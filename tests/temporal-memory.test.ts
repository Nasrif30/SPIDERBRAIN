import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Sensor, startTelemetry, type Observation, type Signal } from '@spiderbrain/sensor';
import { TemporalMemory } from '@spiderbrain/synganglion';
import { WebMemory, fingerprint, similarity } from '@spiderbrain/synganglion/memory';
import { resonanceV3 } from '@spiderbrain/synganglion/physics/resonance';
import { runArena, arenaScenarios } from '../arena/index.js';
import { calibrationReport } from '../arena/calibration.js';

const observation=(route:string,status:number,timestamp:number):Observation=>({schemaVersion:1,id:'test',sessionId:'SB-synthetic',route,status,timestamp,method:'GET',latency:1});
test('temporal memory has finite tiers, decays, and clean behavior suppresses renewed evidence',()=>{
  const memory=new TemporalMemory();memory.observe(observation('/',200,1000));
  for(let i=0;i<100;i++)memory.observe(observation(['/admin','/.env','/backup'][i%3]!,404,1000+i*10000));
  assert.ok(memory.sequence().length<=32);assert.ok(memory.context(991000).longWeight<=32);assert.equal(memory.correlated(991000),false,'an expired entry cannot anchor a fresh sequence');
  memory.observe(observation('/',200,1000000));assert.ok(memory.movement(observation('/admin',404,1000000)).length);
  for(let i=0;i<100;i++)memory.observe(observation('/products',200,1000000+i*1000));
  assert.equal(memory.movement(observation('/admin',404,1100000)).length,0);assert.equal(memory.context(1800000).points.length,0);
  const behavior=memory.behavior(1100000,0);assert.ok(behavior.categories.length<=32);assert.ok(behavior.timingBuckets.length<=32);assert.ok(behavior.velocityProfile.every(value=>value>=0&&value<=1));
});

test('slow cross-category failed traversal survives gaps; isolated mistakes and successful traversal stay quiet',()=>{
  let now=Date.now();const enabled=new Sensor({memory:false,clock:()=>now}),disabled=new Sensor({memory:false,clock:()=>now,temporal:false});
  for(const sensor of [enabled,disabled])sensor.observe({clientKey:'owned-cohort',path:'/',method:'GET',status:200,latency:1});
  let positive=false,control=false;
  for(let i=0;i<42;i++){now+=32000;const path=['/admin','/about','/.env','/products','/backup','/'][i%6]!,raw={clientKey:'owned-cohort',path,method:'GET',status:['/admin','/.env','/backup'].includes(path)?404:200,latency:1};positive||=['ALERT','SUSPICIOUS','HOSTILE'].includes(enabled.observe(raw)!.decision.state);control||=['ALERT','SUSPICIOUS','HOSTILE'].includes(disabled.observe(raw)!.decision.state);}
  assert.ok(positive);assert.equal(control,false);assert.ok(enabled.sessions()[0]!.decision!.calibration!.evidenceDiversity!>=2);
  for(let i=0;i<48;i++){now+=30000;const event=enabled.observe({clientKey:'clean-visitor',path:['/products','/about','/login','/missing-help'][i%4]!,method:'GET',status:i%4===3?404:200,latency:1})!;assert.ok(!['ALERT','SUSPICIOUS','HOSTILE'].includes(event.decision.state));}
  enabled.close();disabled.close();
});

test('sequence resonance requires meaningful independent Eyes and failed category changes, regardless of permutation',()=>{
  const points=Array.from({length:8},(_,i)=>({timestamp:1000+i*1000,route:'synthetic-'+i,category:i%2?'configuration':'administration',failed:true,honey:false}));
  const make=(eye:Signal['eye']):Signal=>({eye,signal:eye,intensity:3,confidence:.8,reason:'owned fixture',decay:.004,timestamp:8000});
  assert.equal(resonanceV3(points,[make('honey')],8000).value,0);
  const pair=resonanceV3(points,[make('route'),make('movement')],8000);assert.ok(pair.value>0&&pair.value<=1.5);
  assert.equal(resonanceV3(points.map(point=>({...point,category:'public',failed:false})),[make('route'),make('movement')],8000).value,0);
  assert.equal(resonanceV3(points,[make('route'),make('movement')],700000).value,0);
});

test('memory pressure preserves honey, coalesces ordinary records with observable loss, and isolates later mutation',()=>{
  const sensor=new Sensor({memory:false,canaries:{enabled:true}}),memory=new WebMemory({path:':memory:'});
  const response=sensor.canaryResponse('/.env.backup','GET')!;
  const honey=sensor.observe({clientKey:'honey',path:'/.env.backup',method:'GET',status:200,latency:1,honey:[response.honey]})!;
  const normal=sensor.observe({clientKey:'normal',path:'/',method:'GET',status:200,latency:1})!;
  for(let i=0;i<64;i++)memory.append(honey);
  for(let i=0;i<300;i++)memory.append(normal);
  assert.equal(memory.counters.queued,256);assert.ok(memory.counters.coalesced>0);assert.equal(memory.counters.dropped,108);
  normal.observation.route='/mutated-after-queue';memory.flush();assert.equal(memory.honeyInteractions(1000).length,64);assert.ok(!JSON.stringify(memory.events(1000)).includes('mutated-after-queue'));assert.equal(memory.counters.processed,256);assert.equal(memory.counters.queued,0);
  memory.close();sensor.close();
});

test('behavioral fingerprints compare categories, transitions, timing and Eyes without route identity or secrets',()=>{
  let now=Date.now();const sensor=new Sensor({memory:{path:':memory:'},clock:()=>now});
  for(const clientKey of ['one','two'])for(let i=0;i<12;i++){now+=2000;sensor.observe({clientKey,path:['/','/products','/about'][i%3]!+'?password=private-secret',method:'GET',status:200,latency:1});}
  sensor.memory!.flush();const sessions=sensor.sessions(),a=fingerprint(sessions[0]!),b=fingerprint(sessions[1]!);
  assert.ok(similarity(a,b)>.9);assert.ok(a.behavior!.categories.every(value=>['public','unknown','configuration','administration','discovery','authentication','synthetic'].includes(value)));
  assert.ok(!JSON.stringify(sensor.memory!.patterns()).includes('private-secret'));const match=sensor.inspect(sessions[1]!.id)!.similarity!;assert.match(match.patternId,/^SB-PATTERN-\d+$/);assert.equal(match.meaning,'behavioral similarity only');sensor.close();
});

test('diagnostic callbacks cannot disable sensing and evidence diversity configuration is bounded',()=>{
  const sensor=new Sensor({memory:false,onProfile:()=>{throw new Error('diagnostic failure');}});assert.ok(sensor.observe({clientKey:'x',path:'/',method:'GET',status:200,latency:1}));assert.equal(sensor.status().online,true);sensor.close();assert.throws(()=>new Sensor({memory:false,meaningfulEyeMinimum:.1}));
});

test('Arena V3 labels and partitions are deterministic; held-out ordinary workflows stay below attention',async()=>{
  assert.ok(arenaScenarios.length>=75);const names=arenaScenarios.filter(row=>row.expected==='ordinary'&&row.partition==='holdout').map(row=>row.name);assert.equal(names.length,8);
  const report=calibrationReport(await runArena(names));assert.equal(report.metrics.FP,0);assert.equal(report.metrics.TN,8);assert.equal(report.metrics.specificity,1);assert.ok(arenaScenarios.some(row=>row.steps.some(step=>step.client===9)));
});

test('SPIDERBRAIN inspect prints stored progression, UTC timeline, carried evidence and anonymous similarity',async()=>{
  const sensor=new Sensor({memory:{path:':memory:'}});for(let i=0;i<16;i++)sensor.observe({clientKey:'owned-inspect',path:i%3?'/admin':'/',method:'GET',status:i%3?404:200,latency:1});
  const id=sensor.sessions()[0]!.id,telemetry=await startTelemetry(sensor,{port:0});
  try{const output=await new Promise<string>((resolve,reject)=>{const child=spawn(process.execPath,['dist/cli/guardian/index.js','inspect',id,'--url',telemetry.url],{stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',data=>text+=String(data));child.once('error',reject);child.once('exit',code=>code===0?resolve(text):reject(new Error('inspect failed')));});assert.match(output,/SESSION SB-/);assert.match(output,/State progression:/);assert.match(output,/Timeline \(UTC/);assert.match(output,/Last decision:/);assert.match(output,/Confidence/);assert.ok(sensor.inspect(id)!.timeline.length>0);}finally{await telemetry.close();sensor.close();}
});
