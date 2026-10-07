import { clamp } from '@spiderbrain/shared';
import { signal, type EyeContext } from './context.js';
export function errorEye({ event, history }: EyeContext) {
  const window = history.filter((item) => event.timestamp - item.timestamp <= 30_000);
  // 5xx errors belong to the application's health, not automatically the visitor's intent.
  const failures = window.filter((item) => [401, 403, 404].includes(item.status)).length;
  if (window.length >= 5 && failures >= 5 && failures / window.length >= 0.6) {
    return [signal('error', 'repeated access errors', clamp(failures / 3, 1, 4), 0.75,
      `${failures} of ${window.length} recent responses were 401, 403, or 404`, event.timestamp)];
  }
  return [];
}
