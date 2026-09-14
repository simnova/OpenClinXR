# Settled Branch Execution Report

**Card**: tsk_4c0f66ebb0453372 — observe whether the settled correction executes at all
**Date**: 2026-09-14
**Method**: node harness driving the production executor (`stepBedsideApproachExecution`) and the
production stance lock (`applyCaseOwnedStanceLock`) over the production gait probe (the 1.2 s clip
built at `apps/ui-xr/src/the-normal-encounter-physician-approaches-and-stops.test.ts:317`), same
frame order as `main.ts` (drive, then pose, then lock). No behaviour changed; no threshold changed;
no `actorSlot.position.y` write; the locomotion gate at
`case-owned-approach-runtime-mod.ts:487` is untouched.
**Test**: `tools/openclinxr/evidence/settled-execution-observation/the-settled-branch-execution-is-observed.test.ts`

## Run reaching arrived (206 frames: walking, settling, arrived; 120 arrived frames observed)

| measure | value |
|---|---|
| frames on which the :477-shaped branch executed (`arrived` + `locomotion <= 0` + `:474` did not return early) | **119 of 120 arrived frames** |
| arrived frames where `restLocal` was null (`:474` block skipped, `:477` reached directly) | 118 |
| arrived frames where `restLocal` was non-null and `closing` was true (`:474` returned early, `:477` skipped) | **1** |
| frames where `applySettledPostureCorrection` reported `corrected:true` | **1** (the first branch frame, index 86) |
| stance toe world Y immediately before correction, first branch frame | **-0.00791 m** (7.9 mm below the floor) |
| stance toe world Y immediately after correction, first branch frame | **0.04762 m** |
| same toe world Y at capture-sample time, first branch frame | **0.19190 m** — the sample is taken from the OTHER toe (the min of the two): the correction lifted the left stance toe while the right swing toe was mid-arc; the track minimum is the uncorrected foot, not the corrected one |
| stance toe world Y after correction, subsequent 118 branch frames | **0.04762 m**, unchanged frame to frame |
| same toe world Y at capture-sample time, last branch frame | **0.04762 m** (identical: nothing moved it between correction and sample) |
| `corrected:false` reason on frames 2..119 | toe already above floor (`toeWorld.y >= floorOriginY` at `stance-lock-mod.ts:431`), so the function returns before the IK solve |

## What this answers

**Whether :477 executes is resolved: it executes on 119 of 120 arrived frames.** The
`turnStep.restLocal is non-null and closing is true` gate the card suspected fires on exactly one
arrived frame. The branch is not the defect — it runs, and the one frame it skips is the single
frame the rest-restore path owns.

**Why the SC-05 number never moved is now measured, and it is neither candidate the card left
open.** The correction DID run and DID lift the toe (-0.00791 m -> 0.04762 m on the one frame that
needed it). Two facts then compound:

1. The correction is sticky in the wrong direction: it rewrites hip/knee quaternions that persist
   across frames with no mixer in this harness to re-drive them, so after frame 86 the toe sits at
   0.04762 m for 118 frames and `corrected` reports false — there is nothing left to correct.
   In the browser the mixer re-drives those bones every frame (the card's mixer hypothesis), which
   is the difference between this harness and the runtime, stated rather than bridged.
2. The capture samples the track minimum across BOTH toes, so on the one frame the correction
   mattered the published sample (0.19190 m) came from the swinging foot, not the corrected stance
   foot. A per-toe correction graded through a min-of-both-toes sampler is observed through the
   wrong foot on every frame exactly one foot is airborne — which, in a rest pose held for two
   seconds, is every frame the rest pose holds one toe higher than the other.

The SC-05 defect (settling 0.0376 m, arrived 0.0350 m against 0.005 m) is a both-feet-below-floor
pose error at rest. A correction that fires only when a toe is below the floor, and whose effect
is then read through the lower of the two toes, cannot move a both-feet pose error by construction:
each frame it lifts at most the lower toe, and the sampler keeps reporting whichever toe is lower.
The three inert fixes share this shape — all three passed every proof because the proofs assert the
correction in isolation (`corrected:true`, toe lifted) while the runtime grades the min of both
tracks.

## Honest limits

- This harness poses toes by direct local writes, not through an `AnimationMixer`, so the
  mixer-overwrites-the-correction half of the card's question is NOT observed here — only the
  branch-execution half is. The gap the card asked to measure (toe Y after correction vs at sample
  time) is 0.00000 m on 118 of 119 frames in this harness, which says the harness has no mixer,
  not that the runtime has no overwrite.
- The rest pose in this run is synthetic (both toes written 0.60 m below their walk height each
  settled frame so the correction has something to correct). The shipped rest frame and the SC-05
  floor datum live in the browser capture this card deliberately did not re-run; the frame count
  (119/120) is about control flow, which is rig-independent, while the toe heights are about this
  rig, which is not the shipped one.
- The capture publishes no telemetry in roughly half its runs; this node run publishes every frame
  by construction, so it answers the discriminator without answering the browser's flakiness.

## Not tested

Whether the mixer at `animation-loop.ts:113` overwrites the corrected hip/knee quaternions before
the capture samples them in a real browser run; the stance toe world Y at sample time in that run;
anything about the shipped GLB clip, gait realism, or Quest behaviour.
