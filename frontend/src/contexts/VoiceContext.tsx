/**
 * Voice Satellite integration context.
 * Manages voice pipeline state, audio capture, wake word detection, and HA communication.
 */

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useCallback,
  useState,
  type ReactNode,
} from 'react';
import type { Connection } from 'home-assistant-js-websocket';
import { useAppContext } from './AppContext';
import { useSkydarkDataContext } from './SkydarkDataContext';
import { VoiceState, type VoiceStateValue } from '../lib/voice/constants';
import { createAudioCapture } from '../lib/voice/audioCapture';
import { createPipelineComms } from '../lib/voice/pipelineComms';
import { createTtsPlayer } from '../lib/voice/ttsPlayer';
import { createWakeWordDetector, type WakeWordDetector } from '../lib/voice/wakeWord';
import type { AnnounceFinishedMsg, SubscribeEventsMsg, UpdateStateMsg } from '../lib/voice/wsTypes';
import { isSkydarkDemo } from '../lib/demoMode';

export interface VoiceContextValue {
  voiceState: VoiceStateValue;
  transcript: string;
  error: string | null;
  isEnabled: boolean;
  isListeningForWakeWord: boolean;
  wakeWordDetected: boolean;
  wakeWordSensitivity: number;
  setWakeWordSensitivity: (value: number) => void;
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
  | { type: 'WAKE_WORD_LISTENING' }
  | { type: 'WAKE_WORD_DETECTED' }
  | { type: 'CONNECTING' }
  | { type: 'LISTENING' }
  | { type: 'PROCESSING' }
  | { type: 'RESPONDING'; transcript: string }
  | { type: 'DONE' }
  | { type: 'ERROR'; message: string }
  | { type: 'DISMISS' };

interface VoiceState {
  state: VoiceStateValue;
  isListeningForWakeWord: boolean;
  wakeWordDetected: boolean;
  transcript: string;
  error: string | null;
}

const initialVoiceState: VoiceState = {
  state: VoiceState.IDLE,
  isListeningForWakeWord: false,
  wakeWordDetected: false,
  transcript: '',
  error: null,
};

function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case 'START':
      return {
        ...state,
        state: VoiceState.IDLE,
        isListeningForWakeWord: true,
        error: null,
      };
    case 'WAKE_WORD_LISTENING':
      return { ...state, isListeningForWakeWord: true, wakeWordDetected: false };
    case 'WAKE_WORD_DETECTED':
      return { ...state, wakeWordDetected: true };
    case 'CONNECTING':
      return {
        ...state,
        state: VoiceState.CONNECTING,
        isListeningForWakeWord: false,
        error: null,
      };
    case 'LISTENING':
      return {
        ...state,
        state: VoiceState.LISTENING,
        error: null,
        transcript: '',
      };
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
      return {
        ...state,
        state: VoiceState.IDLE,
        isListeningForWakeWord: true,
        wakeWordDetected: false,
      };
    case 'ERROR':
      return {
        ...state,
        state: VoiceState.ERROR,
        error: action.message,
        isListeningForWakeWord: true,
      };
    case 'DISMISS':
      return {
        ...state,
        state: VoiceState.IDLE,
        isListeningForWakeWord: true,
        wakeWordDetected: false,
        error: null,
      };
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
  const [wakeWordSensitivity, setWakeWordSensitivityState] = useState(0.5);

  const conn = skydark?.data?.connection ?? null;
  const entityId = app.settings.voiceSatelliteEntityId ?? '';
  const pipelineId = app.settings.voicePipelineId ?? '';
  const isEnabled = entityId.trim().length > 0 && conn !== null;

  // Refs for managers
  const currentHandlerIdRef = useRef(0);
  const wakeWordDetectorRef = useRef<WakeWordDetector | null>(null);
  const isDetectingRef = useRef(false);
  const handlersRef = useRef({
    audio: createAudioCapture({
      onChunk: () => {}, // will be set below
      onError: (err) => {
        dispatch({ type: 'ERROR', message: err.message });
      },
    }),
    pipeline: createPipelineComms(),
    tts: createTtsPlayer(),
  });

  // Initialize wake word detector once
  useEffect(() => {
    if (isSkydarkDemo || !isEnabled) return;

    const initWakeWordDetector = async () => {
      try {
        wakeWordDetectorRef.current = await createWakeWordDetector((confidence) => {
          if (confidence > 0.5) {
            dispatch({ type: 'WAKE_WORD_DETECTED' });
          }
        });
        wakeWordDetectorRef.current.setConfig({ sensitivity: wakeWordSensitivity });
      } catch (err) {
        console.warn('Failed to initialize wake word detector:', err);
      }
    };

    void initWakeWordDetector();

    return () => {
      wakeWordDetectorRef.current?.cleanup();
      wakeWordDetectorRef.current = null;
    };
  }, [isEnabled, wakeWordSensitivity]);

  // Start always-on audio capture for wake word detection
  useEffect(() => {
    if (!isEnabled || isSkydarkDemo) return;

    const startWakeWordListening = async () => {
      try {
        const { audio } = handlersRef.current;
        const detector = wakeWordDetectorRef.current;

        // Set up audio chunk handler for wake word detection
        audio.onChunk = async (pcm: Int16Array) => {
          if (detector && isDetectingRef.current) {
            const { detected } = await detector.detect(pcm);
            if (detected && voiceState.state === VoiceState.IDLE) {
              // Trigger pipeline start
              void startListening();
            }
          }

          // Also send to pipeline if pipeline is active
          if (currentHandlerIdRef.current > 0) {
            handlersRef.current.pipeline.sendAudioChunk(conn, currentHandlerIdRef.current, pcm);
          }
        };

        // Start audio capture
        await audio.start();
        isDetectingRef.current = true;
        dispatch({ type: 'WAKE_WORD_LISTENING' });
      } catch (err) {
        console.warn('Failed to start wake word listening:', err);
        dispatch({ type: 'ERROR', message: 'Failed to access microphone' });
      }
    };

    void startWakeWordListening();

    return () => {
      isDetectingRef.current = false;
      handlersRef.current.audio.stop();
    };
  }, [conn, isEnabled]);

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
                const url = `/api/skydark_calendar/photo/${mediaId}`;
                await handlersRef.current.tts.play(url);
              } catch (err) {
                console.warn('Failed to play announcement', err);
              }

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
      isDetectingRef.current = false;

      const { pipeline } = handlersRef.current;

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
            currentHandlerIdRef.current = 0;
            isDetectingRef.current = true;
            dispatch({ type: 'DONE' });
          },
          onError: (code: string, message: string) => {
            currentHandlerIdRef.current = 0;
            isDetectingRef.current = true;
            dispatch({ type: 'ERROR', message });
          },
        }
      );

      currentHandlerIdRef.current = handlerId;
      dispatch({ type: 'LISTENING' });
    } catch (err) {
      currentHandlerIdRef.current = 0;
      isDetectingRef.current = true;
      dispatch({
        type: 'ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [conn, entityId, isEnabled, pipelineId]);

  const stopListening = useCallback(() => {
    if (!conn || !isEnabled) return;
    try {
      currentHandlerIdRef.current = 0;
      isDetectingRef.current = true;
      dispatch({ type: 'DONE' });
    } catch (err) {
      console.warn('Error stopping audio', err);
    }
  }, [conn, isEnabled]);

  const dismiss = useCallback(() => {
    dispatch({ type: 'DISMISS' });
  }, []);

  const handleSetWakeWordSensitivity = useCallback((value: number) => {
    setWakeWordSensitivityState(value);
    if (wakeWordDetectorRef.current) {
      wakeWordDetectorRef.current.setConfig({ sensitivity: value });
    }
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
    isListeningForWakeWord: voiceState.isListeningForWakeWord,
    wakeWordDetected: voiceState.wakeWordDetected,
    wakeWordSensitivity,
    setWakeWordSensitivity: handleSetWakeWordSensitivity,
    startListening,
    stopListening,
    dismiss,
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
