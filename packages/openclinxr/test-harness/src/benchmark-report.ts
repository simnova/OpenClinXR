import type { ProviderHealth } from "@openclinxr/shared-schemas";
import { openClinXrSpanNames, telemetryRouteAttributes } from "@openclinxr/telemetry";
import { buildAdversarialProbeReport, type AdversarialProbeReport } from "./adversarial-report.js";
import type { SimulationResult } from "./station-simulation.js";

export type MockBenchmarkReport = {
  benchmark: "ed-chest-pain-mock";
  elapsedMs: number;
  stationRunId: string;
  eventCount: number;
  actorResponseCount: number;
  routedActorResponseCount: number;
  clinicalActionEventCount: number;
  voiceAudioEventCount: number;
  missingRequiredTraceTags: string[];
  traceQuality: SimulationResult["reviewPacket"]["traceQuality"];
  reviewSignals: {
    missingRequiredTraceTagCount: number;
    lateTraceTagCount: number;
    unsafeEventCount: number;
  };
  telemetryPlan: {
    spanNames: typeof openClinXrSpanNames;
    benchmarkAttributes: ReturnType<typeof telemetryRouteAttributes>;
  };
  adversarialReport: AdversarialProbeReport;
  providerHealth: {
    model: ProviderHealth;
    voice: ProviderHealth;
    localModel: ProviderHealth;
    localVoice: ProviderHealth;
  };
};

export function buildMockBenchmarkReport(result: SimulationResult, elapsedMs: number): MockBenchmarkReport {
  return {
    benchmark: "ed-chest-pain-mock",
    elapsedMs,
    stationRunId: result.stationRunId,
    eventCount: result.eventCount,
    actorResponseCount: result.actorResponseCount,
    routedActorResponseCount: result.routedActorResponseCount,
    clinicalActionEventCount: result.clinicalActionEventCount,
    voiceAudioEventCount: result.voiceAudioEventCount,
    missingRequiredTraceTags: result.reviewPacket.missingRequiredTraceTags,
    traceQuality: result.reviewPacket.traceQuality,
    reviewSignals: {
      missingRequiredTraceTagCount: result.reviewPacket.missingRequiredTraceTags.length,
      lateTraceTagCount: result.reviewPacket.lateTraceTags.length,
      unsafeEventCount: result.reviewPacket.unsafeEvents.length,
    },
    telemetryPlan: {
      spanNames: openClinXrSpanNames,
      benchmarkAttributes: telemetryRouteAttributes({
        scenarioId: "ed_chest_pain_priority_v1",
        providerId: result.providerHealth.model.providerId,
        routeId: "actor-dialogue-offline-v1",
        routeSurface: "xr-runtime",
        stationRunScoped: true,
      }),
    },
    adversarialReport: buildAdversarialProbeReport(result, {
      hiddenFactCanaries: ["Father died of myocardial infarction"],
    }),
    providerHealth: result.providerHealth,
  };
}
