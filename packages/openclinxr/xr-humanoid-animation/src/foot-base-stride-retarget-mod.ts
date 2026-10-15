import type { Object3D } from "three";
import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";
import { FOOTSTEP_START_PHASE_S } from "./footstep-plan-schedule.js";
import { readFootBaseEnabled } from "./foot-base-query-flag-mod.js";
import type { FootBasePathRow } from "./foot-base-path-data-mod.js";
import type { LocomotionStanceLabels } from "./locomotion-stance-labels.js";
import {
  FOOT_BASE_HEIGHT_DATUM,
  FOOT_BASE_LIFT_PHASE,
  FOOT_BASE_STANCE_FRACTION,
  footBaseHalfBounds,
  footBaseHalfIndex,
  footBaseHalfTravelM,
  footBaseRelPhase,
  footBaseRowAt,
  footBaseScheduleStance,
  type FootBaseSide,
} from "./foot-base-schedule-mod.js";
import {
  findSteppingLegChain,
  heelTargetForToeTargetStable,
  solveSteppingLegHinge,
} from "./stepping-turn-leg-ik-mod.js";

/**
 * Schedule/role math lives in `./foot-base-schedule-mod.js` (split out for
 * the 500-line zone budget); the names are re-exported here so existing deep
 * importers keep working. Behaviour is unchanged.
 */
export {
  FOOT_BASE_HEIGHT_DATUM,
  FOOT_BASE_LIFT_PHASE,
  FOOT_BASE_STANCE_FRACTION,
  footBaseHalfBounds,
  footBaseHalfIndex,
  footBaseHalfTravelM,
  footBaseRelPhase,
  footBaseRowAt,
  footBaseScheduleStance,
  type FootBaseSide,
};

/**
 * Foot-base stride retargeting for the walking phase (foot-base slice, SC-05).
 *
 * Industry practice for variable stride (Johansen 2009, Alyx SIGGRAPH 2021):
 * each foot's toe path stored relative to its foothold segment offline,
 * rebuilt between new footholds as the IK target; stance fixed at foothold.
 * Replaces the amplitude blend plus closed-loop advance per substep: stance
 * toe target = its foothold (XZ pinned by an exact slot translate, height
 * = floor + the plant-toe datum + the stride-scaled row excursion — the
 * rows are plant-relative, not floor-absolute); swing = the foot's own
 * liftoff-to-touchdown segment swept by swing-phase progress (along01 is
 * the documented 0-at-liftoff/1-at-touchdown fraction, heights likewise
 * datum-anchored and stride-scaled), each leg solved with
 * `solveSteppingLegHinge` from a yaw-stable heel target. Pelvis keeps the
 * clip pose. Raw cruise-shape rows applied floor-absolute and
 * stance-relative put targets outside the short-stride reachable envelope
 * (footbase-5: buried stance ~5 cm deep, swing drag 0.6 m behind the hip
 * vs a 0.735 m leg), and the analytic hinge takes the straightest reaching
 * shape — both knees locked straight and the body yanked ahead of the feet.
 *
 * ROLES COME ONLY FROM THE FOOTHOLD SCHEDULE, never from the observe-only
 * stance lock (the lock flaps every 2-4 frames early in the walk; each flap
 * used to freeze the swing foot via the stance pin while the rows marched on,
 * losing ~8 cm of row progress per flap). Each foot's plant-relative phase at
 * the clip time pins it to its foothold over exactly its contact interval
 * (plant-to-lift from physician-walk-contact-phases.json) and lets it follow
 * the swing path otherwise — so in double support BOTH feet pin (each over
 * its own interval; pinning only the most-recent plant dragged the still
 * planted co-stance foot backward ~15 cm per double support). The single
 * crown (most-recent plant, a pure function of phase: one crown change per
 * plant boundary, none between, no hysteresis, no dwell) names the summary
 * stance and orders the slot pin. Footholds are fixed when the plan is built: the
 * entry pair from the physical feet, every later plant one plan step ahead of
 * the other foothold on the planting foot's home side — never re-snapped to
 * the physical landing foot, so swing-IK miss cannot bake into the next
 * foothold. Targets are absolute rebuilds (no takeoff-relative deltas).
 *
 * The plan datum is anchored to walking entry (halves/body travel count route
 * progress since the first active substep, not clip absolute time). The heel
 * offset is re-read from the pre-solve leg every substep, once per foot
 * before its solve (exogenous clip truth, no feedback, no solve-twice: the
 * second pass was measured not converging the 3-5 cm swing miss).
 *
 * Default OFF behind `?footBase=1`, 1.31 m route only; not re-exported from
 * `./footstep-plan` (no new public symbol, deep import from the tail).
 */

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
  "actorSlot" | "leftToe" | "rightToe" | "floorOriginY" | "footstep" | "execution" | "lockArmed" | "start" | "lock"
>;

export type FootBaseClipRead = {
  labels: LocomotionStanceLabels;
  actionTimeSeconds: number;
};

export type FootBaseState = {
  stance: FootBaseSide;
  foothold: Record<FootBaseSide, { x: number; y: number; z: number }>;
  placed: Record<FootBaseSide, boolean>;
  /**
   * Home side coordinate per foot (side-unit projection at entry), so a
   * plan-built plant lands on the planting foot's own side of the route.
   */
  sideHome: Record<FootBaseSide, number>;
  offsetEntry: Record<FootBaseSide, { offset: { x: number; y: number; z: number }; yaw: number } | null>;
  hingeNormal: Record<FootBaseSide, { x: number; y: number; z: number } | null>;
  wraps: number;
  lastActionTimeS: number | null;
  /**
   * Walking-entry anchor for the plan datum (unwrapped action seconds at the
   * first active substep). Halves, body travel and handover footholds measure
   * route progress since entry, not clip absolute time: the first captured
   * walking frame already carries played action, and absolute-time travel led
   * the feet by centimetres from substep one. Null until the first step.
   */
  entryUnwrappedS: number | null;
  worst: { missM: number; side: FootBaseSide; sub: number } | null;
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
    sideHome: { left: 0, right: 0 },
    offsetEntry: { left: null, right: null },
    hingeNormal: { left: null, right: null },
    wraps: 0,
    lastActionTimeS: null,
    entryUnwrappedS: null,
    worst: null,
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
  // ROLES FROM THE SCHEDULE ONLY. The observe-only stance lock is not read
  // here at all: it flaps every 2-4 frames early in the walk, and each flap
  // used to freeze the swing foot via the stance pin while the rows marched
  // on (~8 cm of row progress lost per flap). footBaseScheduleStance is a pure
  // function of clip phase: one role change per plant boundary, none between.
  const scheduled: FootBaseSide = footBaseScheduleStance(phase01);
  let state = states.get(approach);
  if (!state) {
    state = createState(scheduled);
    states.set(approach, state);
  }
  // LoopRepeat wraps the action time at the clip duration; unwrap for the
  // half index so mid-walk wraps keep counting halves forward.
  if (state.lastActionTimeS !== null && actionTimeS < state.lastActionTimeS - cycleS / 2) state.wraps += 1;
  state.lastActionTimeS = actionTimeS;
  const unwrappedS = actionTimeS + state.wraps * cycleS;

  // Plan datum, anchored to walking entry. Halves and body travel measure
  // route progress since the walk started: planS = 0 at entry maps onto the
  // plan's walk-start passing (FOOTSTEP_START_PHASE_S), so bodyTravelM opens
  // at 0 under the physical feet instead of ~9 cm ahead of them. Clip phase
  // (phase01/rows above) keeps absolute action time: rows follow the clip.
  if (state.entryUnwrappedS === null) state.entryUnwrappedS = unwrappedS;
  const planShiftedS = unwrappedS - state.entryUnwrappedS + FOOTSTEP_START_PHASE_S;
  const halfIndex = footBaseHalfIndex(planShiftedS, cycleS);
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

  // THE SLOT ADVANCE: the body travels the foothold polyline (completed
  // halves plus the current half's share). Pinning against the executor's
  // own advance cancels the stride and the walk thrashes (measured root
  // 1.39 m for 0.28 m travel); the pin below is then a mm correction.
  let bodyTravelM = 0;
  for (let h = 1; h < halfIndex; h += 1) bodyTravelM += footBaseHalfTravelM(h, scale);
  const bounds = footBaseHalfBounds(halfIndex, cycleS);
  const halfSpan = bounds.end - bounds.start;
  const halfFrac = halfSpan > 0
    ? Math.min(Math.max((planShiftedS - bounds.start) / halfSpan, 0), 1)
    : 0;
  bodyTravelM += halfTravel * halfFrac;

  const rowNow = (foot: FootBaseSide): FootBasePathRow =>
    footBaseRowAt(foot, footBaseRelPhase(foot, phase01));
  const sideCoord = (p: { x: number; z: number }): number =>
    (p.x - approach.start.x) * sideX + (p.z - approach.start.z) * sideZ;

  if (!state.placed.left || !state.placed.right) {
    // Plan build: the entry pair comes from the physical feet (the only
    // physical read footholds ever take); every later plant is plan geometry.
    state.foothold.left = { ...leftToeW };
    state.foothold.right = { ...rightToeW };
    state.sideHome.left = sideCoord(leftToeW);
    state.sideHome.right = sideCoord(rightToeW);
    state.placed.left = true;
    state.placed.right = true;
    state.stance = scheduled;
  } else if (scheduled !== state.stance) {
    // Schedule handover, immediate, plan-built: the planting foot lands one
    // plan step ahead of the other foothold on its own home side. No
    // physical re-snap (landing error used to bake into the next foothold),
    // no dwell, no hysteresis: the handover fires exactly at the schedule's
    // plant boundary whatever the lock says.
    const other: FootBaseSide = scheduled === "left" ? "right" : "left";
    const otherAlong = (state.foothold[other].x - approach.start.x) * unitX
      + (state.foothold[other].z - approach.start.z) * unitZ;
    const plantAlong = otherAlong + halfTravel;
    state.foothold[scheduled] = {
      x: approach.start.x + unitX * plantAlong + sideX * state.sideHome[scheduled],
      y: floorY,
      z: approach.start.z + unitZ * plantAlong + sideZ * state.sideHome[scheduled],
    };
    state.stance = scheduled;
  }

  // Roles derive from post-handover state. The crown (most-recent plant)
  // names the summary stance; the PIN SET is every foot inside its own
  // contact interval — in double support both feet pin, each to its own
  // foothold. The empty set (absent from the shipped clip) falls back to the
  // crown so one foot always stays grounded.
  const stance: FootBaseSide = state.stance;
  const swing: FootBaseSide = stance === "left" ? "right" : "left";
  const leftIn = footBaseRelPhase("left", phase01) < FOOT_BASE_STANCE_FRACTION.left;
  const rightIn = footBaseRelPhase("right", phase01) < FOOT_BASE_STANCE_FRACTION.right;
  const pinned: FootBaseSide[] =
    leftIn || rightIn
      ? (["left", "right"] as const).filter((side) => (side === "left" ? leftIn : rightIn))
      : [stance];
  const ordered: FootBaseSide[] = [
    ...pinned.filter((side) => side === stance),
    ...pinned.filter((side) => side !== stance),
    ...((["left", "right"] as const).filter((side) => !pinned.includes(side))),
  ];
  const swingRow = rowNow(swing);

  const stanceFoothold = state.foothold[stance];
  // The slot advance follows the entry-anchored foothold polyline
  // (bodyTravelM above); the pin below is then a mm correction.
  slot.position.x = approach.start.x + unitX * bodyTravelM;
  slot.position.z = approach.start.z + unitZ * bodyTravelM;
  slot.updateMatrixWorld(true);

  // Absolute targets, rebuilt per the rows' documented contract (footbase-5).
  // Heights are plant-relative ("toe Y minus this stance's plant toe Y"), so
  // the absolute target is floorY + the plant-toe datum + the stride-scaled
  // excursion: reading heightM raw above the floor buried stance ~5 cm deep
  // and arced the swing at full cruise height, both outside the short-stride
  // reachable envelope (analytic hinge = straightest reaching shape).
  // Fore-aft, along01 is the documented liftoff-to-touchdown fraction (0 at
  // liftoff, 1 at touchdown), so the swing runs from the foot's own liftoff
  // foothold to its touchdown plant by swing-phase progress — never as
  // (along01 x 2 - 1) about the stance foothold, which both jumped ~9 cm at
  // liftoff when consecutive halves travel differently and replayed the
  // cruise toe-off drag 0.6 m behind the hip (unreachable: leg 0.735 m).
  // Touchdown uses the half travel of the half containing the plant (exact
  // coincidence with the handover plant even when the half index advances
  // mid-swing), so touchdown and handover still coincide with no snap.
  const pinTargetFor = (side: FootBaseSide): { x: number; y: number; z: number } => ({
    x: state.foothold[side].x,
    y: floorY + FOOT_BASE_HEIGHT_DATUM[side] + scale * rowNow(side).heightM,
    z: state.foothold[side].z,
  });
  const stanceAlong = (stanceFoothold.x - approach.start.x) * unitX
    + (stanceFoothold.z - approach.start.z) * unitZ;
  const swingRel = footBaseRelPhase(swing, phase01);
  const swingLiftRel = FOOT_BASE_STANCE_FRACTION[swing];
  const swingProgress = Math.min(Math.max((swingRel - swingLiftRel) / (1 - swingLiftRel), 0), 1);
  const liftoffAlong = (state.foothold[swing].x - approach.start.x) * unitX
    + (state.foothold[swing].z - approach.start.z) * unitZ;
  const touchdownHalf = footBaseHalfIndex(planShiftedS + (1 - swingRel) * cycleS, cycleS);
  const touchdownAlong = stanceAlong + footBaseHalfTravelM(touchdownHalf, scale);
  const swingAlong = liftoffAlong + swingProgress * (touchdownAlong - liftoffAlong);
  const swingTarget = {
    x: approach.start.x + unitX * swingAlong
      + sideX * (state.sideHome[swing] + swingRow.lateralM),
    y: floorY + FOOT_BASE_HEIGHT_DATUM[swing] + scale * swingRow.heightM,
    z: approach.start.z + unitZ * swingAlong
      + sideZ * (state.sideHome[swing] + swingRow.lateralM),
  };

  const sub = (approach.execution as { walkSimSubsteps?: number | null }).walkSimSubsteps ?? -1;
  let stanceMissM: number | null = null;
  let swingMissM: number | null = null;
  const yawNow = slot.rotation.y;
  const poleWorld = { x: Math.sin(yawNow), y: 0, z: Math.cos(yawNow) };

  for (const side of ordered) {
    const chain = findSteppingLegChain(slot, side);
    if (chain === null) continue;
    // Fresh offset EVERY substep from the mixer-posed leg (pre-solve): the
    // mixer overwrites local rotations each substep regardless of our
    // writes, so this read is exogenous clip truth — no feedback loop is
    // possible (contrast the stepping-turn warning, which re-read from the
    // solved leg). A once-captured entry offset goes stale as the ankle
    // articulates through the walk and was measured injecting ~15 cm swing
    // errors at handovers; the frozen-foot workaround for it levers the toe
    // on heel rotation by a similar amount. (A solve-twice re-read was
    // tried: the second pass does not converge the 3-5 cm swing miss, so it
    // was removed — one solve, miss from that solve.)
    const ends = heelWorldNow(chain);
    const captured = {
      offset: {
        x: ends.toe.x - ends.heel.x,
        y: ends.toe.y - ends.heel.y,
        z: ends.toe.z - ends.heel.z,
      },
      yaw: yawNow,
    };
    state.offsetEntry[side] = captured;
    const isPin = pinned.includes(side);
    const toeTarget = isPin ? pinTargetFor(side) : swingTarget;
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
    if (isPin) {
      if (side === stance) stanceMissM = solved.missM;
      // THE SLOT PIN: exact rigid translate of the pinned toe onto its
      // foothold. The swing (if any) is solved after the pins. In double
      // support each pin is a mm correction by construction, so ordering is
      // immaterial; the crown goes first.
      const toeNow = toeWorldNow(side === "left" ? approach.leftToe : approach.rightToe);
      const anchor = state.foothold[side];
      if (toeNow !== null) {
        slot.position.x += anchor.x - toeNow.x;
        slot.position.z += anchor.z - toeNow.z;
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
  return { stanceFoot: stance, phase01, halfIndex, stanceMissM, swingMissM };
}
