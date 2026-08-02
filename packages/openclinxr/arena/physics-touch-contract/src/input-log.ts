/**
 * C2 — Input as a recorded stream.
 *
 * Hand/controller poses are quantized and appended to an ordered per-tick input log:
 * `{ tick, handedness, jointPoses[], pinchStrength, contactRegionId }`.
 * The simulation consumes the log, never the live device directly.
 * Live XR writes to the log; replay reads from it.
 */

import type { InputLog, PhysicsTickInput } from "./types.js";

/**
 * Create an empty input log.
 */
export function createInputLog(): InputLog {
  return { entries: [] };
}

/**
 * Append a tick input to the log.
 * Returns a new log (immutable pattern).
 */
export function appendTickInput(
  log: InputLog,
  input: PhysicsTickInput,
): InputLog {
  return {
    entries: [...log.entries, cloneTickInput(input)],
  };
}

/**
 * Get a tick input by tick index.
 * Returns undefined if no entry exists for that tick.
 */
export function getTickInput(
  log: InputLog,
  tick: number,
): PhysicsTickInput | undefined {
  return log.entries.find((entry) => entry.tick === tick);
}

/**
 * Get the total number of entries in the log.
 */
export function inputLogLength(log: InputLog): number {
  return log.entries.length;
}

/**
 * Get a read-only snapshot of all entries, sorted by tick.
 */
export function listTickInputs(log: InputLog): readonly PhysicsTickInput[] {
  return log.entries;
}

function cloneTickInput(input: PhysicsTickInput): PhysicsTickInput {
  return {
    tick: input.tick,
    handedness: input.handedness,
    jointPoses: input.jointPoses.map((pose) => ({
      jointId: pose.jointId,
      position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
      rotation: {
        x: pose.rotation.x,
        y: pose.rotation.y,
        z: pose.rotation.z,
        w: pose.rotation.w,
      },
    })),
    pinchStrength: input.pinchStrength,
    contactRegionId: input.contactRegionId,
  };
}
