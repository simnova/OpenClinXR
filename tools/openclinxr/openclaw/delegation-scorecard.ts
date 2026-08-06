#!/usr/bin/env tsx
/**
 * Mechanical scorecard for delegated work.
 *
 * WHY THIS EXISTS: the previous score for a delegation cycle was 7.5/10 — my own judgement. A loop
 * that scores itself on a judgement call optimises the judgement, not the work. Worse, the metrics
 * closest to hand are the misleading ones: "gates green" was TRUE for the documentation purge that
 * deleted tombstones and MADR-cited evidence, and "worker reported success" was true for a worker
 * that skipped a proof it had been told was non-negotiable.
 *
 * So this deliberately scores OUTCOMES that survive the worker's own reporting:
 *   - did it land, or get reverted later
 *   - did the gate pass on the FIRST try after merge, or need orchestrator repair
 *   - how long did it take end to end
 *
 * It reads the worker session ledger plus git history. It never asks a worker how it did.
 */

import { execFileSync } from "node:child_process";
import { readSessions, type DispatchLedgerEntry } from "./dispatch-worker.js";

export type SliceOutcome = {
  slice: string;
  sessionId: string;
  model: string;
  turns?: number;
  /** Wall-clock is only knowable when the ledger holds both a start and the merge commit. */
  landed: boolean;
  revertedLater: boolean;
};

export type Scorecard = {
  totalDispatched: number;
  landed: number;
  reverted: number;
  /** Landed ÷ dispatched. The single number worth watching over time. */
  landRate: number;
  /** Of landed work, the share NOT later reverted. */
  durabilityRate: number;
  medianTurns: number | undefined;
  byModel: Record<string, { dispatched: number; landed: number }>;
  notes: string[];
};

function gitLines(repoRoot: string, args: string[]): string[] {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** A slice landed if a commit or merge in history mentions its branch or slice id. */
function landedSlices(repoRoot: string): Set<string> {
  const subjects = gitLines(repoRoot, ["log", "--format=%s", "-n", "500"]);
  const landed = new Set<string>();
  for (const subject of subjects) {
    const merge = /Merge branch '(?:wt\/)?([^']+)'/.exec(subject);
    if (merge?.[1]) landed.add(merge[1]);
  }
  return landed;
}

/** Reverts are the honest signal that "landed" was premature. */
function revertedSubjects(repoRoot: string): string[] {
  return gitLines(repoRoot, ["log", "--format=%s", "-n", "500"]).filter((s) => s.startsWith("Revert "));
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function buildScorecard(repoRoot: string, sessions?: DispatchLedgerEntry[]): Scorecard {
  // Only worktree-bound dispatches are scoreable: landing is detected from the merge of the
  // worker's branch, and pre-worktree dispatches wrote straight into main with no branch to find.
  // Including them produced a 6% land rate that measured the LEDGER's history, not the loop's
  // performance — precisely the kind of number a self-scoring loop would then optimise.
  const all = (sessions ?? readSessions(repoRoot)).filter((entry) => entry.slice);
  const entries = all.filter((entry) => entry.worktree !== undefined);
  const skipped = all.length - entries.length;
  const landed = landedSlices(repoRoot);
  const reverts = revertedSubjects(repoRoot);

  const outcomes: SliceOutcome[] = entries.map((entry) => {
    const slice = entry.slice ?? "";
    const didLand = landed.has(slice);
    return {
      slice,
      sessionId: entry.sessionId,
      model: entry.model,
      ...(entry.turns !== undefined ? { turns: entry.turns } : {}),
      landed: didLand,
      revertedLater: reverts.some((subject) => subject.includes(slice)),
    };
  });

  const byModel: Scorecard["byModel"] = {};
  for (const outcome of outcomes) {
    const bucket = (byModel[outcome.model] ??= { dispatched: 0, landed: 0 });
    bucket.dispatched += 1;
    if (outcome.landed) bucket.landed += 1;
  }

  const landedCount = outcomes.filter((o) => o.landed).length;
  const revertedCount = outcomes.filter((o) => o.revertedLater).length;
  const notes: string[] = [];
  if (skipped > 0) {
    notes.push(
      `${skipped} pre-worktree dispatch(es) excluded — they had no branch, so landing is not `
      + `detectable for them. Scoring only what is measurable beats reporting a number that is not.`,
    );
  }
  if (outcomes.length < 10) {
    notes.push(
      `Only ${outcomes.length} scored dispatches — too few to read a trend. Treat rates as indicative.`,
    );
  }
  notes.push(
    "Not measured here: whether a landed change was CORRECT. Gates were green for the purge that "
    + "deleted tombstones and MADR-cited evidence. Land rate is throughput, not quality.",
  );

  return {
    totalDispatched: outcomes.length,
    landed: landedCount,
    reverted: revertedCount,
    landRate: outcomes.length === 0 ? 0 : landedCount / outcomes.length,
    durabilityRate: landedCount === 0 ? 0 : (landedCount - revertedCount) / landedCount,
    medianTurns: median(outcomes.flatMap((o) => (o.turns === undefined ? [] : [o.turns]))),
    byModel,
    notes,
  };
}

export function formatScorecard(card: Scorecard): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines = [
    "Delegation scorecard",
    `  dispatched     ${card.totalDispatched}`,
    `  landed         ${card.landed}  (${pct(card.landRate)})`,
    `  reverted       ${card.reverted}  (durability ${pct(card.durabilityRate)})`,
    `  median turns   ${card.medianTurns ?? "n/a"}`,
    "  by model:",
    ...Object.entries(card.byModel).map(
      ([model, b]) => `    ${model}: ${b.landed}/${b.dispatched} landed`,
    ),
    "  notes:",
    ...card.notes.map((note) => `    - ${note}`),
  ];
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(formatScorecard(buildScorecard(process.cwd())));
}
