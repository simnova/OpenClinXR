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

/** Every check the pinned SC-02 contract requires. A report cannot shrink this set. */
export const SC02_REQUIRED_CHECK_IDS = [
  "required-unsatisfied-blocks-admission",
  "required-pending-blocks-admission",
  "required-unknown-blocks-admission",
  "observation-bound-to-active-run",
  "initial-disconnected-satisfies-initial-predicate",
  "learner-goal-remains-incomplete",
  "one-transition-with-actual-domain-time",
  "snapshot-precedes-due-zero-effect",
  "scheduled-effect-acknowledged-by-consumer",
  "duplicate-tick-does-not-duplicate-effect",
  "failed-effect-retries-without-loss",
  "post-admission-removal-invalidates-acceptance",
] as const;

/** Every negative or known-good control the pinned SC-02 contract requires. */
export const SC02_REQUIRED_CONTROL_IDS = [
  "present-asset-with-unsatisfied-requirement-refuses",
  "client-authored-success-refuses",
  "wrong-run-observation-refuses",
  "stale-observation-refuses",
  "replayed-session-acknowledgment-refuses",
  "reordered-monitor-retains-consumer",
  "direct-api-bypass-refuses",
  "satisfied-goal-before-start-refuses",
  "ordinary-satisfied-transition-still-succeeds",
] as const;

/** The card's frozen write roots, in the board's order. The CLI compares --scope against this. */
export const SC02_FROZEN_SCOPES = [
  "packages/openclinxr/shared-schemas",
  "packages/openclinxr/scenario-runtime",
  "packages/openclinxr/domain",
  "packages/openclinxr/session-state",
  "packages/openclinxr/xr-capture-evidence",
  "packages/openclinxr/xr-asset-loading",
  "apps/api/src",
  "apps/ui-xr/src",
  "docs/openclinxr/scene-closure-2026-09-09/evidence/sc-02.md",
  "tools/openclinxr/evidence/scene-closure/proofs/sc-02",
  "docs/openclinxr/scene-closure-2026-09-09/evidence/sc-02.json",
] as const;

export const SC02_A_ROWS = ["A02", "A03"] as const;

/** The named behavior test and its required ordinary `it` title, both fixed by the card. */
export const SC02_BEHAVIOR_TEST_PATH = "apps/api/src/the-observed-scene-gates-entry-and-due-zero-effects.test.ts";
export const SC02_BEHAVIOR_TEST_TITLE = "SC-02-required-behavior";

/**
 * The card's frozen `run:` completion commands, argv-joined.
 *
 * The report must record each of them EXITING ZERO. Without this a report can pass having run the
 * verifier suite and nothing else — the shape the proof contract calls out: "an already-green
 * regression suite or verifier unit tests on synthetic fixtures cannot close a card".
 */
export const SC02_REQUIRED_COMMANDS = [
  "pnpm exec vitest run packages/openclinxr/scenario-runtime/src/the-scene-spec-gates-promotion.test.ts packages/openclinxr/scenario-runtime/src/the-planner-stays-inside-its-boundary.test.ts packages/openclinxr/scenario-runtime/src/a-scheduled-event-fires-once-at-its-second.test.ts",
  "pnpm exec vitest run apps/api/src/scenario-promotion-path.test.ts apps/api/src/encounter-runtime-handoff.test.ts",
  `pnpm exec vitest run ${SC02_BEHAVIOR_TEST_PATH}`,
  `pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts ${SC02_BEHAVIOR_TEST_PATH} ${SC02_BEHAVIOR_TEST_TITLE}`,
  "pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-02/verifier.test.ts",
] as const;

/**
 * Reject a behavior test whose required title is absent, marked, or inside a skipped suite.
 *
 * `assert-contract-live.ts` is a source-pattern check on the title alone. proof-contract-v2.md says
 * so in as many words — "it is a source-pattern check, not proof that the test runs or asserts
 * useful behavior" — and asks the verifier to "reject a title hidden in a comment, skipped
 * enclosing suite or empty callback". This is that second reading, recomputed from the tree.
 */
export function inspectBehaviorTestSource(source: string, title: string): string[] {
  const problems: string[] = [];
  const uncommented = source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/u, ""))
    .join("\n");
  const ordinary = new RegExp(`(?<![.\\w])it\\s*\\(\\s*["'\`]${title}["'\`]`, "u");
  if (!ordinary.test(uncommented)) {
    problems.push(`behavior test does not contain an ordinary it("${title}", ...) outside comments`);
  }
  for (const marker of ["it.skip", "it.fails", "it.todo", "it.concurrent.skip"]) {
    const marked = new RegExp(`${marker.replace(/\./gu, "\\.")}\\s*\\(\\s*["'\`]${title}["'\`]`, "u");
    if (marked.test(uncommented)) problems.push(`behavior test marks ${title} with ${marker}`);
  }
  if (/describe\.(skip|todo)\s*\(/u.test(uncommented)) {
    problems.push("behavior test has a skipped or todo describe block");
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
  frozen: readonly string[] = SC02_FROZEN_SCOPES,
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
   * Repo-relative source reader. The CLI passes the real filesystem; the unit suite passes a
   * synthetic tree so a malformed or skipped behavior test can be exercised without writing one.
   */
  sourceReader: (repoRelativePath: string) => string | Error;
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
  if (report.cardKey !== "SC-02") fail(`wrong cardKey ${String(report.cardKey)}`);

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
    for (const row of SC02_A_ROWS) if (!aRows.includes(row)) fail(`contract.aRows omits ${row}`);
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
        const inScope = SC02_FROZEN_SCOPES.some((scope) => {
          const root = path.normalize(scope).replace(/\/+$/u, "");
          return changed === root || changed.startsWith(`${root}/`);
        });
        if (!inScope) fail(`changed file outside every frozen scope: ${changed}`);
      }
    }

    // Recompute every declared input hash from the SOURCE TREE. A report carrying a second copy of
    // an expected hash proves nothing; reading the bytes back does. This is also the freshness
    // check the landing reviewer needs: a consumed input edited after the report was written fails
    // here rather than being discovered later.
    const inputs = Array.isArray(implementation["inputs"]) ? implementation["inputs"] : [];
    const hashedInputPaths = new Set<string>();
    for (const entry of inputs) {
      if (!isRecord(entry)) {
        fail("an implementation.inputs entry is not an object");
        continue;
      }
      const inputPath = String(entry["path"]);
      hashedInputPaths.add(path.normalize(inputPath));
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
    // Every file the task changed must carry a recomputed hash, or the audit above covers a set
    // that does not include the change under review.
    for (const entry of Array.isArray(changedFiles) ? changedFiles : []) {
      const changed = path.normalize(String(entry));
      if (!hashedInputPaths.has(changed)) fail(`changed file ${changed} has no hashed entry in implementation.inputs`);
    }
  }

  // The named behavior test, recomputed from the tree rather than trusted from the report.
  const sourceInspection = report.sourceInspection;
  if (!isRecord(sourceInspection)) fail("missing sourceInspection section");
  else {
    if (sourceInspection["behaviorTestPath"] !== SC02_BEHAVIOR_TEST_PATH) {
      fail(`sourceInspection.behaviorTestPath must be ${SC02_BEHAVIOR_TEST_PATH}`);
    }
    if (sourceInspection["behaviorTestTitle"] !== SC02_BEHAVIOR_TEST_TITLE) {
      fail(`sourceInspection.behaviorTestTitle must be ${SC02_BEHAVIOR_TEST_TITLE}`);
    }
    const source = input.sourceReader(SC02_BEHAVIOR_TEST_PATH);
    if (source instanceof Error) fail(`behavior test unreadable: ${source.message}`);
    else for (const problem of inspectBehaviorTestSource(source, SC02_BEHAVIOR_TEST_TITLE)) fail(problem);
  }

  const execution = report.execution;
  if (!isRecord(execution)) fail("missing execution section");
  else {
    if (typeof execution["runId"] !== "string" || String(execution["runId"]).trim() === "") {
      fail("execution.runId is missing; artifacts cannot be bound to a run");
    }
    const commands = Array.isArray(execution["commands"]) ? execution["commands"] : [];
    if (commands.length === 0) fail("execution.commands is empty");
    // Every frozen completion command must be recorded as having exited zero.
    const zeroExit = new Set(
      commands
        .filter((command) => isRecord(command) && Number(command["exitCode"]) === 0 && Array.isArray(command["argv"]))
        .map((command) => (command as Record<string, unknown>)["argv"] as string[])
        .map((argv) => argv.join(" ")),
    );
    for (const required of SC02_REQUIRED_COMMANDS) {
      if (!zeroExit.has(required)) fail(`required completion command was not recorded exiting zero: ${required}`);
    }
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
      "baselineRunId",
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
  const artifactText = new Map<string, string>();
  const executionRunId = isRecord(report.execution) ? String(report.execution["runId"]) : "";
  const baselineRunId = isRecord(report.counterweight) ? String(report.counterweight["baselineRunId"]) : "";
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
    artifactText.set(artifactId, bytes.toString("utf8"));
    // Run identity. An artifact belongs to THIS run or to the named baseline run; anything else is
    // a wrong-run record, which is the exact substitution "replaying another session" performs.
    const artifactRunId = String(artifact["runId"]);
    if (artifactRunId !== executionRunId && artifactRunId !== baselineRunId) {
      fail(`artifact ${artifactId}: runId ${artifactRunId} is neither the execution run ${executionRunId} nor the baseline run ${baselineRunId}`);
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
    if (!(SC02_REQUIRED_CHECK_IDS as readonly string[]).includes(checkId)) {
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
    // "report-authored pass flags without observed evidence" fail. An outcome of `satisfied` has
    // to be findable IN THE BYTES: at least one cited artifact must actually mention this check.
    // Without this a report can cite a real, correctly hashed log that says nothing about it.
    const citedArtifacts = evidenceIds.filter((evidenceId) => artifactText.has(evidenceId));
    if (citedArtifacts.length === 0) {
      fail(`check ${checkId} cites no artifact, so its outcome rests on the report's own word`);
    } else if (!citedArtifacts.some((evidenceId) => artifactText.get(evidenceId)!.includes(checkId))) {
      fail(`check ${checkId} is not mentioned in the bytes of any artifact it cites`);
    }
  }
  for (const required of SC02_REQUIRED_CHECK_IDS) {
    if (!seenChecks.has(required)) fail(`required check ${required} is missing`);
  }

  const controls = Array.isArray(report.controls) ? report.controls : [];
  const seenControls = new Set<string>();
  for (const control of controls) {
    if (!isRecord(control)) continue;
    const controlId = String(control["controlId"]);
    if (seenControls.has(controlId)) fail(`duplicate controlId ${controlId}`);
    seenControls.add(controlId);
    if (!(SC02_REQUIRED_CONTROL_IDS as readonly string[]).includes(controlId)) {
      fail(`unknown controlId ${controlId}`);
    }
    if (control["held"] !== true) fail(`control ${controlId} did not hold`);
    if (typeof control["observed"] !== "string" || control["observed"].trim() === "") {
      fail(`control ${controlId} records no observed result`);
    }
  }
  for (const required of SC02_REQUIRED_CONTROL_IDS) {
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
