export type Eye = 'velocity' | 'route' | 'error' | 'authentication' | 'movement' | 'honey' | 'payload';
export const payloadPatterns = ['sql_like', 'script_like', 'path_traversal', 'shell_like'] as const;
export type PayloadPattern = typeof payloadPatterns[number];
export type HoneyInteractionType = 'route_touch' | 'file_touch' | 'token_reference';
export interface CanaryEntry { id: string; type: 'route' | 'file'; route: string; sensitivity: 'medium' | 'high'; enabled: boolean }
export type CanaryManifest = readonly CanaryEntry[];
export interface HoneyObservation { canaryId: string; resource: string; interaction: HoneyInteractionType }
export interface HoneyInteraction extends HoneyObservation { sessionId: string; timestamp: number }
export interface HoneyPatternStep { resource: string; interaction: HoneyInteractionType }
export type AuthenticationType = 'login_success' | 'login_failure' | 'protected_route_denial' | 'logout' | 'auth_transition';
export interface AuthenticationObservation {
  type: AuthenticationType;
  identityId?: string;
  authenticated?: boolean;
}
export type State = 'DORMANT' | 'CALM' | 'CURIOUS' | 'ALERT' | 'SUSPICIOUS' | 'HOSTILE' | 'TRAPPED';
export interface Signal {
  eye: Eye;
  signal: string;
  intensity: number;
  confidence: number;
  reason: string;
  /** Exponential decay rate, per second. */
  decay: number;
  timestamp: number;
}
/** Deliberately contains no body, query, headers, cookie, or client address. */
export interface Observation {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  route: string;
  method: string;
  timestamp: number;
  status: number;
  latency: number;
  authentication?: AuthenticationObservation;
  honey?: HoneyObservation[];
  /** Recognized structure flags only. Never submitted values or payload text. */
  payload?: PayloadPattern[];
}
export interface Contribution {
  signal: string;
  eye: Eye | 'physics';
  value: number;
  confidence: number;
  reason: string;
}
export interface ConfidenceExplanation {
  kind: 'heuristic';
  evidenceStrength: number;
  eyeDiversity: number;
  eyeTotals: Partial<Record<Eye, number>>;
  perEyeCap: number;
  signalRetentionMs: number;
  formula: string;
  meaningfulEyeMinimum?: number;
  evidenceDiversity?: number;
}
export interface Decision {
  sessionId: string;
  timestamp: number;
  state: State;
  previousState: State;
  risk: number;
  confidence: number;
  energy: number;
  vibration: number;
  entropy: number;
  resonance: number;
  evidenceEyes: Eye[];
  contributions: Contribution[];
  action: 'watch';
  reason: string;
  calibration?: ConfidenceExplanation;
  /** Diagnostic losses already applied to contributions, never subtracted twice. */
  adjustments?: Contribution[];
}
export interface VibrationEvent { observation: Observation; signals: Signal[]; decision: Decision }
export interface SessionView {
  id: string;
  startedAt: number;
  lastSeen: number;
  requests: number;
  state: State;
  energy: number;
  entropy: number;
  resonance: number;
  routes: string[];
  riskProgression: number[];
  intervals: number[];
  counts: Record<string, number>;
  errors: number;
  decision: Decision | null;
  authenticated?: boolean;
  honeyTouches?: number;
  honeySequence?: HoneyPatternStep[];
  behavior?: BehavioralFingerprint;
}
export interface BehavioralFingerprint {
  categories: string[];
  transitionShape: string[];
  timingBuckets: string[];
  velocityProfile: number[];
  eyeProfile: Partial<Record<Eye, number>>;
  honeyInterest: 'NONE' | 'LOW' | 'HIGH';
  durationMs: number;
}
export interface Fingerprint {
  id: string;
  sessionId: string;
  timestamp: number;
  requests: number;
  routes: string[];
  intervals: number[];
  velocity: number;
  entropy: number;
  energy: number;
  resonance: number;
  riskProgression: number[];
  classification: State;
  honeySequence?: HoneyPatternStep[];
  honeyInterest?: 'LOW' | 'HIGH';
  behavior?: BehavioralFingerprint;
}
export interface QueueCounters { queued: number; processed: number; coalesced: number; dropped: number; enqueued: number; maximumDepth: number }
export interface ProfileSample { stage: string; milliseconds: number }
export interface Similarity { patternId: string; similarity: number; meaning: 'behavioral similarity only' }
export interface SensorStatus {
  online: boolean;
  threads: number;
  sessions: number;
  vibrations: number;
  energy: number;
  entropy: number;
  resonance: number;
  threats: number;
  failures: number;
  memoryAvailable: boolean;
  droppedMemoryEvents: number;
  connections?: number;
  spiderSense?: State;
  webUrl?: string;
  canaries?: number;
  honeyTouches?: number;
  telemetry?: QueueCounters;
}
export interface RouteNode { route: string; visits: number; energy: number; awareness: number; lastActivity: number; neighbors: string[] }
export interface RouteEdge { from: string; to: string; transitions: number; lastActivity: number }
export interface RouteGraphView {
  nodes: RouteNode[];
  edges: RouteEdge[];
  limits: { maxNodes: number; maxEdges: number; retentionMs: number };
  evictedNodes: number;
  evictedEdges: number;
  totalNodes: number;
  totalEdges: number;
}
export interface LiveSession { id: string; route: string; state: State; energy: number; risk: number; confidence: number }
export interface LiveWebSnapshot { timestamp: number; status: SensorStatus; graph: RouteGraphView; sessions: LiveSession[]; strongest: VibrationEvent | null; pulses: { id?: string; route: string; from?: string; energy: number; honey?: boolean }[]; canaries?: CanaryEntry[] }
export const clamp = (n: number, min = 0, max = 1): number => Math.min(max, Math.max(min, n));
export const round = (n: number): number => Math.round(n * 100) / 100;
