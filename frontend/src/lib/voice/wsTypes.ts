/**
 * TypeScript shapes for voice_satellite WebSocket messages and events.
 */

import type { Connection, MessageBase } from "home-assistant-js-websocket";

/** Cast custom commands to HA WebSocket `MessageBase` for `sendMessagePromise` / `subscribeMessage`. */
export function toHaMessage<T extends { type: string }>(msg: T): MessageBase {
  return msg as unknown as MessageBase;
}

// ============================================================================
// Outgoing WS messages from browser to HA
// ============================================================================

export interface RunPipelineMsg {
  type: 'voice_satellite/run_pipeline';
  entity_id: string;
  /** Required by voice_satellite; must match streamed PCM (see `VOICE_SAMPLE_RATE`). */
  sample_rate: number;
  pipeline_id?: string;
  conversation_id?: string;
  language?: string;
  start_stage: 'stt' | 'wake_word';
  end_stage: 'tts' | 'intent';
  /**
   * Human phrase for the active on-device wake model (e.g. "Hey Jarvis"). Required for HA core
   * `DATA_LAST_WAKE_UP` dedup when `start_stage` is `stt` (see voice_satellite DESIGN-INTEGRATION).
   */
  wake_word_phrase?: string;
}

export interface UpdateStateMsg {
  type: 'voice_satellite/update_state';
  entity_id: string;
  state: string;
}

export interface SubscribeEventsMsg {
  type: 'voice_satellite/subscribe_events';
  entity_id: string;
}

export interface AnnounceFinishedMsg {
  type: 'voice_satellite/announce_finished';
  entity_id: string;
}

export interface QuestionAnsweredMsg {
  type: 'voice_satellite/question_answered';
  entity_id: string;
  result: string;
}

export interface CancelTimerMsg {
  type: 'voice_satellite/cancel_timer';
  timer_entity_id: string;
}

export interface MediaPlayerEventMsg {
  type: 'voice_satellite/media_player_event';
  entity_id: string;
  event_type: string;
}

export interface ScreensaverStateMsg {
  type: 'voice_satellite/screensaver_state';
  entity_id: string;
  active: boolean;
}

// ============================================================================
// Incoming events from HA to browser
// ============================================================================

export type VoiceSatelliteEvent =
  | { event_type: 'announce'; media_id: string; message?: string }
  | { event_type: 'wake_detected' }
  | { event_type: 'media_command'; command: string }
  | { event_type: 'ask_question'; question: string };

// Pipeline run result from subscribePipelineRun
export interface PipelineRunResult {
  handler_id: number;
}

// Pipeline event shapes (from subscribeMessage events)
export interface PipelineEvent {
  type: string;
  data?: {
    stt_output?: { text: string };
    tts_output?: { text: string; media_id?: string };
    intent_output?: { response?: { speech?: string } };
    message?: string;
    code?: string;
  };
  /** HA often sends a structured object, not a plain string. */
  error?: unknown;
}

// ============================================================================
// Helper to safely extract the raw WebSocket from a Connection object
// ============================================================================

/**
 * Extracts the underlying WebSocket from a home-assistant-js-websocket Connection.
 * Required for sending binary frames (PCM audio) which the Connection API doesn't expose.
 */
export function getRawSocket(conn: Connection): WebSocket {
  return (conn as unknown as { socket: WebSocket }).socket;
}
