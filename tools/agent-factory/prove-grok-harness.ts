import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { readFile as readFileAsync, writeFile as writeFileAsync } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getRepoRoleHarnessPolicy,
  recommendBackgroundAgentModel,
  repoRoleHarnessPolicies,
  resolveHarnessModelSpec,
} from "../../packages/openclinxr/agent-loop/src/index.js";

type ProofIteration = {
  id: string;
  name: string;
  passed: boolean;
  details: Record<string, unknown>;
  durationMs: number;
};

type GrokSessionTokenSummary = {
  sessionId: string;
  sessionDir: string;
  currentModelId?: string;
  peakTotalTokens: number;
  finalTotalTokens: number;
  promptCount: number;
  turnCount: number;
  toolCallCount: number;
  modelIdsSeen: string[];
};

type CcusageAgentSummary = {
  available: boolean;
  agent: string;
  sessionCount: number;
  totalTokens: number;
  totalCostUsd: number;
  topModels: string[];
  note: string;
};

type ProofRunSummary = {
  run: number;
  passed: boolean;
  failedIterationIds: string[];
  durationMs: number;
};

type HarnessProofReport = {
  schemaVersion: "openclinxr.grok-harness-proof.v1";
  generatedAt: string;
  quick: boolean;
  runs: number;
  runSummaries: ProofRunSummary[];
  iterations: ProofIteration[];
  passed: boolean;
  grokSessions: GrokSessionTokenSummary[];
  ccusageCodex: CcusageAgentSummary;
  ccusageOpenclaw: CcusageAgentSummary;
  tokenEfficiency: {
    snapshotRehydrateBytes: number;
    fullAgentsMdBytes: number;
    estimatedContextSavingRatio: number;
    exploreSubagentModel: string;
    composerModelTier: string;
    composerOrchestrationDocumented: boolean;
    grokPeakTokensCurrentWorkspace: number;
    grokPeakByModel: Array<{ modelId: string; peakTotalTokens: number; sessionCount: number }>;
    scoutVsFrontierPeakRatio: number | null;
    hypotheticalExploreSavingsNote: string;
  };
  recommendations: string[];
};

const repoRoot = process.cwd();

function parseArgs(argv: string[]): { quick: boolean; runs: number; outputPath: string } {
  let quick = false;
  let runs = 1;
  let outputPath = path.join(".openclinxr", "openclaw", "grok-harness-proof-latest.json");
  for (const arg of argv) {
    if (arg === "--quick") {
      quick = true;
    }
    if (arg.startsWith("--runs=")) {
      runs = Math.max(1, Number(arg.slice("--runs=".length)) || 1);
    }
    if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  return { quick, runs, outputPath };
}

async function runIteration(
  id: string,
  name: string,
  fn: () => Promise<Record<string, unknown>>,
): Promise<ProofIteration> {
  const started = Date.now();
  try {
    const details = await fn();
    return { id, name, passed: true, details, durationMs: Date.now() - started };
  } catch (error) {
    return {
      id,
      name,
      passed: false,
      details: { error: error instanceof Error ? error.message : String(error) },
      durationMs: Date.now() - started,
    };
  }
}

function readTomlValue(filePath: string, keyPath: string): string | undefined {
  const content = requireFsRead(filePath);
  const parts = keyPath.split(".");
  const section = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
  const key = parts.length > 1 ? parts[parts.length - 1] : keyPath;
  let inSection = section === null;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) {
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inSection = section === null || trimmed === `[${section}]`;
      continue;
    }
    if (!inSection) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"/);
    if (match && match[1] === key) {
      return match[2];
    }
  }
  return undefined;
}

function requireFsRead(filePath: string): string {
  return execFileSync("cat", [filePath], { encoding: "utf8" });
}

async function iterationConfigComposerHints(): Promise<Record<string, unknown>> {
  const configPath = path.join(repoRoot, ".grok", "config.toml");
  const config = await readFileAsync(configPath, "utf8");
  const rules = await readFileAsync(path.join(repoRoot, "agents", "rules", "grok-harness-usage.md"), "utf8");
  const hook = await readFileAsync(
    path.join(repoRoot, ".grok", "hooks", "session-start-memory-consult.json"),
    "utf8",
  );
  if (!config.includes("Composer orchestration entrypoint")) {
    throw new Error("Missing Composer orchestration section in .grok/config.toml");
  }
  if (!rules.includes("Composer as orchestration entrypoint")) {
    throw new Error("Missing Composer section in agents/rules/grok-harness-usage.md");
  }
  const exploreModel = readTomlValue(configPath, "subagents.models.explore");
  const planModel = readTomlValue(configPath, "subagents.models.plan");
  const defaultModel = readTomlValue(configPath, "subagents.default_model");
  if (exploreModel !== "deepseek-v4-flash" || planModel !== "deepseek-v4-pro") {
    throw new Error(`Unexpected subagent models: explore=${exploreModel} plan=${planModel}`);
  }
  if (defaultModel) {
    throw new Error(`subagents.default_model must be unset for per-type routing; found ${defaultModel}`);
  }
  if (!hook.includes("Composer = primary OpenClaw orchestrator")) {
    throw new Error("SessionStart hook missing Composer orchestration reminder");
  }
  return { exploreModel, planModel, defaultModel: defaultModel ?? null, composerDocumented: true };
}

async function iterationRolePolicyMatrix(): Promise<Record<string, unknown>> {
  const coordinator = getRepoRoleHarnessPolicy("chief-coordinator");
  if (!coordinator || coordinator.policyTier !== "fast_bounded") {
    throw new Error("chief-coordinator policy missing or wrong tier");
  }
  const exploreRec = recommendBackgroundAgentModel({ taskType: "bounded_scout", harness: "grok" });
  const codexRec = recommendBackgroundAgentModel({ taskType: "bounded_scout", harness: "codex" });
  if (exploreRec.model !== "deepseek-v4-flash") {
    throw new Error(`Grok scout model expected deepseek-v4-flash, got ${exploreRec.model}`);
  }
  if (codexRec.codexAssistBridge !== "moonbridge") {
    throw new Error("Codex scout should offer moonbridge assist bridge");
  }
  return {
    roleCount: repoRoleHarnessPolicies.length,
    grokScoutModel: exploreRec.model,
    codexAssistBridge: codexRec.codexAssistBridge,
    vpTier: getRepoRoleHarnessPolicy("vp-engineering-delivery")?.policyTier,
  };
}

async function iterationCodexTomlSync(): Promise<Record<string, unknown>> {
  const spawn = spawnSync("pnpm", ["agent:harness:sync"], { cwd: repoRoot, encoding: "utf8" });
  if (spawn.status !== 0) {
    throw new Error(`agent:harness:sync failed: ${spawn.stderr || spawn.stdout}`);
  }
  const checks: Array<{ role: string; model: string; sandbox: string }> = [
    { role: "chief-coordinator", model: "gpt-5.4-mini", sandbox: "read-only" },
    { role: "asset-pipeline-lead", model: "gpt-5.4", sandbox: "workspace-write" },
    { role: "vp-engineering-delivery", model: "gpt-5.5", sandbox: "read-only" },
  ];
  for (const check of checks) {
    const tomlPath = path.join(repoRoot, ".codex", "agents", `${check.role}.toml`);
    const toml = await readFileAsync(tomlPath, "utf8");
    if (!toml.includes(`model = "${check.model}"`)) {
      throw new Error(`${check.role} toml missing model ${check.model}`);
    }
    if (!toml.includes(`sandbox_mode = "${check.sandbox}"`)) {
      throw new Error(`${check.role} toml missing sandbox ${check.sandbox}`);
    }
  }
  return { synced: true, checkedRoles: checks.map((c) => c.role) };
}

async function iterationAgentLoopTests(): Promise<Record<string, unknown>> {
  const spawn = spawnSync("pnpm", ["--filter", "@openclinxr/agent-loop", "test"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (spawn.status !== 0) {
    throw new Error(`agent-loop tests failed: ${spawn.stderr || spawn.stdout}`);
  }
  return { tests: "passed" };
}

async function iterationMemoryAppendDry(): Promise<Record<string, unknown>> {
  const lesson =
    "Composer is the Grok orchestration entrypoint; explore+deepseek-v4-flash handles read-only coordinator consults.";
  const spawn = spawnSync(
    "tsx",
    [
      "tools/agent-factory/append-role-memory-lesson.ts",
      "--role",
      "chief-coordinator",
      "--topic",
      "composer-harness-proof",
      "--lesson",
      lesson,
      "--no-index",
      "--skip-if-exists",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (spawn.status !== 0) {
    throw new Error(`memory append failed: ${spawn.stderr || spawn.stdout}`);
  }
  const memoryPath = path.join(repoRoot, "agents", "coordinator", "chief-coordinator", "memory.md");
  const memory = await readFileAsync(memoryPath, "utf8");
  if (!memory.includes("composer-harness-proof")) {
    throw new Error("memory append did not land in chief-coordinator memory.md");
  }
  return { memoryPath, appended: true };
}

function grokHome(): string {
  return process.env.GROK_HOME || path.join(os.homedir(), ".grok");
}

function grokSessionRoot(): string {
  return path.join(grokHome(), "sessions", "%2FVolumes%2Ffiles%2Fsrc%2Fopenclinxr");
}

async function parseGrokSessionTokens(limit = 5): Promise<GrokSessionTokenSummary[]> {
  const root = grokSessionRoot();
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const summaries: GrokSessionTokenSummary[] = [];
  const sessionDirs = entries
    .map((entry) => path.join(root, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, limit);

  for (const sessionDir of sessionDirs) {
    const updatesPath = path.join(sessionDir, "updates.jsonl");
    const summaryPath = path.join(sessionDir, "summary.json");
    let peakTotalTokens = 0;
    let finalTotalTokens = 0;
    const promptIds = new Set<string>();
    const modelIdsSeen = new Set<string>();
    let toolCallCount = 0;
    let turnCount = 0;
    try {
      const lines = readFileSync(updatesPath, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        const row = JSON.parse(line) as {
          params?: {
            update?: {
              sessionUpdate?: string;
              _meta?: { modelId?: string };
            };
            _meta?: { totalTokens?: number; promptId?: string; modelId?: string };
          };
          _meta?: { totalTokens?: number; promptId?: string; modelId?: string };
        };
        const meta = row.params?._meta ?? row._meta;
        const total = meta?.totalTokens ?? 0;
        finalTotalTokens = total;
        if (total > peakTotalTokens) {
          peakTotalTokens = total;
        }
        if (meta?.promptId) {
          promptIds.add(meta.promptId);
        }
        const modelId = row.params?.update?._meta?.modelId ?? meta?.modelId;
        if (modelId) {
          modelIdsSeen.add(modelId);
        }
        const updateType = row.params?.update?.sessionUpdate;
        if (updateType === "tool_call") {
          toolCallCount += 1;
        }
        if (updateType === "agent_message_chunk" || updateType === "agent_thought_chunk") {
          turnCount += 1;
        }
      }
    } catch {
      continue;
    }
    let currentModelId: string | undefined;
    try {
      const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as {
        current_model_id?: string;
        info?: { id?: string };
      };
      currentModelId = summary.current_model_id;
      if (currentModelId) {
        modelIdsSeen.add(currentModelId);
      }
      summaries.push({
        sessionId: summary.info?.id ?? path.basename(sessionDir),
        sessionDir,
        currentModelId,
        peakTotalTokens,
        finalTotalTokens,
        promptCount: promptIds.size,
        turnCount,
        toolCallCount,
        modelIdsSeen: [...modelIdsSeen],
      });
    } catch {
      summaries.push({
        sessionId: path.basename(sessionDir),
        sessionDir,
        peakTotalTokens,
        finalTotalTokens,
        promptCount: promptIds.size,
        turnCount,
        toolCallCount,
        modelIdsSeen: [...modelIdsSeen],
      });
    }
  }
  return summaries;
}

function fetchCcusageByAgent(agentFilter: string, jsonCommand: string[]): CcusageAgentSummary {
  const spawn = spawnSync("pnpm", ["dlx", "ccusage", ...jsonCommand], {
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (spawn.status !== 0) {
    return {
      available: false,
      agent: agentFilter,
      sessionCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      topModels: [],
      note: `ccusage ${jsonCommand.join(" ")} failed or unavailable`,
    };
  }
  try {
    const parsed = JSON.parse(spawn.stdout) as {
      session?: Array<{
        agent?: string;
        totalTokens?: number;
        totalCost?: number;
        modelsUsed?: string[];
      }>;
    };
    const sessions = (parsed.session ?? []).filter((row) => row.agent === agentFilter);
    const totalTokens = sessions.reduce((sum, row) => sum + (row.totalTokens ?? 0), 0);
    const totalCostUsd = sessions.reduce((sum, row) => sum + (row.totalCost ?? 0), 0);
    const topModels = [...new Set(sessions.flatMap((row) => row.modelsUsed ?? []))].slice(0, 5);
    return {
      available: true,
      agent: agentFilter,
      sessionCount: sessions.length,
      totalTokens,
      totalCostUsd,
      topModels,
      note:
        agentFilter === "codex"
          ? "Codex cross-check via ccusage; Grok/Composer peaks come from ~/.grok/sessions updates.jsonl"
          : "OpenClaw usage via ccusage openclaw session",
    };
  } catch (error) {
    return {
      available: false,
      agent: agentFilter,
      sessionCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      topModels: [],
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

async function iterationGrokInspect(): Promise<Record<string, unknown>> {
  const spawn = spawnSync("grok", ["inspect", "--json"], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 });
  if (spawn.status !== 0) {
    return {
      skipped: true,
      reason: spawn.stderr?.trim() || spawn.stdout?.trim() || "grok inspect unavailable",
    };
  }
  const parsed = JSON.parse(spawn.stdout) as Record<string, unknown>;
  const rules = Array.isArray(parsed.rules) ? parsed.rules.length : 0;
  const subagents = parsed.subagents ?? null;
  return { rules, subagents, inspect: "ok" };
}

async function iterationOrchestrationWorkflow(): Promise<Record<string, unknown>> {
  const consult = await readFileAsync(path.join(repoRoot, "agents", "rules", "agent-consult.md"), "utf8");
  const subagent = await readFileAsync(path.join(repoRoot, "agents", "rules", "subagent-protocol.md"), "utf8");
  if (!consult.includes("Grok Composer entrypoint")) {
    throw new Error("agent-consult.md missing Grok Composer entrypoint");
  }
  if (!subagent.includes("coordinator/orchestration first")) {
    throw new Error("subagent-protocol.md missing coordinator-first rule");
  }
  const scoutRoles = ["chief-coordinator", "openclaw-drift-police", "implementation-plan-gap-attacker"];
  const scoutModels = scoutRoles.map((roleId) => ({
    roleId,
    model: getRepoRoleHarnessPolicy(roleId)?.policyTier
      ? resolveHarnessModelSpec(getRepoRoleHarnessPolicy(roleId)!.policyTier, "grok").model
      : "missing",
  }));
  if (!scoutModels.every((row) => row.model === "deepseek-v4-flash")) {
    throw new Error(`Scout roles should map to deepseek-v4-flash on Grok: ${JSON.stringify(scoutModels)}`);
  }
  return { scoutModels, orchestrationDocumented: true };
}

async function iterationAlignmentGuards(): Promise<Record<string, unknown>> {
  const alignment = spawnSync("pnpm", ["agent:alignment"], { cwd: repoRoot, encoding: "utf8" });
  if (alignment.status !== 0) {
    throw new Error(`agent:alignment failed: ${alignment.stderr || alignment.stdout}`);
  }
  return { alignment: "passed" };
}

async function iterationTokenEfficiencyEstimate(): Promise<Record<string, unknown>> {
  const agentsMd = await readFileAsync(path.join(repoRoot, "AGENTS.md"), "utf8");
  const snapshots = await Promise.all([
    readFileAsync(path.join(repoRoot, "PROJECT_COORDINATION_INDEX.md"), "utf8"),
    readFileAsync(path.join(repoRoot, "AUTONOMOUS_WORK_PLAN.md"), "utf8"),
    readFileAsync(path.join(repoRoot, "docs", "openclinxr", "worker-backlog-and-validation-matrix.md"), "utf8"),
  ]);
  const snapshotBytes = snapshots.reduce((sum, text) => sum + text.split("\n").slice(0, 80).join("\n").length, 0);
  const fullAgentsBytes = agentsMd.length;
  const ratio = Number((1 - snapshotBytes / Math.max(fullAgentsBytes + snapshotBytes, 1)).toFixed(3));
  const exploreModel = resolveHarnessModelSpec("fast_bounded", "grok").model;
  const composerModel = resolveHarnessModelSpec("frontier_thinking", "grok").model;
  return {
    snapshotRehydrateBytes: snapshotBytes,
    fullAgentsMdBytes: fullAgentsBytes,
    estimatedContextSavingRatio: ratio,
    exploreSubagentModel: exploreModel,
    composerModelTier: composerModel,
  };
}

async function runProofSuite(quick: boolean): Promise<{ iterations: ProofIteration[]; durationMs: number }> {
  const started = Date.now();
  const iterations: ProofIteration[] = [];

  iterations.push(await runIteration("01", "composer-config-hints", iterationConfigComposerHints));
  iterations.push(await runIteration("02", "role-policy-matrix", iterationRolePolicyMatrix));
  iterations.push(await runIteration("03", "codex-toml-sync", iterationCodexTomlSync));
  iterations.push(await runIteration("04", "agent-loop-tests", iterationAgentLoopTests));
  iterations.push(await runIteration("05", "memory-append", iterationMemoryAppendDry));
  iterations.push(await runIteration("06", "orchestration-workflow", iterationOrchestrationWorkflow));

  if (!quick) {
    iterations.push(await runIteration("07", "grok-inspect", iterationGrokInspect));
    iterations.push(await runIteration("08", "token-efficiency-estimate", iterationTokenEfficiencyEstimate));
    iterations.push(await runIteration("09", "alignment-guards", iterationAlignmentGuards));
  }

  return { iterations, durationMs: Date.now() - started };
}

async function main(): Promise<void> {
  const { quick, runs, outputPath } = parseArgs(process.argv.slice(2));
  const runSummaries: ProofRunSummary[] = [];
  let iterations: ProofIteration[] = [];

  for (let run = 1; run <= runs; run += 1) {
    const suite = await runProofSuite(quick);
    iterations = suite.iterations;
    const failedIterationIds = suite.iterations.filter((row) => !row.passed).map((row) => row.id);
    runSummaries.push({
      run,
      passed: failedIterationIds.length === 0,
      failedIterationIds,
      durationMs: suite.durationMs,
    });
    if (failedIterationIds.length > 0) {
      break;
    }
  }

  const grokSessions = quick ? [] : await parseGrokSessionTokens(5);
  const ccusageCodex = quick
    ? {
        available: false,
        agent: "codex",
        sessionCount: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        topModels: [],
        note: "skipped in --quick",
      }
    : fetchCcusageByAgent("codex", ["session", "--json"]);
  const ccusageOpenclaw = quick
    ? {
        available: false,
        agent: "openclaw",
        sessionCount: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        topModels: [],
        note: "skipped in --quick",
      }
    : fetchCcusageByAgent("openclaw", ["openclaw", "session", "--json"]);
  const tokenIteration = iterations.find((row) => row.id === "08");
  const tokenDetails = (tokenIteration?.details ?? {}) as Record<string, number | string>;
  const grokPeak = grokSessions.reduce((max, row) => Math.max(max, row.peakTotalTokens), 0);
  const peakByModelMap = new Map<string, { peak: number; count: number }>();
  for (const session of grokSessions) {
    const modelId = session.currentModelId ?? session.modelIdsSeen[0] ?? "unknown";
    const existing = peakByModelMap.get(modelId) ?? { peak: 0, count: 0 };
    existing.peak = Math.max(existing.peak, session.peakTotalTokens);
    existing.count += 1;
    peakByModelMap.set(modelId, existing);
  }
  const grokPeakByModel = [...peakByModelMap.entries()]
    .map(([modelId, stats]) => ({
      modelId,
      peakTotalTokens: stats.peak,
      sessionCount: stats.count,
    }))
    .sort((a, b) => b.peakTotalTokens - a.peakTotalTokens);
  const scoutPeak = grokPeakByModel
    .filter((row) => row.modelId.includes("deepseek") || row.modelId.includes("flash"))
    .reduce((max, row) => Math.max(max, row.peakTotalTokens), 0);
  const frontierPeak = grokPeakByModel
    .filter((row) => row.modelId.includes("grok-build") || row.modelId.includes("composer"))
    .reduce((max, row) => Math.max(max, row.peakTotalTokens), 0);
  const scoutVsFrontierPeakRatio =
    scoutPeak > 0 && frontierPeak > 0 ? Number((frontierPeak / scoutPeak).toFixed(2)) : null;
  const snapshotBytes = Number(tokenDetails.snapshotRehydrateBytes ?? 0);
  const hypotheticalExploreSavingsNote =
    snapshotBytes > 0
      ? `Snapshot rehydrate (~${snapshotBytes} chars) fits a scout consult; routing that read to explore+deepseek-v4-flash keeps Composer peak lower than monolithic coordinator reads in-session (current workspace peak ${grokPeak} tokens).`
      : "Run full proof (without --quick) for Grok peak + snapshot sizing.";

  const report: HarnessProofReport = {
    schemaVersion: "openclinxr.grok-harness-proof.v1",
    generatedAt: new Date().toISOString(),
    quick,
    runs,
    runSummaries,
    iterations,
    passed: runSummaries.every((row) => row.passed),
    grokSessions,
    ccusageCodex,
    ccusageOpenclaw,
    tokenEfficiency: {
      snapshotRehydrateBytes: snapshotBytes,
      fullAgentsMdBytes: Number(tokenDetails.fullAgentsMdBytes ?? 0),
      estimatedContextSavingRatio: Number(tokenDetails.estimatedContextSavingRatio ?? 0),
      exploreSubagentModel: String(tokenDetails.exploreSubagentModel ?? "deepseek-v4-flash"),
      composerModelTier: String(tokenDetails.composerModelTier ?? "grok-build"),
      composerOrchestrationDocumented: iterations.find((row) => row.id === "01")?.passed ?? false,
      grokPeakTokensCurrentWorkspace: grokPeak,
      grokPeakByModel,
      scoutVsFrontierPeakRatio,
      hypotheticalExploreSavingsNote:
        scoutVsFrontierPeakRatio !== null
          ? `Observed Grok workspace peaks: frontier/composer up to ${frontierPeak} tokens vs DeepSeek scout sessions ~${scoutPeak} tokens (${scoutVsFrontierPeakRatio}x). Delegate read-only coordinator consults to explore+deepseek-v4-flash; keep Composer for integration.`
          : hypotheticalExploreSavingsNote,
    },
    recommendations: [
      "Keep Composer context lean; delegate coordinator/drift reads to explore+deepseek-v4-flash.",
      "Track Grok peaks via pnpm agent:harness:prove; use ccusage session (Codex) + openclaw session for cross-harness cost.",
      `Re-run with --runs=5 after policy changes; latest pass rate ${runSummaries.filter((r) => r.passed).length}/${runSummaries.length}.`,
    ],
  };

  await writeFileAsync(path.join(repoRoot, outputPath), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Wrote ${outputPath} passed=${report.passed} iterations=${iterations.length} runs=${runSummaries.length} grokPeak=${grokPeak}`,
  );
  if (!report.passed) {
    const failed = iterations.filter((row) => !row.passed).map((row) => row.id).join(", ");
    process.exitCode = 1;
    console.error(`Failed iterations: ${failed}`);
  }
}

await main();