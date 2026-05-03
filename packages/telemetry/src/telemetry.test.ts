import { describe, expect, it } from "vitest";
import {
  openClinXrSpanNames,
  safeTelemetryAttributes,
  telemetryAttributeNames,
  telemetryRouteAttributes,
  type TelemetryAttributeInput,
} from "./index.js";

describe("OpenClinXR telemetry contract", () => {
  it("names spans for API, GraphQL, Mongo, model, voice, and XR timings", () => {
    expect(openClinXrSpanNames).toEqual({
      apiRoute: "openclinxr.api.route",
      graphqlOperation: "openclinxr.graphql.operation",
      mongoTraceSnapshot: "openclinxr.mongo.trace_snapshot",
      modelGenerateActorResponse: "openclinxr.model.generate_actor_response",
      voiceSynthesize: "openclinxr.voice.synthesize",
      xrInteraction: "openclinxr.xr.interaction",
    });
  });

  it("keeps shared route attributes low-cardinality and OpenClinXR namespaced", () => {
    expect(telemetryRouteAttributes({
      scenarioId: "ed_chest_pain_priority_v1",
      scenarioVersion: 1,
      stationRunId: "run_001",
      actorId: "patient_robert_hayes_v1",
      providerId: "mock-model",
      routeId: "actor-dialogue-offline-v1",
      requestPolicyId: "actor-dialogue-offline-v1",
      deviceProfile: "quest3",
    })).toEqual({
      "openclinxr.scenario_id": "ed_chest_pain_priority_v1",
      "openclinxr.scenario_version": 1,
      "openclinxr.station_run_id": "run_001",
      "openclinxr.actor_id": "patient_robert_hayes_v1",
      "openclinxr.provider_id": "mock-model",
      "openclinxr.route_id": "actor-dialogue-offline-v1",
      "openclinxr.request_policy_id": "actor-dialogue-offline-v1",
      "openclinxr.device_profile": "quest3",
    });
  });

  it("drops sensitive or high-cardinality fields from telemetry attributes", () => {
    const input: TelemetryAttributeInput = {
      scenarioId: "ed_chest_pain_priority_v1",
      learnerUtterance: "My father died of a heart attack.",
      promptText: "system prompt",
      hiddenFacts: ["Father died of myocardial infarction"],
      patientNoteText: "Private note text",
      rawAudioReference: "audio://sensitive",
    };

    expect(safeTelemetryAttributes(input)).toEqual({
      "openclinxr.scenario_id": "ed_chest_pain_priority_v1",
    });
    expect(Object.keys(telemetryAttributeNames).sort()).toEqual([
      "actorId",
      "deviceProfile",
      "guardrailStatus",
      "providerId",
      "requestPolicyId",
      "routeId",
      "scenarioId",
      "scenarioVersion",
      "stationRunId",
    ]);
  });
});
