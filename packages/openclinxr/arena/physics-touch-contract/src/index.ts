/**
 * @openclinxr/physics-touch-contract
 *
 * Determinism contract for physics-compliant clinical touch.
 * One interface, three engine adapters (stub/havok/rapier/jolt).
 *
 * C1: Fixed step at dt = 1/60
 * C2: Input as recorded stream (no live device reads)
 * C3: Snapshot + SHA-256 checksum every N ticks
 * C4: No non-reproducible inputs to the solver
 * C5: Declared determinism scope
 * C6: Replay equivalence (identical input → identical checksums)
 * C7: Physics output is not scoring evidence
 */

// Types
export type {
  ContactRegionId,
  DeterminismScope,
  Handedness,
  InputLog,
  JointPose,
  PhysicsArtifactMeta,
  PhysicsTickInput,
  Sha256Hex,
  SnapshotChecksum,
} from "./types.js";
export {
  createStubPhysicsArtifactMeta,
  defaultNotEvidenceFor,
} from "./types.js";

// Fixed step (C1)
export {
  accumulateFrameTime,
  consumeTick,
  createFixedStepAccumulator,
  currentTick,
  FIXED_DT,
} from "./fixed-step.js";
export type { FixedStepAccumulator } from "./fixed-step.js";

// Input log (C2)
export {
  appendTickInput,
  createInputLog,
  getTickInput,
  inputLogLength,
  listTickInputs,
} from "./input-log.js";

// Snapshot hash (C3)
export {
  computeSnapshotHash,
  hashState,
  serializeState,
} from "./snapshot-hash.js";

// Replay (C6)
export {
  buildDeterministicInputLog,
  DEFAULT_CHECKPOINT_INTERVAL,
  replayFromSnapshot,
  replayInputLog,
} from "./replay.js";
export type { ReplayResult, ReplayTrace } from "./replay.js";

// Adapter contract
export type { PhysicsAdapter, PhysicsStateSnapshot } from "./adapters/stub.js";
export { StubPhysicsAdapter } from "./adapters/stub.js";
