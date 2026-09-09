import { describe, expect, it } from "vitest";
import {
  SC00_FROZEN_SCOPES,
  SC00_REQUIRED_CHECK_IDS,
  SC00_REQUIRED_CONTROL_IDS,
  auditScopes,
  resolveArtifactPath,
  sha256Hex,
  verifyReport,
  type EvidenceRegistry,
  type ObjectReader,
} from "./verify-core.js";
import { parseArgs } from "./verify.js";
import { SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION } from "./report-schema.js";

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

const CONTRACT_DOCUMENTS = new Map<string, string>([
  ["docs/openclinxr/scene-closure-2026-09-09/acceptance-v2.md", "aaa"],
  ["docs/openclinxr/scene-closure-2026-09-09/tasks-v2.md", "bbb"],
  ["docs/openclinxr/scene-closure-2026-09-09/proof-contract-v2.md", "ccc"],
  ["docs/openclinxr/scene-closure-2026-09-09/delegation-v2.md", "ddd"],
]);

function goodReport(): Record<string, unknown> {
  return {
    schemaVersion: SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION,
    cardKey: "SC-00",
    contract: {
      pinnedCommit: "c3f3f3007dc95f85aa6f4dd710c8da5205d03f50",
      documents: [...CONTRACT_DOCUMENTS].map(([path, sha256]) => ({ path, sha256 })),
      aRows: ["A08"],
    },
    implementation: {
      productSourceCommit: "1111111",
      dependencyBaselineCommit: "0000000",
      changeCommits: ["1111111"],
      treeClean: true,
      inputs: [{ path: "tools/openclinxr/factory/scene-closure-case-source.ts", sha256: "eee" }],
      runtime: { node: "v24", platform: "darwin-arm64" },
    },
    execution: {
      taskId: "tsk_d4c4e549f076e0a4",
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
      testIds: ["SC-00-required-behavior"],
      baselineRevision: "0000000",
      failingAssertion: "loaded bundle scenarioId equals the persisted case id",
      observedBeforeFix: "ed_chest_pain_priority_v1",
      knownGoodControl: "ward_delirium_med_rec_v1 still resolves from the fixture bank",
      fixedRevision: "1111111",
      observedAfterFix: "scene_closure_supine_bedside_v1",
      baselineOutputArtifactId: "baseline-output",
      fixedOutputArtifactId: "fixed-output",
    },
    encounter: { caseId: "scene_closure_supine_bedside_v1", caseVersion: 2 },
    observations: [
      {
        observationId: "obs-loaded-scenario",
        metric: "loaded bundle scenarioId",
        unit: "identifier",
        value: "scene_closure_supine_bedside_v1",
        observedAtMs: 1,
        artifactId: "run-observations",
        source: "normal main-UI bundle selection",
      },
    ],
    checks: SC00_REQUIRED_CHECK_IDS.map((checkId) => ({
      checkId,
      expected: "contract predicate",
      observed: "observed value",
      outcome: "satisfied",
      evidenceIds: ["obs-loaded-scenario"],
    })),
    controls: SC00_REQUIRED_CONTROL_IDS.map((controlId) => ({
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
        objectKey: "sc-00/observations.jsonl",
        byteCount: ARTIFACT_BYTES.byteLength,
        sha256: ARTIFACT_SHA,
        mediaType: "application/x-ndjson",
        createdAtIso: "2026-09-09T18:00:00.000Z",
        runId: "run-1",
      },
      {
        artifactId: "baseline-output",
        storeAlias: "sc-evidence",
        objectKey: "sc-00/baseline.txt",
        byteCount: BASELINE_BYTES.byteLength,
        sha256: sha256Hex(BASELINE_BYTES),
        mediaType: "text/plain",
        createdAtIso: "2026-09-09T17:00:00.000Z",
        runId: "run-0",
      },
      {
        artifactId: "fixed-output",
        storeAlias: "sc-evidence",
        objectKey: "sc-00/fixed.txt",
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
  "/store/sc-00/observations.jsonl": ARTIFACT_BYTES,
  "/store/sc-00/baseline.txt": BASELINE_BYTES,
  "/store/sc-00/fixed.txt": FIXED_BYTES,
};

function verify(report: Record<string, unknown>, objects: Record<string, Buffer> = OBJECTS, links: Record<string, string> = {}) {
  return verifyReport({
    report,
    suppliedScopes: [...SC00_FROZEN_SCOPES],
    registry: REGISTRY,
    registrySha256: REGISTRY_SHA,
    reader: readerFor(objects, links),
    contractDocuments: CONTRACT_DOCUMENTS,
  });
}

describe("the SC-00 evidence verifier accepts a complete control and rejects everything else", () => {
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
      "/store/sc-00/observations.jsonl": Buffer.from("tampered\n"),
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
    const links = { "/store/sc-00/observations.jsonl": "/elsewhere/observations.jsonl" };
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
      suppliedScopes: [...SC00_FROZEN_SCOPES],
      registry: REGISTRY,
      registrySha256: "f".repeat(64),
      reader: readerFor(OBJECTS),
      contractDocuments: CONTRACT_DOCUMENTS,
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

  it("(14) the scope audit rejects an omitted, extra or duplicated scope", () => {
    expect(auditScopes(SC00_FROZEN_SCOPES)).toEqual([]);
    expect(auditScopes(SC00_FROZEN_SCOPES.slice(1))).toContain(`omitted --scope ${SC00_FROZEN_SCOPES[0]}`);
    expect(auditScopes([...SC00_FROZEN_SCOPES, "packages/openclinxr/telemetry"]))
      .toContain("extra --scope packages/openclinxr/telemetry");
    expect(auditScopes([...SC00_FROZEN_SCOPES, SC00_FROZEN_SCOPES[0]!]).join("\n")).toMatch(/duplicate/u);
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
