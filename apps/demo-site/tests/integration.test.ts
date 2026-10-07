import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, get as httpGet, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, join } from 'node:path';
import { Sensor } from '@spiderbrain/sensor';
import { startIntegrated } from '../server/main.js';
import { LocalCollector, validRequest } from '../server/collector.js';
import { DemoLog } from '../server/log.js';
import { labResources, siteRoutes } from '../shared/catalog.js';
import type { CollectedRequest, RequestRecord } from '../shared/protocol.js';
import { demoAccess } from '../server/access.js';
const fixture = () => startIntegrated({ sitePort: 0, dashboardPort: 0, memory: ':memory:', logs: false });
const get = async (url: string) => { const response = await fetch(url, { redirect: 'error' }); const text = await response.text(); return { response, text }; };
const post = async (url: string, body: unknown, headers: Record<string,string> = {}) => { const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'error' }); await response.text(); return response; };
const request = (): CollectedRequest => ({ schemaVersion: 1, requestId: randomUUID(), clientId: 'SB-' + 'a'.repeat(24), timestamp: Date.now(), route: '/products', method: 'GET', status: 200, latencyMs: 2, labResource: false });
const hostRequest = (url: string, headers: Record<string, string>, method = 'GET', body?: string) => new Promise<{ status: number; text: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
  const outgoing = httpRequest(url, { method, headers }, response => {
    let text = ''; response.setEncoding('utf8'); response.on('data', (chunk: string) => { text += chunk; });
    response.on('end', () => resolve({ status: response.statusCode!, text, headers: response.headers })); response.on('error', reject);
  }); outgoing.setTimeout(5000, () => outgoing.destroy(new Error('Local request timeout'))); outgoing.on('error', reject); outgoing.end(body);
});
async function modeFixture(value: string | undefined) {
  const previous = process.env['SPIDERBRAIN_REMOTE_DEMO'];
  if (value === undefined) delete process.env['SPIDERBRAIN_REMOTE_DEMO']; else process.env['SPIDERBRAIN_REMOTE_DEMO'] = value;
  try { return await fixture(); } finally { if (previous === undefined) delete process.env['SPIDERBRAIN_REMOTE_DEMO']; else process.env['SPIDERBRAIN_REMOTE_DEMO'] = previous; }
}
function cleanup(path: string) { const target = resolve(path); assert.equal(dirname(target), resolve(tmpdir())); assert.ok(basename(target).startsWith('spiderbrain-labs-')); rmSync(target, { recursive: true, force: true }); }

test('collector validates a strict sanitized schema, rejects secret fields/getters, and deduplicates request IDs before sensing', () => {
  const sensor = new Sensor({ memory: false, publicRoutes: siteRoutes }), collector = new LocalCollector(sensor);
  try {
    const input = request(); assert.ok(validRequest(input));
    for (const invalid of [null, {}, {...input,password:'credential'}, {...input,route:'/products?token=secret'}, {...input,clientId:'127.0.0.1'}, {...input,status:NaN}, {...input,latencyMs:Infinity}, {...input,labResource:true}, {...input,authentication:{type:'login_failure',password:'secret'}}, {...input,authentication:{type:'invalid'}}, {...input,transport:{cloudflarePresent:true,forwardedAddressClass:'ipv4',userAgentClass:'browser',ip:'192.0.2.10'}}, {...input,transport:{cloudflarePresent:'true',forwardedAddressClass:'ipv4',userAgentClass:'browser'}}, {...input,transport:{cloudflarePresent:true,forwardedAddressClass:'192.0.2.10',userAgentClass:'browser'}}, {...input,timestamp:Date.now()-120_000}]) assert.equal(collector.receive(invalid), undefined);
    let read = false; const accessor = {...input}; Object.defineProperty(accessor,'password',{enumerable:true,get(){read=true;throw new Error('Getter must not run');}}); assert.equal(collector.receive(accessor), undefined); assert.equal(read,false);
    assert.ok(collector.receive(input)); assert.equal(collector.receive(input),undefined); assert.equal(sensor.status().vibrations,1); assert.equal(collector.counters().duplicates,1); assert.ok(collector.counters().rejected>=10);
  } finally { sensor.close(); }
});

test('real page requests create anonymous sessions, exact navigation edges, normalized product IDs and typed transition events', async () => {
  const app = await fixture();
  try {
    for (const route of ['/','/products','/login','/admin-demo','/.env-demo']) await get(app.siteUrl+route);
    const session = app.sensor.sessions()[0]!; assert.match(session.id,/^SB-[a-f0-9]{24}$/); assert.equal(session.requests,5);
    const records=app.collector.session(session.id); assert.deepEqual(records.map(row=>row.currentRoute),['/','/products','/login','/admin-demo','/.env-demo']);
    assert.ok(records[0]!.events.some(event=>event.type==='SESSION_CREATED')); assert.equal(records[1]!.previousRoute,'/'); assert.ok(records[1]!.events.some(event=>event.type==='ROUTE_TRANSITION'));
    const graph=app.sensor.liveWeb().graph; for(const [from,to] of [['/','/products'],['/products','/login'],['/login','/admin-demo'],['/admin-demo','/.env-demo']])assert.ok(graph.edges.some(edge=>edge.from===from&&edge.to===to));
    await get(app.siteUrl+'/products/route-atlas?token=discard-me'); const last=app.collector.session(session.id).at(-1)!; assert.equal(last.currentRoute,'/products/:redacted'); assert.equal(JSON.stringify(last).includes('discard-me'),false); assert.equal(JSON.stringify(last).includes('route-atlas'),false);
    const inspection=await(await fetch(app.dashboardUrl!.replace('/web','')+'/web/session/'+session.id)).json() as {requests:RequestRecord[]}; assert.equal(inspection.requests.length,6); assert.ok(inspection.requests.every(row=>row.requestId&&row.vibration.decision.confidence>=0));
  } finally { await app.close(); }
});

test('fictional login emits attempts/outcomes, activates Authentication Eye, protects account routes, and stores no submitted credentials', async () => {
  const app=await fixture();
  try {
    assert.equal((await get(app.siteUrl+'/account')).response.status,403);
    for(let i=0;i<6;i++)assert.equal((await post(app.siteUrl+'/login',{username:'demo',password:'UNIQUE_PASSWORD_NEVER_STORE',email:'PRIVATE_FORM_NEVER_STORE'},{authorization:'Bearer PRIVATE_HEADER_NEVER_STORE',cookie:'secret=PRIVATE_COOKIE_NEVER_STORE'})).status,401);
    const session=app.sensor.sessions()[0]!,rows=app.collector.session(session.id),serialized=JSON.stringify({rows,inspection:app.sensor.inspect(session.id),events:app.sensor.memory!.events()});
    for(const secret of ['UNIQUE_PASSWORD_NEVER_STORE','PRIVATE_FORM_NEVER_STORE','PRIVATE_HEADER_NEVER_STORE','PRIVATE_COOKIE_NEVER_STORE','fixed-demo-account:demo'])assert.equal(serialized.includes(secret),false);
    assert.ok(rows.some(row=>row.events.some(event=>event.type==='AUTH_ATTEMPT'))); assert.ok(rows.some(row=>row.events.some(event=>event.type==='AUTH_FAILURE'))); assert.ok(rows.some(row=>row.vibration.signals.some(signal=>signal.eye==='authentication')));
    const success=await post(app.siteUrl+'/login',{username:'analyst',password:'lab-only'}); assert.equal(success.status,200); const cookie=success.headers.get('set-cookie')!.split(';')[0]!; assert.match(success.headers.get('set-cookie')!,/HttpOnly/); assert.match(success.headers.get('set-cookie')!,/SameSite=Strict/);
    const account=await fetch(app.siteUrl+'/account',{headers:{cookie}}); assert.equal(account.status,200); await account.text(); assert.ok(app.collector.session(session.id).some(row=>row.events.some(event=>event.type==='AUTH_SUCCESS')));
    const raw=JSON.stringify(app.collector.session(session.id)); assert.equal(raw.includes(cookie),false); assert.equal(raw.includes('lab-only'),false);
    assert.equal((await post(app.siteUrl+'/settings',{workspace:'team',digest:true},{cookie})).status,200);
    const settings=await(await fetch(app.siteUrl+'/settings',{headers:{cookie}})).text(); assert.ok(settings.includes('"workspace":"team"')); assert.ok(settings.includes('"digest":true'));
    assert.equal((await post(app.siteUrl+'/logout',{}, {cookie})).status,200); assert.equal((await fetch(app.siteUrl+'/account',{headers:{cookie}})).status,403);
  } finally { await app.close(); }
});

test('lab specimens have explicit statuses and safe metadata; environment values, host files and private form contents cannot be exposed', async () => {
  const app=await fixture(),directory=mkdtempSync(join(tmpdir(),'spiderbrain-labs-files-')),secret='REAL_HOST_FILE_SENTINEL_DO_NOT_EXPOSE';
  const old=process.env['SPIDERBRAIN_REAL_SECRET']; process.env['SPIDERBRAIN_REAL_SECRET']='ENVIRONMENT_SENTINEL_DO_NOT_EXPOSE'; writeFileSync(join(directory,'private.txt'),secret);
  try {
    for(const [route,resource] of Object.entries(labResources)){const result=await get(app.siteUrl+route);assert.equal(result.response.status,resource.status);assert.equal(result.text.includes(secret),false);assert.equal(result.text.includes('ENVIRONMENT_SENTINEL_DO_NOT_EXPOSE'),false);}
    const rows=app.collector.session(app.sensor.sessions()[0]!.id); assert.equal(rows.length,8); assert.ok(rows.every(row=>row.events.some(event=>event.type==='LAB_RESOURCE_ACCESS'))); assert.equal(app.sensor.status().honeyTouches,0);
    for(const route of ['/.git/config','/.env','/package.json','/@fs/'+directory.replaceAll('\\','/')+'/private.txt','/assets/..%2f..%2fprivate.txt']){const result=await get(app.siteUrl+route);assert.ok(result.response.status>=400);assert.equal(result.text.includes(secret),false);assert.equal(result.text.includes('ENVIRONMENT_SENTINEL_DO_NOT_EXPOSE'),false);}
    await post(app.siteUrl+'/contact',{name:'PRIVATE_NAME_SENTINEL',message:'PRIVATE_MESSAGE_SENTINEL'});const stored=JSON.stringify({records:app.collector.session(app.sensor.sessions()[0]!.id),memory:app.sensor.memory!.events()});assert.equal(stored.includes('PRIVATE_NAME_SENTINEL'),false);assert.equal(stored.includes('PRIVATE_MESSAGE_SENTINEL'),false);
    const html=await(await fetch(app.siteUrl+'/.env-demo')).text(),asset=/src="(\/assets\/[^\"]+\.js)"/.exec(html)![1]!;const js=await(await fetch(app.siteUrl+asset)).text();assert.ok(js.includes('FAKE_PASSWORD'));assert.equal(js.includes('ENVIRONMENT_SENTINEL_DO_NOT_EXPOSE'),false);assert.equal(js.includes(secret),false);
  } finally { if(old===undefined)delete process.env['SPIDERBRAIN_REAL_SECRET'];else process.env['SPIDERBRAIN_REAL_SECRET']=old;await app.close();cleanup(directory); }
});

test('repeated actual requests accumulate independent Eyes, resonance and inertial classification while risk remains separate from confidence', async () => {
  const app=await fixture();
  try {
    for(const route of ['/','/products','/about'])await get(app.siteUrl+route); assert.equal(app.sensor.status().spiderSense,'CALM');
    for(let i=0;i<45;i++){if(i%3===0)await post(app.siteUrl+'/login',{username:i%2?'visitor':'demo',password:'wrong-demo'});else await get(app.siteUrl+(i%2?'/admin-demo':'/config-demo'));}
    const rows=app.collector.session(app.sensor.sessions()[0]!.id);assert.ok(rows.some(row=>row.events.some(event=>event.type==='VELOCITY_CHANGE')));assert.ok(rows.some(row=>row.events.some(event=>event.type==='REPEATED_ROUTE')));assert.ok(rows.some(row=>row.vibration.decision.resonance>0));assert.ok(rows.some(row=>['ALERT','SUSPICIOUS','HOSTILE'].includes(row.vibration.decision.state)));
    const last=rows.at(-1)!;assert.ok(last.vibration.decision.risk>last.vibration.decision.confidence);assert.ok(last.vibration.decision.confidence<=.95);assert.ok(rows.some(row=>row.vibration.decision.previousState!==row.vibration.decision.state));
    await get(app.siteUrl+'/products');const graph=app.sensor.liveWeb().graph;assert.ok(graph.edges.some(edge=>edge.transitions>1));
  } finally { await app.close(); }
});

test('SSE delivers runtime graph updates and real request pulses, while dashboard identity and session inspection are preserved', async () => {
  const app=await fixture(),controller=new AbortController();
  try {
    const origin=app.dashboardUrl!.replace('/web',''),response=await fetch(origin+'/web/events',{signal:controller.signal});assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/event-stream/);
    const reader=response.body!.getReader(),decoder=new TextDecoder();let output='';
    const readUntil=async(expected:string)=>{const deadline=Date.now()+5000;while(!output.includes(expected)){assert.ok(Date.now()<deadline,'SSE deadline exceeded');const part=await Promise.race([reader.read(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('SSE timeout')),5000).unref())]);if(part.done)break;output+=decoder.decode(part.value);}return output;};
    await readUntil('event: web');output='';await get(app.siteUrl+'/products');await get(app.siteUrl+'/login');const live=await readUntil('"vibrations":2');assert.ok(live.includes('"route":"/products"'));assert.ok(live.includes('"route":"/login"'));assert.ok(live.includes('"pulses":['));assert.ok(live.includes('"from":"/products"'));
    const html=await(await fetch(origin+'/web')).text();assert.ok(html.includes('SYNGANGLION'));assert.ok(html.includes('Strongest recent vibration'));assert.ok(html.includes('session-autopsy'));
    const javascript=await(await fetch(origin+'/web.js')).text();assert.ok(javascript.includes('new EventSource'));assert.ok(javascript.includes('Inspect session'));await reader.cancel();
  } finally { controller.abort();await app.close(); }
});

test('loopback services reject rebinding, cross-origin mutation and arbitrary collector targets; closed sensing does not break the website', async () => {
  const app=await fixture();
  try {
    const origin=app.dashboardUrl!.replace('/web','');const rebound=await new Promise<number|undefined>((resolve,reject)=>{httpGet(origin+'/web',{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});assert.equal(rebound,403);assert.equal((await fetch(origin+'/web/snapshot',{headers:{origin:'https://evil.example'}})).status,403);assert.equal((await post(app.siteUrl+'/login',{username:'demo',password:'lab-only'},{origin:'https://evil.example'})).status,403);
    assert.equal((await post(origin+'/collect',{target:'https://external.example'})).status,403);assert.equal((await get(origin+'/collect')).response.status,404);
    app.sensor.close();assert.equal((await get(app.siteUrl+'/products')).response.status,200);assert.equal((await post(app.siteUrl+'/login',{username:'demo',password:'lab-only'})).status,200);
  } finally { await app.close(); }
});

test('dashboard listener collision selects another loopback port and leaves the demo website functional', async () => {
  const occupied=createServer((_req,res)=>res.end('owned test listener'));await new Promise<void>(resolve=>occupied.listen(0,'127.0.0.1',resolve));const address=occupied.address();assert.ok(address&&typeof address!=='string');
  const app=await startIntegrated({sitePort:0,dashboardPort:address.port,memory:false,logs:false});
  try {assert.ok(app.dashboardUrl);assert.notEqual(new URL(app.dashboardUrl).port,String(address.port));assert.equal((await get(app.dashboardUrl)).response.status,200);assert.equal((await get(app.siteUrl+'/')).response.status,200);assert.equal(app.sensor.status().vibrations,1);}finally{await app.close();await new Promise<void>(resolve=>occupied.close(()=>resolve()));}
});

test('remote mode defaults off; unset/0/other values accept loopback aliases and reject public hosts even with proxy headers', async () => {
  for (const mode of [undefined, '0', 'true']) {
    const app = await modeFixture(mode), port = new URL(app.siteUrl).port;
    try {
      for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
        const result = await hostRequest(app.siteUrl + '/products', { Host: host, Origin: `http://${host}` });
        assert.equal(result.status, 200); assert.ok(result.text.includes('id="root"'));
      }
      const result = await hostRequest(app.siteUrl + '/', { Host: 'changing-example.trycloudflare.com', 'CF-Ray': 'untrusted-proxy-marker', 'X-Forwarded-Host': `127.0.0.1:${port}`, 'X-Forwarded-For': '127.0.0.1' });
      assert.equal(result.status, 403); assert.equal(result.text, 'Local demo access only'); assert.equal(app.sensor.status().vibrations, 3);
    } finally { await app.close(); }
  }
});

test('explicit remote mode serves real pages/assets/auth through changing public Hosts, keeps telemetry, and leaves dashboard/internal services local', async () => {
  const app = await modeFixture('1'), host = 'first-random.trycloudflare.com', headers = { Host: host, Origin: 'https://' + host,
    'CF-Ray': 'PROXY_HEADER_VALUE_NEVER_STORE', 'CF-Connecting-IP': '192.0.2.199', 'X-Forwarded-For': '192.0.2.199',
    'User-Agent': 'Mozilla/5.0 PRIVATE_AGENT_VALUE_NEVER_STORE' };
  try {
    assert.equal((await get(app.siteUrl + '/')).response.status, 200);
    assert.equal((await hostRequest(app.siteUrl + '/', { Host: 'second-random.trycloudflare.com', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' })).status, 200);
    for (const [route, status] of [['/products', 200], ['/login', 200], ['/admin-demo', 403], ['/.env-demo', 200]] as const) {
      const result = await hostRequest(app.siteUrl + route, headers); assert.equal(result.status, status); assert.ok(result.text.includes('id="root"'));
    }
    const html = (await hostRequest(app.siteUrl + '/', headers)).text, asset = /src="(\/assets\/[^\"]+\.js)"/.exec(html)![1]!;
    const before = app.sensor.status().vibrations; assert.equal((await hostRequest(app.siteUrl + asset, headers)).status, 200); assert.equal(app.sensor.status().vibrations, before);
    const auth = await hostRequest(app.siteUrl + '/login', { ...headers, 'Content-Type': 'application/json' }, 'POST', JSON.stringify({ username: 'demo', password: 'lab-only' }));
    assert.equal(auth.status, 200); const cookie = auth.headers['set-cookie']![0]!.split(';')[0]!; assert.match(auth.headers['set-cookie']![0]!, /Secure/);
    assert.equal((await hostRequest(app.siteUrl + '/account', { ...headers, Cookie: cookie })).status, 200);
    const session = app.sensor.sessions()[0]!, rows = app.collector.session(session.id), proxyRows = rows.filter(row => row.transport?.cloudflarePresent);
    assert.ok(proxyRows.length >= 6); assert.ok(proxyRows.every(row => row.transport?.forwardedAddressClass === 'ipv4' && row.transport.userAgentClass === 'browser'));
    assert.ok(rows.some(row => row.events.some(event => event.type === 'AUTH_SUCCESS'))); assert.ok(app.sensor.liveWeb().graph.edges.some(edge => edge.from === '/products' && edge.to === '/login'));
    const serialized = JSON.stringify({ rows, memory: app.sensor.memory!.events() }); for (const secret of ['192.0.2.199', 'PROXY_HEADER_VALUE_NEVER_STORE', 'PRIVATE_AGENT_VALUE_NEVER_STORE', cookie, 'lab-only']) assert.equal(serialized.includes(secret), false);
    const dashboardOrigin = app.dashboardUrl!.replace('/web', '');
    for (const route of ['/web', '/web/events', '/web/snapshot', '/web/collector', '/web/session/' + session.id]) assert.equal((await hostRequest(dashboardOrigin + route, headers)).status, 403);
    assert.equal((await hostRequest(app.internalTelemetryUrl! + '/web/snapshot', headers)).status, 403);
    assert.equal((await get(app.dashboardUrl!)).response.status, 200);
    assert.equal((await get(dashboardOrigin + '/web/snapshot')).response.status, 200);
    for (const route of ['/web/snapshot', '/web/collector', '/package.json', '/.env', '/.git/config']) assert.equal((await hostRequest(app.siteUrl + route, headers)).status, 404);
    assert.equal((await hostRequest(app.siteUrl + '/login', { ...headers, Origin: 'https://unrelated.example' }, 'POST', '{}')).status, 403);
    assert.equal((await hostRequest(app.siteUrl + '/login', { ...headers, 'Sec-Fetch-Site': 'cross-site' }, 'POST', '{}')).status, 403);
  } finally { await app.close(); }
});

test('remote mode never uses forwarded host/IP/proto as authentication and rejects malformed authorities and cross-site subresources', () => {
  for (const Host of ['evil.example@localhost:4173', 'evil.example/path', 'evil.example:99999', '127.0.0.2:4173', '-bad.example', 'bad..example', 'localhost:9999']) assert.equal(demoAccess({ host: Host }, 'GET', '127.0.0.1:4173', true).allowed, false);
  assert.equal(demoAccess({ host: 'valid.example', origin: 'https://other.example', 'x-forwarded-host': 'other.example', 'x-forwarded-proto': 'https' }, 'POST', '127.0.0.1:4173', true).allowed, false);
  assert.equal(demoAccess({ host: 'valid.example', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' }, 'GET', '127.0.0.1:4173', true).allowed, false);
  assert.equal(demoAccess({ host: 'valid.example' }, 'GET', '127.0.0.1:4173', true).allowed, true);
});

test('async local logs retain sanitized runtime records with bounded pressure and rotation', async () => {
  const directory=mkdtempSync(join(tmpdir(),'spiderbrain-labs-log-')),sensor=new Sensor({memory:false,publicRoutes:siteRoutes}),collector=new LocalCollector(sensor),logger=new DemoLog(directory);
  try {
    const event=collector.observe({clientKey:'PRIVATE_ADDRESS_NEVER_STORE',path:'/products?key=PRIVATE_QUERY_NEVER_STORE',method:'GET',status:200,latency:1})!;const row=collector.session(event.observation.sessionId)[0]!;
    writeFileSync(logger.path,'x'.repeat(5*1024*1024-100));const rotating=new DemoLog(directory);rotating.append(row);await rotating.close();assert.ok(statSync(logger.path.replace('traffic.jsonl','traffic.previous.jsonl')).size<=5*1024*1024);
    for(let i=0;i<600;i++)logger.append(row);assert.equal(logger.dropped,88);await logger.close();assert.equal(logger.processed,512);const text=readFileSync(logger.path,'utf8');assert.equal(text.includes('PRIVATE_ADDRESS_NEVER_STORE'),false);assert.equal(text.includes('PRIVATE_QUERY_NEVER_STORE'),false);assert.ok(text.includes('ROUTE_VISIT'));assert.ok(statSync(logger.path).size<=5*1024*1024);
  } finally {await logger.close();sensor.close();cleanup(directory);}
});
