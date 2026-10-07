export interface ArenaStep { path: string; afterMs: number; outcome?: 'success' | 'failure' | 'logout'; identity?: 'sample-a' | 'sample-b' | 'sample-c'; canaryReference?: string; client?: number }
export interface ArenaScenario { name: string; expected: 'ordinary' | 'probing'; steps: ArenaStep[]; family?: string; canaries?: boolean; partition?: 'calibration' | 'holdout' }
export interface ArenaMetrics {
  scenario: string;
  expected: ArenaScenario['expected'];
  trueDetections: number;
  falsePositives: number;
  missedDetections: number;
  timeToDetectionMs: number | null;
  requestsBeforeDetection: number | null;
  maximumRisk: number;
  maximumConfidence: number;
  finalState: string;
  requests: number;
  graphNodes: number;
  graphEdges: number;
  TP: number; TN: number; FP: number; FN: number;
  family: string;
  maximumEnergy: number;
  honeyTouches: number;
  signals: { eye: string; signal: string; requests: number; maximumContribution: number; atDetection: number }[];
  thresholdCrossings: number;
  rapidStateReversals: number;
  partition?: 'calibration' | 'holdout';
  queue?: import('@spiderbrain/shared').QueueCounters;
}
