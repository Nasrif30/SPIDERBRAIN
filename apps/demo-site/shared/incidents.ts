import type { Contribution, State } from '@spiderbrain/sensor';
export const attackCategories = ['SQL_INJECTION_SUSPECTED', 'AUTH_BRUTE_FORCE', 'CREDENTIAL_STUFFING_PATTERN', 'ROUTE_ENUMERATION',
  'SENSITIVE_ROUTE_DISCOVERY', 'PATH_TRAVERSAL_PATTERN', 'COMMAND_INJECTION_PATTERN', 'XSS_PATTERN', 'AUTOMATED_SCANNING',
  'REQUEST_FLOOD_PATTERN', 'SESSION_SWITCHING', 'ABNORMAL_NAVIGATION', 'REPEATED_RESTRICTED_ACCESS', 'UNKNOWN_ANOMALOUS_BEHAVIOR'] as const;
export type AttackCategory = typeof attackCategories[number];
export const assessmentLabels: Record<AttackCategory, string> = {
  SQL_INJECTION_SUSPECTED: 'Possible SQL injection', AUTH_BRUTE_FORCE: 'Possible authentication brute force',
  CREDENTIAL_STUFFING_PATTERN: 'Behavior consistent with credential stuffing', ROUTE_ENUMERATION: 'Possible route enumeration',
  SENSITIVE_ROUTE_DISCOVERY: 'Possible sensitive-resource discovery', PATH_TRAVERSAL_PATTERN: 'Possible path traversal',
  COMMAND_INJECTION_PATTERN: 'Possible command injection', XSS_PATTERN: 'Possible XSS input pattern',
  AUTOMATED_SCANNING: 'Behavior consistent with automated scanning', REQUEST_FLOOD_PATTERN: 'Possible request flood',
  SESSION_SWITCHING: 'Suspected session switching', ABNORMAL_NAVIGATION: 'Suspected abnormal navigation',
  REPEATED_RESTRICTED_ACCESS: 'Behavior consistent with restricted-route probing', UNKNOWN_ANOMALOUS_BEHAVIOR: 'Suspected anomalous behavior',
};
export interface IncidentTimeline {
  timestamp: number; requestId: string; route: string; method: string; status: number;
  events: string[]; risk: number; confidence: number; state: State; previousState: State;
}
export interface Incident {
  id: string; timestamp: number; firstSeen: number; sessionId: string; route: string;
  category: AttackCategory; relatedCategories: AttackCategory[]; severity: 'LOW' | 'MEDIUM' | 'HIGH';
  state: State; confidence: number; risk: number; summary: string; evidence: string[];
  signals: Contribution[]; timeline: IncidentTimeline[]; recommendedResponse: string[];
  httpBehavior: { retainedRequests: number; routeRequests: number; authFailures: number; peakFrequency: number; methods: string[] };
  limitation: string;
}
