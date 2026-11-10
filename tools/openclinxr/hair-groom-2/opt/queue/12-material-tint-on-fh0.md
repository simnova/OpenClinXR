# 12 material/tint sweep on fh0 (CEO decision 2026-11-10, after queue/11; lane ceo-2026-11-10-b)

Status: round 1 STOP on the minimal falsifier (no eligible trial improves a view beyond noise). Rule cfd9a16a0; K3 accepted by CEO.

## Scope (CEO)
Material and tint only: runtime sheen (spec, roughness, anisotropy), base-colour scale K, spec colour G/B, spec streaks,
scalp tint (amax, wideAmax, closeMm, closeSoftMm), hairline edge fade (fadeFrac, fadeLenMm). Groom geometry frozen at fh0
(seed 1107, groom-r9/s1 positions 15e052dd; cards, atlas, calib, simplified donor from card09/proof-orig, stage-2 sha 8b8a1481).
Base: fh0 = card09/proof-orig/final.glb = card09-fh0.glb, sha 5a62cfdd; scores card09/render-fh0/score.json.

## Build (one trial)
card12/tNN: transplant_donor.py on proof-orig/tw35ta15sm2 donor (cards, members, calib atlas) with the material knobs ->
transplant_library_hair.py (MASK .85, as chain.sh) -> tint_chain.sh with the tint knobs and groom-fh0/strands.npz ->
_hair-transplant-probe/opt/card12-tNN.glb -> render_trial.sh (nohair key = trial tag; tint changes body albedo) ->
score_trial.py --objective objective-v2.json --matte --glb.
Driver: .openclinxr/opt/hair-groom-2/card12/card12_sweep.py (untracked, as card09-11 scripts).

## Round 1 (the only round this card runs)
- t00 control: every knob at its chain.sh value (material BEST3, tint g2). Must reproduce GLB sha 5a62cfdd; mismatch -> stop,
  no other trial counts.
- t01-t16: Latin hypercube over the 14 knobs, ranges = objective-v2.json search.material / search.tint knob ranges, numpy
  default_rng(seed 12), seed recorded in card12/round1.json (D13).
- p1, p2 counterweight probes (destructive, expected to FAIL the named clause): p1 = t00 with K .40 (range floor: global
  darkening); p2 = t00 with fadeFrac .80, fadeLenMm 80 (range ceilings: strongest hairline fade). A probe that does not trip its
  clause leaves that clause unverified, and the report says so. Probes are never picks.

## Clauses (per candidate)
Noise per view: n_v = max(delta_v, delta_regrow_v) (queue/11 d9465b421): front 2.2545, 3q 2.3876, side .6253, back .6444.
- K1 no-worse: D_v <= D_v(fh0) + n_v for all 4 views: front 29.8451, 3q 21.0211, side 20.4302, back 8.2274.
- K2 tris: tris == 63,024 (fh0). Any other value = geometry leak -> stop the round and report.
- K3 front hairline: front hairlineRow <= 255 (fh0 253 + 2; the card 09 control band 253 +- 2).
  The cards 09-11 front clause (row 230-242) is not used: fh0 is at 253 and material/tint does not move roots, so that clause
  fails every candidate by construction. hairlineRow is reported for every trial. Flagged to the CEO at commit.
- Counterweight (cheapest ways a material/tint lowers D_v without looking more like the reference), known-good fh0 and regrow
  seeds 1108-1110 (card11/counterweight-metrics.json):
  - C1 global darkening: hair base L (score terms base.raw) >= target base L - .003 in every view
    (target: front .122, 3q .111, side .086, back .132; .003 = regrow-seed spread of base, max over views).
    Darker than the reference's own median hair is not closer to it. fh0 margins .048 / .005 / .020 / .011.
  - C2 desaturation: sat.raw >= min(sat fh0, sat target) - regrow-seed sat spread, per view
    (front .160-.032 = .128; 3q .165-.036 = .129; side .216-.044 = .172; back .208-.026 = .182).
  - C3 fade into the matte: matte hair pixels (score_trial hair_mask, matte path) >= fh0 - regrow-seed spread, per view
    (front 24,919-523 = 24,396; 3q 25,678-392 = 25,286; side 55,331-1,008 = 54,323; back 143,476-874 = 142,602).
    Shrinking the matte by alpha fade lowers iou/hairline terms with see-through hair.
  - The objective's hard G2 (black <= target + .02, peak >= .8 target) and iou floors stay in force.

## Minimal falsifier and pick
- improved view: D_v < D_v(fh0) - n_v.
- Eligible: t01-t16 passing K1, K2, K3, C1, C2, C3 and objective hard feasibility.
- No eligible trial with at least one improved view -> report and stop (CEO minimal falsifier).
- Else pick = eligible trial with the most improved views; ties by lowest sum D. Not a win until the CEO grades a native
  front + three_quarter_left contact sheet of the pick vs fh0 (card12/sheet-pick-vs-fh0.png, 1024 px crops, no resampling).
- ship_a4 --bars v2: information only. No second round, no promotion, no main push without a CEO decision.

## CEO ruling (after commit, before scores)
K3 accepted as written. Added (no rule change): t00 is judged against every clause; a control failing any clause = clause
miscalibrated, stop.

## Result, round 1 (2026-11-10 13:31; card12/judge.json, round1.json, sweep.log)
Control: t00 GLB sha 5a62cfdd (= fh0), D_v identical to card09/render-fh0, passes every clause.
Tris 63,024 in all 19 trials (K2 holds; no geometry leak). Each trial 54 s build+render+score.
Bars D_v(fh0) + n_v: front 29.845, 3q 21.021, side 20.430, back 8.227. Improved means below: 25.336, 16.246, 19.180, 6.939.
| trial | sum D | front | 3q | side | back | row | failed clauses | improved |
|---|---|---|---|---|---|---|---|---|
| t00 control | 73.612 | 27.59 | 18.63 | 19.80 | 7.58 | 253 | none | none |
| p1 K .40 | 68.657 | 24.75 | 17.41 | 18.01 | 8.50 | 253 | C1 3q/side/back, K1 back, hard (side black) | front, side |
| p2 fade max | 73.221 | 27.19 | 18.84 | 19.64 | 7.55 | 253 | none | none |
| t06 | 75.817 | 29.03 | 18.76 | 20.71 | 7.32 | 252 | K1 side | none |
| t05 | 88.247 | 27.39 | 18.58 | 17.60 | 24.68 | 252 | C2 3q/back, K1 back | side |
| t07 | 79.601 | 26.82 | 21.81 | 21.32 | 9.65 | 252 | K1 3q/side/back | none |
| t01-t04, t08-t16 | 81.3-122.8 | | | | | 250-255 | K1 in 3-4 views each; C2 in 9 of 13 | none |
Eligible trials with an improved view: none. Minimal falsifier met: STOP, no pick, no contact sheet.

## Counterweight probes
- p1 (global darkening, K .40): C1 tripped (base L 3q .079 < .108, side .066 < .083, back .100 < .129), and objective hard G2
  black failed in side. p1 is the lowest sum D of the round (68.66) and improves front and side beyond noise: global
  darkening is the cheapest D reduction on fh0, and C1 refuses it.
- p2 (fadeFrac .80, fadeLenMm 80): C3 not tripped. Matte px vs fh0: front -61, 3q -60, side -42, back -32, inside the
  regrow spread. At its range ceiling the edge fade does not shrink the matte, so C3 is unexercised in this knob space;
  C3 is unverified, not shown wrong.

## Reading
- 13 of 16 LHS trials fail K1 in 3+ views: the objective-v2 ranges around BEST3/g2 mostly move D up by 5-50.
- C2 (desaturation) fails in 9 of 16 LHS trials; C1 in none of them (C1 tripped only by p1).
- Not tested: a second round (DE from the round-1 population), single-knob sensitivity, K between .40 and .65 (the darkening
  direction that improved front/side in p1 while failing C1 in 3q/side/back).

## Round 2 (CEO 2026-11-10 after round 1; rule cfd9a16a0 unchanged; recorded before any round-2 build)
round 2 = K-only sensitivity per CEO 2026-11-10; if 0 eligible improving, the fh0 optimizer lane parks.
- Trials: r2t00 control (all chain values; GLB sha must be 5a62cfdd) and r2k45, r2k50, r2k55, r2k60 = K .45, .50, .55, .60,
  every other knob at its chain value. Record card12/round2.json; driver card12_sweep.py ROUND=2; judge judge.py ROUND=2.
- Same clauses K1, K2, K3, C1, C2, C3, objective hard feasibility, same improve thresholds, same pick rule; r2t00 judged against
  every clause (a failing control = clause miscalibrated, stop).
- Pick -> native front + three_quarter_left contact sheet vs fh0 for CEO grading. No pick -> PARKED note here, commit, push, idle.

## Round 2 result (2026-11-10 13:37; card12/judge2.json, round2.json, sweep2.log)
Control r2t00: GLB sha 5a62cfdd, D_v = fh0, passes every clause. Tris 63,024 in all 5.
| K | sum D | front | 3q | side | back | base L front / 3q / side / back | failed | improved |
|---|---|---|---|---|---|---|---|---|
| .65 (control) | 73.612 | 27.59 | 18.63 | 19.80 | 7.58 | .170 / .116 / .106 / .143 | none | none |
| .60 | 72.207 | 26.98 | 18.30 | 19.49 | 7.44 | .163 / .109 / .098 / .135 | none | none |
| .55 | 71.528 | 26.33 | 18.29 | 19.30 | 7.60 | .156 / .102 / .091 / .127 | C1 3q, back | none |
| .50 | 70.764 | 25.66 | 18.24 | 18.94 | 7.93 | .149 / .095 / .083 / .119 | C1 3q, back | side |
| .45 | 68.804 | 24.97 | 17.99 | 17.66 | 8.17 | .141 / .087 / .075 / .110 | C1 3q, side, back | front, side |
C1 floors (target base L - .003): front .119, 3q .108, side .083, back .129. Eligible improving: none. No pick.
K scales hair base L about uniformly across views, but the reference sits at different ratios of fh0 per view (front .72,
3q .96, side .81, back .92). Front and side improve beyond noise only at K <= .50, where 3q and back fall below the reference.
K .60 passes every clause and improves no view beyond noise (sum D -1.41).

## PARKED (2026-11-10 13:37, per the round-2 pre-registered line)
1. fh0 (groom seed 1107, current Aisha body, GLB 5a62cfdd) is the parked base of the hair-groom-2 optimizer lane.
2. Front-hairline geometry (cards 09-11): no offset/ramp beats fh0 beyond regrow noise in all views (fh12r fails back).
3. Material/tint (card 12, 16 LHS + 4 K-only trials): no eligible trial improves any view beyond max(delta_v, delta_regrow_v).
4. fh0 is at the objective's seed-noise floor for both; the one global lever that moves D (K) trades 3q/back against front/side.
5. Next hair work is the general-purpose hair station once the port lands on main; this lane idles until then.
