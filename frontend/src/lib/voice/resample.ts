/**
 * Linear resample for microphone PCM (speech). Output length ≈ input * toRate / fromRate.
 */

export function resampleFloat32Linear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (input.length === 0 || fromRate <= 0 || toRate <= 0 || fromRate === toRate) {
    return fromRate === toRate ? input : new Float32Array(0);
  }
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const f = srcPos - i0;
    out[i] = input[i0] + f * (input[i1] - input[i0]);
  }
  return out;
}
