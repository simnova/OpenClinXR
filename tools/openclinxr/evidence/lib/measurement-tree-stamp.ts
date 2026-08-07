/**
 * #141 — tree stamp for measure-once-to-disk evidence caches.
 *
 * §7s: any contract whose measurement is cached to disk must record the tree
 * state it measured and refuse the cache when that has moved.
 *
 * Stamp choice: git HEAD + worktree dirtiness fingerprint (status + diff HEAD).
 * - Pure commit sha is wrong in a dirty tree (the case that bites after integrate WIP).
 * - Pure input hashes need a perfect input list per probe; easy to under-specify.
 * - This fingerprint moves when HEAD moves OR tracked content is dirty.
 *
 * NOT COVERED: content of untracked / gitignored files (e.g. cagematch GLBs under
 * apps/ui-xr/public/cagematch). Same residual class as #89 for pixel evidence.
 *
 * Stale behaviour: refuse (return null) so the caller re-measures — honest and
 * still pays the cache win when the tree is unchanged.
 *
 * Duration heuristic (NOT a proof): honest Vite+playwright measure is ~tens of
 * seconds; a multi-second suite pass is a cache hit. See MEASUREMENT_CACHE_DURATION_HEURISTIC.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

export const MEASUREMENT_TREE_STAMP_ALGORITHM = "git-head+status+diff-sha256" as const;

export type MeasurementTreeStamp = {
  /** `git rev-parse HEAD` at measure time. */
  head: string;
  /**
   * sha256 hex of `head + "\\n" + porcelain + "\\n" + git diff HEAD`.
   * Changes when the commit moves or tracked files are dirty relative to HEAD.
   */
  fingerprint: string;
  algorithm: typeof MEASUREMENT_TREE_STAMP_ALGORITHM;
};

/**
 * Heuristic only — do not dress as a contract threshold.
 * Honest live measure boots Vite and typically takes tens of seconds; a disk
 * cache hit returns in a few seconds. A suspiciously fast pass or fail is a
 * failed run until re-checked with a forced re-measure.
 */
export const MEASUREMENT_CACHE_DURATION_HEURISTIC = {
  honestMeasureFloorMs: 15_000,
  note:
    "A pass/fail that returns in a few seconds while claiming a live measure is likely a disk cache hit. Compare wall time to honest cost; this is a heuristic, not a proof.",
} as const;

export function computeMeasurementTreeStamp(cwd: string = process.cwd()): MeasurementTreeStamp {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  }).trim();

  let porcelain = "";
  let diff = "";
  try {
    porcelain = execFileSync("git", ["status", "--porcelain=v1"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    porcelain = "status-unavailable";
  }
  try {
    diff = execFileSync("git", ["diff", "HEAD"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 80 * 1024 * 1024,
    });
  } catch {
    diff = "diff-unavailable";
  }

  const fingerprint = createHash("sha256")
    .update(head)
    .update("\n")
    .update(porcelain)
    .update("\n")
    .update(diff)
    .digest("hex");

  return {
    head,
    fingerprint,
    algorithm: MEASUREMENT_TREE_STAMP_ALGORITHM,
  };
}

export function isMeasurementTreeStamp(value: unknown): value is MeasurementTreeStamp {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.head === "string"
    && v.head.length >= 7
    && typeof v.fingerprint === "string"
    && v.fingerprint.length >= 16
    && v.algorithm === MEASUREMENT_TREE_STAMP_ALGORITHM
  );
}

export function stampsMatch(
  recorded: MeasurementTreeStamp | undefined | null,
  current: MeasurementTreeStamp,
): boolean {
  if (!recorded || !isMeasurementTreeStamp(recorded)) return false;
  return (
    recorded.algorithm === current.algorithm
    && recorded.head === current.head
    && recorded.fingerprint === current.fingerprint
  );
}

/**
 * Read a measure-once artifact and serve it only when its treeStamp matches
 * the current worktree. Stale / missing / corrupt → null (refuse → re-measure).
 */
export async function tryReadStampedArtifact<TReport>(
  artifactPath: string,
  extractReport: (parsed: Record<string, unknown>) => TReport | null,
  options?: { cwd?: string; currentStamp?: MeasurementTreeStamp },
): Promise<TReport | null> {
  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const current = options?.currentStamp ?? computeMeasurementTreeStamp(options?.cwd);
    const recorded = parsed.treeStamp;
    if (!stampsMatch(recorded as MeasurementTreeStamp | undefined, current)) {
      return null;
    }
    return extractReport(parsed);
  } catch {
    return null;
  }
}

/** Attach a freshly computed stamp to a payload about to be written. */
export function withTreeStamp<T extends Record<string, unknown>>(
  payload: T,
  stamp?: MeasurementTreeStamp,
  cwd?: string,
): T & { treeStamp: MeasurementTreeStamp } {
  const treeStamp = stamp ?? computeMeasurementTreeStamp(cwd);
  return { ...payload, treeStamp };
}
