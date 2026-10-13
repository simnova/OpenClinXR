# Steady-state walk accounting: the 0.51 m slide decomposed (2026-10-11)

Result: MINIMAL FALSIFIER — no straight route ≥ 4.5 m is available tools-only, so steps 2-5
run on the SC-05 control alone. The instrument is built and bar-passing; the missing runtime
hook is named at the end.

## What this slice did

- New instrument `tools/openclinxr/evidence/foot-plant/walk-slide-accounting.ts`: reads the
  production `stanceFoot` labels from `foot-plant-video.json` (no relabelling), decomposes each
  labelled contact into root travel vs body-frame foot motion, drops zero-length episodes with
  a count, flags unlabelled stance, and isolates the steady-state subset (all but first/last
  contact). Contact band is the imported `FOOT_CONTACT_HEIGHT_METERS` (0.06 m); toe height is
  toe world Y minus the walk-minimum toe Y (stated proxy floor; the capture carries no floor
  datum; the heel field rides 6-13 cm in stance and never admits the toe band, so it is not
  used for the band test).
- Unit test `the-walk-slide-accounting.test.ts` (5 tests pass): world-fixed foot gives slide 0
  with prediction 0; body-carried foot gives slide equal to root travel; single-frame label
  runs drop with a count; low fast unlabelled feet flag; carried-while-labelled frames count.
- Ran on the SC-05 control
  (`.openclinxr/evidence/walk-slide/off/foot-plant-video.json`: scene_closure_supine_bedside_v1,
  physician senior_resident_ward_v1, steppingTurn off, ccdStanceLock off, 107 frames, 28
  walking). Output `.openclinxr/evidence/walk-account/sc-05-accounting.json`, summary
  `.openclinxr/evidence/walk-account/report.json`.
- Instrument bar: predictedSlideM within 0.03 m of measuredSlideM on all 3 non-dropped
  contacts (exact to 4 decimals; the prediction telescopes to the measurement by construction
  — the bar checks plumbing, the measurement is the decomposition).

## Per-contact rows (SC-05 control; route 1.20 m, 28 walking frames, 0 full gait cycles)

| foot | frames | measuredSlideM | predictedSlideM | bar | maxToeH (m) | notBack | peakBack (m/s) | steady |
|---|---|---|---|---|---|---|---|---|
| right | 2-5 (4) | 0.2284 | 0.2284 | pass | 0.033 | 3/3 | 0.000 | no (first) |
| left | 6-21 (16) | 0.5108 | 0.5108 | pass | 0.026 | 10/15 | 1.265 | yes |
| right | 22-27 (6) | 0.1003 | 0.1003 | pass | 0.022 | 1/5 | 1.083 | no (last) |

Dropped zero-length episodes: 0. Root advances exactly 0.0453 m every walking frame
(frames 2-27; frame 1 carries the 500 ms capture-probe gap, frame 2 the duplicate landing).

## Steady state (left contact, frames 6-21)

- Root speed 1.374 m/s vs median labelled stance-foot backward speed 0.224 m/s (ratio 6.1;
  steady peak 1.265 m/s still below root). Duty factor 0.46 labelled vs 0.41 kinematic.
  Slide for the contact: 0.511 m.
- Label timing: touchdown 3 frames late (frames 3-5 are stance-kinematic — low and moving
  back at 0.6+ m/s — while still labelled right), liftoff 4 frames late (label holds to
  frame 21, kinematic stance ends at 17). Unlabelled-stance frames: 3,4,5 (left), 6
  (right), 18-21 (right, next touchdown arriving early).
- Slide partition (exact per-frame split of the 0.511 m): 30% on kinematically-valid
  stance frames (root outruns the foot even in true stance), 70% on labelled-but-not-stance
  frames — 43% liftoff tail (frames 18-21) plus 27% mid-stance carry (frames 12-14).

## Conclusions

- Root is faster than the clip's stance foot in steady state (ratio 6.1 against the median
  labelled frame; 1.09 even against the contact's peak backward speed of 1.265 m/s).
- Labels are 3 frames late at touchdown and 4 frames long at liftoff on the steady contact.
- Of the steady-state slide, speed mismatch explains 30% and label length 70% (43% liftoff
  tail, 27% mid-stance carry).

## Why no straight-route capture (falsifier)

`foot-plant-video-capture.ts` only drives frozen plans: scene_closure (route 1.31 m) is the
only plan with a walkerRole; ed_chest_pain has none, so the tool refuses it. The only
tools-only long-walk mechanism is an injected `locomotionOrders` entry via
`order-driven-walker-video-capture.ts` (`--target-offset`), but its evidence global
(`__openClinXrLocomotionOrderEvidence`, published by `publishLocomotionOrderRuntimeEvidence`
in `packages/openclinxr/xr-humanoid-animation/src/locomotion-order-mod.ts`) carries toe XYZ,
stanceFoot and correctionMeters only — no slot/root pose and no toe-height-above-floor, so
rootAdvanceM and maxToeHeightM are uncomputable without a packages/** change. Missing hook:
publish `actorSlot` position/yaw plus per-foot height-above-floor (the same fields
`BedsideApproachRuntimeEvidence` already carries) on every order-driven evidence sample.
That edit belongs to the runtime worker; this slice stops at the interface.

## Not evidence for

Gait realism, clinical plausibility, Quest performance. One 1.3 m control walk, zero
steady-state gait cycles — every number above still describes a start/stop transient pair
around a single mid-walk contact.
