# Round 2, comprehension (Goldfish), raw findings, unresolved

Paraphrase failed for: Appearance metrics (crown rows/columns and target mask undefined); P2 Step 0 falsifier

- R2U1 Major [G1] G1 says "gated metrics below" but the metrics section has no thresholds; P2 gate covers 3 views, G1 judgement 4. Fix: thresholds in G1 or "G1 = P2 gate".
- R2U2 Major [Metrics] crown rows/columns not given as pixel boxes; smoothing kernel unstated (rubric D5 uses crown box rows 130-200 cols 480-545). Fix: box per view and kernel.
- R2U3 Major [Metrics] mask from "hair alpha / hair-only render" does not exist for the target photo. Fix: state target mask source.
- R2U4 Major [P3 vs G4] P3 allows tris +10% (~69.3k), G4 caps 63,024; "What worked" says 62,996. Fix: one cap, say which phase may exceed it.
- R2U5 Major [P1 gate a] atlas texels or runtime render? "ambient-only light" undefined. Fix: name surface and light.
- R2U6 Major [P1 gate b] "not worse than BEST3 by .02 L" has no direction. Fix: abs(x - target) <= abs(BEST3 - target) + .02.
- R2U7 Major [P2 step 0] falsifier has no pass/fail or hypothesis. Fix: "if X then skip/redirect P2".
- R2U8 Major [P1 step 0] only the Diffuse-empty branch is specified. Fix: else branch.
- R2U9 Major [P2 files] createSkinShadeGLTFLoader is wired in xr-asset-loading generated-loaders (dist/generated-loaders.js:10,56), surface-meter.test.ts:372, consumes.json:196; none in the file table. Fix: add registration site and public-surface admission.
- R2U10 Nit [P2 gate] "BEST3 + streak map" redundant (BEST3 includes it). Fix: "beats BEST3".
- R2U11 Nit [P2 data map] ID value range unstated. Fix: uniform [0,1], std .289.
- R2U12 Nit [G2] 1.25 ceiling attributed to brief, brief line 13 gives only 0.8 floor and +2 pp. Fix: mark new.
- R2U13 Nit [Header] cites round{1,2,3}.md; only round1 exists.
- R2U14 Nit [Overview] "76 lane commits": grep count gives 73. Fix: give the command.
- R2U15 Nit [Glossary] HUANG, A3, censored card round, B5.side, D5, CUJ3, albedo scale K, _scDD undefined.
- R2U16 Nit [IDs] E1 collides with rubric E1; Q1 with guardrail Q1; P1/P2 with commit names. Fix: prefix escalation IDs.
- R2U17 Nit [Problem vs Metrics] Problem numbers are v3 mask; new eroded per-render mask may not reproduce them. Fix: re-measure baselines.
- R2U18 Nit [Metrics] hue/sat and FWHM never gated. Fix: gate or mark report-only.
- R2U19 Nit [Problem 2] ratios are hair median L at spec 0, not "light received". Fix: say so.
