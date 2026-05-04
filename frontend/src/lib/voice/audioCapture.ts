/**
 * Microphone capture via Web Audio API and AudioWorklet.
 * Captures 16-bit PCM audio at 16kHz sample rate.
 */

import { VOICE_SAMPLE_RATE } from './constants';

export interface AudioCaptureOptions {
  onChunk: (pcm: Int16Array) => void;
  onError: (err: Error) => void;
}

export interface AudioCaptureHandle {
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Creates an audio capture handle that streams PCM samples via a callback.
 * Call start() to request microphone access, then onChunk fires for each 512-sample buffer.
 */
export function createAudioCapture(opts: AudioCaptureOptions): AudioCaptureHandle {
  let audioCtx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let stream: MediaStream | null = null;

  const stop = () => {
    if (workletNode) {
      workletNode.disconnect();
      workletNode = null;
    }
    if (source) {
      source.disconnect();
      source = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (audioCtx && audioCtx.state !== 'closed') {
      void audioCtx.close();
      audioCtx = null;
    }
  };

  const start = async () => {
    try {
      // Request microphone access
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      // Create AudioContext at 16kHz
      audioCtx = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });

      // Load the AudioWorklet processor
      const workletUrl = `${import.meta.env.BASE_URL}voice-worklet-processor.js`;
      await audioCtx.audioWorklet.addModule(workletUrl);

      // Create the microphone source
      source = audioCtx.createMediaStreamSource(stream);

      // Create and configure the worklet node
      workletNode = new AudioWorkletNode(audioCtx, 'voice-capture-processor');

      // Handle samples from the worklet
      workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const float32 = e.data;

        // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          // Clamp to [-1, 1]
          const s = Math.max(-1, Math.min(1, float32[i]));
          // Scale and convert to integer
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        opts.onChunk(int16);
      };

      // Wire up: mic → worklet → (audio plays out via system)
      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);
    } catch (err) {
      stop();
      opts.onError(
        err instanceof Error
          ? err
          : new Error(`Audio capture setup failed: ${String(err)}`)
      );
    }
  };

  return { start, stop };
}
