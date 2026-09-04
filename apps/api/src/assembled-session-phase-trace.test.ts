import { describe, expect, it } from "vitest";
import { createApiApp } from "./index.js";

const assembledStation = {
  examRunId: "exam_run_assembled_api_001",
  scenarioId: "ed_chest_pain_priority_v1",
  stationOrder: 1,
  formTiming: {
    doorway: { startsAtSecond: 0, endsAtSecond: 60 },
    encounter: { startsAtSecond: 60, endsAtSecond: 960 },
    note: { startsAtSecond: 960, endsAtSecond: 1560 },
  },
};

async function json(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

describe("assembled session phase traces", () => {
  it("persists canonical replayable phase events through start-encounter and note", async () => {
    const app = createApiApp();
    const start = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        learnerId: "learner_assembled_001",
        consentAccepted: true,
        scenarioId: "ed_chest_pain_priority_v1",
        assembledStation,
      }),
    });
    expect(start.status).toBe(201);
    const started = (await json(start)) as { stationRunId: string; scenarioId: string };
    expect(started.scenarioId).toBe("ed_chest_pain_priority_v1");
    expect(started.stationRunId).not.toMatch(/^station_run_exam_run_assembled_api_001/);

    const encounter = await app.request(`/sessions/${started.stationRunId}/start-encounter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atSecond: 60 }),
    });
    expect(encounter.status).toBe(200);

    const beforeNote = await app.request(`/sessions/${started.stationRunId}/trace-events`);
    const beforeEvents = (await json(beforeNote)) as Array<{ eventType: string }>;
    expect(beforeEvents.map((event) => event.eventType)).toContain("encounter.started");
    expect(beforeEvents.map((event) => event.eventType)).not.toContain("encounter.ended");
    expect(beforeEvents.map((event) => event.eventType)).not.toContain("note.started");
    expect(beforeEvents.map((event) => event.eventType)).not.toContain("note.submitted");
    expect(beforeEvents.map((event) => event.eventType)).not.toContain("station.advanced");

    expect(
      (
        await app.request(`/sessions/${started.stationRunId}/end-encounter`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ atSecond: 960 }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/sessions/${started.stationRunId}/start-note`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ atSecond: 960 }),
        })
      ).status,
    ).toBe(200);

    const note = await app.request(`/sessions/${started.stationRunId}/note`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atSecond: 1560, text: "Note submitted from assembled station." }),
    });
    expect(note.status).toBe(200);

    const traces = await app.request(`/sessions/${started.stationRunId}/trace-events`);
    expect(traces.status).toBe(200);
    const events = (await json(traces)) as Array<{ eventType: string; payload: Record<string, unknown>; sequence: number; stationRunId: string }>;
    const phases = events.filter((event) =>
      ["encounter.started", "encounter.ended", "note.started", "note.submitted", "station.advanced"].includes(event.eventType),
    );
    expect(phases.map((event) => event.eventType)).toEqual([
      "encounter.started",
      "encounter.ended",
      "note.started",
      "note.submitted",
      "station.advanced",
    ]);
    for (const event of phases) {
      expect(event.stationRunId).toBe(started.stationRunId);
      expect(event.payload["examRunId"]).toBe(assembledStation.examRunId);
      expect(event.payload["scenarioId"]).toBe(assembledStation.scenarioId);
      expect(event.payload["stationOrder"]).toBe(1);
      expect(event.payload["durableEventRef"]).toBe(
        `durable://station-runs/${started.stationRunId}/events/${event.sequence}`,
      );
    }
  });

  it("preserves standalone sessions and refuses partial or cross-scenario assembled context", async () => {
    const app = createApiApp();
    const standalone = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ learnerId: "learner_standalone_api", consentAccepted: true }),
    });
    expect(standalone.status).toBe(201);
    const started = (await json(standalone)) as { stationRunId: string };
    await app.request(`/sessions/${started.stationRunId}/start-encounter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atSecond: 60 }),
    });
    const traces = await app.request(`/sessions/${started.stationRunId}/trace-events`);
    const events = (await json(traces)) as Array<{ eventType: string; payload: Record<string, unknown> }>;
    const startedEvent = events.find((event) => event.eventType === "encounter.started");
    expect(startedEvent?.payload["examRunId"]).toBeUndefined();

    const partial = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        learnerId: "learner_partial_api",
        consentAccepted: true,
        assembledStation: { examRunId: "exam_run_partial", scenarioId: "ed_chest_pain_priority_v1" },
      }),
    });
    expect(partial.status).toBe(400);
    expect(await json(partial)).toEqual({ error: "incomplete_assembled_station_context" });

    const cross = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        learnerId: "learner_cross_api",
        consentAccepted: true,
        scenarioId: "ed_chest_pain_priority_v1",
        assembledStation: { ...assembledStation, scenarioId: "peds_asthma_parent_anxiety_v1" },
      }),
    });
    expect(cross.status).toBe(400);
    expect(await json(cross)).toEqual({ error: "assembled_station_scenario_mismatch" });
  });

  it("refuses start-encounter atSecond 0 so it cannot persist formAtSecond 60", async () => {
    const app = createApiApp();
    const start = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        learnerId: "learner_zero_clock_api",
        consentAccepted: true,
        scenarioId: "ed_chest_pain_priority_v1",
        assembledStation,
      }),
    });
    const started = (await json(start)) as { stationRunId: string };
    const refused = await app.request(`/sessions/${started.stationRunId}/start-encounter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atSecond: 0 }),
    });
    expect(refused.status).toBe(400);
    const traces = await app.request(`/sessions/${started.stationRunId}/trace-events`);
    const events = (await json(traces)) as Array<{ eventType: string; payload: Record<string, unknown> }>;
    expect(events.some((event) => event.eventType === "encounter.started")).toBe(false);
    expect(events.some((event) => event.payload["formAtSecond"] === 60)).toBe(false);
  });
});
