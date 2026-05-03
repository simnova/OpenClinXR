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
  evidence_gates: Array<{
    evidence_id: string;
    ready_to_resolve: boolean;
    satisfied_conditions: string[];
    blockers: string[];
  }>;
};

async function main(): Promise<void> {
  const questSmoke = await latestJson<QuestSmokeReport>("docs/openclinxr/quest-cdp-smoke-*.json");
  const localRuntime = await latestJson<LocalRuntimeProbeReport>("docs/openclinxr/local-runtime-probe-*.json");
  const report = buildReport(questSmoke, localRuntime);
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

function buildReport(
  questSmoke: { file: string; value: QuestSmokeReport } | undefined,
  localRuntime: { file: string; value: LocalRuntimeProbeReport } | undefined,
): EvidenceGateReport {
  const blockers = [
    ...questBlockers(questSmoke?.value),
    ...localRuntimeBlockers(localRuntime?.value),
  ];
  const satisfiedConditions = [
    questSmoke?.value.verdict.shellLoaded ? "quest_shell_loaded" : undefined,
    questSmoke?.value.verdict.interactionAdvanced ? "quest_trace_interaction_advanced" : undefined,
    localRuntime?.value.gates.questUsb.status === "ready" ? "quest_usb_ready" : undefined,
    localRuntime?.value.gates.assetPipeline.status === "ready" ? "asset_pipeline_runtime_ready" : undefined,
    localRuntime?.value.gates.localModel.status === "ready" ? "local_model_runtime_ready" : undefined,
    localRuntime?.value.gates.localVoice.status === "ready" ? "local_voice_runtime_ready" : undefined,
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
    evidence_gates: [
      {
        evidence_id: "evidence-leadership-0007-002",
        ready_to_resolve: blockers.length === 0,
        satisfied_conditions: satisfiedConditions,
        blockers,
      },
    ],
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

function prefixBlockers(prefix: string, gate: GateStatus): Array<string | undefined> {
  if (gate.status === "ready") {
    return [];
  }
  return gate.blockers.map((blocker) => `${prefix}:${blocker}`);
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

await main();
