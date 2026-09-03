/**
 * Worktree promote CLI — close the isolation=worktree loop:
 * writer edits in harness worktree → promote allowed paths into main workspace.
 *
 * Commands:
 *   list    — list ~/.grok/worktrees entries matching this repo
 *   status  — git status --short + changed files for a role worktree
 *   promote — copy writeRoots-allowed (and role handoff) files to main
 *
 * Exit codes (promote):
 *   0 — all intended promotions ok (or nothing to promote)
 *   2 — one or more files skipped due to path-scope while files were attempted
 *   1 — hard errors (missing worktree/policy, git/copy failure)
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";
import {
  getRepoRoleHarnessPolicy,
  pathMatchesAnyGlob,
} from "../../../packages/openclinxr/agent-loop/src/role-harness-policy.js";

export const WORKTREE_PROMOTE_SCHEMA = "openclinxr.worktree-promote.v1" as const;

export type WorktreeListEntry = {
  path: string;
  mtimeMs: number;
  mtimeIso: string;
};

export type PromoteReport = {
  schemaVersion: typeof WORKTREE_PROMOTE_SCHEMA;
  sliceId: string;
  roleId: string;
  worktreePath: string;
  mainRepo: string;
  dryRun: boolean;
  writeRoots: string[];
  changed: string[];
  promoted: string[];
  skipped: Array<{ path: string; reason: string }>;
  errors: string[];
  updatedAt: string;
};

export type ResolveWorktreeOptions = {
  worktreePath?: string | undefined;
  envWorktree?: string | undefined;
  sliceId: string;
  roleId: string;
  homeDir?: string | undefined;
  repoBasename?: string | undefined;
};

/** Normalize repo-relative path for glob matching. */
export function normalizeRepoRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Allow promote when path matches role writeRoots OR the role handoff JSON
 * under .openclinxr/slices/.../handoffs/{roleId}.json (double-star glob).
 */
export function isPathAllowedForPromote(
  relativePath: string,
  writeRoots: string[],
  roleId: string,
): boolean {
  const normalized = normalizeRepoRelativePath(relativePath);
  if (pathMatchesAnyGlob(normalized, writeRoots)) return true;
  // double-star between slices and handoffs so any slice id matches
  const handoffGlob = [".openclinxr/slices/", "**", `/handoffs/${roleId}.json`].join("");
  return pathMatchesAnyGlob(normalized, [handoffGlob]);
}

/** Partition changed paths into allowed vs path-scope skipped. */
export function partitionPromotePaths(
  changed: string[],
  writeRoots: string[],
  roleId: string,
): { allowed: string[]; skipped: Array<{ path: string; reason: string }> } {
  const allowed: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const raw of changed) {
    const p = normalizeRepoRelativePath(raw);
    if (isPathAllowedForPromote(p, writeRoots, roleId)) {
      allowed.push(p);
    } else {
      skipped.push({
        path: p,
        reason: "outside writeRoots and not role handoff path",
      });
    }
  }
  return { allowed, skipped };
}

/**
 * Parse `git status --short` / porcelain v1 lines into repo-relative paths.
 * Prefer rename/copy destination when ` -> ` is present. Skip pure deletes
 * when status index/worktree is D (nothing to copy).
 */
export function parseGitStatusShort(output: string): {
  paths: string[];
  deleted: string[];
} {
  const paths: string[] = [];
  const deleted: string[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    // XY<path> or XY <path> — porcelain uses two status chars then space
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    let rest = line.slice(3).trim();
    // quoted paths
    if (rest.startsWith('"') && rest.endsWith('"')) {
      rest = rest.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
    let target = rest;
    if (rest.includes(" -> ")) {
      const parts = rest.split(" -> ");
      target = parts[parts.length - 1]!.trim();
      if (target.startsWith('"') && target.endsWith('"')) {
        target = target.slice(1, -1);
      }
    }
    target = normalizeRepoRelativePath(target);
    // Pure delete in index and worktree: nothing to promote
    if (xy === "D " || xy === " D" || xy === "DD") {
      deleted.push(target);
      continue;
    }
    if (target) paths.push(target);
  }
  return { paths, deleted };
}

export function defaultGrokWorktreesRoot(homeDir: string = homedir()): string {
  return path.join(homeDir, ".grok", "worktrees");
}

/** Repo basename match: openclinxr, src-openclinxr, *openclinxr*. */
export function worktreeDirMatchesRepo(name: string, repoBasename: string): boolean {
  const n = name.toLowerCase();
  const b = repoBasename.toLowerCase();
  if (n === b) return true;
  if (n.includes(b)) return true;
  if (b.includes("openclinxr") && n.includes("openclinxr")) return true;
  return false;
}

/**
 * List candidate worktree directories under ~/.grok/worktrees matching repo.
 * Layout observed: ~/.grok/worktrees/src-openclinxr/subagent-<id>/
 * Also supports flat ~/.grok/worktrees/*openclinxr*.
 */
export function listMatchingWorktrees(
  homeDir: string = homedir(),
  repoBasename: string = "openclinxr",
): WorktreeListEntry[] {
  const root = defaultGrokWorktreesRoot(homeDir);
  const entries: WorktreeListEntry[] = [];
  if (!existsSync(root)) return entries;

  const pushIfDir = (dirPath: string): void => {
    try {
      const st = statSync(dirPath);
      if (!st.isDirectory()) return;
      entries.push({
        path: dirPath,
        mtimeMs: st.mtimeMs,
        mtimeIso: new Date(st.mtimeMs).toISOString(),
      });
    } catch {
      // skip unreadable
    }
  };

  let top: string[] = [];
  try {
    top = readdirSync(root);
  } catch {
    return entries;
  }

  for (const name of top) {
    if (name.startsWith(".")) continue;
    const full = path.join(root, name);
    if (!worktreeDirMatchesRepo(name, repoBasename)) continue;
    // If this is a container (src-openclinxr), list children as worktrees
    try {
      const st = statSync(full);
      if (!st.isDirectory()) continue;
      const children = readdirSync(full);
      const subagentKids = children.filter(
        (c) => c.startsWith("subagent-") || c.startsWith("worktree-"),
      );
      if (subagentKids.length > 0) {
        for (const child of subagentKids) {
          pushIfDir(path.join(full, child));
        }
      } else {
        // flat match dir itself may be a worktree
        pushIfDir(full);
      }
    } catch {
      // skip
    }
  }

  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function handoffRelativePath(sliceId: string, roleId: string): string {
  return path.posix.join(".openclinxr", "slices", sliceId, "handoffs", `${roleId}.json`);
}

/**
 * Resolve worktree path:
 * 1. --worktree-path
 * 2. OPENCLINXR_WORKTREE / envWorktree
 * 3. newest matching worktree that contains the slice handoff for role
 * 4. newest matching worktree (fallback)
 */
export function resolveWorktreePath(options: ResolveWorktreeOptions): string | null {
  if (options.worktreePath && options.worktreePath.trim()) {
    return path.resolve(options.worktreePath.trim());
  }
  const envWt = options.envWorktree ?? process.env["OPENCLINXR_WORKTREE"];
  if (envWt && envWt.trim()) {
    return path.resolve(envWt.trim());
  }

  const homeDir = options.homeDir ?? homedir();
  const repoBasename = options.repoBasename ?? path.basename(process.cwd());
  const candidates = listMatchingWorktrees(homeDir, repoBasename);
  if (candidates.length === 0) return null;

  const handoffRel = handoffRelativePath(options.sliceId, options.roleId);
  for (const c of candidates) {
    if (existsSync(path.join(c.path, handoffRel))) {
      return c.path;
    }
  }
  // Fallback: newest openclinxr worktree
  return candidates[0]?.path ?? null;
}

export function mapWorktreePathToMain(
  relativePath: string,
  mainRepo: string,
): string {
  return path.join(mainRepo, normalizeRepoRelativePath(relativePath));
}

export function mapWorktreeSourcePath(
  relativePath: string,
  worktreePath: string,
): string {
  return path.join(worktreePath, normalizeRepoRelativePath(relativePath));
}

/**
 * Expand git status paths: if a path is a directory in the worktree
 * (common for untracked dirs like `docs/agent-ops/`), list all files under it.
 * Files pass through unchanged. Missing paths kept as-is for error reporting.
 */
export function expandPathsToFiles(relativePaths: string[], worktreePath: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const walk = (absDir: string, relDir: string): void => {
    let kids: string[] = [];
    try {
      kids = readdirSync(absDir);
    } catch {
      return;
    }
    for (const name of kids) {
      if (name === ".git" || name === "node_modules") continue;
      const abs = path.join(absDir, name);
      const rel = normalizeRepoRelativePath(path.posix.join(relDir.replace(/\\/g, "/"), name));
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs, rel);
      } else if (st.isFile()) {
        if (!seen.has(rel)) {
          seen.add(rel);
          out.push(rel);
        }
      }
    }
  };

  for (const raw of relativePaths) {
    const rel = normalizeRepoRelativePath(raw).replace(/\/$/, "");
    const abs = path.join(worktreePath, rel);
    if (!existsSync(abs)) {
      if (!seen.has(rel)) {
        seen.add(rel);
        out.push(rel);
      }
      continue;
    }
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, rel);
    } else if (st.isFile()) {
      if (!seen.has(rel)) {
        seen.add(rel);
        out.push(rel);
      }
    }
  }
  return out;
}

function runGitStatusShort(worktreePath: string): string {
  return execFileSync("git", ["-C", worktreePath, "status", "--short"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: gitEnvWithoutInheritedRepoVars(),
  });
}

function printHelp(): void {
  console.log(
    [
      "openclaw worktree-promote — promote isolation=worktree edits into main",
      "",
      "Usage:",
      "  pnpm openclaw:worktree:list",
      "  pnpm openclaw:worktree:status  -- --slice-id SLICE --role ROLE [--worktree-path PATH]",
      "  pnpm openclaw:worktree:promote -- --slice-id SLICE --role ROLE [--worktree-path PATH] [--dry-run]",
      "",
      "Promote rules:",
      "  - Only paths matching role pathScope.writeRoots OR role handoff JSON under slices",
      "  - Discovery: --worktree-path | OPENCLINXR_WORKTREE | newest ~/.grok/worktrees match with handoff",
      "  - Report: .openclinxr/openclaw/worktree-promote-SLICE-ROLE.json",
      "  - Does not delete worktrees (no cleanup without future --force)",
      "",
      "Exit codes (promote): 0 ok · 2 path-scope skips · 1 hard error",
      "",
    ].join("\n"),
  );
}

type CliFlags = {
  command: string;
  sliceId?: string | undefined;
  roleId?: string | undefined;
  worktreePath?: string | undefined;
  dryRun: boolean;
  help: boolean;
  json: boolean;
};

export function parseWorktreePromoteArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    command: "help",
    dryRun: false,
    help: false,
    json: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--slice-id" && argv[i + 1]) {
      flags.sliceId = argv[++i];
    } else if (arg === "--role" && argv[i + 1]) {
      flags.roleId = argv[++i];
    } else if (arg === "--worktree-path" && argv[i + 1]) {
      flags.worktreePath = argv[++i];
    } else if (arg.startsWith("--")) {
      // unknown flag — ignore value pair if present
      if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) i += 1;
    } else {
      positional.push(arg);
    }
  }
  if (positional[0]) flags.command = positional[0]!;
  return flags;
}

function cmdList(json: boolean): number {
  const repoBasename = path.basename(process.cwd());
  const entries = listMatchingWorktrees(homedir(), repoBasename);
  if (json) {
    console.log(JSON.stringify({ repoBasename, count: entries.length, worktrees: entries }, null, 2));
  } else {
    if (entries.length === 0) {
      console.log(`No worktrees under ${defaultGrokWorktreesRoot()} matching ${repoBasename}`);
    } else {
      for (const e of entries) {
        console.log(`${e.mtimeIso}  ${e.path}`);
      }
      console.log(`# ${entries.length} worktree(s)`);
    }
  }
  return 0;
}

function requireSliceRole(flags: CliFlags): { sliceId: string; roleId: string } | null {
  if (!flags.sliceId || !flags.roleId) {
    console.error("error: --slice-id and --role are required");
    return null;
  }
  return { sliceId: flags.sliceId, roleId: flags.roleId };
}

function cmdStatus(flags: CliFlags): number {
  const ids = requireSliceRole(flags);
  if (!ids) return 1;
  const worktreePath = resolveWorktreePath({
    worktreePath: flags.worktreePath,
    sliceId: ids.sliceId,
    roleId: ids.roleId,
  });
  if (!worktreePath || !existsSync(worktreePath)) {
    console.error(
      `error: worktree not found (slice=${ids.sliceId} role=${ids.roleId}). Pass --worktree-path or set OPENCLINXR_WORKTREE.`,
    );
    return 1;
  }
  let raw: string;
  try {
    raw = runGitStatusShort(worktreePath);
  } catch (err) {
    console.error(`error: git status failed in ${worktreePath}: ${String(err)}`);
    return 1;
  }
  const { paths, deleted } = parseGitStatusShort(raw);
  const payload = {
    sliceId: ids.sliceId,
    roleId: ids.roleId,
    worktreePath,
    changed: paths,
    deleted,
    rawStatus: raw.trimEnd(),
  };
  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`worktree: ${worktreePath}`);
    console.log(`slice: ${ids.sliceId}  role: ${ids.roleId}`);
    if (!raw.trim()) {
      console.log("(clean)");
    } else {
      console.log(raw.trimEnd());
    }
    console.log(`# changed=${paths.length} deleted=${deleted.length}`);
  }
  return 0;
}

function cmdPromote(flags: CliFlags): number {
  const ids = requireSliceRole(flags);
  if (!ids) return 1;
  const mainRepo = process.cwd();
  const policy = getRepoRoleHarnessPolicy(ids.roleId);
  if (!policy) {
    console.error(`error: unknown roleId (no harness policy): ${ids.roleId}`);
    return 1;
  }
  const writeRoots = policy.pathScope.writeRoots;
  const worktreePath = resolveWorktreePath({
    worktreePath: flags.worktreePath,
    sliceId: ids.sliceId,
    roleId: ids.roleId,
  });
  if (!worktreePath || !existsSync(worktreePath)) {
    console.error(
      `error: worktree not found (slice=${ids.sliceId} role=${ids.roleId}). Pass --worktree-path or set OPENCLINXR_WORKTREE.`,
    );
    return 1;
  }

  const report: PromoteReport = {
    schemaVersion: WORKTREE_PROMOTE_SCHEMA,
    sliceId: ids.sliceId,
    roleId: ids.roleId,
    worktreePath,
    mainRepo,
    dryRun: flags.dryRun,
    writeRoots,
    changed: [],
    promoted: [],
    skipped: [],
    errors: [],
    updatedAt: new Date().toISOString(),
  };

  let raw: string;
  try {
    raw = runGitStatusShort(worktreePath);
  } catch (err) {
    report.errors.push(`git status failed: ${String(err)}`);
    writePromoteReport(mainRepo, report);
    console.error(report.errors[0]);
    return 1;
  }

  const { paths, deleted } = parseGitStatusShort(raw);
  const expanded = expandPathsToFiles(paths, worktreePath);
  report.changed = expanded;
  for (const d of deleted) {
    report.skipped.push({ path: d, reason: "deleted in worktree (promote copies files only)" });
  }

  const { allowed, skipped } = partitionPromotePaths(expanded, writeRoots, ids.roleId);
  report.skipped.push(...skipped);

  for (const rel of allowed) {
    const src = mapWorktreeSourcePath(rel, worktreePath);
    const dest = mapWorktreePathToMain(rel, mainRepo);
    if (!existsSync(src)) {
      report.errors.push(`missing source: ${src}`);
      continue;
    }
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(src);
    } catch (err) {
      report.errors.push(`stat failed ${rel}: ${String(err)}`);
      continue;
    }
    if (!st.isFile()) {
      report.skipped.push({ path: rel, reason: "not a regular file" });
      continue;
    }
    if (flags.dryRun) {
      console.log(`DRY-RUN promote ${rel}`);
      console.log(`  from ${src}`);
      console.log(`  to   ${dest}`);
      report.promoted.push(rel);
      continue;
    }
    try {
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      report.promoted.push(rel);
      console.log(`promoted ${rel}`);
    } catch (err) {
      report.errors.push(`copy failed ${rel}: ${String(err)}`);
    }
  }

  writePromoteReport(mainRepo, report);

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      JSON.stringify(
        {
          schemaVersion: report.schemaVersion,
          sliceId: report.sliceId,
          roleId: report.roleId,
          dryRun: report.dryRun,
          worktreePath: report.worktreePath,
          promoted: report.promoted.length,
          skipped: report.skipped.length,
          errors: report.errors.length,
          reportPath: promoteReportPath(mainRepo, ids.sliceId, ids.roleId),
        },
        null,
        2,
      ),
    );
  }

  if (report.errors.length > 0) return 1;
  // Exit 2 if any path-scope skips when files were attempted (changed files present)
  const scopeSkips = report.skipped.filter((s) => s.reason.includes("writeRoots"));
  if (scopeSkips.length > 0 && paths.length > 0) return 2;
  return 0;
}

export function promoteReportPath(mainRepo: string, sliceId: string, roleId: string): string {
  return path.join(mainRepo, ".openclinxr", "openclaw", `worktree-promote-${sliceId}-${roleId}.json`);
}

function writePromoteReport(mainRepo: string, report: PromoteReport): void {
  const out = promoteReportPath(mainRepo, report.sliceId, report.roleId);
  try {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch (err) {
    console.error(`warning: failed to write promote report ${out}: ${String(err)}`);
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const flags = parseWorktreePromoteArgs(argv);
  if (flags.help || flags.command === "help" || flags.command === "--help") {
    printHelp();
    return 0;
  }
  switch (flags.command) {
    case "list":
      return cmdList(flags.json);
    case "status":
      return cmdStatus(flags);
    case "promote":
      return cmdPromote(flags);
    default:
      console.error(`error: unknown command: ${flags.command}`);
      printHelp();
      return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main();
  process.exit(code);
}
