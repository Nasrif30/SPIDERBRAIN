import type { ArenaScenario } from '../types.js';
const routes = ['/admin', '/admin-old', '/admin.php', '/admin/login', '/backup', '/config.old', '/.env', '/.git/'];
export const routeRecon: ArenaScenario = { name: 'route-recon', expected: 'probing', steps: [
  { path: '/', afterMs: 0 }, { path: '/robots.txt', afterMs: 400 },
  ...Array.from({ length: 48 }, (_, i) => ({ path: routes[i % routes.length]!, afterMs: 25 }))
] };
