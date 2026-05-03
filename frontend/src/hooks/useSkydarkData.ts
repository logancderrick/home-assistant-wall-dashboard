/**
 * Single shared hook: HA WebSocket connection + all SkyDark domain data
 * with loading/error state and retry. Used by views and AppContext to sync from backend.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { buildDemoSkydarkState } from "../dev/demoSkydarkData";
import { getHAConnection, clearHAConnection } from "../lib/haConnection";
import { isSkydarkDemo } from "../lib/demoMode";
import type { Connection } from "home-assistant-js-websocket";
import {
  fetchAppSettings,
  fetchConfig,
  fetchEvents,
  fetchFamilyMembers,
  fetchLists,
  fetchTasks,
  fetchPoints,
  fetchRewards,
  eventToCalendarEvent,
  type SkydarkEvent,
  type SkydarkList,
  type SkydarkListItem,
  type SkydarkTask,
  type SkydarkReward,
} from "../lib/skyDarkApi";
import type { CalendarEvent } from "../types/calendar";
import type { FamilyMember } from "../types/calendar";

const DEFAULT_EVENT_RANGE_DAYS = 60;

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface SkydarkDataState {
  connection: Connection | null;
  events: CalendarEvent[];
  tasks: SkydarkTask[];
  lists: SkydarkList[];
  listItems: Record<string, SkydarkListItem[]>;
  familyMembers: FamilyMember[];
  config: {
    family_name?: string;
    weather_entity?: string;
    panel_url?: string;
  } | null;
  appSettings: Record<string, unknown> | null;
  pointsByMember: Record<string, number>;
  rewards: SkydarkReward[];
  loading: boolean;
  error: string | null;
}

const initialState: SkydarkDataState = {
  connection: null,
  events: [],
  tasks: [],
  lists: [],
  listItems: {},
  familyMembers: [],
  config: null,
  appSettings: null,
  pointsByMember: {},
  rewards: [],
  loading: true,
  error: null,
};

export function useSkydarkData(
  eventRangeDays: number = DEFAULT_EVENT_RANGE_DAYS,
): {
  data: SkydarkDataState;
  refetch: () => Promise<void>;
  refetchEvents: (startDate?: string, endDate?: string) => Promise<void>;
  refetchLists: () => Promise<void>;
} {
  const [data, setData] = useState<SkydarkDataState>(initialState);

  const load = useCallback(
    async (conn: Connection, startDate?: string, endDate?: string) => {
      const start = startDate ?? formatLocalDate(new Date());
      const end =
        endDate ??
        formatLocalDate(new Date(Date.now() + eventRangeDays * 24 * 60 * 60 * 1000));
      const [
        eventsRes,
        tasksRes,
        listsRes,
        familyRes,
        configRes,
        appSettingsRes,
        pointsRes,
        rewardsRes,
      ] = await Promise.all([
        fetchEvents(conn, start, end),
        fetchTasks(conn),
        fetchLists(conn),
        fetchFamilyMembers(conn),
        fetchConfig(conn),
        fetchAppSettings(conn),
        fetchPoints(conn),
        fetchRewards(conn),
      ]);

      const events: CalendarEvent[] = (eventsRes.events ?? []).map(
        (e: SkydarkEvent) => eventToCalendarEvent(e),
      );
      const listItems: Record<string, SkydarkListItem[]> =
        listsRes.list_items ?? {};
      const cfg = configRes.config ?? {};
      const config = {
        panel_url: configRes.panel_url,
        family_name: (cfg as { family_name?: string }).family_name,
        weather_entity: (cfg as { weather_entity?: string }).weather_entity,
      };

      setData((prev) => ({
        ...prev,
        connection: conn,
        events,
        tasks: tasksRes.tasks ?? [],
        lists: listsRes.lists ?? [],
        listItems,
        familyMembers: Array.isArray(familyRes.family_members)
          ? familyRes.family_members
          : [],
        config,
        appSettings:
          appSettingsRes.settings && typeof appSettingsRes.settings === "object"
            ? appSettingsRes.settings
            : {},
        pointsByMember: pointsRes.points_by_member ?? {},
        rewards: rewardsRes.rewards ?? [],
        loading: false,
        error: null,
      }));
    },
    [eventRangeDays],
  );

  const refetch = useCallback(async () => {
    if (isSkydarkDemo) {
      setData(buildDemoSkydarkState());
      return;
    }
    let conn: Connection | null = null;
    try {
      conn = await getHAConnection();
      setData((prev) => ({ ...prev, connection: conn }));
      await load(conn);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load data";
      setData((prev) => ({
        ...prev,
        ...(conn ? { connection: conn } : {}),
        error: message,
      }));
    }
  }, [load]);

  const refetchEvents = useCallback(
    async (startDate?: string, endDate?: string) => {
      if (isSkydarkDemo) return;
      const conn = data.connection;
      if (!conn) return;
      try {
        const start = startDate ?? formatLocalDate(new Date());
        const end =
          endDate ??
          formatLocalDate(new Date(Date.now() + eventRangeDays * 24 * 60 * 60 * 1000));
        const res = await fetchEvents(conn, start, end);
        const events = (res.events ?? []).map((e: SkydarkEvent) =>
          eventToCalendarEvent(e),
        );
        setData((prev) => ({ ...prev, events }));
      } catch {
        // keep previous events on partial failure
      }
    },
    [data.connection, eventRangeDays],
  );

  const refetchLists = useCallback(async () => {
    if (isSkydarkDemo) return;
    const conn = data.connection;
    if (!conn) return;
    try {
      const listsRes = await fetchLists(conn);
      const listItems: Record<string, SkydarkListItem[]> =
        listsRes.list_items ?? {};
      setData((prev) => ({
        ...prev,
        lists: listsRes.lists ?? [],
        listItems,
      }));
    } catch {
      // keep previous lists on partial failure
    }
  }, [data.connection]);

  // Auto-retry on error: clears stale connection and retries with exponential backoff.
  // Resets when error clears so subsequent failures start fresh.
  const retryCountRef = useRef(0);
  useEffect(() => {
    if (!data.error) {
      retryCountRef.current = 0;
      return;
    }
    if (isSkydarkDemo) return;
    const delay = Math.min(15_000 * Math.pow(1.5, retryCountRef.current), 60_000);
    const timer = setTimeout(() => {
      retryCountRef.current++;
      clearHAConnection();
      void refetch();
    }, delay);
    return () => clearTimeout(timer);
  }, [data.error, refetch]);

  useEffect(() => {
    if (isSkydarkDemo) {
      setData(buildDemoSkydarkState());
      return;
    }
    let cancelled = false;
    (async () => {
      let conn: Connection | null = null;
      setData((prev) => ({ ...prev, loading: true, error: null }));
      try {
        conn = await getHAConnection();
        if (cancelled) return;
        // Core HA WebSocket is ready — expose it immediately so views using
        // `get_states` (cameras, etc.) work even if SkyDark-specific fetch fails.
        setData((prev) => ({ ...prev, connection: conn }));
        await load(conn);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to connect";
        setData((prev) => ({
          ...prev,
          loading: false,
          ...(conn ? { connection: conn } : {}),
          error: message,
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return { data, refetch, refetchEvents, refetchLists };
}
