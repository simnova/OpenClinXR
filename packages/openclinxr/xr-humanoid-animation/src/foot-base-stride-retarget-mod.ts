import type { Object3D } from "three";
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
 * Industry practice for variable stride (Grok rounds 1-4, Johansen 2009,
 * Half-Life: Alyx SIGGRAPH 2021): store each foot's toe path relative to the
 * segment between its footholds offline; at runtime rebuild it between new
 * footholds as the IK target; the stance foot stays fixed at its foothold.
 *
 * Today's actuator (flexion blend toward rest by 1-s plus the closed-loop
 * advance) leaves ~0.079 m/m walking slide at s=0.70 because slide grows
 * with (1-s); this path replaces both calls with per-substep IK targets
 * rebuilt from the generated toe-path rows (`foot-base-path-data-mod.ts`):
 * stance toe target = its foothold (XZ pinned by an exact slot translate,
 * the stance-lock discipline), swing toe target = liftoff + along01 * step
 * + lateral * side + height * up, each leg solved with `solveSteppingLegHinge`
 * (NOT solveTwoBoneIK, NOT CCD — both measured worse on this rig) from a
 * yaw-stable heel target. Pelvis keeps the clip pose: nothing above the hips
 * is written.
 *
 * Default OFF behind `?footBase=1`, and this slice's route only (1.31 m):
 * any other route length falls back to the legacy blend + closed loop, so no
 * flagged-off byte changes. No new public symbol: not re-exported from
 * `./footstep-plan`; the walking tail reads this module by deep import.
 */

export type FootBaseSide = "left" | "right";

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
  foothold: Record<FootBaseSide, { x: number; y: number; z: number }>;
  placed: Record<FootBaseSide, boolean>;
  offsetEntry: Record<FootBaseSide, { offset: { x: number; y: number; z: number }; yaw: number } | null>;
  hingeNormal: Record<FootBaseSide, { x: number; y: number; z: number } | null>;
  wraps: number;
  lastActionTimeS: number | null;
  worst: { missM: number; side: FootBaseSide; sub: number } | null;
  /** Post-solve toe worlds from the previous substep, per foot. */
  lastSolved: Record<FootBaseSide, { x: number; y: number; z: number } | null>;
};

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
    foothold: { left: { ...zero }, right: { ...zero } },
    placed: { left: false, right: false },
    offsetEntry: { left: null, right: null },
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
  let state = states.get(approach);
  if (!state) {
    const labelled = stanceAtTime(clip.labels, actionTimeS);
    const initial: FootBaseSide = labelled.left && !labelled.right
      ? "left"
      : labelled.right && !labelled.left
        ? "right"
        : leftToeW.y <= rightToeW.y ? "left" : "right";
    state = createState(initial);
    states.set(approach, state);
  }
  // LoopRepeat wraps the action time at the clip duration; unwrap for the
  // half index so mid-walk wraps keep counting halves forward.
  if (state.lastActionTimeS !== null && actionTimeS < state.lastActionTimeS - cycleS / 2) state.wraps += 1;
  state.lastActionTimeS = actionTimeS;
  const unwrappedS = actionTimeS + state.wraps * cycleS;

  const labelled = stanceAtTime(clip.labels, actionTimeS);
  const stance: FootBaseSide = labelled.left && !labelled.right
    ? "left"
    : labelled.right && !labelled.left
      ? "right"
      : state.stance;
  const swing: FootBaseSide = stance === "left" ? "right" : "left";

  const slot = approach.actorSlot;
  if (!state.placed.left || !state.placed.right) {
    state.foothold.left = { ...leftToeW };
    state.foothold.right = { ...rightToeW };
    state.placed.left = true;
    state.placed.right = true;
    state.stance = stance;
  } else if (stance !== state.stance) {
    // Handover: the new stance foot plants where it PHYSICALLY stands (last
    // substep's solved position), not where the mixer clip poses it this
    // frame — the clip runs at scale 1 while the rebuild runs at plan scale,
    // so the mixer touchdown reads centimetres off the rebuilt one and
    // adopting it shows up as a one-window slide step (measured 16-26 mm).
    // Planting where the foot is makes handover travel exactly zero; the
    // other foot's foothold is its liftoff point (a pinned foot lifts from
    // where it stood).
    const planted = state.lastSolved[stance] ?? (stance === "left" ? leftToeW : rightToeW);
    state.foothold[stance] = { ...planted };
    state.stance = stance;
  }

  const phase01 = ((((actionTimeS % cycleS) + cycleS) % cycleS) + cycleS) % cycleS / cycleS;
  const stanceRow = footBaseRowAt(stance, phase01 - FOOT_BASE_PLANT_PHASE[stance]);
  const swingRow = footBaseRowAt(swing, phase01 - FOOT_BASE_PLANT_PHASE[swing]);

  const halfIndex = footBaseHalfIndex(unwrappedS, cycleS);
  const scale = approach.footstep?.scale ?? FOOT_BASE_DEFAULT_SCALE;
  const halfTravel = footBaseHalfTravelM(halfIndex, scale);
  const routeLen = Math.hypot(input.routeDx, input.routeDz);
  if (!(routeLen > 0)) return null;
  const unitX = input.routeDx / routeLen;
  const unitZ = input.routeDz / routeLen;
  const floorY = approach.floorOriginY;

  // THE SLOT ADVANCE (measured fix 2026-10-14: pinning the stance toe to a
  // fixed foothold while the executor prescribes its own advance cancels the
  // whole stride and the walk thrashes in place — root 1.39 m for 0.28 m of
  // travel). The body travels the foothold polyline: completed halves plus
  // the current half's share by action time. The stance pin below is then a
  // millimetre correction, not a fight; the executor's travelled/arrival
  // bookkeeping is untouched, so exit and arrival behave as before.
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

  const stanceFoothold = state.foothold[stance];
  const stanceTarget = {
    x: stanceFoothold.x,
    y: floorY + stanceRow.heightM,
    z: stanceFoothold.z,
  };
  const prev = state.foothold[swing];
  const segX = unitX * halfTravel;
  const segZ = unitZ * halfTravel;
  const segLen = Math.abs(halfTravel);
  const sideX = segLen > 1e-9 ? -segZ / segLen : 0;
  const sideZ = segLen > 1e-9 ? segX / segLen : 0;
  const swingTarget = {
    x: prev.x + swingRow.along01 * segX + swingRow.lateralM * sideX,
    y: floorY + swingRow.heightM,
    z: prev.z + swingRow.along01 * segZ + swingRow.lateralM * sideZ,
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
