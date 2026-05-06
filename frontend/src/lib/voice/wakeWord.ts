/**
 * On-device wake word using the same TFLite models + inference stack as
 * jxlarrea/voice-satellite-card-integration (vendored under ./upstream-wake).
 */

export const VOICE_WAKE_WORD_MODEL_IDS = [
  "ok_nabu",
  "hey_jarvis",
  "hey_mycroft",
  "alexa",
  "hey_home_assistant",
  "hey_luna",
  "okay_computer",
  "stop",
] as const;

export type VoiceWakeWordModelId = (typeof VOICE_WAKE_WORD_MODEL_IDS)[number];
export const VOICE_WAKE_WORD_NONE = "__none__";

export const VOICE_WAKE_WORD_MODEL_LABELS: Record<VoiceWakeWordModelId, string> = {
  ok_nabu: "Okay Nabu",
  hey_jarvis: "Hey Jarvis",
  hey_mycroft: "Hey Mycroft",
  alexa: "Alexa",
  hey_home_assistant: "Hey Home Assistant",
  hey_luna: "Hey Luna",
  okay_computer: "Okay Computer",
  stop: "Stop",
};

const CHUNK_SAMPLES = 1280;

export interface WakeWordConfig {
  sensitivity: number;
  enabled: boolean;
}

export interface WakeWordDetector {
  detect: (pcm: Int16Array) => Promise<{ detected: boolean; confidence: number }>;
  setConfig: (config: Partial<WakeWordConfig>) => void;
  /** Drop queued PCM and reset microWakeWord internal buffers (avoids phantom wake after a run). */
  flushPending: () => void;
  cleanup: () => Promise<void>;
}

const noopLog = { log: () => {} };

function sensitivityLabelFrom01(v: number): string {
  if (v < 0.34) return "Slightly sensitive";
  if (v > 0.66) return "Very sensitive";
  return "Moderately sensitive";
}

function isVoiceWakeWordModelId(id: string): id is VoiceWakeWordModelId {
  return (VOICE_WAKE_WORD_MODEL_IDS as readonly string[]).includes(id);
}

function setModelsBaseUrl(): void {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  (globalThis as unknown as { __VS_MODELS_BASE?: string }).__VS_MODELS_BASE = `${origin}${base}/voice-models`;
}

export interface CreateWakeWordDetectorOptions {
  modelId: VoiceWakeWordModelId;
  sensitivity01: number;
  onDetection?: (confidence: number) => void;
}

/**
 * Loads the selected keyword model (same assets as the Voice Satellite integration)
 * and runs microWakeWord inference in the browser.
 */
export async function createWakeWordDetector(
  opts: CreateWakeWordDetectorOptions,
): Promise<WakeWordDetector> {
  setModelsBaseUrl();

  const [{ loadTFLite, createIsolatedModelRunner, getMicroModelParams, releaseMicroModels }, modInf] =
    await Promise.all([
      import("./upstream-wake/micro-models.js"),
      import("./upstream-wake/micro-inference.js"),
    ]);

  const { MicroWakeWordInference } = modInf as unknown as {
    MicroWakeWordInference: {
      create: (
        configs: unknown[],
        log: { log: (c: string, m: string) => void },
        sensitivityLabel: string,
        energyGate: boolean,
      ) => Promise<{ processChunk: (s: Float32Array) => Promise<unknown>; reset: () => void; destroy: () => void }>;
    };
  };

  await loadTFLite();
  const modelId = opts.modelId;
  const runner = await createIsolatedModelRunner(null, modelId);
  const p = getMicroModelParams(modelId);
  const sensitivityLabel = sensitivityLabelFrom01(opts.sensitivity01);

  const inference = await MicroWakeWordInference.create(
    [
      {
        runner,
        name: modelId,
        cutoff: p.cutoff,
        slidingWindow: p.slidingWindow,
        stepSize: p.stepSize,
        inputScale: p.inputScale,
        inputZeroPoint: p.inputZeroPoint,
      },
    ],
    noopLog,
    sensitivityLabel,
    true,
  );

  let config: WakeWordConfig = { sensitivity: opts.sensitivity01, enabled: true };
  let floatPending = new Float32Array(0);

  function appendPcmAsFloat(pcm: Int16Array): void {
    const add = new Float32Array(pcm.length);
    const scale = 1 / 32768;
    for (let i = 0; i < pcm.length; i++) {
      add[i] = pcm[i] * scale;
    }
    const next = new Float32Array(floatPending.length + add.length);
    next.set(floatPending);
    next.set(add, floatPending.length);
    floatPending = next;
  }

  const flushPending = () => {
    floatPending = new Float32Array(0);
    try {
      inference.reset();
    } catch {
      /* ignore */
    }
  };

  const detect = async (pcm: Int16Array): Promise<{ detected: boolean; confidence: number }> => {
    if (!config.enabled) return { detected: false, confidence: 0 };
    appendPcmAsFloat(pcm);
    while (floatPending.length >= CHUNK_SAMPLES) {
      const chunk = floatPending.slice(0, CHUNK_SAMPLES);
      floatPending = floatPending.slice(CHUNK_SAMPLES);
      const result = (await inference.processChunk(chunk)) as {
        detected: boolean;
        score?: number;
      };
      if (result.detected) {
        const conf = typeof result.score === "number" ? result.score : 0;
        opts.onDetection?.(conf);
        return { detected: true, confidence: conf };
      }
    }
    return { detected: false, confidence: 0 };
  };

  const setConfig = (newConfig: Partial<WakeWordConfig>) => {
    Object.assign(config, newConfig);
  };

  const cleanup = async () => {
    try {
      inference.destroy();
    } catch {
      // ignore
    }
    floatPending = new Float32Array(0);
    await releaseMicroModels();
  };

  return { detect, setConfig, flushPending, cleanup };
}

export function parseVoiceWakeWordModelId(raw: string | undefined | null): VoiceWakeWordModelId {
  const id = String(raw ?? "").trim();
  if (id && isVoiceWakeWordModelId(id)) return id;
  return "hey_jarvis";
}

export function parseOptionalVoiceWakeWordModelId(
  raw: string | undefined | null,
): VoiceWakeWordModelId | null {
  const id = String(raw ?? "").trim();
  if (!id || id === VOICE_WAKE_WORD_NONE) return null;
  if (isVoiceWakeWordModelId(id)) return id;
  return null;
}
