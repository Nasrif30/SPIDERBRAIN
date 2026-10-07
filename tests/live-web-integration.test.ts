import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { Script } from 'node:vm';
import { Sensor, startTelemetry, type VibrationEvent, type LiveWebSnapshot } from '@spiderbrain/sensor';
import { spiderbrain, noteAuthentication } from '@spiderbrain/express';
import { runArena } from '../arena/index.js';
test('application auth outcomes reach SILK and SQLite with no raw identities, login bodies or credentials', async () => {
  const sensor = new Sensor({ memory: { path: ':memory:' } });
  const events: VibrationEvent[] = [];
  sensor.silk.subscribe((event) => { events.push(event); });
  const app = express(); app.use(spiderbrain(sensor)); app.use(express.json());
  app.post('/login', (_req, res) => { noteAuthentication(res, { type: 'login_failure', identityKey: 'opaque-private-user' }); res.sendStatus(401); });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    for (let i = 0; i < 7; i++) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/login?token=query-secret`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: 'Bearer header-secret', cookie: 'cookie-secret' },
        body: JSON.stringify({ username: 'body-user', password: 'body-password' }) });
      assert.equal(response.status, 401); await response.text();
    }
    const stored = JSON.stringify({ events, memory: sensor.memory!.events(), live: sensor.liveWeb() });
    for (const secret of ['opaque-private-user', 'body-user', 'body-password', 'query-secret', 'header-secret', 'cookie-secret']) assert.ok(!stored.includes(secret));
    assert.equal(new Set(events.map((event) => event.observation.authentication!.identityId)).size, 1);
    assert.ok(events.at(-1)!.signals.some((signal) => signal.eye === 'authentication'));
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); sensor.close(); }
});
test('Live Web serves CSP-protected native assets and updates over SSE with bounded sanitized graph data', { timeout: 10_000 }, async () => {
  const sensor = new Sensor({ memory: false });
  const telemetry = await startTelemetry(sensor, { port: 0 });
  const controller = new AbortController();
  try {
    const html = await fetch(telemetry.url + '/web');
    assert.equal(html.status, 200); assert.match(html.headers.get('content-security-policy')!, /script-src 'self'/);
    assert.match(await html.text(), /Observed route web/);
    const js = await (await fetch(telemetry.url + '/web.js')).text();
    assert.doesNotThrow(() => new Script(js)); assert.match(js, /new EventSource/); assert.ok(!js.includes('innerHTML'));
    assert.equal((await fetch(telemetry.url + '/web.css')).status, 200);
    assert.equal((await fetch(telemetry.url + '/web/snapshot', { headers: { origin: telemetry.url } })).status, 200);
    assert.equal((await fetch(telemetry.url + '/web/snapshot', { headers: { origin: 'https://elsewhere.example' } })).status, 403);
    assert.equal((await fetch(telemetry.url + '/web', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    const response = await fetch(telemetry.url + '/web/events', { signal: controller.signal });
    assert.ok(response.body); const reader = response.body.getReader(); const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /event: web/);
    sensor.observe({ clientKey: 'private-client', path: '/', method: 'GET', status: 200, latency: 1 });
    sensor.observe({ clientKey: 'private-client', path: '/admin?secret=private-value', method: 'GET', status: 404, latency: 1 });
    const text = decoder.decode((await reader.read()).value);
    assert.match(text, /event: web/); assert.ok(text.includes('/admin')); assert.ok(!text.includes('private-client') && !text.includes('private-value'));
    const snapshot = await (await fetch(telemetry.url + '/web/snapshot')).json() as LiveWebSnapshot;
    assert.ok(snapshot.graph.edges.some((edge) => edge.from === '/' && edge.to === '/admin'));
    assert.equal(snapshot.status.connections, 1); assert.equal(snapshot.sessions.length, 1);
    await reader.cancel();
  } finally { controller.abort(); await telemetry.close(); sensor.close(); }
});
test('spiderbrain web reports the actual local Live Web endpoint', async () => {
  const sensor = new Sensor({ memory: false });
  const telemetry = await startTelemetry(sensor, { port: 0 });
  try {
    const child = spawn(process.execPath, ['dist/cli/guardian/index.js', 'web', '--url', telemetry.url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    const timeout = setTimeout(() => child.kill(), 5000);
    const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    clearTimeout(timeout); assert.equal(code, 0); assert.ok(output.includes(telemetry.url + '/web'));
  } finally { await telemetry.close(); sensor.close(); }
});
test('Arena owns its target, refuses arbitrary host inputs, and keeps ordinary traces below ALERT', async () => {
  await assert.rejects(runArena(['https://external.example']));
  await assert.rejects(runArena('http://127.0.0.1:3000' as unknown as string[]));
  const metrics = await runArena(['normal', 'noisy-bot']);
  assert.equal(metrics.length, 2);
  for (const item of metrics) { assert.equal(item.falsePositives, 0); assert.ok(item.maximumConfidence < 0.65); assert.equal(item.timeToDetectionMs, null); }
});
