import { describe, expect, it } from "vitest";
import {
  BRANCH_DECISION_SPAN_NAME,
  learnerSafeAttributesOmitWithheld,
  persistBranchDecision,
  type BranchDecisionRecord,
} from "./persist.js";

function record(overrides: Partial<BranchDecisionRecord> = {}): BranchDecisionRecord {
  return {
    seedId: "case-seed-ed-chest-pain-v1",
    scenarioId: "ed_chest_pain_priority_v1",
    stationRunId: "run_ed_001",
    policyVersion: "branch-policy-v1",
    fromBranchId: "stem",
    toBranchId: "acs_workup",
    selectedTransitionId: "t_acs_workup",
    evaluatedPredicates: [
      { transitionId: "t_acs_workup", predicateId: "p_ecg", kind: "tag_admitted", result: true },
      { transitionId: "t_watchful", predicateId: "p_reassurance", kind: "tag_admitted", result: false },
    ],
    withheldAlternatives: [
      {
        transitionId: "t_watchful",
        toBranchId: "watchful_waiting",
        hiddenFromLearner: true,
        matched: false,
        reason: "predicates_unsatisfied",
      },
    ],
    environmentCue: { cueId: "monitor_on", kind: "environment", payload: { prop: "cardiac_monitor" } },
    actorCue: {
      cueId: "nurse_alert",
      kind: "actor",
      actorId: "nurse_maria_alvarez_v1",
      payload: { line: "I'll get the ECG." },
    },
    eventPrefixFingerprint: '{"seedId":"case-seed-ed-chest-pain-v1"}',
    claimScope: "deterministic_branch_scheduler",
    notEvidenceFor: ["assessment_validity", "exam_equivalence"],
    ...overrides,
  };
}

describe("branch decision persistence", () => {
  it("persists the full decision record including predicates, selected transition, withheld alternatives, and cues", () => {
    const persisted = persistBranchDecision(record());
    expect(persisted.spanName).toBe(BRANCH_DECISION_SPAN_NAME);
    expect(persisted.record.selectedTransitionId).toBe("t_acs_workup");
    expect(persisted.record.evaluatedPredicates).toHaveLength(2);
    expect(persisted.record.withheldAlternatives[0]?.transitionId).toBe("t_watchful");
    expect(persisted.record.environmentCue.cueId).toBe("monitor_on");
    expect(persisted.record.actorCue.cueId).toBe("nurse_alert");
  });

  it("learner-safe attributes name the taken branch and omit withheld alternatives", () => {
    const persisted = persistBranchDecision(record());
    expect(persisted.learnerSafeAttributes["openclinxr.branch.to"]).toBe("acs_workup");
    expect(persisted.learnerSafeAttributes["openclinxr.branch.selected_transition"]).toBe("t_acs_workup");
    expect(JSON.stringify(persisted.learnerSafeAttributes)).not.toContain("t_watchful");
    expect(JSON.stringify(persisted.learnerSafeAttributes)).not.toContain("watchful_waiting");
    expect(learnerSafeAttributesOmitWithheld(persisted.learnerSafeAttributes)).toBe(true);
  });
});
