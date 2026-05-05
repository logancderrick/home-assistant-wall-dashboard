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

/** After speech energy drops, wait this long before sending end-of-audio to HA. */
export const VOICE_UTTERANCE_SILENCE_MS = 2_000;
/** Normalized RMS (0–1) above this counts as “user is speaking” for end-of-utterance. */
export const VOICE_UTTERANCE_SPEECH_RMS = 0.028;
/** Short UI/audio acknowledgement after on-device wake (ms). */
export const VOICE_WAKE_PULSE_MS = 700;
/**
 * Ignore RMS spikes this long after LISTENING so wake-word tail / connect noise does not
 * arm silence-based end before the real command.
 */
export const VOICE_HAD_SPEECH_ARM_DELAY_MS = 550;
/**
 * Do not send end-of-audio from silence until this long after LISTENING starts — gives time
 * to pause between wake phrase and command without closing the stream early.
 */
export const VOICE_MIN_LISTEN_BEFORE_AUTO_END_MS = 2_800;
/**
 * Require this much cumulative “loud” audio (by RMS gate) before silence may end the stream.
 * Stops brief spikes / wake residue from triggering premature sendAudioDone.
 * ~1s+ of speech differentiates a real command from typical wake/network tail (see voice issue:
 * stream ended early → STT ". " / no_intent while user had more to say).
 */
export const VOICE_MIN_LOUD_MS_FOR_AUTO_END_MS = 1_000;
/**
 * Hard cap on LISTENING: always send end-of-audio so the pipeline cannot hang if auto-end never fires.
 */
export const VOICE_MAX_LISTEN_STREAM_MS = 30_000;
/**
 * After a tap-started pipeline ends, wall-clock block before hands-free wake may run again.
 */
export const VOICE_WAKE_BLOCK_AFTER_TAP_MS = 3_500;

/**
 * After a wake-started pipeline ends, minimum wall-clock wait before re-arm scanning.
 * Long enough to dodge immediate TTS/echo; short enough for a follow-up “Hey …” within a few seconds.
 */
export const VOICE_WAKE_BLOCK_AFTER_WAKE_MS = 4_500;

/**
 * After {@link VOICE_WAKE_BLOCK_AFTER_WAKE_MS}, require this much sub-threshold mic audio in a row
 * so “quiet” actually means decayed playback/room noise, not mid-sentence audio.
 */
export const VOICE_WAKE_POST_RUN_QUIET_MS = 1_600;

/**
 * RMS below this counts toward {@link VOICE_WAKE_POST_RUN_QUIET_MS}.
 * Slightly relaxed so real rooms (HVAC, fan) don’t prevent the quiet streak from ever completing.
 */
export const VOICE_WAKE_SILENCE_RMS = 0.021;

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
