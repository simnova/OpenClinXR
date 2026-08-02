/**
 * Adapter contract — one interface, three engines.
 *
 * No candidate-specific types escape this adapter.
 * Havok, Rapier, and Jolt adapters must implement this interface.
 * The stub adapter provides a minimal in-memory implementation for testing.
 */

import type {
  DeterminismScope,
  PhysicsArtifactMeta,
  PhysicsTickInput,
} from "../types.js";

/**
 * A serializable snapshot of the physics world state.
 * Engine-specific binary format; opaque to the contract layer.
 */
export type PhysicsStateSnapshot = Uint8Array;

/**
 * The physics adapter interface.
 * Each engine (stub, havok, rapier, jolt) provides its own implementation.
 */
export interface PhysicsAdapter {
  /** Step the physics world forward by one fixed tick with the given input. */
  step(input: PhysicsTickInput): void;

  /** Take a checksummable snapshot of the current solver state (C3). */
  takeSnapshotBytes(): Uint8Array;

  /** Take a full snapshot for later restore. */
  takeSnapshot(): PhysicsStateSnapshot;

  /** Restore the solver state from a snapshot. */
  applySnapshot(snapshot: PhysicsStateSnapshot): void;

  /** Reset the world to initial state with the given seed. */
  reset(seed: number): void;

  /** Read-only metadata for this adapter. */
  readonly meta: PhysicsArtifactMeta;
}

/**
 * Stub adapter for testing the contract layer.
 * Maintains a simple in-memory state for determinism verification.
 */
export class StubPhysicsAdapter implements PhysicsAdapter {
  readonly meta: PhysicsArtifactMeta;

  private _seed: number;
  private _tick: number;
  private _state: Record<string, number>;

  constructor(seed = 42) {
    this._seed = seed;
    this._tick = 0;
    this._state = {};
    this.meta = {
      determinismScope: "local" as DeterminismScope,
      notEvidenceFor: [
        "clinical_validity",
        "exam_equivalence",
        "scoring",
        "learner_readiness",
      ],
      generatorVersion: "0.1.0",
      engineId: "stub",
      seed,
      fixedDt: 1 / 60,
    };
  }

  step(input: PhysicsTickInput): void {
    this._tick = input.tick;
    // Simple deterministic state mutation: accumulate joint positions
    for (const pose of input.jointPoses) {
      const key = `pose_${pose.jointId}`;
      this._state[key] = (this._state[key] ?? 0) + pose.position.x;
    }
    this._state["tick"] = this._tick;
    this._state["seed"] = this._seed;
  }

  takeSnapshotBytes(): Uint8Array {
    const json = JSON.stringify(this._state, Object.keys(this._state).sort());
    return new TextEncoder().encode(json);
  }

  takeSnapshot(): PhysicsStateSnapshot {
    return this.takeSnapshotBytes();
  }

  applySnapshot(snapshot: PhysicsStateSnapshot): void {
    const json = new TextDecoder().decode(snapshot);
    this._state = JSON.parse(json) as Record<string, number>;
    this._tick = this._state["tick"] ?? 0;
    this._seed = this._state["seed"] ?? this._seed;
  }

  reset(seed: number): void {
    this._seed = seed;
    this._tick = 0;
    this._state = {};
  }
}
