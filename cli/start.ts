import { spiderbrain } from '../sdk/index.js';

/** Public startup creates observation services only; no target website listener. */
export async function startDashboard(options: { dashboardPort?: number; memory?: false | string } = {}) {
  const guardian = spiderbrain({
    dashboard: true,
    dashboardPort: options.dashboardPort ?? 5173,
    memory: options.memory === false ? false : { path: options.memory ?? '.spiderbrain/web-memory.sqlite' },
  });
  const urls = await guardian.ready;
  if (!urls.dashboardUrl) {
    await guardian.close();
    throw new Error('Dashboard could not start');
  }
  return { guardian, ...urls, close: () => guardian.close() };
}
