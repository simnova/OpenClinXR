/**
 * Docs hygiene measure + session-start banner + optional run.
 *
 * Cadence: docs/agent-ops/DOC-HYGIENE-CADENCE.md
 * - Not every task
 * - Thresholds + weekly + multi-week catch-up on startup
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  isFreezeCandidateBasename,
  listFreezeCandidates,
} from "./docs-archive-cli.js";
import { splitCheckpointSections } from "./checkpoint-archive-cli.js";
import { measureTemporalReview } from "./temporal-review-cli.js";

export const DOCS_HYGIENE_STATE_SCHEMA = "openclinxr.docs-hygiene-last-run.v1" as const;

export type DocsHygieneLastRun = {
  schemaVersion: typeof DOCS_HYGIENE_STATE_SCHEMA;
  lastSuccessfulHygieneAt: string;
  lastAction: string;
  details?: Record<string, unknown>;
};

export type DocsHygieneMeasure = {
  schemaVersion: "openclinxr.docs-hygiene-measure.v1";
  measuredAt: string;
  checkpointBlocks: number;
  checkpointThreshold: number;
  freezeCandidates: number;
  freezeCandidateThreshold: number;
  forceFreezeCandidateThreshold: number;
  daysSinceLastHygiene: number | null;
  staleDaysThreshold: number;
  lastSuccessfulHygieneAt: string | null;
  actions: Array<"skip" | "checkpoint" | "freeze" | "force_freeze" | "worktree_list" | "authority">;
  forceHygiene: boolean;
  reason: string[];
  banner: string;
  temporalDueCount?: number;
  temporalBannerLine?: string;
};

const DEFAULT_CHECKPOINT_THRESHOLD = 20;
const DEFAULT_KEEP = 14;
const DEFAULT_FREEZE_CANDIDATES = 5;
const DEFAULT_FORCE_CANDIDATES = 8;
/** "A few weeks" with computer off → catch up on next CEO session start */
const DEFAULT_STALE_DAYS = 14;

const STATE_REL = ".openclinxr/docs-hygiene/last-run.json";

export function countCheckpointBlocks(projectStatusText: string): number {
  return splitCheckpointSections(projectStatusText).blocks.length;
}

export function isArchiveStubBody(body: string): boolean {
  return body.startsWith("# ARCHIVED") && body.includes("docs warehouse cold tier");
}

/** Dated agent-ops files that still have full bodies (not stubs). */
export function countLiveDatedRevisionBodies(agentOpsDir: string): {
  count: number;
  basenames: string[];
} {
  const basenames = listFreezeCandidates(agentOpsDir).filter((name) => {
    const full = path.join(agentOpsDir, name);
    try {
      const body = readFileSync(full, "utf8");
      return !isArchiveStubBody(body);
    } catch {
      return false;
    }
  });
  return { count: basenames.length, basenames };
}

export function daysBetween(isoEarlier: string, isoLater: string): number {
  const a = Date.parse(isoEarlier);
  const b = Date.parse(isoLater);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

export function readLastHygieneRun(repoRoot: string): DocsHygieneLastRun | null {
  const full = path.join(repoRoot, STATE_REL);
  if (!existsSync(full)) return null;
  try {
    const j = JSON.parse(readFileSync(full, "utf8")) as DocsHygieneLastRun;
    if (!j.lastSuccessfulHygieneAt) return null;
    return j;
  } catch {
    return null;
  }
}

export function writeLastHygieneRun(
  repoRoot: string,
  run: Omit<DocsHygieneLastRun, "schemaVersion"> & { schemaVersion?: string },
): void {
  const dir = path.join(repoRoot, ".openclinxr/docs-hygiene");
  mkdirSync(dir, { recursive: true });
  const payload: DocsHygieneLastRun = {
    schemaVersion: DOCS_HYGIENE_STATE_SCHEMA,
    lastSuccessfulHygieneAt: run.lastSuccessfulHygieneAt,
    lastAction: run.lastAction,
    ...(run.details !== undefined ? { details: run.details } : {}),
  };
  writeFileSync(path.join(dir, "last-run.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function measureDocsHygiene(options: {
  repoRoot: string;
  now?: Date;
  checkpointThreshold?: number;
  freezeCandidateThreshold?: number;
  forceFreezeCandidateThreshold?: number;
  staleDaysThreshold?: number;
}): DocsHygieneMeasure {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const checkpointThreshold = options.checkpointThreshold ?? DEFAULT_CHECKPOINT_THRESHOLD;
  const freezeCandidateThreshold = options.freezeCandidateThreshold ?? DEFAULT_FREEZE_CANDIDATES;
  const forceFreezeCandidateThreshold =
    options.forceFreezeCandidateThreshold ?? DEFAULT_FORCE_CANDIDATES;
  const staleDaysThreshold = options.staleDaysThreshold ?? DEFAULT_STALE_DAYS;

  const statusPath = path.join(options.repoRoot, "PROJECT_STATUS.md");
  const statusText = existsSync(statusPath) ? readFileSync(statusPath, "utf8") : "";
  const checkpointBlocks = countCheckpointBlocks(statusText);

  const agentOps = path.join(options.repoRoot, "docs/agent-ops");
  const { count: freezeCandidates, basenames } = countLiveDatedRevisionBodies(agentOps);

  const last = readLastHygieneRun(options.repoRoot);
  const daysSinceLastHygiene =
    last?.lastSuccessfulHygieneAt != null
      ? daysBetween(last.lastSuccessfulHygieneAt, nowIso)
      : null;

  const reason: string[] = [];
  const actions = new Set<DocsHygieneMeasure["actions"][number]>();

  if (checkpointBlocks > checkpointThreshold) {
    actions.add("checkpoint");
    reason.push(`checkpoint blocks ${checkpointBlocks} > ${checkpointThreshold}`);
  }
  if (freezeCandidates >= freezeCandidateThreshold) {
    actions.add("freeze");
    reason.push(`live dated revisions ${freezeCandidates} >= ${freezeCandidateThreshold}`);
  }
  if (freezeCandidates > forceFreezeCandidateThreshold) {
    actions.add("force_freeze");
    reason.push(`candidates ${freezeCandidates} > force N=${forceFreezeCandidateThreshold}`);
  }
  const neverRun = daysSinceLastHygiene === null;
  const stale =
    daysSinceLastHygiene !== null && daysSinceLastHygiene >= staleDaysThreshold;
  const backlog =
    freezeCandidates > forceFreezeCandidateThreshold ||
    checkpointBlocks > checkpointThreshold ||
    freezeCandidates >= freezeCandidateThreshold;

  if (stale) {
    actions.add("force_freeze");
    actions.add("checkpoint");
    actions.add("worktree_list");
    reason.push(
      `stale hygiene: ${daysSinceLastHygiene}d since last run (threshold ${staleDaysThreshold}d — computer-off catch-up)`,
    );
  } else if (neverRun && backlog) {
    actions.add("force_freeze");
    reason.push("no prior hygiene last-run and backlog thresholds already met");
  } else if (neverRun && !backlog) {
    reason.push(
      "no prior hygiene last-run — will heartbeat on quiet session-start (no force until backlog or stale)",
    );
  }

  if (actions.size === 0) {
    actions.add("skip");
    if (reason.length === 0) reason.push("all quiet under thresholds");
  } else {
    if (actions.has("freeze") || actions.has("force_freeze")) {
      actions.add("authority");
    }
  }

  const forceHygiene =
    actions.has("force_freeze") ||
    freezeCandidates > forceFreezeCandidateThreshold ||
    (stale && backlog) ||
    (stale && checkpointBlocks > 0);

  const actionList = [...actions];
  let temporalBannerLine = "TEMPORAL: (catalog not measured)";
  let temporalDueCount = 0;
  try {
    const temporal = measureTemporalReview({
      repoRoot: options.repoRoot,
      now,
      topN: 3,
    });
    temporalBannerLine = temporal.bannerLine;
    temporalDueCount = temporal.dueCount;
  } catch {
    temporalBannerLine = "TEMPORAL: measure skipped";
  }

  const banner = buildBanner({
    forceHygiene,
    reason,
    checkpointBlocks,
    freezeCandidates,
    daysSinceLastHygiene,
    basenames,
    actionList,
    temporalBannerLine,
  });

  return {
    schemaVersion: "openclinxr.docs-hygiene-measure.v1",
    measuredAt: nowIso,
    checkpointBlocks,
    checkpointThreshold,
    freezeCandidates,
    freezeCandidateThreshold,
    forceFreezeCandidateThreshold,
    daysSinceLastHygiene,
    staleDaysThreshold,
    lastSuccessfulHygieneAt: last?.lastSuccessfulHygieneAt ?? null,
    actions: actionList,
    forceHygiene,
    reason,
    banner,
    temporalDueCount,
    temporalBannerLine,
  };
}

function buildBanner(input: {
  forceHygiene: boolean;
  reason: string[];
  checkpointBlocks: number;
  freezeCandidates: number;
  daysSinceLastHygiene: number | null;
  basenames: string[];
  actionList: string[];
  autoRun?: boolean;
  temporalBannerLine?: string;
}): string {
  const lines = [
    "=== DOC HYGIENE (PMO session-start; unattended) ===",
    `checkpoints: ${input.checkpointBlocks}  live_dated_revisions: ${input.freezeCandidates}  days_since_hygiene: ${input.daysSinceLastHygiene ?? "never"}`,
    `actions: ${input.actionList.join(",")}`,
    `reasons: ${input.reason.join("; ")}`,
  ];
  if (input.basenames.length > 0 && input.basenames.length <= 12) {
    lines.push(`candidates: ${input.basenames.join(", ")}`);
  } else if (input.basenames.length > 12) {
    lines.push(`candidates: ${input.basenames.slice(0, 8).join(", ")} … +${input.basenames.length - 8}`);
  }
  if (input.temporalBannerLine) {
    lines.push(input.temporalBannerLine);
  }
  if (input.forceHygiene) {
    lines.push(">>> FORCE HYGIENE BEFORE PRODUCT DEQUEUE <<<");
    if (input.autoRun) {
      lines.push("AUTO-RUN: executing pnpm docs:hygiene:run (no operator step)");
    } else {
      lines.push("Run: pnpm docs:hygiene:session-start -- --auto-run   (hooks use this)");
      lines.push("Or:  pnpm docs:hygiene:run");
    }
    lines.push("SSOT: docs/agent-ops/DOC-HYGIENE-CADENCE.md · owner: pmo");
  } else {
    lines.push("Hygiene quiet — product dequeue OK (still skip per-task archive).");
  }
  lines.push("Temporal catalog: docs/agent-ops/TEMPORAL-DECISIONS.md · pnpm temporal:review");
  lines.push("=== END DOC HYGIENE ===");
  return lines.join("\n");
}

export function runDocsHygiene(options: {
  repoRoot: string;
  measure: DocsHygieneMeasure;
  dryRun: boolean;
}): { ok: boolean; steps: Array<{ step: string; ok: boolean; detail: string }> } {
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  const run = (step: string, cmd: string, args: string[]): boolean => {
    if (options.dryRun) {
      steps.push({ step, ok: true, detail: `dry-run: ${cmd} ${args.join(" ")}` });
      return true;
    }
    const r = spawnSync(cmd, args, {
      cwd: options.repoRoot,
      encoding: "utf8",
      env: process.env,
    });
    const detail = (r.stdout || r.stderr || "").trim().slice(0, 500);
    const ok = r.status === 0;
    steps.push({ step, ok, detail: detail || `exit ${r.status}` });
    return ok;
  };

  let ok = true;
  const acts = new Set(options.measure.actions);

  if (acts.has("checkpoint") || acts.has("force_freeze")) {
    ok =
      run("checkpoint:archive", "pnpm", [
        "openclaw:checkpoint:archive",
        "--",
        "--keep",
        String(DEFAULT_KEEP),
      ]) && ok;
  }

  if (acts.has("freeze") || acts.has("force_freeze")) {
    if (options.measure.freezeCandidates > 0) {
      const batch = `hygiene-${options.measure.measuredAt.slice(0, 10)}`;
      ok =
        run("docs:archive:freeze", "pnpm", [
          "docs:archive",
          "--",
          "freeze",
          "--batch",
          batch,
          ...(options.dryRun ? ["--dry-run"] : []),
        ]) && ok;
    } else {
      steps.push({
        step: "docs:archive:freeze",
        ok: true,
        detail: "no live dated revision bodies to freeze",
      });
    }
  }

  if (acts.has("authority") || acts.has("freeze") || acts.has("force_freeze")) {
    ok = run("docs:authority", "pnpm", ["docs:authority"]) && ok;
  }

  if (acts.has("worktree_list") || acts.has("force_freeze")) {
    ok = run("worktree:list", "pnpm", ["openclaw:worktree:list"]) && ok;
  }

  if (ok && !options.dryRun && !acts.has("skip")) {
    writeLastHygieneRun(options.repoRoot, {
      lastSuccessfulHygieneAt: new Date().toISOString(),
      lastAction: options.measure.actions.join(","),
      details: {
        checkpointBlocks: options.measure.checkpointBlocks,
        freezeCandidates: options.measure.freezeCandidates,
        daysSinceLastHygiene: options.measure.daysSinceLastHygiene,
      },
    });
    steps.push({ step: "record-last-run", ok: true, detail: STATE_REL });
  }

  if (acts.has("skip") && !options.dryRun) {
    // Still heartbeat last-run on pure measure-skip so "never" doesn't forever force-freeze
    // only when explicitly --record-skip
  }

  return { ok, steps };
}

function parseArgs(argv: string[]): {
  command: "measure" | "session-start" | "run" | "help";
  json: boolean;
  dryRun: boolean;
  recordSkip: boolean;
  autoRun: boolean;
} {
  let command: "measure" | "session-start" | "run" | "help" = "help";
  let json = false;
  let dryRun = false;
  let recordSkip = false;
  let autoRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "measure" || a === "session-start" || a === "run" || a === "help") command = a;
    else if (a === "--json") json = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--record-skip") recordSkip = true;
    else if (a === "--auto-run") autoRun = true;
  }
  return { command, json, dryRun, recordSkip, autoRun };
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    console.log(`docs-hygiene — measure / session-start (unattended) / run

Usage:
  pnpm docs:hygiene:measure [--json]
  pnpm docs:hygiene:session-start [-- --auto-run]
    # Banner always. With --auto-run (SessionStart hook): when forceHygiene,
    # executes runDocsHygiene without operator. Exit 0 after successful auto-run;
    # exit 2 if force and no auto-run (or auto-run failed).
  pnpm docs:hygiene:run [-- --dry-run] [-- --record-skip]

State: ${STATE_REL}
Owner: pmo · Cadence: docs/agent-ops/DOC-HYGIENE-CADENCE.md
`);
    process.exitCode = 0;
    return;
  }

  const measure = measureDocsHygiene({ repoRoot });

  if (args.command === "measure") {
    if (args.json) console.log(JSON.stringify(measure, null, 2));
    else {
      console.log(measure.banner);
      console.log(JSON.stringify({ actions: measure.actions, forceHygiene: measure.forceHygiene }, null, 2));
    }
    process.exitCode = measure.forceHygiene ? 2 : 0;
    return;
  }

  if (args.command === "session-start") {
    console.log(measure.banner);
    if (args.autoRun && measure.forceHygiene) {
      console.log("PMO auto-run: force hygiene — executing without operator…");
    }

    // Quiet path: heartbeat so multi-week offline is measured from last open.
    if (!measure.forceHygiene) {
      writeLastHygieneRun(repoRoot, {
        lastSuccessfulHygieneAt: new Date().toISOString(),
        lastAction: "session-start-quiet-heartbeat",
        details: {
          quiet: true,
          checkpointBlocks: measure.checkpointBlocks,
          freezeCandidates: measure.freezeCandidates,
        },
      });
      process.exitCode = 0;
      return;
    }

    // Force path: unattended auto-run when hook passes --auto-run (PMO design).
    if (args.autoRun) {
      const result = runDocsHygiene({
        repoRoot,
        measure,
        dryRun: args.dryRun,
      });
      console.log(JSON.stringify(result, null, 2));
      if (result.ok) {
        console.log("PMO auto-run: hygiene complete — product dequeue OK.");
        process.exitCode = 0;
      } else {
        console.log("PMO auto-run: hygiene FAILED — operator/CEO should inspect steps above.");
        process.exitCode = 2;
      }
      return;
    }

    // Force without auto-run: exit 2 so older callers still notice.
    console.log("Hint: hooks should pass --auto-run for unattended catch-up (owner: pmo).");
    process.exitCode = 2;
    return;
  }

  if (args.command === "run") {
    console.log(measure.banner);
    if (measure.actions.includes("skip") && !measure.forceHygiene) {
      console.log("Nothing to run (quiet). Session-start quiet path heartbeats last-run.");
      if (!args.dryRun) {
        writeLastHygieneRun(repoRoot, {
          lastSuccessfulHygieneAt: new Date().toISOString(),
          lastAction: "run-skip-quiet",
        });
      }
      process.exitCode = 0;
      return;
    }
    const result = runDocsHygiene({ repoRoot, measure, dryRun: args.dryRun });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
