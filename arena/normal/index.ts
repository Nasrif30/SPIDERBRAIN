import type { ArenaScenario } from '../types.js';
export const normal: ArenaScenario = { name: 'normal', expected: 'ordinary', steps: [
  { path: '/', afterMs: 0 }, { path: '/products', afterMs: 2500 }, { path: '/login', afterMs: 2000 },
  { path: '/auth/demo', afterMs: 1200, outcome: 'failure', identity: 'sample-a' },
  { path: '/auth/demo', afterMs: 4000, outcome: 'success', identity: 'sample-a' },
  { path: '/account', afterMs: 1500 }, { path: '/about', afterMs: 3000 }, { path: '/missing', afterMs: 4000 },
  ...Array.from({ length: 30 }, (_, i) => ({ path: ['/', '/products', '/about', '/account', '/api/health'][i % 5]!, afterMs: 2500 }))
] };
