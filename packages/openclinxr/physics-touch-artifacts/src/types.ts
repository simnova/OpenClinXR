/**
 * Physics Touch Artifacts — Schema Types for Baked Bone-Transform JSON
 *
 * Production-safe package: zero Rapier dependency.
 * Production apps (ui-xr, ui-admin, api) MAY import from this package.
 *
 * The baked JSON artifact is generated offline by
 * `packages/openclinxr/arena/physics-touch-contract/src/cli/generate-physics-bone-transforms.ts`
 * and committed to the consuming app's source tree (e.g., apps/ui-xr/src/physics-touch/).
 *
 * Governing artitecture: split-gate model — baked transforms are consumer-ready;
 * live Rapier WASM remains arena-only.
 * See docs/madr/0031-physics-baked-vs-live-consumer-split.md
 */

/** Schema version identifier for the baked artifact */
export type BakedPhysicsSchemaVersion = "openclinxr.physics-bone-transforms.v1";

/** A single bone's delta transform at a simulation tick */
export interface BoneDelta {
  /** Translation offset in mm (x, y, z) */
  translation: [number, number, number];
  /** Rotation in Euler radians (x, y, z) */
  rotation: [number, number, number];
}

/** One frame of baked bone transforms */
export interface BakedBoneFrame {
  /** Simulation tick number */
  tick: number;
  /** Bone name → delta transform */
  boneDeltas: Record<string, BoneDelta>;
}

/** Top-level baked bone-transforms artifact */
export interface BakedBoneTransformsArtifact {
  /** Schema version */
  schemaVersion: BakedPhysicsSchemaVersion;
  /** ISO 8601 generation timestamp */
  generatedAt: string;
  /** Physics engine that produced the data */
  engineId: string;
  /** Random seed used */
  seed: number;
  /** Fixed simulation timestep in seconds */
  fixedDt: number;
  /** Scenario identifier */
  scenarioId: string;
  /** Bone names included in this artifact */
  bones: string[];
  /** Per-tick frames */
  frames: BakedBoneFrame[];
  /** Pre-production fence claims — must be present on all artifacts */
  notEvidenceFor: string[];
}
