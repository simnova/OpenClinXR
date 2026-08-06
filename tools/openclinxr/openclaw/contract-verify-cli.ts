#!/usr/bin/env tsx
/**
 * contract-verify-cli — merge-time re-verify of tree proofs against a candidate tree.
 *
 * WHY: verifying only at dispatch lets a LATER commit drop the proof before the branch is merged.
 * This CLI loads the brief from the TRUSTED coordination root and re-runs tree proofs against
 * `--tree` (defaults to cwd). Exit 2 = contract failure (distinct from 1 = crash).
 *
 * Usage: tsx contract-verify-cli.ts --slice <id> [--tree <path>] [--json]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateDoneWhenRule,
  partitionDoneWhen,
} from "../../../packages/openclinxr/agent-loop/src/done-when-rules.js";
import type { DoneWhenCheck } from "../../../packages/openclinxr/agent-loop/src/slice-team.js";
import { resolveSharedCoordinationPath } from "./coordination-root.js";
import { loadTrustedBrief, trustedSliceDir } from "./dispatch-worker.js";

function usage(): never {
  console.error("Usage: tsx contract-verify-cli.ts --slice <id> [--tree <path>] [--json]");
  process.exit(1);
}

function parseArgs(argv: string[]): { slice: string; tree: string; json: boolean } {
  let slice: string | undefined;
  let tree = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--slice") {
      slice = argv[++i];
    } else if (arg === "--tree") {
      tree = argv[++i] ?? tree;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    }
  }
  if (!slice) usage();
  return { slice: slice!, tree, json };
}

async function main(): Promise<void> {
  const { slice, tree, json } = parseArgs(process.argv.slice(2));
  if (!existsSync(tree)) {
    console.error(`Tree path does not exist: ${tree}`);
    process.exit(1);
  }

  const trustedDir = trustedSliceDir(tree, slice);
  const brief = loadTrustedBrief(trustedDir);
  if (!brief) {
    console.error(
      `No trusted brief at ${join(trustedDir, "brief.json")}. `
      + `Contract lives in the shared coordination root — never in a worktree-local .openclinxr.`,
    );
    process.exit(1);
  }

  const rules = Array.isArray(brief.done_when) ? brief.done_when : [];
  const { treeProofs, narrative, unknown } = partitionDoneWhen(rules);

  if (treeProofs.length === 0) {
    console.error(
      `Slice '${slice}' has no tree proofs in trusted brief (narrative-only or empty done_when). `
      + `Nothing machine-checkable to verify at merge time.`,
    );
    process.exit(1);
  }

  const checks: DoneWhenCheck[] = [];
  for (const rule of treeProofs) {
    checks.push(
      await evaluateDoneWhenRule(tree, rule, slice, {}, { baselineDir: trustedDir }),
    );
  }
  const proofsOk = checks.every((c) => c.passed);

  /**
   * The commit these proofs were actually executed against.
   *
   * Without it the report says only "some tree at this path passed once". `integrate` needs to know
   * whether it passed THE COMMIT ABOUT TO LAND — a re-verify after a fix must not be usable to bless
   * an older or newer head. Same reasoning as `integrate-gate`, which keys freshness on the staged
   * tree hash precisely because an mtime or existence check would pass on a stale artifact.
   */
  let headSha: string | undefined;
  try {
    headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  } catch {
    // A tree with no resolvable HEAD produces a report that cannot claim freshness, which is the
    // correct outcome: integrate falls back to the ledger rather than trusting an unanchored pass.
  }

  const report = {
    schemaVersion: "openclinxr.contract-verify.v1" as const,
    phase: "merge",
    sliceId: slice,
    treeRoot: tree,
    ...(headSha ? { headSha } : {}),
    baselineDir: trustedDir,
    proofsOk,
    checks,
    narrativeSkipped: narrative,
    unknown,
    at: new Date().toISOString(),
  };

  const reportDir = resolveSharedCoordinationPath(".openclinxr/openclaw", tree);
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `contract-verify-${slice}-merge.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (json) {
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  } else {
    console.log(`Contract verify slice=${slice} tree=${tree}`);
    console.log(`Trusted brief: ${join(trustedDir, "brief.json")}`);
    console.log(`Report: ${reportPath}`);
    console.log("");
    console.log("Rule".padEnd(48) + "Pass  Detail");
    console.log("-".repeat(90));
    for (const c of checks) {
      const mark = c.passed ? "OK  " : "FAIL";
      console.log(`${c.rule.slice(0, 46).padEnd(48)}${mark} ${c.detail.slice(0, 80)}`);
    }
    if (narrative.length > 0) {
      console.log("");
      console.log(`Narrative rules skipped (not a merge gate): ${narrative.join("; ")}`);
    }
    console.log("");
    console.log(proofsOk ? "RESULT: all tree proofs passed" : "RESULT: one or more tree proofs FAILED");
  }

  // Exit 2 = contract failure (distinct from 1 = crash / usage).
  if (!proofsOk) process.exit(2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
