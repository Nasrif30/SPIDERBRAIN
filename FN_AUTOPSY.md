# False-negative analysis

All four misses in the earlier canary evaluation were captured before model changes. Each generated timeline in `fn-autopsy-results.json` includes sanitized route movement, fired/silent Eyes, emitted intensity/confidence/decay, carried Eye totals, energy, resonance, risk, state and the exact attention/suspicion gates. Negative decay adjustments are already applied, never subtracted again.

## low-and-slow-1

Thirty-second gaps removed local context. Route evidence decayed at 0.035/sec; Error, Velocity and short-window Movement stayed silent. Risk peaked at 0.8, below 6, with only one Eye. Medium context now recognizes repeated failed navigation across two sensitive categories; meaningful Route + Movement evidence reaches ALERT at request 19.

Before: CALM; fired route; silent velocity, error, authentication, movement, honey. Final energy 0.43, resonance 0, confidence 1%, risk 0.28. After: ALERT; fired route, movement.

## route-shuffling-2

Successful public requests diluted the recent failure fraction, so Error and short-window Movement stayed silent. Route evidence alone was capped at 5; energy and resonance could not supply another Eye. Medium context now recognizes repeated cross-category failures despite intervening successful navigation; ALERT at request 58. The trace ends before three further qualifying observations could promote it to SUSPICIOUS.

Before: CURIOUS; fired route; silent velocity, error, authentication, movement, honey. Final energy 30, resonance 2, confidence 36%, risk 6.4. After: ALERT; fired route, movement.

## low-and-slow-2

Forty-five-second gaps expired the short context and decayed Route evidence between requests. Risk peaked at 0.7 with one Eye. Anchored medium context and the bounded long counter now preserve the correlated pattern; ALERT at request 25. This is attention, not SUSPICIOUS classification or blocking.

Before: CALM; fired route; silent velocity, error, authentication, movement, honey. Final energy 0.26, resonance 0, confidence 1%, risk 0.15. After: ALERT; fired route, movement.

## honey-file-read-1

Eight successful synthetic reads six seconds apart fire Honey only. Honey is capped at 5; maximum risk 5.44 is below 6, confidence 0.36, and one Eye fails the diversity gate. Route/Error correctly stay silent on successful responses; the temporal failure model adds no fabricated corroboration. Remains CURIOUS and an explicitly retained benchmark miss.

Before: CURIOUS; fired honey; silent velocity, route, error, authentication, movement. Final energy 17.13, resonance 0, confidence 36%, risk 5.44. After: CURIOUS; fired honey.

The state thresholds and three-observation promotion rule did not change. Meaningful independent evidence is now measured from each capped Eye total (default minimum 0.8). Category memory supports observed unsuccessful traversal; it does not infer attacker identity. The additional six Arena misses remain in CALIBRATION.md.
