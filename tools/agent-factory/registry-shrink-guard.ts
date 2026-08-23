/**
 * Zero-tolerance shrink guard for protected registry regeneration (#116).
 *
 * A registry is a record: regeneration may add and update; any removal requires
 * an explicit opt-in. No numeric threshold (any number becomes a design target).
 *
 * Shared by:
 * - build-generated-artifact-registry.ts
 * - build-doc-authority-registry.ts
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Default existence probe: registered paths are repo-root-relative. (#580) */
function defaultPathExists(registeredPath: string): boolean {
  return existsSync(path.resolve(process.cwd(), registeredPath));
}

/** CLI flag accepted by both registry builders. */
export const ALLOW_SHRINK_FLAG = "--allow-shrink";

/** Env opt-in (same semantics as the flag). */
export const ALLOW_SHRINK_ENV = "OPENCLINXR_REGISTRY_ALLOW_SHRINK";

/** Paths shown in refusal / cleanup messages (full dumps are unusable). */
export const REMOVAL_SAMPLE_LIMIT = 20;

export type ShrinkGuardInput = {
  /** Human label for the registry pair (e.g. "generated-artifact-registry"). */
  registryLabel: string;
  /** Paths previously registered (from the on-disk JSON). */
  previousPaths: string[];
  /** Paths the scan would register now. */
  nextPaths: string[];
  /** True when operator passed --allow-shrink or the env opt-in. */
  allowShrink: boolean;
  /**
   * Does a registered path still exist on disk? (#580) Resolved against the repo
   * root by both builders; injectable so contracts need no fixture files.
   * Default: real `existsSync`.
   */
  pathExists?: (registeredPath: string) => boolean;
  /** Max paths listed in messages (default REMOVAL_SAMPLE_LIMIT). */
  sampleLimit?: number;
};

export type ShrinkGuardDecision = {
  removedPaths: string[];
  /** False when removals exist and allowShrink is false — caller must not write. */
  allowWrite: boolean;
  /** stderr-style message (refusal or cleanup report). Empty when no removals. */
  message: string;
};

/**
 * Parse opt-in from argv and/or env.
 * Accepted: `--allow-shrink` on argv, or `OPENCLINXR_REGISTRY_ALLOW_SHRINK=1`.
 */
export function parseAllowShrink(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (argv.includes(ALLOW_SHRINK_FLAG)) return true;
  const raw = env[ALLOW_SHRINK_ENV];
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Detect a git worktree (`.git` is a file pointing at gitdir). Informational only —
 * never a gate; a complete worktree is legitimate.
 */
export function detectGitWorktree(cwd: string): boolean {
  const gitPath = path.join(cwd, ".git");
  if (!existsSync(gitPath)) return false;
  try {
    return !statSync(gitPath).isDirectory();
  } catch {
    return false;
  }
}

export function worktreeNote(cwd: string): string | null {
  if (!detectGitWorktree(cwd)) return null;
  return (
    "Note: cwd looks like a git worktree (`.git` is a file). Incomplete worktrees " +
    "often lack gitignored paths that main has registered; this is logged only — " +
    "not a refusal reason. A complete worktree may regenerate freely."
  );
}

/** Read `entries[].path` from an existing registry JSON; empty if missing/unreadable. */
export function loadRegisteredPaths(registryJsonAbsPath: string): string[] {
  if (!existsSync(registryJsonAbsPath)) return [];
  try {
    const raw = readFileSync(registryJsonAbsPath, "utf8");
    const data = JSON.parse(raw) as { entries?: Array<{ path?: unknown }> };
    if (!Array.isArray(data.entries)) return [];
    return data.entries
      .map((entry) => (typeof entry.path === "string" ? entry.path : null))
      .filter((p): p is string => p !== null);
  } catch {
    return [];
  }
}

export function findRemovedPaths(previousPaths: readonly string[], nextPaths: readonly string[]): string[] {
  const next = new Set(nextPaths);
  return previousPaths.filter((p) => !next.has(p)).sort((a, b) => a.localeCompare(b));
}

/**
 * Classify removals by whether the file still exists (#580).
 * - `missing`: bookkeeping — the file is gone; clearing the record is safe.
 * - `present`: suspicious — the file exists but left the scan; removing the
 *   record would drop a live file. Never cleared by `--allow-shrink`.
 */
export type RemovalClassification = {
  missing: string[];
  present: string[];
};

export function classifyRemovals(
  removedPaths: readonly string[],
  pathExists: (registeredPath: string) => boolean,
): RemovalClassification {
  const missing: string[] = [];
  const present: string[] = [];
  for (const p of removedPaths) {
    if (pathExists(p)) present.push(p);
    else missing.push(p);
  }
  return { missing, present };
}

function formatPathSample(paths: readonly string[], sampleLimit: number): string {
  if (paths.length === 0) return "(none)";
  const sample = paths.slice(0, sampleLimit);
  const lines = sample.map((p) => `  - ${p}`).join("\n");
  if (paths.length <= sampleLimit) return lines;
  return `${lines}\n  … and ${paths.length - sampleLimit} more`;
}

/**
 * Decide whether a regeneration that would drop registered paths may write.
 *
 * Zero removals without opt-in. With opt-in (#580): only removals whose file
 * no longer exists on disk are cleared — bookkeeping. A removal whose file
 * still exists is refused even with the flag; it needs an explicit per-path
 * allowlist decision, not the routine cleanup reflex.
 */
export function decideRegistryShrink(input: ShrinkGuardInput): ShrinkGuardDecision {
  const sampleLimit = input.sampleLimit ?? REMOVAL_SAMPLE_LIMIT;
  const pathExists = input.pathExists ?? defaultPathExists;
  const removedPaths = findRemovedPaths(input.previousPaths, input.nextPaths);

  if (removedPaths.length === 0) {
    return { removedPaths, allowWrite: true, message: "" };
  }

  const { missing, present } = classifyRemovals(removedPaths, pathExists);
  const classes =
    `${missing.length} gone from disk (bookkeeping), ` +
    `${present.length} still exist on disk (suspicious)`;

  if (input.allowShrink && present.length > 0) {
    const message =
      `[${input.registryLabel}] REFUSED despite ${ALLOW_SHRINK_FLAG}: ` +
      `${present.length} removed path(s) still exist on disk — dropping them would lose live files.\n` +
      `Still present:\n${formatPathSample(present, sampleLimit)}\n` +
      `Re-run without ${ALLOW_SHRINK_FLAG} to see both classes; clear "still present" removals only ` +
      `via an explicit per-path decision, never via the shrink opt-in.\n` +
      `Nothing was written.`;
    return { removedPaths, allowWrite: false, message };
  }

  if (input.allowShrink) {
    const message =
      `[${input.registryLabel}] --allow-shrink: removing ${removedPaths.length} registered path(s)` +
      ` (${classes}):\n` +
      `${formatPathSample(removedPaths, sampleLimit)}\n` +
      `(opt-in: ${ALLOW_SHRINK_FLAG} or ${ALLOW_SHRINK_ENV}=1)`;
    return { removedPaths, allowWrite: true, message };
  }

  const message =
    `[${input.registryLabel}] REFUSED: regeneration would shrink the protected registry ` +
    `(${removedPaths.length} path(s) removed: ${classes}; 0 allowed without opt-in).\n` +
    `A registry is a record: add/update is free; removal requires an explicit opt-in.\n` +
    `Would remove:\n${formatPathSample(removedPaths, sampleLimit)}\n` +
    `Re-run with ${ALLOW_SHRINK_FLAG} (or ${ALLOW_SHRINK_ENV}=1) to allow shrink cleanup of ` +
    `files that are gone from disk. Files that still exist are refused even with the flag.\n` +
    `Nothing was written.`;

  return { removedPaths, allowWrite: false, message };
}
