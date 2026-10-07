import { createServer, type ServerResponse } from 'node:http';
import type { Sensor } from './index.js';
import type { LiveWebSnapshot } from '@spiderbrain/shared';
import { page, css, script } from '@spiderbrain/live-web';
export interface TelemetryOptions { port?: number }
/** Local, read-only telemetry. Host and Origin checks reject browser rebinding. */
export async function startTelemetry(sensor: Sensor, options: TelemetryOptions = {}) {
  const clients = new Set<ServerResponse>();
  const webClients = new Set<ServerResponse>();
  let ticker: NodeJS.Timeout | undefined;
  let pending: NodeJS.Timeout | undefined;
  let pulses: LiveWebSnapshot['pulses'] = [];
  let epoch = sensor.observationEpoch;
  let port = options.port ?? 4318;
  const send = (res: ServerResponse, value: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  const frame = (recipients: Set<ServerResponse>, event: string, value: unknown) => {
    const data = `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
    for (const client of recipients) {
      if (client.destroyed || client.writableLength > 32_768) { client.destroy(); recipients.delete(client); }
      else client.write(data);
    }
  };
  const publishWeb = () => {
    if (epoch !== sensor.observationEpoch) { epoch = sensor.observationEpoch; pulses = []; }
    if (pending) { clearTimeout(pending); pending = undefined; }
    if (webClients.size) frame(webClients, 'web', sensor.liveWeb(pulses));
    pulses = [];
  };
  const startTicker = () => {
    if (ticker) return;
    ticker = setInterval(() => {
      try {
        if (clients.size) frame(clients, 'status', { ...sensor.status(), webUrl: `http://127.0.0.1:${port}/web` });
        publishWeb();
      } catch { /* Telemetry errors never reach the application. */ }
    }, 1000);
    ticker.unref();
  };
  const staticAsset = (res: ServerResponse, content: string, type: string) => {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'Referrer-Policy': 'no-referrer' });
    res.end(content);
  };
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const browserRoute = ['/web', '/web.js', '/web.css', '/web/events', '/web/snapshot'].includes(url.pathname);
      const validHost = req.headers.host === `127.0.0.1:${port}` || (browserRoute && req.headers.host === `localhost:${port}`);
      const validOrigin = !req.headers.origin || (browserRoute && req.headers.origin === `http://${req.headers.host}`);
      if (!validHost || !validOrigin || req.method !== 'GET' || req.headers['sec-fetch-site'] === 'cross-site') {
        send(res, { error: 'Local CLI access only' }, 403); return;
      }
      if (url.pathname === '/web') { staticAsset(res, page, 'text/html; charset=utf-8'); return; }
      if (url.pathname === '/web.css') { staticAsset(res, css, 'text/css; charset=utf-8'); return; }
      if (url.pathname === '/web.js') { staticAsset(res, script, 'text/javascript; charset=utf-8'); return; }
      if (url.pathname === '/web/snapshot') { send(res, sensor.liveWeb()); return; }
      if (url.pathname === '/status') { send(res, { ...sensor.status(), webUrl: `http://127.0.0.1:${port}/web` }); return; }
      if (url.pathname === '/sessions') { send(res, sensor.sessions()); return; }
      if (url.pathname === '/memory') { send(res, { available: sensor.memory?.online ?? false, patterns: sensor.memory?.patterns() ?? [], honeyInteractions: sensor.memory?.honeyInteractions() ?? [] }); return; }
      if (url.pathname.startsWith('/sessions/')) {
        const result = sensor.inspect(url.pathname.slice('/sessions/'.length));
        send(res, result ?? { error: 'Session not found' }, result ? 200 : 404); return;
      }
      if (url.pathname !== '/events' && url.pathname !== '/web/events') { send(res, { error: 'Not found' }, 404); return; }
      if (clients.size + webClients.size >= 8) { send(res, { error: 'Watcher limit reached' }, 503); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      const recipients = url.pathname === '/web/events' ? webClients : clients;
      recipients.add(res);
      if (recipients === webClients) frame(new Set([res]), 'web', sensor.liveWeb());
      else frame(new Set([res]), 'status', { ...sensor.status(), webUrl: `http://127.0.0.1:${port}/web` });
      startTicker();
      const cleanup = () => {
        recipients.delete(res);
        if (!clients.size && !webClients.size) {
          if (ticker) { clearInterval(ticker); ticker = undefined; }
          if (pending) { clearTimeout(pending); pending = undefined; }
          pulses = [];
        }
      };
      res.on('close', cleanup);
      res.on('error', cleanup);
    } catch { if (!res.headersSent) send(res, { error: 'Telemetry unavailable' }, 503); else res.destroy(); }
  });
  const unsubscribe = sensor.silk.subscribe((event) => {
    if (epoch !== sensor.observationEpoch) { epoch = sensor.observationEpoch; pulses = []; }
    if (clients.size) frame(clients, 'vibration', event);
    if (webClients.size) {
      const from = sensor.previousRoute(event.observation.sessionId);
      pulses.push({ id: event.observation.id, route: event.observation.route, energy: event.decision.vibration,
        ...(event.observation.honey?.length ? { honey: true } : {}), ...(from ? { from } : {}) });
      pulses = pulses.slice(-8);
      if (!pending) { pending = setTimeout(() => {
        try { publishWeb(); } catch { /* isolated */ }
      }, 200); pending.unref(); }
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxConnections = 16;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) { unsubscribe(); server.close(); throw error; }
  server.on('error', () => { /* Application and sensor remain independent. */ });
  const address = server.address();
  if (address && typeof address !== 'string') port = address.port;
  return { url: `http://127.0.0.1:${port}`, server,
    close: async () => {
      unsubscribe();
      for (const client of clients) client.destroy();
      for (const client of webClients) client.destroy();
      if (ticker) clearInterval(ticker);
      if (pending) clearTimeout(pending);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } };
}
