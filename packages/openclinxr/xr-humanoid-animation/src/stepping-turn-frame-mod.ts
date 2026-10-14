import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";
import {
  advanceSteppingTurn,
  beginSteppingTurn,
} from "./stepping-turn-execution-mod.js";

/**
 * Settling/arrived call sites for the procedural stepping turn (2026-10-11).
 *
 * WHY A BRIDGE. `case-owned-approach-frame-mod.ts` sits 2 lines under its 500-line zone
 * budget, so the three stepping call sites (settling entry, settling frame, arrived
 * transition) live here as one-line calls; the comments explaining them live here too.
 * The plan/execution/CCD modules stay free of the approach type; only this bridge
 * couples them to the frame shape, and only through fields (no new package exports).
 */

/** Settling entry: plan from the live entry pose when flagged; otherwise leave cleared. */
export function enterSteppingTurn(approach: CaseOwnedBedsideApproach): void {
  if (!approach.steppingTurnEnabled) {
    approach.steppingTurn = null;
    return;
  }
  // Baseline + scale sources (handback bar 1): the walk-start rest snapshot's own
  // heights and separation — the rig's natural standing toe height and leg scale in
  // this world — not the walk-frozen entry pose.
  const rest = approach.restStance;
  const baseline = rest !== null ? Math.min(rest.heightLeft, rest.heightRight) : null;
  approach.steppingTurn = beginSteppingTurn({
    actorSlot: approach.actorSlot,
    leftToe: approach.leftToe,
    rightToe: approach.rightToe,
    targetHeadingRadians: approach.intent.target.headingRadians,
    floorOriginY: approach.floorOriginY,
    baselineYOverride: baseline,
    restSepXzM: rest?.sepXz ?? null,
    // Backward footfalls anchor on the stand target (`targetWorld` XZ).
    turnTargetXz: { x: approach.target.x, z: approach.target.z },
  });
}

/**
 * Settling frame: run the plan (slot yaw + stance pin + leg CCD) and publish into the
 * settling-phase evidence fields the metrics and SC-05 clauses read. Returns true when
 * the stepping path owned this frame; false (flag off, or no plan) means the caller
 * falls through to the clip-driven turn. `clipTurn.lock` is the carrier only — the
 * clip-driven turn never ran on a stepping run, so nothing else in it is live.
 */
export function applySteppingTurn(approach: CaseOwnedBedsideApproach, deltaSeconds: number): boolean {
  if (!approach.steppingTurnEnabled || approach.steppingTurn === null) return false;
  const targets = advanceSteppingTurn({
    actorSlot: approach.actorSlot,
    leftToe: approach.leftToe,
    rightToe: approach.rightToe,
    deltaSeconds,
    state: approach.steppingTurn,
    restQuats: approach.restStance?.quats ?? null,
    floorOriginY: approach.floorOriginY,
  });
  const leftY = (targets.stanceFoot === "left" ? targets.stanceToe : targets.swingToe).y;
  const rightY = (targets.stanceFoot === "right" ? targets.stanceToe : targets.swingToe).y;
  approach.clipTurn.lock = {
    ...approach.clipTurn.lock,
    stanceFoot: targets.stanceFoot,
    doubleSupport: false,
    labelledStance: { left: targets.stanceFoot === "left", right: targets.stanceFoot === "right" },
    toeHeightMeters: { left: leftY - approach.floorOriginY, right: rightY - approach.floorOriginY },
    prevYawRadians: approach.actorSlot.rotation.y,
  };
  return true;
}

/**
 * Settling->arrived transition: seed the arrival close's plant designation from the
 * plan's last stance foot. The clip-driven `phaseFoot` stays null on a stepping run,
 * so the existing seeding never fires there; this is its stepping equivalent.
 */
export function seedSteppingTurnClose(approach: CaseOwnedBedsideApproach): void {
  if (!approach.steppingTurnEnabled) return;
  const stance = approach.steppingTurn?.lastTargets?.stanceFoot ?? null;
  if (stance !== null) approach.closeState = { ...approach.closeState, plantFoot: stance };
}
