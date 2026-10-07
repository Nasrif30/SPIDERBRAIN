import { clamp } from '@spiderbrain/shared';
/** V = intensity × rarity × velocity × context; bounded to avoid runaway risk. */
export function vibration(intensity: number, rarity: number, velocity: number, context: number): number {
  return clamp(intensity * clamp(rarity, 0.5, 1.5) * clamp(velocity, 1, 2) * clamp(context, 1, 1.4), 0, 12);
}
