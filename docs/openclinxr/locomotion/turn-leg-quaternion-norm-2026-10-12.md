# Turn-leg quaternion norm (2026-10-12)

Physician SC-05 stepping turn. Verdict: **PASS-WITH-ONE-BAR-FAIL** — the
solver-attributable distortion is eliminated on every bar; bar c fails its
strict number on ambient breathing-scale oscillation present with and without
the fix. Full numbers were in the turn-leg-snaps report (machine-local, gitignored,
never landed in HEAD — ci-w8).

## Cause

`quatInParentFrame`
(`packages/openclinxr/xr-humanoid-animation/src/stepping-turn-leg-ik-mod.ts:206`)
does `copy(parentQ).invert().multiply(worldDelta).multiply(parentQ)`. Three
r184 `Quaternion.invert` is conjugate-only: it assumes a unit quaternion, so
the inverted norm is |P| instead of 1/|P| and the local delta takes norm
|P|^2, not 1. `parentQ` comes from `Object3D.getWorldQuaternion`, which
decomposes a matrix carrying the actor hierarchy's scale and shear (0.86 slot
scale plus the non-uniform breathing root scale through rotated joints), so it
is never exactly unit here — measured 0.99995..1.00034 across one traced run,
with all 142 hip/knee deltas non-unit.

One-run per-write trace (machine-local stage2-cause trace, never in HEAD — ci-w8;
`normWrites` on both legs x 2 passes): the first write off unit by more than
1e-6 is frame 0, left leg, pass 0, hip — 1.0 to 1.0006725 from inputs
parentQ 1.0003362 and delta 1.0 (1.0003362^2 = 1.0006725 exactly). Hold-sets
stay exactly 1.0; the mixer gap preserves norms, so the loss compounds inside
the solve, frame over frame, to 0.86 on the hip and 0.49 on the knee. Three.js
builds each bone matrix from the quaternion as given, so a 0.86-norm
quaternion scales the thigh by norm squared (0.74) — the leg visibly
telescopes late in the turn (render below).

## Fix

At the cause line: normalise `parentQ` and the local delta in
`quatInParentFrame`, so the operation produces a unit quaternion by
construction. Guard: normalise all four leg-joint quaternions after the
hold-sets and after the hip/knee writes of each hinge solve. Same pattern
fixed in `ccdSweep`, `solveTwoBoneIK` (axes from `setFromRotationMatrix`
inherit hierarchy scale), the foot/toe yaw freeze, and the arrival close
(rest snapshot before slerp, bone after). Checked with no drift possible once
inputs are unit: the ankle correction (axis normalised), the two-bone
callers, Euler writers, toe-local position writes. No clamps, limiters, or
smoothing filters.

## Metric

`tools/openclinxr/evidence/settle-entry/quat-norm-math.ts` normalises
quaternions before measuring angles and reports the per-bone min/max norm as
its own metric; both analyzers use it. The 16..85 deg one-frame leg snaps
reported in `arrival-turn-stability-2026-10-12.md` were this measurement
artefact: 2*acos(|dot|) on raw quaternions reads 84 deg for two
near-identical quaternions at norm 0.862. Re-measured normalised, control
reads 18.33..18.36 deg over the window and 14.3..14.4 deg over the settling
trace, 0 snaps in 12/12 — **control's true motion already met the 24.5 deg
bar**.

## Evidence (12 control + 12 fix SC-05, 6 proving ground)

- a. Fix: max |norm-1| 6.88e-08 over every frame and bone (bar 1e-4), 12/12.
  Control range 0.4875..1.0235.
- b. Fix max one-frame leg rotation 17.11..17.33 deg, 12/12 under 24.5.
  Control true value 18.33..18.36 deg, 12/12 — already passing.
- c. Fix thigh (hip-to-knee world) settling variation worst 0.0058 m:
  FAIL as written (bar 0.002), but the entire residual is ambient breathing
  root-scale oscillation — the proving ground with no turn at all varies
  0.0083 m — and the solver-attributable change is zero (all quats unit to
  7e-8). Control derived from measured norms via three.js |q|^2 matrix
  composition: hip 0.8606 renders a 0.35 m thigh at ~0.26 m (~0.09 m
  variation); knee reached 0.4875 (shin scale 0.24). **The thigh visibly
  shortened on control** (side-by-side render); nothing of it remains.
- d. Arrival slot mean fix vs control distance 0.0000 m (bar 0.005); fix sd
  0.0001/0.0002 m (bar 0.001). Planted foot self-consistent 12/12 left under
  the fix; control was mixed 10 right / 2 left, so cross-control matching is
  undefined. The fix collapses the bimodal planted-foot yaw (control mean
  -9.09 sd 5.04 deg, fix mean 4.13 sd 0.27 deg) and arrival toe heights go
  from gaps up to 104 mm on control to a stable 8 mm.
- e. Stance-foot slide per planted window: fix max 0.0020 m, 12/12 under
  0.02 (control 8/12, max 0.0213).
- f. Pelvis (slot.y) at arrival identical to 4 decimals (-0.0130 both, delta
  0.0000): the shrunken thigh did not lower the body — slot height is
  plan-driven.
- Proving ground (6 loco runs, fix): arrival along -0.0466 sd 0.0000, lat
  0.0383 sd 0.0000; norms 1.0000; max leg step 19.20..19.27 deg.
- Render (garments on): control clip (this run min hip 0.86, knee 0.44),
  fixed clip, and cropped side-by-side at 0.25x under
  `.openclinxr/evidence/turn-leg-snaps/clip-*/`.

## Unit tests

- `quat-norm-math.test.ts`: identical non-unit quaternions read 0 deg.
- `stepping-turn-leg-quat-norm.test.ts` through the public `./stepping-turn`
  entrypoint (types via `Parameters<>`): 300 consecutive solves on a
  0.86-scaled sheared chain, hip seeded at 0.86 norm, every joint within
  1e-9 of unit. Fails pre-fix, passes post-fix.

## Limits

Nurse, child, other scenes, 60 fps, and headsets are not tested. Control
thigh variation is derived, not captured (old captures lack joint world
positions). The render camera is the default three-quarter view, not a pure
side view.
