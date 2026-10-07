import type { VibrationEvent, Eye } from '@spiderbrain/shared';
const eyes: Eye[] = ['velocity', 'route', 'error', 'authentication', 'movement', 'honey'];
export function autopsy(name: string, events: readonly VibrationEvent[]) {
  const fired = eyes.filter(eye => events.some(event => event.signals.some(signal => signal.eye === eye)));
  return { scenario: name, fired, silent: eyes.filter(eye => !fired.includes(eye)), finalState: events.at(-1)?.decision.state,
    timeline: events.map((event, i) => ({ request: i + 1, elapsedMs: event.observation.timestamp - events[0]!.observation.timestamp,
      gapMs: i ? event.observation.timestamp - events[i - 1]!.observation.timestamp : 0, route: event.observation.route, status: event.observation.status,
      signals: event.signals, eyeContributions: event.decision.calibration?.eyeTotals, energy: event.decision.energy, resonance: event.decision.resonance,
      confidence: event.decision.confidence, risk: event.decision.risk, state: event.decision.state, meaningfulEyes: event.decision.evidenceEyes,
      decay: event.decision.adjustments ?? [], reason: event.decision.reason,
      attentionGate: event.decision.risk < 6 ? 'Risk below 6' : event.decision.evidenceEyes.length < 2 ? 'Fewer than two meaningful Eyes' : 'Attention gate met; state inertia still applies',
      suspicionGate: event.decision.risk < 10 ? 'Risk below 10' : event.decision.confidence < .65 ? 'Confidence below .65' : event.decision.evidenceEyes.length < 2 ? 'Fewer than two meaningful Eyes' : 'Suspicion gate met; state inertia still applies' })) };
}
