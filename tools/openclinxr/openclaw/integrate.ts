#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveSharedCoordinationPath } from "./coordination-root.js";
import { readSessions } from "./dispatch-worker.js";
import { stagedTreeHash, writeGateReport } from "./integrate-gate.js";
import { runMergeKill, type MergeKillReport } from "./merge-kill.js";

/**
 * The land boundary — the only supported way work reaches main.
 *
 * WHY THIS EXISTS: merge-kill exited 2 into the void. Nothing called it, so every guarantee built
 * beneath it (task contract, diff-class policy, kill criteria) was advisory and a human remained the
 * gate. Merge is the last enforceable choke point, and merge-kill is the only mechanism that failed
 * closed on a change `pnpm architecture` passed GREEN — a SIZE_FREEZE ceiling raised 607→999. No
 * rule gate can catch that one, because the gate is what got widened.
 *
 * Two properties this must have, both learned the hard way:
 *   1. Refusal has NO side effect. Reporting a kill after landing is not a gate.
 *   2. Landing records an INTEGRATION EVENT. The scorecard previously inferred "landed" by regexing
 *      `Merge branch 'wt/…'` out of commit subjects, which read 33% when the true figure was 100% —
 *      slices integrated by copying intended files leave no such subject. An explicit event is the
 *      fact; a commit-message pattern is folklore.
 */

const EVENTS = ".openclinxr/openclaw/integration-events.jsonl";

export type IntegrateInput = {
  repoRoot: string;
  base: string;
  head: string;
  slice: string;
  /** Layer-3 contract result, when the work came from a contracted dispatch. */
  contract?: { proofsOk: boolean; proofs: { rule: string; passed: boolean; detail: string }[] } | null;
  /** Evaluate and report, but never touch the tree. */
  dryRun?: boolean;
};

export type IntegrationEvent = {
  slice: string;
  base: string;
  head: string;
  at: string;
};

export type IntegrateResult = {
  killReport: MergeKillReport;
  landed: boolean;
  /** 0 = landed, 2 = refused by merge-kill. Mirrors the merge-kill CLI so callers can propagate it. */
  exitCode: 0 | 2;
  event?: IntegrationEvent;
};

export function integrationEvents(repoRoot: string): IntegrationEvent[] {
  const path = join(repoRoot, EVENTS);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as IntegrationEvent];
      } catch {
        return [];
      }
    });
}

function recordEvent(repoRoot: string, event: IntegrationEvent): void {
  const path = join(repoRoot, EVENTS);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

/**
 * Find the contract this slice's worker actually produced.
 *
 * The dispatch ledger records `contractReportPath` per session. Without this lookup the CLI passed
 * `contract: null`, merge-kill fired `contract-not-verified`, and a slice whose proofs had ALL
 * PASSED was refused — the report existed and nothing read it. Same shape as every other gap today:
 * the pieces were built and left unconnected.
 */
export function contractForSlice(repoRoot: string, slice: string): IntegrateInput["contract"] {
  const entry = readSessions(repoRoot).filter((session) => session.slice === slice).at(-1) as
    | { proofsOk?: boolean; proofs?: { rule: string; passed: boolean; detail: string }[] }
    | undefined;
  if (entry?.proofsOk !== undefined) {
    return { proofsOk: entry.proofsOk, proofs: entry.proofs ?? [] };
  }
  return mergeVerifyContractForSlice(repoRoot, slice);
}

/**
 * Fall back to the merge-time re-verification report.
 *
 * `contract-verify-cli.ts` re-runs the tree proofs against the candidate tree and writes
 * `contract-verify-<slice>-merge.json` — and NOTHING READ IT. Tenth instance of the same class,
 * found when a dispatch aborted before writing its ledger entry: the worker's proofs all passed on
 * independent re-run, the merge report said so, and integrate refused because it only ever looked at
 * the ledger.
 *
 * This STRENGTHENS the gate rather than relaxing it. The ledger entry is the dispatcher's own record
 * of a worker it supervised; this report is proofs re-executed against the tree about to land, which
 * is the better evidence of the two. A missing or failed report still refuses, and a report whose
 * `proofsOk` is false is passed through as false — never coerced.
 */
function mergeVerifyContractForSlice(repoRoot: string, slice: string): IntegrateInput["contract"] {
  const path = resolveSharedCoordinationPath(
    `.openclinxr/openclaw/contract-verify-${slice}-merge.json`,
    repoRoot,
  );
  if (!existsSync(path)) return null;
  try {
    const report = JSON.parse(readFileSync(path, "utf8")) as {
      sliceId?: string;
      proofsOk?: boolean;
      checks?: { rule: string; passed: boolean; detail?: string }[];
    };
    // A report for a different slice is not evidence about this one.
    if (report.sliceId !== undefined && report.sliceId !== slice) return null;
    if (report.proofsOk === undefined) return null;
    return {
      proofsOk: report.proofsOk,
      proofs: (report.checks ?? []).map((check) => ({
        rule: check.rule,
        passed: check.passed,
        detail: check.detail ?? "",
      })),
    };
  } catch {
    return null;
  }
}

export function integrate(input: IntegrateInput): IntegrateResult {
  // Kill FIRST. Nothing below this line may run if it fires.
  const killReport = runMergeKill({
    repoRoot: input.repoRoot,
    base: input.base,
    head: input.head,
    ...(input.contract !== undefined ? { contract: input.contract } : {}),
  });

  if (killReport.killed) {
    return { killReport, landed: false, exitCode: 2 };
  }
  if (input.dryRun) {
    return { killReport, landed: false, exitCode: 0 };
  }

  // Land in two steps so the gate report can be keyed to the tree ACTUALLY being committed.
  // `--no-commit` leaves the index staged; `git write-tree` then hashes it. That hash is knowable
  // before any commit object exists, which is what lets the pre-commit hook compare like for like
  // and covers file-copy landings identically to merges.
    // --no-ff as well as --no-commit: a fast-forward would move the ref with nothing left to commit,
  // so there would be no commit for the pre-commit gate to inspect and no consistent tree to key the
  // report to. Forcing a merge commit gives one shape for both.
  execFileSync("git", ["merge", "--no-edit", "--no-ff", "--no-commit", input.head], {
    cwd: input.repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  writeGateReport(input.repoRoot, {
    killed: false,
    treeHash: stagedTreeHash(input.repoRoot),
    base: input.base,
    head: input.head,
    mode: "merge",
  });
  try {
    execFileSync("git", ["commit", "--no-edit"], {
      cwd: input.repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, OPENCLINXR_INTEGRATING: "1" },
    });
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error ? String((error as { stderr?: Buffer }).stderr) : "";
    throw new Error(`integrate: merge commit failed — ${detail.slice(0, 300)}`);
  }

  const event: IntegrationEvent = {
    slice: input.slice,
    base: input.base,
    head: input.head,
    at: new Date().toISOString(),
  };
  recordEvent(input.repoRoot, event);
  return { killReport, landed: true, exitCode: 0, event };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const slice = flag("slice") ?? "unscoped";
  const result = integrate({
    repoRoot: process.cwd(),
    base: flag("base") ?? "HEAD",
    head: flag("head") ?? "",
    slice,
    contract: contractForSlice(process.cwd(), slice),
    dryRun: args.includes("--dry-run"),
  });
  console.log(
    result.landed
      ? `landed ${result.event?.slice} (${result.killReport.changedFiles} files)`
      : `REFUSED — merge-kill fired:\n${result.killReport.findings.map((f) => `  - ${f.id}: ${f.title}`).join("\n")}`,
  );
  process.exit(result.exitCode);
}
