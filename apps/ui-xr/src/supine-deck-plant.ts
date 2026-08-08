/**
 * Supine deck plant + HOB incline follow (#150/#153/#159/#171).
 *
 * Extracted from supine-pose.ts so the bone map file stays under the zone budget.
 * Pose bones stay in supine-pose.ts; this owns plant, tip, head-align, lift.
 */

import { Quaternion, Vector3, type Object3D } from "three";
import {
  DEFAULT_STRETCHER_POSITION,
} from "@openclinxr/asset-registry";
import {
  STRETCHER_LENGTH_METERS,
  readStretcherBackSectionWorldDeg,
  readStretcherInclineDegrees,
  readStretcherPillowWorld,
} from "./station-stretcher.js";
import {
  measureBackToDeckGap,
  measureHeadPillowGapMeters,
  measurePelvisOnSeat,
  measureSeatClearanceMeters,
  readBackSectionPlane,
  settleSupineOntoBackSectionPreservingSeat,
} from "./hob-contact-metrics.js";
import {
  raiseSupineFeetOntoSeat,
  reapplyStoredSupineFootFlex,
} from "./hob-extremity-flex.js";
import { applySupinePose, type ApplySupinePoseResult } from "./supine-pose.js";
import {
  alignSupineHeadToPillow,
  liftSupineBodyAboveDeck,
  centerSupineBodyOnDeck,
} from "./hob-body-align.js";

export type PlantStepMetrics = {
  step: string;
  inclineDeg: number;
  backToDeckGapMeters: number | null;
  pelvisOnSeatSection: boolean | null;
  seatClearanceMeters: number | null;
  headPillow: { dist: number; dx: number; dy: number; dz: number } | null;
};

function recordPlantStep(
  humanoidRoot: Object3D,
  step: string,
  inclineDeg: number,
  stretcher: Object3D | undefined,
  deckTopY: number,
): PlantStepMetrics {
  const pillow = stretcher ? readStretcherPillowWorld(stretcher) : null;
  const metrics: PlantStepMetrics = {
    step,
    inclineDeg,
    backToDeckGapMeters: stretcher ? measureBackToDeckGap(humanoidRoot, stretcher) : null,
    pelvisOnSeatSection: measurePelvisOnSeat(humanoidRoot, deckTopY),
    seatClearanceMeters: measureSeatClearanceMeters(humanoidRoot, deckTopY),
    headPillow: measureHeadPillowGapMeters(humanoidRoot, pillow),
  };
  const steps = (humanoidRoot.userData.openClinXrPlantSteps as PlantStepMetrics[] | undefined) ?? [];
  steps.push(metrics);
  humanoidRoot.userData.openClinXrPlantSteps = steps;
  return metrics;
}

/**
 * Per-frame: re-apply flat on-back basis then restore the register tip quaternion (#171 seam 3).
 * Prefer the stored register quat (hinge tip) over re-deriving a rotation-only tip — the latter
 * did not match hinge-about-point plant and left head ~0.3 m above the pillow in Y.
 * Re-apply plant-time knee/hip flex after pose — applySupinePose resets SUPINE_BONE_EULERS
 * and would otherwise wipe extremity clearance every frame (full-room ED −0.11 vs lab green).
 * `holdSupinePlantFrame` owns base XYZ; then reapply pillow XZ.
 */
export function applySupinePoseHoldingIncline(humanoidRoot: Object3D): ApplySupinePoseResult {
  const result = applySupinePose(humanoidRoot);
  reapplyStoredSupineFootFlex(humanoidRoot);
  const stored = humanoidRoot.userData?.openClinXrSupineRootQuat as
    | { x: number; y: number; z: number; w: number }
    | undefined;
  if (
    stored
    && Number.isFinite(stored.x)
    && Number.isFinite(stored.y)
    && Number.isFinite(stored.z)
    && Number.isFinite(stored.w)
  ) {
    humanoidRoot.quaternion.set(stored.x, stored.y, stored.z, stored.w);
    humanoidRoot.rotation.setFromQuaternion(humanoidRoot.quaternion, humanoidRoot.rotation.order);
    return result;
  }
  const raw = humanoidRoot.userData?.openClinXrSupineInclineDegrees;
  const incline = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  if (Math.abs(incline) >= 1e-3) {
    applySupineInclineRotationOnly(humanoidRoot, incline);
  }
  return result;
}

/** After hold restores base XYZ, re-apply head→pillow XZ only (no Y — Y sink undoes seat plant). */
export function reapplySupineHeadToStoredPillow(humanoidRoot: Object3D): void {
  const p = humanoidRoot.userData?.openClinXrSupinePillowWorld as
    | { x?: number; y?: number; z?: number }
    | undefined;
  if (!p || typeof p.x !== "number" || typeof p.z !== "number") return;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
  alignSupineHeadToPillow(humanoidRoot, { x: p.x, z: p.z });
}

/** World-Z tip without pelvis translation — for per-frame hold that owns position. */
export function applySupineInclineRotationOnly(
  humanoidRoot: Object3D,
  inclineDegrees: number,
): void {
  if (!Number.isFinite(inclineDegrees) || Math.abs(inclineDegrees) < 1e-6) {
    humanoidRoot.userData.openClinXrSupineInclineDegrees = 0;
    return;
  }
  const rad = (-inclineDegrees * Math.PI) / 180;
  const worldTip = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rad);
  humanoidRoot.quaternion.premultiply(worldTip);
  humanoidRoot.rotation.setFromQuaternion(humanoidRoot.quaternion, humanoidRoot.rotation.order);
  humanoidRoot.userData.openClinXrSupineInclineDegrees = inclineDegrees;
  humanoidRoot.userData.openClinXrSupineInclineSource = "deck_leads_body_follows_world_z_rotation_only";
}

/**
 * Contact-bone filter. Flat supine plants all torso contacts; inclined plants
 * pelvis/seat only so a re-plant cannot drag the raised back into the seat.
 */
export type SupinePlantContactMode = "all_torso" | "pelvis_seat";

/**
 * Shift the humanoid root so the torso rests on the deck top.
 *
 * After the on-back root basis, contact bones (pelvis/spine/chest) sit above the
 * deck plane. Plant those bones onto deckTop + torso half-thickness.
 * Unskinned mesh matrixWorld alone under-reads minY and left the figure floating
 * ~0.14 m (post-fix smoke). Does NOT use seatedVerticalOffsetForSeatHeight.
 *
 * deckTopWorldY — mattress top in world space (procedural stretcher seat: 0.55).
 * torsoHalfThickness — contact-bone height above deck. Calibrated on ed cast:
 * skinned minY sits ~0.25 m below pelvis/spine after Z reorientation, so the
 * bone plant target must be high enough that skinned clearanceAboveDeck ≥ 0.
 *
 * #159: when inclineDeg > 0, use contactMode "pelvis_seat" — hinge the mattress
 * without this and a flat re-plant crumples the body into the seat (or leaves the
 * back floating against air). That is the #67/#156 class.
 */
export function plantSupineBodyOnDeck(
  humanoidRoot: Object3D,
  deckTopWorldY: number,
  /**
   * Target: contact bones sit this far above deck top.
   * Default 0.26 → skinned minY near deck top on ed_chest_pain adult cast (smoke).
   */
  torsoHalfThickness = 0.26,
  options?: { contactMode?: SupinePlantContactMode },
): { deltaY: number; bodyMinYBefore: number | null } {
  const mode: SupinePlantContactMode = options?.contactMode ?? "all_torso";
  const CONTACT_BONE =
    mode === "pelvis_seat"
      ? /^(pelvis|hips|thigh)/i
      : /^(pelvis|hips|spine|chest|spine\d*|thigh)/i;

  const readContactY = (): number | null => {
    humanoidRoot.updateMatrixWorld?.(true);
    // Refresh skinned skeletons so bone matrixWorld is current.
    humanoidRoot.traverse((object) => {
      const skinned = object as Object3D & {
        isSkinnedMesh?: boolean;
        skeleton?: { update?: () => void };
      };
      if (skinned.isSkinnedMesh) skinned.skeleton?.update?.();
    });

    let minContact: number | null = null;
    const consider = (object: Object3D) => {
      const name = object.name ?? "";
      if (!CONTACT_BONE.test(name)) return;
      const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
        || (object as Object3D & { type?: string }).type === "Bone";
      if (!isBone) return;
      object.updateWorldMatrix?.(true, false);
      const wy = object.matrixWorld.elements[13] ?? 0;
      if (minContact === null || wy < minContact) minContact = wy;
    };

    humanoidRoot.traverse(consider);
    humanoidRoot.traverse((object) => {
      const skinned = object as Object3D & {
        isSkinnedMesh?: boolean;
        skeleton?: { bones: Object3D[] };
      };
      if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
      for (const bone of skinned.skeleton.bones) consider(bone);
    });
    return minContact;
  };

  const bodyMinYBefore = readContactY();
  if (bodyMinYBefore === null) return { deltaY: 0, bodyMinYBefore: null };

  // Flat scalar plant for the seat surface. Inclined back surface contact is
  // owned by applySupineInclineMatchingDeck (body follows live back plane).
  const targetContactY = deckTopWorldY + torsoHalfThickness;
  let totalDelta = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    const current = readContactY();
    if (current === null) break;
    const deltaY = targetContactY - current;
    if (Math.abs(deltaY) < 1e-4) break;
    humanoidRoot.position.y += deltaY;
    totalDelta += deltaY;
    humanoidRoot.updateMatrixWorld?.(true);
  }
  return { deltaY: totalDelta, bodyMinYBefore };
}

function readPelvisWorld(humanoid: Object3D): Vector3 | null {
  humanoid.updateMatrixWorld?.(true);
  let found: Vector3 | null = null;
  const consider = (object: Object3D) => {
    if (found) return;
    if (!/^(pelvis|hips)$/i.test(object.name ?? "")) return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone) return;
    object.updateWorldMatrix?.(true, false);
    found = new Vector3().setFromMatrixPosition(object.matrixWorld);
  };
  humanoid.traverse(consider);
  humanoid.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    skinned.skeleton.update?.();
    for (const bone of skinned.skeleton.bones) consider(bone);
  });
  return found;
}

/**
 * Tip the recumbent body so the torso follows the deck incline.
 * After on-back basis, head ≈ −X; a **world** R_z(−θ) lifts head toward +Y.
 *
 * When `hingeWorld` is provided (stretcher HOB hip line on the deck top), the root
 * position is rotated about that point so the seat-side (feet) stays on the flat
 * seat plane — matching the mattress hinge. Pelvis-only tip dropped feet ~9 cm
 * and mesh min ~19 cm below deck (issue-171/below-deck-vertices.json).
 *
 * Incline comes from the stretcher (deck leads). Do not invent a second body angle.
 */
export function applySupineInclineMatchingDeck(
  humanoidRoot: Object3D,
  inclineDegrees: number,
  hingeWorld?: { x: number; y: number; z: number },
): void {
  if (!Number.isFinite(inclineDegrees) || Math.abs(inclineDegrees) < 1e-6) {
    humanoidRoot.userData.openClinXrSupineInclineDegrees = 0;
    return;
  }
  const rad = (-inclineDegrees * Math.PI) / 180;
  const worldTip = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rad);

  if (hingeWorld) {
    // Rotate root position about the mattress hinge, then apply the same orientation tip.
    const hx = hingeWorld.x;
    const hy = hingeWorld.y;
    const hz = hingeWorld.z;
    const px = humanoidRoot.position.x - hx;
    const py = humanoidRoot.position.y - hy;
    const pz = humanoidRoot.position.z - hz;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    humanoidRoot.position.set(hx + (px * c - py * s), hy + (px * s + py * c), hz + pz);
    humanoidRoot.quaternion.premultiply(worldTip);
    humanoidRoot.rotation.setFromQuaternion(humanoidRoot.quaternion, humanoidRoot.rotation.order);
    humanoidRoot.updateMatrixWorld?.(true);
    humanoidRoot.userData.openClinXrSupineInclineSource = "deck_leads_body_follows_hob_hinge";
  } else {
    // Harness / no stretcher: tip about pelvis (pre-#171 behaviour).
    const before = readPelvisWorld(humanoidRoot);
    humanoidRoot.quaternion.premultiply(worldTip);
    humanoidRoot.rotation.setFromQuaternion(humanoidRoot.quaternion, humanoidRoot.rotation.order);
    humanoidRoot.updateMatrixWorld?.(true);
    const after = readPelvisWorld(humanoidRoot);
    if (before && after) {
      humanoidRoot.position.x += before.x - after.x;
      humanoidRoot.position.y += before.y - after.y;
      humanoidRoot.position.z += before.z - after.z;
      humanoidRoot.updateMatrixWorld?.(true);
    }
    humanoidRoot.userData.openClinXrSupineInclineSource = "deck_leads_body_follows_world_z";
  }
  humanoidRoot.userData.openClinXrSupineInclineDegrees = inclineDegrees;
}

/**
 * World-space torso axis angle from horizontal (degrees), from pelvis→chest/spine.
 * Bind-relative eulers lie after root reorientation — measure world only (#153/#159).
 */
export function readSupineTorsoWorldDeg(humanoidRoot: Object3D): number {
  humanoidRoot.updateMatrixWorld?.(true);
  const points = new Map<string, Vector3>();
  const consider = (object: Object3D) => {
    const name = (object.name ?? "").toLowerCase();
    if (!/^(pelvis|hips|spine|chest)$/i.test(name)) return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone) return;
    object.updateWorldMatrix?.(true, false);
    const key = name.startsWith("hip") ? "pelvis" : name.startsWith("spine") ? "spine" : name;
    if (!points.has(key)) points.set(key, new Vector3().setFromMatrixPosition(object.matrixWorld));
  };
  humanoidRoot.traverse(consider);
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    skinned.skeleton.update?.();
    for (const bone of skinned.skeleton.bones) consider(bone);
  });
  const pelvis = points.get("pelvis") ?? points.get("hips");
  const upper = points.get("chest") ?? points.get("spine");
  if (!pelvis || !upper) return 0;
  const dx = upper.x - pelvis.x;
  const dy = upper.y - pelvis.y;
  // Head is −X when flat; incline raises dy. Angle from horizontal:
  return (Math.atan2(dy, Math.abs(dx) < 1e-6 ? 1e-6 : -dx) * 180) / Math.PI;
}

/**
 * One-shot: pose + plant Y + center XZ + re-plant (used at humanoid register).
 * Keeps main.ts under the shrink-only freeze ceiling.
 *
 * #159: optional stretcher — live-query incline (deck leads). 0° path is byte-identical
 * in behaviour to pre-#159 flat supine (same plant mode, no body tip).
 */
export function applyAndPlantSupineOnDeck(
  humanoidRoot: Object3D,
  input: {
    deckTopWorldY: number;
    deckCenter: { x: number; z: number };
    /** World X of the pillow rest point (default: deck center X − 0.95 stretcher local). */
    pillowWorldX?: number;
    torsoHalfThickness?: number;
    /**
     * Procedural stretcher with incline SSOT. When provided, body follows
     * readStretcherInclineDegrees / live back plane. Prefer this over a bare number.
     */
    stretcher?: Object3D;
    /**
     * Fallback incline when stretcher is absent (harness). Prefer stretcher SSOT.
     */
    inclineDegrees?: number;
  },
): {
  plantDeltaY: number;
  bodyMinYBefore: number | null;
  center: { deltaX: number; deltaZ: number };
  headAlignDeltaX: number;
  inclineDegrees: number;
} {
  const thickness = input.torsoHalfThickness ?? 0.26;
  // Deck leads: live query of stretcher SSOT; reject a second body-only angle.
  let incline = 0;
  if (input.stretcher) {
    incline = readStretcherInclineDegrees(input.stretcher);
    // Cross-check live back plane (cannot desync if setStretcherInclineDegrees owns both).
    const liveBack = readStretcherBackSectionWorldDeg(input.stretcher);
    humanoidRoot.userData.openClinXrDeckBackSectionWorldDeg = liveBack;
  } else if (typeof input.inclineDegrees === "number" && Number.isFinite(input.inclineDegrees)) {
    incline = Math.max(0, Math.min(45, input.inclineDegrees));
  }
  const inclined = Math.abs(incline) >= 1e-3;
  const contactMode: SupinePlantContactMode = inclined ? "pelvis_seat" : "all_torso";

  /**
   * Plant order from #159 land (4e5d520) — the combination that greened back contact:
   * pose → plant (pelvis_seat if inclined) → center → head XZ → tip → re-plant pelvis_seat.
   * #171 adds only: step metrics, stored tip quat, live pillow XZ, and a *bounded* seat
   * lift that cannot push back gap past 0.05 (or is skipped when already floating).
   */
  humanoidRoot.userData.openClinXrPlantSteps = [];
  applySupinePose(humanoidRoot);
  const plant = plantSupineBodyOnDeck(humanoidRoot, input.deckTopWorldY, thickness, {
    contactMode,
  });
  recordPlantStep(humanoidRoot, "initial_plant", incline, input.stretcher, input.deckTopWorldY);
  const center = centerSupineBodyOnDeck(humanoidRoot, input.deckCenter);
  const stretcherX =
    input.stretcher?.position?.x
    ?? DEFAULT_STRETCHER_POSITION.x;
  const stretcherZ =
    input.stretcher?.position?.z
    ?? DEFAULT_STRETCHER_POSITION.z;
  const pillowLocalX = -STRETCHER_LENGTH_METERS * 0.38;
  const livePillow = input.stretcher ? readStretcherPillowWorld(input.stretcher) : null;
  let headAlignDeltaX = alignSupineHeadToPillow(humanoidRoot, {
    x: input.pillowWorldX ?? livePillow?.x ?? stretcherX + pillowLocalX,
    z: livePillow?.z ?? stretcherZ,
  }).deltaX;
  recordPlantStep(humanoidRoot, "head_align_xz", incline, input.stretcher, input.deckTopWorldY);

  if (inclined) {
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
    recordPlantStep(humanoidRoot, "final", incline, input.stretcher, input.deckTopWorldY);
  } else {
    plantSupineBodyOnDeck(humanoidRoot, input.deckTopWorldY, thickness, { contactMode: "all_torso" });
    liftSupineBodyAboveDeck(humanoidRoot, input.deckTopWorldY, -0.02);
    recordPlantStep(humanoidRoot, "final_flat", incline, input.stretcher, input.deckTopWorldY);
  }
  humanoidRoot.userData.openClinXrSupinePlantDeltaY = plant.deltaY;
  humanoidRoot.userData.openClinXrSupinePlantBodyMinBefore = plant.bodyMinYBefore;
  humanoidRoot.userData.openClinXrSupineCenterDelta = center;
  humanoidRoot.userData.openClinXrSupineHeadAlignDeltaX = headAlignDeltaX;
  humanoidRoot.userData.openClinXrSupineInclineDegrees = incline;
  // Per-frame restores this exact tip (hinge plant) instead of re-deriving rotation-only.
  humanoidRoot.userData.openClinXrSupineRootQuat = {
    x: humanoidRoot.quaternion.x,
    y: humanoidRoot.quaternion.y,
    z: humanoidRoot.quaternion.z,
    w: humanoidRoot.quaternion.w,
  };
  humanoidRoot.updateMatrixWorld?.(true);
  return {
    plantDeltaY: plant.deltaY,
    bodyMinYBefore: plant.bodyMinYBefore,
    center,
    headAlignDeltaX,
    inclineDegrees: incline,
  };
}

// Body align helpers — re-exported for callers that import from this module.
export {
  liftSupineBodyAboveDeck,
  alignSupineHeadToPillow,
  alignSupineHeadToPillowWorld,
  alignSupineHeadToPillowSoft,
  holdSupinePlantFrame,
  centerSupineBodyOnDeck,
} from "./hob-body-align.js";
