import { describe, expect, it } from "vitest";
import { buildReviewPacket } from "../index.js";

const NOT_EVIDENCE_FOR = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "autonomous_score",
  "diagnosis_correctness",
  "generative_summary_without_review",
] as const;

function packet(traceEvents: Parameters<typeof buildReviewPacket>[0]["traceEvents"]) {
  return buildReviewPacket({
    stationRunId: "run_001",
    scenarioId: "ed_chest_pain_priority_v1",
    requiredTraceTags: [],
    traceEvents,
    facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "debrief" },
  });
}

describe("faculty causal chain via buildReviewPacket", () => {
  it("projects chronology, hypothesis changes, support/contradict, and note linkage with source event ids", () => {
    const result = packet([
      {
        sequence: 2,
        eventType: "learner.observation",
        source: "learner",
        atSecond: 240,
        payload: {
          eventId: "evt_obs_stemi",
          observation: "ST elevation on ECG",
          relation: "supports",
          relatedHypothesisEventId: "evt_hyp_acs",
        },
      },
      {
        sequence: 0,
        eventType: "learner.hypothesis",
        source: "learner",
        atSecond: 60,
        payload: {
          eventId: "evt_hyp_gerd",
          hypothesis: "reflux until proven otherwise",
        },
      },
      {
        sequence: 1,
        eventType: "learner.hypothesis",
        source: "learner",
        atSecond: 180,
        payload: {
          eventId: "evt_hyp_acs",
          hypothesis: "ACS until proven otherwise",
        },
      },
      {
        sequence: 3,
        eventType: "learner.observation",
        source: "learner",
        atSecond: 300,
        payload: {
          eventId: "evt_obs_reflux",
          observation: "burning after meals",
          relation: "contradicts",
          relatedHypothesisEventId: "evt_hyp_acs",
        },
      },
      {
        sequence: 4,
        eventType: "actor.response.generated",
        source: "model-gateway",
        actorId: "patient_robert_hayes_v1",
        atSecond: 320,
        payload: {
          eventId: "evt_actor_001",
          responseKind: "actor_reply",
          relatedHypothesisEventId: "evt_hyp_acs",
          provenance: { providerId: "mock-model", guardrail: { status: "pass" } },
        },
      },
      {
        sequence: 5,
        eventType: "note.submitted",
        source: "learner",
        tag: "patient_note_submitted",
        atSecond: 1260,
        payload: {
          eventId: "evt_note_001",
          noteSummary: "ECG requested; concern for ACS",
          relatedHypothesisEventId: "evt_hyp_acs",
        },
      },
    ]);

    expect(result.causalChain.claimScope).toBe("faculty_causal_chain_not_score_use");
    expect(result.causalChain.scoringValidityClaimed).toBe(false);
    expect(result.causalChain.notEvidenceFor).toEqual([...NOT_EVIDENCE_FOR]);
    expect(result.causalChain.links.map((link) => link.kind)).toEqual([
      "hypothesis",
      "hypothesis",
      "hypothesis_change",
      "supporting_observation",
      "contradicting_observation",
      "actor_response",
      "note",
    ]);
    expect(result.causalChain.links.map((link) => link.sourceEventId)).toEqual([
      "evt_hyp_gerd",
      "evt_hyp_acs",
      "evt_hyp_acs",
      "evt_obs_stemi",
      "evt_obs_reflux",
      "evt_actor_001",
      "evt_note_001",
    ]);
    expect(result.causalChain.links[2]).toMatchObject({
      kind: "hypothesis_change",
      sourceEventId: "evt_hyp_acs",
      citedEventIds: ["evt_hyp_acs", "evt_hyp_gerd"],
      statement: "ACS until proven otherwise",
    });
    expect(result.causalChain.links[3]).toMatchObject({
      kind: "supporting_observation",
      citedEventIds: ["evt_obs_stemi", "evt_hyp_acs"],
      statement: "ST elevation on ECG",
    });
    expect(result.causalChain.links[6]).toMatchObject({
      kind: "note",
      citedEventIds: ["evt_note_001", "evt_hyp_acs"],
      statement: "ECG requested; concern for ACS",
    });
    expect(result.causalChain.missingEvidence).toEqual([
      {
        sourceEventId: "evt_hyp_gerd",
        hypothesisEventId: "evt_hyp_gerd",
        kind: "missing_supporting_observation",
      },
      {
        sourceEventId: "evt_hyp_gerd",
        hypothesisEventId: "evt_hyp_gerd",
        kind: "missing_note",
      },
      {
        sourceEventId: "evt_hyp_gerd",
        hypothesisEventId: "evt_hyp_gerd",
        kind: "missing_actor_response",
      },
    ]);
  });

  it("records explicit missing-evidence states when a hypothesis has no observations, note, or actor response", () => {
    const result = packet([
      {
        sequence: 0,
        eventType: "learner.hypothesis",
        source: "learner",
        atSecond: 30,
        payload: { eventId: "evt_hyp_only", hypothesis: "possible PE" },
      },
    ]);

    expect(result.causalChain.links).toEqual([
      expect.objectContaining({
        sourceEventId: "evt_hyp_only",
        kind: "hypothesis",
        statement: "possible PE",
      }),
    ]);
    expect(result.causalChain.missingEvidence.map((entry) => entry.kind)).toEqual([
      "missing_supporting_observation",
      "missing_note",
      "missing_actor_response",
    ]);
    expect(result.causalChain.missingEvidence.every((entry) => entry.sourceEventId === "evt_hyp_only")).toBe(true);
  });

  it("fails when a causal link has no source event id", () => {
    expect(() => packet([
      {
        sequence: 0,
        eventType: "learner.hypothesis",
        source: "learner",
        atSecond: 30,
        payload: { hypothesis: "ACS until proven otherwise" },
      },
    ])).toThrow("causal chain link requires source event id");
  });

  it("fails when a citation names an event that is not in the trace", () => {
    expect(() => packet([
      {
        sequence: 0,
        eventType: "learner.observation",
        source: "learner",
        atSecond: 40,
        payload: {
          eventId: "evt_obs_orphan",
          observation: "ST elevation on ECG",
          relation: "supports",
          relatedHypothesisEventId: "evt_hyp_missing",
        },
      },
    ])).toThrow("causal chain cites unknown event evt_hyp_missing");
  });

  it("never invents event ids or reasoning absent from the trace", () => {
    const result = packet([
      {
        sequence: 0,
        eventType: "learner.hypothesis",
        source: "learner",
        atSecond: 10,
        payload: { eventId: "evt_hyp_acs", hypothesis: "ACS until proven otherwise" },
      },
      {
        sequence: 1,
        eventType: "learner.utterance",
        source: "learner",
        atSecond: 12,
        payload: { eventId: "evt_utterance", text: "I think this is ACS because the story sounds typical." },
      },
    ]);

    const serialized = JSON.stringify(result.causalChain);
    expect(serialized).not.toContain("evt_invented");
    expect(serialized).not.toContain("the story sounds typical");
    expect(result.causalChain.links.every((link) => ["evt_hyp_acs"].includes(link.sourceEventId))).toBe(true);
    expect(result.causalChain.links.map((link) => link.statement)).toEqual(["ACS until proven otherwise"]);
  });

  it("is replay-stable for the same trace", () => {
    const events = [
      {
        sequence: 0,
        eventType: "learner.hypothesis" as const,
        source: "learner",
        atSecond: 10,
        payload: { eventId: "evt_hyp_acs", hypothesis: "ACS until proven otherwise" },
      },
      {
        sequence: 1,
        eventType: "note.submitted" as const,
        source: "learner",
        atSecond: 20,
        payload: {
          eventId: "evt_note_001",
          noteSummary: "ECG requested; concern for ACS",
          relatedHypothesisEventId: "evt_hyp_acs",
        },
      },
    ];
    expect(JSON.stringify(packet(events).causalChain)).toBe(JSON.stringify(packet(events).causalChain));
  });
});
