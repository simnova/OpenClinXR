/**
 * Physics cagematch metrics — builds a plain-object report for engine comparison.
 *
 * Fields:
 *   - replayEquivalence: boolean — did identical input logs produce identical checksums?
 *   - snapshotSupport: boolean — can we restore from a snapshot and get same checksums?
 *   - stepCostMs: number[] — measured step cost per tick (if available)
 *   - licenceClean: string[] — placeholder verification
 *   - notEvidenceFor: readonly string[] — C7 required
 */

import type { Sha256Hex } from "../types.js";

/**
 * A cagematch report for a single physics engine candidate.
 */
export type PhysicsCagematchReport = {
  /** Engine identifier (e.g. "havok-candidate", "rapier", "jolt"). */
  engineId: string;

  /** Did replay of the same input log produce identical checksums? (C6) */
  replayEquivalence: boolean;

  /** Number of checkpoint ticks verified. */
  checkpointCount: number;

  /** Did snapshot restore → replay produce identical checksums? (C6) */
  snapshotSupport: boolean;

  /** Checksums from the primary replay run. */
  checksums: Sha256Hex[];

  /** Per-tick step cost in milliseconds (empty if not measured). */
  stepCostMs: number[];

  /** Licence-clean check placeholders. */
  licenceClean: string[];

  /** C7: what this engine's output must NOT be used as evidence for. */
  notEvidenceFor: readonly string[];
};

/**
 * Options for building a cagematch report.
 */
export type BuildCagematchReportOptions = {
  engineId: string;
  checksums: Sha256Hex[];
  /** Optional per-tick step cost measurements (ms). */
  stepCostMs?: number[];
  replayEquivalence: boolean;
  snapshotSupport: boolean;
  notEvidenceFor?: readonly string[];
};

/**
 * Build a cagematch report from session parameters.
 */
export function buildPhysicsCagematchReport(
  options: BuildCagematchReportOptions,
): PhysicsCagematchReport {
  const defaultNotEvidence = [
    "clinical_validity",
    "exam_equivalence",
    "scoring",
    "learner_readiness",
  ];

  return {
    engineId: options.engineId,
    replayEquivalence: options.replayEquivalence,
    checkpointCount: options.checksums.length,
    snapshotSupport: options.snapshotSupport,
    checksums: options.checksums,
    stepCostMs: options.stepCostMs ?? [],
    licenceClean: ["mit_web_only", "non_copyleft", "prebuilt_wasm_available"],
    notEvidenceFor: options.notEvidenceFor ?? defaultNotEvidence,
  };
}
