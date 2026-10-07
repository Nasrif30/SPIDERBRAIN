import { clamp } from '@spiderbrain/shared';
import { decay } from './decay.js';
/** Ordinary browsing adds no threat energy. Evidence contributes with saturation. */
export function energy(previous: number, impulse: number, elapsedMs: number): number {
  return clamp(decay(previous, elapsedMs) + impulse * 0.35, 0, 30);
}
