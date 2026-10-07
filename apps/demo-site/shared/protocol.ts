import type { AuthenticationObservation, VibrationEvent, PayloadPattern } from '@spiderbrain/sensor';
/** Credentials, headers, bodies, queries and addresses have no fields in this protocol. */
export interface TransportHints {
  /** Header presence is unverified and is not proof of Cloudflare delivery. */
  cloudflarePresent: boolean;
  forwardedAddressClass: 'absent' | 'ipv4' | 'ipv6' | 'invalid';
  userAgentClass: 'unknown' | 'browser' | 'automation' | 'other';
}
export interface CollectedRequest {
  schemaVersion: 1;
  requestId: string;
  clientId: string;
  timestamp: number;
  route: string;
  method: string;
  status: number;
  latencyMs: number;
  labResource: boolean;
  authentication?: AuthenticationObservation;
  transport?: TransportHints;
  payload?: PayloadPattern[];
}
export type LabEventType = 'ROUTE_VISIT' | 'ROUTE_TRANSITION' | 'SESSION_CREATED' | 'SESSION_UPDATED' | 'AUTH_ATTEMPT' | 'AUTH_SUCCESS' | 'AUTH_FAILURE' | 'LAB_RESOURCE_ACCESS' | 'VELOCITY_CHANGE' | 'REPEATED_ROUTE' | 'BEHAVIOR_UPDATE';
export interface LabEvent {
  type: LabEventType;
  requestId: string;
  sessionId: string;
  timestamp: number;
  route: string;
  previousRoute: string | null;
  method: string;
  status: number;
  latencyMs: number;
  labResource: boolean;
  identityClass?: 'demo-account';
  risk: number;
  confidence: number;
  classification: VibrationEvent['decision']['state'];
}
export interface RequestRecord {
  requestId: string;
  sensorEventId: string;
  sessionId: string;
  timestamp: number;
  previousRoute: string | null;
  currentRoute: string;
  events: LabEvent[];
  vibration: VibrationEvent;
  frequencyPerSecond: number;
  transport?: TransportHints;
}
export interface CollectorCounters { accepted: number; rejected: number; duplicates: number; sessions: number; logged: number; droppedLogs: number; loggingOnline: boolean }
