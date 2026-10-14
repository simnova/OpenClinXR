import type { Object3D } from "three";
import { Quaternion, Vector3 } from "three";
import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";
import {
  FOOTSTEP_R_PASSING_S,
  FOOTSTEP_START_PHASE_S,
  FOOTSTEP_TRAVEL_COEFFS,
} from "./footstep-plan-schedule.js";
import { readFootBaseEnabled } from "./foot-base-query-flag-mod.js";
import {
  FOOT_BASE_PLANT_PHASE,
  FOOT_BASE_ROWS,
  type FootBasePathRow,
} from "./foot-base-path-data-mod.js";
import {
  stanceAtTime,
  type LocomotionStanceLabels,
} from "./locomotion-stance-labels.js";
import {
  findSteppingLegChain,
  heelTargetForToeTargetStable,
  solveSteppingLegHinge,
} from "./stepping-turn-leg-ik-mod.js";

/**
 * Foot-base stride retargeting for the walking phase (foot-base slice, SC-05).
 *
 * Industry practice for variable stride (Johansen 2009, Alyx SIGGRAPH 2021):
 * each foot's toe path stored relative to its foothold segment offline,
 * rebuilt between new footholds as the IK target; stance fixed at foothold.
 * Replaces the amplitude blend plus closed-loop advance per substep: stance
 * toe target = its foothold (XZ pinned by an exact slot translate), swing =
 * liftoff + along01 * step + lateral * side + height * up, each leg solved
 * with `solveSteppingLegHinge` from a yaw-stable heel target. Pelvis keeps
 * the clip pose. Stance follows the clip labels with a 6-substep handover
 * dwell (labels flap up to 4 substeps at the wrap; the metric reads the same
 * lock labels, so pin and metric stance coincide). Feet freeze
 * yaw-compensated beside the offset, else ankle articulation invalidates it
 * by centimetres. Handovers anchor to the solved foot (zero travel).
 *
 * Default OFF behind `?footBase=1`, 1.31 m route only; not re-exported from
 * `./footstep-plan` (no new public symbol, deep import from the tail).
 */

export type FootBaseSide = "left" | "right";

/** World up axis for the yaw-compensated foot freeze. */
const Y_AXIS = new Vector3(0, 1, 0);

/** This slice's route length in metres: the foot-base path runs here only. */
export const FOOT_BASE_ROUTE_LENGTH_M = 1.31;

/** Route match tolerance in metres (exact scene route is 1.31). */
export const FOOT_BASE_ROUTE_TOLERANCE_M = 0.005;

/**
 * Solved 1.31 m plan scale (planFootsteps: 3 halves, (1.31 - 0.4156) / 1.265):
 * the foothold spacing when no live plan state is captured (flag without plan).
 */
export const FOOT_BASE_DEFAULT_SCALE = 0.707;

export type FootBaseApproachState = Pick<
  CaseOwnedBedsideApproach,
  "actorSlot" | "leftToe" | "rightToe" | "floorOriginY" | "footstep" | "execution" | "lockArmed" | "start"
>;

export type FootBaseClipRead = {
  labels: LocomotionStanceLabels;
  actionTimeSeconds: number;
};

export type FootBaseState = {
  stance: FootBaseSide;
  /** Handover dwell: candidate stance plus consecutive substeps seen (null when settled). */
  pending: { side: FootBaseSide; count: number } | null;
  foothold: Record<FootBaseSide, { x: number; y: number; z: number }>;
  placed: Record<FootBaseSide, boolean>;
  /**
   * Takeoff reference per foot, captured on role change (init/handover):
   * physical position, absolute rebuild there, row height there. Targets
   * follow rebuild DELTAS from the physical takeoff, so role changes are
   * continuous even when rows and labels disagree; the constant offset
   * re-anchors every handover and never accumulates.
   */
  takeoff: Record<
    FootBaseSide,
    { origin: { x: number; y: number; z: number }; absBase: { x: number; y: number; z: number }; baseH: number } | null
  >;
  offsetEntry: Record<FootBaseSide, { offset: { x: number; y: number; z: number }; yaw: number } | null>;
  /** Entry foot world orientation per foot (yaw-compensated freeze, stepping-turn discipline). */
  footQuat: Record<FootBaseSide, { q: { x: number; y: number; z: number; w: number }; yaw: number } | null>;
  hingeNormal: Record<FootBaseSide, { x: number; y: number; z: number } | null>;
  wraps: number;
  lastActionTimeS: number | null;
  worst: { missM: number; side: FootBaseSide; sub: number } | null;
  /** Post-solve toe worlds from the previous substep, per foot. */
  lastSolved: Record<FootBaseSide, { x: number; y: number; z: number } | null>;
};

/**
 * Handover dwell in consecutive substeps. Runtime labels flap up to 4
 * substeps at the wrap (measured 2-frame blips); real stance persists 15+.
 */
export const FOOT_BASE_HANDOVER_DWELL_SUBSTEPS = 6;

export type FootBaseStepSummary = {
  stanceFoot: FootBaseSide;
  phase01: number;
  halfIndex: number;
  stanceMissM: number | null;
  swingMissM: number | null;
};

const states = new WeakMap<object, FootBaseState>();

/** Read this approach's foot-base state (tests); null before the first step. */
export function readFootBaseState(approach: object): FootBaseState | null {
  return states.get(approach) ?? null;
}

/** Drop this approach's foot-base state (tests). */
export function clearFootBaseState(approach: object): void {
  states.delete(approach);
}

/** Gate twin: flag on and this slice's route length only. */
export function footBaseStepIsActive(routeLengthMeters: number): boolean {
  return readFootBaseEnabled()
    && Math.abs(routeLengthMeters - FOOT_BASE_ROUTE_LENGTH_M) <= FOOT_BASE_ROUTE_TOLERANCE_M;
}

/** Plant-relative phase of one foot at this loop phase. */
export function footBaseRelPhase(side: FootBaseSide, phase01: number): number {
  const rel = (phase01 - FOOT_BASE_PLANT_PHASE[side]) % 1;
  return ((rel % 1) + 1) % 1;
}

/** Interpolated toe-path row for one foot at its plant-relative phase. */
export function footBaseRowAt(side: FootBaseSide, relPhase01: number): FootBasePathRow {
  const rows = FOOT_BASE_ROWS[side];
  const last = rows.length - 1;
  const wrapped = (((relPhase01 % 1) + 1) % 1 + 1) % 1;
  const f = Math.min(Math.max(wrapped, 0), 1) * last;
  const i0 = Math.min(Math.floor(f), last - 1);
  const fr = f - i0;
  const a = rows[i0]!;
  const b = rows[i0 + 1]!;
  return {
    phase: a.phase + (b.phase - a.phase) * fr,
    along01: a.along01 + (b.along01 - a.along01) * fr,
    lateralM: a.lateralM + (b.lateralM - a.lateralM) * fr,
    heightM: a.heightM + (b.heightM - a.heightM) * fr,
    yawRad: a.yawRad + (b.yawRad - a.yawRad) * fr,
  };
}

/**
 * 1-based passing-to-passing half containing this unwrapped action time.
 * Halves start at the walk-start passing (L, 0.55 s) and alternate R-end /
 * L-end from there, matching planFootsteps' odd-R/even-L convention.
 */
export function footBaseHalfIndex(unwrappedActionTimeS: number, cycleS: number): number {
  if (!(cycleS > 0)) return 1;
  for (let half = 1; half <= 1000; half += 1) {
    const end = half % 2 === 1
      ? FOOTSTEP_R_PASSING_S + ((half - 1) / 2) * cycleS
      : FOOTSTEP_START_PHASE_S + (half / 2) * cycleS;
    if (unwrappedActionTimeS < end) return half;
  }
  return 1000;
}

/** This half's ground travel at stride scale s, from the per-foot affines. */
export function footBaseHalfTravelM(halfIndex: number, scale: number): number {
  const c = FOOTSTEP_TRAVEL_COEFFS;
  return halfIndex % 2 === 1 ? c.aEndR * scale + c.bEndR : c.aEndL * scale + c.bEndL;
}

/**
 * Action-time bounds of one passing-to-passing half: half 1 opens at the
 * walk-start passing; every half opens where the previous one ended.
 */
export function footBaseHalfBounds(halfIndex: number, cycleS: number): { start: number; end: number } {
  const endOf = (half: number): number =>
    half % 2 === 1
      ? FOOTSTEP_R_PASSING_S + ((half - 1) / 2) * cycleS
      : FOOTSTEP_START_PHASE_S + (half / 2) * cycleS;
  return {
    start: halfIndex <= 1 ? FOOTSTEP_START_PHASE_S : endOf(halfIndex - 1),
    end: endOf(Math.max(halfIndex, 1)),
  };
}

function toeWorldNow(toe: Object3D | null): { x: number; y: number; z: number } | null {
  if (toe === null) return null;
  toe.updateWorldMatrix(true, false);
  const e = toe.matrixWorld.elements;
  return { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
}

function heelWorldNow(chain: { heel: Object3D; toe: Object3D }): {
  heel: { x: number; y: number; z: number };
  toe: { x: number; y: number; z: number };
} {
  chain.heel.updateMatrixWorld(true);
  chain.toe.updateMatrixWorld(true);
  const he = chain.heel.matrixWorld.elements;
  const te = chain.toe.matrixWorld.elements;
  return {
    heel: { x: he[12] ?? 0, y: he[13] ?? 0, z: he[14] ?? 0 },
    toe: { x: te[12] ?? 0, y: te[13] ?? 0, z: te[14] ?? 0 },
  };
}

function createState(stance: FootBaseSide): FootBaseState {
  const zero = { x: 0, y: 0, z: 0 };
  return {
    stance,
    pending: null,
    foothold: { left: { ...zero }, right: { ...zero } },
    placed: { left: false, right: false },
    takeoff: { left: null, right: null },
    offsetEntry: { left: null, right: null },
    footQuat: { left: null, right: null },
    hingeNormal: { left: null, right: null },
    wraps: 0,
    lastActionTimeS: null,
    worst: null,
    lastSolved: { left: null, right: null },
  };
}

/**
 * One walking substep of foot-base stride retargeting. Null unless the flag
 * is on, the route is this slice's, the phase is walking, and a clip read is
 * supplied: every other case runs the legacy path untouched.
 *
 * The slot advance follows the foothold polyline: the body travels completed
 * halves plus the current half's share by action time (SET, not incremented —
 * the executor prescribed its own advance pre-lock). After solving the stance
 * leg, the slot is translated XZ so the stance toe coincides with its
 * foothold exactly, and the swing leg is solved after the pin — so the swing
 * lands on its rebuilt target while the stance stays exact. The executor's
 * own travelled/arrival bookkeeping is untouched, so exit and arrival behave
 * as before.
 */
export function applyFootBaseStep(input: {
  approach: FootBaseApproachState;
  routeDx: number;
  routeDz: number;
  routeLength: number;
  clip: FootBaseClipRead | null;
}): FootBaseStepSummary | null {
  const { approach, routeLength } = input;
  if (!footBaseStepIsActive(routeLength)) return null;
  if (approach.execution.phase !== "walking" || routeLength <= 0) return null;
  // The first walking frame still holds the idle pose (the lock skips it and
  // anchors on the next one): recording footholds off it would plant them up
  // to half a metre from the clip's own feet.
  if (!approach.lockArmed) return null;
  const clip = input.clip;
  if (clip === null || !(clip.labels.cycleSeconds > 0) || !Number.isFinite(clip.actionTimeSeconds)) return null;
  const leftToeW = toeWorldNow(approach.leftToe);
  const rightToeW = toeWorldNow(approach.rightToe);
  if (leftToeW === null || rightToeW === null) return null;

  const cycleS = clip.labels.cycleSeconds;
  const actionTimeS = clip.actionTimeSeconds;
  const phase01 = ((((actionTimeS % cycleS) + cycleS) % cycleS) + cycleS) % cycleS / cycleS;
  // Labels-driven stance with handover dwell: single support crowns
  // immediately; a challenger must persist FOOT_BASE_HANDOVER_DWELL_SUBSTEPS
  // consecutive substeps (flaps last 4, real stance 15+). The metric's
  // stance windows read the same lock labels, so pin stance and metric
  // stance coincide by construction.
  const labelled = stanceAtTime(clip.labels, actionTimeS);
  const single: FootBaseSide | null = labelled.left && !labelled.right
    ? "left"
    : labelled.right && !labelled.left
      ? "right"
      : null;
  let state = states.get(approach);
  if (!state) {
    const initial: FootBaseSide = single ?? (leftToeW.y <= rightToeW.y ? "left" : "right");
    state = createState(initial);
    states.set(approach, state);
  }
  // LoopRepeat wraps the action time at the clip duration; unwrap for the
  // half index so mid-walk wraps keep counting halves forward.
  if (state.lastActionTimeS !== null && actionTimeS < state.lastActionTimeS - cycleS / 2) state.wraps += 1;
  state.lastActionTimeS = actionTimeS;
  const unwrappedS = actionTimeS + state.wraps * cycleS;

  const stance: FootBaseSide = (() => {
    const st = state;
    if (single === null || single === st.stance) {
      st.pending = null;
      return st.stance;
    }
    const pending = st.pending;
    if (pending !== null && pending.side === single) {
      const count = pending.count + 1;
      if (count >= FOOT_BASE_HANDOVER_DWELL_SUBSTEPS) {
        st.pending = null;
        return single;
      }
      st.pending = { side: single, count };
      return st.stance;
    }
    st.pending = { side: single, count: 1 };
    return st.stance;
  })();
  const swing: FootBaseSide = stance === "left" ? "right" : "left";

  const halfIndex = footBaseHalfIndex(unwrappedS, cycleS);
  const scale = approach.footstep?.scale ?? FOOT_BASE_DEFAULT_SCALE;
  const halfTravel = footBaseHalfTravelM(halfIndex, scale);
  const routeLen = Math.hypot(input.routeDx, input.routeDz);
  if (!(routeLen > 0)) return null;
  const unitX = input.routeDx / routeLen;
  const unitZ = input.routeDz / routeLen;
  const floorY = approach.floorOriginY;

  const slot = approach.actorSlot;
  const segX = unitX * halfTravel;
  const segZ = unitZ * halfTravel;
  const segLen = Math.abs(halfTravel);
  const sideX = segLen > 1e-9 ? -segZ / segLen : 0;
  const sideZ = segLen > 1e-9 ? segX / segLen : 0;

  const rebuildAbsolute = (foot: FootBaseSide, row: FootBasePathRow): { x: number; y: number; z: number } => {
    const from = state.foothold[foot];
    return {
      x: from.x + row.along01 * segX + row.lateralM * sideX,
      y: floorY + row.heightM,
      z: from.z + row.along01 * segZ + row.lateralM * sideZ,
    };
  };
  const stanceRow = footBaseRowAt(stance, footBaseRelPhase(stance, phase01));
  const swingRow = footBaseRowAt(swing, footBaseRelPhase(swing, phase01));
  const snapTakeoff = (foot: FootBaseSide, row: FootBasePathRow): void => {
    const physical = foot === "left" ? leftToeW : rightToeW;
    const solved = state.lastSolved[foot] ?? physical;
    state.takeoff[foot] = {
      origin: { ...solved },
      absBase: rebuildAbsolute(foot, row),
      baseH: row.heightM,
    };
  };

  if (!state.placed.left || !state.placed.right) {
    state.foothold.left = { ...leftToeW };
    state.foothold.right = { ...rightToeW };
    state.placed.left = true;
    state.placed.right = true;
    state.stance = stance;
    snapTakeoff("left", footBaseRowAt("left", footBaseRelPhase("left", phase01)));
    snapTakeoff("right", footBaseRowAt("right", footBaseRelPhase("right", phase01)));
  } else if (stance !== state.stance) {
    // Handover: plant where the foot PHYSICALLY stands (last solved pos),
    // not the mixer pose (clip scale 1 vs rebuild plan scale reads cm off;
    // measured 16-26 mm window steps). Both feet re-snap takeoff refs, so
    // targets stay continuous across the role change (see below).
    const planted = state.lastSolved[stance] ?? (stance === "left" ? leftToeW : rightToeW);
    state.foothold[stance] = { ...planted };
    state.stance = stance;
    snapTakeoff(stance, stanceRow);
    snapTakeoff(swing, swingRow);
  }

  const stanceFoothold = state.foothold[stance];
  // THE SLOT ADVANCE: the body travels the foothold polyline (completed
  // halves plus the current half's share). Pinning against the executor's
  // own advance cancels the stride and the walk thrashes (measured root
  // 1.39 m for 0.28 m travel); the pin below is then a mm correction.
  let bodyTravelM = 0;
  for (let h = 1; h < halfIndex; h += 1) bodyTravelM += footBaseHalfTravelM(h, scale);
  const bounds = footBaseHalfBounds(halfIndex, cycleS);
  const halfSpan = bounds.end - bounds.start;
  const halfFrac = halfSpan > 0
    ? Math.min(Math.max((unwrappedS - bounds.start) / halfSpan, 0), 1)
    : 0;
  bodyTravelM += halfTravel * halfFrac;
  slot.position.x = approach.start.x + unitX * bodyTravelM;
  slot.position.z = approach.start.z + unitZ * bodyTravelM;
  slot.updateMatrixWorld(true);

  // Takeoff-relative targets: absolute rebuild DELTAS from the handover
  // value on the physical takeoff (constant offset per swing, re-anchored
  // next handover). Stance XZ is an absolute pin; stance Y rides the row
  // height delta from the handover height.
  const stanceTakeoff = state.takeoff[stance];
  const swingTakeoff = state.takeoff[swing];
  const stanceTarget = {
    x: stanceFoothold.x,
    y: stanceFoothold.y + (stanceRow.heightM - (stanceTakeoff?.baseH ?? stanceRow.heightM)),
    z: stanceFoothold.z,
  };
  const swingAbsolute = rebuildAbsolute(swing, swingRow);
  const swingTarget = swingTakeoff === null
    ? swingAbsolute
    : {
        x: swingTakeoff.origin.x + (swingAbsolute.x - swingTakeoff.absBase.x),
        y: swingTakeoff.origin.y + (swingAbsolute.y - swingTakeoff.absBase.y),
        z: swingTakeoff.origin.z + (swingAbsolute.z - swingTakeoff.absBase.z),
      };

  const sub = (approach.execution as { walkSimSubsteps?: number | null }).walkSimSubsteps ?? -1;
  let stanceMissM: number | null = null;
  let swingMissM: number | null = null;
  const yawNow = slot.rotation.y;
  const poleWorld = { x: Math.sin(yawNow), y: 0, z: Math.cos(yawNow) };

  for (const side of [stance, swing] as const) {
    const chain = findSteppingLegChain(slot, side);
    if (chain === null) continue;
    let captured = state.offsetEntry[side];
    if (captured === null) {
      const ends = heelWorldNow(chain);
      captured = {
        offset: {
          x: ends.toe.x - ends.heel.x,
          y: ends.toe.y - ends.heel.y,
          z: ends.toe.z - ends.heel.z,
        },
        yaw: yawNow,
      };
      state.offsetEntry[side] = captured;
    }
    if (state.footQuat[side] === null) {
      // Freeze the foot's WORLD orientation beside the offset (stepping-turn
      // discipline): the mixer's ankle articulation otherwise invalidates
      // the entry offset by centimetres (measured ~5 cm stance misses).
      const parentQ = new Quaternion();
      if (chain.heel.parent) chain.heel.parent.getWorldQuaternion(parentQ);
      else parentQ.identity();
      parentQ.normalize();
      const localQ = chain.heel.quaternion;
      const worldQ = parentQ.clone().multiply(localQ).normalize();
      state.footQuat[side] = {
        q: { x: worldQ.x, y: worldQ.y, z: worldQ.z, w: worldQ.w },
        yaw: yawNow,
      };
    }
    const toeTarget = side === stance ? stanceTarget : swingTarget;
    const heelTarget = heelTargetForToeTargetStable({
      toeTargetWorld: toeTarget,
      slotYawRadians: yawNow,
      offsetEntry: captured.offset,
      offsetYawRadians: captured.yaw,
    });
    const solved = solveSteppingLegHinge({
      chain,
      heelTargetWorld: heelTarget,
      poleWorld,
      midRestQuats: null,
      previousBendNormal: state.hingeNormal[side],
    });
    if (solved.bendNormal !== null) state.hingeNormal[side] = solved.bendNormal;
    const frozen = state.footQuat[side];
    if (frozen !== null) {
      const parentQ = new Quaternion();
      if (chain.heel.parent) chain.heel.parent.getWorldQuaternion(parentQ);
      else parentQ.identity();
      parentQ.normalize();
      const yawDelta = new Quaternion().setFromAxisAngle(Y_AXIS, yawNow - frozen.yaw);
      const wantWorld = yawDelta.multiply(
        new Quaternion(frozen.q.x, frozen.q.y, frozen.q.z, frozen.q.w),
      ).normalize();
      chain.heel.quaternion.copy(parentQ.invert().multiply(wantWorld)).normalize();
      chain.heel.updateMatrixWorld(true);
    }
    if (side === stance) {
      stanceMissM = solved.missM;
      // THE SLOT ADVANCE: exact rigid translate of the stance toe onto its
      // foothold (stance-lock discipline). The swing is solved after this pin.
      const toeNow = toeWorldNow(side === "left" ? approach.leftToe : approach.rightToe);
      if (toeNow !== null) {
        slot.position.x += stanceFoothold.x - toeNow.x;
        slot.position.z += stanceFoothold.z - toeNow.z;
        slot.updateMatrixWorld(true);
      }
    } else {
      swingMissM = solved.missM;
    }
    const worst = state.worst;
    if (worst === null || solved.missM > worst.missM) {
      state.worst = { missM: solved.missM, side, sub };
    }
  }
  slot.updateMatrixWorld(true);
  const solvedLeft = toeWorldNow(approach.leftToe);
  const solvedRight = toeWorldNow(approach.rightToe);
  if (solvedLeft !== null) state.lastSolved.left = solvedLeft;
  if (solvedRight !== null) state.lastSolved.right = solvedRight;
  return { stanceFoot: stance, phase01, halfIndex, stanceMissM, swingMissM };
}
