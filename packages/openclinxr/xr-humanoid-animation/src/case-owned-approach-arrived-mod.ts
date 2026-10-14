import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";
import {
  applyArrivalStanceClose,
} from "./arrival-stance-close-mod.js";
import {
  restoreSettlingRestToePose,
} from "./settling-step-turn-mod.js";
import { applySettledPostureCorrection } from "./settled-posture-correction.js";

/**
 * Arrived-phase lock (2026-10-11): the gradual arrival close plus the settled posture
 * correction. Split out of `case-owned-approach-frame-mod.ts` to clear that file's
 * 500-line zone budget; behaviour is unchanged, only the module boundary moved — the
 * same pattern `stance-lock-ik.ts`'s own header describes for its own split out of
 * `stance-lock-mod.ts`. Returns true when it owned the frame (caller returns).
 */
export function applyCaseOwnedArrivedLock(approach: CaseOwnedBedsideApproach): boolean {
  if (approach.execution.phase !== "arrived" || approach.execution.drive.locomotion > 0) return false;
  // Arrived: gradual close toward the walk-start rest snapshot, then settled
  // correction. The old snap-restore teleported the trailing toe 0.39 m on the
  // settling→arrived transition and froze a 0.50 m split stance (rest: 0.391 m).
  // It survives below as the no-snapshot fallback only.
  //
  // The settled correction runs on EVERY arrived frame, including while the
  // close runs (arrived-foot-snap): starving it until close-done let the
  // penetration deepen to a near-full-extension crouch, from which any
  // one-frame lift is a horizontal teleport by lever geometry. Applied
  // differentially each frame from the close's bent mid-glide poses, the same
  // solve converges the penetration before the close yields, so close-done
  // has nothing left to snap. The close still owns toe placement (it runs
  // first); the correction only trims residual penetration after it.
  let closeActive = false;
  if (approach.restStance !== null) {
    if (!approach.closeState.done) {
      // ## CHANGED — see `arrival-stance-close-mod.ts`'s own header note. The close now
      // publishes which foot is this frame's PLANT vs its SWING onto `approach.lock`, in the
      // same `labelledStance` shape the walking lock already uses, so SC-05's stop-slide clause
      // can read it instead of the 0.06 m contact band — a closing step's swing foot passes
      // below that band while it glides beside the plant, the same reason the walking clauses
      // already read clip labels rather than the band. Two prior `maxStepMeters` gate attempts
      // were reverted here for a different reason (see the arrival-stance-close-mod header); this
      // does not change the close's own step sizing, only what SC-05 grades.
      const closed = applyArrivalStanceClose({
        actorSlot: approach.actorSlot,
        leftToe: approach.leftToe,
        rightToe: approach.rightToe,
        snapshot: approach.restStance,
        state: approach.closeState,
      });
      approach.closeState = closed.state;
      closeActive = !closed.state.done;
      if (closed.state.plantFoot !== null) {
        approach.lock = {
          ...approach.lock,
          stanceFoot: closed.state.plantFoot,
          doubleSupport: false,
          labelledStance: {
            left: closed.state.plantFoot === "left",
            right: closed.state.plantFoot === "right",
          },
        };
      }
    }
    if (!closeActive) {
      // ## CHANGED: once the close has yielded, both toes are settled and neither is a
      // swing foot mid-step — publish double support so `stopSlideL/R` grades both, the
      // same as any double-support frame the walking lock already labels this way. Scoped
      // to the `restStance !== null` (real close) branch only: the legacy no-snapshot
      // fallback below never ran a close and must leave `approach.lock` untouched — see
      // `the-arrived-stance-closes.test.ts`'s clause (1), which pins that fact by identity.
      approach.lock = {
        ...approach.lock,
        stanceFoot: null,
        doubleSupport: true,
        labelledStance: { left: true, right: true },
      };
    }
  } else if (approach.turnStep.restLocal !== null) {
    approach.turnStep = restoreSettlingRestToePose({
      leftToe: approach.leftToe,
      rightToe: approach.rightToe,
      state: approach.turnStep,
      contactBandMeters: approach.contactBandMeters,
    });
    approach.actorSlot.updateMatrixWorld(true);
  }
  // Every arrived frame (arrived-foot-snap): the close runs first and owns
  // toe placement; the correction trims residual penetration after it. While
  // the close runs it is gated to the close's plant foot: the swing foot is
  // mid-glide (tens of mm/frame by design, near-full leg extension) and
  // bending its leg to lift it mid-glide fights the close. After the close
  // yields both feet are settled and the lower one is corrected.
  applySettledPostureCorrection({
    actorSlot: approach.actorSlot,
    leftToe: approach.leftToe,
    rightToe: approach.rightToe,
    floorOriginY: approach.floorOriginY,
    contactBandMeters: approach.contactBandMeters,
    ...(closeActive ? { onlyFoot: approach.closeState.plantFoot } : {}),
  });
  return true;
}
