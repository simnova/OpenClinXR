import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Tree + trusted-baseline machinery for `done_when` rule evaluation.
 *
 * Split out of done-when-rules.ts when the `measured-before:` rule pushed that file past its
 * frozen size ceiling (#177). The ratchet's instruction is split, never raise, and this is the
 * seam its header already named: globMatch / walkFiles / resolveExistsTargets are used ONLY by
 * the rule evaluator, and the baseline record is the trusted spawn-state both `changed:` and
 * `measured-before:` read.
 */

export const SLICE_BASELINE_SCHEMA = "openclinxr.slice-baseline.v1" as const;

export type SliceBaselineHashes = {
  schemaVersion: typeof SLICE_BASELINE_SCHEMA;
  sliceId: string;
  recordedAt: string;
  treeRoot: string;
  /** The `changed:` rules this snapshot covers. A rule not listed cannot pass against this file. */
  targets: string[];
  /**
   * rel-path → sha256. EMPTY is legal: it means "nothing matched yet when the snapshot was taken".
   * A file ABSENT from this map (while the baseline record exists) is evidence the worker created it.
   */
  files: Record<string, string>;
};

/**
 * Trusted directory holding baseline-hashes.json. Worker-unwritable. When omitted, falls back
 * to `<treeRoot>/.openclinxr/slices/<sliceId>` — the legacy hand-run behaviour.
 */
export type DoneWhenEvalOptions = {
  baselineDir?: string;
};

function globMatch(pattern: string, candidate: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const normalizedCandidate = candidate.replaceAll("\\", "/");
  if (!normalizedPattern.includes("*")) {
    return normalizedCandidate === normalizedPattern || normalizedCandidate.endsWith(`/${normalizedPattern}`);
  }
  const regex = new RegExp(
    `^${normalizedPattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );
  return regex.test(normalizedCandidate);
}

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

export async function resolveExistsTargets(treeRoot: string, target: string): Promise<string[]> {
  const absolute = path.isAbsolute(target) ? target : path.join(treeRoot, target);
  if (!target.includes("*")) {
    // #93: a directory target expands to the files beneath it (recursive, files-only) via the
    // same proven walkFiles helper the wildcard branch uses — previously the directory inode
    // itself was returned and `sha256File` threw EISDIR at baseline-write and eval time.
    if (!existsSync(absolute)) return [];
    if (statSync(absolute).isDirectory()) return walkFiles(absolute);
    return [absolute];
  }
  const normalizedTarget = target.replaceAll("\\", "/");
  const wildcardIndex = normalizedTarget.split("/").findIndex((segment) => segment.includes("*"));
  if (wildcardIndex < 0) {
    return [];
  }
  const searchRoot = path.join(treeRoot, ...normalizedTarget.split("/").slice(0, wildcardIndex));
  const pattern = normalizedTarget.split("/").slice(wildcardIndex).join("/");
  const files = await walkFiles(searchRoot);
  return files.filter((file) => {
    const rel = path.relative(searchRoot, file).replaceAll("\\", "/");
    return globMatch(pattern, rel);
  });
}

export function sha256File(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

/**
 * Snapshot every `changed:` target BEFORE the worker runs. Orchestrator-only.
 * Writes into baselineDir (trusted / worker-unwritable plane).
 */
export async function writeBaselineHashes(input: {
  treeRoot: string;
  baselineDir: string;
  sliceId: string;
  rules: string[];
}): Promise<{ path: string; targets: string[]; fileCount: number }> {
  const changedRules = input.rules.filter((r) => r.startsWith("changed:"));
  const files: Record<string, string> = {};
  for (const rule of changedRules) {
    const target = rule.slice("changed:".length).trim();
    if (!target) continue;
    const matches = await resolveExistsTargets(input.treeRoot, target);
    for (const match of matches) {
      const rel = path.relative(input.treeRoot, match).replaceAll("\\", "/");
      files[rel] = sha256File(match);
    }
  }
  const record: SliceBaselineHashes = {
    schemaVersion: SLICE_BASELINE_SCHEMA,
    sliceId: input.sliceId,
    recordedAt: new Date().toISOString(),
    treeRoot: path.resolve(input.treeRoot),
    targets: changedRules,
    files,
  };
  mkdirSync(input.baselineDir, { recursive: true });
  const outPath = path.join(input.baselineDir, "baseline-hashes.json");
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  return { path: outPath, targets: changedRules, fileCount: Object.keys(files).length };
}

export function loadBaseline(
  baselinePath: string,
  rule: string,
  opts?: { requireTarget?: boolean },
): { ok: true; baseline: SliceBaselineHashes } | { ok: false; detail: string } {
  if (!existsSync(baselinePath)) {
    return {
      ok: false,
      detail: "no baseline recorded for this slice; a change cannot be proven",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    return { ok: false, detail: "baseline-hashes.json is unparseable JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, detail: "baseline-hashes.json is not an object" };
  }
  const baseline = parsed as Partial<SliceBaselineHashes>;
  if (baseline.schemaVersion !== SLICE_BASELINE_SCHEMA) {
    return {
      ok: false,
      detail: `baseline schemaVersion must be ${SLICE_BASELINE_SCHEMA} (got ${String(baseline.schemaVersion)})`,
    };
  }
  if (!Array.isArray(baseline.targets)) {
    return { ok: false, detail: "baseline missing targets[]" };
  }
  // `measured-before:` rules are never recorded in targets — writeBaselineHashes only snapshots
  // `changed:` rules — so that rule kind skips the exact-membership check while keeping every
  // other fail-closed validation.
  const requireTarget = opts?.requireTarget ?? true;
  if (requireTarget && !baseline.targets.includes(rule)) {
    return {
      ok: false,
      detail: `baseline.targets does not include this rule (stale baseline from a different rule set)`,
    };
  }
  if (!baseline.files || typeof baseline.files !== "object" || Array.isArray(baseline.files)) {
    return { ok: false, detail: "baseline missing files map" };
  }
  return {
    ok: true,
    baseline: {
      schemaVersion: SLICE_BASELINE_SCHEMA,
      sliceId: String(baseline.sliceId ?? ""),
      recordedAt: String(baseline.recordedAt ?? ""),
      treeRoot: String(baseline.treeRoot ?? ""),
      targets: baseline.targets as string[],
      files: baseline.files as Record<string, string>,
    },
  };
}
