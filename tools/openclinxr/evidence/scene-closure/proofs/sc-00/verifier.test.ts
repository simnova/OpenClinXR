import { describe, expect, it } from "vitest";
import {
  type MotionMeasurement,
  REQUIRED_RUBRIC_METRICS,
  type RubricMetric,
  SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION,
} from "./measurement-rubric.js";
import { SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION } from "./report-schema.js";
import { parseArgs } from "./verify.js";
import {
  auditScopes,
  type EvidenceRegistry,
  type ObjectReader,
  recomputeControlOutcomes,
  resolveArtifactPath,
  SC00_CONTROLS_ARTIFACT_ID,
  SC00_FROZEN_SCOPES,
  SC00_REQUIRED_CHECK_IDS,
  SC00_REQUIRED_CONTROL_IDS,
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

/**
 * A synthetic measurement that grades clean, and the damaged variants the verifier must re-derive.
 *
 * These are pure numbers, not decoded assets: the point here is the verifier's RECOMPUTATION path,
 * not the rubric's arithmetic, which the named behaviour test exercises on real shipped bytes.
 */
function syntheticGoodMeasurement(): MotionMeasurement {
  const track = (joint: string) => ({
    joint,
    samples: [0, 40, 80, 120, 160].map((atMs) => ({ atMs, position: { x: 0.2, y: 0.01, z: -0.3 } })),
  });
  return {
    measurementId: "synthetic-good",
    runId: "run-1",
    actorId: "actor-1",
    skinnedBodyCount: 1,
    skinnedVertexSampleCount: 100,
    clipDeclaredPlayed: false,
    clipName: "idle",
    groundAdvanceMetersPerSecond: 0,
    forward: { x: 0, z: -1 },
    floor: { frameId: "flat", originY: 0, normal: { x: 0, y: 1, z: 0 } },
    support: {
      instanceId: "support-1",
      bounds: { min: { x: -1, y: 0, z: -0.5 }, max: { x: 1, y: 0.5, z: 0.5 } },
      basis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    },
    supportedContactSamples: [-0.5, 0, 0.5].map((x, index) => ({ atMs: index * 40, position: { x, y: 0.5, z: 0 } })),
    contactTracks: [track("toe.L"), track("toe.R")],
    boneLengthSeries: [{ bone: "lowerleg.L", lengthsMeters: [0.4, 0.4, 0.4, 0.4, 0.4] }],
    route: { waypoints: [{ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 0 }], sampleSpacingMeters: 0.35, obstacles: [] },
    arrival: { errorMeters: 0.01 },
    settled: { yawErrorDegrees: 1, observedSeconds: 2.5, rootTravelMeters: 0.001 },
  };
}

function damage(mutate: (measurement: MotionMeasurement) => void): MotionMeasurement {
  const copy = JSON.parse(JSON.stringify(syntheticGoodMeasurement())) as MotionMeasurement;
  mutate(copy);
  return copy;
}

/** One damaged measurement per rubric metric, so every threshold has a probe. */
const SYNTHETIC_DAMAGE: Record<string, { metric: RubricMetric; kind: "fail" | "refuse"; mutate: (m: MotionMeasurement) => void }> = {
  "sliding-foot-fails": { metric: "foot-slide", kind: "fail", mutate: (m) => { for (const t of m.contactTracks) t.samples.forEach((s, i) => { s.position.x += i * 0.05; }); } },
  "single-frame-pop-fails": { metric: "foot-slide", kind: "fail", mutate: (m) => { for (const t of m.contactTracks) t.samples.forEach((s, i) => { if (i >= 3) s.position.x += 0.01; }); } },
  "penetrating-foot-fails": { metric: "floor-penetration", kind: "fail", mutate: (m) => { for (const t of m.contactTracks) for (const s of t.samples) s.position.y -= 0.3; } },
  "missing-contact-windows-fails": { metric: "signed-floor-contact", kind: "fail", mutate: (m) => { for (const t of m.contactTracks) for (const s of t.samples) s.position.y += 0.5; } },
  "zero-skinned-samples-fails": { metric: "skinned-body-presence", kind: "fail", mutate: (m) => { m.skinnedBodyCount = 0; m.skinnedVertexSampleCount = 0; } },
  "absent-actor-fails": { metric: "actor-presence", kind: "fail", mutate: (m) => { m.actorId = ""; } },
  "thin-obstacle-between-waypoints-fails": { metric: "swept-collision", kind: "fail", mutate: (m) => { m.route?.obstacles.push({ id: "pole", bounds: { min: { x: 0.28, y: 0, z: 0.8 }, max: { x: 0.33, y: 1.6, z: 0.85 } } }); } },
  "wrong-support-frame-fails": { metric: "support-frame-identity", kind: "fail", mutate: (m) => { if (m.support) m.support.bounds = { min: { x: 5, y: 0.45, z: 5 }, max: { x: 6, y: 0.5, z: 6 } }; } },
  "clip-flag-without-motion-fails": { metric: "clip-motion-observed", kind: "fail", mutate: (m) => { m.clipDeclaredPlayed = true; } },
  "unsupported-floor-geometry-refuses": { metric: "floor-frame-supported", kind: "refuse", mutate: (m) => { m.floor = { frameId: "ramp", originY: 0, normal: { x: 0, y: 0.9, z: 0.44 } }; } },
  "too-few-samples-fails": { metric: "sample-sufficiency", kind: "fail", mutate: (m) => { for (const t of m.contactTracks) t.samples = t.samples.slice(0, 2); } },
  "nonmonotonic-times-fail": { metric: "timestamp-monotonicity", kind: "fail", mutate: (m) => { const t = m.contactTracks[0]; if (t?.samples[2] && t.samples[1]) t.samples[2].atMs = t.samples[1].atMs - 10; } },
  "dropped-frame-gap-fails": { metric: "timestamp-monotonicity", kind: "fail", mutate: (m) => { const t = m.contactTracks[0]; if (t?.samples[4]) t.samples[4].atMs = 900; } },
  "body-floating-above-support-fails": { metric: "support-contact", kind: "fail", mutate: (m) => { for (const s of m.supportedContactSamples ?? []) s.position.y += 0.04; } },
  "body-sunk-into-support-fails": { metric: "support-penetration", kind: "fail", mutate: (m) => { for (const s of m.supportedContactSamples ?? []) s.position.y -= 0.06; } },
  "deformed-limb-fails": { metric: "limb-integrity", kind: "fail", mutate: (m) => { const s = m.boneLengthSeries[0]; if (s) s.lengthsMeters = [0.4, 0.41, 0.42, 0.43, 0.44]; } },
  "arrival-error-over-cap-fails": { metric: "arrival-error", kind: "fail", mutate: (m) => { m.arrival = { errorMeters: 0.14 }; } },
  "settled-yaw-over-cap-fails": { metric: "settled-heading", kind: "fail", mutate: (m) => { if (m.settled) m.settled.yawErrorDegrees = 27; } },
  "root-resumes-travel-fails": { metric: "stopped-observation", kind: "fail", mutate: (m) => { if (m.settled) m.settled.rootTravelMeters = 0.031; } },
  "shipped-walk-formal-fails-foot-slide": { metric: "foot-slide", kind: "fail", mutate: (m) => { m.clipDeclaredPlayed = true; for (const t of m.contactTracks) t.samples.forEach((s, i) => { s.position.z -= i * 0.08; s.position.x += i * 0.02; }); } },
};

function controlsDocument(): Record<string, unknown> {
  const controls: Array<Record<string, unknown>> = [
    { controlId: "known-good-support-passes", trigger: "unmodified", expectation: { kind: "pass" }, measurement: syntheticGoodMeasurement() },
    { controlId: "deleting-a-metric-fails-rather-than-evades", trigger: "a finding removed", expectation: { kind: "coverage", dropMetric: "foot-slide" }, measurement: syntheticGoodMeasurement() },
  ];
  for (const [controlId, entry] of Object.entries(SYNTHETIC_DAMAGE)) {
    controls.push({
      controlId,
      trigger: "synthetic damage",
      expectation: { kind: entry.kind, metric: entry.metric },
      measurement: damage(entry.mutate),
    });
  }
  return {
    schemaVersion: "openclinxr.sc-00-rubric-controls.v1",
    rubricVersion: SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION,
    runId: "run-1",
    controls,
  };
}

const CONTROLS_BYTES = Buffer.from(`${JSON.stringify(controlsDocument(), null, 2)}\n`);

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
      changedFiles: ["tools/openclinxr/evidence/scene-closure/proofs/sc-00/a.ts","tools/openclinxr/evidence/scene-closure/the-measurement-rubric-rejects-broken-controls.test.ts"],
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
      {
        artifactId: SC00_CONTROLS_ARTIFACT_ID,
        storeAlias: "sc-evidence",
        objectKey: "sc-00/rubric-controls.json",
        byteCount: CONTROLS_BYTES.byteLength,
        sha256: sha256Hex(CONTROLS_BYTES),
        mediaType: "application/json",
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
  "/store/sc-00/rubric-controls.json": CONTROLS_BYTES,
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

  it("(13b) a changed file outside every frozen scope is rejected, and an empty list is too", () => {
    // The argument audit checks what the CLI was TOLD; this checks what the task actually changed.
    // Only the second catches an edit in a package the card never claimed.
    const outside = goodReport();
    (outside["implementation"] as Record<string, unknown>)["changedFiles"] = [
      "tools/openclinxr/evidence/scene-closure/proofs/sc-00/a.ts",
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

  it("(16) MALFORMED: a report that is not an object, or carries the wrong schema or card, fails", () => {
    expect(verify([] as unknown as Record<string, unknown>).ok).toBe(false);
    expect(verify("not a report" as unknown as Record<string, unknown>)).toMatchObject({
      problems: ["report is not a JSON object"],
    });
    const wrongSchema = { ...goodReport(), schemaVersion: "openclinxr.scene-closure-evidence.v99" };
    expect(verify(wrongSchema)).toMatchObject({ problems: expect.arrayContaining([expect.stringContaining("unsupported schemaVersion")]) });
    const wrongCard = { ...goodReport(), cardKey: "SC-05" };
    expect(verify(wrongCard)).toMatchObject({ problems: expect.arrayContaining([expect.stringContaining("wrong cardKey SC-05")]) });
  });

  it("(17) WRONG-RUN: evidence from another run is refused even though every hash resolves", () => {
    const report = goodReport();
    const artifacts = report["artifacts"] as Array<Record<string, unknown>>;
    // The observation stream is from run-0 while the card's measurement run is run-1. Every byte
    // still resolves and rehashes; only the run identity is wrong.
    const stream = artifacts.find((artifact) => artifact["artifactId"] === "run-observations");
    expect(stream).toBeDefined();
    if (stream !== undefined) stream["runId"] = "run-0";
    const result = verify(report);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      problems: expect.arrayContaining([expect.stringContaining("from run run-0, not the measurement run run-1")]),
    });
  });

  it("(18) the baseline exemption covers ONLY the declared baseline artifact", () => {
    const permitted = goodReport();
    const controls = permitted["controls"] as Array<Record<string, unknown>>;
    const first = controls[0];
    expect(first).toBeDefined();
    // Citing the DECLARED baseline output is legitimate: a control that held on both revisions.
    if (first !== undefined) first["evidenceIds"] = ["baseline-output", "run-observations"];
    expect(verify(permitted).ok).toBe(true);

    // The exemption also follows an OBSERVATION to the declared baseline artifact, because a
    // before-state fact is normally cited that way rather than as the raw log.
    const viaObservation = goodReport();
    const observations = viaObservation["observations"] as Array<Record<string, unknown>>;
    observations.push({
      observationId: "obs-baseline-behaviour",
      metric: "baseline instrument output",
      unit: "report",
      value: "graded a submerged foot as a stance",
      observedAtMs: 0,
      artifactId: "baseline-output",
      source: "the unchanged baseline",
    });
    const viaControls = viaObservation["controls"] as Array<Record<string, unknown>>;
    const cited = viaControls[1];
    if (cited !== undefined) cited["evidenceIds"] = ["obs-baseline-behaviour"];
    expect(verify(viaObservation).ok).toBe(true);

    // A second run-0 artifact that the counterweight does not name is not exempt.
    const refused = goodReport();
    const artifacts = refused["artifacts"] as Array<Record<string, unknown>>;
    artifacts.push({
      artifactId: "stale-extra",
      storeAlias: "sc-evidence",
      objectKey: "sc-00/baseline.txt",
      byteCount: BASELINE_BYTES.byteLength,
      sha256: sha256Hex(BASELINE_BYTES),
      mediaType: "text/plain",
      createdAtIso: "2026-09-09T17:00:00.000Z",
      runId: "run-0",
    });
    const refusedControls = refused["controls"] as Array<Record<string, unknown>>;
    const target = refusedControls[0];
    if (target !== undefined) target["evidenceIds"] = ["stale-extra"];
    expect(verify(refused)).toMatchObject({
      problems: expect.arrayContaining([expect.stringContaining("leans on evidence stale-extra from run run-0")]),
    });
  });

  it("(19) RECOMPUTED: a report-authored held flag cannot outvote the measurement behind it", () => {
    // The oracle may not accept its own pre-filled success flag. Every artifact still resolves and
    // every hash still matches; only the MEASUREMENT contradicts the claim.
    const report = goodReport();
    const controls = report["controls"] as Array<Record<string, unknown>>;
    const sliding = controls.find((control) => control["controlId"] === "sliding-foot-fails");
    expect(sliding).toBeDefined();
    if (sliding !== undefined) sliding["held"] = false;
    expect(verify(report)).toMatchObject({
      problems: expect.arrayContaining([expect.stringContaining("report claims control sliding-foot-fails held=false but the recomputed rubric says true")]),
    });

    // And the other direction: a control the report says held, whose measurement is undamaged.
    const document = controlsDocument();
    const entries = document["controls"] as Array<Record<string, unknown>>;
    const penetrating = entries.find((entry) => entry["controlId"] === "penetrating-foot-fails");
    if (penetrating !== undefined) penetrating["measurement"] = syntheticGoodMeasurement();
    const problems = recomputeControlOutcomes(
      Buffer.from(JSON.stringify(document)),
      SC00_REQUIRED_CONTROL_IDS.map((controlId) => ({ controlId, held: true })),
    );
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining("recorded control penetrating-foot-fails does not behave as declared")]),
    );
  });

  it("(20) CORRUPT: a missing, unparseable, stale-rubric or incomplete controls artifact each fails", () => {
    expect(recomputeControlOutcomes(undefined, [])).toEqual([
      "artifact rubric-controls is not declared, so no control outcome could be recomputed",
    ]);
    expect(recomputeControlOutcomes(Buffer.from("{not json"), [])).toMatchObject([
      expect.stringContaining("is not readable JSON"),
    ]);

    const staleRubric = { ...controlsDocument(), rubricVersion: "openclinxr.scene-closure-measurement-rubric.v0" };
    expect(recomputeControlOutcomes(Buffer.from(JSON.stringify(staleRubric)), SC00_REQUIRED_CONTROL_IDS.map((controlId) => ({ controlId, held: true })))).toMatchObject(
      expect.arrayContaining([expect.stringContaining("graded under rubric openclinxr.scene-closure-measurement-rubric.v0")]),
    );

    // Dropping one control from the artifact must be refused, not silently a shorter list. And so
    // must dropping the only control that probes a metric — a threshold nobody probed is not frozen.
    const short = controlsDocument();
    short["controls"] = (short["controls"] as Array<Record<string, unknown>>).filter(
      (entry) => entry["controlId"] !== "deformed-limb-fails",
    );
    const problems = recomputeControlOutcomes(
      Buffer.from(JSON.stringify(short)),
      SC00_REQUIRED_CONTROL_IDS.map((controlId) => ({ controlId, held: true })),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "no measurement was recorded for required control deformed-limb-fails",
        "no recorded control exercises the limb-integrity threshold",
      ]),
    );

    // The complete artifact probes every metric the rubric grades.
    const complete = recomputeControlOutcomes(
      CONTROLS_BYTES,
      SC00_REQUIRED_CONTROL_IDS.map((controlId) => ({ controlId, held: true })),
    );
    expect(complete).toEqual([]);
    expect(REQUIRED_RUBRIC_METRICS.length).toBeGreaterThan(0);
  });
});
