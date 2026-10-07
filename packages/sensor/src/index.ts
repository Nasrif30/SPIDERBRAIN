import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Synganglion, type GraphOptions } from '@spiderbrain/synganglion';
import { WebMemory, fingerprint, type MemoryOptions } from '@spiderbrain/synganglion/memory';
import { Silk } from '@spiderbrain/silk';
import type { SensorStatus, VibrationEvent, LiveWebSnapshot, ProfileSample } from '@spiderbrain/shared';
import { Redactor, type RequestMetadata } from './redaction.js';
import { AnonymousSessions } from './sessions.js';
import { CanaryEngine, type CanaryOptions } from '@spiderbrain/deception';
export { createCanaryManifest, DeceptionBoundary } from '@spiderbrain/deception';
export { Redactor } from './redaction.js';
export { payloadPatterns } from '@spiderbrain/shared';
export type { RequestMetadata, AuthenticationMetadata } from './redaction.js';
export type * from '@spiderbrain/shared';
export interface SensorOptions {
  maxSessions?: number;
  sessionTtlMs?: number;
  publicRoutes?: readonly string[];
  memory?: false | Partial<Omit<MemoryOptions, 'onError'>>;
  clock?: () => number;
  /** Receives a fixed message, never attacker-controlled text or exception details. */
  onError?: (message: string) => void;
  graph?: GraphOptions;
  signalRetentionMs?: number;
  maxSignals?: number;
  /** Explicit opt-in. The catalog and response templates contain only synthetic data. */
  canaries?: false | CanaryOptions;
  /** Diagnostic timings only; no request data is included. Disabled by default. */
  onProfile?: (sample: ProfileSample) => void;
  temporal?: boolean;
  meaningfulEyeMinimum?: number;
}
export class Sensor {
  readonly silk: Silk;
  readonly memory: WebMemory | undefined;
  readonly canaries: CanaryEngine;
  private readonly brain: Synganglion;
  private readonly anonymous = new AnonymousSessions();
  private readonly identities = new AnonymousSessions();
  private readonly redactor: Redactor;
  private readonly clock: () => number;
  private closed = false;
  private failed = false;
  private failures = 0;
  private vibrations = 0;
  private honeyTouches = 0;
  private lastTimestamp = 0;
  private strongest: VibrationEvent | null = null;
  private resetCount = 0;
  get observationEpoch(): number { return this.resetCount; }
  constructor(private readonly options: SensorOptions = {}) {
    this.clock = options.clock ?? Date.now;
    try { this.canaries = new CanaryEngine(options.canaries ?? false); }
    catch { this.canaries = new CanaryEngine(); this.report('Canary policy rejected configuration; canaries disabled'); }
    this.brain = new Synganglion(options.maxSessions, options.sessionTtlMs, {
      ...(options.graph ? { graph: options.graph } : {}),
      ...(options.signalRetentionMs !== undefined ? { signalRetentionMs: options.signalRetentionMs } : {}),
      ...(options.maxSignals !== undefined ? { maxSignals: options.maxSignals } : {}),
      ...(options.temporal !== undefined ? { temporal: options.temporal } : {}),
      ...(options.meaningfulEyeMinimum !== undefined ? { meaningfulEyeMinimum: options.meaningfulEyeMinimum } : {}),
      ...(options.onProfile ? { onProfile: sample => { try { options.onProfile?.(sample); } catch { /* isolated */ } } } : {}) });
    this.redactor = new Redactor(options.publicRoutes);
    this.silk = new Silk(() => this.report('SILK subscriber failed; application continues'));
    if (options.memory !== false) {
      try { this.memory = new WebMemory({ ...options.memory,
        path: options.memory?.path ?? resolve('.spiderbrain/web-memory.sqlite'),
        onError: () => this.report('Web Memory disabled; application continues') }); }
      catch { this.report('Web Memory unavailable; application continues'); }
    }
  }
  private now(): number {
    const timestamp = this.clock();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid clock');
    this.lastTimestamp = Math.max(timestamp, this.lastTimestamp);
    return this.lastTimestamp;
  }
  private report(message: string): void {
    this.failures++;
    try { this.options.onError?.(message); } catch { /* fail open */ }
  }
  private profile(stage: string, started: number): void { if (this.options.onProfile) try { this.options.onProfile({ stage, milliseconds: performance.now() - started }); } catch { /* diagnostics never disable sensing */ } }
  /** Metadata is redacted before any Eye, subscriber or memory sees it. Never throws. */
  observe(raw: RequestMetadata): VibrationEvent | undefined {
    if (this.closed || this.failed) return;
    try {
      const now = this.now();
      let started = this.options.onProfile ? performance.now() : 0;
      const identity = typeof raw.authentication?.identityKey === 'string' ? this.identities.id(raw.authentication.identityKey, now).replace('SB-', 'SB-I-') : undefined;
      const observation = this.redactor.observation(raw, this.anonymous.id(raw.clientKey, now), now, identity);
      this.profile('redaction-and-anonymization', started); started = this.options.onProfile ? performance.now() : 0;
      if (this.canaries.count) {
        const honey = this.canaries.interactions(raw.path, raw.honey);
        if (honey.length) { observation.honey = honey; this.honeyTouches += honey.length; }
      }
      this.profile('canary-index', started); started = this.options.onProfile ? performance.now() : 0;
      const event = this.brain.sense(observation);
      this.profile('synganglion', started); started = this.options.onProfile ? performance.now() : 0;
      this.vibrations++;
      const requests = this.brain.requestCount(observation.sessionId);
      const snapshot = this.memory?.online && (requests === 1 || requests % 10 === 0 || (observation.honey?.length && requests % 5 === 0) || event.decision.state !== event.decision.previousState);
      this.memory?.append(event, snapshot ? this.brain.memorySnapshot(observation.sessionId) : undefined);
      this.profile('snapshot-and-memory-queue', started); started = this.options.onProfile ? performance.now() : 0;
      if (!this.strongest || now - this.strongest.observation.timestamp > 30_000 || event.decision.vibration > this.strongest.decision.vibration ||
        (event.decision.vibration === this.strongest.decision.vibration && event.decision.risk > this.strongest.decision.risk)) this.strongest = structuredClone(event);
      this.profile('strongest-copy', started); started = this.options.onProfile ? performance.now() : 0;
      this.silk.publish(event);
      this.profile('silk', started);
      return event;
    } catch {
      this.failed = true;
      this.report('SPIDERBRAIN FAILURE: telemetry disabled; application continues');
      return undefined;
    }
  }
  status(): SensorStatus {
    let stats: ReturnType<Synganglion['statistics']> = { threads: 0, sessions: 0, energy: 0, entropy: 0, resonance: 0, threats: 0, spiderSense: 'DORMANT', connections: 0 };
    try { if (!this.closed) stats = this.brain.statistics(this.now()); } catch { this.failed = true; }
    return { ...stats, online: !this.closed && !this.failed, vibrations: this.vibrations,
      failures: this.failures, memoryAvailable: this.memory?.online ?? false, droppedMemoryEvents: this.memory?.dropped ?? 0,
      canaries: this.closed || this.failed ? 0 : this.canaries.count, honeyTouches: this.honeyTouches, ...(this.memory ? { telemetry: this.memory.counters } : {}) };
  }
  liveWeb(pulses: LiveWebSnapshot['pulses'] = []): LiveWebSnapshot {
    const now = this.now();
    return { timestamp: now, status: this.status(), graph: this.brain.graph.snapshot(now, 100, 250), sessions: this.brain.liveSessions(now),
      strongest: this.strongest && now - this.strongest.observation.timestamp <= 30_000 ? structuredClone(this.strongest) : null, pulses,
      canaries: this.closed || this.failed ? [] : this.canaries.manifest };
  }
  /** Closed or failed sensing never intercepts the protected application's routes. */
  canaryResponse(path: string, method: string) { return this.closed || this.failed ? undefined : this.canaries.response(path, method); }
  previousRoute(id: string): string | undefined { return this.closed || this.failed ? undefined : this.brain.previousRoute(id); }
  sessions() { return this.closed || this.failed ? [] : this.brain.sessions(this.now()); }
  inspect(id: string) {
    if (this.closed || this.failed) return undefined;
    const session = this.brain.session(id, this.now());
    return session ? { session, similarity: this.memory?.compare(fingerprint(session)) ?? null, timeline: this.memory?.sessionEvents(id) ?? [] } : undefined;
  }
  /** Clear transient observations only. Stored Web Memory and configuration survive. */
  resetObservation(): boolean {
    if (this.closed || this.failed) return false;
    this.brain.close(); this.anonymous.reset(); this.identities.reset();
    this.vibrations = 0; this.honeyTouches = 0; this.strongest = null;
    this.resetCount++;
    return true;
  }
  close(): void {
    if (this.closed) return;
    try {
      if (this.memory?.online) {
        for (const session of this.brain.sessions(this.now())) this.memory.remember(session);
      }
    } catch { this.report('Final memory snapshot unavailable; application continues'); }
    this.closed = true;
    this.memory?.close();
    this.brain.close();
    this.silk.close();
  }
}
export const createSensor = (options?: SensorOptions): Sensor => new Sensor(options);
export { startTelemetry } from './telemetry.js';
export { listenLocal, closeLocal } from './network.js';
