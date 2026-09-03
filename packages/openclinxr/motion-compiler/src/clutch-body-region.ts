import type { CompiledMotionFragment, CompiledMotionTrack, PrimitiveRequest } from "./canonical-motion-contract.js";

import { approachHoldRelease, seededScale } from "./trajectory.js";
import {
  isMotionBodyRegion,
  motionBodyRegionForComplianceRegion,
  type MotionBodyRegion,
} from "./motion-body-region.js";
import { effectorBoneOnRig, isLeftSideBone, requestedEffector } from "./requested-effector.js";

/**
 * `clutch_body_region` — the effector hand clamps onto a body region and HOLDS contact there.
 *
 * Owned by M4 (tsk_ccc9fb8c7f0def8b); the registry seam (tsk_51ffcc3e1a8fdea8) resolved this id to
 * this module's `compile`, and this body replaces the seam's empty-tracks placeholder.
 *
 * BEHAVIOUR: a clutch is a positional contact, so this primitive drives the effector's NODE-LOCAL
 * TRANSLATION — the hand leaves its bind rest position, travels to the region on a minimum-jerk
 * approach, holds for the exact window the action's contact constraint declares
 * (startFraction/endFraction), and releases back to rest on a minimum-jerk fall. It is the only
 * one of the four primitives that writes translation tracks; the other three are rotations.
 *
 * THE SITE IS THE MOTION, not a label (compiler-surface clause 2). The direction of travel comes
 * from the REQUESTED REGION — a closed per-region travel table keyed on the MotionBodyRegion
 * vocabulary (a compliance-region id is translated through the one declared mapper first), so
 * `abdomen` and `chest` compile to different tracks and the same region is byte-stable across
 * calls. A region the vocabularies do not declare is REFUSED, never defaulted to one motion.
 *
 * THE EFFECTOR COMES FROM THE ACTION (clause 3). `action.effector` (handL/handR) is resolved
 * against the profile's own joint table through `requested-effector.ts` — never from a per-request
 * profile field, which would split the rig's `skeletonProfileHash`. A left-hand clutch is mirrored
 * across the body mid-plane from the right-hand travel.
 *
 * TRACK TIMES ARE SECONDS (clause 4). Authored timing arrives as `timing.durationMs`; the clip's
 * `durationSeconds` is the maximum final track time, so the times a primitive emits must already be
 * seconds or the composer reports a 900 ms clutch as 900 seconds.
 *
 * Amplitude is scaled by the request seed (seededScale), which is what makes the clip reproducible
 * under a seed and sensitive to it. Anatomical plausibility is NOT claimed here — the plant's own
 * NOT TESTED line records that no clause grades a pose.
 */

const SAMPLES = 64;
const DEFAULT_DURATION_MS = 900;
const DEFAULT_HOLD = { holdStart: 0.4, holdEnd: 0.72 };
/** Direction the hand travels from its bind rest pose: up toward the abdomen, slightly inward. */
const DEFAULT_TARGET_DELTA = { x: 0.05, y: 0.2, z: -0.08 } as const;
const JITTER = 0.12;
/** The default bind local position the fixtures rest on when a profile carries no joint table. */
const DEFAULT_REST = { x: 0, y: -0.26, z: 0 } as const;

type Vec3 = { x: number; y: number; z: number };

/**
 * Per-region travel deltas, keyed on the closed MotionBodyRegion vocabulary: which way and how far
 * the effector travels from its bind rest to clutch THAT region. Values are metres in the effector
 * node's local frame for the RIGHT hand (x mirrored for the left): y is height of the region above
 * the resting hand, x its laterality (the body's right is +x), z anterior/posterior depth.
 *
 * Typed `Record<MotionBodyRegion, ...>` so the map is exhaustive by construction — every declared
 * region has a travel, and a key outside the vocabulary cannot be written here. The signs follow
 * the anchor directions the region-anchor producer declares (region-anchors.ts), so the two maps
 * agree about which side of the body a region sits on.
 */
const REGION_TRAVEL: Readonly<Record<MotionBodyRegion, Vec3>> = {
  motion_guard_abdomen_rlq: { x: 0.06, y: 0.16, z: -0.06 },
  motion_guard_abdomen_luq: { x: -0.06, y: 0.16, z: -0.06 },
  motion_guard_abdomen_ruq: { x: 0.06, y: 0.22, z: -0.06 },
  motion_guard_abdomen_llq: { x: -0.06, y: 0.12, z: -0.06 },
  motion_guard_abdomen_epigastric: { x: 0, y: 0.24, z: -0.08 },
  motion_guard_abdomen_suprapubic: { x: 0, y: 0.14, z: -0.08 },
  motion_guard_chest_r: { x: 0.05, y: 0.34, z: -0.06 },
  motion_guard_chest_l: { x: -0.05, y: 0.34, z: -0.06 },
  motion_guard_neck_anterior: { x: 0, y: 0.44, z: -0.04 },
  motion_guard_neck_posterior: { x: 0, y: 0.42, z: 0.1 },
  motion_guard_flank_r: { x: 0.14, y: 0.18, z: -0.02 },
  sternum: { x: 0, y: 0.32, z: -0.07 },
  left_precordium: { x: -0.07, y: 0.28, z: -0.05 },
  right_shoulder: { x: 0.1, y: 0.4, z: -0.04 },
  left_thigh: { x: -0.05, y: -0.08, z: -0.02 },
  forehead: { x: 0, y: 0.48, z: -0.02 },
  mouth: { x: 0, y: 0.46, z: -0.03 },
};

function readActionId(request: PrimitiveRequest): string {
  const actionId = (request.action as { actionId?: unknown }).actionId;
  if (typeof actionId !== "string") {
    throw new Error("clutch_body_region requires a request whose action carries a string actionId");
  }
  return actionId;
}

function readDurationMs(action: unknown): number {
  const durationMs = (action as { timing?: { durationMs?: unknown } }).timing?.durationMs;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : DEFAULT_DURATION_MS;
}

/** The contact window the action declares, when it declares one. */
function readContactWindow(action: unknown): { holdStart: number; holdEnd: number } | null {
  const constraints = (action as { constraints?: unknown }).constraints;
  if (!Array.isArray(constraints)) return null;
  for (const raw of constraints) {
    const c = raw as { kind?: unknown; startFraction?: unknown; endFraction?: unknown };
    if (c.kind !== "contact") continue;
    const startFraction = c.startFraction;
    const endFraction = c.endFraction;
    if (
      typeof startFraction === "number" && Number.isFinite(startFraction) && startFraction >= 0
      && typeof endFraction === "number" && Number.isFinite(endFraction) && endFraction <= 1
      && endFraction > startFraction
    ) {
      return { holdStart: startFraction, holdEnd: endFraction };
    }
  }
  return null;
}

/**
 * The target delta for the requested site, or null when the action carries no body_region target.
 *
 * A compliance-region id (the plant fixtures' `abdomen_epigastric` / `chest_L`) is translated
 * through the ONE declared mapper; a MotionBodyRegion id resolves directly. Anything else is
 * REFUSED — one travel per region, never a default that makes every region the same motion.
 */
function travelForTarget(action: unknown): { delta: Vec3; landmark: string } | null {
  const target = (action as { target?: unknown }).target as { kind?: unknown; id?: unknown } | undefined;
  if (target?.kind !== "body_region" || typeof target.id !== "string" || target.id.length === 0) {
    return null;
  }
  const site = target.id;
  // The mapper's codomain is a subset of the declared MotionBodyRegions, so a compliance id
  // translates to a member of the closed vocabulary the travel table is exhaustive over.
  const motionRegion: MotionBodyRegion = isMotionBodyRegion(site)
    ? site
    : (motionBodyRegionForComplianceRegion(site) as MotionBodyRegion);
  const delta = REGION_TRAVEL[motionRegion];
  return { delta, landmark: site };
}

/** The effector's bind local position from the profile's joint table, when the profile carries one. */
function readBindPosition(request: PrimitiveRequest, effectorBone: string): Vec3 {
  const joints = (request.skeletonProfile as { joints?: { boneName?: unknown; bindLocalPosition?: unknown }[] }).joints;
  if (Array.isArray(joints)) {
    for (const joint of joints) {
      if (joint.boneName !== effectorBone) continue;
      const p = joint.bindLocalPosition as { x?: unknown; y?: unknown; z?: unknown } | undefined;
      if (
        p && typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number"
      ) {
        return { x: p.x, y: p.y, z: p.z };
      }
    }
  }
  // The fixture profiles keep the hand at its bind rest when the joint table does not carry it.
  return { x: DEFAULT_REST.x, y: DEFAULT_REST.y, z: DEFAULT_REST.z };
}

function sampleTimes(durationSeconds: number): number[] {
  const out = new Array<number>(SAMPLES);
  for (let i = 0; i < SAMPLES; i += 1) {
    out[i] = (i * durationSeconds) / (SAMPLES - 1);
  }
  return out;
}

export function compile(request: PrimitiveRequest): CompiledMotionFragment {
  const actionId = readActionId(request);
  const action = request.action as { timing?: unknown; constraints?: unknown };
  const durationMs = readDurationMs(action);
  const hold = readContactWindow(action) ?? DEFAULT_HOLD;
  const requested = requestedEffector(request);
  const effector = effectorBoneOnRig(request, requested);
  const rest = readBindPosition(request, effector);

  const travel = travelForTarget(request.action);
  const landmark = travel?.landmark ?? "clutch_body_region_target";
  const baseDelta = travel?.delta ?? DEFAULT_TARGET_DELTA;
  // A left-hand clutch mirrors the right-hand travel across the body mid-plane: the region's side
  // is expressed in the body frame, so the hand's own local x is negated for the left side.
  const lateralSign = isLeftSideBone(effector) || isLeftSideBone(requested) ? -1 : 1;

  const amp = seededScale(request.seed, 1, JITTER);
  const durationSeconds = durationMs / 1000;
  const times = sampleTimes(durationSeconds);
  const values: [number, number, number][] = new Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i += 1) {
    const u = i / (SAMPLES - 1);
    const curve = approachHoldRelease(u, hold);
    values[i] = [
      rest.x + baseDelta.x * lateralSign * amp * curve,
      rest.y + baseDelta.y * amp * curve,
      rest.z + baseDelta.z * amp * curve,
    ];
  }

  const track: CompiledMotionTrack = {
    property: "translationAbsoluteNodeLocal",
    boneName: effector,
    canonicalLandmark: landmark,
    interpolation: "LINEAR",
    times,
    values,
  };

  return { actionId, tracks: [track] };
}
