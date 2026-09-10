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
 *
 * ## FIXED (SC-06) — the control was green by construction on every clean clone
 *
 * MEASURED on baseline 27efa3d2, in a fresh worktree: the record was ABSENT, the gate reported
 * `Test Files 1 passed / Tests 4 passed`, and the record appeared on disk at the same second.
 * `git check-ignore -v` names `.gitignore:9:.openclinxr/` as the reason it was absent, so that was
 * the state of every clean checkout — and this module's own last two lines wrote today's bytes at
 * MODULE IMPORT whenever it found none. Clause (2) therefore compared today's bytes against
 * today's bytes and could not fail.
 *
 * The invalidation direction did work: it fired for real at HEAD 40090435 when SC-04 republished
 * `mpfb-clinical-physician-adult.glb`. That red was cleared by REGENERATING the record, which is
 * what SC-06's required_behavior 3 forbids — "Repair requires fresh observation/revalidation, not
 * overwriting sidecars."
 *
 * THREE CHANGES, and each closes one half of that:
 *  1. THE IMPORT SIDE EFFECT IS GONE. Producing a control is now an explicit call.
 *  2. THE RECORD IS TRACKED, at `supine-control-freeze.record.json` beside this file. A clean clone
 *     now carries the control it is being compared against, so the comparison is real. The
 *     gitignored `.openclinxr/` path is NOT read as a fallback: a fallback would restore "repair by
 *     deleting one untracked file" under a different name.
 *  3. PRODUCTION REQUIRES A FRESH OBSERVATION. `produceSupineControlFreeze` demands an observer and
 *     a timestamp and stamps them into `producedFrom`, so re-baselining after an invalidation is a
 *     recorded act with someone's name on it rather than an anonymous overwrite. It also REFUSES to
 *     record an empty digest, which would have compared equal to every future tree that also could
 *     not read the file.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Repo root resolved from this file's location (tools/openclinxr/evidence/supine-control-freeze/). */
function repoRoot(): string {
  // import.meta.dirname is tools/openclinxr/evidence/supine-control-freeze; four levels up is the
  // workspace root. `__dirname` stood here and is undefined in ES module scope, so the module threw
  // `ReferenceError: __dirname is not defined` under tsx while working under Vitest's CJS interop —
  // a module that only loads in one of the two runners this repo uses. `import.meta.dirname` is what
  // the sibling gates already use (see the-client-entry-does-not-reach-node-builtins.test.ts).
  return resolve(import.meta.dirname, "../../../../");
}

/**
 * Path to the persisted freeze record (repo-relative), and it is TRACKED.
 *
 * The previous location, `.openclinxr/evidence/supine-control-freeze.json`, is covered by
 * `.gitignore:9`, which is why every clean clone had no control and the gate compared today's bytes
 * against themselves. A freeze record that is not in the repository is not a freeze.
 */
export const FREEZE_RECORD_REL =
  "tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.record.json";

/**
 * Absolute path to the freeze record.
 *
 * Exported because `a-corrupt-artifact-is-refused.test.ts` records, in its own comment, that a first
 * draft GUESSED this path, corrupted a file nothing reads, and watched every clause return `ok`. A
 * test that has to guess where its subject lives is one edit away from measuring nothing.
 */
export function freezeRecordPath(root: string = repoRoot()): string {
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
  /**
   * Who produced this control, and when they looked.
   *
   * Optional on the TYPE so `requireSupineControlFreeze` keeps its four-outcome read contract for
   * any v1 record; REQUIRED by `supineControlFreezeProvenanceProblems`, which the gate calls. The
   * split matters: a record with no provenance is not malformed, it is unattributed, and those are
   * different failures with different repairs.
   */
  producedFrom?: SupineControlObservation | undefined;
};

/** A fresh observation of the control assets. The thing a repair cannot fake by editing a sidecar. */
export type SupineControlObservation = {
  observedBy: string;
  observedAtIso: string;
  /** Why this control was produced or re-produced. A re-baseline must say what invalidated it. */
  reason: string;
  /** Byte counts seen at production time, so the digests are not the only witness. */
  byteCountByPath: Record<string, number>;
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
      // Missing asset — record as empty so `supineControlFreezeIsStillValid` reports it against a
      // recorded real digest. `produceSupineControlFreeze` refuses to PERSIST one of these: an empty
      // digest on both sides compares equal, so a control produced while an asset was missing would
      // keep validating every tree in which it is still missing.
      out[relPath] = "";
    }
  }
  return out;
}

/** Byte count per control asset, or -1 where the file is absent. */
function computeAssetByteCounts(root: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const relPath of CONTROL_ASSET_PATHS) {
    const absPath = join(root, relPath);
    out[relPath] = existsSync(absPath) ? statSync(absPath).size : -1;
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

// NO AUTO-INITIALIZATION. The two lines that used to stand here read the record and, finding none,
// wrote today's bytes — so on a tree with no control the byte-freeze gate compared today's bytes
// against today's bytes and reported four passes. Measured on baseline 27efa3d2; see the ## FIXED
// block in this file's header. Producing a control is `produceSupineControlFreeze`, and it needs a
// fresh observation with a name on it.
/**
 * The consumer-facing read: REFUSE a missing or corrupt artifact rather than returning null.
 *
 * Brief §7 step 5: "Corrupt or remove a produced artifact and require the consumer to refuse it."
 *
 * `readSupineControlFreeze` returns `null` for a missing file AND for an unparseable one, which are
 * different situations with the same shape. Worse, `null` is exactly what a caller reads as
 * "no freeze recorded yet, carry on" — so a corrupted control silently becomes no control, and the
 * evidence that depended on it keeps being trusted. That is the failure this refusal closes.
 *
 * The four outcomes are distinguished because a consumer should act differently on each: `absent`
 * means produce it, `malformed` and `wrong_schema` mean something damaged it and a re-run cannot be
 * assumed to fix it, and `ok` means use it.
 *
 * `recordPath` overrides the default location and exists for ONE reason: the record became tracked
 * and therefore SHARED under SC-06, and `a-corrupt-artifact-is-refused.test.ts` corrupts its subject
 * on disk for real. With both test files reading one artifact, that corruption raced the byte-freeze
 * gate running beside it — measured, 1 failure in 3 runs of the directory, passing every time either
 * file ran alone. The refusal test now damages a file it owns; the default path stays the consumer's
 * and one clause there still asserts the reader resolves it.
 */
export type FreezeArtifactRead =
  | { status: "ok"; freeze: SupineControlFreeze }
  | { status: "absent"; path: string; reason: string }
  | { status: "malformed"; path: string; reason: string }
  | { status: "wrong_schema"; path: string; reason: string };

export function requireSupineControlFreeze(recordPath?: string): FreezeArtifactRead {
  const path = recordPath ?? freezeRecordPath();
  if (!existsSync(path)) {
    return {
      status: "absent",
      path,
      reason: "the supine control freeze has never been produced; a control that does not exist cannot invalidate anything",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      status: "malformed",
      path,
      reason: `the freeze artifact is present but not parseable JSON (${error instanceof Error ? error.message : String(error)}); a damaged control must be refused, not read as an absent one`,
    };
  }
  const candidate = parsed as Partial<SupineControlFreeze>;
  if (candidate?.schemaVersion !== "openclinxr.supine-control-freeze.v1") {
    return {
      status: "wrong_schema",
      path,
      reason: `expected schemaVersion "openclinxr.supine-control-freeze.v1", found ${JSON.stringify(candidate?.schemaVersion)}`,
    };
  }
  if (
    typeof candidate.assetSha256ByPath !== "object"
    || candidate.assetSha256ByPath === null
    || Object.keys(candidate.assetSha256ByPath).length === 0
  ) {
    return {
      status: "wrong_schema",
      path,
      reason: "the freeze carries no asset hashes; an empty hash map validates every tree and is worth less than no freeze",
    };
  }
  return { status: "ok", freeze: candidate as SupineControlFreeze };
}

/**
 * Every provenance problem with a freeze record. Empty means it was produced by a named observer.
 *
 * `requireSupineControlFreeze` answers "is this artifact readable"; this answers "did anyone
 * actually look". They are separate because the repairs differ: a malformed record needs
 * re-producing, an unattributed one needs someone to take responsibility for the observation.
 */
export function supineControlFreezeProvenanceProblems(freeze: SupineControlFreeze): string[] {
  const problems: string[] = [];
  const produced = freeze.producedFrom;
  if (produced === undefined) {
    return [
      "the freeze carries no producedFrom block, so nobody is recorded as having observed these bytes; "
      + "an unattributed control cannot distinguish a fresh observation from a sidecar overwrite",
    ];
  }
  if (typeof produced.observedBy !== "string" || produced.observedBy.trim() === "") {
    problems.push("producedFrom.observedBy is blank");
  }
  if (typeof produced.observedAtIso !== "string" || produced.observedAtIso.trim() === "") {
    problems.push("producedFrom.observedAtIso is blank");
  }
  if (typeof produced.reason !== "string" || produced.reason.trim() === "") {
    problems.push("producedFrom.reason is blank; a re-baseline must say what invalidated the old one");
  }
  const counts = produced.byteCountByPath;
  if (typeof counts !== "object" || counts === null || Object.keys(counts).length === 0) {
    problems.push("producedFrom.byteCountByPath is empty");
  } else {
    for (const path of Object.keys(freeze.assetSha256ByPath)) {
      const count = counts[path];
      if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) {
        problems.push(`producedFrom.byteCountByPath has no positive byte count for ${path}`);
      }
    }
  }
  return problems;
}

export type SupineControlProduction =
  | { produced: true; freeze: SupineControlFreeze }
  | { produced: false; reason: string };

/**
 * Produce (or re-produce) the control freeze FROM A FRESH OBSERVATION, or refuse.
 *
 * This is the only sanctioned way a control comes into existence. It refuses three things, and each
 * one is a way the "production" would have been an overwrite in disguise:
 *
 *  - no observer or no timestamp: nobody is accountable for having looked;
 *  - no reason: a re-baseline that does not say what invalidated the previous control is
 *    indistinguishable from one taken to make a red go away, which is what happened at HEAD
 *    40090435 and is what required_behavior 3 forbids;
 *  - an asset that could not be read: recording an empty digest would make the control compare equal
 *    to every future tree in which that asset is also unreadable.
 *
 * It does NOT write. The caller decides where the record goes, so a producer cannot quietly replace
 * a record it was only asked to compute — the separation the deleted import side effect did not have.
 */
export function produceSupineControlFreeze(input: {
  observedBy: string;
  observedAtIso: string;
  reason: string;
  repoRootPath?: string;
}): SupineControlProduction {
  if (input.observedBy.trim() === "") {
    return { produced: false, reason: "a control freeze must name the observer who produced it" };
  }
  if (input.observedAtIso.trim() === "") {
    return { produced: false, reason: "a control freeze must record when the observation was taken" };
  }
  if (input.reason.trim() === "") {
    return {
      produced: false,
      reason:
        "a control freeze must record WHY it was produced; a re-baseline with no stated cause cannot be "
        + "told apart from one taken to clear a red",
    };
  }
  const root = input.repoRootPath ?? repoRoot();
  const assetSha256ByPath = computeAssetHashes(root);
  const unreadable = Object.entries(assetSha256ByPath)
    .filter(([, digest]) => digest === "")
    .map(([path]) => path);
  if (unreadable.length > 0) {
    return {
      produced: false,
      reason:
        `these control assets could not be read: ${unreadable.join(", ")}. Recording an empty digest for `
        + "them would make the control compare equal to every tree that also cannot read them.",
    };
  }
  const byteCountByPath = computeAssetByteCounts(root);
  return {
    produced: true,
    freeze: {
      schemaVersion: "openclinxr.supine-control-freeze.v1",
      scenarioId: CONTROL_SCENARIO_ID,
      assetSha256ByPath,
      staged: {
        posture: STAGED_VALUES.posture,
        supportSurfaceCount: STAGED_VALUES.supportSurfaceCount,
        clearanceAboveDeckMeters: STAGED_VALUES.clearanceAboveDeckMeters,
      },
      producedFrom: {
        observedBy: input.observedBy,
        observedAtIso: input.observedAtIso,
        reason: input.reason,
        byteCountByPath,
      },
    },
  };
}
