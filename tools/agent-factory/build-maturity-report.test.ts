import { describe, expect, it } from "vitest";
import { buildMaturityReport } from "./build-maturity-report.js";
import { scoreWeights, type Scorecard } from "./lib.js";

describe("maturity report builder", () => {
  it("surfaces exact selected blocker ids for the latest iteration", () => {
    const report = buildMaturityReport([
      {
        file: "iterations/iteration-0008/06-leadership-scorecard.json",
        scorecard: scorecard({
          evidence_debt: [
            { id: "evidence-leadership-0008-001", owner: "xr-systems-architect", summary: "Run Quest foreground performance evidence.", status: "open" },
          ],
          decision_debt: [
            { id: "decision-0008-001", owner: "cto", summary: "Choose the XR runtime path.", status: "open" },
          ],
          critical_risks: [
            { id: "risk-0008-001", severity: "high", owner: "platform-devops-lead", summary: "Quest frame pacing is not proven.", status: "open" },
            { id: "risk-0008-002", severity: "medium", owner: "clinical-safety-critic", summary: "Clinical copy needs review.", status: "open" },
          ],
        }),
      },
    ]);

    expect(report.latest_iteration_id).toBe("iteration-0008");
    expect(report.iterations[0]).toMatchObject({
      open_selected_evidence_debt_ids: ["evidence-leadership-0008-001"],
      open_selected_decision_debt_ids: ["decision-0008-001"],
      open_selected_risk_ids: ["risk-0008-001", "risk-0008-002"],
      open_selected_high_or_critical_risk_ids: ["risk-0008-001"],
    });
  });
});

function scorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    iteration_id: "iteration-0008",
    plan_type: "leadership",
    scored_by: "cto",
    scored_at: "2026-05-04T00:00:00.000Z",
    dimensions: Object.fromEntries(
      Object.keys(scoreWeights).map((dimension) => [dimension, { score: 4.8, rationale: "Strong enough for the test fixture." }]),
    ) as Scorecard["dimensions"],
    critical_risks: [],
    evidence_debt: [],
    decision_debt: [],
    confidence: 0.8,
    summary: "Test scorecard.",
    ...overrides,
  };
}
