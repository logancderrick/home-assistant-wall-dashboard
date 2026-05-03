/**
 * Typed wrappers for SkyDark WebSocket API (skydark_calendar/* commands).
 */

import { addDays, format, startOfDay } from "date-fns";
import { callService } from "home-assistant-js-websocket";
import type { Connection } from "home-assistant-js-websocket";
import type { CalendarEvent } from "../types/calendar";
import type { FamilyMember } from "../types/calendar";
import { getHassAccessToken } from "./haAuth";

export interface SkydarkEvent {
  id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time?: string | null;
  all_day?: number;
  location?: string | null;
  calendar_id?: string | null;
  calendar_ids?: string[] | string | null;
  color?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  external_id?: string | null;
  external_source?: string | null;
}

export interface SkydarkTask {
  id: string;
  title: string;
  assignee_id: string;
  category?: string | null;
  frequency?: string | null;
  icon?: string | null;
  points?: number;
  completed_date?: string | null;
  created_at?: string | null;
  due_date?: string | null;
  weekdays?: number[] | null;
}

export interface SkydarkList {
  id: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  sort_order?: number | null;
  owner_id?: string | null;
  list_type?: string | null;
}

export interface SkydarkListItem {
  id: string;
  list_id: string;
  content: string;
  completed: number;
  sort_order?: number | null;
  created_at?: string | null;
}

export interface SkydarkMeal {
  id: string;
  name: string;
  recipe_url?: string | null;
  ingredients?: string | null;
  image_url?: string | null;
  instructions?: string | null;
  meal_date: string;
  meal_type: string;
  created_at?: string | null;
  meal_recipe_id?: string | null;
}

export interface SkydarkPhoto {
  id: string;
  file_path: string;
  caption?: string | null;
  uploaded_by?: string | null;
  created_at?: string | null;
}

export interface SkydarkConfig {
  panel_url?: string;
  config?: { family_name?: string; weather_entity?: string };
}

const SEND_TIMEOUT_MS = 20_000;

function send<T>(conn: Connection, message: { type: string; [key: string]: unknown }): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgPromise = conn.sendMessagePromise(message as any) as Promise<T>;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("HA WebSocket request timed out")),
      SEND_TIMEOUT_MS,
    );
    msgPromise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function fetchEvents(
  conn: Connection,
  startDate?: string,
  endDate?: string
): Promise<{ events: SkydarkEvent[] }> {
  const msg: { type: string; start_date?: string; end_date?: string } = { type: "skydark_calendar/get_events" };
  if (startDate) msg.start_date = startDate;
  if (endDate) msg.end_date = endDate;
  return send(conn, msg);
}

export async function fetchTasks(conn: Connection): Promise<{ tasks: SkydarkTask[] }> {
  return send(conn, { type: "skydark_calendar/get_tasks" });
}

export async function fetchLists(conn: Connection): Promise<{
  lists: SkydarkList[];
  list_items: Record<string, SkydarkListItem[]>;
}> {
  return send(conn, { type: "skydark_calendar/get_lists" });
}

export async function fetchMeals(
  conn: Connection,
  startDate?: string,
  endDate?: string
): Promise<{ meals: SkydarkMeal[] }> {
  const msg: { type: string; start_date?: string; end_date?: string } = { type: "skydark_calendar/get_meals" };
  if (startDate) msg.start_date = startDate;
  if (endDate) msg.end_date = endDate;
  return send(conn, msg);
}

export async function fetchFamilyMembers(conn: Connection): Promise<{
  family_members: FamilyMember[];
}> {
  return send(conn, { type: "skydark_calendar/get_family_members" });
}

export async function fetchPhotos(conn: Connection): Promise<{
  photos: SkydarkPhoto[];
}> {
  return send(conn, { type: "skydark_calendar/get_photos" });
}

export async function addPhotoWS(
  conn: Connection,
  data: { url: string; caption?: string; uploaded_by?: string; filename?: string }
): Promise<{ photo_id: string }> {
  return send(conn, { type: "skydark_calendar/add_photo", ...data });
}

export async function deletePhotoWS(
  conn: Connection,
  photoId: string
): Promise<{ success: boolean }> {
  return send(conn, { type: "skydark_calendar/delete_photo", photo_id: photoId });
}

export function isDisplayableMediaResolveUrl(resolved: string, mediaContentId: string): boolean {
  const s = resolved.trim();
  if (!s || s === mediaContentId) return false;
  if (s.startsWith("media-source://")) return false;
  return (
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("//") ||
    s.startsWith("/") ||
    s.startsWith("data:image/")
  );
}

/**
 * Skydark stores calendar photos under HA local media as
 * `media-source://media_source/local/<encoded path>`, which is served at the same path under
 * `/media/local/<encoded path>`. When `media_source/resolve_media` fails or returns a shape we
 * cannot use, this is a safe same-origin fallback for `<img src>`.
 */
export function localMediaSourceToMediaPath(mediaContentId: string): string | null {
  const prefix = "media-source://media_source/local/";
  if (!mediaContentId.startsWith(prefix)) return null;
  const tail = mediaContentId.slice(prefix.length).trim();
  if (!tail) return null;
  return `/media/local/${tail}`;
}

function absolutizeResolvedMediaUrl(url: string): string {
  const u = url.trim();
  if (u.startsWith("//")) return `${window.location.protocol}${u}`;
  if (u.startsWith("/")) return `${window.location.origin}${u}`;
  return u;
}

function withHassAccessToken(url: string, conn: Connection | null): string {
  const token = getHassAccessToken(conn);
  if (!token) return url;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;
  if (trimmed.startsWith("media-source://")) return trimmed;
  let absolute = trimmed;
  if (trimmed.startsWith("//")) absolute = `${window.location.protocol}${trimmed}`;
  else if (trimmed.startsWith("/")) absolute = `${window.location.origin}${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(absolute, window.location.origin);
  } catch {
    return trimmed;
  }
  if (parsed.origin !== window.location.origin) return trimmed;
  if (
    !(
      parsed.pathname.startsWith("/media/") ||
      parsed.pathname.startsWith("/api/") ||
      parsed.pathname.startsWith("/local/")
    )
  ) {
    return absolute;
  }
  // resolve_media often returns ?authSig=…; adding access_token on top can break HA (401).
  const hasMediaQueryAuth =
    parsed.searchParams.has("access_token") ||
    parsed.searchParams.has("authSig") ||
    parsed.searchParams.has("auth_sig");
  if (!hasMediaQueryAuth) parsed.searchParams.set("access_token", token);
  return parsed.toString();
}

export function makeDisplayableMediaUrl(url: string, conn: Connection | null): string {
  const absolute = absolutizeResolvedMediaUrl(url);
  return withHassAccessToken(absolute, conn);
}

/**
 * Resolve `media-source://…` to a browser URL, following the same WebSocket contract as Home
 * Assistant’s frontend (`media_source/resolve_media` → `{ url, mime_type }`).
 *
 * References (HA expects you to use `result.url` as-is, not append WS OAuth tokens):
 * - https://github.com/home-assistant/frontend/blob/dev/src/data/media_source.ts (`resolveMediaSource`)
 * - https://github.com/home-assistant/frontend/blob/dev/src/panels/lovelace/cards/hui-picture-card.ts (assigns `result.url` to `<img src>`)
 * - https://www.home-assistant.io/integrations/media_source/ (media is HA-authenticated; signed URLs come from resolve)
 */
export async function resolveMediaUrl(
  conn: Connection,
  mediaContentId: string
): Promise<string> {
  const id = mediaContentId.trim();
  if (!id.startsWith("media-source://")) {
    // HA `/media/` and `/local/` static paths authenticate via session cookies in the HA UI
    // pattern (see `hui-picture-card`). Stripping the token keeps our <img> requests aligned
    // with that, and `haMediaImgSrc` makes sure cookies are used.
    if (id.startsWith("/media/") || id.startsWith("/local/")) {
      return absolutizeResolvedMediaUrl(id);
    }
    // `/api/...` views (including our Skydark photo view) need an explicit bearer-style token
    // on the query string because <img> requests cannot carry an Authorization header.
    return makeDisplayableMediaUrl(id, conn);
  }

  const localFallback = localMediaSourceToMediaPath(id);

  try {
    const res = await send<{ url?: unknown }>(conn, {
      type: "media_source/resolve_media",
      media_content_id: id,
    });
    const raw = res?.url;
    if (typeof raw === "string") {
      const url = raw.trim();
      if (url && isDisplayableMediaResolveUrl(url, id)) {
        return absolutizeResolvedMediaUrl(url);
      }
    }
  } catch {
    // Fall through to local /media/local/ path when resolve is unavailable or rejected.
  }

  if (localFallback) {
    return absolutizeResolvedMediaUrl(localFallback);
  }
  return "";
}

export async function fetchConfig(conn: Connection): Promise<{
  panel_url?: string;
  config?: Record<string, unknown>;
}> {
  return send(conn, { type: "skydark_calendar/get_config" });
}

export async function fetchAppSettings(conn: Connection): Promise<{
  settings?: Record<string, unknown>;
}> {
  return send(conn, { type: "skydark_calendar/get_app_settings" });
}

export async function saveAppSettings(
  conn: Connection,
  settings: Record<string, unknown>
): Promise<{ success: boolean }> {
  return send(conn, { type: "skydark_calendar/set_app_settings", settings });
}

export async function fetchPoints(conn: Connection): Promise<{ points_by_member: Record<string, number> }> {
  return send(conn, { type: "skydark_calendar/get_points" });
}

export interface SkydarkReward {
  id: string;
  name: string;
  points_required: number;
  description?: string | null;
  icon?: string | null;
}

export async function fetchRewards(conn: Connection): Promise<{ rewards: SkydarkReward[] }> {
  return send(conn, { type: "skydark_calendar/get_rewards" });
}

export interface SkydarkMealRecipe {
  id: string;
  name: string;
  ingredients: { name: string; quantity?: string; unit?: string }[];
  image_url?: string | null;
  instructions?: string | null;
}

export async function fetchMealRecipes(conn: Connection): Promise<{ recipes: SkydarkMealRecipe[] }> {
  return send(conn, { type: "skydark_calendar/get_meal_recipes" });
}

/** Normalize backend event to frontend CalendarEvent shape */
export function eventToCalendarEvent(e: SkydarkEvent): CalendarEvent {
  const legacyCalendarId = e.calendar_id;
  let multiCalendarIds: string[] = [];
  if (Array.isArray(e.calendar_ids)) {
    multiCalendarIds = e.calendar_ids.map((id) => String(id)).filter(Boolean);
  } else if (typeof e.calendar_ids === "string" && e.calendar_ids.trim()) {
    try {
      const parsed = JSON.parse(e.calendar_ids);
      if (Array.isArray(parsed)) {
        multiCalendarIds = parsed.map((id) => String(id)).filter(Boolean);
      }
    } catch {
      multiCalendarIds = [e.calendar_ids];
    }
  }
  return {
    id: e.id,
    title: e.title,
    description: e.description ?? undefined,
    start_time: e.start_time,
    end_time: e.end_time ?? undefined,
    all_day: Boolean(e.all_day),
    location: e.location ?? undefined,
    calendar_id:
      multiCalendarIds.length > 0
        ? multiCalendarIds
        : legacyCalendarId
          ? [String(legacyCalendarId)]
          : undefined,
    recurrence_rule: undefined,
    external_id: e.external_id ?? undefined,
    external_source: e.external_source ?? undefined,
  };
}

// --- HA service calls (skydark_calendar domain) ---

const DOMAIN = "skydark_calendar";

export async function serviceAddEvent(
  conn: Connection,
  data: {
    title: string;
    start_time: string;
    end_time?: string;
    all_day?: boolean;
    calendar_id?: string;
    calendar_ids?: string[];
    description?: string;
    location?: string;
  }
): Promise<unknown> {
  return callService(conn, DOMAIN, "add_event", data);
}

/**
 * Mirror a new event onto another HA calendar (e.g. Google) via calendar.create_event.
 * Skips silently if the entity id is missing or invalid.
 */
export async function pushEventToHaCalendar(
  conn: Connection,
  entityId: string,
  data: {
    title: string;
    start_time: string;
    end_time?: string;
    all_day?: boolean;
    description?: string;
    location?: string;
  }
): Promise<void> {
  const id = entityId.trim();
  if (!id.startsWith("calendar.")) return;

  const summary = data.title;
  const description = data.description ?? "";
  const location = data.location ?? "";

  if (data.all_day) {
    const startLocal = startOfDay(new Date(data.start_time));
    const lastInclusive = data.end_time
      ? startOfDay(new Date(data.end_time))
      : startLocal;
    const last = lastInclusive < startLocal ? startLocal : lastInclusive;
    const endExclusive = addDays(last, 1);
    await callService(
      conn,
      "calendar",
      "create_event",
      {
        summary,
        description,
        location,
        all_day: true,
        start_date: format(startLocal, "yyyy-MM-dd"),
        end_date: format(endExclusive, "yyyy-MM-dd"),
      },
      { entity_id: id }
    );
    return;
  }

  const start = new Date(data.start_time);
  const end = data.end_time
    ? new Date(data.end_time)
    : new Date(start.getTime() + 60 * 60 * 1000);
  await callService(
    conn,
    "calendar",
    "create_event",
    {
      summary,
      description,
      location,
      start_date_time: start.toISOString(),
      end_date_time: end.toISOString(),
    },
    { entity_id: id }
  );
}

export async function serviceAddTask(
  conn: Connection,
  data: {
    title: string;
    assignee_id: string;
    category?: string;
    frequency?: string;
    icon?: string;
    points?: number;
    due_date?: string;
  }
): Promise<unknown> {
  return callService(conn, DOMAIN, "add_task", data);
}

export async function serviceUpdateTask(
  conn: Connection,
  data: {
    task_id: string;
    title?: string;
    assignee_id?: string;
    category?: string;
    frequency?: string;
    icon?: string;
    points?: number;
    due_date?: string;
  }
): Promise<unknown> {
  return callService(conn, DOMAIN, "update_task", data);
}

export async function serviceCompleteTask(
  conn: Connection,
  data: { task_id: string; completed_date?: string; points?: number }
): Promise<unknown> {
  return callService(conn, DOMAIN, "complete_task", data);
}

export async function serviceAddReward(
  conn: Connection,
  data: { name: string; points_required: number; description?: string; icon?: string }
): Promise<unknown> {
  return callService(conn, DOMAIN, "add_reward", data);
}

export async function serviceAddPoints(
  conn: Connection,
  data: { member_id: string; points: number; reason: string; task_id?: string }
): Promise<unknown> {
  return callService(conn, DOMAIN, "add_points", data);
}

/** Delete a reward via WebSocket (same connection as get_rewards; more reliable than callService in panels). */
export async function deleteReward(conn: Connection, rewardId: string): Promise<void> {
  await send<{ success: boolean }>(conn, {
    type: "skydark_calendar/delete_reward",
    reward_id: rewardId,
  });
}

export async function serviceRedeemReward(
  conn: Connection,
  data: { member_id: string; reward_id: string }
): Promise<unknown> {
  return callService(conn, DOMAIN, "redeem_reward", data);
}

export async function serviceCreateList(
  conn: Connection,
  data: { name: string; color?: string; owner_id?: string; list_type?: string }
): Promise<unknown> {
  return callService(conn, DOMAIN, "create_list", { ...data, list_type: data.list_type ?? "general" });
}

export async function serviceAddListItem(
  conn: Connection,
  data: { list_id: string; content: string }
): Promise<unknown> {
  return callService(conn, DOMAIN, "add_list_item", data);
}

export async function serviceDeleteList(conn: Connection, listId: string): Promise<unknown> {
  return callService(conn, DOMAIN, "delete_list", { list_id: listId });
}

export async function serviceDeleteListItem(conn: Connection, itemId: string): Promise<unknown> {
  return callService(conn, DOMAIN, "delete_list_item", { item_id: itemId });
}

export async function serviceAddMealRecipe(
  conn: Connection,
  data: {
    name: string;
    ingredients?: { name: string; quantity?: string; unit?: string }[];
    image_url?: string;
    instructions?: string;
  }
): Promise<unknown> {
  return callService(conn, DOMAIN, "add_meal_recipe", {
    name: data.name,
    ingredients: data.ingredients ?? [],
    image_url: data.image_url,
    instructions: data.instructions,
  });
}

/** Add a meal recipe via WebSocket and return the new recipe_id (for linking to a meal). */
export async function fetchAddMealRecipe(
  conn: Connection,
  data: {
    name: string;
    ingredients?: { name: string; quantity?: string; unit?: string }[];
    image_url?: string;
    instructions?: string;
  }
): Promise<{ recipe_id: string }> {
  const res = await send<{ recipe_id: string }>(conn, {
    type: "skydark_calendar/add_meal_recipe",
    name: data.name,
    ingredients: (data.ingredients ?? []).map((i) => ({
      name: i.name,
      quantity: i.quantity ?? "",
      unit: i.unit ?? "",
    })),
    image_url: data.image_url,
    instructions: data.instructions,
  });
  return res;
}

export async function serviceAddMeal(
  conn: Connection,
  data: {
    name: string;
    meal_date: string;
    meal_type: string;
    recipe_url?: string;
    ingredients?: string;
    image_url?: string;
    instructions?: string;
    meal_recipe_id?: string;
  }
): Promise<unknown> {
  return callService(conn, DOMAIN, "add_meal", data);
}

export async function addFamilyMemberWS(
  conn: Connection,
  data: { name: string; color: string; initial?: string; avatar_url?: string }
): Promise<{ family_member: FamilyMember & { avatar_url?: string | null; sort_order?: number | null } }> {
  return send(conn, { type: "skydark_calendar/add_family_member", ...data });
}

export async function updateFamilyMemberWS(
  conn: Connection,
  data: {
    member_id: string;
    name?: string;
    color?: string;
    initial?: string;
    avatar_url?: string;
    sort_order?: number;
  }
): Promise<{ success: boolean }> {
  return send(conn, { type: "skydark_calendar/update_family_member", ...data });
}

export async function deleteFamilyMemberWS(
  conn: Connection,
  memberId: string
): Promise<{ success: boolean }> {
  return send(conn, { type: "skydark_calendar/delete_family_member", member_id: memberId });
}

export async function serviceDeleteTask(
  conn: Connection,
  data: { task_id: string }
): Promise<unknown> {
  return callService(conn, DOMAIN, "delete_task", data);
}

export async function serviceUpdateMeal(
  conn: Connection,
  data: {
    meal_id: string;
    name?: string;
    meal_recipe_id?: string;
    ingredients?: string;
    image_url?: string;
    instructions?: string;
  }
): Promise<unknown> {
  return callService(conn, DOMAIN, "update_meal", data);
}

export async function serviceDeleteMeal(
  conn: Connection,
  data: { meal_id: string }
): Promise<unknown> {
  return callService(conn, DOMAIN, "delete_meal", data);
}
