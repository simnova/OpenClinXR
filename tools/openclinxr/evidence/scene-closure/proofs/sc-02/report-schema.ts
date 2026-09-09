/**
 * The scene-closure evidence report, as proof-contract-v2.md fixes it.
 *
 * The report is "a structured index of evidence, not an authority that can declare its own
 * requirements satisfied". Every type here is deliberately narrow: a field that could carry a
 * bare `pass` instead of an observed value is a field a report can lie with.
 *
 * Card-local by design. proof-contract-v2.md gives each card its own proof directory and forbids a
 * shared prerequisite card, so this is duplicated per card rather than imported across ownership
 * boundaries. Duplication is the cost of that boundary and the contract chose it.
 */

export const SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION = "openclinxr.scene-closure-evidence.v1";

export type EvidenceArtifact = {
  /** Stable opaque id used by checks and controls to reference these bytes. */
  artifactId: string;
  /** Approved store alias, resolved through the owner registry. Never a path. */
  storeAlias: string;
  /** Object key relative to the alias root. Traversal and symlink escape are refused. */
  objectKey: string;
  byteCount: number;
  sha256: string;
  mediaType: string;
  createdAtIso: string;
  runId: string;
  /** What this came from, when it is a derivative. */
  derivedFrom?: string | undefined;
};

export type EvidenceObservation = {
  observationId: string;
  /** What was observed, with its unit. Never a bare verdict. */
  metric: string;
  unit: string;
  value: number | string | boolean;
  observedAtMs: number;
  /** Where the raw record lives. */
  artifactId?: string | undefined;
  source: string;
};

export type EvidenceCheck = {
  checkId: string;
  /** The predicate this check evaluates, stated so a reader can recompute it. */
  expected: string;
  observed: number | string | boolean;
  outcome: "satisfied" | "unsatisfied" | "pending" | "unknown";
  evidenceIds: string[];
  refusal?: string | undefined;
};

export type EvidenceControl = {
  controlId: string;
  trigger: string;
  expected: string;
  observed: string;
  held: boolean;
  evidenceIds: string[];
};

export type SceneClosureEvidenceReport = {
  schemaVersion: typeof SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION;
  cardKey: string;
  contract: {
    pinnedCommit: string;
    documents: Array<{ path: string; sha256: string }>;
    aRows: string[];
  };
  implementation: {
    productSourceCommit: string;
    dependencyBaselineCommit: string;
    changeCommits: string[];
    treeClean: boolean;
    inputs: Array<{ path: string; sha256: string }>;
    /** Every file this task changed, audited against the frozen write roots. */
    changedFiles: string[];
    runtime: { node: string; platform: string };
  };
  execution: {
    taskId: string;
    commands: Array<{
      argv: string[];
      exitCode: number;
      startedAtIso: string;
      endedAtIso: string;
      tests?: { passed: number; failed: number; skipped: number; todo: number } | undefined;
      outputArtifactId?: string | undefined;
    }>;
  };
  counterweight: {
    testIds: string[];
    baselineRevision: string;
    failingAssertion: string;
    observedBeforeFix: string;
    knownGoodControl: string;
    fixedRevision: string;
    observedAfterFix: string;
    baselineOutputArtifactId: string;
    fixedOutputArtifactId: string;
  };
  encounter: Record<string, unknown>;
  observations: EvidenceObservation[];
  checks: EvidenceCheck[];
  controls: EvidenceControl[];
  artifacts: EvidenceArtifact[];
  reviews: Array<{
    reviewerId: string;
    role: string;
    distinctFromImplementer: boolean;
    reviewedSourceCommit: string;
    retrievedArtifactIds: string[];
    sessionIso: string;
    observations: string;
    decision: "accepted" | "rejected";
  }>;
  limits: {
    unprovenClinical: string[];
    unprovenHeadset: string[];
    unprovenPublication: string[];
    unresolvedDefects: string[];
  };
  /** Owner registry content hash, bound so a swapped registry is visible. */
  evidenceRegistrySha256: string;
};
