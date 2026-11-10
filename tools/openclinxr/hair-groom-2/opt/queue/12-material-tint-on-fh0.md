# 12 material/tint sweep on fh0 (CEO decision 2026-11-10, after queue/11; lane ceo-2026-11-10-b)

Status: rule committed before any build or score.

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
