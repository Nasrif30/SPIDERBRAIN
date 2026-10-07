import { createHmac, randomBytes } from 'node:crypto';
import { Redactor, payloadPatterns, type RequestMetadata, type Sensor, type VibrationEvent } from '@spiderbrain/sensor';
import { labResources, siteRoutes } from '../shared/catalog.js';
import type { CollectedRequest, LabEvent, LabEventType, RequestRecord, TransportHints } from '../shared/protocol.js';
import { DemoLog } from './log.js';
import { IncidentBook } from './incidents.js';
import type { Incident } from '../shared/incidents.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => 'value' in d);
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const redactor = new Redactor(siteRoutes);
/** Strict runtime schema. Extra fields (including credentials) are rejected. */
export function validRequest(value: unknown, routes = redactor): value is CollectedRequest {
  if (!plain(value) || !only(value, ['schemaVersion', 'requestId', 'clientId', 'timestamp', 'route', 'method', 'status', 'latencyMs', 'labResource', 'authentication', 'transport', 'payload'])) return false;
  if (value.schemaVersion !== 1 || typeof value.requestId !== 'string' || !uuid.test(value.requestId) || typeof value.clientId !== 'string' || !/^SB-[a-f0-9]{24}$/.test(value.clientId)) return false;
  if (typeof value.route !== 'string' || value.route.length > 1024 || routes.route(value.route) !== value.route || typeof value.method !== 'string' || !/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE|OTHER)$/.test(value.method)) return false;
  if (!Number.isSafeInteger(value.timestamp) || (value.timestamp as number) < 0 || !Number.isInteger(value.status) || (value.status as number) < 100 || (value.status as number) > 599 || typeof value.latencyMs !== 'number' || !Number.isFinite(value.latencyMs) || value.latencyMs < 0 || value.latencyMs > 3_600_000) return false;
  if (typeof value.labResource !== 'boolean' || value.labResource !== Object.hasOwn(labResources, value.route)) return false;
  if (value.payload !== undefined && (!Array.isArray(value.payload) || value.payload.length > 4 || !Object.values(Object.getOwnPropertyDescriptors(value.payload)).every(d => 'value' in d) || new Set(value.payload).size !== value.payload.length || !value.payload.every(pattern => payloadPatterns.includes(pattern)))) return false;
  if (value.transport !== undefined) {
    const hints = value.transport;
    if (!plain(hints) || !only(hints, ['cloudflarePresent', 'forwardedAddressClass', 'userAgentClass']) || typeof hints.cloudflarePresent !== 'boolean' ||
      typeof hints.forwardedAddressClass !== 'string' || !['absent', 'ipv4', 'ipv6', 'invalid'].includes(hints.forwardedAddressClass) ||
      typeof hints.userAgentClass !== 'string' || !['unknown', 'browser', 'automation', 'other'].includes(hints.userAgentClass)) return false;
  }
  if (value.authentication !== undefined) {
    const auth = value.authentication;
    if (!plain(auth) || !only(auth, ['type', 'identityId', 'authenticated']) || typeof auth.type !== 'string' || !['login_success', 'login_failure', 'protected_route_denial', 'logout', 'auth_transition'].includes(auth.type)) return false;
    if (auth.identityId !== undefined && (typeof auth.identityId !== 'string' || !/^SB-I-[a-f0-9]{24}$/.test(auth.identityId))) return false;
    if (auth.authenticated !== undefined && typeof auth.authenticated !== 'boolean') return false;
    if (auth.type === 'auth_transition' && typeof auth.authenticated !== 'boolean') return false;
  }
  return true;
}
/** Reuses the existing Express observer and Sensor. Collection stays in-process;
 * no external target, injection HTTP endpoint, extra behavior engine or new Eye. */
export class LocalCollector {
  readonly incidents = new IncidentBook();
  private secret = randomBytes(32);
  private epoch = -1;
  private readonly ids = new Map<string, number>();
  private readonly history = new Map<string, RequestRecord[]>();
  private accepted = 0;
  private rejected = 0;
  private duplicates = 0;
  private readonly redactor: Redactor;
  private significant: Incident | undefined;
  constructor(readonly sensor: Sensor, readonly log?: DemoLog, routes: readonly string[] = siteRoutes) { this.redactor = new Redactor(routes); }
  private id(value: string, now: number, identity = false): string {
    const epoch = Math.floor(now / 86_400_000);
    if (epoch !== this.epoch) { this.secret = randomBytes(32); this.epoch = epoch; }
    return (identity ? 'SB-I-' : 'SB-') + createHmac('sha256', this.secret).update((identity ? 'identity:' : 'client:') + value).digest('hex').slice(0, 24);
  }
  observe(raw: RequestMetadata, transport?: TransportHints): VibrationEvent | undefined {
    try {
      const now = Date.now(), safe = this.redactor.observation(raw, this.id(raw.clientKey, now), now, raw.authentication?.identityKey ? this.id(raw.authentication.identityKey, now, true) : undefined);
      return this.receive({ schemaVersion: 1, requestId: safe.id, clientId: safe.sessionId, timestamp: safe.timestamp, route: safe.route,
        method: safe.method, status: safe.status, latencyMs: safe.latency, labResource: Object.hasOwn(labResources, safe.route), ...(safe.authentication ? { authentication: safe.authentication } : {}), ...(transport ? { transport } : {}), ...(safe.payload ? { payload: safe.payload } : {}) });
    } catch { this.rejected++; return undefined; }
  }
  receive(value: unknown): VibrationEvent | undefined {
    if (!validRequest(value, this.redactor)) { this.rejected++; return undefined; }
    if (this.ids.has(value.requestId)) { this.duplicates++; return undefined; }
    const now = Date.now();
    if (Math.abs(now - value.timestamp) > 60_000) { this.rejected++; return undefined; }
    for (const [id, timestamp] of this.ids) if (now - timestamp > 900_000) this.ids.delete(id);
    if (this.ids.size >= 2048) this.ids.delete(this.ids.keys().next().value!);
    this.ids.set(value.requestId, value.timestamp);
    const event = this.sensor.observe({ clientKey: value.clientId, path: value.route, routeTemplate: value.route, method: value.method, status: value.status, latency: value.latencyMs, ...(value.payload ? { payload: value.payload } : {}),
      ...(value.authentication ? { authentication: { type: value.authentication.type, ...(value.authentication.identityId ? { identityKey: value.authentication.identityId } : {}), ...(value.authentication.authenticated !== undefined ? { authenticated: value.authentication.authenticated } : {}) } } : {}) });
    if (!event) return undefined;
    this.accepted++;
    for (const [id, rows] of this.history) if (now - rows.at(-1)!.timestamp > 900_000) this.history.delete(id);
    const sessionId = event.observation.sessionId, previous = this.history.get(sessionId), previousRoute = previous?.at(-1)?.currentRoute ?? null;
    const types: LabEventType[] = [previous ? 'SESSION_UPDATED' : 'SESSION_CREATED', 'ROUTE_VISIT', 'BEHAVIOR_UPDATE'];
    if (previousRoute) types.push('ROUTE_TRANSITION');
    if (value.labResource) types.push('LAB_RESOURCE_ACCESS');
    if (['login_success', 'login_failure'].includes(value.authentication?.type ?? '')) types.push('AUTH_ATTEMPT', value.authentication?.type === 'login_success' ? 'AUTH_SUCCESS' : 'AUTH_FAILURE');
    if (event.signals.some(s => s.eye === 'velocity')) types.push('VELOCITY_CHANGE');
    if (previous?.some(row => row.currentRoute === value.route)) types.push('REPEATED_ROUTE');
    const events: LabEvent[] = types.map(type => ({ type, requestId: value.requestId, sessionId, timestamp: event.observation.timestamp, route: event.observation.route, previousRoute, method: event.observation.method, status: event.observation.status, latencyMs: event.observation.latency, labResource: value.labResource,
      ...(['AUTH_ATTEMPT', 'AUTH_SUCCESS', 'AUTH_FAILURE'].includes(type) ? { identityClass: 'demo-account' as const } : {}), risk: event.decision.risk, confidence: event.decision.confidence, classification: event.decision.state }));
    const recent = previous?.filter(row => now - row.timestamp <= 1000).length ?? 0;
    const record: RequestRecord = { requestId: value.requestId, sensorEventId: event.observation.id, sessionId, timestamp: event.observation.timestamp, previousRoute, currentRoute: event.observation.route, frequencyPerSecond: recent + 1, events, vibration: structuredClone(event), ...(value.transport ? { transport: { ...value.transport } } : {}) };
    if (!previous && this.history.size >= 128) this.history.delete(this.history.keys().next().value!);
    const rows = previous ?? []; rows.push(record); if (rows.length > 64) rows.shift(); this.history.set(sessionId, rows);
    // Reporting is isolated from sensing and application response delivery.
    try {
      this.incidents.observe(record, rows);
      const report = this.incidents.recent(undefined, sessionId, now).find(item => item.route === record.currentRoute && item.timestamp === record.timestamp && item.severity !== 'LOW');
      if (report) this.significant = report;
    } catch { /* fail open */ }
    this.log?.append(record);
    return event;
  }
  session(id: string): RequestRecord[] { return structuredClone(this.history.get(id) ?? []); }
  lastSignificant(): Incident | null { return this.significant ? structuredClone(this.significant) : null; }
  resetObservation(): boolean {
    if (!this.sensor.resetObservation()) return false;
    this.ids.clear(); this.history.clear(); this.incidents.clear(); this.significant = undefined;
    this.secret = randomBytes(32); this.epoch = -1; this.accepted = 0; this.rejected = 0; this.duplicates = 0;
    return true;
  }
  routeEvidence(route: string) {
    const rows = [...this.history.values()].flatMap(records => records.filter(row => row.currentRoute === route && Date.now() - row.timestamp <= 900_000)).sort((a, b) => b.timestamp - a.timestamp);
    const latest = rows[0]?.vibration.decision;
    return { route, state: latest?.state ?? 'DORMANT', risk: latest?.risk ?? 0, confidence: latest?.confidence ?? 0,
      sessions: [...new Set(rows.map(row => row.sessionId))], recent: structuredClone(rows.slice(0, 12)), incidents: this.incidents.recent(route) };
  }
  counters() { return { accepted: this.accepted, rejected: this.rejected, duplicates: this.duplicates, sessions: this.history.size, logged: this.log?.processed ?? 0, droppedLogs: this.log?.dropped ?? 0, loggingOnline: this.log?.online ?? false }; }
}
