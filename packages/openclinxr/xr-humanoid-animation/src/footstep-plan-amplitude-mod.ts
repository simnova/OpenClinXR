import type { Object3D } from "three";
import { Quaternion } from "three";
import type { ResolvedBedsideApproach } from "@openclinxr/asset-registry/case-approach-intent";
import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";
import {
  FOOTSTEP_CYCLE_S,
  FOOTSTEP_START_PHASE_S,
  planFootsteps,
} from "./footstep-plan-schedule.js";
import {
  parseFootstepPlanEnabled,
  readFootstepPlanEnabled,
  readFootstepRouteMeters,
} from "./footstep-plan-query-flag-mod.js";
import { extendLocoGroundRoute } from "./loco-ground-tap-mod.js";
import { resolveClipStanceForFrame } from "./stop-clip-playback-mod.js";

/**
 * Footstep-plan S2 stride amplitude (default OFF, `?footstepPlan=1`).
 *
 * Stride must change, not root speed: scaling root advance against an
 * unchanged leg pose is slide by construction (S1 D2). So the plan scales
 * stride AMPLITUDE per leg: each leg holds one scale from its lift-off to
 * its next lift-off (M3), blending its chain between the standing snapshot
 * and the walk clip pose; the closed loop (running after the blend) advances
 * the root by what the SCALED planted foot does.
 *
 * The first half-beat holds 0 (standing = the current pose: no start pop);
 * middles run 1.0; the last carrying step takes the shortfall; two closing
 * halves at 0 bring each leg home in turn while the remaining distance is
 * ~0 (root clamped static: the swing lands beside the stance, no trail, no
 * drag); the walk exits on the plan-complete signal once the beat lands.
 * Pelvis holds scale 0 all walk (one adoption at walk start, zero mid-walk
 * transitions: a shared bone changing scale mid-stance would move the
 * planted foot, so it never changes; home all walk keeps the turn-entry
 * pair centered under the slot instead of inheriting the clip's mid-stride
 * pelvis offset, which alone spread the exit feet 0.15 m wide).
 *
 * Lift-offs come from clip TIME (static lift seconds + action time), never
 * from runtime stance labels: the plan is a pure function of route length
 * and the clock only advances its index. Arms and spine stay at clip weight;
 * toes blend with the legs (positions home too); timeScale, the clip, and
 * the turn are untouched.
 *
 * claimScope: the walking legs' amplitude for one approach while flagged.
 * notEvidenceFor: gait realism, other actors, or unflagged runs (no flag =
 * this module returns before touching anything).
 */

export type FootstepBoneSide = "left" | "right" | "pelvis";

export type FootstepBoneRest = {
  bone: Object3D;
  rest: { x: number; y: number; z: number; w: number };
  side: FootstepBoneSide;
  /** Rest local position (leg chains + toes): the blend lerps positions home too. */
  restLocal: { x: number; y: number; z: number } | null;
};

export type FootstepLegClock = {
  /** Scales in lift-off order (plan timetable). */
  scales: number[];
  /** Elapsed clip seconds of each adoption (plan timetable). */
  atS: number[];
  /** Next adoption index. */
  idx: number;
  /** Scale currently held (adopted at the last lift-off). */
  current: number;
};

export type FootstepPlanState = {
  legs: { left: FootstepLegClock; right: FootstepLegClock };
  /** Pelvis scale, adopted once at walk start and held (see header). */
  pelvisScale: number;
  bones: FootstepBoneRest[];
  /** Unwrapped action time elapsed since walk start, clip seconds. */
  clipElapsed: number;
  /** Previous drive-step action time (unwrap datum), or null before start. */
  prevActionTime: number | null;
  /** Plan-complete exit span, clip seconds from walk start. */
  clipSpan: number;
  /** Whole halves planned (carrying + closing), for the G1 window count. */
  steps: number;
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

function legSide(name: string): "left" | "right" {
  return name.replaceAll(".", "").endsWith("R") ? "right" : "left";
}

/**
 * Walk-entry capture: resolve the plan and pin bone refs + rest pose.
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
    if (bone !== undefined) {
      bones.push({
        bone,
        rest: { ...quat },
        side: legSide(name),
        restLocal: { x: bone.position.x, y: bone.position.y, z: bone.position.z },
      });
    }
  }
  for (const bone of collectPelvisBones(approach.actorSlot)) {
    const q = bone.quaternion;
    bones.push({
      bone,
      rest: { x: q.x, y: q.y, z: q.z, w: q.w },
      side: "pelvis",
      restLocal: { x: bone.position.x, y: bone.position.y, z: bone.position.z },
    });
  }
  // Toe bones plus every leg-chain local: rotations alone leave the feet
  // spread wide at scale 0 (measured 0.34 m lateral vs 0.19 m rest, the hips
  // stay stepped); lerping locals home too lands true standing.
  const toes: Array<{ toe: Object3D | null; local: { x: number; y: number; z: number }; side: "left" | "right" }> = [
    { toe: approach.leftToe, local: rest.toeLeft, side: "left" },
    { toe: approach.rightToe, local: rest.toeRight, side: "right" },
  ];
  for (const { toe, local, side } of toes) {
    if (toe === null) continue;
    const q = toe.quaternion;
    bones.push({ bone: toe, rest: { x: q.x, y: q.y, z: q.z, w: q.w }, side, restLocal: { ...local } });
  }
  const clockFor = (side: "left" | "right"): FootstepLegClock => ({
    scales: plan.legs[side].map((a) => a.scale),
    atS: plan.legs[side].map((a) => a.atS),
    idx: 0,
    current: 0,
  });
  approach.footstep = {
    legs: { left: clockFor("left"), right: clockFor("right") },
    pelvisScale: 0,
    bones,
    clipElapsed: 0,
    prevActionTime: null,
    clipSpan: plan.clipSpanS,
    steps: plan.halves.length,
  };
}

/**
 * Drive-step clock (pre-pose action time, one substep stale like the exit
 * labels): unwrap the action time into elapsed clip seconds and adopt each
 * leg's next scale as the elapsed time crosses its lift-off. Adoptions land
 * while the adopting leg is airborne (lift-off), so a planted foot never
 * moves because of a scale change. No flag, no state, or a non-walking
 * phase returns without touching anything.
 */
export function advanceFootstepPlan(approach: CaseOwnedBedsideApproach): void {
  if (!readFootstepPlanEnabled()) return;
  const state = approach.footstep;
  if (state === null || state === undefined || approach.execution.phase !== "walking") return;
  const at = resolveClipStanceForFrame(approach)?.actionTimeSeconds ?? null;
  if (at === null || !(at >= 0) || !Number.isFinite(at)) return;
  if (state.prevActionTime === null) {
    state.prevActionTime = at;
    state.clipElapsed = Math.max(0, at - FOOTSTEP_START_PHASE_S);
    return;
  }
  let delta = at - state.prevActionTime;
  delta -= Math.round(delta / FOOTSTEP_CYCLE_S) * FOOTSTEP_CYCLE_S;
  if (!(delta >= 0) || delta > FOOTSTEP_CYCLE_S / 2) {
    state.prevActionTime = at;
    return;
  }
  state.prevActionTime = at;
  state.clipElapsed += delta;
  for (const side of ["left", "right"] as const) {
    const leg = state.legs[side];
    while (leg.idx < leg.scales.length && state.clipElapsed >= leg.atS[leg.idx]!) {
      leg.current = leg.scales[leg.idx]!;
      leg.idx += 1;
    }
  }
}

const restQuat = new Quaternion();

/**
 * Per-walking-frame amplitude blend (post-pose: call after the mixer posed
 * the skeleton, before the closed-loop advance reads the toes). Slerps each
 * cached leg/pelvis bone between its standing rest and the clip's current
 * pose by its side's held scale, and lerps toe locals home by the same
 * scale; normalizes (G6 quat norm). No flag, no state, or a non-walking
 * phase returns without touching anything.
 */
export function applyFootstepPlanStep(input: {
  approach: CaseOwnedBedsideApproach;
}): void {
  const { approach } = input;
  if (!readFootstepPlanEnabled()) return;
  if (approach.execution.phase !== "walking") return;
  const state = approach.footstep;
  if (state === null || state === undefined) return;
  for (const entry of state.bones) {
    const scale = entry.side === "pelvis"
      ? state.pelvisScale
      : state.legs[entry.side].current;
    const clipX = entry.bone.quaternion.x;
    const clipY = entry.bone.quaternion.y;
    const clipZ = entry.bone.quaternion.z;
    const clipW = entry.bone.quaternion.w;
    restQuat.set(entry.rest.x, entry.rest.y, entry.rest.z, entry.rest.w).normalize();
    entry.bone.quaternion.set(clipX, clipY, clipZ, clipW);
    entry.bone.quaternion.slerp(restQuat, 1 - scale);
    entry.bone.quaternion.normalize();
    if (entry.restLocal) {
      const px = entry.bone.position.x;
      const py = entry.bone.position.y;
      const pz = entry.bone.position.z;
      entry.bone.position.set(
        entry.restLocal.x + (px - entry.restLocal.x) * scale,
        entry.restLocal.y + (py - entry.restLocal.y) * scale,
        entry.restLocal.z + (pz - entry.restLocal.z) * scale,
      );
    }
  }
  approach.actorSlot.updateMatrixWorld(true);
}
