import { describe, expect, it } from "vitest";
import { buildEvidenceDebtReport, type EvidenceDebtRecord } from "./find-evidence-debt.js";

describe("evidence debt report builder", () => {
  it("keeps a latest-first priority queue for open evidence debt", () => {
    const report = buildEvidenceDebtReport(2, [
      evidenceDebt({
        id: "evidence-old",
        iteration_id: "iteration-0001",
        iteration_number: 1,
      }),
      evidenceDebt({
        id: "evidence-latest",
        iteration_id: "iteration-0008",
        iteration_number: 8,
      }),
      evidenceDebt({
        id: "evidence-closed-latest",
        iteration_id: "iteration-0008",
        iteration_number: 8,
        status: "closed",
      }),
    ]);

    expect(report.open_debt.map((debt) => debt.id)).toEqual(["evidence-old", "evidence-latest"]);
    expect(report.priority_open_debt.map((debt) => debt.id)).toEqual(["evidence-latest", "evidence-old"]);
  });
});

function evidenceDebt(overrides: Partial<EvidenceDebtRecord>): EvidenceDebtRecord {
  return {
    id: "evidence-debt",
    file: "iterations/iteration-0001/06-leadership-scorecard.json",
    iteration_id: "iteration-0001",
    iteration_number: 1,
    plan_type: "leadership",
    scored_by: "cto",
    owner: "source-librarian",
    summary: "Evidence must be updated.",
    status: "open",
    ...overrides,
  };
}
