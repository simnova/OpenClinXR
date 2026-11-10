# 11 regrow seed noise of the fh0 build (CEO decision 2026-11-10, option (a) after queue/10)

Status: fh12r FAIL under the regrow bar (back 8.4633 > 8.2274); stop. Rule 741875501, amendment 1 3b2e9384f.

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

## Rule amendment 1 (CEO, 2026-11-10 12:21; committed before any card 11 score; amends 741875501)
Why: sum_m max_k |delta wnorm_{v,m}| over ~14 terms per view takes each term's worst seed independently and drops sign
cancellation; it bounds the D_v spread from above and grows with the term count, so the bar loosens by construction. The clause
compares D_v, so the noise is measured on D_v.
- VERDICT estimator: delta_regrow_v = max_{k=1..3} |D_v(sK) - D_v(fh0)| (seeds 1108-1110).
- Bar unchanged in form: D_v(fh0) + max(delta_v, delta_regrow_v).
- Information only: the per-term-sum estimator of the original rule.
- Counterweight reported: each fh0 seed's front hairlineRow and tris (does a regrow alone move the front or tris clause).
- Consequences unchanged: fh12r passes every clause -> card (b), material/tint optimizer on fh12r; else stop, report excess per view.

## Harness fault (12:22) and fix
First run (log card11/card11_run.failed-1222.log) stopped at chain-s1 stage 1: cards_from_strands.py reads <groom dir>/recipe.json;
the card 09/10 scripts placed it there, card11_run.sh did not. No score existed. Fix: card11_run.sh copies
groom/recipes/straight_centre_part_collarbone.json into each groom-sK and skips a completed groom (s1 groom output kept,
positionsSha c642732f). Failed chain dir kept as chain-s1.failed-*. CEO: harness fault, not a seed build failure; continue.

## Result (2026-11-10 13:10; card11/rejudge.json)
Seeds (fh0 recipe, card09 chain.sh tol 2.00, objective v2):
| | fh0 (1107) | s1 (1108) | s2 (1109) | s3 (1110) |
|---|---|---|---|---|
| front | 27.5907 | 29.5481 | 28.2472 | 27.8184 |
| three_quarter_left | 18.6336 | 21.0211 | 19.6497 | 20.3673 |
| side | 19.8049 | 19.5173 | 19.1795 | 19.5634 |
| back | 7.5830 | 8.1658 | 7.9685 | 7.5652 |
| sum D | 73.6121 | 78.2523 | 75.0450 | 75.3142 |
| front hairlineRow | 253 | 254 | 253 | 254 |
| tris | 63,024 | 64,268 | 63,968 | 63,284 |
| strands | 98,187 | 98,138 | 98,133 | 98,096 |

| view | delta_v | delta_regrow_v (verdict) | per-term sum (info) | bar = D_v(fh0) + max |
|---|---|---|---|---|
| front | 2.2545 | 1.9574 | 3.4182 | 29.8451 (not a clause) |
| three_quarter_left | 1.2173 | 2.3876 | 3.0720 | 21.0211 |
| side | .5211 | .6253 | 2.8158 | 20.4302 |
| back | .6444 | .5828 | .9067 | 8.2274 (delta_v governs; unchanged) |
Largest per-term seed deviations: 3q peak 1.01, peakCeil .78, sat .39; side peakCeil 1.02, sat .68; back sat .31, peak .22.

Re-judge (no re-render):
| build | front row | tris | 3q D / bar | side D / bar | back D / bar | verdict |
|---|---|---|---|---|---|---|
| fh16 | 233 ok | 62,644 ok | 20.9561 / 21.0211 ok | 18.1885 / 20.4302 ok | 8.8011 / 8.2274 FAIL (+.574) | FAIL |
| fh12 | 238 ok | 63,192 FAIL | 21.0333 / 21.0211 FAIL (+.012) | 15.9211 ok | 7.5513 ok | FAIL |
| fh12r | 239 ok | 62,924 ok | 20.2999 / 21.0211 ok (-.721) | 18.4211 ok | 8.4633 / 8.2274 FAIL (+.236) | FAIL |
fh12r fails one clause: stop (rule). Card (b) does not start.

Counterweight:
- Front clause: the regrow alone does not move it (rows 253-254 vs fh0 253).
- Tris clause: the regrow alone breaks it. All three seeds exceed trisMax 63,024 (63,284-64,268) at simplify tol 2.00; fh0 sits
  exactly at the cap. The tris cap is a property of seed 1107, not of the recipe.
- Back: fh12r 8.4633 is above every regrow seed (7.5652-8.1658) and above fh0; the 3q value 20.2999 is inside the seed range
  (19.6497-21.0211).
