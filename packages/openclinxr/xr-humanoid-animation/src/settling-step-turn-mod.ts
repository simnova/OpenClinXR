import { boneIsOwned, type OwnedChain } from "@openclinxr/xr-pose";
import { type Object3D, Vector3 } from "three";
import { LOCOMOTION_CHAIN_OWNER_ID } from "./locomotion-clip-playback-mod.js";
import type { StanceFoot } from "./stance-lock-mod.js";
import { ARRIVAL_CLOSE_MAX_STEP_METERS, applyLocal, copyVec, writeToeLocalClamped, type Vec3 } from "./toe-local-write.js";

/**
 * Terminal-turn pose: one foot stays planted in WORLD XZ, the other is released and later
 * replanted. The actor slot is not translated — that would compete with the walk stance lock and
 * was measured to walk the arrival residual past 0.05 m when a planted toe was used as a pivot.
 *
 * There is no rights-cleared turn-in-place take in the shipped clip set (see the follow-up
 * evidence note). This is an explicit alternating release/replant, not a second root translator.
 *
 * claimScope: local toe pose during the bedside approach settling phase.
 * notEvidenceFor: gait realism, clinical plausibility, Quest readiness, or browser A08 closure.
 */

export const SETTLING_STEP_TURN_OWNER_ID = "openclinxr.settling-step-turn";

/** ~23 deg. A large heading change cannot keep one foot down the whole way; this is the swap grain. */
export const SETTLING_STEP_YAW_RADIANS = 0.4;

/** Added on top of the runtime contact band so the swing toe's contact label is airborne, not fitted. */
export const SWING_CLEARANCE_ABOVE_BAND_METERS = 0.05;

export type SettlingStepTurnState = {
  plantFoot: StanceFoot;
  stepStartHeadingRadians: number;
  restLocal: { left: Vec3; right: Vec3 } | null;
  plantAnchorXz: { x: number; z: number } | null;
  yawPerStepRadians: number;
  /** False until the walk-to-turn contact has been broken by an airborne frame. */
  opened: boolean;
  /** True on the arrived frame that lifts before restoring rest, so stop does not inherit a snap. */
  closing: boolean;
};

export function createSettlingStepTurnState(): SettlingStepTurnState {
  return {
    plantFoot: "right",
    stepStartHeadingRadians: 0,
    restLocal: null,
    plantAnchorXz: null,
    yawPerStepRadians: SETTLING_STEP_YAW_RADIANS,
    opened: false,
    closing: false,
  };
}

function shortestYawDelta(fromRadians: number, toRadians: number): number {
  return Math.atan2(Math.sin(toRadians - fromRadians), Math.cos(toRadians - fromRadians));
}

function worldXz(node: Object3D): { x: number; z: number } {
  const elements = node.matrixWorld.elements;
  return { x: elements[12] ?? Number.NaN, z: elements[14] ?? Number.NaN };
}

/**
 * Pin the plant toe's WORLD XZ by writing its local pose. Parent inverse, not a slot write.
 * The write is clamped so a re-anchor never snaps the toe.
 */
function pinPlantToAnchor(
  plantToe: Object3D,
  rest: Vec3,
  anchor: { x: number; z: number },
  actorSlot: Object3D,
  maxStepMeters: number,
): void {
  const parent = plantToe.parent;
  if (parent === null) {
    writeToeLocalClamped({ actorSlot, toe: plantToe, desired: rest, maxStepMeters });
    return;
  }
  parent.updateWorldMatrix(true, false);
  const restWorld = parent.localToWorld(new Vector3(rest.x, rest.y, rest.z));
  const local = parent.worldToLocal(new Vector3(anchor.x, restWorld.y, anchor.z));
  writeToeLocalClamped({
    actorSlot,
    toe: plantToe,
    desired: { x: local.x, y: local.y, z: local.z },
    maxStepMeters,
  });
}

function exactChainNames(toe: Object3D, actorSlot: Object3D): string[] {
  const names: string[] = [];
  let node: Object3D | null = toe;
  while (node !== null && node !== actorSlot) {
    if (node.name.length > 0) names.push(node.name);
    node = node.parent;
  }
  return names;
}

function claimHost(toe: Object3D | null, actorSlot: Object3D): Object3D {
  if (toe === null || toe.parent === null || toe.parent === actorSlot) return actorSlot;
  let node: Object3D = toe.parent;
  while (node.parent !== null && node.parent !== actorSlot) {
    node = node.parent;
  }
  return node;
}

function declareLegClaim(input: {
  actorSlot: Object3D;
  leftToe: Object3D;
  rightToe: Object3D;
}): void {
  const host = claimHost(input.leftToe, input.actorSlot);
  const boneNames = [
    ...exactChainNames(input.leftToe, input.actorSlot),
    ...exactChainNames(input.rightToe, input.actorSlot),
  ];
  const existing = (host.userData["openClinXrOwnedBoneChains"] as OwnedChain[] | undefined) ?? [];
  if (boneNames.every((name) => boneIsOwned(existing, name))) return;
  const overlapsOtherOwner = existing.some(
    (chain) =>
      chain.ownerId !== SETTLING_STEP_TURN_OWNER_ID
      && chain.ownerId !== LOCOMOTION_CHAIN_OWNER_ID
      && chain.boneNames.some((name) => boneNames.includes(name)),
  );
  if (overlapsOtherOwner) return;
  const ownerId = existing.some((chain) => chain.ownerId === LOCOMOTION_CHAIN_OWNER_ID)
    ? LOCOMOTION_CHAIN_OWNER_ID
    : SETTLING_STEP_TURN_OWNER_ID;
  host.userData["openClinXrOwnedBoneChains"] = [
    ...existing.filter((chain) => chain.ownerId !== SETTLING_STEP_TURN_OWNER_ID),
    { ownerId, boneNames },
  ];
}

export function restoreSettlingRestToePose(input: {
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  state: SettlingStepTurnState;
  contactBandMeters: number;
}): SettlingStepTurnState {
  const rest = input.state.restLocal;
  if (rest === null) return createSettlingStepTurnState();
  const lift = input.contactBandMeters + SWING_CLEARANCE_ABOVE_BAND_METERS;
  if (!input.state.closing) {
    if (input.leftToe !== null) applyLocal(input.leftToe, { ...rest.left, y: rest.left.y + lift });
    if (input.rightToe !== null) applyLocal(input.rightToe, { ...rest.right, y: rest.right.y + lift });
    return { ...input.state, closing: true };
  }
  if (input.leftToe !== null) applyLocal(input.leftToe, rest.left);
  if (input.rightToe !== null) applyLocal(input.rightToe, rest.right);
  return createSettlingStepTurnState();
}

/**
 * Pose one planted foot and one airborne swing foot for this settling frame.
 *
 * Call AFTER the mixer (or the instrument's rest pose) has written this frame, and do not write
 * actorSlot.position. The walk stance lock remains the sole XZ translator, and only while walking.
 */
export function applySettlingStepTurnPose(input: {
  headingRadians: number;
  targetHeadingRadians: number;
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  contactBandMeters: number;
  initialPlant: StanceFoot | null;
  state: SettlingStepTurnState;
}): SettlingStepTurnState {
  const { leftToe, rightToe } = input;
  if (leftToe === null || rightToe === null) return input.state;

  const lift = input.contactBandMeters + SWING_CLEARANCE_ABOVE_BAND_METERS;
  const maxStepMeters = ARRIVAL_CLOSE_MAX_STEP_METERS;
  let restLocal = input.state.restLocal;
  if (restLocal === null) {
    // Fallback capture when no walk-start snapshot exists (approach created mid-walk).
    // Writes are clamped: the old snap-lift moved toes up to 0.18 m in one frame here.
    restLocal = { left: copyVec(leftToe), right: copyVec(rightToe) };
    writeToeLocalClamped({
      actorSlot: input.actorSlot,
      toe: leftToe,
      desired: { ...restLocal.left, y: restLocal.left.y + lift },
      maxStepMeters,
    });
    writeToeLocalClamped({
      actorSlot: input.actorSlot,
      toe: rightToe,
      desired: { ...restLocal.right, y: restLocal.right.y + lift },
      maxStepMeters,
    });
    input.actorSlot.updateMatrixWorld(true);
    const remainingOpen = Math.abs(shortestYawDelta(input.headingRadians, input.targetHeadingRadians));
    return {
      plantFoot: input.initialPlant ?? "right",
      stepStartHeadingRadians: input.headingRadians,
      restLocal,
      plantAnchorXz: null,
      yawPerStepRadians: Math.max(
        remainingOpen / Math.max(3, Math.ceil(remainingOpen / SETTLING_STEP_YAW_RADIANS)),
        Number.EPSILON,
      ),
      opened: false,
      closing: false,
    };
  }

  const yawPerStepRadians = input.state.yawPerStepRadians;

  let plantFoot = !input.state.opened
    ? (input.initialPlant ?? "right")
    : input.state.plantFoot;
  let stepStartHeadingRadians = input.state.stepStartHeadingRadians;
  let plantAnchorXz = input.state.plantAnchorXz;

  if (Math.abs(shortestYawDelta(stepStartHeadingRadians, input.headingRadians)) >= yawPerStepRadians) {
    plantFoot = plantFoot === "left" ? "right" : "left";
    stepStartHeadingRadians = input.headingRadians;
    plantAnchorXz = null;
  }

  const plantRest = plantFoot === "left" ? restLocal.left : restLocal.right;
  const swingRest = plantFoot === "left" ? restLocal.right : restLocal.left;
  const plantToe = plantFoot === "left" ? leftToe : rightToe;
  const swingToe = plantFoot === "left" ? rightToe : leftToe;

  // Both writes clamped: a plant-foot swap used to teleport the swing toe up to
  // 0.24 m here by writing a stale rest local in one frame.
  writeToeLocalClamped({
    actorSlot: input.actorSlot,
    toe: swingToe,
    desired: { x: swingRest.x, y: swingRest.y + lift, z: swingRest.z },
    maxStepMeters,
  });
  writeToeLocalClamped({ actorSlot: input.actorSlot, toe: plantToe, desired: plantRest, maxStepMeters });
  input.actorSlot.updateMatrixWorld(true);

  if (plantAnchorXz === null) {
    plantAnchorXz = worldXz(plantToe);
  } else {
    pinPlantToAnchor(plantToe, plantRest, plantAnchorXz, input.actorSlot, maxStepMeters);
    input.actorSlot.updateMatrixWorld(true);
  }

  declareLegClaim({ actorSlot: input.actorSlot, leftToe, rightToe });

  return {
    plantFoot,
    stepStartHeadingRadians,
    restLocal,
    plantAnchorXz,
    yawPerStepRadians,
    opened: true,
    closing: false,
  };
}

/** Per-frame toe travel cap during settling/arrived: a close-up, never a snap. */
