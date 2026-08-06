#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

  execFileSync("git", ["merge", "--no-edit", input.head], {
    cwd: input.repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

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
  const result = integrate({
    repoRoot: process.cwd(),
    base: flag("base") ?? "HEAD",
    head: flag("head") ?? "",
    slice: flag("slice") ?? "unscoped",
    dryRun: args.includes("--dry-run"),
  });
  console.log(
    result.landed
      ? `landed ${result.event?.slice} (${result.killReport.changedFiles} files)`
      : `REFUSED — merge-kill fired:\n${result.killReport.findings.map((f) => `  - ${f.id}: ${f.title}`).join("\n")}`,
  );
  process.exit(result.exitCode);
}
