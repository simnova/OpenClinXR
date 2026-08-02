/**
 * C6 — Replay.
 *
 * Replay an input log; checkpoint every N ticks.
 * Supports snapshot restore at tick k for equivalence verification.
 */

import type { InputLog, PhysicsTickInput, SnapshotChecksum } from "./types.js";
import { hashState } from "./snapshot-hash.js";
import type { PhysicsAdapter, PhysicsStateSnapshot } from "./adapters/stub.js";

/** Default checkpoint interval: every 30 ticks (C3). */
export const DEFAULT_CHECKPOINT_INTERVAL = 30;

/**
 * Replay result: the list of snapshot checksums at each checkpoint tick.
 */
export type ReplayResult = {
  checksums: SnapshotChecksum[];
};

/**
 * The full replay state including the adapter's accumulated snapshots
 * (so we can restore at a specific tick for C6 equivalence tests).
 */
export type ReplayTrace = {
  result: ReplayResult;
  /** Snapshots taken at each checkpoint, keyed by tick. */
  snapshots: Map<number, PhysicsStateSnapshot>;
};

/**
 * Replay an input log against a physics adapter.
 * Takes a snapshot every `checkpointInterval` ticks.
 * Returns the checksums and snapshots for later restore testing.
 *
 * The adapter handles engine-specific step, snapshot, applySnapshot, reset.
 */
export function replayInputLog(
  adapter: PhysicsAdapter,
  log: InputLog,
  checkpointInterval: number = DEFAULT_CHECKPOINT_INTERVAL,
): ReplayTrace {
  const checksums: SnapshotChecksum[] = [];
  const snapshots = new Map<number, PhysicsStateSnapshot>();

  for (const input of log.entries) {
    adapter.step(input);

    if (input.tick % checkpointInterval === 0) {
      const snapshotBytes = adapter.takeSnapshotBytes();
      const sha256 = hashState(
        Buffer.from(snapshotBytes).toString("base64"),
      );
      checksums.push({ tick: input.tick, sha256 });
      snapshots.set(input.tick, adapter.takeSnapshot());
    }
  }

  return {
    result: { checksums },
    snapshots,
  };
}

/**
 * Replay from a restored snapshot at tick k, then continue replaying
 * the remaining input log entries (tick > k).
 * Used to verify C6: after snapshot restore at tick k → same checksums thereafter.
 */
export function replayFromSnapshot(
  adapter: PhysicsAdapter,
  restoredSnapshot: PhysicsStateSnapshot,
  log: InputLog,
  startTick: number,
  checkpointInterval: number = DEFAULT_CHECKPOINT_INTERVAL,
): ReplayResult {
  adapter.applySnapshot(restoredSnapshot);

  const checksums: SnapshotChecksum[] = [];

  for (const input of log.entries) {
    if (input.tick <= startTick) continue;

    adapter.step(input);

    if (input.tick % checkpointInterval === 0) {
      const snapshotBytes = adapter.takeSnapshotBytes();
      const sha256 = hashState(
        Buffer.from(snapshotBytes).toString("base64"),
      );
      checksums.push({ tick: input.tick, sha256 });
    }
  }

  return { checksums };
}

/**
 * Build a predictable input log for testing C6 determinism.
 * Every tick gets an input with the tick as the only varying field.
 */
export function buildDeterministicInputLog(
  numTicks: number,
  handedness: PhysicsTickInput["handedness"] = "right",
): InputLog {
  const entries: PhysicsTickInput[] = [];
  for (let tick = 0; tick <= numTicks; tick++) {
    entries.push({
      tick,
      handedness,
      jointPoses: [
        {
          jointId: "wrist",
          position: { x: 0.1 * tick, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      pinchStrength: 0,
      contactRegionId: null,
    });
  }
  return { entries };
}
