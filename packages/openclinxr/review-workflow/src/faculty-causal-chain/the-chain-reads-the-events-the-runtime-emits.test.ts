/**
 * Faculty causal chain reads the payload fields scenario-runtime actually
 * emits. Shapes copied from packages/openclinxr/scenario-runtime/src/reasoning-capture:
 *   learner.order identity — capture.ts:67-71 via stampIdentity (eventId + durableEventRef)
 *   learner.hypothesis — capture.ts:92-108 (hypothesis, citedEventIds, claimScope, notEvidenceFor)
 *   learner.hypothesis.changed — capture.ts:91 and capture.ts:104-106 (eventType + previousHypothesisEventId)
 *   note.submitted reasoning — capture.ts:182-197 (noteSummary, citedEventIds, synthesis)
 *   identity stamp — capture.ts:208-221 (eventId) and capture.ts:214 / trace.ts:45-57 (durableEventRef)
 *   claimScope / notEvidenceFor — capture.ts:21-30
 *
 * Driven through `buildReviewPacket` (package entrypoint). Does not import
 * scenario-runtime. Does not publish projectFacultyCausalChain.
 */
import { describe, expect, it } from "vitest";
import { buildReviewPacket } from "../index.js";

const RUNTIME_CLAIM_SCOPE = "learner_reasoning_capture_not_score_use";
const RUNTIME_NOT_EVIDENCE_FOR = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "autonomous_score",
  "diagnosis_correctness",
  "generative_summary_without_review",
] as const;

type TraceEvent = Parameters<typeof buildReviewPacket>[0]["traceEvents"][number];

function packet(traceEvents: Parameters<typeof buildReviewPacket>[0]["traceEvents"]) {
  return buildReviewPacket({
    stationRunId: "run_001",
    scenarioId: "ed_chest_pain_priority_v1",
    requiredTraceTags: [],
    traceEvents,
    facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "debrief" },
  });
}

function durableEventRef(stationRunId: string, sequence: number): string {
  return `durable://station-runs/${stationRunId}/events/${sequence}`;
}

function identityStamp(stationRunId: string, sequence: number, eventId: string): {
  eventId: string;
  durableEventRef: string;
} {
  return { eventId, durableEventRef: durableEventRef(stationRunId, sequence) };
}

function sourceEventId(event: TraceEvent): string {
  const payload = event.payload ?? {};
  const fromPayload = typeof payload["eventId"] === "string" ? payload["eventId"] : "";
  const fromDurable = typeof payload["durableEventRef"] === "string" ? payload["durableEventRef"] : "";
  return fromPayload || fromDurable;
}

function runtimeShapedTrace(): TraceEvent[] {
  const stationRunId = "run_001";
  const orderId = "evt_order_ecg";
  const firstHypothesisId = "evt_hyp_gerd";
  const changedHypothesisId = "evt_hyp_acs";
  const noteId = "evt_note_001";

  return [
    {
      sequence: 0,
      eventType: "learner.order",
      source: "learner",
      atSecond: 120,
      payload: {
        order: "12-lead ECG",
        ...identityStamp(stationRunId, 0, orderId),
      },
    },
    {
      sequence: 1,
      eventType: "learner.hypothesis",
      source: "learner",
      atSecond: 180,
      payload: {
        hypothesis: "reflux until proven otherwise",
        citedEventIds: [orderId],
        claimScope: RUNTIME_CLAIM_SCOPE,
        notEvidenceFor: [...RUNTIME_NOT_EVIDENCE_FOR],
        ...identityStamp(stationRunId, 1, firstHypothesisId),
      },
    },
    {
      sequence: 2,
      eventType: "learner.hypothesis.changed",
      source: "learner",
      atSecond: 240,
      payload: {
        hypothesis: "ACS until proven otherwise",
        citedEventIds: [],
        claimScope: RUNTIME_CLAIM_SCOPE,
        notEvidenceFor: [...RUNTIME_NOT_EVIDENCE_FOR],
        previousHypothesisEventId: firstHypothesisId,
        ...identityStamp(stationRunId, 2, changedHypothesisId),
      },
    },
    {
      sequence: 3,
      eventType: "note.submitted",
      source: "learner",
      atSecond: 1260,
      payload: {
        noteSummary: "ECG requested; concern for ACS",
        citedEventIds: [firstHypothesisId, changedHypothesisId],
        synthesis: {
          noteText: "ECG requested; concern for ACS",
          citedHypothesisEventIds: [firstHypothesisId, changedHypothesisId],
          hypotheses: [
            { eventId: firstHypothesisId, hypothesis: "reflux until proven otherwise" },
            { eventId: changedHypothesisId, hypothesis: "ACS until proven otherwise" },
          ],
        },
        claimScope: RUNTIME_CLAIM_SCOPE,
        notEvidenceFor: [...RUNTIME_NOT_EVIDENCE_FOR],
        ...identityStamp(stationRunId, 3, noteId),
      },
    },
  ];
}

describe("the chain reads the events the runtime emits", () => {
  it("resolves every link to events in a runtime-shaped fixture, including hypothesis and predecessor change", () => {
    const events = runtimeShapedTrace();
    const known = new Set(events.map(sourceEventId).filter((eventId) => eventId.length > 0));
    const chain = packet(events).causalChain;

    expect(chain.links.length).toBeGreaterThan(0);
    for (const link of chain.links) {
      expect(known.has(link.sourceEventId), link.sourceEventId).toBe(true);
      for (const cited of link.citedEventIds) {
        expect(known.has(cited), cited).toBe(true);
      }
    }

    expect(chain.links.some((link) =>
      link.kind === "hypothesis" && link.sourceEventId === "evt_hyp_gerd"
    )).toBe(true);
    expect(chain.links.some((link) =>
      link.kind === "hypothesis_change"
      && link.sourceEventId === "evt_hyp_acs"
      && link.citedEventIds.includes("evt_hyp_gerd")
    )).toBe(true);
  });

  it("refuses a runtime-shaped fixture that cites an event that is not in the trace", () => {
    expect(() => packet([
      {
        sequence: 0,
        eventType: "learner.hypothesis",
        source: "learner",
        atSecond: 180,
        payload: {
          hypothesis: "PE until proven otherwise",
          citedEventIds: ["evt_obs_missing"],
          claimScope: RUNTIME_CLAIM_SCOPE,
          notEvidenceFor: [...RUNTIME_NOT_EVIDENCE_FOR],
          ...identityStamp("run_001", 0, "evt_hyp_pe"),
        },
      },
    ])).toThrow("causal chain cites unknown event evt_obs_missing");
  });
});
