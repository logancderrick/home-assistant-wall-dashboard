/**
 * Simple level meter for 16-bit PCM chunks (voice capture).
 */

export function pcmRmsNormalized(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 32768;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / pcm.length);
}
