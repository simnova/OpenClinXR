import { describe, expect, it } from "vitest";
import {
  buildDeterministicInputLog,
  buildPalpationInputLog,
  runThreeWayCagematch,
} from "../index.js";
import type { ThreeWayCagematchReport } from "../cagematch/three-way.js";

// ---------------------------------------------------------------------------
// Three-way cagematch
// ---------------------------------------------------------------------------
describe("runThreeWayCagematch", () => {
  it("produces a report with all three engines", () => {
    const log = buildDeterministicInputLog(120);
    const report = runThreeWayCagematch(log);

    expect(report.engines).toHaveLength(3);
    expect(report.seed).toBe(42);
    expect(report.tickCount).toBe(121); // 0..120 inclusive

    // Verify all three engineIds are present
    const engineIds = report.engines.map((e) => e.engineId).sort();
    expect(engineIds).toEqual([
      "havok-candidate",
      "jolt-candidate",
      "rapier-candidate",
    ]);
  });

  it("all three engines pass C6 replay equivalence independently", () => {
    const log = buildDeterministicInputLog(120);
    const report = runThreeWayCagematch(log);

    for (const engine of report.engines) {
      expect(engine.replayEquivalence).toBe(true);
    }
  });

  it("all three engines have unique checksums (engine divergence)", () => {
    const log = buildDeterministicInputLog(120);
    const report = runThreeWayCagematch(log);

    const firstChecksums = report.engines.map((e) => e.checksums[0]);
    const uniqueSet = new Set(firstChecksums);
    expect(uniqueSet.size).toBe(3);
  });

  it("verdict declares all three as winners when no engine fails", () => {
    const log = buildDeterministicInputLog(120);
    const report = runThreeWayCagematch(log);

    expect(report.verdict.winners).toHaveLength(3);
    expect(report.verdict.eliminated).toHaveLength(0);
  });

  it("produces a non-empty summary string", () => {
    const log = buildDeterministicInputLog(60);
    const report = runThreeWayCagematch(log);

    expect(report.summary).toBeTruthy();
    expect(report.summary).toContain("Three-way cagematch");
    expect(report.summary).toContain("Winners");
    expect(report.summary).toContain("Engine divergence");
  });

  it("report is JSON-serializable", () => {
    const log = buildDeterministicInputLog(60);
    const report = runThreeWayCagematch(log);

    const json = JSON.stringify(report);
    const parsed = JSON.parse(json) as ThreeWayCagematchReport;

    expect(parsed.engines).toHaveLength(3);
    expect(parsed.verdict.winners).toHaveLength(3);
    expect(parsed.summary).toBeTruthy();
  });

  it("works with palpation scenario log", () => {
    const log = buildPalpationInputLog({
      ticks: 180,
      forcePeak: 0.8,
      sites: [
        {
          quadrant: "abdomen_ruq",
          targetPosition: { x: 0.12, y: 0.58, z: 0.32 },
          forceLevel: 0.3,
        },
      ],
      dwellTicks: 30,
      transitionTicks: 15,
    });

    const report = runThreeWayCagematch(log);

    expect(report.engines).toHaveLength(3);
    for (const engine of report.engines) {
      expect(engine.replayEquivalence).toBe(true);
      expect(engine.checkpointCount).toBeGreaterThan(0);
    }
  });

  it("custom seed produces different checksums but still all pass", () => {
    const log = buildDeterministicInputLog(60);

    const report42 = runThreeWayCagematch(log, 42);
    const report99 = runThreeWayCagematch(log, 99);

    // Different seeds → different checksums
    expect(report42.engines[0]!.checksums[0]).not.toBe(
      report99.engines[0]!.checksums[0],
    );

    // But both should still pass
    expect(report42.verdict.winners).toHaveLength(3);
    expect(report99.verdict.winners).toHaveLength(3);
  });

  it("each engine carries notEvidenceFor in their report (C7)", () => {
    const log = buildDeterministicInputLog(60);
    const report = runThreeWayCagematch(log);

    for (const engine of report.engines) {
      expect(engine.notEvidenceFor).toEqual([
        "clinical_validity",
        "exam_equivalence",
        "scoring",
        "learner_readiness",
      ]);
      expect(engine.licenceClean).toContain("mit_web_only");
      expect(engine.licenceClean).toContain("non_copyleft");
    }
  });

  it("verdict correctly identifies engine divergence in summary", () => {
    const log = buildDeterministicInputLog(60);
    const report = runThreeWayCagematch(log);

    // Engine divergence line should show 3/3
    expect(report.summary).toContain("3/3 distinct first checksums");
  });
});
