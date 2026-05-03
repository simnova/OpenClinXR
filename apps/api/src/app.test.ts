import { describe, expect, it } from "vitest";
import { createApiApp } from "./index.js";

async function json(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

describe("OpenClinXR API shell", () => {
  it("reports health without requiring cloud providers", async () => {
    const app = createApiApp();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      ok: true,
      service: "openclinxr-api",
      providerHealth: {
        model: { providerId: "mock-model", status: "ready" },
        voice: { providerId: "mock-voice", status: "ready" },
        localModel: { providerId: "local-model", status: "not_configured" },
        localVoice: { providerId: "local-voice", status: "not_configured" },
      },
    });
  });

  it("serves the ED chest pain scenario fixture", async () => {
    const app = createApiApp();
    const response = await app.request("/scenarios/ed-chest-pain");
    const body = await json(response) as { scenarioId: string; actors: Array<{ role: string }> };

    expect(response.status).toBe(200);
    expect(body.scenarioId).toBe("ed_chest_pain_priority_v1");
    expect(body.actors.map((actor) => actor.role)).toEqual(["patient", "family", "nurse"]);
  });

  it("starts a session, records events, submits a note, and returns a review packet", async () => {
    const app = createApiApp();
    const start = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ learnerId: "learner_001" }),
    });
    const started = await json(start) as { stationRunId: string; phase: string };

    expect(start.status).toBe(201);
    expect(started.phase).toBe("encounter");

    const action = await app.request(`/sessions/${started.stationRunId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventType: "learner.order", atSecond: 480, tag: "ecg_request", actorId: "nurse_maria_alvarez_v1" }),
    });
    expect(action.status).toBe(201);

    const note = await app.request(`/sessions/${started.stationRunId}/note`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atSecond: 1260, text: "Concern for ACS. ECG requested." }),
    });
    expect(note.status).toBe(200);

    const packetResponse = await app.request(`/sessions/${started.stationRunId}/review-packet`);
    const packet = await json(packetResponse) as { observedTraceTags: string[]; missingRequiredTraceTags: string[] };

    expect(packetResponse.status).toBe(200);
    expect(packet.observedTraceTags).toContain("ecg_request");
    expect(packet.missingRequiredTraceTags).toContain("team_communication");
    expect(packet.missingRequiredTraceTags).not.toContain("patient_note_submitted");
  });
});

