import {
  GeneralIcon,
  CalendarSettingsIcon,
  DisplayIcon,
  LockIcon,
  DeveloperIcon,
  VoiceIcon,
} from "./SettingsIconsFontAwesome";

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
    <aside className="w-40 sm:w-52 border-r border-skydark-border bg-skydark-surface-elevated">
      <div className="p-6 pb-4">
        <h2 className="text-base font-semibold text-skydark-text">Settings</h2>
      </div>
      <nav className="px-3 pb-6">
        <div className="space-y-3">
          {navItems.map(({ id, label, Icon }) => {
            const isActive = activeId === id;
            return (
              <button
                key={id}
                onClick={() => onSelect(id)}
                className={`w-full p-3 rounded-lg transition-colors duration-150 flex justify-start ${
                  isActive
                    ? "bg-skydark-accent text-white"
                    : "text-skydark-text-secondary hover:text-skydark-text hover:bg-skydark-surface"
                }`}
                aria-label={label}
                title={label}
              >
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
