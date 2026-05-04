/**
 * Voice Satellite integration constants, types, and configuration.
 */

export const VoiceState = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  LISTENING: 'listening',
  PROCESSING: 'processing', // STT/intent in flight
  RESPONDING: 'responding', // TTS playing
  ERROR: 'error',
} as const;

export type VoiceStateValue = (typeof VoiceState)[keyof typeof VoiceState];

// Timing and protocol constants
export const VOICE_PIPELINE_TIMEOUT_MS = 30_000;
export const VOICE_RECONNECT_DELAY_MS = 2_000;
export const VOICE_MAX_RECONNECT_ATTEMPTS = 5;
export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_WORKLET_CHUNK_SAMPLES = 512;
export const VOICE_PCM_BYTES_PER_SAMPLE = 2; // Int16

/**
 * Voice control configuration, persisted in AppSettings.
 */
export interface VoiceConfig {
  /** entity_id of the assist_satellite device, e.g. "assist_satellite.wall_panel" */
  entityId: string;
  /** Optional pipeline ID override; undefined = use HA's default pipeline */
  pipelineId?: string;
  /** Conversation ID for multi-turn dialogs; undefined = new conversation */
  conversationId?: string;
  /** Enable wake word detection (future feature) */
  wakeWordEnabled: boolean;
  /** Optional media_player entity for remote TTS output */
  ttsOutputEntityId?: string;
  /** Language for STT/TTS (e.g. "en", "es") */
  language?: string;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  entityId: '',
  wakeWordEnabled: false,
};
