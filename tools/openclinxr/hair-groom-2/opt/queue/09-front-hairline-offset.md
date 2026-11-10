# 09 groom parameter frontHairlineOffsetMm (CEO 10:15, 2026-11-10; from queue/08 CAUSE)

Status: step 1 done; offset 16 chosen (CEO 10:30); rebuild rule below committed before the render.

## Gap direction (measured fact)
Rendered front hair reaches 12-17 px further down the forehead than the v2 target (hairlineRow 253 vs 236; queue/07).
Front strand roots (groom-r9/s1) project to median row 250.5 in the driver frame (queue/08, camera validated IoU .994,
0.803 mm/px): the roots sit ~14.5 px (~11.6 mm) below the target hairline. The scalp tint follows the roots (edge 252.5).

## Constraints (CEO 10:15)
- Blueprint factory: the shift is a named groom parameter frontHairlineOffsetMm in groom.py, default 0 = today's groom
  byte-identical; Aisha's value is recorded in the groom config for this target. No hand-edited root masks, no one-off
  geometry.
- On the opt branch only; upstream of the P3 commit and the port branch, which land independently.

## Step 1 (CPU, before any rebuild)
Where groom.py defines the scalp root region (file:line, mask/region inputs, how roots are sampled), and for a front-edge
offset of 6, 9 and 12 mm: roots removed (count and % of total and of the front band), root density change in the remaining
front 20 mm, and the new front-most root row in the driver frame (queue/08 projection), median over cols 500-524.

## Rebuild rule
Fixed after step 1 and before the render (CEO bounds): full chain at the chosen offset (groom -> cards -> atlas ->
donor/sheen -> transplant -> tint), scored with objective v2 in all 4 views. PASS = front hairlineRow within 6 px of 236 AND
no other view worse than D_inc_v + delta_v (objective-v2 noise). ship_a4 --bars v2 reported as information. The material/tint
optimizer reruns on the new base only after this card passes.

## Step 1 result (probe09, CPU; raw .openclinxr/opt/hair-groom-2/probe09/result.json, untracked)
Root region: groom/groom.py build_scalp :225, table scalp.hairlineMmAboveHeadOriginByAzimuthDeg (:227), is_scalp_v (:231)
interpolates by azimuth (:235) and keeps a vertex with local z > h (:241); nodes 0 deg = 100 mm, 40 deg = 96 mm. Guides: 700 by
area-weighted dart throwing (sample_roots :338, Poisson radius 7.02 mm); 97,487 children by Interpolate, random, 1.6M/m2 (:855).
groom-r9/s1 recipe = groom/recipes/straight_centre_part_collarbone.json (key-sorted identical). The front edge is not a parameter
today; frontHairlineOffsetMm plugs in at :235 as a vertical add to h over az <= 40 deg, ramped to 0 at the 70 deg node.
Simulation on the existing roots (no regeneration): remove roots below the raised h.
| offset (vertical mm) | roots removed (% of 98,187) | % of queue/04 front band | front 20 mm density /cm2 | front-most root row med / p10 / p90 |
|---|---|---|---|---|
| 0 | 0 | 0 | 154.3 | 250.5 / 248.1 / 254.0 |
| 6 | 890 (0.91) | 30.3 | 158.5 | 247.6 / 246.2 / 248.5 |
| 9 | 1619 (1.65) | 55.9 | 157.2 | 244.0 / 241.4 / 244.8 |
| 12 | 2378 (2.42) | 77.1 | 153.8 | 240.0 / 236.6 / 240.6 |
| 16 | 3389 (3.45) | 98.1 | 155.4 | 235.2 / 232.9 / 235.9 |
~0.87 px per vertical mm. Children follow area, so density in the kept band stays 154-158 /cm2. The 11.6 mm in queue/08
was image-plane mm; on the sloped forehead the vertical offset needed is larger. Root row target ~234 (tint edge ~2 px below
roots): 16 mm gives 235.2, ~17 mm ~233.7, 14 mm 237.5.
Not tested: a real groom re-run (Interpolate seed and dart sequence move every root); overhang below roots; other views.

## Rebuild rule (CEO 10:30; committed before the render)
- Offset: frontHairlineOffsetMm = 16 (step 1 table supersedes the image-plane 6/9/12 set).
- Pre-check (CPU): Aisha's forehead height, brow ridge to front hairline, vertical mm on the runtime mesh, at offsets 0 and 16.
  Outside 45-80 mm at 16 -> stop and report (a hairline that matches the target by an implausible forehead is the wrong fix).
- Build: real groom re-run with the recipe's seed, then cards -> atlas -> donor/sheen -> transplant -> tint with the incumbent
  (g2) settings; every stage's output sha recorded.
- PASS: rendered front hairlineRow (score_trial v2, measure_band) within 6 px of 236 (230-242) AND every other view
  D_v <= D_inc_v + delta_v under v2 (3q <= 19.85, side <= 20.33, back <= 8.23; v2 incumbent + objective-v2 noise).
- FALLBACK (fixed now): front passes and another view fails -> rebuild once at 12 mm under the same rule; 12 also fails ->
  stop and report. Front fails at 16 -> stop and report.
- ship_a4 --bars v2 reported as information only.

## Pre-check result (probe09/forehead.json)
Midline profile on mpfb-ob-patient-aisha.glb in the groom head frame: nasion z 34, glabella z 54 (brow plateau z 54-64), hairline
z 100 (table; lowest midline scalp face 102.0) at offset 0 and 116 at 16. Forehead height 46 mm at 0, 62 mm at 16 (36 / 52 with
glabella at z 64). Inside 45-80 mm: rebuild proceeds. Midline vertices are 10-26 mm apart, so landmarks carry ~±5 mm.

## Rule amendment 1 (CEO 09:35; committed before any card 09 score; amends e08f11449)
Why: D_inc_v was scored on the old Aisha body (detail 1.0, 483821ad); fh16 embeds the current body (0.3, 75b9e5c7; 7fd92dd87,
fd32d6baa). Against D_inc_v the other-view clause would measure body change plus hairline change together.
- CARD 09 PASS = fh16 front hairlineRow in 230-242 (236 +- 6) AND every other view D_v(fh16) <= D_v(fh0) + delta_v
  (fh0 = proof-orig final, original groom, current body; delta_v objective-v2: 3q 1.217, side .521, back .644).
- CONTROL VALIDITY: fh0 front hairlineRow within 253 +- 2 (251-255), else the body change moved the hairline itself; card void,
  report.
- Information only (not the verdict): fh16 and fh0 against D_inc_v, and ship_a4 --bars v2. A4 still governs promotion.
- The 12 mm fallback triggers on the amended clause (front passes, another view fails vs fh0 + delta_v).

## Result at 16 mm (amendment 1): FAIL (CEO 09:53, verified from card09/render-fh0, render-fh16 score.json)
Control valid: fh0 front hairlineRow 253 (251-255). fh16 groom: 94,047 strands (fh0 98,187), strands.npz sha c42bf6e6.
| view | D_v fh0 | D_v fh16 | bar fh0 + delta_v | clause |
|---|---|---|---|---|
| front | 27.5907 | 25.9240 | row 233 in 230-242 | pass |
| three_quarter_left | 18.6336 | 20.9561 | 19.8509 | FAIL |
| side | 19.8049 | 18.1885 | 20.3260 | pass |
| back | 7.5830 | 8.8011 | 8.2274 | FAIL |
| sum D | 73.6121 | 73.8697 | | |
Front passes and two other views fail: fixed fallback applies, one rebuild at 12 mm under the same rule.

## Result at 12 mm (fallback, amendment 1): FAIL; card 09 stops (no third offset without a CEO decision)
groom-fh12: 95,101 strands, positionsSha cb4963b0, guides 700 (Poisson 6.91 mm). Chain stage shas in card09/chain12/stages.tsv;
probe GLB card09-fh12.glb sha 8f230b55. Run: card09/card09_run12.sh, log card09_run12.log.
| view | D_v fh0 | D_v fh16 | D_v fh12 | bar fh0 + delta_v | fh12 clause |
|---|---|---|---|---|---|
| front | 27.5907 | 25.9240 | 25.0719 | row 238 in 230-242 | pass |
| three_quarter_left | 18.6336 | 20.9561 | 21.0333 | 19.8509 | FAIL |
| side | 19.8049 | 18.1885 | 15.9211 | 20.3260 | pass |
| back | 7.5830 | 8.8011 | 7.5513 | 8.2274 | pass |
| sum D | 73.6121 | 73.8697 | 69.5776 | | |
Hard constraint: fh12 tris 63,192 > trisMax 63,024, feasible False (violation 0.267); fh0 63,024 and fh16 62,644 feasible.
ship_a4 --bars v2 (information): fh0 fails S3 S4; fh16 fails S1 S2 S3 S4; fh12 fails S1 S2 S3 S4 (S3 views 1).

## Breakdown (score.json views.<v>.terms wnorm, fh0 -> fh16 -> fh12)
- 3q: iou 7.04 -> 7.94 -> 7.60 (raw .648 -> .603 -> .620), peak .21 -> .94 -> 1.01, peakCeil 0 -> .21 -> .36, bandProfileL8
  2.33 -> 2.55 -> 2.71. Matte vs target: the lost hair sits in target hair rows 246-308, image cols 440-551 (left hair edge
  at row 300 moves from col 407 to 544 / 537; right edge fixed at 631); target rows 358-583 unchanged within 120 px. The iou
  loss is the raised front band seen from 3/4 (azimuth ramp 40-70 deg), where the 3q target keeps hair.
- back: fh16 peak .51 -> .97, sat .88 -> 1.25, peakCeil 0 -> .27; iou .801 -> .800. At fh12 back is 7.55 (peak .45, sat .98).
  The back regression at 16 mm is shading on an unchanged silhouette and does not repeat at 12 mm: groom reshuffle (every
  root moves), not the hairline band.
