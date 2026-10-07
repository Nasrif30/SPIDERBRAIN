import { round, type Observation, type SessionView, type Signal, type VibrationEvent, type State, type LiveSession } from '@spiderbrain/shared';
import { velocityEye } from './eyes/velocity.js';
import { routeEye } from './eyes/route.js';
import { errorEye } from './eyes/error.js';
import { AuthenticationEye } from './eyes/authentication.js';
import { SessionMovementEye } from './eyes/movement.js';
import { HoneyEye } from './eyes/honey.js';
import { PayloadAnomalyEye } from './eyes/payload.js';
import { RouteGraph, type GraphOptions } from './graph/index.js';
import { entropy } from './physics/entropy.js';
import { energy } from './physics/energy.js';
import { decay } from './physics/decay.js';
import { resonance } from './physics/resonance.js';
import { resonanceV2 } from './physics/resonance.js';
import { family } from './physics/resonance.js';
import { vibration } from './physics/vibration.js';
import { score, type ScoreModel } from './scoring/index.js';
import { TemporalMemory } from './memory/temporal.js';
import { resonanceV3 } from './physics/resonance.js';
import { performance } from 'node:perf_hooks';
import type { ProfileSample } from '@spiderbrain/shared';
interface Model { view: SessionView; history: Observation[]; movement: Observation[]; signals: Signal[]; score: ScoreModel; temporal: TemporalMemory }
export interface BrainOptions { graph?: GraphOptions; signalRetentionMs?: number; maxSignals?: number; temporal?: boolean; meaningfulEyeMinimum?: number; onProfile?: (sample: ProfileSample) => void }
export class Synganglion {
  private readonly models = new Map<string, Model>();
  readonly graph: RouteGraph;
  private readonly signalRetentionMs: number;
  private readonly maxSignals: number;
  constructor(readonly maxSessions = 1000, readonly sessionTtlMs = 900_000, private readonly options: BrainOptions = {}) {
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 100_000) throw new Error('Invalid session limit');
    if (!Number.isFinite(sessionTtlMs) || sessionTtlMs < 1000) throw new Error('Invalid session TTL');
    this.graph = new RouteGraph(options.graph);
    this.signalRetentionMs = options.signalRetentionMs ?? 120_000;
    this.maxSignals = options.maxSignals ?? 64;
    if (options.meaningfulEyeMinimum !== undefined && (!Number.isFinite(options.meaningfulEyeMinimum) || options.meaningfulEyeMinimum < .4 || options.meaningfulEyeMinimum > 2)) throw new Error('Invalid meaningful evidence minimum');
    if (!Number.isSafeInteger(this.signalRetentionMs) || this.signalRetentionMs < 1000 || this.signalRetentionMs > 900_000 ||
      !Number.isInteger(this.maxSignals) || this.maxSignals < 8 || this.maxSignals > 256) throw new Error('Invalid signal retention bounds');
  }
  prune(now: number): void {
    // Map ordering is recency ordering; only expired entries are scanned.
    for (const [id, model] of this.models) {
      if (now - model.view.lastSeen <= this.sessionTtlMs) break;
      this.models.delete(id);
    }
  }
  sense(event: Observation): VibrationEvent {
    this.prune(event.timestamp);
    let model = this.models.get(event.sessionId);
    if (!model) {
      if (this.models.size >= this.maxSessions) this.models.delete(this.models.keys().next().value!);
      model = { view: { id: event.sessionId, startedAt: event.timestamp, lastSeen: event.timestamp,
        requests: 0, state: 'CALM', energy: 0, entropy: 0, resonance: 0, routes: [], riskProgression: [], intervals: [], counts: {}, errors: 0, decision: null },
        history: [], movement: [], signals: [], score: { state: 'CALM', changedAt: event.timestamp, clean: 0, upward: 0, evidence: new Map(),
          signalRetentionMs: this.signalRetentionMs, maxSignals: this.maxSignals, meaningfulEyeMinimum: this.options.meaningfulEyeMinimum ?? .8 }, temporal: new TemporalMemory() };
    }
    const view = model.view;
    let stageStarted = this.options.onProfile ? performance.now() : 0;
    const elapsed = Math.max(0, event.timestamp - view.lastSeen);
    const previousRoute = elapsed <= 120_000 ? view.routes.at(-1) : undefined;
    this.graph.prune(event.timestamp);
    const rarityMetrics = this.graph.rarity(event.route, previousRoute);
    this.graph.observe(event.route, previousRoute, event.timestamp);
    const diffusedAwareness = this.graph.awareness(event.route, event.timestamp);
    if (this.options.onProfile) { this.options.onProfile({ stage: 'route-graph', milliseconds: performance.now() - stageStarted }); stageStarted = performance.now(); }
    if (view.requests > 0) view.intervals.push(elapsed);
    view.intervals = view.intervals.slice(-32);
    model.history = model.history.filter((item) => event.timestamp - item.timestamp <= 30_000).slice(-127);
    model.history.push(event);
    model.movement = model.movement.filter((item) => event.timestamp - item.timestamp <= 120_000).slice(-127);
    model.movement.push(event);
    view.routes.push(event.route);
    view.routes = view.routes.slice(-32);
    // These counts represent only the bounded recent window.
    view.counts = {};
    for (const item of model.history) view.counts[item.route] = (view.counts[item.route] ?? 0) + 1;
    const context = { event, history: model.history };
    model.temporal.observe(event);
    const retained = this.options.temporal !== false && model.temporal.correlated(event.timestamp);
    const routeSignals = routeEye(context); if (retained) for (const item of routeSignals) item.decay = .006;
    const signals: Signal[] = [...velocityEye(context), ...routeSignals, ...errorEye(context),
      ...AuthenticationEye({ event, history: model.movement }),
      ...SessionMovementEye({ event, history: model.movement, rarity: rarityMetrics }), ...(this.options.temporal === false ? [] : model.temporal.movement(event))];
    if (this.options.onProfile) { this.options.onProfile({ stage: 'eyes-and-temporal', milliseconds: performance.now() - stageStarted }); stageStarted = performance.now(); }
    signals.push(...HoneyEye({ event, history: model.movement }), ...PayloadAnomalyEye(context));
    if (this.options.onProfile) this.options.onProfile({ stage: 'honey-eye', milliseconds: performance.now() - stageStarted });
    model.signals.push(...signals);
    model.signals = model.signals.filter((item) => event.timestamp - item.timestamp <= this.signalRetentionMs).slice(-this.maxSignals);
    const intensity = signals.reduce((sum, item) => sum + item.intensity * item.confidence, 0);
    const rarity = 1 + 0.5 / (view.counts[event.route] ?? 1);
    const velocity = 1 + Math.min(1, model.history.filter((item) => event.timestamp - item.timestamp <= 1000).length / 20);
    const wave = vibration(intensity, rarity, velocity, family(event.route) ? 1.2 : 1);
    view.energy = energy(view.energy, wave, elapsed);
    view.entropy = entropy(model.history.map((item) => item.route));
    view.resonance = resonance(model.history, event.timestamp);
    let combined = resonanceV2(model.signals, event.timestamp, Math.min(30_000, this.signalRetentionMs));
    if (this.options.temporal !== false) { const sequence = resonanceV3(model.temporal.sequence(), model.signals, event.timestamp, this.signalRetentionMs); if (sequence.value > combined.value) combined = sequence; }
    view.resonance = Math.min(5.7, view.resonance + combined.value);
    this.graph.energize(event.route, wave, event.timestamp);
    const decision = score(model.score, event, signals, { energy: view.energy, vibration: wave, entropy: view.entropy,
      resonance: view.resonance, diffusion: diffusedAwareness, resonanceEyes: combined.eyes });
    if (typeof event.authentication?.authenticated === 'boolean') view.authenticated = event.authentication.authenticated;
    if (event.honey?.length) {
      view.honeyTouches = (view.honeyTouches ?? 0) + event.honey.length;
      view.honeySequence = [...(view.honeySequence ?? []), ...event.honey.map(({ resource, interaction }) => ({ resource, interaction }))].slice(-32);
    }
    view.lastSeen = event.timestamp;
    view.requests++;
    view.errors += [401, 403, 404].includes(event.status) ? 1 : 0;
    view.state = decision.state;
    view.decision = decision;
    model.temporal.rememberEyes(decision.calibration?.eyeTotals ?? {});
    view.riskProgression.push(decision.risk);
    view.riskProgression = view.riskProgression.slice(-32);
    this.models.delete(event.sessionId);
    this.models.set(event.sessionId, model);
    return { observation: event, signals, decision };
  }
  sessions(now: number): SessionView[] {
    this.prune(now);
    return Array.from(this.models.values(), ({ view, temporal }) => ({ ...structuredClone(view), behavior: temporal.behavior(view.lastSeen - view.startedAt, view.honeyTouches ?? 0), energy: round(decay(view.energy, now - view.lastSeen)) }));
  }
  session(id: string, now: number): SessionView | undefined {
    this.prune(now);
    const model = this.models.get(id), view = model?.view;
    return view && model ? { ...structuredClone(view), behavior: model.temporal.behavior(view.lastSeen - view.startedAt, view.honeyTouches ?? 0), energy: round(decay(view.energy, now - view.lastSeen)) } : undefined;
  }
  /** Internal memory checkpoint: fingerprint immediately copies these bounded arrays. */
  memorySnapshot(id: string): SessionView | undefined {
    const model = this.models.get(id); if (!model) return;
    const view = model.view;
    return { ...view, counts: {}, decision: null, behavior: model.temporal.behavior(view.lastSeen - view.startedAt, view.honeyTouches ?? 0) };
  }
  requestCount(id: string): number { return this.models.get(id)?.view.requests ?? 0; }
  previousRoute(id: string): string | undefined { return this.models.get(id)?.view.routes.at(-2); }
  statistics(now: number) {
    this.prune(now); this.graph.prune(now);
    let energy = 0, entropy = 0, resonance = 0, threats = 0;
    let spiderSense: State = this.models.size ? 'CALM' : 'DORMANT';
    const order: State[] = ['DORMANT', 'CALM', 'CURIOUS', 'ALERT', 'SUSPICIOUS', 'HOSTILE'];
    for (const { view } of this.models.values()) {
      energy += decay(view.energy, now - view.lastSeen);
      entropy += view.entropy; resonance += view.resonance;
      if (['SUSPICIOUS', 'HOSTILE'].includes(view.state)) threats++;
      if (order.indexOf(view.state) > order.indexOf(spiderSense)) spiderSense = view.state;
    }
    return { sessions: this.models.size, energy: round(energy), entropy: round(entropy / Math.max(1, this.models.size)),
      resonance: round(resonance), threats, spiderSense, connections: this.graph.size.edges, threads: this.graph.size.nodes };
  }
  liveSessions(now: number, limit = 64): LiveSession[] {
    this.prune(now);
    return [...this.models.values()].slice(-limit).map(({ view }) => ({ id: view.id, route: view.routes.at(-1) ?? '/',
      state: view.state, energy: round(decay(view.energy, now - view.lastSeen)), risk: view.decision?.risk ?? 0, confidence: view.decision?.confidence ?? 0 }));
  }
  close(): void { this.models.clear(); this.graph.close(); }
}
export { RouteGraph } from './graph/index.js';
export type { GraphOptions } from './graph/index.js';
export { TemporalMemory } from './memory/temporal.js';
