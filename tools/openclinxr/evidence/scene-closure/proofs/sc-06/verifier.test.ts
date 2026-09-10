import { describe, expect, it } from "vitest";
import { SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION } from "./report-schema.js";
import { parseArgs } from "./verify.js";
import {
  auditScopes,
  type EvidenceRegistry,
  inspectBehaviorTestSource,
  type ObjectReader,
  recomputeAcceptanceLimits,
  resolveArtifactPath,
  SC06_BEHAVIOR_TEST_PATH,
  SC06_BEHAVIOR_TEST_TITLE,
  SC06_FROZEN_SCOPES,
  SC06_REQUIRED_CHECK_IDS,
  SC06_REQUIRED_CONTROL_IDS,
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

const ARTIFACT_BYTES = Buffer.from("a recorded normal-workflow observation stream\n");
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

/** A behavior test source that satisfies the inspector: ordinary `it`, real assertions. */
const BEHAVIOR_TEST_SOURCE = `
describe("the normal consumer replays and invalidates the frozen scene", () => {
  it("${"SC-06-required-behavior"}", () => {
    expect(reopened.status).toBe("reopened");
  });
});
`;
const CASE_SOURCE = "export const SCENE_CLOSURE_CASE_ID = \"scene_closure_supine_bedside_v1\";\n";
const CHANGED_SOURCE = "export const changed = true;\n";
const SOURCE_TREE: Record<string, string> = {
  [SC06_BEHAVIOR_TEST_PATH]: BEHAVIOR_TEST_SOURCE,
  "tools/openclinxr/factory/scene-closure-case-source.ts": CASE_SOURCE,
  "packages/openclinxr/asset-registry/a.ts": CHANGED_SOURCE,
  "packages/openclinxr/scenario-runtime/a.ts": CHANGED_SOURCE,
};

/** Reads the synthetic tree. An unknown path behaves exactly like an unreadable file. */
function sourceReaderFor(tree: Record<string, string>): (repoRelativePath: string) => Buffer | Error {
  return (repoRelativePath) => {
    const source = tree[repoRelativePath];
    return source === undefined ? new Error(`ENOENT ${repoRelativePath}`) : Buffer.from(source, "utf8");
  };
}

const CONTRACT_DOCUMENTS = new Map<string, string>([
  ["docs/openclinxr/scene-closure-2026-09-09/acceptance-v2.md", "aaa"],
  ["docs/openclinxr/scene-closure-2026-09-09/tasks-v2.md", "bbb"],
  ["docs/openclinxr/scene-closure-2026-09-09/proof-contract-v2.md", "ccc"],
  ["docs/openclinxr/scene-closure-2026-09-09/delegation-v2.md", "ddd"],
]);

/**
 * The observation stream a passing behavior run records. These are the VALUES the verifier re-grades;
 * a report cannot supply a second copy of the verdict instead.
 */
function MEASURED_OBSERVATIONS(): Array<Record<string, unknown>> {
  return [
    { observationId: "sc06-a09-fields-present", metric: "a09_fields_present_on_record", unit: "count", value: 14, observedAtMs: 1, artifactId: "run-observations", source: "freezeAcceptedScenePlan" },
    { observationId: "sc06-reproduction-offset", metric: "layout_reproduction_offset_meters", unit: "meters", value: 0, observedAtMs: 2, artifactId: "run-observations", source: "reopenFrozenScene" },
    { observationId: "sc06-variation-resolved", metric: "authorized_indices_that_resolved", unit: "count", value: 6, observedAtMs: 3, artifactId: "run-observations", source: "freezeAcceptedScenePlan" },
    { observationId: "sc06-variation-refused", metric: "authorized_indices_refused_with_named_conflicts", unit: "count", value: 4, observedAtMs: 4, artifactId: "run-observations", source: "freezeAcceptedScenePlan" },
    { observationId: "sc06-distinct-refusals", metric: "distinct_evidence_refusal_kinds", unit: "count", value: 3, observedAtMs: 5, artifactId: "run-observations", source: "reopenFrozenScene" },
    { observationId: "sc06-frozen-plan-revision", metric: "frozen_plan_revision", unit: "digest", value: "plan-v1-abc", observedAtMs: 6, artifactId: "run-observations", source: "scenePlanRevision" },
    { observationId: "sc06-frozen-seed", metric: "frozen_layout_seed", unit: "digest", value: "a".repeat(64), observedAtMs: 7, artifactId: "run-observations", source: "deriveLayoutVariationSeed" },
    { observationId: "sc06-geometry-revision", metric: "frozen_geometry_revision", unit: "digest", value: "geom-v1-c45e274d-7", observedAtMs: 8, artifactId: "run-observations", source: "geometryRevisionDigest" },
  ];
}

function goodReport(): Record<string, unknown> {
  return {
    schemaVersion: SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION,
    cardKey: "SC-06",
    contract: {
      pinnedCommit: "c3f3f3007dc95f85aa6f4dd710c8da5205d03f50",
      documents: [...CONTRACT_DOCUMENTS].map(([path, sha256]) => ({ path, sha256 })),
      aRows: ["A09"],
    },
    implementation: {
      productSourceCommit: "1111111",
      dependencyBaselineCommit: "0000000",
      changeCommits: ["1111111"],
      treeClean: true,
      inputs: [
        { path: "tools/openclinxr/factory/scene-closure-case-source.ts", sha256: sha256Hex(CASE_SOURCE) },
        { path: "packages/openclinxr/asset-registry/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
        { path: "packages/openclinxr/scenario-runtime/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
      ],
      changedFiles: ["packages/openclinxr/asset-registry/a.ts", "packages/openclinxr/scenario-runtime/a.ts"],
      runtime: { node: "v24", platform: "darwin-arm64" },
    },
    sourceInspection: {
      behaviorTestPath: SC06_BEHAVIOR_TEST_PATH,
      behaviorTestTitle: SC06_BEHAVIOR_TEST_TITLE,
    },
    execution: {
      taskId: "tsk_5bae505424890144",
      runId: "run-1",
      commands: [
        {
          argv: ["pnpm", "exec", "vitest", "run", "apps/api/src/the-persisted-scene-reaches-the-normal-xr-consumer.test.ts"],
          exitCode: 0,
          startedAtIso: "2026-09-09T18:00:00.000Z",
          endedAtIso: "2026-09-09T18:00:20.000Z",
          tests: { passed: 3, failed: 0, skipped: 0, todo: 0 },
        },
      ],
    },
    counterweight: {
      testIds: ["SC-06-required-behavior"],
      baselineRevision: "0000000",
      failingAssertion: "loaded bundle scenarioId equals the persisted case id",
      observedBeforeFix: "ed_chest_pain_priority_v1",
      knownGoodControl: "ward_delirium_med_rec_v1 still resolves from the fixture bank",
      fixedRevision: "1111111",
      observedAfterFix: "scene_closure_supine_bedside_v1",
      baselineOutputArtifactId: "baseline-output",
      fixedOutputArtifactId: "fixed-output",
      baselineRunId: "run-0",
    },
    encounter: { caseId: "scene_closure_supine_bedside_v1", caseVersion: 2 },
    observations: MEASURED_OBSERVATIONS(),
    checks: SC06_REQUIRED_CHECK_IDS.map((checkId) => ({
      checkId,
      expected: "contract predicate",
      observed: "observed value",
      outcome: "satisfied",
      evidenceIds: ["sc06-reproduction-offset"],
    })),
    controls: SC06_REQUIRED_CONTROL_IDS.map((controlId) => ({
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
        objectKey: "sc-06/observations.jsonl",
        byteCount: ARTIFACT_BYTES.byteLength,
        sha256: ARTIFACT_SHA,
        mediaType: "application/x-ndjson",
        createdAtIso: "2026-09-09T18:00:00.000Z",
        runId: "run-1",
      },
      {
        artifactId: "baseline-output",
        storeAlias: "sc-evidence",
        objectKey: "sc-06/baseline.txt",
        byteCount: BASELINE_BYTES.byteLength,
        sha256: sha256Hex(BASELINE_BYTES),
        mediaType: "text/plain",
        createdAtIso: "2026-09-09T17:00:00.000Z",
        runId: "run-0",
      },
      {
        artifactId: "fixed-output",
        storeAlias: "sc-evidence",
        objectKey: "sc-06/fixed.txt",
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
  "/store/sc-06/observations.jsonl": ARTIFACT_BYTES,
  "/store/sc-06/baseline.txt": BASELINE_BYTES,
  "/store/sc-06/fixed.txt": FIXED_BYTES,
};

function verify(
  report: Record<string, unknown>,
  objects: Record<string, Buffer> = OBJECTS,
  links: Record<string, string> = {},
  tree: Record<string, string> = SOURCE_TREE,
) {
  return verifyReport({
    report,
    suppliedScopes: [...SC06_FROZEN_SCOPES],
    registry: REGISTRY,
    registrySha256: REGISTRY_SHA,
    reader: readerFor(objects, links),
    contractDocuments: CONTRACT_DOCUMENTS,
    sourceReader: sourceReaderFor(tree),
  });
}

describe("the SC-06 evidence verifier accepts a complete control and rejects everything else", () => {
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
      "/store/sc-06/observations.jsonl": Buffer.from("tampered\n"),
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
    const links = { "/store/sc-06/observations.jsonl": "/elsewhere/observations.jsonl" };
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
      suppliedScopes: [...SC06_FROZEN_SCOPES],
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
      "packages/openclinxr/asset-registry/a.ts",
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
    expect(auditScopes(SC06_FROZEN_SCOPES)).toEqual([]);
    expect(auditScopes(SC06_FROZEN_SCOPES.slice(1))).toContain(`omitted --scope ${SC06_FROZEN_SCOPES[0]}`);
    expect(auditScopes([...SC06_FROZEN_SCOPES, "packages/openclinxr/telemetry"]))
      .toContain("extra --scope packages/openclinxr/telemetry");
    expect(auditScopes([...SC06_FROZEN_SCOPES, SC06_FROZEN_SCOPES[0]!]).join("\n")).toMatch(/duplicate/u);
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

  it("(16) WRONG-RUN control: an artifact from neither this run nor the baseline is refused", () => {
    const report = goodReport();
    (report["artifacts"] as Array<Record<string, unknown>>)[0]!["runId"] = "run-99";
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/is neither the execution run/u);
  });

  it("(17) a source input whose bytes disagree with the tree is refused on the REHASH", () => {
    // The report carries its own copy of the digest; this clause is why that copy proves nothing.
    const report = goodReport();
    (report["implementation"] as Record<string, unknown>)["inputs"] = [
      { path: "tools/openclinxr/factory/scene-closure-case-source.ts", sha256: "0".repeat(64) },
      { path: "packages/openclinxr/asset-registry/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
      { path: "packages/openclinxr/scenario-runtime/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
    ];
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/sha256 mismatch/u);
  });

  it("(18) a changed file that was never hashed is refused, so the audit cannot skip its own subject", () => {
    const report = goodReport();
    (report["implementation"] as Record<string, unknown>)["changedFiles"] = [
      "packages/openclinxr/asset-registry/a.ts",
      "packages/openclinxr/scenario-runtime/a.ts",
      "packages/openclinxr/session-state/unhashed.ts",
    ];
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/not among the hashed implementation.inputs/u);
  });

  it("(19) a behavior test whose required title is skipped, commented or assertion-free is refused", () => {
    for (const [label, source] of [
      ["skipped", 'it.skip("SC-06-required-behavior", () => { expect(1).toBe(1); });'],
      ["it.fails", 'it.fails("SC-06-required-behavior", () => { expect(1).toBe(1); });'],
      ["commented out", '// it("SC-06-required-behavior", () => { expect(1).toBe(1); });'],
      ["inside a block comment", '/* it("SC-06-required-behavior", () => { expect(1).toBe(1); }); */'],
      ["empty callback", 'it("SC-06-required-behavior", () => {});'],
      ["skipped describe", 'describe.skip("s", () => { it("SC-06-required-behavior", () => { expect(1).toBe(1); }); });'],
    ] as const) {
      const problems = inspectBehaviorTestSource(source, SC06_BEHAVIOR_TEST_TITLE);
      expect(problems.length, label).toBeGreaterThan(0);
    }
    // KNOWN-GOOD COLUMN: the real shape passes, so the inspector is not refusing everything.
    expect(inspectBehaviorTestSource(BEHAVIOR_TEST_SOURCE, SC06_BEHAVIOR_TEST_TITLE)).toEqual([]);
  });

  it("(20) a behavior test the tree does not carry is refused rather than assumed present", () => {
    const result = verify(goodReport(), OBJECTS, {}, {
      "tools/openclinxr/factory/scene-closure-case-source.ts": CASE_SOURCE,
      "packages/openclinxr/asset-registry/a.ts": CHANGED_SOURCE,
      "packages/openclinxr/scenario-runtime/a.ts": CHANGED_SOURCE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/behavior test unreadable/u);
  });

  it("(21) REPORT-AUTHORED PASS: every check says satisfied while the observations contradict them", () => {
    // The shape the proof contract names: "a plausible all-green report". Its checks are untouched
    // and every one says `satisfied`; only the recorded NUMBERS are wrong, and the verifier re-grades
    // those rather than reading the verdicts beside them.
    for (const [label, patch] of [
      ["reproduction offset over tolerance", { "sc06-reproduction-offset": 0.31 }],
      ["A09 fields under the required count", { "sc06-a09-fields-present": 3 }],
      ["no index refused, so nothing explored", { "sc06-variation-refused": 0 }],
      ["no index resolved, so nothing was frozen", { "sc06-variation-resolved": 0 }],
      ["refusal kinds collapsed", { "sc06-distinct-refusals": 1 }],
      ["seed is not a digest", { "sc06-frozen-seed": String(Date.now()) }],
    ] as const) {
      const report = goodReport();
      const observations = MEASURED_OBSERVATIONS().map((entry) => {
        const replacement = (patch as Record<string, unknown>)[String(entry["observationId"])];
        return replacement === undefined ? entry : { ...entry, value: replacement };
      });
      report["observations"] = observations;
      const result = verify(report);
      expect(result.ok, label).toBe(false);
    }
  });

  it("(22) an omitted required observation fails even when every check claims satisfied", () => {
    const report = goodReport();
    report["observations"] = MEASURED_OBSERVATIONS().filter(
      (entry) => entry["observationId"] !== "sc06-reproduction-offset",
    );
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/omit required id sc06-reproduction-offset/u);
  });

  it("(23) a frozen command that did not exit zero fails", () => {
    const report = goodReport();
    (report["execution"] as Record<string, unknown> & { commands: Array<Record<string, unknown>> })
      .commands[0]!["exitCode"] = 1;
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/did not exit zero/u);
  });

  it("(24) recomputeAcceptanceLimits accepts the measured stream, so the clauses above are decisive", () => {
    // The known-good column for clause (21). Without it, a recomputation that rejected EVERY stream
    // would make all six of those cases pass while proving nothing.
    expect(recomputeAcceptanceLimits(MEASURED_OBSERVATIONS())).toEqual([]);
  });

  it("(25) a BINARY input is hashed as bytes, not decoded as text first", () => {
    // THE DEFECT THIS CARD'S OWN VERIFIER SHIPPED AND ITS OWN CLI CAUGHT. `readSource` returned
    // `readFileSync(path, "utf8")`, so every one of the four selected humanoid GLBs hashed to a
    // digest of its UTF-8 REPLACEMENT CHARACTERS rather than of the file. Measured on the physician
    // body: `4a6d8a78…` from real bytes, `2c483a01…` through the text reader. A verifier that cannot
    // hash a binary input cannot certify one, and those four bodies are the inputs this card's
    // invalidation claim rests on.
    //
    // The fixture is a byte sequence that is NOT valid UTF-8, so a reader that decodes before hashing
    // gets a different digest and this clause fails.
    const binary = Buffer.from([0x67, 0x6c, 0x54, 0x46, 0xff, 0xfe, 0x00, 0x80, 0x81, 0x82]);
    // The guard on the fixture itself: a UTF-8 round trip must LOSE information, or this clause
    // would pass under a text reader too. (Character COUNT is not the test — U+FFFD is one character
    // per bad byte — so compare the re-encoded bytes.)
    expect(sha256Hex(Buffer.from(binary.toString("utf8"), "utf8"))).not.toBe(sha256Hex(binary));

    const report = goodReport();
    (report["implementation"] as Record<string, unknown>)["inputs"] = [
      { path: "tools/openclinxr/factory/scene-closure-case-source.ts", sha256: sha256Hex(CASE_SOURCE) },
      { path: "packages/openclinxr/asset-registry/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
      { path: "packages/openclinxr/scenario-runtime/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
      { path: "apps/ui-xr/public/generated-humanoids/body.glb", sha256: sha256Hex(binary) },
    ];
    (report["implementation"] as Record<string, unknown>)["changedFiles"] = [
      "packages/openclinxr/asset-registry/a.ts",
      "packages/openclinxr/scenario-runtime/a.ts",
    ];
    const result = verifyReport({
      report,
      suppliedScopes: [...SC06_FROZEN_SCOPES],
      registry: REGISTRY,
      registrySha256: REGISTRY_SHA,
      reader: readerFor(OBJECTS),
      contractDocuments: CONTRACT_DOCUMENTS,
      sourceReader: (repoRelativePath) => {
        if (repoRelativePath === "apps/ui-xr/public/generated-humanoids/body.glb") return binary;
        const source = SOURCE_TREE[repoRelativePath];
        return source === undefined
          ? new Error(`ENOENT ${repoRelativePath}`)
          : Buffer.from(source, "utf8");
      },
    });
    expect(result.ok, result.ok ? "" : result.problems.join("\n")).toBe(true);
  });
});
