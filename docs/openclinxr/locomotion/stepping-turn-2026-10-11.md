# Stepping turn at arrival: procedural lift-and-place steps (2026-10-11)

Verdict: ADOPT_WITH_LIMITS. Runtime code changed (default-off flag); control rows
bit-identical on all rigs. Evidence: `.openclinxr/evidence/stepping-turn/`
(`cagematch.json`, `ik-noop.json`, `report.json`, `stepping-turn-bake-{physician,
nurse,child}.glb`, `step-strip-body.png`, `step-strip-garments.png`,
`step-vs-ref.png`).

## Why this slice exists

Every approach design fails its slide budget in the 62-63 deg in-place arrival turn,
and the room cannot fit a facing-arrival path (`arrival-turn-cagematch-2026-10-11.md`);
Kimodo cannot produce an in-place turn (`pinned-turn-cagematch-2026-10-11.md`). The
runtime's settling turn rotates the body while feet pivot/slide. A human turns by
LIFTING AND PLACING each foot. This slice implements that as a runtime mode of the
settling phase behind a default-off flag.

## STEP 1: the IK lead (pass via CCD, composite-thigh hypothesis refuted)

Prior footstep rounds: the shared two-bone solver missed its own heel target by
0.14-0.2 m on the shipped rig even on a near no-op solve. Suspected cause: a two-bone
solve on a four-segment hip-ankle chain (upperleg01 -> upperleg02 -> lowerleg01 ->
lowerleg02 -> foot). Probe (`tools/.../stepping-turn/ik-noop-probe.ts`) mirrors
shipped bytes (bind + walk-clip samples) into a live tree under the 0.86 runtime
framing and runs the production solver + application, 3 rigs x 2 sides x 5 clip times:

- Existing no-op miss: 0.045-0.40 m (prior finding reproduced).
- Bind-straightened composite: BIT-IDENTICAL to existing everywhere. The intermediates
  already run near-straight (chord-vs-true <= 3.8 mm), so the chord-shortening lead is
  refuted; the miss is the two-bone math/application on this rig, not chain length.
- CCD over all four joints: 0.0000 m no-op worst case, 0.0001 m worst case on a
  reachable 0.2 m step target, all 30 configs. On an unreachable lateral target the
  residual equals the reach gap to <2 mm (converges to the limit, not past it).

## STEP 2: plan + execution behind `steppingTurnEnabled` (default off)

- `stepping-turn-plan-mod.ts` (pure): N = ceil(|residual|/45 deg) alternating steps
  (2 for the 62-63 deg SC-05 residual), inner foot first (right for a positive
  residual: shorter arc, weight stays on the outer pivot), 0.7 s/step, 0.030 m lift,
  0.015 pelvis dip (rig-scaled), min-jerk yaw + lift, body-centered placements under
  the predicted slot with progressive gather widths, rest-snapshot baseline with
  step-0 plant morph, leg scale from rest sep. 9 unit tests.
- `stepping-turn-leg-ik-mod.ts`: analytic hinge (pole-plane cosine triangle,
  twist-free) + yaw-stable heel mapping; CCD kept as documented fallback.
- `stepping-turn-execution-mod.ts`: yaw/dip from plan, hinge legs, stance pinned by
  exact rigid translate, two passes (hinge-then-pin: pinning the pre-solve walk pose
  walked the slot 0.42 m on the child — the pin must read the post-solve world).
- `stepping-turn-frame-mod.ts` bridge + `case-owned-approach-arrived-mod.ts`
  extraction keep frame-mod at 427 lines (budget 500).
- Assay (`runtime-approach-measurement.ts`): flag passthrough, markers posed from
  published plan targets; mixer + walk/rest writes stand down once settling is
  reached (they re-stamped walk locals over the plan pose every frame and spiralled
  the slot 95 deg about the anchor for a 31 deg yaw).

## STEP 3: headless SC-05 assay (control bit-identical, turn bars pass)

Control A rows reproduce `arrival-turn/control.json` bit-identically (7 fields x 3
rigs). Stepping S rows:

| rig | turn slide | whole | yaw err | max step | dur | lift |
|---|---|---|---|---|---|---|
| physician | 0.0000 | 0.0997 (bar 0.0900) | 0.00 | 0.0504 (bar 0.0879) | 1.52 | 0.0300 x2ep |
| nurse | 0.0000 | 0.1364 (bar 0.1064) | 0.00 | 0.0501 (bar 0.1372) | 1.52 | 0.0300 x2ep |
| child | 0.0000 | 0.0569 (bar 0.4280) | 0.00 | 0.0333 (bar 0.4236) | 1.52 | 0.0274 x2ep |

Turn-phase slide 0.12-0.136 -> 0.0000 on all rigs; control swing episodes lift
0.0000 m (a swivel, confirmed) vs 0.027-0.030 over exactly 2 episodes. The whole-run bar
fails on physician/nurse by 0.01/0.03 m: the walk phase alone contributes
0.0997/0.1364 and the brief forbids touching it. Arrival 0.105-0.156 m, control
parity (0.130-0.159); the 0.05 SC-05 cap fails for both.

## STEP 4: side-view strip vs reference (body-only render rule)

`bake-stepping-turn.ts` bakes the production slot path + plan + hinge into per-rig
`stepping-turn-bake-{physician,nurse,child}.glb` (`stepping_turn_arrival`, 91
frames); Blender EEVEE strips with fixed camera, full body, floor ticks. Render rule
(operator 2026-10-11): grading renders hide garments/hair/shoes and show the BODY
ONLY with distinct thigh (orange) / shin (teal) / foot (yellow) materials so the knee
hinge and foot contact read; `step-strip-body.png` beside 6 reference frames at
matching turn phases (`step-vs-ref.png`); `step-strip-garments.png` as secondary.

## Pose bars (per rig, bake-measured)

| rig | hold flex L/R | pelvis Δ | dip | swing max | back-bow | heel miss |
|---|---|---|---|---|---|---|
| physician | 5.8 / 5.8 | 0.0000 | 0.0144 | 35.9 | 0 fr | 0.0351 |
| nurse | 5.7 / 5.6 | 0.0000 | 0.0155 | 39.8 | 0 fr | 0.0380 |
| child | 6.8 / 6.6 | 0.0000 | 0.0105 | 60.1 | 0 fr | 0.0651 |

Bars: hold <= 10 deg both legs, pelvis within 0.02 m of idle, swing <= 45 deg,
zero back-bow frames. 11/12 pass. Hinge no-op + displaced miss 0.00000 worst case
(all 30 probe configs, analytic closed form); the bake misses above are unreachable
stance frames (hip swung past max extension mid-turn — honest gap, optimal placement).

What fixed the FAIL pose (CCD: hold 9/29 deg, 91 bowed frames, crouch): the hinge
freezes intermediates at rest, solves the exact two-bone triangle in the pole plane
with twist-free minimal arcs (no iteration, no limit cycle), maps toe->heel through
a yaw-stable entry offset (re-reading the live offset fed solved orientations back
in: 120 deg of offset swing, 11 cm overshoot), pins the walk-frozen float down to
the rest baseline on step 0, dips the pelvis 0.015 (scaled), scales spatial targets
by rest-sep leg scale (REF 0.6058: 0.96/1.03/0.70), and lands placements under the
predicted slot with progressive gather widths. A setFromRotationMatrix-on-scaled-
matrix shear bug (slot 0.86) was found and fixed along the way (getWorldQuaternion).

## Limits (why with-limits, not adopt)

1. Child swing knee peaks 60.1 deg (bar 45): the absolute 0.42 m walk-frozen entry
   split on 0.52 m legs forces long first-step travels; N=3 measured 59.4 deg and
   breaks timing (2.05 s). Hold passes (6.8/6.6); ratios consistent with adults.
2. Whole-run slide stays walk-bound on adult rigs until the walk improves (out of
   scope; control bit-identity required it).
3. Arrival at control parity via pivot migration, not improved to any cap.
4. The browser leg path is probe- + bake-proven only; flipping the flag for
   production needs orchestrator review. Nurse/child strips not rendered.
