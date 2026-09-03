import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveSharedCoordinationPath } from "./coordination-root.js";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";

/**
 * Half two of the land boundary: make the integrate wrapper hard to skip.
 *
 * `pnpm openclaw:integrate` runs merge-kill first, but typing `git merge` skips it — so on its own
 * the wrapper is a convention, and conventions lose to a hurried operator.
 *
 * VOCABULARY, deliberately: this is HIGH FRICTION FOR THE DEFAULT PATH, not a boundary. A same-uid
 * process can pass `--no-verify`, and a final commit made that way leaves nothing in branch history
 * to grep. Earlier today "hard control" was written about a string matcher and licensed four layers
 * of work on a false premise; the residual is stated here instead.
 */

/** The report is keyed to the TREE it judged, so it covers both `git merge` and file-copy landings. */
export type IntegrateGateReport = {
  killed: boolean;
  /** `git write-tree` of the index that is about to be committed. */
  treeHash: string;
  base?: string;
  head?: string;
  mode?: "merge" | "path-copy";
};

const GATE_REPORT = ".openclinxr/openclaw/integrate-gate-report.json";

/**
 * Decide whether this commit must present a kill report.
 *
 * The discriminator is "is this an integrate LAND", NOT "are product paths staged". Keying on
 * product paths would demand a report for every ordinary commit on main, which is precisely how a
 * gate gets disabled — the same dynamic that makes a slow hook lead to `--no-verify`. The failure
 * being closed is "forgot to run kill while landing worker work", not "cannot edit packages".
 */
export function requiresKillReport(input: {
  branch: string;
  /** Set by the wrapper for its own commit. */
  integrating: boolean;
  /** Branch names of additional merge parents, when the commit is a merge. */
  mergeParents: readonly string[];
}): boolean {
  if (input.branch !== "main") return false;
  if (input.integrating) return true;
  // Catches `git merge wt/...` typed by hand, which is the bypass this half exists to close.
  return input.mergeParents.some((parent) => parent.startsWith("wt/"));
}

export function evaluateIntegrateGate(input: {
  treeHash: string;
  report: IntegrateGateReport | null;
}): { allowed: boolean; reason?: string } {
  if (input.report === null) {
    return {
      allowed: false,
      reason:
        "No merge-kill report for this land. Use `pnpm openclaw:integrate`, which runs merge-kill "
        + "first and refuses without touching the tree if it fires.",
    };
  }
  if (input.report.treeHash !== input.treeHash) {
    return {
      allowed: false,
      reason:
        `Stale report: it judged tree ${input.report.treeHash} but ${input.treeHash} is about to be `
        + "committed — a different tree, so the report says nothing about this commit. Freshness is "
        + "by content because an existence or mtime check would pass here.",
    };
  }
  if (input.report.killed) {
    return { allowed: false, reason: "merge-kill killed this land; the report records killed: true." };
  }
  return { allowed: true };
}

/** Hash of the index about to be committed — knowable in pre-commit, before any commit object. */
export function stagedTreeHash(repoRoot: string): string {
  return execFileSync("git", ["write-tree"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: gitEnvWithoutInheritedRepoVars(),
  }).trim();
}

export function writeGateReport(repoRoot: string, report: IntegrateGateReport): string {
  const path = resolveSharedCoordinationPath(GATE_REPORT, repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}

export function readGateReport(repoRoot: string): IntegrateGateReport | null {
  const path = resolveSharedCoordinationPath(GATE_REPORT, repoRoot);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as IntegrateGateReport;
  } catch {
    return null;
  }
}

/** Merge-parent branch names for a pending merge, or [] when this is not a merge commit. */
export function pendingMergeParents(repoRoot: string): string[] {
  const headPath = join(repoRoot, ".git", "MERGE_HEAD");
  if (!existsSync(headPath)) return [];
  return readFileSync(headPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((sha) => {
      try {
        return [
          execFileSync("git", ["name-rev", "--name-only", sha.trim()], {
            cwd: repoRoot,
            encoding: "utf8",
            env: gitEnvWithoutInheritedRepoVars(),
          }).trim(),
        ];
      } catch {
        return [];
      }
    });
}
