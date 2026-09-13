import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildGeneratedArtifactRegistry,
  selectEligibleGeneratedArtifactScanPaths,
} from "../../../agent-factory/build-generated-artifact-registry.ts";

/**
 * The generated-artifact registry must produce the SAME entry set from a
 * complete-checkout path list (tracked + gitignored local) and a worktree
 * path list (tracked only). Measured 2026-09-13 at fa4cd0f4: committed 3,394
 * (worktree) vs 10,633 (main) — 7,239 additions, 0 lost, 300/300 untracked.
 *
 * Reproduce synthetically. A worktree has no gitignored content, so
 * `pnpm docs:artifacts` looking clean here is the defect being invisible.
 *
 * Cheap pass this forbids: `next = discovered ∪ previous` (or carry-forward
 * of every present previous path). That makes tightening "just work" and
 * deletes the shrink guard. Clause (3) in preserved-entries-survive-regen
 * is the counterweight; this file's (C) restates it against the ignore filter.
 */

const REL_JSON = "docs/openclinxr/generated-artifact-registry-2026-05-27.json";
const REL_MD = "docs/openclinxr/generated-artifact-registry-2026-05-27.md";

const TRACKED = [
  "docs/openclinxr/keep.json",
  ".openclinxr/evidence/force-added.json",
] as const;
const GRANDFATHERED_IGNORED = ".openclinxr/evidence/old-local-untracked.json";
const NEW_IGNORED = ".openclinxr/slices/machine-only.json";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function seed(tmp: string, paths: readonly string[]): void {
  const entries = paths.map((p) => ({
    path: p,
    authority: "keep-evidence",
    tracked: false,
    action: "keep",
    rationale: "seed",
  }));
  const jsonAbs = path.join(tmp, REL_JSON);
  mkdirSync(path.dirname(jsonAbs), { recursive: true });
  writeFileSync(
    jsonAbs,
    `${JSON.stringify({ schemaVersion: "2026-05-27", counts: {}, entries }, null, 2)}\n`,
  );
  writeFileSync(path.join(tmp, REL_MD), "# seed\n");
}

function writtenPaths(tmp: string): string[] {
  const written = JSON.parse(readFileSync(path.join(tmp, REL_JSON), "utf8")) as {
    entries: Array<{ path: string }>;
  };
  return written.entries.map((e) => e.path).sort();
}

function isGitignoredLocal(p: string): boolean {
  return p === GRANDFATHERED_IGNORED || p === NEW_IGNORED;
}

describe("generated-artifact scan is checkout-independent", () => {
  it("(A) selectEligible drops new gitignored paths and keeps grandfathered ones", () => {
    const eligible = selectEligibleGeneratedArtifactScanPaths({
      discovered: [...TRACKED, GRANDFATHERED_IGNORED, NEW_IGNORED],
      previousPaths: [...TRACKED, GRANDFATHERED_IGNORED],
      ignoredPaths: new Set([GRANDFATHERED_IGNORED, NEW_IGNORED]),
    });
    expect(eligible).toEqual([...TRACKED, GRANDFATHERED_IGNORED].sort());
  });

  it("(B) DETERMINISM: complete-checkout and worktree path lists produce the same entry set", () => {
    const previous = [...TRACKED, GRANDFATHERED_IGNORED];
    const completeDiscovered = [...TRACKED, GRANDFATHERED_IGNORED, NEW_IGNORED];
    const worktreeDiscovered = [...TRACKED];

    const completeTmp = mkdtempSync(path.join(tmpdir(), "openclinxr-registry-complete-"));
    const worktreeTmp = mkdtempSync(path.join(tmpdir(), "openclinxr-registry-worktree-"));
    temps.push(completeTmp, worktreeTmp);
    seed(completeTmp, previous);
    seed(worktreeTmp, previous);

    const complete = buildGeneratedArtifactRegistry({
      cwd: completeTmp,
      allowShrink: false,
      pathListOverride: completeDiscovered,
      preservedEntries: [],
      carryForwardMissingPrevious: true,
      pathIsIgnored: isGitignoredLocal,
      pathExists: (p) => completeDiscovered.includes(p),
      logError: () => {},
    });
    const worktree = buildGeneratedArtifactRegistry({
      cwd: worktreeTmp,
      allowShrink: false,
      pathListOverride: worktreeDiscovered,
      preservedEntries: [],
      carryForwardMissingPrevious: true,
      pathIsIgnored: isGitignoredLocal,
      pathExists: (p) => worktreeDiscovered.includes(p),
      logError: () => {},
    });

    expect(complete.ok, complete.stderr).toBe(true);
    expect(worktree.ok, worktree.stderr).toBe(true);
    expect(writtenPaths(completeTmp)).toEqual(writtenPaths(worktreeTmp));
    expect(writtenPaths(completeTmp)).toEqual(previous.sort());
    expect(writtenPaths(completeTmp)).not.toContain(NEW_IGNORED);
  });

  it("(C) COUNTERWEIGHT: an unpreserved present-file removal still refuses (tightening must not just work)", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "openclinxr-registry-counter-"));
    temps.push(tmp);
    seed(tmp, ["scan/keep.json", "outside/live.json"]);

    const result = buildGeneratedArtifactRegistry({
      cwd: tmp,
      allowShrink: true,
      pathListOverride: ["scan/keep.json"],
      preservedEntries: [],
      pathExists: () => true,
      logError: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.wrote).toBe(false);
    expect(result.removedPaths).toEqual(["outside/live.json"]);
    expect(readFileSync(path.join(tmp, REL_MD), "utf8")).toBe("# seed\n");
  });
});
