import { describe, expect, it } from "vitest";
import { SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION } from "./report-schema.js";
import { parseArgs } from "./verify.js";
import {
  auditScopes,
  type EvidenceRegistry,
  type IndependentResearchFacts,
  type ObjectReader,
  resolveArtifactPath,
  SC10_FROZEN_SCOPES,
  SC10_REQUIRED_CHECK_IDS,
  SC10_REQUIRED_CONTROL_IDS,
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

/** The eight dimensions SC-10's screening engine returns, with the outcomes the good report claims. */
const INDEPENDENT_DIMENSIONS = [
  { id: "candidate-identity", outcome: "eligible" },
  { id: "pinned-revisions", outcome: "eligible" },
  { id: "skeleton-mapping", outcome: "eligible" },
  { id: "documentation-divergence", outcome: "eligible" },
  { id: "body-and-encoder-terms", outcome: "blocked" },
  { id: "training-data-rights", outcome: "unresolved" },
  { id: "output-terms", outcome: "eligible" },
  { id: "local-execution", outcome: "blocked" },
] as const;

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
    cardKey: "SC-10",
    contract: {
      pinnedCommit: "c3f3f3007dc95f85aa6f4dd710c8da5205d03f50",
      documents: [...CONTRACT_DOCUMENTS].map(([path, sha256]) => ({ path, sha256 })),
      aRows: ["A13"],
    },
    implementation: {
      productSourceCommit: "1111111",
      dependencyBaselineCommit: "0000000",
      changeCommits: ["1111111"],
      treeClean: true,
      inputs: [{ path: "tools/openclinxr/factory/scene-closure-case-source.ts", sha256: "eee" }],
      changedFiles: ["tools/openclinxr/evidence/scene-closure-research/a.ts","tools/openclinxr/evidence/scene-closure/proofs/sc-10/a.ts"],
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
      testIds: ["SC-10-required-behavior"],
      baselineRevision: "0000000",
      failingAssertion: "loaded bundle scenarioId equals the persisted case id",
      observedBeforeFix: "ed_chest_pain_priority_v1",
      knownGoodControl: "ward_delirium_med_rec_v1 still resolves from the fixture bank",
      fixedRevision: "1111111",
      observedAfterFix: "scene_closure_supine_bedside_v1",
      baselineOutputArtifactId: "baseline-output",
      fixedOutputArtifactId: "fixed-output",
    },
    encounter: {
      candidate: "nvidia/Kimodo-SOMA (nv-tlabs/kimodo)",
      verdict: "held",
      holdReasons: ["body-and-encoder-terms (blocked): base model is gated"],
      nextUnblock: "Owner decision on the gated encoder licence, then a CUDA host.",
      dimensions: INDEPENDENT_DIMENSIONS.map((entry) => ({ ...entry })),
    },
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
    checks: SC10_REQUIRED_CHECK_IDS.map((checkId) => ({
      checkId,
      expected: "contract predicate",
      observed: "observed value",
      outcome: "satisfied",
      evidenceIds: ["obs-loaded-scenario"],
    })),
    controls: SC10_REQUIRED_CONTROL_IDS.map((controlId) => ({
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
        objectKey: "sc-10/observations.jsonl",
        byteCount: ARTIFACT_BYTES.byteLength,
        sha256: ARTIFACT_SHA,
        mediaType: "application/x-ndjson",
        createdAtIso: "2026-09-09T18:00:00.000Z",
        runId: "run-1",
      },
      {
        artifactId: "baseline-output",
        storeAlias: "sc-evidence",
        objectKey: "sc-10/baseline.txt",
        byteCount: BASELINE_BYTES.byteLength,
        sha256: sha256Hex(BASELINE_BYTES),
        mediaType: "text/plain",
        createdAtIso: "2026-09-09T17:00:00.000Z",
        runId: "run-0",
      },
      {
        artifactId: "fixed-output",
        storeAlias: "sc-evidence",
        objectKey: "sc-10/fixed.txt",
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
  "/store/sc-10/observations.jsonl": ARTIFACT_BYTES,
  "/store/sc-10/baseline.txt": BASELINE_BYTES,
  "/store/sc-10/fixed.txt": FIXED_BYTES,
};

/**
 * A recomputation that agrees with `goodReport()`.
 *
 * In production this comes from `screenCandidate` over bytes pulled from the owner store. Here it
 * is a fixture, which is the one place the proof contract allows one — and note that every test
 * below that varies the REPORT holds this constant, so a disagreement between the two is what the
 * assertion sees.
 */
function independentFacts(): IndependentResearchFacts {
  return {
    verdict: "held",
    dimensionOutcomes: INDEPENDENT_DIMENSIONS.map((entry) => ({ id: entry.id, outcome: entry.outcome })),
    holdReasons: ["body-and-encoder-terms (blocked): base model is gated"],
    nextUnblock: "Owner decision on the gated encoder licence, then a CUDA host.",
    qualifyingInferenceObservationCount: 0,
    sourceProblems: [],
    retrievedSourceIds: ["soma-rp-model-card", "soma-rp-checkpoint-config", "kimodo-skeleton-definitions"],
    skeletonMappingInspected: true,
    documentationDivergenceResolution: "resolved",
  };
}

function verify(
  report: Record<string, unknown>,
  objects: Record<string, Buffer> = OBJECTS,
  links: Record<string, string> = {},
  independent: IndependentResearchFacts | Error = independentFacts(),
) {
  return verifyReport({
    report,
    suppliedScopes: [...SC10_FROZEN_SCOPES],
    registry: REGISTRY,
    registrySha256: REGISTRY_SHA,
    reader: readerFor(objects, links),
    contractDocuments: CONTRACT_DOCUMENTS,
    independent,
  });
}

describe("the SC-10 evidence verifier accepts a complete control and rejects everything else", () => {
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
      "/store/sc-10/observations.jsonl": Buffer.from("tampered\n"),
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
    const links = { "/store/sc-10/observations.jsonl": "/elsewhere/observations.jsonl" };
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
      suppliedScopes: [...SC10_FROZEN_SCOPES],
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

  it("(13b) a changed file outside every frozen scope is rejected, and an empty list is too", () => {
    // The argument audit checks what the CLI was TOLD; this checks what the task actually changed.
    // Only the second catches an edit in a package the card never claimed.
    const outside = goodReport();
    (outside["implementation"] as Record<string, unknown>)["changedFiles"] = [
      "tools/openclinxr/evidence/scene-closure-research/a.ts",
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
    expect(auditScopes(SC10_FROZEN_SCOPES)).toEqual([]);
    expect(auditScopes(SC10_FROZEN_SCOPES.slice(1))).toContain(`omitted --scope ${SC10_FROZEN_SCOPES[0]}`);
    expect(auditScopes([...SC10_FROZEN_SCOPES, "packages/openclinxr/telemetry"]))
      .toContain("extra --scope packages/openclinxr/telemetry");
    expect(auditScopes([...SC10_FROZEN_SCOPES, SC10_FROZEN_SCOPES[0]!]).join("\n")).toMatch(/duplicate/u);
  });

  // ----------------------------------------------------------------- SC-10 verdict controls
  //
  // Everything above grades report SHAPE, and the recorded baseline control shows that shape alone
  // passed a fabricated `executed`. These four groups grade the CLAIM.

  it("(16) WRONG RUN: a verdict the recomputed evidence contradicts is rejected", () => {
    const report = goodReport();
    (report["encounter"] as Record<string, unknown>)["verdict"] = "executed";
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toContain('recomputes to "held"');
  });

  it("(17) `executed` without a motion-inference observation is rejected", () => {
    const report = goodReport();
    (report["encounter"] as Record<string, unknown>)["verdict"] = "executed";
    // The recomputation agrees it is executed, but nothing was actually inferred. A text-encoder
    // offload and an install probe both leave this counter at zero, which is the point.
    const result = verify(report, OBJECTS, {}, {
      ...independentFacts(),
      verdict: "executed",
      holdReasons: [],
      nextUnblock: "",
      qualifyingInferenceObservationCount: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toContain("zero motion-inference observations");
  });

  it("(18) a non-executed verdict may not name a comparison baseline", () => {
    const report = goodReport();
    (report["encounter"] as Record<string, unknown>)["comparisonBaseline"] = "SC-06";
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toContain("comparison that did not run cannot name a baseline");
  });

  it("(19) a HOLD with no reason or no next unblock is not a completed assessment", () => {
    const withoutReasons = goodReport();
    (withoutReasons["encounter"] as Record<string, unknown>)["holdReasons"] = [];
    const a = verify(withoutReasons);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.problems.join("\n")).toContain("holdReasons lists 0 reason(s)");

    const withoutNext = goodReport();
    (withoutNext["encounter"] as Record<string, unknown>)["nextUnblock"] = "   ";
    const b = verify(withoutNext);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.problems.join("\n")).toContain("encounter.nextUnblock is empty");

    // And a recomputation that produced no reason cannot be dressed up by the report either.
    const c = verify(goodReport(), OBJECTS, {}, { ...independentFacts(), holdReasons: [] });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.problems.join("\n")).toContain("no hold reason");
  });

  it("(20) MALFORMED: an absent or failed recomputation refuses instead of throwing", () => {
    const missing = verifyReport({
      report: goodReport(),
      suppliedScopes: [...SC10_FROZEN_SCOPES],
      registry: REGISTRY,
      registrySha256: REGISTRY_SHA,
      reader: readerFor(OBJECTS),
      contractDocuments: CONTRACT_DOCUMENTS,
      independent: undefined as unknown as IndependentResearchFacts,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.problems.join("\n")).toContain("no independent research recomputation");

    const failed = verify(goodReport(), OBJECTS, {}, new Error("registry unreadable"));
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.problems.join("\n")).toContain("registry unreadable");
  });

  it("(21) CORRUPT: a source that changed since retrieval invalidates the screening", () => {
    const result = verify(goodReport(), OBJECTS, {}, {
      ...independentFacts(),
      sourceProblems: ["soma-rp-model-card bytes changed since retrieval"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toContain("bytes changed since retrieval");

    const empty = verify(goodReport(), OBJECTS, {}, { ...independentFacts(), retrievedSourceIds: [] });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.problems.join("\n")).toContain("nothing was screened");
  });

  it("(22) an uninspected skeleton and an unresolved divergence each block a confident verdict", () => {
    const uninspected = verify(goodReport(), OBJECTS, {}, {
      ...independentFacts(),
      skeletonMappingInspected: false,
    });
    expect(uninspected.ok).toBe(false);
    if (!uninspected.ok) expect(uninspected.problems.join("\n")).toContain("was not inspected");

    // Unresolved divergence is compatible with `held` — the honest state — and with nothing else.
    const stillHeld = verify(goodReport(), OBJECTS, {}, {
      ...independentFacts(),
      documentationDivergenceResolution: "unresolved",
    });
    expect(stillHeld.ok).toBe(true);

    const screenedReport = goodReport();
    const encounter = screenedReport["encounter"] as Record<string, unknown>;
    encounter["verdict"] = "screened";
    encounter["holdReasons"] = [];
    encounter["nextUnblock"] = "compare against SC-06";
    const asserted = verify(screenedReport, OBJECTS, {}, {
      ...independentFacts(),
      verdict: "screened",
      holdReasons: [],
      documentationDivergenceResolution: "unresolved",
    });
    expect(asserted.ok).toBe(false);
    if (!asserted.ok) expect(asserted.problems.join("\n")).toContain("no verdict other than held");
  });

  it("(23) a performance number recorded while nothing was inferred is rejected", () => {
    const report = goodReport();
    (report["observations"] as unknown[]).push({
      observationId: "obs-latency",
      metric: "motion generation latency",
      unit: "ms",
      value: 4200,
      observedAtMs: 2,
      source: "claimed",
    });
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toContain("while no motion inference was performed");
  });

  it("(24) a reported dimension table that disagrees with the recomputed one fails", () => {
    const report = goodReport();
    const dimensions = (report["encounter"] as Record<string, unknown>)["dimensions"] as Array<
      Record<string, unknown>
    >;
    const encoder = dimensions.find((entry) => entry["id"] === "body-and-encoder-terms");
    if (encoder) encoder["outcome"] = "eligible";
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toContain("body-and-encoder-terms is reported eligible");
  });

  it("(25) a report that simply OMITS a dimension is caught by the count, not by the outcomes", () => {
    // Found by the two-sided gate: reverting the count check alone broke no test, because every
    // other assertion here varies an outcome and the per-entry loop only walks entries that are
    // PRESENT. Dropping the blocking dimension is the cheapest way to make a HOLD look clean, and
    // until this test existed only the count clause stood between a report and that edit.
    const report = goodReport();
    const encounter = report["encounter"] as Record<string, unknown>;
    const dimensions = encounter["dimensions"] as Array<Record<string, unknown>>;
    encounter["dimensions"] = dimensions.filter((entry) => entry["id"] !== "body-and-encoder-terms");
    const result = verify(report);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toContain("has 7 entries but 8 were recomputed");
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
