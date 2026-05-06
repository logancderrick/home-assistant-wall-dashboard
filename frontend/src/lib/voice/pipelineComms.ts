/**
 * WebSocket protocol for voice_satellite audio pipeline.
 * Handles `voice_satellite/run_pipeline` subscription and binary PCM frame sending.
 */

import type { Connection } from "home-assistant-js-websocket";
import type { RunPipelineMsg, PipelineEvent } from "./wsTypes";
import { getRawSocket, toHaMessage } from "./wsTypes";
import { formatVoiceUserMessage } from "./formatVoiceUserMessage";

function extractPipelineErrorCode(e: Record<string, unknown>): string {
  const data = e.data as Record<string, unknown> | undefined;
  if (data && typeof data.code === 'string' && data.code.length > 0) return data.code;
  if (typeof e.code === 'string' && e.code.length > 0) return e.code;
  return 'unknown';
}

/** HA `assist_pipeline.error.DuplicateWakeUpDetectedError` — benign; ignore UI error. */
export function isDuplicateWakeUpPipelineError(code: string, message: string): boolean {
  const blob = `${code} ${message}`.toLowerCase();
  return (
    code === 'duplicate_wake_up_detected' ||
    blob.includes('duplicate_wake_up_detected') ||
    blob.includes('duplicate wake-up')
  );
}

function pipelineErrorText(e: Record<string, unknown>, pipelineEvent: PipelineEvent): string {
  const fromField = formatVoiceUserMessage(pipelineEvent.error);
  if (fromField !== "Unknown error") return fromField;
  const data = pipelineEvent.data as Record<string, unknown> | undefined;
  if (data) {
    const nested = formatVoiceUserMessage(data.message ?? data.error ?? data.code);
    if (nested !== "Unknown error") return nested;
  }
  return formatVoiceUserMessage(e.message ?? e.error);
}

export interface PipelineEventCallbacks {
  onSttEnd: (transcript: string) => void;
  onIntentEnd: (speech: string, responseType: string) => void;
  onTtsStart: (ttsOutput: string) => void;
  onTtsEnd: (ttsUrl?: string) => void;
  onError: (code: string, message: string) => void;
  onRunEnd: () => void;
}

export interface PipelineCommsHandle {
  start: (
    conn: Connection,
    msg: RunPipelineMsg,
    callbacks: PipelineEventCallbacks
  ) => Promise<{ handlerId: number }>;
  sendAudioChunk: (conn: Connection, handlerId: number, pcm: Int16Array) => void;
  sendAudioDone: (conn: Connection, handlerId: number) => void;
}

function normalizeBinaryHandlerId(handlerId: number): number {
  const n = Math.trunc(handlerId);
  if (!Number.isFinite(n) || n < 0 || n > 255) {
    throw new Error("Invalid binary handler id from Home Assistant");
  }
  return n;
}

/**
 * Creates a pipeline comms handle for sending audio to HA's assist pipeline.
 */
export function createPipelineComms(): PipelineCommsHandle {
  const start = async (
    conn: Connection,
    msg: RunPipelineMsg,
    callbacks: PipelineEventCallbacks
  ): Promise<{ handlerId: number }> => {
    let handlerResolved = false;
    let settled = false;

    return new Promise((resolve, reject) => {
      const settleReject = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      void conn
        .subscribeMessage(
          (event: unknown) => {
            const e = event as Record<string, unknown>;
            const type = e.type as string;

            // voice_satellite (and assist_pipeline) send handler_id only in this event,
            // not in the command result. A second sendMessagePromise was removing the
            // subscription and breaking the stream ("unknown subscription" in the client).
            if (type === "init") {
              try {
                const hid = normalizeBinaryHandlerId(Number(e.handler_id));
                if (!handlerResolved) {
                  handlerResolved = true;
                  settled = true;
                  resolve({ handlerId: hid });
                }
              } catch (subErr) {
                settleReject(
                  subErr instanceof Error
                    ? subErr
                    : new Error(String(subErr)),
                );
              }
              return;
            }

            if (type === "displaced") {
              settleReject(
                new Error(
                  "Voice session was replaced by another browser or tab using this satellite entity.",
                ),
              );
              return;
            }

            if (type === "run-start") {
              // Pipeline started
            } else if (type === "stt-end") {
              const pipelineEvent = e as unknown as PipelineEvent;
              const transcript = pipelineEvent.data?.stt_output?.text ?? "";
              callbacks.onSttEnd(transcript);
            } else if (type === "intent-end") {
              const pipelineEvent = e as unknown as PipelineEvent;
              const response = pipelineEvent.data?.intent_output?.response;
              const speech = response?.speech?.plain?.speech ?? "";
              const responseType = response?.response_type ?? "";
              callbacks.onIntentEnd(speech, responseType);
            } else if (type === "tts-start") {
              const pipelineEvent = e as unknown as PipelineEvent;
              const ttsOutput =
                pipelineEvent.data?.tts_output?.text ??
                pipelineEvent.data?.intent_output?.response?.speech?.plain?.speech ??
                "";
              callbacks.onTtsStart(ttsOutput);
            } else if (type === "tts-end") {
              const pipelineEvent = e as unknown as PipelineEvent;
              const ttsUrl = pipelineEvent.data?.tts_output?.url;
              callbacks.onTtsEnd(ttsUrl);
            } else if (type === "run-end") {
              callbacks.onRunEnd();
            } else if (type === "error") {
              const pipelineEvent = e as unknown as PipelineEvent;
              const code = extractPipelineErrorCode(e);
              const msg = pipelineErrorText(e, pipelineEvent);
              if (!handlerResolved) {
                settleReject(new Error(`${code}: ${msg}`));
              } else {
                callbacks.onError(code, msg);
              }
            }
          },
          toHaMessage(msg)
        )
        .catch((err) => {
          settleReject(
            err instanceof Error ? err : new Error(formatVoiceUserMessage(err)),
          );
        });
    });
  };

  const sendAudioChunk = (conn: Connection, handlerId: number, pcm: Int16Array): void => {
    try {
      const socket = getRawSocket(conn);
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      // HA WebSocket binary: first byte = registered binary handler id, remainder = PCM (int16le mono).
      // See homeassistant/components/websocket_api/http.py (command-phase BINARY).
      const hi = normalizeBinaryHandlerId(handlerId);
      const buf = new ArrayBuffer(1 + pcm.byteLength);
      const uint8View = new Uint8Array(buf);
      uint8View[0] = hi;
      uint8View.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 1);

      socket.send(buf);
    } catch (err) {
      // Silently ignore send errors (connection may have closed)
    }
  };

  const sendAudioDone = (conn: Connection, handlerId: number): void => {
    try {
      const socket = getRawSocket(conn);
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const hi = normalizeBinaryHandlerId(handlerId);
      // Empty payload after handler byte = stop stream (voice_satellite audio_queue).
      socket.send(new Uint8Array([hi]));
    } catch (err) {
      // Silently ignore send errors
    }
  };

  return { start, sendAudioChunk, sendAudioDone };
}
