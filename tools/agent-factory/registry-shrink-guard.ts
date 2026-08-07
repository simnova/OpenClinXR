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

function formatPathSample(paths: readonly string[], sampleLimit: number): string {
  if (paths.length === 0) return "(none)";
  const sample = paths.slice(0, sampleLimit);
  const lines = sample.map((p) => `  - ${p}`).join("\n");
  if (paths.length <= sampleLimit) return lines;
  return `${lines}\n  … and ${paths.length - sampleLimit} more`;
}

/**
 * Decide whether a regeneration that would drop registered paths may write.
 * Zero removals without opt-in. With opt-in, writes and reports what went.
 */
export function decideRegistryShrink(input: ShrinkGuardInput): ShrinkGuardDecision {
  const sampleLimit = input.sampleLimit ?? REMOVAL_SAMPLE_LIMIT;
  const removedPaths = findRemovedPaths(input.previousPaths, input.nextPaths);

  if (removedPaths.length === 0) {
    return { removedPaths, allowWrite: true, message: "" };
  }

  if (input.allowShrink) {
    const message =
      `[${input.registryLabel}] --allow-shrink: removing ${removedPaths.length} registered path(s):\n` +
      `${formatPathSample(removedPaths, sampleLimit)}\n` +
      `(opt-in: ${ALLOW_SHRINK_FLAG} or ${ALLOW_SHRINK_ENV}=1)`;
    return { removedPaths, allowWrite: true, message };
  }

  const message =
    `[${input.registryLabel}] REFUSED: regeneration would shrink the protected registry ` +
    `(${removedPaths.length} path(s) removed, 0 allowed without opt-in).\n` +
    `A registry is a record: add/update is free; removal requires an explicit opt-in.\n` +
    `Would remove:\n${formatPathSample(removedPaths, sampleLimit)}\n` +
    `Re-run with ${ALLOW_SHRINK_FLAG} (or ${ALLOW_SHRINK_ENV}=1) to allow shrink cleanup.\n` +
    `Nothing was written.`;

  return { removedPaths, allowWrite: false, message };
}
