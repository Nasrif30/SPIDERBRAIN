import type { State } from '@spiderbrain/shared';
export const activeStates: State[] = ['CALM', 'CURIOUS', 'ALERT', 'SUSPICIOUS', 'HOSTILE'];
export function desiredState(risk: number, confidence: number, eyes: number): State {
  if (risk >= 16 && confidence >= 0.8 && eyes >= 3) return 'HOSTILE';
  if (risk >= 10 && confidence >= 0.65 && eyes >= 2) return 'SUSPICIOUS';
  if (risk >= 6 && eyes >= 2) return 'ALERT';
  if (risk >= 2) return 'CURIOUS';
  return 'CALM';
}
export interface Inertia { state: State; upward: number; clean: number; changedAt: number; candidate?: State }
const demotionThreshold: Partial<Record<State, number>> = { CURIOUS: 1, ALERT: 4, SUSPICIOUS: 7, HOSTILE: 12 };
export function transition(model: Inertia, target: State, hasEvidence: boolean, now: number, risk = 0): State {
  const current = activeStates.indexOf(model.state);
  const desired = activeStates.indexOf(target);
  if (desired > current) {
    model.clean = 0;
    model.upward = model.candidate === target ? model.upward + 1 : 1;
    model.candidate = target;
    if (model.upward >= 3) {
      model.state = activeStates[current + 1] ?? 'HOSTILE';
      model.changedAt = now;
      model.upward = 0;
    }
  } else {
    model.upward = 0;
    delete model.candidate;
    model.clean = hasEvidence ? 0 : model.clean + 1;
    if (desired < current && risk < (demotionThreshold[model.state] ?? 0) && model.clean >= 5 && now - model.changedAt >= 15_000) {
      model.state = activeStates[current - 1] ?? 'CALM';
      model.changedAt = now;
      model.clean = 0;
    }
  }
  return model.state;
}
