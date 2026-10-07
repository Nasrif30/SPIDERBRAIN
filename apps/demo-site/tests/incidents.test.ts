import test from 'node:test';
import assert from 'node:assert/strict';
import { get as httpGet } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Sensor, type PayloadPattern } from '@spiderbrain/sensor';
import { detectPayload } from '../server/payload.js';
import { classifyBehavior, IncidentBook } from '../server/incidents.js';
import { LocalCollector, validRequest } from '../server/collector.js';
import { startIntegrated } from '../server/main.js';
import { attackCategories } from '../shared/incidents.js';
import { siteRoutes } from '../shared/catalog.js';
import type { RequestRecord } from '../shared/protocol.js';

test('bounded payload analysis recognizes structure flags but ignores passwords, tokens, private form fields and getters', () => {
  const cases: [string, PayloadPattern][] = [["' OR 1=1 -- TEST_ONLY", 'sql_like'], ['<script>test-only</script>', 'script_like'], ['../../test-only.txt', 'path_traversal'], ['; whoami', 'shell_like']];
  for (const [input, pattern] of cases) assert.deepEqual(detectPayload('/search?q=' + encodeURIComponent(input), {}), [pattern]);
  assert.deepEqual(detectPayload('/search?q=' + encodeURIComponent('%252e%252e%252fexample'), {}), ['path_traversal']);
  assert.deepEqual(detectPayload('/login', { password: cases[0]![0], token: cases[1]![0], message: cases[2]![0], email: cases[3]![0] }), []);
  assert.deepEqual(detectPayload('/search?token=' + encodeURIComponent(cases[0]![0]), {}), []);
  assert.deepEqual(detectPayload('/search?q=ordinary+field+notes', { username: "O'Brien", path: 'notes/2026', input: 'less < noise' }), []);
  const getter = Object.defineProperty({}, 'username', { get() { throw new Error('Must not inspect getters'); } });
  assert.deepEqual(detectPayload('/login', getter), []);
  assert.deepEqual(detectPayload('/search?q=' + 'a'.repeat(4096) + encodeURIComponent(cases[1]![0]), {}), []);
});

test('Payload Anomaly Eye is capped and decays; repeated payload evidence alone cannot create HOSTILE', () => {
  let now = Date.now(); const sensor = new Sensor({ memory: false, publicRoutes: siteRoutes, clock: () => now });
  try {
    for (let i = 0; i < 20; i++) {
      now += 5000;
      const event = sensor.observe({ clientKey: 'isolated-test-cohort', path: '/search', method: 'GET', status: 200, latency: 1, payload: ['sql_like', 'script_like', 'path_traversal', 'shell_like'] })!;
      assert.equal(event.signals.filter(s => s.eye === 'payload').length, 4);
      assert.ok(event.decision.contributions.filter(c => c.eye === 'payload').reduce((sum, c) => sum + c.value, 0) <= 5);
      assert.ok(!['ALERT', 'SUSPICIOUS', 'HOSTILE'].includes(event.decision.state)); assert.ok(event.decision.confidence < .65);
    }
    const before = sensor.sessions()[0]!.decision!.risk; now += 180_000;
    const clean = sensor.observe({ clientKey: 'isolated-test-cohort', path: '/search', method: 'GET', status: 200, latency: 1 })!;
    assert.ok(clean.decision.risk < before); assert.equal(clean.signals.some(s => s.eye === 'payload'), false);
  } finally { sensor.close(); }
});

function fixtureRows() {
  const sensor = new Sensor({ memory: false, publicRoutes: siteRoutes }), collector = new LocalCollector(sensor);
  for (let i = 0; i < 8; i++) collector.observe({ clientKey: 'unit-incident-cohort', path: '/login', method: 'POST', status: 401, latency: 1,
    authentication: { type: 'login_failure', identityKey: 'fixed-demo-test-' + i % 3 }, payload: ['sql_like'] });
  const rows = collector.session(sensor.sessions()[0]!.id); sensor.close(); return rows;
}

test('route-aware classification requires supporting behavior and recognizes payload, authentication, scanning and discovery labels', () => {
  const rows = fixtureRows(), last = rows.at(-1)!;
  const result = classifyBehavior(last, rows); assert.ok(result.categories.includes('SQL_INJECTION_SUSPECTED')); assert.ok(result.categories.includes('CREDENTIAL_STUFFING_PATTERN'));
  const ordinary = structuredClone(rows[0]!); ordinary.vibration.decision.state = 'CALM'; ordinary.vibration.decision.contributions = []; ordinary.vibration.observation.payload = [];
  for (const route of ['/login', '/admin-demo', '/.env-demo']) { ordinary.currentRoute = route; assert.deepEqual(classifyBehavior(ordinary, [ordinary]).categories, []); }
  for (const [pattern, label] of [['script_like', 'XSS_PATTERN'], ['path_traversal', 'PATH_TRAVERSAL_PATTERN'], ['shell_like', 'COMMAND_INJECTION_PATTERN']] as const) {
    const altered = structuredClone(rows); for (const row of altered) { row.currentRoute = '/search'; row.vibration.observation.payload = [pattern]; }
    assert.ok(classifyBehavior(altered.at(-1)!, altered).categories.includes(label));
  }
  const brute = structuredClone(rows); for (const row of brute) { row.vibration.observation.authentication!.identityId = 'SB-I-' + 'a'.repeat(24); row.vibration.observation.payload = []; }
  assert.ok(classifyBehavior(brute.at(-1)!, brute).categories.includes('AUTH_BRUTE_FORCE'));
  const scan = structuredClone(rows); const routes = ['/admin-demo', '/backup-demo', '/.env-demo', '/config-demo', '/internal-demo', '/.git-demo', '/admin-old-demo', '/.env-demo'];
  scan.forEach((row, i) => { row.currentRoute = routes[i]!; row.vibration.observation.status = 404; row.vibration.observation.payload = []; row.transport = { cloudflarePresent: false, userAgentClass: 'automation', forwardedAddressClass: 'absent' }; });
  scan.at(-1)!.vibration.decision.contributions.push({ eye: 'route', signal: 'route enumeration', value: 2, confidence: .7, reason: 'test route evidence' }, { eye: 'movement', signal: 'abnormal navigation', value: 2, confidence: .7, reason: 'test movement evidence' }, { eye: 'velocity', signal: 'velocity impulse', value: 2, confidence: .7, reason: 'test velocity evidence' });
  scan.at(-1)!.frequencyPerSecond = 20; scan.at(-1)!.vibration.decision.entropy = 2;
  const labels = classifyBehavior(scan.at(-1)!, scan).categories;
  for (const label of ['SENSITIVE_ROUTE_DISCOVERY', 'ROUTE_ENUMERATION', 'AUTOMATED_SCANNING', 'REQUEST_FLOOD_PATTERN', 'ABNORMAL_NAVIGATION'] as const) assert.ok(labels.includes(label));
  const restricted = structuredClone(scan); for (const row of restricted) { row.currentRoute = '/admin-demo'; row.vibration.observation.status = 403; }
  restricted.at(-1)!.vibration.decision.contributions.push({ eye: 'error', signal: 'error pattern', value: 2, confidence: .7, reason: 'test denial evidence' });
  assert.ok(classifyBehavior(restricted.at(-1)!, restricted).categories.includes('REPEATED_RESTRICTED_ACCESS'));
  assert.ok(classifyBehavior(last, rows).categories.includes('SESSION_SWITCHING'));
  ordinary.vibration.decision.state = 'ALERT'; assert.ok(classifyBehavior(ordinary, [ordinary]).categories.includes('UNKNOWN_ANOMALOUS_BEHAVIOR')); assert.equal(attackCategories.length, 14);
});

test('incident retention coalesces repeated evidence, caps reports, expires old records and isolates returned mutation', () => {
  const rows = fixtureRows(), book = new IncidentBook(2, 1000), first = rows.at(-1)!;
  book.observe(first, rows); const report = book.recent(undefined, undefined, first.timestamp)[0]!; assert.ok(report.id.startsWith('SB-IR-')); assert.equal(report.category, 'SQL_INJECTION_SUSPECTED');
  book.observe(first, rows); assert.equal(book.recent(undefined, undefined, first.timestamp).length, 1); assert.equal(book.get(report.id, first.timestamp)!.id, report.id);
  report.evidence.push('MUTATED'); assert.equal(book.get(report.id, first.timestamp)!.evidence.includes('MUTATED'), false);
  for (let i = 0; i < 3; i++) { const next = { ...first, sessionId: 'SB-' + String(i).repeat(24) }; book.observe(next, rows); }
  assert.equal(book.recent(undefined, undefined, first.timestamp).length, 2); assert.equal(book.recent(undefined, undefined, first.timestamp + 1001).length, 0);
});

test('real HTTP anomalies produce safe incident reports and JSON exports through the existing scoring/SSE pipeline; remote dashboard access stays denied', async () => {
  const app = await startIntegrated({ sitePort: 0, dashboardPort: 0, memory: ':memory:', logs: false });
  const sentinel = "' OR 1=1 -- RAW_INPUT_SENTINEL", privatePassword = '<script>PRIVATE_PASSWORD_SENTINEL</script>';
  try {
    await fetch(app.siteUrl + '/');
    for (let i = 0; i < 24; i++) {
      const response = await fetch(app.siteUrl + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sentinel, password: privatePassword }) });
      assert.equal(response.status, 401); await response.text();
    }
    const origin = app.dashboardUrl!.replace('/web', ''), result = await (await fetch(origin + '/web/incidents')).json() as { incidents: ReturnType<IncidentBook['recent']> };
    const report = result.incidents.find(value => value.category === 'SQL_INJECTION_SUSPECTED')!; assert.ok(report); assert.ok(report.signals.some(s => s.eye === 'payload')); assert.ok(report.signals.some(s => s.eye === 'authentication'));
    assert.match(report.summary, /Possible/); assert.ok(report.timeline.some(row => row.events.includes('AUTH_FAILURE'))); assert.ok(report.timeline.some(row => row.previousState !== row.state)); assert.ok(report.confidence <= .95);
    const serialized = JSON.stringify({ report, records: app.collector.session(report.sessionId), memory: app.sensor.memory!.events() });
    for (const secret of [sentinel, 'RAW_INPUT_SENTINEL', 'PRIVATE_PASSWORD_SENTINEL', '<script>', 'OR 1=1']) assert.equal(serialized.includes(secret), false);
    const download = await fetch(origin + '/web/incidents/' + report.id + '/export'); assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition')!, /attachment/); const exported = await download.json(); assert.deepEqual(exported, report);
    const route = await (await fetch(origin + '/web/route-report?route=%2Flogin')).json() as { sessions: string[]; incidents: unknown[] }; assert.ok(route.sessions.includes(report.sessionId)); assert.ok(route.incidents.length);
    const html = await (await fetch(origin + '/web')).text(), js = await (await fetch(origin + '/web.js')).text(); assert.ok(html.includes('Recent incidents')); assert.ok(html.includes('SPIDERBRAIN INCIDENT REPORT')); assert.ok(js.includes('originalNodeSelect')); assert.ok(js.includes('EXPORT JSON')); assert.equal(js.includes('innerHTML'), false);
    assert.equal(await new Promise<number|undefined>((resolve, reject) => { httpGet(origin + '/web/incidents/' + report.id + '/export', { headers: { Host: 'untrusted.trycloudflare.com' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); }), 403);
    assert.equal((await fetch(app.siteUrl + '/web/incidents')).status, 404);
    const live = await (await fetch(origin + '/web/snapshot')).json() as { strongest: { signals: { eye: string }[] } }; assert.ok(live.strongest.signals.some(signal => signal.eye === 'payload'));
  } finally { await app.close(); }
});

test('collector rejects raw payload values, duplicate flags and accessor arrays before sensing', () => {
  const sensor = new Sensor({ memory: false, publicRoutes: siteRoutes }), collector = new LocalCollector(sensor);
  try {
    collector.observe({ clientKey: 'schema-cohort', path: '/search', method: 'GET', status: 200, latency: 1 });
    const input = { schemaVersion: 1, requestId: randomUUID(), clientId: 'SB-' + 'a'.repeat(24), timestamp: Date.now(), route: '/search', method: 'GET', status: 200, latencyMs: 1, labResource: false };
    assert.ok(validRequest({ ...input, payload: ['sql_like'] }));
    for (const payload of [['sql_like', 'sql_like'], ['RAW_VALUE_SENTINEL'], { sql_like: true }, ['sql_like', 'script_like', 'path_traversal', 'shell_like', 'sql_like']]) assert.equal(collector.receive({ ...input, payload }), undefined);
    const array = Object.defineProperty([], '0', { get() { throw new Error('Getter must not run'); } }); assert.equal(collector.receive({ ...input, payload: array }), undefined);
    assert.equal(sensor.status().vibrations, 1);
  } finally { sensor.close(); }
});
