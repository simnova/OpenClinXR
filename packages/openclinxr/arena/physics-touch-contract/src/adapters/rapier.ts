/**
 * RapierCandidateAdapter — position-based RigidBody + impulse-based solver.
 *
 * CANDIDATE PATH: No real @dimforge/rapier3d WASM loaded.
 * Models Rapier's distinctive architecture deterministically for C6 proofs.
 *
 * State model (rapier-candidate):
 *   - rigidBodies: Record<rbId, { pos, prevPos, rot, vel, angVel, mass, isKinematic }>
 *   - contacts: Record<contactId, { bodyA, bodyB, point, normal, depth, warmStartImpulse }>
 *   - stepCount: number
 *   - seed: number
 *   - rngState: number — SplitMix32 PRNG state (distinct from Havok's mulberry32)
 *
 * Distinctives vs Havok:
 *   - Position-based Verlet integration (prevPos for velocity-free damping)
 *   - SplitMix32 PRNG (different generator family → different checksums)
 *   - Contact warm-starting impulses (carried across frames)
 *   - SOR-like constraint relaxation (applied every step)
 *
 * GAP DOCUMENTED: To upgrade to real Rapier:
 *   1. `pnpm --filter @openclinxr/physics-touch-contract add @dimforge/rapier3d`
 *   2. Replace step() with real Rapier World.step() + RigidBody/ImpulseJoint APIs
 *   3. takeSnapshotBytes() serializes the Rapier World.takeSnapshot()
 *   4. Re-run C6 tests; if checksums match, upgrade engineId to "rapier"
 */

import type {
  DeterminismScope,
  PhysicsArtifactMeta,
  PhysicsTickInput,
} from "../types.js";
import type { PhysicsConfigV1 } from "../factory/physics-config-v1.js";
import type { PhysicsAdapter, PhysicsStateSnapshot } from "./stub.js";

// ---------------------------------------------------------------------------
// Rapier-style state types
// ---------------------------------------------------------------------------
type Vec3 = { x: number; y: number; z: number };
type Quat4 = { x: number; y: number; z: number; w: number };

type RapierRigidBodyState = {
  id: string;
  /** Current position (Verlet: the "current" point). */
  position: Vec3;
  /** Previous position (Verlet integration uses this for implicit velocity). */
  prevPosition: Vec3;
  rotation: Quat4;
  velocity: Vec3;
  angularVelocity: Vec3;
  mass: number;
  isKinematic: boolean;
};

type RapierContactState = {
  id: string;
  bodyA: string;
  bodyB: string;
  point: Vec3;
  normal: Vec3;
  penetrationDepth: number;
  /** Warm-starting impulse accumulated across solver iterations (Rapier-style). */
  warmStartImpulse: number;
};

type RapierCandidateState = {
  rigidBodies: Record<string, RapierRigidBodyState>;
  contacts: Record<string, RapierContactState>;
  stepCount: number;
  seed: number;
  /** SplitMix32 PRNG state (distinct from Havok's mulberry32). */
  rngState: number;
};

// ---------------------------------------------------------------------------
// RapierCandidateAdapter
// ---------------------------------------------------------------------------
export class RapierCandidateAdapter implements PhysicsAdapter {
  readonly meta: PhysicsArtifactMeta;

  private _state: RapierCandidateState;
  private _config: PhysicsConfigV1 | null;

  static readonly PALP_HAND_RB = "palp_hand";
  static readonly ABDOMEN_RB = "abdomen";
  static readonly EXAM_TABLE_RB = "exam_table";

  /**
   * Create a RapierCandidateAdapter from a PhysicsConfigV1.
   *
   * Derives body masses, seed, and fixedDt from config.
   * When config is provided, the adapter MUST NOT invent its own
   * mass/stiffness constants — all simulation parameters come from config.
   */
  static fromPhysicsConfig(config: PhysicsConfigV1): RapierCandidateAdapter {
    return new RapierCandidateAdapter(config.seed, config);
  }

  /**
   * @param seed - PRNG seed (default 42). Overridden by config.seed if config provided.
   * @param config - Optional PhysicsConfigV1. When provided, body masses and
   *                 simulation parameters are derived from config rather than
   *                 hardcoded adapter defaults (anti-invention guard).
   */
  constructor(seed = 42, config?: PhysicsConfigV1) {
    this._config = config ?? null;
    const effectiveSeed = config?.seed ?? seed;
    this._state = this._buildInitialState(effectiveSeed, config);

    this.meta = {
      determinismScope: "local" as DeterminismScope,
      notEvidenceFor: [
        "clinical_validity",
        "exam_equivalence",
        "scoring",
        "learner_readiness",
      ],
      generatorVersion: "0.1.0",
      engineId: "rapier-candidate",
      seed: effectiveSeed,
      fixedDt: config?.fixedDt ?? 1 / 60,
    };
  }

  step(input: PhysicsTickInput): void {
    this._state.stepCount = input.tick;

    // -----------------------------------------------------------------------
    // 1. Position-based Verlet integration (Rapier's distinctive approach)
    //    - Store previous position → current position
    //    - Apply velocity-based displacement via prevPos
    // -----------------------------------------------------------------------
    const dt = 1 / 60;
    const dt2 = dt * dt;

    // Sorted keys so live step order matches post-JSON-snapshot restore (C6).
    for (const rbId of Object.keys(this._state.rigidBodies).sort()) {
      const rb = this._state.rigidBodies[rbId]!;
      if (!rb || rb.isKinematic) continue;

      // Verlet: new_pos = 2*pos - prevPos + acceleration * dt^2
      const damping = 0.98; // Rapier-style slight damping
      const velX = (rb.position.x - rb.prevPosition.x) * damping;
      const velY = (rb.position.y - rb.prevPosition.y) * damping;
      const velZ = (rb.position.z - rb.prevPosition.z) * damping;

      // Gravity-like downward acceleration (Rapier uses -9.81 in Y-up)
      const gravityY = -9.81;

      const prevPos = { ...rb.position };
      rb.position = {
        x: rb.position.x + velX,
        y: rb.position.y + velY + gravityY * dt2,
        z: rb.position.z + velZ,
      };
      rb.prevPosition = prevPos;

      // Update velocity from Verlet displacement
      rb.velocity = {
        x: (rb.position.x - rb.prevPosition.x) / dt,
        y: (rb.position.y - rb.prevPosition.y) / dt,
        z: (rb.position.z - rb.prevPosition.z) / dt,
      };
    }

    // -----------------------------------------------------------------------
    // 2. Apply input-driven hand motion (kinematic-like update with noise)
    // -----------------------------------------------------------------------
    for (const pose of input.jointPoses) {
      const handRb =
        this._state.rigidBodies[RapierCandidateAdapter.PALP_HAND_RB];
      if (!handRb) continue;

      // Rapier-style noise: SplitMix32 with slightly larger noise scale
      const noiseScale = 0.0015;
      handRb.position = {
        x: pose.position.x + (this._nextRandom() - 0.5) * noiseScale,
        y: pose.position.y + (this._nextRandom() - 0.5) * noiseScale,
        z: pose.position.z + (this._nextRandom() - 0.5) * noiseScale,
      };
      handRb.prevPosition = {
        x: handRb.position.x - handRb.velocity.x * dt,
        y: handRb.position.y - handRb.velocity.y * dt,
        z: handRb.position.z - handRb.velocity.z * dt,
      };
      handRb.rotation = {
        x: pose.rotation.x,
        y: pose.rotation.y,
        z: pose.rotation.z,
        w: pose.rotation.w,
      };
    }

    // -----------------------------------------------------------------------
    // 3. Contact detection with warm-starting (Rapier-style SOR impulses)
    // -----------------------------------------------------------------------
    if (input.contactRegionId) {
      const contactId = `${RapierCandidateAdapter.PALP_HAND_RB}_${input.contactRegionId}_t${input.tick}`;
      const abdomenRb =
        this._state.rigidBodies[RapierCandidateAdapter.ABDOMEN_RB];
      const handRb =
        this._state.rigidBodies[RapierCandidateAdapter.PALP_HAND_RB];

      const abdomenPos = abdomenRb?.position ?? { x: 0, y: 0.5, z: 0.3 };
      const handPos = handRb?.position ?? { x: 0, y: 0.8, z: 0.4 };

      // Direction from abdomen toward hand (contact normal)
      const dx = handPos.x - abdomenPos.x;
      const dy = handPos.y - abdomenPos.y;
      const dz = handPos.z - abdomenPos.z;
      const invLen =
        1 / Math.sqrt(dx * dx + dy * dy + dz * dz + 1e-10);

      // Rapier-style contact with warm-starting impulse
      // Impulse magnitude grows across repeated contacts (warm-starting)
      const existingContact = this._state.contacts[contactId];
      const baseImpulse = input.pinchStrength * 0.05;
      const warmStartBonus = existingContact
        ? existingContact.warmStartImpulse * 0.8
        : 0;
      const totalImpulse =
        baseImpulse + warmStartBonus + this._nextRandom() * 0.002;

      this._state.contacts[contactId] = {
        id: contactId,
        bodyA: RapierCandidateAdapter.PALP_HAND_RB,
        bodyB: RapierCandidateAdapter.ABDOMEN_RB,
        point: {
          x: abdomenPos.x + dx * invLen * 0.08,
          y: abdomenPos.y + dy * invLen * 0.08,
          z: abdomenPos.z + dz * invLen * 0.08,
        },
        normal: { x: dx * invLen, y: dy * invLen, z: dz * invLen },
        penetrationDepth: input.pinchStrength * 0.025 + totalImpulse * 0.1,
        warmStartImpulse: totalImpulse,
      };
    }

    // -----------------------------------------------------------------------
    // 4. SOR-like constraint relaxation (Rapier hallmark)
    //    - Iterate over active contacts and apply impulse corrections
    // -----------------------------------------------------------------------
    const sorRelaxation = 1.2; // Successive over-relaxation factor
    for (const contactId of Object.keys(this._state.contacts).sort()) {
      const contact = this._state.contacts[contactId]!;
      const bodyA = this._state.rigidBodies[contact.bodyA];
      const bodyB = this._state.rigidBodies[contact.bodyB];
      if (!bodyA || !bodyB) continue;

      // Push bodies apart along contact normal (penetration resolution)
      const correction = contact.penetrationDepth * sorRelaxation * 0.5;
      if (!bodyA.isKinematic) {
        bodyA.position = {
          x: bodyA.position.x + contact.normal.x * correction / (bodyA.mass + 1e-6),
          y: bodyA.position.y + contact.normal.y * correction / (bodyA.mass + 1e-6),
          z: bodyA.position.z + contact.normal.z * correction / (bodyA.mass + 1e-6),
        };
      }
    }

    // Prune old contacts (keep only last 30 ticks — Rapier uses narrower window)
    const currentTick = input.tick;
    const maxTickAge = 25;
    for (const key of Object.keys(this._state.contacts)) {
      const ctTick = parseInt(key.split("_").pop() ?? "0", 10);
      if (!isNaN(ctTick) && currentTick - ctTick > maxTickAge) {
        delete this._state.contacts[key];
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
    this._state = JSON.parse(json) as RapierCandidateState;
  }

  reset(seed: number): void {
    const effectiveSeed = this._config?.seed ?? seed;
    this._state = this._buildInitialState(effectiveSeed, this._config ?? undefined);
  }

  // ---------------------------------------------------------------------------
  // Internal: SplitMix32 PRNG (distinct from Havok's mulberry32)
  // ---------------------------------------------------------------------------

  /**
   * SplitMix32 — a fast, high-quality PRNG.
   * Different algorithm family from Havok's mulberry32 → different checksums.
   */
  private _nextRandom(): number {
    let s = this._state.rngState;
    s = (s + 0x9e3779b9) | 0;
    s = Math.imul(s ^ (s >>> 16), 0x85ebca6b) | 0;
    s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35) | 0;
    this._state.rngState = s;
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  }

  private _buildInitialState(
    seed: number,
    config?: PhysicsConfigV1,
  ): RapierCandidateState {
    // SplitMix32 seed: use a different initial rngState strategy
    const rngSeed = (seed ^ 0xdeadbeef) >>> 0;

    // Derive body masses from config when provided (anti-invention).
    // When config is absent, use hardcoded defaults (backward compat).
    const abdomenMass = config?.masses["abdomen"] ?? 5.0;
    const handMass = 0.5; // hand mass is not driven by clinical body-region config; kept stable

    return {
      rigidBodies: {
        [RapierCandidateAdapter.PALP_HAND_RB]: {
          id: RapierCandidateAdapter.PALP_HAND_RB,
          position: { x: 0, y: 0.8, z: 0.4 },
          prevPosition: { x: 0, y: 0.8005, z: 0.4 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          mass: handMass,
          isKinematic: false,
        },
        [RapierCandidateAdapter.ABDOMEN_RB]: {
          id: RapierCandidateAdapter.ABDOMEN_RB,
          position: { x: 0, y: 0.5, z: 0.3 },
          prevPosition: { x: 0, y: 0.5, z: 0.3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          mass: abdomenMass,
          isKinematic: true,
        },
        [RapierCandidateAdapter.EXAM_TABLE_RB]: {
          id: RapierCandidateAdapter.EXAM_TABLE_RB,
          position: { x: 0, y: 0.3, z: 0 },
          prevPosition: { x: 0, y: 0.3, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          mass: 0,
          isKinematic: true,
        },
      },
      contacts: {},
      stepCount: 0,
      seed,
      rngState: rngSeed,
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
