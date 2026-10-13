# Fixed-timestep animation clock (2026-10-12 measurement)

Active in the browser. Default ON; `?fixedClock=0` restores legacy frame-dt stepping.

## What is on the fixed clock (file:line)

- Accumulator + 1/60 s substeps + render interpolation: `packages/openclinxr/xr-humanoid-animation/src/fixed-timestep-clock-mod.ts:17` (`FIXED_SUBSTEP_SECONDS`), `:25` (`MAX_SUBSTEPS_PER_FRAME = 4`), `:64` (`consumeFrameTime`), `:92` (`interpolateSimScalar`), `:134` (`stepFixedClockFrame`), `:170` (`window.__openClinXrFixedClockStats` per-frame substep publish).
- Contact-window walk exit (single-support gating, max 60-substep wait): `packages/openclinxr/xr-runtime-state/src/walk-exit-window.ts:80` (`WALK_EXIT_MAX_WAIT_SUBSTEPS`), `:90` (`buildWalkExitBandStep`).
- Execution wiring (band evaluated per 1/60 s substep): `packages/openclinxr/xr-runtime-state/src/bedside-approach-execution-mod.ts:420`.
- Frame-loop wiring: `apps/ui-xr/src/main.ts:2856` (flag + frame state), `:3377` (frame dt: exactly 1/60 under the deterministic clock, clamped wall dt otherwise), `:3484` (`stepActorSimulation` one-substep body), `:3500` (fixed-clock vs legacy branch).
- Capture pacing modes: `tools/openclinxr/evidence/settle-entry/settle-entry-capture.ts:57` (`capture|real|fixed72|jitter`), `:66` (seed 20261012), `:84` (synthetic dt), `:170` (fixed-clock probe).
- Analysis: `tools/openclinxr/evidence/settle-entry/settle-entry-analyze.ts:329` (rendered reversals + second difference), `:354` (substep histogram).

## Proof matrix (SC-05, stepping turn on; branch stage3 vs main stage0 control)

| condition | n | along mean/sd | lateral mean/sd | plant | walk-end clip |
|---|---|---|---|---|---|
| real (stage3) | 12 | -0.0301 / 0.0002 | 0.0387 / 0.0005 | left x12 | 1.598 x12 |
| fixed72 (stage3) | 6 | -0.0301 / 0.0001 | 0.0384 / 0.0002 | left x6 | 1.544 x5, 1.571 x1 |
| jitter (stage3) | 6 | -0.0301 / 0.0001 | 0.0384 / 0.0002 | left x6 | 1.544 x6 |
| capture (stage3) | 6 | -0.0301 / 0.0001 | 0.0384 / 0.0002 | left x6 | 1.571 x6 |
| control (main stage0) | 6/12/6/6 | capture -0.0231/0.0001, real -0.0330/0.0238, fixed72 -0.0123/0.0001, jitter -0.0118/0.0044 | capture 0.0153/0.0001, real 0.0132/0.0126, fixed72 0.0253/0.0005, jitter 0.0234/0.0025 | mixed (one run planted right) | — |

Real-time sd collapsed 0.0238 -> 0.0002. All four stage3 means agree to 0.0003 m.

## Bar verdicts

1. Arrival consistency: PASS (sd <= 0.0005 everywhere; means within 0.0003).
2. Walk-end clip time within one substep: FAIL. Spread 1.544/1.571/1.598 = 0.054 s (~3.2 substeps). All exits inside single-support R window; the phase of the first eligible window depends on pacing history.
3. Planted foot: PASS (left 30/30; control had one right).
4. Vs capture-clock control within 0.01 m: FAIL on lateral (along -0.0301 vs -0.0231, delta 0.007 ok; lateral 0.0384 vs 0.0153, delta 0.023). The contact-window wait shifts arrival vs the legacy immediate exit.
5. Rendered smoothness: reversals 0 everywhere PASS; second difference FAIL on the mean reading (capture mean-of-max 0.0118, 2x = 0.0236; fixed72 0.0357 = 3.0x; jitter 0.0485 = 4.1x; real 0.0057 passes). Max-reading passes everywhere (capture run max 0.0682, 2x = 0.1364 vs worst 0.0687). Fixed72/jitter interpolation over substep quanta adds velocity stair-steps the capture path never renders.
6. Turn slide + norms: PASS (max planted-window slide 0.0016 m <= 0.005; quat norms 1.0000..1.0000).
7. Substeps at 72 Hz: 0:284, 1:1117, 2:167 (n = 1568). Reported.
8. Proving ground (row lockOff): PASS. Stationary 0.487/0.453 vs main 0.47/0.44 (delta 0.017/0.013); toe 0.164-0.165/0.160-0.161 vs 0.157-0.160 (delta <= 0.008).

Verdict: adopt_with_limits. Determinism across pacings holds (bar 1); limits are the pacing-dependent exit clip phase (bar 2), the lateral arrival shift vs the legacy exit (bar 4), and interpolation stair-steps at non-60 Hz display rates (bar 5).

## Limits

- The exit substep is a clip-phase event only within a pacing; across pacings it varies ~3 substeps.
- Arrival moved ~0.023 m lateral vs main; the shift comes with the contact-window wait, not the accumulator.
- Second-difference elevation at 72 Hz/jitter is render interpolation, not sim divergence (sim arrival identical).

## Not tested

- `?fixedClock=0` legacy path; 90/120 Hz pacing; multi-frame stall / MAX_SUBSTEPS cap path (no run exceeded 3 substeps); forced exit after 60 waits; real-time settling in sim seconds; twoBone/ccd loco rows; Quest hardware / presenting / screenshots / video.
