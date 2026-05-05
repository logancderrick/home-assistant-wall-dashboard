/**
 * Centralized app state: family members, settings, and PIN auth.
 * Used by Calendar, Tasks, Rewards, Lists, and Settings so all views share the same accounts.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { FamilyMember } from "../types/calendar";
import { useSkydarkDataContext } from "./SkydarkDataContext";
import {
  addFamilyMemberWS,
  deleteFamilyMemberWS,
  saveAppSettings,
  updateFamilyMemberWS,
} from "../lib/skyDarkApi";
import { isSkydarkDemo } from "../lib/demoMode";
import { readStoredThemePreference, writeStoredThemePreference } from "../lib/themePreferenceStorage";

const STORAGE_KEY_SETTINGS = "skydark_app_settings";
const STORAGE_KEY_MEMBERS = "skydark_family_members";
const STORAGE_KEY_SHOPPING_CHECKED = "skydark_shopping_checked";

const DEFAULT_MEMBERS: FamilyMember[] = [
  { id: "1", name: "Logan", color: "#C8E6F5", initial: "L" },
  { id: "2", name: "Kaylee", color: "#FFD4D4", initial: "K" },
  { id: "3", name: "Kittrick", color: "#C8F5E8", initial: "Ki" },
];

const DEFAULT_REMOTE_CALENDAR_ENTITIES: string[] = [
  "calendar.logan_work_ahead",
  "calendar.logan_work_cornelis",
  "calendar.kaylee_work",
  "calendar.family",
];

export interface LockedFeatures {
  addEvents: boolean;
  editDeleteEvents: boolean;
  createLists: boolean;
  deleteLists: boolean;
  addItemsToLists: boolean;
  checkLists: boolean;
  addChores: boolean;
  deleteChores: boolean;
  completeChores: boolean;
  addRewards: boolean;
  claimRewards: boolean;
  meals: boolean;
  mealprep: boolean;
  changeSettings: boolean;
}

const DEFAULT_LOCKED_FEATURES: LockedFeatures = {
  addEvents: false,
  editDeleteEvents: false,
  createLists: false,
  deleteLists: false,
  addItemsToLists: false,
  checkLists: false,
  addChores: false,
  deleteChores: false,
  completeChores: false,
  addRewards: false,
  claimRewards: false,
  meals: false,
  mealprep: false,
  changeSettings: false,
};

export type LockedFeatureKey = keyof LockedFeatures;

export interface AppSettings {
  familyName: string;
  pinCodeHash?: string;
  lockEnabled: boolean;
  autoRelockEnabled: boolean;
  autoRelockMinutes: number;
  lockedFeatures: LockedFeatures;
  /** Optional US ZIP code for weather API lookups. */
  weatherZipCode: string;
  /** Show a compact 7-day forecast row in the top header. */
  showTopWeeklyForecast: boolean;
  /** Meal prep checked-state map (shopping item id -> checked). */
  shoppingChecked: Record<string, boolean>;
  /** Home Assistant calendar entity IDs to merge into the calendar (e.g. calendar.google_work). */
  remoteCalendarEntities?: string[];
  /** Per-entity visibility for remote calendar events (false = hidden). */
  remoteCalendarVisibility?: Record<string, boolean>;
  /** Per remote calendar entity_id -> #RRGGBB for event chips and toggles. */
  remoteCalendarColors?: Record<string, string>;
  /** Optional friendly names for merged calendar entities (entity_id -> label). */
  remoteCalendarLabels?: Record<string, string>;
  /** When set, new events default to this family member; otherwise "Family" profile or first member. */
  defaultFamilyCalendarMemberId?: string;
  /**
   * Optional HA calendar entity_id. After each new SkyDark event, `calendar.create_event` is called
   * so the event appears on that calendar (Google / iCal sync, etc.).
   */
  pushEventsToCalendarEntityId?: string;
  /** Optional `camera.*` entity IDs shown as a live strip on the calendar page (rotates if more than one). */
  calendarPreviewCameras: string[];
  /** Seconds between cameras when `calendarPreviewCameras` has multiple entries (clamped 10–120). */
  calendarPreviewRotateSeconds: number;
  /** Overall UI palette: light (default) or dark. */
  themePreference: "light" | "dark";
  /** Voice satellite entity ID (e.g. "assist_satellite.wall_panel") for hands-free control. */
  voiceSatelliteEntityId?: string;
  /** Optional pipeline ID override for voice satellite; undefined = use default pipeline. */
  voicePipelineId?: string;
  /** Wake word sensitivity for on-device detection (0.0–1.0, default 0.5). */
  wakeWordSensitivity?: number;
  /** Enable wake word detection (default true when entity ID is configured). */
  wakeWordEnabled?: boolean;
  /**
   * On-device wake keyword (same TFLite assets as jxlarrea/voice-satellite-card-integration).
   * Default `hey_jarvis`.
   */
  voiceWakeWordModelId?: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  familyName: "The Derricks",
  remoteCalendarEntities: [...DEFAULT_REMOTE_CALENDAR_ENTITIES],
  lockEnabled: false,
  autoRelockEnabled: false,
  autoRelockMinutes: 5,
  lockedFeatures: DEFAULT_LOCKED_FEATURES,
  weatherZipCode: "",
  showTopWeeklyForecast: false,
  shoppingChecked: {},
  calendarPreviewCameras: [],
  calendarPreviewRotateSeconds: 20,
  themePreference: "light",
  voiceSatelliteEntityId: "",
  voicePipelineId: "",
  wakeWordSensitivity: 0.5,
  wakeWordEnabled: true,
  voiceWakeWordModelId: "hey_jarvis",
};

interface AppState {
  familyMembers: FamilyMember[];
  settings: AppSettings;
  isAuthenticated: boolean;
  isLocked: boolean;
}

interface AppContextValue extends AppState {
  setFamilyMembers: (members: FamilyMember[] | ((prev: FamilyMember[]) => FamilyMember[])) => void;
  addFamilyMember: (member: Omit<FamilyMember, "id">) => FamilyMember;
  updateFamilyMember: (id: string, updates: Partial<FamilyMember>) => void;
  removeFamilyMember: (id: string) => void;
  setSettings: (settings: Partial<AppSettings>) => void;
  setAuthenticated: (value: boolean) => void;
  verifyPin: (pin: string) => boolean;
  setIsLocked: (locked: boolean) => void;
  isFeatureLocked: (feature: LockedFeatureKey) => boolean;
  unlockApp: (pin: string) => boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

function isValidMember(m: unknown): m is FamilyMember {
  return (
    typeof m === "object" &&
    m !== null &&
    "id" in m &&
    "name" in m &&
    "color" in m &&
    typeof (m as FamilyMember).id === "string" &&
    typeof (m as FamilyMember).name === "string" &&
    typeof (m as FamilyMember).color === "string"
  );
}

function normalizeSettings(candidate: Partial<AppSettings> | null | undefined): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(candidate ?? {}) };
  if (!merged.lockedFeatures) {
    merged.lockedFeatures = { ...DEFAULT_LOCKED_FEATURES };
  } else {
    merged.lockedFeatures = { ...DEFAULT_LOCKED_FEATURES, ...merged.lockedFeatures };
  }
  if (typeof merged.lockEnabled !== "boolean") merged.lockEnabled = false;
  if (typeof merged.autoRelockEnabled !== "boolean") merged.autoRelockEnabled = false;
  if (
    typeof merged.autoRelockMinutes !== "number" ||
    merged.autoRelockMinutes < 1 ||
    merged.autoRelockMinutes > 60
  ) {
    merged.autoRelockMinutes = 5;
  }
  if (typeof merged.familyName !== "string" || !merged.familyName.trim()) {
    merged.familyName = DEFAULT_SETTINGS.familyName;
  }
  if (!merged.shoppingChecked || typeof merged.shoppingChecked !== "object") {
    merged.shoppingChecked = {};
  }
  if (merged.remoteCalendarEntities !== undefined && !Array.isArray(merged.remoteCalendarEntities)) {
    merged.remoteCalendarEntities = [];
  }
  if (
    merged.remoteCalendarVisibility !== undefined &&
    (typeof merged.remoteCalendarVisibility !== "object" || merged.remoteCalendarVisibility === null)
  ) {
    merged.remoteCalendarVisibility = {};
  }
  if (
    merged.remoteCalendarColors !== undefined &&
    (typeof merged.remoteCalendarColors !== "object" || merged.remoteCalendarColors === null)
  ) {
    merged.remoteCalendarColors = {};
  }
  if (
    merged.remoteCalendarLabels !== undefined &&
    (typeof merged.remoteCalendarLabels !== "object" || merged.remoteCalendarLabels === null)
  ) {
    merged.remoteCalendarLabels = {};
  }
  if (
    merged.defaultFamilyCalendarMemberId !== undefined &&
    typeof merged.defaultFamilyCalendarMemberId !== "string"
  ) {
    merged.defaultFamilyCalendarMemberId = undefined;
  }
  if (
    merged.pushEventsToCalendarEntityId !== undefined &&
    typeof merged.pushEventsToCalendarEntityId !== "string"
  ) {
    merged.pushEventsToCalendarEntityId = undefined;
  }
  if (!Array.isArray(merged.calendarPreviewCameras)) {
    merged.calendarPreviewCameras = [];
  } else {
    // Keep partial entity ids while typing in Settings (do not require camera.* prefix here).
    merged.calendarPreviewCameras = merged.calendarPreviewCameras
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim())
      .slice(0, 6);
  }
  let rotateSec = merged.calendarPreviewRotateSeconds;
  if (typeof rotateSec !== "number" || Number.isNaN(rotateSec)) {
    rotateSec = DEFAULT_SETTINGS.calendarPreviewRotateSeconds;
  }
  merged.calendarPreviewRotateSeconds = Math.min(120, Math.max(10, rotateSec));
  if (merged.themePreference !== "light" && merged.themePreference !== "dark") {
    merged.themePreference = "light";
  }
  if (typeof merged.voiceSatelliteEntityId !== "string") {
    merged.voiceSatelliteEntityId = "";
  }
  if (typeof merged.voicePipelineId !== "string") {
    merged.voicePipelineId = "";
  }
  if (typeof merged.wakeWordSensitivity !== "number" || merged.wakeWordSensitivity < 0 || merged.wakeWordSensitivity > 1) {
    merged.wakeWordSensitivity = 0.5;
  }
  if (typeof merged.wakeWordEnabled !== "boolean") {
    merged.wakeWordEnabled = true;
  }
  const allowedWake = new Set([
    "ok_nabu",
    "hey_jarvis",
    "hey_mycroft",
    "alexa",
    "hey_home_assistant",
    "hey_luna",
    "okay_computer",
    "stop",
  ]);
  if (typeof merged.voiceWakeWordModelId !== "string" || !allowedWake.has(merged.voiceWakeWordModelId)) {
    merged.voiceWakeWordModelId = DEFAULT_SETTINGS.voiceWakeWordModelId;
  }
  return merged;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const skydark = useSkydarkDataContext();
  const [familyMembers, setFamilyMembersState] = useState<FamilyMember[]>(DEFAULT_MEMBERS);
  const [settings, setSettingsState] = useState<AppSettings>(() =>
    normalizeSettings({
      ...DEFAULT_SETTINGS,
      themePreference: readStoredThemePreference() ?? DEFAULT_SETTINGS.themePreference,
    })
  );
  const [isAuthenticated, setAuthenticatedState] = useState(false);
  const [isLocked, setIsLockedState] = useState(false);
  const didMigrateLegacyLocalRef = useRef(false);

  // Seed shared state from HA-backed WebSocket data (or demo sample data when VITE_SKYDARK_DEMO is set).
  // useLayoutEffect so the first painted shell after AppBootstrapGate opens already reflects HA settings/members.
  useLayoutEffect(() => {
    if (!skydark?.data) return;
    const conn = skydark.data.connection;
    if (!conn && !isSkydarkDemo) return;
    if (Array.isArray(skydark.data.familyMembers) && skydark.data.familyMembers.length > 0) {
      const valid = skydark.data.familyMembers.filter((m) => isValidMember(m));
      if (valid.length > 0) setFamilyMembersState(valid);
    }
    if (skydark.data.appSettings && typeof skydark.data.appSettings === "object") {
      const fromServer = skydark.data.appSettings as Partial<AppSettings>;
      const storedTheme = readStoredThemePreference();
      setSettingsState(
        normalizeSettings({
          ...fromServer,
          themePreference: storedTheme ?? fromServer.themePreference ?? DEFAULT_SETTINGS.themePreference,
        })
      );
    }
  }, [skydark?.data?.connection, skydark?.data?.familyMembers, skydark?.data?.appSettings]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const dark = settings.themePreference === "dark";
    document.documentElement.classList.toggle("dark", dark);
    writeStoredThemePreference(dark ? "dark" : "light");
  }, [settings.themePreference]);

  // One-time migration: copy old local settings/members into backend settings once connected.
  useEffect(() => {
    if (didMigrateLegacyLocalRef.current) return;
    const conn = skydark?.data?.connection;
    if (!conn) return;
    didMigrateLegacyLocalRef.current = true;

    try {
      const rawSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
      const rawMembers = localStorage.getItem(STORAGE_KEY_MEMBERS);
      const rawShoppingChecked = localStorage.getItem(STORAGE_KEY_SHOPPING_CHECKED);
      if (rawSettings || rawMembers) {
        if (rawSettings) {
          const parsed = JSON.parse(rawSettings) as Partial<AppSettings>;
          const shoppingCheckedFromLegacy = (() => {
            if (!rawShoppingChecked) return {};
            try {
              const parsedChecked = JSON.parse(rawShoppingChecked) as Record<string, boolean>;
              return parsedChecked && typeof parsedChecked === "object" ? parsedChecked : {};
            } catch {
              return {};
            }
          })();
          const merged = normalizeSettings({
            ...parsed,
            shoppingChecked: {
              ...(parsed.shoppingChecked ?? {}),
              ...shoppingCheckedFromLegacy,
            },
          });
          setSettingsState(merged);
          void saveAppSettings(conn, merged as unknown as Record<string, unknown>);
        }
        if (rawMembers) {
          const parsedMembers = JSON.parse(rawMembers) as unknown;
          if (Array.isArray(parsedMembers)) {
            const valid = parsedMembers.filter(isValidMember);
            if (valid.length > 0) {
              setFamilyMembersState(valid);
            }
          }
        }
      }
    } catch {
      // Ignore bad local migration payloads.
    } finally {
      try {
        localStorage.removeItem(STORAGE_KEY_SETTINGS);
        localStorage.removeItem(STORAGE_KEY_MEMBERS);
        localStorage.removeItem(STORAGE_KEY_SHOPPING_CHECKED);
      } catch {
        // ignore
      }
    }
  }, [skydark?.data?.connection]);

  const setFamilyMembers = useCallback(
    (value: FamilyMember[] | ((prev: FamilyMember[]) => FamilyMember[])) => {
      setFamilyMembersState(value);
    },
    []
  );

  const addFamilyMember = useCallback((member: Omit<FamilyMember, "id">): FamilyMember => {
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const newMember: FamilyMember = {
      ...member,
      id,
      initial: member.initial ?? member.name.charAt(0).toUpperCase(),
    };
    const conn = skydark?.data?.connection;
    if (conn) {
      void addFamilyMemberWS(conn, {
        name: newMember.name,
        color: newMember.color,
        initial: newMember.initial,
      })
        .then((res) => {
          const saved = res.family_member;
          if (!saved?.id) return;
          setFamilyMembersState((prev) => [...prev, {
            id: String(saved.id),
            name: String(saved.name ?? newMember.name),
            color: String(saved.color ?? newMember.color),
            initial: String(saved.initial ?? newMember.initial ?? newMember.name.charAt(0).toUpperCase()),
          }]);
        })
        .catch(() => {
          setFamilyMembersState((prev) => [...prev, newMember]);
        });
    } else {
      setFamilyMembersState((prev) => [...prev, newMember]);
    }
    return newMember;
  }, [skydark?.data?.connection]);

  const updateFamilyMember = useCallback((id: string, updates: Partial<FamilyMember>) => {
    setFamilyMembersState((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
    );
    const conn = skydark?.data?.connection;
    if (!conn) return;
    void updateFamilyMemberWS(conn, {
      member_id: id,
      name: updates.name,
      color: updates.color,
      initial: updates.initial,
    });
  }, [skydark?.data?.connection]);

  const removeFamilyMember = useCallback((id: string) => {
    setFamilyMembersState((prev) => prev.filter((m) => m.id !== id));
    const conn = skydark?.data?.connection;
    if (!conn) return;
    void deleteFamilyMemberWS(conn, id);
  }, [skydark?.data?.connection]);

  const setSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettingsState((prev) => {
      const next = normalizeSettings({ ...prev, ...updates });
      const conn = skydark?.data?.connection;
      if (conn) {
        void saveAppSettings(conn, next as unknown as Record<string, unknown>);
      }
      return next;
    });
  }, [skydark?.data?.connection]);

  const setAuthenticated = useCallback((value: boolean) => {
    setAuthenticatedState(value);
  }, []);

  const setIsLocked = useCallback((locked: boolean) => {
    setIsLockedState(locked);
  }, []);

  const isFeatureLocked = useCallback(
    (feature: LockedFeatureKey): boolean => {
      if (!settings.lockEnabled || !isLocked) return false;
      return settings.lockedFeatures[feature] === true;
    },
    [settings.lockEnabled, settings.lockedFeatures, isLocked]
  );

  const unlockApp = useCallback(
    (pin: string): boolean => {
      if (!settings.lockEnabled) return true;
      if (!settings.pinCodeHash) return true;
      const hash = hashPin(pin);
      if (hash === settings.pinCodeHash) {
        setIsLockedState(false);
        return true;
      }
      return false;
    },
    [settings.lockEnabled, settings.pinCodeHash]
  );

  const verifyPin = useCallback(
    (pin: string): boolean => {
      if (!settings.pinCodeHash) return true;
      const hash = hashPin(pin);
      if (hash === settings.pinCodeHash) {
        setAuthenticatedState(true);
        return true;
      }
      return false;
    },
    [settings.pinCodeHash]
  );

  const value: AppContextValue = useMemo(
    () => ({
      familyMembers,
      settings,
      isAuthenticated,
      isLocked,
      setFamilyMembers,
      addFamilyMember,
      updateFamilyMember,
      removeFamilyMember,
      setSettings,
      setAuthenticated,
      verifyPin,
      setIsLocked,
      isFeatureLocked,
      unlockApp,
    }),
    [
      familyMembers,
      settings,
      isAuthenticated,
      isLocked,
      setFamilyMembers,
      addFamilyMember,
      updateFamilyMember,
      removeFamilyMember,
      setSettings,
      setAuthenticated,
      verifyPin,
      setIsLocked,
      isFeatureLocked,
      unlockApp,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}

/** Simple hash for PIN (not cryptographically secure; sufficient for local protection). */
export function hashPin(pin: string): string {
  let h = 0;
  for (let i = 0; i < pin.length; i++) {
    h = (h << 5) - h + pin.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}
