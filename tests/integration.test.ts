import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, get, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { Sensor, startTelemetry, type VibrationEvent } from '@spiderbrain/sensor';
import { spiderbrain } from '@spiderbrain/express';
async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
function cleanupTemporary(directory: string): void {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith('spiderbrain-'));
  rmSync(target, { recursive: true, force: true });
}
test('Express redacts before SILK and SQLite, survives failure, and restores persistent memory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spiderbrain-test-'));
  const path = join(directory, 'memory.sqlite');
  const sensor = new Sensor({ memory: { path } });
  const events: VibrationEvent[] = [];
  sensor.silk.subscribe((event) => { events.push(event); });
  sensor.silk.subscribe(() => { throw new Error('broken subscriber'); });
  const app = express();
  app.use(spiderbrain(sensor));
  app.use(express.json());
  const router = express.Router();
  router.post('/account/:id', (_req, res) => res.status(201).json({ ok: true }));
  app.use('/api', router);
  app.use((_req, res) => res.status(404).send('Not found'));
  const { server, url } = await listen(app);
  try {
    const response = await fetch(url + '/api/account/private-person-id?access_token=query-secret', { method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer header-secret', cookie: 'session=cookie-secret', 'x-api-key': 'api-secret' },
      body: JSON.stringify({ password: 'body-secret', content: 'private-form-secret' }) });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(events[0]!.observation.route, '/api/account/:redacted');
    assert.equal(events[0]!.observation.method, 'POST');
    await fetch(url + '/.env?key=another-secret');
    sensor.memory!.flush();
    const db = new DatabaseSync(path);
    const contents = JSON.stringify({ events: db.prepare('SELECT data FROM events').all(), patterns: db.prepare('SELECT data FROM patterns').all() });
    db.close();
    for (const secret of ['private-person-id', 'query-secret', 'header-secret', 'cookie-secret', 'api-secret', 'body-secret', 'private-form-secret', 'another-secret', '127.0.0.1']) {
      assert.ok(!contents.includes(secret), `Stored secret: ${secret}`);
      assert.ok(!JSON.stringify(events).includes(secret), `Published secret: ${secret}`);
    }
    sensor.close();
    assert.equal((await fetch(url + '/')).status, 404);
    const reopened = new Sensor({ memory: { path } });
    try { assert.equal(reopened.memory!.events().length, 2); assert.ok(reopened.memory!.patterns().length); }
    finally { reopened.close(); }
  } finally { sensor.close(); await close(server); cleanupTemporary(directory); }
});
test('Express responds normally even when observation and error reporting throw', async () => {
  const app = express();
  app.use(spiderbrain({ observe: () => { throw new Error('failed engine'); } }, { onError: () => { throw new Error('failed reporter'); } }));
  app.get('/', (_req, res) => res.send('still online'));
  const { server, url } = await listen(app);
  try {
    for (let i = 0; i < 3; i++) { const response = await fetch(url); assert.equal(response.status, 200); assert.equal(await response.text(), 'still online'); }
  } finally { await close(server); }
});
test('a locked SQLite database disables memory while sensing and the application continue', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spiderbrain-lock-'));
  const path = join(directory, 'memory.sqlite');
  const sensor = new Sensor({ memory: { path } });
  const db = new DatabaseSync(path);
  const app = express();
  app.use(spiderbrain(sensor));
  app.get('/', (_req, res) => res.send('online'));
  const { server, url } = await listen(app);
  try {
    db.exec('BEGIN IMMEDIATE');
    assert.equal((await fetch(url)).status, 200);
    sensor.memory!.flush();
    assert.equal(sensor.status().memoryAvailable, false);
    assert.equal(sensor.status().online, true);
    assert.equal((await fetch(url)).status, 200);
    assert.equal(sensor.status().vibrations, 2);
    assert.ok(sensor.status().droppedMemoryEvents >= 1);
  } finally { db.exec('ROLLBACK'); db.close(); sensor.close(); await close(server); cleanupTemporary(directory); }
});
test('local telemetry streams real observations and rejects browser access and rebinding hosts', async () => {
  const sensor = new Sensor({ memory: false });
  const telemetry = await startTelemetry(sensor, { port: 0 });
  const controller = new AbortController();
  try {
    assert.equal((await fetch(telemetry.url + '/status')).status, 200);
    assert.equal((await fetch(telemetry.url + '/status', { headers: { origin: 'https://elsewhere.example' } })).status, 403);
    const forgedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(telemetry.url + '/status', { headers: { host: 'rebinding.example' } }, (response) => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(forgedHostStatus, 403);
    assert.equal((await fetch(telemetry.url + '/status', { method: 'POST' })).status, 403);
    const response = await fetch(telemetry.url + '/events', { signal: controller.signal });
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    assert.match(decoder.decode(first.value), /event: status/);
    const event = sensor.observe({ clientKey: 'private-client', path: '/admin?password=secret', method: 'GET', status: 404, latency: 1 })!;
    const next = await reader.read();
    const text = decoder.decode(next.value);
    assert.match(text, /event: vibration/);
    assert.ok(text.includes(event.observation.id));
    assert.ok(!text.includes('password') && !text.includes('private-client'));
    await reader.cancel();
  } finally { controller.abort(); await telemetry.close(); sensor.close(); }
});
test('telemetry listener collision does not disable the sensor', async () => {
  const sensor = new Sensor({ memory: false });
  const telemetry = await startTelemetry(sensor, { port: 0 });
  try {
    const port = Number(new URL(telemetry.url).port);
    await assert.rejects(startTelemetry(sensor, { port }));
    assert.ok(sensor.observe({ clientKey: 'client', path: '/', method: 'GET', status: 200, latency: 1 }));
  } finally { await telemetry.close(); sensor.close(); }
});
test('SPIDERBRAIN watch connects, displays banner and status, and exits cleanly with --once', async () => {
  const sensor = new Sensor({ memory: false });
  const telemetry = await startTelemetry(sensor, { port: 0 });
  try {
    const child = spawn(process.execPath, ['dist/cli/guardian/index.js', 'watch', '--once', '--url', telemetry.url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString(); });
    const timeout = setTimeout(() => child.kill(), 10_000);
    const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    clearTimeout(timeout);
    assert.equal(code, 0, error);
    assert.match(output, /S P I D E R B R A I N/);
    assert.match(output, /made by Naskilabot/);
    assert.match(output, /SYNGANGLION ONLINE/);
    assert.match(output, /Vibrations\s+0/);
  } finally { await telemetry.close(); sensor.close(); }
});
