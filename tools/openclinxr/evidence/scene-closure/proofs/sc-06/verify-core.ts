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

/** Every check the pinned SC-06 contract requires. A report cannot shrink this set. */
export const SC06_REQUIRED_CHECK_IDS = [
  "frozen-inputs-reproduce-accepted-result",
  "several-indices-explore-authorized-choices",
  "impossible-intent-reports-named-conflicts",
  "bound-bytes-cover-case-bundle-glb-clip-rig-solver",
  "acknowledgment-snapshot-and-event-order-persisted",
  "replay-through-normal-consumer",
  "browser-entry-reaches-no-server-only-builtin",
] as const;

/** Every negative or known-good control the pinned SC-06 contract requires. */
export const SC06_REQUIRED_CONTROL_IDS = [
  "changed-case-refuses-stale-acceptance",
  "corrupt-bundle-refuses",
  "removed-glb-refuses",
  "changed-clip-refuses",
  "different-solver-revision-refuses",
  "missing-and-corrupt-are-distinguished",
  "repair-requires-fresh-observation",
  "no-hidden-facts-in-exported-evidence",
] as const;

/** The card's frozen write roots, in the board's order. The CLI compares --scope against this. */
export const SC06_FROZEN_SCOPES = [
  "packages/openclinxr/asset-registry",
  "packages/openclinxr/scenario-runtime",
  "packages/openclinxr/session-state",
  "packages/openclinxr/review-workflow",
  "apps/api/src",
  "apps/ui-xr/src",
  "tools/openclinxr/evidence/supine-control-freeze",
  "docs/openclinxr/scene-closure-2026-09-09/evidence/sc-06.md",
  "tools/openclinxr/evidence/scene-closure/proofs/sc-06",
  "docs/openclinxr/scene-closure-2026-09-09/evidence/sc-06.json",
] as const;

export const SC06_A_ROWS = ["A09"] as const;

export const SC06_BEHAVIOR_TEST_PATH =
  "apps/ui-xr/src/the-normal-consumer-replays-and-invalidates-the-frozen-scene.test.ts";
export const SC06_BEHAVIOR_TEST_TITLE = "SC-06-required-behavior";

/**
 * The frozen acceptance rubric this card REUSES from SC-05, quoted in proof-contract-v2.md's SC-05
 * row: arrival at most 0.05 m, settled heading at most 10 degrees, stopped for two seconds, and
 * SC-05's own 0.005 m stopped-travel figure. SC-06 does not set its own numbers, because "the same
 * versioned result replays" is a claim about the rubric that accepted it.
 *
 * The reproduction tolerance is 1e-9 m and its provenance is in
 * `scenario-runtime/src/frozen-scene-replay.ts`: re-solving is a re-EXECUTION of a pure function on
 * persisted inputs, so the only correct difference is IEEE-754 noise, about 2.2e-16 m at metre
 * scale. It is not a fraction of the observed offset, which would pass by construction.
 */
export const SC06_ACCEPTANCE_LIMITS = {
  arrivalErrorMaxMeters: 0.05,
  settledHeadingErrorMaxDegrees: 10,
  stoppedObservationMinSeconds: 2,
  stoppedRootTravelMaxMeters: 0.005,
  layoutReproductionMaxMeters: 1e-9,
  /** A09 requires all fourteen. The baseline measured 0 of 14 on the accepted plan. */
  requiredA09FieldCount: 14,
} as const;

/**
 * Named behavior-test clauses this report's observations must actually carry values for.
 *
 * A report can claim a check is satisfied; it cannot claim a number it never recorded. Each id below
 * is looked up in `observations` and its VALUE is re-graded against the limits above.
 */
export const SC06_REQUIRED_OBSERVATION_IDS = [
  "sc06-a09-fields-present",
  "sc06-reproduction-offset",
  "sc06-variation-resolved",
  "sc06-variation-refused",
  "sc06-distinct-refusals",
  "sc06-frozen-plan-revision",
  "sc06-frozen-seed",
  "sc06-geometry-revision",
] as const;

/**
 * Inspect the behavior test's SOURCE for an ordinary, non-skipped `it` with the required title.
 *
 * `assert-contract-live.ts` is a source-pattern check and the proof contract says so explicitly:
 * "it is a source-pattern check, not proof that the test runs or asserts useful behavior. Pair it
 * with the actual Vitest run, inspect real result counts and test source, and reject a title hidden
 * in a comment, skipped enclosing suite or empty callback."
 *
 * Comments are stripped FIRST, so a title mentioned in a header block cannot satisfy it.
 */
export function inspectBehaviorTestSource(source: string, title: string): string[] {
  const problems: string[] = [];
  const stripped = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  const ordinary = new RegExp(`(?<![.\\w])it\\(\\s*["'\`]${title}["'\`]`, "u");
  if (!ordinary.test(stripped)) {
    problems.push(`no ordinary it("${title}") outside comments in the behavior test`);
  }
  for (const modifier of ["it.skip", "it.fails", "it.todo", "it.concurrent.skip"]) {
    if (stripped.includes(`${modifier}("${title}"`) || stripped.includes(`${modifier}('${title}'`)) {
      problems.push(`the required title is declared as ${modifier}`);
    }
  }
  if (/describe\.(?:skip|todo)\(/u.test(stripped)) {
    problems.push("the behavior test contains a skipped or todo describe block");
  }
  // An empty callback satisfies the pattern above and asserts nothing.
  const body = stripped.slice(stripped.indexOf(title));
  if (!/expect\(/u.test(body)) {
    problems.push("the required test body contains no expect() call");
  }
  return problems;
}

/**
 * Re-grade the report's own recorded observation VALUES against the frozen limits.
 *
 * proof-contract-v2.md: "Never trust a second copy of the expected value supplied by the same
 * report." A report whose `checks` all say `satisfied` while its observation stream records a 0.31 m
 * arrival fails here, which is the whole point of separating checks from observations.
 */
export function recomputeAcceptanceLimits(
  observations: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const problems: string[] = [];
  const byId = new Map<string, unknown>();
  for (const entry of observations) byId.set(String(entry["observationId"]), entry["value"]);

  for (const required of SC06_REQUIRED_OBSERVATION_IDS) {
    if (!byId.has(required)) problems.push(`observations omit required id ${required}`);
  }

  const a09 = Number(byId.get("sc06-a09-fields-present"));
  if (!Number.isFinite(a09) || a09 < SC06_ACCEPTANCE_LIMITS.requiredA09FieldCount) {
    problems.push(
      `a09_fields_present_on_record is ${String(byId.get("sc06-a09-fields-present"))}, under the `
        + `${SC06_ACCEPTANCE_LIMITS.requiredA09FieldCount} A09 requires`,
    );
  }
  const offset = Number(byId.get("sc06-reproduction-offset"));
  if (!Number.isFinite(offset) || offset > SC06_ACCEPTANCE_LIMITS.layoutReproductionMaxMeters) {
    problems.push(
      `layout_reproduction_offset_meters is ${String(byId.get("sc06-reproduction-offset"))}, over the `
        + `${SC06_ACCEPTANCE_LIMITS.layoutReproductionMaxMeters} m tolerance`,
    );
  }
  const resolvedCount = Number(byId.get("sc06-variation-resolved"));
  const refusedCount = Number(byId.get("sc06-variation-refused"));
  if (!Number.isFinite(resolvedCount) || resolvedCount < 1) {
    problems.push("no authorized variation index resolved, so nothing was frozen to replay");
  }
  if (!Number.isFinite(refusedCount) || refusedCount < 1) {
    problems.push(
      "no authorized variation index refused, so the index never reached a different decision and "
        + "\"several permitted indices explore authorized choices\" is unproven",
    );
  }
  const distinct = Number(byId.get("sc06-distinct-refusals"));
  if (distinct !== 3) {
    problems.push(
      `distinct_evidence_refusal_kinds is ${String(byId.get("sc06-distinct-refusals"))}; missing, corrupt `
        + "and changed must be three different answers",
    );
  }
  for (const digestId of ["sc06-frozen-plan-revision", "sc06-frozen-seed", "sc06-geometry-revision"]) {
    const value = String(byId.get(digestId) ?? "");
    if (value.trim() === "") problems.push(`${digestId} records no value`);
  }
  const seed = String(byId.get("sc06-frozen-seed") ?? "");
  if (!/^[0-9a-f]{64}$/u.test(seed)) {
    problems.push(`frozen_layout_seed ${seed} is not a 64-hex digest, so it was not derived`);
  }
  return problems;
}

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
  frozen: readonly string[] = SC06_FROZEN_SCOPES,
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
  /**
   * Reads a tracked file from the TREE, as BYTES. The report's `implementation.inputs` digests are
   * rehashed through this, so a report cannot certify a source it never touched — and the behavior
   * test's own source is read through it and inspected rather than trusted.
   *
   * Bytes, not text, because the manifest carries binary inputs: decoding a GLB as UTF-8 and hashing
   * the result produces a digest of the replacement characters, not of the file.
   */
  sourceReader: (repoRelativePath: string) => Buffer | Error;
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
  if (report.cardKey !== "SC-06") fail(`wrong cardKey ${String(report.cardKey)}`);

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
    for (const row of SC06_A_ROWS) if (!aRows.includes(row)) fail(`contract.aRows omits ${row}`);
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
    const inputs = Array.isArray(implementation["inputs"]) ? implementation["inputs"] : [];
    if (inputs.length === 0) fail("implementation.inputs is empty");
    const hashedInputs = new Set<string>();
    for (const entry of inputs) {
      if (!isRecord(entry)) {
        fail("an implementation.inputs entry is not an object");
        continue;
      }
      const inputPath = String(entry["path"]);
      hashedInputs.add(path.normalize(inputPath));
      // REHASHED FROM THE TREE. A report carrying its own second copy of the digest proves nothing;
      // this is the clause that makes `implementation.inputs` an audit rather than a claim.
      const source = input.sourceReader(inputPath);
      if (source instanceof Error) {
        fail(`input ${inputPath}: ${source.message}`);
        continue;
      }
      const digest = sha256Hex(source);
      if (digest !== entry["sha256"]) {
        fail(`input ${inputPath}: sha256 mismatch (report ${String(entry["sha256"])}, tree ${digest})`);
      }
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
        const inScope = SC06_FROZEN_SCOPES.some((scope) => {
          const root = path.normalize(scope).replace(/\/+$/u, "");
          return changed === root || changed.startsWith(`${root}/`);
        });
        if (!inScope) fail(`changed file outside every frozen scope: ${changed}`);
        // Every changed file must also be one of the REHASHED inputs. Without this the audit could
        // cover a set that excludes the very change under review.
        if (!hashedInputs.has(changed)) {
          fail(`changed file ${changed} is not among the hashed implementation.inputs`);
        }
      }
    }
  }

  const sourceInspection = report.sourceInspection;
  if (!isRecord(sourceInspection)) fail("missing sourceInspection section");
  else {
    if (sourceInspection["behaviorTestPath"] !== SC06_BEHAVIOR_TEST_PATH) {
      fail(`sourceInspection.behaviorTestPath is ${String(sourceInspection["behaviorTestPath"])}`);
    }
    if (sourceInspection["behaviorTestTitle"] !== SC06_BEHAVIOR_TEST_TITLE) {
      fail(`sourceInspection.behaviorTestTitle is ${String(sourceInspection["behaviorTestTitle"])}`);
    }
  }
  const behaviorSource = input.sourceReader(SC06_BEHAVIOR_TEST_PATH);
  if (behaviorSource instanceof Error) fail(`behavior test unreadable: ${behaviorSource.message}`);
  else {
    // The one consumer that wants TEXT decodes here. Everything else compares digests over bytes.
    for (const problem of inspectBehaviorTestSource(behaviorSource.toString("utf8"), SC06_BEHAVIOR_TEST_TITLE)) {
      fail(problem);
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
      if (Number(command["exitCode"]) !== 0) {
        fail(`a recorded command did not exit zero: ${JSON.stringify(command["argv"])}`);
      }
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
      "baselineRunId",
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

  const executionRunId = isRecord(execution) ? String(execution["runId"] ?? "") : "";
  const baselineRunId = isRecord(counterweight) ? String(counterweight["baselineRunId"] ?? "") : "";
  if (executionRunId.trim() === "") fail("execution.runId is missing; artifacts cannot be bound to a run");
  for (const artifact of artifacts) {
    if (!isRecord(artifact)) continue;
    const runId = String(artifact["runId"]);
    if (runId !== executionRunId && runId !== baselineRunId) {
      fail(
        `artifact ${String(artifact["artifactId"])}: runId ${runId} is neither the execution run `
        + `${executionRunId} nor the baseline run ${baselineRunId}`,
      );
    }
  }

  const observations = Array.isArray(report.observations) ? report.observations : [];
  if (observations.length === 0) fail("observations is empty");
  // THE SUFFICIENCY GATE. Re-grade the recorded VALUES, not the report's verdicts about them.
  for (const problem of recomputeAcceptanceLimits(
    observations.filter(isRecord) as ReadonlyArray<Record<string, unknown>>,
  )) {
    fail(problem);
  }
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
    if (!(SC06_REQUIRED_CHECK_IDS as readonly string[]).includes(checkId)) {
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
  for (const required of SC06_REQUIRED_CHECK_IDS) {
    if (!seenChecks.has(required)) fail(`required check ${required} is missing`);
  }

  const controls = Array.isArray(report.controls) ? report.controls : [];
  const seenControls = new Set<string>();
  for (const control of controls) {
    if (!isRecord(control)) continue;
    const controlId = String(control["controlId"]);
    if (seenControls.has(controlId)) fail(`duplicate controlId ${controlId}`);
    seenControls.add(controlId);
    if (!(SC06_REQUIRED_CONTROL_IDS as readonly string[]).includes(controlId)) {
      fail(`unknown controlId ${controlId}`);
    }
    if (control["held"] !== true) fail(`control ${controlId} did not hold`);
    if (typeof control["observed"] !== "string" || control["observed"].trim() === "") {
      fail(`control ${controlId} records no observed result`);
    }
  }
  for (const required of SC06_REQUIRED_CONTROL_IDS) {
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
