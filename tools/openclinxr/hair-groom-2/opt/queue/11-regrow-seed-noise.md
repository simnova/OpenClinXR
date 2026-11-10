# 11 regrow seed noise of the fh0 build (CEO decision 2026-11-10, option (a) after queue/10)

Status: rule committed before any build.

## Why (CEO)
Cards 09 and 10 judge a regrown groom against delta_v. Back at fh12r has an unchanged silhouette (iou wnorm 3.97 -> 4.00) and
moved only in shading, the fh16 back signature.

## Correction to queue/10
queue/10 says delta_seed_v "was measured on material seeds". That is wrong. delta_seed_v (noise_floors.py) comes from
EV/p3/tol.json (grade/p3_tol.py): strand seeds s1..s6 of the groom, rendered as raw strands in Cycles under the P3 target camera,
5 metrics only (peak, base, black, streak, bandCont), tol_m = max_{i=2..5} |m(s_i) - m(s1)|, delta_seed_v = sum_m w_m tol_m / s_m.
It contains no card/atlas/transplant/tint chain and no iou, sat, hue, bandProfileL8, bandBlack8, bandRowVec, skin or peakCeil
term. Regrow noise through the runtime chain on the full objective is unmeasured.

## Measure
- fh0 recipe (groom/recipes/straight_centre_part_collarbone.json, seed 1107 = fh0) at groom.py --seed-offset 1, 2, 3
  (seeds 1108, 1109, 1110); `--samples 128 --views front,three_quarter_left,side,back`; current Aisha body (75b9e5c7).
- Same chain as fh0: card09/chain.sh (simplify tol 2.00, g2 settings), render_trial.sh, score_trial.py --objective
  objective-v2.json, matte. Tris recorded, not gated (noise measurement, not candidates).
- Store: .openclinxr/opt/hair-groom-2/card11/ (groom-sK, chain-sK, render-sK); probe GLBs _hair-transplant-probe/opt/card11-sK.glb.

## Estimator (named; p3_tol A estimator extended to every objective-v2 term)
Per view v and term m (score.json views.v.terms.m.wnorm), reference fh0 = card09/render-fh0/score.json:
  tol_{v,m} = max_{k=1..3} |wnorm_{v,m}(sK) - wnorm_{v,m}(fh0)|
  delta_regrow_v = sum_m tol_{v,m}
This is the delta_seed_v construction (per-metric max abs deviation of seeds from the reference seed, summed in D units with the
objective weights and scales; wnorm already carries both), over all terms instead of 5. Reported beside it, information only:
the D-level spread max_k |D_v(sK) - D_v(fh0)|, each seed's front hairlineRow, and tris.

## Consequence (fixed now, CEO)
- Re-judge fh16, fh12 (card 09) and fh12r (card 10) from their existing score.json, no re-render, in queue/11 and
  .openclinxr/opt/hair-groom-2/card11/rejudge.json:
  other-view bar_v = D_v(fh0) + max(delta_v, delta_regrow_v), delta_v = objective-v2 delta_seed_v (3q 1.217, side .521, back .644).
  Front clause unchanged (hairlineRow 230-242). Tris clause unchanged (<= 63,024).
- fh12r passes every clause -> next card is (b): material/tint optimizer on fh12r.
- fh12r fails any clause -> stop and report the new excess per view.
- A seed build that fails (groom, chain or render error) -> stop and report; no substitute seed.
- No promotion, no main push.
