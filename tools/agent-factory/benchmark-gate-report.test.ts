import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAssetProductionArtifactEvidenceReport } from "../openclinxr/asset-production-artifact-evidence.js";
import { buildAssetProductionEvidenceLadderReport } from "../openclinxr/asset-production-evidence-ladder.js";
import type { AssetProductionReadinessReport } from "../openclinxr/asset-production-readiness-benchmark.js";
import type { QuestManualPerformanceReport } from "../openclinxr/check-quest-manual-performance.js";
import type { QuestMixedRealityManualReport } from "../openclinxr/check-quest-mixed-reality-manual.js";
import type { LocalMoshiRuntimePackageEvidenceReport } from "../openclinxr/local-moshi-runtime-package-evidence.js";
import type { LocalQwenTtsRuntimeSmokeReport } from "../openclinxr/local-qwen-tts-runtime-smoke.js";
import type { VisualQaEvidence } from "../openclinxr/visual-qa-evidence-check.js";
import {
  buildBenchmarkGateReport,
  isQuestManualPerformanceRawReportPath,
  isQuestMixedRealityManualRawReportPath,
  latestJson,
  latestVisualQaEvidenceJson,
} from "./build-benchmark-gate-report.js";

type BlockerGroup = {
  group_id: string;
  title: string;
  owner: string;
  blockers: string[];
  next_step: string;
};

type BenchmarkGateReport = {
  quest_smoke?: {
    file: string;
    classification: string;
    ready_for_foreground_quest_claim: boolean;
    satisfied_conditions: string[];
    blockers: string[];
  };
  quest_mixed_reality_manual?: {
    file: string;
    input_file: string | null;
    ready_to_claim_mixed_reality_readiness: boolean;
    ready_to_claim_full_vr_readiness: false;
    satisfied_conditions: string[];
    blockers: string[];
    not_evidence_for: string[];
  };
  visual_qa_evidence?: {
    file: string;
    ready_for_adversarial_visual_qa: boolean;
    ready_for_production_runtime: false;
    ready_for_physical_quest_claim: false;
    capture: {
      source?: string;
      artifact_type?: string;
      artifact?: string;
      scenario_id?: string;
      xr_mode?: string;
    };
    blockers: string[];
    allowed_claims: string[];
    not_evidence_for: string[];
  };
  iwsdk_evidence_contract?: {
    file: string;
    generated_at: string;
    status: string;
    ready_for_install_backed_sidecar: boolean;
    ready_for_agent_tooling: boolean;
    ready_for_production_runtime: boolean;
    blockers: string[];
    leadership_posture: {
      statement: string;
      sub_verdicts: Array<{
        area: string;
        status: string;
        blockers: string[];
      }>;
    };
  };
  evidence_freshness?: Array<{
    evidence_id: string;
    file: string | null;
    generated_at: string | null;
    age_hours: number | null;
    max_age_hours: number;
    status: string;
    blockers: string[];
  }>;
  local_runtime_probe?: {
    gates: {
      apiBunRuntime?: {
        status: string;
        blockers: string[];
      };
    };
  };
  asset_production_readiness_benchmark?: {
    input?: {
      localAssetEvidenceFixtureUsed?: boolean;
    };
    generation_evidence?: {
      generatedHumanRiggingObserved: boolean;
      skinClothingProvenanceObserved: boolean;
      medicalEquipmentLibraryObserved: boolean;
      animationRetargetingObserved: boolean;
      placeholderOnly: boolean;
      blockers: string[];
    };
    optimization_evidence?: {
      lodTiersObserved: boolean;
      textureCompressionBudgetObserved: boolean;
      colliderSimplificationObserved: boolean;
      placeholderOnly: boolean;
      blockers: string[];
    };
    station_budget_evidence?: {
      scenarioId: string;
      source: string;
      requiredAssetCount: number;
      placeholderOnly: boolean;
      observed: boolean;
      blockers: string[];
      budget: {
        maxVisibleTriangles: number;
        maxTextureMegabytes: number;
        maxDrawCalls: number;
        totalTriangles: number;
        totalTextureMegabytes: number;
        totalDrawCalls: number;
        blockers: string[];
      };
    };
  };
  asset_production_evidence_ladder?: {
    file: string;
    schema_version: string;
    generated_at: string;
    status: string;
    source_readiness_report: {
      file: string;
      status: string;
      localAssetEvidenceFixtureUsed: boolean;
    };
    summary: {
      totalLaneCount: number;
      observedLaneCount: number;
      contractOnlyLaneCount: number;
      blockedLaneCount: number;
      artifactBackedProductionAssetEvidenceObserved: boolean;
    };
    verdict: {
      passed: boolean;
      readyForProductionAssets: false;
      blockers: string[];
    };
  };
  asset_production_artifact_evidence?: {
    file: string;
    schema_version: string;
    generated_at: string;
    status: string;
    summary: {
      requiredLaneIds: string[];
      observedLaneIds: string[];
      artifactBackedLaneIds: string[];
      placeholderOrFixtureLaneIds: string[];
      missingLaneIds: string[];
      allRequiredLanesObserved: boolean;
      allArtifactFilesMaterialized: boolean;
      artifactBackedProductionEvidenceObserved: boolean;
    };
    verdict: {
      passed: boolean;
      readyForProductionAssets: false;
      blockers: string[];
    };
  };
  asset_capability_job_evidence?: {
    summary: {
      allCapabilitiesObserved: boolean;
      allJobsSucceeded: boolean;
      allManifestsObserved: boolean;
      allLicenseProvenanceObserved: boolean;
      zeroSpendObserved: boolean;
      noExternalNetworkObserved: boolean;
      blockers: string[];
    };
    verdict: {
      passed: boolean;
      readyForProductionAssets: false;
      blockers: string[];
    };
  };
  realtime_voice_transport_spike?: {
    round_trip_latency_ms: number;
    latency_budget: {
      targetMs: number;
      passed: boolean;
    };
    python_backend_verifier: {
      status: string;
      blockers: string[];
    };
    verdict: {
      transportContractPassed: boolean;
      readyForLiveDialog: false;
      blockers: string[];
    };
  };
  local_realtime_voice_model_cache_evidence?: {
    file: string;
    generated_at: string;
    kind: string;
    claim_scope: string | null;
    cache_dir: string;
    approved_model_ids: string[];
    cache_exists: boolean;
    ready: boolean;
    models: Array<{
      model_id: string;
      ready: boolean;
      blockers: string[];
    }>;
    support_directories: Array<{
      name: string;
      reason: string;
    }>;
    blockers: string[];
  };
  local_realtime_voice_model_source_currentness?: {
    file: string;
    generated_at: string;
    ready: boolean;
    models: Array<{
      model_id: string;
      source_revision: string | null;
      local_revision: string | null;
      verdict: {
        passed: boolean;
        blockers: string[];
      };
    }>;
    verdict: {
      passed: boolean;
      blockers: string[];
    };
  };
  local_model_cache_evidence?: {
    file: string;
    generated_at: string;
    kind: string;
    claim_scope: string;
    cache_dir: string;
    approved_model_ids: string[];
    cache_exists: boolean;
    ready: boolean;
    policy: {
      cloudApisUsed: false;
      paidApisUsed: false;
      downloadAttemptedByThisTool: false;
      localRuntimeExecutionAttemptedByThisTool: false;
      productionUseAllowed: false;
    };
    models: Array<{
      model_id: string;
      file_name: string;
      ready: boolean;
      blockers: string[];
      local_revision: string | null;
      main_ref_revision: string | null;
      main_ref_matches_file_revision: boolean | null;
      size_bytes: number;
      sha256: string | null;
    }>;
    blockers: string[];
  };
  local_qwen_tts_runtime_smoke?: {
    file: string;
    generated_at: string;
    kind: string;
    claim_scope: string;
    status: string;
    runtime: {
      modelId: string;
      tool: string;
      toolVersion: string | null;
    };
    verdict: {
      passed: boolean;
      readyForLiveDialog: false;
    };
  };
  local_moshi_runtime_package_evidence?: {
    file: string;
    generated_at: string;
    kind: string;
    claim_scope: string;
    status: string;
    runtime: LocalMoshiRuntimePackageEvidenceReport["runtime"];
    model_cache: LocalMoshiRuntimePackageEvidenceReport["modelCache"];
    verdict: LocalMoshiRuntimePackageEvidenceReport["verdict"];
  };
  blueprint_voice_simulation_spike?: {
    file: string;
    generated_at: string;
    status: string;
    claim_scope: {
      tier0_blueprint_compiler_passed: boolean;
      mock_voice_facade_exercised: boolean;
      tier1_transport_loop_passed: boolean;
      tier2_local_inference_observed: boolean;
      tier3_webxr_observed: boolean;
      ready_for_production: boolean;
    };
    plan_summary: {
      blueprint_id: string;
      scenario_id: string;
      actor_count: number;
      voice_slot_count: number;
      trigger_count: number;
      prewarm_artifact_count: number;
    };
    interaction_evidence: {
      runtime_routing_exercised: boolean;
      multi_character_interruption_exercised: boolean;
      transport_linked_existing_evidence: boolean;
      bun_python_proxy_passed: boolean;
      raw_audio_stored: boolean;
      hidden_facts_exposed_to_learner: boolean;
    };
    blockers: string[];
  };
  godot_quest_voice_evidence?: {
    file: string;
    generated_at: string;
    input_file: string | null;
    ready_for_binary_transport_evidence: boolean;
    ready_for_quest_audio_pipeline_evidence: boolean;
    ready_for_latency_measurement_evidence: boolean;
    ready_for_production_runtime: false;
    ready_for_clinical_voice_claim: false;
    blockers: string[];
    satisfied_conditions: string[];
    not_evidence_for: string[];
    next_steps: string[];
  };
  godot_project_import_check?: {
    file: string;
    generated_at: string;
    project_path: string;
    source_contract: {
      passed: boolean;
      blockers: string[];
      satisfied_conditions: string[];
    };
    godot_import: {
      attempted: boolean;
      status: string;
      blockers: string[];
    };
    verdict: {
      ready_for_source_contract_claim: boolean;
      ready_for_godot_import_claim: boolean;
      ready_for_quest_runtime_claim: false;
      ready_for_voice_runtime_claim: false;
      blockers: string[];
    };
    not_evidence_for: string[];
  };
  api_python_backend_runtime_smoke?: {
    status: string;
    health: {
      ok: boolean;
    };
    capabilities?: {
      ok: boolean;
      modes: Array<{ id: string; status: string }>;
    };
    websocket: {
      connected: boolean;
      binaryEchoObserved: boolean;
    };
    related_local_inference_evidence?: {
      qwen3Tts?: {
        observed: boolean;
        claimScope: string;
        modelId: string;
        realTimeFactor: number | null;
        readyForLiveDialog: false;
        blockers: string[];
      };
    };
    verdict: {
      passed: boolean;
      readyForLiveDialog: false;
      blockers: string[];
    };
  };
  api_bun_websocket_runtime_smoke?: {
    file: string;
    generated_at: string;
    status: string;
    bun: {
      version: string | null;
      revision: string | null;
    };
    health: {
      ok: boolean;
    };
    h3: {
      enabled: false;
      h3_true_enabled: boolean;
      out_of_scope_for_this_smoke: true;
    };
    trace_contexts: {
      pre_vr_trace_interaction: {
        observed: boolean;
        control_frame_types: string[];
      };
      in_vr_trace_interaction: {
        observed: false;
        blocker: string;
      };
    };
    websocket: {
      connected: boolean;
      reconnect_observed: boolean;
      control_ack_observed: boolean;
      audio_metadata_observed: boolean;
      transcript_delta_observed: boolean;
      binary_echo_observed: boolean;
      binary_frames_sent: number;
      binary_bytes_sent: number;
      server_errors: string[];
    };
    verdict: {
      smoke_passed: boolean;
      ready_for_live_dialog: false;
      blockers: string[];
    };
  };
  api_bun_python_proxy_runtime_smoke?: {
    file: string;
    generated_at: string;
    status: string;
    python_backend: {
      health_ok: boolean;
    };
    bun_gateway: {
      health_ok: boolean;
      backend_url_configured: boolean;
    };
    websocket: {
      connected: boolean;
      backend_protocol_observed: boolean;
      latency_fields_observed: boolean;
      binary_echo_observed: boolean;
      binary_messages: number;
      event_types_observed: string[];
      error_messages: string[];
    };
    verdict: {
      smoke_passed: boolean;
      ready_for_live_dialog: false;
      blockers: string[];
    };
  };
  evidence_gates: Array<{
    evidence_id: string;
    ready_to_resolve?: boolean;
    satisfied_conditions?: string[];
    blockers: string[];
    blocker_summary?: {
      distinct_problem_count?: number;
      total_blockers?: number;
      groups: BlockerGroup[];
    };
  }>;
};

function expectNoUnresolvedLocalRuntimeSelectionBlockers(blockers: readonly string[] | undefined): void {
  expect(blockers ?? []).not.toEqual(expect.arrayContaining([
    "local_model:model_weights_not_selected_or_benchmarked",
    "local_voice:voice_model_not_selected_or_benchmarked",
    "local_model_benchmark:runtime_not_ready",
    "local_voice_benchmark:runtime_not_ready",
    "missing_local_model_runtime_benchmark_report",
    "missing_local_voice_runtime_benchmark_report",
  ]));
}

function passedApiBunWebSocketRuntimeSmoke(): Parameters<typeof buildBenchmarkGateReport>[0]["apiBunWebSocketRuntimeSmoke"] {
  return {
    file: "docs/openclinxr/api-bun-websocket-runtime-smoke-2026-05-05.json",
    value: {
      generatedAt: "2026-05-05T16:45:35.909Z",
      status: "passed",
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        modelDownloadsUsed: false,
        http3Enabled: false,
        webTransportUsed: false,
        quicUsed: false,
        web3Used: false,
        questHardwareClaimed: false,
        productionUseAllowed: false,
        lowLatencyClaimed: false,
      },
      bun: {
        executable: "/Users/patrick/.bun/bin/bun",
        version: "1.3.13",
        revision: "1.3.13+bf2e2cecf",
      },
      runtime: {
        target: "apps/api bun+hono",
        appPath: "apps/api",
        websocketPath: "/voice/realtime/ws",
        h3: {
          enabled: false,
          h3TrueEnabled: false,
          optionPresentInServerSource: false,
          outOfScopeForThisSmoke: true,
        },
      },
      server: {
        attempted: true,
        command: ["/Users/patrick/.bun/bin/bun", "src/bun-server.ts"],
        port: 4322,
        stdout: ["OpenClinXR Bun/Hono API listening on http://localhost:4322/"],
        stderr: [],
      },
      health: {
        attempted: true,
        ok: true,
        statusCode: 200,
        latencyMs: 336,
        body: { ok: true, service: "openclinxr-api" },
      },
      traceContexts: {
        preVrTraceInteraction: {
          observed: true,
          source: "synthetic_local_websocket_control_frame",
          controlFrameTypes: ["voice.start"],
        },
        inVrTraceInteraction: {
          observed: false,
          blocker: "in_vr_trace_not_executed_by_local_bun_smoke",
        },
      },
      websocket: {
        attempted: true,
        connected: true,
        reconnectObserved: true,
        openLatencyMs: 4,
        firstReadyLatencyMs: 5,
        controlAckLatencyMs: 5,
        firstBinaryEchoLatencyMs: 5,
        jsonMessages: 21,
        binaryMessages: 9,
        eventTypesObserved: ["gateway.ready", "control.ack", "audio.metadata", "transcript.delta"],
        controlFrameTypesSent: ["voice.start"],
        binaryFramesSent: 9,
        binaryBytesSent: 2054,
        closeCode: 1000,
        reconnectCloseCode: 1000,
        controlAckObserved: true,
        audioMetadataObserved: true,
        transcriptDeltaObserved: true,
        binaryEchoObserved: true,
        serverErrors: [],
        protocolContract: {
          gatewayReadyLocalEchoObserved: true,
          gatewayReadyLiveDialogDisabledObserved: true,
          canonicalVoiceStartAckObserved: true,
          sanitizedControlPayloadObserved: true,
          localClientObservationOnly: true,
        },
        protocolBoundary: {
          malformedJsonFramesSent: 1,
          malformedJsonControlRejected: true,
          unsupportedControlFrameTypesSent: ["voice.unsupported_local_smoke_probe"],
          unsupportedControlRejected: true,
          errorReasonsObserved: ["invalid_json_control_frame", "unsupported_control_type"],
          localClientObservationOnly: true,
        },
        backpressure: {
          burstFrameCount: 8,
          burstBytes: 2048,
          maxBufferedAmount: 0,
          bufferedAmountSamples: [0, 0, 0],
          droppedOrErroredMessages: 0,
          localClientObservationOnly: true,
        },
      },
      runtimeEvidenceBlockers: [],
      verdict: {
        smokePassed: true,
        readyForLiveDialog: false,
        blockers: [
          "in_vr_trace_not_executed_by_local_bun_smoke",
          "quest_browser_audio_capture_not_observed",
          "quest_playback_not_observed",
          "opus_media_path_not_verified",
          "real_model_inference_not_observed",
          "production_ingress_not_verified",
          "clinical_voice_safety_not_exercised",
          "low_latency_claim_not_supported_by_local_smoke",
        ],
        caveats: [
          "This smoke proves local Bun server WebSocket upgrade and bidirectional frame handling only.",
        ],
      },
    },
  };
}

function passedApiBunPythonProxyRuntimeSmoke(): Parameters<typeof buildBenchmarkGateReport>[0]["apiBunPythonProxyRuntimeSmoke"] {
  return {
    file: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
    value: {
      generatedAt: "2026-05-05T18:21:30.330Z",
      status: "passed",
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        modelDownloadsUsed: false,
        http3Enabled: false,
        webTransportUsed: false,
        quicUsed: false,
        web3Used: false,
        questHardwareClaimed: false,
        productionUseAllowed: false,
        lowLatencyClaimed: false,
      },
      python: {
        executable: "/Users/patrick/.cache/openclinxr/realtime-voice/api-python-backend-venv/bin/python",
        version: "Python 3.11.4",
      },
      bun: {
        executable: "/Users/patrick/.bun/bin/bun",
        version: "1.3.13",
        revision: "1.3.13+bf2e2cecf",
      },
      runtime: {
        apiTarget: "apps/api bun+hono",
        pythonBackendTarget: "apps/arena/api-python-backend fastapi",
        websocketPath: "/voice/realtime/ws",
        backendProtocol: "python-fastapi-compatible-websocket",
      },
      pythonBackend: {
        attempted: true,
        port: 8767,
        healthOk: true,
        stdout: [],
        stderr: [],
      },
      bunGateway: {
        attempted: true,
        port: 4327,
        healthOk: true,
        backendUrlConfigured: true,
        stdout: ["OpenClinXR Bun/Hono API listening on http://localhost:4327/"],
        stderr: [],
      },
      bunGatewayPosture: {
        attempted: true,
        fetched: true,
        httpStatus: 200,
        pythonFastApiStatus: "source_present_not_executed",
        pythonBackendTransportProxyStatus: "configured_not_verified",
        pythonBackendTransportProxyConfigured: true,
        readyForLiveDialog: false,
        transportProxyBlockers: [
          "python_backend_proxy_reachability_not_claimed_by_posture_endpoint",
          "real_model_inference_not_observed",
        ],
        pythonBackendBlockers: [
          "fastapi_uvicorn_websockets_not_installed",
          "mlx_moshi_or_qwen3_tts_not_installed",
        ],
      },
      websocket: {
        attempted: true,
        connected: true,
        eventTypesObserved: [
          "gateway.ready",
          "backend.ready",
          "voice.started",
          "audio.chunk",
          "transcript.partial",
          "transcript.final",
          "voice.stopped",
        ],
        binaryMessages: 1,
        backendProtocolObserved: true,
        latencyFieldsObserved: true,
        binaryEchoObserved: true,
        errorMessages: [],
      },
      runtimeEvidenceBlockers: [],
      postureEvidencePromotion: {
        eligible: true,
        promotedTransportProxyStatus: "configured_reachability_verified",
        environment: {
          backendUrlVariable: "OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL",
          evidenceFileVariable: "OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE",
        },
        instructions: [
          "Set OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE to this passed smoke report JSON file before starting a later Bun/Hono API process.",
        ],
        blockers: [],
        caveats: [
          "The live smoke fetches the posture endpoint before this report is written, so the current process can truthfully remain configured_not_verified.",
        ],
      },
      verdict: {
        smokePassed: true,
        readyForLiveDialog: false,
        blockers: [
          "real_model_inference_not_observed",
          "quest_browser_audio_capture_not_observed",
          "quest_playback_not_observed",
          "opus_codec_not_verified",
          "clinical_voice_safety_not_exercised",
          "production_ingress_not_verified",
          "low_latency_claim_not_supported_by_local_smoke",
        ],
        caveats: ["This smoke proves only the local Bun-to-FastAPI WebSocket proxy path."],
      },
    },
  };
}

type LocalRealtimeVoiceModelCacheEvidenceInput = {
  file: string;
  value: {
    generatedAt: string;
    kind: string;
    claim_scope?: string;
    cache_dir: string;
    approved_model_ids: string[];
    cache_exists: boolean;
    ready: boolean;
    models: Array<{
      model_id: string;
      path: string;
      source_type: string;
      expected_storage_name: string | null;
      approved: boolean;
      has_evidence: boolean;
      ready: boolean;
      blockers: string[];
      file_count: number;
      total_bytes: number;
      local_revision?: string | null;
      metadata_revision_file_count?: number;
      metadata_revision_consistent?: boolean;
      evidence?: Record<string, unknown>;
    }>;
    support_directories: Array<{
      path: string;
      name: string;
      reason: string;
      file_count: number;
      total_bytes: number;
    }>;
  };
};

type LocalRealtimeVoiceModelSourceCurrentnessInput = {
  file: string;
  value: {
    kind: "local_realtime_voice_model_source_currentness_check";
    generatedAt: string;
    ready: boolean;
    metadata_file: string;
    cache_evidence_file: string;
    models: Array<{
      model_id: string;
      source_revision: string | null;
      local_revision: string | null;
      license: {
        source: string | null;
        expected: "cc-by-4.0" | "apache-2.0";
        accepted: boolean;
      };
      files: {
        required: string[];
        listed_by_source: boolean;
      };
      cache: {
        cached: boolean;
        ready: boolean;
        metadata_revision_consistent: boolean;
      };
      verdict: {
        passed: boolean;
        blockers: string[];
      };
    }>;
    verdict: {
      passed: boolean;
      blockers: string[];
    };
  };
};

type LocalModelCacheEvidenceInput = {
  file: string;
  value: {
    generatedAt: string;
    kind: "local_model_evidence_check";
    claim_scope: "cache_inventory_only";
    cache_dir: string;
    approved_model_ids: string[];
    cache_exists: boolean;
    ready: boolean;
    policy: {
      cloudApisUsed: false;
      paidApisUsed: false;
      downloadAttemptedByThisTool: false;
      localRuntimeExecutionAttemptedByThisTool: false;
      productionUseAllowed: false;
    };
    models: Array<{
      model_id: string;
      path: string;
      source_type: "local_cache_snapshot";
      expected_storage_name: string;
      file_name: string;
      license: string;
      source_id: string;
      approved: true;
      has_evidence: boolean;
      ready: boolean;
      blockers: string[];
      local_revision: string | null;
      main_ref_revision: string | null;
      main_ref_matches_file_revision: boolean | null;
      size_bytes: number;
      sha256: string | null;
    }>;
  };
};

type LocalQwenTtsRuntimeSmokeInput = {
  file: string;
  value: LocalQwenTtsRuntimeSmokeReport;
};

type LocalMoshiRuntimePackageEvidenceInput = {
  file: string;
  value: LocalMoshiRuntimePackageEvidenceReport;
};

function missingRealtimeVoiceModelCacheEvidence(): LocalRealtimeVoiceModelCacheEvidenceInput {
  return {
    file: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
    value: {
      generatedAt: "2026-05-05T18:30:00.000Z",
      kind: "local_voice_evidence_check",
      claim_scope: "cache_inventory_only",
      cache_dir: "/Users/patrick/.cache/openclinxr/realtime-voice",
      approved_model_ids: [
        "kyutai/moshiko-mlx-q4",
        "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
      ],
      cache_exists: true,
      ready: false,
      models: [],
      support_directories: [
        {
          path: "/Users/patrick/.cache/openclinxr/realtime-voice/api-python-backend-venv",
          name: "api-python-backend-venv",
          reason: "runtime_support_venv_not_model_weights",
          file_count: 2494,
          total_bytes: 45304743,
        },
      ],
    },
  };
}

function readyRealtimeVoiceModelCacheEvidence(): LocalRealtimeVoiceModelCacheEvidenceInput {
  return {
    file: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
    value: {
      ...missingRealtimeVoiceModelCacheEvidence().value,
      ready: true,
      models: [
        {
          model_id: "kyutai/moshiko-mlx-q4",
          path: "/Users/patrick/.cache/openclinxr/realtime-voice/kyutai__moshiko-mlx-q4",
          source_type: "local_source_copy",
          expected_storage_name: "kyutai__moshiko-mlx-q4",
          approved: true,
          has_evidence: true,
          ready: true,
          blockers: [],
          file_count: 3,
          total_bytes: 123456,
          local_revision: "18e4df760a34d5977a34517d7d1580e07acbb2f1",
          metadata_revision_file_count: 5,
          metadata_revision_consistent: true,
          evidence: {
            model_id: "kyutai/moshiko-mlx-q4",
            source_type: "local_source_copy",
          },
        },
      ],
    },
  };
}

function missingLocalModelCacheEvidence(): LocalModelCacheEvidenceInput {
  return {
    file: "docs/openclinxr/local-model-cache-evidence-2026-05-06.json",
    value: {
      generatedAt: "2026-05-06T22:00:00.000Z",
      kind: "local_model_evidence_check",
      claim_scope: "cache_inventory_only",
      cache_dir: "/Users/patrick/.cache/huggingface/hub",
      approved_model_ids: ["Qwen/Qwen3-4B-GGUF"],
      cache_exists: true,
      ready: false,
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        downloadAttemptedByThisTool: false,
        localRuntimeExecutionAttemptedByThisTool: false,
        productionUseAllowed: false,
      },
      models: [],
    },
  };
}

function readyRealtimeVoiceModelSourceCurrentness(): LocalRealtimeVoiceModelSourceCurrentnessInput {
  return {
    file: "docs/openclinxr/local-realtime-voice-model-source-currentness-2026-05-06.json",
    value: {
      kind: "local_realtime_voice_model_source_currentness_check",
      generatedAt: "2026-05-05T18:35:00.000Z",
      ready: true,
      metadata_file: "docs/openclinxr/local-realtime-voice-model-source-metadata-2026-05-06.json",
      cache_evidence_file: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
      models: [
        {
          model_id: "kyutai/moshiko-mlx-q4",
          source_revision: "18e4df760a34d5977a34517d7d1580e07acbb2f1",
          local_revision: "18e4df760a34d5977a34517d7d1580e07acbb2f1",
          license: {
            source: "cc-by-4.0",
            expected: "cc-by-4.0",
            accepted: true,
          },
          files: {
            required: ["model.q4.safetensors"],
            listed_by_source: true,
          },
          cache: {
            cached: true,
            ready: true,
            metadata_revision_consistent: true,
          },
          verdict: {
            passed: true,
            blockers: [],
          },
        },
      ],
      verdict: {
        passed: true,
        blockers: [],
      },
    },
  };
}

function readyLocalModelCacheEvidence(): LocalModelCacheEvidenceInput {
  return {
    file: "docs/openclinxr/local-model-cache-evidence-2026-05-06.json",
    value: {
      ...missingLocalModelCacheEvidence().value,
      ready: true,
      models: [
        {
          model_id: "Qwen/Qwen3-4B-GGUF",
          path: "/Users/patrick/.cache/huggingface/hub/models--Qwen--Qwen3-4B-GGUF/snapshots/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf",
          source_type: "local_cache_snapshot",
          expected_storage_name: "models--Qwen--Qwen3-4B-GGUF",
          file_name: "Qwen3-4B-Q4_K_M.gguf",
          license: "Apache-2.0",
          source_id: "src-qwen3-4b-gguf-2026",
          approved: true,
          has_evidence: true,
          ready: true,
          blockers: [],
          local_revision: "bc640142c66e1fdd12af0bd68f40445458f3869b",
          main_ref_revision: "bc640142c66e1fdd12af0bd68f40445458f3869b",
          main_ref_matches_file_revision: true,
          size_bytes: 2497280256,
          sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
        },
      ],
    },
  };
}

function passedQwenTtsRuntimeSmoke(): LocalQwenTtsRuntimeSmokeInput {
  return {
    file: "docs/openclinxr/local-qwen-tts-runtime-smoke-2026-05-06.json",
    value: {
      kind: "local_qwen_tts_runtime_smoke",
      claim_scope: "local_tts_inference_only",
      generatedAt: "2026-05-05T18:32:00.000Z",
      status: "passed_with_caveats",
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        productionUseAllowed: false,
        generatedAudioCommitted: false,
        fullDuplexClaimAllowed: false,
        clinicalValidityClaimAllowed: false,
        runtimeExecutionObserved: true,
        downloadAttemptedByThisTool: false,
        networkAccessObservedByThisTool: false,
      },
      runtime: {
        modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
        modelLicense: "Apache-2.0",
        sourceRecordIds: [
          "src-qwen3-tts-mlx-4bit-2026",
          "src-mlx-audio-pypi-2026",
        ],
        tool: "mlx-audio",
        toolVersion: "0.3.0",
        toolLicense: "MIT",
        pythonVersion: "3.11.4",
        exitStatus: 0,
        command: "/Users/patrick/.cache/openclinxr/realtime-voice/api-python-backend-venv/bin/python -m mlx_audio.tts.generate",
      },
      input: {
        text: "The patient reports chest pressure and needs help now.",
        textLength: 48,
        referenceAudioUsed: false,
      },
      audio: {
        outputPath: "/Users/patrick/.cache/openclinxr/realtime-voice/qwen-smoke/out.wav",
        sha256: "0".repeat(64),
        codec: "pcm_s16le",
        durationMs: 1200,
        sampleRateHz: 24000,
        channels: 1,
        sizeBytes: 57644,
        bitRate: 384000,
      },
      metrics: {
        wallClockMs: 420,
        audioDurationMs: 1200,
        realTimeFactor: 0.35,
        maxResidentSetBytes: 123456,
        approxFirstAudiblePlaybackLatencyMs: null,
      },
      modelCache: {
        evidenceKind: "local_voice_evidence_check",
        evidenceGeneratedAt: "2026-05-05T18:30:00.000Z",
        cacheDir: "/Users/patrick/.cache/openclinxr/realtime-voice",
        ready: true,
        readyModelObserved: true,
        readyModelIds: ["mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit"],
        blockers: [],
      },
      verdict: {
        passed: true,
        readyForLiveDialog: false,
        blockers: [],
        caveats: [
          "This is local outbound TTS file-generation evidence only; it is not full-duplex ASR/dialog evidence.",
        ],
      },
    },
  };
}

function passedMoshiRuntimePackageEvidence(): LocalMoshiRuntimePackageEvidenceInput {
  return {
    file: "docs/openclinxr/local-moshi-runtime-package-evidence-2026-05-06.json",
    value: {
      kind: "local_moshi_runtime_package_evidence",
      claim_scope: "runtime_package_import_only",
      generatedAt: "2026-05-05T18:33:00.000Z",
      status: "passed_with_caveats",
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        productionUseAllowed: false,
        generatedAudioCommitted: false,
        runtimeInferenceObserved: false,
        microphonePlaybackObserved: false,
        downloadAttemptedByThisTool: false,
        networkAccessObservedByThisTool: false,
      },
      runtime: {
        modelId: "kyutai/moshiko-mlx-q4",
        modelLicense: "CC-BY-4.0",
        sourceRecordIds: ["src-moshiko-mlx-q4-2026"],
        venvPath: "/Users/patrick/.cache/openclinxr/realtime-voice/moshi-mlx-venv",
        venvBytes: null,
        packageVersions: {
          moshi_mlx: "0.3.0",
          mlx: "0.26.5",
          "mlx-metal": "0.26.5",
        },
        importResults: {
          moshi_mlx: { ok: true },
          "mlx.core": { ok: true },
        },
        entrypoints: ["moshi-local-web", "moshi-local"],
        commandHelp: "usage: moshi-local [-h]",
      },
      modelCache: {
        evidenceFile: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json",
      },
      verdict: {
        passed: true,
        readyForLiveDialog: false,
        blockers: [],
        caveats: [
          "Moshi package imports and CLI entrypoints are evidence of isolated runtime availability only; no model inference, microphone capture, or playback loop ran.",
        ],
      },
    },
  };
}

function passedApiPythonBackendRuntimeSmokeWithQwenEvidence(): NonNullable<Parameters<typeof buildBenchmarkGateReport>[0]["apiPythonBackendRuntimeSmoke"]> {
  return {
    file: "docs/openclinxr/api-python-backend-runtime-smoke-2026-05-06.json",
    value: {
      generatedAt: "2026-05-06T09:30:00.000Z",
      status: "passed",
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        modelDownloadsUsed: false,
        committedGeneratedAudio: false,
        productionUseAllowed: false,
      },
      python: {
        executable: "/Users/patrick/.cache/openclinxr/realtime-voice/api-python-backend-venv/bin/python",
        version: "Python 3.11.4",
        dependencies: {
          fastapi: "available",
          uvicorn: "available",
          websockets: "available",
        },
        missingPackages: [],
      },
      server: {
        attempted: true,
        command: ["python", "-m", "uvicorn"],
        port: 8765,
        stdout: [],
        stderr: [],
      },
      health: {
        attempted: true,
        ok: true,
        statusCode: 200,
        latencyMs: 10,
        body: { status: "ok" },
      },
      capabilities: {
        attempted: true,
        ok: true,
        statusCode: 200,
        latencyMs: 11,
        modes: [
          { id: "transport-echo", status: "ready", blockers: [] },
          { id: "moshi-mlx", status: "approved_runtime_missing", blockers: ["model_weights_not_installed", "mlx_runtime_not_installed", "real_inference_not_observed"] },
          { id: "qwen3-tts-mlx", status: "approved_runtime_missing", blockers: ["model_weights_not_installed", "mlx_runtime_not_installed", "real_inference_not_observed"] },
        ],
        body: { defaultMode: "transport-echo" },
      },
      websocket: {
        attempted: true,
        connected: true,
        jsonMessages: 5,
        binaryMessages: 1,
        controlAckObserved: true,
        audioMetadataObserved: true,
        transcriptDeltaObserved: true,
        binaryEchoObserved: true,
        latencyMs: 8,
        protocol: {
          websocketPath: "/voice/realtime/ws",
          codec: "opus",
          backendProtocolObserved: true,
          clientControlFrameTypesSent: ["voice.start", "voice.audio_metadata", "voice.stop"],
          serverEventTypesObserved: ["backend.ready", "voice.started", "audio.chunk", "transcript.partial", "transcript.final", "voice.stopped"],
          latencyFieldsObserved: true,
          canonicalProtocolObserved: true,
        },
      },
      relatedLocalInferenceEvidence: {
        qwen3Tts: {
          observed: true,
          claimScope: "local_tts_inference_only",
          modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
          realTimeFactor: 1.96,
          readyForLiveDialog: false,
          blockers: [],
        },
      },
      verdict: {
        passed: true,
        readyForLiveDialog: false,
        blockers: [],
        caveats: [
          "Qwen3-TTS local inference has separate file-generation evidence, but the FastAPI backend is still transport-echo only and does not execute that model.",
        ],
      },
    },
  };
}

function binaryOnlyGodotQuestVoiceEvidence(): Parameters<typeof buildBenchmarkGateReport>[0]["godotQuestVoiceEvidence"] {
  return {
    file: "docs/openclinxr/godot-quest-voice-evidence-2026-05-06.json",
    value: {
      generatedAt: "2026-05-06T09:00:00.000Z",
      inputFile: "docs/openclinxr/godot-quest-voice-evidence-raw-2026-05-06.json",
      evidence: {
        schemaVersion: "openclinxr.godot-quest-voice-evidence.v1",
        classification: {
          lane: "godot_quest_voice_transport",
          scope: "physical_quest_developer_evidence",
          notEvidenceFor: [
            "production_voice_runtime_readiness",
            "clinical_voice_dialog_quality",
            "grok_voice_parity",
            "webxr_client_readiness",
            "low_latency_voice_readiness",
          ],
        },
        device: {
          app: "apps/arena/ui-quest-voice-godot",
          performedOnPhysicalQuest3: true,
          headsetConnectedViaUsbC: true,
          godotVersion: "4.5.1",
          buildProfile: "debug",
        },
        gateway: {
          endpoint: "ws://localhost:4322/voice/realtime/ws",
          serverRuntime: "bun_hono_gateway",
          cloudApisUsed: false,
          paidApisUsed: false,
          http3Enabled: false,
          webTransportUsed: false,
          quicUsed: false,
          web3Used: false,
        },
        transport: {
          webSocketConnected: true,
          jsonControlFramesObserved: ["voice.start", "voice.audio_metadata", "voice.stop"],
          binaryPacketsSent: 12,
          binaryPacketsReceived: 12,
          binaryRoundTripObserved: true,
          firstBinaryRoundTripLatencyMs: 18,
          reconnects: 0,
        },
        audio: {
          microphoneCaptureObserved: false,
          opusEncodeDecodeObserved: false,
          playbackObserved: false,
          codec: "opus",
          sampleRateHz: 48_000,
        },
        latency: {
          endToEndLatencyMs: {
            firstPacket: null,
            p50: null,
            p95: null,
            sampleCount: 0,
          },
        },
        safety: {
          rawAudioCommitted: false,
          noCloudApis: true,
          noPaidApis: true,
        },
        claims: {
          readyForProductionRuntime: false,
          readyForClinicalVoiceUse: false,
          readyForLowLatencyVoiceClaim: false,
        },
      },
      result: {
        readyForBinaryTransportEvidence: true,
        readyForQuestAudioPipelineEvidence: false,
        readyForLatencyMeasurementEvidence: false,
        readyForProductionRuntime: false,
        readyForClinicalVoiceClaim: false,
        blockers: [
          "quest_microphone_capture_not_observed",
          "opus_encode_decode_not_observed",
          "quest_playback_not_observed",
          "latency_first_packet_missing_or_nonpositive",
          "latency_p50_missing_or_nonpositive",
          "latency_p95_missing_or_nonpositive",
          "latency_p95_less_than_p50",
          "latency_sample_count_under_10",
        ],
        satisfiedConditions: [
          "schema_version_godot_quest_voice_evidence_v1",
          "classification_physical_quest_developer_evidence",
          "physical_quest3_device_recorded",
          "local_websocket_gateway_recorded",
          "binary_websocket_roundtrip_observed",
          "safety_boundaries_preserved",
        ],
        nextSteps: [
          "Record separate Quest microphone capture, Opus encode/decode, and playback observations before claiming audio-pipeline evidence.",
          "Capture at least 10 end-to-end Quest audio latency samples with first-packet, p50, and p95 values.",
        ],
      },
    },
  };
}

function sourceOnlyGodotProjectImportCheck(): Parameters<typeof buildBenchmarkGateReport>[0]["godotProjectImportCheck"] {
  return {
    file: ".agent-factory/godot-project-import-check.json",
    value: {
      generatedAt: "2026-05-06T10:00:00.000Z",
      projectPath: "apps/arena/ui-quest-voice-godot",
      sourceContract: {
        passed: true,
        blockers: [],
        satisfiedConditions: [
          "binary_packet_send_source_observed",
          "forty_eight_khz_sample_rate_declared",
          "godot_4_project_source_observed",
          "json_binary_receive_split_source_observed",
          "mobile_renderer_configured",
          "opus_codec_lane_declared",
          "websocket_peer_source_observed",
        ],
      },
      godotImport: {
        attempted: false,
        status: "skipped_no_godot_binary",
        executable: null,
        exitCode: null,
        stdout: [],
        stderr: [],
        blockers: ["godot_import_not_executed"],
      },
      verdict: {
        readyForSourceContractClaim: true,
        readyForGodotImportClaim: false,
        readyForQuestRuntimeClaim: false,
        readyForVoiceRuntimeClaim: false,
        blockers: [
          "godot_import:not_executed",
          "quest_runtime:not_executed",
          "voice_runtime:not_executed",
        ],
      },
      notEvidenceFor: [
        "physical_quest_voice_runtime",
        "quest_microphone_capture",
        "native_opus_encode_decode",
        "headset_audio_playback",
        "low_latency_voice_readiness",
        "clinical_voice_dialog_quality",
        "production_runtime_readiness",
      ],
      nextSteps: [
        "Provide a local Godot 4 executable with --godot-binary to run the headless import check.",
        "Run the sidecar on the physical Quest 3 before claiming microphone, playback, Opus, latency, or production voice readiness.",
      ],
    },
  };
}

function expectNoNonFreshnessLocalBenchmarkBlockers(blockers: readonly string[] | undefined): void {
  const localBenchmarkBlockers = (blockers ?? []).filter((blocker) =>
    blocker.startsWith("local_model")
    || blocker.startsWith("local_voice")
    || blocker.startsWith("mock_model")
    || blocker.startsWith("mock_voice")
  );
  expect(localBenchmarkBlockers.every((blocker) => blocker.includes(":evidence_stale_over_"))).toBe(true);
}

function healthyQuestRuntimeEvidence(): Record<string, unknown> {
  return {
    textPanelEvidence: {
      panelCount: 3,
      panels: [
        {
          name: "openclinxr.ed-chest-pain.in-vr-clinical-panel",
          lineCount: 4,
          readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
        },
        {
          name: "openclinxr.ed-chest-pain.in-vr-dialogue-panel",
          lineCount: 2,
          readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
        },
        {
          name: "openclinxr.ed-chest-pain.in-vr-input-panel",
          lineCount: 3,
          readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
        },
      ],
    },
    inputEvidence: {
      activeLocomotionSource: "none",
      inputSourceCount: 2,
      inputSourceKinds: ["xr_hand"],
      keyboardVector: { forward: 0, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0, turn: 0 },
    },
    frameStats: {
      framesObserved: 120,
      qualitySource: "webxr_animation_loop",
      renderLoopMode: "webxr_animation_loop_with_preview_fallback",
      latestFrameDeltaMs: 16.7,
      longFrameRatio: 0.02,
    },
  };
}

function healthyQuestFrameSampleEvidence(): Record<string, unknown> {
  return {
    timedOut: false,
    latestFrameAgeMs: 16,
    framesObservedDuringProbe: 120,
    qualitySource: "webxr_animation_loop",
    renderLoopMode: "webxr_animation_loop_with_preview_fallback",
    latestFrameDeltaMs: 16.7,
    longFrameRatio: 0.02,
  };
}

const completedQuestManualPerformanceReport: QuestManualPerformanceReport = {
  generatedAt: "2026-05-04T00:00:00.000Z",
  runContext: {
    performedBy: "xr-systems-architect",
    durationMinutes: 10,
  },
  setup: {
    foregroundPageConfirmed: true,
    devtoolsScreencastDisabled: true,
    extraBrowserWindowsClosed: true,
  },
  station: {
    shellLoaded: true,
    traceInteractionPassed: true,
    traceInteractionAttempt: "runtime_event_observed",
    textReadable: true,
    immersiveSessionStarted: true,
    consoleErrors: [],
  },
  experience: {
    modeId: "full_vr",
    phaseLabel: "Phase 1 Full VR",
    requestedSessionMode: "immersive-vr",
    mixedRealityPassthroughImplemented: false,
    handTrackingPosture: "optional_feature_with_local_mesh_hand_model_and_primitive_fallback",
    locomotionPosture: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
  },
  input: {
    handModelCount: 2,
    handModelStatus: "installed",
    handRepresentationKind: "mesh",
    handInputsObserved: 2,
    locomotionMode: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
    locomotionAttempt: "runtime_event_observed",
    activeLocomotionSource: "xr_gamepad",
    lastLocomotionAtMs: 60_000,
    rigPosition: { x: 0.4, z: -0.2 },
    locomotionDelta: {
      from: { x: 0, z: 0, yawRadians: 0 },
      to: { x: 0.4, z: -0.2, yawRadians: 0.15 },
      delta: { x: 0.4, z: -0.2, yawRadians: 0.15 },
      distanceMeters: 0.447,
      turnRadians: 0.15,
    },
  },
  traceLatencyProxy: {
    source: "xr_controller_select",
    lastTraceTag: "ecg_request",
    lastSelectLatencyMs: 140,
    measuredAtMs: 1234,
    productionControllerLatencySubstitute: false,
  },
  performance: {
    source: "window.__openClinXrFrameStats",
    framesObserved: 600,
    sampleWindowSize: 120,
    firstFrameAtMs: 1000,
    previewFramesObserved: 0,
    immersiveFramesObserved: 600,
    avgFps: 72,
    p95FrameMs: 25,
    minimumObservedFps: 60,
    controllerSelectLatencyMs: 140,
  },
  reproducibility: {
    source: "browser_runtime",
    url: "http://localhost:5173/",
    userAgent: "Mozilla/5.0 (Linux; Android 14; Quest 3) AppleWebKit/537.36 OculusBrowser/40.0.0.0.0 Chrome/120.0.0.0",
    browserVersionHints: {
      oculusBrowser: "40.0.0.0.0",
      chrome: "120.0.0.0",
    },
    app: {
      packageName: "@openclinxr/ui-xr",
      version: "0.1.0",
      gitCommit: "abc1234",
      buildTime: "2026-05-04T00:00:00.000Z",
      mode: "production",
    },
    webXr: {
      navigatorXrPresent: true,
      immersiveVrSupported: true,
      immersiveVrSupportCheckedAtMs: 228.6,
      immersiveArSupported: false,
      immersiveArSupportCheckedAtMs: 228.7,
      supportError: null,
    },
    display: {
      viewportWidth: 2064,
      viewportHeight: 2208,
      screenWidth: 2064,
      screenHeight: 2208,
      devicePixelRatio: 1,
      visibilityState: "visible",
    },
    limitations: [
      "browser_reported_metadata_not_device_firmware_proof",
      "display_refresh_rate_inferred_from_frame_cadence",
    ],
  },
  comfort: {
    motionComfort: "comfortable",
    heatConcern: false,
    batteryDropPercent: 2,
  },
};

const completedQuestTextPanelEvidence = {
  source: "window.__openClinXrTextPanelEvidence",
  panelCount: 3,
  panels: [
    {
      name: "openclinxr.ed-chest-pain.in-vr-clinical-panel",
      lineCount: 4,
      readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
    },
    {
      name: "openclinxr.ed-chest-pain.in-vr-dialogue-panel",
      lineCount: 2,
      readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
    },
    {
      name: "openclinxr.ed-chest-pain.in-vr-input-panel",
      lineCount: 6,
      readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
    },
  ],
};

const completedQuestSceneAssetEvidence = {
  source: "window.__openClinXrSceneAssetEvidence",
  expectedAssetCount: 6,
  loadedCount: 6,
  failedCount: 0,
  pendingCount: 0,
  fallbackActiveCount: 0,
  productionAssetReadinessClaimed: false,
  assets: [
    {
      assetId: "openclinxr.ed-chest-pain.patient-robert-hayes.generated-humanoid",
      assetPath: "/xr-assets/humanoids/neutral-generated-human.glb",
      status: "loaded" as const,
      fallbackActive: false,
    },
    {
      assetId: "openclinxr.ed-chest-pain.nurse-maria-alvarez.generated-humanoid",
      assetPath: "/xr-assets/humanoids/neutral-generated-human.glb",
      status: "loaded" as const,
      fallbackActive: false,
    },
    {
      assetId: "openclinxr.ed-chest-pain.spouse-anna-hayes.generated-humanoid",
      assetPath: "/xr-assets/humanoids/neutral-generated-human.glb",
      status: "loaded" as const,
      fallbackActive: false,
    },
    {
      assetId: "openclinxr.ed-chest-pain.ecg-cart.generated-glb",
      assetPath: "/xr-assets/medical-equipment/ecg-cart-12-lead.glb",
      status: "loaded" as const,
      fallbackActive: false,
    },
    {
      assetId: "openclinxr.ed-chest-pain.iv-pole-with-pump.generated-glb",
      assetPath: "/xr-assets/medical-equipment/iv-pole-with-pump.glb",
      status: "loaded" as const,
      fallbackActive: false,
    },
    {
      assetId: "openclinxr.ed-chest-pain.environment-shell.generated-glb",
      assetPath: "/xr-assets/environment/ed-exam-bay-shell.glb",
      status: "loaded" as const,
      fallbackActive: false,
    },
  ],
};

const completedQuestMixedRealityManualReport: QuestMixedRealityManualReport = {
  schemaVersion: "openclinxr.quest-mixed-reality-manual.v1",
  generatedAt: "2026-05-04T20:45:00.000Z",
  runContext: {
    performedBy: "xr-systems-architect",
    durationMinutes: 10,
    notes: "Operator-approved local Mixed Reality run with no room recording.",
  },
  experience: {
    modeId: "mixed_reality_passthrough",
    requestedSessionMode: "immersive-ar",
    entryGate: "mr=approved",
    mixedRealityPassthroughImplemented: true,
  },
  webXr: {
    navigatorXrPresent: true,
    immersiveArSupported: true,
    immersiveArSupportCheckedAtMs: 250,
    supportError: null,
  },
  entry: {
    operatorApproved: true,
    physicalUserGestureUsed: true,
    sessionStarted: true,
    lastOutcome: "session_started",
    lastError: null,
  },
  passthrough: {
    observed: true,
    transparentBackgroundObserved: true,
    blackSkyboxOrFloorAbsent: true,
    realRoomRecorded: false,
  },
  readability: {
    clinicalTextReadable: true,
    panelsReadable: ["clinical", "dialogue", "input"],
    occlusionIssues: [],
  },
  privacySafety: {
    reviewCompleted: true,
    roomScanOrRecordingAvoided: true,
    bystandersOrPhiVisible: false,
    boundaryComfort: "good",
  },
  performance: {
    source: "window.__openClinXrFrameStats",
    framesObserved: 600,
    immersiveFramesObserved: 600,
    avgFps: 72,
    p95FrameMs: 25,
  },
  comfort: {
    motionComfort: "good",
    heatConcern: false,
    batteryDropPercent: 2,
  },
  notEvidenceFor: [
    "replacement_for_full_vr",
    "production_quest_readiness",
    "passthrough_privacy_readiness",
    "clinical_room_safety_readiness",
  ],
};

const completedVisualQaEvidence: VisualQaEvidence = {
  schemaVersion: "openclinxr.visual-qa-evidence.v1",
  capture: {
    source: "iwer_emulation",
    artifactType: "screenshot",
    artifact: "docs/openclinxr/screenshots/iwer-sidecar-agent-browser-2026-05-04.png",
    mimeType: "image/png",
    dimensions: { width: 500, height: 500 },
    runtimeUrl: "http://127.0.0.1:5183/",
    route: "/",
    scenarioId: "ed_chest_pain_priority_v1",
    xrMode: "desktop_managed_browser_not_immersive_session",
    captureCommand: "pnpm iwsdk:iwer:evidence",
  },
  adversarialReview: {
    reviewers: [
      "test-automation-lead",
      "ux-friction-critic",
      "clinical-safety-critic",
      "xr-systems-architect",
      "asset-pipeline-lead",
    ],
    checks: {
      clinical_scene_fidelity: { status: "concern", notes: ["Clinical fidelity remains placeholder-level."] },
      actor_equipment_realism: { status: "concern", notes: ["Actors and equipment are not production-realistic."] },
      ui_readability: { status: "pass", notes: ["The artifact is usable for adversarial iteration notes."] },
      interaction_affordances: { status: "concern", notes: ["Controller and hand input still require separate evidence."] },
      occlusion_scale: { status: "concern", notes: ["Scale and occlusion need XR scene inspection and Quest confirmation."] },
      evidence_limits: { status: "pass", notes: ["This is IWER evidence, not physical Quest or production proof."] },
    },
  },
  claimBoundaries: {
    notEvidenceFor: [
      "physical_quest_foreground_frame_pacing",
      "quest_controller_latency",
      "quest_hand_tracking_quality",
      "in_headset_text_readability",
      "thermal_or_battery_behavior",
      "production_runtime_readiness",
    ],
    allowedClaims: ["adversarial_visual_iteration_artifact"],
  },
};

describe("benchmark gate report", () => {
  it("selects raw Quest CDP smoke evidence without derived check reports", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openclinxr-quest-smoke-latest-"));
    const rawPath = path.join(tempDir, "quest-cdp-smoke-2026-05-04.json");
    const derivedCheckPath = path.join(tempDir, "quest-cdp-smoke-check-2026-05-04.json");
    await writeFile(rawPath, `${JSON.stringify({ kind: "raw" })}\n`, "utf8");
    await writeFile(derivedCheckPath, `${JSON.stringify({ kind: "check" })}\n`, "utf8");

    const selected = await latestJson<{ kind: string }>(
      `${tempDir}/quest-cdp-smoke-*.json`,
      (filePath) => path.basename(filePath).startsWith("quest-cdp-smoke-2026-"),
    );

    expect(selected).toEqual({
      file: rawPath,
      value: { kind: "raw" },
    });
  });

  it("selects raw Quest manual performance evidence without derived check reports", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openclinxr-quest-manual-latest-"));
    const rawPath = path.join(tempDir, "quest-manual-performance-2026-05-04.json");
    const derivedCheckPath = path.join(tempDir, "quest-manual-performance-check-2026-05-04.json");
    await writeFile(rawPath, `${JSON.stringify({ kind: "raw" })}\n`, "utf8");
    await writeFile(derivedCheckPath, `${JSON.stringify({ kind: "check" })}\n`, "utf8");

    const selected = await latestJson<{ kind: string }>(
      `${tempDir}/quest-manual-performance-*.json`,
      isQuestManualPerformanceRawReportPath,
    );

    expect(selected).toEqual({
      file: rawPath,
      value: { kind: "raw" },
    });
  });

  it("selects copied UI Quest manual performance payloads through the manual evidence path", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openclinxr-quest-manual-copy-latest-"));
    const wrapperPath = path.join(tempDir, "quest-manual-performance-2026-05-05.json");
    const templatePath = path.join(tempDir, "quest-manual-performance-template.json");
    await writeFile(wrapperPath, `${JSON.stringify({
      manualPerformanceDraft: { generatedAt: "2026-05-05T00:00:00.000Z" },
      captureSummary: {
        draftAvailable: true,
        manualValidationReady: true,
        frameStatsFresh: true,
        blockers: [],
      },
    })}\n`, "utf8");
    await writeFile(templatePath, `${JSON.stringify({ kind: "template" })}\n`, "utf8");

    const selected = await latestJson<{ manualPerformanceDraft?: { generatedAt?: string } }>(
      `${tempDir}/quest-manual-performance-*.json`,
      isQuestManualPerformanceRawReportPath,
    );

    expect(selected).toEqual({
      file: wrapperPath,
      value: {
        manualPerformanceDraft: { generatedAt: "2026-05-05T00:00:00.000Z" },
        captureSummary: {
          draftAvailable: true,
          manualValidationReady: true,
          frameStatsFresh: true,
          blockers: [],
        },
      },
    });
  });

  it("selects raw Quest Mixed Reality manual evidence without template or derived check reports", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openclinxr-quest-mr-latest-"));
    const rawPath = path.join(tempDir, "quest-mixed-reality-manual-2026-05-04.json");
    const derivedCheckPath = path.join(tempDir, "quest-mixed-reality-manual-check-2026-05-04.json");
    const templatePath = path.join(tempDir, "quest-mixed-reality-manual-template.json");
    await writeFile(rawPath, `${JSON.stringify({ kind: "raw" })}\n`, "utf8");
    await writeFile(derivedCheckPath, `${JSON.stringify({ kind: "check" })}\n`, "utf8");
    await writeFile(templatePath, `${JSON.stringify({ kind: "template" })}\n`, "utf8");

    const selected = await latestJson<{ kind: string }>(
      `${tempDir}/quest-mixed-reality-manual-*.json`,
      isQuestMixedRealityManualRawReportPath,
    );

    expect(selected).toEqual({
      file: rawPath,
      value: { kind: "raw" },
    });
  });

  it("selects visual QA evidence by embedded capture date instead of descriptor name", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openclinxr-visual-qa-latest-"));
    const olderAlphabeticalPath = path.join(tempDir, "visual-qa-evidence-ui-xr-fresh-frame-evidence-2026-05-04.json");
    const newerPath = path.join(tempDir, "visual-qa-evidence-iwer-auto-entry-wide-panel-depth-2026-05-05.json");
    await writeFile(olderAlphabeticalPath, `${JSON.stringify({ capture: { scenarioId: "older-ui" } })}\n`, "utf8");
    await writeFile(newerPath, `${JSON.stringify({ capture: { scenarioId: "newer-iwer" } })}\n`, "utf8");

    const selected = await latestVisualQaEvidenceJson(`${tempDir}/visual-qa-evidence-*.json`);

    expect(selected).toEqual({
      file: newerPath,
      value: { capture: { scenarioId: "newer-iwer" } },
    });
  });

  it("keeps resolved local runtime selection blockers out of leadership remediation groups", async () => {
    const report = JSON.parse(await readFile(".agent-factory/benchmark-gate-report.json", "utf8")) as BenchmarkGateReport;
    const gate = report.evidence_gates.find((candidate) => candidate.evidence_id === "evidence-leadership-0007-002");

    expectNoUnresolvedLocalRuntimeSelectionBlockers(gate?.blockers);
    expect(gate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_model_runtime_benchmark_passed",
      "local_voice_first_audio_benchmark_passed",
    ]));
    const groups = gate?.blocker_summary?.groups ?? [];

    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group_id: "quest_foreground_frame_pacing",
          owner: "xr-systems-architect",
          blockers: expect.arrayContaining([
            "quest_immersive_entry_activation_not_received",
            "quest_immersive_session_not_started",
            "quest_manual_performance:duration_under_10_minutes",
            "quest_manual_performance:frame_sample_under_600_or_missing",
            "quest_manual_performance:controller_select_latency_ms_above_150_or_missing",
          ]),
        }),
      ]),
    );
    expect(groups.every((group) => group.next_step.length > 0)).toBe(true);
  });

  it("blocks leadership gates when non-IWSDK benchmark evidence is stale", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0],
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      questSmoke: {
        file: "docs/openclinxr/quest-cdp-smoke-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          url: "http://localhost:5173/",
          target: "station",
          adb: {
            version: "Android Debug Bridge version 1.0.41",
            deviceLine: "1234 device product:quest3",
            reverseList: "1234 tcp:5173 tcp:5173",
          },
          browser: {
            userAgent: "Mozilla/5.0 Quest 3",
            hidden: false,
            visibilityState: "visible",
            ...healthyQuestRuntimeEvidence(),
          },
          interaction: {},
          frameSample: healthyQuestFrameSampleEvidence(),
          verdict: {
            shellLoaded: true,
            interactionAdvanced: true,
            frameSampleComplete: true,
            immersiveEntryOutcome: "not_requested",
            blockers: [],
          },
        },
      },
      localRuntime: {
        file: "docs/openclinxr/local-runtime-probe-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            apiBunRuntime: {
              status: "not_configured",
              blockers: ["bun_runtime_not_installed_on_this_machine"],
            },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
      localProviderBenchmark: {
        file: "docs/openclinxr/local-provider-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          mockModel: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          mockVoice: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          localModel: { status: "passed", blockers: [], metrics: {} },
          localVoice: { status: "passed", blockers: [], metrics: {} },
          verdict: {
            deterministicMocksPassed: true,
            localModelReadyToBenchmark: true,
            localVoiceReadyToBenchmark: true,
            blockers: [],
          },
        },
      },
      iwsdkEvidenceContract: {
        file: "docs/openclinxr/iwsdk-evidence-contract-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          status: "contract_only",
          verdict: {
            readyForInstallBackedSidecar: false,
            readyForAgentTooling: false,
            readyForProductionRuntime: false,
            blockers: ["sidecar:operator_accepts_iwsdk_install_scope"],
          },
        },
      },
    }, { now: new Date("2026-05-05T01:00:00.000Z"), maxEvidenceAgeHours: 24 });

    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "quest_smoke",
        status: "stale",
        age_hours: 25,
        blockers: ["quest_smoke:evidence_stale_over_24h"],
      }),
      expect.objectContaining({
        evidence_id: "local_runtime_probe",
        status: "stale",
        age_hours: 25,
        blockers: ["local_runtime_probe:evidence_stale_over_24h"],
      }),
      expect.objectContaining({
        evidence_id: "local_provider_benchmark",
        status: "stale",
        age_hours: 25,
        blockers: ["local_provider_benchmark:evidence_stale_over_24h"],
      }),
    ]));
    expect(report.evidence_freshness?.map((entry) => entry.evidence_id)).not.toContain("iwsdk_evidence_contract");
    expect(report.local_runtime_probe?.gates.apiBunRuntime).toEqual({
      status: "not_configured",
      blockers: ["bun_runtime_not_installed_on_this_machine"],
    });

    expect(report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001")?.blockers).toEqual(
      expect.arrayContaining(["quest_smoke:evidence_stale_over_24h", "local_runtime_probe:evidence_stale_over_24h"]),
    );
    expect(report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-002")?.blockers).not.toEqual(
      expect.arrayContaining(["local_runtime_probe:evidence_stale_over_24h", "local_provider_benchmark:evidence_stale_over_24h"]),
    );
    expect(report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-002")?.blockers).toEqual(
      expect.arrayContaining(["local_runtime_probe:evidence_stale_over_24h", "local_provider_benchmark:evidence_stale_over_24h"]),
    );
    expect(report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-004")?.blockers).toEqual([
      "iwsdk:sidecar:operator_accepts_iwsdk_install_scope",
    ]);
  });

  it("marks benchmark evidence stale as soon as its exact age exceeds the freshness limit", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0],
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;

    const localRuntime = {
      file: "docs/openclinxr/local-runtime-probe-boundary.json",
      value: {
        generatedAt: "2026-05-04T00:00:00.000Z",
        gates: {
          questUsb: { status: "ready", blockers: [] },
          questForegroundPreflight: { status: "ready", blockers: [] },
          apiBunRuntime: { status: "ready", blockers: [] },
          localModel: { status: "ready", blockers: [] },
          localVoice: { status: "ready", blockers: [] },
          assetPipeline: { status: "ready", blockers: [] },
        },
      },
    } satisfies NonNullable<Parameters<typeof buildBenchmarkGateReport>[0]["localRuntime"]>;

    const exactlyAtLimit = buildReport(
      { localRuntime },
      { now: new Date("2026-05-05T00:00:00.000Z"), maxEvidenceAgeHours: 24 },
    );
    const oneMinutePastLimit = buildReport(
      { localRuntime },
      { now: new Date("2026-05-05T00:01:00.000Z"), maxEvidenceAgeHours: 24 },
    );

    expect(exactlyAtLimit.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "local_runtime_probe",
        age_hours: 24,
        status: "fresh",
        blockers: [],
      }),
    ]));
    expect(oneMinutePastLimit.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "local_runtime_probe",
        age_hours: 24,
        status: "stale",
        blockers: ["local_runtime_probe:evidence_stale_over_24h"],
      }),
    ]));
  });

  it("splits iteration 0008 benchmark evidence debt by owner-specific leadership gates", async () => {
    const report = JSON.parse(await readFile(".agent-factory/benchmark-gate-report.json", "utf8")) as BenchmarkGateReport;
    const gatesById = new Map(report.evidence_gates.map((gate) => [gate.evidence_id, gate]));

    expect([...gatesById.keys()].sort()).toEqual([
      "evidence-leadership-0007-002",
      "evidence-leadership-0008-001",
      "evidence-leadership-0008-002",
      "evidence-leadership-0008-003",
      "evidence-leadership-0008-004",
      "evidence-leadership-0009-001",
      "evidence-leadership-0009-002",
      "evidence-leadership-0009-003",
      "evidence-leadership-0009-004",
      "evidence-leadership-0009-005",
    ]);

    expect(gatesById.get("evidence-leadership-0008-001")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "quest_smoke:evidence_stale_over_24h",
        "quest_frame_quality_evidence_missing",
        "quest_immersive_entry_activation_not_received",
        "quest_immersive_session_not_started",
        "quest_manual_performance:duration_under_10_minutes",
        "quest_manual_performance:frame_sample_under_600_or_missing",
        "quest_manual_performance:controller_select_latency_ms_above_150_or_missing",
      ]),
      satisfied_conditions: expect.arrayContaining([
        "performed_by_recorded",
        "immersive_session_started",
        "quest_cdp_frame_sample_complete",
        "quest_page_visible",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0009-001")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "quest_smoke:evidence_stale_over_24h",
        "quest_frame_quality_evidence_missing",
        "quest_immersive_entry_activation_not_received",
        "quest_immersive_session_not_started",
        "quest_manual_performance:duration_under_10_minutes",
        "quest_manual_performance:frame_sample_under_600_or_missing",
        "quest_manual_performance:controller_select_latency_ms_above_150_or_missing",
      ]),
      satisfied_conditions: expect.arrayContaining([
        "performed_by_recorded",
        "immersive_session_started",
        "quest_cdp_frame_sample_complete",
        "quest_page_visible",
      ]),
    }));
    const localModelGate = gatesById.get("evidence-leadership-0008-002");
    expect(localModelGate).toEqual(expect.objectContaining({
      satisfied_conditions: expect.arrayContaining([
        "local_model_ready_to_benchmark",
        "local_model_runtime_benchmark_passed",
      ]),
    }));
    expectNoNonFreshnessLocalBenchmarkBlockers(localModelGate?.blockers);
    expectNoUnresolvedLocalRuntimeSelectionBlockers(localModelGate?.blockers);
    expect(localModelGate?.ready_to_resolve).toBe(true);

    const localVoiceGate = gatesById.get("evidence-leadership-0008-003");
    expect(localVoiceGate).toEqual(expect.objectContaining({
      satisfied_conditions: expect.arrayContaining([
        "local_voice_ready_to_benchmark",
        "local_voice_first_audio_benchmark_passed",
      ]),
    }));
    expectNoNonFreshnessLocalBenchmarkBlockers(localVoiceGate?.blockers);
    expectNoUnresolvedLocalRuntimeSelectionBlockers(localVoiceGate?.blockers);
    expect(localVoiceGate?.ready_to_resolve).toBe(true);

    const assetGate = gatesById.get("evidence-leadership-0008-004");
    expect(assetGate).toEqual(expect.objectContaining({
      satisfied_conditions: expect.arrayContaining([
        "asset_pipeline_blender_bake_smoke_passed",
        "asset_pipeline_gltf_pipeline_smoke_passed",
      ]),
    }));
    expect(assetGate?.ready_to_resolve).toBe(true);
    expect(gatesById.get("evidence-leadership-0009-004")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "iwsdk:agent_tooling:adapter_sync_not_recorded",
        "iwsdk:agent_tooling:mcp_smoke_tool_not_validated_scene_get_hierarchy",
        "iwsdk:agent_tooling:mcp_smoke_tool_not_validated_xr_accept_session",
        "iwsdk:agent_tooling:mcp_smoke_tool_not_validated_xr_select",
        "iwsdk:agent_tooling:scene_hierarchy_required_objects_not_confirmed",
        "iwsdk:agent_tooling:ecs_runtime_not_queryable",
      ]),
      satisfied_conditions: expect.arrayContaining([
        "iwsdk_agent_tooling_local_preflight_ready",
        "iwsdk_evidence_contract_present",
        "iwsdk_install_backed_sidecar_ready",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0009-004")?.blockers).not.toEqual(expect.arrayContaining([
      "iwsdk:agent_tooling:phase2_devtools_not_installed_in_sidecar",
      "iwsdk:agent_tooling:mcp_tool_inventory_count_not_32",
    ]));
    expect(gatesById.get("evidence-leadership-0009-002")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "local_model_quality:target_hardware:target_hardware_not_m1_profile",
      ]),
      satisfied_conditions: expect.arrayContaining([
        "local_model_quality_actor_policy_benchmark_passed",
        "local_model_quality_report_present",
        "local_model_quality_required_keys_present",
        "local_model_runtime_benchmark_passed",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0009-002")?.blockers).not.toEqual(expect.arrayContaining([
      "local_model_quality:structured_output:reasoning_markup_emitted",
      "local_model_quality:structured_output:safety_flags_not_guardrail_labels",
      "local_model_quality:structured_output:schema_grammar_not_enforced",
      "local_model_quality_benchmark:evidence_stale_over_24h",
    ]));
    expect(gatesById.get("evidence-leadership-0009-002")?.blockers).not.toEqual(expect.arrayContaining([
      "local_model_quality:actor_policy:real_local_model_visible_fact_grounding_probe_failed",
    ]));
    expect(gatesById.get("evidence-leadership-0009-003")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "local_voice_live_dialog:runtime_stream:real_local_voice_stream_benchmark_missing",
        "local_voice_live_dialog:runtime:runtime_file_generation_only",
        "local_voice_live_dialog:runtime:real_time_factor_above_1",
        "local_voice_live_dialog:webxr_playback:webxr_playback_not_observed",
      ]),
      satisfied_conditions: expect.arrayContaining([
        "local_voice_first_audio_benchmark_passed",
        "local_voice_live_dialog_mock_stream_passed",
        "local_voice_live_dialog_report_present",
        "local_voice_live_dialog_safety_controls_observed",
      ]),
    }));
    const assetProductionReadinessGate = gatesById.get("evidence-leadership-0009-005");
    expect(assetProductionReadinessGate).toBeDefined();
    expect(assetProductionReadinessGate?.ready_to_resolve).toBe(false);
    expect(assetProductionReadinessGate?.blockers).toBeDefined();
    for (const expectedBlocker of [
      "asset_production:artifact_evidence:artifact_backed_production_asset_evidence_missing",
      "asset_production:not_ready_for_production_assets",
    ]) {
      expect(assetProductionReadinessGate?.blockers).toContain(expectedBlocker);
    }
    expect(assetProductionReadinessGate?.satisfied_conditions).toBeDefined();
    for (const expectedCondition of [
      "asset_pipeline_blender_bake_smoke_passed",
      "asset_pipeline_gltf_pipeline_smoke_passed",
      "asset_pipeline_runtime_ready",
      "asset_production_artifact_evidence_lanes_observed",
      "asset_production_artifact_evidence_manifest_present",
      "asset_production_capability_job_contract_observed",
      "asset_production_multi_actor_quest_budget_observed",
      "asset_production_readiness_report_present",
      "asset_production_source_smokes_passed",
    ]) {
      expect(assetProductionReadinessGate?.satisfied_conditions).toContain(expectedCondition);
    }
    expect(assetProductionReadinessGate?.blocker_summary?.distinct_problem_count).toBe(1);
    expect(assetProductionReadinessGate?.blocker_summary?.total_blockers).toBeGreaterThanOrEqual(1);
    expect(
      assetProductionReadinessGate?.blocker_summary?.groups?.some(
        (group) => group?.group_id === "asset_production_readiness" && group?.owner === "asset-pipeline-lead",
      ),
    ).toBe(true);
    expect(assetProductionReadinessGate?.satisfied_conditions).not.toContain("asset_production_readiness_benchmark_passed");
    expect(report.asset_production_readiness_benchmark?.input).toEqual(expect.objectContaining({
      localAssetEvidenceFixtureUsed: false,
    }));
  });

  it("uses local model quality evidence to replace generic actor-policy blockers with precise findings", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localModelQualityBenchmark?: {
          file: string;
          value: {
            generatedAt: string;
            status: string;
            structuredOutput: {
              requiredKeysPresent: boolean;
              schemaGrammarEnforced: boolean;
              blockers: string[];
            };
            actorPolicy: {
              passed: boolean;
              blockers: string[];
            };
            targetHardware: {
              passed: boolean;
              blockers: string[];
            };
            verdict: {
              passed: boolean;
              blockers: string[];
              caveats: string[];
            };
          };
        };
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      localRuntime: {
        file: "docs/openclinxr/local-runtime-probe-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
      localProviderBenchmark: {
        file: "docs/openclinxr/local-provider-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          mockModel: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          mockVoice: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          localModel: { status: "passed", blockers: [], metrics: {} },
          localVoice: { status: "passed", blockers: [], metrics: {} },
          verdict: {
            deterministicMocksPassed: true,
            localModelReadyToBenchmark: true,
            localVoiceReadyToBenchmark: true,
            blockers: [],
          },
        },
      },
      localModelRuntimeBenchmark: {
        file: "docs/openclinxr/local-model-runtime-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          status: "passed_with_caveats",
          runtime: { device: "MTL0 (Apple M1 Max)" },
          metrics: {},
          output: {},
          verdict: {
            passed: true,
            blockers: [],
            caveats: ["Structured output caveat retained from the runtime smoke."],
          },
        },
      },
      localModelQualityBenchmark: {
        file: "docs/openclinxr/local-model-quality-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          status: "blocked",
          structuredOutput: {
            requiredKeysPresent: true,
            schemaGrammarEnforced: false,
            blockers: ["schema_grammar_not_enforced"],
          },
          actorPolicy: {
            passed: false,
            blockers: [
              "real_local_model_visible_fact_grounding_benchmark_missing",
              "real_local_model_hidden_truth_injection_benchmark_missing",
              "real_local_model_system_prompt_extraction_benchmark_missing",
            ],
          },
          targetHardware: {
            passed: false,
            blockers: ["target_hardware_not_m1_profile"],
          },
          verdict: {
            passed: false,
            blockers: [
              "structured_output:schema_grammar_not_enforced",
              "actor_policy:real_local_model_visible_fact_grounding_benchmark_missing",
              "actor_policy:real_local_model_hidden_truth_injection_benchmark_missing",
              "actor_policy:real_local_model_system_prompt_extraction_benchmark_missing",
              "target_hardware:target_hardware_not_m1_profile",
            ],
            caveats: [],
          },
        },
      },
    }, { now: new Date("2026-05-04T20:05:00.000Z"), maxEvidenceAgeHours: 24 });

    const qualityGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-002");

    expect(qualityGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_model_quality_report_present",
      "local_model_quality_required_keys_present",
    ]));
    expect(qualityGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_model_quality_actor_policy_benchmark_passed",
    ]));
    expect(qualityGate?.blockers).toEqual(expect.arrayContaining([
      "local_model_quality:actor_policy:real_local_model_visible_fact_grounding_benchmark_missing",
      "local_model_quality:actor_policy:real_local_model_hidden_truth_injection_benchmark_missing",
      "local_model_quality:actor_policy:real_local_model_system_prompt_extraction_benchmark_missing",
      "local_model_quality:structured_output:schema_grammar_not_enforced",
      "local_model_quality:target_hardware:target_hardware_not_m1_profile",
    ]));
    expect(qualityGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_model_quality:missing_hidden_truth_actor_policy_benchmark",
      "local_model_quality:actor_policy:real_local_model_actor_policy_benchmark_missing",
      "local_model_quality:missing_schema_grammar_benchmark",
    ]));
  });

  it("surfaces local model cache evidence as a local model quality gate input", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localModelCacheEvidence?: LocalModelCacheEvidenceInput;
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;

    const report = buildReport({
      localModelCacheEvidence: missingLocalModelCacheEvidence(),
    }, { now: new Date("2026-05-06T22:05:00.000Z"), maxEvidenceAgeHours: 24 });
    const qualityGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-002");

    expect(report.local_model_cache_evidence).toMatchObject({
      file: "docs/openclinxr/local-model-cache-evidence-2026-05-06.json",
      kind: "local_model_evidence_check",
      claim_scope: "cache_inventory_only",
      cache_exists: true,
      ready: false,
      models: [],
      blockers: [
        "approved_local_model_cache_missing_or_not_ready",
        "approved_model_weights_not_cached",
      ],
    });
    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "local_model_cache_evidence",
        file: "docs/openclinxr/local-model-cache-evidence-2026-05-06.json",
        status: "fresh",
        blockers: [],
      }),
    ]));
    expect(qualityGate?.blockers).toEqual(expect.arrayContaining([
      "local_model_quality:local_model_cache:approved_local_model_cache_missing_or_not_ready",
      "local_model_quality:local_model_cache:approved_model_weights_not_cached",
    ]));
    expect(qualityGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_model_cache_evidence_present",
    ]));
    expect(qualityGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_model_cache_ready",
    ]));
  });

  it("treats a ready local model cache as a satisfied local model quality condition", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localModelCacheEvidence?: LocalModelCacheEvidenceInput;
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;

    const report = buildReport({
      localModelCacheEvidence: readyLocalModelCacheEvidence(),
    }, { now: new Date("2026-05-06T22:05:00.000Z"), maxEvidenceAgeHours: 24 });
    const qualityGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-002");

    expect(report.local_model_cache_evidence).toMatchObject({
      cache_exists: true,
      ready: true,
      blockers: [],
      models: [
        {
          model_id: "Qwen/Qwen3-4B-GGUF",
          ready: true,
          blockers: [],
          main_ref_matches_file_revision: true,
          sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
        },
      ],
    });
    expect(qualityGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_model_cache_evidence_present",
      "local_model_cache_ready",
    ]));
    expect(qualityGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_model_quality:local_model_cache:approved_local_model_cache_missing_or_not_ready",
      "local_model_quality:local_model_cache:approved_model_weights_not_cached",
      "local_model_quality:local_model_cache:missing_local_model_cache_evidence_report",
    ]));
  });

  it("uses local voice live-dialog evidence to replace generic streaming blockers with precise findings", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localVoiceLiveDialogBenchmark?: {
          file: string;
          value: {
            generatedAt: string;
            status: string;
            mockStream: {
              passed: boolean;
              blockers: string[];
            };
            runtimeFit: {
              blockers: string[];
            };
            webxrPlayback: {
              observed: boolean;
              blockers: string[];
            };
            safetyControls: {
              blockers: string[];
            };
            verdict: {
              passed: boolean;
              blockers: string[];
              caveats: string[];
            };
          };
        };
        realtimeVoiceTransportSpike?: {
          file: string;
          value: {
            generatedAt: string;
            status: string;
            harness: {
              roundTripLatencyMs: number;
              latencyBudget: {
                targetMs: number;
                passed: boolean;
              };
            };
            pythonBackendVerifier: {
              status: string;
              blockers: string[];
            };
            protocolEvidence?: {
              websocketLocalHarnessObserved: boolean;
              bunHonoRuntimeObserved: boolean;
              webTransportObserved: boolean;
              quicObserved: boolean;
              web3SignalingObserved: boolean;
              notes: string[];
            };
            verdict: {
              transportContractPassed: boolean;
              readyForLiveDialog: false;
              blockers: string[];
              caveats: string[];
            };
          };
        };
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      localRuntime: {
        file: "docs/openclinxr/local-runtime-probe-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
      localProviderBenchmark: {
        file: "docs/openclinxr/local-provider-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          mockModel: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          mockVoice: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          localModel: { status: "passed", blockers: [], metrics: {} },
          localVoice: { status: "passed", blockers: [], metrics: {} },
          verdict: {
            deterministicMocksPassed: true,
            localModelReadyToBenchmark: true,
            localVoiceReadyToBenchmark: true,
            blockers: [],
          },
        },
      },
      localVoiceRuntimeBenchmark: {
        file: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          status: "passed_with_caveats",
          runtime: {},
          audio: {},
          metrics: { realTimeFactor: 5.24 },
          verdict: {
            passed: true,
            blockers: [],
            caveats: ["This measured file-based local generation."],
          },
        },
      },
      localVoiceLiveDialogBenchmark: {
        file: "docs/openclinxr/local-voice-live-dialog-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:15:00.000Z",
          status: "blocked",
          mockStream: {
            passed: true,
            blockers: [],
          },
          runtimeFit: {
            blockers: ["runtime_file_generation_only", "real_time_factor_above_1"],
          },
          runtimeStream: {
            realLocalVoiceStreamObserved: false,
            blockers: ["real_local_voice_stream_benchmark_missing"],
          },
          webxrPlayback: {
            observed: false,
            blockers: ["webxr_playback_not_observed"],
          },
          safetyControls: {
            blockers: [],
          },
          verdict: {
            passed: false,
            blockers: [
              "runtime_stream:real_local_voice_stream_benchmark_missing",
              "runtime:runtime_file_generation_only",
              "runtime:real_time_factor_above_1",
              "webxr_playback:webxr_playback_not_observed",
            ],
            caveats: [],
          },
        },
      },
      realtimeVoiceTransportSpike: {
        file: "docs/openclinxr/realtime-voice-transport-spike-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:16:00.000Z",
          status: "transport_spike_passed",
          harness: {
            roundTripLatencyMs: 42,
            audioMetadataFramesSent: 2,
            audioChunkMetadataReceived: 2,
            frameLatencySamplesMs: [11, 13],
            audioChunkIndexesReceived: [0, 1],
            latencyBudget: {
              targetMs: 250,
              passed: true,
            },
          },
          pythonBackendVerifier: {
            status: "passed",
            blockers: [],
          },
          protocolEvidence: {
            websocketLocalHarnessObserved: true,
            bunHonoRuntimeObserved: false,
            webTransportObserved: false,
            quicObserved: false,
            web3SignalingObserved: false,
            notes: [
              "Only the local WebSocket transport harness has execution evidence in this report.",
              "WebTransport, direct QUIC, and Web3 signaling remain proposal- and evidence-gated.",
            ],
          },
          verdict: {
            transportContractPassed: true,
            readyForLiveDialog: false,
            blockers: ["real_moshi_or_qwen3_inference_not_observed"],
            caveats: [],
          },
        },
      },
      apiPythonBackendRuntimeSmoke: {
        file: "docs/openclinxr/api-python-backend-runtime-smoke-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:17:00.000Z",
          status: "passed",
          policy: {
            cloudApisUsed: false,
            paidApisUsed: false,
            modelDownloadsUsed: false,
            committedGeneratedAudio: false,
            productionUseAllowed: false,
          },
          python: {
            executable: ".openclinxr-local/api-python-backend-venv/bin/python",
            version: "Python 3.11.4",
            dependencies: {
              fastapi: "available",
              uvicorn: "available",
              websockets: "available",
            },
            missingPackages: [],
          },
          server: {
            attempted: true,
            command: ["python", "-m", "uvicorn"],
            port: 8765,
            stdout: [],
            stderr: [],
          },
          health: {
            attempted: true,
            ok: true,
            statusCode: 200,
            latencyMs: 10,
            body: { status: "ok" },
          },
          capabilities: {
            attempted: true,
            ok: true,
            statusCode: 200,
            latencyMs: 11,
            modes: [
              { id: "transport-echo", status: "ready", blockers: [] },
              { id: "moshi-mlx", status: "approved_runtime_missing", blockers: ["model_weights_not_installed", "mlx_runtime_not_installed", "real_inference_not_observed"] },
              { id: "qwen3-tts-mlx", status: "approved_runtime_missing", blockers: ["model_weights_not_installed", "mlx_runtime_not_installed", "real_inference_not_observed"] },
            ],
            body: { defaultMode: "transport-echo" },
          },
          websocket: {
            attempted: true,
            connected: true,
            jsonMessages: 5,
            binaryMessages: 1,
            controlAckObserved: true,
            audioMetadataObserved: true,
            transcriptDeltaObserved: true,
            binaryEchoObserved: true,
            latencyMs: 8,
            protocol: {
              websocketPath: "/voice/realtime/ws",
              codec: "opus",
              backendProtocolObserved: true,
              clientControlFrameTypesSent: ["voice.start", "voice.audio_metadata", "voice.stop"],
              serverEventTypesObserved: ["backend.ready", "voice.started", "audio.chunk", "transcript.partial", "transcript.final", "voice.stopped"],
              latencyFieldsObserved: true,
              canonicalProtocolObserved: true,
            },
          },
          verdict: {
            passed: true,
            readyForLiveDialog: false,
            blockers: [],
            caveats: [],
          },
        },
      },
      apiBunWebSocketRuntimeSmoke: passedApiBunWebSocketRuntimeSmoke(),
      apiBunPythonProxyRuntimeSmoke: passedApiBunPythonProxyRuntimeSmoke(),
    }, { now: new Date("2026-05-04T20:20:00.000Z"), maxEvidenceAgeHours: 24 });

    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(liveDialogGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_voice_live_dialog_report_present",
      "local_voice_live_dialog_mock_stream_passed",
      "local_voice_live_dialog_safety_controls_observed",
      "local_voice_realtime_transport_contract_observed",
      "local_voice_python_backend_runtime_smoke_passed",
      "local_voice_bun_websocket_runtime_smoke_passed",
      "local_voice_bun_python_proxy_runtime_smoke_passed",
    ]));
    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:runtime_stream:real_local_voice_stream_benchmark_missing",
      "local_voice_live_dialog:runtime:runtime_file_generation_only",
      "local_voice_live_dialog:runtime:real_time_factor_above_1",
      "local_voice_live_dialog:webxr_playback:webxr_playback_not_observed",
      "local_voice_live_dialog:realtime_transport_spike:real_moshi_or_qwen3_inference_not_observed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog_runtime_stream_observed",
    ]));
    expect(liveDialogGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog:missing_streaming_webxr_playback_benchmark",
      "local_voice_live_dialog:missing_disclosure_retention_misuse_controls",
      "local_voice_live_dialog:realtime_transport_spike:transport_contract_failed",
      "local_voice_live_dialog:api_bun_websocket_runtime_smoke:low_latency_claim_not_supported_by_local_smoke",
      "local_voice_live_dialog:api_bun_websocket_runtime_smoke:quest_browser_audio_capture_not_observed",
      "local_voice_live_dialog:api_bun_python_proxy_runtime_smoke:low_latency_claim_not_supported_by_local_smoke",
      "local_voice_live_dialog:api_bun_python_proxy_runtime_smoke:real_model_inference_not_observed",
    ]));
    expect(report.realtime_voice_transport_spike).toMatchObject({
      round_trip_latency_ms: 42,
      audio_metadata_frames_sent: 2,
      audio_chunk_metadata_received: 2,
      frame_latency_samples_ms: [11, 13],
      audio_chunk_indexes_received: [0, 1],
      latency_budget: {
        targetMs: 250,
        passed: true,
      },
      protocol_evidence: {
        websocket_local_harness_observed: true,
        bun_hono_runtime_observed: false,
        webtransport_observed: false,
        quic_observed: false,
        web3_signaling_observed: false,
      },
      python_backend_verifier: {
        status: "passed",
        blockers: [],
      },
      verdict: {
        transportContractPassed: true,
        readyForLiveDialog: false,
      },
    });
    expect(report.api_python_backend_runtime_smoke).toMatchObject({
      status: "passed",
      health: { ok: true },
      capabilities: {
        ok: true,
        modes: [
          { id: "transport-echo", status: "ready" },
          { id: "moshi-mlx", status: "approved_runtime_missing" },
          { id: "qwen3-tts-mlx", status: "approved_runtime_missing" },
        ],
      },
      websocket: {
        connected: true,
        binaryEchoObserved: true,
      },
      verdict: {
        passed: true,
        readyForLiveDialog: false,
      },
    });
    expect(report.api_bun_websocket_runtime_smoke).toMatchObject({
      file: "docs/openclinxr/api-bun-websocket-runtime-smoke-2026-05-05.json",
      generated_at: "2026-05-05T16:45:35.909Z",
      status: "passed",
      bun: {
        version: "1.3.13",
        revision: "1.3.13+bf2e2cecf",
      },
      health: { ok: true },
      h3: {
        enabled: false,
        h3_true_enabled: false,
        out_of_scope_for_this_smoke: true,
      },
      trace_contexts: {
        pre_vr_trace_interaction: {
          observed: true,
          control_frame_types: ["voice.start"],
        },
        in_vr_trace_interaction: {
          observed: false,
          blocker: "in_vr_trace_not_executed_by_local_bun_smoke",
        },
      },
      websocket: {
        connected: true,
        reconnect_observed: true,
        control_ack_observed: true,
        audio_metadata_observed: true,
        transcript_delta_observed: true,
        binary_echo_observed: true,
        binary_frames_sent: 9,
        binary_bytes_sent: 2054,
        server_errors: [],
      },
      verdict: {
        smoke_passed: true,
        ready_for_live_dialog: false,
      },
    });
    expect(report.api_bun_python_proxy_runtime_smoke).toMatchObject({
      file: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
      generated_at: "2026-05-05T18:21:30.330Z",
      status: "passed",
      python_backend: {
        health_ok: true,
      },
      bun_gateway: {
        health_ok: true,
        backend_url_configured: true,
      },
      websocket: {
        connected: true,
        backend_protocol_observed: true,
        latency_fields_observed: true,
        binary_echo_observed: true,
        binary_messages: 1,
        event_types_observed: [
          "gateway.ready",
          "backend.ready",
          "voice.started",
          "audio.chunk",
          "transcript.partial",
          "transcript.final",
          "voice.stopped",
        ],
        error_messages: [],
      },
      verdict: {
        smoke_passed: true,
        ready_for_live_dialog: false,
      },
    });
    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "api_bun_websocket_runtime_smoke",
        file: "docs/openclinxr/api-bun-websocket-runtime-smoke-2026-05-05.json",
        status: "fresh",
        blockers: [],
      }),
      expect.objectContaining({
        evidence_id: "api_bun_python_proxy_runtime_smoke",
        file: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
        status: "fresh",
        blockers: [],
      }),
    ]));
  });

  it("surfaces local realtime voice model cache evidence as a live-dialog blocker", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localVoiceLiveDialogBenchmark?: {
          file: string;
          value: {
            generatedAt: string;
            status: string;
            mockStream: {
              passed: boolean;
              blockers: string[];
            };
            runtimeFit: {
              blockers: string[];
            };
            webxrPlayback: {
              observed: boolean;
              blockers: string[];
            };
            safetyControls: {
              blockers: string[];
            };
            verdict: {
              passed: boolean;
              blockers: string[];
              caveats: string[];
            };
          };
        };
        localRealtimeVoiceModelCacheEvidence?: LocalRealtimeVoiceModelCacheEvidenceInput;
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;

    const report = buildReport({
      localVoiceRuntimeBenchmark: {
        file: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-05.json",
        value: {
          generatedAt: "2026-05-05T18:30:30.000Z",
          status: "passed_with_caveats",
          runtime: {},
          audio: {},
          metrics: {
            realTimeFactor: 0.7,
          },
          verdict: {
            passed: true,
            blockers: [],
            caveats: [],
          },
        },
      },
      localVoiceLiveDialogBenchmark: {
        file: "docs/openclinxr/local-voice-live-dialog-benchmark-2026-05-05.json",
        value: {
          generatedAt: "2026-05-05T18:31:00.000Z",
          status: "blocked",
          mockStream: {
            passed: true,
            blockers: [],
          },
          runtimeFit: {
            blockers: [],
          },
          webxrPlayback: {
            observed: true,
            blockers: [],
          },
          safetyControls: {
            blockers: [],
          },
          verdict: {
            passed: false,
            blockers: [
              "model_cache:approved_model_weights_not_cached",
              "model_cache:real_moshi_or_qwen3_model_cache_missing",
            ],
            caveats: [],
          },
        },
      },
      localRealtimeVoiceModelCacheEvidence: missingRealtimeVoiceModelCacheEvidence(),
    }, { now: new Date("2026-05-05T18:45:00.000Z"), maxEvidenceAgeHours: 24 });
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.local_realtime_voice_model_cache_evidence).toMatchObject({
      file: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
      generated_at: "2026-05-05T18:30:00.000Z",
      kind: "local_voice_evidence_check",
      claim_scope: "cache_inventory_only",
      cache_exists: true,
      ready: false,
      models: [],
      support_directories: [
        {
          name: "api-python-backend-venv",
          reason: "runtime_support_venv_not_model_weights",
        },
      ],
      blockers: [
        "approved_model_weights_not_cached",
        "real_moshi_or_qwen3_model_cache_missing",
      ],
    });
    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "local_realtime_voice_model_cache_evidence",
        file: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json",
        status: "fresh",
        blockers: [],
      }),
    ]));
    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:local_realtime_voice_model_cache:approved_model_weights_not_cached",
      "local_voice_live_dialog:local_realtime_voice_model_cache:real_moshi_or_qwen3_model_cache_missing",
    ]));
    expect(liveDialogGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog:model_cache:approved_model_weights_not_cached",
      "local_voice_live_dialog:model_cache:real_moshi_or_qwen3_model_cache_missing",
    ]));
    expect(liveDialogGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_voice_realtime_model_cache_evidence_present",
      "local_voice_realtime_model_support_venv_observed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_realtime_model_cache_ready",
    ]));
  });

  it("keeps live-dialog evidence blocked until local realtime voice model cache evidence exists", () => {
    const report = buildBenchmarkGateReport({}, {
      now: new Date("2026-05-05T18:45:00.000Z"),
      maxEvidenceAgeHours: 24,
    }) as BenchmarkGateReport;
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "local_realtime_voice_model_cache_evidence",
        status: "missing",
        blockers: ["local_realtime_voice_model_cache_evidence:evidence_missing"],
      }),
    ]));
    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:local_realtime_voice_model_cache:missing_local_realtime_voice_model_cache_evidence_report",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_realtime_model_cache_evidence_present",
      "local_voice_realtime_model_cache_ready",
    ]));
  });

  it("treats a ready local realtime voice model cache as a satisfied live-dialog condition", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localRealtimeVoiceModelCacheEvidence?: LocalRealtimeVoiceModelCacheEvidenceInput;
        localRealtimeVoiceModelSourceCurrentness?: LocalRealtimeVoiceModelSourceCurrentnessInput;
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;

    const report = buildReport({
      localRealtimeVoiceModelCacheEvidence: readyRealtimeVoiceModelCacheEvidence(),
      localRealtimeVoiceModelSourceCurrentness: readyRealtimeVoiceModelSourceCurrentness(),
    }, { now: new Date("2026-05-05T18:45:00.000Z"), maxEvidenceAgeHours: 24 });
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.local_realtime_voice_model_cache_evidence).toMatchObject({
      cache_exists: true,
      ready: true,
      blockers: [],
      models: [
        {
          model_id: "kyutai/moshiko-mlx-q4",
          ready: true,
          blockers: [],
        },
      ],
    });
    expect(liveDialogGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_voice_realtime_model_cache_evidence_present",
      "local_voice_realtime_model_cache_ready",
      "local_voice_realtime_model_source_currentness_present",
      "local_voice_realtime_model_source_currentness_ready",
      "local_voice_realtime_model_support_venv_observed",
    ]));
    expect(liveDialogGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog:local_realtime_voice_model_cache:approved_model_weights_not_cached",
      "local_voice_live_dialog:local_realtime_voice_model_cache:real_moshi_or_qwen3_model_cache_missing",
      "local_voice_live_dialog:local_realtime_voice_model_cache:missing_local_realtime_voice_model_cache_evidence_report",
    ]));
  });

  it("keeps live-dialog evidence blocked when ready voice cache evidence lacks source currentness", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localRealtimeVoiceModelCacheEvidence?: LocalRealtimeVoiceModelCacheEvidenceInput;
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;

    const report = buildReport({
      localRealtimeVoiceModelCacheEvidence: readyRealtimeVoiceModelCacheEvidence(),
    }, { now: new Date("2026-05-05T18:45:00.000Z"), maxEvidenceAgeHours: 24 });
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "local_realtime_voice_model_source_currentness",
        status: "missing",
        blockers: ["local_realtime_voice_model_source_currentness:evidence_missing"],
      }),
    ]));
    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:local_realtime_voice_model_source_currentness:missing_local_realtime_voice_model_source_currentness_report",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_realtime_model_source_currentness_present",
      "local_voice_realtime_model_source_currentness_ready",
    ]));
  });

  it("surfaces passed local Qwen TTS inference without upgrading it to full-duplex live-dialog evidence", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localQwenTtsRuntimeSmoke?: LocalQwenTtsRuntimeSmokeInput;
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;

    const report = buildReport({
      localQwenTtsRuntimeSmoke: passedQwenTtsRuntimeSmoke(),
    }, { now: new Date("2026-05-05T18:45:00.000Z"), maxEvidenceAgeHours: 24 });
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.local_qwen_tts_runtime_smoke).toMatchObject({
      file: "docs/openclinxr/local-qwen-tts-runtime-smoke-2026-05-06.json",
      generated_at: "2026-05-05T18:32:00.000Z",
      kind: "local_qwen_tts_runtime_smoke",
      claim_scope: "local_tts_inference_only",
      status: "passed_with_caveats",
      runtime: {
        modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
        tool: "mlx-audio",
        toolVersion: "0.3.0",
      },
      verdict: {
        passed: true,
        readyForLiveDialog: false,
      },
    });
    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "local_qwen_tts_runtime_smoke",
        file: "docs/openclinxr/local-qwen-tts-runtime-smoke-2026-05-06.json",
        status: "fresh",
        blockers: [],
      }),
    ]));
    expect(liveDialogGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_voice_qwen_tts_runtime_smoke_passed",
      "local_voice_qwen_tts_local_inference_observed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog_runtime_stream_observed",
      "local_voice_live_dialog_webxr_playback_observed",
      "local_voice_live_dialog_benchmark_passed",
    ]));
    expect(liveDialogGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog:local_qwen_tts_runtime_smoke:tts_runtime_smoke_failed",
    ]));
  });

  it("surfaces isolated Moshi package evidence without upgrading it to live-dialog evidence", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localMoshiRuntimePackageEvidence?: LocalMoshiRuntimePackageEvidenceInput;
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;

    const report = buildReport({
      localMoshiRuntimePackageEvidence: passedMoshiRuntimePackageEvidence(),
    }, { now: new Date("2026-05-05T18:45:00.000Z"), maxEvidenceAgeHours: 24 });
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.local_moshi_runtime_package_evidence).toMatchObject({
      file: "docs/openclinxr/local-moshi-runtime-package-evidence-2026-05-06.json",
      generated_at: "2026-05-05T18:33:00.000Z",
      kind: "local_moshi_runtime_package_evidence",
      claim_scope: "runtime_package_import_only",
      status: "passed_with_caveats",
      runtime: {
        modelId: "kyutai/moshiko-mlx-q4",
        modelLicense: "CC-BY-4.0",
        packageVersions: {
          moshi_mlx: "0.3.0",
          mlx: "0.26.5",
        },
        entrypoints: ["moshi-local-web", "moshi-local"],
      },
      verdict: {
        passed: true,
        readyForLiveDialog: false,
      },
    });
    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "local_moshi_runtime_package_evidence",
        file: "docs/openclinxr/local-moshi-runtime-package-evidence-2026-05-06.json",
        status: "fresh",
        blockers: [],
      }),
    ]));
    expect(liveDialogGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_voice_moshi_runtime_package_evidence_passed",
      "local_voice_moshi_runtime_imports_observed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog_runtime_stream_observed",
      "local_voice_live_dialog_webxr_playback_observed",
      "local_voice_live_dialog_benchmark_passed",
    ]));
  });

  it("surfaces FastAPI related Qwen TTS evidence without treating the backend mode as wired", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        apiPythonBackendRuntimeSmoke?: ReturnType<typeof passedApiPythonBackendRuntimeSmokeWithQwenEvidence>;
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;

    const report = buildReport({
      apiPythonBackendRuntimeSmoke: passedApiPythonBackendRuntimeSmokeWithQwenEvidence(),
    }, { now: new Date("2026-05-06T09:45:00.000Z"), maxEvidenceAgeHours: 24 });
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.api_python_backend_runtime_smoke).toMatchObject({
      file: "docs/openclinxr/api-python-backend-runtime-smoke-2026-05-06.json",
      status: "passed",
      capabilities: {
        modes: [
          { id: "transport-echo", status: "ready" },
          { id: "moshi-mlx", status: "approved_runtime_missing" },
          { id: "qwen3-tts-mlx", status: "approved_runtime_missing" },
        ],
      },
      related_local_inference_evidence: {
        qwen3Tts: {
          observed: true,
          claimScope: "local_tts_inference_only",
          modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
          realTimeFactor: 1.96,
          readyForLiveDialog: false,
          blockers: [],
        },
      },
      verdict: {
        passed: true,
        readyForLiveDialog: false,
      },
    });
    expect(liveDialogGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_voice_python_backend_runtime_smoke_passed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog_runtime_stream_observed",
    ]));
  });

  it("surfaces blueprint voice simulation tiers without promoting mock evidence to local inference or WebXR readiness", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        blueprintVoiceSimulationSpike?: {
          file: string;
          value: {
            generatedAt: string;
            status: string;
            policy: {
              rawAudioStored: boolean;
              hiddenFactsExposedToLearner: boolean;
            };
            plan: {
              blueprintId: string;
              station: {
                scenarioId: string;
              };
              actorRoster: unknown[];
              voiceSlots: unknown[];
              triggerPlan: unknown[];
            };
            runtimeRouting: {
              exercised: boolean;
            };
            multiCharacterInterruption: {
              exercised: boolean;
            };
            transportEvidence: {
              linkedExistingEvidence: boolean;
              bunPythonProxyPassed: boolean;
            };
            prewarmEvidence: {
              executed: boolean;
              preparedArtifactCount: number;
              blockers: string[];
            };
            verdict: {
              tier0BlueprintCompilerPassed: boolean;
              mockVoiceFacadeExercised: boolean;
              tier1TransportLoopPassed: boolean;
              tier2LocalInferenceObserved: boolean;
              tier3WebXrObserved: boolean;
              readyForProduction: boolean;
              blockers: string[];
            };
          };
        };
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;

    const report = buildReport({
      blueprintVoiceSimulationSpike: {
        file: "docs/openclinxr/blueprint-voice-simulation-spike-2026-05-05.json",
        value: {
          generatedAt: "2026-05-06T03:18:07.296Z",
          status: "mock_facade_exercised",
          policy: {
            rawAudioStored: false,
            hiddenFactsExposedToLearner: false,
          },
          plan: {
            blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
            station: {
              scenarioId: "ed_chest_pain_priority_v1",
            },
            actorRoster: [{}, {}, {}],
            voiceSlots: [{}, {}, {}],
            triggerPlan: [{}],
          },
          runtimeRouting: {
            exercised: true,
          },
          multiCharacterInterruption: {
            exercised: true,
          },
          transportEvidence: {
            linkedExistingEvidence: true,
            bunPythonProxyPassed: true,
          },
          prewarmEvidence: {
            executed: true,
            preparedArtifactCount: 8,
            blockers: ["first_response_improvement_not_measured"],
          },
          verdict: {
            tier0BlueprintCompilerPassed: true,
            mockVoiceFacadeExercised: true,
            tier1TransportLoopPassed: true,
            tier2LocalInferenceObserved: false,
            tier3WebXrObserved: false,
            readyForProduction: false,
            blockers: [
              "real_local_full_duplex_model_not_executed",
              "webxr_iwsdk_client_not_executed_for_this_report",
            ],
          },
        },
      },
    }, { now: new Date("2026-05-06T04:00:00.000Z"), maxEvidenceAgeHours: 24 });
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.blueprint_voice_simulation_spike).toEqual({
      file: "docs/openclinxr/blueprint-voice-simulation-spike-2026-05-05.json",
      generated_at: "2026-05-06T03:18:07.296Z",
      status: "mock_facade_exercised",
      claim_scope: {
        tier0_blueprint_compiler_passed: true,
        mock_voice_facade_exercised: true,
        tier1_transport_loop_passed: true,
        tier2_local_inference_observed: false,
        tier3_webxr_observed: false,
        ready_for_production: false,
      },
      plan_summary: {
        blueprint_id: "blueprint_openclinxr_step2cs_style_seed_v1",
        scenario_id: "ed_chest_pain_priority_v1",
        actor_count: 3,
        voice_slot_count: 3,
        trigger_count: 1,
        prewarm_artifact_count: 8,
      },
      interaction_evidence: {
        runtime_routing_exercised: true,
        multi_character_interruption_exercised: true,
        transport_linked_existing_evidence: true,
        bun_python_proxy_passed: true,
        raw_audio_stored: false,
        hidden_facts_exposed_to_learner: false,
      },
      blockers: [
        "first_response_improvement_not_measured",
        "not_ready_for_production",
        "real_local_full_duplex_model_not_executed",
        "tier2_local_inference_not_observed",
        "tier3_webxr_not_observed",
        "webxr_iwsdk_client_not_executed_for_this_report",
      ],
    });
    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "blueprint_voice_simulation_spike",
        file: "docs/openclinxr/blueprint-voice-simulation-spike-2026-05-05.json",
        status: "fresh",
        blockers: [],
      }),
    ]));
    expect(liveDialogGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "blueprint_voice_tier0_compiler_passed",
      "blueprint_voice_mock_facade_exercised",
      "blueprint_voice_tier1_transport_loop_passed",
      "blueprint_voice_runtime_routing_exercised",
      "blueprint_voice_multi_character_interruption_exercised",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "blueprint_voice_tier2_local_inference_observed",
      "blueprint_voice_tier3_webxr_observed",
      "blueprint_voice_production_ready",
    ]));
    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:blueprint_voice_simulation:real_local_full_duplex_model_not_executed",
      "local_voice_live_dialog:blueprint_voice_simulation:tier2_local_inference_not_observed",
      "local_voice_live_dialog:blueprint_voice_simulation:tier3_webxr_not_observed",
      "local_voice_live_dialog:blueprint_voice_simulation:webxr_iwsdk_client_not_executed_for_this_report",
      "local_voice_live_dialog:blueprint_voice_simulation:first_response_improvement_not_measured",
      "local_voice_live_dialog:blueprint_voice_simulation:not_ready_for_production",
    ]));
  });

  it("does not satisfy realtime voice model cache readiness from unapproved model evidence", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localRealtimeVoiceModelCacheEvidence?: LocalRealtimeVoiceModelCacheEvidenceInput;
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;

    const unapprovedCacheEvidence = readyRealtimeVoiceModelCacheEvidence();
    unapprovedCacheEvidence.value.models = [
      {
        ...unapprovedCacheEvidence.value.models[0],
        model_id: "unapproved-lab/experimental-voice",
        approved: false,
        ready: true,
        blockers: [],
      },
    ];

    const report = buildReport({
      localRealtimeVoiceModelCacheEvidence: unapprovedCacheEvidence,
    }, { now: new Date("2026-05-05T18:45:00.000Z"), maxEvidenceAgeHours: 24 });
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.local_realtime_voice_model_cache_evidence).toMatchObject({
      ready: false,
      blockers: [
        "model:unapproved-lab/experimental-voice:not_in_approved_model_ids",
        "model:unapproved-lab/experimental-voice:not_marked_approved",
        "real_moshi_or_qwen3_model_cache_missing",
      ],
    });
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_realtime_model_cache_ready",
    ]));
    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:local_realtime_voice_model_cache:model:unapproved-lab/experimental-voice:not_in_approved_model_ids",
      "local_voice_live_dialog:local_realtime_voice_model_cache:model:unapproved-lab/experimental-voice:not_marked_approved",
      "local_voice_live_dialog:local_realtime_voice_model_cache:real_moshi_or_qwen3_model_cache_missing",
    ]));
  });

  it("keeps live dialog evidence blocked until local Bun WebSocket smoke evidence exists", () => {
    const report = buildBenchmarkGateReport({}, {
      now: new Date("2026-05-05T17:00:00.000Z"),
      maxEvidenceAgeHours: 24,
    }) as BenchmarkGateReport;

    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "api_bun_websocket_runtime_smoke",
        status: "missing",
        blockers: ["api_bun_websocket_runtime_smoke:evidence_missing"],
      }),
      expect.objectContaining({
        evidence_id: "api_bun_python_proxy_runtime_smoke",
        status: "missing",
        blockers: ["api_bun_python_proxy_runtime_smoke:evidence_missing"],
      }),
    ]));
    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:api_bun_websocket_runtime_smoke:missing_api_bun_websocket_runtime_smoke_report",
      "local_voice_live_dialog:api_bun_python_proxy_runtime_smoke:missing_api_bun_python_proxy_runtime_smoke_report",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_bun_websocket_runtime_smoke_passed",
      "local_voice_bun_python_proxy_runtime_smoke_passed",
    ]));
  });

  it("keeps live dialog evidence blocked until Godot Quest voice evidence exists", () => {
    const report = buildBenchmarkGateReport({}, {
      now: new Date("2026-05-06T09:30:00.000Z"),
      maxEvidenceAgeHours: 24,
    }) as BenchmarkGateReport;
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "godot_quest_voice_evidence",
        status: "missing",
        blockers: ["godot_quest_voice_evidence:evidence_missing"],
      }),
    ]));
    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:godot_quest_voice:missing_godot_quest_voice_evidence_report",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_godot_quest_voice_evidence_present",
      "local_voice_godot_quest_binary_transport_observed",
      "local_voice_godot_quest_audio_pipeline_observed",
      "local_voice_godot_quest_latency_measurement_observed",
    ]));
  });

  it("surfaces Godot Quest voice evidence without satisfying live-dialog or low-latency claims", () => {
    const report = buildBenchmarkGateReport({
      godotQuestVoiceEvidence: binaryOnlyGodotQuestVoiceEvidence(),
    }, {
      now: new Date("2026-05-06T09:30:00.000Z"),
      maxEvidenceAgeHours: 24,
    }) as BenchmarkGateReport;
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.godot_quest_voice_evidence).toMatchObject({
      file: "docs/openclinxr/godot-quest-voice-evidence-2026-05-06.json",
      generated_at: "2026-05-06T09:00:00.000Z",
      input_file: "docs/openclinxr/godot-quest-voice-evidence-raw-2026-05-06.json",
      ready_for_binary_transport_evidence: true,
      ready_for_quest_audio_pipeline_evidence: false,
      ready_for_latency_measurement_evidence: false,
      ready_for_production_runtime: false,
      ready_for_clinical_voice_claim: false,
      blockers: [
        "quest_microphone_capture_not_observed",
        "opus_encode_decode_not_observed",
        "quest_playback_not_observed",
        "latency_first_packet_missing_or_nonpositive",
        "latency_p50_missing_or_nonpositive",
        "latency_p95_missing_or_nonpositive",
        "latency_p95_less_than_p50",
        "latency_sample_count_under_10",
      ],
      satisfied_conditions: [
        "schema_version_godot_quest_voice_evidence_v1",
        "classification_physical_quest_developer_evidence",
        "physical_quest3_device_recorded",
        "local_websocket_gateway_recorded",
        "binary_websocket_roundtrip_observed",
        "safety_boundaries_preserved",
      ],
      not_evidence_for: [
        "production_voice_runtime_readiness",
        "clinical_voice_dialog_quality",
        "grok_voice_parity",
        "webxr_client_readiness",
        "low_latency_voice_readiness",
      ],
    });
    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "godot_quest_voice_evidence",
        file: "docs/openclinxr/godot-quest-voice-evidence-2026-05-06.json",
        status: "fresh",
        blockers: [],
      }),
    ]));
    expect(liveDialogGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_voice_godot_quest_voice_evidence_present",
      "local_voice_godot_quest_binary_transport_observed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_godot_quest_audio_pipeline_observed",
      "local_voice_godot_quest_latency_measurement_observed",
      "local_voice_live_dialog_runtime_stream_observed",
      "local_voice_live_dialog_benchmark_passed",
    ]));
    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:godot_quest_voice:quest_microphone_capture_not_observed",
      "local_voice_live_dialog:godot_quest_voice:opus_encode_decode_not_observed",
      "local_voice_live_dialog:godot_quest_voice:quest_playback_not_observed",
      "local_voice_live_dialog:godot_quest_voice:latency_first_packet_missing_or_nonpositive",
      "local_voice_live_dialog:godot_quest_voice:latency_sample_count_under_10",
    ]));
    expect(liveDialogGate?.ready_to_resolve).toBe(false);
  });

  it("surfaces Godot source/import evidence while preserving Quest voice runtime blockers", () => {
    const report = buildBenchmarkGateReport({
      godotProjectImportCheck: sourceOnlyGodotProjectImportCheck(),
    }, {
      now: new Date("2026-05-06T10:30:00.000Z"),
      maxEvidenceAgeHours: 24,
    }) as BenchmarkGateReport;
    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(report.godot_project_import_check).toMatchObject({
      file: ".agent-factory/godot-project-import-check.json",
      generated_at: "2026-05-06T10:00:00.000Z",
      project_path: "apps/arena/ui-quest-voice-godot",
      source_contract: {
        passed: true,
        blockers: [],
        satisfied_conditions: [
          "binary_packet_send_source_observed",
          "forty_eight_khz_sample_rate_declared",
          "godot_4_project_source_observed",
          "json_binary_receive_split_source_observed",
          "mobile_renderer_configured",
          "opus_codec_lane_declared",
          "websocket_peer_source_observed",
        ],
      },
      godot_import: {
        attempted: false,
        status: "skipped_no_godot_binary",
        blockers: ["godot_import_not_executed"],
      },
      verdict: {
        ready_for_source_contract_claim: true,
        ready_for_godot_import_claim: false,
        ready_for_quest_runtime_claim: false,
        ready_for_voice_runtime_claim: false,
        blockers: [
          "godot_import:not_executed",
          "quest_runtime:not_executed",
          "voice_runtime:not_executed",
        ],
      },
    });
    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "godot_project_import_check",
        file: ".agent-factory/godot-project-import-check.json",
        status: "fresh",
        blockers: [],
      }),
    ]));
    expect(liveDialogGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_voice_godot_source_contract_observed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_godot_import_observed",
      "local_voice_godot_quest_runtime_observed",
      "local_voice_godot_voice_runtime_observed",
    ]));
    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:godot_project_import:godot_import:not_executed",
      "local_voice_live_dialog:godot_project_import:quest_runtime:not_executed",
      "local_voice_live_dialog:godot_project_import:voice_runtime:not_executed",
      "local_voice_live_dialog:godot_quest_voice:missing_godot_quest_voice_evidence_report",
    ]));
  });

  it("blocks realtime voice evidence when frame metadata is incomplete or mismatched", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0],
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      realtimeVoiceTransportSpike: {
        file: "docs/openclinxr/realtime-voice-transport-spike-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:16:00.000Z",
          status: "transport_spike_passed",
          harness: {
            roundTripLatencyMs: 42,
            audioMetadataFramesSent: 2,
            audioChunkMetadataReceived: 1,
            frameLatencySamplesMs: [],
            audioChunkIndexesReceived: [1],
            latencyBudget: {
              targetMs: 250,
              passed: true,
            },
          },
          pythonBackendVerifier: {
            status: "passed",
            blockers: [],
          },
          protocolEvidence: {
            websocketLocalHarnessObserved: true,
            bunHonoRuntimeObserved: false,
            webTransportObserved: false,
            quicObserved: false,
            web3SignalingObserved: false,
            notes: [],
          },
          verdict: {
            transportContractPassed: true,
            readyForLiveDialog: false,
            blockers: [],
            caveats: [],
          },
        },
      },
    }, { now: new Date("2026-05-04T20:20:00.000Z"), maxEvidenceAgeHours: 24 });

    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:realtime_transport_spike:audio_metadata_count_mismatch",
      "local_voice_live_dialog:realtime_transport_spike:frame_latency_samples_incomplete",
      "local_voice_live_dialog:realtime_transport_spike:audio_chunk_indexes_not_contiguous",
    ]));
    expect(liveDialogGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog:realtime_transport_spike:transport_contract_failed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_realtime_transport_contract_observed",
    ]));
  });

  it("blocks realtime voice evidence when latency budget contradicts the transport verdict", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0],
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      realtimeVoiceTransportSpike: {
        file: "docs/openclinxr/realtime-voice-transport-spike-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:16:00.000Z",
          status: "transport_spike_passed",
          harness: {
            roundTripLatencyMs: 425,
            audioMetadataFramesSent: 2,
            audioChunkMetadataReceived: 2,
            frameLatencySamplesMs: [12, -1],
            audioChunkIndexesReceived: [0, 1],
            latencyBudget: {
              targetMs: 250,
              passed: false,
            },
          },
          pythonBackendVerifier: {
            status: "passed",
            blockers: [],
          },
          protocolEvidence: {
            websocketLocalHarnessObserved: true,
            bunHonoRuntimeObserved: false,
            webTransportObserved: false,
            quicObserved: false,
            web3SignalingObserved: false,
            notes: [],
          },
          verdict: {
            transportContractPassed: true,
            readyForLiveDialog: false,
            blockers: [],
            caveats: [],
          },
        },
      },
    }, { now: new Date("2026-05-04T20:20:00.000Z"), maxEvidenceAgeHours: 24 });

    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:realtime_transport_spike:latency_budget_failed",
      "local_voice_live_dialog:realtime_transport_spike:frame_latency_samples_invalid",
    ]));
    expect(liveDialogGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog:realtime_transport_spike:transport_contract_failed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_realtime_transport_contract_observed",
    ]));
  });

  it("blocks stale FastAPI runtime smoke evidence that lacks canonical websocket protocol fields", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0],
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      apiPythonBackendRuntimeSmoke: {
        file: "docs/openclinxr/api-python-backend-runtime-smoke-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:17:00.000Z",
          status: "passed",
          policy: {
            cloudApisUsed: false,
            paidApisUsed: false,
            modelDownloadsUsed: false,
            committedGeneratedAudio: false,
            productionUseAllowed: false,
          },
          python: {
            executable: "python3",
            version: "Python 3.11.4",
            dependencies: { fastapi: "available", uvicorn: "available", websockets: "available" },
            missingPackages: [],
          },
          server: {
            attempted: true,
            command: ["python3", "-m", "uvicorn"],
            port: 8765,
            stdout: [],
            stderr: [],
          },
          health: {
            attempted: true,
            ok: true,
            statusCode: 200,
            latencyMs: 10,
            body: { status: "ok", service: "api-python-backend" },
          },
          capabilities: {
            attempted: true,
            ok: true,
            statusCode: 200,
            latencyMs: 11,
            modes: [],
            body: { defaultMode: "transport-echo" },
          },
          websocket: {
            attempted: true,
            connected: true,
            jsonMessages: 5,
            binaryMessages: 1,
            controlAckObserved: true,
            audioMetadataObserved: true,
            transcriptDeltaObserved: true,
            binaryEchoObserved: true,
            latencyMs: 17,
            protocol: {
              websocketPath: "/voice/realtime/ws",
              codec: "opus",
              backendProtocolObserved: false,
              clientControlFrameTypesSent: ["voice.start", "voice.audio_metadata", "voice.stop"],
              serverEventTypesObserved: ["backend.ready", "voice.started", "audio.chunk", "transcript.partial", "voice.stopped"],
              latencyFieldsObserved: false,
              canonicalProtocolObserved: false,
            },
          },
          verdict: {
            passed: true,
            readyForLiveDialog: false,
            blockers: [],
            caveats: [],
          },
        },
      },
    }, { now: new Date("2026-05-04T20:20:00.000Z"), maxEvidenceAgeHours: 24 });

    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:api_python_backend_runtime_smoke:websocket_backend_protocol_not_observed",
      "local_voice_live_dialog:api_python_backend_runtime_smoke:websocket_latency_fields_not_observed",
      "local_voice_live_dialog:api_python_backend_runtime_smoke:websocket_canonical_protocol_not_observed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_python_backend_runtime_smoke_passed",
    ]));
  });

  it("uses asset production readiness evidence to replace generic placeholder asset blockers", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        assetProductionReadinessBenchmark?: {
          file: string;
          value: AssetProductionReadinessReport;
        };
        assetCapabilityJobEvidence?: {
          file: string;
          value: {
            generatedAt: string;
            status: string;
            policy: {
              cloudApisUsed: false;
              paidApisUsed: false;
              externalNetworkAllowed: false;
              spendLimitCents: 0;
              productionArtifactClaimed: false;
            };
            summary: {
              allCapabilitiesObserved: boolean;
              allJobsSucceeded: boolean;
              allManifestsObserved: boolean;
              allLicenseProvenanceObserved: boolean;
              zeroSpendObserved: boolean;
              noExternalNetworkObserved: boolean;
              blockers: string[];
            };
            jobs: Array<{ capabilityId: string; passed: boolean; blockers: string[] }>;
            verdict: {
              passed: boolean;
              readyForProductionAssets: false;
              blockers: string[];
              caveats: string[];
            };
          };
        };
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      localRuntime: {
        file: "docs/openclinxr/local-runtime-probe-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
      gltfPipelineSmoke: {
        file: "docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          tool: { command: "gltf-pipeline", package: "gltf-pipeline", version: "4.3.1", license: "Apache-2.0" },
          output: { glbBytes: 848, magic: "glTF", version: 2, declaredLength: 848, elapsedMs: 1 },
          verdict: { passed: true, blockers: [] },
        },
      },
      blenderAssetBakeSmoke: {
        file: "docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          tool: { command: "blender", package: "Blender", version: "Blender 5.1.1", license: "GPL-3.0-or-later-tooling" },
          input: {
            fixture: "low_poly_clinical_humanoid",
            externalAssetsUsed: false,
            sourceLicensePosture: "repo_generated_placeholder",
            expectedObjectCount: 7,
          },
          output: { glbBytes: 27284, magic: "glTF", version: 2, declaredLength: 27284, elapsedMs: 1 },
          verdict: { passed: true, blockers: [] },
        },
      },
      assetProductionReadinessBenchmark: {
        file: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
        value: {
          generatedAt: "2026-05-04T20:30:00.000Z",
          status: "blocked",
          policy: {
            cloudApisUsed: false,
            paidApisUsed: false,
            externalAssetsUsed: false,
            productionUseAllowed: false,
            copyleftRuntimeAllowed: false,
          },
          input: {
            gltfSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json",
            gltfSmokeTool: "gltf-pipeline",
            blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json",
            gltfGeneratedAt: "2026-05-04T20:00:00.000Z",
            blenderGeneratedAt: "2026-05-04T20:00:00.000Z",
            localAssetEvidenceFixtureUsed: false,
          },
          sourceEvidence: {
            gltfSmokePassed: true,
            gltfSmokeTool: "gltf-pipeline",
            blenderBakeSmokePassed: true,
            blenderSourceLicensePosture: "repo_generated_placeholder",
            placeholderBakeOnly: true,
            blenderSemanticInventoryObserved: false,
            blenderMissingRequiredObjectNames: [],
            blockers: ["placeholder_bake_only"],
          },
          productionProofs: {
            generatedHumanRigging: {
              observed: true,
              requiredEvidence: ["neutral generated human GLB", "canonical skeleton binding", "skin-weight or rigging report"],
              blockers: [],
            },
            skinClothingProvenance: {
              observed: true,
              requiredEvidence: ["skin/texture provenance", "clothing mesh provenance", "runtime-safe material report"],
              blockers: [],
            },
            medicalEquipmentLibrary: {
              observed: true,
              requiredEvidence: ["equipment GLB library", "clinical equipment metadata", "license provenance"],
              blockers: [],
            },
            animationRetargeting: {
              observed: true,
              requiredEvidence: ["canonical skeleton clips", "viseme or facial target mapping", "retargeting QA report"],
              blockers: [],
            },
            lodTextureColliderBudget: {
              observed: true,
              requiredEvidence: ["LOD tiers", "KTX2 or texture budget report", "collider simplification report"],
              blockers: [],
            },
            multiActorQuestBudget: {
              observed: true,
              requiredEvidence: ["multi-actor station budget", "Quest frame budget", "draw-call and texture-memory budget"],
              blockers: [],
            },
          },
          generationEvidence: {
            generatedHumanRiggingObserved: true,
            skinClothingProvenanceObserved: true,
            medicalEquipmentLibraryObserved: true,
            animationRetargetingObserved: true,
            placeholderOnly: false,
            blockers: [],
          },
          optimizationEvidence: {
            lodTiersObserved: true,
            textureCompressionBudgetObserved: true,
            colliderSimplificationObserved: true,
            placeholderOnly: false,
            blockers: [],
          },
          stationBudgetEvidence: {
            scenarioId: "ed_chest_pain_priority_v1",
            source: "@openclinxr/asset-registry:createEdChestPainLocalAssetEvidenceFixtureManifests",
            requiredAssetCount: 3,
            placeholderOnly: false,
            observed: true,
            blockers: [],
            budget: {
              maxVisibleTriangles: 180000,
              maxTextureMegabytes: 512,
              maxDrawCalls: 120,
              totalTriangles: 60000,
              totalTextureMegabytes: 80,
              totalDrawCalls: 28,
              blockers: [],
            },
          },
          runtimeBudget: {
            singleAssetPackGlbBytes: 27284,
            targetStationBundleMb: 80,
            maxVisibleTriangles: 180000,
            maxDrawCalls: 120,
            maxTextureMemoryMb: 512,
            multiActorBudgetObserved: true,
            blockers: [],
          },
          claimBoundaries: {
            localAssetEvidenceFixtureIsContractOnly: false,
            artifactBackedProductionAssetEvidenceObserved: false,
            allowedClaims: [],
            notEvidenceFor: [
              "production clinical asset generation readiness",
              "artifact-backed generated human rigging",
              "artifact-backed skin and clothing provenance",
              "artifact-backed medical equipment library coverage",
              "artifact-backed animation retargeting",
              "artifact-backed Quest 3 production bundle budget",
            ],
          },
          verdict: {
            passed: false,
            readyForProductionAssets: false,
            blockers: [
              "source:placeholder_bake_only",
            ],
            caveats: [],
          },
        },
      },
      assetCapabilityJobEvidence: passedAssetCapabilityJobEvidence("2026-05-04T20:25:00.000Z"),
    }, { now: new Date("2026-05-04T20:35:00.000Z"), maxEvidenceAgeHours: 24 });

    const assetGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-005");

    expect(assetGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "asset_pipeline_blender_bake_smoke_passed",
      "asset_pipeline_gltf_pipeline_smoke_passed",
      "asset_production_animation_retargeting_observed",
      "asset_production_capability_job_contract_observed",
      "asset_production_collider_simplification_observed",
      "asset_production_generated_human_rigging_observed",
      "asset_production_lod_tiers_observed",
      "asset_production_medical_equipment_library_observed",
      "asset_production_multi_actor_quest_budget_observed",
      "asset_production_readiness_report_present",
      "asset_production_skin_clothing_provenance_observed",
      "asset_production_source_smokes_passed",
      "asset_production_texture_compression_budget_observed",
    ]));
    expect(assetGate?.blockers).toEqual([
      "asset_production:not_ready_for_production_assets",
      "asset_production:source:placeholder_bake_only",
    ]);
    expect(assetGate?.blockers).not.toEqual(expect.arrayContaining([
      "asset_production:missing_asset_capability_job_evidence_report",
      "asset_production:asset_capability_job_contract_failed",
      "asset_production:missing_generated_human_rigging_report",
      "asset_production:missing_lod_texture_collider_budget_report",
      "asset_production:missing_multi_actor_quest_budget_report",
      "asset_production:placeholder_bake_only",
      "asset_production:generation:generated_human_rigging_missing",
      "asset_production:generation:skin_clothing_provenance_missing",
      "asset_production:generation:medical_equipment_library_missing",
      "asset_production:generation:animation_retargeting_missing",
      "asset_production:optimization:lod_tiers_missing",
      "asset_production:optimization:texture_compression_budget_missing",
      "asset_production:optimization:collider_simplification_report_missing",
      "asset_production:runtime:multi_actor_quest_budget_missing",
    ]));
    expect(assetGate?.blockers.some((blocker) => blocker.startsWith("asset_production:proof:"))).toBe(false);
    expect(report.asset_capability_job_evidence?.summary).toMatchObject({
      allCapabilitiesObserved: true,
      allJobsSucceeded: true,
      allManifestsObserved: true,
      allLicenseProvenanceObserved: true,
      zeroSpendObserved: true,
      noExternalNetworkObserved: true,
      blockers: [],
    });
    expect(report.asset_capability_job_evidence?.verdict).toMatchObject({
      passed: true,
      readyForProductionAssets: false,
      blockers: [],
    });
    expect(report.asset_production_readiness_benchmark?.station_budget_evidence).toEqual({
      scenarioId: "ed_chest_pain_priority_v1",
      source: "@openclinxr/asset-registry:createEdChestPainLocalAssetEvidenceFixtureManifests",
      requiredAssetCount: 3,
      placeholderOnly: false,
      observed: true,
      blockers: [],
      budget: {
        maxVisibleTriangles: 180000,
        maxTextureMegabytes: 512,
        maxDrawCalls: 120,
        totalTriangles: 60000,
        totalTextureMegabytes: 80,
        totalDrawCalls: 28,
        blockers: [],
      },
    });
    expect(report.asset_production_readiness_benchmark?.input).toEqual(expect.objectContaining({
      localAssetEvidenceFixtureUsed: false,
    }));
    expect(report.asset_production_readiness_benchmark?.generation_evidence).toEqual({
      generatedHumanRiggingObserved: true,
      skinClothingProvenanceObserved: true,
      medicalEquipmentLibraryObserved: true,
      animationRetargetingObserved: true,
      placeholderOnly: false,
      blockers: [],
    });
    expect(report.asset_production_readiness_benchmark?.optimization_evidence).toEqual({
      lodTiersObserved: true,
      textureCompressionBudgetObserved: true,
      colliderSimplificationObserved: true,
      placeholderOnly: false,
      blockers: [],
    });
  });

  it("keeps contract-only local asset fixture reports blocked from resolving production asset debt", () => {
    const assetProductionReadinessValue = {
      generatedAt: "2026-05-06T08:19:18.833Z",
      status: "blocked" as const,
      input: {
        gltfSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-06.json",
        gltfSmokeTool: "gltf-pipeline",
        blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-06.json",
        gltfGeneratedAt: "2026-05-06T08:05:00.000Z",
        blenderGeneratedAt: "2026-05-06T08:10:00.000Z",
        localAssetEvidenceFixtureUsed: true,
      },
      sourceEvidence: {
        gltfSmokePassed: true,
        gltfSmokeTool: "gltf-pipeline",
        blenderBakeSmokePassed: true,
        blenderSourceLicensePosture: "reviewed_local_clinical_asset_fixture",
        placeholderBakeOnly: false,
        blenderSemanticInventoryObserved: true,
        blenderMissingRequiredObjectNames: [],
        blockers: [],
      },
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        externalAssetsUsed: false,
        productionUseAllowed: false,
        copyleftRuntimeAllowed: false,
      },
      productionProofs: {
        generatedHumanRigging: {
          observed: true,
          requiredEvidence: ["neutral generated human GLB", "canonical skeleton binding", "skin-weight or rigging report"],
          blockers: [],
        },
        skinClothingProvenance: {
          observed: true,
          requiredEvidence: ["skin/texture provenance", "clothing mesh provenance", "runtime-safe material report"],
          blockers: [],
        },
        medicalEquipmentLibrary: {
          observed: true,
          requiredEvidence: ["equipment GLB library", "clinical equipment metadata", "license provenance"],
          blockers: [],
        },
        animationRetargeting: {
          observed: true,
          requiredEvidence: ["canonical skeleton clips", "viseme or facial target mapping", "retargeting QA report"],
          blockers: [],
        },
        lodTextureColliderBudget: {
          observed: true,
          requiredEvidence: ["LOD tiers", "KTX2 or texture budget report", "collider simplification report"],
          blockers: [],
        },
        multiActorQuestBudget: {
          observed: true,
          requiredEvidence: ["multi-actor station budget", "Quest frame budget", "draw-call and texture-memory budget"],
          blockers: [],
        },
      },
      generationEvidence: {
        generatedHumanRiggingObserved: true,
        skinClothingProvenanceObserved: true,
        medicalEquipmentLibraryObserved: true,
        animationRetargetingObserved: true,
        placeholderOnly: false,
        blockers: [],
      },
      optimizationEvidence: {
        lodTiersObserved: true,
        textureCompressionBudgetObserved: true,
        colliderSimplificationObserved: true,
        placeholderOnly: false,
        blockers: [],
      },
      stationBudgetEvidence: {
        scenarioId: "ed_chest_pain_priority_v1",
        source: "@openclinxr/asset-registry:createEdChestPainLocalAssetEvidenceFixtureManifests",
        requiredAssetCount: 3,
        placeholderOnly: false,
        observed: true,
        blockers: [],
        budget: {
          maxVisibleTriangles: 180000,
          maxTextureMegabytes: 512,
          maxDrawCalls: 120,
          totalTriangles: 60000,
          totalTextureMegabytes: 80,
          totalDrawCalls: 28,
          blockers: [],
        },
      },
      runtimeBudget: {
        singleAssetPackGlbBytes: 109040,
        targetStationBundleMb: 80,
        maxVisibleTriangles: 180000,
        maxDrawCalls: 120,
        maxTextureMemoryMb: 512,
        multiActorBudgetObserved: true,
        blockers: [],
      },
      claimBoundaries: {
        localAssetEvidenceFixtureIsContractOnly: true,
        artifactBackedProductionAssetEvidenceObserved: false,
        allowedClaims: [
          "local asset evidence fixture contract slots observed",
          "reviewed local clinical fixture semantic inventory observed",
        ],
        notEvidenceFor: [
          "production clinical asset generation readiness",
          "artifact-backed generated human rigging",
          "artifact-backed skin and clothing provenance",
          "artifact-backed medical equipment library coverage",
          "artifact-backed animation retargeting",
          "artifact-backed Quest 3 production bundle budget",
        ],
      },
      verdict: {
        passed: false,
        readyForProductionAssets: false,
        blockers: ["artifact_backed_production_asset_evidence_missing"],
        caveats: [
          "The local asset evidence fixture supplies contract-level proof slots only; fixture IDs are not artifact-backed generated production assets.",
        ],
      },
    } satisfies AssetProductionReadinessReport;
    const report = buildBenchmarkGateReport({
      localRuntime: {
        file: "docs/openclinxr/local-runtime-probe-2026-05-04.json",
        value: {
          generatedAt: "2026-05-06T08:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
      gltfPipelineSmoke: {
        file: "docs/openclinxr/gltf-pipeline-smoke-2026-05-06.json",
        value: {
          generatedAt: "2026-05-06T08:05:00.000Z",
          tool: { command: "gltf-pipeline", package: "gltf-pipeline", version: "4.3.1", license: "Apache-2.0" },
          output: { glbBytes: 848, magic: "glTF", version: 2, declaredLength: 848, elapsedMs: 1 },
          verdict: { passed: true, blockers: [] },
        },
      },
      blenderAssetBakeSmoke: {
        file: "docs/openclinxr/blender-asset-bake-smoke-2026-05-06.json",
        value: {
          generatedAt: "2026-05-06T08:10:00.000Z",
          tool: { command: "blender", package: "Blender", version: "Blender 5.1.1", license: "GPL-3.0-or-later-tooling" },
          input: {
            fixture: "ed_chest_pain_clinical_asset_pack",
            externalAssetsUsed: false,
            sourceLicensePosture: "reviewed_local_clinical_asset_fixture",
            expectedObjectCount: 21,
          },
          output: { glbBytes: 109040, magic: "glTF", version: 2, declaredLength: 109040, elapsedMs: 5608.9 },
          verdict: { passed: true, blockers: [] },
        },
      },
      assetCapabilityJobEvidence: passedAssetCapabilityJobEvidence("2026-05-06T08:15:00.000Z"),
      assetProductionReadinessBenchmark: {
        file: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
        value: assetProductionReadinessValue,
      },
      assetProductionEvidenceLadder: {
        file: "docs/openclinxr/asset-production-evidence-ladder-2026-05-06.json",
        value: buildAssetProductionEvidenceLadderReport({
          generatedAt: "2026-05-06T08:20:00.000Z",
          readinessReportFile: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
          readinessReport: assetProductionReadinessValue,
        }),
      },
    } satisfies Parameters<typeof buildBenchmarkGateReport>[0], {
      now: new Date("2026-05-06T09:00:00.000Z"),
      maxEvidenceAgeHours: 24,
    }) as BenchmarkGateReport;

    const assetGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-005");

    expect(assetGate).toMatchObject({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "asset_production:artifact_backed_production_asset_evidence_missing",
        "asset_production:ladder:generatedHumanRigging:contract_only_fixture_not_artifact_backed",
        "asset_production:not_ready_for_production_assets",
      ]),
    });
    expect(assetGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "asset_production_local_fixture_contract_slots_observed",
    ]));
    expect(assetGate?.satisfied_conditions).not.toContain("asset_production_readiness_benchmark_passed");
    expect(report.asset_production_readiness_benchmark?.input).toEqual(expect.objectContaining({
      localAssetEvidenceFixtureUsed: true,
    }));
    expect(report.asset_production_evidence_ladder).toMatchObject({
      file: "docs/openclinxr/asset-production-evidence-ladder-2026-05-06.json",
      schema_version: "openclinxr.asset-production-evidence-ladder.v1",
      status: "blocked",
      source_readiness_report: {
        file: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
        status: "blocked",
        localAssetEvidenceFixtureUsed: true,
      },
      summary: {
        totalLaneCount: 7,
        observedLaneCount: 0,
        contractOnlyLaneCount: 6,
        blockedLaneCount: 7,
        artifactBackedProductionAssetEvidenceObserved: false,
      },
      verdict: {
        passed: false,
        readyForProductionAssets: false,
        blockers: expect.arrayContaining([
          "artifact_backed_production_asset_evidence_missing",
          "generatedHumanRigging:contract_only_fixture_not_artifact_backed",
        ]),
      },
    });
    expect(report.evidence_freshness?.find((entry) => entry.evidence_id === "asset_production_evidence_ladder")).toMatchObject({
      status: "fresh",
      file: "docs/openclinxr/asset-production-evidence-ladder-2026-05-06.json",
    });
  });

  it("flags invalid asset production ladder reports before consuming lane blockers", () => {
    const report = buildBenchmarkGateReport({
      assetProductionEvidenceLadder: {
        file: "docs/openclinxr/asset-production-evidence-ladder-2026-05-06.json",
        value: {
          schemaVersion: "openclinxr.asset-production-evidence-ladder.v1",
          kind: "asset_production_evidence_ladder",
          generatedAt: "2026-05-06T08:20:00.000Z",
          status: "blocked",
          sourceReadinessReport: {
            file: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
            generatedAt: "2026-05-06T08:19:18.833Z",
            status: "blocked",
            localAssetEvidenceFixtureUsed: true,
          },
          policy: {
            installsIntroduced: false,
            cloudApisUsed: false,
            paidApisUsed: false,
            externalAssetsUsed: false,
            productionAssetReadinessClaimed: false,
          },
          lanes: [],
          summary: {
            totalLaneCount: 7,
            observedLaneCount: 0,
            contractOnlyLaneCount: 6,
            blockedLaneCount: 7,
            artifactBackedProductionAssetEvidenceObserved: false,
          },
          verdict: {
            passed: false,
            readyForProductionAssets: false,
            blockers: [
              "artifact_backed_production_asset_evidence_missing",
              "generatedHumanRigging:contract_only_fixture_not_artifact_backed",
            ],
            caveats: ["Contract-only local fixture evidence is not artifact-backed production asset evidence."],
          },
        },
      },
    } as unknown as Parameters<typeof buildBenchmarkGateReport>[0], {
      now: new Date("2026-05-06T09:00:00.000Z"),
      maxEvidenceAgeHours: 24,
    });

    const assetGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-005");

    expect(assetGate?.blockers).toContain("asset_production:ladder:invalid_asset_production_evidence_ladder_report");
  });

  it("consumes asset production artifact evidence without resolving placeholder-only production asset debt", () => {
    const report = buildBenchmarkGateReport({
      assetProductionArtifactEvidence: {
        file: "docs/openclinxr/asset-production-artifact-evidence-2026-05-06.json",
        value: buildAssetProductionArtifactEvidenceReport({
          generatedAt: "2026-05-06T08:25:00.000Z",
        }),
      },
    } as unknown as Parameters<typeof buildBenchmarkGateReport>[0], {
      now: new Date("2026-05-06T09:00:00.000Z"),
      maxEvidenceAgeHours: 24,
    }) as BenchmarkGateReport;

    const assetGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-005");

    expect(report.asset_production_artifact_evidence).toMatchObject({
      file: "docs/openclinxr/asset-production-artifact-evidence-2026-05-06.json",
      schema_version: "openclinxr.asset-production-artifact-evidence.v1",
      status: "blocked",
      summary: {
        allRequiredLanesObserved: true,
        allArtifactFilesMaterialized: false,
        artifactBackedProductionEvidenceObserved: false,
      },
      verdict: {
        passed: false,
        readyForProductionAssets: false,
        blockers: expect.arrayContaining([
          "artifact_backed_production_asset_evidence_missing",
          "generatedHumanRigging:evidence_tier_not_reviewed_generated_production_source",
        ]),
      },
    });
    expect(assetGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "asset_production_artifact_evidence_manifest_present",
      "asset_production_artifact_evidence_lanes_observed",
    ]));
    expect(assetGate?.satisfied_conditions).not.toContain("asset_production_artifact_backed_evidence_observed");
    expect(assetGate?.blockers).toEqual(expect.arrayContaining([
      "asset_production:artifact_evidence:artifact_backed_production_asset_evidence_missing",
      "asset_production:artifact_evidence:generatedHumanRigging:evidence_tier_not_reviewed_generated_production_source",
    ]));
  });

  it("flags invalid asset capability job evidence before accepting contract evidence", () => {
    const invalidCapabilityEvidence = passedAssetCapabilityJobEvidence("2026-05-06T08:15:00.000Z");
    invalidCapabilityEvidence.value.jobs = [];

    const report = buildBenchmarkGateReport({
      assetCapabilityJobEvidence: invalidCapabilityEvidence,
    } as unknown as Parameters<typeof buildBenchmarkGateReport>[0], {
      now: new Date("2026-05-06T09:00:00.000Z"),
      maxEvidenceAgeHours: 24,
    });

    const assetGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-005");

    expect(assetGate?.blockers).toContain("asset_production:invalid_asset_capability_job_evidence_report");
    expect(assetGate?.satisfied_conditions).not.toContain("asset_production_capability_job_contract_observed");
  });

  it("flags invalid asset production readiness evidence before consuming readiness blockers", () => {
    const report = buildBenchmarkGateReport({
      assetProductionReadinessBenchmark: {
        file: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
        value: {
          generatedAt: "2026-05-06T08:19:18.833Z",
          status: "blocked",
          input: {
            localAssetEvidenceFixtureUsed: true,
          },
          sourceEvidence: {
            gltfSmokePassed: true,
            blenderBakeSmokePassed: true,
            placeholderBakeOnly: false,
            blockers: [],
          },
          productionProofs: {},
          runtimeBudget: {
            multiActorBudgetObserved: true,
            blockers: [],
          },
          verdict: {
            passed: false,
            readyForProductionAssets: false,
            blockers: [],
            caveats: [],
          },
        },
      },
    } as unknown as Parameters<typeof buildBenchmarkGateReport>[0], {
      now: new Date("2026-05-06T09:00:00.000Z"),
      maxEvidenceAgeHours: 24,
    });

    const assetGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-005");

    expect(assetGate?.blockers).toContain("asset_production:invalid_asset_production_readiness_benchmark_report");
    expect(assetGate?.satisfied_conditions).not.toContain("asset_production_readiness_report_present");
    expect(assetGate?.satisfied_conditions).not.toContain("asset_production_source_smokes_passed");
  });

  it("summarizes missing Blender asset evidence as an asset-pipeline group", () => {
    const report = buildBenchmarkGateReport({
      localRuntime: {
        file: "runtime.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "blocked", blockers: ["missing_blender"] },
          },
        },
      },
    });
    const groups = report.evidence_gates[0]?.blocker_summary.groups ?? [];

    expect(groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        group_id: "asset_pipeline_blender",
        owner: "asset-pipeline-lead",
        blockers: expect.arrayContaining(["asset_pipeline:missing_blender", "missing_blender_asset_bake_smoke_report"]),
      }),
    ]));
  });

  it("includes Quest foreground preflight blockers in Quest leadership evidence", () => {
    const report = buildBenchmarkGateReport({
      localRuntime: {
        file: "runtime.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: {
              status: "blocked",
              blockers: ["quest_3_asleep_or_not_foreground_ready"],
            },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
    });
    const questGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001");

    expect(questGate?.blockers).toEqual(expect.arrayContaining([
      "quest_foreground_preflight:quest_3_asleep_or_not_foreground_ready",
    ]));
    expect(questGate?.blocker_summary.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        group_id: "quest_foreground_frame_pacing",
        blockers: expect.arrayContaining(["quest_foreground_preflight:quest_3_asleep_or_not_foreground_ready"]),
      }),
    ]));
  });

  it("surfaces IWSDK evidence contract status as a dedicated leadership gate", () => {
    const report = buildBenchmarkGateReport({
      iwsdkEvidenceContract: {
        file: "docs/openclinxr/iwsdk-evidence-contract-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          status: "contract_only",
          verdict: {
            readyForInstallBackedSidecar: false,
            readyForAgentTooling: false,
            readyForProductionRuntime: false,
            blockers: [
              "sidecar:operator_accepts_iwsdk_install_scope",
              "sidecar:exact_iwsdk_versions_selected",
              "sidecar:license_review_accepts_transitive_dependency_posture",
              "compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
              "agent_tooling:adapter_sync_not_recorded",
              "production_runtime:missing_foreground_quest_preflight_ready",
              "metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
            ],
          },
        },
      },
    });

    expect(report.iwsdk_evidence_contract).toEqual({
      file: "docs/openclinxr/iwsdk-evidence-contract-2026-05-04.json",
      generated_at: "2026-05-04T00:00:00.000Z",
      status: "contract_only",
      ready_for_install_backed_sidecar: false,
      ready_for_agent_tooling: false,
      ready_for_production_runtime: false,
      blockers: [
        "agent_tooling:adapter_sync_not_recorded",
        "compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
        "metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
        "production_runtime:missing_foreground_quest_preflight_ready",
        "sidecar:exact_iwsdk_versions_selected",
        "sidecar:license_review_accepts_transitive_dependency_posture",
        "sidecar:operator_accepts_iwsdk_install_scope",
      ],
      leadership_posture: {
        statement: "IWSDK is MIT-licensed and architecturally relevant for Three/WebXR/AI-MCP inspection, but OpenClinXR remains contract-only: no @iwsdk packages installed, no reference warmup, no production runtime claim, and no Quest readiness claim until the local sidecar and manual foreground gates pass.",
        sub_verdicts: [
          {
            area: "license_posture",
            status: "blocked",
            blockers: ["sidecar:license_review_accepts_transitive_dependency_posture"],
          },
          {
            area: "runtime_fit",
            status: "blocked",
            blockers: ["sidecar:exact_iwsdk_versions_selected"],
          },
          {
            area: "vite_fit",
            status: "blocked",
            blockers: ["compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major"],
          },
          {
            area: "ai_mcp_tooling",
            status: "blocked",
            blockers: ["agent_tooling:adapter_sync_not_recorded"],
          },
          {
            area: "quest_manual",
            status: "blocked",
            blockers: ["production_runtime:missing_foreground_quest_preflight_ready"],
          },
          {
            area: "local_only",
            status: "blocked",
            blockers: ["sidecar:operator_accepts_iwsdk_install_scope"],
          },
          {
            area: "reference_downloads",
            status: "blocked",
            blockers: ["metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2"],
          },
        ],
      },
    });
    const blenderGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-004");
    const iwsdkGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-004");

    expect(blenderGate).toEqual(expect.objectContaining({
      evidence_id: "evidence-leadership-0008-004",
      blockers: expect.arrayContaining(["missing_local_runtime_probe_report", "missing_gltf_pipeline_smoke_report", "missing_blender_asset_bake_smoke_report"]),
    }));
    expect(iwsdkGate).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      satisfied_conditions: ["iwsdk_evidence_contract_present"],
      blockers: expect.arrayContaining([
        "iwsdk:agent_tooling:adapter_sync_not_recorded",
        "iwsdk:sidecar:operator_accepts_iwsdk_install_scope",
      ]),
    }));
    expect(iwsdkGate?.blocker_summary?.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        group_id: "iwsdk_sidecar_tooling",
        owner: "xr-systems-architect",
        blockers: expect.arrayContaining([
          "iwsdk:agent_tooling:adapter_sync_not_recorded",
          "iwsdk:sidecar:operator_accepts_iwsdk_install_scope",
        ]),
      }),
    ]));
  });

  it("derives Quest manual performance checks from raw foreground headset reports", () => {
    const report = buildBenchmarkGateReport({
      questSmoke: {
        file: "quest.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          url: "http://localhost:5173/",
          target: "station",
          adb: {
            version: "Android Debug Bridge version 1.0.41",
            deviceLine: "1234 device product:quest3",
            reverseList: "1234 tcp:5173 tcp:5173",
          },
          browser: {
            userAgent: "Mozilla/5.0 Quest 3",
            hidden: false,
            visibilityState: "visible",
          },
          interaction: {},
          frameSample: {},
          verdict: {
            shellLoaded: true,
            interactionAdvanced: true,
            frameSampleComplete: false,
            immersiveEntryOutcome: "not_requested",
            blockers: ["quest_cdp_frame_sample_incomplete"],
          },
        },
      },
      questManualPerformanceReport: {
        file: "docs/openclinxr/quest-manual-performance-2026-05-04.json",
        value: completedQuestManualPerformanceReport,
      },
      localRuntime: {
        file: "runtime.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
    });
    const questGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001");

    expect(report.quest_manual_performance?.file).toBe("docs/openclinxr/quest-manual-performance-2026-05-04.json");
    expect(report.quest_manual_performance?.input_file).toBe("docs/openclinxr/quest-manual-performance-2026-05-04.json");
    expect(report.quest_manual_performance?.evidence_posture).toBe("full_vr_frame_pacing_readiness");
    expect(report.quest_manual_performance?.adversarial_findings).toEqual([]);
    expect(report.quest_smoke).toEqual(expect.objectContaining({
      classification: "blocked",
      ready_for_foreground_quest_claim: false,
      blockers: expect.arrayContaining([
        "quest_cdp_frame_sample_incomplete",
        "quest_frame_stats_missing",
      ]),
    }));
    expect(questGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "quest_manual_frame_pacing_ready",
      "performed_by_recorded",
      "immersive_session_started",
      "frame_sample_600_or_more",
      "immersive_frame_count_recorded",
      "rolling_frame_window_120_or_more",
      "average_fps_72_or_higher",
      "p95_frame_ms_25_or_lower",
      "controller_select_latency_150ms_or_lower",
      "hand_or_controller_input_observed",
      "locomotion_observed",
    ]));
    expect(questGate?.blockers).not.toContain("quest_manual_performance:missing_quest_manual_performance_report");
  });

  it("derives Quest manual benchmark readiness from copied UI payloads", () => {
    const report = buildBenchmarkGateReport({
      questSmoke: {
        file: "quest.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          url: "http://localhost:5173/",
          target: "station",
          adb: {
            version: "Android Debug Bridge version 1.0.41",
            deviceLine: "1234 device product:quest3",
            reverseList: "1234 tcp:5173 tcp:5173",
          },
          browser: {
            userAgent: "Mozilla/5.0 Quest 3",
            hidden: false,
            visibilityState: "visible",
          },
          interaction: {},
          frameSample: {},
          verdict: {
            shellLoaded: true,
            interactionAdvanced: true,
            frameSampleComplete: false,
            immersiveEntryOutcome: "not_requested",
            blockers: ["quest_cdp_frame_sample_incomplete"],
          },
        },
      },
      questManualPerformanceReport: {
        file: "docs/openclinxr/quest-manual-performance-2026-05-04.json",
        value: {
          manualPerformanceDraft: completedQuestManualPerformanceReport,
          captureSummary: {
            draftAvailable: true,
            manualValidationReady: true,
            frameStatsFresh: true,
            blockers: [],
          },
          textPanelEvidence: completedQuestTextPanelEvidence,
          sceneAssetEvidence: completedQuestSceneAssetEvidence,
        },
      },
    });
    const questGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001");

    expect(report.quest_manual_performance?.adversarial_findings).toEqual([
      "copied_ui_manual_performance_payload",
      "generated_scene_asset_evidence:runtime_asset_load_status_only",
      "generated_scene_assets_are_visual_runtime_presence_evidence_only",
    ]);
    expect(questGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "quest_manual_frame_pacing_ready",
      "frame_sample_600_or_more",
      "immersive_frame_count_recorded",
      "controller_select_latency_150ms_or_lower",
      "generated_scene_assets_loaded",
    ]));
    expect(questGate?.blockers).not.toContain("quest_manual_performance:missing_quest_manual_performance_report");
  });

  it("surfaces Quest Mixed Reality manual checks separately without satisfying Full VR gates", () => {
    const report = buildBenchmarkGateReport({
      questMixedRealityManualReport: {
        file: "docs/openclinxr/quest-mixed-reality-manual-2026-05-04.json",
        value: completedQuestMixedRealityManualReport,
      },
    });
    const questGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001");

    expect(report.quest_mixed_reality_manual).toMatchObject({
      file: "docs/openclinxr/quest-mixed-reality-manual-2026-05-04.json",
      input_file: "docs/openclinxr/quest-mixed-reality-manual-2026-05-04.json",
      ready_to_claim_mixed_reality_readiness: true,
      ready_to_claim_full_vr_readiness: false,
      blockers: [],
      not_evidence_for: [
        "replacement_for_full_vr",
        "production_quest_readiness",
        "passthrough_privacy_readiness",
        "clinical_room_safety_readiness",
      ],
    });
    expect(report.quest_mixed_reality_manual?.satisfied_conditions).toEqual(expect.arrayContaining([
      "mixed_reality_session_started",
      "passthrough_observed",
      "clinical_text_readable",
      "frame_sample_600_or_more",
    ]));
    expect(report.evidence_freshness.map((entry) => entry.evidence_id)).toContain("quest_mixed_reality_manual");
    expect(questGate?.satisfied_conditions).not.toContain("mixed_reality_session_started");
    expect(questGate?.satisfied_conditions).not.toContain("passthrough_observed");
    expect(questGate?.blockers).toEqual(expect.arrayContaining([
      "missing_quest_manual_performance_check",
    ]));
    expect(questGate?.ready_to_resolve).toBe(false);
  });

  it("surfaces visual QA evidence as adversarial support without satisfying production or physical Quest claims", () => {
    const report = buildBenchmarkGateReport({
      visualQaEvidence: {
        file: "docs/openclinxr/visual-qa-evidence-2026-05-04.json",
        value: completedVisualQaEvidence,
      },
    });
    const questGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001");

    expect(report.visual_qa_evidence).toEqual({
      file: "docs/openclinxr/visual-qa-evidence-2026-05-04.json",
      ready_for_adversarial_visual_qa: true,
      ready_for_production_runtime: false,
      ready_for_physical_quest_claim: false,
      capture: {
        source: "iwer_emulation",
        artifact_type: "screenshot",
        artifact: "docs/openclinxr/screenshots/iwer-sidecar-agent-browser-2026-05-04.png",
        scenario_id: "ed_chest_pain_priority_v1",
        xr_mode: "desktop_managed_browser_not_immersive_session",
      },
      blockers: [],
      allowed_claims: ["adversarial_visual_iteration_artifact"],
      not_evidence_for: [
        "physical_quest_foreground_frame_pacing",
        "quest_controller_latency",
        "quest_hand_tracking_quality",
        "in_headset_text_readability",
        "thermal_or_battery_behavior",
        "production_runtime_readiness",
      ],
    });
    expect(questGate?.ready_to_resolve).toBe(false);
    expect(questGate?.satisfied_conditions).not.toContain("adversarial_visual_iteration_artifact");
    expect(questGate?.blockers).toEqual(expect.arrayContaining([
      "missing_quest_manual_performance_check",
    ]));
  });

  it("keeps copied UI payload summary blockers in Quest manual benchmark gates", () => {
    const report = buildBenchmarkGateReport({
      questManualPerformanceReport: {
        file: "docs/openclinxr/quest-manual-performance-2026-05-04.json",
        value: {
          manualPerformanceDraft: completedQuestManualPerformanceReport,
          captureSummary: {
            draftAvailable: true,
            manualValidationReady: false,
            frameStatsFresh: false,
            blockers: ["frame_stats_stale_or_unsampled"],
          },
          textPanelEvidence: completedQuestTextPanelEvidence,
        },
      },
    });
    const questGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001");

    expect(report.quest_manual_performance?.blockers).toEqual([
      "copied_payload_summary_not_ready",
      "frame_stats_stale_or_unsampled",
    ]);
    expect(questGate?.blockers).toContain("quest_manual_performance:copied_payload_summary_not_ready");
    expect(questGate?.blockers).toContain("quest_manual_performance:frame_stats_stale_or_unsampled");
  });

  it("keeps unknown copied locomotion probe reasons blocked in Quest leadership gates", () => {
    const report = buildBenchmarkGateReport({
      questManualPerformanceReport: {
        file: "docs/openclinxr/quest-manual-performance-copied-probe-unknown.json",
        value: {
          manualPerformanceDraft: completedQuestManualPerformanceReport,
          captureSummary: {
            draftAvailable: true,
            manualValidationReady: false,
            frameStatsFresh: true,
            blockers: [],
            technicalGaps: [],
            locomotionProbeSummary: {
              claimScope: "runtime_probe_only",
              readiness: "blocked",
              primaryReason: "future_probe_reason",
              reasonCodes: ["future_probe_reason"],
            },
          },
          textPanelEvidence: completedQuestTextPanelEvidence,
        },
      },
    });
    const questGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001");

    expect(report.quest_manual_performance?.blockers).toEqual(expect.arrayContaining([
      "copied_payload_locomotion_probe_reason_invalid:future_probe_reason",
    ]));
    expect(questGate?.blockers).toContain(
      "quest_manual_performance:copied_payload_locomotion_probe_reason_invalid:future_probe_reason",
    );
    expect(report.quest_manual_performance?.next_steps).toContain(
      "Re-copy the in-app Quest Evidence payload after updating the manual checker to recognize locomotion probe reason future_probe_reason.",
    );
  });

  it("keeps copied locomotion probe blockers in Quest leadership gates", () => {
    const report = buildBenchmarkGateReport({
      questManualPerformanceReport: {
        file: "docs/openclinxr/quest-manual-performance-copied-probe-blocked.json",
        value: {
          manualPerformanceDraft: completedQuestManualPerformanceReport,
          captureSummary: {
            draftAvailable: true,
            manualValidationReady: false,
            frameStatsFresh: true,
            blockers: [],
            technicalGaps: [],
            locomotionProbeSummary: {
              claimScope: "runtime_probe_only",
              readiness: "blocked",
              primaryReason: "no_gamepad_sources",
              reasonCodes: ["no_gamepad_sources", "hand_arming_dwell", "hand_below_deadzone"],
            },
          },
          textPanelEvidence: completedQuestTextPanelEvidence,
        },
      },
    });
    const questGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001");

    expect(report.quest_manual_performance?.blockers).toEqual(expect.arrayContaining([
      "copied_payload_locomotion_probe:no_gamepad_sources",
      "copied_payload_locomotion_probe:hand_arming_dwell",
      "copied_payload_locomotion_probe:hand_below_deadzone",
    ]));
    expect(questGate?.blockers).toEqual(expect.arrayContaining([
      "quest_manual_performance:copied_payload_locomotion_probe:no_gamepad_sources",
      "quest_manual_performance:copied_payload_locomotion_probe:hand_arming_dwell",
      "quest_manual_performance:copied_payload_locomotion_probe:hand_below_deadzone",
    ]));
    expect(report.quest_manual_performance?.adversarial_findings).toContain("locomotion_probe:runtime_probe_only");
  });

  it("surfaces CDP manual harvest summaries in Quest benchmark gates", () => {
    const report = buildBenchmarkGateReport({
      questManualPerformanceReport: {
        file: "docs/openclinxr/quest-manual-performance-harvest-2026-05-04.json",
        value: {
          manualPerformanceDraft: completedQuestManualPerformanceReport,
          captureSummary: {
            draftAvailable: true,
            manualValidationReady: true,
            frameStatsFresh: true,
            blockers: [],
          },
          textPanelEvidence: completedQuestTextPanelEvidence,
          harvestSummary: {
            source: "quest_cdp_manual_evidence_harvest",
            ready: false,
            timedOut: true,
            blockers: ["headset_trace_latency_missing"],
            elapsedWallMs: 9000,
            signalSnapshot: {
              textPanelMetadataPresent: true,
              textPanelCount: 3,
              frameStatsFresh: true,
              immersiveFramesObserved: 720,
              sampleWindowSize: 120,
              immersiveFrameReady: true,
              sampleWindowReady: true,
              sceneAssetEvidencePresent: true,
              generatedSceneAssetsLoaded: true,
              generatedSceneAssetExpectedCount: 6,
              generatedSceneAssetLoadedCount: 6,
              generatedSceneAssetFallbackCount: 0,
              traceSource: null,
              lastTraceTag: null,
              lastTraceLatencyMs: null,
              headsetTraceEvidencePresent: false,
              activeLocomotionSource: "none",
              locomotionAttempt: "not_attempted",
              lastLocomotionAtMs: null,
              locomotionDistanceMeters: null,
              locomotionTurnRadians: null,
              locomotionDelta: null,
              locomotionEvidencePresent: false,
              locomotionProbeReasonCodes: [],
              technicalGaps: ["headset_trace_latency_missing"],
            },
          },
        },
      },
    });
    const questManualPerformance = report.quest_manual_performance as typeof report.quest_manual_performance & {
      harvest_summary?: {
        source?: string;
        ready?: boolean;
        timed_out?: boolean;
        blockers?: string[];
        elapsed_wall_ms?: number | null;
        signal_snapshot?: Record<string, unknown> | null;
      };
      next_steps?: string[];
    };
    const questGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001");

    expect(questManualPerformance?.harvest_summary).toMatchObject({
      source: "quest_cdp_manual_evidence_harvest",
      ready: false,
      timed_out: true,
      blockers: ["headset_trace_latency_missing"],
      elapsed_wall_ms: 9000,
      signal_snapshot: {
        sceneAssetEvidencePresent: true,
        generatedSceneAssetsLoaded: true,
        generatedSceneAssetExpectedCount: 6,
        generatedSceneAssetLoadedCount: 6,
        generatedSceneAssetFallbackCount: 0,
      },
    });
    expect(report.quest_manual_performance?.blockers).toEqual([
      "manual_evidence_harvest_not_ready",
      "manual_evidence_harvest_timed_out",
      "headset_trace_latency_missing",
    ]);
    expect(questGate?.blockers).toContain("quest_manual_performance:manual_evidence_harvest_not_ready");
    expect(questGate?.blockers).toContain("quest_manual_performance:headset_trace_latency_missing");
    expect(questManualPerformance?.next_steps).toEqual(expect.arrayContaining([
      "Rerun the CDP manual evidence harvester after the headset is foregrounded and the missing technical signal is visible.",
      "Trigger an xr_controller_select or xr_hand_select trace action before harvesting manual evidence.",
    ]));
  });

  it("marks the leadership evidence gate ready when all fixture evidence is satisfied", () => {
    const report = buildBenchmarkGateReport({
      questSmoke: {
        file: "quest.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          url: "http://localhost:5173/",
          target: "station",
          adb: {
            version: "Android Debug Bridge version 1.0.41",
            deviceLine: "1234 device product:quest3",
            reverseList: "1234 tcp:5173 tcp:5173",
          },
          browser: {
            userAgent: "Mozilla/5.0 Quest 3",
            hidden: false,
            visibilityState: "visible",
            ...healthyQuestRuntimeEvidence(),
          },
          interaction: {},
          frameSample: healthyQuestFrameSampleEvidence(),
          verdict: {
            shellLoaded: true,
            interactionAdvanced: true,
            frameSampleComplete: true,
            immersiveEntryOutcome: "not_requested",
            blockers: [],
          },
        },
      },
      questManualPerformance: {
        file: "quest-manual.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          inputFile: "manual-input.json",
          evidencePosture: "full_vr_frame_pacing_readiness",
          readyToClaimFramePacing: true,
          satisfiedConditions: ["average_fps_72_or_higher"],
          blockers: [],
          adversarialFindings: [],
          nextSteps: [],
        },
      },
      localRuntime: {
        file: "runtime.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
      gltfPipelineSmoke: {
        file: "gltf.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          tool: { command: "gltf-pipeline", package: "gltf-pipeline", version: "4.3.1", license: "Apache-2.0" },
          output: { glbBytes: 1024, magic: "glTF", version: 2, declaredLength: 1024, elapsedMs: 10 },
          verdict: { passed: true, blockers: [] },
        },
      },
      blenderAssetBakeSmoke: {
        file: "blender.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          tool: { command: "blender", package: "Blender", version: "Blender 5.1.1", license: "GPL-3.0-or-later-tooling" },
          input: {
            fixture: "low_poly_clinical_humanoid",
            externalAssetsUsed: false,
            sourceLicensePosture: "repo_generated_placeholder",
            expectedObjectCount: 7,
          },
          output: { glbBytes: 4096, magic: "glTF", version: 2, declaredLength: 4096, elapsedMs: 2500 },
          verdict: { passed: true, blockers: [] },
        },
      },
      localProviderBenchmark: {
        file: "provider.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          mockModel: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          mockVoice: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          localModel: { status: "passed", blockers: [], metrics: {} },
          localVoice: { status: "passed", blockers: [], metrics: {} },
          verdict: {
            deterministicMocksPassed: true,
            localModelReadyToBenchmark: true,
            localVoiceReadyToBenchmark: true,
            blockers: [],
          },
        },
      },
    }, { now: new Date("2026-05-04T20:20:00.000Z"), maxEvidenceAgeHours: 24 });
    const gate = report.evidence_gates[0];

    expect(gate?.ready_to_resolve).toBe(true);
    expect(gate?.blockers).toEqual([]);
    expect(gate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "quest_shell_loaded",
      "quest_manual_frame_pacing_ready",
      "asset_pipeline_gltf_pipeline_smoke_passed",
      "asset_pipeline_blender_bake_smoke_passed",
      "local_model_ready_to_benchmark",
      "local_voice_ready_to_benchmark",
    ]));
  });
});

function passedAssetCapabilityJobEvidence(
  generatedAt = "2026-05-04T20:25:00.000Z",
): NonNullable<Parameters<typeof buildBenchmarkGateReport>[0]["assetCapabilityJobEvidence"]> {
  const capabilityIds = [
    "character-generation",
    "medical-equipment-generation",
    "voice-asset-generation",
    "animation-generation",
    "asset-bake",
  ] as const;

  return {
    file: "docs/openclinxr/asset-capability-job-evidence-2026-05-04.json",
    value: {
      generatedAt,
      status: "passed",
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        externalNetworkAllowed: false,
        spendLimitCents: 0,
        productionArtifactClaimed: false,
      },
      summary: {
        requiredCapabilityIds: [...capabilityIds],
        observedCapabilityIds: [...capabilityIds],
        allCapabilitiesObserved: true,
        allJobsSucceeded: true,
        allManifestsObserved: true,
        allArtifactFilesMaterialized: false,
        missingArtifactPathCount: capabilityIds.length * 2,
        allLicenseProvenanceObserved: true,
        zeroSpendObserved: true,
        noExternalNetworkObserved: true,
        blockers: [],
      },
      jobs: capabilityIds.map((capabilityId, index) => ({
        capabilityId,
        jobId: `asset-capability-job-${String(index + 1).padStart(3, "0")}`,
        status: "succeeded",
        worker: {
          providerId: `deterministic-${capabilityId}`,
          providerKind: "deterministic-mock",
          implementationLanguage: "typescript",
          transport: "in-process",
        },
        artifactKinds: ["manifest", "source"],
        artifactPaths: [
          `.openclinxr/asset-generation/asset-capability-job-${String(index + 1).padStart(3, "0")}/${capabilityId}-manifest.json`,
          `.openclinxr/asset-generation/asset-capability-job-${String(index + 1).padStart(3, "0")}/${capabilityId}-source.asset.json`,
        ],
        allArtifactFilesMaterialized: false,
        missingArtifactPaths: [
          `.openclinxr/asset-generation/asset-capability-job-${String(index + 1).padStart(3, "0")}/${capabilityId}-manifest.json`,
          `.openclinxr/asset-generation/asset-capability-job-${String(index + 1).padStart(3, "0")}/${capabilityId}-source.asset.json`,
        ],
        manifestObserved: true,
        licenseProvenanceObserved: true,
        zeroSpendObserved: true,
        noExternalNetworkObserved: true,
        passed: true,
        blockers: [],
      })),
      verdict: {
        passed: true,
        readyForProductionAssets: false,
        blockers: [],
        caveats: ["Deterministic control-plane evidence only."],
      },
    },
  };
}
