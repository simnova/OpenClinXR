import {
  applyArrivalStanceClose,
} from "./arrival-stance-close-mod.js";
import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";
import { applyFootFlatten } from "./foot-flatten-mod.js";
import { applySettledPostureCorrection } from "./settled-posture-correction.js";
import {
  restoreSettlingRestToePose,
} from "./settling-step-turn-mod.js";

/**
 * Arrived-phase lock (2026-10-11 close, 2026-10-14 hold): the arrival continuity hold
 * plus the settled posture correction. Split out of `case-owned-approach-frame-mod.ts`
 * to clear that file's 500-line zone budget; behaviour is unchanged, only the module
 * boundary moved — the same pattern `stance-lock-ik.ts`'s own header describes for its
 * own split out of `stance-lock-mod.ts`. Returns true when it owned the frame.
 */
export function applyCaseOwnedArrivedLock(
  approach: CaseOwnedBedsideApproach,
  deltaSeconds?: number,
): boolean {
  if (approach.execution.phase !== "arrived" || approach.execution.drive.locomotion > 0) return false;
  // Arrived: continuity HOLD, then settled correction. The 2026-10-11 gradual close
  // converged toes toward the walk-start rest snapshot; measured 2026-10-14 it glided the
  // feet 0.075 m away from where the turn had already put them on the target (turn end
  // 0.028 m, close done 0.103 m) and re-taking its anchor on a plant-foot role swap
  // jumped the slot 0.196 m on fixed-clock runs. The hold freezes both anchors on the
  // first arrived frame and writes no bone pose, so a swap changes only the pin priority,
  // never the slot. The old snap-restore teleported the trailing toe 0.39 m on the
  // settling→arrived transition and froze a 0.50 m split stance (rest: 0.391 m).
  // It survives below as the no-snapshot fallback only.
  //
  // The settled correction runs on EVERY arrived frame, including while the
  // hold runs (arrived-foot-snap): starving it until close-done let the
  // penetration deepen to a near-full-extension crouch, from which any
  // one-frame lift is a horizontal teleport by lever geometry. Applied
  // differentially each frame, the same solve converges the penetration before the hold
  // yields, so close-done has nothing left to snap. The hold still runs first (it owns
  // toe XZ placement); the correction only trims residual penetration after it.
  let closeActive = false;
  if (approach.restStance !== null) {
    if (!approach.closeState.done) {
      // ## CHANGED (hold) — see `arrival-stance-close-mod.ts`'s own header note. The hold
      // publishes which foot is this frame's pin foot onto `approach.lock`, in the
      // same `labelledStance` shape the walking lock already uses, so SC-05's stop-slide
      // clause can read it instead of the 0.06 m contact band, the same reason the walking
      // clauses already read clip labels rather than the band. Two prior `maxStepMeters`
      // gate attempts were reverted for a different reason (see the arrival-stance-close-mod
      // header); this does not change the hold's own (zero) step sizing, only what SC-05 grades.
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
      // ## CHANGED: once the hold has yielded, both toes are settled and neither is
      // mid-step — publish double support so `stopSlideL/R` grades both, the
      // same as any double-support frame the walking lock already labels this way. Scoped
      // to the `restStance !== null` (real hold) branch only: the legacy no-snapshot
      // fallback below never ran a hold and must leave `approach.lock` untouched — see
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
  // Every arrived frame (arrived-foot-snap): the hold runs first and owns
  // toe XZ placement; the correction trims residual penetration after it,
  // including while the hold runs, so no singular end-state accumulates.
  applySettledPostureCorrection({
    actorSlot: approach.actorSlot,
    leftToe: approach.leftToe,
    rightToe: approach.rightToe,
    floorOriginY: approach.floorOriginY,
    contactBandMeters: approach.contactBandMeters,
  });
  // FOOT-FLATTEN (flat-stance slice): after the hold + correction, rotate each
  // planted foot's ankle so heel-sole and toe both lie on the floor (pitch ->
  // 0 about the slot-lateral axis, pivoting about the toe, knee re-solved by
  // the hinge). Eases in over 0.3 s from the first gated frame, holds after.
  // No-op without leg chains (headless markers) or on airborne feet.
  applyFootFlatten({
    actorSlot: approach.actorSlot,
    deltaSeconds: deltaSeconds ?? 1 / 30,
    floorOriginY: approach.floorOriginY,
  });
  return true;
}
