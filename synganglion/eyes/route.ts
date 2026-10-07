import { clamp } from '@spiderbrain/shared';
import { family } from '../physics/resonance.js';
import { signal, type EyeContext } from './context.js';
export function routeEye({ event, history }: EyeContext) {
  const signals = [];
  if (event.status >= 400 && ['administration', 'configuration'].includes(family(event.route) ?? '')) {
    signals.push(signal('route', 'sensitive route probing', 1.8, 0.6,
      'Unsuccessful request near an administrative or configuration route', event.timestamp));
  }
  const window = history.filter((item) => event.timestamp - item.timestamp <= 30_000);
  const missingRoutes = new Set(window.filter((item) => item.status === 404).map((item) => item.route)).size;
  if (missingRoutes >= 4) signals.push(signal('route', 'route enumeration', clamp(missingRoutes / 2, 1, 4), 0.8,
    `${missingRoutes} distinct sanitized missing routes within thirty seconds`, event.timestamp));
  return signals;
}
