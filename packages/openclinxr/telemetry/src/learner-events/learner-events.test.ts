import { describe, expect, it } from "vitest";
import {
  DURABLE_LEARNER_EVENT_CLAIM_SCOPE,
  DURABLE_LEARNER_EVENT_NOT_EVIDENCE_FOR,
  DURABLE_LEARNER_EVENT_SPAN_NAME,
  persistDurableLearnerEvent,
  type DurableLearnerEventRecord,
} from "./persist.js";

function record(overrides: Partial<DurableLearnerEventRecord> = {}): DurableLearnerEventRecord {
  return {
    eventId: "evt_hypothesis_001",
    stationRunId: "run_001",
    scenarioId: "ed_chest_pain_priority_v1",
    atSecond: 120,
    sequence: 1,
    kind: "learner.hypothesis",
    relation: null,
    statement: "ACS until proven otherwise",
    relatedEventIds: [],
    ...overrides,
  };
}

describe("durable learner event persistence", () => {
  it("persists hypothesis, note, and actor-response records with the supplied event id", () => {
    const hypothesis = persistDurableLearnerEvent(record());
    const note = persistDurableLearnerEvent(record({
      eventId: "evt_note_001",
      kind: "note.submitted",
      atSecond: 1260,
      sequence: 4,
      statement: "ECG requested; concern for ACS",
      relatedEventIds: ["evt_hypothesis_001"],
    }));
    const actorResponse = persistDurableLearnerEvent(record({
      eventId: "evt_actor_001",
      kind: "actor.response.generated",
      atSecond: 180,
      sequence: 2,
      statement: "actor_reply",
      relatedEventIds: ["evt_hypothesis_001"],
    }));

    expect(hypothesis.spanName).toBe(DURABLE_LEARNER_EVENT_SPAN_NAME);
    expect(hypothesis.record.eventId).toBe("evt_hypothesis_001");
    expect(note.record.kind).toBe("note.submitted");
    expect(note.record.relatedEventIds).toEqual(["evt_hypothesis_001"]);
    expect(actorResponse.record.kind).toBe("actor.response.generated");
    expect(hypothesis.claimScope).toBe(DURABLE_LEARNER_EVENT_CLAIM_SCOPE);
    expect(hypothesis.notEvidenceFor).toEqual(DURABLE_LEARNER_EVENT_NOT_EVIDENCE_FOR);
  });

  it("refuses a record with no source event id", () => {
    expect(() => persistDurableLearnerEvent(record({ eventId: "   " }))).toThrow(
      "durable learner event requires source event id",
    );
  });

  it("does not invent related event ids and omits statement text from learner-safe attributes", () => {
    const persisted = persistDurableLearnerEvent(record({
      kind: "learner.observation",
      relation: "supports",
      statement: "ST elevation on ECG",
      relatedEventIds: ["evt_hypothesis_001"],
    }));

    expect(persisted.record.relatedEventIds).toEqual(["evt_hypothesis_001"]);
    expect(persisted.learnerSafeAttributes["openclinxr.learner.event_id"]).toBe("evt_hypothesis_001");
    expect(persisted.learnerSafeAttributes["openclinxr.learner.related_event_ids"]).toBe("evt_hypothesis_001");
    expect(JSON.stringify(persisted.learnerSafeAttributes)).not.toContain("ST elevation on ECG");
    expect(JSON.stringify(persisted.learnerSafeAttributes)).not.toContain("ACS until proven otherwise");
  });

  it("is replay-stable for the same record", () => {
    const first = persistDurableLearnerEvent(record({
      relatedEventIds: ["evt_obs_001", "evt_note_001"],
    }));
    const second = persistDurableLearnerEvent(record({
      relatedEventIds: ["evt_obs_001", "evt_note_001"],
    }));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
