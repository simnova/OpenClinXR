/**
 * handoff — mechanical lane-handoff writer. No model: every mechanical section
 * is gathered by commands, template slots are left as headings for the model.
 *
 * Usage: pnpm exec tsx tools/openclinxr/openclaw/handoff.ts write <lane>
 *   [--result <path> ...] [--card <id> ...] [--repo <path>] [--out <path>]
 *
 * Board cards are listed only: board-cli has no cheap read (its status command
 * posts via gh), and the write never fails when the board is unreachable.
 *
 * Per-worktree git facts run concurrently (bounded pool): the repo carries
 * hundreds of worktrees and sequential spawns exceed any reasonable timeout.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";

export type HandoffOptions = {
  repo: string;
  lane: string;
  results: string[];
  cards: string[];
  out?: string;
};

const CONCURRENCY = 32;

function run(cmd: string, args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    // Scrub hook-inherited repo vars (GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE):
    // under a git hook these override `cwd` and every call below would drive
    // the host repo instead of the lane's (measured core.bare flip 2026-09-23).
    execFile(
      cmd,
      args,
      { cwd, encoding: "utf8", timeout: 15_000, env: gitEnvWithoutInheritedRepoVars() },
      (error, stdout) => {
        if (error) resolve(null);
        else resolve(stdout.trim());
      },
    );
  });
}

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function lastLineOf(path: string): string {
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
    return lines.at(-1) ?? "(empty file)";
  } catch {
    return "(unreadable — file may not exist yet)";
  }
}

type WorktreeFacts = {
  path: string;
  branch: string;
  head: string;
  ahead: { sha: string; subject: string }[];
  dirty: number;
};

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(runners);
  return out;
}

async function worktreeFacts(repo: string): Promise<WorktreeFacts[] | null> {
  const list = await run("git", ["worktree", "list", "--porcelain"], repo);
  if (list === null) return null;
  const paths: string[] = [];
  for (const block of list.split("\n\n")) {
    const pathLine = block.split("\n").find((l) => l.startsWith("worktree "));
    if (pathLine) paths.push(pathLine.slice("worktree ".length));
  }
  return mapPool(paths, CONCURRENCY, async (path): Promise<WorktreeFacts> => {
    if (!pathExists(path)) {
      return { path, branch: "(path missing)", head: "?", ahead: [], dirty: -1 };
    }
    const [branch, head, aheadRaw, dirtyRaw] = await Promise.all([
      run("git", ["rev-parse", "--abbrev-ref", "HEAD"], path),
      run("git", ["rev-parse", "HEAD"], path),
      run("git", ["log", "origin/main..HEAD", "--format=%H %s"], path),
      run("git", ["status", "--porcelain"], path),
    ]);
    const ahead =
      aheadRaw === null
        ? []
        : aheadRaw
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41) }));
    const dirty = dirtyRaw === null ? -1 : dirtyRaw.split("\n").filter((l) => l.trim()).length;
    return { path, branch: branch ?? "?", head: head ?? "?", ahead, dirty };
  });
}

type WorkerFacts = { pid: string; cwd: string };

async function workerFacts(repo: string): Promise<WorkerFacts[] | string> {
  const out = await run("pgrep", ["-a", "-f", repo], repo);
  if (out === null) return "pgrep unavailable — worker processes unmeasured, not assumed absent";
  const pids = out
    .split("\n")
    .filter((line) => /opencode run --dir|grok/.test(line) && line.includes(repo))
    .map((line) => line.split(/\s+/)[0] ?? "?");
  return mapPool(pids, CONCURRENCY, async (pid): Promise<WorkerFacts> => {
    const cwd = await run("lsof", ["-a", "-p", pid, "-d", "cwd", "-F", "n"], repo);
    const dir = cwd?.split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? "(cwd unreadable)";
    return { pid, cwd: dir };
  });
}

export async function renderHandoff(opts: HandoffOptions): Promise<string> {
  const { repo, lane, results, cards } = opts;
  const lines: string[] = [`# handoff: ${lane}`, ""];
  lines.push("## Mechanical (gathered by commands, verify with git before acting)", "");
  const trees = await worktreeFacts(repo);
  lines.push("### Worktrees", "");
  if (trees === null) {
    lines.push("not a readable git repo — worktrees unmeasured, not assumed clean");
  } else if (trees.length === 0) {
    lines.push("(no worktrees listed)");
  } else {
    for (const t of trees) {
      lines.push(`- path: ${t.path}`);
      lines.push(`  branch: ${t.branch}`);
      lines.push(`  HEAD: ${t.head}`);
      lines.push(`  dirty files: ${t.dirty < 0 ? "unmeasured" : t.dirty}`);
      lines.push(`  commits ahead of origin/main: ${t.ahead.length}`);
      for (const c of t.ahead) lines.push(`    - ${c.sha} ${c.subject}`);
    }
  }
  lines.push("", "### Worker processes", "");
  const workers = await workerFacts(repo);
  if (typeof workers === "string") {
    lines.push(workers);
  } else if (workers.length === 0) {
    lines.push("(no `opencode run --dir` / `grok` processes matched this worktree path)");
  } else {
    for (const w of workers) lines.push(`- pid ${w.pid}, cwd ${w.cwd}`);
  }
  lines.push("", "### RESULT files (last line each)", "");
  if (results.length === 0) {
    lines.push("(no --result given)");
  } else {
    for (const r of results) lines.push(`- ${r}: ${lastLineOf(r)}`);
  }
  lines.push("", "### Open board cards (listed only, board not polled)", "");
  if (cards.length === 0) {
    lines.push("(no --card given)");
  } else {
    for (const c of cards) lines.push(`- ${c}`);
  }
  lines.push(
    "",
    "## Decisions and why",
    "",
    "(model: fill in)",
    "",
    "## Gates and their sources",
    "",
    "(model: gate name + the command or file that proves it, per gate)",
    "",
    "## Store paths this lane owns",
    "",
    "(model: card-owned paths. Rule: a new store output goes to a new card-owned path; " +
      "an existing store path cited by a tracked report is read-only.)",
    "",
    "## Next action",
    "",
    "(model: fill in)",
    "",
    "---",
    "",
    `You are resuming lane ${lane}. Read .openclinxr/handoffs/${lane}.md, verify every mechanical fact with git before acting, then do Next action.`,
    "",
  );
  return lines.join("\n");
}

export async function writeHandoff(opts: HandoffOptions): Promise<string> {
  const out = opts.out ?? join(opts.repo, ".openclinxr", "handoffs", `${opts.lane}.md`);
  mkdirSync(join(opts.repo, ".openclinxr", "handoffs"), { recursive: true });
  writeFileSync(out, await renderHandoff(opts));
  return out;
}

function parseArgs(argv: string[]): HandoffOptions | null {
  const [cmd, lane] = argv;
  if (cmd !== "write" || !lane) return null;
  const opts: HandoffOptions = { repo: process.cwd(), lane, results: [], cards: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag === "--result" || flag === "--card" || flag === "--repo" || flag === "--out") && value) {
      if (flag === "--result") opts.results.push(value);
      else if (flag === "--card") opts.cards.push(value);
      else if (flag === "--repo") opts.repo = value;
      else opts.out = value;
      i += 1;
    } else {
      return null;
    }
  }
  return opts;
}

const invokedDirectly = process.argv[1]?.endsWith("handoff.ts") ?? false;
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    process.stderr.write(
      "usage: handoff.ts write <lane> [--result <path> ...] [--card <id> ...] [--repo <path>] [--out <path>]\n",
    );
    process.exit(2);
  }
  writeHandoff(opts).then(
    (out) => process.stdout.write(`${out}\n`),
    (error) => {
      process.stderr.write(`handoff failed: ${String(error)}\n`);
      process.exit(1);
    },
  );
}
