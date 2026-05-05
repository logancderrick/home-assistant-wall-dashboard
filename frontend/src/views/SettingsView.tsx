import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import SettingsSidebar, { type SettingsSectionId } from "../components/Settings/SettingsSidebar";
import SettingsSection, { SettingRow } from "../components/Settings/SettingsSection";
import AddProfileModal from "../components/Settings/AddProfileModal";
import EditProfileColorModal from "../components/Settings/EditProfileColorModal";
import Toggle from "../components/Common/Toggle";
import Modal from "../components/Common/Modal";
import CloseIcon from "../components/Common/CloseIcon";
import { useAppContext, hashPin } from "../contexts/AppContext";
import PinPrompt from "../components/Common/PinPrompt";
import {
  GeneralIcon,
  CalendarSettingsIcon,
  DisplayIcon,
  LockIcon,
  DeveloperIcon,
  VoiceIcon,
} from "../components/Settings/SettingsIcons";
import { useViewportSimulator } from "../contexts/ViewportSimulatorContext";
import { VIEWPORT_PRESETS } from "../lib/viewportPresets";
import { useWeatherData } from "../hooks/useWeeklyWeather";
import { useSkydarkDataContext } from "../contexts/SkydarkDataContext";
import { REMOTE_CALENDAR_DEFAULT_COLORS } from "../components/Calendar/EventColorPattern";
import { CameraIcon } from "../components/Layout/SidebarIcons";
import HaEntitySelect from "../components/Settings/HaEntitySelect";
import { fetchAssistPipelines, type AssistPipelineSummary } from "../lib/skyDarkApi";
import { isSkydarkDemo } from "../lib/demoMode";
import {
  parseVoiceWakeWordModelId,
  VOICE_WAKE_WORD_MODEL_IDS,
  VOICE_WAKE_WORD_MODEL_LABELS,
} from "../lib/voice/wakeWord";

export default function SettingsView() {
  const {
    familyMembers: members,
    addFamilyMember,
    updateFamilyMember,
    removeFamilyMember,
    settings,
    setSettings,
    verifyPin,
    isLocked,
    unlockApp,
  } = useAppContext();
  const navigate = useNavigate();
  const viewportSimulator = useViewportSimulator();
  const weather = useWeatherData();
  const skydark = useSkydarkDataContext();
  const conn = skydark?.data?.connection ?? null;
  const pendingPinActionRef = useRef<(() => void) | null>(null);
  const [remoteAddPickerKey, setRemoteAddPickerKey] = useState(0);
  const [assistPipelines, setAssistPipelines] = useState<AssistPipelineSummary[]>([]);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");
  const [showDisableLockPrompt, setShowDisableLockPrompt] = useState(false);
  const [showSetPin, setShowSetPin] = useState(false);
  const [setPinStep, setSetPinStep] = useState<"current" | "new" | "confirm">("current");
  const [newPinForConfirm, setNewPinForConfirm] = useState("");
  const [pinError, setPinError] = useState("");
  const [keyboardClicks, setKeyboardClicks] = useState(true);
  const [addProfileOpen, setAddProfileOpen] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<{ id: string; name: string } | null>(null);
  const [editColorMember, setEditColorMember] = useState<{ id: string; name: string; color: string } | null>(null);

  const handleAddProfile = (result: { name: string; color: string }) => {
    addFamilyMember({
      name: result.name,
      color: result.color,
      initial: result.name.charAt(0).toUpperCase(),
    });
    setAddProfileOpen(false);
  };

  const handleSetPinVerify = (pin: string): boolean => {
    if (setPinStep === "current") {
      if (settings.pinCodeHash && hashPin(pin) !== settings.pinCodeHash) return false;
      setPinError("");
      const pending = pendingPinActionRef.current;
      if (pending) {
        pending();
        pendingPinActionRef.current = null;
        handleSetPinClose();
        return true;
      }
      setSetPinStep("new");
      return false;
    }
    if (setPinStep === "new") {
      setNewPinForConfirm(pin);
      setSetPinStep("confirm");
      setPinError("");
      return false;
    }
    if (setPinStep === "confirm") {
      if (pin !== newPinForConfirm) {
        setPinError("PINs do not match");
        return false;
      }
      setSettings({ pinCodeHash: hashPin(pin) });
      setShowSetPin(false);
      setSetPinStep("current");
      setNewPinForConfirm("");
      pendingPinActionRef.current?.();
      pendingPinActionRef.current = null;
      return true;
    }
    return false;
  };

  const handleSetPinClose = () => {
    setShowSetPin(false);
    setSetPinStep("current");
    setNewPinForConfirm("");
    setPinError("");
    pendingPinActionRef.current = null;
  };

  const handleLockEnabledChange = (checked: boolean) => {
    if (checked) {
      if (!settings.pinCodeHash) {
        setPinError("");
        setShowSetPin(true);
        setSetPinStep("new");
        setNewPinForConfirm("");
        pendingPinActionRef.current = () => {
          setSettings({ lockEnabled: true });
          setShowSetPin(false);
        };
        return;
      }
      setSettings({ lockEnabled: true });
      return;
    }
    setShowDisableLockPrompt(true);
  };

  const handleDisableLockVerify = (pin: string): boolean => {
    if (!pin && settings.pinCodeHash) return false;
    const ok = !settings.pinCodeHash || verifyPin(pin);
    if (ok) {
      setSettings({ lockEnabled: false });
      setShowDisableLockPrompt(false);
      return true;
    }
    return false;
  };

  const commitRemoteCalendarIds = useCallback(
    (ids: string[]) => {
      const prevColors = settings.remoteCalendarColors ?? {};
      const prevLabels = settings.remoteCalendarLabels ?? {};
      const nextColors: Record<string, string> = {};
      const nextLabels: Record<string, string> = {};
      ids.forEach((id, i) => {
        const existing = prevColors[id]?.trim();
        nextColors[id] =
          existing && /^#[0-9A-Fa-f]{6}$/i.test(existing)
            ? existing
            : REMOTE_CALENDAR_DEFAULT_COLORS[i % REMOTE_CALENDAR_DEFAULT_COLORS.length];
        const label = prevLabels[id]?.trim();
        if (label) nextLabels[id] = label;
      });
      setSettings({
        remoteCalendarEntities: ids,
        remoteCalendarColors: nextColors,
        remoteCalendarLabels: nextLabels,
      });
      void skydark?.refetchEvents();
    },
    [setSettings, settings.remoteCalendarColors, settings.remoteCalendarLabels, skydark],
  );

  useEffect(() => {
    if (activeSection !== "voice") return;
    if (isSkydarkDemo) {
      setAssistPipelines([{ id: "demo_pipeline", name: "Demo pipeline" }]);
      return;
    }
    const c = skydark?.data?.connection;
    if (!c) {
      setAssistPipelines([]);
      return;
    }
    let cancelled = false;
    void fetchAssistPipelines(c).then((p) => {
      if (!cancelled) setAssistPipelines(p);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSection, skydark?.data?.connection]);

  const requireUnlockToChangeSettings =
    settings.lockEnabled && isLocked && settings.lockedFeatures.changeSettings;

  if (requireUnlockToChangeSettings) {
    return (
      <div className="h-full flex bg-skydark-bg items-center justify-center p-4">
        <PinPrompt
          open
          onClose={() => navigate(-1)}
          onVerify={(pin) => unlockApp(pin)}
          onSuccess={() => {}}
          title="Enter PIN to change settings"
        />
      </div>
    );
  }

  return (
    <div className="h-full flex bg-skydark-bg">
      <SettingsSidebar activeId={activeSection} onSelect={setActiveSection} />

      <div className="flex-1 min-w-0 py-4 sm:py-6 px-4 sm:px-8 overflow-auto">
        {activeSection === "general" && (
          <>
            <h2 className="text-xl font-semibold text-skydark-text mb-6">General</h2>

            <SettingsSection title="Family" icon={<GeneralIcon className="w-5 h-5 text-skydark-text-secondary" />}>
              <div className="py-3">
                <label className="block text-sm font-medium text-skydark-text mb-1.5">Family name</label>
                <input
                  type="text"
                  value={settings.familyName ?? "The Derricks"}
                  onChange={(e) => setSettings({ familyName: e.target.value })}
                  className="input-skydark max-w-md"
                />
              </div>
              <div className="py-3">
                <label className="block text-sm font-medium text-skydark-text mb-2">Family members</label>
                <ul className="space-y-2">
                  {members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-3 p-3 rounded-card-lg bg-skydark-surface shadow-skydark"
                    >
                      <div
                        className="w-10 h-10 aspect-square rounded-full shrink-0 flex items-center justify-center text-white font-semibold"
                        style={{ backgroundColor: m.color }}
                      >
                        {m.initial}
                      </div>
                      <span className="flex-1 font-medium text-skydark-text">{m.name}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditColorMember({ id: m.id, name: m.name, color: m.color })}
                          className="text-sm font-medium text-skydark-accent hover:underline"
                        >
                          Edit color
                        </button>
                        <button
                          type="button"
                          onClick={() => setMemberToDelete({ id: m.id, name: m.name })}
                          disabled={members.length <= 1}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-skydark-text-secondary hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-skydark-text-secondary"
                          aria-label={`Delete ${m.name}`}
                          title={members.length <= 1 ? "At least one profile is required" : `Delete ${m.name}`}
                        >
                          <CloseIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setAddProfileOpen(true)}
                  className="mt-2 text-sm font-medium text-skydark-accent hover:underline"
                >
                  + Add profile
                </button>
              </div>
            </SettingsSection>

            <SettingsSection title="Display" icon={<GeneralIcon className="w-5 h-5 text-skydark-text-secondary" />}>
              <div className="py-3">
                <label className="block text-sm font-medium text-skydark-text mb-1.5">Weather ZIP code (US)</label>
                <div className="flex items-center gap-2 max-w-md">
                  <input
                    type="tel"
                    value={settings.weatherZipCode ?? ""}
                    onChange={(e) => setSettings({ weatherZipCode: e.target.value })}
                    placeholder="12345"
                    className="input-skydark flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => weather.refresh()}
                    disabled={weather.refreshing}
                    className="btn-secondary whitespace-nowrap disabled:opacity-60"
                  >
                    {weather.refreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
                {weather.locationLabel && (
                  <p className="mt-1 text-xs text-skydark-text-secondary">
                    {weather.locationLabel}
                  </p>
                )}
                <p className="mt-1 text-xs text-skydark-text-secondary">
                  Leave blank to use device location.
                </p>
              </div>
              <SettingRow
                label="Show 7-day forecast in top header"
                control={
                  <Toggle
                    checked={settings.showTopWeeklyForecast ?? false}
                    onChange={(checked) => setSettings({ showTopWeeklyForecast: checked })}
                    aria-label="Show top 7-day forecast"
                  />
                }
              />
            </SettingsSection>

            <SettingsSection title="Volume" icon={<GeneralIcon className="w-5 h-5 text-skydark-text-secondary" />}>
              <SettingRow
                label="Keyboard clicks"
                control={
                  <Toggle
                    checked={keyboardClicks}
                    onChange={setKeyboardClicks}
                    aria-label="Keyboard clicks"
                  />
                }
              />
            </SettingsSection>
          </>
        )}

        {activeSection === "lock" && (
          <>
            <h2 className="text-xl font-semibold text-skydark-text mb-6">Lock</h2>
            <SettingsSection title="Lock" icon={<LockIcon className="w-5 h-5 text-skydark-text-secondary" />}>
              <SettingRow
                label="Enable lock"
                control={
                  <Toggle
                    checked={settings.lockEnabled}
                    onChange={handleLockEnabledChange}
                    aria-label="Enable lock"
                  />
                }
              />
              {settings.lockEnabled && settings.pinCodeHash && !isLocked && (
                <div className="py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPinError("");
                      setSetPinStep("current");
                      setNewPinForConfirm("");
                      setShowSetPin(true);
                      (window as unknown as { __pendingPinAction?: () => void }).__pendingPinAction = undefined;
                    }}
                    className="text-sm font-medium text-skydark-accent hover:underline"
                  >
                    Change PIN
                  </button>
                </div>
              )}
              {settings.lockEnabled && (
                <>
                  <SettingRow
                    label="Re-lock after inactivity"
                    control={
                      <Toggle
                        checked={settings.autoRelockEnabled}
                        onChange={(checked) => setSettings({ autoRelockEnabled: checked })}
                        aria-label="Auto-relock on inactivity"
                      />
                    }
                  />
                  {settings.autoRelockEnabled && (
                    <div className="py-2">
                      <label className="block text-sm font-medium text-skydark-text mb-1.5">Inactivity timeout (minutes)</label>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={settings.autoRelockMinutes}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (!Number.isNaN(n) && n >= 1 && n <= 60) setSettings({ autoRelockMinutes: n });
                        }}
                        className="input-skydark w-24 py-2"
                      />
                    </div>
                  )}
                  {!isLocked && (
                    <>
                      <div className="pt-4 pb-2">
                        <span className="text-sm font-medium text-skydark-text">Lock individual features when locked</span>
                      </div>
                      {(
                        [
                          ["addEvents", "Add events"],
                          ["editDeleteEvents", "Edit & delete events"],
                          ["createLists", "Create lists"],
                          ["deleteLists", "Delete lists"],
                          ["addItemsToLists", "Add items to lists"],
                          ["checkLists", "Check lists"],
                          ["addChores", "Add chores"],
                          ["deleteChores", "Delete chores"],
                          ["completeChores", "Complete chores"],
                          ["addRewards", "Add rewards"],
                          ["claimRewards", "Claim rewards"],
                          ["changeSettings", "Change any settings"],
                        ] as const
                      ).map(([key, label]) => (
                        <SettingRow
                          key={key}
                          label={label}
                          control={
                            <Toggle
                              checked={settings.lockedFeatures[key]}
                              onChange={(checked) =>
                                setSettings({
                                  lockedFeatures: { ...settings.lockedFeatures, [key]: checked },
                                })
                              }
                              aria-label={label}
                            />
                          }
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </SettingsSection>
          </>
        )}

        {activeSection === "calendar" && (
          <>
            <h2 className="text-xl font-semibold text-skydark-text mb-6">Calendar</h2>

            <SettingsSection title="Family calendar" icon={<CalendarSettingsIcon className="w-5 h-5 text-skydark-text-secondary" />}>
              <p className="text-sm text-skydark-text-secondary mb-3">
                When you add an event from the calendar, you pick a Home Assistant <span className="font-medium text-skydark-text">calendar.*</span>{" "}
                entity (from your merged list below). Events are created there via Home Assistant so they can sync with Google,
                Apple, etc. The profile default here is only used when editing SkyDark events that are stored on a family profile.
              </p>
              <label className="block text-sm font-medium text-skydark-text mb-1.5">Default profile for SkyDark-stored events</label>
              <select
                value={
                  settings.defaultFamilyCalendarMemberId &&
                  members.some((m) => m.id === settings.defaultFamilyCalendarMemberId)
                    ? settings.defaultFamilyCalendarMemberId
                    : "__auto__"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setSettings({
                    defaultFamilyCalendarMemberId: v === "__auto__" ? undefined : v,
                  });
                }}
                className="input-skydark w-full max-w-lg"
                aria-label="Default family profile for SkyDark-stored events"
              >
                <option value="__auto__">Auto (profile named Family, or first member)</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <label className="block text-sm font-medium text-skydark-text mb-1.5 mt-6">
                Default Home Assistant calendar for new events (optional)
              </label>
              <HaEntitySelect
                connection={conn}
                domain="calendar"
                allowEmpty
                emptyLabel="(none — pick when adding an event)"
                value={settings.pushEventsToCalendarEntityId ?? ""}
                onChange={(id) => setSettings({ pushEventsToCalendarEntityId: id ? id : undefined })}
                aria-label="Home Assistant calendar entity to push new events to"
              />
              <p className="text-xs text-skydark-text-secondary mt-2 max-w-lg">
                If set, the Add Event screen selects this calendar first when it appears in your merged list. The panel calls{" "}
                <span className="font-mono">calendar.create_event</span> on the calendar you choose when saving a new event. Use a
                calendar you can write to. If you merge the same calendar as a remote source, events may appear twice until you hide
                one source.
              </p>
            </SettingsSection>

            <SettingsSection title="Calendar camera preview" icon={<CameraIcon className="w-5 h-5 text-skydark-text-secondary" />}>
              <p className="text-sm text-skydark-text-secondary mb-3">
                Show a live camera strip at the top of the Calendar page (same streams as Cameras). Enter one or two{" "}
                <span className="font-mono text-skydark-text">camera.*</span> entity IDs; with two, the preview alternates
                between them.
              </p>
              <label className="block text-sm font-medium text-skydark-text mb-1.5">Camera entity 1</label>
              <div className="mb-4">
                <HaEntitySelect
                  connection={conn}
                  domain="camera"
                  allowEmpty
                  emptyLabel="(none)"
                  value={settings.calendarPreviewCameras?.[0] ?? ""}
                  onChange={(id) => {
                    const v = id.trim();
                    const second = settings.calendarPreviewCameras?.[1]?.trim() ?? "";
                    setSettings({ calendarPreviewCameras: [v, second].filter(Boolean) });
                  }}
                  aria-label="First calendar preview camera entity ID"
                />
              </div>
              <label className="block text-sm font-medium text-skydark-text mb-1.5">Camera entity 2 (optional)</label>
              <div className="mb-4">
                <HaEntitySelect
                  connection={conn}
                  domain="camera"
                  allowEmpty
                  emptyLabel="(none)"
                  value={settings.calendarPreviewCameras?.[1] ?? ""}
                  onChange={(id) => {
                    const v = id.trim();
                    const first = settings.calendarPreviewCameras?.[0]?.trim() ?? "";
                    setSettings({ calendarPreviewCameras: [first, v].filter(Boolean) });
                  }}
                  aria-label="Second calendar preview camera entity ID"
                />
              </div>
              <label className="block text-sm font-medium text-skydark-text mb-1.5">Rotate every (seconds)</label>
              <input
                type="number"
                min={10}
                max={120}
                className="input-skydark w-full max-w-[140px] mb-2"
                value={settings.calendarPreviewRotateSeconds}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isNaN(n)) return;
                  setSettings({ calendarPreviewRotateSeconds: Math.min(120, Math.max(10, n)) });
                }}
                aria-label="Seconds between alternating cameras"
              />
              <p className="text-xs text-skydark-text-secondary max-w-lg">
                Clear both fields to hide the preview. Values are saved with your other SkyDark settings.
              </p>
            </SettingsSection>

            <SettingsSection title="Remote calendars" icon={<CalendarSettingsIcon className="w-5 h-5 text-skydark-text-secondary" />}>
              <p className="text-sm text-skydark-text-secondary mb-3">
                Pick Home Assistant <span className="font-mono text-skydark-text">calendar.*</span> entities to merge into SkyDark
                (for example from the Remote Calendar integration). Use the buttons on the calendar view to show or hide each source.
              </p>
              <label className="block text-sm font-medium text-skydark-text mb-1.5">Add calendar</label>
              <HaEntitySelect
                key={remoteAddPickerKey}
                connection={conn}
                domain="calendar"
                allowEmpty
                emptyLabel="Choose a calendar to add…"
                excludeIds={settings.remoteCalendarEntities ?? []}
                value=""
                onChange={(id) => {
                  if (!id) return;
                  const cur = settings.remoteCalendarEntities ?? [];
                  if (cur.includes(id)) return;
                  commitRemoteCalendarIds([...cur, id]);
                  setRemoteAddPickerKey((k) => k + 1);
                }}
                aria-label="Add merged Home Assistant calendar"
              />
              {(settings.remoteCalendarEntities ?? []).length === 0 && (
                <p className="text-sm text-amber-900 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-3 max-w-lg">
                  No remote calendars yet. Add at least one above so Google / Apple / etc. events appear on the calendar.
                </p>
              )}
              {(settings.remoteCalendarEntities ?? []).length > 0 && (
                <div className="mt-4 space-y-3 max-w-lg">
                  <p className="text-sm font-medium text-skydark-text">Display names and colors</p>
                  <p className="text-xs text-skydark-text-secondary">
                    Optional friendly names appear on calendar filter chips and in the Add Event picker. Colors match event chips
                    and toggles.
                  </p>
                  {(settings.remoteCalendarEntities ?? []).map((eid, i) => (
                    <div
                      key={eid}
                      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 border-b border-skydark-border pb-3 last:border-0 last:pb-0"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0 sm:max-w-[16rem]">
                        <span
                          className="text-xs text-skydark-text-secondary font-mono truncate min-w-0"
                          title={eid}
                        >
                          {eid}
                        </span>
                        <button
                          type="button"
                          className="text-xs font-medium text-red-600 hover:underline shrink-0"
                          onClick={() =>
                            commitRemoteCalendarIds((settings.remoteCalendarEntities ?? []).filter((x) => x !== eid))
                          }
                        >
                          Remove
                        </button>
                      </div>
                      <input
                        type="text"
                        className="input-skydark flex-1 min-w-[8rem] max-w-md text-sm"
                        placeholder="Display name (optional)"
                        value={settings.remoteCalendarLabels?.[eid] ?? ""}
                        onChange={(e) =>
                          setSettings({
                            remoteCalendarLabels: {
                              ...(settings.remoteCalendarLabels ?? {}),
                              [eid]: e.target.value,
                            },
                          })
                        }
                        aria-label={`Display name for ${eid}`}
                      />
                      <input
                        type="color"
                        aria-label={`Color for ${eid}`}
                        value={
                          (() => {
                            const c = settings.remoteCalendarColors?.[eid]?.trim();
                            return c && /^#[0-9A-Fa-f]{6}$/i.test(c)
                              ? c
                              : REMOTE_CALENDAR_DEFAULT_COLORS[i % REMOTE_CALENDAR_DEFAULT_COLORS.length];
                          })()
                        }
                        onChange={(e) =>
                          setSettings({
                            remoteCalendarColors: {
                              ...(settings.remoteCalendarColors ?? {}),
                              [eid]: e.target.value,
                            },
                          })
                        }
                        className="h-9 w-14 cursor-pointer rounded border border-skydark-border bg-skydark-surface p-0.5 shrink-0"
                      />
                    </div>
                  ))}
                </div>
              )}
            </SettingsSection>
          </>
        )}

        {activeSection === "display" && (
          <>
            <h2 className="text-xl font-semibold text-skydark-text mb-6">Display</h2>
            <SettingsSection title="Appearance" icon={<DisplayIcon className="w-5 h-5 text-skydark-text-secondary" />}>
              <SettingRow
                label="Dark theme"
                value="Applies across the whole panel (calendar, chores, lists, settings)."
                control={
                  <Toggle
                    checked={settings.themePreference === "dark"}
                    onChange={(checked) => setSettings({ themePreference: checked ? "dark" : "light" })}
                    aria-label="Use dark theme"
                  />
                }
              />
            </SettingsSection>
          </>
        )}

        {activeSection === "developer" && (
          <>
            <h2 className="text-xl font-semibold text-skydark-text mb-6">Developer</h2>
            <SettingsSection title="Viewport Tester" icon={<DeveloperIcon className="w-5 h-5 text-skydark-text-secondary" />}>
              <SettingRow
                label="Developer Mode"
                control={
                  <Toggle
                    checked={viewportSimulator.developerMode}
                    onChange={viewportSimulator.setDeveloperMode}
                    aria-label="Developer mode"
                  />
                }
              />
              <div className="py-3">
                <label className="block text-sm font-medium text-skydark-text mb-1.5">Device preset</label>
                <select
                  value={viewportSimulator.presetId}
                  onChange={(e) => viewportSimulator.setPresetId(e.target.value)}
                  className="input-skydark max-w-[280px]"
                  aria-label="Device preset"
                >
                  {VIEWPORT_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <SettingRow
                label="Orientation"
                value={viewportSimulator.orientation === "landscape" ? "Landscape" : "Portrait"}
                control={
                  <Toggle
                    checked={viewportSimulator.orientation === "landscape"}
                    onChange={(checked) =>
                      viewportSimulator.setOrientation(checked ? "landscape" : "portrait")
                    }
                    aria-label="Landscape orientation"
                  />
                }
              />
              <SettingRow
                label="Show safe-area padding"
                control={
                  <Toggle
                    checked={viewportSimulator.showSafeArea}
                    onChange={viewportSimulator.setShowSafeArea}
                    aria-label="Show safe-area padding"
                  />
                }
              />
              <SettingRow
                label="Show grid overlay"
                control={
                  <Toggle
                    checked={viewportSimulator.showGrid}
                    onChange={viewportSimulator.setShowGrid}
                    aria-label="Show grid overlay"
                  />
                }
              />
              <div className="pt-3">
                <button
                  type="button"
                  onClick={viewportSimulator.resetToRealDevice}
                  className="btn-secondary"
                >
                  Reset to real device
                </button>
              </div>
            </SettingsSection>
          </>
        )}

        {activeSection === "voice" && (
          <>
            <h2 className="text-xl font-semibold text-skydark-text mb-6">Voice Control</h2>
            <SettingsSection title="Voice Satellite" icon={<VoiceIcon className="w-5 h-5 text-skydark-text-secondary" />}>
              <p className="text-sm text-skydark-text-secondary mb-4">
                Connect this panel to a Voice Satellite entity for hands-free or push-to-talk Assist. Uses the same
                <span className="font-mono"> voice_satellite/run_pipeline</span> WebSocket contract as the official
                browser satellite (including <span className="font-mono">wake_word_phrase</span> for Home Assistant
                duplicate wake suppression).
              </p>
              <div className="py-3">
                <label className="flex items-start gap-3 cursor-pointer max-w-lg">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-skydark-border"
                    checked={settings.wakeWordEnabled !== false}
                    onChange={(e) => setSettings({ wakeWordEnabled: e.target.checked })}
                  />
                  <span>
                    <span className="block text-sm font-medium text-skydark-text">Listen for wake word hands-free</span>
                    <span className="block text-xs text-skydark-text-secondary mt-1">
                      Turn off if the mic keeps re-triggering (e.g. TTS echo). The mic button still starts Assist when off.
                    </span>
                  </span>
                </label>
              </div>
              <div className="py-3">
                <label className="block text-sm font-medium text-skydark-text mb-1.5">
                  Assist Satellite entity ID
                </label>
                <HaEntitySelect
                  connection={conn}
                  domain="assist_satellite"
                  allowEmpty
                  emptyLabel="(disabled — no voice satellite)"
                  value={settings.voiceSatelliteEntityId ?? ""}
                  onChange={(id) =>
                    setSettings({ voiceSatelliteEntityId: id.trim() ? id.trim() : undefined })
                  }
                  aria-label="Assist Satellite entity"
                />
                <p className="text-xs text-skydark-text-secondary mt-2 max-w-lg">
                  Leave empty to disable voice control. The entity_id must match the one configured in the
                  voice_satellite integration.
                </p>
              </div>
              <div className="py-3">
                <label className="block text-sm font-medium text-skydark-text mb-1.5">On-device wake word</label>
                <select
                  className="input-skydark w-full max-w-lg text-sm"
                  value={parseVoiceWakeWordModelId(settings.voiceWakeWordModelId)}
                  onChange={(e) => setSettings({ voiceWakeWordModelId: e.target.value })}
                  aria-label="Wake word model"
                >
                  {VOICE_WAKE_WORD_MODEL_IDS.map((id) => (
                    <option key={id} value={id}>
                      {VOICE_WAKE_WORD_MODEL_LABELS[id]}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-skydark-text-secondary mt-2 max-w-lg">
                  Matches the integration’s bundled TFLite classifiers. The mic button hint uses this phrase (e.g. Hey Jarvis).
                </p>
              </div>
              <div className="py-3">
                <label className="block text-sm font-medium text-skydark-text mb-1.5">
                  Pipeline ID (optional)
                </label>
                {assistPipelines.length > 0 ? (
                  <>
                    <select
                      className="input-skydark w-full max-w-lg text-sm"
                      value={settings.voicePipelineId ?? ""}
                      onChange={(e) =>
                        setSettings({ voicePipelineId: e.target.value.trim() || undefined })
                      }
                      aria-label="Assist pipeline"
                    >
                      <option value="">Default pipeline</option>
                      {settings.voicePipelineId &&
                      !assistPipelines.some((p) => p.id === settings.voicePipelineId) ? (
                        <option value={settings.voicePipelineId}>
                          Current: {settings.voicePipelineId}
                        </option>
                      ) : null}
                      {assistPipelines.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.id})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-skydark-text-secondary mt-2 max-w-lg">
                      Loaded from Home Assistant. Choose Default unless you need a specific Assist pipeline.
                    </p>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      className="input-skydark w-full max-w-lg font-mono text-sm"
                      placeholder="Leave empty for default pipeline"
                      value={settings.voicePipelineId ?? ""}
                      onChange={(e) => setSettings({ voicePipelineId: e.target.value.trim() || undefined })}
                      spellCheck={false}
                      aria-label="Assist pipeline ID (manual)"
                    />
                    <p className="text-xs text-skydark-text-secondary mt-2 max-w-lg">
                      Pipelines could not be listed (connect to Home Assistant or check Assist). You can still paste a pipeline ID
                      from <span className="font-mono">Settings → Voice assistants</span> in Home Assistant.
                    </p>
                  </>
                )}
              </div>
              <div className="py-3">
                <label className="block text-sm font-medium text-skydark-text mb-3">
                  Wake Word Sensitivity
                </label>
                <div className="flex items-center gap-3 max-w-lg">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    className="flex-1 accent-skydark-accent"
                    value={settings.wakeWordSensitivity ?? 0.5}
                    onChange={(e) => setSettings({ wakeWordSensitivity: parseFloat(e.target.value) })}
                  />
                  <span className="text-sm font-mono text-skydark-text-secondary w-12 text-right">
                    {((settings.wakeWordSensitivity ?? 0.5) * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-xs text-skydark-text-secondary mt-2 max-w-lg">
                  Lower = more stable but slower to detect. Higher = faster but more false positives. Start with 50%.
                </p>
              </div>
            </SettingsSection>
          </>
        )}
      </div>

      <AddProfileModal
        open={addProfileOpen}
        onClose={() => setAddProfileOpen(false)}
        onAdd={handleAddProfile}
      />

      <Modal
        open={!!memberToDelete}
        onClose={() => setMemberToDelete(null)}
        title={memberToDelete ? `Delete ${memberToDelete.name}?` : "Delete profile"}
        variant="center"
      >
        {memberToDelete && (
          <div className="space-y-4">
            <p className="text-sm text-skydark-text-secondary">
              This will remove {memberToDelete.name} from family members. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setMemberToDelete(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  removeFamilyMember(memberToDelete.id);
                  setMemberToDelete(null);
                }}
                className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>

      <EditProfileColorModal
        open={!!editColorMember}
        member={editColorMember}
        onClose={() => setEditColorMember(null)}
        onSelectColor={(color) => {
          if (editColorMember) {
            updateFamilyMember(editColorMember.id, { color });
            setEditColorMember(null);
          }
        }}
      />

      <PinPrompt
        key={setPinStep}
        open={showSetPin}
        onClose={handleSetPinClose}
        onVerify={handleSetPinVerify}
        title={
          setPinStep === "current"
            ? settings.pinCodeHash
              ? "Enter current PIN"
              : "Enter new PIN"
            : setPinStep === "new"
              ? "Enter new PIN"
              : "Confirm new PIN"
        }
        error={pinError}
      />

      <PinPrompt
        open={showDisableLockPrompt}
        onClose={() => setShowDisableLockPrompt(false)}
        onVerify={handleDisableLockVerify}
        title="Enter PIN to disable lock"
        allowBypass
        onBypass={() => {
          setSettings({ lockEnabled: false });
          setShowDisableLockPrompt(false);
        }}
      />
    </div>
  );
}
