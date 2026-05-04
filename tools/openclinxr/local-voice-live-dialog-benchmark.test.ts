import { describe, expect, it } from "vitest";
import { buildLocalVoiceLiveDialogBenchmarkReport, type LocalVoiceRuntimeBenchmarkReport } from "./local-voice-live-dialog-benchmark.js";

describe("local voice live-dialog benchmark report", () => {
  it("turns file-generation voice evidence into explicit live-dialog blockers without executing a voice runtime", async () => {
    const report = await buildLocalVoiceLiveDialogBenchmarkReport({
      generatedAt: "2026-05-04T20:15:00.000Z",
      runtimeBenchmarkFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json",
      runtimeBenchmark: localVoiceRuntimeBenchmark({
        caveats: [
          "This measured file-based local generation, not WebXR playback or a live streaming websocket turn.",
          "Real-time factor was 5.24x on this Apple M1 Max, so current local VibeVoice is not yet Quest-ready for live dialog.",
        ],
        realTimeFactor: 5.24,
      }),
    });

    expect(report.policy).toEqual({
      cloudApisUsed: false,
      paidApisUsed: false,
      voiceRuntimeExecutionAllowed: false,
      productionUseAllowed: false,
      generatedAudioCommitted: false,
    });
    expect(report.mockStream).toMatchObject({
      provider: "deterministic-mock-voice-gateway",
      transcriptEvents: 2,
      audioChunks: 1,
      firstAudiblePlaybackLatencyMs: 0,
      visemeCuesPresent: true,
      passed: true,
    });
    expect(report.runtimeFit).toMatchObject({
      fileGenerationOnly: true,
      realTimeFactor: 5.24,
      realTimeCapable: false,
      blockers: ["runtime_file_generation_only", "real_time_factor_above_1"],
    });
    expect(report.runtimeStream).toEqual({
      realLocalVoiceStreamObserved: false,
      evidenceSource: "not_captured",
      firstAudiblePlaybackLatencyMs: null,
      transcriptRoundTripObserved: false,
      blockers: ["real_local_voice_stream_benchmark_missing"],
    });
    expect(report.webxrPlayback).toEqual({
      observed: false,
      evidenceSource: "not_captured",
      blockers: ["webxr_playback_not_observed"],
    });
    expect(report.safetyControls).toEqual({
      disclosureRequired: true,
      generatedAudioCommitted: false,
      misuseControlsRequired: true,
      retentionPolicyObserved: true,
      blockers: [],
    });
    expect(report.verdict).toEqual({
      passed: false,
      readyForLiveDialog: false,
      blockers: [
        "runtime_stream:real_local_voice_stream_benchmark_missing",
        "runtime:runtime_file_generation_only",
        "runtime:real_time_factor_above_1",
        "webxr_playback:webxr_playback_not_observed",
      ],
      caveats: [
        "Mock stream evidence proves gateway event shape only; it is not a real VibeVoice streaming or Quest playback capture.",
        "The source runtime benchmark is an existing file-generation smoke; this live-dialog report does not execute a voice runtime.",
      ],
    });
  });

  it("passes the live-dialog evidence contract when runtime, stream, WebXR, and controls are all clean", async () => {
    const report = await buildLocalVoiceLiveDialogBenchmarkReport({
      generatedAt: "2026-05-04T20:15:00.000Z",
      runtimeBenchmarkFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json",
      webxrPlaybackObserved: true,
      realLocalVoiceStreamObserved: true,
      firstAudiblePlaybackLatencyMs: 450,
      transcriptRoundTripObserved: true,
      runtimeBenchmark: localVoiceRuntimeBenchmark({
        caveats: [],
        realTimeFactor: 0.7,
      }),
    });

    expect(report.runtimeFit.blockers).toEqual([]);
    expect(report.runtimeStream).toEqual({
      realLocalVoiceStreamObserved: true,
      evidenceSource: "local_voice_runtime_stream",
      firstAudiblePlaybackLatencyMs: 450,
      transcriptRoundTripObserved: true,
      blockers: [],
    });
    expect(report.webxrPlayback.blockers).toEqual([]);
    expect(report.safetyControls.blockers).toEqual([]);
    expect(report.verdict).toMatchObject({
      passed: true,
      readyForLiveDialog: false,
      blockers: [],
    });
  });
});

function localVoiceRuntimeBenchmark(input: {
  caveats: string[];
  realTimeFactor: number;
}): LocalVoiceRuntimeBenchmarkReport {
  return {
    generatedAt: "2026-05-04T15:01:12Z",
    status: "passed_with_caveats",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      voiceInstallApproved: true,
      voiceSafetyReviewApproved: true,
      productionUseAllowed: false,
      generatedAudioCommitted: false,
    },
    runtime: {
      modelId: "microsoft/VibeVoice-Realtime-0.5B",
      device: "mps",
    },
    audio: {
      durationMs: 3466.667,
      sampleRateHz: 24000,
    },
    metrics: {
      realTimeFactor: input.realTimeFactor,
      approxFirstSpeechTokenLatencyMs: 9000,
    },
    verdict: {
      passed: true,
      blockers: [],
      caveats: input.caveats,
    },
  };
}
