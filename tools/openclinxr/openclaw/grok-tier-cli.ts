import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  buildGrokSliceTokenIntrospectionReport,
  formatGrokSliceTokenBrief,
} from "../../../packages/openclinxr/agent-loop/src/grok-token-introspection.js";
import {
  GROK_TIER_PACKAGE_SCRIPTS,
  buildGrokTierIntrospectionReport,
  buildGrokTierWorkOrder,
  evaluateGrokDelegationAdvice,
  evaluateGrokTierUpgrade,
  formatGrokTierIntrospectionBrief,
  parseGrokTierId,
  recommendGrokStartTier,
  validateGrokHarnessTierConfig,
  type GrokDelegationIntent,
  type GrokTierId,
} from "../../../packages/openclinxr/agent-loop/src/grok-tier-routing.js";
import {
  DEFAULT_SLICE_BASELINE_PATH,
  DEFAULT_SLICE_TOKEN_REPORT_PATH,
  appendSliceTokenHistory,
  captureSliceTokenBaseline,
  fetchCcusageDailySnapshot,
  parseGrokSessionTokens,
  parseGrokSubagentCompletions,
  readSliceTokenBaseline,
} from "./grok-token-io.js";

const repoRoot = process.cwd();
const DEFAULT_INTROSPECTION_PATH = ".openclinxr/openclaw/grok-tier-introspection-latest.json";
const DEFAULT_WORK_ORDER_PATH = ".openclinxr/openclaw/grok-tier-work-order-latest.json";

type CliArgs = {
  command:
    | "introspect"
    | "work-order"
    | "check"
    | "brief"
    | "advise"
    | "upgrade"
    | "slice-start"
    | "slice-introspect"
    | "post-slice"
    | "task-cost";
  outputPath: string;
  sliceId: string;
  sliceSummary: string;
  scoutQuestion: string;
  planQuestion?: string;
  executionScope?: string;
  intent: GrokDelegationIntent;
  currentTier: GrokTierId;
  scoutOutput?: string;
  verificationFailures: number;
  evidenceOnlyStreak: number;
  touchesProtectedClaims: boolean;
  fromBaseline: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const command = (positional[0] ?? "introspect") as CliArgs["command"];
  let outputPath = command === "work-order" ? DEFAULT_WORK_ORDER_PATH : DEFAULT_INTROSPECTION_PATH;
  let sliceId = "unspecified-slice";
  let sliceSummary = "Unspecified slice";
  let scoutQuestion = "What is the smallest next product slice and which files own it?";
  let planQuestion: string | undefined;
  let executionScope: string | undefined;
  let intent: GrokDelegationIntent = "scout";
  let currentTier: GrokTierId = "tier1_deepseek_flash_scout";
  let scoutOutput: string | undefined;
  let verificationFailures = 0;
  let evidenceOnlyStreak = 0;
  let touchesProtectedClaims = false;
  let fromBaseline = false;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    if (arg === "--output" && argv[i + 1]) outputPath = argv[++i];
    if (arg === "--slice-id" && argv[i + 1]) sliceId = argv[++i];
    if (arg === "--slice-summary" && argv[i + 1]) sliceSummary = argv[++i];
    if (arg === "--scout-question" && argv[i + 1]) scoutQuestion = argv[++i];
    if (arg === "--plan-question" && argv[i + 1]) planQuestion = argv[++i];
    if (arg === "--execution-scope" && argv[i + 1]) executionScope = argv[++i];
    if (arg === "--intent" && argv[i + 1]) intent = argv[++i] as GrokDelegationIntent;
    if (arg === "--current-tier" && argv[i + 1]) currentTier = parseGrokTierId(argv[++i]);
    if (arg === "--scout-output" && argv[i + 1]) scoutOutput = argv[++i];
    if (arg === "--verification-failures" && argv[i + 1]) verificationFailures = Number(argv[++i]) || 0;
    if (arg === "--evidence-only-streak" && argv[i + 1]) evidenceOnlyStreak = Number(argv[++i]) || 0;
    if (arg === "--touches-protected-claims") touchesProtectedClaims = true;
    if (arg === "--from-baseline") fromBaseline = true;
  }

  return {
    command,
    outputPath,
    sliceId,
    sliceSummary,
    scoutQuestion,
    planQuestion,
    executionScope,
    intent,
    currentTier,
    scoutOutput,
    verificationFailures,
    evidenceOnlyStreak,
    touchesProtectedClaims,
    fromBaseline,
    json,
  };
}

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

async function packageScriptsPresent(): Promise<boolean> {
  const pkg = JSON.parse(await readRepoFile("package.json")) as { scripts?: Record<string, string> };
  return GROK_TIER_PACKAGE_SCRIPTS.every((script) => typeof pkg.scripts?.[script] === "string");
}

async function runIntrospect(args: CliArgs): Promise<void> {
  const [configToml, rulePresent] = await Promise.all([
    readRepoFile(".grok/config.toml"),
    readRepoFile("agents/rules/grok-tier-routing.md").then(() => true).catch(() => false),
  ]);
  const report = buildGrokTierIntrospectionReport({
    configToml,
    ruleFilePresent: rulePresent,
    packageScriptsPresent: await packageScriptsPresent(),
  });
  await mkdir(path.dirname(path.join(repoRoot, args.outputPath)), { recursive: true });
  await writeFile(path.join(repoRoot, args.outputPath), `${JSON.stringify(report, null, 2)}\n`);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatGrokTierIntrospectionBrief(report));
  console.log(`\nWrote ${args.outputPath}`);
  if (report.posture !== "aligned") {
    process.exitCode = 1;
  }
}

async function runCheck(): Promise<void> {
  const configToml = await readRepoFile(".grok/config.toml");
  const result = validateGrokHarnessTierConfig(configToml);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

async function runBrief(): Promise<void> {
  const configToml = await readRepoFile(".grok/config.toml");
  const report = buildGrokTierIntrospectionReport({
    configToml,
    ruleFilePresent: true,
    packageScriptsPresent: await packageScriptsPresent(),
  });
  console.log(formatGrokTierIntrospectionBrief(report));
}

async function runWorkOrder(args: CliArgs): Promise<void> {
  const startTier = recommendGrokStartTier({ taskKind: "scout" });
  const order = buildGrokTierWorkOrder({
    sliceId: args.sliceId,
    sliceSummary: args.sliceSummary,
    scoutQuestion: args.scoutQuestion,
    planQuestion: args.planQuestion,
    executionScope: args.executionScope,
    startTier,
  });
  await mkdir(path.dirname(path.join(repoRoot, args.outputPath)), { recursive: true });
  await writeFile(path.join(repoRoot, args.outputPath), `${JSON.stringify(order, null, 2)}\n`);
  if (args.json) {
    console.log(JSON.stringify(order, null, 2));
    return;
  }
  console.log(`Work order: ${order.sliceId}`);
  console.log(`Start tier: ${order.recommendedStartTier}`);
  console.log(`Scout prompt: ${order.scoutPrompt}`);
  console.log(`Wrote ${args.outputPath}`);
}

async function runAdvise(args: CliArgs): Promise<void> {
  const advice = evaluateGrokDelegationAdvice({ intent: args.intent });
  console.log(JSON.stringify(advice, null, 2));
}

async function runUpgrade(args: CliArgs): Promise<void> {
  const evaluation = evaluateGrokTierUpgrade({
    currentTier: args.currentTier,
    scoutOutput: args.scoutOutput,
    verificationFailures: args.verificationFailures,
    evidenceOnlyStreak: args.evidenceOnlyStreak,
    touchesProtectedClaims: args.touchesProtectedClaims,
  });
  console.log(JSON.stringify(evaluation, null, 2));
  if (evaluation.shouldUpgrade) process.exitCode = 2;
}

async function runSliceStart(args: CliArgs): Promise<void> {
  const baseline = await captureSliceTokenBaseline({
    repoRoot,
    sliceId: args.sliceId,
    declaredTier: args.currentTier,
    outputPath: args.outputPath === DEFAULT_INTROSPECTION_PATH ? DEFAULT_SLICE_BASELINE_PATH : args.outputPath,
  });
  if (args.json) {
    console.log(JSON.stringify(baseline, null, 2));
    return;
  }
  console.log(`Captured slice token baseline for ${baseline.sliceId} (${baseline.declaredTier})`);
  console.log(`ccusage ${baseline.ccusageDaily.period}: ${baseline.ccusageDaily.totalTokens} tokens`);
  console.log(`Grok workspace peak: ${baseline.grokWorkspace.maxPeakTotalTokens}`);
  console.log(`Wrote ${DEFAULT_SLICE_BASELINE_PATH}`);
}

async function runSliceIntrospect(args: CliArgs): Promise<void> {
  const baseline = args.fromBaseline ? await readSliceTokenBaseline(repoRoot) : null;
  const sliceId = baseline?.sliceId ?? args.sliceId;
  const declaredTier = baseline?.declaredTier ?? args.currentTier;
  const subagentCompletions = parseGrokSubagentCompletions();
  const sessions = parseGrokSessionTokens();
  const report = buildGrokSliceTokenIntrospectionReport({
    sliceId,
    declaredTier,
    baseline,
    currentCcusage: await fetchCcusageDailySnapshot(),
    currentGrokSessions: sessions,
    subagentCompletions,
  });
  const outputPath = path.join(repoRoot, args.outputPath === DEFAULT_INTROSPECTION_PATH ? DEFAULT_SLICE_TOKEN_REPORT_PATH : args.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  // Also write subagent completion snapshot for debugging native token path
  await writeFile(
    path.join(repoRoot, ".openclinxr/openclaw/grok-subagent-tokens-latest.json"),
    `${JSON.stringify({ generatedAt: report.generatedAt, count: subagentCompletions.length, items: subagentCompletions.slice(0, 40) }, null, 2)}\n`,
  );

  // Task cost rollup (subagent+model breakdown + total)
  const { buildTaskCostRollup } = await import("../../../packages/openclinxr/agent-loop/src/task-cost-rollup.js");
  const parentPeak = report.grok.current.maxPeakTotalTokens;
  const baselinePeak = report.grok.baseline.maxPeakTotalTokens;
  const parentDelta = Math.max(0, parentPeak - baselinePeak);
  const parentModel =
    sessions[0]?.modelIdsSeen.find((m) => m.includes("grok")) ?? sessions[0]?.modelIdsSeen[0] ?? "grok-4.5";
  const costRollup = buildTaskCostRollup({
    taskId: sliceId,
    subagents: subagentCompletions,
    sinceIso: baseline?.capturedAt ?? null,
    untilIso: report.generatedAt,
    parentTokens: parentDelta,
    parentModelId: parentModel,
    generatedAt: report.generatedAt,
  });
  const costPath = path.join(repoRoot, ".openclinxr/openclaw/task-cost-latest.json");
  await writeFile(costPath, `${JSON.stringify(costRollup, null, 2)}\n`);
  const costMdPath = path.join(repoRoot, ".openclinxr/openclaw/task-cost-latest.md");
  await writeFile(
    costMdPath,
    [
      `# Task cost rollup — \`${sliceId}\``,
      ``,
      `Generated: ${costRollup.generatedAt}`,
      ``,
      costRollup.disclaimer,
      ``,
      `**${costRollup.costRecordLine}**`,
      ``,
      costRollup.markdownTable,
      ``,
      `Estimate method: ${costRollup.estimateMethod}`,
      `Window: since=${costRollup.window.sinceIso ?? "null"} until=${costRollup.window.untilIso}`,
      ``,
      `See docs/agent-ops/TASK-COST-ROLLUP.md`,
      ``,
    ].join("\n"),
  );
  await appendSliceTokenHistory(
    repoRoot,
    JSON.stringify({
      generatedAt: report.generatedAt,
      sliceId: report.sliceId,
      posture: report.posture,
      stateRecordLine: report.stateRecordLine,
      costRecordLine: costRollup.costRecordLine,
      grandEstimatedUsd: costRollup.totals.grandEstimatedUsd,
      subagentCount: subagentCompletions.length,
    }),
  );
  if (args.json) {
    console.log(JSON.stringify({ token: report, cost: costRollup }, null, 2));
  } else {
    console.log(formatGrokSliceTokenBrief(report));
    console.log(
      `Subagent completions with tokens: ${subagentCompletions.filter((s) => s.peakTotalTokens > 0).length}/${subagentCompletions.length}`,
    );
    console.log(costRollup.costRecordLine);
    console.log(`\nWrote ${path.relative(repoRoot, outputPath)}`);
    console.log(`Wrote ${path.relative(repoRoot, costPath)}`);
    console.log(`Wrote ${path.relative(repoRoot, costMdPath)}`);
    console.log(`Ledger line: ${report.stateRecordLine}`);
    console.log(`Cost line: ${costRollup.costRecordLine}`);
  }
  if (report.posture === "violation") process.exitCode = 1;
  if (report.posture === "drift") process.exitCode = 2;
}

async function runTaskCost(args: CliArgs): Promise<void> {
  const { buildTaskCostRollup } = await import("../../../packages/openclinxr/agent-loop/src/task-cost-rollup.js");
  const baseline = args.fromBaseline ? await readSliceTokenBaseline(repoRoot) : null;
  const subagentCompletions = parseGrokSubagentCompletions(12);
  const sessions = parseGrokSessionTokens();
  const parentModel =
    sessions[0]?.modelIdsSeen.find((m) => m.includes("grok")) ?? sessions[0]?.modelIdsSeen[0] ?? "grok-4.5";
  const rollup = buildTaskCostRollup({
    taskId: baseline?.sliceId ?? args.sliceId ?? "ad-hoc",
    subagents: subagentCompletions,
    // without --from-baseline, include all discovered completions (ad-hoc full rollup)
    sinceIso: args.fromBaseline ? baseline?.capturedAt ?? null : null,
    parentTokens: args.fromBaseline
      ? Math.max(
          0,
          (sessions[0]?.peakTotalTokens ?? 0) - (baseline?.grokWorkspace.maxPeakTotalTokens ?? 0),
        )
      : 0,
    parentModelId: parentModel,
  });
  const costPath = path.join(repoRoot, ".openclinxr/openclaw/task-cost-latest.json");
  const costMdPath = path.join(repoRoot, ".openclinxr/openclaw/task-cost-latest.md");
  await mkdir(path.dirname(costPath), { recursive: true });
  await writeFile(costPath, `${JSON.stringify(rollup, null, 2)}\n`);
  await writeFile(
    costMdPath,
    [
      `# Task cost rollup — \`${rollup.taskId}\``,
      ``,
      rollup.disclaimer,
      ``,
      `**${rollup.costRecordLine}**`,
      ``,
      rollup.markdownTable,
      ``,
      `See docs/agent-ops/TASK-COST-ROLLUP.md`,
      ``,
    ].join("\n"),
  );
  if (args.json) console.log(JSON.stringify(rollup, null, 2));
  else {
    console.log(rollup.costRecordLine);
    console.log(rollup.markdownTable);
    console.log(`\nWrote ${costPath}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "check":
      await runCheck();
      break;
    case "brief":
      await runBrief();
      break;
    case "work-order":
      await runWorkOrder(args);
      break;
    case "advise":
      await runAdvise(args);
      break;
    case "upgrade":
      await runUpgrade(args);
      break;
    case "task-cost":
      await runTaskCost(args);
      break;
    case "slice-start":
      await runSliceStart(args);
      break;
    case "slice-introspect":
    case "post-slice":
      await runSliceIntrospect({ ...args, fromBaseline: args.fromBaseline || args.command === "post-slice" });
      break;
    case "introspect":
    default:
      await runIntrospect(args);
      break;
  }
}

await main();