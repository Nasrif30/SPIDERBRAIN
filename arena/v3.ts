import type { ArenaScenario, ArenaStep } from './types.js';
const cycle=(routes:string[],length:number,gap:number):ArenaStep[]=>Array.from({length},(_,i)=>({path:routes[i%routes.length]!,afterMs:i?gap:0}));
const normalRoutes=['/','/products','/about','/login','/account','/api/health'];
export const v3Traces:ArenaScenario[]=[];
for(let variant=0;variant<3;variant++){
  const add=(family:string,steps:ArenaStep[],canaries=false)=>v3Traces.push({name:'v3-'+family+'-'+(variant+1),family,expected:'ordinary',steps,canaries,partition:variant===2?'holdout':'calibration'});
  add('normal-browsing',cycle(normalRoutes,36,1800+variant*1100));
  add('fast-legitimate',cycle(normalRoutes,72,15+variant*30));
  add('api-heavy',cycle(['/api/health','/products','/api/health','/account'],64,50+variant*100));
  add('authenticated-workflow',Array.from({length:36},(_,i):ArenaStep=>i%6===0?{path:'/auth/demo',outcome:'success',identity:'sample-a',afterMs:1000+variant*500}:{path:normalRoutes[i%6]!,afterMs:800+variant*250}));
  add('broken-links',cycle(['/','/missing-help','/about','/missing-image','/products','/missing-faq'],36,1200+variant*1500));
  add('refresh-heavy',cycle(['/products','/products','/products','/about'],80,60+variant*50));
  add('mobile-navigation',cycle(['/','/products','/products','/account','/about'],30,8000+variant*9000));
  add('benign-bot',cycle(['/robots.txt','/','/products','/about','/api/health'],50,100+variant*700));
}
for(let variant=0;variant<2;variant++){
  const entry:ArenaStep[]=[{path:'/',afterMs:0},{path:'/robots.txt',afterMs:1500}];
  const probes=['/admin','/.env','/.git/','/backup','/config.old','/internal'];
  const add=(family:string,steps:ArenaStep[],canaries=false)=>v3Traces.push({name:'v3-'+family+'-'+(variant+1),family,expected:'probing',steps,canaries,partition:variant?'holdout':'calibration'});
  add('low-slow-recon',[...entry,...cycle(probes,48,variant?42000:25000)]);
  add('route-permutation',[...entry,...cycle(variant?[...probes].reverse():[probes[3]!,probes[0]!,probes[5]!,probes[2]!,probes[1]!,probes[4]!],48,variant?1800:700)]);
  add('sparse-config',[...entry,...cycle(['/config.old','/about','/.env','/products','/admin','/backup'],54,variant?37000:21000)]);
  add('long-pauses',[...entry,...cycle(probes,36,variant?120000:95000)]);
  add('return-visits',[...entry,...Array.from({length:54},(_,i)=>({path:probes[i%6]!,afterMs:i%12===0?110000:variant?3000:1400}))]);
  add('mixed-navigation',[...entry,...cycle(['/products','/admin','/about','/.env','/account','/.git/','/login','/backup'],64,variant?1700:500)]);
  // Each cohort is independent; this trace intentionally does not enable distributed attribution/correlation.
  add('distributed-cohorts',Array.from({length:60},(_,i)=>({path:probes[Math.floor(i/10)%6]!,afterMs:variant?1600:350,client:i%10})));
  add('canary-near-miss',[...entry,...cycle(['/admin','/admin-old/missing','/.env','/.env.backup/missing','/config.old/missing'],40,variant?10000:1100)],true);
  add('honey-interest',[...entry,...cycle(['/admin','/.env','/admin-old','/.env.backup','/config.old','/backup.sql'],36,variant?12000:500)],true);
  add('auth-probing',[...entry,...Array.from({length:30},(_,i):ArenaStep=>({path:'/auth/demo',outcome:'failure',identity:(['sample-a','sample-b','sample-c'] as const)[i%3]!,afterMs:variant?14000:1200}))]);
  add('normal-looking-gaps',[...entry,...cycle(probes,54,variant?11000:4500)]);
}
