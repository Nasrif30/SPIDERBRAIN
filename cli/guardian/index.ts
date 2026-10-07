#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { terminalBanner, attribution } from './banner.js';
import type { SensorStatus, VibrationEvent, SessionView, Similarity } from '@spiderbrain/shared';
const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const endpointAt = args.indexOf('--url');
const endpoint = endpointAt >= 0 ? args[endpointAt + 1] : 'http://127.0.0.1:4318';
function localUrl(): string {
  const url = new URL(endpoint ?? '');
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a loopback telemetry URL: http://127.0.0.1:4318');
  }
  return url.origin;
}
function status(value: SensorStatus): void {
  console.log(value.online ? 'SYNGANGLION ONLINE' : 'SYNGANGLION OFFLINE');
  console.log('SPIDERBRAIN // SYNGANGLION');
  for (const [label, number] of Object.entries({ Threads: value.threads, Connections: value.connections ?? 0, Sessions: value.sessions, Vibrations: value.vibrations,
    Energy: value.energy, Entropy: value.entropy, Resonance: value.resonance, Threats: value.threats, Canaries: value.canaries ?? 0, 'Honey touches': value.honeyTouches ?? 0 })) console.log(`${label.padEnd(14)}${number}`);
  console.log(`Memory       ${value.memoryAvailable ? 'online' : 'disabled'}\n`);
  console.log(`Spider Sense: ${value.spiderSense ?? 'DORMANT'}\n`);
  if(value.telemetry)console.log(`Queue depth   ${value.telemetry.queued}\nProcessed     ${value.telemetry.processed}\nCoalesced     ${value.telemetry.coalesced}\nDropped       ${value.telemetry.dropped}\n`);
}
function inspect(result:{session:SessionView;similarity:Similarity|null;timeline:VibrationEvent[]}):void{
  const {session,timeline,similarity}=result;
  console.log(`SESSION ${session.id}\n`);
  const progression:string[]=[];for(const event of timeline)if(progression.at(-1)!==event.decision.state)progression.push(event.decision.state);
  console.log('State progression: '+(progression.length?progression.join(' → '):session.state));
  console.log('\nTimeline (UTC; last 24 retained observations, carried evidence totals):');
  if(!timeline.length)console.log('Stored timeline unavailable.');
  for(const event of timeline.slice(-24)){
    const totals=event.decision.calibration?.eyeTotals??{};
    const evidence=Object.entries(totals).filter(([,value])=>(value??0)>=.05).map(([eye,value])=>`${eye} +${value!.toFixed(1)}`).join(' · ');
    const decay=(event.decision.adjustments??[]).reduce((sum,item)=>sum+item.value,0);
    console.log(`${new Date(event.observation.timestamp).toISOString()} ${event.observation.route} | ${evidence||'no carried Eye evidence'} | resonance ${event.decision.resonance.toFixed(1)}${decay?` · decay ${decay.toFixed(1)} (already applied)`:''}`);
    const temporal=event.signals.find(item=>item.signal==='structured temporal traversal');if(temporal)console.log('  Temporal movement: '+temporal.reason);
  }
  console.log(`\nLast decision: ${session.decision?new Date(session.decision.timestamp).toISOString():'unavailable'}\nState       ${session.state}\nRisk        ${session.decision?.risk??'unavailable'}\nConfidence  ${session.decision?Math.round(session.decision.confidence*100)+'%':'unavailable'}\nEnergy      ${session.energy}\nReason: ${session.decision?.reason??'No retained decision.'}`);
  console.log(similarity?`\nCurrent pattern resembles ${similarity.patternId}: ${Math.round(similarity.similarity*100)}% — behavioral similarity only.`:'\nNo comparable retained pattern.');
}
function sense(event: VibrationEvent): void {
  const decision = event.decision;
  if (decision.risk < 2 && !args.includes('--all')) return;
  const names: Record<string, string> = { route: 'Route Eye', velocity: 'Velocity Eye', error: 'Error Eye', authentication: 'Authentication Eye', movement: 'Movement Eye', honey: 'Honey Eye' };
  console.log(`+-- Strong vibration: ${event.observation.route}\n| Spider Sense risk: ${decision.risk.toFixed(1)}`);
  for (const item of event.observation.honey ?? []) console.log(`| Synthetic resource: ${item.resource} / ${item.canaryId} / ${item.interaction}`);
  for (const item of decision.contributions) console.log(`| +${item.value.toFixed(1)} ${names[item.eye] ?? item.signal} / ${item.signal}: ${item.reason}`);
  for (const item of decision.adjustments ?? []) console.log(`| ${item.value.toFixed(1)} Time decay (already applied): ${item.reason}`);
  console.log(`State: ${decision.state} | Confidence: ${Math.round(decision.confidence * 100)}% | Energy: ${decision.energy}`);
  console.log('Confidence is heuristic. SpiderBrain is watching.\n');
}
async function watch(): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const response = await fetch(`${localUrl()}/events`, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Telemetry returned ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
          if (!data) continue;
          if (frame.startsWith('event: status')) status(JSON.parse(data) as SensorStatus);
          if (frame.startsWith('event: vibration')) sense(JSON.parse(data) as VibrationEvent);
          if (args.includes('--once')) return;
        }
        if (buffer.length > 65_536) throw new Error('Telemetry frame limit exceeded');
      }
    } finally { await reader.cancel(); }
  } catch (error) { if (!controller.signal.aborted) throw error; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
async function main(): Promise<void> {
  if (command === 'init') {
    mkdirSync(resolve('.spiderbrain'), { recursive: true });
    try { writeFileSync(resolve('.spiderbrain/config.json'), JSON.stringify({ telemetryUrl: 'http://127.0.0.1:4318', canaries: false }, null, 2) + '\n', { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    console.log('SpiderBrain workspace ready. Attach the Express middleware to start sensing.'); return;
  }
  if (command === 'watch') { console.log(terminalBanner()); console.log(attribution); await watch(); return; }
  if (['status', 'sense', 'inspect', 'memory'].includes(command)) {
    const path = command === 'memory' ? '/memory' : command === 'inspect' ? (args[1] && !args[1].startsWith('--') ? `/sessions/${encodeURIComponent(args[1])}` : '/sessions') : '/status';
    const response = await fetch(localUrl() + path, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Telemetry returned ${response.status}`);
    const result: unknown = await response.json();
    if (command === 'status' || command === 'sense') status(result as SensorStatus); else if(command==='inspect'&&args[1]&&!args[1].startsWith('--')&&!args.includes('--json'))inspect(result as Parameters<typeof inspect>[0]);else console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'web') {
    const response = await fetch(localUrl() + '/status', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Telemetry unavailable');
    console.log(`Live Web V2: ${localUrl()}/web\nOpen this local page in your browser. SpiderBrain is watching.`); return;
  }
  console.log('spiderbrain init | watch [--all] [--once] | web | status | sense | inspect [session] | memory\nOptions: --url http://127.0.0.1:4318');
  if (command !== 'help' && command !== '--help') process.exitCode = 1;
}
void main().catch(() => { console.error('[SPIDERBRAIN] Telemetry unavailable. The protected application remains independent.'); process.exitCode = 1; });
