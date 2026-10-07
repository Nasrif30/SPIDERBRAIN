import type { ArenaScenario, ArenaStep } from '../types.js';
const cycle = (paths: string[], length: number, delay: number): ArenaStep[] => Array.from({ length }, (_, i) => ({ path: paths[i % paths.length]!, afterMs: delay }));
/** Labels describe the script's intended behavior, before observing detector output. */
export const normalTraces: ArenaScenario[] = [0, 1].flatMap((variant) => {
  const delay = variant ? 1800 : 3000;
  const build = (family: string, steps: ArenaStep[]): ArenaScenario => ({ name: family + '-' + (variant + 1), family, expected: 'ordinary', steps });
  return [
    build('casual-browser', cycle(['/', '/products', '/about', '/products', '/'], 24, delay)),
    build('authenticated-user', [{ path: '/', afterMs: 0 }, { path: '/login', afterMs: delay },
      { path: '/auth/demo', afterMs: delay, identity: variant ? 'sample-b' : 'sample-a', outcome: 'success' },
      ...cycle(['/account', '/products', '/account', '/about'], 24, delay), { path: '/auth/demo', afterMs: delay, identity: 'sample-a', outcome: 'logout' }]),
    build('fast-user', cycle(['/', '/products', '/about', '/login', '/account'], 80, variant ? 15 : 40)),
    build('broken-links', Array.from({ length: 30 }, (_, i) => ({ path: i === 7 || i === 21 ? '/missing-link' : ['/', '/products', '/about'][i % 3]!, afterMs: delay }))),
    build('api-heavy-user', cycle(['/api/health', '/api/health', '/products', '/api/health'], 80, variant ? 25 : 100)),
  ];
});
