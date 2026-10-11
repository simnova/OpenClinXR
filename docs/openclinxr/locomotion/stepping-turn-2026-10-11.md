# Stepping turn at arrival: procedural lift-and-place steps (2026-10-11)

Verdict: ADOPT_WITH_LIMITS. Runtime code changed (default-off flag); control rows
bit-identical on all rigs. Evidence: `.openclinxr/evidence/stepping-turn/`
(`cagematch.json`, `ik-noop.json`, `report.json`, `stepping-turn-bake.glb`,
`step-strip.png`, `step-vs-ref.png`).

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
  residual: shorter arc, weight stays on the outer pivot), 0.7 s/step, 0.035 m lift
  peak, min-jerk yaw + lift, placements rotated about the stance foot and gathered
  to 0.25 m shoulder width (a 0.42-0.53 m walk split pivoted wide walks the torso
  0.30-0.36 m off the spot). 8 unit tests (count, alternation, exact landing,
  chaining, width cap, timing/lift, Y hand-off continuity, gathered endpoints).
- `stepping-turn-leg-ik-mod.ts`: production CCD + heel-from-toe closed-loop offset.
- `stepping-turn-execution-mod.ts`: yaw from plan, CCD legs, stance pinned by exact
  rigid translate, two passes (CCD-then-pin: pinning the pre-CCD walk pose walked the
  slot 0.42 m on the child — the pin must read the post-CCD world).
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
| physician | 0.0000 | 0.0997 (bar 0.0900) | 0.00 | 0.0504 (bar 0.0879) | 1.52 | 0.0350 x2ep |
| nurse | 0.0000 | 0.1364 (bar 0.1064) | 0.00 | 0.0501 (bar 0.1372) | 1.52 | 0.0350 x2ep |
| child | 0.0000 | 0.0569 (bar 0.4280) | 0.00 | 0.0333 (bar 0.4236) | 1.52 | 0.0350 x2ep |

Turn-phase slide 0.12-0.136 -> 0.0000 on all rigs; control swing episodes lift
0.0000 m (a swivel, confirmed) vs 0.0350 over exactly 2 episodes. The whole-run bar
fails on physician/nurse by 0.01/0.03 m: the walk phase alone contributes
0.0997/0.1364 and the brief forbids touching it. Arrival 0.105-0.156 m, control
parity (0.130-0.159); the 0.05 SC-05 cap fails for both.

## STEP 4: side-view strip vs reference

`bake-stepping-turn.ts` bakes the production slot path + plan + CCD into
`stepping-turn-bake.glb` (`stepping_turn_arrival`, 91 frames); Blender EEVEE strip
(fixed camera, full body, floor ticks, framing verified) beside 6 reference frames
at matching turn phases: `step-vs-ref.png`. Both show two lift-and-place steps with
body yaw following the feet.

## Limits (why with-limits, not adopt)

1. Whole-run slide stays walk-bound on adult rigs until the walk improves (out of
   scope; control bit-identity required it).
2. Arrival at control parity via pivot migration, not improved to any cap.
3. The browser CCD path is probe- + bake-proven only; flipping the flag for
   production needs orchestrator review. Nurse/child strips not rendered.
