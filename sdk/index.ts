import type { RequestHandler } from 'express';
import { Sensor, startTelemetry, type SensorOptions, type VibrationEvent } from '@spiderbrain/sensor';
import { spiderbrain as observer } from '@spiderbrain/express';
import { LocalCollector } from '../apps/demo-site/server/collector.js';
import { dashboard as dashboardServer } from '../apps/demo-site/server/dashboard.js';
import { listenLocal, closeLocal } from './network.js';

export { Sensor, Redactor, createSensor, startTelemetry } from '@spiderbrain/sensor';
export { noteAuthentication, canaryRoutes } from '@spiderbrain/express';
export type { SensorOptions, RequestMetadata, AuthenticationMetadata, VibrationEvent, SensorStatus } from '@spiderbrain/sensor';
export type { Incident, AttackCategory } from '../apps/demo-site/shared/incidents.js';
export const aiEventTypes = ['AI_MODEL_REQUEST', 'AI_MODEL_RESPONSE', 'AI_AGENT_ACTION', 'AI_TOOL_CALL', 'AI_TOOL_RESULT', 'AI_WORKFLOW_TRANSITION', 'AI_AUTH_EVENT'] as const;
export interface AIEvent {
  type: typeof aiEventTypes[number];
  sessionId: string;
  timestamp?: number;
  durationMs?: number;
  status?: number;
  model?: string;
  tool?: string;
  workflow?: string;
}
export interface SafeAIEvent extends Omit<AIEvent, 'sessionId' | 'timestamp'> { sessionId: string; timestamp: number; }
export interface SpiderbrainOptions extends SensorOptions {
  dashboard?: boolean;
  dashboardPort?: number;
  /** Application-owned names, not user input; all other names become redacted. */
  publicAINames?: readonly string[];
}
export type Guardian = RequestHandler & {
  sensor: Sensor;
  collector: LocalCollector;
  ready: Promise<{ dashboardUrl: string | null; telemetryUrl: string | null }>;
  emit(event: AIEvent): VibrationEvent | undefined;
  aiEvents(): SafeAIEvent[];
  close(): Promise<void>;
};

/** Express middleware + explicit metadata SDK. No body/header/prompt capture. */
export function spiderbrain(options: SpiderbrainOptions = {}): Guardian {
  const routes = [...(options.publicRoutes ?? []), ...aiEventTypes.map(type => '/api/ai/' + type.slice(3).toLowerCase().replaceAll('_', '-'))];
  const sensor = new Sensor({ ...options, publicRoutes: routes }), collector = new LocalCollector(sensor, undefined, routes);
  const publicNames = new Set((options.publicAINames ?? []).filter(name => /^[a-zA-Z0-9._-]{1,64}$/.test(name)).slice(0, 128));
  const aiHistory: SafeAIEvent[] = [];
  let aiEpoch = sensor.observationEpoch;
  const syncEpoch = () => { if (aiEpoch !== sensor.observationEpoch) { aiEpoch = sensor.observationEpoch; aiHistory.length = 0; } };
  let closed = false;
  let internal: Awaited<ReturnType<typeof startTelemetry>> | undefined;
  let web: ReturnType<typeof dashboardServer> | undefined;
  const handler = observer({ observe: raw => collector.observe(raw) }) as Guardian;
  handler.sensor = sensor; handler.collector = collector;
  handler.ready = (async () => {
    if (!options.dashboard) return { dashboardUrl: null, telemetryUrl: null };
    try {
      internal = await startTelemetry(sensor, { port: 0 });
      web = dashboardServer(sensor, collector, internal.url, () => '');
      const port = await listenLocal(web.server, options.dashboardPort ?? 5173); web.setPort(port);
      return { dashboardUrl: `http://127.0.0.1:${port}/web`, telemetryUrl: internal.url };
    } catch {
      if (web) await closeLocal(web.server); await internal?.close();
      try { options.onError?.('Dashboard unavailable; application monitoring continues'); } catch { /* fail open */ }
      return { dashboardUrl: null, telemetryUrl: null };
    }
  })();
  handler.emit = input => {
    try {
      syncEpoch();
      if (closed || !input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return;
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const keys = ['type', 'sessionId', 'timestamp', 'durationMs', 'status', 'model', 'tool', 'workflow'];
      if (!Object.entries(descriptors).every(([key, descriptor]) => keys.includes(key) && 'value' in descriptor)) return;
      if (!aiEventTypes.includes(input.type) || typeof input.sessionId !== 'string' || input.sessionId.length > 512) return;
      const now = Date.now(), timestamp = input.timestamp ?? now, duration = input.durationMs ?? 0, status = input.status ?? 200;
      if (!Number.isSafeInteger(timestamp) || Math.abs(timestamp - now) > 60_000 || !Number.isFinite(duration) || duration < 0 || duration > 3_600_000 || !Number.isInteger(status) || status < 100 || status > 599) return;
      for (const key of ['model', 'tool', 'workflow'] as const) if (input[key] !== undefined && typeof input[key] !== 'string') return;
      const kind = input.type.slice(3).toLowerCase().replaceAll('_', '-');
      const event = collector.observe({ clientKey: input.sessionId, path: '/api/ai/' + kind, routeTemplate: '/api/ai/' + kind, method: 'POST', status, latency: duration });
      if (!event) return;
      const safe: SafeAIEvent = { type: input.type, sessionId: event.observation.sessionId, timestamp, durationMs: duration, status };
      for (const key of ['model', 'tool', 'workflow'] as const) if (input[key] !== undefined) safe[key] = publicNames.has(input[key]!) ? input[key]! : 'redacted';
      aiHistory.push(safe); if (aiHistory.length > 256) aiHistory.shift();
      return event;
    } catch { return undefined; }
  };
  handler.aiEvents = () => { syncEpoch(); return structuredClone(aiHistory); };
  handler.close = async () => {
    if (closed) return; closed = true;
    await handler.ready; if (web) await closeLocal(web.server); await internal?.close();
    aiHistory.length = 0; sensor.close();
  };
  return handler;
}
export const createSpiderbrain = spiderbrain;
