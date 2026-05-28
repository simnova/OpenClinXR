import { buildFacultyReviewPath, type FacultyReviewPath } from "@openclinxr/review-workflow";
import type { ProviderHealth } from "@openclinxr/shared-schemas";
import { openClinXrSpanNames, telemetryRouteAttributes } from "@openclinxr/telemetry";
import { type AdversarialProbeReport, buildAdversarialProbeReport } from "./adversarial-report.js";
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
  facultyReviewPath: FacultyReviewPath;
  telemetryPlan: {
    spanNames: typeof openClinXrSpanNames;
    benchmarkAttributes: ReturnType<typeof telemetryRouteAttributes>;
  };
  adversarialReport: AdversarialProbeReport;
  dialogueSeedReplay: SimulationResult["dialogueSeedReplay"];
  providerHealth: {
    model: ProviderHealth;
    voice: ProviderHealth;
    localModel: ProviderHealth;
    localVoice: ProviderHealth;
  };
  optionalRuntimeSkips: SimulationResult["optionalRuntimeSkips"];
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
      unsafeEventCount: result.reviewPacket.traceQuality.unsafeEventCount,
    },
    facultyReviewPath: buildFacultyReviewPath({
      packet: result.reviewPacket,
      hasDurableSummary: true,
      durableSummaryIsSafe: true,
      traceEventCount: result.eventCount,
      safetyFlagLabels: result.reviewPacket.unsafeEvents,
    }),
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
    dialogueSeedReplay: result.dialogueSeedReplay,
    providerHealth: result.providerHealth,
    optionalRuntimeSkips: result.optionalRuntimeSkips,
  };
}
