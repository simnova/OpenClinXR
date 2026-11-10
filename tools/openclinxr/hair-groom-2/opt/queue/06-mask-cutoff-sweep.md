# 06 MASK alpha cutoff sweep at the front hairline (CEO 2026-11-10 09:10, option b of queue/05)

Status: rule written before any render. Probe GLBs are probe artifacts (public/_hair-transplant-probe/opt/cut-*.glb, gitignored);
no shipped GLB changes.

## Hypothesis
queue/05: front cards reach 50 % width coverage at alpha >= .85 a median 18.2 mm from the root (random cards 5.1 mm), and
624 / 1410 cards never do. alphaMode MASK discards every texel under the cutoff, so lowering the cutoff should raise the
visible front hairline toward the target.

## Probe
Incumbent GLB aisha-cards-p2-b.glb, alphaCutoff of material hair_cards rewritten in the GLB JSON chunk only (opt/glb_cutoff.py;
no other byte change), all cards: cutoff in {.85 control, .75, .65, .5}. Render with render_trial.sh (nohair key inc), score
with objective-v2.json (d3520f10e, frame fithead-8f1709ab, mask mattes). Per cutoff: D_v x 4, sum D, front hairlineRow and
falloff (part_width.measure_band), iou x 4, ship_a4 --bars v2 verdict.

## Rule (fixed before the renders)
- VOID: control sum D differs from the v2 incumbent 73.612 (trials-v2.csv incumbent row) by > 0.01 (renders are
  deterministic: t24 seed 0 reproduced to 1e-4, 2026-11-10). Then the sweep says nothing.
- MOVES: a cutoff moves the front hairlineRow by >= 5 px toward 236 (v2 target): row <= 247 (control 252; 5 px from CEO
  09:10, slightly above the hairlineRow scale of 4 px). A row below 236 counts by its distance to 236, not its raw shift
  (overshoot is not a gain).
- NOT THE CAUSE: no cutoff gives row <= 247. Then go to queue/05 option (a), root stagger in the atlas.
- COST: for the best moving cutoff (lowest |row - 236|; ties -> higher cutoff), any non-front view with
  D_v(cut) - D_v(control) > delta_v (objective-v2 noise: 3q 1.217, side .521, back .644) -> rerun that cutoff on the
  front-band cards only (queue/04 band: 32 cards) as a separate material.
- Counterweight: the front hairline can rise because the outline grows. The front iou and the front D_v are reported next
  to the row; a row gain with front D_v worse than control by > delta_front 2.254 is recorded as a trade, not a win.
