import type { Object3D } from "three";
import {
  captureRestStance,
  type RestStanceSnapshot,
} from "./arrival-stance-close-mod.js";

/**
 * Stopping-to-settling rest re-target. The arrived close converges toes toward
 * `restStance`, snapshotted at walk start (feet together). After a distance-indexed
 * stop the skeleton holds the take's own hold stance (feet planted split); converging
 * that toward walk rest drags the slot ~0.2 m and slides toes ~0.1-0.3 m through the
 * whole arrived phase on every rig (stop-takes slide decomposition). Re-capture rest
 * from the current (hold) pose exactly once, at the stopping→settling transition, so
 * the close converges toward planted feet and moves almost nothing. Walk-only runs
 * never take this transition, so their snapshot (and control rows) are untouched.
 * Returns whether a snapshot was taken.
 */
export function recaptureStopRestStance(approach: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  restStance: RestStanceSnapshot | null;
}): boolean {
  const recaptured = captureRestStance({
    actorSlot: approach.actorSlot,
    leftToe: approach.leftToe,
    rightToe: approach.rightToe,
  });
  if (recaptured === null) return false;
  approach.restStance = recaptured;
  return true;
}
