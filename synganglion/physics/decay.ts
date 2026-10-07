export function decay(energy: number, elapsedMs: number, rate = 0.025): number {
  return Math.max(0, energy) * Math.exp(-Math.max(0, elapsedMs) / 1000 * rate);
}
