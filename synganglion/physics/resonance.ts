import { clamp, type Eye, type Observation, type Signal } from '@spiderbrain/shared';
import { decay } from './decay.js';
import type { TemporalPoint } from '../memory/temporal.js';
export function family(route: string): string | null {
  if (/(^|\/)(admin[^/]*|wp-admin|wp-login\.php|dev-console|internal)(\/|$)/.test(route)) return 'administration';
  if (/(^|\/)(\.env[^/]*|\.git|config[^/]*|backup[^/]*)(\/|$)/.test(route)) return 'configuration';
  if (/(^|\/)(login|auth)(\/|$)/.test(route)) return 'authentication';
  return null;
}
export function resonanceV2(signals: readonly Signal[], now: number, windowMs = 30_000): { value: number; eyes: Eye[] } {
  const groups = new Map<Eye, number>();
  for (const signal of signals) {
    if (now - signal.timestamp > windowMs || signal.timestamp > now) continue;
    groups.set(signal.eye, Math.min(3, (groups.get(signal.eye) ?? 0) + decay(signal.intensity * signal.confidence, now - signal.timestamp, signal.decay)));
  }
  const eyes = [...groups].filter(([, value]) => value >= 0.5).map(([eye]) => eye).sort();
  if (eyes.length < 2) return { value: 0, eyes };
  const strength = eyes.reduce((sum, eye) => sum + (groups.get(eye) ?? 0), 0) / (eyes.length * 3);
  return { value: clamp((eyes.length - 1) * 0.7 + strength * 0.8, 0, eyes.length >= 3 ? 4 : 1.5), eyes };
}
export function resonance(history: readonly Observation[], now: number): number {
  const groups = new Map<string, Set<string>>();
  for (const event of history) {
    if (now - event.timestamp > 30_000 || event.status < 400) continue;
    const group = family(event.route);
    if (!group) continue;
    const routes = groups.get(group) ?? new Set<string>();
    routes.add(event.route);
    groups.set(group, routes);
  }
  return Math.min(3, Math.max(0, ...Array.from(groups.values(), (routes) => routes.size - 1)));
}
/** Category transitions support existing independent Eyes, never manufacture one.
 * Reordering within sensitive categories has the same evidence quality. */
export function resonanceV3(points: readonly TemporalPoint[], signals: readonly Signal[], now: number, windowMs = 120_000) {
  const recent = points.filter(point => now - point.timestamp <= 600_000 && point.failed);
  const groups = new Map<Eye, number>();
  for (const item of signals) if (now - item.timestamp <= windowMs) groups.set(item.eye, Math.min(3, (groups.get(item.eye) ?? 0) + decay(item.intensity * item.confidence, now - item.timestamp, item.decay)));
  const eyes = [...groups].filter(([, strength]) => strength >= .8).map(([eye]) => eye).sort();
  const changes = recent.slice(1).filter((point, i) => point.category !== recent[i]!.category).length;
  if (recent.length < 5 || changes < 2 || eyes.length < 2) return { value: 0, eyes, changes };
  const weight = recent.reduce((sum, point) => sum + decay(1, now - point.timestamp, .003), 0);
  return { value: Math.min(eyes.length >= 3 ? 3 : 1.5, changes * .2 + weight * .1), eyes, changes };
}
