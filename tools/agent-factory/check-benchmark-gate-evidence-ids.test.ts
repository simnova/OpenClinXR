import { describe, expect, it } from "vitest";
import { buildBenchmarkEvidenceIdReport } from "./check-benchmark-gate-evidence-ids.js";

describe("benchmark gate evidence id checker", () => {
  it("flags benchmark gates that do not map to scorecard evidence debt", () => {
    const report = buildBenchmarkEvidenceIdReport({
      scorecardFiles: [
        {
          file: "iterations/iteration-0009/06-leadership-scorecard.json",
          evidenceDebt: [
            { id: "evidence-leadership-0009-001", status: "open" },
          ],
        },
      ],
      benchmarkGateIds: [
        { evidence_id: "evidence-leadership-0009-001", ready_to_resolve: false },
        { evidence_id: "evidence-leadership-0009-999", ready_to_resolve: false },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.gates_without_scorecard_debt).toEqual(["evidence-leadership-0009-999"]);
  });

  it("flags resolved scorecard debt when its benchmark gate is still blocked", () => {
    const report = buildBenchmarkEvidenceIdReport({
      scorecardFiles: [
        {
          file: "iterations/iteration-0008/06-leadership-scorecard.json",
          evidenceDebt: [
            { id: "evidence-leadership-0008-004", status: "resolved" },
          ],
        },
      ],
      benchmarkGateIds: [
        { evidence_id: "evidence-leadership-0008-004", ready_to_resolve: false },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.resolved_debt_with_unready_gate).toEqual([
      {
        evidence_id: "evidence-leadership-0008-004",
        scorecard_file: "iterations/iteration-0008/06-leadership-scorecard.json",
      },
    ]);
  });

  it("passes when gates map to scorecard debt and resolved debt gates are ready", () => {
    const report = buildBenchmarkEvidenceIdReport({
      scorecardFiles: [
        {
          file: "iterations/iteration-0008/06-leadership-scorecard.json",
          evidenceDebt: [
            { id: "evidence-leadership-0008-004", status: "resolved" },
          ],
        },
        {
          file: "iterations/iteration-0009/06-leadership-scorecard.json",
          evidenceDebt: [
            { id: "evidence-leadership-0009-004", status: "open" },
          ],
        },
      ],
      benchmarkGateIds: [
        { evidence_id: "evidence-leadership-0008-004", ready_to_resolve: true },
        { evidence_id: "evidence-leadership-0009-004", ready_to_resolve: false },
      ],
    });

    expect(report).toMatchObject({
      ok: true,
      gates_without_scorecard_debt: [],
      resolved_debt_with_unready_gate: [],
    });
  });
});
