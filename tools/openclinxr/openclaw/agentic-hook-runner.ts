import { execFileSync, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

type HookProfile = "pre-commit" | "pre-push" | "strict" | "local-exam";

type HookStep = {
  label: string;
  command: string[];
  reason: string;
};

type HookRunResult = {
  step: HookStep;
  status: number | null;
  elapsedMs: number;
};

const hookProfiles = new Set<HookProfile>(["pre-commit", "pre-push", "strict", "local-exam"]);

function cliOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function normalizeProfile(args: string[]): HookProfile {
  const rawProfile = cliOption(args, "--profile") ?? args[0] ?? "pre-commit";
  if (!hookProfiles.has(rawProfile as HookProfile)) {
    throw new Error(`Unknown OpenClaw hook profile '${rawProfile}'. Expected one of: ${[...hookProfiles].join(", ")}.`);
  }
  return rawProfile as HookProfile;
}

function runGit(args: string[]): string[] {
  try {
    return execFileSync("git", args, { encoding: "utf8" })
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function changedFilesForProfile(profile: HookProfile): string[] {
  if (profile === "pre-commit") {
    const staged = runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"]);
    return staged.length > 0 ? staged : runGit(["diff", "--name-only", "--diff-filter=ACMRTUXB"]);
  }

  if (profile === "pre-push") {
    const upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])[0];
    if (upstream) {
      return runGit(["diff", "--name-only", "--diff-filter=ACMRTUXB", `${upstream}...HEAD`]);
    }
    return runGit(["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD"]);
  }

  return [];
}

function matchesAnyPath(files: string[], patterns: RegExp[]): boolean {
  return files.some((file) => patterns.some((pattern) => pattern.test(file)));
}

function pnpm(script: string): string[] {
  return ["pnpm", script];
}

function buildBaseOpenClawSteps(): HookStep[] {
  return [
    {
      label: "OpenClaw drift check",
      command: pnpm("docs:drift-check"),
      reason: "protected guardrails, registries, and generated artifact posture stay aligned",
    },
    {
      label: "Agent coordination alignment",
      command: pnpm("agent:alignment"),
      reason: "canonical state files remain coherent for repo-native agents",
    },
    {
      label: "Architecture fitness rules",
      command: pnpm("architecture"),
      reason: "production app, factory, asset commons, and capability arena boundaries stay enforced",
    },
    {
      label: "OpenClaw post-slice record check",
      command: pnpm("openclaw:post-slice"),
      reason: "required per-slice markers remain discoverable for agentic continuation",
    },
  ];
}

function buildPathAwareSteps(profile: HookProfile, changedFiles: string[]): HookStep[] {
  const publicAssetChanged = matchesAnyPath(changedFiles, [
    /^README\.md$/u,
    /^docs\/(?:index\.html|styles\.css|assets\/)/u,
    /^\.github\/workflows\/pages\.yml$/u,
  ]);
  const productCodeChanged = matchesAnyPath(changedFiles, [
    /^apps\//u,
    /^packages\//u,
    /^tools\/openclinxr\/(?:factory|openclaw|evidence)\//u,
    /^package\.json$/u,
    /^turbo\.json$/u,
  ]);

  const steps: HookStep[] = [];

  if (publicAssetChanged || process.env.OPENCLINXR_HOOK_PUBLIC_ASSETS === "1") {
    steps.push({
      label: "Public site validation",
      command: pnpm("pages:validate"),
      reason: "public README/site links, source posture, and snapshot markers remain valid",
    });
  }

  if (profile === "pre-push" && productCodeChanged) {
    steps.push({
      label: "Affected package tests",
      command: pnpm("packages:test:affected"),
      reason: "code changes get a Turbo-scoped test pass before leaving the machine",
    });
  }

  if (process.env.OPENCLINXR_HOOK_AFFECTED === "1" && productCodeChanged) {
    steps.push({
      label: "Affected package tests (opt-in pre-commit)",
      command: pnpm("packages:test:affected"),
      reason: "OPENCLINXR_HOOK_AFFECTED=1 requested a stronger local gate",
    });
  }

  if (process.env.OPENCLINXR_HOOK_TYPECHECK_AFFECTED === "1" && productCodeChanged) {
    steps.push({
      label: "Affected package typecheck (opt-in)",
      command: pnpm("packages:typecheck:affected"),
      reason: "OPENCLINXR_HOOK_TYPECHECK_AFFECTED=1 requested stricter typing feedback",
    });
  }

  return steps;
}

function stepsForProfile(profile: HookProfile): HookStep[] {
  if (profile === "local-exam") {
    return [
      {
        label: "Local exam deterministic smoke",
        command: pnpm("local:exam:smoke"),
        reason: "ED chest-pain fixture runs with deterministic providers and review-packet trace assertions",
      },
    ];
  }

  if (profile === "strict") {
    return [
      ...buildBaseOpenClawSteps(),
      {
        label: "Full typecheck",
        command: pnpm("typecheck"),
        reason: "release branches and broad merges should repair or acknowledge the full TypeScript baseline",
      },
      { label: "Security audit", command: pnpm("security:audit"), reason: "high severity dependency audit remains visible" },
      {
        label: "Security audit policy",
        command: pnpm("security:audit-policy"),
        reason: "audit results stay inside the repo policy boundary",
      },
      { label: "License policy", command: pnpm("security:licenses"), reason: "dependency licenses stay inside approved boundaries" },
      { label: "Knip hygiene", command: pnpm("hygiene:knip"), reason: "unused exports/dependencies stay visible without blocking fast commits" },
      { label: "Biome hygiene", command: pnpm("hygiene:biome"), reason: "format/lint hygiene for release-level review" },
      { label: "E18e hygiene", command: pnpm("hygiene:e18e:analyze"), reason: "dependency hygiene analyzer for broad merge review" },
    ];
  }

  const changedFiles = changedFilesForProfile(profile);
  return [...buildBaseOpenClawSteps(), ...buildPathAwareSteps(profile, changedFiles)];
}

function formatCommand(command: string[]): string {
  return command.join(" ");
}

function runStep(step: HookStep, index: number, total: number): HookRunResult {
  const startedAt = performance.now();
  console.log(`\n[${index}/${total}] ${step.label}`);
  console.log(`reason: ${step.reason}`);
  console.log(`cmd: ${formatCommand(step.command)}`);

  const [command, ...args] = step.command;
  if (!command) {
    throw new Error(`Hook step '${step.label}' has no command.`);
  }

  const result = spawnSync(command, args, { stdio: "inherit" });
  const elapsedMs = performance.now() - startedAt;
  return { step, status: result.status, elapsedMs };
}

function printSummary(profile: HookProfile, results: HookRunResult[]): void {
  const failed = results.filter((result) => result.status !== 0);
  console.log(`\nOpenClaw hook profile '${profile}' finished ${failed.length === 0 ? "green" : "red"}.`);
  for (const result of results) {
    const seconds = (result.elapsedMs / 1000).toFixed(1);
    const status = result.status === 0 ? "ok" : `failed:${result.status ?? "signal"}`;
    console.log(`- ${status} ${result.step.label} (${seconds}s)`);
  }

  if (failed.length > 0) {
    console.error("\nFailed hook step(s):");
    for (const result of failed) {
      console.error(`- ${result.step.label}: rerun '${formatCommand(result.step.command)}'`);
    }
  }
}

export async function runAgenticHookProfile(profile: HookProfile): Promise<number> {
  const steps = stepsForProfile(profile);
  const results: HookRunResult[] = [];

  console.log(`OpenClaw agentic hook runner: ${profile}`);
  console.log("Use OPENCLAW_SKIP_HOOKS=1 only for intentional emergency bypasses.");
  if (profile !== "strict") {
    console.log("Use OPENCLINXR_HOOK_TYPECHECK_AFFECTED=1 for affected typecheck while the full baseline is being repaired.");
  }

  for (const [index, step] of steps.entries()) {
    const result = runStep(step, index + 1, steps.length);
    results.push(result);
    if (result.status !== 0) {
      printSummary(profile, results);
      return result.status ?? 1;
    }
  }

  printSummary(profile, results);
  return 0;
}

async function main(): Promise<void> {
  const profile = normalizeProfile(process.argv.slice(2));
  process.exitCode = await runAgenticHookProfile(profile);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
