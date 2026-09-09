import { describe, expect, it } from "vitest";
import { SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION } from "./report-schema.js";
import { parseArgs } from "./verify.js";
import {
  auditScopes,
  type EvidenceRegistry,
  inspectBehaviorTestSource,
  type ObjectReader,
  resolveArtifactPath,
  SC03_BEHAVIOR_TEST_PATH,
  SC03_BEHAVIOR_TEST_TITLE,
  SC03_FROZEN_SCOPES,
  SC03_REQUIRED_CHECK_IDS,
  SC03_REQUIRED_COMMANDS,
  SC03_REQUIRED_CONTROL_IDS,
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

const ARTIFACT_BYTES = Buffer.from(
  `a recorded normal-workflow observation stream\n${SC03_REQUIRED_CHECK_IDS.join("\n")}\n`,
);
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
  'describe("the mounted support controls the posed patient", () => {',
  `  it("${SC03_BEHAVIOR_TEST_TITLE}", async () => { expect(1).toBe(1); });`,
  "});",
  "",
].join("\n");
const CHANGED_SOURCE = "export const x = 1;\n";
const SOURCE_TREE: Record<string, string> = {
  [SC03_BEHAVIOR_TEST_PATH]: BEHAVIOR_TEST_SOURCE,
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
    cardKey: "SC-03",
    contract: {
      pinnedCommit: "c3f3f3007dc95f85aa6f4dd710c8da5205d03f50",
      documents: [...CONTRACT_DOCUMENTS].map(([path, sha256]) => ({ path, sha256 })),
      aRows: ["A04", "A05"],
    },
    implementation: {
      productSourceCommit: "1111111",
      dependencyBaselineCommit: "0000000",
      changeCommits: ["1111111"],
      treeClean: true,
      inputs: [
        { path: SC03_BEHAVIOR_TEST_PATH, sha256: sha256Hex(BEHAVIOR_TEST_SOURCE) },
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
      taskId: "tsk_2d19693a11aed51e",
      runId: "run-1",
      commands: SC03_REQUIRED_COMMANDS.map((command) => ({
        argv: command.split(" "),
        exitCode: 0,
        startedAtIso: "2026-09-09T18:00:00.000Z",
        endedAtIso: "2026-09-09T18:00:20.000Z",
        tests: { passed: 3, failed: 0, skipped: 0, todo: 0 },
      })),
    },
    counterweight: {
      testIds: ["SC-03-required-behavior"],
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
      behaviorTestPath: SC03_BEHAVIOR_TEST_PATH,
      behaviorTestTitle: SC03_BEHAVIOR_TEST_TITLE,
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
    checks: SC03_REQUIRED_CHECK_IDS.map((checkId) => ({
      checkId,
      expected: "contract predicate",
      observed: "observed value",
      outcome: "satisfied",
      evidenceIds: ["obs-loaded-scenario", "run-observations"],
    })),
    controls: SC03_REQUIRED_CONTROL_IDS.map((controlId) => ({
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
        objectKey: "sc-03/observations.jsonl",
        byteCount: ARTIFACT_BYTES.byteLength,
        sha256: ARTIFACT_SHA,
        mediaType: "application/x-ndjson",
        createdAtIso: "2026-09-09T18:00:00.000Z",
        runId: "run-1",
      },
      {
        artifactId: "baseline-output",
        storeAlias: "sc-evidence",
        objectKey: "sc-03/baseline.txt",
        byteCount: BASELINE_BYTES.byteLength,
        sha256: sha256Hex(BASELINE_BYTES),
        mediaType: "text/plain",
        createdAtIso: "2026-09-09T17:00:00.000Z",
        runId: "run-0",
      },
      {
        artifactId: "fixed-output",
        storeAlias: "sc-evidence",
        objectKey: "sc-03/fixed.txt",
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
  "/store/sc-03/observations.jsonl": ARTIFACT_BYTES,
  "/store/sc-03/baseline.txt": BASELINE_BYTES,
  "/store/sc-03/fixed.txt": FIXED_BYTES,
};

function verify(
  report: Record<string, unknown>,
  objects: Record<string, Buffer> = OBJECTS,
  links: Record<string, string> = {},
  tree: Record<string, string> = SOURCE_TREE,
) {
  return verifyReport({
    report,
    suppliedScopes: [...SC03_FROZEN_SCOPES],
    registry: REGISTRY,
    registrySha256: REGISTRY_SHA,
    reader: readerFor(objects, links),
    contractDocuments: CONTRACT_DOCUMENTS,
    sourceReader: sourceReaderFor(tree),
  });
}

describe("the SC-03 evidence verifier accepts a complete control and rejects everything else", () => {
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
      "/store/sc-03/observations.jsonl": Buffer.from("tampered\n"),
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
    const links = { "/store/sc-03/observations.jsonl": "/elsewhere/observations.jsonl" };
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
      suppliedScopes: [...SC03_FROZEN_SCOPES],
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
    expect(auditScopes(SC03_FROZEN_SCOPES)).toEqual([]);
    expect(auditScopes(SC03_FROZEN_SCOPES.slice(1))).toContain(`omitted --scope ${SC03_FROZEN_SCOPES[0]}`);
    expect(auditScopes([...SC03_FROZEN_SCOPES, "packages/openclinxr/telemetry"]))
      .toContain("extra --scope packages/openclinxr/telemetry");
    expect(auditScopes([...SC03_FROZEN_SCOPES, SC03_FROZEN_SCOPES[0]!]).join("\n")).toMatch(/duplicate/u);
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
    expect(inspectBehaviorTestSource(BEHAVIOR_TEST_SOURCE, SC03_BEHAVIOR_TEST_TITLE)).toEqual([]);
    for (const bad of [
      `describe("s", () => { it.skip("${SC03_BEHAVIOR_TEST_TITLE}", () => {}); it("${SC03_BEHAVIOR_TEST_TITLE}", () => {}); });`,
      `describe.skip("s", () => { it("${SC03_BEHAVIOR_TEST_TITLE}", () => {}); });`,
      `// it("${SC03_BEHAVIOR_TEST_TITLE}", () => {});`,
      `/* it("${SC03_BEHAVIOR_TEST_TITLE}", () => {}); */`,
      `describe("s", () => { it.fails("${SC03_BEHAVIOR_TEST_TITLE}", () => {}); });`,
    ]) {
      expect(inspectBehaviorTestSource(bad, SC03_BEHAVIOR_TEST_TITLE).length, bad).toBeGreaterThan(0);
    }
    // And through the whole verifier, with the tree holding a skipped test.
    const tree = {
      ...SOURCE_TREE,
      [SC03_BEHAVIOR_TEST_PATH]: `describe.skip("s", () => { it("${SC03_BEHAVIOR_TEST_TITLE}", () => {}); });`,
    };
    const report = goodReport();
    (report["implementation"] as Record<string, unknown>)["inputs"] = [
      { path: SC03_BEHAVIOR_TEST_PATH, sha256: sha256Hex(tree[SC03_BEHAVIOR_TEST_PATH]!) },
      { path: "packages/openclinxr/shared-schemas/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
      { path: "packages/openclinxr/scenario-runtime/a.ts", sha256: sha256Hex(CHANGED_SOURCE) },
    ];
    expect(verify(report, OBJECTS, {}, tree).ok).toBe(false);
  });

  it("(20) a check citing a real, correctly hashed artifact that never mentions it is refused", () => {
    // The report-authored pass. Every hash resolves and every byte is genuine; the artifact simply
    // says nothing about this check, so the `satisfied` rests on the report's own word.
    const bytes = Buffer.from("an observation stream about something else entirely\n");
    const result = verify(goodReport(), { ...OBJECTS, "/store/sc-03/observations.jsonl": bytes });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The hash check fires too; the clause under test is the mention.
    const report = goodReport();
    (report["artifacts"] as Array<Record<string, unknown>>)[0]!["sha256"] = sha256Hex(bytes);
    (report["artifacts"] as Array<Record<string, unknown>>)[0]!["byteCount"] = bytes.byteLength;
    const mentionOnly = verify(report, { ...OBJECTS, "/store/sc-03/observations.jsonl": bytes });
    expect(mentionOnly.ok).toBe(false);
    if (mentionOnly.ok) return;
    expect(mentionOnly.problems.join("\n")).toMatch(/is not mentioned in the bytes/u);
  });

  it("(21) a changed file with no hashed input entry fails, so the audit cannot skip the change", () => {
    const report = goodReport();
    (report["implementation"] as Record<string, unknown>)["inputs"] = [
      { path: SC03_BEHAVIOR_TEST_PATH, sha256: sha256Hex(BEHAVIOR_TEST_SOURCE) },
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
});
