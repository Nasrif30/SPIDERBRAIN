import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Sensor, startTelemetry } from '@spiderbrain/sensor';
import { siteRoutes } from '../shared/catalog.js';
import { LocalCollector } from './collector.js';
import { DemoLog } from './log.js';
import { site } from './site.js';
import { dashboard } from './dashboard.js';
import { listenLocal } from '@spiderbrain/sensor';
const directory = fileURLToPath(new URL('../../', import.meta.url));
const closeServer = async (server: Server) => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); };
export async function startIntegrated(options: { sitePort?: number; dashboardPort?: number; memory?: false | string; logs?: boolean; directory?: string } = {}) {
  const runtimeDirectory = options.directory ?? directory;
  for (const value of [options.sitePort ?? 4173, options.dashboardPort ?? 5173]) if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('Invalid local port');
  const log = options.logs === false ? undefined : new DemoLog(join(runtimeDirectory, 'logs'));
  const sensor = new Sensor({ publicRoutes: siteRoutes, memory: options.memory === false ? false : { path: options.memory ?? join(runtimeDirectory, 'logs', 'web-memory.sqlite') } });
  const collector = new LocalCollector(sensor, log);
  let sitePort = options.sitePort ?? 4173, dashboardPort = options.dashboardPort ?? 5173;
  let internal: Awaited<ReturnType<typeof startTelemetry>> | undefined;
  const remoteDemo = process.env['SPIDERBRAIN_REMOTE_DEMO'] === '1';
  const website = createServer(site(collector, runtimeDirectory, () => `127.0.0.1:${sitePort}`, () => `http://127.0.0.1:${dashboardPort}/web`, remoteDemo));
  let web: ReturnType<typeof dashboard> | undefined;
  try {
    sitePort = await listenLocal(website, sitePort);
    // The website is already available if the optional telemetry listener fails.
    try {
      internal = await startTelemetry(sensor, { port: 0 });
      web = dashboard(sensor, collector, internal.url, () => `http://127.0.0.1:${sitePort}`);
      dashboardPort = await listenLocal(web.server, dashboardPort); web.setPort(dashboardPort);
    } catch { console.error('Integrated dashboard unavailable; demo website continues.'); await internal?.close(); internal = undefined; }
    return { sensor, collector, siteUrl: `http://127.0.0.1:${sitePort}`, dashboardUrl: internal ? `http://127.0.0.1:${dashboardPort}/web` : null,
      internalTelemetryUrl: internal?.url ?? null,
      close: async () => { if (web?.server.listening) await closeServer(web.server); await internal?.close(); await closeServer(website); sensor.close(); await log?.close(); } };
  } catch (error) { if (website.listening) await closeServer(website); await internal?.close(); sensor.close(); await log?.close(); throw error; }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/server/main.js')) {
  try {
    const app = await startIntegrated();
    console.log(`SPIDERBRAIN LABS\nWebsite: ${app.siteUrl}\nLive Web: ${app.dashboardUrl ?? 'unavailable'}\nCollector: in-process, validated metadata only\nDemo access: ${process.env['SPIDERBRAIN_REMOTE_DEMO'] === '1' ? 'remote demo enabled' : 'local only'}\nDashboard local only. All listeners loopback. Ctrl+C stops both listeners.`);
    const stop = () => { void app.close().then(() => process.exit(0)); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { console.error('Local demo could not start. Check that ports 4173 and 5173 are available.'); process.exitCode = 1; }
}
