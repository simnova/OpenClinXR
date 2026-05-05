import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildQuestManualPerformanceCheck,
  type QuestManualPerformanceCheck,
  type QuestManualPerformancePayload,
} from "../openclinxr/check-quest-manual-performance.js";
import {
  buildQuestMixedRealityManualCheck,
  type QuestMixedRealityManualCheck,
  type QuestMixedRealityManualReport,
} from "../openclinxr/check-quest-mixed-reality-manual.js";
import {
  buildQuestSmokeEvidenceCheck,
  type QuestSmokeEvidenceCheck,
  type QuestSmokeReport,
} from "../openclinxr/quest-cdp-smoke.js";
import type { ApiBunWebSocketRuntimeSmokeReport } from "../openclinxr/api-bun-websocket-runtime-smoke.js";
import type { ApiPythonBackendRuntimeSmokeReport } from "../openclinxr/api-python-backend-runtime-smoke.js";
import {
  buildVisualQaEvidenceReport,
  type VisualQaEvidence,
  type VisualQaEvidenceReport,
} from "../openclinxr/visual-qa-evidence-check.js";
import { globFiles, readJson, writeJson } from "./lib.js";

type GateStatus = {
  status: "ready" | "not_configured" | "blocked";
  blockers: string[];
};

type LocalRuntimeProbeReport = {
  generatedAt: string;
  gates: {
    questUsb: GateStatus;
    questForegroundPreflight?: GateStatus;
    apiBunRuntime?: GateStatus;
    localModel: GateStatus;
    localVoice: GateStatus;
    assetPipeline: GateStatus;
  };
};

type GltfPipelineSmokeReport = {
  generatedAt: string;
  tool: {
    command: string;
    package: string;
    version: string;
    license: string;
  };
  output: {
    glbBytes: number;
    magic: string;
    version: number | null;
    declaredLength: number | null;
    elapsedMs: number;
  };
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

type BlenderAssetBakeSmokeReport = {
  generatedAt: string;
  tool: {
    command: string;
    package: string;
    version: string;
    license: string;
  };
  input: {
    fixture: string;
    externalAssetsUsed: boolean;
    sourceLicensePosture: string;
    expectedObjectCount: number;
  };
  output: {
    glbBytes: number;
    magic: string;
    version: number | null;
    declaredLength: number | null;
    elapsedMs: number;
  };
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

type AssetProductionReadinessBenchmarkReport = {
  generatedAt: string;
  status: string;
  sourceEvidence: {
    gltfPipelineSmokePassed: boolean;
    blenderBakeSmokePassed: boolean;
    placeholderBakeOnly: boolean;
    blockers: string[];
  };
  productionProofs: Record<string, { observed: boolean; blockers: string[] }>;
  generationEvidence?: {
    generatedHumanRiggingObserved: boolean;
    skinClothingProvenanceObserved: boolean;
    medicalEquipmentLibraryObserved: boolean;
    animationRetargetingObserved: boolean;
    placeholderOnly: boolean;
    blockers: string[];
  };
  optimizationEvidence?: {
    lodTiersObserved: boolean;
    textureCompressionBudgetObserved: boolean;
    colliderSimplificationObserved: boolean;
    placeholderOnly: boolean;
    blockers: string[];
  };
  stationBudgetEvidence?: {
    scenarioId: string;
    source: string;
    requiredAssetCount: number;
    observed: boolean;
    blockers: string[];
    budget: Record<string, unknown>;
  };
  runtimeBudget: {
    multiActorBudgetObserved: boolean;
    blockers: string[];
  };
  verdict: {
    passed: boolean;
    blockers: string[];
    caveats: string[];
  };
};

type AssetCapabilityJobEvidenceReport = {
  generatedAt: string;
  status: string;
  summary: {
    allCapabilitiesObserved: boolean;
    allJobsSucceeded: boolean;
    allManifestsObserved: boolean;
    allLicenseProvenanceObserved: boolean;
    zeroSpendObserved: boolean;
    noExternalNetworkObserved: boolean;
    blockers: string[];
  };
  jobs: Array<{
    capabilityId: string;
    passed: boolean;
    blockers: string[];
  }>;
  verdict: {
    passed: boolean;
    readyForProductionAssets: false;
    blockers: string[];
    caveats: string[];
  };
};

type LocalProviderBenchmarkReport = {
  generatedAt: string;
  mockModel: {
    status: string;
    latencyMs: number | null;
    blockers: string[];
    metrics: Record<string, unknown>;
  };
  mockVoice: {
    status: string;
    latencyMs: number | null;
    blockers: string[];
    metrics: Record<string, unknown>;
  };
  localModel: {
    status: string;
    blockers: string[];
    metrics: Record<string, unknown>;
  };
  localVoice: {
    status: string;
    blockers: string[];
    metrics: Record<string, unknown>;
  };
  verdict: {
    deterministicMocksPassed: boolean;
    localModelReadyToBenchmark: boolean;
    localVoiceReadyToBenchmark: boolean;
    blockers: string[];
  };
};

type LocalModelRuntimeBenchmarkReport = {
  generatedAt: string;
  status: string;
  runtime: Record<string, unknown>;
  metrics: Record<string, unknown>;
  output: Record<string, unknown>;
  verdict: {
    passed: boolean;
    blockers: string[];
    caveats: string[];
  };
};

type LocalModelQualityBenchmarkReport = {
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

type LocalVoiceRuntimeBenchmarkReport = {
  generatedAt: string;
  status: string;
  runtime: Record<string, unknown>;
  audio: Record<string, unknown>;
  metrics: Record<string, unknown>;
  verdict: {
    passed: boolean;
    blockers: string[];
    caveats: string[];
  };
};

type LocalVoiceLiveDialogBenchmarkReport = {
  generatedAt: string;
  status: string;
  mockStream: {
    passed: boolean;
    blockers: string[];
  };
  runtimeFit: {
    blockers: string[];
  };
  runtimeStream?: {
    realLocalVoiceStreamObserved: boolean;
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

type RealtimeVoiceTransportSpikeReport = {
  generatedAt: string;
  status: string;
  harness: {
    roundTripLatencyMs: number;
    audioMetadataFramesSent?: number;
    audioChunkMetadataReceived?: number;
    frameLatencySamplesMs?: number[];
    audioChunkIndexesReceived?: number[];
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

type IwsdkEvidenceContractReport = {
  generatedAt: string;
  status: string;
  verdict: {
    readyForInstallBackedSidecar: boolean;
    readyForAgentTooling: boolean;
    readyForProductionRuntime: boolean;
    blockers: string[];
  };
};

type IwsdkLeadershipPosture = {
  statement: string;
  sub_verdicts: Array<{
    area: string;
    status: "ready" | "blocked";
    blockers: string[];
  }>;
};

type EvidenceGateReport = {
  generated_by: string;
  evidence_freshness: EvidenceFreshnessEntry[];
  quest_smoke?: {
    file: string;
    generated_at: string;
    shell_loaded: boolean;
    interaction_advanced: boolean;
    frame_sample_complete: boolean;
    ready_for_foreground_quest_claim: boolean;
    classification: QuestSmokeEvidenceCheck["classification"];
    satisfied_conditions: string[];
    blockers: string[];
  };
  local_runtime_probe?: {
    file: string;
    generated_at: string;
    gates: LocalRuntimeProbeReport["gates"];
  };
  gltf_pipeline_smoke?: {
    file: string;
    generated_at: string;
    tool: GltfPipelineSmokeReport["tool"];
    output: GltfPipelineSmokeReport["output"];
    passed: boolean;
    blockers: string[];
  };
  blender_asset_bake_smoke?: {
    file: string;
    generated_at: string;
    tool: BlenderAssetBakeSmokeReport["tool"];
    input: BlenderAssetBakeSmokeReport["input"];
    output: BlenderAssetBakeSmokeReport["output"];
    passed: boolean;
    blockers: string[];
  };
  asset_production_readiness_benchmark?: {
    file: string;
    generated_at: string;
    status: string;
    source_evidence: AssetProductionReadinessBenchmarkReport["sourceEvidence"];
    production_proofs: AssetProductionReadinessBenchmarkReport["productionProofs"];
    generation_evidence: AssetProductionReadinessBenchmarkReport["generationEvidence"];
    optimization_evidence: AssetProductionReadinessBenchmarkReport["optimizationEvidence"];
    station_budget_evidence?: AssetProductionReadinessBenchmarkReport["stationBudgetEvidence"];
    runtime_budget: AssetProductionReadinessBenchmarkReport["runtimeBudget"];
    verdict: AssetProductionReadinessBenchmarkReport["verdict"];
  };
  asset_capability_job_evidence?: {
    file: string;
    generated_at: string;
    status: string;
    summary: AssetCapabilityJobEvidenceReport["summary"];
    jobs: AssetCapabilityJobEvidenceReport["jobs"];
    verdict: AssetCapabilityJobEvidenceReport["verdict"];
  };
  local_provider_benchmark?: {
    file: string;
    generated_at: string;
    mock_model: LocalProviderBenchmarkReport["mockModel"];
    mock_voice: LocalProviderBenchmarkReport["mockVoice"];
    local_model: LocalProviderBenchmarkReport["localModel"];
    local_voice: LocalProviderBenchmarkReport["localVoice"];
    verdict: LocalProviderBenchmarkReport["verdict"];
  };
  local_model_runtime_benchmark?: {
    file: string;
    generated_at: string;
    status: string;
    runtime: LocalModelRuntimeBenchmarkReport["runtime"];
    metrics: LocalModelRuntimeBenchmarkReport["metrics"];
    output: LocalModelRuntimeBenchmarkReport["output"];
    verdict: LocalModelRuntimeBenchmarkReport["verdict"];
  };
  local_model_quality_benchmark?: {
    file: string;
    generated_at: string;
    status: string;
    structured_output: LocalModelQualityBenchmarkReport["structuredOutput"];
    actor_policy: LocalModelQualityBenchmarkReport["actorPolicy"];
    target_hardware: LocalModelQualityBenchmarkReport["targetHardware"];
    verdict: LocalModelQualityBenchmarkReport["verdict"];
  };
  local_voice_runtime_benchmark?: {
    file: string;
    generated_at: string;
    status: string;
    runtime: LocalVoiceRuntimeBenchmarkReport["runtime"];
    audio: LocalVoiceRuntimeBenchmarkReport["audio"];
    metrics: LocalVoiceRuntimeBenchmarkReport["metrics"];
    verdict: LocalVoiceRuntimeBenchmarkReport["verdict"];
  };
  local_voice_live_dialog_benchmark?: {
    file: string;
    generated_at: string;
    status: string;
    mock_stream: LocalVoiceLiveDialogBenchmarkReport["mockStream"];
    runtime_fit: LocalVoiceLiveDialogBenchmarkReport["runtimeFit"];
    runtime_stream: LocalVoiceLiveDialogBenchmarkReport["runtimeStream"];
    webxr_playback: LocalVoiceLiveDialogBenchmarkReport["webxrPlayback"];
    safety_controls: LocalVoiceLiveDialogBenchmarkReport["safetyControls"];
    verdict: LocalVoiceLiveDialogBenchmarkReport["verdict"];
  };
  realtime_voice_transport_spike?: {
    file: string;
    generated_at: string;
    status: string;
    round_trip_latency_ms: number;
    audio_metadata_frames_sent?: number;
    audio_chunk_metadata_received?: number;
    frame_latency_samples_ms?: number[];
    audio_chunk_indexes_received?: number[];
    latency_budget: RealtimeVoiceTransportSpikeReport["harness"]["latencyBudget"];
    protocol_evidence?: {
      websocket_local_harness_observed: boolean;
      bun_hono_runtime_observed: boolean;
      webtransport_observed: boolean;
      quic_observed: boolean;
      web3_signaling_observed: boolean;
      notes: string[];
    };
    python_backend_verifier: RealtimeVoiceTransportSpikeReport["pythonBackendVerifier"];
    verdict: RealtimeVoiceTransportSpikeReport["verdict"];
  };
  api_python_backend_runtime_smoke?: {
    file: string;
    generated_at: string;
    status: string;
    python: ApiPythonBackendRuntimeSmokeReport["python"];
    health: ApiPythonBackendRuntimeSmokeReport["health"];
    capabilities: ApiPythonBackendRuntimeSmokeReport["capabilities"];
    websocket: ApiPythonBackendRuntimeSmokeReport["websocket"];
    verdict: ApiPythonBackendRuntimeSmokeReport["verdict"];
  };
  api_bun_websocket_runtime_smoke?: {
    file: string;
    generated_at: string;
    status: string;
    bun: ApiBunWebSocketRuntimeSmokeReport["bun"];
    health: ApiBunWebSocketRuntimeSmokeReport["health"];
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
      caveats: string[];
    };
  };
  quest_manual_performance?: {
    file: string;
    generated_at: string;
    input_file: string | null;
    evidence_posture: QuestManualPerformanceCheck["evidencePosture"];
    ready_to_claim_frame_pacing: boolean;
    satisfied_conditions: string[];
    blockers: string[];
    adversarial_findings: string[];
    next_steps: string[];
    harvest_summary?: {
      source?: string;
      ready?: boolean;
      timed_out?: boolean;
      blockers: string[];
      elapsed_wall_ms?: number | null;
    };
  };
  quest_mixed_reality_manual?: {
    file: string;
    generated_at: string;
    input_file: string | null;
    ready_to_claim_mixed_reality_readiness: boolean;
    ready_to_claim_full_vr_readiness: false;
    satisfied_conditions: string[];
    blockers: string[];
    not_evidence_for: string[];
    next_steps: string[];
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
    leadership_posture: IwsdkLeadershipPosture;
  };
  evidence_gates: Array<{
    evidence_id: string;
    ready_to_resolve: boolean;
    satisfied_conditions: string[];
    blockers: string[];
    blocker_summary: BlockerSummary;
  }>;
};

type BlockerSummary = {
  total_blockers: number;
  distinct_problem_count: number;
  groups: BlockerGroup[];
  ungrouped_blockers: string[];
};

type BlockerGroup = {
  group_id: string;
  title: string;
  owner: string;
  blockers: string[];
  next_step: string;
};

type EvidenceFile<TValue> = { file: string; value: TValue };

type EvidenceFreshnessStatus = "fresh" | "stale" | "missing" | "invalid";

type EvidenceFreshnessEntry = {
  evidence_id: string;
  file: string | null;
  generated_at: string | null;
  age_hours: number | null;
  max_age_hours: number;
  status: EvidenceFreshnessStatus;
  blockers: string[];
};

export type BenchmarkGateReportInput = {
  questSmoke?: EvidenceFile<QuestSmokeReport>;
  localRuntime?: EvidenceFile<LocalRuntimeProbeReport>;
  gltfPipelineSmoke?: EvidenceFile<GltfPipelineSmokeReport>;
  blenderAssetBakeSmoke?: EvidenceFile<BlenderAssetBakeSmokeReport>;
  assetCapabilityJobEvidence?: EvidenceFile<AssetCapabilityJobEvidenceReport>;
  assetProductionReadinessBenchmark?: EvidenceFile<AssetProductionReadinessBenchmarkReport>;
  localProviderBenchmark?: EvidenceFile<LocalProviderBenchmarkReport>;
  localModelRuntimeBenchmark?: EvidenceFile<LocalModelRuntimeBenchmarkReport>;
  localModelQualityBenchmark?: EvidenceFile<LocalModelQualityBenchmarkReport>;
  localVoiceRuntimeBenchmark?: EvidenceFile<LocalVoiceRuntimeBenchmarkReport>;
  localVoiceLiveDialogBenchmark?: EvidenceFile<LocalVoiceLiveDialogBenchmarkReport>;
  realtimeVoiceTransportSpike?: EvidenceFile<RealtimeVoiceTransportSpikeReport>;
  apiPythonBackendRuntimeSmoke?: EvidenceFile<ApiPythonBackendRuntimeSmokeReport>;
  apiBunWebSocketRuntimeSmoke?: EvidenceFile<ApiBunWebSocketRuntimeSmokeReport>;
  questManualPerformance?: EvidenceFile<QuestManualPerformanceCheck>;
  questManualPerformanceReport?: EvidenceFile<QuestManualPerformancePayload>;
  questMixedRealityManual?: EvidenceFile<QuestMixedRealityManualCheck>;
  questMixedRealityManualReport?: EvidenceFile<QuestMixedRealityManualReport>;
  visualQaEvidence?: EvidenceFile<VisualQaEvidence>;
  iwsdkEvidenceContract?: EvidenceFile<IwsdkEvidenceContractReport>;
};

export type BenchmarkGateReportOptions = {
  now?: Date | string;
  maxEvidenceAgeHours?: number;
};

const defaultMaxEvidenceAgeHours = 24;
const hourMs = 60 * 60 * 1000;

async function main(): Promise<void> {
  const questSmoke = await latestJson<QuestSmokeReport>(
    "docs/openclinxr/quest-cdp-smoke-*.json",
    (file) => path.basename(file).startsWith("quest-cdp-smoke-202"),
  );
  const localRuntime = await latestJson<LocalRuntimeProbeReport>("docs/openclinxr/local-runtime-probe-*.json");
  const gltfPipelineSmoke = await latestJson<GltfPipelineSmokeReport>("docs/openclinxr/gltf-pipeline-smoke-*.json");
  const blenderAssetBakeSmoke = await latestJson<BlenderAssetBakeSmokeReport>("docs/openclinxr/blender-asset-bake-smoke-*.json");
  const assetCapabilityJobEvidence = await latestJson<AssetCapabilityJobEvidenceReport>("docs/openclinxr/asset-capability-job-evidence-*.json");
  const assetProductionReadinessBenchmark = await latestJson<AssetProductionReadinessBenchmarkReport>("docs/openclinxr/asset-production-readiness-benchmark-*.json");
  const localProviderBenchmark = await latestJson<LocalProviderBenchmarkReport>("docs/openclinxr/local-provider-benchmark-*.json");
  const localModelRuntimeBenchmark = await latestJson<LocalModelRuntimeBenchmarkReport>("docs/openclinxr/local-model-runtime-benchmark-*.json");
  const localModelQualityBenchmark = await latestJson<LocalModelQualityBenchmarkReport>("docs/openclinxr/local-model-quality-benchmark-*.json");
  const localVoiceRuntimeBenchmark = await latestJson<LocalVoiceRuntimeBenchmarkReport>("docs/openclinxr/local-voice-runtime-benchmark-*.json");
  const localVoiceLiveDialogBenchmark = await latestJson<LocalVoiceLiveDialogBenchmarkReport>("docs/openclinxr/local-voice-live-dialog-benchmark-*.json");
  const realtimeVoiceTransportSpike = await latestJson<RealtimeVoiceTransportSpikeReport>("docs/openclinxr/realtime-voice-transport-spike-*.json");
  const apiPythonBackendRuntimeSmoke = await latestJson<ApiPythonBackendRuntimeSmokeReport>("docs/openclinxr/api-python-backend-runtime-smoke-*.json");
  const apiBunWebSocketRuntimeSmoke = await latestJson<ApiBunWebSocketRuntimeSmokeReport>("docs/openclinxr/api-bun-websocket-runtime-smoke-*.json");
  const visualQaEvidence = await latestVisualQaEvidenceJson();
  const iwsdkEvidenceContract = await latestJson<IwsdkEvidenceContractReport>("docs/openclinxr/iwsdk-evidence-contract-*.json");
  const questManualPerformanceReport = await latestQuestManualPerformanceReportJson();
  const questManualPerformance = questManualPerformanceReport
    ? manualPerformanceReportToCheck(questManualPerformanceReport)
    : await fileJson<QuestManualPerformanceCheck>(".agent-factory/quest-manual-performance-report.json");
  const questMixedRealityManualReport = await latestQuestMixedRealityManualReportJson();
  const questMixedRealityManual = questMixedRealityManualReport
    ? mixedRealityManualReportToCheck(questMixedRealityManualReport)
    : await fileJson<QuestMixedRealityManualCheck>(".agent-factory/quest-mixed-reality-manual-report.json");
  const report = buildBenchmarkGateReport({
    questSmoke,
    localRuntime,
    gltfPipelineSmoke,
    blenderAssetBakeSmoke,
    assetCapabilityJobEvidence,
    assetProductionReadinessBenchmark,
    localProviderBenchmark,
    localModelRuntimeBenchmark,
    localModelQualityBenchmark,
    localVoiceRuntimeBenchmark,
    localVoiceLiveDialogBenchmark,
    realtimeVoiceTransportSpike,
    apiPythonBackendRuntimeSmoke,
    apiBunWebSocketRuntimeSmoke,
    visualQaEvidence,
    iwsdkEvidenceContract,
    questManualPerformance,
    questManualPerformanceReport,
    questMixedRealityManual,
    questMixedRealityManualReport,
  });
  await writeJson(".agent-factory/benchmark-gate-report.json", report);
  const readySummary = report.evidence_gates
    .map((gate) => `${gate.evidence_id}=${gate.ready_to_resolve}`)
    .join(", ");
  console.log(`Wrote .agent-factory/benchmark-gate-report.json; gates ${readySummary}`);
}

export async function latestJson<TValue>(
  pattern: string,
  acceptFile: (file: string) => boolean = () => true,
): Promise<{ file: string; value: TValue } | undefined> {
  const files = (await globFiles(pattern)).filter(acceptFile).sort();
  const file = files.at(-1);
  if (!file) {
    return undefined;
  }
  return { file, value: await readJson<TValue>(file) };
}

async function fileJson<TValue>(file: string): Promise<{ file: string; value: TValue } | undefined> {
  try {
    return { file, value: await readJson<TValue>(file) };
  } catch {
    return undefined;
  }
}

export function buildBenchmarkGateReport(input: BenchmarkGateReportInput, options: BenchmarkGateReportOptions = {}): EvidenceGateReport {
  const {
    questSmoke,
    localRuntime,
    gltfPipelineSmoke,
    blenderAssetBakeSmoke,
    assetCapabilityJobEvidence,
    assetProductionReadinessBenchmark,
    localProviderBenchmark,
    localModelRuntimeBenchmark,
    localModelQualityBenchmark,
    localVoiceRuntimeBenchmark,
    localVoiceLiveDialogBenchmark,
    realtimeVoiceTransportSpike,
    apiPythonBackendRuntimeSmoke,
    apiBunWebSocketRuntimeSmoke,
    visualQaEvidence,
    iwsdkEvidenceContract,
  } = input;
  const questSmokeEvidenceCheck = questSmoke
    ? { file: questSmoke.file, value: buildQuestSmokeEvidenceCheck(questSmoke.file, questSmoke.value) }
    : undefined;
  const questManualPerformance = input.questManualPerformanceReport
    ? manualPerformanceReportToCheck(input.questManualPerformanceReport)
    : input.questManualPerformance;
  const questMixedRealityManual = input.questMixedRealityManualReport
    ? mixedRealityManualReportToCheck(input.questMixedRealityManualReport)
    : input.questMixedRealityManual;
  const visualQaEvidenceReport = visualQaEvidence
    ? visualQaEvidenceToReport(visualQaEvidence)
    : undefined;
  const evidenceFreshness = buildEvidenceFreshnessReport({
    questSmoke,
    localRuntime,
    gltfPipelineSmoke,
    blenderAssetBakeSmoke,
    assetCapabilityJobEvidence,
    assetProductionReadinessBenchmark,
    localProviderBenchmark,
    localModelRuntimeBenchmark,
    localModelQualityBenchmark,
    localVoiceRuntimeBenchmark,
    localVoiceLiveDialogBenchmark,
    realtimeVoiceTransportSpike,
    apiPythonBackendRuntimeSmoke,
    apiBunWebSocketRuntimeSmoke,
    questManualPerformance,
    questMixedRealityManual,
  }, options);
  const localModelRuntimeBenchmarkIsRequired = requiresLocalModelRuntimeBenchmark(localRuntime?.value);
  const localVoiceRuntimeBenchmarkIsRequired = requiresLocalVoiceRuntimeBenchmark(localRuntime?.value);
  const questEvidenceFreshnessBlockers = freshnessBlockers(evidenceFreshness, [
    "quest_smoke",
    "local_runtime_probe",
    "quest_manual_performance",
  ]);
  const localModelEvidenceFreshnessBlockers = freshnessBlockers(evidenceFreshness, [
    "local_runtime_probe",
    "local_provider_benchmark",
    ...(localModelRuntimeBenchmarkIsRequired ? ["local_model_runtime_benchmark"] : []),
  ]);
  const localVoiceEvidenceFreshnessBlockers = freshnessBlockers(evidenceFreshness, [
    "local_runtime_probe",
    "local_provider_benchmark",
    ...(localVoiceRuntimeBenchmarkIsRequired ? ["local_voice_runtime_benchmark"] : []),
  ]);
  const assetEvidenceFreshnessBlockers = freshnessBlockers(evidenceFreshness, [
    "local_runtime_probe",
    "gltf_pipeline_smoke",
    "blender_asset_bake_smoke",
  ]);
  const questEvidenceBlockers = [
    ...questBlockers(questSmoke?.value, questSmokeEvidenceCheck?.value),
    ...questManualPerformanceBlockers(questManualPerformance?.value),
    ...questUsbBlockers(localRuntime?.value),
    ...questForegroundPreflightBlockers(localRuntime?.value),
    ...questEvidenceFreshnessBlockers,
  ];
  const localModelEvidenceBlockers = [
    ...localModelRuntimeBlockers(localRuntime?.value, localModelRuntimeBenchmark),
    ...localModelBenchmarkBlockers(localProviderBenchmark?.value),
    ...localModelRuntimeBenchmarkBlockers(localRuntime?.value, localModelRuntimeBenchmark),
    ...localModelEvidenceFreshnessBlockers,
  ];
  const localVoiceEvidenceBlockers = [
    ...localVoiceRuntimeBlockers(localRuntime?.value, localVoiceRuntimeBenchmark),
    ...localVoiceBenchmarkBlockers(localProviderBenchmark?.value),
    ...localVoiceRuntimeBenchmarkBlockers(localRuntime?.value, localVoiceRuntimeBenchmark),
    ...localVoiceEvidenceFreshnessBlockers,
  ];
  const assetEvidenceBlockers = [
    ...assetRuntimeBlockers(localRuntime?.value),
    ...gltfPipelineSmokeBlockers(gltfPipelineSmoke?.value),
    ...blenderAssetBakeSmokeBlockers(blenderAssetBakeSmoke?.value),
    ...assetEvidenceFreshnessBlockers,
  ];
  const localModelQualityEvidenceBlockers = [
    ...localModelQualityBlockers(localModelRuntimeBenchmark, localModelQualityBenchmark),
    ...freshnessBlockers(evidenceFreshness, [
      "local_runtime_probe",
      "local_provider_benchmark",
      "local_model_runtime_benchmark",
      "local_model_quality_benchmark",
    ]),
  ];
  const localVoiceLiveDialogEvidenceBlockers = [
    ...localVoiceLiveDialogBlockers(localVoiceRuntimeBenchmark, localVoiceLiveDialogBenchmark),
    ...realtimeVoiceTransportSpikeBlockers(realtimeVoiceTransportSpike),
    ...apiPythonBackendRuntimeSmokeBlockers(apiPythonBackendRuntimeSmoke),
    ...apiBunWebSocketRuntimeSmokeBlockers(apiBunWebSocketRuntimeSmoke),
    ...freshnessBlockers(evidenceFreshness, [
      "local_runtime_probe",
      "local_provider_benchmark",
      "local_voice_runtime_benchmark",
      "local_voice_live_dialog_benchmark",
      "realtime_voice_transport_spike",
      ...(apiPythonBackendRuntimeSmoke ? ["api_python_backend_runtime_smoke"] : []),
      "api_bun_websocket_runtime_smoke",
    ]),
  ];
  const assetProductionEvidenceBlockers = [
    ...assetCapabilityJobEvidenceBlockers(assetCapabilityJobEvidence),
    ...assetProductionBlockers(gltfPipelineSmoke, blenderAssetBakeSmoke, assetProductionReadinessBenchmark),
    ...freshnessBlockers(evidenceFreshness, [
      "local_runtime_probe",
      "gltf_pipeline_smoke",
      "blender_asset_bake_smoke",
      "asset_capability_job_evidence",
      "asset_production_readiness_benchmark",
    ]),
  ];
  const iwsdkEvidenceBlockers = iwsdkEvidenceContractBlockers(iwsdkEvidenceContract?.value);
  const combinedBlockers = unique([
    ...questEvidenceBlockers,
    ...localModelEvidenceBlockers,
    ...localVoiceEvidenceBlockers,
    ...assetEvidenceBlockers,
  ]);
  const combinedSatisfiedConditions = unique([
    questSmoke?.value.verdict.shellLoaded ? "quest_shell_loaded" : undefined,
    questSmoke?.value.verdict.interactionAdvanced ? "quest_trace_interaction_advanced" : undefined,
    ...(questSmokeEvidenceCheck?.value.satisfiedConditions ?? []),
    questManualPerformance?.value.readyToClaimFramePacing ? "quest_manual_frame_pacing_ready" : undefined,
    ...(questManualPerformance?.value.satisfiedConditions ?? []),
    localRuntime?.value.gates.questUsb.status === "ready" ? "quest_usb_ready" : undefined,
    localRuntime?.value.gates.questForegroundPreflight?.status === "ready" ? "quest_foreground_preflight_ready" : undefined,
    localRuntime?.value.gates.assetPipeline.status === "ready" ? "asset_pipeline_runtime_ready" : undefined,
    gltfPipelineSmoke?.value.verdict.passed ? "asset_pipeline_gltf_pipeline_smoke_passed" : undefined,
    blenderAssetBakeSmoke?.value.verdict.passed ? "asset_pipeline_blender_bake_smoke_passed" : undefined,
    assetCapabilityJobEvidence?.value.verdict.passed ? "asset_production_capability_job_contract_observed" : undefined,
    assetProductionReadinessBenchmark ? "asset_production_readiness_report_present" : undefined,
    assetProductionReadinessBenchmark?.value.sourceEvidence.gltfPipelineSmokePassed && assetProductionReadinessBenchmark.value.sourceEvidence.blenderBakeSmokePassed ? "asset_production_source_smokes_passed" : undefined,
    assetProductionReadinessBenchmark?.value.generationEvidence?.generatedHumanRiggingObserved ? "asset_production_generated_human_rigging_observed" : undefined,
    assetProductionReadinessBenchmark?.value.generationEvidence?.skinClothingProvenanceObserved ? "asset_production_skin_clothing_provenance_observed" : undefined,
    assetProductionReadinessBenchmark?.value.generationEvidence?.medicalEquipmentLibraryObserved ? "asset_production_medical_equipment_library_observed" : undefined,
    assetProductionReadinessBenchmark?.value.generationEvidence?.animationRetargetingObserved ? "asset_production_animation_retargeting_observed" : undefined,
    assetProductionReadinessBenchmark?.value.optimizationEvidence?.lodTiersObserved ? "asset_production_lod_tiers_observed" : undefined,
    assetProductionReadinessBenchmark?.value.optimizationEvidence?.textureCompressionBudgetObserved ? "asset_production_texture_compression_budget_observed" : undefined,
    assetProductionReadinessBenchmark?.value.optimizationEvidence?.colliderSimplificationObserved ? "asset_production_collider_simplification_observed" : undefined,
    assetProductionReadinessBenchmark?.value.runtimeBudget.multiActorBudgetObserved ? "asset_production_multi_actor_quest_budget_observed" : undefined,
    assetProductionReadinessBenchmark?.value.verdict.passed ? "asset_production_readiness_benchmark_passed" : undefined,
    localProviderBenchmark?.value.verdict.deterministicMocksPassed ? "local_provider_mock_benchmarks_passed" : undefined,
    localRuntime?.value.gates.localModel.status === "ready" ? "local_model_runtime_ready" : undefined,
    localRuntime?.value.gates.localVoice.status === "ready" ? "local_voice_runtime_ready" : undefined,
    localProviderBenchmark?.value.verdict.localModelReadyToBenchmark ? "local_model_ready_to_benchmark" : undefined,
    localProviderBenchmark?.value.verdict.localVoiceReadyToBenchmark ? "local_voice_ready_to_benchmark" : undefined,
    localModelRuntimeBenchmark?.value.verdict.passed ? "local_model_runtime_benchmark_passed" : undefined,
    localModelQualityBenchmark ? "local_model_quality_report_present" : undefined,
    localModelQualityBenchmark?.value.structuredOutput.requiredKeysPresent ? "local_model_quality_required_keys_present" : undefined,
    localModelQualityBenchmark?.value.actorPolicy.passed ? "local_model_quality_actor_policy_benchmark_passed" : undefined,
    localModelQualityBenchmark?.value.targetHardware.passed ? "local_model_quality_target_hardware_passed" : undefined,
    localModelQualityBenchmark?.value.verdict.passed ? "local_model_quality_benchmark_passed" : undefined,
    localVoiceRuntimeBenchmark?.value.verdict.passed ? "local_voice_first_audio_benchmark_passed" : undefined,
    localVoiceLiveDialogBenchmark ? "local_voice_live_dialog_report_present" : undefined,
    localVoiceLiveDialogBenchmark?.value.mockStream.passed ? "local_voice_live_dialog_mock_stream_passed" : undefined,
    localVoiceLiveDialogBenchmark?.value.runtimeStream?.realLocalVoiceStreamObserved ? "local_voice_live_dialog_runtime_stream_observed" : undefined,
    localVoiceLiveDialogBenchmark?.value.webxrPlayback.observed ? "local_voice_live_dialog_webxr_playback_observed" : undefined,
    localVoiceLiveDialogBenchmark && localVoiceLiveDialogBenchmark.value.safetyControls.blockers.length === 0 ? "local_voice_live_dialog_safety_controls_observed" : undefined,
    localVoiceLiveDialogBenchmark?.value.verdict.passed ? "local_voice_live_dialog_benchmark_passed" : undefined,
    realtimeVoiceTransportSpikePassed(realtimeVoiceTransportSpike) ? "local_voice_realtime_transport_contract_observed" : undefined,
    apiPythonBackendRuntimeSmokePassed(apiPythonBackendRuntimeSmoke)
      ? "local_voice_python_backend_runtime_smoke_passed"
      : undefined,
    apiBunWebSocketRuntimeSmokePassed(apiBunWebSocketRuntimeSmoke)
      ? "local_voice_bun_websocket_runtime_smoke_passed"
      : undefined,
  ]);
  const questSatisfiedConditions = combinedSatisfiedConditions.filter((condition) =>
    condition.startsWith("quest_") || (questManualPerformance?.value.satisfiedConditions ?? []).includes(condition)
  );
  const localModelSatisfiedConditions = combinedSatisfiedConditions.filter((condition) =>
    (condition.startsWith("local_model_") && !condition.startsWith("local_model_quality_")) || condition === "local_provider_mock_benchmarks_passed"
  );
  const localModelQualitySatisfiedConditions = combinedSatisfiedConditions.filter((condition) =>
    condition.startsWith("local_model_") || condition === "local_provider_mock_benchmarks_passed"
  );
  const localVoiceSatisfiedConditions = combinedSatisfiedConditions.filter((condition) =>
    (condition.startsWith("local_voice_") && !condition.startsWith("local_voice_live_dialog_")) || condition === "local_provider_mock_benchmarks_passed"
  );
  const localVoiceLiveDialogSatisfiedConditions = combinedSatisfiedConditions.filter((condition) =>
    condition.startsWith("local_voice_") || condition === "local_provider_mock_benchmarks_passed"
  );
  const assetSatisfiedConditions = combinedSatisfiedConditions.filter((condition) =>
    condition.startsWith("asset_pipeline_") || condition.startsWith("asset_production_")
  );
  const iwsdkSatisfiedConditions = iwsdkEvidenceContract
    ? [
      "iwsdk_evidence_contract_present",
      iwsdkEvidenceContract.value.verdict.readyForInstallBackedSidecar ? "iwsdk_install_backed_sidecar_ready" : undefined,
      iwsdkEvidenceContract.value.verdict.readyForAgentTooling ? "iwsdk_agent_tooling_ready" : undefined,
      iwsdkEvidenceContract.value.verdict.readyForProductionRuntime ? "iwsdk_production_runtime_ready" : undefined,
    ].filter((condition): condition is string => typeof condition === "string")
    : [];

  return {
    generated_by: "tools/agent-factory/build-benchmark-gate-report.ts",
    evidence_freshness: evidenceFreshness,
    ...(questSmoke ? {
      quest_smoke: {
        file: questSmoke.file,
        generated_at: questSmoke.value.generatedAt,
        shell_loaded: questSmoke.value.verdict.shellLoaded,
        interaction_advanced: questSmoke.value.verdict.interactionAdvanced,
        frame_sample_complete: questSmoke.value.verdict.frameSampleComplete,
        ready_for_foreground_quest_claim: questSmokeEvidenceCheck?.value.readyForForegroundQuestClaim ?? false,
        classification: questSmokeEvidenceCheck?.value.classification ?? "missing",
        satisfied_conditions: questSmokeEvidenceCheck?.value.satisfiedConditions ?? [],
        blockers: questSmokeEvidenceCheck?.value.blockers ?? [...questSmoke.value.verdict.blockers],
      },
    } : {}),
    ...(localRuntime ? {
      local_runtime_probe: {
        file: localRuntime.file,
        generated_at: localRuntime.value.generatedAt,
        gates: localRuntime.value.gates,
      },
    } : {}),
    ...(gltfPipelineSmoke ? {
      gltf_pipeline_smoke: {
        file: gltfPipelineSmoke.file,
        generated_at: gltfPipelineSmoke.value.generatedAt,
        tool: gltfPipelineSmoke.value.tool,
        output: gltfPipelineSmoke.value.output,
        passed: gltfPipelineSmoke.value.verdict.passed,
        blockers: [...gltfPipelineSmoke.value.verdict.blockers],
      },
    } : {}),
    ...(blenderAssetBakeSmoke ? {
      blender_asset_bake_smoke: {
        file: blenderAssetBakeSmoke.file,
        generated_at: blenderAssetBakeSmoke.value.generatedAt,
        tool: blenderAssetBakeSmoke.value.tool,
        input: blenderAssetBakeSmoke.value.input,
        output: blenderAssetBakeSmoke.value.output,
        passed: blenderAssetBakeSmoke.value.verdict.passed,
        blockers: [...blenderAssetBakeSmoke.value.verdict.blockers],
      },
    } : {}),
    ...(assetProductionReadinessBenchmark ? {
      asset_production_readiness_benchmark: {
        file: assetProductionReadinessBenchmark.file,
        generated_at: assetProductionReadinessBenchmark.value.generatedAt,
        status: assetProductionReadinessBenchmark.value.status,
        source_evidence: assetProductionReadinessBenchmark.value.sourceEvidence,
        production_proofs: assetProductionReadinessBenchmark.value.productionProofs,
        generation_evidence: assetProductionReadinessBenchmark.value.generationEvidence,
        optimization_evidence: assetProductionReadinessBenchmark.value.optimizationEvidence,
        ...(assetProductionReadinessBenchmark.value.stationBudgetEvidence ? {
          station_budget_evidence: assetProductionReadinessBenchmark.value.stationBudgetEvidence,
        } : {}),
        runtime_budget: assetProductionReadinessBenchmark.value.runtimeBudget,
        verdict: assetProductionReadinessBenchmark.value.verdict,
      },
    } : {}),
    ...(assetCapabilityJobEvidence ? {
      asset_capability_job_evidence: {
        file: assetCapabilityJobEvidence.file,
        generated_at: assetCapabilityJobEvidence.value.generatedAt,
        status: assetCapabilityJobEvidence.value.status,
        summary: assetCapabilityJobEvidence.value.summary,
        jobs: assetCapabilityJobEvidence.value.jobs,
        verdict: assetCapabilityJobEvidence.value.verdict,
      },
    } : {}),
    ...(localProviderBenchmark ? {
      local_provider_benchmark: {
        file: localProviderBenchmark.file,
        generated_at: localProviderBenchmark.value.generatedAt,
        mock_model: localProviderBenchmark.value.mockModel,
        mock_voice: localProviderBenchmark.value.mockVoice,
        local_model: localProviderBenchmark.value.localModel,
        local_voice: localProviderBenchmark.value.localVoice,
        verdict: localProviderBenchmark.value.verdict,
      },
    } : {}),
    ...(localModelRuntimeBenchmark ? {
      local_model_runtime_benchmark: {
        file: localModelRuntimeBenchmark.file,
        generated_at: localModelRuntimeBenchmark.value.generatedAt,
        status: localModelRuntimeBenchmark.value.status,
        runtime: localModelRuntimeBenchmark.value.runtime,
        metrics: localModelRuntimeBenchmark.value.metrics,
        output: localModelRuntimeBenchmark.value.output,
        verdict: localModelRuntimeBenchmark.value.verdict,
      },
    } : {}),
    ...(localModelQualityBenchmark ? {
      local_model_quality_benchmark: {
        file: localModelQualityBenchmark.file,
        generated_at: localModelQualityBenchmark.value.generatedAt,
        status: localModelQualityBenchmark.value.status,
        structured_output: localModelQualityBenchmark.value.structuredOutput,
        actor_policy: localModelQualityBenchmark.value.actorPolicy,
        target_hardware: localModelQualityBenchmark.value.targetHardware,
        verdict: localModelQualityBenchmark.value.verdict,
      },
    } : {}),
    ...(localVoiceRuntimeBenchmark ? {
      local_voice_runtime_benchmark: {
        file: localVoiceRuntimeBenchmark.file,
        generated_at: localVoiceRuntimeBenchmark.value.generatedAt,
        status: localVoiceRuntimeBenchmark.value.status,
        runtime: localVoiceRuntimeBenchmark.value.runtime,
        audio: localVoiceRuntimeBenchmark.value.audio,
        metrics: localVoiceRuntimeBenchmark.value.metrics,
        verdict: localVoiceRuntimeBenchmark.value.verdict,
      },
    } : {}),
    ...(localVoiceLiveDialogBenchmark ? {
      local_voice_live_dialog_benchmark: {
        file: localVoiceLiveDialogBenchmark.file,
        generated_at: localVoiceLiveDialogBenchmark.value.generatedAt,
        status: localVoiceLiveDialogBenchmark.value.status,
        mock_stream: localVoiceLiveDialogBenchmark.value.mockStream,
        runtime_fit: localVoiceLiveDialogBenchmark.value.runtimeFit,
        runtime_stream: localVoiceLiveDialogBenchmark.value.runtimeStream,
        webxr_playback: localVoiceLiveDialogBenchmark.value.webxrPlayback,
        safety_controls: localVoiceLiveDialogBenchmark.value.safetyControls,
        verdict: localVoiceLiveDialogBenchmark.value.verdict,
      },
    } : {}),
    ...(realtimeVoiceTransportSpike ? {
      realtime_voice_transport_spike: {
        file: realtimeVoiceTransportSpike.file,
        generated_at: realtimeVoiceTransportSpike.value.generatedAt,
        status: realtimeVoiceTransportSpike.value.status,
        round_trip_latency_ms: realtimeVoiceTransportSpike.value.harness.roundTripLatencyMs,
        audio_metadata_frames_sent: realtimeVoiceTransportSpike.value.harness.audioMetadataFramesSent,
        audio_chunk_metadata_received: realtimeVoiceTransportSpike.value.harness.audioChunkMetadataReceived,
        frame_latency_samples_ms: realtimeVoiceTransportSpike.value.harness.frameLatencySamplesMs,
        audio_chunk_indexes_received: realtimeVoiceTransportSpike.value.harness.audioChunkIndexesReceived,
        latency_budget: realtimeVoiceTransportSpike.value.harness.latencyBudget,
        ...(realtimeVoiceTransportSpike.value.protocolEvidence ? {
          protocol_evidence: {
            websocket_local_harness_observed: realtimeVoiceTransportSpike.value.protocolEvidence.websocketLocalHarnessObserved,
            bun_hono_runtime_observed: realtimeVoiceTransportSpike.value.protocolEvidence.bunHonoRuntimeObserved,
            webtransport_observed: realtimeVoiceTransportSpike.value.protocolEvidence.webTransportObserved,
            quic_observed: realtimeVoiceTransportSpike.value.protocolEvidence.quicObserved,
            web3_signaling_observed: realtimeVoiceTransportSpike.value.protocolEvidence.web3SignalingObserved,
            notes: realtimeVoiceTransportSpike.value.protocolEvidence.notes,
          },
        } : {}),
        python_backend_verifier: realtimeVoiceTransportSpike.value.pythonBackendVerifier,
        verdict: realtimeVoiceTransportSpike.value.verdict,
      },
    } : {}),
    ...(apiPythonBackendRuntimeSmoke ? {
      api_python_backend_runtime_smoke: {
        file: apiPythonBackendRuntimeSmoke.file,
        generated_at: apiPythonBackendRuntimeSmoke.value.generatedAt,
        status: apiPythonBackendRuntimeSmoke.value.status,
        python: apiPythonBackendRuntimeSmoke.value.python,
        health: apiPythonBackendRuntimeSmoke.value.health,
        capabilities: apiPythonBackendRuntimeSmoke.value.capabilities,
        websocket: apiPythonBackendRuntimeSmoke.value.websocket,
        verdict: apiPythonBackendRuntimeSmoke.value.verdict,
      },
    } : {}),
    ...(apiBunWebSocketRuntimeSmoke ? {
      api_bun_websocket_runtime_smoke: {
        file: apiBunWebSocketRuntimeSmoke.file,
        generated_at: apiBunWebSocketRuntimeSmoke.value.generatedAt,
        status: apiBunWebSocketRuntimeSmoke.value.status,
        bun: apiBunWebSocketRuntimeSmoke.value.bun,
        health: apiBunWebSocketRuntimeSmoke.value.health,
        h3: {
          enabled: apiBunWebSocketRuntimeSmoke.value.runtime.h3.enabled,
          h3_true_enabled: apiBunWebSocketRuntimeSmoke.value.runtime.h3.h3TrueEnabled,
          out_of_scope_for_this_smoke: apiBunWebSocketRuntimeSmoke.value.runtime.h3.outOfScopeForThisSmoke,
        },
        trace_contexts: {
          pre_vr_trace_interaction: {
            observed: apiBunWebSocketRuntimeSmoke.value.traceContexts.preVrTraceInteraction.observed,
            control_frame_types: apiBunWebSocketRuntimeSmoke.value.traceContexts.preVrTraceInteraction.controlFrameTypes,
          },
          in_vr_trace_interaction: {
            observed: apiBunWebSocketRuntimeSmoke.value.traceContexts.inVrTraceInteraction.observed,
            blocker: apiBunWebSocketRuntimeSmoke.value.traceContexts.inVrTraceInteraction.blocker,
          },
        },
        websocket: {
          connected: apiBunWebSocketRuntimeSmoke.value.websocket.connected,
          reconnect_observed: apiBunWebSocketRuntimeSmoke.value.websocket.reconnectObserved,
          control_ack_observed: apiBunWebSocketRuntimeSmoke.value.websocket.controlAckObserved,
          audio_metadata_observed: apiBunWebSocketRuntimeSmoke.value.websocket.audioMetadataObserved,
          transcript_delta_observed: apiBunWebSocketRuntimeSmoke.value.websocket.transcriptDeltaObserved,
          binary_echo_observed: apiBunWebSocketRuntimeSmoke.value.websocket.binaryEchoObserved,
          binary_frames_sent: apiBunWebSocketRuntimeSmoke.value.websocket.binaryFramesSent,
          binary_bytes_sent: apiBunWebSocketRuntimeSmoke.value.websocket.binaryBytesSent,
          server_errors: apiBunWebSocketRuntimeSmoke.value.websocket.serverErrors,
        },
        verdict: {
          smoke_passed: apiBunWebSocketRuntimeSmoke.value.verdict.smokePassed,
          ready_for_live_dialog: apiBunWebSocketRuntimeSmoke.value.verdict.readyForLiveDialog,
          blockers: apiBunWebSocketRuntimeSmoke.value.verdict.blockers,
          caveats: apiBunWebSocketRuntimeSmoke.value.verdict.caveats,
        },
      },
    } : {}),
    ...(questManualPerformance ? {
      quest_manual_performance: {
        file: questManualPerformance.file,
        generated_at: questManualPerformance.value.generatedAt,
        input_file: questManualPerformance.value.inputFile,
        evidence_posture: questManualPerformance.value.evidencePosture,
        ready_to_claim_frame_pacing: questManualPerformance.value.readyToClaimFramePacing,
        satisfied_conditions: [...questManualPerformance.value.satisfiedConditions],
        blockers: [...questManualPerformance.value.blockers],
        adversarial_findings: [...questManualPerformance.value.adversarialFindings],
        next_steps: [...questManualPerformance.value.nextSteps],
        ...(questManualPerformance.value.harvestSummary ? {
          harvest_summary: {
            source: questManualPerformance.value.harvestSummary.source,
            ready: questManualPerformance.value.harvestSummary.ready,
            timed_out: questManualPerformance.value.harvestSummary.timedOut,
            blockers: [...(questManualPerformance.value.harvestSummary.blockers ?? [])],
            elapsed_wall_ms: questManualPerformance.value.harvestSummary.elapsedWallMs ?? null,
          },
        } : {}),
      },
    } : {}),
    ...(questMixedRealityManual ? {
      quest_mixed_reality_manual: {
        file: questMixedRealityManual.file,
        generated_at: questMixedRealityManual.value.generatedAt,
        input_file: questMixedRealityManual.value.inputFile,
        ready_to_claim_mixed_reality_readiness: questMixedRealityManual.value.readyToClaimMixedRealityReadiness,
        ready_to_claim_full_vr_readiness: questMixedRealityManual.value.readyToClaimFullVrReadiness,
        satisfied_conditions: [...questMixedRealityManual.value.satisfiedConditions],
        blockers: [...questMixedRealityManual.value.blockers],
        not_evidence_for: [...questMixedRealityManual.value.notEvidenceFor],
        next_steps: [...questMixedRealityManual.value.nextSteps],
      },
    } : {}),
    ...(visualQaEvidenceReport ? {
      visual_qa_evidence: {
        file: visualQaEvidenceReport.file,
        ready_for_adversarial_visual_qa: visualQaEvidenceReport.value.result.readyForAdversarialVisualQa,
        ready_for_production_runtime: visualQaEvidenceReport.value.result.readyForProductionRuntime,
        ready_for_physical_quest_claim: visualQaEvidenceReport.value.result.readyForPhysicalQuestClaim,
        capture: {
          source: visualQaEvidenceReport.value.evidence.capture?.source,
          artifact_type: visualQaEvidenceReport.value.evidence.capture?.artifactType,
          artifact: visualQaEvidenceReport.value.evidence.capture?.artifact,
          scenario_id: visualQaEvidenceReport.value.evidence.capture?.scenarioId,
          xr_mode: visualQaEvidenceReport.value.evidence.capture?.xrMode,
        },
        blockers: [...visualQaEvidenceReport.value.result.blockers],
        allowed_claims: [...(visualQaEvidenceReport.value.evidence.claimBoundaries?.allowedClaims ?? [])],
        not_evidence_for: [...(visualQaEvidenceReport.value.evidence.claimBoundaries?.notEvidenceFor ?? [])],
      },
    } : {}),
    ...(iwsdkEvidenceContract ? {
      iwsdk_evidence_contract: {
        file: iwsdkEvidenceContract.file,
        generated_at: iwsdkEvidenceContract.value.generatedAt,
        status: iwsdkEvidenceContract.value.status,
        ready_for_install_backed_sidecar: iwsdkEvidenceContract.value.verdict.readyForInstallBackedSidecar,
        ready_for_agent_tooling: iwsdkEvidenceContract.value.verdict.readyForAgentTooling,
        ready_for_production_runtime: iwsdkEvidenceContract.value.verdict.readyForProductionRuntime,
        blockers: unique(iwsdkEvidenceContract.value.verdict.blockers),
        leadership_posture: buildIwsdkLeadershipPosture(iwsdkEvidenceContract.value),
      },
    } : {}),
    evidence_gates: [
      buildEvidenceGate("evidence-leadership-0007-002", combinedSatisfiedConditions, combinedBlockers),
      buildEvidenceGate("evidence-leadership-0008-001", questSatisfiedConditions, unique(questEvidenceBlockers)),
      buildEvidenceGate("evidence-leadership-0008-002", localModelSatisfiedConditions, unique(localModelEvidenceBlockers)),
      buildEvidenceGate("evidence-leadership-0008-003", localVoiceSatisfiedConditions, unique(localVoiceEvidenceBlockers)),
      buildEvidenceGate("evidence-leadership-0008-004", assetSatisfiedConditions, unique(assetEvidenceBlockers)),
      buildEvidenceGate("evidence-leadership-0009-002", localModelQualitySatisfiedConditions, unique(localModelQualityEvidenceBlockers)),
      buildEvidenceGate("evidence-leadership-0009-003", localVoiceLiveDialogSatisfiedConditions, unique(localVoiceLiveDialogEvidenceBlockers)),
      buildEvidenceGate("evidence-leadership-0009-004", iwsdkSatisfiedConditions, unique(iwsdkEvidenceBlockers)),
      buildEvidenceGate("evidence-leadership-0009-005", assetSatisfiedConditions, unique(assetProductionEvidenceBlockers)),
    ],
  };
}

function buildEvidenceFreshnessReport(
  evidence: {
    questSmoke?: EvidenceFile<QuestSmokeReport>;
    localRuntime?: EvidenceFile<LocalRuntimeProbeReport>;
    gltfPipelineSmoke?: EvidenceFile<GltfPipelineSmokeReport>;
    blenderAssetBakeSmoke?: EvidenceFile<BlenderAssetBakeSmokeReport>;
    assetCapabilityJobEvidence?: EvidenceFile<AssetCapabilityJobEvidenceReport>;
    assetProductionReadinessBenchmark?: EvidenceFile<AssetProductionReadinessBenchmarkReport>;
    localProviderBenchmark?: EvidenceFile<LocalProviderBenchmarkReport>;
    localModelRuntimeBenchmark?: EvidenceFile<LocalModelRuntimeBenchmarkReport>;
    localModelQualityBenchmark?: EvidenceFile<LocalModelQualityBenchmarkReport>;
    localVoiceRuntimeBenchmark?: EvidenceFile<LocalVoiceRuntimeBenchmarkReport>;
    localVoiceLiveDialogBenchmark?: EvidenceFile<LocalVoiceLiveDialogBenchmarkReport>;
    realtimeVoiceTransportSpike?: EvidenceFile<RealtimeVoiceTransportSpikeReport>;
    apiPythonBackendRuntimeSmoke?: EvidenceFile<ApiPythonBackendRuntimeSmokeReport>;
    apiBunWebSocketRuntimeSmoke?: EvidenceFile<ApiBunWebSocketRuntimeSmokeReport>;
    questManualPerformance?: EvidenceFile<QuestManualPerformanceCheck>;
    questMixedRealityManual?: EvidenceFile<QuestMixedRealityManualCheck>;
  },
  options: BenchmarkGateReportOptions,
): EvidenceFreshnessEntry[] {
  const now = resolveNow(options.now);
  const maxAgeHours = options.maxEvidenceAgeHours ?? defaultMaxEvidenceAgeHours;

  return [
    evidenceFreshnessEntry("quest_smoke", evidence.questSmoke, now, maxAgeHours),
    evidenceFreshnessEntry("local_runtime_probe", evidence.localRuntime, now, maxAgeHours),
    evidenceFreshnessEntry("gltf_pipeline_smoke", evidence.gltfPipelineSmoke, now, maxAgeHours),
    evidenceFreshnessEntry("blender_asset_bake_smoke", evidence.blenderAssetBakeSmoke, now, maxAgeHours),
    evidenceFreshnessEntry("asset_capability_job_evidence", evidence.assetCapabilityJobEvidence, now, maxAgeHours),
    evidenceFreshnessEntry("asset_production_readiness_benchmark", evidence.assetProductionReadinessBenchmark, now, maxAgeHours),
    evidenceFreshnessEntry("local_provider_benchmark", evidence.localProviderBenchmark, now, maxAgeHours),
    evidenceFreshnessEntry("local_model_runtime_benchmark", evidence.localModelRuntimeBenchmark, now, maxAgeHours),
    evidenceFreshnessEntry("local_model_quality_benchmark", evidence.localModelQualityBenchmark, now, maxAgeHours),
    evidenceFreshnessEntry("local_voice_runtime_benchmark", evidence.localVoiceRuntimeBenchmark, now, maxAgeHours),
    evidenceFreshnessEntry("local_voice_live_dialog_benchmark", evidence.localVoiceLiveDialogBenchmark, now, maxAgeHours),
    evidenceFreshnessEntry("realtime_voice_transport_spike", evidence.realtimeVoiceTransportSpike, now, maxAgeHours),
    evidenceFreshnessEntry("api_python_backend_runtime_smoke", evidence.apiPythonBackendRuntimeSmoke, now, maxAgeHours),
    evidenceFreshnessEntry("api_bun_websocket_runtime_smoke", evidence.apiBunWebSocketRuntimeSmoke, now, maxAgeHours),
    evidenceFreshnessEntry("quest_manual_performance", evidence.questManualPerformance, now, maxAgeHours),
    ...(evidence.questMixedRealityManual
      ? [evidenceFreshnessEntry("quest_mixed_reality_manual", evidence.questMixedRealityManual, now, maxAgeHours)]
      : []),
  ];
}

function evidenceFreshnessEntry(
  evidenceId: string,
  evidence: EvidenceFile<{ generatedAt: string }> | undefined,
  now: Date,
  maxAgeHours: number,
): EvidenceFreshnessEntry {
  if (!evidence) {
    return {
      evidence_id: evidenceId,
      file: null,
      generated_at: null,
      age_hours: null,
      max_age_hours: maxAgeHours,
      status: "missing",
      blockers: [`${evidenceId}:evidence_missing`],
    };
  }

  const generatedAt = new Date(evidence.value.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) {
    return {
      evidence_id: evidenceId,
      file: evidence.file,
      generated_at: evidence.value.generatedAt,
      age_hours: null,
      max_age_hours: maxAgeHours,
      status: "invalid",
      blockers: [`${evidenceId}:evidence_timestamp_invalid`],
    };
  }

  const ageHours = wholeHours(Math.max(0, now.getTime() - generatedAt.getTime()) / hourMs);
  if (ageHours > maxAgeHours) {
    return {
      evidence_id: evidenceId,
      file: evidence.file,
      generated_at: evidence.value.generatedAt,
      age_hours: ageHours,
      max_age_hours: maxAgeHours,
      status: "stale",
      blockers: [`${evidenceId}:evidence_stale_over_${maxAgeHours}h`],
    };
  }

  return {
    evidence_id: evidenceId,
    file: evidence.file,
    generated_at: evidence.value.generatedAt,
    age_hours: ageHours,
    max_age_hours: maxAgeHours,
    status: "fresh",
    blockers: [],
  };
}

function freshnessBlockers(entries: EvidenceFreshnessEntry[], evidenceIds: string[]): string[] {
  const ids = new Set(evidenceIds);
  return unique(entries
    .filter((entry) => ids.has(entry.evidence_id) && entry.status !== "missing")
    .flatMap((entry) => entry.blockers));
}

function resolveNow(now: BenchmarkGateReportOptions["now"]): Date {
  if (!now) {
    return new Date();
  }
  return typeof now === "string" ? new Date(now) : now;
}

function wholeHours(value: number): number {
  return Math.floor(value);
}

async function latestQuestManualPerformanceReportJson(): Promise<EvidenceFile<QuestManualPerformancePayload> | undefined> {
  const files = (await globFiles("docs/openclinxr/quest-manual-performance-*.json"))
    .filter(isQuestManualPerformanceRawReportPath)
    .sort();
  const file = files.at(-1);
  if (!file) {
    return undefined;
  }
  return { file, value: await readJson<QuestManualPerformancePayload>(file) };
}

export function isQuestManualPerformanceRawReportPath(file: string): boolean {
  const baseName = path.basename(file);
  return baseName.startsWith("quest-manual-performance-")
    && !baseName.startsWith("quest-manual-performance-check-")
    && baseName !== "quest-manual-performance-template.json";
}

async function latestQuestMixedRealityManualReportJson(): Promise<EvidenceFile<QuestMixedRealityManualReport> | undefined> {
  const files = (await globFiles("docs/openclinxr/quest-mixed-reality-manual-*.json"))
    .filter(isQuestMixedRealityManualRawReportPath)
    .sort();
  const file = files.at(-1);
  if (!file) {
    return undefined;
  }
  return { file, value: await readJson<QuestMixedRealityManualReport>(file) };
}

export function isQuestMixedRealityManualRawReportPath(file: string): boolean {
  const baseName = path.basename(file);
  return baseName.startsWith("quest-mixed-reality-manual-")
    && !baseName.startsWith("quest-mixed-reality-manual-check-")
    && baseName !== "quest-mixed-reality-manual-template.json";
}

export function isVisualQaEvidenceRawReportPath(file: string): boolean {
  const baseName = path.basename(file);
  return baseName.startsWith("visual-qa-evidence-")
    && !baseName.startsWith("visual-qa-evidence-check-")
    && !baseName.startsWith("visual-qa-evidence-report-");
}

export async function latestVisualQaEvidenceJson(
  pattern = "docs/openclinxr/visual-qa-evidence-*.json",
): Promise<EvidenceFile<VisualQaEvidence> | undefined> {
  const files = (await globFiles(pattern))
    .filter(isVisualQaEvidenceRawReportPath)
    .sort(compareVisualQaEvidenceFiles);
  const file = files.at(-1);
  if (!file) {
    return undefined;
  }
  return { file, value: await readJson<VisualQaEvidence>(file) };
}

function compareVisualQaEvidenceFiles(left: string, right: string): number {
  const leftDate = visualQaEvidenceDateKey(left);
  const rightDate = visualQaEvidenceDateKey(right);
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }
  return left.localeCompare(right);
}

function visualQaEvidenceDateKey(file: string): string {
  return path.basename(file).match(/(\d{4}-\d{2}-\d{2})(?=\.json$)/)?.[1] ?? "";
}

function manualPerformanceReportToCheck(
  report: EvidenceFile<QuestManualPerformancePayload>,
): EvidenceFile<QuestManualPerformanceCheck> {
  return {
    file: report.file,
    value: buildQuestManualPerformanceCheck(report.file, report.value),
  };
}

function mixedRealityManualReportToCheck(
  report: EvidenceFile<QuestMixedRealityManualReport>,
): EvidenceFile<QuestMixedRealityManualCheck> {
  return {
    file: report.file,
    value: buildQuestMixedRealityManualCheck(report.file, report.value),
  };
}

function visualQaEvidenceToReport(
  evidence: EvidenceFile<VisualQaEvidence>,
): EvidenceFile<VisualQaEvidenceReport> {
  return {
    file: evidence.file,
    value: buildVisualQaEvidenceReport({
      inputFile: evidence.file,
      evidence: evidence.value,
    }),
  };
}

function buildEvidenceGate(evidenceId: string, satisfiedConditions: string[], blockers: string[]): EvidenceGateReport["evidence_gates"][number] {
  return {
    evidence_id: evidenceId,
    ready_to_resolve: blockers.length === 0,
    satisfied_conditions: satisfiedConditions,
    blockers,
    blocker_summary: summarizeBlockers(blockers),
  };
}

function summarizeBlockers(blockers: string[]): BlockerSummary {
  const remaining = new Set(blockers);
  const groups: BlockerGroup[] = [];

  for (const group of blockerGroups) {
    const groupBlockers = unique(blockers.filter(group.matches));
    for (const blocker of groupBlockers) {
      remaining.delete(blocker);
    }
    if (groupBlockers.length > 0) {
      groups.push({
        group_id: group.groupId,
        title: group.title,
        owner: group.owner,
        blockers: groupBlockers,
        next_step: group.nextStep,
      });
    }
  }

  return {
    total_blockers: blockers.length,
    distinct_problem_count: groups.length + remaining.size,
    groups,
    ungrouped_blockers: [...remaining].sort(),
  };
}

function questBlockers(report: QuestSmokeReport | undefined, evidenceCheck: QuestSmokeEvidenceCheck | undefined): string[] {
  if (!report) {
    return ["missing_quest_cdp_smoke_report"];
  }

  const blockers = [...(evidenceCheck?.blockers ?? report.verdict.blockers)];
  if (!report.verdict.shellLoaded) {
    blockers.push("quest_shell_not_loaded");
  }
  if (!report.verdict.interactionAdvanced) {
    blockers.push("quest_interaction_not_advanced");
  }
  if (!report.verdict.frameSampleComplete) {
    blockers.push("quest_sustained_frame_sample_not_complete");
  }
  return unique(blockers);
}

function questManualPerformanceBlockers(report: QuestManualPerformanceCheck | undefined): string[] {
  if (!report) {
    return ["missing_quest_manual_performance_check"];
  }
  if (report.readyToClaimFramePacing) {
    return [];
  }
  return unique(report.blockers.map((blocker) => `quest_manual_performance:${blocker}`));
}

function questUsbBlockers(report: LocalRuntimeProbeReport | undefined): string[] {
  if (!report) {
    return ["missing_local_runtime_probe_report"];
  }
  return unique(prefixBlockers("quest_usb", report.gates.questUsb));
}

function questForegroundPreflightBlockers(report: LocalRuntimeProbeReport | undefined): string[] {
  if (!report) {
    return ["missing_local_runtime_probe_report"];
  }
  return unique(prefixBlockers("quest_foreground_preflight", report.gates.questForegroundPreflight ?? blockedGate("quest_foreground_preflight_not_recorded")));
}

function localModelRuntimeBlockers(
  report: LocalRuntimeProbeReport | undefined,
  runtimeBenchmark: EvidenceFile<LocalModelRuntimeBenchmarkReport> | undefined,
): string[] {
  if (!report) {
    return ["missing_local_runtime_probe_report"];
  }
  return unique(prefixBlockers("local_model", report.gates.localModel)).filter((blocker) =>
    !(runtimeBenchmark?.value.verdict.passed && blocker === "local_model:model_weights_not_selected_or_benchmarked")
  );
}

function localVoiceRuntimeBlockers(
  report: LocalRuntimeProbeReport | undefined,
  runtimeBenchmark: EvidenceFile<LocalVoiceRuntimeBenchmarkReport> | undefined,
): string[] {
  if (!report) {
    return ["missing_local_runtime_probe_report"];
  }
  return unique(prefixBlockers("local_voice", report.gates.localVoice)).filter((blocker) =>
    !(runtimeBenchmark?.value.verdict.passed && blocker === "local_voice:voice_model_not_selected_or_benchmarked")
  );
}

function assetRuntimeBlockers(report: LocalRuntimeProbeReport | undefined): string[] {
  if (!report) {
    return ["missing_local_runtime_probe_report"];
  }
  return unique(prefixBlockers("asset_pipeline", report.gates.assetPipeline));
}

function gltfPipelineSmokeBlockers(report: GltfPipelineSmokeReport | undefined): string[] {
  if (!report) {
    return ["missing_gltf_pipeline_smoke_report"];
  }
  if (report.verdict.passed) {
    return [];
  }
  return unique(report.verdict.blockers.map((blocker) => `gltf_pipeline_smoke:${blocker}`));
}

function blenderAssetBakeSmokeBlockers(report: BlenderAssetBakeSmokeReport | undefined): string[] {
  if (!report) {
    return ["missing_blender_asset_bake_smoke_report"];
  }
  if (report.verdict.passed) {
    return [];
  }
  return unique(report.verdict.blockers.map((blocker) => `blender_asset_bake_smoke:${blocker}`));
}

function localModelBenchmarkBlockers(report: LocalProviderBenchmarkReport | undefined): string[] {
  if (!report) {
    return ["missing_local_provider_benchmark_report"];
  }
  return unique([
    ...report.mockModel.blockers.map((blocker) => `mock_model_benchmark:${blocker}`),
    ...(report.verdict.localModelReadyToBenchmark ? [] : report.localModel.blockers.map((blocker) => `local_model_benchmark:${blocker}`)),
  ]);
}

function localVoiceBenchmarkBlockers(report: LocalProviderBenchmarkReport | undefined): string[] {
  if (!report) {
    return ["missing_local_provider_benchmark_report"];
  }
  return unique([
    ...report.mockVoice.blockers.map((blocker) => `mock_voice_benchmark:${blocker}`),
    ...(report.verdict.localVoiceReadyToBenchmark ? [] : report.localVoice.blockers.map((blocker) => `local_voice_benchmark:${blocker}`)),
  ]);
}

function requiresLocalModelRuntimeBenchmark(report: LocalRuntimeProbeReport | undefined): boolean {
  return report?.gates.localModel.blockers.includes("model_weights_not_selected_or_benchmarked") ?? false;
}

function requiresLocalVoiceRuntimeBenchmark(report: LocalRuntimeProbeReport | undefined): boolean {
  return report?.gates.localVoice.blockers.includes("voice_model_not_selected_or_benchmarked") ?? false;
}

function localModelRuntimeBenchmarkBlockers(
  runtimeReport: LocalRuntimeProbeReport | undefined,
  benchmark: EvidenceFile<LocalModelRuntimeBenchmarkReport> | undefined,
): string[] {
  if (!requiresLocalModelRuntimeBenchmark(runtimeReport)) {
    return [];
  }
  if (!benchmark) {
    return ["missing_local_model_runtime_benchmark_report"];
  }
  if (benchmark.value.verdict.passed) {
    return [];
  }
  return unique(benchmark.value.verdict.blockers.map((blocker) => `local_model_runtime_benchmark:${blocker}`));
}

function localModelQualityBlockers(
  benchmark: EvidenceFile<LocalModelRuntimeBenchmarkReport> | undefined,
  qualityBenchmark: EvidenceFile<LocalModelQualityBenchmarkReport> | undefined,
): string[] {
  if (!benchmark) {
    return ["missing_local_model_runtime_benchmark_report"];
  }

  if (qualityBenchmark) {
    return unique([
      ...qualityBenchmark.value.verdict.blockers.map((blocker) => `local_model_quality:${blocker}`),
      ...(qualityBenchmark.value.actorPolicy.passed
        ? []
        : (qualityBenchmark.value.actorPolicy.blockers.length > 0 ? qualityBenchmark.value.actorPolicy.blockers : ["actor_policy_probe_failed"])
          .map((blocker) => `local_model_quality:actor_policy:${blocker}`)),
      ...(qualityBenchmark.value.structuredOutput.schemaGrammarEnforced
        ? []
        : qualityBenchmark.value.structuredOutput.blockers
          .filter((blocker) => blocker === "schema_grammar_not_enforced")
          .map((blocker) => `local_model_quality:structured_output:${blocker}`)),
      ...(qualityBenchmark.value.targetHardware.passed
        ? []
        : qualityBenchmark.value.targetHardware.blockers.map((blocker) => `local_model_quality:target_hardware:${blocker}`)),
    ]);
  }

  const blockers: string[] = [];
  if (!benchmark.value.verdict.passed) {
    blockers.push(...benchmark.value.verdict.blockers.map((blocker) => `local_model_quality:${blocker}`));
  }
  if (benchmark.value.verdict.caveats.length > 0) {
    blockers.push("local_model_quality:structured_output_caveats_present");
  }
  if (!runtimeDeviceLooksLikeTargetM4(benchmark.value.runtime.device)) {
    blockers.push("local_model_quality:target_hardware_not_m4_profile");
  }
  blockers.push(
    "local_model_quality:missing_hidden_truth_actor_policy_benchmark",
    "local_model_quality:missing_schema_grammar_benchmark",
  );
  return unique(blockers);
}

function localVoiceRuntimeBenchmarkBlockers(
  runtimeReport: LocalRuntimeProbeReport | undefined,
  benchmark: EvidenceFile<LocalVoiceRuntimeBenchmarkReport> | undefined,
): string[] {
  if (!requiresLocalVoiceRuntimeBenchmark(runtimeReport)) {
    return [];
  }
  if (!benchmark) {
    return ["missing_local_voice_runtime_benchmark_report"];
  }
  if (benchmark.value.verdict.passed) {
    return [];
  }
  return unique(benchmark.value.verdict.blockers.map((blocker) => `local_voice_runtime_benchmark:${blocker}`));
}

function localVoiceLiveDialogBlockers(
  benchmark: EvidenceFile<LocalVoiceRuntimeBenchmarkReport> | undefined,
  liveDialogBenchmark: EvidenceFile<LocalVoiceLiveDialogBenchmarkReport> | undefined,
): string[] {
  if (!benchmark) {
    return ["missing_local_voice_runtime_benchmark_report"];
  }

  if (liveDialogBenchmark) {
    const runtimeStreamBlockers = liveDialogBenchmark.value.runtimeStream?.blockers ?? ["real_local_voice_stream_benchmark_missing"];
    return unique([
      ...liveDialogBenchmark.value.verdict.blockers.map((blocker) => `local_voice_live_dialog:${blocker}`),
      ...(liveDialogBenchmark.value.mockStream.passed
        ? []
        : (liveDialogBenchmark.value.mockStream.blockers.length > 0 ? liveDialogBenchmark.value.mockStream.blockers : ["mock_stream_probe_failed"])
          .map((blocker) => `local_voice_live_dialog:mock_stream:${blocker}`)),
      ...runtimeStreamBlockers.map((blocker) => `local_voice_live_dialog:runtime_stream:${blocker}`),
      ...liveDialogBenchmark.value.runtimeFit.blockers.map((blocker) => `local_voice_live_dialog:runtime:${blocker}`),
      ...liveDialogBenchmark.value.webxrPlayback.blockers.map((blocker) => `local_voice_live_dialog:webxr_playback:${blocker}`),
      ...liveDialogBenchmark.value.safetyControls.blockers.map((blocker) => `local_voice_live_dialog:safety_controls:${blocker}`),
    ]);
  }

  const blockers: string[] = [];
  if (!benchmark.value.verdict.passed) {
    blockers.push(...benchmark.value.verdict.blockers.map((blocker) => `local_voice_live_dialog:${blocker}`));
  }
  if (benchmark.value.verdict.caveats.some((caveat) => caveat.toLowerCase().includes("file-based"))) {
    blockers.push("local_voice_live_dialog:file_generation_only");
  }
  if (numberMetric(benchmark.value.metrics.realTimeFactor) > 1) {
    blockers.push("local_voice_live_dialog:real_time_factor_above_1");
  }
  blockers.push(
    "local_voice_live_dialog:missing_streaming_webxr_playback_benchmark",
    "local_voice_live_dialog:missing_disclosure_retention_misuse_controls",
  );
  return unique(blockers);
}

function realtimeVoiceTransportSpikeBlockers(
  realtimeVoiceTransportSpike: EvidenceFile<RealtimeVoiceTransportSpikeReport> | undefined,
): string[] {
  if (!realtimeVoiceTransportSpike) {
    return [];
  }
  const frameMetadataBlockers = realtimeVoiceTransportSpikeFrameMetadataBlockers(realtimeVoiceTransportSpike);
  const protocolEvidenceBlockers = realtimeVoiceTransportSpikeProtocolEvidenceBlockers(realtimeVoiceTransportSpike);
  return unique([
    realtimeVoiceTransportSpike.value.verdict.transportContractPassed
      ? undefined
      : "local_voice_live_dialog:realtime_transport_spike:transport_contract_failed",
    ...(realtimeVoiceTransportSpike.value.verdict.transportContractPassed
      ? []
      : realtimeVoiceTransportSpike.value.pythonBackendVerifier.blockers
        .map((blocker) => `local_voice_live_dialog:realtime_transport_spike:python_backend:${blocker}`)),
    ...frameMetadataBlockers.map((blocker) => `local_voice_live_dialog:realtime_transport_spike:${blocker}`),
    ...protocolEvidenceBlockers.map((blocker) => `local_voice_live_dialog:realtime_transport_spike:${blocker}`),
    ...realtimeVoiceTransportSpike.value.verdict.blockers
      .map((blocker) => `local_voice_live_dialog:realtime_transport_spike:${blocker}`),
  ]);
}

function realtimeVoiceTransportSpikePassed(
  realtimeVoiceTransportSpike: EvidenceFile<RealtimeVoiceTransportSpikeReport> | undefined,
): boolean {
  return Boolean(
    realtimeVoiceTransportSpike?.value.verdict.transportContractPassed
      && realtimeVoiceTransportSpikeFrameMetadataBlockers(realtimeVoiceTransportSpike).length === 0
      && realtimeVoiceTransportSpikeProtocolEvidenceBlockers(realtimeVoiceTransportSpike).length === 0,
  );
}

function realtimeVoiceTransportSpikeProtocolEvidenceBlockers(
  realtimeVoiceTransportSpike: EvidenceFile<RealtimeVoiceTransportSpikeReport>,
): string[] {
  const protocolEvidence = realtimeVoiceTransportSpike.value.protocolEvidence;
  if (!protocolEvidence) {
    return ["protocol_evidence_missing"];
  }

  return unique([
    protocolEvidence.websocketLocalHarnessObserved ? undefined : "websocket_local_harness_not_observed",
    protocolEvidence.webTransportObserved ? "webtransport_unapproved_runtime_observed" : undefined,
    protocolEvidence.quicObserved ? "quic_unapproved_runtime_observed" : undefined,
    protocolEvidence.web3SignalingObserved ? "web3_signaling_unapproved_runtime_observed" : undefined,
  ]);
}

function realtimeVoiceTransportSpikeFrameMetadataBlockers(
  realtimeVoiceTransportSpike: EvidenceFile<RealtimeVoiceTransportSpikeReport>,
): string[] {
  const harness = realtimeVoiceTransportSpike.value.harness;
  const metadataFramesSent = numberMetric(harness.audioMetadataFramesSent);
  const metadataFramesReceived = numberMetric(harness.audioChunkMetadataReceived);
  const frameLatencySamples = Array.isArray(harness.frameLatencySamplesMs) ? harness.frameLatencySamplesMs : [];
  const chunkIndexes = Array.isArray(harness.audioChunkIndexesReceived) ? harness.audioChunkIndexesReceived : [];

  return unique([
    harness.latencyBudget.passed ? undefined : "latency_budget_failed",
    metadataFramesSent > 0 && Number.isFinite(metadataFramesSent) ? undefined : "audio_metadata_frames_missing",
    metadataFramesReceived > 0 && Number.isFinite(metadataFramesReceived) ? undefined : "audio_chunk_metadata_missing",
    metadataFramesSent === metadataFramesReceived ? undefined : "audio_metadata_count_mismatch",
    frameLatencySamples.length === metadataFramesReceived ? undefined : "frame_latency_samples_incomplete",
    frameLatencySamples.every((sample) => typeof sample === "number" && Number.isFinite(sample) && sample >= 0)
      ? undefined
      : "frame_latency_samples_invalid",
    chunkIndexes.length === metadataFramesReceived ? undefined : "audio_chunk_indexes_incomplete",
    chunkIndexes.every((chunkIndex, index) => chunkIndex === index) ? undefined : "audio_chunk_indexes_not_contiguous",
  ]);
}

function apiPythonBackendRuntimeSmokeBlockers(
  apiPythonBackendRuntimeSmoke: EvidenceFile<ApiPythonBackendRuntimeSmokeReport> | undefined,
): string[] {
  if (!apiPythonBackendRuntimeSmoke) {
    return [];
  }

  return unique([
    ...apiPythonBackendRuntimeSmoke.value.verdict.blockers,
    ...apiPythonBackendRuntimeSmokeProtocolBlockers(apiPythonBackendRuntimeSmoke.value),
  ].map((blocker) => `local_voice_live_dialog:api_python_backend_runtime_smoke:${blocker}`));
}

function apiPythonBackendRuntimeSmokePassed(
  apiPythonBackendRuntimeSmoke: EvidenceFile<ApiPythonBackendRuntimeSmokeReport> | undefined,
): boolean {
  return Boolean(
    apiPythonBackendRuntimeSmoke?.value.verdict.passed
      && apiPythonBackendRuntimeSmokeProtocolBlockers(apiPythonBackendRuntimeSmoke.value).length === 0,
  );
}

function apiPythonBackendRuntimeSmokeProtocolBlockers(report: ApiPythonBackendRuntimeSmokeReport): string[] {
  const protocol = report.websocket.protocol;
  return unique([
    protocol?.backendProtocolObserved ? undefined : "websocket_backend_protocol_not_observed",
    protocol?.latencyFieldsObserved ? undefined : "websocket_latency_fields_not_observed",
    protocol?.canonicalProtocolObserved ? undefined : "websocket_canonical_protocol_not_observed",
  ]);
}

function apiBunWebSocketRuntimeSmokeBlockers(
  apiBunWebSocketRuntimeSmoke: EvidenceFile<ApiBunWebSocketRuntimeSmokeReport> | undefined,
): string[] {
  return apiBunWebSocketRuntimeSmokeEvidenceBlockers(apiBunWebSocketRuntimeSmoke)
    .map((blocker) => `local_voice_live_dialog:api_bun_websocket_runtime_smoke:${blocker}`);
}

function apiBunWebSocketRuntimeSmokePassed(
  apiBunWebSocketRuntimeSmoke: EvidenceFile<ApiBunWebSocketRuntimeSmokeReport> | undefined,
): boolean {
  return apiBunWebSocketRuntimeSmokeEvidenceBlockers(apiBunWebSocketRuntimeSmoke).length === 0;
}

function apiBunWebSocketRuntimeSmokeEvidenceBlockers(
  apiBunWebSocketRuntimeSmoke: EvidenceFile<ApiBunWebSocketRuntimeSmokeReport> | undefined,
): string[] {
  if (!apiBunWebSocketRuntimeSmoke) {
    return ["missing_api_bun_websocket_runtime_smoke_report"];
  }

  const report = apiBunWebSocketRuntimeSmoke.value;
  return unique([
    report.status === "passed" ? undefined : "api_bun_websocket_runtime_smoke_not_passed",
    report.verdict.smokePassed ? undefined : "smoke_verdict_not_passed",
    report.bun.executable && report.bun.version ? undefined : "bun_runtime_not_available",
    report.health.attempted && report.health.ok ? undefined : "health_check_failed",
    report.websocket.attempted && report.websocket.connected ? undefined : "websocket_not_connected",
    report.websocket.reconnectObserved ? undefined : "websocket_reconnect_not_observed",
    report.websocket.controlAckObserved ? undefined : "websocket_control_ack_missing",
    report.websocket.audioMetadataObserved ? undefined : "websocket_audio_metadata_missing",
    report.websocket.transcriptDeltaObserved ? undefined : "websocket_transcript_delta_missing",
    report.websocket.binaryEchoObserved ? undefined : "websocket_binary_echo_missing",
    report.websocket.serverErrors.length === 0 ? undefined : "server_errors_observed",
    report.runtime.h3.enabled === false && report.runtime.h3.h3TrueEnabled === false
      ? undefined
      : "http3_enabled_outside_approved_scope",
    ...report.runtimeEvidenceBlockers,
  ]);
}

function assetProductionBlockers(
  gltfPipelineSmoke: EvidenceFile<GltfPipelineSmokeReport> | undefined,
  blenderAssetBakeSmoke: EvidenceFile<BlenderAssetBakeSmokeReport> | undefined,
  assetProductionReadinessBenchmark: EvidenceFile<AssetProductionReadinessBenchmarkReport> | undefined,
): string[] {
  if (assetProductionReadinessBenchmark) {
    return unique(assetProductionReadinessBenchmark.value.verdict.blockers.map((blocker) => `asset_production:${blocker}`));
  }

  const blockers: string[] = [];
  if (!gltfPipelineSmoke?.value.verdict.passed) {
    blockers.push("asset_production:missing_gltf_conversion_smoke");
  }
  if (!blenderAssetBakeSmoke?.value.verdict.passed) {
    blockers.push("asset_production:missing_blender_placeholder_bake");
  }
  if (
    blenderAssetBakeSmoke?.value.input.fixture.includes("low_poly")
    || blenderAssetBakeSmoke?.value.input.sourceLicensePosture === "repo_generated_placeholder"
  ) {
    blockers.push("asset_production:placeholder_bake_only");
  }
  blockers.push(
    "asset_production:missing_generated_human_rigging_report",
    "asset_production:missing_lod_texture_collider_budget_report",
    "asset_production:missing_multi_actor_quest_budget_report",
  );
  return unique(blockers);
}

function assetCapabilityJobEvidenceBlockers(
  assetCapabilityJobEvidence: EvidenceFile<AssetCapabilityJobEvidenceReport> | undefined,
): string[] {
  if (!assetCapabilityJobEvidence) {
    return ["asset_production:missing_asset_capability_job_evidence_report"];
  }
  if (assetCapabilityJobEvidence.value.verdict.passed) {
    return [];
  }
  return unique([
    "asset_production:asset_capability_job_contract_failed",
    ...assetCapabilityJobEvidence.value.summary.blockers.map((blocker) => `asset_production:asset_capability_summary:${blocker}`),
    ...assetCapabilityJobEvidence.value.verdict.blockers.map((blocker) => `asset_production:asset_capability_verdict:${blocker}`),
    ...assetCapabilityJobEvidence.value.jobs
      .flatMap((job) => job.blockers.map((blocker) => `asset_production:asset_capability_job:${job.capabilityId}:${blocker}`)),
  ]);
}

function runtimeDeviceLooksLikeTargetM4(device: unknown): boolean {
  return typeof device === "string" && /\bM4\b/.test(device);
}

function numberMetric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function iwsdkEvidenceContractBlockers(report: IwsdkEvidenceContractReport | undefined): string[] {
  if (!report) {
    return ["missing_iwsdk_evidence_contract_report"];
  }
  if (
    report.verdict.readyForInstallBackedSidecar
    && report.verdict.readyForAgentTooling
    && report.verdict.readyForProductionRuntime
  ) {
    return [];
  }
  return unique(report.verdict.blockers.map((blocker) => `iwsdk:${blocker}`));
}

function buildIwsdkLeadershipPosture(report: IwsdkEvidenceContractReport): IwsdkLeadershipPosture {
  const statement = report.verdict.readyForInstallBackedSidecar
    ? "IWSDK Phase 1 is now an install-backed sidecar with exact core/input packages, but OpenClinXR still has no production runtime claim, no reference warmup, no MCP/devtool readiness, and no Quest foreground readiness until bundle, agent-tooling, and headset gates pass."
    : "IWSDK is MIT-licensed and architecturally relevant for Three/WebXR/AI-MCP inspection, but OpenClinXR remains contract-only: no @iwsdk packages installed, no reference warmup, no production runtime claim, and no Quest readiness claim until the local sidecar and manual foreground gates pass.";

  return {
    statement,
    sub_verdicts: iwsdkLeadershipSubVerdicts.map((subVerdict) => {
      const blockers = unique(report.verdict.blockers.filter(subVerdict.matches));
      return {
        area: subVerdict.area,
        status: blockers.length === 0 ? "ready" : "blocked",
        blockers,
      };
    }),
  };
}

const iwsdkLeadershipSubVerdicts = [
  {
    area: "license_posture",
    matches: (blocker: string) => blocker.includes("license"),
  },
  {
    area: "runtime_fit",
    matches: (blocker: string) =>
      blocker === "sidecar:exact_iwsdk_versions_selected"
      || blocker.startsWith("preinstall:")
      || blocker.startsWith("preinstall_review:")
      || (blocker.startsWith("production_runtime:") && !iwsdkQuestManualBlocker(blocker)),
  },
  {
    area: "vite_fit",
    matches: (blocker: string) => blocker.startsWith("compatibility:"),
  },
  {
    area: "ai_mcp_tooling",
    matches: (blocker: string) => blocker.startsWith("agent_tooling:"),
  },
  {
    area: "quest_manual",
    matches: iwsdkQuestManualBlocker,
  },
  {
    area: "local_only",
    matches: (blocker: string) =>
      blocker === "sidecar:operator_accepts_iwsdk_install_scope"
      || blocker === "sidecar:pnpm_iwsdk_verify_passes",
  },
  {
    area: "reference_downloads",
    matches: (blocker: string) => blocker.startsWith("metadata_drift:") || blocker.includes("@iwsdk/reference"),
  },
] as const;

function iwsdkQuestManualBlocker(blocker: string): boolean {
  return blocker.startsWith("production_runtime:")
    && (
      blocker.includes("foreground_quest")
      || blocker.includes("avg_fps")
      || blocker.includes("p95_frame_ms")
      || blocker.includes("controller_select_latency")
    );
}

function prefixBlockers(prefix: string, gate: GateStatus): Array<string | undefined> {
  if (gate.status === "ready") {
    return [];
  }
  return gate.blockers.map((blocker) => `${prefix}:${blocker}`);
}

function blockedGate(blocker: string): GateStatus {
  return { status: "blocked", blockers: [blocker] };
}

const blockerGroups = [
  {
    groupId: "benchmark_evidence_freshness",
    title: "Benchmark evidence freshness",
    owner: "qa-evidence-lead",
    matches: (blocker: string) => blocker.includes(":evidence_stale_over_") || blocker.endsWith(":evidence_timestamp_invalid"),
    nextStep: "Regenerate the stale local evidence files before using the benchmark gate as leadership-ready proof.",
  },
  {
    groupId: "quest_foreground_frame_pacing",
    title: "Foreground Quest frame pacing evidence",
    owner: "xr-systems-architect",
    matches: (blocker: string) => blocker.startsWith("quest_") || blocker.startsWith("quest_manual_performance:"),
    nextStep: "Use the approved proposals/approved/proposal-quest-foreground-performance-capture.md scope, then capture the foreground in-headset manual report for comfort, readability, immersive-session, and sustained-frame observations that CDP cannot honestly attest alone.",
  },
  {
    groupId: "local_model_runtime",
    title: "Local model runtime benchmark",
    owner: "local-ai-inference-engineer",
    matches: (blocker: string) =>
      blocker.startsWith("local_model:")
      || blocker.startsWith("local_model_benchmark:")
      || blocker.startsWith("local_model_runtime_benchmark:")
      || blocker === "missing_local_model_runtime_benchmark_report",
    nextStep: "Follow the approved proposals/approved/proposal-local-model-benchmark.md scope, set runtime and model environment variables privately, then rerun the local model benchmark.",
  },
  {
    groupId: "local_voice_runtime",
    title: "Local voice runtime benchmark",
    owner: "voice-speech-engineer",
    matches: (blocker: string) =>
      blocker.startsWith("local_voice:")
      || blocker.startsWith("local_voice_benchmark:")
      || blocker.startsWith("local_voice_runtime_benchmark:")
      || blocker === "missing_local_voice_runtime_benchmark_report",
    nextStep: "Follow the approved proposals/approved/proposal-local-voice-runtime.md scope, configure one local voice runtime and voice ID privately, then record first-audio latency evidence.",
  },
  {
    groupId: "local_model_quality",
    title: "Local model structured-output and actor-policy evidence",
    owner: "local-ai-inference-engineer",
    matches: (blocker: string) => blocker.startsWith("local_model_quality:"),
    nextStep: "Add schema/grammar, hidden-truth, actor-policy, and target M4 hardware benchmark evidence before enabling local dialogue in station runtime.",
  },
  {
    groupId: "local_voice_live_dialog",
    title: "Local voice live-dialog evidence",
    owner: "voice-speech-engineer",
    matches: (blocker: string) => blocker.startsWith("local_voice_live_dialog:"),
    nextStep: "Prove streaming WebXR playback, first audible playback latency, real-time factor, disclosure, retention, and misuse controls before enabling live local voice.",
  },
  {
    groupId: "asset_pipeline_blender",
    title: "Blender-backed asset bake",
    owner: "asset-pipeline-lead",
    matches: (blocker: string) =>
      blocker.startsWith("asset_pipeline:")
      || blocker === "missing_blender_asset_bake_smoke_report"
      || blocker.startsWith("blender_asset_bake_smoke:"),
    nextStep: "Install Blender locally and run the small humanoid asset bake before treating the asset pipeline as ready.",
  },
  {
    groupId: "asset_production_readiness",
    title: "Production asset generation readiness",
    owner: "asset-pipeline-lead",
    matches: (blocker: string) => blocker.startsWith("asset_production:"),
    nextStep: "Add generated human, skin, clothing, rigging, animation, equipment, LOD, texture, and collider reports before claiming production asset readiness.",
  },
  {
    groupId: "iwsdk_sidecar_tooling",
    title: "IWSDK sidecar and MCP tooling evidence",
    owner: "xr-systems-architect",
    matches: (blocker: string) =>
      blocker === "missing_iwsdk_evidence_contract_report" || blocker.startsWith("iwsdk:"),
    nextStep: "Use the approved proposals/approved/proposal-iwsdk-phase2-devtools.md scope when sidecar devtools are useful; keep IWSDK isolated to the sidecar and record adapter-sync, MCP inventory, bundle, and Quest evidence before production adoption.",
  },
] as const;

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
