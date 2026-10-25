import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * HX-PATHS S4 — no hard-coded worktree roots in the managed-path modules.
 *
 * The managed worktree root has exactly one owner (worktree-roots.ts, via
 * managedWorktreeRoot honoring OPENCLINXR_WT_ROOT). Every other module in this
 * card's set must resolve it at call time, never embed the literals below —
 * three lanes lost work to a dispatcher base on a stale literal-adjacent path.
 */

const SCANNED = [
  "worktree-base-freshness.ts",
  "dispatch-worker.ts",
  "worktree-promote.ts",
  "handoff.ts",
] as const;

const LITERAL_PATTERNS = [
  /\.grok\/worktrees/,
  /"\.grok",\s*"worktrees"/,
  /\/Volumes\/files\/src-openclinxr/,
];

/** Code lines containing a hard-coded root literal; full-line comments excluded. */
export function findLiterals(text: string): string[] {
  const hits: string[] = [];
  let inBlock = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/*")) inBlock = true;
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      continue;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (LITERAL_PATTERNS.some((pattern) => pattern.test(line))) hits.push(line);
  }
  return hits;
}

describe("no hard-coded worktree roots outside worktree-roots.ts", () => {
  it("the four managed-path modules embed no root literal in code lines", () => {
    const root = join(import.meta.dirname);
    const offenders: string[] = [];
    for (const file of SCANNED) {
      const src = readFileSync(join(root, file), "utf8");
      for (const line of findLiterals(src)) offenders.push(`${file}: ${line.trim()}`);
    }
    expect(offenders, `hard-coded worktree roots: ${offenders.join(" | ")}`).toEqual([]);
  });

  it("destructive probe: a planted code line is flagged, a planted comment line is not", () => {
    const probe = [
      "const target = join(managedWorktreeRoot(), name);",
      "const legacy = join(home, \".grok\", \"worktrees\", \"src-openclinxr\"); // planted",
      "// planted comment: lane worktrees live under ~/.grok/worktrees",
      "* planted comment: layout ~/.grok/worktrees/src-openclinxr/x",
    ].join("\n");
    const found = findLiterals(probe);
    console.log(`hx-paths probe: planted=2 code+comment, found=${found.length}`);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("planted");
    expect(found[0]).toContain("legacy");
  });
});
