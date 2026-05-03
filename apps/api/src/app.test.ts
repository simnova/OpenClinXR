import { describe, expect, it } from "vitest";
import { createApiApp } from "./index.js";

async function json(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

const expectedProviderHealth = {
  model: { providerId: "mock-model", status: "ready" },
  voice: { providerId: "mock-voice", status: "ready" },
  localModel: { providerId: "local-model", status: "not_configured" },
  localVoice: { providerId: "local-voice", status: "not_configured" },
};

describe("OpenClinXR API shell", () => {
  it("reports health without requiring cloud providers", async () => {
    const app = createApiApp();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      ok: true,
      service: "openclinxr-api",
      providerHealth: expectedProviderHealth,
    });
  });

  it("reports provider health from the gateway layer", async () => {
    const app = createApiApp();
    const response = await app.request("/providers/health");

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual(expectedProviderHealth);
  });

  it("serves the ED chest pain scenario fixture", async () => {
    const app = createApiApp();
    const response = await app.request("/scenarios/ed-chest-pain");
    const body = await json(response) as { scenarioId: string; actors: Array<{ role: string; hiddenFacts?: string[] }> };

    expect(response.status).toBe(200);
    expect(body.scenarioId).toBe("ed_chest_pain_priority_v1");
    expect(body.actors.map((actor) => actor.role)).toEqual(["patient", "family", "nurse"]);
    expect(body.actors.some((actor) => "hiddenFacts" in actor)).toBe(false);
    expect(JSON.stringify(body)).not.toContain("Father died of myocardial infarction");
  });

  it("serves ED chest pain asset readiness from the shared runtime", async () => {
    const app = createApiApp();
    const response = await app.request("/scenarios/ed-chest-pain/assets/readiness");
    const body = await json(response) as { productionReady: boolean; missingRequiredAssetIds: string[]; blockedAssets: unknown[] };

    expect(response.status).toBe(200);
    expect(body.productionReady).toBe(true);
    expect(body.missingRequiredAssetIds).toEqual([]);
    expect(body.blockedAssets).toEqual([]);
  });

  it("serves the default exam blueprint and assembles a ready review form", async () => {
    const app = createApiApp();
    const blueprintResponse = await app.request("/exam-blueprints/default");
    const blueprint = await json(blueprintResponse) as { blueprintId: string; stationSlots: Array<{ order: number }> };

    expect(blueprintResponse.status).toBe(200);
    expect(blueprint.blueprintId).toBe("blueprint_openclinxr_clinical_skills_pilot_v1");
    expect(blueprint.stationSlots.map((slot) => slot.order)).toEqual([1]);

    const formResponse = await app.request("/exam-forms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examFormId: "form_openclinxr_pilot_001" }),
    });
    const form = await json(formResponse) as { status: string; stationRefs: Array<{ order: number; scenarioId: string }>; coverage: { missingTraceTags: string[] } };

    expect(formResponse.status).toBe(201);
    expect(form.status).toBe("ready_for_review");
    expect(form.stationRefs).toEqual([{ order: 1, scenarioId: "ed_chest_pain_priority_v1", scenarioVersion: 1, title: "ED Chest Pain With Nurse Interruption And Family Pressure" }]);
    expect(form.coverage.missingTraceTags).toEqual([]);
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

  it("returns not found for missing runtime sessions", async () => {
    const app = createApiApp();
    const response = await app.request("/sessions/missing-run/review-packet");

    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: "session_not_found" });
  });
});
