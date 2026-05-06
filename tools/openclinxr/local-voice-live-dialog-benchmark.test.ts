import { describe, expect, it } from "vitest";
import {
  buildLocalVoiceLiveDialogBenchmarkReport,
  type LocalRealtimeVoiceModelCacheEvidenceReport,
  type LocalVoiceRuntimeBenchmarkReport,
} from "./local-voice-live-dialog-benchmark.js";

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
        "model_cache:missing_local_realtime_voice_model_cache_evidence_report",
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
      modelCacheEvidenceFile: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
      modelCacheEvidence: localRealtimeVoiceModelCacheEvidence({
        ready: true,
        models: [
          {
            model_id: "kyutai/moshiko-mlx-q4",
            ready: true,
            blockers: [],
          },
        ],
        supportDirectories: [
          {
            name: "api-python-backend-venv",
            reason: "runtime_support_venv_not_model_weights",
          },
        ],
      }),
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

  it("surfaces local realtime model cache evidence as a first-class live-dialog blocker", async () => {
    const report = await buildLocalVoiceLiveDialogBenchmarkReport({
      generatedAt: "2026-05-05T22:45:00.000Z",
      runtimeBenchmarkFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-05.json",
      runtimeBenchmark: localVoiceRuntimeBenchmark({
        caveats: [],
        realTimeFactor: 0.7,
      }),
      modelCacheEvidenceFile: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
      modelCacheEvidence: localRealtimeVoiceModelCacheEvidence({
        ready: false,
        models: [],
        supportDirectories: [
          {
            name: "api-python-backend-venv",
            reason: "runtime_support_venv_not_model_weights",
          },
        ],
      }),
      webxrPlaybackObserved: true,
      realLocalVoiceStreamObserved: true,
      firstAudiblePlaybackLatencyMs: 450,
      transcriptRoundTripObserved: true,
    });

    expect(report.modelCache).toMatchObject({
      evidenceFile: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
      generatedAt: "2026-05-05T22:27:38.731Z",
      kind: "local_voice_evidence_check",
      claimScope: "cache_inventory_only",
      approvedModelIds: [
        "kyutai/moshiko-mlx-q4",
        "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
      ],
      cacheExists: true,
      ready: false,
      readyModelIds: [],
      supportRuntimeObserved: true,
      blockers: [
        "approved_model_weights_not_cached",
        "real_moshi_or_qwen3_model_cache_missing",
      ],
    });
    expect(report.verdict).toMatchObject({
      passed: false,
      readyForLiveDialog: false,
      blockers: [
        "model_cache:approved_model_weights_not_cached",
        "model_cache:real_moshi_or_qwen3_model_cache_missing",
      ],
    });
  });

  it("rejects ready local realtime model cache evidence when the ready model is not approved", async () => {
    const report = await buildLocalVoiceLiveDialogBenchmarkReport({
      generatedAt: "2026-05-05T22:45:00.000Z",
      runtimeBenchmarkFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-05.json",
      runtimeBenchmark: localVoiceRuntimeBenchmark({
        caveats: [],
        realTimeFactor: 0.7,
      }),
      modelCacheEvidenceFile: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
      modelCacheEvidence: localRealtimeVoiceModelCacheEvidence({
        ready: true,
        models: [
          {
            model_id: "unapproved-lab/experimental-voice",
            approved: false,
            ready: true,
            blockers: [],
          },
        ],
        supportDirectories: [
          {
            name: "api-python-backend-venv",
            reason: "runtime_support_venv_not_model_weights",
          },
        ],
      }),
      webxrPlaybackObserved: true,
      realLocalVoiceStreamObserved: true,
      firstAudiblePlaybackLatencyMs: 450,
      transcriptRoundTripObserved: true,
    });

    expect(report.modelCache).toMatchObject({
      ready: false,
      readyModelIds: [],
      blockers: [
        "model:unapproved-lab/experimental-voice:not_in_approved_model_ids",
        "model:unapproved-lab/experimental-voice:not_marked_approved",
        "real_moshi_or_qwen3_model_cache_missing",
      ],
    });
    expect(report.verdict.blockers).toEqual([
      "model_cache:model:unapproved-lab/experimental-voice:not_in_approved_model_ids",
      "model_cache:model:unapproved-lab/experimental-voice:not_marked_approved",
      "model_cache:real_moshi_or_qwen3_model_cache_missing",
    ]);
  });

  it("rejects ready local realtime model cache evidence when the ready model approval flag is missing", async () => {
    const report = await buildLocalVoiceLiveDialogBenchmarkReport({
      generatedAt: "2026-05-05T22:45:00.000Z",
      runtimeBenchmarkFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-05.json",
      runtimeBenchmark: localVoiceRuntimeBenchmark({
        caveats: [],
        realTimeFactor: 0.7,
      }),
      modelCacheEvidenceFile: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
      modelCacheEvidence: localRealtimeVoiceModelCacheEvidence({
        ready: true,
        models: [
          {
            model_id: "kyutai/moshiko-mlx-q4",
            approved: undefined,
            ready: true,
            blockers: [],
          },
        ],
        supportDirectories: [
          {
            name: "api-python-backend-venv",
            reason: "runtime_support_venv_not_model_weights",
          },
        ],
      }),
      webxrPlaybackObserved: true,
      realLocalVoiceStreamObserved: true,
      firstAudiblePlaybackLatencyMs: 450,
      transcriptRoundTripObserved: true,
    });

    expect(report.modelCache).toMatchObject({
      ready: false,
      readyModelIds: [],
      blockers: [
        "model:kyutai/moshiko-mlx-q4:not_marked_approved",
        "real_moshi_or_qwen3_model_cache_missing",
      ],
    });
  });

  it("rejects nonpositive first-audible latency for real local voice stream claims", async () => {
    const report = await buildLocalVoiceLiveDialogBenchmarkReport({
      generatedAt: "2026-05-05T22:45:00.000Z",
      runtimeBenchmarkFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-05.json",
      runtimeBenchmark: localVoiceRuntimeBenchmark({
        caveats: [],
        realTimeFactor: 0.7,
      }),
      modelCacheEvidenceFile: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
      modelCacheEvidence: localRealtimeVoiceModelCacheEvidence({
        ready: true,
        models: [
          {
            model_id: "kyutai/moshiko-mlx-q4",
            ready: true,
            blockers: [],
          },
        ],
        supportDirectories: [
          {
            name: "api-python-backend-venv",
            reason: "runtime_support_venv_not_model_weights",
          },
        ],
      }),
      webxrPlaybackObserved: true,
      realLocalVoiceStreamObserved: true,
      firstAudiblePlaybackLatencyMs: 0,
      transcriptRoundTripObserved: true,
    });

    expect(report.runtimeStream).toMatchObject({
      realLocalVoiceStreamObserved: true,
      evidenceSource: "local_voice_runtime_stream",
      firstAudiblePlaybackLatencyMs: null,
      blockers: ["first_audible_playback_latency_missing"],
    });
    expect(report.verdict.blockers).toContain("runtime_stream:first_audible_playback_latency_missing");
  });

  it("keeps missing local realtime model cache evidence explicit in standalone live-dialog reports", async () => {
    const report = await buildLocalVoiceLiveDialogBenchmarkReport({
      generatedAt: "2026-05-05T22:45:00.000Z",
      runtimeBenchmarkFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-05.json",
      runtimeBenchmark: localVoiceRuntimeBenchmark({
        caveats: [],
        realTimeFactor: 0.7,
      }),
      webxrPlaybackObserved: true,
      realLocalVoiceStreamObserved: true,
      firstAudiblePlaybackLatencyMs: 450,
      transcriptRoundTripObserved: true,
    });

    expect(report.modelCache).toMatchObject({
      evidenceFile: null,
      ready: false,
      readyModelIds: [],
      supportRuntimeObserved: false,
      blockers: ["missing_local_realtime_voice_model_cache_evidence_report"],
    });
    expect(report.verdict).toMatchObject({
      passed: false,
      readyForLiveDialog: false,
      blockers: ["model_cache:missing_local_realtime_voice_model_cache_evidence_report"],
    });
  });

  it("propagates cloud and paid source-runtime policy violations into the live-dialog verdict", async () => {
    const report = await buildLocalVoiceLiveDialogBenchmarkReport({
      generatedAt: "2026-05-05T22:45:00.000Z",
      runtimeBenchmarkFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-05.json",
      runtimeBenchmark: localVoiceRuntimeBenchmark({
        caveats: [],
        realTimeFactor: 0.7,
        cloudApisUsed: true,
        paidApisUsed: true,
      }),
      modelCacheEvidenceFile: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
      modelCacheEvidence: localRealtimeVoiceModelCacheEvidence({
        ready: true,
        models: [
          {
            model_id: "kyutai/moshiko-mlx-q4",
            ready: true,
            blockers: [],
          },
        ],
        supportDirectories: [
          {
            name: "api-python-backend-venv",
            reason: "runtime_support_venv_not_model_weights",
          },
        ],
      }),
      webxrPlaybackObserved: true,
      realLocalVoiceStreamObserved: true,
      firstAudiblePlaybackLatencyMs: 450,
      transcriptRoundTripObserved: true,
    });

    expect(report.policy).toMatchObject({
      cloudApisUsed: true,
      paidApisUsed: true,
    });
    expect(report.safetyControls.blockers).toEqual([
      "cloud_apis_used_in_source_runtime_benchmark",
      "paid_apis_used_in_source_runtime_benchmark",
    ]);
    expect(report.verdict.blockers).toEqual([
      "safety_controls:cloud_apis_used_in_source_runtime_benchmark",
      "safety_controls:paid_apis_used_in_source_runtime_benchmark",
    ]);
  });
});

function localVoiceRuntimeBenchmark(input: {
  caveats: string[];
  realTimeFactor: number;
  cloudApisUsed?: boolean;
  paidApisUsed?: boolean;
}): LocalVoiceRuntimeBenchmarkReport {
  return {
    generatedAt: "2026-05-04T15:01:12Z",
    status: "passed_with_caveats",
    policy: {
      cloudApisUsed: input.cloudApisUsed ?? false,
      paidApisUsed: input.paidApisUsed ?? false,
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

function localRealtimeVoiceModelCacheEvidence(input: {
  ready: boolean;
  models: Array<Partial<LocalRealtimeVoiceModelCacheEvidenceReport["models"][number]> & {
    model_id: string;
    ready: boolean;
    blockers: string[];
  }>;
  supportDirectories: LocalRealtimeVoiceModelCacheEvidenceReport["support_directories"];
}): LocalRealtimeVoiceModelCacheEvidenceReport {
  return {
    kind: "local_voice_evidence_check",
    claim_scope: "cache_inventory_only",
    generatedAt: "2026-05-05T22:27:38.731Z",
    cache_dir: "/Users/patrick/.cache/openclinxr/realtime-voice",
    approved_model_ids: [
      "kyutai/moshiko-mlx-q4",
      "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
    ],
    cache_exists: true,
    ready: input.ready,
    models: input.models.map((model) => ({
      approved: true,
      ...model,
    })),
    support_directories: input.supportDirectories,
  };
}
