# Fixed-timestep animation clock (2026-10-12 measurement)

Opt-in in the browser (`?fixedClock=1`; default is legacy frame-dt stepping since handback-2). `?walkExitWindow=1` opts into the contact-window exit under the clock.

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

Verdict: adopt_with_limits. Determinism across pacings holds (bar 1); limits are the pacing-dependent exit clip phase (bar 2 — since shown to be a render instrument, B below), the lateral arrival shift vs the legacy exit (bar 4 — cause attributed to the accumulator path, A below; fix attempts failed, fallback C below), and interpolation stair-steps at non-60 Hz display rates (bar 5 — coverage measured, D below).

## Handback A: attribution (measured, not asserted)

`?walkExitWindow=0` (now default OFF, `?walkExitWindow=1` opts in) separates the
window from the clock. Capture pacing, SC-05:

| cell | config | along | lateral | yaw | plant | walk-end clip |
|---|---|---|---|---|---|---|
| 1 | fixedClock=0 (legacy stepping, window on) | -0.0231 sd 0.0001 | 0.0154 sd 0.0001 | 180.0 | left x3 | 1.476 x3 |
| 2 | clock on, window off | -0.0301 sd 0.0000 | 0.0385 sd 0.0001 | 180.0 | left x3 | 1.571 x3 |
| 3 | both on (stage3-capture) | -0.0301 sd 0.0001 | 0.0384 sd 0.0002 | 180.0 | left x6 | 1.571 x6 |

Cell 1 reproduces the main control (-0.0231 / 0.0153) on this branch. Cells 2
and 3 are identical to each other and both shifted. Cause: the accumulator
path (fixed-timestep stepping), not the contact-window wait. The prior draft
sentence claiming the shift "comes with the contact-window wait" was wrong and
is retracted. Mechanism: the substep exit band fires ~2 walk-relative substeps
later than the legacy frame band, and the clip-driven settling turn steers
chaotically with exit clip phase (1.476 legacy vs 1.517 in-sim), carrying the
slot to a different arrival.

## Handback B: bar-2 mechanism = instrument

In-sim exit probe (`__openClinXrWalkExitProbe`: exit-substep clip time, wait
count, walking-call index; `walkExitWindow.ts`, published at the exit branch;
`walkExitProbe` added to the capture probe; `exitClipS` + in-sim histogram
added to the analyzer): capture/fixed72/jitter all exit at walking
substep 58, clip 1.5171287, waited 0. The sim exits at ONE phase; the rendered
first-settling clipTime (1.571/1.544/1.544) trails it by however many substeps
ran later in the same display frame. Bar 2's "three clip phases" evaporates.

## Handback C: fix attempts failed, window default OFF

- Attempt 1 (legacy-width 1/30 s band, `WALK_EXIT_BAND_SECONDS`): exit moved
  to in-sim 1.490; arrival (-0.0436, +0.0337) — worse on along. The
  phase-to-arrival map is non-monotonic.
- Attempt 2 (band evaluated every 2nd walking substep = legacy cadence):
  exit back at in-sim 1.517; arrival (-0.0301, +0.0384) — unmoved.
- Fallback per contract: exit window default OFF (`walkExitWindow=1` opts in),
  fixed clock default ON. Default-path verify: 6 capture (-0.0301 sd 0.0001 /
  +0.0384 sd 0.0002, left x6, yaw 180.0) + 6 real (-0.0302 sd 0.0000 /
  +0.0383 sd 0.0001, left x6, yaw 180.0). Yaw matches control (180.0);
  the lateral offset stands as a known limit.

## Handback D: bar-5 coverage (measured, not fixed)

Render interpolation covers the slot root transform only
(`fixed-timestep-clock-mod.ts:161-168`: slot position XZ + yaw; bones are
posed by the mixer per substep, uninterpolated). At fixed72, walking frames,
along-route second-difference maxima per run: root rendered 0.0357 in all 6
runs (deterministic interpolation stair-step across 0-substep frames);
left-toe world 0.170-0.184 (raw clip strike dynamics + stance pins sampled
per display frame, ~5x the root). No fix in this handback.

## Handback E: gates

- surface-meter 137->138 recorded with dated comment for the branch's
  `./fixed-timestep-clock` subpath; `bedside-approach-execution-mod.ts`
  kept at exactly 500 lines by moving the band dispatch to
  `stepWalkExitBand` in `walk-exit-window.ts`.
- Rebases onto origin/main b7bef9faa; ADMISSION_GROUPS keeps both
  `walk-symmetry-gate-v1` and `fixed-clock-v1` (apply-map + admission test
  hunks + both admission JSONs present); registry holds both census entries
  (evidence count 180).
- Post-rebase: architecture 291/291, xr-humanoid-animation 119/119,
  xr-runtime-state 97/97.

## Limits

- The lateral arrival offset vs the main legacy exit (+0.023 m) stands, and
  the end stance stays staggered (foot separation ~0.34 m vs main 0.036 m
  side-by-side): fixed clock default OFF, legacy immediate exit default
  everywhere. Both A fix attempts are recorded in handback-2 below.
- Root interpolation stays: at fixed72 it does not worsen planted-foot world
  slide vs legacy (5.03 vs 5.44 mm mean, p95/max equal); rendering the last
  sim state instead worsened root second difference (0.0458 vs 0.0357) for a
  0.6 mm slide gain, so it was reverted. Pose interpolation was declined:
  the defect it would address measures absent.

## Handback-2 A: identical-dt falsifier (measured)

New `fixed60` capture pacing (one rAF per 1/60 step: legacy steps exactly
1/60, the clock runs exactly one substep) plus walk-relative
`walkSimSubsteps` telemetry in the evidence tail. At identical dt the two
paths are the same walk up to a constant: clip-matched route progress offset
+0.0000 m sd 0.0000 across the walk, yaw identical everywhere. The 46 mm
offset from the first falsifier run was a coarse pre-walk/growth jump
artifact (100/500 ms fastForwards running the walk start unrecorded through
multi-substep frames); fine 1/60 pre-walk removed it. No product-code defect
was named by the diff, so none was fixed.

Honest statement, shown: main's arrival is a function of frame rate; the
fixed clock picks one. Legacy arrivals on main's own path (new tool,
fixedClock=0): 1/30 (-0.0147, +0.0121), 1/60 (-0.0356, +0.0367, n=1;
mean -0.0277 sd 0.0139 over n=3 — the forced-dt reference itself is
session-unstable), 1/72 (-0.0428, +0.0343). Fixed-clock arrivals sit inside
that cloud.

Fix attempts (physical-band exit = legacy route position, not compensation):
(1) legacy-width band + even-substep cadence — arrival unmoved (-0.0301,
+0.0384); the cadence provably nullifies the width. (2) legacy-width band,
every substep — exit one frame earlier (clipW 1.49), arrival (-0.0436,
+0.0336): wrong way. Reverted to the narrow band. Foot separation never left
the staggered cluster (0.27-0.35 vs main 0.036; forced-1/60 legacy itself
0.276 sd 0.092, bimodal): the end stance is bistable in exit phase and no
band formulation lands side-by-side. A missed both targets after two
attempts: arrival within 0.01 of the forced-1/60 mean on means (0.0024/0.0054
— met) but foot separation 0.31 from main's (not met).

A verify (current build, default flags): 6 capture (-0.0301 sd 0.0001 /
+0.0384 sd 0.0002, left x6, yaw 180.0, sep +0.346 sd 0.003) + 6 real
(-0.0302 sd 0.0000 / +0.0383 sd 0.0001, left x6, yaw 180.0, sep +0.340
sd 0.005).

## Handback-2 B: root vs pose (measured, baseline kept)

Planted-foot world slide per rendered frame during continuous single support,
fixed72, SC-05: fixed mean 5.03 mm p50 0.00 p95 24.18 max 217.6 (n=749);
legacy mean 5.44 mm p50 0.01 p95 21.92 max 222.8 (n=754). No defect.
Option (1) (render last sim state, 3 runs): slide mean 4.41 p95 24.16
max 216.0; root second difference 0.0458 vs 0.0357 baseline — fails the
bar-5 smoothness bar (source: handback-1 RESULT, 2x capture = 0.0236).
Reverted. Option (2) (interpolate the pose) declined and unbuilt: it would
address a slide defect that measures absent.

## Not tested

- `?fixedClock=0` legacy path; 90/120 Hz pacing; multi-frame stall / MAX_SUBSTEPS cap path (no run exceeded 3 substeps); forced exit after 60 waits; real-time settling in sim seconds; twoBone/ccd loco rows; Quest hardware / presenting / screenshots / video.
