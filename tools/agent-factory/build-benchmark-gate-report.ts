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

export type BenchmarkGateReportInput = {
  questSmoke?: EvidenceFile<QuestSmokeReport>;
  localRuntime?: EvidenceFile<LocalRuntimeProbeReport>;
  gltfPipelineSmoke?: EvidenceFile<GltfPipelineSmokeReport>;
  blenderAssetBakeSmoke?: EvidenceFile<BlenderAssetBakeSmokeReport>;
  localProviderBenchmark?: EvidenceFile<LocalProviderBenchmarkReport>;
  questManualPerformance?: EvidenceFile<QuestManualPerformanceCheck>;
  questManualPerformanceReport?: EvidenceFile<QuestManualPerformanceReport>;
  iwsdkEvidenceContract?: EvidenceFile<IwsdkEvidenceContractReport>;
};

async function main(): Promise<void> {
  const questSmoke = await latestJson<QuestSmokeReport>("docs/openclinxr/quest-cdp-smoke-*.json");
  const localRuntime = await latestJson<LocalRuntimeProbeReport>("docs/openclinxr/local-runtime-probe-*.json");
  const gltfPipelineSmoke = await latestJson<GltfPipelineSmokeReport>("docs/openclinxr/gltf-pipeline-smoke-*.json");
  const blenderAssetBakeSmoke = await latestJson<BlenderAssetBakeSmokeReport>("docs/openclinxr/blender-asset-bake-smoke-*.json");
  const localProviderBenchmark = await latestJson<LocalProviderBenchmarkReport>("docs/openclinxr/local-provider-benchmark-*.json");
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

export function buildBenchmarkGateReport(input: BenchmarkGateReportInput): EvidenceGateReport {
  const { questSmoke, localRuntime, gltfPipelineSmoke, blenderAssetBakeSmoke, localProviderBenchmark, iwsdkEvidenceContract } = input;
  const questSmokeEvidenceCheck = questSmoke
    ? { file: questSmoke.file, value: buildQuestSmokeEvidenceCheck(questSmoke.file, questSmoke.value) }
    : undefined;
  const questManualPerformance = input.questManualPerformanceReport
    ? manualPerformanceReportToCheck(input.questManualPerformanceReport)
    : input.questManualPerformance;
  const questEvidenceBlockers = [
    ...questBlockers(questSmoke?.value, questSmokeEvidenceCheck?.value),
    ...questManualPerformanceBlockers(questManualPerformance?.value),
    ...questUsbBlockers(localRuntime?.value),
    ...questForegroundPreflightBlockers(localRuntime?.value),
  ];
  const localModelEvidenceBlockers = [
    ...localModelRuntimeBlockers(localRuntime?.value),
    ...localModelBenchmarkBlockers(localProviderBenchmark?.value),
  ];
  const localVoiceEvidenceBlockers = [
    ...localVoiceRuntimeBlockers(localRuntime?.value),
    ...localVoiceBenchmarkBlockers(localProviderBenchmark?.value),
  ];
  const assetEvidenceBlockers = [
    ...assetRuntimeBlockers(localRuntime?.value),
    ...gltfPipelineSmokeBlockers(gltfPipelineSmoke?.value),
    ...blenderAssetBakeSmokeBlockers(blenderAssetBakeSmoke?.value),
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

function localModelRuntimeBlockers(report: LocalRuntimeProbeReport | undefined): string[] {
  if (!report) {
    return ["missing_local_runtime_probe_report"];
  }
  return unique(prefixBlockers("local_model", report.gates.localModel));
}

function localVoiceRuntimeBlockers(report: LocalRuntimeProbeReport | undefined): string[] {
  if (!report) {
    return ["missing_local_runtime_probe_report"];
  }
  return unique(prefixBlockers("local_voice", report.gates.localVoice));
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
  return {
    statement: "IWSDK is MIT-licensed and architecturally relevant for Three/WebXR/AI-MCP inspection, but OpenClinXR remains contract-only: no @iwsdk packages installed, no reference warmup, no production runtime claim, and no Quest readiness claim until the local sidecar and manual foreground gates pass.",
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
    groupId: "quest_foreground_frame_pacing",
    title: "Foreground Quest frame pacing evidence",
    owner: "xr-systems-architect",
    matches: (blocker: string) => blocker.startsWith("quest_") || blocker.startsWith("quest_manual_performance:"),
    nextStep: "Capture a foreground in-headset manual performance report and keep CDP hidden-page blockers until that report passes.",
  },
  {
    groupId: "local_model_runtime",
    title: "Local model runtime benchmark",
    owner: "local-ai-inference-engineer",
    matches: (blocker: string) => blocker.startsWith("local_model:") || blocker.startsWith("local_model_benchmark:"),
    nextStep: "Install or point to one approved local model runtime if missing; otherwise approve one model ID/download, set runtime and model environment variables, then rerun the benchmark.",
  },
  {
    groupId: "local_voice_runtime",
    title: "Local voice runtime benchmark",
    owner: "voice-speech-engineer",
    matches: (blocker: string) => blocker.startsWith("local_voice:") || blocker.startsWith("local_voice_benchmark:"),
    nextStep: "Complete voice install approval plus safety/license review, configure one local voice runtime and voice ID, then record first-audio latency evidence.",
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
    nextStep: "Keep IWSDK contract-only until the operator approves the sidecar install scope, exact versions, license posture, adapter-sync evidence, and foreground Quest performance proof.",
  },
] as const;

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
