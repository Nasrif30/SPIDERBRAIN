import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Sensor } from '@spiderbrain/sensor';
import { runArena } from '../arena/index.js';
import { autopsy } from '../arena/autopsy.js';
const label=process.argv[2]??'baseline';
const names=['low-and-slow-1','low-and-slow-2','route-shuffling-2','honey-file-read-1'];
const autopsies: unknown[]=[];
await runArena(names,{onTrace:(name,events)=>autopsies.push(autopsy(name,events))});
writeFileSync('.spiderbrain/fn-autopsy-'+label+'.json',JSON.stringify(autopsies,null,2)+'\n');
const samples=new Map<string,number[]>();
const sensor=new Sensor({memory:{path:':memory:'},canaries:{enabled:true},onProfile:sample=>{const values=samples.get(sample.stage)??[];values.push(sample.milliseconds);samples.set(sample.stage,values);}});
const timings:number[]=[];
for(let i=0;i<1500;i++){const start=performance.now(),path=i%3?'/.env.backup':'/admin-old',response=sensor.canaryResponse(path,'GET')!;sensor.observe({clientKey:'owned-profile-cohort',path,method:'GET',status:200,latency:1,honey:[response.honey]});timings.push(performance.now()-start);if(i%64===63)await new Promise<void>(resolve=>setImmediate(resolve));}
const flush=performance.now();sensor.memory!.flush();const flushMs=performance.now()-flush;
const q=(values:number[],p:number)=>values.sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]??0;
const summary=[...samples].map(([stage,values])=>({stage,samples:values.length,medianMs:q(values,.5),p95Ms:q(values,.95),p99Ms:q(values,.99)}));
sensor.close();writeFileSync('.spiderbrain/profile-'+label+'.json',JSON.stringify({kind:'diagnostic direct metadata profile, not HTTP overhead',requests:timings.length,medianMs:q(timings,.5),p95Ms:q(timings,.95),p99Ms:q(timings,.99),explicitFlushMs:flushMs,stages:summary},null,2)+'\n');console.log(JSON.stringify(summary));
