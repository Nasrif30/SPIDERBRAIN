import type { ArenaScenario, ArenaStep } from '../types.js';
export const honeyTraces: ArenaScenario[] = [0, 1].flatMap((variant) => {
  const entry: ArenaStep[] = [{ path: '/', afterMs: 0 }, { path: '/robots.txt', afterMs: 1000 }, { path: '/admin', afterMs: 1000 }, { path: '/.env', afterMs: 1000 }];
  const build = (family: string, expected: ArenaScenario['expected'], steps: ArenaStep[]): ArenaScenario => ({ name: family + '-' + (variant + 1), family, expected, canaries: true, steps });
  return [
    // Accidental discovery is an explicit negative control, not relabeled after scoring.
    build('canary-discovery', variant ? 'probing' : 'ordinary', variant ? [...entry, ...Array.from({ length: 12 }, (_, i) => ({ path: ['/admin-old', '/internal-dev', '/backup-console'][i % 3]!, afterMs: 300 }))]
      : [{ path: '/', afterMs: 0 }, { path: '/products', afterMs: 2500 }, { path: '/admin-old', afterMs: 3000 }, { path: '/about', afterMs: 5000 }]),
    // File-only interest is probing by script intent, but still only one independent Eye.
    build('honey-file-read', 'probing', variant ? [...entry, ...Array.from({ length: 14 }, (_, i) => ({ path: ['/.env.backup', '/config.old', '/backup.sql'][i % 3]!, afterMs: 250 }))]
      : Array.from({ length: 8 }, (_, i) => ({ path: ['/.env.backup', '/config.old'][i % 2]!, afterMs: 6000 }))),
    build('repeated-honey-interest', 'probing', [...entry, ...Array.from({ length: 20 }, (_, i): ArenaStep => i % 3 === 2
      ? { path: '/account', canaryReference: '/.env.backup', afterMs: variant ? 1200 : 500 }
      : { path: i % 2 ? '/admin-old' : '/.env.backup', afterMs: variant ? 1200 : 500 })]),
  ];
});
