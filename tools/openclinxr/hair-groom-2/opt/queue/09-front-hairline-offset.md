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
