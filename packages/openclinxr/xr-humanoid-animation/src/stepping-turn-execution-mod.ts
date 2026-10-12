import type { Object3D } from "three";
import { Quaternion, Vector3 } from "three";
import {
  planSteppingTurn,
  steppingTurnAt,
  steppingTurnLegScale,
  type SteppingTurnPlan,
  type SteppingTurnTargets,
} from "./stepping-turn-plan-mod.js";
import {
  findSteppingLegChain,
  heelTargetForToeTargetStable,
  type HingeQuat,
  solveSteppingLegHinge,
} from "./stepping-turn-leg-ik-mod.js";
import { worldXyz } from "./stance-lock-ik.js";
import {
  pivotSlotXzForSteppingFrame,
  STEPPING_PIVOT_CAPTURE_HEIGHT_M,
  steppingPivotWindowKey,
  type SteppingPivotAnchor,
} from "./stepping-turn-slot-pivot-mod.js";
import { readSteppingTurnLegacyPin } from "./stepping-turn-query-flag-mod.js";
import {
  isSteppingTurnTraceEnabled,
  recordSteppingTurnTraceFrame,
  type SteppingTurnTracePass,
} from "./stepping-turn-trace-mod.js";

/**
 * Stepping-turn EXECUTION (2026-10-11): run a `SteppingTurnPlan` through the settling phase.
 *
 * PER FRAME (flag on only; the caller owns the flag and the settling-phase gate):
 *  1. advance the plan clock, evaluate slot yaw + both toe world targets;
 *  2. write slot yaw (the pelvis follows the feet, per the plan);
 *  3. translate the slot XZ so the stance toe's world lands exactly on its anchor —
 *     zero slide by construction, the same exact-translate discipline
 *     `pivotSlotAroundAnchor` (stance-lock-ik.ts) uses for yaw pivots;
 *  4. where leg bones exist (browser rig), CCD each leg to its heel target derived
 *     from the toe target via the foot's current heel-to-toe offset; where they do
 *     not (headless assay markers), skip — the assay poses its markers from the
 *     published targets instead, and the toe locals are never written (writing a
 *     toe's local position moves only the toe, not the leg: the detached-toe trap).
 *
 * The returned targets are the published contract: the caller mirrors stanceFoot into
 * the settling-phase evidence fields and the assay poses its markers from them.
 */

export type SteppingTurnExecState = {
  plan: SteppingTurnPlan;
  elapsedS: number;
  lastTargets: SteppingTurnTargets | null;
  /** Settling-frame counter for the default-off slot-update trace. */
  traceFrames: number;
  /**
   * Held-anchor pivot (stage-2 fix): the anchor the turn pivots about, captured
   * ONCE per planted window from a foot actually on the floor and held in world
   * space. Null until the first capture; while null the slot holds XZ (yaw in
   * place) instead of translating.
   */
  pivot: SteppingPivotAnchor | null;
  /** Window key whose foot is still airborne: capture retried every frame. */
  pivotPendingWindow: string | null;
  /** Floor Y for the capture gate; stored at begin. */
  pivotFloorY: number;
  /** Slot Y at entry; the pelvis dip subtracts from this each frame. */
  slotY0: number;
  /** Toe-minus-heel offset per side with the yaw it was captured at (stable mapping). */
  offsetEntry: {
    left: { offset: { x: number; y: number; z: number }; yaw: number } | null;
    right: { offset: { x: number; y: number; z: number }; yaw: number } | null;
  };
  /**
   * Foot-bone WORLD orientation per side at capture, with the yaw it was captured
   * at. Re-asserted every frame (yaw-compensated): the heel-target map above is built
   * from the entry foot orientation, but the foot's world orientation also swings with
   * knee articulation (walk-bent at entry, extending through the turn), so a frozen
   * LOCAL quaternion still leaves a structural toe residual that the stance pin
   * integrates into slot travel — measured, ~0.5 m of pelvis-behind-feet drift with
   * the toes still pinned. Holding the WORLD orientation (yawed with the slot, like
   * the map) keeps the live mapping exact through any articulation; the hinge never
   * touches the foot bone, so nothing fights the freeze. (The bake's idle-constant
   * feet are the same construction with a near-zero articulation delta, which is why
   * it never spiralled.)
   */
  footQuat: {
    left: { q: HingeQuat; yaw: number } | null;
    right: { q: HingeQuat; yaw: number } | null;
  };
};

function shortestYawDelta(fromRadians: number, toRadians: number): number {
  return Math.atan2(Math.sin(toRadians - fromRadians), Math.cos(toRadians - fromRadians));
}

const Y_AXIS = new Vector3(0, 1, 0);

/** Capture the entry pose and plan the turn. Null when there are no live toes to plan from. */
export function beginSteppingTurn(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  targetHeadingRadians: number;
  floorOriginY: number;
  /**
   * Stance baseline override: the rig's natural standing toe height (the walk-start
   * rest snapshot's heights). Absent, the entry minimum is used — but a walk frozen
   * mid-stride can hold both feet centimetres off the floor, and pinning that float
   * for the whole turn crouches the bake (measured 44-62 deg hold flexion from a
   * 6 cm float). Step 0 still starts at live heights and morphs down (no snap).
   */
  baselineYOverride?: number | null;
  /** Walk-start rest toe separation (world m) for the rig leg scale; null = 1.0. */
  restSepXzM?: number | null;
}): SteppingTurnExecState | null {
  const { actorSlot, leftToe, rightToe } = input;
  if (leftToe === null || rightToe === null) return null;
  actorSlot.updateMatrixWorld(true);
  leftToe.updateMatrixWorld(true);
  rightToe.updateMatrixWorld(true);
  const leftWorld = worldXyz(leftToe);
  const rightWorld = worldXyz(rightToe);
  const entryYaw = actorSlot.rotation.y;
  const planInput = {
    residualYawRadians: shortestYawDelta(entryYaw, input.targetHeadingRadians),
    entryYawRadians: entryYaw,
    targetHeadingRadians: input.targetHeadingRadians,
    leftToeXz: { x: leftWorld.x, z: leftWorld.z },
    rightToeXz: { x: rightWorld.x, z: rightWorld.z },
    leftToeY: leftWorld.y,
    rightToeY: rightWorld.y,
    stanceBaselineY: input.baselineYOverride ?? Math.min(leftWorld.y, rightWorld.y),
    entrySlotXz: { x: actorSlot.position.x, z: actorSlot.position.z },
    legScale: steppingTurnLegScale(input.restSepXzM),
  };
  // Center the final pair under the pelvis (two-step turns): the yaw split steers the
  // pivot-arc composition, so optimize it against the closed-form slot path. Falls back
  // to even (or untouched for N != 2) with no gain.
  const plan = planSteppingTurn(planInput);
  return {
    plan,
    elapsedS: 0,
    lastTargets: steppingTurnAt(plan, 0),
    traceFrames: 0,
    pivot: null,
    pivotPendingWindow: null,
    pivotFloorY: input.floorOriginY,
    slotY0: actorSlot.position.y,
    offsetEntry: { left: null, right: null },
    footQuat: { left: null, right: null },
  };
}
export function advanceSteppingTurn(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  deltaSeconds: number;
  state: SteppingTurnExecState;
  /** Rest orientations keyed by bone name (the walk-start snapshot); null leaves mids as-is. */
  restQuats?: Record<string, HingeQuat> | null;
  /** Floor Y for the default-off trace's toe-height records; null skips them. */
  floorOriginY?: number | null;
}): SteppingTurnTargets {
  const { actorSlot, state } = input;
  state.elapsedS += input.deltaSeconds;
  const targets = steppingTurnAt(state.plan, state.elapsedS);
  state.lastTargets = targets;
  const traceOn = isSteppingTurnTraceEnabled();
  const traceFrameIndex = state.traceFrames;
  state.traceFrames += 1;
  const traceYawPrev = actorSlot.rotation.y;
  const traceSlotBeforeX = actorSlot.position.x;
  const traceSlotBeforeZ = actorSlot.position.z;
  const tracePasses: SteppingTurnTracePass[] = [];

  // Pelvis yaw follows the feet; pelvis height dips a few cm mid-swing (the plan's
  // dip profile, 0 at placements) so the lift-plus-reach span is shared between knee
  // flexion and hip drop instead of crouching the knee alone.
  actorSlot.rotation.y = targets.yawRadians;
  actorSlot.position.y = state.slotY0 - targets.pelvisDipM;
  actorSlot.updateMatrixWorld(true);

  // HELD-ANCHOR PIVOT (stage-2 fix; `?steppingTurnLegacyPin=1` restores the old
  // per-pass pin for A/B). The anchor is captured ONCE per planted window from
  // a foot actually on the floor and held in world space; while no window has
  // captured yet the slot holds XZ (yaw in place). No slot term here reads a
  // toe world — the pin's feedback (gain up to 3.26, stage 1) is gone.
  const legacyPin = readSteppingTurnLegacyPin();
  const windowKey = steppingPivotWindowKey(targets.stepIndex, targets.stanceFoot);
  let tracePivot: {
    dx: number;
    dz: number;
    anchorX: number | null;
    anchorZ: number | null;
    anchorWindow: string | null;
    pendingWindow: string | null;
    legacy: boolean;
  } | null = null;
  if (!legacyPin) {
    if (state.pivot?.windowKey !== windowKey) state.pivotPendingWindow = windowKey;
    if (state.pivotPendingWindow === windowKey) {
      const stanceToeForCapture = targets.stanceFoot === "left" ? input.leftToe : input.rightToe;
      if (stanceToeForCapture !== null) {
        stanceToeForCapture.updateMatrixWorld(true);
        const toeWorld = worldXyz(stanceToeForCapture);
        const height = toeWorld.y - state.pivotFloorY;
        if (Number.isFinite(height) && height <= STEPPING_PIVOT_CAPTURE_HEIGHT_M) {
          state.pivot = {
            anchorXz: { x: toeWorld.x, z: toeWorld.z },
            slotXzAtCapture: { x: actorSlot.position.x, z: actorSlot.position.z },
            yawAtCaptureRadians: actorSlot.rotation.y,
            windowKey,
            capturedAtFrame: traceFrameIndex,
          };
          state.pivotPendingWindow = null;
        }
      }
    }
    if (state.pivot !== null) {
      const pivoted = pivotSlotXzForSteppingFrame({ anchor: state.pivot, yawNowRadians: targets.yawRadians });
      tracePivot = {
        dx: pivoted.x - actorSlot.position.x,
        dz: pivoted.z - actorSlot.position.z,
        anchorX: state.pivot.anchorXz.x,
        anchorZ: state.pivot.anchorXz.z,
        anchorWindow: state.pivot.windowKey,
        pendingWindow: state.pivotPendingWindow,
        legacy: false,
      };
      actorSlot.position.x = pivoted.x;
      actorSlot.position.z = pivoted.z;
      actorSlot.updateMatrixWorld(true);
    } else {
      tracePivot = {
        dx: 0,
        dz: 0,
        anchorX: null,
        anchorZ: null,
        anchorWindow: null,
        pendingWindow: state.pivotPendingWindow,
        legacy: false,
      };
    }
  } else {
    tracePivot = {
      dx: 0,
      dz: 0,
      anchorX: null,
      anchorZ: null,
      anchorWindow: null,
      pendingWindow: null,
      legacy: true,
    };
  }

  // Shape the legs where bones exist, then pin the stance toe to its anchor with an
  // exact rigid translate. Headless markers resolve no chain and skip the solve, so the
  // pin reads the assay-posed locals there.
  //
  // ORDER (measured 2026-10-11: the reverse order walks the slot). The pin must read the
  // POST-solve stance world, not the pre-solve one: the mixer keeps playing the walk clip
  // underneath (leg weight 0.4), so the pre-solve stance world is a walk-pose sample —
  // pinning THAT teleports the slot by the walk sample's own discontinuity every frame
  // (measured 0.42 m of slot travel on the child) and the subsequent solve only moves the
  // foot. Hinge first puts the foot where the plan says; the pin then cancels only the
  // yaw rotation's own displacement plus solve residue — the exact-translate discipline
  // `compensateSlotForYawChange` (stance-lock-ik.ts) uses, rather than a drift chase.
  // Two passes: the second pin moves the slot by the first solve's residue (~0.1 mm), so
  // the heel it disturbs stays within the probe-measured miss.
  //
  // Pole: the slot's own facing — knees bow forward along the body heading, never back.
  const yawNow = actorSlot.rotation.y;
  const poleWorld = { x: Math.sin(yawNow), y: 0, z: Math.cos(yawNow) };
  for (let pass = 0; pass < 2; pass += 1) {
    let traceOffsetCaptured = false;
    let traceFootCaptured = false;
    for (const side of ["left", "right"] as const) {
      const chain = findSteppingLegChain(actorSlot, side);
      if (chain === null) continue;
      // Capture the heel-toe offset once (first resolving frame); after that it only
      // rotates with slot yaw — re-reading it live feeds solved orientations back in.
      // The foot's WORLD orientation is frozen beside it (see footQuat), applied
      // AFTER the hinge solve below: the solve rotates the knee, so a freeze built
      // on pre-solve parents is stale by the solve's own articulation and the pin
      // integrates that stale-by-one-pass error every frame.
      if (state.offsetEntry[side] === null) {
        if (traceOn && side === targets.stanceFoot) traceOffsetCaptured = true;
        chain.heel.updateMatrixWorld(true);
        chain.toe.updateMatrixWorld(true);
        const heelWorld = worldXyz(chain.heel);
        const toeWorld = worldXyz(chain.toe);
        state.offsetEntry[side] = {
          offset: {
            x: toeWorld.x - heelWorld.x,
            y: toeWorld.y - heelWorld.y,
            z: toeWorld.z - heelWorld.z,
          },
          yaw: targets.yawRadians,
        };
        const parentQ = new Quaternion();
        if (chain.heel.parent) chain.heel.parent.getWorldQuaternion(parentQ);
        else parentQ.identity();
        const localQ = chain.heel.quaternion;
        const worldQ = parentQ.clone().multiply(localQ);
        state.footQuat[side] = {
          q: { x: worldQ.x, y: worldQ.y, z: worldQ.z, w: worldQ.w },
          yaw: targets.yawRadians,
        };
      }
      const toeTarget = side === targets.stanceFoot ? targets.stanceToe : targets.swingToe;
      const captured = state.offsetEntry[side];
      if (captured === null) continue;
      const heelTarget = heelTargetForToeTargetStable({
        toeTargetWorld: toeTarget,
        slotYawRadians: targets.yawRadians,
        offsetEntry: captured.offset,
        offsetYawRadians: captured.yaw,
      });
      const rest = input.restQuats ?? null;
      const upper = rest?.[chain.upperMid.name] ?? null;
      const lower = rest?.[chain.lowerMid.name] ?? null;
      solveSteppingLegHinge({
        chain,
        heelTargetWorld: heelTarget,
        poleWorld,
        midRestQuats: { upper, lower },
      });
      // Yaw-compensated world freeze, on post-solve parents: the foot yaws with the
      // slot (like the map) but keeps its entry pitch/roll through any articulation,
      // so the live mapping stays exact and the pin stops chasing. Refresh the heel
      // subtree: the pin below reads the toe through it.
      const frozen = state.footQuat[side];
      if (traceOn && side === targets.stanceFoot) {
        // The offset and the foot freeze are captured in the same once-only
        // block above, so one flag covers both.
        traceFootCaptured = traceOffsetCaptured;
      }
      if (frozen !== null) {
        const parentQ = new Quaternion();
        if (chain.heel.parent) chain.heel.parent.getWorldQuaternion(parentQ);
        else parentQ.identity();
        const yawDelta = new Quaternion().setFromAxisAngle(Y_AXIS, targets.yawRadians - frozen.yaw);
        const wantWorld = yawDelta.multiply(new Quaternion(frozen.q.x, frozen.q.y, frozen.q.z, frozen.q.w));
        chain.heel.quaternion.copy(parentQ.invert().multiply(wantWorld));
        chain.heel.updateWorldMatrix(true, false);
      }
    }
    actorSlot.updateMatrixWorld(true);
    const stanceToe = targets.stanceFoot === "left" ? input.leftToe : input.rightToe;
    if (stanceToe !== null) {
      stanceToe.updateMatrixWorld(true);
      const world = worldXyz(stanceToe);
      const dx = targets.stanceToe.x - world.x;
      const dz = targets.stanceToe.z - world.z;
      if (traceOn) {
        tracePasses.push({
          pass,
          dx,
          dz,
          targetX: targets.stanceToe.x,
          targetZ: targets.stanceToe.z,
          targetY: targets.stanceToe.y,
          toeWorldX: world.x,
          toeWorldZ: world.z,
          toeWorldY: world.y,
          offsetCapturedThisFrame: traceOffsetCaptured,
          footQuatCapturedThisFrame: traceFootCaptured,
        });
      }
      // LEGACY PIN (A/B only): the measured feedback loop. Default (held-anchor
      // pivot above) never translates the slot from a toe read.
      if (legacyPin) {
        actorSlot.position.x += dx;
        actorSlot.position.z += dz;
        actorSlot.updateMatrixWorld(true);
      }
    }
  }
  if (traceOn) {
    const floorY = input.floorOriginY ?? null;
    let toeLeftY: number | null = null;
    let toeRightY: number | null = null;
    if (input.leftToe !== null) {
      input.leftToe.updateMatrixWorld(true);
      toeLeftY = worldXyz(input.leftToe).y;
    }
    if (input.rightToe !== null) {
      input.rightToe.updateMatrixWorld(true);
      toeRightY = worldXyz(input.rightToe).y;
    }
    recordSteppingTurnTraceFrame({
      frame: traceFrameIndex,
      elapsedS: state.elapsedS,
      stepIndex: targets.stepIndex,
      u: targets.u,
      stanceFoot: targets.stanceFoot,
      swingFoot: targets.swingFoot,
      yawPrev: traceYawPrev,
      yawNew: targets.yawRadians,
      dipY: targets.pelvisDipM,
      slotBeforeX: traceSlotBeforeX,
      slotBeforeZ: traceSlotBeforeZ,
      slotAfterX: actorSlot.position.x,
      slotAfterZ: actorSlot.position.z,
      passes: tracePasses,
      toeLeftY,
      toeRightY,
      floorOriginY: floorY,
      pivot: tracePivot,
    });
  }
  return targets;
}
