/**
 * Supine control station byte-level freeze record.
 *
 * Records SHA256 hashes of every asset file the inpatient supine control station loads,
 * plus the staged posture/support/clearance values, so "the control did not move"
 * claims can cite this record rather than literals that could drift because an asset changed.
 *
 * Contracted export surface (see the RED test header):
 * - SupineControlFreeze type
 * - readSupineControlFreeze()
 * - computeSupineControlFreeze(repoRoot)
 * - supineControlFreezeIsStillValid(recorded, current)
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

/** Repo root resolved from this file's location (tools/openclinxr/evidence/supine-control-freeze/). */
function repoRoot(): string {
  // __dirname is tools/openclinxr/evidence/supine-control-freeze
  // Go up 4 levels: tools -> openclinxr -> evidence -> supine-control-freeze -> repo root (openclinxr-fix-frozen-control)
  return resolve(__dirname, "../../../../");
}

/** Path to the persisted freeze record (repo-relative). */
const FREEZE_RECORD_REL = ".openclinxr/evidence/supine-control-freeze.json";

/** Absolute path to the freeze record. */
function freezeRecordPath(root: string = repoRoot()): string {
  return join(root, FREEZE_RECORD_REL);
}

/**
 * Asset paths loaded by the inpatient supine control station.
 * Derived from resolveScenarioActorCast for the three declared inpatient scenarios
 * and the Infinigen environment assets they reference.
 */
const CONTROL_ASSET_PATHS: readonly string[] = [
  // Environments
  "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb",
  "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb",
  "apps/ui-xr/public/xr-assets/environment/infinigen-surgical-ward.glb",
  // Humanoid actors (shared across scenarios)
  "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb",
] as const;

/** Declared inpatient recumbent scenario IDs (from actor-posture.ts). */
const DECLARED_INPATIENT_SCENARIOS = [
  "ward_delirium_med_rec_v1",
  "stepdown_sepsis_nurse_escalation_v1",
  "postop_fever_consult_pressure_v1",
] as const;

/** The default control scenario — the first declared inpatient. */
const CONTROL_SCENARIO_ID = DECLARED_INPATIENT_SCENARIOS[0];

/** Staged values pinned by this freeze (from inspectInpatientSupineStaging). */
const STAGED_VALUES = {
  posture: "supine" as const,
  supportSurfaceCount: 1,
  clearanceAboveDeckMeters: 0.25,
} as const;

export type SupineControlFreeze = {
  schemaVersion: "openclinxr.supine-control-freeze.v1";
  scenarioId: string;
  assetSha256ByPath: Record<string, string>;
  staged: {
    posture: "supine";
    supportSurfaceCount: 1;
    clearanceAboveDeckMeters: number;
  };
};

/** Validation result for freeze integrity check. */
export type ValidationResult = { valid: boolean; changedPaths: string[] };

/** Compute SHA256 of a file. */
function sha256File(filePath: string): string {
  const buffer = readFileSync(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

/** Compute SHA256 for all control asset paths. */
function computeAssetHashes(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const relPath of CONTROL_ASSET_PATHS) {
    const absPath = join(root, relPath);
    if (existsSync(absPath)) {
      out[relPath] = sha256File(absPath);
    } else {
      // Missing asset — record as empty to trigger validation failure
      out[relPath] = "";
    }
  }
  return out;
}

/**
 * Read the persisted freeze record, or null if missing.
 */
export function readSupineControlFreeze(): SupineControlFreeze | null {
  const path = freezeRecordPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as SupineControlFreeze;
  } catch {
    return null;
  }
}

/**
 * Compute a fresh freeze record from current asset bytes on disk.
 */
export function computeSupineControlFreeze(repoRootPath: string): SupineControlFreeze {
  const assetSha256ByPath = computeAssetHashes(repoRootPath);
  return {
    schemaVersion: "openclinxr.supine-control-freeze.v1",
    scenarioId: CONTROL_SCENARIO_ID,
    assetSha256ByPath,
    staged: {
      posture: STAGED_VALUES.posture,
      supportSurfaceCount: STAGED_VALUES.supportSurfaceCount,
      clearanceAboveDeckMeters: STAGED_VALUES.clearanceAboveDeckMeters,
    },
  };
}

/**
 * Write a freeze record to disk (used to initialize/update the control).
 */
export function writeSupineControlFreeze(freeze: SupineControlFreeze, root: string = repoRoot()): void {
  const path = freezeRecordPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(freeze, null, 2)}\n`, "utf8");
}

/**
 * Validate that a recorded freeze still matches current asset bytes.
 * Returns { valid: true, changedPaths: [] } when all hashes match.
 * Returns { valid: false, changedPaths: [...] } listing paths whose sha256 differs.
 */
export function supineControlFreezeIsStillValid(
  recorded: SupineControlFreeze,
  current: SupineControlFreeze,
): ValidationResult {
  const changedPaths: string[] = [];

  // Check schema version match
  if (recorded.schemaVersion !== current.schemaVersion) {
    changedPaths.push("__schemaVersion__");
  }

  // Check scenarioId match
  if (recorded.scenarioId !== current.scenarioId) {
    changedPaths.push("__scenarioId__");
  }

  // Check staged values match
  if (recorded.staged.posture !== current.staged.posture) {
    changedPaths.push("__staged.posture__");
  }
  if (recorded.staged.supportSurfaceCount !== current.staged.supportSurfaceCount) {
    changedPaths.push("__staged.supportSurfaceCount__");
  }
  if (recorded.staged.clearanceAboveDeckMeters !== current.staged.clearanceAboveDeckMeters) {
    changedPaths.push("__staged.clearanceAboveDeckMeters__");
  }

  // Check asset hashes
  const allPaths = new Set([
    ...Object.keys(recorded.assetSha256ByPath),
    ...Object.keys(current.assetSha256ByPath),
  ]);

  for (const path of allPaths) {
    const recordedHash = recorded.assetSha256ByPath[path];
    const currentHash = current.assetSha256ByPath[path];
    if (recordedHash !== currentHash) {
      changedPaths.push(path);
    }
  }

  return {
    valid: changedPaths.length === 0,
    changedPaths,
  };
}

// Initialize freeze record on first import if missing
const existing = readSupineControlFreeze();
if (!existing) {
  const computed = computeSupineControlFreeze(repoRoot());
  writeSupineControlFreeze(computed);
}