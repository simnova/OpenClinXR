/**
 * JoltCandidateAdapter — velocity-based sub-stepped rigid body solver.
 *
 * CANDIDATE PATH: No real JoltPhysics WASM loaded.
 * Models Jolt's distinctive architecture deterministically for C6 proofs.
 *
 * State model (jolt-candidate):
 *   - rigidBodies: Record<rbId, { pos, rot, vel, angVel, mass, isKinematic,
 *       broadPhaseProxy }>
 *   - contacts: Record<contactId, { bodyA, bodyB, point, normal, depth,
 *       combinedRestitution, combinedFriction }>
 *   - broadPhase: { gridCells: Record<cellKey, string[]> } — hierarchical grid
 *   - stepCount: number
 *   - subStep: number (0 or 1 within each tick)
 *   - seed: number
 *   - rngState: number[] — Xoshiro128** PRNG state (4 × u32)
 *
 * Distinctives vs Havok:
 *   - Velocity-based integration (no prevPos — explicit acceleration + Euler)
 *   - Two sub-steps per tick (Jolt's sub-stepping for stability)
 *   - Hierarchical broad-phase grid (Jolt's spatial partitioning)
 *   - Speculative contact points (slightly projected positions)
 *   - Xoshiro128** PRNG (different generator family → different checksums)
 *   - Material properties: combinedRestitution + combinedFriction on contacts
 *
 * GAP DOCUMENTED: To upgrade to real Jolt:
 *   1. Real Jolt is a C++ library; Node binding via napi-rs or emscripten WASM
 *   2. Replace step() with real Jolt PhysicsSystem.Update()
 *   3. takeSnapshotBytes() serializes via Jolt StateRecorder
 *   4. Re-run C6 tests; if checksums match, upgrade engineId to "jolt"
 */

import type {
  DeterminismScope,
  PhysicsArtifactMeta,
  PhysicsTickInput,
} from "../types.js";
import type { PhysicsAdapter, PhysicsStateSnapshot } from "./stub.js";

// ---------------------------------------------------------------------------
// Jolt-style state types
// ---------------------------------------------------------------------------
type Vec3 = { x: number; y: number; z: number };
type Quat4 = { x: number; y: number; z: number; w: number };

type JoltRigidBodyState = {
  id: string;
  position: Vec3;
  rotation: Quat4;
  velocity: Vec3;
  angularVelocity: Vec3;
  mass: number;
  isKinematic: boolean;
  /** Jolt broad-phase proxy: cell key for hierarchical grid lookup. */
  broadPhaseCell: string;
};

type JoltContactState = {
  id: string;
  bodyA: string;
  bodyB: string;
  point: Vec3;
  normal: Vec3;
  penetrationDepth: number;
  /** Speculative contact: point slightly ahead of current position. */
  speculativeOffset: number;
  /** Jolt-style combined material properties. */
  combinedRestitution: number;
  combinedFriction: number;
};

type JoltCandidateState = {
  rigidBodies: Record<string, JoltRigidBodyState>;
  contacts: Record<string, JoltContactState>;
  /** Broad-phase hierarchical grid cells. */
  broadPhaseCells: Record<string, string[]>;
  stepCount: number;
  /** Current sub-step (0 or 1) within the tick. */
  subStep: number;
  seed: number;
  /** Xoshiro128** PRNG state: 4 u32 values. */
  rngState: number[];
};

// ---------------------------------------------------------------------------
// JoltCandidateAdapter
// ---------------------------------------------------------------------------
export class JoltCandidateAdapter implements PhysicsAdapter {
  readonly meta: PhysicsArtifactMeta;

  private _state: JoltCandidateState;

  static readonly PALP_HAND_RB = "palp_hand";
  static readonly ABDOMEN_RB = "abdomen";
  static readonly EXAM_TABLE_RB = "exam_table";

  /** Jolt uses 2 sub-steps per physics tick for stability. */
  static readonly SUB_STEPS_PER_TICK = 2;

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
      engineId: "jolt-candidate",
      seed,
      fixedDt: 1 / 60,
    };
  }

  step(input: PhysicsTickInput): void {
    this._state.stepCount = input.tick;

    // Jolt sub-steps: run 2 half-steps per tick
    for (let sub = 0; sub < JoltCandidateAdapter.SUB_STEPS_PER_TICK; sub++) {
      this._state.subStep = sub;
      this._subStepPhysics(input, sub);
    }
  }

  /**
   * Single sub-step of Jolt-style velocity-based integration.
   */
  private _subStepPhysics(input: PhysicsTickInput, subStep: number): void {
    const subDt = (1 / 60) / JoltCandidateAdapter.SUB_STEPS_PER_TICK;

    // -----------------------------------------------------------------------
    // 1. Velocity-based integration (Jolt's Euler semi-implicit approach)
    //    v(t+dt) = v(t) + a*dt
    //    x(t+dt) = x(t) + v(t+dt)*dt
    // -----------------------------------------------------------------------
    // Sorted keys so live step order matches post-JSON-snapshot restore (C6).
    for (const rbId of Object.keys(this._state.rigidBodies).sort()) {
      const rb = this._state.rigidBodies[rbId]!;
      if (!rb || rb.isKinematic) continue;

      // Gravity in Jolt (configurable, default -9.81 in Y-up)
      const gravity = { x: 0, y: -9.81, z: 0 };

      // Damping (Jolt uses linear + angular damping)
      const linearDamping = 0.05;
      const dampedVel = {
        x: rb.velocity.x * (1 - linearDamping * subDt),
        y: rb.velocity.y * (1 - linearDamping * subDt),
        z: rb.velocity.z * (1 - linearDamping * subDt),
      };

      // Acceleration = gravity / mass (simplified; real Jolt adds forces)
      const invMass = rb.mass > 0 ? 1 / rb.mass : 0;
      const accel = {
        x: gravity.x * invMass,
        y: gravity.y * invMass,
        z: gravity.z * invMass,
      };

      // Semi-implicit Euler
      rb.velocity = {
        x: dampedVel.x + accel.x * subDt,
        y: dampedVel.y + accel.y * subDt,
        z: dampedVel.z + accel.z * subDt,
      };

      rb.position = {
        x: rb.position.x + rb.velocity.x * subDt,
        y: rb.position.y + rb.velocity.y * subDt,
        z: rb.position.z + rb.velocity.z * subDt,
      };
    }

    // -----------------------------------------------------------------------
    // 2. Broad-phase update (Jolt's hierarchical grid)
    //    - Assign each body to a grid cell based on position
    // -----------------------------------------------------------------------
    this._updateBroadPhase();

    // -----------------------------------------------------------------------
    // 3. Apply input-driven hand motion (with Jolt-style speculative noise)
    //    Only update on subStep 0 to avoid double-applying per tick
    // -----------------------------------------------------------------------
    if (subStep === 0) {
      for (const pose of input.jointPoses) {
        const handRb =
          this._state.rigidBodies[JoltCandidateAdapter.PALP_HAND_RB];
        if (!handRb) continue;

        // Jolt uses slightly different noise profile (Xoshiro128**)
        const noiseScale = 0.002;
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
        handRb.velocity = {
          x: (this._nextRandom() - 0.5) * 0.01,
          y: (this._nextRandom() - 0.5) * 0.01,
          z: (this._nextRandom() - 0.5) * 0.01,
        };
      }
    }

    // -----------------------------------------------------------------------
    // 4. Speculative contact detection (Jolt's distinctive approach)
    //    - Project positions slightly forward using velocity
    //    - Detect contacts at projected positions
    //    - Combined material properties (restitution, friction)
    // -----------------------------------------------------------------------
    if (input.contactRegionId && subStep === 0) {
      const contactId = `${JoltCandidateAdapter.PALP_HAND_RB}_${input.contactRegionId}_t${input.tick}_s${subStep}`;
      const abdomenRb =
        this._state.rigidBodies[JoltCandidateAdapter.ABDOMEN_RB];
      const handRb =
        this._state.rigidBodies[JoltCandidateAdapter.PALP_HAND_RB];

      const abdomenPos = abdomenRb?.position ?? { x: 0, y: 0.5, z: 0.3 };

      // Speculative projection: look ahead by velocity * subDt
      const handVel = handRb?.velocity ?? { x: 0, y: 0, z: 0 };
      const lookaheadTime = subDt * 2;
      const projectedPos = {
        x: (handRb?.position.x ?? 0) + handVel.x * lookaheadTime,
        y: (handRb?.position.y ?? 0) + handVel.y * lookaheadTime,
        z: (handRb?.position.z ?? 0) + handVel.z * lookaheadTime,
      };

      // Direction from abdomen toward projected hand position
      const dx = projectedPos.x - abdomenPos.x;
      const dy = projectedPos.y - abdomenPos.y;
      const dz = projectedPos.z - abdomenPos.z;
      const invLen =
        1 / Math.sqrt(dx * dx + dy * dy + dz * dz + 1e-10);

      const depth = input.pinchStrength * 0.03 + this._nextRandom() * 0.0015;

      this._state.contacts[contactId] = {
        id: contactId,
        bodyA: JoltCandidateAdapter.PALP_HAND_RB,
        bodyB: JoltCandidateAdapter.ABDOMEN_RB,
        point: {
          x: abdomenPos.x + dx * invLen * 0.07 + (this._nextRandom() - 0.5) * 0.005,
          y: abdomenPos.y + dy * invLen * 0.07 + (this._nextRandom() - 0.5) * 0.005,
          z: abdomenPos.z + dz * invLen * 0.07 + (this._nextRandom() - 0.5) * 0.005,
        },
        normal: { x: dx * invLen, y: dy * invLen, z: dz * invLen },
        penetrationDepth: depth,
        speculativeOffset: lookaheadTime,
        // Jolt-style material properties (skin on skin contact)
        combinedRestitution: 0.1 + this._nextRandom() * 0.05,
        combinedFriction: 0.5 + this._nextRandom() * 0.2,
      };
    }

    // -----------------------------------------------------------------------
    // 5. Contact resolution with Jolt-style impulse + material response
    // -----------------------------------------------------------------------
    for (const contactId of Object.keys(this._state.contacts).sort()) {
      const contact = this._state.contacts[contactId]!;
      const bodyA = this._state.rigidBodies[contact.bodyA];
      const bodyB = this._state.rigidBodies[contact.bodyB];
      if (!bodyA || !bodyB) continue;

      // Penetration resolution (position correction)
      const correctionStrength = 0.8;
      const positionCorrection = contact.penetrationDepth * correctionStrength;
      if (!bodyA.isKinematic) {
        bodyA.position = {
          x: bodyA.position.x + contact.normal.x * positionCorrection / (bodyA.mass + 1e-6),
          y: bodyA.position.y + contact.normal.y * positionCorrection / (bodyA.mass + 1e-6),
          z: bodyA.position.z + contact.normal.z * positionCorrection / (bodyA.mass + 1e-6),
        };
      }

      // Velocity response (Jolt-style restitution + friction)
      if (!bodyA.isKinematic) {
        const relVelX = bodyA.velocity.x - (bodyB.isKinematic ? 0 : bodyB.velocity.x);
        const relVelY = bodyA.velocity.y - (bodyB.isKinematic ? 0 : bodyB.velocity.y);
        const relVelZ = bodyA.velocity.z - (bodyB.isKinematic ? 0 : bodyB.velocity.z);

        // Normal impulse with restitution
        const relVelNormal =
          relVelX * contact.normal.x +
          relVelY * contact.normal.y +
          relVelZ * contact.normal.z;

        const restitutionImpulse =
          -(1 + contact.combinedRestitution) * relVelNormal / (1 / bodyA.mass + 1e-6);

        bodyA.velocity = {
          x: bodyA.velocity.x + restitutionImpulse * contact.normal.x * (1 / bodyA.mass),
          y: bodyA.velocity.y + restitutionImpulse * contact.normal.y * (1 / bodyA.mass),
          z: bodyA.velocity.z + restitutionImpulse * contact.normal.z * (1 / bodyA.mass),
        };

        // Friction impulse (tangential, Jolt-style)
        const frictionScale = contact.combinedFriction * 0.1;
        bodyA.velocity = {
          x: bodyA.velocity.x - relVelX * frictionScale,
          y: bodyA.velocity.y - relVelY * frictionScale,
          z: bodyA.velocity.z - relVelZ * frictionScale,
        };
      }
    }

    // Prune old contacts (Jolt keeps slightly longer window)
    const currentTick = input.tick;
    const maxTickAge = 35;
    for (const key of Object.keys(this._state.contacts)) {
      const parts = key.split("_");
      const ctTick = parseInt(parts[parts.length - 2] ?? "0", 10);
      if (!isNaN(ctTick) && currentTick - ctTick > maxTickAge) {
        delete this._state.contacts[key];
      }
    }
  }

  /**
   * Update the broad-phase hierarchical grid based on body positions.
   * Jolt uses a layered grid for spatial partitioning.
   */
  private _updateBroadPhase(): void {
    this._state.broadPhaseCells = {};

    for (const rbId of Object.keys(this._state.rigidBodies).sort()) {
      const rb = this._state.rigidBodies[rbId]!;
      if (!rb) continue;
      // Cell key: floor position / cellSize
      const cellSize = 0.5;
      const cx = Math.floor(rb.position.x / cellSize);
      const cy = Math.floor(rb.position.y / cellSize);
      const cz = Math.floor(rb.position.z / cellSize);
      const cellKey = `${cx}:${cy}:${cz}`;

      rb.broadPhaseCell = cellKey;

      if (!this._state.broadPhaseCells[cellKey]) {
        this._state.broadPhaseCells[cellKey] = [];
      }
      this._state.broadPhaseCells[cellKey]!.push(rb.id);
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
    this._state = JSON.parse(json) as JoltCandidateState;
  }

  reset(seed: number): void {
    this._state = this._buildInitialState(seed);
  }

  // ---------------------------------------------------------------------------
  // Internal: Xoshiro128** PRNG (distinct from Havok + Rapier)
  // ---------------------------------------------------------------------------

  /**
   * Xoshiro128** — high-quality 4-state PRNG.
   * Used by JoltPhysics for deterministic noise.
   * Different algorithm → different checksums from both Havok and Rapier.
   */
  private _nextRandom(): number {
    const s = this._state.rngState;
    const result = Math.imul(
      Math.imul(s[1]! * 5, s[1]! * 5) << 7 | (Math.imul(s[1]! * 5, s[1]! * 5) >>> 25),
      s[1]! * 5,
    );
    const t = s[1]! << 9;

    s[2] = s[2]! ^ s[0]!;
    s[3] = s[3]! ^ s[1]!;
    s[1] = s[1]! ^ s[2]!;
    s[0] = s[0]! ^ s[3]!;

    s[2] = s[2]! ^ t;
    s[3] = ((s[3]! << 11) | (s[3]! >>> 21)) >>> 0;

    this._state.rngState = s;

    return (result >>> 0) / 4294967296;
  }

  private _buildInitialState(seed: number): JoltCandidateState {
    // Split seed into 4 u32 values (Jolt-style seeding)
    const s0 = (seed ^ 0x9e3779b9) >>> 0;
    const s1 = ((seed * 0x85ebca6b) & 0xffffffff) >>> 0;
    const s2 = ((seed ^ 0xc2b2ae35) & 0xffffffff) >>> 0;
    const s3 = ((seed * 0x27d4eb2f) & 0xffffffff) >>> 0;

    return {
      rigidBodies: {
        [JoltCandidateAdapter.PALP_HAND_RB]: {
          id: JoltCandidateAdapter.PALP_HAND_RB,
          position: { x: 0, y: 0.8, z: 0.4 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          mass: 0.5,
          isKinematic: false,
          broadPhaseCell: "0:1:0",
        },
        [JoltCandidateAdapter.ABDOMEN_RB]: {
          id: JoltCandidateAdapter.ABDOMEN_RB,
          position: { x: 0, y: 0.5, z: 0.3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          mass: 5.0,
          isKinematic: true,
          broadPhaseCell: "0:1:0",
        },
        [JoltCandidateAdapter.EXAM_TABLE_RB]: {
          id: JoltCandidateAdapter.EXAM_TABLE_RB,
          position: { x: 0, y: 0.3, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          mass: 0,
          isKinematic: true,
          broadPhaseCell: "0:0:0",
        },
      },
      contacts: {},
      broadPhaseCells: {
        "0:1:0": [
          JoltCandidateAdapter.PALP_HAND_RB,
          JoltCandidateAdapter.ABDOMEN_RB,
        ],
        "0:0:0": [JoltCandidateAdapter.EXAM_TABLE_RB],
      },
      stepCount: 0,
      subStep: 0,
      seed,
      rngState: [s0, s1, s2, s3],
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
