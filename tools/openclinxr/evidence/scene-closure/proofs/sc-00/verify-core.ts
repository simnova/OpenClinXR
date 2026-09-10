import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  gradeMotionMeasurement,
  type MotionMeasurement,
  REQUIRED_RUBRIC_METRICS,
  type RubricMetric,
  rubricCoverageProblems,
  SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION,
} from "./measurement-rubric.js";
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

/** Every check the pinned SC-00 contract requires. A report cannot shrink this set. */
export const SC00_REQUIRED_CHECK_IDS = [
  "thresholds-frozen-with-rationale",
  "asset-rig-frame-hashes-recorded",
  "arrival-error-cap-is-0p05m",
  "settled-yaw-cap-is-10deg",
  "stopped-observation-is-2s",
  "signed-contact-height-relative-to-floor",
  "sample-sufficiency-threshold-set",
  "independent-reviewer-fixed-thresholds",
  "foot-slide-threshold-independent-of-shipped-clip",
  "swept-collision-recomputed-below-thinnest-obstacle",
  "unsupported-floor-geometry-refuses",
  "sc07-observes-production-without-injection",
] as const;

/**
 * Every negative or known-good control the pinned SC-00 contract requires.
 *
 * The card names nine plus the coverage case. The other eleven exist because the rubric grades
 * seventeen metrics and "each broken control fails its own named metric" is only checkable when
 * every metric HAS one — a metric with no control is a threshold nobody probed.
 */
export const SC00_REQUIRED_CONTROL_IDS = [
  "known-good-support-passes",
  "sliding-foot-fails",
  "single-frame-pop-fails",
  "penetrating-foot-fails",
  "missing-contact-windows-fails",
  "zero-skinned-samples-fails",
  "absent-actor-fails",
  "thin-obstacle-between-waypoints-fails",
  "wrong-support-frame-fails",
  "clip-flag-without-motion-fails",
  "deleting-a-metric-fails-rather-than-evades",
  "unsupported-floor-geometry-refuses",
  "too-few-samples-fails",
  "nonmonotonic-times-fail",
  "dropped-frame-gap-fails",
  "body-floating-above-support-fails",
  "body-sunk-into-support-fails",
  "deformed-limb-fails",
  "arrival-error-over-cap-fails",
  "settled-yaw-over-cap-fails",
  "root-resumes-travel-fails",
  "shipped-walk-formal-fails-foot-slide",
] as const;

/**
 * The artifact carrying the actual graded measurements.
 *
 * This is what makes the verifier something other than a reader of the report's own opinions. The
 * report says a control `held`; this artifact carries the MEASUREMENT that control was built from,
 * and the verifier re-grades it through the frozen rubric and compares. proof-contract-v2.md:
 * "recompute from the bound persisted case, actual normalized mounted geometry, recorded
 * observation stream and frozen rubric. Never trust a second copy of the expected value supplied by
 * the same report."
 */
export const SC00_CONTROLS_ARTIFACT_ID = "rubric-controls";

/** The card's frozen write roots, in the board's order. The CLI compares --scope against this. */
export const SC00_FROZEN_SCOPES = [
  "docs/openclinxr/scene-closure-2026-09-09/evidence/sc-00.md",
  "tools/openclinxr/evidence/scene-closure/proofs/sc-00",
  "docs/openclinxr/scene-closure-2026-09-09/evidence/sc-00.json",
  "tools/openclinxr/evidence/scene-closure/the-measurement-rubric-rejects-broken-controls.test.ts",
] as const;

export const SC00_A_ROWS = ["A08"] as const;

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
  frozen: readonly string[] = SC00_FROZEN_SCOPES,
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

/** One control as the measurement artifact records it, before anything grades it. */
type RecordedControl = {
  controlId: string;
  expectation:
    | { kind: "pass" }
    | { kind: "fail"; metric: RubricMetric }
    | { kind: "refuse"; metric: RubricMetric }
    | { kind: "coverage"; dropMetric: RubricMetric };
  measurement: MotionMeasurement;
};

/**
 * Re-grade every recorded control through the frozen rubric and compare with what the report
 * claims.
 *
 * This is the counterweight against a report-authored pass flag. `held: true` beside a measurement
 * that does not behave as the control says is the exact shape "the oracle cannot accept its own
 * pre-filled success flag" forbids, and it is the shape a plausible all-green report takes.
 *
 * Exported so `verifier.test.ts` can drive it with synthetic bytes; the CLI reaches it only through
 * `verifyReport`, with the real artifact's real bytes.
 */
export function recomputeControlOutcomes(
  controlsBytes: Buffer | undefined,
  reportedControls: readonly unknown[],
): string[] {
  const problems: string[] = [];
  if (controlsBytes === undefined) {
    problems.push(`artifact ${SC00_CONTROLS_ARTIFACT_ID} is not declared, so no control outcome could be recomputed`);
    return problems;
  }
  let document: unknown;
  try {
    document = JSON.parse(controlsBytes.toString("utf8"));
  } catch (error) {
    problems.push(`artifact ${SC00_CONTROLS_ARTIFACT_ID} is not readable JSON: ${String(error)}`);
    return problems;
  }
  if (!isRecord(document)) {
    problems.push(`artifact ${SC00_CONTROLS_ARTIFACT_ID} is not a JSON object`);
    return problems;
  }
  if (document["rubricVersion"] !== SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION) {
    problems.push(
      `controls artifact was graded under rubric ${String(document["rubricVersion"])}, not ${SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION}`,
    );
  }
  const entries = Array.isArray(document["controls"]) ? (document["controls"] as unknown[]) : [];
  if (entries.length === 0) {
    problems.push(`artifact ${SC00_CONTROLS_ARTIFACT_ID} carries no controls`);
    return problems;
  }

  const heldById = new Map<string, unknown>();
  for (const control of reportedControls) {
    if (isRecord(control)) heldById.set(String(control["controlId"]), control["held"]);
  }

  const recomputedIds = new Set<string>();
  const metricsWithABrokenControl = new Set<string>();
  for (const raw of entries) {
    if (!isRecord(raw)) {
      problems.push("a recorded control is not an object");
      continue;
    }
    const entry = raw as unknown as RecordedControl;
    const controlId = String(entry.controlId);
    recomputedIds.add(controlId);
    if (!isRecord(raw["measurement"])) {
      problems.push(`recorded control ${controlId} carries no measurement`);
      continue;
    }
    const grade = gradeMotionMeasurement(entry.measurement);
    const expectation = entry.expectation;
    let behaved = false;
    let observed = "";
    if (!isRecord(raw["expectation"])) {
      problems.push(`recorded control ${controlId} carries no expectation`);
      continue;
    }
    if (expectation.kind === "pass") {
      behaved = grade.ok;
      observed = grade.ok ? "graded ok" : `failed ${grade.failedMetrics.join(",")}`;
    } else if (expectation.kind === "coverage") {
      const trimmed = grade.findings.filter((finding) => finding.metric !== expectation.dropMetric);
      behaved = rubricCoverageProblems(grade.findings).length === 0 && rubricCoverageProblems(trimmed).length > 0;
      observed = `coverage of the full grade ${rubricCoverageProblems(grade.findings).length === 0 ? "clean" : "dirty"}, of the trimmed grade ${rubricCoverageProblems(trimmed).length} problem(s)`;
      metricsWithABrokenControl.add(expectation.dropMetric);
    } else {
      const wanted = expectation.kind === "refuse" ? "refused" : "violated";
      const finding = grade.findings.find((candidate) => candidate.metric === expectation.metric);
      behaved = !grade.ok && finding?.outcome === wanted;
      observed = `${expectation.metric} graded ${String(finding?.outcome)}; whole grade ${grade.ok ? "ok" : `failed ${grade.failedMetrics.join(",")}`}`;
      metricsWithABrokenControl.add(expectation.metric);
    }

    if (!behaved) {
      problems.push(`recorded control ${controlId} does not behave as declared: ${observed}`);
    }
    const held = heldById.get(controlId);
    if (held === undefined) {
      problems.push(`control ${controlId} is measured but the report does not record it`);
    } else if (held !== behaved) {
      problems.push(
        `report claims control ${controlId} held=${String(held)} but the recomputed rubric says ${String(behaved)} (${observed})`,
      );
    }
  }

  for (const required of SC00_REQUIRED_CONTROL_IDS) {
    if (!recomputedIds.has(required)) problems.push(`no measurement was recorded for required control ${required}`);
  }
  // A metric with no broken control is a threshold nobody probed.
  for (const metric of REQUIRED_RUBRIC_METRICS) {
    if (!metricsWithABrokenControl.has(metric)) problems.push(`no recorded control exercises the ${metric} threshold`);
  }
  return problems;
}

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
  if (report.cardKey !== "SC-00") fail(`wrong cardKey ${String(report.cardKey)}`);

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
    for (const row of SC00_A_ROWS) if (!aRows.includes(row)) fail(`contract.aRows omits ${row}`);
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
        const inScope = SC00_FROZEN_SCOPES.some((scope) => {
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
  let controlsBytes: Buffer | undefined;
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
    if (artifactId === SC00_CONTROLS_ARTIFACT_ID) controlsBytes = bytes;
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
    if (!(SC00_REQUIRED_CHECK_IDS as readonly string[]).includes(checkId)) {
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
  for (const required of SC00_REQUIRED_CHECK_IDS) {
    if (!seenChecks.has(required)) fail(`required check ${required} is missing`);
  }

  const controls = Array.isArray(report.controls) ? report.controls : [];
  const seenControls = new Set<string>();
  for (const control of controls) {
    if (!isRecord(control)) continue;
    const controlId = String(control["controlId"]);
    if (seenControls.has(controlId)) fail(`duplicate controlId ${controlId}`);
    seenControls.add(controlId);
    if (!(SC00_REQUIRED_CONTROL_IDS as readonly string[]).includes(controlId)) {
      fail(`unknown controlId ${controlId}`);
    }
    if (control["held"] !== true) fail(`control ${controlId} did not hold`);
    if (typeof control["observed"] !== "string" || control["observed"].trim() === "") {
      fail(`control ${controlId} records no observed result`);
    }
  }
  for (const required of SC00_REQUIRED_CONTROL_IDS) {
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

  // WRONG-RUN. proof-contract-v2.md requires the good, malformed, wrong-run and corrupt controls to
  // be exercised separately, and run identity is the one of the four nothing above catches: every
  // artifact resolves, every hash matches, every outcome is "satisfied" — and the bytes came from a
  // DIFFERENT run than the one the card is claiming. "Measurements and frames must refer to the
  // same run."
  //
  // The measurement run is DERIVED, not declared, so a report cannot name a run that suits it: it
  // is whichever run produced the counterweight's FIXED output, because that is the run the card's
  // after-state was observed in. EXACTLY ONE artifact is exempt — the one
  // `counterweight.baselineOutputArtifactId` names — because it is the before-state by definition,
  // and a control that held on BOTH revisions legitimately cites it. SC-01S narrowed the exemption
  // to that single declared artifact after an earlier, broader version refused its own baseline
  // control; the rule was too strict, not the evidence.
  const artifactRunById = new Map<string, string>();
  for (const artifact of artifacts) {
    if (isRecord(artifact)) artifactRunById.set(String(artifact["artifactId"]), String(artifact["runId"]));
  }
  const observationArtifactById = new Map<string, string | undefined>();
  for (const observation of observations) {
    if (!isRecord(observation)) continue;
    const artifactId = observation["artifactId"];
    observationArtifactById.set(
      String(observation["observationId"]),
      typeof artifactId === "string" ? artifactId : undefined,
    );
  }
  const measurementRunId = isRecord(counterweight)
    ? artifactRunById.get(String(counterweight["fixedOutputArtifactId"]))
    : undefined;
  if (isRecord(counterweight) && measurementRunId === undefined) {
    fail("counterweight.fixedOutputArtifactId names no declared artifact, so the measurement run is unknown");
  }
  if (measurementRunId !== undefined) {
    const runOf = (evidenceId: string): string | undefined =>
      artifactRunById.get(evidenceId)
      ?? (observationArtifactById.has(evidenceId)
        ? artifactRunById.get(observationArtifactById.get(evidenceId) ?? "")
        : undefined);
    const baselineArtifactId = isRecord(counterweight)
      ? String(counterweight["baselineOutputArtifactId"])
      : undefined;
    // The exemption follows an OBSERVATION to its artifact as well as naming the artifact directly.
    // A before-state fact is usually cited as an observation of the baseline output, not as the raw
    // log; refusing that form would refuse the card's own RED, which is the same over-strictness
    // SC-01S corrected. It stays narrow: one declared artifact, whatever route reaches it.
    const isBaselineEvidence = (evidenceId: string): boolean => {
      if (baselineArtifactId === undefined) return false;
      return evidenceId === baselineArtifactId || observationArtifactById.get(evidenceId) === baselineArtifactId;
    };
    const auditRun = (kind: string, id: string, evidenceIds: readonly string[]): void => {
      for (const evidenceId of evidenceIds) {
        if (isBaselineEvidence(evidenceId)) continue;
        const runId = runOf(evidenceId);
        if (runId !== undefined && runId !== measurementRunId) {
          fail(`${kind} ${id} leans on evidence ${evidenceId} from run ${runId}, not the measurement run ${measurementRunId}`);
        }
      }
    };
    for (const check of checks) {
      if (!isRecord(check)) continue;
      auditRun("check", String(check["checkId"]), Array.isArray(check["evidenceIds"]) ? check["evidenceIds"].map(String) : []);
    }
    for (const control of controls) {
      if (!isRecord(control)) continue;
      auditRun("control", String(control["controlId"]), Array.isArray(control["evidenceIds"]) ? control["evidenceIds"].map(String) : []);
    }
  }

  // RECOMPUTE. Everything above this line still trusts one thing the report authored: `held: true`
  // on each control. For an instrument card that is the whole claim, so it is re-derived here from
  // the measurements the controls artifact carries, through the same frozen rubric the card ships.
  // A report that says a control held while the measurement behind it grades otherwise fails.
  for (const problem of recomputeControlOutcomes(controlsBytes, controls)) fail(problem);

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
