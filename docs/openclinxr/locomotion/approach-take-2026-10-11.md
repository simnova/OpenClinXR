# Whole-approach take: no-baked-turn regen + hold attribution (2026-10-11)

> Landed as evidence only (2026-10-11). The runtime take path described below (approach-take-*-mod.ts, bedside-approach-take-mod.ts, admission approach-take-v1) is NOT on main; it lives on branch `wt/approach-take` at `1e2560b8c`. Verdict: not_shipped_bar_fail.

Slice: whole-approach take (stand, walk the planned route, stop). Assay route 1.3059 m,
hash `b195b407…2af00`. Prior finding: slide concentrated in the stop window holding Kimodo's
baked 63.6 deg arrival turn (physician 0.13–0.15 m, nurse 0.25 m, child up to 0.21 m) and the
hold (0.05–0.10 m); start/cruise 0.02–0.04 m.

## 1. No baked turn

Regenerated physician seed 1, nurse seed 1, child seed 8 with the constraint arrival heading
equal to the route travel heading (2.0310192919565173 rad). The builder skips the turn window
when |arrivalDelta| < 1e-6 rad (turn 0.00 s); the take ends standing, facing down the route.
The route-hash arrival stays π, so the hash gate and clip names are unchanged (provenance
`noBakedTurn: true` on all three).

Runtime path confirmed without code change: `stepTake` exits into `settling` when the take-end
residual exceeds `SETTLE_TURN_TOLERANCE_RADIANS` (2 deg), else `arrived`
(`bedside-approach-take-mod.ts`); the flat-take unit test covers exactly this
("settles when the take ends off the target heading"). All three assay rows run
walking → settling → arrived, take-end heading ≈ 2.03–2.04 rad vs target π.

## 2. Hold slide: offline take vs runtime assay

| rig | bound take hold toe travel (world, offline) | runtime assay hold phase | root max in hold vs cruise mean |
|---|---|---|---|
| physician | L 0.0115 m / R 0.0114 m | med 0.0199 m, max 0.0214 m | 3.7% |
| nurse | L 0.0043 m / R 0.0049 m | med 0.0049 m, max 0.0205 m | 6.0% |
| child | L 0.0210 m / R 0.0220 m | med 0.0214 m, max 0.0214 m | 3.8% |

The runtime adds nothing in the hold: assay hold matches the bound take. The old 0.05–0.10 m
hold slide left with the baked turn (turn-end foot motion plus arrival-close convergence).
No trim applied: the takes are still in the hold (toe travel ≤ 0.022 m; root-speed spikes are
single-frame, mean ≈ 1% of cruise).

## 3. Assay result: bars fail, slide moved, not removed

Stop-phase slide collapsed (phy 0.132 → 0.026 m, nur 0.248 → 0.030 m, chi 0.049 m) but the
whole-run slide did not: the 63.6 deg residual now turns in the fallback settling leg, which
drags feet worse than the baked turn did.

| rig | take-end miss | phases | whole slide | takeStepMax | arrival | bars |
|---|---|---|---|---|---|---|
| physician s1 | 0.116 m short | walking,settling,arrived | 0.237 m | 0.042 m | 0.209 m | arrival/slide/stanceStep fail |
| nurse s1 | 0.112 m short | walking,settling,arrived | 0.273 m | 0.042 m | 0.106 m | slide/stanceStep fail |
| child s8 | 0.086 m short | walking,settling,arrived | 0.212 m | 0.034 m | 0.163 m | arrival/slide/stanceStep fail |

Controls bit-identical to pre-fix. Attribution of the top windows per rig:

- Settling-turn windows 0.19–0.27 m (all rigs): the clip-driven turn over a 63.6 deg residual
  walks the feet. The settling machinery was built for small residuals, not a full
  patient-facing turn. Production-real (browser plays the same blend + turn).
- Entry-morph windows 0.13–0.21 m at take time 0.03–0.27 s (phy 0.197, chi 0.212, nur 0.042):
  the 0.25 s rest→take fade morphs toes across a stance mismatch between the rig rest pose
  and the take frame 0. Production-real (same fade in the browser).
- Take-end miss 0.086–0.116 m short: the no-turn generations under-walk the constraint path
  7–10% (bound root travel 1.19–1.22 m vs 1.306 m route; source-side chords confirm). Same
  seeds as gen 3, new constraint shape, different walk length. The constraint-scale
  compensation corrects bind scale, not Kimodo's path-length adherence.

## Verdict

NOT SHIPPED. No stage 4/5. The whole-approach take still fails slide, stance-step (and
physician/child arrival) bars on every rig. Removing the baked turn fixed the stop window
but the slide reappeared in the settling fallback plus entry morph, and the takes under-cover
the route.

Candidate next directions (not attempted): constrain or select takes for full path coverage
first (arrival is gated on it); make take frame 0 match the rig rest stance (entry morph is
~0.2 m of free slide); or shorten the take and let a small-residual settling turn do what it
was built for. Fitting per-take scale to generation noise is not recommended.

Evidence: `.openclinxr/evidence/approach-take/assay.json` (this run),
`.openclinxr/evidence/approach-take/sweep.json` generation 4 (no-turn regen rows with
underCoverageM), work dirs `work-{physician,nurse,child}-seed{1,1,8}` (profiles with
turnSeconds 0.0, provenance with noBakedTurn).
