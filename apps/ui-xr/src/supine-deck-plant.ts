/**
 * Supine deck plant + HOB incline follow (#150/#153/#159/#171).
 *
 * Extracted from supine-pose.ts so the bone map file stays under the zone budget.
 * Pose bones stay in supine-pose.ts; this owns plant, tip, head-align, lift.
 */

import { Box3, Quaternion, Vector3, type Object3D } from "three";
import {
  DEFAULT_STRETCHER_POSITION,
} from "@openclinxr/asset-registry";
import {
  STRETCHER_LENGTH_METERS,
  readStretcherBackSectionWorldDeg,
  readStretcherInclineDegrees,
  readStretcherPillowWorld,
} from "./station-stretcher.js";
import { applySupinePose, type ApplySupinePoseResult } from "./supine-pose.js";

/**
 * Per-frame: re-apply flat on-back basis then re-tip to the stored deck incline (#171 seam 3).
 * Tip is rotation-only; `holdSupinePlantFrame` owns base XYZ; then reapply pillow soft-align.
 */
export function applySupinePoseHoldingIncline(humanoidRoot: Object3D): ApplySupinePoseResult {
  const result = applySupinePose(humanoidRoot);
  const raw = humanoidRoot.userData?.openClinXrSupineInclineDegrees;
  const incline = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  if (Math.abs(incline) >= 1e-3) {
    applySupineInclineRotationOnly(humanoidRoot, incline);
  }
  return result;
}

/** After hold restores base XYZ, re-apply soft head→pillow from register. */
export function reapplySupineHeadToStoredPillow(humanoidRoot: Object3D): void {
  const p = humanoidRoot.userData?.openClinXrSupinePillowWorld as
    | { x?: number; y?: number; z?: number }
    | undefined;
  if (!p || typeof p.x !== "number" || typeof p.z !== "number") return;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
  const y = typeof p.y === "number" && Number.isFinite(p.y) ? p.y : undefined;
  if (y === undefined) {
    alignSupineHeadToPillow(humanoidRoot, { x: p.x, z: p.z });
    return;
  }
  alignSupineHeadToPillowSoft(humanoidRoot, { x: p.x, y, z: p.z }, 0.55);
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
 * Tip the recumbent body about the pelvis so the torso follows the deck incline.
 * After on-back basis, head ≈ −X; a **world** R_z(−θ) lifts head toward +Y.
 *
 * Must be world-space: euler `rotation.z +=` after Rx(−π/2)·Rz(+π/2) does **not**
 * raise the head (it rolls about the post-basis local axis). #163's body-only tip
 * looked like a fold for that reason; with an articulating deck we need the true
 * world hinge match.
 *
 * Incline comes from the stretcher (deck leads). Do not invent a second body angle.
 */
export function applySupineInclineMatchingDeck(
  humanoidRoot: Object3D,
  inclineDegrees: number,
): void {
  if (!Number.isFinite(inclineDegrees) || Math.abs(inclineDegrees) < 1e-6) {
    humanoidRoot.userData.openClinXrSupineInclineDegrees = 0;
    return;
  }
  const before = readPelvisWorld(humanoidRoot);
  const rad = (-inclineDegrees * Math.PI) / 180;
  // World-space premultiply: rotate the already-on-back figure about world +Z.
  const worldTip = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rad);
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
  humanoidRoot.userData.openClinXrSupineInclineDegrees = inclineDegrees;
  humanoidRoot.userData.openClinXrSupineInclineSource = "deck_leads_body_follows_world_z";
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

  applySupinePose(humanoidRoot);
  // Flat plant first so center/head-align have a known deck contact, then tip if needed.
  const plant = plantSupineBodyOnDeck(humanoidRoot, input.deckTopWorldY, thickness, {
    contactMode: "all_torso",
  });
  const center = centerSupineBodyOnDeck(humanoidRoot, input.deckCenter);
  // #153: head → pillow. Prefer live pillow mesh (rides HOB); fall back to flat local offset.
  const livePillow = input.stretcher ? readStretcherPillowWorld(input.stretcher) : null;
  const pillowLocalX = -STRETCHER_LENGTH_METERS * 0.38;
  const pillowX =
    input.pillowWorldX
    ?? livePillow?.x
    ?? (DEFAULT_STRETCHER_POSITION.x + pillowLocalX);
  const pillowZ = livePillow?.z ?? DEFAULT_STRETCHER_POSITION.z;
  let headAlign = alignSupineHeadToPillow(humanoidRoot, { x: pillowX, z: pillowZ });
  if (inclined) {
    applySupineInclineMatchingDeck(humanoidRoot, incline);
    // Re-plant pelvis on seat so the raised torso is not dragged flat (#159).
    plantSupineBodyOnDeck(humanoidRoot, input.deckTopWorldY, thickness, { contactMode: "pelvis_seat" });
    // Mild seat-plane lift first (rigid tip drops extremities through the flat seat).
    liftSupineBodyAboveDeck(humanoidRoot, input.deckTopWorldY, -0.08);
    // Head→pillow: full XZ + partial Y. Full Y snap sinks the mesh ~0.25 m through the
    // seat; XZ-only left head ~0.33 m above the pillow. Blend Y so both stay in band.
    const pillowAfter = input.stretcher ? readStretcherPillowWorld(input.stretcher) : null;
    if (pillowAfter) {
      headAlign = alignSupineHeadToPillowSoft(humanoidRoot, pillowAfter, 0.55);
      humanoidRoot.userData.openClinXrSupinePillowWorld = { ...pillowAfter };
    }
  } else {
    plantSupineBodyOnDeck(humanoidRoot, input.deckTopWorldY, thickness, { contactMode });
    liftSupineBodyAboveDeck(humanoidRoot, input.deckTopWorldY, -0.02);
  }
  humanoidRoot.userData.openClinXrSupinePlantDeltaY = plant.deltaY;
  humanoidRoot.userData.openClinXrSupinePlantBodyMinBefore = plant.bodyMinYBefore;
  humanoidRoot.userData.openClinXrSupineCenterDelta = center;
  humanoidRoot.userData.openClinXrSupineHeadAlignDelta = headAlign;
  humanoidRoot.userData.openClinXrSupineInclineDegrees = incline;
  humanoidRoot.updateMatrixWorld?.(true);
  return {
    plantDeltaY: plant.deltaY,
    bodyMinYBefore: plant.bodyMinYBefore,
    center,
    headAlignDeltaX: headAlign.deltaX,
    inclineDegrees: incline,
  };
}

/**
 * Raise the root if skinned world AABB minY is below deckTop + minClearance.
 * Prevents an inclined tip from leaving extremities 10cm+ through the seat plane
 * (same instrument family as #150's skinnedWorldAabb clearance).
 */
export function liftSupineBodyAboveDeck(
  humanoidRoot: Object3D,
  deckTopWorldY: number,
  minClearanceMeters = -0.02,
): number {
  humanoidRoot.updateMatrixWorld?.(true);
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { update?: () => void };
    };
    if (skinned.isSkinnedMesh) skinned.skeleton?.update?.();
  });
  const box = new Box3();
  let any = false;
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & { isSkinnedMesh?: boolean };
    if (!skinned.isSkinnedMesh) return;
    const meshBox = new Box3().setFromObject(object);
    if (meshBox.isEmpty()) return;
    if (!any) {
      box.copy(meshBox);
      any = true;
    } else {
      box.union(meshBox);
    }
  });
  if (!any || !Number.isFinite(box.min.y)) return 0;
  const target = deckTopWorldY + minClearanceMeters;
  if (box.min.y >= target - 1e-4) return 0;
  const delta = target - box.min.y;
  humanoidRoot.position.y += delta;
  humanoidRoot.updateMatrixWorld?.(true);
  humanoidRoot.userData.openClinXrSupineSinkLiftMeters = delta;
  return delta;
}

/**
 * Shift root XZ so the head bone sits on the pillow rest point (staging, not anatomy).
 * Call after centerSupineBodyOnDeck; re-plant Y afterwards.
 */
export function alignSupineHeadToPillow(
  humanoidRoot: Object3D,
  pillowWorld: { x: number; z: number },
): { deltaX: number; deltaZ: number } {
  const full = alignSupineHeadToPillowWorld(humanoidRoot, {
    x: pillowWorld.x,
    y: readHeadWorld(humanoidRoot)?.y ?? 0,
    z: pillowWorld.z,
  });
  return { deltaX: full.deltaX, deltaZ: full.deltaZ };
}

/**
 * Match head bone to the live pillow in world XYZ (#171 inclined HOB).
 * XZ-only left the head ~0.3–0.4 m above a raised pillow after tip + sink lift.
 */
export function alignSupineHeadToPillowWorld(
  humanoidRoot: Object3D,
  pillowWorld: { x: number; y: number; z: number },
): { deltaX: number; deltaY: number; deltaZ: number } {
  return alignSupineHeadToPillowSoft(humanoidRoot, pillowWorld, 1);
}

/**
 * Head→pillow with optional Y blend. yBlend=1 is full XYZ; yBlend=0 is XZ-only.
 * Rigid whole-body tip cannot put head on pillow AND keep feet on the seat; blend trades both.
 */
export function alignSupineHeadToPillowSoft(
  humanoidRoot: Object3D,
  pillowWorld: { x: number; y: number; z: number },
  yBlend: number,
): { deltaX: number; deltaY: number; deltaZ: number } {
  const head = readHeadWorld(humanoidRoot);
  if (!head) return { deltaX: 0, deltaY: 0, deltaZ: 0 };
  const blend = Math.max(0, Math.min(1, yBlend));
  const deltaX = pillowWorld.x - head.x;
  const deltaY = (pillowWorld.y - head.y) * blend;
  const deltaZ = pillowWorld.z - head.z;
  if (Math.abs(deltaX) < 1e-4 && Math.abs(deltaY) < 1e-4 && Math.abs(deltaZ) < 1e-4) {
    return { deltaX: 0, deltaY: 0, deltaZ: 0 };
  }
  humanoidRoot.position.x += deltaX;
  humanoidRoot.position.y += deltaY;
  humanoidRoot.position.z += deltaZ;
  humanoidRoot.updateMatrixWorld?.(true);
  return { deltaX, deltaY, deltaZ };
}

function readHeadWorld(humanoidRoot: Object3D): { x: number; y: number; z: number } | null {
  humanoidRoot.updateMatrixWorld?.(true);
  let found: { x: number; y: number; z: number } | null = null;
  const consider = (object: Object3D) => {
    if (found) return;
    if (object.name !== "head" && object.name !== "Head") return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone && object.name !== "head") return;
    object.updateWorldMatrix?.(true, false);
    const e = object.matrixWorld?.elements;
    if (!e) return;
    found = { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
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
  return found;
}

/**
 * Per-frame plant hold: restore base XZ/Y with mild breathing; root Z owned by applySupinePose.
 */
export function holdSupinePlantFrame(
  root: Object3D,
  base: { x: number; y: number; z: number; scaleX: number; scaleY: number; scaleZ: number },
  breathing: number,
): void {
  root.position.y = base.y + breathing * 0.006;
  root.position.x = base.x;
  root.position.z = base.z;
  root.scale.x = base.scaleX;
  root.scale.y = base.scaleY + breathing * 0.006;
  root.scale.z = base.scaleZ;
}

/**
 * Center the recumbent body on the stretcher XZ and nudge so the head end sits
 * toward the pillow (−X). Call after applySupinePose + plant Y.
 */
export function centerSupineBodyOnDeck(
  humanoidRoot: Object3D,
  deckCenter: { x: number; z: number },
): { deltaX: number; deltaZ: number } {
  humanoidRoot.updateMatrixWorld?.(true);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let any = false;
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      geometry?: {
        attributes?: {
          position?: { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number };
        };
      };
      matrixWorld?: { elements: number[] };
    };
    if (!skinned.isSkinnedMesh || !skinned.geometry?.attributes?.position) return;
    const pos = skinned.geometry.attributes.position;
    const e = skinned.matrixWorld?.elements;
    if (!e) return;
    any = true;
    const stride = Math.max(1, Math.floor(pos.count / 2000));
    for (let i = 0; i < pos.count; i += stride) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const w = 1 / (e[3] * vx + e[7] * vy + e[11] * vz + e[15] || 1);
      const wx = (e[0] * vx + e[4] * vy + e[8] * vz + e[12]) * w;
      const wz = (e[2] * vx + e[6] * vy + e[10] * vz + e[14]) * w;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
  });
  if (!any) return { deltaX: 0, deltaZ: 0 };
  const bodyCx = (minX + maxX) / 2;
  const bodyCz = (minZ + maxZ) / 2;
  const deltaX = deckCenter.x - bodyCx;
  const deltaZ = deckCenter.z - bodyCz;
  humanoidRoot.position.x += deltaX;
  humanoidRoot.position.z += deltaZ;
  humanoidRoot.updateMatrixWorld?.(true);
  return { deltaX, deltaZ };
}
