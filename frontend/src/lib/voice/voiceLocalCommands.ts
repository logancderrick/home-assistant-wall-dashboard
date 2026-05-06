/**
 * Interprets spoken phrases for SkyDark dashboard actions (lists, alarms) locally
 * before / alongside the Home Assistant Assist pipeline.
 */

import type { Connection } from "home-assistant-js-websocket";
import { addDays, addMinutes, format, setHours, setMilliseconds, setMinutes, setSeconds, startOfDay } from "date-fns";
import type { SkydarkList } from "../skyDarkApi";
import { pushEventToHaCalendar, serviceAddEvent, serviceAddListItem, serviceTimerStart } from "../skyDarkApi";

export interface VoiceDashboardContext {
  lists: Pick<SkydarkList, "id" | "name">[];
  /** When set, phrases like "add milk" (no list name) use this list. */
  voiceDefaultListId?: string;
  defaultFamilyCalendarMemberId?: string | undefined;
  pushEventsToCalendarEntityId?: string | undefined;
  /** Optional `timer.*` entity for "timer 10 minutes". */
  voiceTimerEntityId?: string | undefined;
  listAddLocked: boolean;
  addEventsLocked: boolean;
}

export interface VoiceDashboardExecutors {
  conn: Connection;
  refetchLists: () => Promise<void>;
  refetchEvents: () => Promise<void>;
}

export interface VoiceDashboardMatch {
  /** Spoken confirmation when local handling replaces pipeline TTS. */
  speakSummary: string;
  apply: () => Promise<void>;
}

function collapseWs(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function normalizeTranscript(transcript: string): string {
  return collapseWs(transcript.replace(/\u2019/g, "'")).replace(/\.+$/, "");
}

function findListForHint(
  lists: Pick<SkydarkList, "id" | "name">[],
  hintRaw: string
): Pick<SkydarkList, "id" | "name"> | null {
  const hint = collapseWs(hintRaw).toLowerCase();
  if (!hint) return null;
  const ranked = [...lists].sort((a, b) => b.name.length - a.name.length);
  const exact = ranked.find((l) => l.name.toLowerCase() === hint);
  if (exact) return exact;
  const incl = ranked.find((l) => hint.includes(l.name.toLowerCase()) || l.name.toLowerCase().includes(hint));
  return incl ?? null;
}

/** "add eggs to grocery", "put milk on the shopping list". */
export function parseExplicitListAdd(transcript: string): { content: string; listHint: string } | null {
  const t = normalizeTranscript(transcript);
  const re =
    /^(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the\s+)?(.+?)(?:\s+list)?$/i;
  const m = t.match(re);
  if (!m) return null;
  const content = collapseWs(m[1]);
  const listHint = collapseWs(m[2]);
  if (!content || !listHint) return null;
  return { content, listHint };
}

/** "add milk" using default list only. */
export function parseDefaultListAdd(
  transcript: string,
  defaultListId: string | undefined,
  lists: Pick<SkydarkList, "id" | "name">[]
): string | null {
  if (!defaultListId?.trim()) return null;
  if (!lists.some((l) => l.id === defaultListId)) return null;
  const t = normalizeTranscript(transcript);
  const m = t.match(/^please\s+(?:add|put)\s+(.+)$/i) ?? t.match(/^(?:add|put)\s+(.+)$/i);
  if (!m) return null;
  const content = collapseWs(m[1]);
  if (!content) return null;
  if (/\s(?:to|on)\s+/i.test(content)) return null;
  return content;
}

function durationSeconds(amount: number, unit: string): number {
  const stem = unit.toLowerCase().replace(/s$/, "");
  if (stem === "second") return amount;
  if (stem === "minute") return amount * 60;
  if (stem === "hour") return amount * 3600;
  return amount * 60;
}

/** Relative timers: "timer 10 minutes", "in 15 minutes", "alarm for 5 minutes". */
export function parseDurationTimer(transcript: string): { seconds: number } | null {
  const t = normalizeTranscript(transcript);

  let m = t.match(/\b(?:in)\s+(\d+)\s*(seconds?|minutes?|hours?)\b/i);
  if (m) return { seconds: durationSeconds(Number(m[1]), m[2]) };

  if ((m = t.match(/^please\s+set\s+(?:a\s+)?timer\s+(?:for\s+)?(\d+)\s*(seconds?|minutes?|hours?)\b/i)))
    return { seconds: durationSeconds(Number(m[1]), m[2]) };
  if ((m = t.match(/^set\s+(?:a\s+)?timer\s+(?:for\s+)?(\d+)\s*(seconds?|minutes?|hours?)\b/i)))
    return { seconds: durationSeconds(Number(m[1]), m[2]) };
  if ((m = t.match(/^timer\s+(?:for\s+)?(\d+)\s*(seconds?|minutes?|hours?)\b/i)))
    return { seconds: durationSeconds(Number(m[1]), m[2]) };

  if ((m = t.match(/^set\s+(?:an?\s+)?alarm\s+for\s+(\d+)\s*(seconds?|minutes?|hours?)\b/i)))
    return { seconds: durationSeconds(Number(m[1]), m[2]) };

  return null;
}

interface ParsedWallTime {
  hour24: number;
  minute: number;
}

/** First clock match in fragment: 6:30pm, 7 am, 16:45, 7 (no suffix). */
function parseWallClockToken(frag: string): ParsedWallTime | null {
  const t = collapseWs(frag);
  let m = t.match(/\b(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?\b/i);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = m[3].toLowerCase() === "p";
    const isAm = m[3].toLowerCase() === "a";
    if (ap && h < 12) h += 12;
    if (isAm && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return { hour24: h, minute: min };
  }
  m = t.match(/\b(\d{1,2})\s*([ap])\.?\s*m\.?\b/i);
  if (m) {
    let h = Number(m[1]);
    const ap = m[2].toLowerCase() === "p";
    const isAm = m[2].toLowerCase() === "a";
    if (ap && h < 12) h += 12;
    if (isAm && h === 12) h = 0;
    if (h > 23) return null;
    return { hour24: h, minute: 0 };
  }
  m = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return { hour24: h, minute: min };
  }
  m = t.match(/\b(\d{1,2})\b/);
  if (m) {
    const h = Number(m[1]);
    if (h < 1 || h > 12) return null;
    return { hour24: h, minute: 0 };
  }
  return null;
}

function stripMatchedTimeFromFragment(fragment: string): string {
  const t = collapseWs(fragment.replace(/^at\s+/i, ""));
  const patterns: RegExp[] = [
    /\b\d{1,2}:\d{2}\s*[ap]\.?\s*m\.?\b/i,
    /\b\d{1,2}\s*[ap]\.?\s*m\.?\b/i,
    /\b\d{1,2}:\d{2}\b/,
    /\b\d{1,2}\b/,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m && m.index !== undefined && m[0]) {
      return collapseWs(
        `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)}`,
      )
        .replace(/\b(at|for|the|on|today|tomorrow|tonight)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  }
  return t;
}

/**
 * Parses wall-clock alarms: "set alarm for 7 p.m.", "wake me up at 7", "remind me at 16:30 tomorrow".
 */
export function parseClockAlarm(transcript: string, now: Date): { at: Date; title: string } | null {
  const t = normalizeTranscript(transcript);
  const tomorrow = /\btomorrow\b/i.test(t);

  let fragments = "";

  let m = t.match(/\bwake\s+me(?:\s+up)?\s+(?:at\s+)?(.+)$/i);
  if (m) fragments = m[1] ?? "";

  if (!fragments) {
    m = t.match(/\bremind\s+me\s+to\s+.+\s+at\s+(.+)$/i);
    if (m) fragments = m[1] ?? "";
  }
  if (!fragments) {
    m = t.match(/\bremind\s+me\s+at\s+(.+)$/i);
    if (m) fragments = m[1] ?? "";
  }

  if (!fragments) {
    m = t.match(/\b(?:set\s+(?:an?\s+)?)?(?:alarm|reminder)\s+for\s+(.+)$/i);
    if (m) fragments = m[1] ?? "";
  }

  fragments = collapseWs(fragments.replace(/^at\s+/i, ""));
  if (!fragments) return null;

  const wt = parseWallClockToken(fragments);
  if (!wt) return null;

  const baseDay = tomorrow ? addDays(startOfDay(now), 1) : startOfDay(now);
  let candidate = setMilliseconds(
    setSeconds(setMinutes(setHours(baseDay, wt.hour24), wt.minute), 0),
    0,
  );

  const hasExplicitAmpm = /[ap]\.?\s*m\.?\b/i.test(fragments);
  const hasColonMinutes = /\b\d{1,2}:\d{2}\b/.test(fragments);
  const bareHourGuess = wt.hour24 <= 12 && !hasColonMinutes && !hasExplicitAmpm;

  if (bareHourGuess) {
    while (candidate.getTime() <= now.getTime()) {
      candidate = addMinutes(candidate, 12 * 60);
    }
  } else {
    while (!tomorrow && candidate.getTime() <= now.getTime()) {
      candidate = addDays(candidate, 1);
    }
  }

  const leftover = stripMatchedTimeFromFragment(fragments);
  const title = leftover.length >= 2 ? leftover.slice(0, 96) : "Alarm";

  return { at: candidate, title };
}

export function matchVoiceDashboardCommand(
  transcript: string,
  ctx: VoiceDashboardContext,
  exec: VoiceDashboardExecutors
): VoiceDashboardMatch | null {
  const trimmed = transcript.trim();
  if (trimmed.length < 3) return null;

  const lists = ctx.lists;
  const now = new Date();

  const explicit = parseExplicitListAdd(trimmed);
  if (explicit && !ctx.listAddLocked) {
    const list = findListForHint(lists, explicit.listHint);
    if (!list) return null;
    const content = explicit.content;
    const speakSummary = `Added ${content} to ${list.name}.`;
    return {
      speakSummary,
      apply: async () => {
        await serviceAddListItem(exec.conn, { list_id: list.id, content });
        await exec.refetchLists();
      },
    };
  }

  const defaultItem = parseDefaultListAdd(trimmed, ctx.voiceDefaultListId, lists);
  if (defaultItem && !ctx.listAddLocked) {
    const listId = ctx.voiceDefaultListId!;
    const name = lists.find((l) => l.id === listId)?.name ?? "list";
    const speakSummary = `Added ${defaultItem} to ${name}.`;
    return {
      speakSummary,
      apply: async () => {
        await serviceAddListItem(exec.conn, { list_id: listId, content: defaultItem });
        await exec.refetchLists();
      },
    };
  }

  const dur = parseDurationTimer(trimmed);
  if (dur) {
    const timerEntity = ctx.voiceTimerEntityId?.trim();
    const parts =
      dur.seconds >= 3600
        ? `${Math.floor(dur.seconds / 3600)} hour${dur.seconds >= 7200 ? "s" : ""}`
        : dur.seconds >= 60
          ? `${Math.round(dur.seconds / 60)} minute${dur.seconds >= 120 ? "s" : ""}`
          : `${dur.seconds} second${dur.seconds !== 1 ? "s" : ""}`;
    const speakSummary = timerEntity?.startsWith("timer.")
      ? `Timer started for ${parts}.`
      : `Countdown set for ${parts}.`;

    return {
      speakSummary,
      apply: async () => {
        if (timerEntity?.startsWith("timer.")) {
          await serviceTimerStart(exec.conn, timerEntity, dur.seconds);
          return;
        }
        if (ctx.addEventsLocked) return;
        const start = new Date(now.getTime() + dur.seconds * 1000);
        const end = addMinutes(start, 1);
        await serviceAddEvent(exec.conn, {
          title: "Timer",
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          calendar_id: ctx.defaultFamilyCalendarMemberId,
        });
        const pushId = ctx.pushEventsToCalendarEntityId?.trim();
        if (pushId?.startsWith("calendar.")) {
          try {
            await pushEventToHaCalendar(exec.conn, pushId, {
              title: "Timer",
              start_time: start.toISOString(),
              end_time: end.toISOString(),
            });
          } catch {
            // optional mirror
          }
        }
        await exec.refetchEvents();
      },
    };
  }

  const clock = !ctx.addEventsLocked ? parseClockAlarm(trimmed, now) : null;
  if (clock) {
    const end = addMinutes(clock.at, 15);
    const speakSummary = `Alarm set for ${format(clock.at, "h:mm a")}.`;
    return {
      speakSummary,
      apply: async () => {
        await serviceAddEvent(exec.conn, {
          title: clock.title,
          start_time: clock.at.toISOString(),
          end_time: end.toISOString(),
          calendar_id: ctx.defaultFamilyCalendarMemberId,
        });
        const pushId = ctx.pushEventsToCalendarEntityId?.trim();
        if (pushId?.startsWith("calendar.")) {
          try {
            await pushEventToHaCalendar(exec.conn, pushId, {
              title: clock.title,
              start_time: clock.at.toISOString(),
              end_time: end.toISOString(),
            });
          } catch {
            // optional mirror
          }
        }
        await exec.refetchEvents();
      },
    };
  }

  return null;
}
