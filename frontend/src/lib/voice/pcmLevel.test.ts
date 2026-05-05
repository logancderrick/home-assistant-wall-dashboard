import { describe, it, expect } from "vitest";
import { pcmRmsNormalized } from "./pcmLevel";

describe("pcmRmsNormalized", () => {
  it("returns 0 for empty buffer", () => {
    expect(pcmRmsNormalized(new Int16Array(0))).toBe(0);
  });

  it("is near 0 for silence", () => {
    expect(pcmRmsNormalized(new Int16Array(512))).toBeLessThan(0.001);
  });

  it("rises with non-trivial tone", () => {
    const pcm = new Int16Array(512);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = Math.round(8000 * Math.sin((i / 512) * Math.PI * 2 * 8));
    }
    const r = pcmRmsNormalized(pcm);
    expect(r).toBeGreaterThan(0.15);
    expect(r).toBeLessThanOrEqual(1);
  });
});
