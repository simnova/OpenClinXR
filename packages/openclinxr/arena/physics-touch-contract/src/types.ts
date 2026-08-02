/**
 * Joint pose for a single hand joint at a single tick.
 */
export type JointPose = {
  /** Bone/joint name or index mapping to the rig. */
  jointId: string;
  /** Local or world-space position (engine-convention). */
  position: { x: number; y: number; z: number };
  /** Quaternion rotation. */
  rotation: { x: number; y: number; z: number; w: number };
};

/**
 * Handedness label for XR input sources.
 */
export type Handedness = "left" | "right" | "gaze" | "none";

/**
 * Contact region identifier mapping to case-def contact regions.
 */
export type ContactRegionId = string;

/**
 * A single tick of physics input consumed from the input log.
 */
export type PhysicsTickInput = {
  /** Monotonic integer tick index. */
  tick: number;
  /** Hand/controller that produced this input. */
  handedness: Handedness;
  /** Full set of joint poses for this hand at this tick. */
  jointPoses: JointPose[];
  /** 0-1 pinch strength for grasp detection. */
  pinchStrength: number;
  /** Which case-def contact region the hand is targeting, if any. */
  contactRegionId: ContactRegionId | null;
};

/**
 * An ordered log of physics tick inputs.
 * The simulation consumes the log, never the live device directly (C2).
 */
export type InputLog = {
  entries: PhysicsTickInput[];
};

/**
 * SHA-256 hex digest of a serialized physics snapshot.
 */
export type Sha256Hex = string;

/**
 * A checksum record at a specific checkpoint tick.
 */
export type SnapshotChecksum = {
  /** The tick at which the snapshot was taken. */
  tick: number;
  /** SHA-256 hex digest of the serialized state. */
  sha256: Sha256Hex;
};

/**
 * Declared scope of determinism for a physics artifact.
 * C5: "local" until cross-architecture proof exists.
 */
export type DeterminismScope = "local" | "cross-platform";

/**
 * Metadata carried by every generated physics artifact.
 * C5 + C7: determinismScope + notEvidenceFor required.
 */
export type PhysicsArtifactMeta = {
  determinismScope: DeterminismScope;
  /** Canonical notEvidenceFor list per C7. */
  notEvidenceFor: readonly [
    "clinical_validity",
    "exam_equivalence",
    "scoring",
    "learner_readiness",
  ];
  /** Generator version that produced this artifact. */
  generatorVersion: string;
  /** Engine identifier (stub, havok, rapier, jolt). */
  engineId: string;
  /** The seed used for any PRNG in this artifact. */
  seed: number;
  /** The fixed dt used (must be 1/60 per C1). */
  fixedDt: number;
};

/**
 * Factory for the default notEvidenceFor list (C7).
 */
export function defaultNotEvidenceFor(): PhysicsArtifactMeta["notEvidenceFor"] {
  return [
    "clinical_validity",
    "exam_equivalence",
    "scoring",
    "learner_readiness",
  ] as const;
}

/**
 * Factory for stub metadata.
 */
export function createStubPhysicsArtifactMeta(
  overrides?: Partial<Omit<PhysicsArtifactMeta, "notEvidenceFor">>,
): PhysicsArtifactMeta {
  return {
    determinismScope: "local",
    notEvidenceFor: defaultNotEvidenceFor(),
    generatorVersion: "0.1.0",
    engineId: "stub",
    seed: 42,
    fixedDt: 1 / 60,
    ...overrides,
  };
}
