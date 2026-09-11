import { describe, expect, it } from "vitest";
import {
  BRANCH_SCHEDULER_CLAIM_SCOPE,
  BRANCH_SCHEDULER_NOT_EVIDENCE_FOR,
  composeAdmittedLearnerEventPath,
  evaluateBranchScheduler,
  eventPrefixFingerprint,
  initialBranchState,
  type AdmittedLearnerEvent,
  type FrozenCaseSeed,
} from "./evaluate.js";

const STATION = "run_ed_001";
const POLICY = "branch-policy-v1";
const HIDDEN = "hidden-truth:acs-not-disclosed";

function seed(overrides: Partial<FrozenCaseSeed> = {}): FrozenCaseSeed {
  return {
    seedId: "case-seed-ed-chest-pain-v1",
    scenarioId: "ed_chest_pain_priority_v1",
    stationRunId: STATION,
    caseRevision: "rev-1",
    policyVersion: POLICY,
    initialBranchId: "stem",
    hiddenTruthFingerprint: HIDDEN,
    transitions: [
      {
        transitionId: "t_acs_workup",
        fromBranchId: "stem",
        toBranchId: "acs_workup",
        priority: 1,
        predicates: [
          { predicateId: "p_ecg", kind: "tag_admitted", tag: "ecg_request" },
          { predicateId: "p_order", kind: "event_type_admitted", eventType: "learner.order" },
        ],
        environmentCue: {
          cueId: "monitor_on",
          kind: "environment",
          payload: { prop: "cardiac_monitor" },
        },
        actorCue: {
          cueId: "nurse_alert",
          kind: "actor",
          actorId: "nurse_maria_alvarez_v1",
          payload: { line: "I'll get the ECG." },
        },
        hiddenFromLearner: false,
      },
      {
        transitionId: "t_watchful",
        fromBranchId: "stem",
        toBranchId: "watchful_waiting",
        priority: 2,
        predicates: [{ predicateId: "p_reassurance", kind: "tag_admitted", tag: "reassurance_only" }],
        environmentCue: { cueId: "hold_room", kind: "environment", payload: { prop: "exam_room" } },
        actorCue: {
          cueId: "patient_wait",
          kind: "actor",
          actorId: "patient_robert_hayes_v1",
          payload: { line: "I'll wait." },
        },
        hiddenFromLearner: true,
      },
      {
        transitionId: "t_troponin",
        fromBranchId: "acs_workup",
        toBranchId: "acs_labs",
        priority: 1,
        predicates: [{ predicateId: "p_trop", kind: "tag_admitted", tag: "troponin_order" }],
        environmentCue: { cueId: "lab_draw", kind: "environment", payload: { prop: "phlebotomy_tray" } },
        actorCue: {
          cueId: "nurse_labs",
          kind: "actor",
          actorId: "nurse_maria_alvarez_v1",
          payload: { line: "Labs are drawing." },
        },
        hiddenFromLearner: true,
      },
    ],
    ...overrides,
  };
}

function learnerEvent(overrides: Partial<AdmittedLearnerEvent> & Pick<AdmittedLearnerEvent, "sequence" | "eventType">): AdmittedLearnerEvent {
  const event: AdmittedLearnerEvent = {
    stationRunId: STATION,
    atSecond: overrides.atSecond ?? overrides.sequence * 10,
    source: "learner",
    ...overrides,
  };
  return event;
}

describe("deterministic branch scheduler", () => {
  it("selects the matching stem transition, persists predicates, withheld alternatives, and cues", () => {
    const frozen = seed();
    const events = [
      learnerEvent({ sequence: 3, eventType: "learner.order", tag: "ecg_request", atSecond: 480 }),
    ];
    const result = evaluateBranchScheduler({
      seed: frozen,
      admittedLearnerEvents: events,
      current: initialBranchState(frozen),
      policyVersion: POLICY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.decision.selectedTransitionId).toBe("t_acs_workup");
    expect(result.decision.toBranchId).toBe("acs_workup");
    expect(result.decision.environmentCue.cueId).toBe("monitor_on");
    expect(result.decision.actorCue.cueId).toBe("nurse_alert");
    expect(result.decision.evaluatedPredicates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ predicateId: "p_ecg", result: true }),
        expect.objectContaining({ predicateId: "p_order", result: true }),
        expect.objectContaining({ predicateId: "p_reassurance", result: false }),
      ]),
    );
    expect(result.decision.withheldAlternatives).toEqual([
      {
        transitionId: "t_watchful",
        toBranchId: "watchful_waiting",
        hiddenFromLearner: true,
        matched: false,
        reason: "predicates_unsatisfied",
      },
    ]);
    expect(result.decision.eventPrefixFingerprint).toBe(eventPrefixFingerprint(frozen, events));
    expect(result.decision.claimScope).toBe(BRANCH_SCHEDULER_CLAIM_SCOPE);
    expect(result.decision.notEvidenceFor).toEqual(BRANCH_SCHEDULER_NOT_EVIDENCE_FOR);
    expect(Object.isFrozen(result.decision)).toBe(true);
    expect(result.nextState.hiddenTruthFingerprint).toBe(HIDDEN);
  });

  it("equal seeds and equal event prefixes produce byte-equal composed branches", () => {
    const frozen = seed();
    const prefix = [
      learnerEvent({ sequence: 3, eventType: "learner.order", tag: "ecg_request", atSecond: 480 }),
      learnerEvent({ sequence: 4, eventType: "learner.order", tag: "troponin_order", atSecond: 600 }),
    ];
    const left = composeAdmittedLearnerEventPath({
      seed: frozen,
      policyVersion: POLICY,
      admittedLearnerEvents: prefix,
    });
    const right = composeAdmittedLearnerEventPath({
      seed: seed(),
      policyVersion: POLICY,
      admittedLearnerEvents: prefix.map((event) => ({ ...event })),
    });
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (!left.ok || !right.ok) {
      return;
    }
    expect(JSON.stringify(left.decisions)).toBe(JSON.stringify(right.decisions));
    expect(left.finalState.branchId).toBe("acs_labs");
    expect(left.decisions.map((decision) => decision.selectedTransitionId)).toEqual(["t_acs_workup", "t_troponin"]);
  });

  it("fails closed on reordered, cross-station, stale-policy, and reviewer-only inputs", () => {
    const frozen = seed();
    const current = initialBranchState(frozen);
    const base = learnerEvent({ sequence: 3, eventType: "learner.order", tag: "ecg_request", atSecond: 480 });

    const reordered = evaluateBranchScheduler({
      seed: frozen,
      current,
      policyVersion: POLICY,
      admittedLearnerEvents: [
        learnerEvent({ sequence: 4, eventType: "learner.utterance", atSecond: 500 }),
        base,
      ],
    });
    expect(reordered).toMatchObject({ ok: false, reason: "reordered_events" });

    const crossStation = evaluateBranchScheduler({
      seed: frozen,
      current,
      policyVersion: POLICY,
      admittedLearnerEvents: [{ ...base, stationRunId: "run_other_station" }],
    });
    expect(crossStation).toMatchObject({ ok: false, reason: "cross_station" });

    const stale = evaluateBranchScheduler({
      seed: frozen,
      current,
      policyVersion: "branch-policy-v0",
      admittedLearnerEvents: [base],
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale_policy" });

    const reviewer = evaluateBranchScheduler({
      seed: frozen,
      current,
      policyVersion: POLICY,
      admittedLearnerEvents: [{ ...base, source: "reviewer" }],
    });
    expect(reviewer).toMatchObject({ ok: false, reason: "reviewer_only_input" });
  });

  it("refuses a current state that mutates authored hidden truth", () => {
    const frozen = seed();
    const result = evaluateBranchScheduler({
      seed: frozen,
      policyVersion: POLICY,
      admittedLearnerEvents: [
        learnerEvent({ sequence: 3, eventType: "learner.order", tag: "ecg_request" }),
      ],
      current: { ...initialBranchState(frozen), hiddenTruthFingerprint: "mutated-hidden-truth" },
    });
    expect(result).toMatchObject({ ok: false, reason: "authored_hidden_truth_mutation" });
  });

  it("holds the stem when no predicate matches and still records withheld alternatives", () => {
    const frozen = seed();
    const result = evaluateBranchScheduler({
      seed: frozen,
      policyVersion: POLICY,
      current: initialBranchState(frozen),
      admittedLearnerEvents: [
        learnerEvent({ sequence: 3, eventType: "learner.utterance", tag: "small_talk", atSecond: 120 }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.decision.selectedTransitionId).toBeNull();
    expect(result.decision.toBranchId).toBe("stem");
    expect(result.decision.environmentCue.cueId).toBe("hold_environment");
    expect(result.decision.withheldAlternatives.map((row) => row.transitionId).sort()).toEqual([
      "t_acs_workup",
      "t_watchful",
    ]);
  });
});
