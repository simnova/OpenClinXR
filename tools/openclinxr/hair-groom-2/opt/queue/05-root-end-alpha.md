# 05 card root-end alpha at the front hairline (CEO NEXT 2, 2026-11-10)

Source: card 04 closed (card roots within 2 mm of strand roots, median vertical 2.0 mm); the gap to explain is 31-35 rows
in the P3 frame (~25-28 mm); in the driver frame under objective v2 (d3520f10e) the incumbent family reads ~252 vs target 236.
Suspect: the atlas root end. atlas_bake.py / atlas_from_members.py stagger member roots over card_root_depth_mm, and
cards_from_strands.py --root-offset-scale help records atlas transmittance .36-.40 at card roots (r13 d5an.py). The runtime
GLB uses alphaMode MASK with cutoff 0.85 (build_trial.sh), so texels under .85 are discarded, not blended.

## Hypothesis
Front-band cards are not opaque (alpha >= .85) until some distance d_mm along v from station 0; the visible hairline sits
d_mm behind the card root. If median d_mm over the front band is near 25 mm, the root-end alpha is the gap.

## First probe (CPU, numpy, no render)
Inputs (read-only): the incumbent runtime GLB (W2 public _hair-transplant-probe/aisha-cards-p2-b.glb: hair mesh UVs and
the baseColor/alpha atlas actually shipped) and EV/r10/tw35ta15sm2 cards.npz (card length, card_cell, card UV layout);
front band = card 04's (root y <= ymin+10 mm, |x| <= 50 mm head-local; 32 cards; probe04/roots.json).
Per front card: alpha profile along v (mean and p75 across u inside the cell), converted to mm along the card; d_mm = first
v where the u-coverage fraction with alpha >= .85 reaches .5. Report median / p90 d_mm and the same for 32 random non-front cards.

## Accept rule (proposed thresholds)
- Root-end alpha is the cause: front median d_mm >= 15 mm (more than half the 25-28 mm gap). Next: a structural
  candidate that changes the root stagger or the MASK cutoff on the root end, scored with objective v2.
- Not the cause: front median d_mm < 5 mm. Report and name the next suspect from the evidence.
- Between: report both numbers and the share of the gap explained.
