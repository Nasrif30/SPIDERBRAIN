import { performance } from 'node:perf_hooks';
import { mkdtempSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import express from 'express';
import { Sensor, createCanaryManifest } from '@spiderbrain/sensor';
import { spiderbrain, canaryRoutes } from '@spiderbrain/express';
import { runArena } from '../arena/index.js';
const q=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]??0;
const round=(n:number)=>Math.round(n*1000)/1000;
const directory=mkdtempSync(join(tmpdir(),'spiderbrain-canary-bench-'));
function bytes(path:string){let total=0;for(const suffix of ['', '-wal', '-shm'])try{total+=statSync(path+suffix).size;}catch{/* absent */}return total;}
async function http(name:string,enabled:boolean,highRoutes=false){
  const path=join(directory,name+'.sqlite'),manifest=createCanaryManifest(),routes=highRoutes?Array.from({length:100},(_,i)=>'/load-'+i):['/','/about','/products','/login','/account'];
  const sensor=new Sensor({memory:{path},canaries:enabled?{enabled:true,manifest}:false,publicRoutes:routes});
  const beforeBytes=bytes(path),baseline=express(),guarded=express();guarded.use(spiderbrain(sensor));guarded.use(canaryRoutes(sensor));
  for(const app of [baseline,guarded])for(const route of routes)app.get(route,(_req,res)=>res.send('ok'));
  const canaryPaths=['/admin-old','/.env.backup'];if(enabled)for(const route of canaryPaths){const content=sensor.canaryResponse(route,'GET')!;baseline.get(route,(_req,res)=>res.type(content.contentType).send(content.body));}
  const paths=enabled?[...routes,...canaryPaths]:routes,servers=[createServer(baseline),createServer(guarded)],urls:string[]=[];
  for(const server of servers){await new Promise<void>((resolve)=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Local benchmark unavailable');urls.push('http://127.0.0.1:'+address.port);}
  const duration=async(url:string)=>{const started=performance.now();await(await fetch(url,{redirect:'error'})).text();return performance.now()-started;};
  const paired:number[]=[],guardedTimes:number[]=[],roundMeans:number[]=[];global.gc?.();const beforeMemory=process.memoryUsage();
  try{
    for(let i=0;i<100;i++)for(const url of urls)await duration(url+paths[i%paths.length]);
    for(let r=0;r<5;r++){let total=0;for(let i=0;i<300;i++){const route=paths[(r*300+i)%paths.length]!;let a:number,b:number;if(i%2){b=await duration(urls[1]!+route);a=await duration(urls[0]!+route);}else{a=await duration(urls[0]!+route);b=await duration(urls[1]!+route);}paired.push(b-a);guardedTimes.push(b);total+=b-a;}roundMeans.push(total/300);}
    sensor.memory!.flush();global.gc?.();const after=process.memoryUsage(),web=sensor.liveWeb();
    return{name,canariesEnabled:enabled,medianOverheadMs:round(q(paired,.5)),p95OverheadMs:round(q(paired,.95)),medianRoundMeanOverheadMs:round(q(roundMeans,.5)),guardedP95Ms:round(q(guardedTimes,.95)),eventsPerSecond:round(1000*guardedTimes.length/guardedTimes.reduce((a,b)=>a+b,0)),requests:paired.length,
      processRssMiB:round(after.rss/1048576),incrementalHeapMiB:round((after.heapUsed-beforeMemory.heapUsed)/1048576),sqliteGrowthBytes:bytes(path)-beforeBytes,sqliteBytes:bytes(path),graphNodes:web.graph.totalNodes,graphEdges:web.graph.totalEdges,dropped:sensor.status().droppedMemoryEvents};
  }finally{for(const server of servers){server.closeAllConnections();await new Promise<void>((resolve)=>server.close(()=>resolve()));}sensor.close();}
}
function sessions(){
  const path=join(directory,'multiple-sessions.sqlite'),routes=Array.from({length:100},(_,i)=>'/load-'+i),sensor=new Sensor({memory:{path},publicRoutes:routes,canaries:{enabled:true}});
  global.gc?.();const before=process.memoryUsage(),beforeBytes=bytes(path),samples:number[]=[],started=performance.now();
  for(let step=0;step<4;step++)for(let i=0;i<1000;i++){const start=performance.now();sensor.observe({clientKey:'local-synthetic-session-'+i,path:routes[(i*(step+1)+step)%routes.length]!,method:'GET',status:200,latency:1});if(i%128===127)sensor.memory!.flush();samples.push(performance.now()-start);}
  sensor.memory!.flush();const elapsed=performance.now()-started;global.gc?.();const after=process.memoryUsage(),web=sensor.liveWeb(),status=sensor.status();sensor.close();
  return{name:'multiple-sessions',kind:'direct sensor metadata, not HTTP',medianMs:round(q(samples,.5)),p95Ms:round(q(samples,.95)),eventsPerSecond:round(4000000/elapsed),sessions:status.sessions,graphNodes:web.graph.totalNodes,graphEdges:web.graph.totalEdges,incrementalHeapMiB:round((after.heapUsed-before.heapUsed)/1048576),processRssMiB:round(after.rss/1048576),sqliteGrowthBytes:bytes(path)-beforeBytes,sqliteBytes:bytes(path),dropped:status.droppedMemoryEvents};
}
try{
  const disabled=await http('canaries-disabled',false),enabled=await http('canaries-enabled',true),highRoutes=await http('high-route-count',true,true),multipleSessions=sessions();
  const arenaPath=join(directory,'arena.sqlite'),arenaTimes:number[]=[],arenaStarted=performance.now(),arena=await runArena(undefined,{memory:{path:arenaPath},onRequestDuration:ms=>arenaTimes.push(ms)}),arenaElapsed=performance.now()-arenaStarted;
  const idleChild=spawnSync(process.execPath,['--expose-gc','dist/tests/idle.js'],{encoding:'utf8',timeout:10000});if(idleChild.status!==0)throw new Error('Idle sample failed');
  let previous:unknown=null;try{previous=JSON.parse(readFileSync('.spiderbrain/storage-benchmark.json','utf8'));}catch{/* optional baseline */}
  const report={kind:'local engineering performance benchmark',node:process.version,disabled,enabled,highRoutes,multipleSessions,arena:{traces:arena.length,requests:arena.reduce((n,row)=>n+row.requests,0),elapsedMs:round(arenaElapsed),eventsPerSecond:round(arena.reduce((n,row)=>n+row.requests,0)*1000/arenaElapsed),sqliteBytes:bytes(arenaPath),graphNodesMaximum:Math.max(...arena.map(row=>row.graphNodes)),graphEdgesMaximum:Math.max(...arena.map(row=>row.graphEdges)),TP:arena.reduce((n,row)=>n+row.TP,0),TN:arena.reduce((n,row)=>n+row.TN,0),FP:arena.reduce((n,row)=>n+row.FP,0),FN:arena.reduce((n,row)=>n+row.FN,0)},idle:JSON.parse(idleChild.stdout) as unknown,historicalStorageBenchmark:previous,
    arenaRequestTiming:{medianMs:round(q(arenaTimes,.5)),p95Ms:round(q(arenaTimes,.95)),processRssMiB:round(process.memoryUsage().rss/1048576),sqliteGrowthBytes:bytes(arenaPath),note:'Absolute local HTTP request durations, not paired overhead. SQLite growth starts with no database file.'},
    deltaFromStorageBaselineDisk:{disabledMedianMs:round(disabled.medianOverheadMs-.113),disabledP95Ms:round(disabled.p95OverheadMs-.241),enabledMedianMs:round(enabled.medianOverheadMs-.113),enabledP95Ms:round(enabled.p95OverheadMs-.241)},note:'Paired alternating signed guarded-minus-baseline HTTP samples, concurrency one, disk SQLite, no SSE watchers. Enabled mode includes real synthetic resource responses, so workloads differ from the storage benchmark. Process RSS reflects prior high-water workloads; incremental heap and fresh idle are separate. Arena intervals are virtual, requests are local HTTP.'};
  writeFileSync('benchmark-canaries-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,historicalStorageBenchmark:'retained in result file'},null,2));
}finally{const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('spiderbrain-canary-bench-'))throw new Error('Unsafe benchmark cleanup target');rmSync(target,{recursive:true,force:true});}
