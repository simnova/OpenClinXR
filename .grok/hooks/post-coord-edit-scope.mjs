#!/usr/bin/env node
/**
 * CEO PostToolUse coordination guard, scoped by what is actually dirty.
 *
 * WHY. This hook ran `pnpm agent:alignment && pnpm docs:drift-check` after EVERY matching tool call
 * in the orchestrator session — `Edit|search_replace|write|create|run_terminal_cmd` — whether or not
 * the call touched a coordination file. Measured 2026-09-12 on this machine: the pair costs 1.22 s
 * wall, and `git status --porcelain` costs 0.03 s. The overwhelming majority of a working session's
 * tool calls touch `apps/`, `packages/` and `tools/`, where neither guard has anything to say.
 *
 * WHAT IS NOT WEAKENED. Both guards still run, in full, whenever a coordination path is dirty. Both
 * still run UNCONDITIONALLY at pre-commit via `.githooks` → `agentic-hook-runner.ts`
 * (`buildBaseOpenClawSteps`), which is the gate that actually protects main. This hook is the fast
 * advisory copy in front of that, and narrowing WHEN it fires changes no check it performs.
 *
 * WHY THE TREE, NOT THE TOOL PAYLOAD. Deciding from the hook payload's file path would depend on
 * undocumented per-tool field names, and would be defeated by exactly the cases that matter: a
 * computed path, a shell redirection, a `sed -i` whose target is in a variable. `git status` sees
 * the result of the call whatever produced it. The one case the payload would catch and this does
 * not is an edit already committed within the session — and a commit runs the unconditional
 * pre-commit pair, so that path is covered by a stronger gate, not left open.
 *
 * FAILS SAFE. If `git status` cannot be read, the guards RUN. "I could not tell" must never be the
 * cheap branch.
 */

import { spawnSync } from "node:child_process";

/** Coordination files named individually by the two guards (and their historical ledgers). */
export const COORD_EXACT_FILES = [
  "AGENTS.md",
  "PROJECT_STATUS.md",
  "PROJECT_COORDINATION_INDEX.md",
  "AUTONOMOUS_WORK_PLAN.md",
  "CLAUDE.md",
];

/**
 * Directory prefixes whose contents either guard reads or validates.
 *
 * Deliberately a GENEROUS superset of what `check-coordination-alignment.ts` and
 * `check-openclaw-drift.ts` enumerate: an extra prefix costs 1.22 s on a rare call, while a missing
 * one costs a guard that should have run. `docs/` is taken whole because drift-check walks it.
 */
export const COORD_PREFIXES = [
  "docs/",
  "agents/",
  ".grok/",
  ".claude/",
  ".cursor/",
  ".codex/",
  ".agents/",
  "operator-",
];

export function isCoordinationPath(p) {
  if (!p) return false;
  const norm = p.replace(/^\.\//u, "");
  if (COORD_EXACT_FILES.includes(norm)) return true;
  if (COORD_PREFIXES.some((prefix) => norm.startsWith(prefix))) return true;
  // Any top-level markdown is coordination-shaped by convention in this repo.
  return !norm.includes("/") && norm.toLowerCase().endsWith(".md");
}

/** Paths a `git status --porcelain` line refers to (handles rename/copy "old -> new"). */
export function pathsFromPorcelainLine(line) {
  if (!line || line.length < 4) return [];
  const body = line.slice(3);
  const arrow = body.indexOf(" -> ");
  const raw = arrow === -1 ? [body] : [body.slice(0, arrow), body.slice(arrow + 4)];
  return raw
    .map((p) => (p.startsWith('"') ? unquote(p) : p))
    .filter((p) => p.length > 0);
}

function unquote(p) {
  try {
    return JSON.parse(p) ?? p;
  } catch {
    return p;
  }
}

export function coordinationPathsIn(porcelain) {
  const hits = [];
  for (const line of String(porcelain ?? "").split("\n")) {
    for (const p of pathsFromPorcelainLine(line)) {
      if (isCoordinationPath(p) && !hits.includes(p)) hits.push(p);
    }
  }
  return hits;
}

function isWorkerSession(env) {
  return env.OPENCLINXR_WORKER === "1" || env.OPENCLINXR_WORKER === "true" || Boolean(env.GROK_SUBAGENT);
}

function main() {
  const env = process.env;
  if (isWorkerSession(env)) {
    console.log("PostToolUse (worker): skip alignment/drift-check (parent/CEO owns coord guards)");
    return 0;
  }

  const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", timeout: 20_000 });
  let hits;
  if (status.status !== 0 || typeof status.stdout !== "string") {
    hits = ["(git status unavailable — failing safe and running the guards)"];
  } else {
    hits = coordinationPathsIn(status.stdout);
  }

  if (hits.length === 0) {
    console.log(
      "PostToolUse (coord edit guard): no coordination path dirty — skipping alignment/drift-check. " +
        "Both still run in full on any coordination edit, and unconditionally at pre-commit " +
        "(.githooks → agentic-hook-runner.ts).",
    );
    return 0;
  }

  console.log(
    `PostToolUse (coord edit guard): ${hits.length} coordination path(s) dirty ` +
      `(${hits.slice(0, 3).join(", ")}${hits.length > 3 ? ", …" : ""}) — running pnpm agent:alignment && pnpm docs:drift-check`,
  );
  if (env.OPENCLINXR_COORD_GUARD_DRY_RUN === "1") {
    console.log("DRY RUN: guards not executed");
    return 0;
  }

  const run = spawnSync("sh", ["-c", "pnpm agent:alignment && pnpm docs:drift-check"], { stdio: "inherit" });
  if (run.status !== 0) {
    console.log("Guard check completed with notes (exit non-zero ignored for PostToolUse; review output)");
  }
  console.log(
    "OpenClaw-style tie: .githooks pre-commit/pre-push also run the agentic-hook-runner.ts " +
      "(drift/alignment/architecture/post-slice) on git ops for these files.",
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
