import { describe, expect, it } from "vitest";
import {
  buildPhysicsCagematchReport,
  type PhysicsCagematchReport,
} from "../index.js";

// ---------------------------------------------------------------------------
// Physics cagematch report
// ---------------------------------------------------------------------------
describe("buildPhysicsCagematchReport", () => {
  it("builds a report with all required fields", () => {
    const report = buildPhysicsCagematchReport({
      engineId: "havok-candidate",
      checksums: [
        "a".repeat(64),
        "b".repeat(64),
      ],
      stepCostMs: [0.12, 0.15, 0.11],
      replayEquivalence: true,
      snapshotSupport: true,
    });

    expect(report.engineId).toBe("havok-candidate");
    expect(report.replayEquivalence).toBe(true);
    expect(report.checkpointCount).toBe(2);
    expect(report.snapshotSupport).toBe(true);
    expect(report.checksums).toHaveLength(2);
    expect(report.stepCostMs).toEqual([0.12, 0.15, 0.11]);
    expect(report.licenceClean).toContain("mit_web_only");
    expect(report.licenceClean).toContain("non_copyleft");
  });

  it("defaults stepCostMs to empty array", () => {
    const report = buildPhysicsCagematchReport({
      engineId: "rapier",
      checksums: ["c".repeat(64)],
      replayEquivalence: false,
      snapshotSupport: false,
    });

    expect(report.stepCostMs).toEqual([]);
  });

  it("carries notEvidenceFor (C7)", () => {
    const report = buildPhysicsCagematchReport({
      engineId: "jolt",
      checksums: [],
      replayEquivalence: false,
      snapshotSupport: false,
    });

    expect(report.notEvidenceFor).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ]);
  });

  it("accepts custom notEvidenceFor", () => {
    const customNef = ["clinical_validity", "exam_equivalence"] as const;
    const report = buildPhysicsCagematchReport({
      engineId: "custom",
      checksums: [],
      replayEquivalence: true,
      snapshotSupport: true,
      notEvidenceFor: customNef,
    });

    expect(report.notEvidenceFor).toEqual(customNef);
  });

  it("produces a plain object (no class instances)", () => {
    const report = buildPhysicsCagematchReport({
      engineId: "havok-candidate",
      checksums: ["d".repeat(64)],
      replayEquivalence: true,
      snapshotSupport: true,
    });

    // Plain object check
    expect(report.constructor).toBe(Object);
    expect(JSON.stringify(report)).toBeTruthy();
  });

  it("supports realistic cagematch use case", () => {
    // Simulating what a cagematch harness would produce
    const checksums = [
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
    ];

    const report: PhysicsCagematchReport = buildPhysicsCagematchReport({
      engineId: "havok-candidate",
      checksums,
      stepCostMs: [0.08, 0.09, 0.08, 0.09, 0.08],
      replayEquivalence: true,
      snapshotSupport: true,
    });

    // The report should be ready for serialization
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json) as PhysicsCagematchReport;

    expect(parsed.engineId).toBe("havok-candidate");
    expect(parsed.replayEquivalence).toBe(true);
    expect(parsed.snapshotSupport).toBe(true);
    expect(parsed.checksums).toEqual(checksums);
    expect(parsed.stepCostMs).toHaveLength(5);
    expect(parsed.licenceClean).toBeDefined();
    expect(parsed.notEvidenceFor).toHaveLength(4);
  });
});
