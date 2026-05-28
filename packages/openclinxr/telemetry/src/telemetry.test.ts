import { describe, expect, it } from "vitest";
import {
  createInMemoryTelemetryRecorder,
  createNoopTelemetryRecorder,
  openClinXrSpanNames,
  safeTelemetryAttributes,
  summarizeTelemetrySpans,
  type TelemetryAttributeInput,
  type TelemetrySpanRecord,
  telemetryAttributeNames,
  telemetryRouteAttributes,
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
      routeSurface: "xr-runtime",
      stationRunScoped: true,
      requestPolicyId: "actor-dialogue-offline-v1",
      deviceProfile: "quest3",
      graphqlOperationName: "StationRunQueueSnapshots",
    })).toEqual({
      "openclinxr.scenario_id": "ed_chest_pain_priority_v1",
      "openclinxr.scenario_version": 1,
      "openclinxr.station_run_id": "run_001",
      "openclinxr.actor_id": "patient_robert_hayes_v1",
      "openclinxr.provider_id": "mock-model",
      "openclinxr.route_id": "actor-dialogue-offline-v1",
      "openclinxr.route_surface": "xr-runtime",
      "openclinxr.station_run_scoped": true,
      "openclinxr.request_policy_id": "actor-dialogue-offline-v1",
      "openclinxr.device_profile": "quest3",
      "openclinxr.graphql.operation_name": "StationRunQueueSnapshots",
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
      "graphqlOperationName",
      "guardrailStatus",
      "providerId",
      "requestPolicyId",
      "routeId",
      "routeSurface",
      "scenarioId",
      "scenarioVersion",
      "stationRunId",
      "stationRunScoped",
    ]);
  });

  it("offers no-op and in-memory recorders for local verification before exporters exist", async () => {
    await expect(Promise.resolve(createNoopTelemetryRecorder().recordSpan({
      name: openClinXrSpanNames.apiRoute,
      attributes: {},
      durationMs: 1,
    }))).resolves.toBeUndefined();

    const recorder = createInMemoryTelemetryRecorder();
    recorder.recordSpan({
      name: openClinXrSpanNames.apiRoute,
      attributes: telemetryRouteAttributes({ routeId: "actor-response", stationRunId: "run_001" }),
      durationMs: 2.5,
      statusCode: 201,
    });

    expect(recorder.spans()).toEqual([
      {
        name: "openclinxr.api.route",
        attributes: {
          "openclinxr.route_id": "actor-response",
          "openclinxr.station_run_id": "run_001",
        },
        durationMs: 2.5,
        statusCode: 201,
      },
    ]);

    recorder.clear();
    expect(recorder.spans()).toEqual([]);
  });

  it("summarizes spans with low-cardinality labels and no PHI-bearing fields", () => {
    const spans: TelemetrySpanRecord[] = [
      {
        name: openClinXrSpanNames.apiRoute,
        attributes: telemetryRouteAttributes({
          routeId: "actor-dialogue-offline-v1",
          routeSurface: "xr-runtime",
          stationRunScoped: true,
          providerId: "mock-model",
          stationRunId: "run-001",
          scenarioId: "ed_chest_pain_priority_v1",
        }),
        durationMs: 10,
        statusCode: 200,
      },
      {
        name: openClinXrSpanNames.apiRoute,
        attributes: telemetryRouteAttributes({
          routeId: "actor-dialogue-offline-v1",
          routeSurface: "xr-runtime",
          stationRunScoped: true,
          providerId: "mock-model",
          stationRunId: "run-002",
          scenarioId: "abdominal_pain_v1",
        }),
        durationMs: 40,
        statusCode: 503,
        errorType: "UpstreamTimeout",
      },
      {
        name: openClinXrSpanNames.graphqlOperation,
        attributes: telemetryRouteAttributes({
          graphqlOperationName: "StationRunQueueSnapshots",
          stationRunId: "run-003",
        }),
        durationMs: 25,
      },
    ];

    expect(summarizeTelemetrySpans(spans)).toEqual({
      buckets: [
        {
          name: "openclinxr.api.route",
          labels: {
            "openclinxr.provider_id": "mock-model",
            "openclinxr.route_id": "actor-dialogue-offline-v1",
            "openclinxr.route_surface": "xr-runtime",
            "openclinxr.station_run_scoped": true,
          },
          count: 2,
          errorCount: 1,
          statusCodes: [200, 503],
          durationMs: {
            avg: 25,
            max: 40,
            min: 10,
            p95: 40,
          },
        },
        {
          name: "openclinxr.graphql.operation",
          labels: {
            "openclinxr.graphql.operation_name": "StationRunQueueSnapshots",
          },
          count: 1,
          errorCount: 0,
          statusCodes: [],
          durationMs: {
            avg: 25,
            max: 25,
            min: 25,
            p95: 25,
          },
        },
      ],
    });
  });
});
