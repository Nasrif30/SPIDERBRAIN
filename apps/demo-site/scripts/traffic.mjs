// Explicitly invoked local acceptance exercise. Fixed owned routes only;
// no target argument, timer, background traffic or payload execution.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const site='http://127.0.0.1:4173',dashboard='http://127.0.0.1:5173';
const before=await(await fetch(dashboard+'/web/snapshot')).json();
for(let round=0;round<8;round++)for(const path of ['/products','/admin-demo','/config-demo','/login','/admin-old-demo']){
  const response=await fetch(site+path,{redirect:'error',signal:AbortSignal.timeout(5000),...(path==='/login'?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'demo',password:'wrong-demo-only'})}:{})});await response.text();
}
const after=await(await fetch(dashboard+'/web/snapshot')).json();
const result={kind:'explicit local real-HTTP acceptance exercise',requests:40,before:before.status,after:after.status,graph:after.graph,strongest:after.strongest};
const directory=fileURLToPath(new URL('../logs/',import.meta.url));mkdirSync(directory,{recursive:true});writeFileSync(directory+'acceptance-traffic.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({requests:40,website:site,dashboard:dashboard+'/web',status:after.status,contributions:after.strongest?.decision.contributions.map(row=>({eye:row.eye,signal:row.signal,value:row.value}))},null,2));
