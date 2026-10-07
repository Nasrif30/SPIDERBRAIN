import { clamp, type Signal } from '@spiderbrain/shared';
import { signal, type EyeContext } from './context.js';
export function AuthenticationEye({ event, history }: EyeContext): Signal[] {
  if (!event.authentication) return [];
  const recent = history.filter((item) => item.authentication && event.timestamp - item.timestamp <= 60_000);
  const failures = recent.filter((item) => item.authentication?.type === 'login_failure');
  const identities = new Set(failures.map((item) => item.authentication?.identityId).filter(Boolean));
  const signals: Signal[] = [];
  if (failures.length >= 4) signals.push(signal('authentication', 'AUTH_RESONANCE', clamp(failures.length * 0.6, 1, 4.2), 0.81,
    `${failures.length} failed authentication events across ${identities.size} anonymous identities; observed outcomes only`, event.timestamp));
  if (identities.size >= 3 && failures.length >= 5) signals.push(signal('authentication', 'anonymous identity switching', 2.4, 0.7,
    'Repeated failures involve at least three anonymous identity references', event.timestamp));
  const short = recent.filter((item) => event.timestamp - item.timestamp <= 30_000);
  const successes = short.filter((item) => item.authentication?.type === 'login_success');
  if (successes.length >= 4 && new Set(successes.map((item) => item.authentication?.identityId).filter(Boolean)).size >= 3) {
    signals.push(signal('authentication', 'rapid account switching', 1.8, 0.55, 'At least four successful transitions across three anonymous accounts in thirty seconds', event.timestamp));
  }
  if (short.filter((item) => item.authentication?.type === 'protected_route_denial').length >= 3) {
    signals.push(signal('authentication', 'protected-route denials', 2, 0.7, 'At least three application-reported protected-route denials in thirty seconds', event.timestamp));
  }
  const states = short.map((item) => item.authentication?.authenticated).filter((value): value is boolean => typeof value === 'boolean');
  const changes = states.slice(1).filter((state, i) => state !== states[i]).length;
  if (changes >= 4) signals.push(signal('authentication', 'authentication state transitions', 1.5, 0.55,
    `${changes} reported authentication-state changes in thirty seconds`, event.timestamp));
  return signals;
}
