import { describe, expect, it } from "vitest";
import {
  BRANCH_REPLAY_CLAIM_SCOPE,
  BRANCH_REPLAY_NOT_EVIDENCE_FOR,
  projectFacultyBranchReplay,
  projectLearnerBranchProvenance,
  type BranchDecisionReplayRecord,
} from "./replay.js";

function record(): BranchDecisionReplayRecord {
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
  };
}

describe("branch replay projections", () => {
  it("exposes withheld alternatives and cues to faculty replay", () => {
    const faculty = projectFacultyBranchReplay(record());
    expect(faculty.selectedTransitionId).toBe("t_acs_workup");
    expect(faculty.withheldAlternatives).toEqual([
      expect.objectContaining({ transitionId: "t_watchful", hiddenFromLearner: true }),
    ]);
    expect(faculty.evaluatedPredicates).toHaveLength(2);
    expect(faculty.environmentCue.cueId).toBe("monitor_on");
    expect(faculty.actorCue.cueId).toBe("nurse_alert");
    expect(faculty.claimScope).toBe(BRANCH_REPLAY_CLAIM_SCOPE);
    expect(faculty.notEvidenceFor).toEqual(BRANCH_REPLAY_NOT_EVIDENCE_FOR);
  });

  it("does not reveal hidden alternatives on the learner provenance projection", () => {
    const learner = projectLearnerBranchProvenance(record());
    expect(learner.toBranchId).toBe("acs_workup");
    expect(learner.selectedTransitionId).toBe("t_acs_workup");
    expect(learner.environmentCueId).toBe("monitor_on");
    expect(learner).not.toHaveProperty("withheldAlternatives");
    expect(learner).not.toHaveProperty("evaluatedPredicates");
    expect(JSON.stringify(learner)).not.toContain("t_watchful");
    expect(JSON.stringify(learner)).not.toContain("watchful_waiting");
  });
});
