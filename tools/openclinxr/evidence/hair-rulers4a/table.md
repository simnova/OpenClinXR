# Hair rulers v4a — frozen structural table (R1 / R4 / R5)

Subjects: target = target-masks-vs-themselves (REFERENCE, not a probe);
current = hem2 `scores/c_curve`; previous = hem1 `scores/c_best8`.
Registration: `register_view` imported from hair-judge `hair_judge.py` (no bpy)
with RAW triples (front 103/583/512, profile 131/561/209, back 155/651/512;
targets 127/608/513, 125/577/344, 130/646/513). Stored-transform agreement vs
hem2 `shape_base.json` within rounding (see probes `agree-*`: 32/32 pass).
Local mm: 0.4599 mm/px from skull H 210.659 mm over target-frame skull-front
H (481 px raw minus 10 mm hair-over-skull offset).

Thresholds are derived from the TARGET value plus probe noise only:
IoU >= 0.95 (target 1.0, minus 0.05 resample margin); distances/hem <= 10 px
(4.6 mm, 2x the smallest planted shift the rulers resolve exactly, 5 px).
They were not tuned to pass or fail either groom.

| row | ruler | view | metric | target | current | previous | class | threshold | current |
|---|---|---|---|---|---|---|---|---|---|
| r1.front.above.iou | R1 | front | above-chin IoU | 1.0 | 0.5942 | 0.5941 | HARD_GATE | >=0.95 | FAIL |
| r1.front.below.iou | R1 | front | below-chin IoU | 1.0 | 0.7214 | 0.7323 | HARD_GATE | >=0.95 | FAIL |
| r1.profile_90.above.iou | R1 | profile | above-chin IoU | 1.0 | 0.8167 | 0.8166 | HARD_GATE | >=0.95 | FAIL |
| r1.profile_90.below.iou | R1 | profile | below-chin IoU | 1.0 | 0.5028 | 0.5061 | HARD_GATE | >=0.95 | FAIL |
| r1.back.above.iou | R1 | back | above-chin-equiv IoU | 1.0 | 0.7503 | 0.7503 | HARD_GATE | >=0.95 | FAIL |
| r1.back.below.iou | R1 | back | below-chin-equiv IoU | 1.0 | 0.877 | 0.7834 | HARD_GATE | >=0.95 | FAIL |
| r1.front.above.absP95 | R1 | front | above contour absP95 | 0.0 px / 0.0 mm | 34.83 px / 16.0 mm | 34.83 px / 16.0 mm | HARD_GATE | <=10 px | FAIL |
| r1.front.below.absP95 | R1 | front | below contour absP95 | 0.0 px / 0.0 mm | 19.77 px / 9.1 mm | 20.32 px / 9.3 mm | HARD_GATE | <=10 px | FAIL |
| r1.profile_90.above.absP95 | R1 | profile | above contour absP95 | 0.0 px / 0.0 mm | 115.88 px / 53.3 mm | 115.89 px / 53.3 mm | HARD_GATE | <=10 px | FAIL |
| r1.profile_90.below.absP95 | R1 | profile | below contour absP95 | 0.0 px / 0.0 mm | 100.82 px / 46.4 mm | 95.54 px / 43.9 mm | HARD_GATE | <=10 px | FAIL |
| r1.back.above.absP95 | R1 | back | above contour absP95 | 0.0 px / 0.0 mm | 128.08 px / 58.9 mm | 128.08 px / 58.9 mm | HARD_GATE | <=10 px | FAIL |
| r1.back.below.absP95 | R1 | back | below contour absP95 | 0.0 px / 0.0 mm | 44.0 px / 20.2 mm | 42.0 px / 19.3 mm | HARD_GATE | <=10 px | FAIL |
| r4.profile.coverage | R4 | profile | pinna coverage | 0.2114 (self-region) | 1.0 (tgtReg 1.0) | 1.0 (tgtReg 1.0) | ADVISORY | \|ours-tgtReg\|<=0.15 | match |
| r4.3q.coverage | R4 | three_quarter | pinna coverage, ours only | n/a, no registered target | 0.4927 | 0.4927 | ADVISORY | report-only | -- |
| r5.front.yBottom | R5 | front | yBottom MAE | 0.0 px / 0.0 mm | 46.6 px / 21.4 mm | 46.01 px / 21.2 mm | HARD_GATE | <=10 px | FAIL |
| r5.profile_90.yBottom | R5 | profile | yBottom MAE | 0.0 px / 0.0 mm | 32.9 px / 15.1 mm | 31.49 px / 14.5 mm | HARD_GATE | <=10 px | FAIL |
| r5.back.yBottom | R5 | back | yBottom MAE | 0.0 px / 0.0 mm | 4.7 px / 2.2 mm | 21.58 px / 9.9 mm | HARD_GATE | <=10 px | PASS |
| r5.front.width | R5 | front | width MAE | 0.0 px / 0.0 mm | 12.35 px / 5.7 mm | 12.09 px / 5.6 mm | HARD_GATE | <=10 px | FAIL |
| r5.profile_90.width | R5 | profile | width MAE | 0.0 px / 0.0 mm | 38.48 px / 17.7 mm | 37.67 px / 17.3 mm | HARD_GATE | <=10 px | FAIL |
| r5.back.width | R5 | back | width MAE | 0.0 px / 0.0 mm | 42.48 px / 19.5 mm | 61.86 px / 28.4 mm | HARD_GATE | <=10 px | FAIL |

Notes.
- R4 profile semantics: the target value is read over each subject's own
  registered region. Current covers its pinna region 1.0 and the target mask
  covers current's registered region 1.0 (match, no defect signal); the 0.2114
  is the target sampled at the identity-mapped region (reference only, different
  region, not comparable). No current-vs-target separation exists, so R4 stays
  ADVISORY; the ruler is frozen for the rebuilt groom. R4 three_quarter has no
  registered target: ours-only, identical for both grooms (shared head/cap).
- R5 back separates the grooms (current 4.7 px vs previous 21.58 px yBottom):
  hem2 improved the back hem; front/profile hems did not move.
- R1 shows what whole-mask IoU hid: profile below-chin IoU 0.50 and contour
  tails to 128 px on a groom whose whole-mask IoU reads 0.73/0.75/0.79.
- Machine-readable: `table.json`. Per-subject numbers: `subject-*.json`.
