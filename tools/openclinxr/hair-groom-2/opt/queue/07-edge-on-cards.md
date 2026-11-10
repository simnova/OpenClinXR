# 07 edge-on front cards at the hairline (CEO 09:45, 2026-11-10)

Status: run 2026-11-10, verdict NOT THE CAUSE (front ratio 1.33 vs bars .5 and .82). Rule committed before the probe (4a9d61837).
Ruled out for the front hairlineRow gap (253 vs target 236, driver frame, objective v2): card root position (queue/04),
edge fade (queue/00), scalp tint (queue/00 pre-fade build has none and reads 255), texture alpha (queue/06). Strands read
142 vs target 140 in the P3 frame, cards 173, with card roots within 2 mm of strand roots.

## Hypothesis
Front-band roots rise up and back over the scalp; a card whose width vector W lies near the front view direction projects
to a few px in the front view, while strand cylinders show their width from every side.

## Probe (CPU, numpy, no render)
Inputs (read-only): EV/r10/tw35ta15sm2/cards.npz, card-members.npz, EV/groom-r9/s1/strands.npz; front band and frame from
probe04 (head-local mm, -y front, +z up; front view direction = +y, image plane = x-z, to be verified against the GLB /
render frame and stated). Random control: 32 non-front cards, seed 0 (same draw as probe05).
Per card, at stations within 0-10 mm and 10-20 mm of station 0 (arc length along the card centreline):
- pw = card width projected on the front image plane = |W_xz| x card width (mm)
- ms = member spread projected on the image plane: p95 - p5 of member positions at the same arc length, measured
  across the card's projected centreline direction (mm)
- ratio = pw / ms (median over the stations in the band); angle = angle between the card normal and the front view direction (deg)
- flag: card is among the 12 front cards that never reach 50 % coverage at alpha >= .85 (probe05 result.json per_front)
Aggregation: per-card median over stations, then median / p90 over the card set.

## Rule (fixed before the probe; CEO 09:45)
- CAUSE: front-band median ratio over 0-10 mm <= .5 AND <= half the random-control median ratio over 0-10 mm.
- NOT THE CAUSE: otherwise. If the control median is also <= .5, edge-on is general to all cards and does not explain a
  front-only gap: recorded as NOT THE CAUSE for the front gap.
- IF CAUSE: next card = render probe on the incumbent rotating front-band W toward the front view at the roots, rule fixed
  before the render, scored with v2 in all 4 views.
- IF NOT: report shading as the next suspect with a probe shape.
- Counterweight: ms can be small where members are tightly bundled, which inflates the ratio. The absolute pw (mm) is
  reported beside the ratio, and a front median pw below the control's is recorded even when the ratio rule fails.

## Result (probe07, CPU; raw .openclinxr/opt/hair-groom-2/probe07/result.json, untracked)
View direction head-local +y (groom.head_frame rows right/back/up; card_local vs card_verts fit, ~3 deg head tilt, residual
max 2 mm). W from card_verts edge pairs, sampled at 1 mm steps (24 stations are ~23 mm apart).
| set | ratio 0-10 mm median / p90 | ratio 10-20 mm median | pw mm | ms mm | angle normal vs view, deg |
|---|---|---|---|---|---|
| front band (32) | 1.33 / 2.83 | 1.32 | 8.14 | 5.19 | 34.3 |
| random control (32, probe05 ids) | 1.64 / 3.01 | 1.65 | 6.19 | 3.55 | 61.5 |
| front, 12 never covered (probe05) | 2.30 | - | 8.13 | 3.12 | 34.0 |
| front, other 20 | 1.19 | - | 8.19 | 6.81 | 34.8 |
Rule: 1.33 <= .5 false; 1.33 <= .5 x 1.64 = .82 false. Front cards face the front camera more than the control does.

## Gap direction (measured after the probe, existing renders; manager check)
Front column profile, cols 500-524, median L, incumbent at cutoff .85 (probe06/cut-85) vs v2 target (tgt-fithead):
| row | 228 | 232 | 236 | 240 | 244 | 248 | 250 | 252 | 256 | 260 |
|---|---|---|---|---|---|---|---|---|---|---|
| render | .15 | .21 | .21 | .21 | .25 | .23 | .41 | .51 | .60 | .61 |
| nohair (same body, hair hidden) | .40 | .39 | .38 | .39 | .39 | .39 | .43 | .51 | .60 | .61 |
| target | .19 | .26 | .40 | .59 | .62 | .63 | .64 | .64 | .64 | .66 |
Rows 236-248 are hair-dark in the render (.21-.25) and skin in the target (.40-.63): the rendered hair reaches 12-17 px
FURTHER DOWN the forehead than the target. The gap is overshoot, not missing coverage; this matches the alpha sweep (more
coverage did not raise the row) and the edge-on result. Shading is out on the same profile: the hair there reads dark, not
skin-bright. The nohair render is darkened (L .38-.39) down to row ~250, the same place the render hair ends.
