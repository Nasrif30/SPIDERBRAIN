import type { Observation, Signal } from '@spiderbrain/shared';
export interface EyeContext { event: Observation; history: readonly Observation[] }
export function signal(eye: Signal['eye'], name: string, intensity: number, confidence: number, reason: string, now: number, decay = 0.035): Signal {
  return { eye, signal: name, intensity, confidence, reason, decay, timestamp: now };
}
