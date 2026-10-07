import type { ArenaScenario, ArenaStep } from '../types.js';
const cycle = (paths: string[], length: number, delay: number): ArenaStep[] => Array.from({ length }, (_, i) => ({ path: paths[i % paths.length]!, afterMs: delay }));
export const suspiciousTraces: ArenaScenario[] = [0, 1].flatMap((variant) => {
  const build = (family: string, steps: ArenaStep[]): ArenaScenario => ({ name: family + '-' + (variant + 1), family, expected: 'probing', steps });
  const entry: ArenaStep[] = [{ path: '/', afterMs: 0 }, { path: '/robots.txt', afterMs: 1200 }];
  return [
    build('noisy-enumeration', [...entry, ...cycle(['/admin', '/backup', '/.env', '/config.old', '/.git/', '/internal'], 60, variant ? 35 : 10)]),
    build('slow-recon', [...entry, ...cycle(['/admin', '/backup', '/.env', '/config.old', '/.git/'], 30, variant ? 10000 : 8000)]),
    build('config-hunting', [...entry, ...cycle(['/.env', '/config', '/config.old', '/backup', '/.git/'], 36, variant ? 1700 : 250)]),
    build('admin-discovery', [...entry, ...cycle(['/admin', '/admin-old', '/admin.php', '/admin/login', '/wp-admin'], 36, variant ? 1500 : 100)]),
    build('auth-failure-burst', [{ path: '/login', afterMs: 0 }, ...Array.from({ length: 24 }, (_, i): ArenaStep => ({ path: '/auth/demo', afterMs: variant ? 600 : 80, outcome: 'failure', identity: (['sample-a', 'sample-b', 'sample-c'] as const)[i % 3]! }))]),
    build('route-shuffling', [...entry, ...cycle(['/products', '/admin', '/about', '/backup', '/login', '/.env', '/account', '/config.old'], 56, variant ? 400 : 45)]),
    build('low-and-slow', [...entry, ...cycle(['/admin', '/about', '/.env', '/products', '/backup', '/'], 24, variant ? 45000 : 30000)]),
  ];
});
