import type { Object3D } from "three";
import { Quaternion } from "three";
import type { ResolvedBedsideApproach } from "@openclinxr/asset-registry/case-approach-intent";
import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";
import { planFootsteps } from "./footstep-plan-schedule.js";
import {
  parseFootstepPlanEnabled,
  readFootstepPlanEnabled,
  readFootstepProbeModelScale,
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
  // G6 probe: the model seed scales the plan solve only; the correction
  // always runs the TRUE model (that asymmetry is what lets M3 recover).
  const plan = planFootsteps(Math.hypot(routeDx, routeDz), readFootstepProbeModelScale());
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
const clipQuat = new Quaternion();
const deltaQuat = new Quaternion();
const twistQuat = new Quaternion();
const scaledTwist = new Quaternion();
const IDENTITY_QUAT = new Quaternion();

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
export type FootstepTapPelvisPose = {
  pos: { x: number; y: number; z: number };
  quat: { x: number; y: number; z: number; w: number };
} | null;

export type FootstepTapStagePose = {
  left: { x: number; y: number; z: number } | null;
  right: { x: number; y: number; z: number } | null;
  slotX: number;
  slotZ: number;
  /** M1b: pelvis world pose at this stage (rigid-vs-leg split), null off-rig. */
  pelvis: FootstepTapPelvisPose;
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
    pelvis: tapPelvisWorld(input.actorSlot),
  };
}

const tapPelvisCache = new WeakMap<object, Object3D | null>();

/**
 * M1b: pelvis world pose for the rigid-vs-leg split. The pelvis bone is
 * resolved once per actor slot (same `^pelvis` match as the blend set);
 * reads only, null when the rig carries none.
 */
function tapPelvisWorld(actorSlot: Object3D): FootstepTapPelvisPose {
  let pelvis: Object3D | null | undefined;
  if (tapPelvisCache.has(actorSlot)) {
    pelvis = tapPelvisCache.get(actorSlot) ?? null;
  } else {
    pelvis = collectPelvisBones(actorSlot)[0] ?? null;
    tapPelvisCache.set(actorSlot, pelvis);
  }
  if (pelvis === null || pelvis === undefined) return null;
  pelvis.updateWorldMatrix(true, false);
  const pe = pelvis.matrixWorld.elements;
  const pq = pelvis.quaternion;
  return {
    pos: { x: pe[12] ?? 0, y: pe[13] ?? 0, z: pe[14] ?? 0 },
    quat: { x: pq.x, y: pq.y, z: pq.z, w: pq.w },
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

/** One drained per-passing log entry (M5 record shape; the capture tool writes the file). */
export type FootstepPassingRecord = {
  k: number;
  endFoot: "L" | "R";
  scaleUsed: number;
  predictedHalfM: number;
  measuredHalfM: number;
  remainingM: number;
  residualM: number;
  /** Executor walking-call index at the passing. */
  sub: number;
};

const FOOTSTEP_PASSING_KEY = "__openClinXrFootstepPassing";
const FOOTSTEP_PASSING_LIMIT = 64;

const FOOTSTEP_SAFETY_KEY = "__openClinXrFootstepSafety";

/** Push one passing entry; no-op unless `?footstepPlan=1`. */
export function pushFootstepPassingRecord(record: FootstepPassingRecord): void {
  if (!readFootstepPlanEnabled()) return;
  const host = globalThis as unknown as Record<string, unknown>;
  const ring = host[FOOTSTEP_PASSING_KEY];
  if (Array.isArray(ring)) {
    ring.push(record);
    while (ring.length > FOOTSTEP_PASSING_LIMIT) ring.shift();
  } else {
    host[FOOTSTEP_PASSING_KEY] = [record];
  }
}

/** Push one loud safety trip; no-op unless `?footstepPlan=1`. */
export function pushFootstepSafetyRecord(record: { reason: string; travelledM: number; boundM: number }): void {
  if (!readFootstepPlanEnabled()) return;
  const host = globalThis as unknown as Record<string, unknown>;
  const ring = host[FOOTSTEP_SAFETY_KEY];
  if (Array.isArray(ring)) {
    ring.push(record);
  } else {
    host[FOOTSTEP_SAFETY_KEY] = [record];
  }
}

/**
 * Late-correction apply (M3, default OFF, same flag): consume the
 * executor's correction request into the plan state (scale + steps take
 * effect from this passing onward, never inside a half-cycle) and drain
 * the passing log entry plus any loud safety trip to the capture rings.
 * The request is cleared after applying so the next step never re-applies;
 * the executor's correctedAtPassing guard double-covers a missed clear.
 */
export function applyFootstepCorrection(approach: CaseOwnedBedsideApproach): void {
  if (!readFootstepPlanEnabled()) return;
  const state = approach.execution.footstep;
  if (state === null || state === undefined) return;
  if (state.lastPassing !== null) {
    pushFootstepPassingRecord({
      ...state.lastPassing,
      sub: approach.execution.walkSimSubsteps ?? -1,
    });
  }
  const correct = state.correct;
  if (correct !== null) {
    const plan = approach.footstep;
    if (plan !== null) {
      plan.scale = correct.scale;
      plan.steps = correct.steps;
    }
    state.correct = null;
  }
  const trip = state.safetyTrip;
  if (trip !== null && trip.drained !== true) {
    pushFootstepSafetyRecord({ reason: trip.reason, travelledM: trip.travelledM, boundM: trip.boundM });
    trip.drained = true;
  }
}

/**
 * Per-walking-frame amplitude blend (post-pose: call after the mixer posed
 * the skeleton, before the closed-loop advance reads the toes). Blends each
 * cached leg/pelvis bone between its standing rest and the clip's current
 * pose by the plan scale; normalizes (G6 quat norm). No flag, no state, or
 * a non-walking phase returns without touching anything.
 *
 * CREEP M2 (default OFF, same flag): flexion-only blend. Only the twist
 * about each bone's local X — the anatomical flexion axis (shipped-clip
 * decomposition: knee/foot excursion is X-only within 3.4 deg, hip X
 * dominates 2:1 with the off-X yaw/roll carrying the lateral) — is blended
 * toward rest; the off-X yaw/roll stays clip-true. The M1 tap showed the
 * full slerp displacing the planted toe 28.5 mm laterally per substep while
 * the 1-DOF along-route advance follows with 0.00 mm mid-walk error, so the
 * lateral is uncorrectable slide; hinge bones are unaffected (their delta
 * is already X-only). Stride length (hip/knee/foot X) still scales, so
 * travel and arrival keep their geometry; no constants, no IK, no timing.
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
  const t = 1 - state.scale;
  for (const entry of state.bones) {
    clipQuat.set(
      entry.bone.quaternion.x,
      entry.bone.quaternion.y,
      entry.bone.quaternion.z,
      entry.bone.quaternion.w,
    );
    restQuat.set(entry.rest.x, entry.rest.y, entry.rest.z, entry.rest.w).normalize();
    // clip -> rest delta, twist about local X only (flexion); off-X stays clip-true.
    deltaQuat.copy(clipQuat).invert().multiply(restQuat);
    const tn = Math.hypot(deltaQuat.x, deltaQuat.w);
    if (tn > 1e-9) {
      twistQuat.set(deltaQuat.x / tn, 0, 0, deltaQuat.w / tn);
      scaledTwist.copy(IDENTITY_QUAT).slerp(twistQuat, t);
      entry.bone.quaternion.copy(clipQuat).multiply(scaledTwist);
    } else {
      entry.bone.quaternion.copy(clipQuat);
    }
    entry.bone.quaternion.normalize();
  }
  approach.actorSlot.updateMatrixWorld(true);
}
