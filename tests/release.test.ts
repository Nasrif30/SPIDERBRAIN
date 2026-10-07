import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, get } from 'node:http';
import { fileURLToPath } from 'node:url';
import { spiderbrain, aiEventTypes, noteAuthentication } from '../sdk/index.js';
import { startMonitor, validateTarget } from '../sdk/proxy.js';
import { listenLocal, closeLocal } from '../sdk/network.js';
import { browserCommand } from '../cli/open.js';
import { startIntegrated } from '../apps/demo-site/server/main.js';
import { Sensor, startTelemetry } from '@spiderbrain/sensor';
import { startDashboard } from '../cli/start.js';

test('public startup serves only the local dashboard and observation services', async () => {
  const app = await startDashboard({ dashboardPort: 0, memory: false });
  try {
    assert.equal('siteUrl' in app, false);
    assert.ok(app.telemetryUrl);
    const response = await fetch(app.dashboardUrl!);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Observed route web/);
    assert.ok(!html.includes('SPIDERBRAIN LABS') && !html.includes('Good tools. Better questions.'));
    const origin = new URL(app.dashboardUrl!).origin;
    const root = await fetch(origin + '/', { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/web');
    for (const path of ['/products', '/login', '/assets/index.js']) assert.equal((await fetch(origin + path)).status, 404);
    assert.equal(app.guardian.sensor.status().vibrations, 0);
    assert.equal(await new Promise<number | undefined>((resolve, reject) => get(app.dashboardUrl!, { headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject)), 403);
  } finally { await app.close(); }
});

test('preferred ports fall back to OS-selected loopback ports without discovery', async () => {
  const occupied = createServer(), available = createServer();
  try { const port = await listenLocal(occupied, 0); const selected = await listenLocal(available, port); assert.notEqual(selected, port); assert.equal((available.address() as {address:string}).address, '127.0.0.1'); }
  finally { await closeLocal(available); await closeLocal(occupied); }
});
test('Express SDK uses the existing engine, explicit authentication outcomes and safe metadata', async () => {
  const guardian = spiderbrain({ dashboard: true, dashboardPort: 0, memory: false });
  const app = express(); app.use(guardian); app.post('/login', (_req,res) => { noteAuthentication(res,{type:'login_failure'});res.sendStatus(401); });
  const server = createServer(app);
  try {
    const port = await listenLocal(server,0), urls = await guardian.ready;
    for(let i=0;i<24;i++) await (await fetch(`http://127.0.0.1:${port}/login`,{method:'POST',headers:{Authorization:'Bearer PRIVATE_SDK_SENTINEL',Cookie:'PRIVATE_COOKIE_SENTINEL'},body:'PRIVATE_BODY_SENTINEL'})).text();
    assert.equal(guardian.sensor.status().vibrations,24); assert.ok(guardian.collector.incidents.recent().some(r=>r.category==='AUTH_BRUTE_FORCE'));
    const snapshot = await(await fetch(urls.dashboardUrl!.replace('/web','')+'/web/snapshot')).text();assert.ok(!snapshot.includes('PRIVATE_'));assert.match(snapshot,/authentication/);
  } finally { await closeLocal(server); await guardian.close(); }
});
test('typed AI metadata joins the real engine, rejects content fields and never invokes accessors', async () => {
  const guardian=spiderbrain({memory:false,publicAINames:['demo-model','read_catalog']});
  try {
    for(const type of aiEventTypes)assert.ok(guardian.emit({type,sessionId:'PRIVATE_SESSION_SENTINEL',model:'demo-model',tool:'read_catalog',workflow:'PRIVATE_WORKFLOW_SENTINEL',durationMs:4}));
    const safe=JSON.stringify(guardian.aiEvents());assert.ok(safe.includes('demo-model'));assert.ok(!safe.includes('PRIVATE_'));assert.equal(guardian.sensor.status().vibrations,7);
    for(const extra of ['prompt','output','metadata','token'])assert.equal(guardian.emit({type:'AI_TOOL_CALL',sessionId:'test',[extra]:'PRIVATE_CONTENT_SENTINEL'} as never),undefined);
    const getter=Object.defineProperty({sessionId:'test'},'type',{get(){throw Error('accessor');}});assert.equal(guardian.emit(getter as never),undefined);
    const inherited=Object.create({get type(){throw Error('inherited accessor');}});assert.equal(guardian.emit(inherited),undefined);
    const first=guardian.aiEvents()[0]!;first.model='MUTATED';assert.notEqual(guardian.aiEvents()[0]!.model,'MUTATED');
    assert.equal(guardian.emit({type:'AI_MODEL_REQUEST',sessionId:'test',status:Infinity}),undefined);
    guardian.collector.resetObservation();assert.equal(guardian.aiEvents().length,0);assert.ok(guardian.emit({type:'AI_MODEL_REQUEST',sessionId:'new'}));assert.equal(guardian.aiEvents().length,1);
  } finally { await guardian.close(); }
});
test('reset discards old queued web impulses without discarding the first fresh observation',async()=>{
  const sensor=new Sensor({memory:false}),telemetry=await startTelemetry(sensor,{port:0}),controller=new AbortController();
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    const response=await fetch(telemetry.url+'/web/events',{signal:controller.signal});reader=response.body!.getReader();await reader.read();
    sensor.observe({clientKey:'test',path:'/login',method:'GET',status:200,latency:1});sensor.resetObservation();
    sensor.observe({clientKey:'test',path:'/products',method:'GET',status:200,latency:1});
    const frame=new TextDecoder().decode((await reader.read()).value);const data=JSON.parse(frame.split('\n').find(line=>line.startsWith('data: '))!.slice(6)) as {pulses:{route:string}[]};
    assert.deepEqual(data.pulses.map(pulse=>pulse.route),['/products']);
  }finally{await reader?.cancel();controller.abort();await telemetry.close();sensor.close();}
});
test('fixed-target proxy streams real traffic, preserves query/body transport and isolates local control services', async () => {
  let received=''; const target=createServer((req,res)=>{req.on('data',chunk=>received+=String(chunk));req.on('end',()=>{res.writeHead(req.url?.startsWith('/missing')?404:200,{'Content-Type':'text/plain'});res.end('REAL_TARGET '+req.url);});});
  let monitor:Awaited<ReturnType<typeof startMonitor>>|undefined;
  try {
    const targetPort=await listenLocal(target,0);monitor=await startMonitor(`http://127.0.0.1:${targetPort}`,{gatewayPort:0,dashboardPort:0,memory:false});
    const response=await fetch(monitor.siteUrl+'/products?q=ordinary',{method:'POST',body:'PRIVATE_PROXY_BODY',headers:{Authorization:'Bearer PRIVATE_PROXY_AUTH'}});assert.match(await response.text(),/REAL_TARGET \/products\?q=ordinary/);assert.equal(received,'PRIVATE_PROXY_BODY');
    for(const route of ['/missing/a','/missing/b','/missing/c','/missing/d','/missing/e','/missing/f'])await(await fetch(monitor.siteUrl+route)).text();
    assert.equal(monitor.guardian.sensor.status().vibrations,7);assert.ok(!JSON.stringify(monitor.guardian.sensor.liveWeb()).includes('PRIVATE_'));
    assert.equal(await new Promise<number|undefined>((resolve,reject)=>get(monitor!.dashboardUrl!,{headers:{Host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject)),403);
    assert.equal(await new Promise<number|undefined>((resolve,reject)=>get(monitor!.siteUrl,{headers:{Host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject)),403);
  } finally { await monitor?.close(); await closeLocal(target); }
});
test('proxy URL validation requires an explicit target and excludes credentials, alternate schemes and implicit remote access',()=>{
  for(const value of ['file:///secret','ftp://localhost/','http://user:secret@localhost:3000/','http://example.com/','http://localhost:3000/?token=secret'])assert.throws(()=>validateTarget(value));
  assert.equal(validateTarget('http://localhost:3000').hostname,'localhost');assert.equal(validateTarget('https://example.com',true).hostname,'example.com');
});
test('default browser launch commands use platform tools with separate arguments and local generated URLs',()=>{
  const url='http://127.0.0.1:5173/web';assert.equal(browserCommand(url,'win32').command,'rundll32.exe');assert.deepEqual(browserCommand(url,'darwin'),{command:'open',args:[url]});assert.deepEqual(browserCommand(url,'linux'),{command:'xdg-open',args:[url]});assert.throws(()=>browserCommand('https://untrusted.example'));assert.throws(()=>browserCommand('http://127.0.0.1/web?token=secret'));
});
test('confirmed local reset clears transient evidence, preserves stored memory, and significant reports survive a quiet web',async()=>{
  const app=await startIntegrated({sitePort:0,dashboardPort:0,memory:':memory:',logs:false,directory:fileURLToPath(new URL('../../apps/demo-site/',import.meta.url))});
  try{
    for(let i=0;i<24;i++)await(await fetch(app.siteUrl+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'demo',password:'fictional-wrong'})})).text();
    const report=app.collector.lastSignificant()!;assert.ok(report);assert.equal(report.category,'AUTH_BRUTE_FORCE');
    const storedBeforeReset=app.sensor.memory!.events().length;assert.ok(storedBeforeReset>0);
    const origin=app.dashboardUrl!.replace('/web','');const exported=await fetch(origin+'/web/incidents/'+report.id+'/export');assert.match(exported.headers.get('content-disposition')!,/spiderbrain-incident-SB-IR-.*-\d{4}-\d{2}-\d{2}\.json/);
    assert.equal((await fetch(origin+'/web/reset',{method:'POST'})).status,403);
    const {token}=await(await fetch(origin+'/web/control-token')).json() as {token:string};
    assert.equal((await fetch(origin+'/web/reset',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json','X-Spiderbrain-Control':token},body:'{}'})).status,403);
    assert.equal((await fetch(origin+'/web/reset',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Spiderbrain-Control':token},body:'{}'})).status,200);
    assert.equal(app.sensor.status().vibrations,0);assert.equal(app.sensor.sessions().length,0);assert.equal(app.sensor.liveWeb().graph.nodes.length,0);assert.equal(app.collector.lastSignificant(),null);assert.ok(app.sensor.memory!.online);assert.equal(app.collector.incidents.recent().length,0);
    assert.ok(app.sensor.memory!.events().length>=storedBeforeReset);
    await(await fetch(app.siteUrl+'/products')).text();assert.equal(app.sensor.status().vibrations,1);assert.equal(app.sensor.sessions()[0]!.state,'CALM');
  }finally{await app.close();}
});
