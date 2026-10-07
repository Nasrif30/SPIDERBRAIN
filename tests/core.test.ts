import test from 'node:test';
import assert from 'node:assert/strict';
import { Sensor, Redactor } from '@spiderbrain/sensor';
import { Silk } from '@spiderbrain/silk';
import { WebMemory, fingerprint, similarity } from '@spiderbrain/synganglion/memory';
import { decay } from '@spiderbrain/synganglion/physics/decay';
import { entropy } from '@spiderbrain/synganglion/physics/entropy';
import { vibration } from '@spiderbrain/synganglion/physics/vibration';
import type { VibrationEvent } from '@spiderbrain/shared';
const probeRoutes = ['/admin', '/admin-old', '/admin.php', '/admin/login', '/.env', '/.git/', '/backup', '/config.old'];
function harness(options: ConstructorParameters<typeof Sensor>[0] = {}) {
  let now = Date.now();
  const sensor = new Sensor({ memory: false, ...options, clock: () => now });
  const request = (path = '/', status = 200, step = 1000, clientKey = 'visitor') => {
    now += step;
    return sensor.observe({ clientKey, path, method: 'GET', status, latency: 2 })!;
  };
  return { sensor, request, advance: (ms: number) => { now += ms; } };
}
test('physics: exponential decay, bounded vibration, entropy', () => {
  assert.equal(decay(10, 0), 10);
  assert.ok(Math.abs(decay(10, 1000, 1) - 10 / Math.E) < 1e-9);
  assert.equal(decay(10, -100), 10);
  assert.equal(vibration(100, 10, 10, 10), 12);
  assert.equal(vibration(0, 1, 1, 1), 0);
  assert.equal(entropy(['a', 'a']), 0);
  assert.equal(entropy(['a', 'b']), 1);
});
test('redaction strips values, secrets, encoded paths, and unrecognized methods', () => {
  const redactor = new Redactor(['/catalog']);
  const raw = { clientKey: 'client-address', path: '/api/token/supersecret?password=secret#secret', method: 'SECRETMETHOD', status: 200, latency: 1,
    headers: { authorization: 'Bearer forbidden', cookie: 'forbidden' }, body: { password: 'forbidden' } };
  const event = redactor.observation(raw, 'anonymous', Date.now());
  assert.equal(event.route, '/api/:redacted/:redacted');
  assert.equal(event.method, 'OTHER');
  for (const secret of ['supersecret', 'password=', 'forbidden', 'client-address', 'SECRETMETHOD']) assert.ok(!JSON.stringify(event).includes(secret));
  assert.equal(redactor.route('/catalog/person@example.com'), '/catalog/:redacted');
  assert.equal(redactor.route('/%61dmin'), '/admin');
  assert.equal(redactor.route('/api/%252Ftoken%252Fsecret'), '/api/:redacted');
  assert.equal(redactor.route('/api/%broken'), '/api/:redacted');
  assert.equal(redactor.observation({ ...raw, routeTemplate: '/products/:id', path: '/products/private-key' }, 'anonymous', 1).route, '/products/:redacted');
});
test('ordinary browsing, sensitive routes with success, and isolated 404 stay CALM', () => {
  const { sensor, request } = harness();
  try {
    for (let i = 0; i < 40; i++) assert.equal(request(['/', '/about', '/products', '/login', '/admin'][i % 5]!).decision.state, 'CALM');
    const event = request('/missing-private-value', 404);
    assert.equal(event.decision.state, 'CALM');
    assert.equal(event.decision.risk, 0);
    assert.equal(event.decision.action, 'watch');
  } finally { sensor.close(); }
});
test('server errors alone are not blamed on visitors', () => {
  const { sensor, request } = harness();
  try { for (let i = 0; i < 20; i++) assert.equal(request('/', 500, 2000).decision.risk, 0); }
  finally { sensor.close(); }
});
test('high velocity or high entropy alone cannot reach ALERT or HOSTILE', () => {
  const { sensor, request } = harness();
  try {
    for (let i = 0; i < 60; i++) {
      const event = request(probeRoutes[i % probeRoutes.length]!, 200, 20);
      assert.ok(['CALM', 'CURIOUS'].includes(event.decision.state));
      assert.ok(!event.decision.contributions.some((item) => item.signal === 'navigation entropy'));
    }
  } finally { sensor.close(); }
});
test('repeated multi-Eye probing resonates, explains its score, and reaches HOSTILE gradually', () => {
  const { sensor, request } = harness();
  try {
    const events: VibrationEvent[] = [];
    for (let i = 0; i < 50; i++) events.push(request(probeRoutes[i % probeRoutes.length]!, 404, 25));
    assert.ok(events.slice(0, 3).every((event) => event.decision.state !== 'HOSTILE'));
    const last = events.at(-1)!.decision;
    assert.equal(last.state, 'HOSTILE');
    assert.deepEqual(new Set(last.evidenceEyes), new Set(['route', 'velocity', 'error']));
    assert.ok(last.confidence >= 0.8);
    assert.ok(last.resonance > 0);
    assert.ok(last.contributions.every((item) => item.reason && item.value <= 5));
    const sum = last.contributions.reduce((n, item) => n + item.value, 0);
    assert.ok(Math.abs(sum - last.risk) <= 0.011);
    assert.equal(last.action, 'watch');
  } finally { sensor.close(); }
});
test('energy decays while idle; sufficient time and clean behavior restore CALM', () => {
  const { sensor, request, advance } = harness();
  try {
    for (let i = 0; i < 50; i++) request(probeRoutes[i % probeRoutes.length]!, 404, 25);
    const before = sensor.status().energy;
    advance(120_000);
    assert.ok(sensor.status().energy < before / 10);
    for (let i = 0; i < 30; i++) request('/', 200, 4000);
    assert.equal(sensor.sessions()[0]!.state, 'CALM');
    assert.ok(sensor.sessions()[0]!.decision!.risk < 2);
  } finally { sensor.close(); }
});
test('anonymous sessions isolate visitors, expire, cap cardinality, and rotate daily', () => {
  const { sensor, request, advance } = harness({ maxSessions: 2, sessionTtlMs: 1000 });
  try {
    const a = request('/', 200, 0, 'raw-client-A').observation.sessionId;
    const b = request('/', 200, 0, 'raw-client-B').observation.sessionId;
    assert.notEqual(a, b);
    assert.equal(request('/', 200, 0, 'raw-client-A').observation.sessionId, a);
    request('/', 200, 0, 'raw-client-C');
    assert.equal(sensor.sessions().length, 2);
    assert.ok(!sensor.inspect(b));
    assert.ok(!JSON.stringify(sensor.sessions()).includes('raw-client'));
    advance(1001);
    assert.equal(sensor.status().sessions, 0);
    advance(86_400_000);
    assert.notEqual(request('/', 200, 0, 'raw-client-A').observation.sessionId, a);
  } finally { sensor.close(); }
});
test('SILK isolates sync/async errors and subscriber mutation', async () => {
  const { sensor, request } = harness();
  const bus = new Silk();
  try {
    const event = request();
    let delivered = false;
    bus.subscribe(() => { throw new Error('subscriber'); });
    bus.subscribe(async () => { throw new Error('async subscriber'); });
    bus.subscribe((copy) => { copy.observation.route = '/changed'; });
    bus.subscribe((copy) => { assert.equal(copy.observation.route, '/'); delivered = true; });
    assert.doesNotThrow(() => bus.publish(event));
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(delivered);
    assert.equal(event.observation.route, '/');
  } finally { bus.close(); sensor.close(); }
});
test('sensor failure disables telemetry and never throws; memory failure leaves sensing available', () => {
  const sensor = new Sensor({ memory: false, clock: () => { throw new Error('private-error'); }, onError: () => { throw new Error('reporter'); } });
  assert.equal(sensor.observe({ clientKey: 'client', path: '/', method: 'GET', status: 200, latency: 0 }), undefined);
  assert.equal(sensor.status().online, false);
  assert.equal(sensor.status().failures, 1);
  sensor.close();
  const unavailable = new Sensor({ memory: { path: '\u0000invalid' } });
  assert.ok(unavailable.observe({ clientKey: 'client', path: '/', method: 'GET', status: 200, latency: 0 }));
  assert.equal(unavailable.status().memoryAvailable, false);
  assert.equal(unavailable.status().online, true);
  unavailable.close();
});
test('Web Memory bounds records, preserves sanitized metadata, and compares behavior', () => {
  const { sensor, request } = harness();
  const memory = new WebMemory({ path: ':memory:', maxEvents: 5, maxPatterns: 2 });
  try {
    for (const visitor of ['visitor-a', 'visitor-b', 'visitor-c']) {
      for (let i = 0; i < 10; i++) {
        const event = request(probeRoutes[i % probeRoutes.length]! + '?token=forbidden', 404, 25, visitor);
        memory.append(event, sensor.inspect(event.observation.sessionId)!.session);
      }
    }
    memory.flush();
    assert.equal(memory.events(100).length, 5);
    assert.equal(memory.patterns(100).length, 2);
    assert.ok(!JSON.stringify(memory.events()).includes('forbidden'));
    const current = fingerprint(sensor.sessions().at(-1)!);
    const match = memory.compare(current);
    assert.ok(match && match.similarity > 0.8);
    assert.equal(match.meaning, 'behavioral similarity only');
    const sparse = { ...current, requests: 1 };
    assert.equal(similarity(sparse, current), 0);
  } finally { memory.close(); memory.close(); sensor.close(); }
});
test('memory drops oldest queued events under pressure and sensor history remains bounded', () => {
  const { sensor, request } = harness();
  const memory = new WebMemory({ path: ':memory:' });
  try {
    for (let i = 0; i < 300; i++) memory.append(request('/', 200, 0));
    assert.equal(memory.dropped, 44);
    memory.flush();
    assert.equal(memory.events(1000).length, 256);
    const session = sensor.sessions()[0]!;
    assert.equal(session.routes.length, 32);
    assert.equal(session.intervals.length, 32);
    assert.equal(session.riskProgression.length, 32);
    assert.ok(Object.values(session.counts).reduce((a, b) => a + b, 0) <= 128);
  } finally { memory.close(); sensor.close(); }
});
test('high-water flushing persists a normal asynchronous burst without dropping events', async () => {
  const { sensor, request } = harness();
  const memory = new WebMemory({ path: ':memory:' });
  try {
    for (let i = 0; i < 200; i++) memory.append(request('/', 200, 0));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(memory.dropped, 0);
    assert.equal(memory.events(1000).length, 200);
  } finally { memory.close(); sensor.close(); }
});
