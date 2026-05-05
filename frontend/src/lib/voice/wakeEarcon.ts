/**
 * Very short acknowledgement tone when the on-device wake model fires.
 * Uses a separate AudioContext from mic capture so it does not interfere with the graph.
 */

let sharedCtx: AudioContext | null = null;

export function playWakeEarcon(): void {
  try {
    const AC =
      typeof globalThis.AudioContext !== "undefined"
        ? globalThis.AudioContext
        : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;

    if (!sharedCtx || sharedCtx.state === "closed") {
      sharedCtx = new AC();
    }
    if (sharedCtx.state === "suspended") {
      void sharedCtx.resume();
    }

    const t0 = sharedCtx.currentTime;
    const osc = sharedCtx.createOscillator();
    const gain = sharedCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.exponentialRampToValueAtTime(660, t0 + 0.11);
    osc.connect(gain);
    gain.connect(sharedCtx.destination);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.11, t0 + 0.018);
    gain.gain.linearRampToValueAtTime(0, t0 + 0.14);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  } catch {
    // Ignore missing Web Audio (tests, locked autoplay, etc.)
  }
}
