import express from 'express';
import { createSensor, spiderbrain, startTelemetry, noteAuthentication, canaryRoutes } from '@spiderbrain/express';
export function demo(sensor = createSensor({ publicRoutes: ['/auth/demo'] })) {
  const app = express();
  app.disable('x-powered-by');
  app.use(spiderbrain(sensor));
  app.use(canaryRoutes(sensor));
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SPIDERBRAIN</title>
    <style>body{background:#0c1318;color:#d5e8dd;font:18px system-ui;max-width:750px;margin:12vh auto;padding:24px}h1{letter-spacing:.13em}a{color:#86d5af;margin-right:18px}code{color:#86d5af}p{line-height:1.6}</style>
    <h1>SPIDERBRAIN</h1><p>Give a website the ability to feel danger before damage happens.</p><p>SYNGANGLION is observing sanitized behavioral metadata. SPIDERBRAIN explains each disturbance.</p>
    <nav><a href="/about">About</a><a href="/products">Products</a><a href="/login">Login</a><a href="/account">Account</a><a href="/api/health">Health</a></nav><p>Open a terminal: <code>npm run watch</code> or <code>node dist/cli/guardian/index.js web</code></p><p>SpiderBrain observes. It does not block traffic.</p></html>`));
  app.get('/about', (_req, res) => res.send('A local nervous system: sense, measure, watch, remember.'));
  app.get('/login', (_req, res) => res.send('Demo login placeholder. No credentials are collected.'));
  app.get('/products', (_req, res) => res.send('Synthetic demo catalog. No production data.'));
  app.get('/account', (req, res) => {
    if (req.query['denied'] === '1') { noteAuthentication(res, { type: 'protected_route_denial' }); res.status(403).send('Synthetic demo denial'); }
    else res.send('Synthetic demo account. No production data.');
  });
  // Explicit synthetic outcomes, not a real login or a credential processor.
  app.post('/auth/demo', express.json({ limit: '1kb' }), (req, res) => {
    const identities = new Set(['sample-a', 'sample-b', 'sample-c']);
    const body: unknown = req.body;
    if (!body || typeof body !== 'object') { res.status(400).send('Synthetic outcome required'); return; }
    const value = body as Record<string, unknown>;
    if (typeof value['identity'] !== 'string' || !identities.has(value['identity'])) { res.status(400).send('Use a bundled synthetic identity'); return; }
    if (value['outcome'] === 'failure') { noteAuthentication(res, { type: 'login_failure', identityKey: value['identity'] }); res.status(401).json({ outcome: 'failure' }); }
    else if (value['outcome'] === 'success') { noteAuthentication(res, { type: 'login_success', identityKey: value['identity'] }); res.json({ outcome: 'success' }); }
    else if (value['outcome'] === 'logout') { noteAuthentication(res, { type: 'logout', authenticated: false }); res.json({ outcome: 'logout' }); }
    else res.status(400).send('Use success, failure, or logout');
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use((_req, res) => res.status(404).send('Not found'));
  return { app, sensor };
}
// This file is also imported by integration tests.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/examples/demo.js')) {
  const { app, sensor } = demo(createSensor({ publicRoutes: ['/auth/demo'], canaries: process.argv.includes('--canaries') ? { enabled: true } : false, onError: (message) => console.error(message) }));
  const port = Number(process.env['PORT'] ?? 3000);
  const server = app.listen(port, '127.0.0.1', () => console.log(`Demo: http://127.0.0.1:${port}`));
  server.on('error', () => { console.error('Demo listener unavailable'); sensor.close(); process.exitCode = 1; });
  let telemetry: Awaited<ReturnType<typeof startTelemetry>> | undefined;
  try {
    telemetry = await startTelemetry(sensor, { port: Number(process.env['SPIDERBRAIN_PORT'] ?? 4318) });
    console.log(`SYNGANGLION ONLINE: ${telemetry.url}\nLive Web: ${telemetry.url}/web\nRun npm run watch in another terminal.`);
  } catch { console.error('Local telemetry unavailable. Demo application continues.'); }
  const stop = async () => {
    await telemetry?.close();
    server.closeAllConnections();
    server.close(() => sensor.close());
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
}
