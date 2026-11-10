# SPEC::hair-groom-2-opt | FORMAT::DENSE_v1 | approved by operator 2026-11-10 ("Approve both": OP6 + handover)
Source: CEO session consult with a Fable peer (4 turns) + A3 check. Every number carries a source; UNKNOWN is UNKNOWN.

W::`/Users/patrick/.grok/worktrees/src-openclinxr/hair-groom-2` (lane, branch wt/hair-groom-2; READ ONLY for you)
EV::`W/.openclinxr/evidence/hair-groom-2`
W2::`/Users/patrick/.grok/worktrees/src-openclinxr/hair-groom-2-opt`, branch wt/hair-groom-2-opt (create from wt/hair-groom-2 HEAD; merge the lane's P3 commit in when it lands)
A3::`/private/tmp/claude-501/-Users-patrick--claude-spares-spare-Qm4C9Y/3d1e3113-cca3-49f1-aac5-820d82946498/scratchpad/a3/{result.json,compute.py}`
PY::`/Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13` + PYTHONPATH="$HOME/Library/Application Support/Blender/5.2/scripts/modules". numpy only. scipy/optuna absent everywhere [meas 2026-11-10]; no installs.

## DECISIONS
D1::OP6 (operator-approved): appearance metrics (peak, base, black, hue, sat, band row/profile) gated vs the TARGET images; structural metrics (outline falloff, stray px, streak direction) gated vs the strand render with seed tolerance. ∵ P3 strands in target scene miss target: peak front .607/3q .537/side .501 vs target .28/.33/.25; black front .324 vs .194; bandCont front .671 vs .970 [meas:EV/p3/score-s1.json]; target highlights are Imagine paint.
D2::no LLM in the inner loop (D1/D9 of GUARD_SAFETY). LLM jobs: implement structural candidates, finalist grading, promotion review. Short-lived, fresh context, state in files.
D3::hairline gap is card-side: front hairlineRow target 140 | strands 142 | cards 173 [meas:EV/p3/part-s1.json]. Suspects: hairline_edge_fade (60 mm alpha fade on 561 cards) or K4 cluster-mean root drop. First structural probe: part_width on pre-fade sheen3b build in the same warp.
D4::every metric scored in ONE registered frame per view (runtime_frame.py to-runtime or frames-samebody warp); frame id stored per trial row. ∵ P2 frame gives 255 vs 223, P3 frame 173 vs 140 for the same gap.

## COSTS
C1::runtime render pack 8 crops = 35.2 s [meas:EV/p3/batch-p2b.log wallClockMs 35245]; nohair crops depend on body only ⇒ render once, cache; 4 renders/trial.
C2::material build (s3.sh path: transplant_donor + transplant_library_hair) UNKNOWN s; tint build (cards/p2_scalp.sh, 2 Blender launches) UNKNOWN s. Time the first run of each and record.
C3::one heavy GPU job at a time on this Mac.

## OBJECTIVE (freeze as tools/openclinxr/hair-groom-2/opt/objective.json before trial 1; scales are illustrative from A3, not fitted)
per view v ∈ {front, three_quarter_left, side, back}: D_v(x) = Σ_m w_m·|m(x) − m(target)| / s_m ; D = Σ_v D_v
sheen terms (sheen_gate.py): peak s=.3·target | base s=.3·target | black s=.05 | hue s=10° w=.5 | sat s=.3·target | bandCont s=.10 w=.5 | streak s=.5·target ; w=1 unless stated
placement terms (zero extra renders):
  iou: hair-mask IoU vs frozen target mask (grade/target-masks), s=.05; HARD floor front ≥ .79, 3q ≥ .83, profile ≥ .84 [src: PROTO_PRIOR_ART_COMPUTE_FIRST row 1 groom gates]; back floor UNKNOWN → set from incumbent's measured IoU
  bandProfileL8: 8 equal row bands crown→hem, band median L, mean |ΔL_b| / (.3·target base)
  bandBlack8: same bands, black share, s=.05
  bandRowVec: per crown column row of max L vs target, median |Δrow|, s=.05·cropH (replaces bandRowCol)
  skinBand: front + 3q, rows hairline+5..+40 inside skin mask, |ΔL| s=.03, |Δhue| s=5°
front part terms (part_width.py): partWidthMedPx s=2 px | hairlineFalloffMedPx s=4 px | hairlineRow s=4 px (in the registered frame, D4)
soft ceiling: peakCeil = max(0, peak − 1.25·target)/(.3·target), w=2 [DESIGN:125 report-only, no known-good]
HARD: G2 black_v ≤ target_v + .02 ∧ peak_v ≥ .8·target_v [DESIGN G2]; tris ≤ 63,024 [DESIGN G4 record]; shape untouched (41/41 not re-run; material/tint do not move geometry)

## A3 RESULT (premise check, read-only, PASS)
E1 BEST3 < r10 all 4 views: D_v front 9.04/18.89, 3q 6.10/19.04, side 10.47/17.96, back 4.33/11.85 ⇒ Δ_v = 9.85 | 12.94 | 7.49 | 7.52, ΣΔ 37.8
E2 BEST3 < ns15 all 4, weak: front passes only on streak (streak-free ns15 8.23 < BEST3 8.54)
E3 p2a < BEST3 front part+falloff 1.5 vs 4.0
E4 g2 vs p2a: sheen terms MISSING (no nohair renders for g2 ×4, p2a side/back)
X1 cards-p2b vs strands sheen D 37.17 vs 31.34 (P3 frame)

## NOISE FLOORS
δ_seed_v: strand seeds 1-6 spread per structural metric (lane's P3 output) → plateau rule + ship-margin floor
δ_grader_v: |D_v(g2) − D_v(p2a)| (graders called a near tie, 5:4 of 16 cells) → needs 6 nohair renders: g2 front/3q/side/back + p2a side/back, same ts scene and crop set as EV/p2/st1/crops. FIRST GPU job.
δ_v = max(δ_seed_v, δ_grader_v)
resolution check: Σδ_v ≥ ΣΔ_v/4 (= 9.45) ⇒ composite cannot separate no-change from a clear win ⇒ do NOT run DE; add terms; report.

## SEARCH
S1::stage material first, then stage tint with material fixed. numpy DE rand/1/bin, pop 16, F .6, CR .9; Sobol/LHS 16 first for sensitivity.
material knobs (best3 value; range; src): K .65 [.4,1.0] sheen3 probe | spec .3 [.1,1.0] r10 1.0/ns15 .15 | roughness .4 [.2,.6] upper UNKNOWN | anisotropy .5 [.3,1.0] r10 .95 | specColorG .45 [.3,1.0] | specColorB .25 [.15,1.0] (R frozen 1) | streakAmp .5 [0,1] donor.json | streakSigmaMm .5 [.3,1.0] bounds UNKNOWN ; frozen: anisoRot 0, streak map structure (rho, seed) [P1 "streak map kept" 685c0056e]. budget 96 trials, 4 h wall.
tint knobs (g2 value; range): amax .8 [.4,1.0] | wideAmax .3 [0,.5] | closeMm 2 [1,3] (3 mm erosion bared the part, DESIGN:368) | closeSoftMm 1.5 [.5,3] | fadeFrac .6 [.3,.8] | fadeLenMm 60 [20,80] (6-20 mm ramps failed, DESIGN:359) ; frozen sigmaMm .6, wideSigmaMm 3, sideburnWeight .2. budget 32 trials.
counterweights (which term refuses the cheap corner): K↓ → bandProfileL8, sat, hue | spec↑ roughness↓ → peakCeil, bandRowVec, bandCont | streakAmp↑ → peak, sat | amax↑ closeMm↑ → skinBand, hairlineFalloff | fadeLenMm↑ fadeFrac↑ → hairlineRow, iou front.

## STOP
plateau: 32 trials (2 generations) with best ΣD improving < Σδ_v
infeasible: 0 feasible trials after 30
ship candidate: D_v(cand) ≤ D_v(incumbent) − max(2·δ_v, Δ_v/4) in every view ∧ all HARD
rounds: 2 per stage/structure on a miss, then report to operator [DESIGN:257]
incumbent: BEST3 + p2 g2 = apps/ui-xr/public/generated-humanoids/_hair-transplant-probe/aisha-cards-p2-b.glb (p2_scalp.sh sha f346382e3945281b)

## FINALIST GATE (G1')
5 fresh-context Claude (sonnet) graders × 4 views = 20 blinded A/B (candidate vs incumbent), target T shown, labels hidden, left/right randomised per grader, no knobs/trial ids. Q1 gated: "which of A/B is closer to T"; PASS ≥ 15/20 pick candidate (binomial p≈.02 under null). Calibration: BEST3 vs r10 (expected BEST3) shown separately; a grader failing calibration is discarded and replaced. Q2 ungated, no target: "which reads more as real hair"; split (Q1 wins, Q2 loses ≥ 3/5 graders) ⇒ report to operator as OP6 evidence. Then CEO grades pixels at native resolution. Promotion = operator only.

## DRIVER LAYOUT (W2/tools/openclinxr/hair-groom-2/opt/)
objective.json | de.py (pure function of trials.csv → next vector; restart-safe) | build_trial.sh <stage> <json> (material: s3.sh path; tint: p2_scalp.sh path; writes glb + sha) | render_trial.sh (batch.ts, 4 views, hair crops; nohair cached) | score_trial.py (sheen_gate + part_width + placement terms → metrics, D_v, feasible, frame id) | driver.py (loop: propose → skip if row exists → build → render → score → append row via atomic rename → check STOP → exit 0 writing opt/STATUS.md) | queue/NN-<name>.md (structural candidates: hypothesis, files, new knobs+ranges, accept rule)
state: W2/.openclinxr/opt/hair-groom-2/trials.csv (trial,stage,seed,code_sha,glb_sha,frame_id,knobs…,metrics…,D_v…,feasible,seconds); process: nohup, opt/driver.pid, driver.log. code_sha change ⇒ new stage label, old rows kept.
structural queue seed: 00-hairline-gap-probe (D3), 01-T1-data-bake, 02-T3-two-lobe, 03-T8-flyaway [DESIGN:180-193 untested techniques].

## AMENDMENTS (CEO session, 2026-11-10 01:10; verbatim intent, applied before trial 1)
A1::MASK CONTAMINATION. hideHair diff mask (|img − nohair|) includes shirt/skin pixels the hair SHADES: 34,952 px with L > .35 at rows 685-744 front on Cycles strands [meas: DESIGN-realism.md ~L427, be78f298d]. On a hair matte strands are DARKER than target (peak .145-.212 vs target .253-.328; front black .486-.531 vs .194). D1 conclusion stands; D1 numbers replaced by the matte numbers. Runtime card crops use the same diff mask ⇒ card sheen metrics and A3 E1 likely contaminated. Before freezing objective.json: (a) measure contamination on runtime crops (mask px outside the hair silhouette / shadow-only px); (b) score with a hair matte (`sheen_gate.py score label=prefix::matte`, be78f298d); build a runtime hair matte without editing isolated-subject-lab.ts / isolated-subject-rig-variants.ts; (c) re-run A3 E1-E3 on matte masks. Any expected row inverts ⇒ stop and report.
A2::TARGETS ON A DIFFERENT BODY (targets: mpfb_parent_tara_johnson_v1 15,949 verts; runtime: ob_patient_aisha 7,006 verts [DESIGN ~L398]). IoU and hairlineRow vs target only after registration: `grade/runtime_frame.py fit-head` (be78f298d; IoU .895-.985) for every view; frame id per trial row. IoU floors .79/.83/.84 demoted to soft terms; HARD iou floor_v = incumbent registered IoU_v − δ_seed_v.
A3::δ_seed_v from `grade/p3_tol.py` output (EV/p3/tol.json; seed 6 passes 19/24 cells, r10 fails 4 views).
GPU::P3 condition met (be78f298d). One heavy job at a time incl. the C51 board worker's Playwright captures.
A4::SHIP RULE (CEO, 2026-11-10; replaces "every view ≥ max(2δ,Δ/4)"; applied post hoc to trials.csv at stage end; driver not restarted).
Derivation: Δ_full_v = D_r10_v − D_BEST3_v under the frozen full objective (12ab0163d, matte, fithead-8f1709ab) [meas: .openclinxr/opt/hair-groom-2/DELTA_FULL.md]; r_v = Δ_full_v / D_r10_v (relative cut of the graded 4/4 win BEST3 vs r10): front .394 | 3q .599 | side .410 | back .691. The /4 is carried from turn 3 and is UNSOURCED.
S1 non-regression: D_v ≤ D_inc_v + δ_v, all 4 views.
S2 G1 literal: D_v < D_BEST3_v, all 4 views.
S3 visible gain in ≥ 2 of 4 views: D_v ≤ D_inc_v − max(2δ_v, D_inc_v·r_v/4) ⇒ front ≤ 23.59 | 3q ≤ 15.84 | side ≤ 17.78 | back ≤ 6.27.
S4 total: ΣD ≤ ΣD_inc − 2Σδ = 74.11 − 9.26 = 64.85.
Stability (CEO): g2 instead of BEST3 as win end point moves the /4 margins by .57 | .11 | .13 | .02, each < δ_v.
Known leak: a darker/flatter K↓ spec↑ trade on front+3q can pass S1-S4; a candidate is not a ship until the finalist Q1/Q2 gate passes.
Stage-end report adds: count of trials passing S1-S4; best one's per-view D_v vs each bar; trials failing exactly one clause by < δ_v listed as border cases (reported, not passed).
