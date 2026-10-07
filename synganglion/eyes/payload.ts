import type { PayloadPattern, Signal } from '@spiderbrain/shared';
import { signal, type EyeContext } from './context.js';
export const payloadReasons: Record<PayloadPattern, string> = {
  sql_like: 'SQL-like metacharacter or keyword sequence detected; submitted values discarded',
  script_like: 'Script-like input structure detected; submitted values discarded',
  path_traversal: 'Path traversal sequence detected; submitted values discarded',
  shell_like: 'Shell-like command separator structure detected; submitted values discarded',
};
/** One capped Eye; no independent claim of execution, vulnerability or hostility. */
export function PayloadAnomalyEye({ event }: EyeContext): Signal[] {
  return (event.payload ?? []).map(pattern => signal('payload', 'PAYLOAD_' + pattern.toUpperCase(), 1.8, .68, payloadReasons[pattern], event.timestamp, .045));
}
