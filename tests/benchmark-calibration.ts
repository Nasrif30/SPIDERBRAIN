import { performance } from 'node:perf_hooks';
import { mkdtempSync,statSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { Sensor } from '@spiderbrain/sensor';
import { spiderbrain,canaryRoutes } from '@spiderbrain/express';
import { runArena } from '../arena/index.js';
const q=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]??0;
const round=(value:number)=>Math.round(value*1000)/1000;
const bytes=(path:string)=>['','-wal','-shm'].reduce((sum,suffix)=>{try{return sum+statSync(path+suffix).size;}catch{return sum;}},0);
const directory=mkdtempSync(join(tmpdir(),'spiderbrain-calibration-bench-'));
async function http(name:string,enabled:boolean,dense=false,concurrency=1){
  const path=join(directory,name+'.sqlite'),routes=dense?Array.from({length:98},(_,i)=>'/bench-route-'+i):['/','/about','/products','/login','/account'];
  const sensor=new Sensor({memory:{path},canaries:enabled?{enabled:true}:false,publicRoutes:routes});
  const baseline=express(),guarded=express();
  guarded.use((req,_res,next)=>{const cohort=req.headers['x-owned-bench-cohort'];if(typeof cohort==='string'&&/^cohort-[0-9]$/.test(cohort))Object.defineProperty(req,'ip',{value:cohort});next();});guarded.use(spiderbrain(sensor));guarded.use(canaryRoutes(sensor));
  for(const app of [baseline,guarded])for(const route of routes)app.get(route,(_req,res)=>res.send('ok'));
  const canaryPaths=['/admin-old','/.env.backup'];if(enabled)for(const route of canaryPaths){const content=sensor.canaryResponse(route,'GET')!;baseline.get(route,(_req,res)=>res.type(content.contentType).send(content.body));}
  const paths=enabled?[...routes,...canaryPaths]:routes,servers=[createServer(baseline),createServer(guarded)],urls:string[]=[];
  for(const server of servers){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Owned benchmark unavailable');urls.push('http://127.0.0.1:'+address.port);}
  let requestIndex=0;
  const group=async(url:string,index:number)=>Promise.all(Array.from({length:concurrency},async(_,cohort)=>{const ordinal=index+cohort,chunk=Math.floor(ordinal/paths.length),route=paths[((ordinal%paths.length)*[1,3,7,9][chunk%4]!+chunk)%paths.length]!,start=performance.now();await(await fetch(url+route,{headers:{'x-owned-bench-cohort':'cohort-'+cohort},redirect:'error'})).text();return performance.now()-start;}));
  try{
    for(let i=0;i<100;i+=concurrency){await group(urls[0]!,i);await group(urls[1]!,i);}
    global.gc?.();const before=process.memoryUsage(),beforeBytes=bytes(path),cpu=process.cpuUsage(),start=performance.now(),overheads:number[]=[],times:number[]=[];
    for(let roundIndex=0;roundIndex<5;roundIndex++)for(let i=0;i<300;i+=concurrency){let a:number[],b:number[];if((i/concurrency)%2){b=await group(urls[1]!,requestIndex);a=await group(urls[0]!,requestIndex);}else{a=await group(urls[0]!,requestIndex);b=await group(urls[1]!,requestIndex);}for(let c=0;c<concurrency;c++){overheads.push(b[c]!-a[c]!);times.push(b[c]!);}requestIndex+=concurrency;}
    const elapsed=performance.now()-start,usage=process.cpuUsage(cpu);sensor.memory!.flush();global.gc?.();const after=process.memoryUsage(),web=sensor.liveWeb(),status=sensor.status();
    return{name,concurrency,requests:times.length,medianOverheadMs:round(q(overheads,.5)),p95OverheadMs:round(q(overheads,.95)),p99OverheadMs:round(q(overheads,.99)),guardedP95Ms:round(q(times,.95)),eventsPerSecond:round(times.length*concurrency*1000/times.reduce((a,b)=>a+b,0)),processRssMiB:round(after.rss/1048576),incrementalHeapMiB:round((after.heapUsed-before.heapUsed)/1048576),cpuMs:round((usage.user+usage.system)/1000),cpuPercent:round((usage.user+usage.system)/1000/elapsed*100),sqliteGrowthBytes:bytes(path)-beforeBytes,graphNodes:web.graph.totalNodes,graphEdges:web.graph.totalEdges,renderedNodes:web.graph.nodes.length,renderedEdges:web.graph.edges.length,queue:status.telemetry};
  }finally{for(const server of servers){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}sensor.close();}
}
try{
  const off=await http('canaries-off',false),on=await http('canaries-on',true),dense=await http('100-routes-250-transitions',true,true),concurrent=await http('ten-concurrent-cohorts',true,true,10);
  const arenaPath=join(directory,'arena.sqlite'),times:number[]=[],cpu=process.cpuUsage(),start=performance.now(),metrics=await runArena(undefined,{memory:{path:arenaPath},onRequestDuration:ms=>times.push(ms)}),elapsed=performance.now()-start,usage=process.cpuUsage(cpu);
  const idle=spawnSync(process.execPath,['--expose-gc','dist/tests/idle.js'],{encoding:'utf8',timeout:10000});if(idle.status!==0)throw new Error('Idle sample failed');
  let baseline:unknown=null;try{baseline=JSON.parse(readFileSync('.spiderbrain/http-baseline.json','utf8'));}catch{/* optional local baseline */}
  const report={kind:'local engineering benchmark',node:process.version,off,on,dense,concurrent,arena:{traces:metrics.length,requests:times.length,medianMs:round(q(times,.5)),p95Ms:round(q(times,.95)),p99Ms:round(q(times,.99)),eventsPerSecond:round(times.length*1000/elapsed),cpuMs:round((usage.user+usage.system)/1000),cpuPercent:round((usage.user+usage.system)/1000/elapsed*100),processRssMiB:round(process.memoryUsage().rss/1048576),graphNodesMaximum:Math.max(...metrics.map(item=>item.graphNodes)),graphEdgesMaximum:Math.max(...metrics.map(item=>item.graphEdges)),queue:{maximumDepth:Math.max(...metrics.map(item=>item.queue?.maximumDepth??0)),queued:metrics.reduce((sum,item)=>sum+(item.queue?.queued??0),0),processed:metrics.reduce((sum,item)=>sum+(item.queue?.processed??0),0),coalesced:metrics.reduce((sum,item)=>sum+(item.queue?.coalesced??0),0),dropped:metrics.reduce((sum,item)=>sum+(item.queue?.dropped??0),0)},sqliteGrowthBytes:bytes(arenaPath),note:'Absolute HTTP durations; not overhead deltas.'},idle:JSON.parse(idle.stdout) as unknown,historicalCanaryBaseline:baseline,note:'Signed paired guarded-minus-baseline HTTP samples, alternating order, five rounds of 300 requests, disk SQLite, no SSE watchers. Ten-cohort rows pair concurrent groups by cohort; throughput reflects overlapping requests. CPU is the complete benchmark process (client plus both servers), not isolated server CPU. RSS is process high-water usage; idle/incremental heap are separate. Historical benchmarks are not same-run controls.'};
  writeFileSync('benchmark-calibration-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,historicalCanaryBaseline:'retained in file'},null,2));
}finally{const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('spiderbrain-calibration-bench-'))throw new Error('Unsafe temporary cleanup');rmSync(target,{recursive:true,force:true});}
