# Walk playback blend (2026-10-12)

The shipped walk looked like a shuffle (swing toe 0.03 m, feet never still in
world) although the bound clip lifts 0.159 m. Cause: the idle take co-ran at
weight 1 beside the walk action at weight 1 and three.js normalised the pair
to a half-amplitude walk. Fix: autoplayed non-locomotion clips lose their
locomotion-owned leg tracks at registration, so only the walk writes the
legs. The clip, the bind, labels, and root advance are untouched.

## Cause

`packages/openclinxr/xr-asset-loading/src/humanoid-animation.ts` autoplayed
every non-deliberate-selection clip (`clipsToPlay`), so the physician mixer
ran `ClinicalIdleConversation` (411 channels, full body) at weight 1 while
`playLocomotionClip`
(`packages/openclinxr/xr-humanoid-animation/src/locomotion-clip-playback-mod.ts:223,325`)
ran the walk at weight 1. Nothing ever fades the idle action (the only
`setEffectiveWeight` calls in the locomotion path target the walk/stop
actions). Stage A measured all three actions running at weight 1 on all 136
walking frames and the tap leg pose equal to the normalised idle+walk blend
to 0.022 deg steady max (walk-only null hypothesis off by up to 39 deg).

## Attribution (Stage 1)

Source: Mesh2Motion `Walk` (`human-base-animations.glb#Walk`, CC0, licence
row `docs/openclinxr/asset-licence-records/row-05-mesh2motion-clip-library-ledger-correction.json`).

| metric | (a) source, native rig | (b) bound, MPFB offline x0.86 | (c) browser mixer pose |
|---|---|---|---|
| swing toe max, m | 0.172 / 0.172 | 0.159 / 0.159 | 0.029 / 0.031 |
| swing ankle max, m | 0.330 / 0.330 | 0.271 / 0.271 | n/m (tap lacked ankles) |
| kinematic duty | 0.57 / 0.57 | 0.62 / 0.52 | 0.571 / 0.549 |
| stance speed med, m/s | 0.786 / 0.786 (unscaled) | 0.661 / 0.676 | 0.564 / 0.559 @rate (0.348 @rate1) |
| stride, m | 0.723 / 0.363 | 0.318 / 0.494 | 0.771 / 0.635 |
| cycle @rate1, s | ~1.667 (1 strike/foot/loop) | ~1.667 | 0.912 / 0.751 |
| hip height mean / standing, m | 0.876 / 0.902 | 0.798 / 0.787 | n/m |
| knee flexion range, deg | 9.2–88.0 | 2.6–76.5 | n/m |
| thigh rotation range, deg | 37.01 / 68.94 (source is lopsided) | 37.01 / 68.94 (identical) | n/m |

Blame: **playback**. The bind preserves rotation ranges to 0.01 deg and 92%
of toe lift. The live mixer halved every leg joint (0.29–0.50x); a 50/50
bind-blend model predicts toe max 0.048 m vs 0.035 m live. Ratios:
joint amplitude 0.29–0.50x, toe lift 0.22x, stance speed 0.52x,
root/stance 2.43x (1.374/0.566).

## Construction (Stage B)

`stripLocomotionLegTracks` in
`packages/openclinxr/xr-asset-loading/src/humanoid-animation.ts`: inside the
autoplay loop, every autoplayed clip except locomotion clips
(`isDeliberateSelectionOnlyClip`) loses the 15 locomotion-owned leg-bone
tracks (upperleg01/02, lowerleg01/02, foot, toe1-1, pelvis L/R, root) in
place, after the seated-admission reads, idempotently, stamped on
`humanoidData["openClinXrAutoplayLegTrackStrip"]`.

Why not complement weights (idle = 1 − walk weight): zeroing idle during the
walk would also mute the idle upper-body/arm sway the posture crossfade and
the arm fix were validated with. The strip keeps idle at weight 1 for the
upper body (arms bit-identical fix vs control) and changes legs only; idle
legs measured bind-static (<=0.04 deg), so standing is preserved (pre-walk
0.000 deg). Untouched: posture ownership blend, 0.4/0.5 s upper-body ramp,
leg-weight ramp and stop fade, stance labels, root advance, clip and bind.

## Bars (Stage C, physician senior_resident_ward_v1, 6 m straight)

Control = origin/main + measurement-only tap (ankle/upper-arm reads, no
writes). Fix = control + the strip.

| bar | control lockOff | fix lockOff | verdict |
|---|---|---|---|
| 1. live/clip amplitude >= 0.95, every leg bone | 0.29–0.50 | 0.95–1.00, statics held | PASS |
| 2. swing toe >= 0.127, ankle >= 0.21 | 0.027/0.029, 0.072/0.073 | 0.155/0.158, 0.217/0.218 | PASS (control fails) |
| 3. standing within 1 deg | — | pre-walk 0.000; arrived footR 21.06 | PARTIAL (limit L3) |
| 4. transition steps <= control+10% | start thigh 17.51, foot 0.157; end foot 0.103 | start thigh 35.01, foot 0.367; end foot 0.160 | FAIL, reported (limits L1/L2) |
| 5. arm steps <= 4.3, hold 13.1±1 | start 4.31/5.70, hold 13.92 | identical bit-for-bit, hold 13.92 | PASS on no-regression; absolute start cap fails on both (vehicle) |
| 6. report: stationary, stance, root, ratio, heel | stat 0/0, stance 0.552 played (0.340 @rate1), root 1.36, ratio 2.46, heel 0.392 | stat 0.47/0.41, stance 1.087 (0.669 @rate1), root 1.36, ratio 1.25, heel 0.125 | reported |

Hold landmarks: trunk axis spine01→neck01, arm shoulder→elbow, arrived
means, rest-chain FK (posture pass writes only upperarm01, verified from tap
posture tags). Arm steps from rendered end-of-frame tap quats.

## Limits (accepted, not fixed here)

- L1 walk-start snap: legs go bind/idle to full clip mid-stride pose in one
  frame (upperleg01R 35.01 deg, foot world step 0.367 m vs control 17.51 deg
  / 0.157 m). Inherent to full-weight-first-frame + a clip whose first key
  is mid-stride; changing it means a ramp (leg-rule change) or a clip
  starting at stand (clip change) — both out of scope. Reported, no limiter.
- L2 walk-end step: fix 0.160 m vs control 0.103 m (both small).
- L3 arrived plant differs: footR 21.06 deg, ankle +25 mm, plant displaced
  18 cm lockOff / 6 cm shipped-lock. Walk itself byte-identical in position
  (div 0.000–0.014); yaw identical; divergence only during settling. The
  clip-driven settling turn takes bigger steps now; the arrival-close was
  tuned on half-amplitude legs. SC-05 (authoritative 1.2 m vehicle): arrival
  error 0.062 fix vs 0.067 control — identical.
- Bar 5 absolute start cap (4.3) fails on both rows (5.70 R): vehicle
  difference vs the arm lane's rig, not a regression (fix≡control exactly).
- SC-05 full-body framing gate fails on fix (toeSpanFraction 0.137 < 0.2
  floor; control 0.278 passes): the fixed camera framing was tuned on
  half-amplitude steps; longer full-amplitude steps widen the auto-frame
  past the floor. Capture/tool tuning, not product behavior.

## SC-05 (foot-plant-video-capture --full-body, shipped lock)

| metric | control | fix |
|---|---|---|
| max slide, m | 0.511 | 0.243 |
| median slide, m | 0.230 | 0.100 |
| arrival error, m | 0.067 | 0.062 |
| stance windows | 3 | 6 |
| max toe step, m | 0.0946 | 0.1265 |

## Renders

Side body-only 0.5x follow-cam 6 m videos from the proving-ground capture
(uncommitted, kept beside the captures):
- `.openclinxr/evidence/loco-ground/lockOff/loco-ground-lockOff-0.5x.mp4` (fix)
- `.openclinxr/evidence/loco-ground/twoBone/loco-ground-twoBone-0.5x.mp4` (fix)
- control worktree `walk-control` equivalents (control)
Garments/hair hidden by the capture's name rule; floor grid on. No
garments-on render (body mesh under hidden garments not graded here).

## Not tested

Stopping-phase labels; settling/arrived metrics beyond the above; other
actors, clips, scenes; 60 fps; worn headsets; the stance-speed/dual-mixer
calibration question (runtime calibration reads 0.845 m/s @rate1 vs 0.669
measured here — different contact/floor definitions, one line per brief);
dual-mixer interplay beyond Stage A; SC-05 stepping-turn (disabled in both
runs); Kimodo or library replacement clips (dropped per directive).
