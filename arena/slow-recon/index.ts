import type { ArenaScenario } from '../types.js';
const routes = ['/admin', '/backup', '/config.old', '/admin-old', '/.env', '/.git/'];
export const slowRecon: ArenaScenario = { name: 'slow-recon', expected: 'probing', steps: [
  { path: '/', afterMs: 0 }, { path: '/robots.txt', afterMs: 5000 },
  ...Array.from({ length: 24 }, (_, i) => ({ path: routes[i % routes.length]!, afterMs: 8000 }))
] };
