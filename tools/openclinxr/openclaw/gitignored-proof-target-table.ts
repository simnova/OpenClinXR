#!/usr/bin/env tsx
/**
 * #217 population table — the FIRST measurement, before any check is trusted.
 *
 * For every recorded slice in the shared coordination root, list each `exists:` / `min-bytes:`
 * proof target, whether it is gitignored, whether it is tracked, and whether the #217
 * integrate-time refusal would fire on it. Publishing this before the check shows what the
 * check would have caught and whether mechanism (1) alone is worth it.
 *
 * The table uses the SAME evaluator as merge-kill (`evaluateGitignoredProofTarget`), so the
 * published table and the gate cannot drift: a row's `wouldRefuse` is exactly what
 * `gitignored-proof-target` would conclude about that target today.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/openclaw/gitignored-proof-target-table.ts
 *     [--root <coordination-root>]   default: resolveCoordinationRoot(cwd)
 *     [--out <path>]                 default: <cwd>/.openclinxr/evidence/issue-217/gitignored-proof-target-table.json
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCoordinationRoot } from "./coordination-root.js";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";
import {
  evaluateGitignoredProofTarget,
  extractProofTarget,
} from "./merge-kill.js";

export type ProofTargetRow = {
  slice: string;
  rule: string;
  ruleKind: "exists" | "min-bytes";
  target: string;
  gitignored: boolean;
  tracked: boolean;
  /** True when the target has a `*` glob — tracked is "any tracked file matches". */
  glob: boolean;
  /** gitignored && !tracked && not in the brief's gitignoredProofTargetsAllowed opt-out. */
  wouldRefuse: boolean;
  optOut: boolean;
};

export type GitignoredProofTargetTable = {
  schemaVersion: "openclinxr.gitignored-proof-target-table.v1";
  generatedAt: string;
  repoRoot: string;
  headSha: string | null;
  slices: number;
  summary: {
    targets: number;
    gitignored: number;
    tracked: number;
    wouldRefuse: number;
    refusedSlices: number;
    globTargets: number;
  };
  rows: ProofTargetRow[];
};

function git(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: gitEnvWithoutInheritedRepoVars(),
    });
  } catch {
    return null;
  }
}

function parseArgs(argv: string[]): { root?: string; out?: string } {
  let root: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--out") out = argv[++i];
  }
  return { root, out };
}

export function buildGitignoredProofTargetTable(
  root: string,
): GitignoredProofTargetTable {
  const slicesDir = join(root, ".openclinxr", "slices");
  const rows: ProofTargetRow[] = [];
  let slices = 0;

  if (existsSync(slicesDir)) {
    for (const dir of readdirSync(slicesDir).sort()) {
      const briefPath = join(slicesDir, dir, "brief.json");
      if (!existsSync(briefPath)) continue;
      let brief: { done_when?: string[]; gitignoredProofTargetsAllowed?: string[] };
      try {
        brief = JSON.parse(readFileSync(briefPath, "utf8"));
      } catch {
        continue;
      }
      slices += 1;
      const allowed = new Set(
        Array.isArray(brief.gitignoredProofTargetsAllowed)
          ? brief.gitignoredProofTargetsAllowed
          : [],
      );
      for (const rule of brief.done_when ?? []) {
        if (!rule.startsWith("exists:") && !rule.startsWith("min-bytes:")) continue;
        const target = extractProofTarget(rule);
        if (!target) continue;
        const evalResult = evaluateGitignoredProofTarget(root, target, "HEAD", "HEAD");
        const optOut = allowed.has(target);
        rows.push({
          slice: dir,
          rule,
          ruleKind: rule.startsWith("min-bytes:") ? "min-bytes" : "exists",
          target,
          gitignored: evalResult.gitignored,
          tracked: evalResult.tracked,
          glob: target.includes("*"),
          optOut,
          wouldRefuse: evalResult.wouldRefuse && !optOut,
        });
      }
    }
  }

  const summary = {
    targets: rows.length,
    gitignored: rows.filter((r) => r.gitignored).length,
    tracked: rows.filter((r) => r.tracked).length,
    wouldRefuse: rows.filter((r) => r.wouldRefuse).length,
    refusedSlices: new Set(rows.filter((r) => r.wouldRefuse).map((r) => r.slice)).size,
    globTargets: rows.filter((r) => r.glob).length,
  };

  return {
    schemaVersion: "openclinxr.gitignored-proof-target-table.v1",
    generatedAt: new Date().toISOString(),
    repoRoot: root,
    headSha: git(root, ["rev-parse", "HEAD"])?.trim() ?? null,
    slices,
    summary,
    rows,
  };
}

function main(): void {
  const { root, out } = parseArgs(process.argv.slice(2));
  const repoRoot = root ?? resolveCoordinationRoot(process.cwd());
  const outPath =
    out ?? join(process.cwd(), ".openclinxr", "evidence", "issue-217", "gitignored-proof-target-table.json");

  const table = buildGitignoredProofTargetTable(repoRoot);
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(table, null, 2)}\n`);

  const s = table.summary;
  console.log(`#217 gitignored-proof-target population table`);
  console.log(`  root: ${table.repoRoot}`);
  console.log(`  head: ${table.headSha}`);
  console.log(`  slices with brief: ${table.slices}`);
  console.log(`  exists/min-bytes targets: ${s.targets}`);
  console.log(`    gitignored:    ${s.gitignored}`);
  console.log(`    tracked:       ${s.tracked}`);
  console.log(`    wouldRefuse:   ${s.wouldRefuse} across ${s.refusedSlices} slices`);
  console.log(`    glob targets:  ${s.globTargets}`);
  console.log(`  wrote ${outPath}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
