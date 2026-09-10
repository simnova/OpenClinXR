import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION,
  type SceneClosureEvidenceReport,
} from "./report-schema.js";

/**
 * The card-local evidence verifier's decision logic, separated from its CLI shell so
 * `verifier.test.ts` can exercise every rejection with synthetic fixtures while `verify.ts`
 * resolves ACTUAL evidence.
 *
 * proof-contract-v2.md: "Verifier unit tests may invoke an exported validation function with
 * fixture data; the completion CLI must resolve actual external evidence through the approved
 * store registry and inspect it." That sentence is the whole reason for this split, and it is also
 * the trap: nothing here may become a path the CLI can take to avoid touching real bytes. Every
 * function below is given its filesystem reader as an argument, and the CLI passes the real one.
 */

/** Every check the pinned SC-08 contract requires. A report cannot shrink this set. */
export const SC08_REQUIRED_CHECK_IDS = [
  "site-serves-cleared-edit",
  "site-serves-sanitized-full-proof",
  "captions-poster-transcript-load",
  "keyboard-controls-work",
  "desktop-and-mobile-layout-hold",
  "media-lineage-resolves-to-sc07-run",
  "public-rights-resolve-to-sc04",
  "media-within-size-budget",
  "no-sentinel-or-raw-content-in-published-artifacts",
] as const;

/** Every negative or known-good control the pinned SC-08 contract requires. */
export const SC08_REQUIRED_CONTROL_IDS = [
  "missing-captions-fails",
  "missing-poster-fails",
  "broken-url-fails",
  "substituted-source-fails",
  "edit-from-another-run-fails",
  "mobile-overflow-fails",
  "failed-playback-fails",
  "over-budget-media-fails",
  "html-strings-alone-cannot-pass",
] as const;

/** The card's frozen write roots, in the board's order. The CLI compares --scope against this. */
export const SC08_FROZEN_SCOPES = [
  "docs/index.html",
  "docs/styles.css",
  "docs/assets",
  "docs/openclinxr/videos",
  "tools/openclinxr/evidence/check-github-pages-site.ts",
  "tools/openclinxr/evidence/check-github-pages-site.test.ts",
  "tools/openclinxr/evidence/sync-github-pages-evidence-links.ts",
  "docs/openclinxr/scene-closure-2026-09-09/evidence/sc-08.md",
  "tools/openclinxr/evidence/scene-closure/proofs/sc-08",
  "docs/openclinxr/scene-closure-2026-09-09/evidence/sc-08.json",
] as const;

export const SC08_A_ROWS = ["A11"] as const;

export type EvidenceRegistry = {
  schemaVersion: string;
  storageRoot: string;
  aliases: Record<string, { root: string; description?: string }>;
};

/** Injected so unit tests can drive rejections without writing real bytes. */
export type ObjectReader = {
  /** Bytes at an absolute path, or an Error explaining why not. */
  read(absolutePath: string): Buffer | Error;
  /** The path with every symlink resolved, or an Error. Used to catch escapes. */
  realpath(absolutePath: string): string | Error;
};

export const nodeObjectReader: ObjectReader = {
  read(absolutePath) {
    try {
      if (lstatSync(absolutePath).isSymbolicLink()) {
        return new Error(`refused: ${absolutePath} is a symlink`);
      }
      return readFileSync(absolutePath);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  },
  realpath(absolutePath) {
    try {
      return realpathSync(absolutePath);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  },
};

export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Compare the CLI's repeated `--scope` arguments against the frozen contract.
 *
 * "reject omitted/extra/duplicate scopes, and never treat the CLI or report as authority to widen
 * scope". The comparison is on the normalized SET; the CLI may not reorder its way past a mismatch,
 * and a duplicate is a distinct failure from an extra because a duplicate hides an omission.
 */
export function auditScopes(
  supplied: readonly string[],
  frozen: readonly string[] = SC08_FROZEN_SCOPES,
): string[] {
  const problems: string[] = [];
  const normalized = supplied.map((scope) => path.normalize(scope).replace(/\/+$/u, ""));
  const seen = new Set<string>();
  for (const scope of normalized) {
    if (seen.has(scope)) problems.push(`duplicate --scope ${scope}`);
    seen.add(scope);
  }
  const expected = new Set(frozen.map((scope) => path.normalize(scope).replace(/\/+$/u, "")));
  for (const scope of expected) if (!seen.has(scope)) problems.push(`omitted --scope ${scope}`);
  for (const scope of seen) if (!expected.has(scope)) problems.push(`extra --scope ${scope}`);
  return problems;
}

/** Resolve an artifact's object key under its alias, refusing traversal and symlink escape. */
export function resolveArtifactPath(
  registry: EvidenceRegistry,
  storeAlias: string,
  objectKey: string,
  reader: ObjectReader,
): string | Error {
  const alias = registry.aliases[storeAlias];
  if (!alias) return new Error(`unknown store alias ${storeAlias}`);
  if (path.isAbsolute(objectKey)) return new Error(`objectKey ${objectKey} must be relative`);
  const root = path.resolve(alias.root);
  const candidate = path.resolve(root, objectKey);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return new Error(`objectKey ${objectKey} escapes alias root`);
  }
  const real = reader.realpath(candidate);
  if (real instanceof Error) return real;
  const realRoot = reader.realpath(root);
  if (realRoot instanceof Error) return realRoot;
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
    return new Error(`objectKey ${objectKey} resolves outside alias root through a link`);
  }
  return candidate;
}

export type VerifyInput = {
  report: unknown;
  suppliedScopes: readonly string[];
  registry: EvidenceRegistry | Error;
  registrySha256: string | Error;
  reader: ObjectReader;
  /** Contract documents as they exist on disk, for hash comparison. */
  contractDocuments: Map<string, string>;
};

export type VerifyResult = { ok: true } | { ok: false; problems: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decide whether this report, with its ACTUAL evidence resolved, meets the pinned contract.
 *
 * There is no success path that does not resolve every declared artifact's real bytes and rehash
 * them. A report that says `outcome: "satisfied"` and references an artifact whose bytes are gone
 * fails here, which is the "plausible all-green report with its underlying artifacts removed"
 * case the proof contract requires the verifier to be tested against.
 */
export function verifyReport(input: VerifyInput): VerifyResult {
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(message);
  };

  const scopeProblems = auditScopes(input.suppliedScopes);
  for (const problem of scopeProblems) fail(problem);

  if (input.registry instanceof Error) fail(`evidence registry unusable: ${input.registry.message}`);
  if (input.registrySha256 instanceof Error) fail(`evidence registry unhashable: ${input.registrySha256.message}`);

  if (!isRecord(input.report)) {
    fail("report is not a JSON object");
    return { ok: false, problems };
  }
  const report = input.report as Partial<SceneClosureEvidenceReport>;

  if (report.schemaVersion !== SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION) {
    fail(`unsupported schemaVersion ${String(report.schemaVersion)}`);
  }
  if (report.cardKey !== "SC-08") fail(`wrong cardKey ${String(report.cardKey)}`);

  // Contract hashes are recomputed from the documents on disk. A report that carries its own
  // second copy of the expected value proves nothing.
  const contract = report.contract;
  if (!isRecord(contract)) fail("missing contract section");
  else {
    const documents = Array.isArray(contract["documents"]) ? contract["documents"] : [];
    if (documents.length === 0) fail("contract.documents is empty");
    for (const entry of documents) {
      if (!isRecord(entry)) {
        fail("contract.documents entry is not an object");
        continue;
      }
      const docPath = String(entry["path"]);
      const actual = input.contractDocuments.get(docPath);
      if (actual === undefined) fail(`contract document ${docPath} was not read from disk`);
      else if (actual !== entry["sha256"]) fail(`contract document ${docPath} hash mismatch`);
    }
    const aRows = Array.isArray(contract["aRows"]) ? contract["aRows"].map(String) : [];
    for (const row of SC08_A_ROWS) if (!aRows.includes(row)) fail(`contract.aRows omits ${row}`);
  }

  if (typeof report.evidenceRegistrySha256 !== "string") fail("missing evidenceRegistrySha256");
  else if (!(input.registrySha256 instanceof Error) && report.evidenceRegistrySha256 !== input.registrySha256) {
    fail("evidenceRegistrySha256 does not match the owner registry in use");
  }

  const implementation = report.implementation;
  if (!isRecord(implementation)) fail("missing implementation section");
  else {
    if (implementation["treeClean"] !== true) fail("implementation.treeClean is not true");
    if (!Array.isArray(implementation["changeCommits"]) || implementation["changeCommits"].length === 0) {
      fail("implementation.changeCommits is empty");
    }
    if (!Array.isArray(implementation["inputs"]) || implementation["inputs"].length === 0) {
      fail("implementation.inputs is empty");
    }
    // "Audit the actual task-attributed source changes ... against these roots; reject
    // modifications outside scope." The scope ARGUMENT audit above checks what the CLI was told;
    // this checks what the task actually changed. Only the second one catches an edit in a package
    // the card never claimed, which is how a card silently grows its own boundary.
    const changedFiles = (implementation as Record<string, unknown>)["changedFiles"];
    if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
      fail("implementation.changedFiles is empty; the scope audit has nothing to check");
    } else {
      for (const entry of changedFiles) {
        const changed = path.normalize(String(entry));
        const inScope = SC08_FROZEN_SCOPES.some((scope) => {
          const root = path.normalize(scope).replace(/\/+$/u, "");
          return changed === root || changed.startsWith(`${root}/`);
        });
        if (!inScope) fail(`changed file outside every frozen scope: ${changed}`);
      }
    }
  }

  const execution = report.execution;
  if (!isRecord(execution)) fail("missing execution section");
  else {
    const commands = Array.isArray(execution["commands"]) ? execution["commands"] : [];
    if (commands.length === 0) fail("execution.commands is empty");
    for (const command of commands) {
      if (!isRecord(command)) continue;
      if (!Array.isArray(command["argv"]) || command["argv"].length === 0) fail("a command has no argv");
      const tests = command["tests"];
      if (isRecord(tests)) {
        if (Number(tests["passed"]) === 0) fail(`a recorded test run passed zero tests: ${JSON.stringify(command["argv"])}`);
        if (Number(tests["failed"]) > 0) fail(`a recorded test run had failures: ${JSON.stringify(command["argv"])}`);
        if (Number(tests["skipped"]) > 0) fail(`a recorded test run skipped tests: ${JSON.stringify(command["argv"])}`);
        if (Number(tests["todo"]) > 0) fail(`a recorded test run had todo tests: ${JSON.stringify(command["argv"])}`);
      }
    }
  }

  const counterweight = report.counterweight;
  if (!isRecord(counterweight)) fail("missing counterweight section");
  else {
    for (const field of [
      "testIds",
      "baselineRevision",
      "failingAssertion",
      "observedBeforeFix",
      "knownGoodControl",
      "fixedRevision",
      "observedAfterFix",
      "baselineOutputArtifactId",
      "fixedOutputArtifactId",
    ]) {
      const value = (counterweight as Record<string, unknown>)[field];
      if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
        fail(`counterweight.${field} is missing`);
      }
    }
    if (counterweight["baselineRevision"] === counterweight["fixedRevision"]) {
      fail("counterweight baseline and fixed revisions are identical, so no behavior changed");
    }
    if (counterweight["observedBeforeFix"] === counterweight["observedAfterFix"]) {
      fail("counterweight observed the same value before and after, so the control is not decisive");
    }
  }

  // Artifacts: resolve every one through the registry and rehash its real bytes.
  const artifacts = Array.isArray(report.artifacts) ? report.artifacts : [];
  const artifactIds = new Set<string>();
  if (artifacts.length === 0) fail("artifacts is empty");
  for (const artifact of artifacts) {
    if (!isRecord(artifact)) {
      fail("an artifact entry is not an object");
      continue;
    }
    const artifactId = String(artifact["artifactId"]);
    if (artifactIds.has(artifactId)) fail(`duplicate artifactId ${artifactId}`);
    artifactIds.add(artifactId);
    if (input.registry instanceof Error) continue;
    const resolved = resolveArtifactPath(
      input.registry,
      String(artifact["storeAlias"]),
      String(artifact["objectKey"]),
      input.reader,
    );
    if (resolved instanceof Error) {
      fail(`artifact ${artifactId}: ${resolved.message}`);
      continue;
    }
    const bytes = input.reader.read(resolved);
    if (bytes instanceof Error) {
      fail(`artifact ${artifactId}: ${bytes.message}`);
      continue;
    }
    if (bytes.byteLength !== Number(artifact["byteCount"])) {
      fail(`artifact ${artifactId}: byteCount ${String(artifact["byteCount"])} but ${bytes.byteLength} bytes on disk`);
    }
    const digest = sha256Hex(bytes);
    if (digest !== artifact["sha256"]) {
      fail(`artifact ${artifactId}: sha256 mismatch (report ${String(artifact["sha256"])}, disk ${digest})`);
    }
  }

  const observations = Array.isArray(report.observations) ? report.observations : [];
  if (observations.length === 0) fail("observations is empty");
  for (const observation of observations) {
    if (!isRecord(observation)) continue;
    const artifactId = observation["artifactId"];
    if (typeof artifactId === "string" && !artifactIds.has(artifactId)) {
      fail(`observation ${String(observation["observationId"])} references unknown artifact ${artifactId}`);
    }
    if (observation["value"] === undefined) fail(`observation ${String(observation["observationId"])} has no value`);
  }

  // Checks: exactly the pinned set, each satisfied, each referencing evidence that exists.
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const seenChecks = new Set<string>();
  for (const check of checks) {
    if (!isRecord(check)) continue;
    const checkId = String(check["checkId"]);
    if (seenChecks.has(checkId)) fail(`duplicate checkId ${checkId}`);
    seenChecks.add(checkId);
    if (!(SC08_REQUIRED_CHECK_IDS as readonly string[]).includes(checkId)) {
      fail(`unknown checkId ${checkId}`);
    }
    if (check["outcome"] !== "satisfied") {
      fail(`check ${checkId} outcome is ${String(check["outcome"])}`);
    }
    if (check["observed"] === undefined) fail(`check ${checkId} has no observed value`);
    const evidenceIds = Array.isArray(check["evidenceIds"]) ? check["evidenceIds"].map(String) : [];
    if (evidenceIds.length === 0) fail(`check ${checkId} references no evidence`);
    for (const evidenceId of evidenceIds) {
      const known = artifactIds.has(evidenceId)
        || observations.some((entry) => isRecord(entry) && entry["observationId"] === evidenceId);
      if (!known) fail(`check ${checkId} references unknown evidence ${evidenceId}`);
    }
  }
  for (const required of SC08_REQUIRED_CHECK_IDS) {
    if (!seenChecks.has(required)) fail(`required check ${required} is missing`);
  }

  const controls = Array.isArray(report.controls) ? report.controls : [];
  const seenControls = new Set<string>();
  for (const control of controls) {
    if (!isRecord(control)) continue;
    const controlId = String(control["controlId"]);
    if (seenControls.has(controlId)) fail(`duplicate controlId ${controlId}`);
    seenControls.add(controlId);
    if (!(SC08_REQUIRED_CONTROL_IDS as readonly string[]).includes(controlId)) {
      fail(`unknown controlId ${controlId}`);
    }
    if (control["held"] !== true) fail(`control ${controlId} did not hold`);
    if (typeof control["observed"] !== "string" || control["observed"].trim() === "") {
      fail(`control ${controlId} records no observed result`);
    }
  }
  for (const required of SC08_REQUIRED_CONTROL_IDS) {
    if (!seenControls.has(required)) fail(`required control ${required} is missing`);
  }

  const encounter = report.encounter;
  if (!isRecord(encounter) || Object.keys(encounter).length === 0) fail("encounter section is empty");

  const reviews = Array.isArray(report.reviews) ? report.reviews : [];
  if (reviews.length === 0) fail("reviews is empty");
  if (!reviews.some((review) => isRecord(review) && review["distinctFromImplementer"] === true && review["decision"] === "accepted")) {
    fail("no accepted review by a reviewer distinct from the implementer");
  }

  if (!isRecord(report.limits)) fail("missing limits section");

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
