import test from 'node:test';
import assert from 'node:assert/strict';
import { Sensor, type RequestMetadata, type Signal } from '@spiderbrain/sensor';
import { RouteGraph } from '@spiderbrain/synganglion';
import { diffuse, diffusionConfig } from '@spiderbrain/synganglion/physics/diffusion';
import { resonanceV2 } from '@spiderbrain/synganglion/physics/resonance';
import { transition, type Inertia } from '@spiderbrain/synganglion/instincts/state';
import { AuthenticationEye } from '@spiderbrain/synganglion/eyes/authentication';
function harness(options: ConstructorParameters<typeof Sensor>[0] = {}) {
  let now = 1_800_000_000_000;
  const sensor = new Sensor({ ...options, memory: false, clock: () => now });
  const request = (path = '/', status = 200, step = 1000, extra: Partial<RequestMetadata> = {}) => {
    now += step;
    return sensor.observe({ clientKey: 'visitor', path, method: 'GET', status, latency: 1, ...extra })!;
  };
  return { sensor, request, advance: (ms: number) => { now += ms; } };
}
test('Authentication Eye uses explicit sanitized outcomes and describes anonymous switching', () => {
  const { sensor, request } = harness();
  try {
    assert.equal(request('/login', 401).signals.some((item) => item.eye === 'authentication'), false);
    for (let i = 0; i < 7; i++) request('/login', 401, 1000, { authentication: { type: 'login_failure', identityKey: 'private-person-' + i % 3 } });
    const event = request('/login', 401, 1000, { authentication: { type: 'login_failure', identityKey: 'private-person-0' } });
    assert.ok(event.signals.some((item) => item.signal === 'AUTH_RESONANCE' && item.reason.includes('3 anonymous identities')));
    assert.ok(event.signals.some((item) => item.signal === 'anonymous identity switching'));
    assert.ok(!JSON.stringify(sensor.sessions()).includes('private-person'));
    assert.ok(!JSON.stringify(event).toLowerCase().includes('brute force'));
    assert.ok(event.observation.authentication?.identityId?.startsWith('SB-I-'));
  } finally { sensor.close(); }
});
test('successful login, protected denial, rapid switching and authentication transitions are explicit', () => {
  const { sensor, request } = harness();
  try {
    const single = request('/login', 200, 1000, { authentication: { type: 'login_success', identityKey: 'private-a' } });
    assert.equal(single.decision.state, 'CALM');
    assert.equal(sensor.sessions()[0]!.authenticated, true);
    for (let i = 0; i < 4; i++) request('/login', 200, 1000, { authentication: { type: 'login_success', identityKey: 'private-' + i % 3 } });
    const switching = request('/login', 200, 1000, { authentication: { type: 'login_success', identityKey: 'private-0' } });
    assert.ok(switching.signals.some((item) => item.signal === 'rapid account switching'));
    for (let i = 0; i < 3; i++) request('/account', 403, 1000, { authentication: { type: 'protected_route_denial' } });
    assert.ok(request('/account', 403, 1000, { authentication: { type: 'protected_route_denial' } }).signals.some((item) => item.signal === 'protected-route denials'));
    for (let i = 0; i < 6; i++) request('/login', 200, 1000, { authentication: { type: 'auth_transition', authenticated: i % 2 === 0 } });
    assert.equal(sensor.sessions()[0]!.authenticated, false);
    const next = request('/login', 200, 1000, { authentication: { type: 'logout' } });
    assert.ok(next.signals.some((item) => item.signal === 'authentication state transitions'));
  } finally { sensor.close(); }
});
test('normal and rare successful movement stay quiet while contextual failed traversal raises movement signals', () => {
  const { sensor, request } = harness({ publicRoutes: ['/catalog', '/checkout'] });
  try {
    for (const path of ['/', '/products', '/catalog', '/login', '/account', '/checkout']) assert.equal(request(path).signals.some((item) => item.eye === 'movement'), false);
    request('/robots.txt', 404);
    for (const path of ['/admin', '/backup', '/config.old', '/admin-old']) request(path, 404, 200);
    const event = request('/.env', 404, 200);
    assert.ok(event.signals.some((item) => item.signal === 'sensitive-route concentration'));
    assert.ok(event.signals.some((item) => item.signal === 'unusual navigation direction'));
    assert.ok(sensor.liveWeb().graph.edges.some((edge) => edge.from === '/login' && edge.to === '/account'));
  } finally { sensor.close(); }
});
test('RouteGraph counts directed transitions, bounds nodes/edges, expires old paths and has no dangling neighbors', () => {
  const graph = new RouteGraph({ maxNodes: 3, maxEdges: 2, retentionMs: 1000 });
  assert.deepEqual(graph.rarity('/', undefined), { route: 1, transition: 1 });
  graph.observe('/', undefined, 0); graph.observe('/login', '/', 10); graph.observe('/account', '/login', 20);
  graph.observe('/login', '/account', 30);
  assert.equal(graph.rarity('/login', '/account').transition, 0.5);
  graph.observe('/admin', '/login', 40);
  const view = graph.snapshot(40);
  assert.equal(view.nodes.length, 3); assert.ok(view.edges.length <= 2);
  assert.ok(view.evictedNodes >= 1); assert.ok(view.evictedEdges >= 1);
  for (const edge of view.edges) assert.ok(view.nodes.some((node) => node.route === edge.from) && view.nodes.some((node) => node.route === edge.to));
  for (const node of view.nodes) assert.ok(node.neighbors.every((route) => view.nodes.some((item) => item.route === route)));
  assert.equal(graph.snapshot(1100).nodes.length, 0);
  assert.equal(graph.snapshot(1100).edges.length, 0);
  graph.close();
});
test('diffusion is local, deterministic, attenuated, depth-limited and conserves its strict total budget', () => {
  const neighbors: Record<string, string[]> = { admin: ['login'], login: ['home', 'admin'], home: ['login'] };
  const local = diffuse('admin', 10, (route) => neighbors[route] ?? []);
  assert.equal(local.get('login'), 2); assert.equal(local.get('home'), undefined); assert.equal(local.has('admin'), false);
  const deep = diffuse('admin', 5, (route) => neighbors[route] ?? [], { depth: 2 });
  assert.equal(deep.get('login'), 1); assert.ok(Math.abs(deep.get('home')! - 0.2) < 1e-8);
  assert.deepEqual(deep, diffuse('admin', 5, (route) => [...(neighbors[route] ?? [])].reverse(), { depth: 2 }));
  const wide = diffuse('admin', 12, () => Array.from({ length: 100 }, (_, i) => 'route-' + i), { depth: 3, maxRecipients: 5 });
  assert.ok(wide.size <= 5); assert.ok([...wide.values()].reduce((a, b) => a + b, 0) <= 2);
  assert.equal(diffuse('admin', 12, () => ['login'], { depth: 0 }).size, 0);
  assert.throws(() => diffusionConfig({ maxContribution: 3 })); assert.throws(() => diffusionConfig({ depth: 20 }));
});
test('received graph awareness decays, cannot feed back, and cannot taint an ordinary visitor', () => {
  const graph = new RouteGraph();
  graph.observe('/admin', undefined, 0); graph.observe('/login', '/admin', 0); graph.observe('/', '/login', 0);
  graph.energize('/admin', 10, 0);
  assert.equal(graph.awareness('/login', 0), 2); assert.equal(graph.awareness('/', 0), 0);
  graph.energize('/login', 0, 0);
  assert.equal(graph.awareness('/', 0), 0);
  for (let i = 0; i < 20; i++) graph.energize('/admin', 12, 0);
  assert.equal(graph.awareness('/login', 0), 2);
  assert.ok(graph.awareness('/login', 60_000) < 0.01);
  const { sensor, request } = harness();
  try {
    request('/'); request('/login');
    for (let i = 0; i < 40; i++) request('/admin', 404, 10);
    const clean = request('/login', 200, 10, { clientKey: 'ordinary-new-visitor' });
    assert.equal(clean.decision.state, 'CALM'); assert.equal(clean.decision.confidence, 0); assert.ok(clean.decision.risk <= 0.8);
  } finally { sensor.close(); graph.close(); }
});
test('resonance V2 requires distinct Eyes and expires bounded temporal evidence', () => {
  const make = (eye: Signal['eye']): Signal => ({ eye, signal: eye, intensity: 3, confidence: 0.8, reason: 'test', decay: 0.035, timestamp: 1000 });
  assert.equal(resonanceV2(Array.from({ length: 20 }, () => make('route')), 1000).value, 0);
  const pair = resonanceV2([make('route'), make('authentication')], 1000);
  assert.equal(pair.eyes.length, 2); assert.ok(pair.value <= 1.5);
  assert.ok(resonanceV2([make('route'), make('authentication'), make('movement')], 1000).value > pair.value);
  assert.equal(resonanceV2([make('route'), make('authentication')], 32_000).value, 0);
});
test('per-Eye caps, confidence components, decayed losses and risk remain separately explainable', () => {
  const { sensor, request, advance } = harness({ signalRetentionMs: 60_000, maxSignals: 16 });
  try {
    request('/');
    for (let i = 0; i < 40; i++) request(['/admin', '/backup', '/config.old', '/admin-old'][i % 4]!, 404, 25,
      { authentication: { type: 'login_failure', identityKey: 'private-' + i % 3 } });
    advance(40_000);
    const decision = request('/', 200).decision;
    const totals = new Map<string, number>();
    for (const item of decision.contributions.filter((item) => item.eye !== 'physics')) totals.set(item.eye, (totals.get(item.eye) ?? 0) + item.value);
    for (const value of totals.values()) assert.ok(value <= 5 + 1e-10);
    assert.equal(decision.calibration?.kind, 'heuristic');
    assert.ok(decision.adjustments?.some((item) => item.value < 0 && item.reason.includes('do not subtract twice')));
    assert.ok(Math.abs(decision.risk - decision.contributions.reduce((n, item) => n + item.value, 0)) <= 0.011);
    assert.notEqual(decision.risk, decision.confidence); assert.notEqual(decision.energy, decision.confidence);
    advance(120_000);
    const expired = request('/', 200).decision;
    assert.equal(expired.evidenceEyes.length, 0);
  } finally { sensor.close(); }
});
test('separate recovery thresholds and clean-time inertia prevent state flapping', () => {
  const model: Inertia = { state: 'CURIOUS', upward: 0, clean: 0, changedAt: 0 };
  for (let i = 0; i < 20; i++) assert.equal(transition(model, 'CALM', false, 20_000 + i, 1.5), 'CURIOUS');
  assert.equal(transition(model, 'CALM', false, 21_000, 0.5), 'CALM');
  const hostile: Inertia = { state: 'HOSTILE', upward: 0, clean: 0, changedAt: 0 };
  for (let i = 0; i < 20; i++) assert.equal(transition(hostile, 'CALM', false, i * 100, 0), 'HOSTILE');
  assert.equal(transition(hostile, 'CALM', false, 16_000, 0), 'SUSPICIOUS');
  assert.equal(transition(hostile, 'HOSTILE', true, 16_010, 30), 'SUSPICIOUS');
});
test('Authentication Eye never infers credentials from response codes alone', () => {
  const { sensor, request } = harness();
  try {
    const event = request('/login', 401);
    assert.deepEqual(AuthenticationEye({ event: event.observation, history: [event.observation] }), []);
  } finally { sensor.close(); }
});
