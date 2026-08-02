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

// Engine candidate adapters
export { HavokCandidateAdapter } from "./adapters/havok.js";
export { RapierCandidateAdapter } from "./adapters/rapier.js";
export { JoltCandidateAdapter } from "./adapters/jolt.js";

// Real engine adapter (AD-1: engineId="rapier", NOT /-candidate$/)
export { RapierRealAdapter, initRapier, isRapierInitialized } from "./adapters/rapier-real.js";

// Palpation scenario (C2 input log)
export {
  buildPalpationInputLog,
  DEFAULT_PALPATION_SITES,
} from "./scenarios/palpation.js";
export type { PalpationConfig, PalpationQuadrant, PalpationSite } from "./scenarios/palpation.js";

// Cagematch metrics
export { buildPhysicsCagematchReport } from "./metrics/report.js";
export type { BuildCagematchReportOptions, PhysicsCagematchReport } from "./metrics/report.js";

// Three-way cagematch (Havok vs Rapier vs Jolt)
export { runThreeWayCagematch } from "./cagematch/three-way.js";
export type {
  EngineResult,
  ThreeWayCagematchReport,
  ThreeWayVerdict,
} from "./cagematch/three-way.js";

// Winner-path scenarios (passive ROM, guarding, positioning)
export {
  buildPassiveRomInputLog,
  DEFAULT_PASSIVE_ROM_CONFIG,
} from "./scenarios/passive-rom.js";
export type {
  PassiveRomConfig,
  RomDirection,
  RomJoint,
  RomSide,
} from "./scenarios/passive-rom.js";

export {
  buildGuardingInputLog,
  DEFAULT_GUARDING_CONFIG,
} from "./scenarios/guarding.js";
export type {
  GuardingConfig,
  GuardingThresholdEvent,
} from "./scenarios/guarding.js";

export {
  buildPositioningInputLog,
  DEFAULT_POSITIONING_CONFIG,
} from "./scenarios/positioning.js";
export type { PositioningConfig } from "./scenarios/positioning.js";

// Scenario inspection
export { buildScenarioInspectionReport } from "./inspection/scenario-inspection.js";
export type {
  BuildInspectionReportOptions,
  GarmentCoherenceClaim,
  ScenarioEntry,
  ScenarioInspectionReport,
  ScenarioInspectionResult,
} from "./inspection/scenario-inspection.js";

// Physics config v1 factory (s5)
export {
  createDefaultPhysicsConfigV1,
  generatePhysicsConfigFromPhenotype,
} from "./factory/physics-config-v1.js";
export type {
  PhenotypeBodyMechanics,
  PhysicsConfigPhenotypeInput,
  PhysicsConfigV1,
} from "./factory/physics-config-v1.js";

// Habitus tables (s5)
export {
  AVERAGE_COMPLIANCE,
  AVERAGE_GUARDING_TRIGGERS,
  AVERAGE_JOINT_LIMITS,
  AVERAGE_MASS,
  FRAIL_COMPLIANCE,
  FRAIL_GUARDING_TRIGGERS,
  FRAIL_JOINT_LIMITS,
  FRAIL_MASS,
  OBESE_COMPLIANCE,
  OBESE_GUARDING_TRIGGERS,
  OBESE_JOINT_LIMITS,
  OBESE_MASS,
  selectComplianceTable,
  selectGuardingTriggers,
  selectJointLimitTable,
  selectMassTable,
} from "./factory/habitus-tables.js";
export type {
  ComplianceRegion,
  ComplianceTable,
  GuardingTriggerEntry,
  Habitus,
  HabitusBodyRegion,
  HabitusJoint,
  JointLimit,
  JointLimitTable,
  MassTable,
} from "./factory/habitus-tables.js";

// Promotion gates (pre-production fence)
export { PHYSICS_TOUCH_PROMOTION, runtimePromotionAllowed } from "./promotion-gates.js";
