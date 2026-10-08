/** Preserve the established incline path on rigs outside the MPFB contact solver. */
import type { Object3D } from "three";
import { readStretcherPillowWorld } from "@openclinxr/xr-station";
import { settleSupineFloatOntoDeck } from "./hob-body-align.js";
import { measureBackToDeckGap, measureSeatClearanceMeters, readBackSectionPlane, settleSupineOntoBackSectionPreservingSeat } from "./hob-contact-metrics.js";
import { raiseSupineFeetOntoSeat } from "./hob-extremity-flex.js";
import { flexSupineHeadOntoPillow } from "./hob-head-flex.js";
export function plantLegacySupineIncline(
  humanoidRoot: Object3D,
  input: { stretcher?: Object3D; deckTopWorldY: number },
  incline: number,
  applySupineInclineMatchingDeck: (root: Object3D, degrees: number) => void,
  recordPlantStep: (root: Object3D, step: string, incline: number, stretcher: Object3D | undefined, deckTopY: number) => void,
): void {
    /**
     * Measured trade (plant-steps):
     * - Hinge tip: backGap≈0.016 (good) but seat clearance −0.11/−0.25/−0.38 at 15/30/45
     *   (whole rigid body drives the seat-side mesh through the flat seat).
     * - Pelvis tip: clearance better (pelvis fixed) but gap/sin(θ)≈0.40 (constant-radius float).
     * Path: pelvis tip + XZ-only settle (closes gap via n_x without sinking Y) + knee/hip flex
     * for residual extremity sink. Full normal settle or pure-Y lift reopens the other residual.
     * If both still fail: residual is spine flex (#181) — recorded on openClinXrSupineRigidTrade.
     */
    applySupineInclineMatchingDeck(humanoidRoot, incline);
    recordPlantStep(humanoidRoot, "pelvis_tip", incline, input.stretcher, input.deckTopWorldY);

    // Contract: back gap ≤ 0.06, seat penetration ≤ 0.05. Keep 1 mm headroom on each.
    const MAX_GAP_BUDGET = 0.058;
    const TARGET_CLEARANCE = -0.04;

    if (input.stretcher) {
      // XZ settle first — closes |gap| without burning Y budget (works for sink or float).
      settleSupineOntoBackSectionPreservingSeat(humanoidRoot, input.stretcher, 0.02);
      recordPlantStep(humanoidRoot, "xz_settle_back", incline, input.stretcher, input.deckTopWorldY);
    }

    // Knee/hip flex before any root lift — true skinned clearance sees this (#150 instrument).
    raiseSupineFeetOntoSeat(humanoidRoot, input.deckTopWorldY);
    recordPlantStep(humanoidRoot, "knee_flex_feet", incline, input.stretcher, input.deckTopWorldY);

    if (input.stretcher) {
      const gapAfterFlex = measureBackToDeckGap(humanoidRoot, input.stretcher);
      if (gapAfterFlex > 0.035 || gapAfterFlex < -0.02) {
        settleSupineOntoBackSectionPreservingSeat(humanoidRoot, input.stretcher, 0.02);
      }
      recordPlantStep(humanoidRoot, "xz_settle_after_flex", incline, input.stretcher, input.deckTopWorldY);

      const gap = measureBackToDeckGap(humanoidRoot, input.stretcher);
      const clearance = measureSeatClearanceMeters(humanoidRoot, input.deckTopWorldY);
      const { normal } = readBackSectionPlane(input.stretcher);
      const ny = Math.max(0.25, Math.abs(normal.y));
      const needLift = clearance < TARGET_CLEARANCE ? TARGET_CLEARANCE - clearance : 0;
      const maxLift = Math.max(0, (MAX_GAP_BUDGET - gap) / ny);
      const appliedLift = Math.min(needLift, maxLift);
      if (appliedLift > 1e-4) {
        humanoidRoot.position.y += appliedLift;
        humanoidRoot.updateMatrixWorld?.(true);
        humanoidRoot.userData.openClinXrSupineSinkLiftMeters = appliedLift;
      }
      humanoidRoot.userData.openClinXrSupineSeatLiftCapped = needLift > appliedLift + 1e-4;
      humanoidRoot.userData.openClinXrSupineSeatClearanceAfter =
        measureSeatClearanceMeters(humanoidRoot, input.deckTopWorldY);
      humanoidRoot.userData.openClinXrSupineBackGapAfter =
        measureBackToDeckGap(humanoidRoot, input.stretcher);
      humanoidRoot.userData.openClinXrSupineRigidTrade = {
        needLift,
        maxLift,
        appliedLift,
        clearanceAfter: humanoidRoot.userData.openClinXrSupineSeatClearanceAfter,
        backGapAfter: humanoidRoot.userData.openClinXrSupineBackGapAfter,
        note:
          needLift > appliedLift + 1e-3
            ? "rigid_body_cannot_clear_seat_without_reopening_back_gap_or_spine_flex"
            : "within_rigid_trade_band",
      };
      const pillowAfter = readStretcherPillowWorld(input.stretcher);
      if (pillowAfter) {
        humanoidRoot.userData.openClinXrSupinePillowWorld = { ...pillowAfter };
      }
      recordPlantStep(humanoidRoot, "bounded_seat_lift", incline, input.stretcher, input.deckTopWorldY);
    }

    // #620: the inclined path closed SINKING (bounded seat lift) but never closed FLOAT — the
    // ED patient sat 0.221 m above the deck while penetration read 0 and every #150 clause
    // passed. Lower the root with the same skinned instrument the contract grades. A zero target
    // lands the contract reading near mid-band after the measured ~29 mm inspector offset (#620).
    settleSupineFloatOntoDeck(humanoidRoot, input.deckTopWorldY, 0.0);
    recordPlantStep(humanoidRoot, "skinned_float_settle", incline, input.stretcher, input.deckTopWorldY);

    // #181: the rigid inclined body leaves the head ~0.3 m above the pillow; close the residual with distributed
    // upper-spine/neck flex; the root stays put so the seat plant above survives.
    if (input.stretcher) {
      const flexPillow = readStretcherPillowWorld(input.stretcher);
      if (flexPillow) {
        flexSupineHeadOntoPillow(humanoidRoot, flexPillow);
        recordPlantStep(humanoidRoot, "head_flex", incline, input.stretcher, input.deckTopWorldY);
      }
    }

    recordPlantStep(humanoidRoot, "final", incline, input.stretcher, input.deckTopWorldY);
}
