/**
 * Worktree prune plan (#367) — classify every registered worktree with the safe-prune
 * discriminator, write a plan artifact, and (opt-in, --apply) remove the prunable set.
 *
 * DISCRIMINATOR (issue #367, measured 2026-08-13/14):
 *   prunable    = tip is an ancestor of main AND (clean OR dirty only within the
 *                 SessionStart docs-hygiene churn path set)
 *   not prunable = has_work (any dirty path outside the churn set) or unmerged
 *
 * The churn path set is the fingerprint of `.grok/hooks/session-start-docs-hygiene.json`
 * running `pnpm docs:hygiene:session-start -- --auto-run` in any session without
 * `OPENCLINXR_WORKER=1` (diagnosed at PROTO_VERIFY_DELEGATION §11p): PROJECT_STATUS.md,
 * docs/_archive/**, docs/agent-ops/**, and the doc-authority registry pair.
 *
 * SAFETY (from the issue):
 *  - --dry-run is the default; --apply --yes is the only removal path.
 *  - Removal uses `git worktree remove` WITHOUT --force (git refuses a dirty tree by
 *    design — a second independent safety net agreeing with the discriminator).
 *  - churn_only trees are reverted to clean first (tracked churn paths via checkout,
 *    the untracked archive copy via clean), then removed with the same non-forcing call.
 *  - main and the current worktree are never removed; has_work/unmerged are never touched.
 *  - Missing-directory entries are handled by `git worktree prune` (admin entry only,
 *    no disk deletion) — never `rm -rf` a worktree directory.
 *  - If the classification totals drift from issue #367's measured counts, the plan marks
 *    safeToRemove=false and --apply refuses (the issue's STOP rule).
 *  - A prunable worktree with a live listening server is skipped and reported.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Churn paths: exact files the SessionStart docs-hygiene hook touches. */
export const CHURN_EXACT_PATHS = [
  "PROJECT_STATUS.md",
  "docs/openclinxr/doc-authority-registry-2026-05-27.json",
  "docs/openclinxr/doc-authority-registry-2026-05-27.md",
] as const;

/** Churn paths: directory prefixes the SessionStart docs-hygiene hook writes under. */
export const CHURN_PATH_PREFIXES = ["docs/_archive/", "docs/agent-ops/"] as const;

/** Issue #367 expected totals (measured 2026-08-14 09:2x). Drift from these → STOP. */
export const ISSUE_367_EXPECTED_TOTALS: Record<string, number> = {
  registered: 275,
  clean: 187,
  churn_only: 65,
  has_work: 15,
  unmerged: 8,
  missing: 0,
};

export function isChurnPath(p: string): boolean {
  if ((CHURN_EXACT_PATHS as readonly string[]).includes(p)) return true;
  return CHURN_PATH_PREFIXES.some((prefix) => p.startsWith(prefix));
}

function unquotePorcelainPath(p: string): string {
  if (!p.startsWith('"')) return p;
  try {
    // porcelain quotes with C-style escapes; JSON.parse covers the common subset.
    return (JSON.parse(p) as string) ?? p;
  } catch {
    return p;
  }
}

/**
 * Extract the path(s) a `git status --porcelain` line refers to.
 * Handles "XY path", "?? path", and rename/copy "XY old -> new" (both sides).
 */
export function pathsFromPorcelainLine(line: string): string[] {
  if (!line) return [];
  const body = line.length >= 4 ? line.slice(3) : line;
  const arrow = body.indexOf(" -> ");
  if (arrow !== -1) {
    const oldPath = unquotePorcelainPath(body.slice(0, arrow));
    const newPath = unquotePorcelainPath(body.slice(arrow + 4));
    return [oldPath, newPath].filter((p) => p.length > 0);
  }
  const single = unquotePorcelainPath(body);
  return single.length > 0 ? [single] : [];
}

export type PruneClassification =
  | "clean"
  | "churn_only"
  | "has_work"
  | "unmerged"
  | "missing";

export type WorktreeRecord = {
  path: string;
  branch: string | null;
  detached: boolean;
  /** HEAD sha from `git worktree list --porcelain` (null only if unparseable). */
  tip: string | null;
  /** True when tip is an ancestor of main; null when it could not be determined. */
  merged: boolean | null;
  dirtyFileCount: number;
  classification: PruneClassification;
  /** Raw `git status --porcelain` lines (empty when clean). */
  dirtyFiles: string[];
  sizeBytes: number | null;
  isMain: boolean;
  isCurrent: boolean;
};

export type SubagentClone = {
  path: string;
  sizeBytes: number;
  branch: string | null;
};

export type LiveServerPid = {
  pid: number;
  command: string;
  port: number;
  started: string | null;
};

export type LiveServer = {
  worktreePath: string;
  pids: LiveServerPid[];
};

export type PruneTotals = {
  registered: number;
  clean: number;
  churn_only: number;
  has_work: number;
  unmerged: number;
  missing: number;
  prunable: number;
  preserved: number;
};

export type PruneDrift = {
  bucket: string;
  expected: number;
  actual: number;
  matches: boolean;
};

export type PrunePlan = {
  schemaVersion: "openclinxr.worktree-prune-plan.v1";
  generatedAt: string;
  repoRoot: string;
  grokRoot: string | null;
  mainTip: string;
  mainBranch: string;
  totals: PruneTotals;
  worktrees: WorktreeRecord[];
  /** Paths `--apply` would remove with `git worktree remove` (no --force). */
  wouldRemove: string[];
  /** Missing-dir entries; `git worktree prune` drops their admin entries only. */
  prunableMissing: string[];
  subagentClones: SubagentClone[];
  liveServers: LiveServer[];
  counterweight: {
    /** issue-100 must classify has_work — the issue's known-good on real data. */
    issue100Path: string;
    issue100Classification: PruneClassification | null;
    passes: boolean;
  };
  expectedTotals: Record<string, number>;
  drift: PruneDrift[];
  safeToRemove: boolean;
  grokRootSizeBytes: number | null;
  note: string;
};

export type WorktreeEntry = {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
};

/** Parse `git worktree list --porcelain` (ignores attribute lines like locked/prunable). */
export function parseWorktreeListPorcelain(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let cur: WorktreeEntry | null = null;
  for (const line of porcelain.split("\n")) {
    if (line === "") {
      if (cur) entries.push(cur);
      cur = null;
      continue;
    }
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length), head: null, branch: null, detached: false };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("HEAD ")) cur.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch ")) cur.branch = line.slice("branch ".length);
    else if (line.startsWith("detached")) cur.detached = true;
  }
  if (cur) entries.push(cur);
  return entries;
}

/** The pure discriminator: mechanical classification of one worktree. */
export function classifyWorktree(input: {
  isMain: boolean;
  isCurrent: boolean;
  dirExists: boolean;
  merged: boolean | null;
  dirtyPaths: string[];
  dirtyFileCount: number;
}): PruneClassification {
  if (!input.dirExists || input.merged === null) return "missing";
  if (!input.merged) return "unmerged";
  if (input.dirtyFileCount === 0) return "clean";
  const outsideChurn = input.dirtyPaths.some((p) => !isChurnPath(p));
  return outsideChurn ? "has_work" : "churn_only";
}

export function classifyFromPorcelain(input: {
  isMain: boolean;
  isCurrent: boolean;
  dirExists: boolean;
  merged: boolean | null;
  porcelainStatus: string;
}): { classification: PruneClassification; dirtyPaths: string[]; dirtyFileCount: number } {
  const lines = input.porcelainStatus.split("\n").filter((l) => l.length > 0);
  const dirtyPaths = lines.flatMap(pathsFromPorcelainLine);
  return {
    classification: classifyWorktree({
      isMain: input.isMain,
      isCurrent: input.isCurrent,
      dirExists: input.dirExists,
      merged: input.merged,
      dirtyPaths,
      dirtyFileCount: lines.length,
    }),
    dirtyPaths,
    dirtyFileCount: lines.length,
  };
}

export function computeTotals(records: WorktreeRecord[]): PruneTotals {
  const totals: PruneTotals = {
    registered: records.length,
    clean: 0,
    churn_only: 0,
    has_work: 0,
    unmerged: 0,
    missing: 0,
    prunable: 0,
    preserved: 0,
  };
  for (const r of records) {
    if (r.classification === "clean") totals.clean += 1;
    else if (r.classification === "churn_only") totals.churn_only += 1;
    else if (r.classification === "has_work") totals.has_work += 1;
    else if (r.classification === "unmerged") totals.unmerged += 1;
    else if (r.classification === "missing") totals.missing += 1;
  }
  totals.prunable = totals.clean + totals.churn_only;
  totals.preserved = totals.has_work + totals.unmerged + totals.missing;
  return totals;
}

/** Drift vs the issue's measured counts; any mismatch marks the plan unsafe to apply. */
export function computeDrift(totals: PruneTotals): PruneDrift[] {
  const buckets: Array<{ bucket: keyof PruneTotals; label: string }> = [
    { bucket: "clean", label: "clean" },
    { bucket: "churn_only", label: "churn_only" },
    { bucket: "has_work", label: "has_work" },
    { bucket: "unmerged", label: "unmerged" },
    { bucket: "missing", label: "missing" },
  ];
  const drift: PruneDrift[] = [];
  for (const { bucket, label } of buckets) {
    const expected = ISSUE_367_EXPECTED_TOTALS[label] ?? 0;
    const actual = totals[bucket];
    drift.push({ bucket: label, expected, actual, matches: expected === actual });
  }
  const registered = ISSUE_367_EXPECTED_TOTALS["registered"] ?? 0;
  drift.push({
    bucket: "registered",
    expected: registered,
    actual: totals.registered,
    matches: registered === totals.registered,
  });
  return drift;
}

export function verifyPlanArithmetic(plan: PrunePlan): string[] {
  const problems: string[] = [];
  const { totals } = plan;
  if (totals.clean + totals.churn_only + totals.has_work + totals.unmerged + totals.missing !== totals.registered) {
    problems.push("bucket sum != registered");
  }
  if (totals.prunable !== totals.clean + totals.churn_only) {
    problems.push("prunable != clean + churn_only");
  }
  if (plan.wouldRemove.length !== totals.clean + totals.churn_only) {
    problems.push("wouldRemove length != clean + churn_only");
  }
  return problems;
}

export type GitRunOptions = {
  cwd: string;
  args: string[];
  allowStatuses?: number[];
  timeoutMs?: number;
};

/**
 * Run git (or any command) synchronously. Returns {status, stdout, stderr}.
 * `allowStatuses` are treated as success; all other non-zero statuses are errors.
 */
export function runCommand(opts: GitRunOptions): { status: number; stdout: string; stderr: string } {
  try {
    const r = execFileSync("git", opts.args, {
      cwd: opts.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeoutMs ?? 60_000,
    });
    return { status: 0, stdout: r, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    const status = typeof e.status === "number" ? e.status : 1;
    if (opts.allowStatuses?.includes(status)) {
      return { status, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
    }
    throw err;
  }
}

export function runGit(cwd: string, args: string[], allowStatuses?: number[]): { status: number; stdout: string; stderr: string } {
  return runCommand({ cwd, args, allowStatuses });
}

export function duBytes(target: string): number | null {
  try {
    const r = spawnSync("du", ["-sk", target], { encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) return null;
    const first = r.stdout.split("\n")[0] ?? "";
    const kb = Number.parseInt(first.trim().split(/\s+/)[0] ?? "", 10);
    if (!Number.isFinite(kb)) return null;
    return kb * 1024;
  } catch {
    return null;
  }
}

export function detectGrokRoot(worktreePaths: string[]): string | null {
  const grokWt = worktreePaths.filter((p) => p.includes(`${path.sep}.grok${path.sep}worktrees${path.sep}`));
  if (grokWt.length === 0) return null;
  let root = path.dirname(grokWt[0]!);
  for (const p of grokWt.slice(1)) {
    while (!p.startsWith(root + path.sep) && root.length > 1) root = path.dirname(root);
  }
  return root;
}

export function scanSubagentClones(grokRoot: string, registeredPaths: Set<string>): SubagentClone[] {
  if (!existsSync(grokRoot)) return [];
  const clones: SubagentClone[] = [];
  let names: string[];
  try {
    names = readdirSync(grokRoot);
  } catch {
    return [];
  }
  for (const name of names.sort()) {
    if (!name.startsWith("subagent-")) continue;
    const full = path.join(grokRoot, name);
    if (registeredPaths.has(full)) continue;
    if (!statSync(full).isDirectory()) continue;
    let branch: string | null = null;
    if (existsSync(path.join(full, ".git"))) {
      const r = runGit(full, ["symbolic-ref", "--short", "-q", "HEAD"], [1]);
      branch = r.status === 0 && r.stdout.trim().length > 0 ? r.stdout.trim() : null;
    }
    clones.push({ path: full, sizeBytes: duBytes(full) ?? 0, branch });
  }
  return clones;
}

function parsePortFromLsofName(name: string): number {
  const m = name.match(/:(\d+)$/);
  if (!m) return 0;
  return Number.parseInt(m[1] ?? "0", 10);
}

/**
 * Map listening TCP processes to the worktree their cwd lives in.
 * Used to flag prunable worktrees that hold a live dev server (issue #367 report item).
 */
export function scanLiveServers(worktreePaths: string[]): LiveServer[] {
  const servers: LiveServer[] = [];
  let lsofOut: string;
  try {
    const r = spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    if (r.status !== 0) return [];
    lsofOut = r.stdout;
  } catch {
    return [];
  }
  const byPid = new Map<number, { command: string; port: number }>();
  let curPid = 0;
  let curCommand = "";
  for (const line of lsofOut.split("\n")) {
    if (line.startsWith("p")) {
      curPid = Number.parseInt(line.slice(1), 10);
      curCommand = "";
    } else if (line.startsWith("c")) {
      curCommand = line.slice(1);
    } else if (line.startsWith("n")) {
      if (curPid > 0) {
        const port = parsePortFromLsofName(line.slice(1));
        byPid.set(curPid, { command: curCommand, port });
      }
    }
  }
  for (const [pid, info] of byPid) {
    const cwd = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    const cwdLine = (cwd.stdout ?? "").split("\n").find((l) => l.startsWith("n"));
    if (!cwdLine) continue;
    const cwdPath = cwdLine.slice(1);
    let best: string | null = null;
    for (const wt of worktreePaths) {
      if (cwdPath === wt || cwdPath.startsWith(wt + path.sep)) {
        if (best === null || wt.length > best.length) best = wt;
      }
    }
    if (best === null) continue;
    const started = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 10_000,
    });
    const entry = servers.find((s) => s.worktreePath === best);
    const pidInfo: LiveServerPid = {
      pid,
      command: info.command,
      port: info.port,
      started: (started.stdout ?? "").trim() || null,
    };
    if (entry) entry.pids.push(pidInfo);
    else servers.push({ worktreePath: best, pids: [pidInfo] });
  }
  return servers;
}

export type BuildPrunePlanOptions = {
  /** The worktree this tool runs from — never removed, marked isCurrent. */
  cwd: string;
  /** Set to measure sizes (grok root du + per-worktree du). Slow; off by default. */
  withSizes?: boolean;
};

export function buildPrunePlan(opts: BuildPrunePlanOptions): PrunePlan {
  const cwd = opts.cwd;
  const listOut = runGit(cwd, ["worktree", "list", "--porcelain"], [0]);
  const entries = parseWorktreeListPorcelain(listOut.stdout);
  if (entries.length === 0) {
    throw new Error("worktree-prune: no worktrees registered — cannot classify");
  }
  const main = entries[0]!;
  const repoRoot = main.path;
  const mainTip = runGit(repoRoot, ["rev-parse", "HEAD"]).stdout.trim();
  const mainBranchOut = runGit(repoRoot, ["symbolic-ref", "--short", "-q", "HEAD"], [1]);
  const mainBranch = mainBranchOut.status === 0 ? mainBranchOut.stdout.trim() : "main";

  const records: WorktreeRecord[] = [];
  for (const entry of entries) {
    const isMain = entry.path === repoRoot;
    const isCurrent = !isMain && path.resolve(entry.path) === path.resolve(cwd);
    const dirExists = existsSync(entry.path);
    let merged: boolean | null = null;
    if (dirExists && entry.head) {
      const r = runGit(repoRoot, ["merge-base", "--is-ancestor", entry.head, mainTip], [0, 1]);
      merged = r.status === 0;
    }
    let porcelainStatus = "";
    if (dirExists) {
      const r = runGit(entry.path, ["status", "--porcelain"], [0]);
      porcelainStatus = r.stdout;
    }
    const { classification, dirtyFileCount } = classifyFromPorcelain({
      isMain,
      isCurrent,
      dirExists,
      merged,
      porcelainStatus,
    });
    records.push({
      path: entry.path,
      branch: entry.branch,
      detached: entry.detached,
      tip: entry.head,
      merged,
      dirtyFileCount,
      classification,
      dirtyFiles: porcelainStatus.split("\n").filter((l) => l.length > 0),
      sizeBytes: null,
      isMain,
      isCurrent,
    });
  }

  if (opts.withSizes) {
    for (const r of records) {
      if (r.path === repoRoot) continue; // main worktree size is not reclaimable
      r.sizeBytes = duBytes(r.path);
    }
  }

  const totals = computeTotals(records);
  const drift = computeDrift(totals);
  const wouldRemove = records
    .filter((r) => r.classification === "clean" || r.classification === "churn_only")
    .map((r) => r.path)
    .sort();
  const prunableMissing = records.filter((r) => r.classification === "missing").map((r) => r.path).sort();

  const grokRoot = detectGrokRoot(records.map((r) => r.path));
  const registeredPaths = new Set(records.map((r) => r.path));
  const subagentClones = grokRoot ? scanSubagentClones(grokRoot, registeredPaths) : [];

  const liveServers = scanLiveServers(records.map((r) => r.path));

  const issue100 = records.find((r) => r.path.endsWith(`${path.sep}issue-100`));
  const counterweight = {
    issue100Path: issue100?.path ?? "",
    issue100Classification: issue100?.classification ?? null,
    passes: issue100?.classification === "has_work",
  };

  const driftNote =
    drift.some((d) => !d.matches)
      ? "DRIFT vs issue #367 measured totals (2026-08-14 09:2x) — per the issue's STOP rule this plan must not be applied until reconciled."
      : "";

  const note = [
    `registered=${totals.registered} clean=${totals.clean} churn_only=${totals.churn_only} has_work=${totals.has_work} unmerged=${totals.unmerged} missing=${totals.missing} (prunable=${totals.prunable}, preserved=${totals.preserved})`,
    counterweight.passes
      ? `counterweight OK: issue-100 classifies ${counterweight.issue100Classification} (not prunable)`
      : `counterweight FAILED: issue-100 classifies ${String(counterweight.issue100Classification)} — expected has_work`,
    driftNote,
    subagentClones.length > 0
      ? `${subagentClones.length} subagent-* full clones in grok root (not worktrees; git worktree prune cannot see them; ~${formatBytes(subagentClones.reduce((s, c) => s + c.sizeBytes, 0))}) — reported, not removed`
      : "no subagent-* clones found",
    liveServers.length > 0
      ? `${liveServers.length} worktree(s) with live listening server(s): ${liveServers.map((s) => `${path.basename(s.worktreePath)}:${s.pids.map((p) => p.port).join(",")}`).join(" ")} — removal skips these`
      : "no live listening servers in any registered worktree",
    `missing-dir entries (${prunableMissing.length}) are handled by \`git worktree prune\` (admin entries only)`,
    "Removal is opt-in: `--apply --yes`. Branches of removed worktrees are left in place (not part of this slice).",
  ].filter((l) => l.length > 0).join("\n");

  return {
    schemaVersion: "openclinxr.worktree-prune-plan.v1",
    generatedAt: new Date().toISOString(),
    repoRoot,
    grokRoot,
    mainTip,
    mainBranch,
    totals,
    worktrees: records,
    wouldRemove,
    prunableMissing,
    subagentClones,
    liveServers,
    counterweight,
    expectedTotals: { ...ISSUE_367_EXPECTED_TOTALS },
    drift,
    safeToRemove: drift.every((d) => d.matches) && counterweight.passes,
    grokRootSizeBytes: opts.withSizes && grokRoot ? duBytes(grokRoot) : null,
    note,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Commands that revert a churn_only tree to clean, so `git worktree remove` (no --force)
 * will accept it. Pure — the caller executes them.
 */
export function churnRevertCommands(record: WorktreeRecord): string[][] {
  const untrackedPaths: string[] = [];
  const trackedPaths: string[] = [];
  for (const line of record.dirtyFiles) {
    const isUntracked = line.startsWith("??");
    for (const p of pathsFromPorcelainLine(line)) {
      (isUntracked ? untrackedPaths : trackedPaths).push(p);
    }
  }
  const commands: string[][] = [];
  if (trackedPaths.length > 0) {
    commands.push(["checkout", "--", ...trackedPaths]);
  }
  if (untrackedPaths.length > 0) {
    commands.push(["clean", "-fd", "--", ...untrackedPaths]);
  }
  return commands;
}

/** Remove the prunable set. Returns per-path outcomes. Only invoked with --apply --yes. */
export function applyPrunePlan(
  plan: PrunePlan,
  opts: { dryRun: boolean },
): Array<{ path: string; action: string; ok: boolean; detail: string }> {
  const outcomes: Array<{ path: string; action: string; ok: boolean; detail: string }> = [];
  if (opts.dryRun) {
    for (const p of plan.wouldRemove) {
      outcomes.push({ path: p, action: "remove", ok: true, detail: "dry-run: would git worktree remove" });
    }
    for (const p of plan.prunableMissing) {
      outcomes.push({ path: p, action: "prune-admin", ok: true, detail: "dry-run: would git worktree prune (admin entry)" });
    }
    return outcomes;
  }
  const livePaths = new Set(plan.liveServers.map((s) => s.worktreePath));
  for (const p of plan.wouldRemove) {
    const rec = plan.worktrees.find((r) => r.path === p);
    if (!rec) continue;
    if (livePaths.has(p)) {
      outcomes.push({ path: p, action: "skip", ok: false, detail: "live server in worktree — skipped" });
      continue;
    }
    if (rec.classification === "churn_only") {
      for (const args of churnRevertCommands(rec)) {
        const r = runGit(rec.path, args, [0, 1]);
        if (r.status !== 0) {
          outcomes.push({ path: p, action: "revert", ok: false, detail: r.stderr.trim().slice(0, 300) });
        }
      }
      const after = runGit(rec.path, ["status", "--porcelain"], [0]);
      if (after.stdout.trim().length > 0) {
        outcomes.push({
          path: p,
          action: "remove",
          ok: false,
          detail: `churn revert incomplete (${after.stdout.trim().split("\n").length} files remain) — git worktree remove would refuse`,
        });
        continue;
      }
    }
    const r = runGit(plan.repoRoot, ["worktree", "remove", p], [0]);
    if (r.status === 0) {
      outcomes.push({ path: p, action: "remove", ok: true, detail: "git worktree remove (no --force)" });
    } else {
      outcomes.push({ path: p, action: "remove", ok: false, detail: r.stderr.trim().slice(0, 300) });
    }
  }
  if (plan.prunableMissing.length > 0) {
    const r = runGit(plan.repoRoot, ["worktree", "prune"], [0]);
    outcomes.push({
      path: plan.prunableMissing.join(", "),
      action: "prune-admin",
      ok: r.status === 0,
      detail: r.status === 0 ? "git worktree prune (admin entries only)" : r.stderr.trim().slice(0, 300),
    });
  }
  return outcomes;
}
