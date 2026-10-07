import type { Signal } from '@spiderbrain/shared';
import { signal, type EyeContext } from './context.js';
/** Describes synthetic interactions; it supplies one capped Eye, never attribution. */
export function HoneyEye({ event, history }: EyeContext): Signal[] {
  if (!event.honey?.length) return [];
  const signals: Signal[] = [];
  for (const kind of ['route_touch', 'file_touch', 'token_reference'] as const) {
    if (!event.honey.some((item) => item.interaction === kind)) continue;
    const name = { route_touch: 'HONEY_ROUTE_TOUCH', file_touch: 'HONEY_FILE_TOUCH', token_reference: 'HONEY_TOKEN_REFERENCE' }[kind];
    const reason = { route_touch: 'Explicitly synthetic archived route accessed', file_touch: 'Explicitly synthetic configuration or backup resource accessed', token_reference: 'An enabled synthetic canary identifier was referenced; no credential or identity attribution' }[kind];
    signals.push(signal('honey', name, kind === 'route_touch' ? 3 : 4, 0.85, reason, event.timestamp, 0.025));
  }
  const recent = history.filter((item) => item.honey?.length && event.timestamp - item.timestamp <= 120_000);
  if (recent.length >= 3) signals.push(signal('honey', 'HONEY_REPEAT_INTEREST', 4, 0.88,
    `${recent.length} requests interacted with enabled synthetic resources in two minutes; observed interest only`, event.timestamp, 0.025));
  return signals;
}
