import { clamp } from '@spiderbrain/shared';
import { signal, type EyeContext } from './context.js';
export function velocityEye({ event, history }: EyeContext) {
  const recent = history.filter((item) => event.timestamp - item.timestamp <= 1000).length;
  const baseline = history.filter((item) => {
    const age = event.timestamp - item.timestamp;
    return age > 1000 && age <= 11_000;
  }).length / 10;
  if (recent >= 8 && recent > Math.max(1, baseline) * 4) {
    return [signal('velocity', 'velocity impulse', clamp((recent - 4) / 3, 1, 5), 0.8,
      `${recent} requests in one second; abrupt acceleration above the preceding baseline`, event.timestamp)];
  }
  const tenSeconds = history.filter((item) => event.timestamp - item.timestamp <= 10_000).length;
  if (tenSeconds >= 35) return [signal('velocity', 'sustained velocity', clamp(tenSeconds / 20, 1, 4), 0.65,
    `${tenSeconds} requests in ten seconds; sustained request pressure`, event.timestamp)];
  return [];
}
