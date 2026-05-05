import { describe, it, expect } from "vitest";
import { resampleFloat32Linear } from "./resample";

describe("resampleFloat32Linear", () => {
  it("returns same reference when rates match", () => {
    const a = new Float32Array([0, 1, 0, -1]);
    const b = resampleFloat32Linear(a, 16_000, 16_000);
    expect(b).toBe(a);
  });

  it("downsamples 48k -> 16k to ~1/3 length", () => {
    const inArr = new Float32Array(480);
    for (let i = 0; i < inArr.length; i++) inArr[i] = Math.sin(i / 10);
    const out = resampleFloat32Linear(inArr, 48_000, 16_000);
    expect(out.length).toBe(160);
  });
});
