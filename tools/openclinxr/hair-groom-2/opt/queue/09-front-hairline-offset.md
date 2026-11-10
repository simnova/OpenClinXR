# 09 groom parameter frontHairlineOffsetMm (CEO 10:15, 2026-11-10; from queue/08 CAUSE)

Status: step 1 (CPU) running; rebuild rule to be written after step 1, before any render.

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
