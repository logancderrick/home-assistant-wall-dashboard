/**
 * Voice Satellite integration context.
 * Manages voice pipeline state, audio capture, wake word detection, and HA communication.
 */

import {
  useReducer,
  useEffect,
  useRef,
  useCallback,
  useState,
  useContext,
  type ReactNode,
} from 'react';
import { useAppContext } from './AppContext';
import { useSkydarkDataContext } from './SkydarkDataContext';
import {
  VoiceState,
  VOICE_SAMPLE_RATE,
  VOICE_UTTERANCE_SILENCE_MS,
  VOICE_UTTERANCE_SPEECH_RMS,
  VOICE_WAKE_PULSE_MS,
  VOICE_HAD_SPEECH_ARM_DELAY_MS,
  VOICE_MIN_LISTEN_BEFORE_AUTO_END_MS,
  VOICE_MIN_LOUD_MS_FOR_AUTO_END_MS,
  VOICE_MAX_LISTEN_STREAM_MS,
  VOICE_WAKE_BLOCK_AFTER_TAP_MS,
  VOICE_WAKE_BLOCK_AFTER_WAKE_MS,
  VOICE_WAKE_POST_RUN_QUIET_MS,
  VOICE_WAKE_SILENCE_RMS,
  type VoiceStateValue,
} from '../lib/voice/constants';
import { formatVoiceUserMessage } from '../lib/voice/formatVoiceUserMessage';
import { createAudioCapture } from '../lib/voice/audioCapture';
import { createPipelineComms, isDuplicateWakeUpPipelineError } from '../lib/voice/pipelineComms';
import { createTtsPlayer } from '../lib/voice/ttsPlayer';
import {
  createWakeWordDetector,
  parseVoiceWakeWordModelId,
  VOICE_WAKE_WORD_MODEL_LABELS,
  type WakeWordDetector,
} from '../lib/voice/wakeWord';
import { toHaMessage, type AnnounceFinishedMsg, type SubscribeEventsMsg, type UpdateStateMsg } from '../lib/voice/wsTypes';
import { isSkydarkDemo } from '../lib/demoMode';
import { pcmRmsNormalized } from '../lib/voice/pcmLevel';
import { playWakeEarcon } from '../lib/voice/wakeEarcon';
import { VoiceContext, type VoiceContextValue } from './voiceContextShared';

export type { VoiceContextValue };

/** No active voice_satellite binary handler — do not use 0 (HA may assign handler id 0). */
const NO_PIPELINE_HANDLER = -1;

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
  | { type: 'ERROR'; message: unknown }
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
        error: formatVoiceUserMessage(action.message),
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
  const [wakePulse, setWakePulse] = useState(false);

  const conn = skydark?.data?.connection ?? null;
  const entityId = app.settings.voiceSatelliteEntityId ?? '';
  const pipelineId = app.settings.voicePipelineId ?? '';
  const isEnabled = entityId.trim().length > 0 && conn !== null;
  const wakeModelId = parseVoiceWakeWordModelId(app.settings.voiceWakeWordModelId);
  const wakePhrase = VOICE_WAKE_WORD_MODEL_LABELS[wakeModelId];
  const wakeListeningEnabled = app.settings.wakeWordEnabled !== false;

  const voiceStateRef = useRef(voiceState.state);
  voiceStateRef.current = voiceState.state;

  const wakeListeningEnabledRef = useRef(wakeListeningEnabled);
  wakeListeningEnabledRef.current = wakeListeningEnabled;

  const pcmChunkHandlerRef = useRef<(pcm: Int16Array) => void | Promise<void>>(() => {});
  const startListeningRef = useRef<(initiator?: 'wake' | 'tap') => Promise<void>>(async () => {});
  /** How the current/last pipeline was started — drives post-run wake block length. */
  const lastPipelineInitiatorRef = useRef<'wake' | 'tap'>('tap');

  // Refs for managers
  const currentHandlerIdRef = useRef(NO_PIPELINE_HANDLER);
  const wakeWordDetectorRef = useRef<WakeWordDetector | null>(null);
  const isDetectingRef = useRef(false);
  const wakePulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utteranceRef = useRef({
    hadSpeech: false,
    lastLoudAt: 0,
    loudMs: 0,
    endSent: false,
  });
  /** performance.now() when LISTENING began for this pipeline run; drives client VAD gating. */
  const listeningStartedAtRef = useRef(0);
  /** Blocks overlapping voice_satellite runs (duplicate startListening / wake bounce). */
  const pipelineSessionActiveRef = useRef(false);
  /** Earliest performance.now() when wake may run after a pipeline ends. */
  const wakeArmNotBeforeRef = useRef(0);
  /** After a run, stay off until the mic has been quiet long enough (see VOICE_WAKE_POST_RUN_QUIET_MS). */
  const suppressWakeUntilQuietRef = useRef(false);
  const wakeQuietStreakMsRef = useRef(0);
  /**
   * microWakeWord mutates internal buffers in `detect()`; audio `onChunk` does not await the
   * handler, so overlapping `detect()` calls corrupt state and can double-fire wake → earcon loop.
   */
  const wakeDetectChainRef = useRef<Promise<void>>(Promise.resolve());

  const resetUtteranceTracking = useCallback(() => {
    utteranceRef.current = { hadSpeech: false, lastLoudAt: 0, loudMs: 0, endSent: false };
    listeningStartedAtRef.current = 0;
  }, []);

  const armWakeAfterPipelineEnd = () => {
    suppressWakeUntilQuietRef.current = true;
    wakeQuietStreakMsRef.current = 0;
    const blockMs =
      lastPipelineInitiatorRef.current === 'wake'
        ? VOICE_WAKE_BLOCK_AFTER_WAKE_MS
        : VOICE_WAKE_BLOCK_AFTER_TAP_MS;
    wakeArmNotBeforeRef.current = performance.now() + blockMs;
    wakeWordDetectorRef.current?.flushPending();
  };
  const handlersRef = useRef({
    audio: createAudioCapture({
      onChunk: (pcm) => {
        void pcmChunkHandlerRef.current(pcm);
      },
      onError: (err) => {
        dispatch({ type: 'ERROR', message: err.message || err });
      },
    }),
    pipeline: createPipelineComms(),
    tts: createTtsPlayer(),
  });

  // Initialize wake word detector once (skipped when hands-free wake is disabled in settings)
  useEffect(() => {
    if (isSkydarkDemo || !isEnabled || !wakeListeningEnabled) {
      if (wakeWordDetectorRef.current) {
        void wakeWordDetectorRef.current.cleanup();
        wakeWordDetectorRef.current = null;
      }
      return;
    }

    const initWakeWordDetector = async () => {
      try {
        wakeWordDetectorRef.current = await createWakeWordDetector({
          modelId: wakeModelId,
          sensitivity01: wakeWordSensitivity,
        });
        wakeWordDetectorRef.current.setConfig({ sensitivity: wakeWordSensitivity });
      } catch (err) {
        console.error(
          '[SkyDark voice] Wake word models failed to load — tap-to-talk may still work, wake word will not:',
          err,
        );
      }
    };

    void initWakeWordDetector();

    return () => {
      if (wakePulseTimeoutRef.current) {
        clearTimeout(wakePulseTimeoutRef.current);
        wakePulseTimeoutRef.current = null;
      }
      setWakePulse(false);
      wakeWordDetectorRef.current?.cleanup();
      wakeWordDetectorRef.current = null;
    };
  }, [isEnabled, wakeWordSensitivity, wakeModelId, wakeListeningEnabled]);

  // Start always-on audio capture for wake word detection
  useEffect(() => {
    if (!isEnabled || isSkydarkDemo) return;
    const c = conn;
    if (!c) return;

    const startWakeWordListening = async () => {
      try {
        const { audio } = handlersRef.current;

        pcmChunkHandlerRef.current = async (pcm: Int16Array) => {
          const chunkMs = (pcm.length / VOICE_SAMPLE_RATE) * 1000;
          const level = pcmRmsNormalized(pcm);
          if (level < VOICE_WAKE_SILENCE_RMS) {
            wakeQuietStreakMsRef.current += chunkMs;
          } else {
            wakeQuietStreakMsRef.current = 0;
          }
          if (
            suppressWakeUntilQuietRef.current &&
            wakeQuietStreakMsRef.current >= VOICE_WAKE_POST_RUN_QUIET_MS &&
            performance.now() >= wakeArmNotBeforeRef.current
          ) {
            suppressWakeUntilQuietRef.current = false;
            wakeWordDetectorRef.current?.flushPending();
          }

          if (
            wakeWordDetectorRef.current &&
            isDetectingRef.current &&
            wakeListeningEnabledRef.current
          ) {
            if (
              performance.now() >= wakeArmNotBeforeRef.current &&
              !suppressWakeUntilQuietRef.current
            ) {
              wakeDetectChainRef.current = wakeDetectChainRef.current
                .then(async () => {
                  const detector = wakeWordDetectorRef.current;
                  if (!detector || !isDetectingRef.current) return;
                  if (performance.now() < wakeArmNotBeforeRef.current) return;
                  if (suppressWakeUntilQuietRef.current) return;
                  if (voiceStateRef.current !== VoiceState.IDLE) return;
                  const { detected } = await detector.detect(pcm);
                  if (!detected) return;
                  if (performance.now() < wakeArmNotBeforeRef.current) return;
                  if (suppressWakeUntilQuietRef.current) return;
                  if (voiceStateRef.current !== VoiceState.IDLE || !isDetectingRef.current) return;

                  dispatch({ type: 'WAKE_WORD_DETECTED' });
                  playWakeEarcon();
                  if (wakePulseTimeoutRef.current) {
                    clearTimeout(wakePulseTimeoutRef.current);
                    wakePulseTimeoutRef.current = null;
                  }
                  setWakePulse(true);
                  wakePulseTimeoutRef.current = setTimeout(() => {
                    wakePulseTimeoutRef.current = null;
                    setWakePulse(false);
                  }, VOICE_WAKE_PULSE_MS);

                  void startListeningRef.current('wake');
                })
                .catch((err) => {
                  console.warn('[SkyDark voice] Wake detection error:', err);
                });
            }
          }

          let handlerId = currentHandlerIdRef.current;
          if (handlerId >= 0) {
            handlersRef.current.pipeline.sendAudioChunk(c, handlerId, pcm);
          }

          handlerId = currentHandlerIdRef.current;
          if (
            handlerId >= 0 &&
            voiceStateRef.current === VoiceState.LISTENING &&
            !utteranceRef.current.endSent
          ) {
            const u = utteranceRef.current;
            const rms = pcmRmsNormalized(pcm);
            const now = performance.now();
            const listen0 = listeningStartedAtRef.current;
            const pastArmDelay = listen0 > 0 && now - listen0 >= VOICE_HAD_SPEECH_ARM_DELAY_MS;
            const pastMinListen = listen0 > 0 && now - listen0 >= VOICE_MIN_LISTEN_BEFORE_AUTO_END_MS;

            if (pastArmDelay && rms >= VOICE_UTTERANCE_SPEECH_RMS) {
              u.hadSpeech = true;
              u.lastLoudAt = now;
              u.loudMs += chunkMs;
            } else if (
              pastMinListen &&
              u.hadSpeech &&
              u.loudMs >= VOICE_MIN_LOUD_MS_FOR_AUTO_END_MS &&
              now - u.lastLoudAt >= VOICE_UTTERANCE_SILENCE_MS
            ) {
              u.endSent = true;
              handlersRef.current.pipeline.sendAudioDone(c, handlerId);
              currentHandlerIdRef.current = NO_PIPELINE_HANDLER;
            } else if (
              listen0 > 0 &&
              now - listen0 >= VOICE_MAX_LISTEN_STREAM_MS
            ) {
              u.endSent = true;
              handlersRef.current.pipeline.sendAudioDone(c, handlerId);
              currentHandlerIdRef.current = NO_PIPELINE_HANDLER;
            }
          }
        };

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
      wakeDetectChainRef.current = Promise.resolve();
      pcmChunkHandlerRef.current = () => {};
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
                await conn.sendMessagePromise(toHaMessage(ackMsg));
              } catch (err) {
                console.warn('Failed to send announce_finished', err);
              }
            }
          }
        }, toHaMessage(subscribeMsg));
      } catch (err) {
        console.warn('Failed to subscribe to voice satellite events', err);
      }
    };

    void subscribe();

    return () => {
      if (unsubscribe) void unsubscribe();
    };
  }, [conn, entityId, isEnabled]);

  const startListening = useCallback(async (initiator: 'wake' | 'tap' = 'tap') => {
    if (!conn || !isEnabled || isSkydarkDemo) return;
    if (pipelineSessionActiveRef.current) return;

    lastPipelineInitiatorRef.current = initiator;

    pipelineSessionActiveRef.current = true;
    try {
      dispatch({ type: 'CONNECTING' });
      isDetectingRef.current = false;
      wakeWordDetectorRef.current?.flushPending();
      resetUtteranceTracking();

      const { pipeline } = handlersRef.current;

      const { handlerId } = await pipeline.start(
        conn,
        {
          type: 'voice_satellite/run_pipeline',
          entity_id: entityId,
          sample_rate: VOICE_SAMPLE_RATE,
          pipeline_id: pipelineId || undefined,
          start_stage: 'stt',
          end_stage: 'tts',
          /** HA core duplicate wake-up suppression (DATA_LAST_WAKE_UP); same contract as voice_satellite card. */
          wake_word_phrase: wakePhrase,
        },
        {
          onSttEnd: (_transcript: string) => {
            dispatch({ type: 'PROCESSING' });
          },
          onTtsStart: (ttsOutput: string) => {
            dispatch({ type: 'RESPONDING', transcript: formatVoiceUserMessage(ttsOutput as unknown) });
          },
          onTtsEnd: () => {
            // End of TTS
          },
          onRunEnd: () => {
            currentHandlerIdRef.current = NO_PIPELINE_HANDLER;
            isDetectingRef.current = true;
            armWakeAfterPipelineEnd();
            pipelineSessionActiveRef.current = false;
            resetUtteranceTracking();
            dispatch({ type: 'DONE' });
          },
          onError: (code: string, message: string) => {
            currentHandlerIdRef.current = NO_PIPELINE_HANDLER;
            isDetectingRef.current = true;
            armWakeAfterPipelineEnd();
            pipelineSessionActiveRef.current = false;
            resetUtteranceTracking();
            if (isDuplicateWakeUpPipelineError(code, message)) {
              dispatch({ type: 'DONE' });
              return;
            }
            dispatch({ type: 'ERROR', message });
          },
        }
      );

      currentHandlerIdRef.current = handlerId;
      listeningStartedAtRef.current = performance.now();
      dispatch({ type: 'LISTENING' });
    } catch (err) {
      currentHandlerIdRef.current = NO_PIPELINE_HANDLER;
      isDetectingRef.current = true;
      armWakeAfterPipelineEnd();
      pipelineSessionActiveRef.current = false;
      resetUtteranceTracking();
      const raw = err instanceof Error ? err.message : formatVoiceUserMessage(err);
      const colon = raw.indexOf(':');
      const codePart = colon >= 0 ? raw.slice(0, colon).trim() : raw;
      const msgPart = colon >= 0 ? raw.slice(colon + 1).trim() : '';
      if (isDuplicateWakeUpPipelineError(codePart, msgPart || raw)) {
        dispatch({ type: 'DONE' });
        return;
      }
      dispatch({ type: 'ERROR', message: raw });
    }
  }, [conn, entityId, isEnabled, pipelineId, resetUtteranceTracking, wakePhrase]);

  startListeningRef.current = startListening;

  const stopListening = useCallback(() => {
    if (!conn || !isEnabled) return;
    try {
      const hid = currentHandlerIdRef.current;
      if (hid >= 0) {
        utteranceRef.current.endSent = true;
        handlersRef.current.pipeline.sendAudioDone(conn, hid);
      }
      currentHandlerIdRef.current = NO_PIPELINE_HANDLER;
      isDetectingRef.current = true;
      lastPipelineInitiatorRef.current = 'tap';
      armWakeAfterPipelineEnd();
      pipelineSessionActiveRef.current = false;
      resetUtteranceTracking();
      dispatch({ type: 'DONE' });
    } catch (err) {
      console.warn('Error stopping audio', err);
    }
  }, [conn, isEnabled, resetUtteranceTracking]);

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
      void conn.sendMessagePromise(toHaMessage(updateMsg));
    } catch (err) {
      // Silently ignore
    }
  }, [conn, entityId, isEnabled, voiceState.state]);

  const value: VoiceContextValue = {
    voiceState: voiceState.state,
    transcript: voiceState.transcript,
    error: voiceState.error,
    isEnabled,
    wakeHandsFreeEnabled: wakeListeningEnabled,
    isListeningForWakeWord: voiceState.isListeningForWakeWord && wakeListeningEnabled,
    wakeWordDetected: voiceState.wakeWordDetected,
    wakeWordSensitivity,
    wakePhrase,
    wakePulse,
    setWakeWordSensitivity: handleSetWakeWordSensitivity,
    startListening,
    stopListening,
    dismiss,
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
