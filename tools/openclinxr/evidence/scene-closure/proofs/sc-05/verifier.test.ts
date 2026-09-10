import { describe, expect, it } from "vitest";
import { SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION } from "./report-schema.js";
import { measureShippedApproach } from "./runtime-approach-measurement.js";
import { parseArgs } from "./verify.js";
import {
  auditScopes,
  type EvidenceRegistry,
  inspectBehaviorTestSource,
  type ObjectReader,
  resolveArtifactPath,
  SC05_BEHAVIOR_TEST_PATH,
  SC05_BEHAVIOR_TEST_TITLE,
  SC05_FROZEN_SCOPES,
  SC05_REQUIRED_CHECK_IDS,
  SC05_REQUIRED_COMMANDS,
  SC05_REQUIRED_CONTROL_IDS,
  sha256Hex,
  verifyReport,
} from "./verify-core.js";

/**
 * The verifier's rejection matrix.
 *
 * proof-contract-v2.md permits synthetic fixtures HERE and nowhere else: "Verifier unit tests may
 * invoke an exported validation function with fixture data; the completion CLI must resolve actual
 * external evidence through the approved store registry and inspect it."
 *
 * The clause that matters most is (3). A verifier that accepts a plausible all-green report whose
 * artifacts are gone is worse than none, because every downstream reader treats its exit code as
 * evidence that bytes exist. The contract asks for exactly that test by name.
 */

/**
 * A synthetic observation stream that names every required check AND carries numbers the frozen
 * acceptance limits accept. The verifier re-applies those limits to these bytes, so a fixture that
 * only listed the ids would be refused here exactly as a real report would.
 */
const MEASURED_OBSERVATIONS = [
  ...SC05_REQUIRED_CHECK_IDS.filter(
    (checkId) =>
      checkId !== "arrival-error-within-0p05m"
      && checkId !== "settled-yaw-within-10deg"
      && checkId !== "root-stopped-for-two-seconds"
      && checkId !== "rubric-applied-to-loaded-skeleton-and-skin",
  ).map((checkId) => JSON.stringify({ checkId, metric: checkId, unit: "id", value: checkId })),
  ...SC05_REQUIRED_CONTROL_IDS.map((controlId) =>
    JSON.stringify({ checkId: controlId, metric: controlId, unit: "id", value: controlId }),
  ),
  JSON.stringify({ checkId: "arrival-error-within-0p05m", metric: "arrivalErrorMeters", unit: "m", value: 0.0147 }),
  JSON.stringify({
    checkId: "browser-run-arrives-and-stops",
    metric: "browserApproachGrade",
    unit: "m",
    value: {
      driveSource: "case_owned_bedside_approach",
      recorderGlobalPresent: false,
      skeletonSampleCount: 330,
      limbTravelMeters: 2.719,
      arrivalErrorMeters: 0.0327,
      settledYawErrorDegrees: 0,
      authoredTargetHeadingRadians: Math.PI,
      observedFinalYawRadians: Math.PI,
      stoppedSeconds: 4.09,
      stoppedRootTravelMeters: 0,
    },
  }),
  JSON.stringify({ checkId: "settled-yaw-within-10deg", metric: "settledYawErrorDegrees", unit: "deg", value: 0 }),
  JSON.stringify({
    checkId: "root-stopped-for-two-seconds",
    metric: "stoppedRootTravelMeters",
    unit: "m",
    value: { stoppedSeconds: 7.18, stoppedRootTravelMeters: 0 },
  }),
  JSON.stringify({
    checkId: "rubric-applied-to-loaded-skeleton-and-skin",
    metric: "rubricGrades",
    unit: "metric",
    value: {
      rubricVersion: "openclinxr.scene-closure-measurement-rubric.v1",
      walkFailedMetrics: ["support-contact", "support-penetration"],
      skinnedBodyCount: 11,
      skinnedVertexSampleCount: 51548,
    },
  }),
].join("\n");
const ARTIFACT_BYTES = Buffer.from(`${MEASURED_OBSERVATIONS}\n`);
const ARTIFACT_SHA = sha256Hex(ARTIFACT_BYTES);
const BASELINE_BYTES = Buffer.from("baseline run output\n");
const FIXED_BYTES = Buffer.from("fixed run output\n");

const REGISTRY: EvidenceRegistry = {
  schemaVersion: "openclinxr.sc-evidence-registry.v1",
  storageRoot: "/store",
  aliases: { "sc-evidence": { root: "/store" } },
};
const REGISTRY_SHA = "0".repeat(64);

/** A reader over an in-memory store. Absent keys behave exactly like absent bytes on disk. */
function readerFor(objects: Record<string, Buffer>, links: Record<string, string> = {}): ObjectReader {
  return {
    read(absolutePath) {
      const bytes = objects[absolutePath];
      return bytes ?? new Error(`ENOENT ${absolutePath}`);
    },
    realpath(absolutePath) {
      return links[absolutePath] ?? absolutePath;
    },
  };
}

/** A synthetic source tree. proof-contract-v2.md allows fixtures HERE and only here. */
const BEHAVIOR_TEST_SOURCE = [
  'import { describe, it, expect } from "vitest";',
  'describe("the normal encounter physician approaches and stops", () => {',
  `  it("${SC05_BEHAVIOR_TEST_TITLE}", async () => { expect(1).toBe(1); });`,
  "});",
  "",
].join("\n");
const CHANGED_SOURCE = "export const x = 1;\n";
const SOURCE_TREE: Record<string, string> = {
  [SC05_BEHAVIOR_TEST_PATH]: BEHAVIOR_TEST_SOURCE,
  "packages/openclinxr/xr-runtime-state/a.ts": CHANGED_SOURCE,
  "packages/openclinxr/xr-station-room/a.ts": CHANGED_SOURCE,
};

function sourceReaderFor(tree: Record<string, string>): (path: string) => string | Error {
  return (repoRelativePath) => tree[repoRelativePath] ?? new Error(`ENOENT ${repoRelativePath}`);
}

const CONTRACT_DOCUMENTS = new Map<string, string>([
  ["docs/openclinxr/scene-closure-2026-09-09/acceptance-v2.md", "aaa"],
  ["docs/openclinxr/scene-closure-2026-09-09/tasks-v2.md", "bbb"],
  ["docs/openclinxr/scene-closure-2026-09-09/proof-contract-v2.md", "ccc"],
  ["docs/openclinxr/scene-closure-2026-09-09/delegation-v2.md", "ddd"],
]);

function goodReport(): Record<string, unknown> {
  return {
    schemaVersion: SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION,
    cardKey: "SC-05",
    contract: {
      pinnedCommit: "c3f3f3007dc95f85aa6f4dd710c8da5205d03f50",
      documents: [...CONTRACT_DOCUMENTS].map(([path, sha256]) => ({ path, sha256 })),
      aRows: ["A05", "A07", "A08"],
    },
    implementation: {
      productSourceCommit: "1111111",
      dependencyBaselineCommit: "0000000",
      changeCommits: ["1111111"],
      treeClean: true,
      inputs: [
        { path: SC05_BEHAVIOR_TEST_PATH, sha256: sha256Hex(BEHAVIOR_TEST_SOURCE) },
        { path: "packages/openclinxr/xr-runtime-state/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
        { path: "packages/openclinxr/xr-station-room/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
      ],
      changedFiles: [
        "packages/openclinxr/xr-runtime-state/a.ts",
        "packages/openclinxr/xr-station-room/a.ts",
      ],
      runtime: { node: "v24", platform: "darwin-arm64" },
    },
    execution: {
      taskId: "tsk_4d39f0beaa5cdcc6",
      runId: "run-1",
      commands: SC05_REQUIRED_COMMANDS.map((command) => ({
        argv: command.split(" "),
        exitCode: 0,
        startedAtIso: "2026-09-09T18:00:00.000Z",
        endedAtIso: "2026-09-09T18:00:20.000Z",
        tests: { passed: 3, failed: 0, skipped: 0, todo: 0 },
      })),
    },
    counterweight: {
      testIds: ["SC-05-required-behavior"],
      baselineRevision: "0000000",
      baselineRunId: "run-0",
      failingAssertion: "the manifest names the exact support the supine placement depends on",
      observedBeforeFix: "undefined",
      knownGoodControl: "the standing clinical placement still resolves with no support required",
      fixedRevision: "1111111",
      observedAfterFix: "inpatient_ward_room_v1:stretcher",
      baselineOutputArtifactId: "baseline-output",
      fixedOutputArtifactId: "fixed-output",
    },
    sourceInspection: {
      behaviorTestPath: SC05_BEHAVIOR_TEST_PATH,
      behaviorTestTitle: SC05_BEHAVIOR_TEST_TITLE,
    },
    encounter: { caseId: "scene_closure_supine_bedside_v1", caseVersion: 2 },
    observations: [
      {
        observationId: "obs-loaded-scenario",
        metric: "required support instance on the supine placement",
        unit: "identifier",
        value: "inpatient_ward_room_v1:stretcher",
        observedAtMs: 1,
        artifactId: "run-observations",
        source: "stageStationActors over a real station shell",
      },
    ],
    checks: SC05_REQUIRED_CHECK_IDS.map((checkId) => ({
      checkId,
      expected: "contract predicate",
      observed: "observed value",
      outcome: "satisfied",
      evidenceIds: ["obs-loaded-scenario", "run-observations"],
    })),
    controls: SC05_REQUIRED_CONTROL_IDS.map((controlId) => ({
      controlId,
      trigger: "constructed",
      expected: "refusal",
      observed: "refused as expected",
      held: true,
      evidenceIds: ["run-observations"],
    })),
    artifacts: [
      {
        artifactId: "run-observations",
        storeAlias: "sc-evidence",
        objectKey: "sc-05/observations.jsonl",
        byteCount: ARTIFACT_BYTES.byteLength,
        sha256: ARTIFACT_SHA,
        mediaType: "application/x-ndjson",
        createdAtIso: "2026-09-09T18:00:00.000Z",
        runId: "run-1",
      },
      {
        artifactId: "baseline-output",
        storeAlias: "sc-evidence",
        objectKey: "sc-05/baseline.txt",
        byteCount: BASELINE_BYTES.byteLength,
        sha256: sha256Hex(BASELINE_BYTES),
        mediaType: "text/plain",
        createdAtIso: "2026-09-09T17:00:00.000Z",
        runId: "run-0",
      },
      {
        artifactId: "fixed-output",
        storeAlias: "sc-evidence",
        objectKey: "sc-05/fixed.txt",
        byteCount: FIXED_BYTES.byteLength,
        sha256: sha256Hex(FIXED_BYTES),
        mediaType: "text/plain",
        createdAtIso: "2026-09-09T18:00:00.000Z",
        runId: "run-1",
      },
    ],
    reviews: [
      {
        reviewerId: "reviewer-session-1",
        role: "independent reviewer",
        distinctFromImplementer: true,
        reviewedSourceCommit: "1111111",
        retrievedArtifactIds: ["run-observations"],
        sessionIso: "2026-09-09T18:30:00.000Z",
        observations: "retrieved and inspected the observation stream",
        decision: "accepted",
      },
    ],
    limits: {
      unprovenClinical: ["clinical validity"],
      unprovenHeadset: ["worn-headset readiness"],
      unprovenPublication: ["public deployment"],
      unresolvedDefects: [],
    },
    evidenceRegistrySha256: REGISTRY_SHA,
  };
}

const OBJECTS = {
  "/store/sc-05/observations.jsonl": ARTIFACT_BYTES,
  "/store/sc-05/baseline.txt": BASELINE_BYTES,
  "/store/sc-05/fixed.txt": FIXED_BYTES,
};

function verify(
  report: Record<string, unknown>,
  objects: Record<string, Buffer> = OBJECTS,
  links: Record<string, string> = {},
  tree: Record<string, string> = SOURCE_TREE,
) {
  return verifyReport({
    report,
    suppliedScopes: [...SC05_FROZEN_SCOPES],
    registry: REGISTRY,
    registrySha256: REGISTRY_SHA,
    reader: readerFor(objects, links),
    contractDocuments: CONTRACT_DOCUMENTS,
    sourceReader: sourceReaderFor(tree),
  });
}

describe("the SC-05 evidence verifier accepts a complete control and rejects everything else", () => {
  it("(1) a complete valid report with resolvable artifacts is accepted", () => {
    const result = verify(goodReport());
    expect(result.ok, result.ok ? "" : result.problems.join("\n")).toBe(true);
  });

  it("(2) COUNTERWEIGHT: a plausible all-green report whose artifacts are GONE is rejected", () => {
    // Named by the proof contract: "Test the verifier against a plausible all-green report with its
    // underlying artifacts removed or changed." Nothing in the report changes here — only the bytes
    // disappear, which is exactly the state a reader cannot see without this check.
    const result = verify(goodReport(), {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/ENOENT/u);
  });

  it("(3) CHANGED artifact bytes are rejected on the hash, not merely on presence", () => {
    const result = verify(goodReport(), {
      ...OBJECTS,
      "/store/sc-05/observations.jsonl": Buffer.from("tampered\n"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/sha256 mismatch/u);
  });

  it("(4) an unknown store alias, an absolute key and a traversal key are each refused", () => {
    const reader = readerFor(OBJECTS);
    expect(resolveArtifactPath(REGISTRY, "not-a-store", "x", reader)).toBeInstanceOf(Error);
    expect(resolveArtifactPath(REGISTRY, "sc-evidence", "/etc/passwd", reader)).toBeInstanceOf(Error);
    expect(resolveArtifactPath(REGISTRY, "sc-evidence", "../outside", reader)).toBeInstanceOf(Error);
  });

  it("(5) a SYMLINK escape out of the alias root is refused even though the key looks clean", () => {
    // The key is relative and inside the root; only the resolved path leaves it. A verifier that
    // checks the key string alone passes this.
    const links = { "/store/sc-05/observations.jsonl": "/elsewhere/observations.jsonl" };
    const result = verify(goodReport(), OBJECTS, links);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/resolves outside alias root/u);
  });

  it("(6) a missing required check and a missing required control each fail", () => {
    const missingCheck = goodReport();
    (missingCheck["checks"] as unknown[]).pop();
    expect(verify(missingCheck).ok).toBe(false);

    const missingControl = goodReport();
    (missingControl["controls"] as unknown[]).pop();
    expect(verify(missingControl).ok).toBe(false);
  });

  it("(7) a report cannot invent a check id or duplicate one to fill the set", () => {
    const invented = goodReport();
    (invented["checks"] as Array<Record<string, unknown>>)[0] = {
      checkId: "a-check-the-contract-never-required",
      expected: "x",
      observed: "y",
      outcome: "satisfied",
      evidenceIds: ["obs-loaded-scenario"],
    };
    const result = verify(invented);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/unknown checkId/u);
    expect(result.problems.join("\n")).toMatch(/required check .* is missing/u);
  });

  it("(8) pending and unknown outcomes do not pass, and neither does an unheld control", () => {
    for (const outcome of ["pending", "unknown", "unsatisfied"]) {
      const report = goodReport();
      (report["checks"] as Array<Record<string, unknown>>)[0]!["outcome"] = outcome;
      expect(verify(report).ok, `${outcome} must not pass`).toBe(false);
    }
    const unheld = goodReport();
    (unheld["controls"] as Array<Record<string, unknown>>)[0]!["held"] = false;
    expect(verify(unheld).ok).toBe(false);
  });

  it("(9) a counterweight that observed the same value before and after is not decisive", () => {
    const report = goodReport();
    const counterweight = report["counterweight"] as Record<string, unknown>;
    counterweight["observedAfterFix"] = counterweight["observedBeforeFix"];
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/same value before and after/u);
  });

  it("(10) a recorded test run with zero passing, or any skipped, fails", () => {
    for (const tests of [
      { passed: 0, failed: 0, skipped: 0, todo: 0 },
      { passed: 3, failed: 0, skipped: 1, todo: 0 },
      { passed: 3, failed: 1, skipped: 0, todo: 0 },
      { passed: 3, failed: 0, skipped: 0, todo: 2 },
    ]) {
      const report = goodReport();
      ((report["execution"] as Record<string, unknown>)["commands"] as Array<Record<string, unknown>>)[0]!["tests"] = tests;
      expect(verify(report).ok, JSON.stringify(tests)).toBe(false);
    }
  });

  it("(11) a review by the implementer is not an independent review", () => {
    const report = goodReport();
    (report["reviews"] as Array<Record<string, unknown>>)[0]!["distinctFromImplementer"] = false;
    expect(verify(report).ok).toBe(false);
  });

  it("(12) a swapped evidence registry is visible through its bound hash", () => {
    const result = verifyReport({
      report: goodReport(),
      suppliedScopes: [...SC05_FROZEN_SCOPES],
      registry: REGISTRY,
      registrySha256: "f".repeat(64),
      reader: readerFor(OBJECTS),
      contractDocuments: CONTRACT_DOCUMENTS,
      sourceReader: sourceReaderFor(SOURCE_TREE),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/registry in use/u);
  });

  it("(13) a contract document hash that disagrees with the file on disk fails", () => {
    const report = goodReport();
    (report["contract"] as Record<string, unknown>)["documents"] = [
      { path: "docs/openclinxr/scene-closure-2026-09-09/acceptance-v2.md", sha256: "not-the-real-hash" },
    ];
    expect(verify(report).ok).toBe(false);
  });

  it("(13b) a changed file outside every frozen scope is rejected, and an empty list is too", () => {
    // The argument audit checks what the CLI was TOLD; this checks what the task actually changed.
    // Only the second catches an edit in a package the card never claimed.
    const outside = goodReport();
    (outside["implementation"] as Record<string, unknown>)["changedFiles"] = [
      "packages/openclinxr/shared-schemas/a.ts",
      "packages/openclinxr/never-owned-by-any-card/x.ts",
    ];
    const result = verify(outside);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/outside every frozen scope: packages\/openclinxr\/never-owned-by-any-card/u);

    const empty = goodReport();
    (empty["implementation"] as Record<string, unknown>)["changedFiles"] = [];
    expect(verify(empty).ok).toBe(false);
  });

  it("(14) the scope audit rejects an omitted, extra or duplicated scope", () => {
    expect(auditScopes(SC05_FROZEN_SCOPES)).toEqual([]);
    expect(auditScopes(SC05_FROZEN_SCOPES.slice(1))).toContain(`omitted --scope ${SC05_FROZEN_SCOPES[0]}`);
    expect(auditScopes([...SC05_FROZEN_SCOPES, "packages/openclinxr/telemetry"]))
      .toContain("extra --scope packages/openclinxr/telemetry");
    expect(auditScopes([...SC05_FROZEN_SCOPES, SC05_FROZEN_SCOPES[0]!]).join("\n")).toMatch(/duplicate/u);
  });

  it("(16) WRONG-RUN control: an artifact carrying neither the execution nor the baseline run id fails", () => {
    const report = goodReport();
    (report["artifacts"] as Array<Record<string, unknown>>)[0]!["runId"] = "run-from-another-session";
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/is neither the execution run/u);

    // Known-good half: the BASELINE artifact legitimately carries a different run id and passes,
    // so this clause is about a foreign run and not about run ids differing at all.
    expect(verify(goodReport()).ok).toBe(true);
  });

  it("(17) a frozen completion command that was not recorded exiting zero fails", () => {
    const missing = goodReport();
    const commands = (missing["execution"] as Record<string, unknown>)["commands"] as unknown[];
    commands.pop();
    expect(verify(missing).ok).toBe(false);

    const nonZero = goodReport();
    const all = (nonZero["execution"] as Record<string, unknown>)["commands"] as Array<Record<string, unknown>>;
    all[0]!["exitCode"] = 1;
    const result = verify(nonZero);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/was not recorded exiting zero/u);
  });

  it("(18) CORRUPT SOURCE control: an input whose tree bytes no longer match its recorded hash fails", () => {
    const result = verify(goodReport(), OBJECTS, {}, {
      ...SOURCE_TREE,
      "packages/openclinxr/xr-station-room/a.ts": "export const x = 2;\n",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/sha256 mismatch \(report/u);
  });

  it("(19) MALFORMED BEHAVIOR TEST control: skipped, marked, or comment-only titles are refused", () => {
    // assert-contract-live.ts is a source-pattern check on the title; these are the readings it
    // cannot make, and the proof contract names them.
    expect(inspectBehaviorTestSource(BEHAVIOR_TEST_SOURCE, SC05_BEHAVIOR_TEST_TITLE)).toEqual([]);
    for (const bad of [
      `describe("s", () => { it.skip("${SC05_BEHAVIOR_TEST_TITLE}", () => {}); it("${SC05_BEHAVIOR_TEST_TITLE}", () => {}); });`,
      `describe.skip("s", () => { it("${SC05_BEHAVIOR_TEST_TITLE}", () => {}); });`,
      `// it("${SC05_BEHAVIOR_TEST_TITLE}", () => {});`,
      `/* it("${SC05_BEHAVIOR_TEST_TITLE}", () => {}); */`,
      `describe("s", () => { it.fails("${SC05_BEHAVIOR_TEST_TITLE}", () => {}); });`,
    ]) {
      expect(inspectBehaviorTestSource(bad, SC05_BEHAVIOR_TEST_TITLE).length, bad).toBeGreaterThan(0);
    }
    // And through the whole verifier, with the tree holding a skipped test.
    const tree = {
      ...SOURCE_TREE,
      [SC05_BEHAVIOR_TEST_PATH]: `describe.skip("s", () => { it("${SC05_BEHAVIOR_TEST_TITLE}", () => {}); });`,
    };
    const report = goodReport();
    (report["implementation"] as Record<string, unknown>)["inputs"] = [
      { path: SC05_BEHAVIOR_TEST_PATH, sha256: sha256Hex(tree[SC05_BEHAVIOR_TEST_PATH]!) },
      { path: "packages/openclinxr/shared-schemas/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
      { path: "packages/openclinxr/scenario-runtime/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
    ];
    expect(verify(report, OBJECTS, {}, tree).ok).toBe(false);
  });

  it("(20) a check citing a real, correctly hashed artifact that never mentions it is refused", () => {
    // The report-authored pass. Every hash resolves and every byte is genuine; the artifact simply
    // says nothing about this check, so the `satisfied` rests on the report's own word.
    const bytes = Buffer.from("an observation stream about something else entirely\n");
    const result = verify(goodReport(), { ...OBJECTS, "/store/sc-05/observations.jsonl": bytes });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The hash check fires too; the clause under test is the mention.
    const report = goodReport();
    (report["artifacts"] as Array<Record<string, unknown>>)[0]!["sha256"] = sha256Hex(bytes);
    (report["artifacts"] as Array<Record<string, unknown>>)[0]!["byteCount"] = bytes.byteLength;
    const mentionOnly = verify(report, { ...OBJECTS, "/store/sc-05/observations.jsonl": bytes });
    expect(mentionOnly.ok).toBe(false);
    if (mentionOnly.ok) return;
    expect(mentionOnly.problems.join("\n")).toMatch(/is not mentioned in the bytes/u);
  });

  it("(21) a changed file with no hashed input entry fails, so the audit cannot skip the change", () => {
    const report = goodReport();
    (report["implementation"] as Record<string, unknown>)["inputs"] = [
      { path: SC05_BEHAVIOR_TEST_PATH, sha256: sha256Hex(BEHAVIOR_TEST_SOURCE) },
    ];
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/has no hashed entry in implementation.inputs/u);
  });

  it("(15) the CLI argv parser refuses an unknown flag, a bare argument and a missing report", () => {
    expect(parseArgs(["--report", "x", "--scope", "y"])).toEqual({ report: "x", scopes: ["y"] });
    expect(parseArgs(["--scope", "y"])).toEqual({ error: "--report is required" });
    expect(parseArgs(["--report", "x"])).toEqual({ error: "at least one --scope is required" });
    expect(parseArgs(["--report", "x", "--fixture"])).toMatchObject({ error: expect.stringContaining("unknown argument") });
    expect(parseArgs(["bare"])).toMatchObject({ error: expect.stringContaining("unknown argument") });
    expect(parseArgs(["--report", "x", "--report", "z", "--scope", "y"]))
      .toMatchObject({ error: expect.stringContaining("more than once") });
  });

  // ── The three acceptance limits, and the frozen rubric grade, re-applied to the BYTES ──────────
  //
  // proof-contract-v2.md: "Never trust a second copy of the expected value supplied by the same
  // report." Every clause below hands the verifier a report whose `checks` all say `satisfied` and
  // whose observation stream says otherwise, and the observation stream wins.

  function withObservations(lines: readonly string[]): Record<string, unknown> {
    const bytes = Buffer.from(`${lines.join("\n")}\n`);
    const report = goodReport();
    const artifacts = report["artifacts"] as Array<Record<string, unknown>>;
    for (const artifact of artifacts) {
      if (artifact["artifactId"] === "run-observations") {
        artifact["sha256"] = sha256Hex(bytes);
        artifact["byteCount"] = bytes.byteLength;
      }
    }
    return report;
  }

  function verifyWithObservations(lines: readonly string[]): ReturnType<typeof verify> {
    const bytes = Buffer.from(`${lines.join("\n")}\n`);
    return verify(withObservations(lines), {
      "/store/sc-05/observations.jsonl": bytes,
      "/store/sc-05/baseline.txt": BASELINE_BYTES,
      "/store/sc-05/fixed.txt": FIXED_BYTES,
    });
  }

  const MEASURED_LINES = MEASURED_OBSERVATIONS.split("\n");

  function replacingCheck(checkId: string, value: unknown): string[] {
    return MEASURED_LINES.map((line) => {
      const parsed = JSON.parse(line) as { checkId: string; metric: string; unit: string };
      return parsed.checkId === checkId ? JSON.stringify({ ...parsed, value }) : line;
    });
  }

  it("(23) an arrival error over the 0.05 m cap fails even though every check says satisfied", () => {
    const result = verifyWithObservations(replacingCheck("arrival-error-within-0p05m", 0.31));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("arrival error 0.31 m exceeds the 0.05 m cap");
  });

  it("(24) a settled heading over the 10 degree cap fails", () => {
    const result = verifyWithObservations(replacingCheck("settled-yaw-within-10deg", 41.2));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("41.2 deg exceeds the 10 deg cap");
  });

  it("(25) a stopped observation shorter than two seconds fails, and so does resumed root travel", () => {
    const short = verifyWithObservations(
      replacingCheck("root-stopped-for-two-seconds", { stoppedSeconds: 1.4, stoppedRootTravelMeters: 0 }),
    );
    expect(short.ok).toBe(false);
    expect(short.problems.join(" ")).toContain("under the 2 s minimum");
    const moved = verifyWithObservations(
      replacingCheck("root-stopped-for-two-seconds", { stoppedSeconds: 3, stoppedRootTravelMeters: 0.02 }),
    );
    expect(moved.ok).toBe(false);
    expect(moved.problems.join(" ")).toContain("root travel 0.02 m during the stopped observation");
  });

  it("(26) a grade naming a different rubric version fails", () => {
    const result = verifyWithObservations(
      replacingCheck("rubric-applied-to-loaded-skeleton-and-skin", {
        rubricVersion: "openclinxr.scene-closure-measurement-rubric.v2",
        walkFailedMetrics: ["support-contact", "support-penetration"],
        skinnedBodyCount: 11,
        skinnedVertexSampleCount: 51548,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("not the frozen SC-00 version");
  });

  it("(27) EVASION: a shrinking walk-failure list is refused, not read as a cleaner sheet", () => {
    const result = verifyWithObservations(
      replacingCheck("rubric-applied-to-loaded-skeleton-and-skin", {
        rubricVersion: "openclinxr.scene-closure-measurement-rubric.v1",
        walkFailedMetrics: [],
        skinnedBodyCount: 11,
        skinnedVertexSampleCount: 51548,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("a shrinking failure list is a coverage change, not a pass");
  });

  it("(28) any OTHER metric failing the walk interval fails", () => {
    const result = verifyWithObservations(
      replacingCheck("rubric-applied-to-loaded-skeleton-and-skin", {
        rubricVersion: "openclinxr.scene-closure-measurement-rubric.v1",
        walkFailedMetrics: ["support-contact", "support-penetration", "foot-slide"],
        skinnedBodyCount: 11,
        skinnedVertexSampleCount: 51548,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("the walk interval failed foot-slide");
  });

  it("(29) zero skinned bodies or zero vertex samples fail; absence is not a pass", () => {
    const result = verifyWithObservations(
      replacingCheck("rubric-applied-to-loaded-skeleton-and-skin", {
        rubricVersion: "openclinxr.scene-closure-measurement-rubric.v1",
        walkFailedMetrics: ["support-contact", "support-penetration"],
        skinnedBodyCount: 0,
        skinnedVertexSampleCount: 0,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("zero skinned bodies were observed");
    expect(result.problems.join(" ")).toContain("zero skinned vertex samples were observed");
  });

  it("(30b) a browser run driven by a recorder global fails, and so does one that observed nothing", () => {
    const injected = verifyWithObservations(
      replacingCheck("browser-run-arrives-and-stops", {
        driveSource: "window.__openClinXrPedsDrive",
        recorderGlobalPresent: true,
        skeletonSampleCount: 330,
        limbTravelMeters: 2.719,
        arrivalErrorMeters: 0.0327,
        settledYawErrorDegrees: 0,
        authoredTargetHeadingRadians: Math.PI,
        observedFinalYawRadians: Math.PI,
        stoppedSeconds: 4.09,
        stoppedRootTravelMeters: 0,
      }),
    );
    expect(injected.ok).toBe(false);
    expect(injected.problems.join(" ")).toContain("not the case-owned producer");
    expect(injected.problems.join(" ")).toContain("a recorder global was present");

    const blind = verifyWithObservations(
      replacingCheck("browser-run-arrives-and-stops", {
        driveSource: "case_owned_bedside_approach",
        recorderGlobalPresent: false,
        skeletonSampleCount: 0,
        limbTravelMeters: 0,
        arrivalErrorMeters: 0.0327,
        settledYawErrorDegrees: 0,
        authoredTargetHeadingRadians: Math.PI,
        observedFinalYawRadians: Math.PI,
        stoppedSeconds: 4.09,
        stoppedRootTravelMeters: 0,
      }),
    );
    expect(blind.ok).toBe(false);
    expect(blind.problems.join(" ")).toContain("fewer than three skeleton samples");
    expect(blind.problems.join(" ")).toContain("a flag is not motion");
  });

  it("(30c) a browser run whose final heading is not the AUTHORED one fails inside the yaw tolerance", () => {
    // Math.PI - 0.08 is 0.08 rad off the authored heading — 4.58 degrees, the exact size of the
    // heading SC-03 measured being silently dropped, and well inside the 10 degree cap.
    const result = verifyWithObservations(
      replacingCheck("browser-run-arrives-and-stops", {
        driveSource: "case_owned_bedside_approach",
        recorderGlobalPresent: false,
        skeletonSampleCount: 330,
        limbTravelMeters: 2.719,
        arrivalErrorMeters: 0.0327,
        settledYawErrorDegrees: 4.58,
        authoredTargetHeadingRadians: Math.PI,
        observedFinalYawRadians: Math.PI - 0.08,
        stoppedSeconds: 4.09,
        stoppedRootTravelMeters: 0,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("is not the authored");
  });

  it("(30) a missing acceptance measurement fails; a number nobody recorded is not a passing one", () => {
    const result = verifyWithObservations(
      MEASURED_LINES.filter((line) => !line.includes("arrival-error-within-0p05m")),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("no numeric arrival-error observation was recorded");
  });


  // ── THE ACTUAL RUN, on the shipped bytes, graded by SC-00's frozen rubric ──────────────────────
  //
  // Everything above is synthetic and is allowed to be: proof-contract-v2.md permits fixtures in
  // this suite and nowhere else. This clause is the opposite kind and is here because of a boundary,
  // not a preference. The card fixes the behaviour test inside `apps/ui-xr/src`, and
  // `workspace-architecture.test.ts` forbids app source from importing `tools/openclinxr/evidence/`,
  // which is where the frozen rubric and its GLB decoders live. So the SHIPPED clip is driven
  // through the same production runtime HERE, where the rubric may be imported, and the app test
  // drives the same runtime over a clip whose stride is known.

  it("(31) THE SHIPPED CLIP: the walk interval passes the frozen rubric and the terminal turn does not", async () => {
    const { grades } = await measureShippedApproach();
    // The walk. SC-00 measured this clip at 8.0x and 20.0x over the plant threshold at the advance
    // the executor applies; under the stance lock the walk interval is exactly zero on both feet.
    expect(grades.walkFootSlide.outcome).toBe("satisfied");
    expect(grades.walk.failedMetrics.slice().sort()).toEqual(["support-contact", "support-penetration"]);
    // The two that remain are the PATIENT's: they grade a body resting on a support, and this
    // measurement is of a standing physician whose floor contact `signed-floor-contact` and
    // `floor-penetration` do grade. Asserting the exact set rather than filtering it is deliberate.
    expect(grades.stop.failedMetrics.slice().sort()).toEqual(["support-contact", "support-penetration"]);
    // The terminal turn FAILS, and it is asserted as failing rather than excluded. There is no
    // turn-in-place take in the shipped clip set, so a planted toe drags while the body rotates.
    expect(grades.settleTurnFootSlide.outcome).toBe("violated");
    // And the whole-run grade carries that failure, so the interval split cannot be read as a way
    // of hiding it.
    expect(grades.wholeRun.failedMetrics).toContain("foot-slide");
    // The acceptance-contract limits, on the shipped clip's own run.
    expect(grades.arrivalErrorMeters).toBeLessThanOrEqual(0.05);
    expect(grades.settledYawErrorDegrees).toBeLessThanOrEqual(10);
    expect(grades.stoppedSeconds).toBeGreaterThanOrEqual(2);
    expect(grades.stoppedRootTravelMeters).toBeLessThanOrEqual(0.005);
    // Zero skinned bodies or zero samples would be the measurement observing nothing.
    expect(grades.skinnedBodyCount).toBeGreaterThan(0);
    expect(grades.skinnedVertexSampleCount).toBeGreaterThan(0);
    // The clip's own advance is MEASURED, not the executor's shipped 1.1 m/s constant.
    expect(grades.clipStanceAdvanceMetersPerSecond).toBeGreaterThan(0);
    expect(grades.clipStanceAdvanceMetersPerSecond).toBeLessThan(1.1);
  }, 300_000);

});
