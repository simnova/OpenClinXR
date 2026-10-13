import type { Object3D } from "three";
import { Quaternion } from "three";
import type { ResolvedBedsideApproach } from "@openclinxr/asset-registry/case-approach-intent";
import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";
import { planFootsteps } from "./footstep-plan-schedule.js";
import {
  parseFootstepPlanEnabled,
  readFootstepPlanEnabled,
  readFootstepRouteMeters,
} from "./footstep-plan-query-flag-mod.js";
import { extendLocoGroundRoute } from "./loco-ground-tap-mod.js";

/**
 * Footstep-plan S2 stride amplitude (default OFF, `?footstepPlan=1`).
 *
 * Stride must change, not root speed: scaling root advance against an
 * unchanged leg pose is slide by construction (S1 D2). So the plan scales
 * stride AMPLITUDE: every walking frame, leg+pelvis bone rotations are
 * blended between the standing snapshot and the walk clip pose by the
 * plan's uniform scale, and the closed loop (running after this blend)
 * advances the root by what the SCALED planted foot does.
 *
 * Why uniform scale needs no transitions: the plan gives every step the
 * same scale, adopted by both legs plus pelvis at walk start while the
 * action begins at FOOTSTEP_START_PHASE_S (feet passing, near standing, so
 * adoption moves toes centimetres, not the 0.285 m control snap). No scale
 * ever changes mid-walk, so a planted foot can never move because of a
 * scale change: the STOP condition (scale change moves a planted toe) is
 * structurally unreachable, and the per-frame trace in the S2 report shows
 * it. Arms, spine, toes, timeScale, the clip, and the turn are untouched.
 *
 * claimScope: the walking legs' amplitude for one approach while flagged.
 * notEvidenceFor: gait realism, other actors, or unflagged runs (no flag =
 * this module returns before touching anything).
 */

export type FootstepBoneRest = {
  bone: Object3D;
  rest: { x: number; y: number; z: number; w: number };
};

export type FootstepPlanState = {
  scale: number;
  steps: number;
  bones: FootstepBoneRest[];
};

const routeIntentCache = new WeakMap<ResolvedBedsideApproach, ResolvedBedsideApproach>();

/**
 * 2.0 m second route (S2 gate cell): prepend collinear waypoints and move
 * the start back along the route axis until the polyline is 2.0 m, reusing
 * extendLocoGroundRoute with routeMeters 2. Pure; null route flag or an
 * already-long route returns the input untouched. Default off.
 */
export function extendFootstepRouteIntent(intent: ResolvedBedsideApproach): ResolvedBedsideApproach {
  if (!readFootstepPlanEnabled() || readFootstepRouteMeters() === null) return intent;
  const cached = routeIntentCache.get(intent);
  if (cached) return cached;
  const extended = extendLocoGroundRoute({
    start: intent.start,
    target: intent.target.position,
    waypoints: intent.plan.waypoints,
    routeMeters: 2,
  });
  const out = extended === null
    ? intent
    : { ...intent, start: extended.start, plan: { ...intent.plan, waypoints: extended.waypoints } };
  routeIntentCache.set(intent, out);
  return out;
}

/** Node-testable gate twin: pure parser over the search string. */
export function footstepRouteExtensionForTest(search: string): number | null {
  if (!parseFootstepPlanEnabled(search)) return null;
  const raw = new URLSearchParams(search).get("footstepRouteM");
  return raw !== null && Number(raw) === 2 ? 2 : null;
}

const PELVIS_BONE = /^pelvis/;

function collectPelvisBones(actorSlot: Object3D): Object3D[] {
  const found: Object3D[] = [];
  actorSlot.traverse((node) => {
    if (typeof node.name === "string" && PELVIS_BONE.test(node.name.replaceAll(".", ""))) found.push(node);
  });
  return found;
}

/**
 * Walk-entry capture: resolve the plan scale and pin bone refs + rest pose.
 * Call on the first walking frame (pre-clip pose, same frame as
 * captureRestStance). Flag off clears the state; a refused plan or missing
 * rest also clears it, so the blend below no-ops and the walk runs S1-style
 * (gates then show the miss loudly, never a silent half-blend).
 */
export function captureFootstepRest(approach: CaseOwnedBedsideApproach): void {
  if (!readFootstepPlanEnabled()) {
    approach.footstep = null;
    return;
  }
  const routeDx = approach.target.x - approach.start.x;
  const routeDz = approach.target.z - approach.start.z;
  // Planned against the route length itself. (An exit-lead variant was tried
  // and reverted: threshold shifts scale with the stride rate, so a lead
  // cannot move the exit substep — same substep 91 at leads 0.011 and 0.016,
  // and the turn mapped the micro-different entry worse. See the S2 report.)
  const plan = planFootsteps(Math.hypot(routeDx, routeDz));
  const rest = approach.restStance;
  if ("refused" in plan || rest === null) {
    approach.footstep = null;
    return;
  }
  const bones: FootstepBoneRest[] = [];
  const byName = new Map<string, Object3D>();
  approach.actorSlot.traverse((node) => {
    if (typeof node.name === "string" && node.name.length > 0 && !byName.has(node.name)) {
      byName.set(node.name, node);
    }
  });
  for (const [name, quat] of Object.entries(rest.quats)) {
    const bone = byName.get(name);
    if (bone !== undefined) bones.push({ bone, rest: { ...quat } });
  }
  for (const bone of collectPelvisBones(approach.actorSlot)) {
    const q = bone.quaternion;
    bones.push({ bone, rest: { x: q.x, y: q.y, z: q.z, w: q.w } });
  }
  approach.footstep = { scale: plan.scale, steps: plan.steps, bones };
}

const restQuat = new Quaternion();

/**
 * M1 per-stage tap (footstep-plan-creep D1/D2, default OFF behind
 * `?footstepPlan=1` — the same guard as the blend, so the default path
 * runs zero extra reads). Pure observation: snapshots never write the
 * scene, the slot, the bones, or the plan.
 *
 * One record per walking substep, three stages inside
 * `applyCaseOwnedStanceLock`'s walking tail (case-owned-approach-frame-mod.ts):
 * mixer = entry (clip pose; the observe-only lock writes nothing), blend =
 * after `applyFootstepPlanStep`, post = after `applyClosedLoopWalkStep`
 * (slot translated; toes re-read). The capture tool drains the ring to
 * `tap-<vehicle>-run<N>.json` beside the run file; `sub` joins to the
 * probe's `walkSimSubsteps` column.
 */
export type FootstepTapStagePose = {
  left: { x: number; y: number; z: number } | null;
  right: { x: number; y: number; z: number } | null;
  slotX: number;
  slotZ: number;
};

export type FootstepTapRecord = {
  /** Executor walking-call index (joins to the probe `walkSimSubsteps`). */
  sub: number;
  scale: number | null;
  stanceLabel: string | null;
  plantedFoot: "left" | "right" | null;
  carried: boolean | null;
  advanceMeters: number | null;
  appliedDeltaMeters: number | null;
  mixer: FootstepTapStagePose;
  blend: FootstepTapStagePose;
  post: FootstepTapStagePose;
};

const FOOTSTEP_TAP_KEY = "__openClinXrFootstepTap";
const FOOTSTEP_TAP_LIMIT = 3000;

function tapToeWorld(toe: Object3D | null): { x: number; y: number; z: number } | null {
  if (toe === null) return null;
  toe.updateWorldMatrix(true, false);
  const e = toe.matrixWorld.elements;
  return { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
}

/** Snapshot one tap stage: both toe worlds + slot XZ, reads only. */
export function snapshotFootstepTapStage(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
}): FootstepTapStagePose {
  return {
    left: tapToeWorld(input.leftToe),
    right: tapToeWorld(input.rightToe),
    slotX: input.actorSlot.position.x,
    slotZ: input.actorSlot.position.z,
  };
}

/** Push one per-substep tap record; no-op unless `?footstepPlan=1`. */
export function pushFootstepTapRecord(record: FootstepTapRecord): void {
  if (!readFootstepPlanEnabled()) return;
  const host = globalThis as unknown as Record<string, unknown>;
  const ring = host[FOOTSTEP_TAP_KEY];
  if (Array.isArray(ring)) {
    ring.push(record);
    while (ring.length > FOOTSTEP_TAP_LIMIT) ring.shift();
  } else {
    host[FOOTSTEP_TAP_KEY] = [record];
  }
}

/**
 * Per-walking-frame amplitude blend (post-pose: call after the mixer posed
 * the skeleton, before the closed-loop advance reads the toes). Slerps each
 * cached leg/pelvis bone between its standing rest and the clip's current
 * pose by the plan scale; normalizes (G6 quat norm). No flag, no state, or
 * a non-walking phase returns without touching anything.
 */
export function applyFootstepPlanStep(input: {
  approach: CaseOwnedBedsideApproach;
  routeDx: number;
  routeDz: number;
  routeLength: number;
}): void {
  const { approach } = input;
  if (!readFootstepPlanEnabled()) return;
  if (approach.execution.phase !== "walking" || input.routeLength <= 0) return;
  const state = approach.footstep;
  if (state === null) return;
  for (const entry of state.bones) {
    const clipX = entry.bone.quaternion.x;
    const clipY = entry.bone.quaternion.y;
    const clipZ = entry.bone.quaternion.z;
    const clipW = entry.bone.quaternion.w;
    restQuat.set(entry.rest.x, entry.rest.y, entry.rest.z, entry.rest.w).normalize();
    entry.bone.quaternion.set(clipX, clipY, clipZ, clipW);
    entry.bone.quaternion.slerp(restQuat, 1 - state.scale);
    entry.bone.quaternion.normalize();
  }
  approach.actorSlot.updateMatrixWorld(true);
}
