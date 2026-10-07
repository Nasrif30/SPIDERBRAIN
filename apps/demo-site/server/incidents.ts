import { randomUUID } from 'node:crypto';
import type { PayloadPattern } from '@spiderbrain/sensor';
import { assessmentLabels, type AttackCategory, type Incident } from '../shared/incidents.js';
import type { RequestRecord } from '../shared/protocol.js';

const inputReasons: Record<PayloadPattern, string> = {
  sql_like: 'SQL-like metacharacter or keyword sequence detected', script_like: 'Script-like input structure detected',
  path_traversal: 'Path traversal sequence detected', shell_like: 'Shell-like command separator structure detected',
};
const sensitive = /^\/(?:\.env-demo|\.git-demo|backup-demo|config-demo|internal-demo|debug-demo)(?:\/|$)/;
/** Labels are a read-only projection of runtime evidence, never new enforcement. */
export function classifyBehavior(record: RequestRecord, history: readonly RequestRecord[]): { categories: AttackCategory[]; evidence: string[] } {
  const now = record.timestamp, recent = history.filter(row => now - row.timestamp >= 0 && now - row.timestamp <= 60_000);
  const local = recent.filter(row => row.currentRoute === record.currentRoute), decision = record.vibration.decision;
  const failures = recent.filter(row => row.vibration.observation.authentication?.type === 'login_failure');
  const localFailures = local.filter(row => row.vibration.observation.authentication?.type === 'login_failure');
  const identities = new Set(failures.map(row => row.vibration.observation.authentication?.identityId).filter(Boolean));
  const patterns = new Set(local.flatMap(row => row.vibration.observation.payload ?? []));
  const hasEye = (eye: string) => decision.contributions.some(c => c.eye === eye && c.value >= .5);
  const authRoute = /^\/(?:login|register|auth)(?:\/|$)/.test(record.currentRoute);
  const supportedInput = local.length >= 2 && (localFailures.length >= 2 || local.filter(row => row.vibration.observation.payload?.length).length >= 2 || hasEye('velocity'));
  const routes = new Set(recent.map(row => row.currentRoute));
  const denied = local.filter(row => [401, 403].includes(row.vibration.observation.status));
  const failed = recent.filter(row => [401, 403, 404].includes(row.vibration.observation.status));
  const categories: AttackCategory[] = [], evidence: string[] = [];
  if (supportedInput) {
    if (patterns.has('sql_like') && (authRoute || /search|products/.test(record.currentRoute))) categories.push('SQL_INJECTION_SUSPECTED');
    if (patterns.has('script_like')) categories.push('XSS_PATTERN');
    if (patterns.has('path_traversal')) categories.push('PATH_TRAVERSAL_PATTERN');
    if (patterns.has('shell_like')) categories.push('COMMAND_INJECTION_PATTERN');
    for (const pattern of patterns) evidence.push(inputReasons[pattern]);
  }
  if (authRoute && failures.length >= 5 && identities.size >= 3 && hasEye('authentication')) categories.push('CREDENTIAL_STUFFING_PATTERN');
  else if (authRoute && localFailures.length >= 4 && hasEye('authentication')) categories.push('AUTH_BRUTE_FORCE');
  if (denied.length >= 3 && local.length >= 3 && (hasEye('error') || hasEye('authentication') || hasEye('route'))) categories.push('REPEATED_RESTRICTED_ACCESS');
  if (sensitive.test(record.currentRoute) && new Set(recent.filter(row => sensitive.test(row.currentRoute)).map(row => row.currentRoute)).size >= 3 && failed.length >= 2 && (hasEye('route') || hasEye('movement'))) categories.push('SENSITIVE_ROUTE_DISCOVERY');
  if (routes.size >= 5 && failed.length >= 3 && (hasEye('route') || hasEye('movement'))) categories.push('ROUTE_ENUMERATION');
  if (record.transport?.userAgentClass === 'automation' && routes.size >= 4 && failed.length >= 3 && (hasEye('route') || hasEye('velocity'))) categories.push('AUTOMATED_SCANNING');
  if (record.frequencyPerSecond >= 16 && hasEye('velocity')) categories.push('REQUEST_FLOOD_PATTERN');
  if (decision.contributions.some(c => c.eye === 'authentication' && /switching|state transitions/.test(c.signal) && c.value >= .5)) categories.push('SESSION_SWITCHING');
  if (routes.size >= 4 && failed.length >= 2 && decision.entropy >= 1.5 && hasEye('movement')) categories.push('ABNORMAL_NAVIGATION');
  if (!categories.length && ['ALERT', 'SUSPICIOUS', 'HOSTILE', 'TRAPPED'].includes(decision.state)) categories.push('UNKNOWN_ANOMALOUS_BEHAVIOR');
  if (localFailures.length) evidence.push(`${localFailures.length} application-reported failed authentication outcomes on this route`);
  if (denied.length >= 3) evidence.push(`${denied.length} restricted responses on this route`);
  if (local.length >= 3) evidence.push(`${local.length} repeated requests to the same normalized route in the retained minute`);
  if (routes.size >= 4 && failed.length >= 2) evidence.push(`${routes.size} normalized routes and ${failed.length} unsuccessful responses in the retained minute`);
  if (hasEye('velocity')) evidence.push(`Velocity Eye evidence; peak observed frequency ${Math.max(...recent.map(row => row.frequencyPerSecond), 0)} requests in one second`);
  if (decision.resonance > 0) evidence.push(`Repeated resonance ${decision.resonance.toFixed(1)} from the existing engine`);
  if (categories.includes('CREDENTIAL_STUFFING_PATTERN')) evidence.push(`${identities.size} distinct anonymous account references with repeated failures; credentials were not inspected`);
  if (categories.includes('AUTOMATED_SCANNING')) evidence.push('Coarse automation user-agent hint supports route/error evidence; headers are unverified');
  return { categories, evidence: [...new Set(evidence)].slice(0, 12) };
}

export class IncidentBook {
  private readonly reports = new Map<string, Incident>();
  constructor(readonly maxReports = 128, readonly retentionMs = 900_000) {}
  private prune(now: number) { for (const [key, value] of this.reports) if (now - value.timestamp > this.retentionMs) this.reports.delete(key); }
  observe(record: RequestRecord, history: readonly RequestRecord[]): void {
    this.prune(record.timestamp);
    const d = record.vibration.decision, result = classifyBehavior(record, history), category = result.categories[0];
    if (!category || d.risk < 2) return;
    const key = record.sessionId + '|' + record.currentRoute + '|' + category, previous = this.reports.get(key);
    const recent = history.filter(row => record.timestamp - row.timestamp <= 60_000).slice(-32);
    const recommendations = ['Monitor the anonymous session and preserve sanitized evidence.'];
    if (['SQL_INJECTION_SUSPECTED', 'XSS_PATTERN', 'PATH_TRAVERSAL_PATTERN', 'COMMAND_INJECTION_PATTERN'].includes(category)) recommendations.push('Review application input validation and safe query, output, path or command handling as appropriate.');
    if (/AUTH|CREDENTIAL|SESSION/.test(category)) recommendations.push('Review authentication logs and consider additional authentication.');
    recommendations.push('Consider temporary rate limits only after reviewing accumulated evidence.', 'Block only after sufficient corroborating evidence; never retaliate.');
    const report: Incident = {
      id: previous?.id ?? 'SB-IR-' + randomUUID(), firstSeen: previous?.firstSeen ?? record.timestamp, timestamp: record.timestamp,
      sessionId: record.sessionId, route: record.currentRoute, category, relatedCategories: result.categories.slice(1),
      severity: ['HOSTILE', 'TRAPPED'].includes(d.state) || (d.state === 'SUSPICIOUS' && d.risk >= 12) ? 'HIGH' : ['ALERT', 'SUSPICIOUS'].includes(d.state) ? 'MEDIUM' : 'LOW',
      state: d.state, risk: d.risk, confidence: d.confidence, summary: assessmentLabels[category], evidence: result.evidence,
      signals: structuredClone(d.contributions), recommendedResponse: recommendations,
      httpBehavior: { retainedRequests: recent.length, routeRequests: recent.filter(row => row.currentRoute === record.currentRoute).length,
        authFailures: recent.filter(row => row.vibration.observation.authentication?.type === 'login_failure').length,
        peakFrequency: Math.max(...recent.map(row => row.frequencyPerSecond), 0), methods: [...new Set(recent.map(row => row.vibration.observation.method))] },
      timeline: recent.map(row => ({ timestamp: row.timestamp, requestId: row.requestId, route: row.currentRoute,
        method: row.vibration.observation.method, status: row.vibration.observation.status,
        events: [...row.events.filter(e => /^(AUTH_|LAB_RESOURCE|REPEATED_)/.test(e.type)).map(e => e.type), ...(row.vibration.observation.payload ?? []).map(pattern => inputReasons[pattern])],
        risk: row.vibration.decision.risk, confidence: row.vibration.decision.confidence, state: row.vibration.decision.state, previousState: row.vibration.decision.previousState })),
      limitation: 'Heuristic assessment only. Confidence is evidence strength, not attack probability. No payload execution, vulnerability or attacker identity is established. Timeline is bounded; connection cohorts can include multiple visitors.',
    };
    this.reports.delete(key); this.reports.set(key, report);
    if (this.reports.size > this.maxReports) this.reports.delete(this.reports.keys().next().value!);
  }
  recent(route?: string, sessionId?: string, now = Date.now()): Incident[] {
    this.prune(now);
    return structuredClone([...this.reports.values()].filter(value => (!route || value.route === route) && (!sessionId || value.sessionId === sessionId)).reverse().slice(0, 20));
  }
  get(id: string, now = Date.now()): Incident | undefined { this.prune(now); const value = [...this.reports.values()].find(report => report.id === id); return value ? structuredClone(value) : undefined; }
  clear(): void { this.reports.clear(); }
}
