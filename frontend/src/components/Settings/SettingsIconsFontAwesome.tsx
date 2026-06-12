import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSliders,
  faCalendar,
  faDisplay,
  faLock,
  faMicrophone,
  faCode,
} from "@fortawesome/free-solid-svg-icons";

interface IconProps {
  className?: string;
}

export function GeneralIcon({ className }: IconProps) {
  return <FontAwesomeIcon icon={faSliders} className={className} fixedWidth />;
}

export function CalendarSettingsIcon({ className }: IconProps) {
  return <FontAwesomeIcon icon={faCalendar} className={className} fixedWidth />;
}

export function DisplayIcon({ className }: IconProps) {
  return <FontAwesomeIcon icon={faDisplay} className={className} fixedWidth />;
}

export function LockIcon({ className }: IconProps) {
  return <FontAwesomeIcon icon={faLock} className={className} fixedWidth />;
}

export function VoiceIcon({ className }: IconProps) {
  return <FontAwesomeIcon icon={faMicrophone} className={className} fixedWidth />;
}

export function DeveloperIcon({ className }: IconProps) {
  return <FontAwesomeIcon icon={faCode} className={className} fixedWidth />;
}
