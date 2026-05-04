/**
 * WebSocket protocol for voice_satellite audio pipeline.
 * Handles `voice_satellite/run_pipeline` subscription and binary PCM frame sending.
 */

import type { Connection } from 'home-assistant-js-websocket';
import type { RunPipelineMsg, PipelineRunResult, PipelineEvent } from './wsTypes';
import { getRawSocket } from './wsTypes';

export interface PipelineEventCallbacks {
  onSttEnd: (transcript: string) => void;
  onTtsStart: (ttsOutput: string) => void;
  onTtsEnd: () => void;
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

/**
 * Creates a pipeline comms handle for sending audio to HA's assist pipeline.
 */
export function createPipelineComms(): PipelineCommsHandle {
  const start = async (
    conn: Connection,
    msg: RunPipelineMsg,
    callbacks: PipelineEventCallbacks
  ): Promise<{ handlerId: number }> => {
    return new Promise((resolve, reject) => {
      try {
        // Subscribe to the pipeline run with event handling
        conn.subscribeMessage(
          (event: unknown) => {
            const e = event as Record<string, unknown>;
            const type = e.type as string;

            // Parse pipeline event
            if (type === 'run-start') {
              // Pipeline started
            } else if (type === 'stt-end') {
              const pipelineEvent = e as PipelineEvent;
              const transcript =
                pipelineEvent.data?.stt_output?.text ?? '';
              callbacks.onSttEnd(transcript);
            } else if (type === 'tts-start') {
              const pipelineEvent = e as PipelineEvent;
              const ttsOutput = pipelineEvent.data?.tts_output?.text ?? '';
              callbacks.onTtsStart(ttsOutput);
            } else if (type === 'tts-end') {
              callbacks.onTtsEnd();
            } else if (type === 'run-end') {
              callbacks.onRunEnd();
            } else if (type === 'error') {
              const pipelineEvent = e as PipelineEvent;
              callbacks.onError('pipeline_error', pipelineEvent.error ?? 'Unknown error');
            }
          },
          msg
        ).then((unsubscribe) => {
          // Query the response to get the handler_id
          conn.sendMessagePromise(msg as Record<string, unknown>).then((result) => {
            const pipelineResult = result as PipelineRunResult;
            resolve({ handlerId: pipelineResult.handler_id });
          });
        }).catch((err) => {
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  };

  const sendAudioChunk = (conn: Connection, handlerId: number, pcm: Int16Array): void => {
    try {
      const socket = getRawSocket(conn);
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      // HA assist pipeline protocol: 4-byte little-endian uint32 handler_id + PCM bytes
      const buf = new ArrayBuffer(4 + pcm.byteLength);
      const view = new DataView(buf);
      view.setUint32(0, handlerId, true); // handler_id as little-endian uint32

      // Copy PCM data after the handler_id
      const uint8View = new Uint8Array(buf);
      uint8View.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 4);

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

      // Send termination frame: just the handler_id with zero bytes
      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);
      view.setUint32(0, handlerId, true);

      socket.send(buf);
    } catch (err) {
      // Silently ignore send errors
    }
  };

  return { start, sendAudioChunk, sendAudioDone };
}
