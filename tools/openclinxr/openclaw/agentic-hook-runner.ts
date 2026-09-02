import { execFileSync, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export type HookProfile = "pre-commit" | "pre-push" | "strict" | "local-exam";

export type HookStep = {
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

/**
 * Architecture suites that must always run full-repo when architecture is in the hook.
 * These rules are inherently global: freeze-list honesty, workspace-wide scanners, and
 * cross-package import / dependency boundaries cannot be limited to staged paths without
 * missing violations that only appear in the full graph.
 */
export const ARCHITECTURE_GLOBAL_SUITE_FILES = [
  "src/archunit-tests/file-size-budgets.test.ts",
  "src/archunit-tests/workspace-architecture.test.ts",
  "src/archunit-tests/decision-invariants.test.ts",
  "src/archunit-tests/tsconfig-conventions.test.ts",
] as const;

/**
 * Staged paths that can introduce architecture-rule violations.
 * Commits whose staged set is disjoint from these roots skip the architecture step
 * (path-scoped omit) — e.g. pure PROJECT_STATUS / operator-* coordination commits.
 */
export const ARCHITECTURE_RELEVANT_PATH_PATTERNS: RegExp[] = [
  /^apps\//u,
  /^packages\//u,
  /^tools\//u,
  /^schemas\//u,
  /^sources\//u,
  /^package\.json$/u,
  /^pnpm-lock\.yaml$/u,
  /^pnpm-workspace\.yaml$/u,
  /^turbo\.json$/u,
  /^tsconfig[^/]*\.json$/u,
  /^\.githooks\//u,
  /^\.agents\//u,
  /^\.codex\//u,
  /^\.grok\//u,
  /^plugins\//u,
  /^docs\/(?:openclinxr|madr)\//u,
  /^README\.md$/u,
  /^biome\.json$/u,
  /^vitest\.config\.ts$/u,
];

/**
 * Staged paths that force the full turbo `pnpm architecture` path (with ^typecheck).
 * Editing the rules package or monorepo topology is not safe to short-circuit.
 */
export const ARCHITECTURE_FORCE_FULL_PATH_PATTERNS: RegExp[] = [
  /^packages\/openclinxr\/architecture-rules\//u,
  /^package\.json$/u,
  /^pnpm-lock\.yaml$/u,
  /^pnpm-workspace\.yaml$/u,
  /^turbo\.json$/u,
  /^tsconfig[^/]*\.json$/u,
];

export type ArchitectureInvocationMode = "omit" | "path-scoped-global" | "full-turbo";

function cliOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function normalizeProfile(args: string[]): HookProfile {
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

export function changedFilesForProfile(profile: HookProfile): string[] {
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

/**
 * The true pre-commit staged set — WITHOUT the unstaged fallback that
 * `changedFilesForProfile` uses for invocation classification. The size gate scopes
 * to what THIS commit actually contains; an empty staged set must keep the sweep
 * global, never re-scope it to somebody else's uncommitted WIP (#361).
 */
export function stagedFilesForPreCommit(): string[] {
  return runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"]);
}

export function matchesAnyPath(files: string[], patterns: RegExp[]): boolean {
  return files.some((file) => patterns.some((pattern) => pattern.test(file)));
}

/** Staged files Biome's root config includes (apps/packages/tools + root json). */
const BIOME_STAGED_FILE = /^(?:apps|packages|tools)\/.+\.(?:ts|tsx|js|jsx|mts|cts|json|jsonc)$|^[^/]+\.jsonc?$|^biome\.json$/u;
const BIOME_STAGED_SKIP = /(?:^|\/)(?:dist|node_modules|generated)\//u;
const BIOME_STAGED_FILE_CAP = 200;

/**
 * Cellix gates `biome lint` on package prebuild. Pre-commit here lints the staged
 * files that biome.json already includes — not the full-tree `hygiene:biome` sweep.
 */
export function biomeStagedFiles(changedFiles: string[]): string[] {
  return changedFiles.filter((file) => BIOME_STAGED_FILE.test(file) && !BIOME_STAGED_SKIP.test(file));
}

const KNIP_RELEVANT_PATH = /^(?:apps|packages|tools)\//u;
const KNIP_MANIFEST_PATH =
  /^(?:knip\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|apps\/.+\/package\.json|packages\/.+\/package\.json)$/u;
const E18E_MANIFEST_PATH =
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|apps\/.+\/package\.json|packages\/.+\/package\.json)$/u;

/** Knip is whole-repo; skip coordination-only commits the way biome skips non-source paths. */
export function buildKnipStep(changedFiles: string[]): HookStep | null {
  if (!changedFiles.some((file) => KNIP_RELEVANT_PATH.test(file) || KNIP_MANIFEST_PATH.test(file))) {
    return null;
  }
  return {
    label: "Knip check",
    command: pnpm("hygiene:knip"),
    reason: "unused files, unlisted imports, and unused dependencies fail closed (unused exports stay advisory)",
  };
}

/** e18e packs the install graph; only run when a manifest/lockfile is in the staged set. */
export function buildE18eStep(changedFiles: string[]): HookStep | null {
  if (!changedFiles.some((file) => E18E_MANIFEST_PATH.test(file))) {
    return null;
  }
  return {
    label: "E18e analyze",
    command: pnpm("hygiene:e18e:analyze"),
    reason: "dependency-hygiene errors fail closed when package manifests or the lockfile change",
  };
}

export function buildBiomeStep(changedFiles: string[]): HookStep | null {
  const files = biomeStagedFiles(changedFiles);
  if (files.length === 0) return null;
  if (files.length > BIOME_STAGED_FILE_CAP) {
    return {
      label: "Biome check (affected packages)",
      command: pnpm("packages:lint:affected"),
      reason: `staged set has ${files.length} Biome files (>${BIOME_STAGED_FILE_CAP}); Turbo lint on affected packages`,
    };
  }
  return {
    label: "Biome check (staged)",
    command: ["pnpm", "exec", "biome", "lint", "--no-errors-on-unmatched", "--", ...files],
    reason: "Cellix-style lint gate: staged TS/JS/JSON under apps/packages/tools must pass biome lint",
  };
}

/**
 * Classify how pre-commit should invoke architecture for a staged file set.
 *
 * - omit: staged paths cannot introduce architecture violations (coordination-only, etc.)
 * - path-scoped-global: staged paths are product/tooling-relevant; run all global suites
 *   via direct package vitest (full-repo scanners still run — they are inherently global)
 * - full-turbo: staged paths touch architecture-rules or monorepo topology; use turbo
 *   `pnpm architecture` with the normal ^typecheck graph
 */
export function classifyArchitectureInvocation(
  profile: HookProfile,
  changedFiles: string[],
): ArchitectureInvocationMode {
  if (profile === "strict" || profile === "pre-push") {
    return "full-turbo";
  }
  if (profile === "local-exam") {
    return "omit";
  }

  // pre-commit
  if (changedFiles.length === 0) {
    // Unknown/empty change set: stay conservative.
    return "full-turbo";
  }
  if (!matchesAnyPath(changedFiles, ARCHITECTURE_RELEVANT_PATH_PATTERNS)) {
    return "omit";
  }
  if (matchesAnyPath(changedFiles, ARCHITECTURE_FORCE_FULL_PATH_PATTERNS)) {
    return "full-turbo";
  }
  return "path-scoped-global";
}

/**
 * Build the architecture fitness step (or null when path-scoped omit is safe).
 *
 * Path-scoped pre-commit still executes the full global suites (file-size freeze,
 * workspace-wide scanners, cross-package imports) — those cannot be limited to staged
 * paths without missing violations. The scope win is:
 * 1) omit architecture entirely when staged files cannot hit the rules, and
 * 2) invoke the suites directly (no turbo ^typecheck cascade) for ordinary product commits.
 */
export function buildArchitectureStep(profile: HookProfile, changedFiles: string[]): HookStep | null {
  if (profile === "local-exam") {
    return null;
  }

  const mode = classifyArchitectureInvocation(profile, changedFiles);

  if (mode === "omit") {
    return null;
  }

  if (mode === "full-turbo") {
    return {
      label: "Architecture fitness rules",
      command: pnpm("architecture"),
      reason:
        profile === "pre-commit"
          ? "staged paths touch architecture-rules or monorepo topology — full turbo architecture (global suites + ^typecheck)"
          : "production app, factory, asset commons, and capability arena boundaries stay enforced",
    };
  }

  // path-scoped-global: direct vitest of all inherently-global suites
  return {
    label: "Architecture fitness rules (path-scoped pre-commit)",
    command: [
      "pnpm",
      "--filter",
      "@openclinxr/architecture-rules",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.arch.config.ts",
      "--root",
      ".",
      ...ARCHITECTURE_GLOBAL_SUITE_FILES,
    ],
    reason:
      "staged paths are architecture-relevant; full-repo global suites (file-size freeze, workspace scanners, cross-package imports) via direct vitest (no turbo ^typecheck cascade)",
  };
}

function pnpm(script: string): string[] {
  return ["pnpm", script];
}

function buildBaseOpenClawSteps(profile: HookProfile, changedFiles: string[]): HookStep[] {
  const steps: HookStep[] = [
    // FIRST, and only fires for integrate lands (the wrapper's env marker or a wt/* merge parent),
    // so ordinary commits on main are untouched. Keying on "product paths staged" would demand a
    // report for every commit, which is how a gate gets disabled.
    //
    // Installed because the designed-but-uninstalled version was worth nothing: friction that is
    // never wired is ZERO friction, and calling it "high friction, not a boundary" was an honest
    // label used as grounds to defer installing it.
    {
      label: "Integrate gate (land path only)",
      command: pnpm("openclaw:integrate-gate"),
      reason: "a land must present a clean merge-kill report for the exact tree being committed",
    },
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
      /**
       * UNCONDITIONAL, and that is the point. On 2026-08-24 four commits improved a published
       * humanoid nothing loads, and every gate in this file passed all of them, because each
       * accepted a self-description of product relevance — a path, a declared factory step, an
       * attached proof. None consulted the consumer graph. This step IS the consumer graph.
       *
       * It is deliberately NOT path-scoped like the architecture step: the asset that caused this
       * was emitted as a SIDE EFFECT of a provenance slice, so a commit need not look asset-shaped
       * to publish an orphan.
       *
       * See docs/openclinxr/postmortem-anny-fixture-polish-2026-08-25.md.
       */
      {
        label: "Published humanoids are cast or declared",
        command: pnpm("assets:reachability"),
        reason: "a published humanoid must be reachable by the cast resolver or say what it is instead",
      },
  ];

  const architectureStep = buildArchitectureStep(profile, changedFiles);
  if (architectureStep) {
    steps.push(architectureStep);
  }

  steps.push({
    label: "OpenClaw post-slice record check",
    command: pnpm("openclaw:post-slice"),
    reason: "required per-slice markers remain discoverable for agentic continuation",
  });

  return steps;
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

  // Mirrors the architecture path-scoped rule: the suite that guards the delegation loop runs
  // when, and only when, a staged file lives in the directory it guards. Without this, a commit
  // touching the dispatcher/board/sweep/hook-runner itself never pays for the contracts that
  // guard them (measured 2026-08-24: three files red for 18, 5 and 2 days behind exactly this gap).
  const openclawCodeChanged = matchesAnyPath(changedFiles, [/^tools\/openclinxr\/openclaw\//u]);

  const steps: HookStep[] = [];

  const biomeStep = buildBiomeStep(changedFiles);
  if (biomeStep) {
    steps.push(biomeStep);
  }

  const knipStep = buildKnipStep(changedFiles);
  if (knipStep) {
    steps.push(knipStep);
  }

  if (profile === "pre-push") {
    const e18eStep = buildE18eStep(changedFiles);
    if (e18eStep) {
      steps.push(e18eStep);
    }
  }

  if (publicAssetChanged || process.env.OPENCLINXR_HOOK_PUBLIC_ASSETS === "1") {
    steps.push({
      label: "Public site validation",
      command: pnpm("pages:validate"),
      reason: "public README/site links, source posture, and snapshot markers remain valid",
    });
  }

  if (profile === "pre-commit" && openclawCodeChanged) {
    steps.push({
      label: "OpenClaw suite (openclaw code staged)",
      command: ["pnpm", "exec", "vitest", "run", "tools/openclinxr/openclaw/"],
      reason:
        "a staged file under tools/openclinxr/openclaw/ can break the delegation loop — the contracts guarding it must run",
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

export function stepsForProfile(profile: HookProfile, changedFiles?: string[]): HookStep[] {
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
      ...buildBaseOpenClawSteps(profile, changedFiles ?? []),
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
      { label: "Knip hygiene", command: pnpm("hygiene:knip"), reason: "unused files/dependencies fail closed; unused exports remain advisory via hygiene:knip:exports" },
      { label: "Biome hygiene", command: pnpm("hygiene:biome"), reason: "format/lint hygiene for release-level review" },
      { label: "E18e hygiene", command: pnpm("hygiene:e18e:analyze"), reason: "dependency hygiene analyzer for broad merge review" },
    ];
  }

  const files = changedFiles ?? changedFilesForProfile(profile);
  return [...buildBaseOpenClawSteps(profile, files), ...buildPathAwareSteps(profile, files)];
}

function formatCommand(command: string[]): string {
  return command.join(" ");
}

/**
 * Host-repo git fingerprint used around the OpenClaw suite step.
 * Captures HEAD, core.bare, and porcelain so a suite that stages deletions
 * or flips the checkout to bare refuses the commit instead of capturing it.
 */
export function snapshotGitState(cwd: string = process.cwd()): string {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    let bare = "unset";
    try {
      bare = execFileSync("git", ["config", "--get", "core.bare"], { cwd, encoding: "utf8" }).trim();
    } catch {
      bare = "unset";
    }
    const porcelain = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
    return `HEAD=${head}\nbare=${bare}\n${porcelain}`;
  } catch (error) {
    return `UNREADABLE:${error instanceof Error ? error.message : String(error)}`;
  }
}

export function assertRepoUnchanged(before: string, after: string): void {
  if (before === after) {
    return;
  }
  throw new Error(
    `OpenClaw suite mutated the host repo git state.\nbefore:\n${before}\nafter:\n${after}`,
  );
}

function runStep(step: HookStep, index: number, total: number, profile: HookProfile): HookRunResult {
  const startedAt = performance.now();
  console.log(`\n[${index}/${total}] ${step.label}`);
  console.log(`reason: ${step.reason}`);
  console.log(`cmd: ${formatCommand(step.command)}`);

  const [command, ...args] = step.command;
  if (!command) {
    throw new Error(`Hook step '${step.label}' has no command.`);
  }

  const guardHostRepo = /^OpenClaw suite/u.test(step.label);
  const gitStateBefore = guardHostRepo ? snapshotGitState() : null;

  // Propagate the pre-commit staged set so the size gate (file-size-budgets) scopes
  // to what THIS commit changes instead of the whole working tree. Pre-push and
  // strict keep the full-tree sweep: their architecture step is turbo `pnpm
  // architecture` and no staged-set scoping applies (#361).
  const env = { ...process.env };
  if (profile === "pre-commit" && step.label.startsWith("Architecture fitness rules")) {
    const staged = stagedFilesForPreCommit();
    if (staged.length > 0) {
      env.OPENCLINXR_HOOK_STAGED_FILES = staged.join("\n");
    }
  }

  const result = spawnSync(command, args, { stdio: "inherit", env });
  const elapsedMs = performance.now() - startedAt;
  if (gitStateBefore !== null) {
    try {
      assertRepoUnchanged(gitStateBefore, snapshotGitState());
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return { step, status: 1, elapsedMs };
    }
  }
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
  const changedFiles = changedFilesForProfile(profile);
  const steps = stepsForProfile(profile, changedFiles);
  const results: HookRunResult[] = [];

  console.log(`OpenClaw agentic hook runner: ${profile}`);
  console.log("Use OPENCLAW_SKIP_HOOKS=1 only for intentional emergency bypasses.");
  if (profile === "pre-commit") {
    const mode = classifyArchitectureInvocation(profile, changedFiles);
    console.log(`Architecture invocation: ${mode} (staged files: ${changedFiles.length})`);
  }
  if (profile !== "strict") {
    console.log("Use OPENCLINXR_HOOK_TYPECHECK_AFFECTED=1 for affected typecheck while the full baseline is being repaired.");
  }

  for (const [index, step] of steps.entries()) {
    const result = runStep(step, index + 1, steps.length, profile);
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
  void main();
}
