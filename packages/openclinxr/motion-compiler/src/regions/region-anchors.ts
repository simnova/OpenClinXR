/**
 * The ANCHOR half of the skeleton profile: `deriveSkeletonProfile` places MotionBodyRegion anchors
 * on the RIG half M1b (`src/derive-skeleton-profile.ts`) produces.
 *
 * Card tsk_1e0cd3cc7084db02. M1b reads a shipped GLB and returns the rig's bind frame; this module
 * CONSUMES that record (the `RigAsset` shape below) and adds `regionAnchors` in
 * `REGION_ANCHOR_SPACE` — `bind_world_metres`, the same space as `bindFrame`. There is no third
 * profile dialect: the produced record is the asset's own rig half unchanged plus the anchor half,
 * so the compile path consumes one profile and cannot slip a fixture back in between M1b and M2.
 *
 * HOW AN ANCHOR IS DERIVED — a landmark position plus a per-region DIRECTION offset, scaled by the
 * asset's OWN measured body dimensions:
 *
 *   - LANDMARKS: `resolvePoseBone` (asset-registry's pose-bone-resolver.ts, the single declared
 *     map) resolves canonical landmarks (`chest`, `spine`, `pelvis`, `upper_armR`, `neck`, `head`,
 *     `thighL`) to the bone names THIS rig actually carries, and the position is read from the
 *     asset's own bind frame. A rig that cannot carry a region's reference landmark is REFUSED for
 *     that region — never defaulted, because a silent default is a wrong anchor nobody can see.
 *   - SCALE: torso height (chest.y − pelvis.y, spine.y where a rig has no pelvis), shoulder
 *     half-width (|upper_armR.x|), and `bodyExtent.halfDepth` for depth offsets are measured ON
 *     THE ASSET, so an anchor moves with the body it was derived for — a 1.00 and a 0.72 body, or
 *     two rig families, land at different bind-world points.
 *   - REGION: the per-region part is only a DIRECTION (`chest_R` is +x of the chest, `rlq` is +x
 *     and down, ...). A direction is the anatomical knowledge; the distance is the asset's.
 *
 * notEvidenceFor: clinical_validity, biomechanical_validity, surface geometry (normals,
 * closest-point, penetration, orientation — tsk_67cafb96802a06bc), production_animation_quality,
 * exam_equivalence, scoring, learner_readiness. An anchor is a bind-pose proxy for a point on the
 * body; what a SURFACE adds on top of a point is deliberately out of scope here.
 */
import { resolvePoseBone } from "../../../asset-registry/src/pose-bone-resolver.js";
import type { MotionBodyRegion } from "../motion-body-region.js";
import { REGION_ANCHOR_SPACE } from "../plant-motion-regions.js";

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export type FkJoint = {
  boneName: string;
  parentBoneName?: string;
  bindLocalPosition: Vec3;
  bindLocalQuaternion: Quat;
};

/** The record M1b produces for a shipped rig, in the shape the anchor producer consumes. */
export type RigAsset = {
  rigFingerprint: string;
  effectorBone: string;
  joints: readonly FkJoint[];
  bindFrame: Readonly<Record<string, Vec3>>;
  bodyExtent: { minY: number; maxY: number; halfWidth: number; halfDepth: number };
};

/** The rig half unchanged plus the anchor half — one profile, no fourth dialect. */
export type ProducedProfile = {
  rigFingerprint: string;
  effectorBone: string;
  joints: readonly FkJoint[];
  bindFrame: Readonly<Record<string, Vec3>>;
  regionAnchorSpace: string;
  regionAnchors: Readonly<Record<string, Vec3>>;
};

type AnchorDirection = {
  /** Canonical pose-bone landmark the region is anchored to (`resolvePoseBone` key). */
  landmark: string;
  /** Signed fractions of the shoulder half-width. */
  dx: number;
  /** Signed fractions of the torso height (chest.y − pelvis/spine.y). Negative is DOWN. */
  dy: number;
  /** Signed fractions of `bodyExtent.halfDepth`. */
  dz: number;
};

/**
 * Per-region anchor DIRECTIONS, keyed by the closed MotionBodyRegion vocabulary.
 *
 * Typed as `Record<MotionBodyRegion, AnchorDirection>` so the map is exhaustive by construction —
 * every declared region has a direction, and a key outside the vocabulary cannot be written here.
 * The four guard regions the M2 plant drives sit on the chest (lateral) and the lower abdomen
 * (down and lateral); the remaining regions cover the rest of the declared set.
 */
const REGION_ANCHOR_DIRECTIONS: Readonly<Record<MotionBodyRegion, AnchorDirection>> = {
  motion_guard_abdomen_rlq: { landmark: "chest", dx: 0.3, dy: -0.55, dz: 0 },
  motion_guard_abdomen_luq: { landmark: "chest", dx: -0.3, dy: -0.55, dz: 0 },
  motion_guard_abdomen_ruq: { landmark: "chest", dx: 0.3, dy: -0.3, dz: 0 },
  motion_guard_abdomen_llq: { landmark: "chest", dx: -0.3, dy: -0.55, dz: 0 },
  motion_guard_abdomen_epigastric: { landmark: "chest", dx: 0, dy: -0.25, dz: 0 },
  motion_guard_abdomen_suprapubic: { landmark: "chest", dx: 0, dy: -0.6, dz: 0 },
  motion_guard_chest_r: { landmark: "chest", dx: 0.45, dy: 0, dz: 0 },
  motion_guard_chest_l: { landmark: "chest", dx: -0.45, dy: 0, dz: 0 },
  motion_guard_neck_anterior: { landmark: "neck", dx: 0, dy: 0, dz: 0.25 },
  motion_guard_neck_posterior: { landmark: "neck", dx: 0, dy: 0, dz: -0.25 },
  motion_guard_flank_r: { landmark: "chest", dx: 0.7, dy: -0.45, dz: 0 },
  sternum: { landmark: "chest", dx: 0, dy: -0.05, dz: 0 },
  left_precordium: { landmark: "chest", dx: -0.3, dy: -0.15, dz: 0 },
  right_shoulder: { landmark: "upper_armR", dx: -0.15, dy: -0.1, dz: 0 },
  left_thigh: { landmark: "thighL", dx: 0, dy: -0.05, dz: 0.3 },
  forehead: { landmark: "head", dx: 0, dy: 0.05, dz: 0.35 },
  mouth: { landmark: "head", dx: 0, dy: -0.18, dz: 0.25 },
};

/**
 * Derive a complete profile — the asset's own rig half plus `regionAnchors` — for the requested
 * regions.
 *
 * REFUSALS: a region id outside the declared MotionBodyRegion vocabulary, a rig carrying no chest
 * landmark, a degenerate torso (chest not above its base), and a region whose reference landmark
 * the rig cannot carry all THROW. A silent default would solve cleanly and put the hand on the
 * wrong part of the body.
 */
export function deriveSkeletonProfile(asset: RigAsset, regions: readonly string[]): ProducedProfile {
  const jointNames = new Set(asset.joints.map((joint) => joint.boneName));

  const landmarkPosition = (key: string): Vec3 | undefined => {
    const boneName = resolvePoseBone(key, jointNames);
    if (boneName === null) return undefined;
    return asset.bindFrame[boneName];
  };

  const chest = landmarkPosition("chest");
  if (chest === undefined) {
    throw new Error(
      `deriveSkeletonProfile: ${asset.rigFingerprint} carries no chest landmark — no region anchor can be placed`,
    );
  }
  const trunkBase = landmarkPosition("pelvis") ?? landmarkPosition("spine");
  if (trunkBase === undefined || trunkBase.y >= chest.y) {
    throw new Error(
      `deriveSkeletonProfile: ${asset.rigFingerprint} has a degenerate torso (chest at y=${chest.y.toFixed(3)}) — anchors cannot be placed`,
    );
  }
  const torsoHeight = chest.y - trunkBase.y;
  const shoulder = landmarkPosition("upper_armR");
  const shoulderHalfWidth = shoulder === undefined ? asset.bodyExtent.halfWidth : Math.abs(shoulder.x);

  const anchors: Record<string, Vec3> = {};
  for (const region of regions) {
    const direction = REGION_ANCHOR_DIRECTIONS[region as MotionBodyRegion];
    if (direction === undefined) {
      throw new Error(
        `deriveSkeletonProfile: "${region}" is not a declared MotionBodyRegion — no anchor can be derived`,
      );
    }
    const reference = landmarkPosition(direction.landmark);
    if (reference === undefined) {
      throw new Error(
        `deriveSkeletonProfile: "${region}" needs the "${direction.landmark}" landmark, which ${asset.rigFingerprint} does not carry — refused, not defaulted`,
      );
    }
    anchors[region] = {
      x: reference.x + direction.dx * shoulderHalfWidth,
      y: reference.y + direction.dy * torsoHeight,
      z: reference.z + direction.dz * asset.bodyExtent.halfDepth,
    };
  }

  return {
    rigFingerprint: asset.rigFingerprint,
    effectorBone: asset.effectorBone,
    joints: asset.joints,
    bindFrame: asset.bindFrame,
    regionAnchorSpace: REGION_ANCHOR_SPACE,
    regionAnchors: anchors,
  };
}
