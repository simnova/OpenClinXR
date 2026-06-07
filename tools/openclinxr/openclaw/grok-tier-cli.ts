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
    | "post-slice";
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
  const report = buildGrokSliceTokenIntrospectionReport({
    sliceId,
    declaredTier,
    baseline,
    currentCcusage: await fetchCcusageDailySnapshot(),
    currentGrokSessions: parseGrokSessionTokens(),
  });
  const outputPath = path.join(repoRoot, args.outputPath === DEFAULT_INTROSPECTION_PATH ? DEFAULT_SLICE_TOKEN_REPORT_PATH : args.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  await appendSliceTokenHistory(repoRoot, JSON.stringify({
    generatedAt: report.generatedAt,
    sliceId: report.sliceId,
    posture: report.posture,
    stateRecordLine: report.stateRecordLine,
  }));
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatGrokSliceTokenBrief(report));
    console.log(`\nWrote ${path.relative(repoRoot, outputPath)}`);
    console.log(`Ledger line: ${report.stateRecordLine}`);
  }
  if (report.posture === "violation") process.exitCode = 1;
  if (report.posture === "drift") process.exitCode = 2;
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