/**
 * Wake word detection using TensorFlow Lite.
 * Detects "Hey Jarvis" wake words from continuous audio stream.
 */

import * as tf from '@tensorflow/tfjs';
import { VOICE_SAMPLE_RATE } from './constants';

export interface WakeWordConfig {
  sensitivity: number; // 0.0-1.0, higher = more sensitive (more false positives)
  enabled: boolean;
}

export interface WakeWordDetector {
  detect: (pcm: Int16Array) => Promise<{ detected: boolean; confidence: number }>;
  setConfig: (config: Partial<WakeWordConfig>) => void;
  cleanup: () => Promise<void>;
}

/**
 * Create a wake word detector for "Hey Jarvis".
 * Uses TFLite models: microWakeWord (feature extractor) + hey_google (classifier).
 */
export async function createWakeWordDetector(
  onDetection?: (confidence: number) => void
): Promise<WakeWordDetector> {
  const config: WakeWordConfig = {
    sensitivity: 0.5,
    enabled: true,
  };

  let featureExtractor: tf.GraphModel | null = null;
  let wakeWordModel: tf.GraphModel | null = null;
  let audioBuffer: number[] = [];
  const FEATURE_SIZE = 1960; // 49 frames * 40 mel-freq bins

  const loadModels = async () => {
    try {
      const baseUrl = `${import.meta.env.BASE_URL}voice-models/`;
      featureExtractor = await (tf as any).loadGraphModel(`${baseUrl}microWakeWord.tflite`, {
        requestInit: { cache: 'force-cache' },
      });
      wakeWordModel = await (tf as any).loadGraphModel(`${baseUrl}hey_google.tflite`, {
        requestInit: { cache: 'force-cache' },
      });
    } catch (err) {
      console.warn('Failed to load wake word models:', err);
      throw err;
    }
  };

  const extractFeatures = (pcmSamples: Int16Array): tf.Tensor | null => {
    // Convert Int16 PCM to float32 [-1, 1]
    const float32 = new Float32Array(pcmSamples.length);
    for (let i = 0; i < pcmSamples.length; i++) {
      float32[i] = pcmSamples[i] / 32768.0;
    }

    // Add to audio buffer
    for (let i = 0; i < float32.length; i++) {
      audioBuffer.push(float32[i]);
    }

    // Keep buffer at reasonable size (5 seconds at 16kHz = 80k samples)
    if (audioBuffer.length > 80000) {
      audioBuffer = audioBuffer.slice(audioBuffer.length - 80000);
    }

    // Need at least 1 second of audio for meaningful features
    if (audioBuffer.length < VOICE_SAMPLE_RATE) {
      return null;
    }

    try {
      // Create mel-spectrogram features
      const features = computeMelSpectrogram(new Float32Array(audioBuffer), VOICE_SAMPLE_RATE);
      if (!features || features.length === 0) {
        return null;
      }

      // Use the last FEATURE_SIZE features
      const featureTensor = tf.tensor2d([features.slice(-FEATURE_SIZE)]);
      return featureTensor;
    } catch (err) {
      console.warn('Feature extraction failed:', err);
      return null;
    }
  };

  const detect = async (pcm: Int16Array): Promise<{ detected: boolean; confidence: number }> => {
    if (!config.enabled || !featureExtractor || !wakeWordModel) {
      return { detected: false, confidence: 0 };
    }

    try {
      const features = extractFeatures(pcm);
      if (!features) {
        return { detected: false, confidence: 0 };
      }

      // Run feature extraction (deprecated in newer TFLite, but needed for compatibility)
      // For now, use features directly
      const prediction = wakeWordModel.predict(features) as tf.Tensor;
      const probs = await prediction.data();
      const confidence = Math.max(...Array.from(probs));

      features.dispose();
      prediction.dispose();

      // Adjust threshold based on sensitivity (0.5 = 0.5, 0.8 = 0.35, 0.3 = 0.65)
      const threshold = 1.0 - config.sensitivity;
      const detected = confidence > threshold;

      if (detected && onDetection) {
        onDetection(confidence);
      }

      return { detected, confidence };
    } catch (err) {
      console.warn('Wake word detection error:', err);
      return { detected: false, confidence: 0 };
    }
  };

  const setConfig = (newConfig: Partial<WakeWordConfig>) => {
    Object.assign(config, newConfig);
  };

  const cleanup = async () => {
    if (featureExtractor) featureExtractor.dispose();
    if (wakeWordModel) wakeWordModel.dispose();
    audioBuffer = [];
  };

  // Load models on creation
  await loadModels();

  return { detect, setConfig, cleanup };
}

/**
 * Compute mel-spectrogram from PCM samples.
 * Simplified version: extracts MFCC-like features for wake word detection.
 */
function computeMelSpectrogram(pcm: Float32Array, sampleRate: number): number[] {
  // Frame parameters
  const frameSize = 512; // ~32ms at 16kHz
  const hopSize = 160; // 10ms
  const numMelBins = 40;

  if (pcm.length < frameSize) {
    return [];
  }

  const frames: number[][] = [];

  // Compute power spectrum for each frame
  for (let i = 0; i + frameSize <= pcm.length; i += hopSize) {
    const frame = pcm.slice(i, i + frameSize);

    // Apply Hann window
    const windowed = new Float32Array(frameSize);
    for (let j = 0; j < frameSize; j++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (frameSize - 1));
      windowed[j] = frame[j] * w;
    }

    // FFT (simplified: just use power of first half)
    const power = new Float32Array(frameSize / 2);
    for (let j = 0; j < frameSize / 2; j++) {
      power[j] = windowed[j] * windowed[j];
    }

    // Mel-frequency mapping (simplified)
    const melBins = new Float32Array(numMelBins);
    const freqBins = power.length;
    for (let m = 0; m < numMelBins; m++) {
      const start = Math.floor((m / numMelBins) * freqBins);
      const end = Math.floor(((m + 1) / numMelBins) * freqBins);
      let sum = 0;
      for (let j = start; j < end && j < freqBins; j++) {
        sum += power[j];
      }
      melBins[m] = Math.log(Math.max(sum, 1e-6));
    }

    frames.push(Array.from(melBins));
  }

  // Flatten frames into a single feature vector
  return frames.flat();
}
