import { clamp, round, type Contribution, type Decision, type Eye, type Observation, type Signal, type State } from '@spiderbrain/shared';
import { decay } from '../physics/decay.js';
import { activeStates, desiredState, transition, type Inertia } from '../instincts/state.js';
export interface Evidence { eye: Eye; value: number; confidence: number; reason: string; timestamp: number; observedAt: number; decay: number }
export interface ScoreModel extends Inertia { evidence: Map<string, Evidence>; signalRetentionMs: number; maxSignals: number; meaningfulEyeMinimum?: number }
const perEyeCap = 5;
function totals(evidence: Map<string, Evidence>): Partial<Record<Eye, number>> {
  const result: Partial<Record<Eye, number>> = {};
  for (const item of evidence.values()) result[item.eye] = Math.min(perEyeCap, (result[item.eye] ?? 0) + item.value);
  return result;
}
/** Each signal is capped and decays. Multiple Eyes are required for high confidence. */
export function score(model: ScoreModel, event: Observation, signals: Signal[], physics: { energy: number; vibration: number; entropy: number; resonance: number; diffusion?: number; resonanceEyes?: Eye[] }): Decision {
  const beforeDecay = Object.values(totals(model.evidence)).reduce((sum, value) => sum + (value ?? 0), 0);
  for (const [name, evidence] of model.evidence) {
    evidence.value = decay(evidence.value, event.timestamp - evidence.timestamp, evidence.decay);
    evidence.timestamp = event.timestamp;
    if (evidence.value < 0.05 || event.timestamp - evidence.observedAt > model.signalRetentionMs) model.evidence.delete(name);
  }
  const decayLoss = round(Math.max(0, beforeDecay - Object.values(totals(model.evidence)).reduce((sum, value) => sum + (value ?? 0), 0)));
  for (const signal of signals) {
    const previous = model.evidence.get(signal.signal)?.value ?? 0;
    if (!model.evidence.has(signal.signal) && model.evidence.size >= model.maxSignals) {
      const oldest = [...model.evidence].sort((a, b) => a[1].observedAt - b[1].observedAt)[0];
      if (oldest) model.evidence.delete(oldest[0]);
    }
    model.evidence.set(signal.signal, {
      eye: signal.eye, value: clamp(previous + signal.intensity * signal.confidence * 0.65, 0, 5),
      confidence: signal.confidence, reason: signal.reason, timestamp: event.timestamp, observedAt: signal.timestamp, decay: signal.decay,
    });
  }
  const rawTotals: Partial<Record<Eye, number>> = {};
  for (const item of model.evidence.values()) rawTotals[item.eye] = (rawTotals[item.eye] ?? 0) + item.value;
  const allocated: Partial<Record<Eye, number>> = {};
  const contributions: Contribution[] = Array.from(model.evidence, ([signal, item]) => {
    const value = Math.min(round(item.value * Math.min(1, perEyeCap / (rawTotals[item.eye] ?? 1))), round(Math.max(0, perEyeCap - (allocated[item.eye] ?? 0))));
    allocated[item.eye] = (allocated[item.eye] ?? 0) + value;
    return { signal, eye: item.eye, value, confidence: item.confidence, reason: item.reason };
  });
  const meaningfulEyeMinimum = model.meaningfulEyeMinimum ?? .8;
  const eyes = (Object.keys(allocated) as Eye[]).filter(eye => (allocated[eye] ?? 0) >= meaningfulEyeMinimum);
  if (physics.resonance > 0) contributions.push({ signal: 'repeated resonance', eye: 'physics',
    value: round(Math.min(4, physics.resonance * 0.7)), confidence: 0.75,
    reason: `Related unsuccessful route variants and bounded temporal evidence from ${physics.resonanceEyes?.length ?? 0} distinct Eyes resonate; correlated signals remain heuristic` });
  if ((physics.diffusion ?? 0) > 0) contributions.push({ signal: 'local diffusion', eye: 'physics',
    value: round(Math.min(0.8, (physics.diffusion ?? 0) * 0.4)), confidence: 0.3,
    reason: 'Weak decaying awareness from directly connected observed routes; no independent confidence or identity attribution' });
  if (eyes.length >= 2 && physics.entropy > 2) contributions.push({ signal: 'navigation entropy', eye: 'physics',
    value: round(Math.min(1.2, physics.entropy * 0.2)), confidence: 0.5, reason: 'Route diversity supports existing evidence from multiple Eyes; entropy alone never classifies' });
  // Energy is bounded support, not a separate Eye or independent proof.
  if (eyes.length >= 2) contributions.push({ signal: 'behavioral energy', eye: 'physics', value: round(physics.energy * 0.14),
    confidence: 0.6, reason: 'Decaying accumulated vibration energy supports repeated multi-Eye evidence' });
  const risk = round(contributions.reduce((sum, item) => sum + item.value, 0));
  const evidenceStrength = clamp(contributions.filter((item) => item.eye !== 'physics').reduce((sum, item) => sum + item.value, 0) / 12);
  const eyeDiversity = Math.min(1, eyes.length / 3);
  const confidence = round(clamp(evidenceStrength * 0.55 + eyeDiversity * 0.4, 0, 0.95));
  const previousState: State = model.state;
  const target = desiredState(risk, confidence, eyes.length);
  const state = transition(model, target, signals.length > 0, event.timestamp, risk);
  const reason = activeStates.indexOf(target) > activeStates.indexOf(state)
    ? `Evidence is accumulating; promotion requires three stable observations (${model.upward}/3 currently)`
    : activeStates.indexOf(target) < activeStates.indexOf(state)
      ? 'State held by hysteresis: recovery requires lower risk, five clean observations and fifteen seconds in the state'
      : state === 'CALM' ? 'No accumulated behavioral disturbance warrants escalation'
        : `Accumulated evidence across ${eyes.length} Eye(s); observing and preserving sanitized evidence`;
  return { sessionId: event.sessionId, timestamp: event.timestamp, state, previousState, risk, confidence,
    energy: round(physics.energy), vibration: round(physics.vibration), entropy: round(physics.entropy), resonance: physics.resonance,
    evidenceEyes: eyes, contributions, action: 'watch',
    calibration: { kind: 'heuristic', evidenceStrength: round(evidenceStrength), eyeDiversity: round(eyeDiversity),
      eyeTotals: totals(model.evidence), perEyeCap, signalRetentionMs: model.signalRetentionMs, meaningfulEyeMinimum, evidenceDiversity: eyes.length,
      formula: 'min(0.95, 0.55 × min(capped evidence / 12, 1) + 0.40 × min(distinct Eyes / 3, 1)); physics adds no confidence' },
    adjustments: decayLoss > 0 ? [{ signal: 'time decay', eye: 'physics', value: -decayLoss, confidence: 1,
      reason: 'Loss already applied to carried Eye evidence before these totals; do not subtract twice' }] : [],
    reason };
}
