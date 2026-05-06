/**
 * Stable module for VoiceContext only — keeps the same context object across Vite HMR
 * reloads of VoiceContext.tsx. Without this, consumers can see null context while the
 * devtools tree still lists “VoiceProvider”.
 */

import { createContext } from "react";
import type { VoiceStateValue } from "../lib/voice/constants";

export interface VoiceContextValue {
  voiceState: VoiceStateValue;
  transcript: string;
  error: string | null;
  isEnabled: boolean;
  /** False when user disabled hands-free wake in settings (mic button still works). */
  wakeHandsFreeEnabled: boolean;
  isListeningForWakeWord: boolean;
  wakeWordDetected: boolean;
  wakeWordSensitivity: number;
  /** Friendly phrase for the selected on-device wake model (e.g. "Hey Jarvis"). */
  wakePhrase: string;
  /** Brief UI pulse after on-device wake (earcon plays in parallel). */
  wakePulse: boolean;
  setWakeWordSensitivity: (value: number) => void;
  startListening: (
    initiator?: "wake" | "tap",
    pipelineOverrideId?: string,
    wakePhraseOverride?: string,
  ) => Promise<void>;
  stopListening: () => void;
  dismiss: () => void;
}

export const VoiceContext = createContext<VoiceContextValue | null>(null);
