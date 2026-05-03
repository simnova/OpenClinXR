import type { ProviderHealth } from "@openclinxr/shared-schemas";
import { buildAdversarialProbeReport, type AdversarialProbeReport } from "./adversarial-report.js";
import type { SimulationResult } from "./station-simulation.js";

export type MockBenchmarkReport = {
  benchmark: "ed-chest-pain-mock";
  elapsedMs: number;
  stationRunId: string;
  eventCount: number;
  actorResponseCount: number;
  voiceAudioEventCount: number;
  missingRequiredTraceTags: string[];
  traceQuality: SimulationResult["reviewPacket"]["traceQuality"];
  reviewSignals: {
    missingRequiredTraceTagCount: number;
    lateTraceTagCount: number;
    unsafeEventCount: number;
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
    voiceAudioEventCount: result.voiceAudioEventCount,
    missingRequiredTraceTags: result.reviewPacket.missingRequiredTraceTags,
    traceQuality: result.reviewPacket.traceQuality,
    reviewSignals: {
      missingRequiredTraceTagCount: result.reviewPacket.missingRequiredTraceTags.length,
      lateTraceTagCount: result.reviewPacket.lateTraceTags.length,
      unsafeEventCount: result.reviewPacket.unsafeEvents.length,
    },
    adversarialReport: buildAdversarialProbeReport(result, {
      hiddenFactCanaries: ["Father died of myocardial infarction"],
    }),
    providerHealth: result.providerHealth,
  };
}
