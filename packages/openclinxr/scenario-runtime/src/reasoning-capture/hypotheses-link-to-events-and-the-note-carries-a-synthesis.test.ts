/**
 * A learner hypothesis is an immutable trace event with its own id and the
 * ids of the events it rests on. Changing it appends `learner.hypothesis.changed`
 * rather than mutating the original. `submitNote` captures a structured
 * synthesis that cites those hypothesis event ids so the landed faculty
 * causal chain (`projectFacultyCausalChain`) can read real source events.
 *
 * Known-good: review-workflow faculty-causal-chain.test.ts refuses missing
 * source ids and unknown citations.
 *
 * Drive through `createDefaultScenarioRuntime` (public entrypoint). No new exports.
 */
import { describe, expect, it } from "vitest";
import { projectFacultyCausalChain } from "../../../review-workflow/dist/faculty-causal-chain/index.js";
import { createDefaultScenarioRuntime } from "../index.js";
import type { ReviewPacket, TraceEvent } from "@openclinxr/shared-schemas";

type CausalLink = {
  kind: string;
  sourceEventId: string;
  citedEventIds: readonly string[];
  statement: string;
};

type CausalChain = {
  links: readonly CausalLink[];
  missingEvidence: readonly { kind: string; hypothesisEventId: string }[];
};

async function startedRuntime() {
  const runtime = createDefaultScenarioRuntime();
  const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
  runtime.startEncounter(session.stationRunId, { atSecond: 60 });
  return { runtime, stationRunId: session.stationRunId };
}

function payloadString(event: TraceEvent, key: string): string {
  const value = event.payload[key];
  return typeof value === "string" ? value : "";
}

function recordedEventId(event: TraceEvent): string {
  return payloadString(event, "eventId") || payloadString(event, "durableEventRef");
}

function idsInTrace(events: readonly TraceEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    const eventId = recordedEventId(event);
    if (eventId.length > 0) {
      ids.add(eventId);
    }
  }
  return ids;
}

function causalChainOf(packet: ReviewPacket): CausalChain {
  const withChain = packet as ReviewPacket & { causalChain: CausalChain };
  return withChain.causalChain;
}

describe("hypotheses link to events and the note carries a synthesis", () => {
  it("records an immutable hypothesis with its own id and the events it rests on", async () => {
    const { runtime, stationRunId } = await startedRuntime();
    const resting = runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.order",
      atSecond: 120,
      tag: "ecg_request",
      payload: { order: "12-lead ECG" },
    });
    const restingId = payloadString(resting, "eventId");
    expect(restingId.length).toBeGreaterThan(0);

    const hypothesis = runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.hypothesis",
      atSecond: 180,
      payload: {
        hypothesis: "reflux until proven otherwise",
        citedEventIds: [restingId],
      },
    });

    expect(hypothesis.eventType).toBe("learner.hypothesis");
    expect(payloadString(hypothesis, "eventId").length).toBeGreaterThan(0);
    expect(payloadString(hypothesis, "eventId")).not.toBe(restingId);
    expect(hypothesis.payload["citedEventIds"]).toEqual([restingId]);
    expect(payloadString(hypothesis, "hypothesis")).toBe("reflux until proven otherwise");
  });

  it("records a change as a new event instead of overwriting the original", async () => {
    const { runtime, stationRunId } = await startedRuntime();
    const first = runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.hypothesis",
      atSecond: 60,
      payload: { hypothesis: "reflux until proven otherwise" },
    });
    const firstId = payloadString(first, "eventId");

    const changed = runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.hypothesis",
      atSecond: 180,
      payload: { hypothesis: "ACS until proven otherwise" },
    });

    expect(changed.eventType).toBe("learner.hypothesis.changed");
    expect(payloadString(changed, "eventId")).not.toBe(firstId);
    expect(payloadString(changed, "previousHypothesisEventId")).toBe(firstId);
    expect(payloadString(changed, "hypothesis")).toBe("ACS until proven otherwise");

    const original = runtime.traceEvents(stationRunId).find((event) => payloadString(event, "eventId") === firstId);
    expect(original).toBeDefined();
    expect(original?.eventType).toBe("learner.hypothesis");
    expect(payloadString(original ?? first, "hypothesis")).toBe("reflux until proven otherwise");
  });

  it("refuses to reuse a recorded hypothesis event id or cite an event that is not in the trace", async () => {
    const { runtime, stationRunId } = await startedRuntime();
    const first = runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.hypothesis",
      atSecond: 60,
      payload: { eventId: "evt_hyp_gerd", hypothesis: "reflux until proven otherwise" },
    });
    expect(payloadString(first, "eventId")).toBe("evt_hyp_gerd");

    expect(() => runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.hypothesis",
      atSecond: 90,
      payload: { eventId: "evt_hyp_gerd", hypothesis: "ACS until proven otherwise" },
    })).toThrow("hypothesis event id already recorded");

    expect(() => runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.hypothesis",
      atSecond: 100,
      payload: {
        hypothesis: "PE until proven otherwise",
        citedEventIds: ["evt_obs_missing"],
      },
    })).toThrow("hypothesis cites unknown event evt_obs_missing");
  });

  it("captures a structured note synthesis that cites recorded hypotheses for the faculty chain", async () => {
    const { runtime, stationRunId } = await startedRuntime();
    const resting = runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.order",
      atSecond: 120,
      tag: "ecg_request",
      payload: { order: "12-lead ECG" },
    });
    const first = runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.hypothesis",
      atSecond: 180,
      payload: {
        hypothesis: "reflux until proven otherwise",
        citedEventIds: [payloadString(resting, "eventId")],
      },
    });
    const changed = runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.hypothesis",
      atSecond: 240,
      payload: { hypothesis: "ACS until proven otherwise" },
    });

    runtime.submitNote(stationRunId, {
      atSecond: 1260,
      text: "ECG requested; concern for ACS",
    });

    const note = runtime.traceEvents(stationRunId).find((event) => event.eventType === "note.submitted");
    expect(note).toBeDefined();
    if (!note) {
      return;
    }
    const firstId = payloadString(first, "eventId");
    const changedId = payloadString(changed, "eventId");
    expect(payloadString(note, "eventId").length).toBeGreaterThan(0);
    expect(payloadString(note, "noteSummary")).toBe("ECG requested; concern for ACS");
    expect(note.payload["citedEventIds"]).toEqual([firstId, changedId]);
    expect(note.payload["synthesis"]).toEqual({
      noteText: "ECG requested; concern for ACS",
      citedHypothesisEventIds: [firstId, changedId],
      hypotheses: [
        { eventId: firstId, hypothesis: "reflux until proven otherwise" },
        { eventId: changedId, hypothesis: "ACS until proven otherwise" },
      ],
    });

    const chain = causalChainOf(runtime.reviewPacket(stationRunId));
    expect(chain.links.map((link) => link.kind)).toEqual([
      "hypothesis",
      "hypothesis_change",
      "note",
    ]);
    expect(chain.links.map((link) => link.sourceEventId)).toEqual([
      firstId,
      changedId,
      payloadString(note, "eventId"),
    ]);
    expect(chain.links[2]).toMatchObject({
      kind: "note",
      citedEventIds: [payloadString(note, "eventId"), firstId, changedId],
      statement: "ECG requested; concern for ACS",
    });
    expect(chain.missingEvidence.filter((entry) => entry.kind === "missing_note")).toEqual([]);
  });

  it("feeds the captured trace to projectFacultyCausalChain so every link cites an event in that trace", async () => {
    const { runtime, stationRunId } = await startedRuntime();
    const resting = runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.order",
      atSecond: 120,
      tag: "ecg_request",
      payload: { order: "12-lead ECG" },
    });
    const hypothesis = runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.hypothesis",
      atSecond: 180,
      payload: {
        hypothesis: "reflux until proven otherwise",
        citedEventIds: [payloadString(resting, "eventId")],
      },
    });
    runtime.submitNote(stationRunId, {
      atSecond: 1260,
      text: "ECG requested; concern for ACS",
    });

    const trace = runtime.traceEvents(stationRunId);
    const chain = projectFacultyCausalChain(trace);
    const known = idsInTrace(trace);
    const hypothesisId = payloadString(hypothesis, "eventId");

    expect(chain.links.length).toBeGreaterThan(0);
    for (const link of chain.links) {
      expect(known.has(link.sourceEventId), link.sourceEventId).toBe(true);
      for (const cited of link.citedEventIds) {
        expect(known.has(cited), cited).toBe(true);
      }
    }
    expect(chain.links.some((link) =>
      link.kind === "hypothesis" && link.sourceEventId === hypothesisId
    )).toBe(true);
  });

  it("leaves submitNote unchanged when the station records no hypothesis", async () => {
    const { runtime, stationRunId } = await startedRuntime();
    runtime.appendLearnerEvent(stationRunId, {
      eventType: "learner.order",
      atSecond: 480,
      tag: "ecg_request",
    });
    runtime.submitNote(stationRunId, {
      atSecond: 1260,
      text: "Concern for ACS. ECG requested.",
    });

    const events = runtime.traceEvents(stationRunId);
    expect(events.map((event) => event.eventType)).toEqual([
      "station.started",
      "consent.accepted",
      "encounter.started",
      "learner.order",
      "encounter.ended",
      "note.submitted",
    ]);
    const notes = events.filter((event) => event.eventType === "note.submitted");
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note).toBeDefined();
    if (!note) {
      return;
    }
    expect(note.source).toBe("learner");
    expect(note.tag).toBe("patient_note_submitted");
    expect(note.payload).toEqual({});
    expect(note.payload["synthesis"]).toBeUndefined();
    expect(events.some((event) => event.eventType.includes("synthesis"))).toBe(false);
  });
});
