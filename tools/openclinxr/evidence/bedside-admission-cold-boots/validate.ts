import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bedside admission cold-boots report validator.
 *
 * ONE implementation, three consumers: capture.ts (fresh run), this file's CLI
 * (tracked report.json), admission-report.test.ts (destructive fixtures).
 *
 * Recomputes hashes and the four-way outcome. Does not boot a browser.
 * Does not rewrite the tracked snapshot.
 */

export const SCHEMA_VERSION = "openclinxr.bedside-admission-cold-boots.v1" as const;

export const TRACKED_REPORT_RELATIVE_PATH =
  "tools/openclinxr/evidence/bedside-admission-cold-boots/report.json";

export const SOURCE_PATHS = {
  collector: "tools/openclinxr/evidence/bedside-admission-cold-boots/capture.ts",
  validator: "tools/openclinxr/evidence/bedside-admission-cold-boots/validate.ts",
  actorStaging: "packages/openclinxr/xr-station-room/src/actor-staging.ts",
  uiXrMain: "apps/ui-xr/src/main.ts",
  encounterBundleAdmission:
    "packages/openclinxr/asset-registry/src/encounter-bundle-admission-mod.ts",
  frozenSceneReplay: "packages/openclinxr/asset-registry/src/frozen-scene-replay-mod.ts",
  observedRoom:
    "packages/openclinxr/asset-registry/src/encounter-bundle-admission-observed-room-mod.ts",
} as const;

export type CollectorOutcome =
  | "all_admitted"
  | "stable_refusal"
  | "mixed_outcomes"
  | "incomplete";

export type ProductionAdmissionStatus =
  | "admitted"
  | "refused"
  | "no_plan_carried"
  | "unknown";

export type NamedTimeout =
  | "server_startup"
  | "navigation"
  | "station_shell"
  | "admission_observation"
  | "browser_launch"
  | null;

export type AdmissionSnapshot = {
  atIso: string;
  atMs: number;
  status: ProductionAdmissionStatus | string;
  reason: string | null;
  detail: string | null;
  reproduced: boolean | null;
  observedGeometryRevision: string | null;
  source: string | null;
};

export type AttemptRecord = {
  attemptId: string;
  captureHead: string;
  bundleSha256: string;
  frozenPlanSha256: string;
  browserVersion: string;
  startIso: string;
  endIso: string;
  namedTimeout: NamedTimeout;
  timeoutDiagnostic: string | null;
  admissionObservationPresent: boolean;
  finalStatus: ProductionAdmissionStatus | string;
  finalReason: string | null;
  finalDetail: string | null;
  finalReproduced: boolean | null;
  observedGeometryRevision: string | null;
  snapshots: AdmissionSnapshot[];
  publishCount: number;
  driveSource: string;
  driveSourceDiagnostic: string | null;
  environmentState: string;
  environmentDiagnostic: string | null;
  actorWorldPositions: Array<{
    actorId: string;
    name: string | null;
    x: number | null;
    y: number | null;
    z: number | null;
  }>;
  actorPositionsDiagnostic: string | null;
  consoleErrors: string[];
  pageErrors: string[];
  requestErrors: string[];
  browser: {
    name: string;
    version: string;
    pid: number | null;
    pidDiagnostic: string | null;
    launchedAtIso: string | null;
    closedAtIso: string | null;
  };
  screenshot: {
    path: string | null;
    sha256: string | null;
    diagnostic: string | null;
  };
  raw: {
    path: string;
    sha256: string;
  };
};

export type SourceHashRecord = {
  path: string;
  sha256: string;
};

export type CollectorIdentity = {
  bundleSha256: string;
  frozenPlanId: string;
  frozenPlanSha256: string;
  frozenGeometryRevision: string;
  browserName: string;
  browserVersion: string;
  caseId: string;
  stationId: string;
  environmentId: string;
  viewport: { width: number; height: number };
  launchArgs: string[];
};

export type GeometryVariation = {
  revisions: string[];
  preventsStableRefusal: true;
};

export type BedsideAdmissionColdBootsReport = {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  captureHead: string;
  runId: string;
  runDir: string;
  elapsedWallClockMs: number;
  outcome: CollectorOutcome;
  identity: CollectorIdentity;
  sourceSha256: Record<keyof typeof SOURCE_PATHS, SourceHashRecord>;
  attempts: AttemptRecord[];
  geometryVariation: GeometryVariation | null;
  deadlinesHit: string[];
  claimScope: string;
  notEvidenceFor: string[];
};

export type ValidatorIdentity = {
  snapshotValidatorSha256: string | null;
  snapshotValidatorProvenanceRevision: string | null;
  executingValidatorSha256: string | null;
  candidateRevision: string | null;
  validatorIdentityDivergence: boolean;
  validatorIdentityNote: string | null;
};

export type ValidatorResult = {
  ok: boolean;
  errors: string[];
  outcome: CollectorOutcome | null;
} & ValidatorIdentity;

export type GitObjectStore = {
  candidateRevision(): Promise<string | null>;
  blobSha256(revision: string, gitPath: string): Promise<string | null>;
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
  listRevisions(gitPath: string, throughRevision?: string): Promise<string[]>;
};

export type ValidateReportOptions = {
  root: string;
  git?: GitObjectStore;
};

const EMPTY_IDENTITY: ValidatorIdentity = {
  snapshotValidatorSha256: null,
  snapshotValidatorProvenanceRevision: null,
  executingValidatorSha256: null,
  candidateRevision: null,
  validatorIdentityDivergence: false,
  validatorIdentityNote: null,
};

const DERIVED_FINAL_FIELDS = [
  "finalStatus",
  "finalReason",
  "finalDetail",
  "finalReproduced",
  "observedGeometryRevision",
] as const;

const VALIDATOR_GIT_PATH = SOURCE_PATHS.validator;

const PRODUCTION_STATUSES = new Set(["admitted", "refused", "no_plan_carried"]);

export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return sha256Hex(buf);
}

export function repoRootFromHere(hereUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(hereUrl)), "../../../..");
}

function runGit(root: string, args: string[]): { status: number; stdout: Buffer } {
  const result = spawnSync("git", args, {
    cwd: root,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  const stdout = result.stdout;
  return {
    status: result.status ?? 1,
    stdout: Buffer.isBuffer(stdout)
      ? stdout
      : typeof stdout === "string"
        ? Buffer.from(stdout)
        : Buffer.alloc(0),
  };
}

function uniquePreserve(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item) || item.length === 0) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function createGitObjectStore(root: string): GitObjectStore {
  return {
    async candidateRevision() {
      const result = runGit(root, ["rev-parse", "HEAD"]);
      if (result.status !== 0) return null;
      const rev = result.stdout.toString("utf8").trim();
      return rev.length > 0 ? rev : null;
    },
    async blobSha256(revision: string, gitPath: string) {
      const result = runGit(root, ["cat-file", "blob", `${revision}:${gitPath}`]);
      if (result.status !== 0) return null;
      return sha256Hex(result.stdout);
    },
    async isAncestor(ancestor: string, descendant: string) {
      const result = runGit(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
      return result.status === 0;
    },
    async listRevisions(gitPath: string, throughRevision?: string) {
      const args = throughRevision
        ? ["log", "--pretty=format:%H", throughRevision, "--", gitPath]
        : ["log", "--pretty=format:%H", "--all", "--", gitPath];
      const result = runGit(root, args);
      if (result.status !== 0) return [];
      return result.stdout
        .toString("utf8")
        .split("\n")
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0);
    },
  };
}

function toResult(
  errors: string[],
  outcome: CollectorOutcome | null,
  identity: ValidatorIdentity = EMPTY_IDENTITY,
): ValidatorResult {
  return {
    ok: errors.length === 0,
    errors,
    outcome,
    ...identity,
  };
}

export function formatValidatorIdentity(identity: ValidatorIdentity): string {
  return [
    "validatorIdentity:",
    `  snapshotValidatorSha256=${identity.snapshotValidatorSha256 ?? ""}`,
    `  snapshotValidatorProvenanceRevision=${identity.snapshotValidatorProvenanceRevision ?? ""}`,
    `  executingValidatorSha256=${identity.executingValidatorSha256 ?? ""}`,
    `  candidateRevision=${identity.candidateRevision ?? ""}`,
    `  validatorIdentityDivergence=${identity.validatorIdentityDivergence ? "true" : "false"}`,
    `  validatorIdentityNote=${identity.validatorIdentityNote ?? ""}`,
  ].join("\n");
}

function validatorIdentityNote(identity: Omit<ValidatorIdentity, "validatorIdentityNote" | "validatorIdentityDivergence"> & {
  validatorIdentityDivergence: boolean;
}): string {
  const historical = identity.snapshotValidatorSha256 ?? "";
  const provenance = identity.snapshotValidatorProvenanceRevision ?? "";
  const executing = identity.executingValidatorSha256 ?? "";
  const candidate = identity.candidateRevision ?? "";
  if (identity.validatorIdentityDivergence) {
    return `historical snapshot validator ${historical} at revision ${provenance} diverges from executing validator ${executing} at candidate ${candidate}`;
  }
  return `historical snapshot validator ${historical} at revision ${provenance} matches executing validator ${executing} at candidate ${candidate}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveMaybePath(filePath: string, root: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

export function attemptHasAdmissionObservation(attempt: AttemptRecord): boolean {
  return attempt.snapshots.some((snap) => PRODUCTION_STATUSES.has(String(snap.status)));
}

export function lastObservedSnapshot(snapshots: AdmissionSnapshot[]): AdmissionSnapshot | undefined {
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : undefined;
}

export function deriveFinalsFromLastSnapshot(snapshots: AdmissionSnapshot[]): Pick<
  AttemptRecord,
  "finalStatus" | "finalReason" | "finalDetail" | "finalReproduced" | "observedGeometryRevision"
> {
  const last = lastObservedSnapshot(snapshots);
  if (!last) {
    return {
      finalStatus: "unknown",
      finalReason: "unknown",
      finalDetail: "window.__openClinXrFrozenScenePlanAdmission was never published",
      finalReproduced: null,
      observedGeometryRevision: null,
    };
  }
  return {
    finalStatus: last.status,
    finalReason: last.reason,
    finalDetail: last.detail,
    finalReproduced: last.reproduced,
    observedGeometryRevision: last.observedGeometryRevision,
  };
}

export function attemptLastObservationComplete(attempt: AttemptRecord): boolean {
  if (attempt.namedTimeout) return false;
  const last = lastObservedSnapshot(attempt.snapshots);
  if (!last) return false;
  return PRODUCTION_STATUSES.has(String(last.status));
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  return false;
}

const INTENTIONAL_RAW_SHA256_PATH = "raw.sha256";

function collectDivergences(
  left: unknown,
  right: unknown,
  fieldPath: string,
  attemptId: string,
  errors: string[],
): void {
  if (fieldPath === INTENTIONAL_RAW_SHA256_PATH) {
    return;
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const next = fieldPath ? `${fieldPath}.${key}` : key;
      collectDivergences(left[key], right[key], next, attemptId, errors);
    }
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      errors.push(`attempt ${attemptId} field ${fieldPath} diverges from raw`);
      return;
    }
    for (let index = 0; index < left.length; index += 1) {
      collectDivergences(left[index], right[index], `${fieldPath}[${index}]`, attemptId, errors);
    }
    return;
  }
  if (left !== right) {
    errors.push(`attempt ${attemptId} field ${fieldPath} diverges from raw`);
  }
}

function bindAttemptToRaw(report: AttemptRecord, raw: AttemptRecord, errors: string[]): void {
  collectDivergences(report, raw, "", report.attemptId, errors);
}

export function recomputeCollectorOutcome(attempts: AttemptRecord[]): {
  outcome: CollectorOutcome;
  geometryVariation: GeometryVariation | null;
} {
  const derived = attempts.map((attempt) => ({
    attempt,
    finals: deriveFinalsFromLastSnapshot(attempt.snapshots),
    complete: attemptLastObservationComplete(attempt),
  }));
  const complete = attempts.length === 5 && derived.every((row) => row.complete);
  const revisions = [
    ...new Set(
      derived
        .map((row) => row.finals.observedGeometryRevision)
        .filter((rev): rev is string => typeof rev === "string" && rev.length > 0 && rev !== "unknown"),
    ),
  ].sort();
  const geometryVariation: GeometryVariation | null =
    revisions.length > 1 ? { revisions, preventsStableRefusal: true } : null;

  if (!complete) {
    return { outcome: "incomplete", geometryVariation };
  }

  const allAdmitted = derived.every(
    (row) => String(row.finals.finalStatus) === "admitted" && row.finals.finalReproduced === true,
  );
  if (allAdmitted) {
    return { outcome: "all_admitted", geometryVariation };
  }

  const allRefused = derived.every((row) => String(row.finals.finalStatus) === "refused");
  if (allRefused) {
    const reasons = new Set(derived.map((row) => row.finals.finalReason ?? ""));
    const details = new Set(derived.map((row) => row.finals.finalDetail ?? ""));
    const measuredGeometry =
      revisions.length === 1 &&
      derived.every(
        (row) =>
          typeof row.finals.observedGeometryRevision === "string" &&
          row.finals.observedGeometryRevision.length > 0 &&
          row.finals.observedGeometryRevision !== "unknown" &&
          row.finals.observedGeometryRevision === revisions[0],
      );
    if (reasons.size === 1 && details.size === 1 && measuredGeometry && geometryVariation === null) {
      return { outcome: "stable_refusal", geometryVariation: null };
    }
  }

  return { outcome: "mixed_outcomes", geometryVariation };
}

function asAttempt(value: unknown, index: number, errors: string[]): AttemptRecord | null {
  if (!isRecord(value)) {
    errors.push(`attempt[${index}] is not an object`);
    return null;
  }
  const attemptId = value.attemptId;
  if (typeof attemptId !== "string" || attemptId.length === 0) {
    errors.push(`attempt[${index}].attemptId missing`);
    return null;
  }
  const snapshotsRaw = value.snapshots;
  if (!Array.isArray(snapshotsRaw)) {
    errors.push(`attempt ${attemptId}: snapshots is not an array`);
    return null;
  }
  const snapshots: AdmissionSnapshot[] = [];
  for (const [si, snap] of snapshotsRaw.entries()) {
    if (!isRecord(snap)) {
      errors.push(`attempt ${attemptId} snapshot[${si}] is not an object`);
      continue;
    }
    snapshots.push({
      atIso: String(snap.atIso ?? "unknown"),
      atMs: typeof snap.atMs === "number" ? snap.atMs : 0,
      status: String(snap.status ?? "unknown"),
      reason: snap.reason === null || snap.reason === undefined ? null : String(snap.reason),
      detail: snap.detail === null || snap.detail === undefined ? null : String(snap.detail),
      reproduced:
        typeof snap.reproduced === "boolean" ? snap.reproduced : snap.reproduced === null ? null : null,
      observedGeometryRevision:
        snap.observedGeometryRevision === null || snap.observedGeometryRevision === undefined
          ? null
          : String(snap.observedGeometryRevision),
      source: snap.source === null || snap.source === undefined ? null : String(snap.source),
    });
  }
  const screenshot = isRecord(value.screenshot) ? value.screenshot : {};
  const raw = isRecord(value.raw) ? value.raw : {};
  const browser = isRecord(value.browser) ? value.browser : {};
  if (typeof raw.path !== "string" || typeof raw.sha256 !== "string") {
    errors.push(`attempt ${attemptId}: raw.path/sha256 missing`);
  }
  const namedTimeout = (value.namedTimeout ?? null) as NamedTimeout;
  const actors = Array.isArray(value.actorWorldPositions)
    ? value.actorWorldPositions.filter(isRecord).map((row) => ({
        actorId: String(row.actorId ?? "unknown"),
        name: row.name === null || row.name === undefined ? null : String(row.name),
        x: typeof row.x === "number" ? row.x : null,
        y: typeof row.y === "number" ? row.y : null,
        z: typeof row.z === "number" ? row.z : null,
      }))
    : [];
  return {
    attemptId,
    captureHead: String(value.captureHead ?? "unknown"),
    bundleSha256: String(value.bundleSha256 ?? "unknown"),
    frozenPlanSha256: String(value.frozenPlanSha256 ?? "unknown"),
    browserVersion: String(value.browserVersion ?? "unknown"),
    startIso: String(value.startIso ?? "unknown"),
    endIso: String(value.endIso ?? "unknown"),
    namedTimeout,
    timeoutDiagnostic:
      value.timeoutDiagnostic === null || value.timeoutDiagnostic === undefined
        ? null
        : String(value.timeoutDiagnostic),
    admissionObservationPresent: value.admissionObservationPresent === true,
    finalStatus: String(value.finalStatus ?? "unknown"),
    finalReason:
      value.finalReason === null || value.finalReason === undefined ? null : String(value.finalReason),
    finalDetail:
      value.finalDetail === null || value.finalDetail === undefined ? null : String(value.finalDetail),
    finalReproduced: typeof value.finalReproduced === "boolean" ? value.finalReproduced : null,
    observedGeometryRevision:
      value.observedGeometryRevision === null || value.observedGeometryRevision === undefined
        ? null
        : String(value.observedGeometryRevision),
    snapshots,
    publishCount: typeof value.publishCount === "number" ? value.publishCount : 0,
    driveSource: String(value.driveSource ?? "unknown"),
    driveSourceDiagnostic:
      value.driveSourceDiagnostic === null || value.driveSourceDiagnostic === undefined
        ? null
        : String(value.driveSourceDiagnostic),
    environmentState: String(value.environmentState ?? "unknown"),
    environmentDiagnostic:
      value.environmentDiagnostic === null || value.environmentDiagnostic === undefined
        ? null
        : String(value.environmentDiagnostic),
    actorWorldPositions: actors,
    actorPositionsDiagnostic:
      value.actorPositionsDiagnostic === null || value.actorPositionsDiagnostic === undefined
        ? null
        : String(value.actorPositionsDiagnostic),
    consoleErrors: Array.isArray(value.consoleErrors) ? value.consoleErrors.map(String) : [],
    pageErrors: Array.isArray(value.pageErrors) ? value.pageErrors.map(String) : [],
    requestErrors: Array.isArray(value.requestErrors) ? value.requestErrors.map(String) : [],
    browser: {
      name: String(browser.name ?? "unknown"),
      version: String(browser.version ?? "unknown"),
      pid: typeof browser.pid === "number" ? browser.pid : null,
      pidDiagnostic:
        browser.pidDiagnostic === null || browser.pidDiagnostic === undefined
          ? null
          : String(browser.pidDiagnostic),
      launchedAtIso:
        browser.launchedAtIso === null || browser.launchedAtIso === undefined
          ? null
          : String(browser.launchedAtIso),
      closedAtIso:
        browser.closedAtIso === null || browser.closedAtIso === undefined
          ? null
          : String(browser.closedAtIso),
    },
    screenshot: {
      path:
        screenshot.path === null || screenshot.path === undefined ? null : String(screenshot.path),
      sha256:
        screenshot.sha256 === null || screenshot.sha256 === undefined
          ? null
          : String(screenshot.sha256),
      diagnostic:
        screenshot.diagnostic === null || screenshot.diagnostic === undefined
          ? null
          : String(screenshot.diagnostic),
    },
    raw: {
      path: String(raw.path ?? ""),
      sha256: String(raw.sha256 ?? ""),
    },
  };
}

async function verifyValidatorSourceIdentity(input: {
  root: string;
  git: GitObjectStore;
  recordedSha256: string | null;
  errors: string[];
}): Promise<ValidatorIdentity> {
  const { root, git, recordedSha256, errors } = input;
  const candidate = await git.candidateRevision();
  let executingSha256: string | null = null;
  const abs = path.resolve(root, VALIDATOR_GIT_PATH);
  try {
    executingSha256 = await sha256File(abs);
  } catch (err) {
    errors.push(
      `source file missing: ${VALIDATOR_GIT_PATH} (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (!candidate) {
    errors.push(`missing git blob for validator at HEAD:${VALIDATOR_GIT_PATH}`);
  } else {
    const headBlob = await git.blobSha256(candidate, VALIDATOR_GIT_PATH);
    if (headBlob === null) {
      errors.push(`missing git blob for validator at ${candidate}:${VALIDATOR_GIT_PATH}`);
    } else if (executingSha256 !== null && executingSha256 !== headBlob) {
      errors.push(
        `executing validator bytes differ from candidate blob at ${candidate}: disk=${executingSha256} blob=${headBlob}`,
      );
    }
  }

  let provenanceRevision: string | null = null;
  if (recordedSha256 === null) {
    // Missing hash entry is named by the sourceSha256 loop.
  } else if (candidate) {
    const ancestorRevs = await git.listRevisions(VALIDATOR_GIT_PATH, candidate);
    const allRevs = await git.listRevisions(VALIDATOR_GIT_PATH);
    const revisions = uniquePreserve([candidate, ...ancestorRevs, ...allRevs]);
    for (const rev of revisions) {
      const blobHash = await git.blobSha256(rev, VALIDATOR_GIT_PATH);
      if (blobHash === null) {
        continue;
      }
      if (blobHash === recordedSha256) {
        provenanceRevision = rev;
        break;
      }
    }
    if (provenanceRevision === null) {
      errors.push(`historical validator hash does not match git blob: recorded=${recordedSha256}`);
    } else if (!(await git.isAncestor(provenanceRevision, candidate))) {
      errors.push(
        `provenance revision ${provenanceRevision} is not an ancestor of candidate ${candidate}`,
      );
    }
  }

  const diverged = Boolean(
    recordedSha256 && executingSha256 && recordedSha256 !== executingSha256,
  );
  const identity: ValidatorIdentity = {
    snapshotValidatorSha256: recordedSha256,
    snapshotValidatorProvenanceRevision: provenanceRevision,
    executingValidatorSha256: executingSha256,
    candidateRevision: candidate,
    validatorIdentityDivergence: diverged,
    validatorIdentityNote: null,
  };
  identity.validatorIdentityNote = validatorIdentityNote(identity);
  return identity;
}

export async function validateBedsideAdmissionColdBootsReport(
  value: unknown,
  options: ValidateReportOptions,
): Promise<ValidatorResult> {
  const errors: string[] = [];
  const git = options.git ?? createGitObjectStore(options.root);
  if (!isRecord(value)) {
    return toResult(["report is not an object"], null);
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion ${String(value.schemaVersion)} !== ${SCHEMA_VERSION}`);
  }
  if (typeof value.captureHead !== "string" || value.captureHead.length < 7) {
    errors.push("captureHead missing or too short");
  }
  if (!isRecord(value.identity)) {
    errors.push("identity missing");
    return toResult(errors, null);
  }
  const identity = value.identity;
  const requiredIdentity = [
    "bundleSha256",
    "frozenPlanId",
    "frozenPlanSha256",
    "frozenGeometryRevision",
    "browserName",
    "browserVersion",
    "caseId",
    "stationId",
    "environmentId",
  ] as const;
  for (const key of requiredIdentity) {
    if (typeof identity[key] !== "string" || String(identity[key]).length === 0) {
      errors.push(`identity.${key} missing`);
    }
  }
  if (!isRecord(identity.viewport) || identity.viewport.width !== 960 || identity.viewport.height !== 720) {
    errors.push("identity.viewport must be 960x720");
  }
  if (!Array.isArray(value.attempts)) {
    errors.push("attempts is not an array");
    return toResult(errors, null);
  }
  if (value.attempts.length !== 5) {
    errors.push(`attempt count ${value.attempts.length} !== 5`);
  }

  const attempts: AttemptRecord[] = [];
  for (const [i, rawAttempt] of value.attempts.entries()) {
    const parsed = asAttempt(rawAttempt, i, errors);
    if (parsed) attempts.push(parsed);
  }

  const ids = attempts.map((a) => a.attemptId);
  const unique = new Set(ids);
  if (unique.size !== attempts.length) {
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    errors.push(`duplicate attempt id: ${[...new Set(dup)].join(",")}`);
  }
  if (attempts.length === 5 && unique.size !== 5) {
    errors.push("five attempt records are not unique");
  }

  for (const attempt of attempts) {
    if (attempt.raw.path) {
      const rawAbs = resolveMaybePath(attempt.raw.path, options.root);
      try {
        const actual = await sha256File(rawAbs);
        if (actual !== attempt.raw.sha256) {
          errors.push(
            `raw hash mismatch for ${attempt.raw.path}: recorded=${attempt.raw.sha256} actual=${actual}`,
          );
        }
      } catch (err) {
        errors.push(
          `raw file missing for attempt ${attempt.attemptId}: ${attempt.raw.path} (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    } else {
      errors.push(`attempt ${attempt.attemptId}: raw.path empty`);
    }

    if (attempt.screenshot.path) {
      const shotAbs = resolveMaybePath(attempt.screenshot.path, options.root);
      try {
        const actual = await sha256File(shotAbs);
        if (actual !== attempt.screenshot.sha256) {
          errors.push(
            `screenshot hash mismatch for ${attempt.screenshot.path}: recorded=${attempt.screenshot.sha256} actual=${actual}`,
          );
        }
      } catch (err) {
        errors.push(
          `screenshot file missing for attempt ${attempt.attemptId}: ${attempt.screenshot.path} (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    } else if (!attempt.screenshot.diagnostic) {
      errors.push(
        `attempt ${attempt.attemptId}: screenshot path null without diagnostic text`,
      );
    }

    const observed = attemptHasAdmissionObservation(attempt);
    if (attempt.admissionObservationPresent !== observed) {
      errors.push(
        `attempt ${attempt.attemptId}: admissionObservationPresent=${String(attempt.admissionObservationPresent)} but snapshots ${observed ? "contain" : "lack"} a production admission status`,
      );
    }
    if (String(attempt.finalStatus) === "refused" && attempt.finalReason === "route_blocked") {
      errors.push(
        `attempt ${attempt.attemptId}: route_blocked is a DETAIL on the solver constraint, not a reason enum`,
      );
    }
  }

  const identityBundle = String(identity.bundleSha256 ?? "");
  const identityPlan = String(identity.frozenPlanSha256 ?? "");
  const identityBrowser = String(identity.browserVersion ?? "");
  const identityHead = String(value.captureHead ?? "");
  const evidenceAttempts: AttemptRecord[] = attempts.slice();
  for (const [attemptIndex, attempt] of attempts.entries()) {
    if (attempt.captureHead !== "unknown" && attempt.captureHead !== identityHead) {
      errors.push(
        `identity mismatch: attempt ${attempt.attemptId} captureHead ${attempt.captureHead} !== ${identityHead}`,
      );
    }
    if (attempt.bundleSha256 !== "unknown" && attempt.bundleSha256 !== identityBundle) {
      errors.push(
        `identity mismatch: attempt ${attempt.attemptId} bundleSha256 ${attempt.bundleSha256} !== ${identityBundle}`,
      );
    }
    if (attempt.frozenPlanSha256 !== "unknown" && attempt.frozenPlanSha256 !== identityPlan) {
      errors.push(
        `identity mismatch: attempt ${attempt.attemptId} frozenPlanSha256 ${attempt.frozenPlanSha256} !== ${identityPlan}`,
      );
    }
    if (
      attempt.browserVersion !== "unknown" &&
      identityBrowser !== "unknown" &&
      attempt.browserVersion !== identityBrowser
    ) {
      errors.push(
        `identity mismatch: attempt ${attempt.attemptId} browserVersion ${attempt.browserVersion} !== ${identityBrowser}`,
      );
    }
    const rawAbs = attempt.raw.path ? resolveMaybePath(attempt.raw.path, options.root) : "";
    if (!rawAbs) continue;
    try {
      const rawText = await readFile(rawAbs, "utf8");
      let rawJson: unknown;
      try {
        rawJson = JSON.parse(rawText) as unknown;
      } catch (err) {
        errors.push(
          `attempt ${attempt.attemptId} raw JSON malformed: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      if (!isRecord(rawJson)) {
        errors.push(`attempt ${attempt.attemptId} raw is not an object`);
        continue;
      }
      if (typeof rawJson.captureHead === "string" && rawJson.captureHead !== identityHead) {
        errors.push(
          `identity mismatch: attempt ${attempt.attemptId} raw captureHead ${rawJson.captureHead} !== ${identityHead}`,
        );
      }
      if (typeof rawJson.bundleSha256 === "string" && rawJson.bundleSha256 !== identityBundle) {
        errors.push(
          `identity mismatch: attempt ${attempt.attemptId} raw bundleSha256 ${rawJson.bundleSha256} !== ${identityBundle}`,
        );
      }
      const rawLocalErrors: string[] = [];
      const rawAttempt = asAttempt(rawJson, 0, rawLocalErrors);
      if (rawLocalErrors.length > 0) {
        errors.push(
          `attempt ${attempt.attemptId} raw parse error: ${rawLocalErrors.join("; ")}`,
        );
      }
      if (!rawAttempt) {
        continue;
      }
      bindAttemptToRaw(attempt, rawAttempt, errors);
      evidenceAttempts[attemptIndex] = rawAttempt;
    } catch (err) {
      const alreadyMissing = errors.some((e) =>
        e.includes(`raw file missing for attempt ${attempt.attemptId}`),
      );
      if (!alreadyMissing) {
        errors.push(
          `attempt ${attempt.attemptId} raw unreadable: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  for (const [attemptIndex, attempt] of attempts.entries()) {
    const evidence = evidenceAttempts[attemptIndex] ?? attempt;
    const last = lastObservedSnapshot(evidence.snapshots);
    const derived = deriveFinalsFromLastSnapshot(evidence.snapshots);
    for (const field of DERIVED_FINAL_FIELDS) {
      if (!sameValue(evidence[field], derived[field]) || !sameValue(attempt[field], derived[field])) {
        errors.push(`attempt ${attempt.attemptId}: ${field} inconsistent with last snapshot`);
      }
    }
    if (String(attempt.finalStatus) === "admitted") {
      if (!last || !PRODUCTION_STATUSES.has(String(last.status))) {
        errors.push(`admitted attempt ${attempt.attemptId} has no admission snapshot`);
      } else if (String(last.status) !== "admitted" || last.reproduced !== true) {
        errors.push(
          `admitted attempt ${attempt.attemptId} last snapshot is not admitted with reproduced=true`,
        );
      }
    }
  }

  const recomputed = recomputeCollectorOutcome(evidenceAttempts);
  const recordedOutcome = value.outcome;
  if (recordedOutcome !== recomputed.outcome) {
    errors.push(
      `recorded outcome ${String(recordedOutcome)} !== recomputed ${recomputed.outcome}`,
    );
  }
  if (recomputed.geometryVariation && recordedOutcome === "stable_refusal") {
    errors.push(
      `geometry variation ${recomputed.geometryVariation.revisions.join(",")} prevents stable_refusal`,
    );
  }

  let validatorIdentity: ValidatorIdentity = EMPTY_IDENTITY;
  if (!isRecord(value.sourceSha256)) {
    errors.push("sourceSha256 missing");
    validatorIdentity = await verifyValidatorSourceIdentity({
      root: options.root,
      git,
      recordedSha256: null,
      errors,
    });
  } else {
    for (const [key, rel] of Object.entries(SOURCE_PATHS) as Array<
      [keyof typeof SOURCE_PATHS, string]
    >) {
      const recorded = value.sourceSha256[key];
      const recordedSha =
        isRecord(recorded) && typeof recorded.sha256 === "string" ? recorded.sha256 : null;
      if (recordedSha === null) {
        errors.push(`sourceSha256.${key} missing`);
      }
      if (key === "validator") {
        validatorIdentity = await verifyValidatorSourceIdentity({
          root: options.root,
          git,
          recordedSha256: recordedSha,
          errors,
        });
        continue;
      }
      if (recordedSha === null) {
        continue;
      }
      const abs = path.resolve(options.root, rel);
      try {
        const actual = await sha256File(abs);
        if (actual !== recordedSha) {
          errors.push(
            `source hash mismatch for ${rel}: recorded=${recordedSha} actual=${actual}`,
          );
        }
      } catch (err) {
        errors.push(
          `source file missing: ${rel} (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
  }

  return toResult(errors, recomputed.outcome, validatorIdentity);
}

export async function validateTrackedReport(
  root: string = repoRootFromHere(),
  reportPath: string = path.join(root, TRACKED_REPORT_RELATIVE_PATH),
): Promise<ValidatorResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
  } catch (err) {
    return toResult(
      [
        `tracked report unreadable: ${reportPath} (${err instanceof Error ? err.message : String(err)})`,
      ],
      null,
    );
  }
  return validateBedsideAdmissionColdBootsReport(parsed, { root });
}

async function main(): Promise<void> {
  const root = repoRootFromHere();
  const result = await validateTrackedReport(root);
  if (!result.ok) {
    process.stderr.write(`${result.errors.join("\n")}\n`);
    process.stdout.write(`${formatValidatorIdentity(result)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`ok outcome=${result.outcome}\n`);
  process.stdout.write(`${formatValidatorIdentity(result)}\n`);
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
const thisFile = fileURLToPath(import.meta.url);
if (invoked === thisFile) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
