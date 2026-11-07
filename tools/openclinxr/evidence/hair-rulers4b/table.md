# Hair rulers v4b — extended table (R1/R4/R5 + R2/R6/R3, FIX A/B)

Subjects: target = reference (target-vs-itself where defined); current = hem2 `scores/c_curve`; previous = hem1 `scores/c_best8`.
Registration: default skull (scorer orientation; front +10 mm offset, scale 0.9545); v4a-frozen rows keep raw (front 1.0021). Skull reproduces all three score.json orientation transforms within 1e-6 (probes A-skull-*); profile/back are mode-invariant (probe A-profile-mode-invariant). Local mm: 0.4599 mm/px.

Thresholds derive from the TARGET value plus probe noise only (R1 IoU >=0.95; R1/R5/R6 distances <=10/10/5 px; R3 |p50|<=3 px = 3x the +-1 px plant resolution with absP95<=10 px tail guard as in R1; R2 midline <=5 mm = 10x the 0.5 mm plant resolution, an order of magnitude below the diagnosed 21-26 mm defect), never fitted to either groom. R4/R3-3q are ADVISORY (no target beauty / no 3q target); R3 temple zones are UNOBSERVED (curtain reaches the brow in the target too), never zero error and non-blocking.

| row | ruler | view | metric | reg | target | current | previous | class | threshold | current |
|---|---|---|---|---|---|---|---|---|---|---|
| r1.front.above.iou | R1 | front | chin IoU | raw(frozen) | 1.0 | 0.5942 | 0.5941 | HARD_GATE | >=0.95 | FAIL |
| r1.front.below.iou | R1 | front | chin IoU | raw(frozen) | 1.0 | 0.7214 | 0.7323 | HARD_GATE | >=0.95 | FAIL |
| r1.front.above.absP95 | R1 | front | above contour absP95 | raw(frozen) | 0.0 px / 0.0 mm | 34.83 px / 16.014 mm | 34.83 px / 16.014 mm | HARD_GATE | <=10 px | FAIL |
| r1.front.below.absP95 | R1 | front | below contour absP95 | raw(frozen) | 0.0 px / 0.0 mm | 19.77 px / 9.091 mm | 20.32 px / 9.344 mm | HARD_GATE | <=10 px | FAIL |
| r1.profile_90.above.iou | R1 | profile | chin IoU | raw(frozen) | 1.0 | 0.8167 | 0.8166 | HARD_GATE | >=0.95 | FAIL |
| r1.profile_90.below.iou | R1 | profile | chin IoU | raw(frozen) | 1.0 | 0.5028 | 0.5061 | HARD_GATE | >=0.95 | FAIL |
| r1.profile_90.above.absP95 | R1 | profile | above contour absP95 | raw(frozen) | 0.0 px / 0.0 mm | 115.88 px / 53.282 mm | 115.89 px / 53.286 mm | HARD_GATE | <=10 px | FAIL |
| r1.profile_90.below.absP95 | R1 | profile | below contour absP95 | raw(frozen) | 0.0 px / 0.0 mm | 100.82 px / 46.356 mm | 95.54 px / 43.927 mm | HARD_GATE | <=10 px | FAIL |
| r1.back.above.iou | R1 | back | chin-equiv IoU | raw(frozen) | 1.0 | 0.7503 | 0.7503 | HARD_GATE | >=0.95 | FAIL |
| r1.back.below.iou | R1 | back | chin-equiv IoU | raw(frozen) | 1.0 | 0.877 | 0.7834 | HARD_GATE | >=0.95 | FAIL |
| r1.back.above.absP95 | R1 | back | above contour absP95 | raw(frozen) | 0.0 px / 0.0 mm | 128.08 px / 58.89 mm | 128.08 px / 58.89 mm | HARD_GATE | <=10 px | FAIL |
| r1.back.below.absP95 | R1 | back | below contour absP95 | raw(frozen) | 0.0 px / 0.0 mm | 44.0 px / 20.231 mm | 42.0 px / 19.311 mm | HARD_GATE | <=10 px | FAIL |
| r1.front.above.iou.skull | R1 | front | chin IoU | skull | 1.0 | 0.7194 | 0.7193 | HARD_GATE | >=0.95 | FAIL |
| r1.front.below.iou.skull | R1 | front | chin IoU | skull | 1.0 | 0.6683 | 0.6775 | HARD_GATE | >=0.95 | FAIL |
| r1.front.above.absP95.skull | R1 | front | above contour absP95 | skull | 0.0 px / 0.0 mm | 29.07 px / 13.365 mm | 29.07 px / 13.365 mm | HARD_GATE | <=10 px | FAIL |
| r1.front.below.absP95.skull | R1 | front | below contour absP95 | skull | 0.0 px / 0.0 mm | 21.62 px / 9.939 mm | 22.0 px / 10.115 mm | HARD_GATE | <=10 px | FAIL |
| r1.profile_90.above.iou.skull | R1 | profile | chin IoU | skull | 1.0 | 0.8167 | 0.8166 | HARD_GATE | >=0.95 | FAIL |
| r1.profile_90.below.iou.skull | R1 | profile | chin IoU | skull | 1.0 | 0.5028 | 0.5061 | HARD_GATE | >=0.95 | FAIL |
| r1.profile_90.above.absP95.skull | R1 | profile | above contour absP95 | skull | 0.0 px / 0.0 mm | 115.88 px / 53.282 mm | 115.89 px / 53.286 mm | HARD_GATE | <=10 px | FAIL |
| r1.profile_90.below.absP95.skull | R1 | profile | below contour absP95 | skull | 0.0 px / 0.0 mm | 100.82 px / 46.356 mm | 95.54 px / 43.927 mm | HARD_GATE | <=10 px | FAIL |
| r1.back.above.iou.skull | R1 | back | chin-equiv IoU | skull | 1.0 | 0.7503 | 0.7503 | HARD_GATE | >=0.95 | FAIL |
| r1.back.below.iou.skull | R1 | back | chin-equiv IoU | skull | 1.0 | 0.877 | 0.7834 | HARD_GATE | >=0.95 | FAIL |
| r1.back.above.absP95.skull | R1 | back | above contour absP95 | skull | 0.0 px / 0.0 mm | 128.08 px / 58.89 mm | 128.08 px / 58.89 mm | HARD_GATE | <=10 px | FAIL |
| r1.back.below.absP95.skull | R1 | back | below contour absP95 | skull | 0.0 px / 0.0 mm | 44.0 px / 20.231 mm | 42.0 px / 19.311 mm | HARD_GATE | <=10 px | FAIL |
| r5.front.yBottomMAEpx.raw | R5 | front | yBottom MAE | raw(frozen) | 0.0 px / 0.0 mm | 46.6 px / 21.43 mm | 46.01 px / 21.15 mm | HARD_GATE | <=10 px | FAIL |
| r5.front.widthMAEpx.raw | R5 | front | width MAE | raw(frozen) | 0.0 px / 0.0 mm | 12.35 px / 5.68 mm | 12.09 px / 5.56 mm | HARD_GATE | <=10 px | FAIL |
| r5.front.yBottomMAEpx.skull | R5 | front | yBottom MAE | skull | 0.0 px / 0.0 mm | 34.02 px / 15.64 mm | 33.66 px / 15.48 mm | HARD_GATE | <=10 px | FAIL |
| r5.front.widthMAEpx.skull | R5 | front | width MAE | skull | 0.0 px / 0.0 mm | 17.31 px / 7.96 mm | 17.09 px / 7.86 mm | HARD_GATE | <=10 px | FAIL |
| r5.profile_90.yBottomMAEpx.raw | R5 | profile | yBottom MAE | raw(frozen) | 0.0 px / 0.0 mm | 32.9 px / 15.13 mm | 31.49 px / 14.48 mm | HARD_GATE | <=10 px | FAIL |
| r5.profile_90.widthMAEpx.raw | R5 | profile | width MAE | raw(frozen) | 0.0 px / 0.0 mm | 38.48 px / 17.69 mm | 37.67 px / 17.32 mm | HARD_GATE | <=10 px | FAIL |
| r5.profile_90.yBottomMAEpx.skull | R5 | profile | yBottom MAE | skull | 0.0 px / 0.0 mm | 32.9 px / 15.13 mm | 31.49 px / 14.48 mm | HARD_GATE | <=10 px | FAIL |
| r5.profile_90.widthMAEpx.skull | R5 | profile | width MAE | skull | 0.0 px / 0.0 mm | 38.48 px / 17.69 mm | 37.67 px / 17.32 mm | HARD_GATE | <=10 px | FAIL |
| r5.back.yBottomMAEpx.raw | R5 | back | yBottom MAE | raw(frozen) | 0.0 px / 0.0 mm | 4.7 px / 2.16 mm | 21.58 px / 9.92 mm | HARD_GATE | <=10 px | PASS |
| r5.back.widthMAEpx.raw | R5 | back | width MAE | raw(frozen) | 0.0 px / 0.0 mm | 42.48 px / 19.53 mm | 61.86 px / 28.44 mm | HARD_GATE | <=10 px | FAIL |
| r5.back.yBottomMAEpx.skull | R5 | back | yBottom MAE | skull | 0.0 px / 0.0 mm | 4.7 px / 2.16 mm | 21.58 px / 9.92 mm | HARD_GATE | <=10 px | PASS |
| r5.back.widthMAEpx.skull | R5 | back | width MAE | skull | 0.0 px / 0.0 mm | 42.48 px / 19.53 mm | 61.86 px / 28.44 mm | HARD_GATE | <=10 px | FAIL |
| r4.profile.coverage.30-128-230 | R4 | profile | pinna coverage @30/128/230 | n/a | 0.2114 | 1.0/1.0/0.9516 | 1.0/1.0/0.951 | ADVISORY | report-only | -- |
| r4.profile.skinVisible | R4 | profile | skin-visible frac in hair (skin [255.0, 193.0, 152.0]; hair [34.0, 31.0, 29.0]) | n/a | n/a (no target beauty) | 0.0 | 0.0 | ADVISORY | report-only | -- |
| r4.3q.coverage | R4 | three_quarter | pinna coverage, ours only | n/a | n/a, no registered target | 0.4927 | 0.4927 | ADVISORY | report-only | -- |
| r2.midline.p50 | R2 | midline | boundary-to-root p50 (cap-v7 + lineage strands) | n/a | N/A (geometry) | 0.2 mm (gap -0.5 mm) | 0.2 mm (gap -0.5 mm) | HARD_GATE | <=5.0 mm | PASS |
| r2.temple_L.p50 | R2 | temple_L | boundary-to-root p50 (cap-v7 + lineage strands) | n/a | N/A (geometry) | 0.32 mm (gap 0.9 mm) | 0.32 mm (gap 0.9 mm) | HARD_GATE | <=10.0 mm | PASS |
| r2.temple_R.p50 | R2 | temple_R | boundary-to-root p50 (cap-v7 + lineage strands) | n/a | N/A (geometry) | 0.2 mm (gap -0.2 mm) | 0.2 mm (gap -0.2 mm) | HARD_GATE | <=10.0 mm | PASS |
| r2.parity.firstRoot | R2 | midline | parity midline firstRootYmm (cap-v8+spread) | n/a | crown4 -121.9 mm | -121.9 mm | same inputs (shared) | HARD_GATE | +-1 mm | PASS |
| r6.shoulderPlane.gap | R6 | profile | posterior gap @ shoulder-plane row (row 671, common) | skull | 151 px / 69.43 mm (ref) | 276 px / 126.9 mm | 246 px / 113.11 mm | HARD_GATE | |ours-tgt|<=5 px | FAIL |
| r6.ownHem.gap | R6 | profile | posterior gap @ own-hem row (tgt row 870 / cur row 832 / prev row 823) | skull | -10 px / -4.6 mm (ref) | 10 px / 4.6 mm | 19 px / 8.74 mm | HARD_GATE | |ours-tgt|<=5 px | FAIL |
| r3.front.midline.p50 | R3 | front | signed hairline p50 midline (n=101) | skull | 0.0 px (ref) | 11.0 px | 11.0 px | HARD_GATE | |p50|<=3 px and absP95<=10 px | FAIL |
| r3.front.brow_L.p50 | R3 | front | signed hairline p50 brow_L (n=52) | skull | 0.0 px (ref) | -9.0 px | -9.0 px | HARD_GATE | |p50|<=3 px and absP95<=10 px | FAIL |
| r3.front.brow_R.p50 | R3 | front | signed hairline p50 brow_R (n=51) | skull | 0.0 px (ref) | -1.0 px | -1.0 px | HARD_GATE | |p50|<=3 px and absP95<=10 px | FAIL |
| r3.front.temple_L.p50 | R3 | front | signed hairline p50 temple_L (n=0) | skull | 0.0 px (ref) | UNOBSERVED | UNOBSERVED | HARD_GATE | |p50|<=3 px and absP95<=10 px | UNOBSERVED |
| r3.front.temple_R.p50 | R3 | front | signed hairline p50 temple_R (n=0) | skull | 0.0 px (ref) | UNOBSERVED | UNOBSERVED | HARD_GATE | |p50|<=3 px and absP95<=10 px | UNOBSERVED |
| r3.3q.observed | R3 | three_quarter | hairline observed fraction, ours only | n/a | n/a (no 3q target) | 173/400 (p50 row 209.0) | 173/400 | ADVISORY | report-only | -- |

Registration delta (current, skull - raw): front IoU/scales move with the 22.83 px crown shift; profile/back deltas are exactly 0 (shared triple). Full per-row deltas: RESULT.txt + table.json `registrationDelta`.
