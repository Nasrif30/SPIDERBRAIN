import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import express from 'express';
import { Sensor, createCanaryManifest, type VibrationEvent } from '@spiderbrain/sensor';
import { CanaryEngine, DeceptionBoundary } from '@spiderbrain/deception';
import { spiderbrain, canaryRoutes } from '@spiderbrain/express';
import { WebMemory } from '@spiderbrain/synganglion/memory';
import { runArena, arenaScenarios, scenarioNames } from '../arena/index.js';
import { calibrationReport } from '../arena/calibration.js';
const manifest = createCanaryManifest().map((entry, i) => ({ ...entry, id: 'SB-CANARY-' + (i + 1).toString(16).toUpperCase().padStart(6, '0') }));
function temp() { return mkdtempSync(join(tmpdir(), 'spiderbrain-canary-test-')); }
function cleanup(directory: string) { const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir())); assert.ok(basename(target).startsWith('spiderbrain-canary-test-')); rmSync(target, { recursive: true, force: true }); }
test('DeceptionBoundary rejects arbitrary content, host paths, external URLs, executable templates and property getters', () => {
  const boundary = new DeceptionBoundary(), entry = manifest[0]!;
  for (const option of ['content', 'env', 'credentials', 'customerData', 'sourceFile', 'command', 'outboundUrl', 'template']) assert.throws(() => boundary.response({ ...entry, [option]: 'attacker input' }), /REJECT/);
  for (const route of ['/../../private', 'C:\\Users\\private', '/admin-old/../.env', '/%2e%2e/private', '//external.invalid/admin-old', 'https://external.invalid']) assert.throws(() => boundary.validate({ ...entry, route }), /REJECT/);
  assert.throws(() => boundary.response({ ...entry, id: 'SB-CANARY-ABCDEF\n${process.env.SECRET}' }), /REJECT/);
  let touched = false; const getter = { ...entry }; Object.defineProperty(getter, 'id', { get() { touched = true; return entry.id; }, enumerable: true });
  assert.throws(() => boundary.response(getter), /REJECT/); assert.equal(touched, false);
  assert.throws(() => boundary.response({ ...entry, enabled: false }), /REJECT/);
});
test('templates are deterministic synthetic data, never read environment/host files or invoke outbound fetch', () => {
  const directory = temp(), secret = 'private-host-file-secret', previous = process.env['SPIDERBRAIN_TEST_SECRET'];
  writeFileSync(join(directory, 'secret.txt'), secret); process.env['SPIDERBRAIN_TEST_SECRET'] = 'private-environment-secret';
  const network = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected outbound action'); });
  try {
    const engine = new CanaryEngine({ enabled: true, manifest });
    for (const entry of manifest) {
      const response = engine.response(entry.route, 'GET')!; assert.ok(response.body.includes(entry.id)); assert.equal(response.body, engine.response(entry.route, 'GET')!.body);
      for (const value of [secret, 'private-environment-secret', directory, '${', '<script']) assert.ok(!response.body.includes(value));
    }
    assert.equal(network.mock.callCount(), 0); assert.equal(readFileSync(join(directory, 'secret.txt'), 'utf8'), secret);
  } finally { network.mock.restore(); if (previous === undefined) delete process.env['SPIDERBRAIN_TEST_SECRET']; else process.env['SPIDERBRAIN_TEST_SECRET'] = previous; cleanup(directory); }
});
test('malformed URLs cannot escape the catalog, and references match only active synthetic identifiers', () => {
  const engine = new CanaryEngine({ enabled: true, manifest });
  for (const path of ['/%61dmin-old', '/admin-old/../.env.backup', '//host/admin-old', '/admin-old%00', '/admin-old\\..\\private', '/ADMIN-OLD', '/admin-old/', '/admin-old#fragment', '/./admin-old', '/.env.backup/../secret']) assert.equal(engine.response(path, 'GET'), undefined);
  assert.equal(engine.response('/admin-old', 'POST'), undefined); assert.equal(engine.response('/admin-old', 'HEAD')!.honey.interaction, 'route_touch');
  const id = manifest[4]!.id;
  assert.deepEqual(engine.interactions('/about?canary=' + id + '&password=not-retained', undefined), [{ canaryId: id, resource: '/.env.backup', interaction: 'token_reference' }]);
  assert.equal(engine.interactions('/about?canary=private-real-token', undefined).length, 0);
  assert.equal(engine.interactions('/about?canary=' + id + '&canary=' + id, undefined).length, 0);
  assert.equal(engine.interactions('/about', [{ canaryId: id, resource: '/.env.backup', interaction: 'file_touch' }]).length, 0);
});
test('opt-in manifest is immutable and bounded; rejected configuration safely disables canaries', () => {
  const engine = new CanaryEngine({ enabled: true, manifest }); const copy = engine.manifest; copy[0]!.enabled = false;
  assert.equal(engine.count, 8); assert.ok(engine.response('/admin-old', 'GET'));
  assert.throws(() => new CanaryEngine({ enabled: true, manifest: [manifest[0]!, manifest[0]!] }), /REJECT/);
  const disabled = new Sensor({ memory: false }); assert.equal(disabled.status().canaries, 0); assert.equal(disabled.canaryResponse('/admin-old', 'GET'), undefined); disabled.close();
  const rejected = new Sensor({ memory: false, canaries: { enabled: true, manifest: [{ ...manifest[0]!, route: '/private' }] } });
  assert.equal(rejected.status().canaries, 0); assert.equal(rejected.status().online, true); assert.equal(rejected.status().failures, 1); rejected.close();
});
test('Honey Eye alone remains capped and cannot confirm hostility or dominate confidence', () => {
  let now = Date.now(); const sensor = new Sensor({ memory: false, canaries: { enabled: true, manifest }, clock: () => now });
  try {
    for (let i = 0; i < 14; i++) {
      now += 6000; const path = i % 2 ? '/config.old' : '/.env.backup', response = sensor.canaryResponse(path, 'GET')!;
      const event = sensor.observe({ clientKey: 'anonymous', path, method: 'GET', status: 200, latency: 1, honey: [response.honey] })!;
      assert.ok(event.signals.some((signal) => signal.eye === 'honey')); assert.equal(event.decision.evidenceEyes.length, 1);
      assert.ok(event.decision.contributions.filter((item) => item.eye === 'honey').reduce((sum, item) => sum + item.value, 0) <= 5.001);
      assert.ok(event.decision.confidence < .4); assert.ok(!['ALERT', 'SUSPICIOUS', 'HOSTILE'].includes(event.decision.state)); assert.equal(event.decision.action, 'watch');
    }
    assert.equal(sensor.sessions()[0]!.honeySequence!.length, 14);
  } finally { sensor.close(); }
});
test('Web Memory migrates the earlier memory schema, retains exactly five canary fields, bounds honey rows and compares anonymous behavior', () => {
  const directory = temp(), path = join(directory, 'memory.sqlite'); const database = new DatabaseSync(path);
  database.exec('CREATE TABLE events (seq INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE patterns (session_id TEXT PRIMARY KEY, pattern_id TEXT NOT NULL, timestamp INTEGER NOT NULL, data TEXT NOT NULL);');
  database.prepare('INSERT INTO events(timestamp,data) VALUES (?,?)').run(Date.now(), JSON.stringify({ legacyRecord: 'preserved' })); database.close();
  const sensor = new Sensor({ memory: { path, maxHoneyInteractions: 5 }, canaries: { enabled: true, manifest } });
  try {
    for (const clientKey of ['private-client-one', 'private-client-two']) for (let i = 0; i < 7; i++) {
      const route = i % 2 ? '/admin-old' : '/.env.backup', response = sensor.canaryResponse(route, 'GET')!;
      sensor.observe({ clientKey, path: route + '?password=private-query', method: 'GET', status: 200, latency: 1, honey: [response.honey] });
    }
    sensor.memory!.flush(); const stored = sensor.memory!.honeyInteractions(20); assert.equal(stored.length, 5);
    for (const item of stored) assert.deepEqual(Object.keys(item).sort(), ['canaryId', 'resource', 'interaction', 'sessionId', 'timestamp'].sort());
    const json = JSON.stringify({ stored, patterns: sensor.memory!.patterns() }); assert.ok(!json.includes('private-client') && !json.includes('private-query'));
    assert.ok(sensor.memory!.events(100).some((event) => (event as unknown as { legacyRecord?: string }).legacyRecord === 'preserved'));
    const inspected = sensor.inspect(sensor.sessions()[1]!.id)!; assert.equal(inspected.similarity!.meaning, 'behavioral similarity only'); assert.ok(inspected.similarity!.similarity > .5);
    assert.ok(sensor.memory!.patterns().every((pattern) => pattern.honeyInterest === 'HIGH'));
  } finally { sensor.close(); cleanup(directory); }
});
test('honey retention expires and a disabled canary cannot produce trusted honey evidence', () => {
  const memory = new WebMemory({ path: ':memory:', retentionMs: 20 });
  const sensor = new Sensor({ memory: false, canaries: { enabled: true, manifest } });
  try {
    const response = sensor.canaryResponse('/admin-old', 'GET')!, event = sensor.observe({ clientKey: 'x', path: '/admin-old', method: 'GET', status: 200, latency: 1, honey: [response.honey] })!;
    event.observation.timestamp = Date.now() - 1000; memory.append(event); assert.equal(memory.honeyInteractions().length, 0);
    const off = new Sensor({ memory: false }); assert.equal(off.observe({ clientKey: 'x', path: '/admin-old', method: 'GET', status: 200, latency: 1, honey: [response.honey] })!.observation.honey, undefined); off.close();
  } finally { sensor.close(); memory.close(); }
});
test('Express serves opt-in synthetic responses, redacts query/body/headers and remains functional when sensing is closed', async () => {
  const sensor = new Sensor({ memory: { path: ':memory:' }, canaries: { enabled: true, manifest } }), events: VibrationEvent[] = [];
  sensor.silk.subscribe((event) => { events.push(event); });const app = express();app.use(spiderbrain(sensor));app.use(canaryRoutes(sensor));app.get('/', (_req, res) => res.send('application alive'));app.use((_req, res) => res.sendStatus(404));
  const server = createServer(app);await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));const address = server.address();assert.ok(address && typeof address !== 'string');const origin = 'http://127.0.0.1:' + address.port;
  try {
    const response = await fetch(origin + '/.env.backup?password=private-query', { headers: { cookie: 'private-cookie', authorization: 'Bearer private-auth' } });
    assert.equal(response.status, 200);assert.match(response.headers.get('content-security-policy')!, /default-src 'none'/);assert.match(await response.text(), /synthetic-db.invalid/);
    await (await fetch(origin + '/about?canary=' + manifest[4]!.id)).text();assert.ok(events.at(-1)!.signals.some((item) => item.signal === 'HONEY_TOKEN_REFERENCE'));
    const post = await fetch(origin + '/admin-old', { method: 'POST', body: 'private-body' });assert.equal(post.status, 404);await post.text();
    const json=JSON.stringify({events,honey:sensor.memory!.honeyInteractions(),web:sensor.liveWeb()});for(const secret of ['private-query','private-cookie','private-auth','private-body'])assert.ok(!json.includes(secret));
    assert.equal(sensor.liveWeb().canaries!.length, 8);sensor.close();assert.equal(await (await fetch(origin + '/')).text(), 'application alive');assert.equal((await fetch(origin + '/admin-old')).status, 404);
  } finally { server.closeAllConnections();await new Promise<void>((resolve) => server.close(() => resolve()));sensor.close(); }
});
test('Arena V2 has 30 new deterministic labeled traces, owns its target, and reports its misses honestly', { timeout: 20000 }, async () => {
  assert.ok(scenarioNames.length >= 34);assert.equal(new Set(scenarioNames).size, scenarioNames.length);assert.ok(arenaScenarios.filter((item) => item.family).length >= 30);
  const first=await runArena(['canary-discovery-1','honey-file-read-1','low-and-slow-1']),second=await runArena(['canary-discovery-1','honey-file-read-1','low-and-slow-1']);assert.deepEqual(first, second);
  // Labels remain unchanged; temporal context now detects the low-and-slow trace.
  const report=calibrationReport(first);assert.equal(report.metrics.TN,1);assert.equal(report.metrics.TP,1);assert.equal(report.metrics.FN,1);assert.equal(report.metrics.FP,0);assert.equal(report.metrics.precision,1);assert.equal(report.metrics.recall,.5);
  assert.match(report.markdown,/not scientific proof/);assert.ok(report.misses.length===1);await assert.rejects(runArena(['http://external.invalid']));
});
