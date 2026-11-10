# 00 hairline gap probe (SPEC D3)

status: queued, not run. Needs the GPU gate open (the probe renders one front crop).

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
