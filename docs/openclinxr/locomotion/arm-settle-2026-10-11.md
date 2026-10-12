# Arm settle: ownership blend applies once per bone (2026-10-11)

Physician walk start and walk end snapped the upper arm ~30 deg in one frame. The
locomotion crossfade ramp (0→1 / 1→0) existed on paper and reached the posture pass
intact. The posture pass applied it 19 times per frame.

## Cause

`packages/openclinxr/xr-pose/src/clinical-idle-posture.ts:351-366` traverses every
skinned mesh's skeleton after the scene-graph traversal. The physician GLB carries 18
skinned-mesh objects (8 body primitives + 10 single-primitive meshes) sharing one
skeleton, so the same bone objects were presented 19 times per call. Absolute writes
are idempotent, but the ownership slerp (`:324`) is not: N applications compound the
mixer residual to w^N. Measured on upperarm01L, residual B/A = w^19 exactly (K = 19.0
at six steps across both transitions), crushing the continuous ramp into a step:
output bit-exact idle for w ≤ 0.77, release in one frame at w ≈ 0.99.

Evidence: `.openclinxr/evidence/arm-settle/control-tap.json` (per-frame weight the
posture pass read, claim writer tag, pre/post quats). Every claim write during both
transitions is `loco:walking` / `loco:stopping` from
`packages/openclinxr/xr-humanoid-animation/src/locomotion-clip-playback-mod.ts`; no
other writer touches the claim. The mixer never steps more than 1.6 deg.

## Fix

- Posture pass: one application per bone OBJECT per call (identity guard,
  `clinical-idle-posture.ts`). Shared skeleton objects apply once; distinct
  same-named objects each still apply. Absolute-write behavior unchanged.
- Upper-body ownership ramp: 0→1 over 0.4 s from walk start, 1→0 over 0.5 s from the
  moment walking ends (`LOCOMOTION_UPPER_BODY_BLEND_IN_S/_OUT_S`,
  `locomotion-clip-playback-mod.ts`). The leg action-weight fade stays on the frozen
  0.3 s rate: it sets stance amplitude the arrival-close reads.

## Bars (physician, browser)

- INVARIANT: end-of-frame upper-arm quat = slerp(idleTarget, afterMixer, w) to 0.000
  deg max; w takes 10 distinct values in (0,1) at walk start, 12 at walk end.
- Max upper-arm step: 4.27 deg walk start, 2.74 walk end (cap 4.3).
- PRESERVATION: steps 10–24 end = mixer to 0.000 deg; idle hold 12.96 deg from trunk
  (13.1 ± 1).
- Legs: max quat diff 0.37 (lowerleg01L, step 71, arrived hold) vs same-code
  control-vs-control noise floor 0.29 at the same bone and step (root 0.18 vs 0.087).
  Toes bit-identical the whole run; divergence confined to settling-turn path timing
  (turn pivot/close hysteresis from load-timing dust, present with and without the
  fix). No leg code path touched: leg fade rate formula unchanged, leg claim weight 1
  throughout, leg action weights follow the untouched 0.3 s ramp.
- FORBIDDEN: no pose-vs-previous-frame limiter added;
  `no-arm-clamp-in-the-pose-path.test.ts` asserts a 60 deg command lands same frame.

## Renders

Side + front body-only (garments/hair hidden) 0.5x clips of walk start and walk end:
`.openclinxr/evidence/arm-settle/renders/arm-settle-{side-start,side-end,front-start,front-end}.mp4`.
Front view matches the orchestrator reference framing.

## Files

- `packages/openclinxr/xr-pose/src/clinical-idle-posture.ts` (guard)
- `packages/openclinxr/xr-humanoid-animation/src/locomotion-clip-playback-mod.ts`
  (blend-in/out durations; leg fade untouched)
- Unit tests: `xr-pose/.../the-posture-pass-applies-an-owned-bone-once.test.ts`,
  `xr-pose/.../no-arm-clamp-in-the-pose-path.test.ts`,
  `xr-humanoid-animation/.../the-upper-body-ownership-ramps.test.ts`
- Tool: `tools/openclinxr/evidence/arm-settle/arm-settle-render.ts`
- Evidence: `.openclinxr/evidence/arm-settle/{control-tap,control-tap2,fix-tap}.json`,
  `report.json`
