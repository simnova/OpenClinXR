# 00 hairline gap probe (SPEC D3)

status: run 2026-11-10, verdict S2 (fade is not the cause). Raw: .openclinxr/opt/hair-groom-2/probe00/part.json (untracked).

## Result (front hairlineRow, part_width.py; renders via render_trial.sh, 25 s each, 4 views)
| build | P3 frame (frames-samebody warp; identical s/dx/dy to frames-fithead) | driver frame (fithead-8f1709ab, target mapped to runtime = native crop) |
|---|---|---|
| target | 140 [EV/p3/part-s1.json] | 233 (tgt-fithead/target-front.png) |
| pre-fade sheen3b-final | 177 | 255 |
| faded incumbent p2-b | 173 (reproduces EV/p3 warped/ts-p2b-front.png, identical metrics) | 253 |
Pre-fade minus faded: +4 rows in the P3 frame, +2 rows in the driver frame (both inside the hairlineRow scale of 4 px).
Gap to target: 37 rows (P3 frame, sheen3b), 22 rows (driver frame, sheen3b). Removing the fade moves the row 0 rows toward 142.
Accept rule: pre-fade 177 >= 165 -> S2 accepted; S1 rejected. Next: queue a cards_from_strands root-keep structural candidate (new card);
tint-stage fadeFrac/fadeLenMm get no hairlineRow weight on this evidence. The strands row in the driver frame was not measured.


## Hypothesis
The front hairline gap is card-side. Front hairlineRow in the P3 frame: target 140 | strands 142 | cards 173
[EV/p3/part-s1.json]. Two suspects:
- S1: `cards/hairline_edge_fade.py` (60 mm alpha fade over the outer 0.6 of the cell width on 507-561 cards) pushes the
  visible hairline down.
- S2: K4 (DESIGN-realism.md:174), cards_from_strands.py takes the cluster mean, which drops root-end columns at the hairline.
S1 and S2 predict different results for a pre-fade build: S1 moves the row toward 142 when the fade is absent; S2 leaves it near 173.

## Files
- `cards/hairline_edge_fade.py` (read), `cards/cards_from_strands.py` (read), `grade/part_width.py` (measure),
  `grade/runtime_frame.py` (frames-samebody warp, D4).
- Inputs: pre-fade BEST3 material build `aisha-cards-sheen3b-final.glb` (no scalp tint, no fade) and `aisha-cards-p2-b.glb`.

## First probe
part_width on the pre-fade sheen3b build, rendered in the same warp as the P3 cards number (frames-samebody, the frame that
gave 173). One render of one GLB: front view, plus its nohair crop if the sheen terms are wanted.
Command shape: `render_trial.sh generated-humanoids/_hair-transplant-probe/aisha-cards-sheen3b-final.glb probe00 <dir> g2`,
then `python3 grade/part_width.py <out.json> prefade=<dir>/ts-probe00-front.png`, compare hairlineRow to 173 and 140.

## New knobs and ranges
None in the probe. If S1 holds, the tint-stage knobs fadeFrac [.3,.8] and fadeLenMm [20,80] already cover it (DESIGN-realism.md:359
records 6-20 mm ramps failing). If S2 holds, a K4 root-column keep fraction is a new structural knob (range UNKNOWN until the
cards_from_strands.py option is read).

## Accept rule (thresholds proposed by the implementer, not from SPEC)
- S1 accepted: pre-fade hairlineRow <= 150 in the P3 frame (within 2x the hairlineRow scale of 4 px of strands 142) and the
  fade build returns 173; then the tint stage gets hairlineRow-weighted trials, and this card closes.
- S2 accepted: pre-fade hairlineRow >= 165 (unchanged within 8 px of 173); then queue a cards_from_strands root-keep change as a
  structural candidate (new card here).
- Neither: report the measured row; do not tune the fade.
