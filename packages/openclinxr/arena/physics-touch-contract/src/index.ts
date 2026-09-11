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


// Fixed step (C1)
export {
  accumulateFrameTime,
  consumeTick,
  createFixedStepAccumulator,
  currentTick,
  FIXED_DT,
} from "./fixed-step.js";
// Input log (C2)
export {
  appendTickInput,
  createInputLog,
  getTickInput,
  inputLogLength,
  listTickInputs,
} from "./input-log.js";
// Replay (C6)
export {
  buildDeterministicInputLog,
  replayFromSnapshot,
  replayInputLog,
} from "./replay.js";

// Snapshot hash (C3)
export {
  computeSnapshotHash,
  hashState,
  serializeState,
} from "./snapshot-hash.js";
export {
  createStubPhysicsArtifactMeta,
  defaultNotEvidenceFor,
} from "./types.js";

// Adapter contract

export {
  StubPhysicsAdapter,
} from "./adapters/stub.js";
// Three-way cagematch (Havok vs Rapier vs Jolt)
export {
  runThreeWayCagematch,
} from "./cagematch/three-way.js";
export {
  runMeasuredMetrics,
} from "./metrics/measure.js";
export type {
  PhysicsCagematchReport,
} from "./metrics/report.js";
// Cagematch metrics
export {
  buildPhysicsCagematchReport,
} from "./metrics/report.js";
export {
  buildPalpationInputLog,
} from "./scenarios/palpation.js";
import "./inspection/scenario-inspection.js";
