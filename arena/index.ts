import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Sensor, type VibrationEvent, type SensorOptions } from '@spiderbrain/sensor';
import { demo } from '../examples/demo.js';
import { normal } from './normal/index.js';
import { noisyBot } from './noisy-bot/index.js';
import { routeRecon } from './route-recon/index.js';
import { slowRecon } from './slow-recon/index.js';
import { normalTraces } from './normal/traces.js';
import { suspiciousTraces } from './suspicious/index.js';
import { honeyTraces } from './honey/index.js';
import { createCanaryManifest } from '@spiderbrain/deception';
import { calibrationReport } from './calibration.js';
import type { ArenaMetrics, ArenaScenario } from './types.js';
import { v3Traces } from './v3.js';
export const arenaScenarios: readonly ArenaScenario[] = [normal, noisyBot, routeRecon, slowRecon, ...normalTraces, ...suspiciousTraces, ...honeyTraces, ...v3Traces];
export const scenarioNames: readonly string[] = arenaScenarios.map((scenario) => scenario.name);
/** No target argument, no supplied URL, no environment target: owns its loopback server. */
export async function runArena(names: readonly string[] = scenarioNames, options: { memory?: SensorOptions['memory']; onRequestDuration?: (milliseconds: number) => void; onTrace?: (scenario: string, events: readonly VibrationEvent[]) => void } = {}): Promise<ArenaMetrics[]> {
  if (!Array.isArray(names) || !names.length || names.some((name) => !scenarioNames.includes(name as typeof scenarioNames[number]))) throw new Error('Choose a bundled Arena scenario; external targets are unsupported');
  const metrics: ArenaMetrics[] = [];
  for (const scenario of arenaScenarios.filter((item) => names.includes(item.name))) {
    let now = Math.floor(Date.now() / 86_400_000) * 86_400_000 + 43_200_000;
    const started = now;
    const manifest = scenario.canaries ? createCanaryManifest().map((entry, i) => ({ ...entry, id: 'SB-CANARY-' + (i + 1).toString(16).toUpperCase().padStart(6, '0') })) : undefined;
    const sensor = new Sensor({ memory: options.memory ?? false, clock: () => now, publicRoutes: ['/auth/demo'], canaries: manifest ? { enabled: true, manifest } : false });
    const events: VibrationEvent[] = [];
    sensor.silk.subscribe((event) => { events.push(event); });
    const { app } = demo(sensor);
    const server = createServer((req,res)=>{const cohort=req.headers['x-spiderbrain-arena-cohort'];if(typeof cohort==='string'&&/^owned-cohort-[0-9]$/.test(cohort))Object.defineProperty(req,'ip',{value:cohort,configurable:true});app(req,res);});
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Bundled demo unavailable');
      const origin = `http://127.0.0.1:${address.port}`;
      if (scenario.steps.length > 128) throw new Error('Arena trace limit exceeded');
      for (const step of scenario.steps) {
        if (!/^\/(?!\/)[a-zA-Z0-9/._-]*$/.test(step.path) || !Number.isSafeInteger(step.afterMs) || step.afterMs < 0 || step.afterMs > 120_000) throw new Error('Arena steps must be bounded fixed local paths');
        const reference = step.canaryReference ? manifest?.find((entry) => entry.route === step.canaryReference) : undefined;
        if (step.canaryReference && !reference) throw new Error('Arena reference must belong to its own manifest');
        now += step.afterMs;
        if(step.client!==undefined&&(!Number.isInteger(step.client)||step.client<0||step.client>9))throw new Error('Arena cohort must be one of ten owned synthetic sessions');
        const requestStarted = options.onRequestDuration ? performance.now() : 0;
        const response = await fetch(origin + step.path + (reference ? '?canary=' + reference.id : ''), { redirect: 'error', signal: AbortSignal.timeout(5000),
          headers:{...(step.outcome?{'Content-Type':'application/json'}:{}),...(step.client!==undefined?{'x-spiderbrain-arena-cohort':'owned-cohort-'+step.client}:{})},
          ...(step.outcome ? { method: 'POST', body: JSON.stringify({ outcome: step.outcome, identity: step.identity }) } : {}) });
        await response.text();
        options.onRequestDuration?.(performance.now() - requestStarted);
      }
      if (events.length !== scenario.steps.length) throw new Error('Arena telemetry incomplete');
      const detected = events.findIndex((event) => ['ALERT', 'SUSPICIOUS', 'HOSTILE'].includes(event.decision.state));
      const positive = detected >= 0;
      const snapshot = sensor.liveWeb();
      const signalTotals = new Map<string, ArenaMetrics['signals'][number]>();
      for (const event of events) for (const contribution of event.decision.contributions) {
        const item = signalTotals.get(contribution.signal) ?? { eye: contribution.eye, signal: contribution.signal, requests: 0, maximumContribution: 0, atDetection: 0 };
        item.requests++; item.maximumContribution = Math.max(item.maximumContribution, contribution.value);
        signalTotals.set(contribution.signal, item);
      }
      if (positive) for (const contribution of events[detected]!.decision.contributions) signalTotals.get(contribution.signal)!.atDetection = contribution.value;
      let thresholdCrossings = 0, rapidStateReversals = 0, lastAttention = false, lastDirection = 0, lastChange = started;
      const stateOrder = ['DORMANT', 'CALM', 'CURIOUS', 'ALERT', 'SUSPICIOUS', 'HOSTILE'];
      for (const { decision } of events) {
        const attention = decision.risk >= 6 && decision.evidenceEyes.length >= 2;
        if (attention !== lastAttention) thresholdCrossings++;
        lastAttention = attention;
        const direction = Math.sign(stateOrder.indexOf(decision.state) - stateOrder.indexOf(decision.previousState));
        if (direction) {
          if (lastDirection && direction !== lastDirection && decision.timestamp - lastChange < 15_000) rapidStateReversals++;
          lastDirection = direction; lastChange = decision.timestamp;
        }
      }
      metrics.push({ scenario: scenario.name, expected: scenario.expected,
        trueDetections: scenario.expected === 'probing' && positive ? 1 : 0,
        falsePositives: scenario.expected === 'ordinary' && positive ? 1 : 0,
        missedDetections: scenario.expected === 'probing' && !positive ? 1 : 0,
        timeToDetectionMs: positive ? events[detected]!.observation.timestamp - started : null,
        requestsBeforeDetection: positive ? detected + 1 : null,
        maximumRisk: Math.max(...events.map((event) => event.decision.risk)),
        maximumConfidence: Math.max(...events.map((event) => event.decision.confidence)),
        finalState: events.at(-1)!.decision.state, requests: events.length, graphNodes: snapshot.graph.totalNodes, graphEdges: snapshot.graph.totalEdges,
        TP: scenario.expected === 'probing' && positive ? 1 : 0, TN: scenario.expected === 'ordinary' && !positive ? 1 : 0,
        FP: scenario.expected === 'ordinary' && positive ? 1 : 0, FN: scenario.expected === 'probing' && !positive ? 1 : 0,
        family: scenario.family ?? 'legacy', maximumEnergy: Math.max(...events.map((event) => event.decision.energy)),
        honeyTouches: sensor.status().honeyTouches ?? 0, signals: [...signalTotals.values()], thresholdCrossings, rapidStateReversals,partition:scenario.partition??'calibration' });
      options.onTrace?.(scenario.name, events);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      sensor.close();
      const result = metrics.at(-1);
      if (result?.scenario === scenario.name && sensor.memory) result.queue = sensor.memory.counters;
    }
  }
  return metrics;
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/arena/index.js')) {
  const args = process.argv.slice(2);
  const names = args.length === 0 ? scenarioNames : args.length === 2 && args[0] === '--scenario' ? [args[1]!] : [];
  try {
    const results = await runArena(names);
    const calibration = calibrationReport(results);
    const report = { kind: 'engineering benchmark', target: 'owned bundled loopback demo only',
      detectionThreshold: 'ALERT or higher: monitoring attention, not blocking or attacker attribution',
      timing: 'Virtual inter-request timestamps with actual local HTTP requests; no real-time slow-attack accuracy claim',
      results, ...calibration.metrics, trueDetections: results.reduce((n, item) => n + item.trueDetections, 0),
      falsePositives: results.reduce((n, item) => n + item.falsePositives, 0), missedDetections: results.reduce((n, item) => n + item.missedDetections, 0),
      note: 'Engineering benchmark, not scientific proof of real-world detection accuracy. Labels describe script intent; low evidence may intentionally remain below attention.' };
    writeFileSync('arena-results.json', JSON.stringify(report, null, 2) + '\n');
    writeFileSync('calibration-report.json', JSON.stringify(calibration, null, 2) + '\n');
    writeFileSync('CALIBRATION.md', calibration.markdown);
    console.log(JSON.stringify({...calibration.metrics,misses:calibration.misses,files:['arena-results.json','calibration-report.json','CALIBRATION.md']}));
  } catch { console.error('Arena requires a bundled scenario and an owned loopback demo. No external target is supported.'); process.exitCode = 1; }
}
