import type { Object3D } from "three";
import { readClosedLoopWalkEnabled } from "./closed-loop-walk-query-flag-mod.js";

/**
 * Closed-loop root advance for the walking phase (walk-closed-loop stage 2).
 *
 * The executor prescribes a planned advance every walking frame
 * (`walkSpeedMetersPerSecond`, the calibration's stance read scaled to the played
 * rate: 1.37 m/s on the shipped clip). The stage-0 control table measured the
 * stance foot itself moving back at only ~1.09 m/s as played, so the body
 * outruns the planted foot by 25% and no pin can hold. This module replaces the
 * slot's along-route advance with what the planted foot actually does: the foot
 * is world-stationary by construction, not by correction.
 *
 * Mechanism, per walking frame (post-pose, so the reads below are the mixer's
 * own pose for this frame; the posture pass writes only upper-arm bones, so leg
 * and toe worlds are clip pose):
 *
 * - Candidate feet are chosen from the MIXER pose with NO stance labels, NO
 *   speed table and NO calibration: toe inside the contact band, not leaving
 *   the ground (this frame's toe Y at most RISE_CAP above last frame's), and
 *   moving backward in the body frame (toe-minus-slot XZ displacement along
 *   the route unit strictly negative). "Not rising" is deliberately a CAP, not
 *   zero: browser measurement on this clip shows the true stance foot rising
 *   2-8 mm/frame through its whole pass (toe 15 -> 74 mm while bearing
 *   weight), so a zero rise tolerance rejects every mid-stance frame and the
 *   walk degrades to carried prescription; liftoff bursts read 19-27 mm/frame
 *   and stay excluded. See the stage-2 smoke analysis in the slice report.
 * - Single support: the one candidate. Double support: the foot planted longer
 *   keeps the crown; the crown hands over on the frame the other foot's
 *   backward displacement exceeds it AND the challenger has dwelled in
 *   candidacy for HANDOVER_DWELL frames. The dwell is load-bearing: a
 *   late-swing foot descending toward touchdown is in-band and reads a large
 *   apparent backward displacement (up to the slot's own speed), so an
 *   undwelled speed handover crowns the swing foot every cycle and the advance
 *   locks onto the slot's own speed instead of the clip's stance speed
 *   (measured: 1.29 m/s advance with a 25% planted rate). No averaging of the
 *   two feet (the parked-table lesson: averaging interpolates through double
 *   support and leaves centimetres per contact).
 * - Single support: the one candidate. Double support: the foot planted longer
 *   keeps the crown; the crown hands over on the frame the other foot's
 *   backward displacement exceeds it. No averaging of the two feet (the
 *   parked-table lesson: averaging interpolates through double support and
 *   leaves centimetres per contact).
 * - Flight, or no planted foot: carry the last applied advance.
 * - The slot is translated along the route unit by (advance - actual), where
 *   actual is the slot's own along-route motion since last frame's correction
 *   (executor prescription plus any acting-lock translation). The replacement
 *   is exact: with no acting lock, actual IS the executor advance, so the
 *   executor's travelled/arrival/evidence bookkeeping keeps working untouched.
 * - The last step is clamped to the executor-measured remaining distance, so
 *   the slot lands on the target line; the walk still ends on the executor's
 *   own remaining-distance rule. Nothing here changes arrival, stopping,
 *   settling, timeScale, the clip, or the bind.
 *
 * Default OFF on main (footstep-plan S1): the wiring calls this function only
 * under `?closedLoopWalk=1`; without the flag the executor's planned-speed
 * advance runs untouched. `?plannedWalkSpeed=1` restores the pure
 * planned-speed advance inside the opt-in (this function is then not called).
 *
 * claimScope: the walking slot's along-route advance for one frame.
 * notEvidenceFor: gait realism, turning walks (yaw pivot compensation no
 * longer acts; straight routes only are verified), or the arrival residual.
 */

export type ClosedLoopPlantedFoot = "left" | "right";

export type ClosedLoopWalkState = {
  /** Previous frame's final toe world XZ (after any correction), or null. */
  prevToeWorldXz: { left: { x: number; z: number }; right: { x: number; z: number } } | null;
  /** Previous frame's final toe world Y. */
  prevToeY: { left: number; right: number } | null;
  /** Previous frame's final slot XZ (after any correction), or null. */
  prevFinalSlotXz: { x: number; z: number } | null;
  /** The advance applied last frame (bootstrap: the planned advance). */
  lastAdvanceMeters: number;
  /** Consecutive candidate frames per foot. */
  plantAgeLeft: number;
  plantAgeRight: number;
  /** Which foot carried the body last frame, or null. */
  plantedFoot: ClosedLoopPlantedFoot | null;
};

export function createClosedLoopWalkState(): ClosedLoopWalkState {
  return {
    prevToeWorldXz: null,
    prevToeY: null,
    prevFinalSlotXz: null,
    lastAdvanceMeters: 0,
    plantAgeLeft: 0,
    plantAgeRight: 0,
    plantedFoot: null,
  };
}

/** Default-off opt-out `=== "1"` shape, same as the neighbouring flag mods. */
export function parsePlannedWalkSpeed(search: string): boolean {
  return new URLSearchParams(search).get("plannedWalkSpeed") === "1";
}

/** Browser entry read; false anywhere without a location search (node, tools). */
export function readPlannedWalkSpeed(): boolean {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" && parsePlannedWalkSpeed(search);
}

/** Vertical cap for the not-leaving test, in metres: keeps liftoff bursts out, keeps stance creep in. */
const RISE_CAP_METERS = 0.010;
/**
 * Challenger dwell for the speed handover, in consecutive candidate frames:
 * a descending swing foot is in-band and apparently fast for ~3 frames before
 * touchdown; only a foot that has stayed a candidate this long may take the
 * crown by speed. About 100 ms at the 30 Hz capture rate: weight-transfer time.
 */
const HANDOVER_DWELL_FRAMES = 3;

function toeWorldXz(toe: Object3D): { x: number; y: number; z: number } {
  toe.updateWorldMatrix(true, false);
  const e = toe.matrixWorld.elements;
  return { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
}

export function applyClosedLoopRootAdvance(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  floorOriginY: number;
  contactBandMeters: number;
  /** Route unit direction in world XZ. */
  travelUnit: { x: number; z: number };
  /** Executor-measured remaining along-route distance, in metres (>= 0). */
  remainingMeters: number;
  /** Executor's planned advance this frame, in metres (bootstrap carry). */
  plannedAdvanceMeters: number;
  state: ClosedLoopWalkState;
}): {
  state: ClosedLoopWalkState;
  plantedFoot: ClosedLoopPlantedFoot | null;
  advanceMeters: number;
  appliedDeltaMeters: number;
  carried: boolean;
} {
  const { actorSlot, state } = input;
  actorSlot.updateMatrixWorld(true);
  const slotPreXz = { x: actorSlot.position.x, z: actorSlot.position.z };
  const unitLen = Math.hypot(input.travelUnit.x, input.travelUnit.z);
  const ux = unitLen > 0 ? input.travelUnit.x / unitLen : 0;
  const uz = unitLen > 0 ? input.travelUnit.z / unitLen : 1;

  const finish = (
    advanceMeters: number,
    appliedDeltaMeters: number,
    plantedFoot: ClosedLoopPlantedFoot | null,
    carried: boolean,
    base: ClosedLoopWalkState,
  ): {
    state: ClosedLoopWalkState;
    plantedFoot: ClosedLoopPlantedFoot | null;
    advanceMeters: number;
    appliedDeltaMeters: number;
    carried: boolean;
  } => {
    if (appliedDeltaMeters !== 0) {
      actorSlot.position.x += ux * appliedDeltaMeters;
      actorSlot.position.z += uz * appliedDeltaMeters;
      actorSlot.updateMatrixWorld(true);
    }
    // Re-read the toes AFTER the translation: the snapshot must pair toe and
    // slot from the same instant. A pre-correction toe against a
    // post-correction slot reads this frame's own delta back as clip travel
    // on the next frame (measured in unit tests: a 13 mm shortfall per step).
    const postLeft = input.leftToe !== null ? toeWorldXz(input.leftToe) : null;
    const postRight = input.rightToe !== null ? toeWorldXz(input.rightToe) : null;
    return {
      state: {
        ...base,
        prevToeWorldXz: postLeft !== null && postRight !== null
          ? { left: { x: postLeft.x, z: postLeft.z }, right: { x: postRight.x, z: postRight.z } }
          : base.prevToeWorldXz,
        prevToeY: postLeft !== null && postRight !== null
          ? { left: postLeft.y, right: postRight.y }
          : base.prevToeY,
        prevFinalSlotXz: { x: actorSlot.position.x, z: actorSlot.position.z },
        lastAdvanceMeters: advanceMeters,
        plantedFoot,
      },
      plantedFoot,
      advanceMeters,
      appliedDeltaMeters,
      carried,
    };
  };

  // No toe bones, or a degenerate route: keep the prescription (delta 0) and
  // snapshot the slot so a later frame has a datum. Without toe bones every
  // frame takes this path, which degrades exactly to the planned advance.
  if (input.leftToe === null || input.rightToe === null || unitLen <= 0) {
    return finish(input.plannedAdvanceMeters, 0, null, true, {
      ...state,
      lastAdvanceMeters: input.plannedAdvanceMeters,
    });
  }

  const left = toeWorldXz(input.leftToe);
  const right = toeWorldXz(input.rightToe);
  const prevToe = state.prevToeWorldXz;
  const prevY = state.prevToeY;

  // Bootstrap (no previous pose): keep the prescription, carry the plan.
  if (prevToe === null || prevY === null) {
    return finish(input.plannedAdvanceMeters, 0, null, true, {
      ...state,
      prevToeWorldXz: { left: { x: left.x, z: left.z }, right: { x: right.x, z: right.z } },
      prevToeY: { left: left.y, right: right.y },
      lastAdvanceMeters: input.plannedAdvanceMeters,
    });
  }

  // Body-frame along-route displacement per foot (toe minus slot cancels the
  // slot's own motion exactly, leaving the clip's own travel). Negative is
  // backward: the direction a planted foot moves under the body.
  const prevSlot = state.prevFinalSlotXz ?? slotPreXz;
  const dispL = ((left.x - slotPreXz.x - (prevToe.left.x - prevSlot.x)) * ux
    + (left.z - slotPreXz.z - (prevToe.left.z - prevSlot.z)) * uz);
  const dispR = ((right.x - slotPreXz.x - (prevToe.right.x - prevSlot.x)) * ux
    + (right.z - slotPreXz.z - (prevToe.right.z - prevSlot.z)) * uz);
  const candL = left.y - input.floorOriginY <= input.contactBandMeters
    && left.y - prevY.left <= RISE_CAP_METERS
    && dispL < 0;
  const candR = right.y - input.floorOriginY <= input.contactBandMeters
    && right.y - prevY.right <= RISE_CAP_METERS
    && dispR < 0;
  const ageL = candL ? state.plantAgeLeft + 1 : 0;
  const ageR = candR ? state.plantAgeRight + 1 : 0;

  let planted: ClosedLoopPlantedFoot | null = null;
  if (candL && candR) {
    const incumbent: ClosedLoopPlantedFoot = ageL === ageR
      ? (state.plantedFoot ?? "left")
      : ageL > ageR ? "left" : "right";
    const challenger: ClosedLoopPlantedFoot = incumbent === "left" ? "right" : "left";
    const challengerAge = challenger === "left" ? ageL : ageR;
    const incDisp = incumbent === "left" ? dispL : dispR;
    const chalDisp = challenger === "left" ? dispL : dispR;
    // Hand over on the frame the other foot's backward displacement exceeds
    // the incumbent's — but only once the challenger has dwelled in candidacy
    // (see HANDOVER_DWELL_FRAMES): without the dwell the crown goes to the
    // descending swing foot while it is still falling toward touchdown.
    // Displacements are negative; more negative is faster.
    planted = challengerAge >= HANDOVER_DWELL_FRAMES && chalDisp < incDisp ? challenger : incumbent;
  } else if (candL) {
    planted = "left";
  } else if (candR) {
    planted = "right";
  }

  const next = {
    ...state,
    prevToeWorldXz: { left: { x: left.x, z: left.z }, right: { x: right.x, z: right.z } },
    prevToeY: { left: left.y, right: right.y },
    plantAgeLeft: ageL,
    plantAgeRight: ageR,
  };

  if (planted === null) {
    // Flight or no planted foot: carry the last applied advance.
    const advance = Math.min(state.lastAdvanceMeters, Math.max(0, input.remainingMeters));
    const actual = (slotPreXz.x - prevSlot.x) * ux + (slotPreXz.z - prevSlot.z) * uz;
    return finish(advance, advance - actual, null, true, next);
  }

  const backward = planted === "left" ? -dispL : -dispR;
  const advance = Math.min(backward, Math.max(0, input.remainingMeters));
  const actual = (slotPreXz.x - prevSlot.x) * ux + (slotPreXz.z - prevSlot.z) * uz;
  return finish(advance, advance - actual, planted, false, next);
}

/**
 * S1 wiring step (default OFF): apply the closed-loop advance to a
 * case-owned approach when `?closedLoopWalk=1` opts in during the walking
 * phase; `?plannedWalkSpeed=1` restores the pure planned-speed advance
 * inside the opt-in. Without the flag this returns without touching
 * anything, so default runtime is unchanged. Lives here (not in the frame
 * module) to hold that file's zone budget.
 */
export function applyClosedLoopWalkStep(input: {
  approach: {
    execution: { phase: string; travelledMeters: number };
    actorSlot: Object3D;
    leftToe: Object3D | null;
    rightToe: Object3D | null;
    floorOriginY: number;
    contactBandMeters: number;
    walkSpeedMetersPerSecond: number;
    closedLoop: ClosedLoopWalkState | null;
  };
  routeDx: number;
  routeDz: number;
  routeLength: number;
  deltaSeconds: number;
}): void {
  const { approach, routeLength } = input;
  if (approach.execution.phase !== "walking" || routeLength <= 0) return;
  if (!readClosedLoopWalkEnabled() || readPlannedWalkSpeed()) return;
  const remainingMeters = Math.max(0, routeLength - approach.execution.travelledMeters);
  if (approach.closedLoop === null) approach.closedLoop = createClosedLoopWalkState();
  const closed = applyClosedLoopRootAdvance({
    actorSlot: approach.actorSlot,
    leftToe: approach.leftToe,
    rightToe: approach.rightToe,
    floorOriginY: approach.floorOriginY,
    contactBandMeters: approach.contactBandMeters,
    travelUnit: { x: input.routeDx / routeLength, z: input.routeDz / routeLength },
    remainingMeters,
    plannedAdvanceMeters: approach.walkSpeedMetersPerSecond * input.deltaSeconds,
    state: approach.closedLoop,
  });
  approach.closedLoop = closed.state;
}
