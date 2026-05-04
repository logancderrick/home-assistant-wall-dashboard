/**
 * Voice Satellite integration context.
 * Manages voice pipeline state, audio capture, and HA communication.
 */

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import type { Connection } from 'home-assistant-js-websocket';
import { useAppContext } from './AppContext';
import { useSkydarkDataContext } from './SkydarkDataContext';
import { VoiceState, type VoiceStateValue } from '../lib/voice/constants';
import { createAudioCapture } from '../lib/voice/audioCapture';
import { createPipelineComms } from '../lib/voice/pipelineComms';
import { createTtsPlayer } from '../lib/voice/ttsPlayer';
import type { AnnounceFinishedMsg, SubscribeEventsMsg, UpdateStateMsg } from '../lib/voice/wsTypes';
import { isSkydarkDemo } from '../lib/demoMode';

export interface VoiceContextValue {
  voiceState: VoiceStateValue;
  transcript: string;
  error: string | null;
  isEnabled: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
  dismiss: () => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function useVoiceContext(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoiceContext must be used within VoiceProvider');
  return ctx;
}

// ============================================================================
// State machine
// ============================================================================

type VoiceAction =
  | { type: 'START' }
  | { type: 'CONNECTING' }
  | { type: 'LISTENING' }
  | { type: 'PROCESSING' }
  | { type: 'RESPONDING'; transcript: string }
  | { type: 'DONE' }
  | { type: 'ERROR'; message: string }
  | { type: 'DISMISS' };

interface VoiceState {
  state: VoiceStateValue;
  transcript: string;
  error: string | null;
}

const initialVoiceState: VoiceState = {
  state: VoiceState.IDLE,
  transcript: '',
  error: null,
};

function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case 'START':
      return { ...state, state: VoiceState.IDLE, error: null };
    case 'CONNECTING':
      return { ...state, state: VoiceState.CONNECTING, error: null };
    case 'LISTENING':
      return { ...state, state: VoiceState.LISTENING, error: null, transcript: '' };
    case 'PROCESSING':
      return { ...state, state: VoiceState.PROCESSING, error: null };
    case 'RESPONDING':
      return {
        ...state,
        state: VoiceState.RESPONDING,
        error: null,
        transcript: action.transcript,
      };
    case 'DONE':
      return { ...state, state: VoiceState.IDLE };
    case 'ERROR':
      return { ...state, state: VoiceState.ERROR, error: action.message };
    case 'DISMISS':
      return { ...state, state: VoiceState.IDLE, error: null };
    default:
      return state;
  }
}

// ============================================================================
// Provider
// ============================================================================

export function VoiceProvider({ children }: { children: ReactNode }) {
  const app = useAppContext();
  const skydark = useSkydarkDataContext();
  const [voiceState, dispatch] = useReducer(voiceReducer, initialVoiceState);

  const conn = skydark?.data?.connection ?? null;
  const entityId = app.settings.voiceSatelliteEntityId ?? '';
  const pipelineId = app.settings.voicePipelineId ?? '';
  const isEnabled = entityId.trim().length > 0 && conn !== null;

  // Ref to avoid recreating on every render
  const currentHandlerIdRef = useRef(0);
  const handlersRef = useRef({
    audio: createAudioCapture({
      onChunk: () => {}, // will be set in startListening
      onError: (err) => {
        dispatch({ type: 'ERROR', message: err.message });
      },
    }),
    pipeline: createPipelineComms(),
    tts: createTtsPlayer(),
  });

  // Subscribe to voice_satellite events (announcements, wake, etc.)
  useEffect(() => {
    if (!conn || !isEnabled || isSkydarkDemo) return;

    const subscribeMsg: SubscribeEventsMsg = {
      type: 'voice_satellite/subscribe_events',
      entity_id: entityId,
    };

    let unsubscribe: (() => void) | null = null;

    const subscribe = async () => {
      try {
        unsubscribe = await conn.subscribeMessage(async (event: unknown) => {
          const evt = event as Record<string, unknown>;
          const eventType = evt.event_type as string;

          if (eventType === 'announce') {
            const mediaId = evt.media_id as string | undefined;
            if (mediaId) {
              try {
                // Convert media_id to HTTP-accessible URL
                const url = `/api/skydark_calendar/photo/${mediaId}`;
                await handlersRef.current.tts.play(url);
              } catch (err) {
                console.warn('Failed to play announcement', err);
              }

              // Send ACK
              const ackMsg: AnnounceFinishedMsg = {
                type: 'voice_satellite/announce_finished',
                entity_id: entityId,
              };
              try {
                await conn.sendMessagePromise(ackMsg as Record<string, unknown>);
              } catch (err) {
                console.warn('Failed to send announce_finished', err);
              }
            }
          }
        }, subscribeMsg);
      } catch (err) {
        console.warn('Failed to subscribe to voice satellite events', err);
      }
    };

    void subscribe();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [conn, entityId, isEnabled]);

  const startListening = useCallback(async () => {
    if (!conn || !isEnabled || isSkydarkDemo) return;

    try {
      dispatch({ type: 'CONNECTING' });

      const handlers = handlersRef.current;
      const { pipeline, audio, tts } = handlers;

      // Start audio capture with handler reference for PCM chunks
      audio.onChunk = (pcm: Int16Array) => {
        if (currentHandlerIdRef.current > 0) {
          pipeline.sendAudioChunk(conn, currentHandlerIdRef.current, pcm);
        }
      };

      await audio.start();
      dispatch({ type: 'LISTENING' });

      // Start pipeline
      const { handlerId } = await pipeline.start(
        conn,
        {
          type: 'voice_satellite/run_pipeline',
          entity_id: entityId,
          pipeline_id: pipelineId || undefined,
          start_stage: 'stt',
          end_stage: 'tts',
        },
        {
          onSttEnd: (transcript: string) => {
            dispatch({ type: 'PROCESSING' });
          },
          onTtsStart: (ttsOutput: string) => {
            dispatch({ type: 'RESPONDING', transcript: ttsOutput });
          },
          onTtsEnd: () => {
            // End of TTS
          },
          onRunEnd: () => {
            audio.stop();
            currentHandlerIdRef.current = 0;
            dispatch({ type: 'DONE' });
          },
          onError: (code: string, message: string) => {
            audio.stop();
            currentHandlerIdRef.current = 0;
            dispatch({ type: 'ERROR', message });
          },
        }
      );

      currentHandlerIdRef.current = handlerId;
    } catch (err) {
      handlersRef.current.audio.stop();
      currentHandlerIdRef.current = 0;
      dispatch({
        type: 'ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [conn, entityId, isEnabled, pipelineId]);

  const stopListening = useCallback(() => {
    if (!conn || !isEnabled) return;
    try {
      handlersRef.current.audio.stop();
      dispatch({ type: 'DONE' });
    } catch (err) {
      console.warn('Error stopping audio', err);
    }
  }, [conn, isEnabled]);

  const dismiss = useCallback(() => {
    dispatch({ type: 'DISMISS' });
  }, []);

  // Update entity state in HA
  useEffect(() => {
    if (!conn || !isEnabled) return;

    const updateMsg: UpdateStateMsg = {
      type: 'voice_satellite/update_state',
      entity_id: entityId,
      state: voiceState.state,
    };

    try {
      void conn.sendMessagePromise(updateMsg as Record<string, unknown>);
    } catch (err) {
      // Silently ignore
    }
  }, [conn, entityId, isEnabled, voiceState.state]);

  const value: VoiceContextValue = {
    voiceState: voiceState.state,
    transcript: voiceState.transcript,
    error: voiceState.error,
    isEnabled,
    startListening,
    stopListening,
    dismiss,
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
