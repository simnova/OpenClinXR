import { pathToFileURL } from "node:url";
import {
  buildQuestManualPerformanceCheck,
  type QuestManualPerformanceCheck,
  type QuestManualPerformanceReport,
} from "../openclinxr/check-quest-manual-performance.js";
import {
  buildQuestSmokeEvidenceCheck,
  type QuestSmokeEvidenceCheck,
  type QuestSmokeReport,
} from "../openclinxr/quest-cdp-smoke.js";
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
  local_voice_runtime_benchmark?: {
    file: string;
    generated_at: string;
    status: string;
    runtime: LocalVoiceRuntimeBenchmarkReport["runtime"];
    audio: LocalVoiceRuntimeBenchmarkReport["audio"];
    metrics: LocalVoiceRuntimeBenchmarkReport["metrics"];
    verdict: LocalVoiceRuntimeBenchmarkReport["verdict"];
  };
  quest_manual_performance?: {
    file: string;
    generated_at: string;
    input_file: string | null;
    ready_to_claim_frame_pacing: boolean;
    satisfied_conditions: string[];
    blockers: string[];
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
  localProviderBenchmark?: EvidenceFile<LocalProviderBenchmarkReport>;
  localModelRuntimeBenchmark?: EvidenceFile<LocalModelRuntimeBenchmarkReport>;
  localVoiceRuntimeBenchmark?: EvidenceFile<LocalVoiceRuntimeBenchmarkReport>;
  questManualPerformance?: EvidenceFile<QuestManualPerformanceCheck>;
  questManualPerformanceReport?: EvidenceFile<QuestManualPerformanceReport>;
  iwsdkEvidenceContract?: EvidenceFile<IwsdkEvidenceContractReport>;
};

export type BenchmarkGateReportOptions = {
  now?: Date | string;
  maxEvidenceAgeHours?: number;
};

const defaultMaxEvidenceAgeHours = 24;
const hourMs = 60 * 60 * 1000;

async function main(): Promise<void> {
  const questSmoke = await latestJson<QuestSmokeReport>("docs/openclinxr/quest-cdp-smoke-*.json");
  const localRuntime = await latestJson<LocalRuntimeProbeReport>("docs/openclinxr/local-runtime-probe-*.json");
  const gltfPipelineSmoke = await latestJson<GltfPipelineSmokeReport>("docs/openclinxr/gltf-pipeline-smoke-*.json");
  const blenderAssetBakeSmoke = await latestJson<BlenderAssetBakeSmokeReport>("docs/openclinxr/blender-asset-bake-smoke-*.json");
  const localProviderBenchmark = await latestJson<LocalProviderBenchmarkReport>("docs/openclinxr/local-provider-benchmark-*.json");
  const localModelRuntimeBenchmark = await latestJson<LocalModelRuntimeBenchmarkReport>("docs/openclinxr/local-model-runtime-benchmark-*.json");
  const localVoiceRuntimeBenchmark = await latestJson<LocalVoiceRuntimeBenchmarkReport>("docs/openclinxr/local-voice-runtime-benchmark-*.json");
  const iwsdkEvidenceContract = await latestJson<IwsdkEvidenceContractReport>("docs/openclinxr/iwsdk-evidence-contract-*.json");
  const questManualPerformanceReport = await latestQuestManualPerformanceReportJson();
  const questManualPerformance = questManualPerformanceReport
    ? manualPerformanceReportToCheck(questManualPerformanceReport)
    : await fileJson<QuestManualPerformanceCheck>(".agent-factory/quest-manual-performance-report.json");
  const report = buildBenchmarkGateReport({
    questSmoke,
    localRuntime,
    gltfPipelineSmoke,
    blenderAssetBakeSmoke,
    localProviderBenchmark,
    localModelRuntimeBenchmark,
    localVoiceRuntimeBenchmark,
    iwsdkEvidenceContract,
    questManualPerformance,
    questManualPerformanceReport,
  });
  await writeJson(".agent-factory/benchmark-gate-report.json", report);
  const readySummary = report.evidence_gates
    .map((gate) => `${gate.evidence_id}=${gate.ready_to_resolve}`)
    .join(", ");
  console.log(`Wrote .agent-factory/benchmark-gate-report.json; gates ${readySummary}`);
}

async function latestJson<TValue>(pattern: string): Promise<{ file: string; value: TValue } | undefined> {
  const files = (await globFiles(pattern)).sort();
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
    localProviderBenchmark,
    localModelRuntimeBenchmark,
    localVoiceRuntimeBenchmark,
    iwsdkEvidenceContract,
  } = input;
  const questSmokeEvidenceCheck = questSmoke
    ? { file: questSmoke.file, value: buildQuestSmokeEvidenceCheck(questSmoke.file, questSmoke.value) }
    : undefined;
  const questManualPerformance = input.questManualPerformanceReport
    ? manualPerformanceReportToCheck(input.questManualPerformanceReport)
    : input.questManualPerformance;
  const evidenceFreshness = buildEvidenceFreshnessReport({
    questSmoke,
    localRuntime,
    gltfPipelineSmoke,
    blenderAssetBakeSmoke,
    localProviderBenchmark,
    localModelRuntimeBenchmark,
    localVoiceRuntimeBenchmark,
    questManualPerformance,
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
    localProviderBenchmark?.value.verdict.deterministicMocksPassed ? "local_provider_mock_benchmarks_passed" : undefined,
    localRuntime?.value.gates.localModel.status === "ready" ? "local_model_runtime_ready" : undefined,
    localRuntime?.value.gates.localVoice.status === "ready" ? "local_voice_runtime_ready" : undefined,
    localProviderBenchmark?.value.verdict.localModelReadyToBenchmark ? "local_model_ready_to_benchmark" : undefined,
    localProviderBenchmark?.value.verdict.localVoiceReadyToBenchmark ? "local_voice_ready_to_benchmark" : undefined,
    localModelRuntimeBenchmark?.value.verdict.passed ? "local_model_runtime_benchmark_passed" : undefined,
    localVoiceRuntimeBenchmark?.value.verdict.passed ? "local_voice_first_audio_benchmark_passed" : undefined,
  ]);
  const questSatisfiedConditions = combinedSatisfiedConditions.filter((condition) =>
    condition.startsWith("quest_") || (questManualPerformance?.value.satisfiedConditions ?? []).includes(condition)
  );
  const localModelSatisfiedConditions = combinedSatisfiedConditions.filter((condition) =>
    condition.startsWith("local_model_") || condition === "local_provider_mock_benchmarks_passed"
  );
  const localVoiceSatisfiedConditions = combinedSatisfiedConditions.filter((condition) =>
    condition.startsWith("local_voice_") || condition === "local_provider_mock_benchmarks_passed"
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
    ...(questManualPerformance ? {
      quest_manual_performance: {
        file: questManualPerformance.file,
        generated_at: questManualPerformance.value.generatedAt,
        input_file: questManualPerformance.value.inputFile,
        ready_to_claim_frame_pacing: questManualPerformance.value.readyToClaimFramePacing,
        satisfied_conditions: [...questManualPerformance.value.satisfiedConditions],
        blockers: [...questManualPerformance.value.blockers],
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
      buildEvidenceGate("evidence-leadership-0008-004", iwsdkSatisfiedConditions, unique(iwsdkEvidenceBlockers)),
    ],
  };
}

function buildEvidenceFreshnessReport(
  evidence: {
    questSmoke?: EvidenceFile<QuestSmokeReport>;
    localRuntime?: EvidenceFile<LocalRuntimeProbeReport>;
    gltfPipelineSmoke?: EvidenceFile<GltfPipelineSmokeReport>;
    blenderAssetBakeSmoke?: EvidenceFile<BlenderAssetBakeSmokeReport>;
    localProviderBenchmark?: EvidenceFile<LocalProviderBenchmarkReport>;
    localModelRuntimeBenchmark?: EvidenceFile<LocalModelRuntimeBenchmarkReport>;
    localVoiceRuntimeBenchmark?: EvidenceFile<LocalVoiceRuntimeBenchmarkReport>;
    questManualPerformance?: EvidenceFile<QuestManualPerformanceCheck>;
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
    evidenceFreshnessEntry("local_provider_benchmark", evidence.localProviderBenchmark, now, maxAgeHours),
    evidenceFreshnessEntry("local_model_runtime_benchmark", evidence.localModelRuntimeBenchmark, now, maxAgeHours),
    evidenceFreshnessEntry("local_voice_runtime_benchmark", evidence.localVoiceRuntimeBenchmark, now, maxAgeHours),
    evidenceFreshnessEntry("quest_manual_performance", evidence.questManualPerformance, now, maxAgeHours),
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

async function latestQuestManualPerformanceReportJson(): Promise<EvidenceFile<QuestManualPerformanceReport> | undefined> {
  const files = (await globFiles("docs/openclinxr/quest-manual-performance-*.json"))
    .filter((file) => !file.endsWith("quest-manual-performance-template.json"))
    .sort();
  const file = files.at(-1);
  if (!file) {
    return undefined;
  }
  return { file, value: await readJson<QuestManualPerformanceReport>(file) };
}

function manualPerformanceReportToCheck(
  report: EvidenceFile<QuestManualPerformanceReport>,
): EvidenceFile<QuestManualPerformanceCheck> {
  return {
    file: report.file,
    value: buildQuestManualPerformanceCheck(report.file, report.value),
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
    nextStep: "Review proposal-quest-foreground-performance-capture.md, then capture a foreground in-headset manual performance report and keep CDP hidden-page blockers until that report passes.",
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
    groupId: "iwsdk_sidecar_tooling",
    title: "IWSDK sidecar and MCP tooling evidence",
    owner: "xr-systems-architect",
    matches: (blocker: string) =>
      blocker === "missing_iwsdk_evidence_contract_report" || blocker.startsWith("iwsdk:"),
    nextStep: "Review proposal-iwsdk-phase2-devtools.md before adding Phase 2 packages; keep IWSDK isolated to the Phase 1 sidecar until bundle budgets, adapter-sync evidence, and foreground Quest performance proof pass.",
  },
] as const;

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
