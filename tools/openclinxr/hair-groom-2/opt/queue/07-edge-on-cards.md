# 07 edge-on front cards at the hairline (CEO 09:45, 2026-11-10)

Status: rule written before the probe.
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
