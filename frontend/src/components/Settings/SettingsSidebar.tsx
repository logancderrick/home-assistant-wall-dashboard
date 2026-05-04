/**
 * Left sidebar for Settings sub-navigation (General, Calendar, Display, Lock, Developer).
 * Matches Skydark two-column settings layout.
 */

import {
  GeneralIcon,
  CalendarSettingsIcon,
  DisplayIcon,
  LockIcon,
  DeveloperIcon,
  VoiceIcon,
} from "./SettingsIcons";

export type SettingsSectionId = "general" | "calendar" | "display" | "lock" | "voice" | "developer";

interface NavItem {
  id: SettingsSectionId;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { id: "general", label: "General", Icon: GeneralIcon },
  { id: "calendar", label: "Calendar", Icon: CalendarSettingsIcon },
  { id: "display", label: "Display", Icon: DisplayIcon },
  { id: "lock", label: "Lock", Icon: LockIcon },
  { id: "voice", label: "Voice", Icon: VoiceIcon },
  { id: "developer", label: "Developer", Icon: DeveloperIcon },
];

interface SettingsSidebarProps {
  activeId: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
}

export default function SettingsSidebar({ activeId, onSelect }: SettingsSidebarProps) {
  return (
    <aside
      className="flex-shrink-0 w-40 sm:w-52 border-r border-skydark-border bg-skydark-surface-elevated py-6 pl-3 sm:pl-4 pr-2"
      aria-label="Settings navigation"
    >
      <h2 className="text-base font-semibold text-skydark-text mb-1 text-left">Settings</h2>
      <nav className="mt-4 flex flex-col gap-0.5 items-start w-full" aria-label="Settings sections">
        {navItems.map(({ id, label, Icon }) => {
          const isActive = activeId === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={`
                flex items-center gap-3 w-full rounded-lg py-2.5 pl-3 pr-3 text-left text-sm font-medium transition-colors justify-start
                ${isActive
                  ? "bg-skydark-accent-bg text-skydark-accent"
                  : "text-skydark-text-secondary hover:bg-skydark-surface-muted hover:text-skydark-text"}
              `}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="shrink-0 text-inherit" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
