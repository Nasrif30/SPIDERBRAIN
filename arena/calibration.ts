import type { ArenaMetrics } from './types.js';
const rate = (numerator: number, denominator: number) => denominator ? Math.round(numerator / denominator * 10000) / 10000 : null;
export function calibrationReport(results: readonly ArenaMetrics[]) {
  const sum = (key: 'TP' | 'TN' | 'FP' | 'FN') => results.reduce((n, row) => n + row[key], 0);
  const TP = sum('TP'), TN = sum('TN'), FP = sum('FP'), FN = sum('FN');
  const metrics = { traces: results.length, TP, TN, FP, FN, precision: rate(TP, TP + FP), recall: rate(TP, TP + FN), specificity:rate(TN,TN+FP), falsePositiveRate: rate(FP, FP + TN) };
  const falsePositiveSignals = [...new Set(results.filter((row) => row.FP).flatMap((row) => row.signals.filter((signal) => signal.atDetection > 0).map((signal) => signal.signal)))];
  const allSignals = [...new Set(results.flatMap((row) => row.signals.map((signal) => signal.signal)))].sort();
  const signalInspection = allSignals.map((name) => {
    const present = results.filter((row) => row.signals.some((signal) => signal.signal === name));
    return { signal: name, eye: present[0]!.signals.find((signal) => signal.signal === name)!.eye,
      ordinaryTraces: present.filter((row) => row.expected === 'ordinary').length,
      probingTraces: present.filter((row) => row.expected === 'probing').length,
      atTrueDetection: present.filter((row) => row.TP && row.signals.some((signal) => signal.signal === name && signal.atDetection > 0)).length,
      atFalsePositive: present.filter((row) => row.FP && row.signals.some((signal) => signal.signal === name && signal.atDetection > 0)).length,
      maximumContribution: Math.max(...present.flatMap((row) => row.signals.filter((signal) => signal.signal === name).map((signal) => signal.maximumContribution))) };
  });
  const confidenceBins = Array.from({ length: 5 }, (_, i) => {
    const subset = results.filter((row) => row.maximumConfidence >= i / 5 && (i === 4 || row.maximumConfidence < (i + 1) / 5));
    return { lower: i / 5, upper: (i + 1) / 5, traces: subset.length, probingFraction: rate(subset.filter((row) => row.expected === 'probing').length, subset.length) };
  });
  const misses = results.filter((row) => row.FN).map((row) => ({ scenario: row.scenario, risk: row.maximumRisk, confidence: row.maximumConfidence, energy: row.maximumEnergy,
    eyes: [...new Set(row.signals.filter((signal) => signal.eye !== 'physics').map((signal) => signal.eye))] }));
  const peakEyeContributions: Record<string, number> = {};
  // Each row's signal maxima need not occur simultaneously: inspect the actual aggregate cap in tests, not a sum of maxima.
  for (const row of results) for (const signal of row.signals) if (signal.eye !== 'physics') peakEyeContributions[signal.eye] = Math.max(peakEyeContributions[signal.eye] ?? 0, signal.maximumContribution);
  const observations = [
    FP ? 'False-positive co-occurring signals: ' + falsePositiveSignals.join(', ') + '. Correlation is not causal attribution.' : 'No false-positive signals in these scripts; real-world false-positive rates remain unknown.',
    'Every Eye remains capped at 5 total evidence per decision; Honey alone stays below high-confidence attention.',
    'Eye strength inspection: Route-only and Honey-only misses show limited independent evidence, rather than a reason to remove confidence safeguards. No Eye is established as overpowered by this small dataset; Velocity also occurs in ordinary fast browsing, so its independent cap remains necessary.',
    'Signals with no contribution at true detection: ' + (signalInspection.filter((signal) => !signal.atTrueDetection).map((signal) => signal.signal).join(', ') || 'none observed') + '. This is not an ablation study.',
    'Misses: ' + (misses.map((miss) => miss.scenario + ' (' + miss.eyes.join('/') + ')').join(', ') || 'none') + '. Sparse or single-Eye evidence remains a known detection limit.',
    'Raw attention-threshold crossings: ' + results.reduce((n, row) => n + row.thresholdCrossings, 0) + '; state reversals within 15 seconds: ' + results.reduce((n, row) => n + row.rapidStateReversals, 0) + '.',
    'Confidence-bin probing fractions use maximum session confidence and scripted labels; they are not calibrated attack probabilities.',
    'State thresholds and per-Eye caps are unchanged. Meaningful diversity uses aggregate per-Eye evidence; bounded temporal context retains repeated cross-category failed traversal. More independent deployment observations are needed before tuning.',
  ];
  const markdown = '# Calibration inspection\n\nEngineering benchmark, not scientific proof of real-world detection accuracy.\n\n' +
    `Traces ${metrics.traces}; TP ${TP}; TN ${TN}; FP ${FP}; FN ${FN}. Precision ${metrics.precision}; recall ${metrics.recall}; false-positive rate ${metrics.falsePositiveRate}.\n\n` +
    observations.map((line) => '- ' + line).join('\n') + '\n\n| Signal | Ordinary traces | Probing traces | At TP | At FP | Peak individual contribution |\n| --- | ---: | ---: | ---: | ---: | ---: |\n' +
    signalInspection.map((row) => `| ${row.signal} | ${row.ordinaryTraces} | ${row.probingTraces} | ${row.atTrueDetection} | ${row.atFalsePositive} | ${row.maximumContribution} |`).join('\n') + '\n';
  const partitions=['calibration','holdout'].map(partition=>{const rows=results.filter(row=>(row.partition??'calibration')===partition),sum=(key:'TP'|'TN'|'FP'|'FN')=>rows.reduce((n,row)=>n+row[key],0);return{partition,traces:rows.length,TP:sum('TP'),TN:sum('TN'),FP:sum('FP'),FN:sum('FN')};});
  return { kind: 'deterministic engineering calibration inspection', metrics,partitions, falsePositiveSignals, signalInspection, confidenceBins, misses, peakEyeContributions, observations, markdown };
}
