import { globFiles, readJson, writeJson } from "./lib.js";

type QuestSmokeReport = {
  generatedAt: string;
  verdict: {
    shellLoaded: boolean;
    interactionAdvanced: boolean;
    frameSampleComplete: boolean;
    blockers: string[];
  };
};

type GateStatus = {
  status: "ready" | "not_configured" | "blocked";
  blockers: string[];
};

type LocalRuntimeProbeReport = {
  generatedAt: string;
  gates: {
    questUsb: GateStatus;
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

type QuestManualPerformanceCheck = {
  generatedAt: string;
  inputFile: string | null;
  readyToClaimFramePacing: boolean;
  satisfiedConditions: string[];
  blockers: string[];
};

type EvidenceGateReport = {
  generated_by: string;
  quest_smoke?: {
    file: string;
    generated_at: string;
    shell_loaded: boolean;
    interaction_advanced: boolean;
    frame_sample_complete: boolean;
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

async function main(): Promise<void> {
  const questSmoke = await latestJson<QuestSmokeReport>("docs/openclinxr/quest-cdp-smoke-*.json");
  const localRuntime = await latestJson<LocalRuntimeProbeReport>("docs/openclinxr/local-runtime-probe-*.json");
  const gltfPipelineSmoke = await latestJson<GltfPipelineSmokeReport>("docs/openclinxr/gltf-pipeline-smoke-*.json");
  const localProviderBenchmark = await latestJson<LocalProviderBenchmarkReport>("docs/openclinxr/local-provider-benchmark-*.json");
  const questManualPerformance = await fileJson<QuestManualPerformanceCheck>(".agent-factory/quest-manual-performance-report.json");
  const report = buildReport(questSmoke, localRuntime, gltfPipelineSmoke, localProviderBenchmark, questManualPerformance);
  await writeJson(".agent-factory/benchmark-gate-report.json", report);
  console.log(`Wrote .agent-factory/benchmark-gate-report.json; evidence-leadership-0007-002 ready=${report.evidence_gates[0]?.ready_to_resolve ?? false}`);
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

function buildReport(
  questSmoke: { file: string; value: QuestSmokeReport } | undefined,
  localRuntime: { file: string; value: LocalRuntimeProbeReport } | undefined,
  gltfPipelineSmoke: { file: string; value: GltfPipelineSmokeReport } | undefined,
  localProviderBenchmark: { file: string; value: LocalProviderBenchmarkReport } | undefined,
  questManualPerformance: { file: string; value: QuestManualPerformanceCheck } | undefined,
): EvidenceGateReport {
  const blockers = [
    ...questBlockers(questSmoke?.value),
    ...questManualPerformanceBlockers(questManualPerformance?.value),
    ...localRuntimeBlockers(localRuntime?.value),
    ...gltfPipelineSmokeBlockers(gltfPipelineSmoke?.value),
    ...localProviderBenchmarkBlockers(localProviderBenchmark?.value),
  ];
  const satisfiedConditions = [
    questSmoke?.value.verdict.shellLoaded ? "quest_shell_loaded" : undefined,
    questSmoke?.value.verdict.interactionAdvanced ? "quest_trace_interaction_advanced" : undefined,
    questManualPerformance?.value.readyToClaimFramePacing ? "quest_manual_frame_pacing_ready" : undefined,
    ...(questManualPerformance?.value.satisfiedConditions ?? []),
    localRuntime?.value.gates.questUsb.status === "ready" ? "quest_usb_ready" : undefined,
    localRuntime?.value.gates.assetPipeline.status === "ready" ? "asset_pipeline_runtime_ready" : undefined,
    gltfPipelineSmoke?.value.verdict.passed ? "asset_pipeline_gltf_pipeline_smoke_passed" : undefined,
    localProviderBenchmark?.value.verdict.deterministicMocksPassed ? "local_provider_mock_benchmarks_passed" : undefined,
    localRuntime?.value.gates.localModel.status === "ready" ? "local_model_runtime_ready" : undefined,
    localRuntime?.value.gates.localVoice.status === "ready" ? "local_voice_runtime_ready" : undefined,
    localProviderBenchmark?.value.verdict.localModelReadyToBenchmark ? "local_model_ready_to_benchmark" : undefined,
    localProviderBenchmark?.value.verdict.localVoiceReadyToBenchmark ? "local_voice_ready_to_benchmark" : undefined,
  ].filter((condition): condition is string => typeof condition === "string");

  return {
    generated_by: "tools/agent-factory/build-benchmark-gate-report.ts",
    ...(questSmoke ? {
      quest_smoke: {
        file: questSmoke.file,
        generated_at: questSmoke.value.generatedAt,
        shell_loaded: questSmoke.value.verdict.shellLoaded,
        interaction_advanced: questSmoke.value.verdict.interactionAdvanced,
        frame_sample_complete: questSmoke.value.verdict.frameSampleComplete,
        blockers: [...questSmoke.value.verdict.blockers],
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
    evidence_gates: [
      {
        evidence_id: "evidence-leadership-0007-002",
        ready_to_resolve: blockers.length === 0,
        satisfied_conditions: satisfiedConditions,
        blockers,
        blocker_summary: summarizeBlockers(blockers),
      },
    ],
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

function questBlockers(report: QuestSmokeReport | undefined): string[] {
  if (!report) {
    return ["missing_quest_cdp_smoke_report"];
  }

  const blockers = [...report.verdict.blockers];
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

function localRuntimeBlockers(report: LocalRuntimeProbeReport | undefined): string[] {
  if (!report) {
    return ["missing_local_runtime_probe_report"];
  }

  return unique([
    ...prefixBlockers("quest_usb", report.gates.questUsb),
    ...prefixBlockers("local_model", report.gates.localModel),
    ...prefixBlockers("local_voice", report.gates.localVoice),
    ...prefixBlockers("asset_pipeline", report.gates.assetPipeline),
    report.gates.localModel.status === "ready" ? "local_model_runtime_not_benchmarked" : undefined,
    report.gates.localVoice.status === "ready" ? "local_voice_runtime_not_benchmarked" : undefined,
  ]);
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

function localProviderBenchmarkBlockers(report: LocalProviderBenchmarkReport | undefined): string[] {
  if (!report) {
    return ["missing_local_provider_benchmark_report"];
  }
  return unique([
    ...report.mockModel.blockers.map((blocker) => `mock_model_benchmark:${blocker}`),
    ...report.mockVoice.blockers.map((blocker) => `mock_voice_benchmark:${blocker}`),
    ...(report.verdict.localModelReadyToBenchmark ? [] : report.localModel.blockers.map((blocker) => `local_model_benchmark:${blocker}`)),
    ...(report.verdict.localVoiceReadyToBenchmark ? [] : report.localVoice.blockers.map((blocker) => `local_voice_benchmark:${blocker}`)),
  ]);
}

function prefixBlockers(prefix: string, gate: GateStatus): Array<string | undefined> {
  if (gate.status === "ready") {
    return [];
  }
  return gate.blockers.map((blocker) => `${prefix}:${blocker}`);
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
    nextStep: "Install or point to one approved local model runtime, set the runtime and model environment variables, then rerun the benchmark.",
  },
  {
    groupId: "local_voice_runtime",
    title: "Local voice runtime benchmark",
    owner: "voice-speech-engineer",
    matches: (blocker: string) => blocker.startsWith("local_voice:") || blocker.startsWith("local_voice_benchmark:"),
    nextStep: "Complete voice safety and license review, configure one local voice runtime and voice ID, then record first-audio latency evidence.",
  },
  {
    groupId: "asset_pipeline_blender",
    title: "Blender-backed asset bake",
    owner: "asset-pipeline-lead",
    matches: (blocker: string) => blocker.startsWith("asset_pipeline:"),
    nextStep: "Install Blender locally and run the small humanoid asset bake before treating the asset pipeline as ready.",
  },
] as const;

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

await main();
