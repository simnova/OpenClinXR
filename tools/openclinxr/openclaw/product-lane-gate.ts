#!/usr/bin/env tsx
/**
 * PRODUCT-LANE GATE (superagent ruling 2026-08-22).
 *
 * WHAT HAPPENED: in the window 2026-08-22T06:00Z..14:55Z the loop landed 40 commits and ZERO on
 * any product path, while the prior 24h landed 161 commits including ~50 across apps/ui-xr and
 * tools/openclinxr/asset-pipeline. Every slice chosen in the window measured or repaired the loop's
 * own instrumentation (capture-harness clip ranking x4, dispatch-ledger accounting x4, iris
 * measurement instruments x2+salvage, a new done_when rule type). The orchestration review of
 * 2026-08-19 had already named this exact drift: "measurement lab that protects the factory instead
 * of extending it." Recording it did not stop it.
 *
 * WHY THIS IS A GATE AND NOT A RULE: 160+ numbered doctrine rules are prose and demonstrably do not
 * bind slice selection. A gate in dispatch() binds mechanically — a dispatch that would extend an
 * evidence-only stretch FAILS CLOSED before a worktree is created and before any worker token is
 * spent. Same shape as assertLoopNotPaused (issue #461-class): the halt is first, costs nothing,
 * and lives where the thing being halted cannot clear it.
 *
 * THE MECHANISM (git, not memory): count commits per release lane since the last commit that
 * touched a product path. Evidence/coordination commits do NOT reset the product clock. When the
 * product clock passes PRODUCT_IDLE_LIMIT, dispatch() refuses every non-product dispatch until a
 * product-path commit lands. Escaping requires exactly one act: land product bytes.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";

/** Evidence-only commits tolerated before the next product commit is REQUIRED. */
export const PRODUCT_IDLE_LIMIT = 4;

/** A pulse row older than this is STALE and must be refreshed before it can gate a dispatch. */
export const PULSE_STALE_MS = 90 * 60 * 1000;

/**
 * Release lanes: paths whose commits RESET the product clock (Q1 blueprint-to-runtime generation,
 * Q4 review/persistence/replay surfaces, or runtime-visible asset bytes). Everything else —
 * evidence instruments, openclaw tooling, coordination docs, owner memory — is overhead by this
 * measure and never resets it.
 *
 * DELIBERATE EXCLUSION: `apps/arena/model-vetting-studio` is the capture harness, not the exam.
 * The 2026-08-22 toil window landed four slices on its clip-ranking function; a broad `apps/`
 * lane would have counted every one as product and this gate would have been a paper shield
 * against the exact drift it exists to stop. Same logic excludes agent-loop (the done_when
 * machinery) — both are instrumented loops, not shipped capability.
 */
export const PRODUCT_PATHS = [
  "apps/ui-xr/",
  "apps/api/",
  "apps/ui-admin/",
  "packages/",
  "tools/openclinxr/asset-pipeline/",
  "tools/openclinxr/factory/",
  "tools/openclinxr/dark-factory/",
];

const EXCLUDED_PRODUCT_PATHS = [
  // done_when machinery + loop tooling: measuring the factory is not shipping it
  "packages/openclinxr/agent-loop/",
  "packages/openclinxr/test-harness/",
];

export function isProductPath(filePath: string): boolean {
  const p = filePath.replace(/\\/g, "/");
  if (EXCLUDED_PRODUCT_PATHS.some((x) => p === x || p.startsWith(x))) return false;
  return PRODUCT_PATHS.some((x) => p === x || p.startsWith(x));
}

export type ProductLaneState = {
  /** Commits on main since the last product-path commit. */
  evidenceOnlyCommits: number;
  /** Short hash + subject of the last product-path commit (null when none exists). */
  lastProductCommit: { hash: string; subject: string; date: string } | null;
};

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    env: gitEnvWithoutInheritedRepoVars(),
  });
}

/** Count commits on HEAD since the most recent one that touched a product path. */
export function measureProductLaneState(repoRoot: string): ProductLaneState {
  // Newest-first with per-commit file lists. Entries are [header, file...]; a header line
  // contains tabs (%h%x09%ad%x09%s). Walk until the first entry whose FILES hit a product path.
  //
  // `--name-only` alone emits ZERO file lines for a merge commit (integrate uses --no-ff).
  // `-m` shows the first-parent diff for merges; `--first-parent` keeps the walk on the
  // integration line and avoids a second parent block that would double-count landings.
  // History only — never the working tree (#590).
  let log: string;
  try {
    log = git(repoRoot, [
      "log",
      "--first-parent",
      "-m",
      "--date=iso-strict",
      "--pretty=format:%h%x09%ad%x09%s",
      "--name-only",
      "-n",
      "400",
    ]);
  } catch {
    // Not a git repo (test fixtures, scratch roots): no measurable history -> clock fresh.
    // The gate bounds a measurable evidence-only STRETCH on the real repo; an unmeasurable
    // root must not break unrelated dispatch machinery.
    return { evidenceOnlyCommits: 0, lastProductCommit: null };
  }
  if (!log.trim()) {
    return { evidenceOnlyCommits: 0, lastProductCommit: null };
  }
  type Entry = { hash: string; date: string; subject: string; files: string[] };
  const entries: Entry[] = [];
  let current: Entry | null = null;
  for (const raw of log.split("\n")) {
    if (!raw.trim()) continue;
    if (raw.includes("\t")) {
      if (current) entries.push(current);
      const [hash, date, subject] = raw.split("\t");
      current = { hash, date: date ?? "", subject: subject ?? "", files: [] };
    } else if (current) {
      current.files.push(raw.trim());
    }
  }
  if (current) entries.push(current);

  let counted = 0;
  for (const entry of entries) {
    if (entry.files.some((f) => isProductPath(f))) {
      return { evidenceOnlyCommits: counted, lastProductCommit: { hash: entry.hash, subject: entry.subject, date: entry.date } };
    }
    counted += 1;
  }
  // 400 commits with no product commit anywhere: report the full depth.
  return { evidenceOnlyCommits: counted, lastProductCommit: null };
}

export class ProductLaneGateError extends Error {}

/**
 * PULSE FRESHNESS GATE (superagent ruling 2026-08-22). The 2026-08-22 derailment ran with the
 * hourly pulse firing but nobody consuming it, including a 4h05m hole caused by worker-heavy
 * stretches: dispatched workers skip the SessionStart hook via env, so the sampler goes blind
 * exactly when dispatch volume is highest. A right number in a file nobody opens is decoration.
 *
 * Mechanism: dispatch() force-refreshes a stale pulse ITSELF (the pulse needs only git, the
 * ledger, unified.jsonl and gh — all present orchestrator-side before any spawn; the refresh is
 * ~10 s inside the dispatch budget), then refuses only if the measurement is STILL unusable:
 *   - refresh attempted and the state file is still stale (refresh itself failed), or
 *   - the last row carries degraded:true (DATA_STALE — a source was unreadable).
 * Fail-closed on "I cannot see", never on "what I see is bad": PRODUCING_NOTHING /
 * ACTIVITY_INCREASING rows are data for the tick's NEEDS-DECISION record, not a halt — blocking
 * dispatch over them starves the owner grading cadence that produces graded transitions, which
 * compounds the disease it punishes. Behavioral bounds stay with assertProductLaneNotStarved;
 * this gate answers one question: is the factory's self-measurement alive?
 */
export type PulseGateResult = { refreshed: boolean; verdict: string | null };

const PULSE_STATE_REL = join(".openclinxr", "openclaw", "factory-pulse-last.json");
const PULSE_ROWS_REL = join("docs", "openclinxr", "owner-memory", "pulse.jsonl");

function lastPulseVerdict(repoRoot: string): string | null {
  try {
    const content = readFileSync(join(repoRoot, PULSE_ROWS_REL), "utf8");
    const rows = content.trim().split("\n").filter(Boolean);
    const last = rows[rows.length - 1];
    return last ? (JSON.parse(last).verdict as string) : null;
  } catch {
    return null;
  }
}

export function assertPulseMeasurementAlive(repoRoot: string): PulseGateResult {
  // Unmeasurable root (test fixture / scratch dir): no runner to refresh — skip, like
  // measureProductLaneState falls back to clock-fresh. The gate binds the REAL repo only.
  if (!existsSync(join(repoRoot, "package.json")) || !existsSync(join(repoRoot, ".git"))) {
    return { refreshed: false, verdict: null };
  }
  const statePath = join(repoRoot, PULSE_STATE_REL);
  let stale: boolean;
  if (!existsSync(statePath)) {
    stale = true; // never run — first refresh creates it
  } else {
    try {
      stale = Date.now() - statSync(statePath).mtimeMs > PULSE_STALE_MS;
    } catch {
      stale = true; // unreadable state file is itself a broken measurement
    }
  }
  if (!stale) return { refreshed: false, verdict: lastPulseVerdict(repoRoot) };

  // Self-heal: refresh from the orchestrator side, where git/gh/ledger are all reachable.
  try {
    execFileSync("pnpm", ["openclinxr:factory-pulse"], { cwd: repoRoot, encoding: "utf8", timeout: 120_000 });
  } catch {
    throw new ProductLaneGateError(
      [
        "PULSE GATE: factory pulse is stale and the in-dispatch refresh FAILED.",
        "dispatch() cannot verify the factory's self-measurement is alive — refusing.",
        `Fix the runner manually: pnpm openclinxr:factory-pulse (state: ${statePath}).`,
      ].join("\n"),
    );
  }
  const stillStale = Date.now() - statSync(statePath).mtimeMs > PULSE_STALE_MS;
  if (stillStale) {
    throw new ProductLaneGateError(
      "PULSE GATE: refresh ran but the state file did not move — refusing on unverifiable measurement.",
    );
  }
  const verdict = lastPulseVerdict(repoRoot);
  if (verdict === "DATA_STALE") {
    throw new ProductLaneGateError(
      [
        "PULSE GATE: the freshest pulse row is DATA_STALE (a source was unreadable at measure time).",
        "Refusing on broken measurement. Repair the unreadable source named in the row's",
        "null_fields, or fix the runner — do not clear the row by hand.",
      ].join("\n"),
    );
  }
  return { refreshed: true, verdict };
}

/**
 * Refuse a dispatch when the product clock has expired and this dispatch is not itself product-lane.
 * Throws BEFORE worktree creation / spawn so a refused dispatch costs zero worker tokens.
 */
export function assertProductLaneNotStarved(
  repoRoot: string,
  options: { slice?: string; product?: boolean },
): void {
  const state = measureProductLaneState(repoRoot);
  if (options.product) return; // product dispatches are always allowed and reset the clock on landing
  if (state.evidenceOnlyCommits < PRODUCT_IDLE_LIMIT) return;
  throw new ProductLaneGateError(
    [
      `PRODUCT-LANE GATE: refusing dispatch '${options.slice ?? "unscoped"}' — ${state.evidenceOnlyCommits} consecutive commits without touching a product path (limit ${PRODUCT_IDLE_LIMIT}).`,
      `Last product commit: ${state.lastProductCommit ? `${state.lastProductCommit.hash} ${state.lastProductCommit.subject}` : "(none in the last 400)"}`,
      `Escape hatch is ONE act: dispatch with product: true and land bytes under one of: ${PRODUCT_PATHS.join(" ")}`,
      `This gate exists because the 2026-08-22 window landed 40 instrument/tooling commits and zero product commits.`,
    ].join("\n"),
  );
}
