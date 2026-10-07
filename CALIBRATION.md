# Calibration inspection

Engineering benchmark, not scientific proof of real-world detection accuracy.

Traces 80; TP 37; TN 37; FP 0; FN 6. Precision 1; recall 0.8605; false-positive rate 0.

- No false-positive signals in these scripts; real-world false-positive rates remain unknown.
- Every Eye remains capped at 5 total evidence per decision; Honey alone stays below high-confidence attention.
- Eye strength inspection: Route-only and Honey-only misses show limited independent evidence, rather than a reason to remove confidence safeguards. No Eye is established as overpowered by this small dataset; Velocity also occurs in ordinary fast browsing, so its independent cap remains necessary.
- Signals with no contribution at true detection: sustained velocity. This is not an ablation study.
- Misses: honey-file-read-1 (honey), v3-long-pauses-1 (route/movement), v3-distributed-cohorts-1 (route/error), v3-long-pauses-2 (route/movement), v3-distributed-cohorts-2 (route), v3-auth-probing-2 (authentication). Sparse or single-Eye evidence remains a known detection limit.
- Raw attention-threshold crossings: 60; state reversals within 15 seconds: 0.
- Confidence-bin probing fractions use maximum session confidence and scripted labels; they are not calibrated attack probabilities.
- State thresholds and per-Eye caps are unchanged. Meaningful diversity uses aggregate per-Eye evidence; bounded temporal context retains repeated cross-category failed traversal. More independent deployment observations are needed before tuning.

| Signal | Ordinary traces | Probing traces | At TP | At FP | Peak individual contribution |
| --- | ---: | ---: | ---: | ---: | ---: |
| AUTH_RESONANCE | 0 | 4 | 3 | 0 | 3.42 |
| HONEY_FILE_TOUCH | 0 | 6 | 5 | 0 | 4.41 |
| HONEY_REPEAT_INTEREST | 0 | 7 | 6 | 0 | 2.59 |
| HONEY_ROUTE_TOUCH | 1 | 5 | 5 | 0 | 3.42 |
| HONEY_TOKEN_REFERENCE | 0 | 2 | 2 | 0 | 1.35 |
| anonymous identity switching | 0 | 4 | 3 | 0 | 2.5 |
| behavioral energy | 0 | 40 | 37 | 0 | 4.2 |
| local diffusion | 12 | 37 | 30 | 0 | 0.8 |
| navigation entropy | 0 | 24 | 22 | 0 | 0.66 |
| rapid route changes | 0 | 7 | 7 | 0 | 2.93 |
| repeated access errors | 0 | 18 | 17 | 0 | 5 |
| repeated resonance | 0 | 41 | 37 | 0 | 3.99 |
| repeated sensitive revisits | 0 | 15 | 5 | 0 | 2.5 |
| route enumeration | 0 | 23 | 22 | 0 | 3.3 |
| sensitive route probing | 0 | 38 | 34 | 0 | 5 |
| sensitive-route concentration | 0 | 19 | 18 | 0 | 5 |
| structured temporal traversal | 0 | 22 | 16 | 0 | 5 |
| sustained velocity | 8 | 1 | 0 | 0 | 5 |
| unusual navigation direction | 0 | 20 | 18 | 0 | 2.59 |
| velocity impulse | 12 | 6 | 6 | 0 | 5 |
