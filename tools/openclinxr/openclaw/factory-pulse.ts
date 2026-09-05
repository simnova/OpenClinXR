/**
 * factory-pulse - the hourly factory review, per the product owner's PULSE-PROTOCOL.
 *
 * Spec authored by the product owner (docs/openclinxr/owner-memory/PULSE-PROTOCOL.md). This file is
 * glue: it reads, computes, appends one row, and never decides anything. The verdict rule and its
 * thresholds are the owner's; changing them here without changing the protocol is a silent fork.
 *
 * WHY IT EXISTS. Completions, turns and proofsOk measure execution health, not product movement, so
 * the loop could not tell "progress improving" from "activity increasing". The two metrics that
 * separate them - board Factory transitions to Graded, and rework (a slice dispatched more than once)
 * - live nowhere in the logs. This reads them.
 *
 * FAILS OPEN, ALWAYS. Any unreadable source still appends a row with degraded:true and the failing
 * field named. It never exits nonzero, because it runs from a SessionStart hook and a nonzero exit
 * there would break the wake it is meant to observe.
 *
 * THROTTLE. Hourly via a 55-minute guard against its own state file, not per wake: wakes are ~15
 * minutes and the board query costs ~9 s and ~3 MB.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { isProductPath } from "./product-lane-gate.js";

/** Count git-log blocks (one per commit: hash line + file lines) whose files touch a release lane. */
export function countProductCommitBlocks(blocks: string[]): number {
  return blocks.filter((b) =>
    b
      .split("\n")
      .slice(1) // block[0] is the %H hash line; the rest are --name-only paths
      .some((line) => line.trim() !== "" && isProductPath(line.trim())),
  ).length;
}

const REPO = join(dirname(new URL(import.meta.url).pathname), "../../..");
const LEDGER = join(REPO, ".openclinxr/openclaw/worker-sessions.jsonl");
const UNIFIED = join(homedir(), ".grok/logs/unified.jsonl");
const PULSE = join(REPO, "docs/openclinxr/owner-memory/pulse.jsonl");
const STATE = join(REPO, ".openclinxr/openclaw/factory-pulse-last.json");
const THROTTLE_MS = 55 * 60 * 1000;

type State = { lastRunIso: string; boardItems: Record<string, string> };

function readState(): State | null {
  try { return JSON.parse(readFileSync(STATE, "utf8")) as State; } catch { return null; }
}

function sh(cmd: string, args: string[]): string {
  // ANSI STRIP (superagent ruling 2026-08-22, the DATA_STALE root cause): this harness sets
  // FORCE_COLOR/CLICOLOR_FORCE, so `gh project item-list --format json` emits ANSI-coloured
  // "JSON" and JSON.parse throws — every board query since the env landed has been silently
  // degraded to nullFields:["board"], the same class as the §6g Vite ready-line matcher.
  // Disable colour at the source AND strip any escapes that survive (belt and suspenders).
  const raw = execFileSync(cmd, args, {
    cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", CLICOLOR: "0", CLICOLOR_FORCE: "0", FORCE_COLOR: "0" },
  });
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

/**
 * Ledger aggregation over one window of already-filtered ledger rows.
 *
 * Counts DISPATCHES (distinct sessionIds), not lines: dispatch writes two "completed" rows for one
 * run (exit, then contract verification with proofsOk resolved), so line counts double-count every
 * proofed slice (#562, measured 1.67x on the live ledger). Rework counts slices dispatched to more
 * than one DISTINCT session that each actually ran - a provider-failure spawn ("died", or
 * spawned-only with no terminal row) never started a worker and is not delegate rework (#565).
 */
export function summariseLedgerWindow(rows: Record<string, unknown>[]): {
  completions: number; passed: number; failed: number; passRate: number | null; rework: number;
  needsResume: number; readyToIntegrate: number; handoffUnknown: number;
} {
  const terminalBySession = new Map<string, { phase: unknown; proofsOk: unknown; handoff?: string }>();
  const spawnSessionsBySlice = new Map<string, Set<string>>();
  for (const r of rows) {
    const sid = String(r.sessionId ?? "");
    if (!sid) continue;
    const phase = r.phase;
    if (phase === "spawned") {
      const set = spawnSessionsBySlice.get(String(r.slice ?? "")) ?? new Set<string>();
      set.add(sid);
      spawnSessionsBySlice.set(String(r.slice ?? ""), set);
      continue;
    }
    // Terminal rows repeat per session (completed is written at exit and again after proof
    // verification). Last write wins; within one session they agree on phase and resolve proofsOk.
    terminalBySession.set(sid, { phase, proofsOk: r.proofsOk, handoff: r["handoff"] as string | undefined });
  }

  const ran = [...terminalBySession.values()].filter((t) => t.phase === "completed");
  const completions = ran.length;
  const passed = ran.filter((t) => t.proofsOk === true).length;
  const failed = ran.filter((t) => t.proofsOk === false).length;

  /**
   * COMPLETED IS NOT INTEGRABLE, and this counter used to conflate them.
   *
   * MEASURED on issue-620: a row reading `completed / cancelled / proofsOk:true` was counted here as
   * one completion and one pass — while FOUR files sat dirty and uncommitted in the worktree. A bare
   * resume later committed the work and wrote no ledger row, so the pulse's view of that slice stayed
   * the intermediate state.
   *
   * `handoff` is derived from the worktree itself (worker-handoff-state.ts) and is the field to read.
   * Rows written before it existed carry `undefined`, which is counted as unknown rather than
   * silently good — an unmeasured tree is unmeasured.
   */
  const needsResume = ran.filter((t) => t.handoff === "needs_resume").length;
  const readyToIntegrate = ran.filter((t) => t.handoff === "ready_to_integrate").length;
  const handoffUnknown = ran.filter((t) => t.handoff !== "needs_resume" && t.handoff !== "ready_to_integrate").length;
  const passRate = completions > 0 ? passed / completions : null;

  // Rework = a slice whose workers genuinely ran more than once. SessionIds with only a "spawned"
  // or "died" line never took a turn (provider auth/balance failures), so they are excluded here.
  const ranSessionsBySlice = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.phase !== "completed") continue;
    const sid = String(r.sessionId ?? "");
    if (!sid) continue;
    const slice = String(r.slice ?? "");
    const set = ranSessionsBySlice.get(slice) ?? new Set<string>();
    set.add(sid);
    ranSessionsBySlice.set(slice, set);
  }
  const rework = [...ranSessionsBySlice.values()].filter((sessions) => sessions.size > 1).length;
  return { completions, passed, failed, passRate, rework, needsResume, readyToIntegrate, handoffUnknown };
}

function main(): void {
  const now = new Date();
  const prev = readState();
  if (prev && now.getTime() - new Date(prev.lastRunIso).getTime() < THROTTLE_MS) return; // silent, per spec
  const since = prev?.lastRunIso ?? new Date(now.getTime() - 3600_000).toISOString();
  const nullFields: string[] = [];

  // --- ledger: completions, pass rate, rework -------------------------------------------------
  let completions = 0, passed = 0, failed = 0, rework = 0;
  let needsResume = 0, readyToIntegrate = 0, handoffUnknown = 0;
  let passRate: number | null = null;
  try {
    const rows = readFileSync(LEDGER, "utf8").split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => typeof r.at === "string" && (r.at as string) >= since);
    ({ completions, passed, failed, passRate, rework, needsResume, readyToIntegrate, handoffUnknown } = summariseLedgerWindow(rows));
  } catch { nullFields.push("ledger"); }

  // --- unified log: provider health ------------------------------------------------------------
  const provider = { empty_response: 0, inference_retry: 0, auth_lock: 0 };
  try {
    for (const line of readFileSync(UNIFIED, "utf8").split("\n")) {
      if (!line || line < `{"ts":"${since}`) continue;
      if (line.includes("empty_response")) provider.empty_response += 1;
      if (line.includes("inference_retry")) provider.inference_retry += 1;
      if (line.includes("auth lock")) provider.auth_lock += 1;
    }
  } catch { nullFields.push("unified"); }

  // --- git: product commits vs churn ------------------------------------------------------------
  // SUPERAGENT RULING 2026-08-22: the release-lane definition is owned by product-lane-gate.ts,
  // not re-derived here. The previous inline regex (/\n(apps|packages)\//) counted
  // apps/arena/model-vetting-studio (capture harness — all four #558-#566 clip-ranking toil
  // slices) and packages/openclinxr/agent-loop (done_when machinery) as PRODUCT, reporting
  // 6/1/11/2 product commits across the 2026-08-22 derailment window while the tree held 44
  // consecutive non-product commits. Two instruments defining "product" differently is how the
  // hourly review certified toil; there is exactly one definition in the tree and the pulse
  // imports it. Agreement is pinned by the-pulse-product-lanes-match-the-gate.test.ts.
  let productCommits = 0, totalCommits = 0;
  try {
    const log = sh("git", ["log", `--since=${since}`, "--pretty=format:%H", "--name-only"]);
    const blocks = log.split(/\n(?=[0-9a-f]{40}\n)/u).filter(Boolean);
    totalCommits = blocks.length;
    productCommits = countProductCommitBlocks(blocks);
  } catch { nullFields.push("git"); }

  // --- board: Graded transitions ----------------------------------------------------------------
  let graded = 0;
  const boardItems: Record<string, string> = {};
  try {
    const raw = sh("gh", ["project", "item-list", "7", "--owner", "simnova", "--limit", "2000", "--format", "json"]);
    const items = (JSON.parse(raw) as { items?: Record<string, unknown>[] }).items ?? [];
    for (const it of items) {
      const id = String(it["id"] ?? "");
      const f = String(it["factory"] ?? "");
      if (id) boardItems[id] = f;
      if (f === "Graded" && prev && prev.boardItems[id] !== "Graded") graded += 1;
    }
  } catch { nullFields.push("board"); }

  // --- verdict, thresholds owned by PULSE-PROTOCOL ----------------------------------------------
  // PRODUCING_NOTHING (superagent ruling 2026-08-22, supersedes the bare ACTIVITY_INCREASING
  // reading): real execution happened in the window — completions and commits both above noise —
  // yet zero commits touched a release lane. The reference input is commit VOLUME, which slice
  // selection cannot inflate without landing release-lane bytes, so the clause cannot be gamed
  // by dispatching more. Calibration: it fires on a corrected replay of the 2026-08-22 08:51
  // row (total=15, completions=10, product=0) four hours before any other signal fired, and
  // stays silent on a quiet morning (1 commit, 0 completions). Any genuinely productive hour
  // has product_commits > 0 and cannot fire.
  const producingNothing =
    nullFields.length === 0 &&
    graded === 0 &&
    productCommits === 0 &&
    totalCommits >= 3 &&
    completions >= 3;

  let verdict: string;
  if (nullFields.length > 0) verdict = "DATA_STALE";
  else if (graded > 0 && passRate !== null && passRate >= 0.85 && rework <= 1) verdict = "PROGRESS_IMPROVING";
  else if (producingNothing) verdict = "PRODUCING_NOTHING";
  else if (graded === 0 && rework >= 2 && (completions > 0 || totalCommits > 0)) verdict = "ACTIVITY_INCREASING";
  else verdict = "NUMBERS_ONLY";

  const row = {
    ts: now.toISOString(), since,
    completions_1h: completions, pass_rate_1h: passRate, rework_1h: rework,
    // A completion whose worktree is dirty is NOT integrable — issue-620 counted as a pass with
    // four uncommitted files. Surfaced separately so monitoring stops inferring readiness.
    needs_resume_1h: needsResume, ready_to_integrate_1h: readyToIntegrate, handoff_unknown_1h: handoffUnknown,
    graded_transitions_1h: graded, product_commits_1h: productCommits, total_commits_1h: totalCommits,
    provider_failures_1h: provider, verdict,
    degraded: nullFields.length > 0, null_fields: nullFields,
  };
  try {
    mkdirSync(dirname(PULSE), { recursive: true });
    appendFileSync(PULSE, `${JSON.stringify(row)}\n`, "utf8");
    mkdirSync(dirname(STATE), { recursive: true });
    writeFileSync(STATE, JSON.stringify({ lastRunIso: row.ts, boardItems }, null, 2), "utf8");
    console.log(`FACTORY PULSE ${verdict} completions=${completions} graded=${graded} rework=${rework}`);
  } catch (error) {
    console.warn(`FACTORY PULSE: could not append row: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Stale alarm: printed by the hook wrapper when this file's state has not moved in 90 minutes. */
export function staleLine(): string | null {
  try {
    const age = Date.now() - statSync(STATE).mtimeMs;
    return age > 90 * 60 * 1000 ? `FACTORY PULSE STALE: last run ${new Date(statSync(STATE).mtimeMs).toISOString()}` : null;
  } catch { return existsSync(STATE) ? null : "FACTORY PULSE STALE: never run"; }
}

// ISSUE #562: this module is imported by tests (the planted contract imports it to reach
// summariseLedgerWindow), so the hook must not fire on import - a 9-second board query plus an
// append to the tracked pulse.jsonl per import. Run only when executed directly as the entrypoint.
if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]).href)) {
  main();
}
