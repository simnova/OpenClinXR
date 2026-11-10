# 05 card root-end alpha at the front hairline (CEO NEXT 2, 2026-11-10)

Status: first probe run 2026-11-10, verdict cause (front median d_mm 18.2 mm).
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

## Result (probe05, CPU; raw .openclinxr/opt/hair-groom-2/probe05/result.json, untracked)
GLB: material hair_cards, baseColorTexture alpha (strand-atlas-cal 2048^2 RGBA), alphaMode MASK, cutoff 0.85. Mapping: GLB hair
triangles in cards.npz order (31393 / 31512 match card_verts < 0.1 mm; the 27 mismatched cards include no front card).
| set | n | never reach 50 % coverage >= .85 | d_mm median (reaching) | p90 | d_mm median (never = card length) | first texel >= .85, median |
|---|---|---|---|---|---|---|
| front band | 32 | 12 | 18.2 | 133.6 | 122 | 5.9 |
| random non-front (seed 0) | 32 | 10 | 5.1 | 8.7 | 6.2 | 1.7 |
| all cards | 1410 | 624 | 6.0 | 89.4 | 26.6 | - |
Front mean alpha by mm from root: 0-2 .21, 2-5 .25, 5-10 .44, 10-20 .52 (random cards .33, .52, .61, .65). Mean row fraction
with >= 50 % coverage: front .38, random .58.
Verdict by the accept rule: cause (front median 18.2 >= 15). The measure also shows whole-card clipping: 624 of 1410 cards never
reach 50 % coverage at cutoff .85. Front cards are more transparent than random cards over their whole length, not only at the root.
Not tested: a render showing the hairline row moving with d_mm; root stagger and the MASK cutoff as separate causes; atlas row
resolution ~2.8-3.4 mm per row.
