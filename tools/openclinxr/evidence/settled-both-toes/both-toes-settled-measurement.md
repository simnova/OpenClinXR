# Both-Toes Settled Measurement

**Card**: tsk_7a70fe19156af6a8 — the stance lock corrects one named toe while the rubric grades the deeper of both
**Date**: 2026-09-14
**Method**: production `runApproach` over the SHIPPED physician GLB
(`apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb`) and shipped walk clip
(`openclinxr_retarget_walk_formal_cc0`), driven through the production executor and stance lock
with `applySettledPostureCorrection` running in its production call sites. No source changed before
this measurement; no threshold changed; no `actorSlot.position.y` write.
**Test**: `tools/openclinxr/evidence/settled-both-toes/the-both-toes-are-below-the-floor.test.ts`

## Run shape (12 s at 60 Hz: walking, settling, arrived)

| measure | value |
|---|---|
| floor datum (`floorOriginY`) | -0.000000001 m (effectively 0) |
| settled frames | 101 |
| arrived frames | 432 |
| settled frames with left toe below floor | 0 |
| settled frames with right toe below floor | 0 |
| arrived frames with left toe below floor | 0 |
| arrived frames with right toe below floor | 0 |
| settled frames over the 0.005 m limit (either toe) | 0 |
| arrived frames over the 0.005 m limit (either toe) | 0 |
| deepest sample, settled (both toes) | -0.013571 m (0.0136 m ABOVE the floor) |
| deepest sample, arrived (both toes) | -0.013571 m (0.0136 m ABOVE the floor) |
| rubric `floor-penetration`, settled interval | satisfied, observed 0 |
| rubric `floor-penetration`, arrived interval | satisfied, observed 0 |

Per-frame signed heights: both toes hold ~0.0136 m above the floor across all 101 settled and all
432 arrived frames. The pinned per-frame extremes are identical on both toes (the rest frame is
symmetric: `restLeft` (0.0959, 0.0158, 0.0345), `restRight` (-0.0959, 0.0158, 0.0345) in body frame),
so rubric attribution of "the deeper toe" is a tie broken by comparison order (`toe1-1.R`
reported); with zero below-floor samples the attribution names no violator.

## What this answers

**THE PREMISE OF THIS CARD IS FALSE on the current tree: neither toe is ever below the floor
across the settled and arrived phases of the shipped capture, so there is no second submerged toe
for a per-toe correction to miss.** The card directs exactly this outcome: "say so in that
measurement, stop, and do not write a fix. That is a complete and successful outcome for this
card." No source file was edited; the `claimScope` line and the behaviour already agree that a
correction with nothing to correct does nothing.

The card's cited figures (settling 0.037578 m, arrived 0.035024 m) do not reproduce through the
node `runApproach` harness on this tree. Recorded candidates for where they come from, in order:

1. The BROWSER capture path (`ui-xr-bedside-approach-capture.ts:487-500`), which samples
   `station-bedside-approach-mod.ts` telemetry off the LOADED skeleton after the mixer and the
   lock — a different pose source from this node harness, which poses decoded clip bytes
   directly. The retained report text names a browser `floor-penetration` failure at 0.01430 m
   against 0.005 m, which is also not 0.0376 m, so even the browser number on record is a
   different figure from the card's.
2. A stale phase label: the card's "settling" may name the terminal-turn interval (settling +
   turn), where the shipped clip set contains no turn-in-place take and a planted toe drags.
   That interval's defect was measured and fixed separately (terminal-turn replant,
   `settling-step-turn-mod.ts`), and the stopped intervals measured here are clean.
3. The three prior fixes themselves: the breathing rigid-bob removal
   (`animation-loop.ts`, toes ~14 mm under for the whole settled period) and the rest-frame
   settle (`playLocomotionClip` settling on the clip rest frame instead of a mid-stride pose)
   both landed before this measurement and both move exactly the stopped-pose number the card
   says never moved.

Whichever source is right, the consequence for this card is the same: the shipped-capture
stopped pose measured here is above the floor on both feet, the rubric agrees, and extending
the correction to a second toe would change no graded sample.

## Honest limits

- This is the NODE harness (`runApproach`), not the browser: toes are decoded clip bytes posed
  directly, with no `AnimationMixer` re-driving bones and no loaded GLB skin. A correction that
  is unneeded in node may still be needed — or be overwritten — in the browser; the mixer half
  (`animation-loop.ts:113`) is explicitly not observed here.
- The browser capture publishes no telemetry in roughly half its runs; this node run publishes
  every frame by construction.
- No pixel grade was taken of any pose.

## Not tested

Whether the browser capture still reports a submerged foot on the shipped bytes, and if so on
which toe and in which phase. Whether correcting both legs simultaneously is kinematically
consistent with a pinned root. Whether the SC-05 capture's floor datum is itself correct.
