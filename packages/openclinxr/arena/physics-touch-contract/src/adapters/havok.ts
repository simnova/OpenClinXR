/**
 * HavokCandidateAdapter — deterministic Havok-style physics adapter.
 *
 * CANDIDATE PATH: No real Havok WASM loaded.
 * This adapter simulates a Havok-like solver state deterministically for C6 proofs.
 *
 * GAP DOCUMENTED: To upgrade to real Havok:
 *   1. `pnpm --filter @openclinxr/physics-touch-contract add -D @babylonjs/havok`
 *   2. In this adapter, `await HavokPhysics()` (dynamic import of WASM)
 *   3. Replace the step() body with real Havok rigid-body + contact manifold solve
 *   4. takeSnapshotBytes() serializes the real Havok world state
 *   5. Re-run C6 tests; if checksums match, upgrade engineId to "havok"
 *
 * State model (havok-candidate):
 *   - rigidBodies: Record<rigidBodyId, { pos, quat, vel, angVel, mass, isKinematic }>
 *   - contactManifolds: Record<contactId, { bodyA, bodyB, points[] }>
 *   - stepCount: number
 *   - seed: number
 *   - rngState: number — current PRNG state (serialized for C6 replay)
 *
 * Determinism: seeded PRNG (mulberry32) for "noise" on contact resolution.
 * rngState is part of the snapshot so applySnapshot → replay produces identical checksums.
 * Same seed + same input log → same checksums (C6).
 */

import type {
  DeterminismScope,
  PhysicsArtifactMeta,
  PhysicsTickInput,
} from "../types.js";
import type { PhysicsAdapter, PhysicsStateSnapshot } from "./stub.js";

// ---------------------------------------------------------------------------
// Havok-style state types
// ---------------------------------------------------------------------------
type Vec3 = { x: number; y: number; z: number };
type Quat4 = { x: number; y: number; z: number; w: number };

type RigidBodyState = {
  id: string;
  position: Vec3;
  rotation: Quat4;
  velocity: Vec3;
  angularVelocity: Vec3;
  mass: number;
  isKinematic: boolean;
};

type ContactPoint = {
  point: Vec3;
  normal: Vec3;
  penetrationDepth: number;
};

type ContactManifoldState = {
  id: string;
  bodyA: string;
  bodyB: string;
  points: ContactPoint[];
};

type HavokCandidateState = {
  rigidBodies: Record<string, RigidBodyState>;
  contactManifolds: Record<string, ContactManifoldState>;
  stepCount: number;
  seed: number;
  /** Current PRNG state — must be serialized for deterministic applySnapshot replay. */
  rngState: number;
};

// ---------------------------------------------------------------------------
// HavokCandidateAdapter
// ---------------------------------------------------------------------------
export class HavokCandidateAdapter implements PhysicsAdapter {
  readonly meta: PhysicsArtifactMeta;

  private _state: HavokCandidateState;

  /** Rigid body IDs that simulate the clinical touch bodies. */
  static readonly PALP_HAND_RB = "palp_hand";
  static readonly ABDOMEN_RB = "abdomen";
  static readonly EXAM_TABLE_RB = "exam_table";

  constructor(seed = 42) {
    this._state = this._buildInitialState(seed);

    this.meta = {
      determinismScope: "local" as DeterminismScope,
      notEvidenceFor: [
        "clinical_validity",
        "exam_equivalence",
        "scoring",
        "learner_readiness",
      ],
      generatorVersion: "0.1.0",
      engineId: "havok-candidate",
      seed,
      fixedDt: 1 / 60,
    };
  }

  step(input: PhysicsTickInput): void {
    this._state.stepCount = input.tick;

    // Resolve the input into the simulated physics bodies
    for (const pose of input.jointPoses) {
      // Simulate a Havok-style rigid-body integration for the palp hand
      const handRb =
        this._state.rigidBodies[HavokCandidateAdapter.PALP_HAND_RB];
      if (!handRb) continue;

      // Update hand position from joint pose (with slight Havok-style noise)
      const noiseScale = 0.001;
      handRb.position = {
        x: pose.position.x + (this._nextRandom() - 0.5) * noiseScale,
        y: pose.position.y + (this._nextRandom() - 0.5) * noiseScale,
        z: pose.position.z + (this._nextRandom() - 0.5) * noiseScale,
      };
      handRb.rotation = {
        x: pose.rotation.x,
        y: pose.rotation.y,
        z: pose.rotation.z,
        w: pose.rotation.w,
      };
    }

    // If contact region is specified, create/update a contact manifold (Havok-style)
    if (input.contactRegionId) {
      const contactId = `${HavokCandidateAdapter.PALP_HAND_RB}_${input.contactRegionId}_t${input.tick}`;
      const abdomenRb =
        this._state.rigidBodies[HavokCandidateAdapter.ABDOMEN_RB];
      const abdomenPos = abdomenRb?.position ?? { x: 0, y: 0, z: 0 };

      // Simulate a contact manifold between hand and abdomen
      this._state.contactManifolds[contactId] = {
        id: contactId,
        bodyA: HavokCandidateAdapter.PALP_HAND_RB,
        bodyB: HavokCandidateAdapter.ABDOMEN_RB,
        points: [
          {
            point: {
              x: abdomenPos.x + (this._nextRandom() - 0.5) * 0.01,
              y: abdomenPos.y + (this._nextRandom() - 0.5) * 0.01,
              z: abdomenPos.z + (this._nextRandom() - 0.5) * 0.01 + 0.1,
            },
            normal: { x: 0, y: 0, z: 1 },
            penetrationDepth:
              input.pinchStrength * 0.02 + this._nextRandom() * 0.001,
          },
        ],
      };
    }

    // Prune old contact manifolds (keep only the last 30 ticks)
    const currentTick = input.tick;
    const maxTickAge = 30;
    for (const key of Object.keys(this._state.contactManifolds)) {
      const mfTick = parseInt(
        key.split("_").pop() ?? "0",
        10,
      );
      if (!isNaN(mfTick) && currentTick - mfTick > maxTickAge) {
        delete this._state.contactManifolds[key];
      }
    }
  }

  takeSnapshotBytes(): Uint8Array {
    const json = JSON.stringify(this._state, stateReplacer);
    return new TextEncoder().encode(json);
  }

  takeSnapshot(): PhysicsStateSnapshot {
    return this.takeSnapshotBytes();
  }

  applySnapshot(snapshot: PhysicsStateSnapshot): void {
    const json = new TextDecoder().decode(snapshot);
    this._state = JSON.parse(json) as HavokCandidateState;
  }

  reset(seed: number): void {
    this._state = this._buildInitialState(seed);
  }

  // ---------------------------------------------------------------------------
  // Internal: deterministic PRNG (mulberry32) with rngState in the snapshot
  // ---------------------------------------------------------------------------

  /**
   * Deterministic PRNG step. Mutates _state.rngState so the full PRNG sequence
   * is checkpointed with every snapshot. applySnapshot restores it exactly.
   */
  private _nextRandom(): number {
    let s = this._state.rngState;
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    this._state.rngState = s;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private _buildInitialState(seed: number): HavokCandidateState {
    return {
      rigidBodies: {
        [HavokCandidateAdapter.PALP_HAND_RB]: {
          id: HavokCandidateAdapter.PALP_HAND_RB,
          position: { x: 0, y: 0.8, z: 0.4 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          mass: 0.5,
          isKinematic: false,
        },
        [HavokCandidateAdapter.ABDOMEN_RB]: {
          id: HavokCandidateAdapter.ABDOMEN_RB,
          position: { x: 0, y: 0.5, z: 0.3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          mass: 5.0,
          isKinematic: true,
        },
        [HavokCandidateAdapter.EXAM_TABLE_RB]: {
          id: HavokCandidateAdapter.EXAM_TABLE_RB,
          position: { x: 0, y: 0.3, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          mass: 0,
          isKinematic: true,
        },
      },
      contactManifolds: {},
      stepCount: 0,
      seed,
      rngState: seed,
    };
  }
}

/**
 * Deterministic JSON replacer: sorts object keys for reproducible serialization.
 */
function stateReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const k of keys) {
    sorted[k] = (value as Record<string, unknown>)[k];
  }
  return sorted;
}
