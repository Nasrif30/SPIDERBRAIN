import { clamp, type Observation, type Signal } from '@spiderbrain/shared';
import { family } from '../physics/resonance.js';
import { signal } from './context.js';
export interface MovementContext { event: Observation; history: readonly Observation[]; rarity: { route: number; transition: number } }
/** Direction requires a navigation anchor and failed traversal, never rarity alone. */
export function SessionMovementEye({ event, history, rarity }: MovementContext): Signal[] {
  if (event.status < 400) return [];
  const recent = history.filter((item) => event.timestamp - item.timestamp <= 120_000);
  const anchor = recent.findLastIndex((item) => ['/', '/about', '/products', '/robots.txt'].includes(item.route));
  if (anchor < 0) return [];
  const navigation = recent.slice(anchor);
  const sensitive = navigation.filter((item) => ['administration', 'configuration'].includes(family(item.route) ?? '') && [401, 403, 404].includes(item.status));
  const distinct = new Set(sensitive.map((item) => item.route));
  const directions = new Set(sensitive.map((item) => family(item.route)));
  const signals: Signal[] = [];
  if (sensitive.length >= 4 && distinct.size >= 3 && sensitive.length / navigation.length >= 0.5) {
    signals.push({ ...signal('movement', 'sensitive-route concentration', clamp(sensitive.length / 3, 1, 3), 0.7,
      `${sensitive.length} unsuccessful sensitive-route visits after a navigation entry, across ${distinct.size} routes`, event.timestamp), decay: 0.012 });
  }
  if (sensitive.length >= 3 && directions.size >= 2 && rarity.transition >= 0.25) {
    signals.push({ ...signal('movement', 'unusual navigation direction', 1.3 + rarity.route * 0.4, 0.6,
      'Navigation moves from an entry route toward administrative and configuration resources through an uncommon transition', event.timestamp), decay: 0.012 });
  }
  const rapid = navigation.filter((item) => event.timestamp - item.timestamp <= 5000);
  const changes = rapid.slice(1).filter((item, i) => item.route !== rapid[i]?.route).length;
  if (sensitive.length >= 3 && changes >= 6) signals.push(signal('movement', 'rapid route changes', 1.5, 0.65,
    `${changes} route changes in five seconds alongside unsuccessful sensitive-route traversal`, event.timestamp));
  const revisits = sensitive.filter((item) => item.route === event.route).length;
  if (revisits >= 3 && distinct.size >= 3) signals.push(signal('movement', 'repeated sensitive revisits', 1.4, 0.6,
    `${revisits} unsuccessful revisits to the current route amid exploration of related resources`, event.timestamp));
  return signals;
}
