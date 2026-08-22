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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveSharedCoordinationPath } from "./coordination-root.js";
import { readSessions, type DispatchLedgerEntry } from "./dispatch-worker.js";
import { integrationEvents } from "./integrate.js";
import type { TripwireSignal } from "./loop-pause.js";

/**
 * Last accepted scorecard debt snapshot — shared coordination root so every worktree
 * compares against the same baseline (cwd-local snapshots would each start at rose:false).
 */
export const SCORECARD_SNAPSHOT = ".openclinxr/openclaw/scorecard-snapshot.json";

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
  /**
   * Ratchet debt on main: frozen file-size ceilings and unresolved Markdown references.
   *
   * Land rate rewards volume, and revert rate is near-free to keep at zero by simply never
   * reverting — leaving the rot on main. Debt is the counterweight: it rises when work is merged
   * that degrades the codebase, whatever the worker or the gate reported.
   */
  debt: { brokenReferenceCeilings: number; sizeFreezeEntries: number };
  notes: string[];
};

function gitLines(repoRoot: string, args: string[]): string[] {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * A slice landed when the integrate gate RECORDED it landing.
 *
 * This previously regexed `Merge branch 'wt/…'` out of commit subjects. Subjects are folklore: a
 * slice integrated by copying intended files leaves no such subject (that under-reported land rate
 * as 33% when the truth was 100%), and any commit can be titled to look like one. An integration
 * event is a fact written by the gate that performed the land.
 */
function landedSlices(repoRoot: string, injected?: { events?: IntegrationEventLike[] }): Set<string> {
  const events = injected?.events ?? integrationEvents(repoRoot);
  return new Set(events.map((event) => event.slice));
}

/** Reverts are the honest signal that "landed" was premature. */
function revertedSubjects(repoRoot: string): string[] {
  return gitLines(repoRoot, ["log", "--format=%s", "-n", "500"]).filter((s) => s.startsWith("Revert "));
}

/** Probe slices measure the substrate, not the backlog; they are excluded from land rate. */
export function isProbeSlice(slice: string): boolean {
  return /^(ceil|proof|probe)-/.test(slice);
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

type IntegrationEventLike = { slice: string; base: string; head: string; at: string };

export function buildScorecard(
  repoRoot: string,
  sessions?: DispatchLedgerEntry[],
  injected?: { events?: IntegrationEventLike[]; mergeSubjects?: string[] },
): Scorecard {
  // Only worktree-bound dispatches are scoreable: landing is detected from the merge of the
  // worker's branch, and pre-worktree dispatches wrote straight into main with no branch to find.
  // Including them produced a 6% land rate that measured the LEDGER's history, not the loop's
  // performance — precisely the kind of number a self-scoring loop would then optimise.
  // ISSUE #440: a fresh dispatch now writes a "spawned" line before the child exists, and a
  // proofed dispatch re-appends a complete line after proofs evaluate — so one dispatch can
  // occupy 2-3 ledger lines. De-duplicate by sessionId (the last line carries the most post-exit
  // knowledge) and skip the early "spawned" lines, or totalDispatched / byModel double-count.
  // ISSUE #565: a "died" line (#563) is the terminal row for a child that exited WITHOUT an end
  // event — provider 402/401, arg-parse abort, kill. No worker ran, so there is no delegate
  // attempt to score against landing; skipping it outright would instead hide provider health,
  // so it is collected and surfaced in notes below. A died id that later RESUMED and completed
  // stays scoreable through its completed line and is not reported as dead.
  const bySession = new Map<string, DispatchLedgerEntry>();
  const diedSessionIds = new Set<string>();
  for (const entry of sessions ?? readSessions(repoRoot)) {
    if (!entry.slice || entry.phase === "spawned") continue;
    if (entry.phase === "died") {
      diedSessionIds.add(entry.sessionId);
      continue;
    }
    // ISSUE #567: a completed line supersedes an earlier died line for the same session —
    // the dispatch was resumed to completion, so it is no longer a LOST dispatch. Without
    // this removal the death note counted every session that ever died, contradicting the
    // comment above and the ## FIXED (#565) note.
    diedSessionIds.delete(entry.sessionId);
    bySession.set(entry.sessionId, entry);
  }
  const all = [...bySession.values()];
  const worktreeBound = all.filter((entry) => entry.worktree !== undefined);
  // Infrastructure probes (isolation proofs, ceiling sweeps) never produce a merge, by design.
  // Counting them as "did not land" made the live figure read 4/14 = 29% when the real answer for
  // work that COULD land was 4/6. A metric that punishes measurement discourages measuring.
  const entries = worktreeBound.filter((entry) => !isProbeSlice(entry.slice ?? ""));
  const probes = worktreeBound.length - entries.length;
  const skipped = all.length - worktreeBound.length;
  const landed = landedSlices(repoRoot, injected);
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
  if (probes > 0) {
    notes.push(
      `${probes} infrastructure probe(s) excluded — they never merge by design, so counting them as `
      + `"did not land" punishes measuring the substrate.`,
    );
  }
  if (skipped > 0) {
    notes.push(
      `${skipped} pre-worktree dispatch(es) excluded — they had no branch, so landing is not `
      + `detectable for them. Scoring only what is measurable beats reporting a number that is not.`,
    );
  }
  if (diedSessionIds.size > 0) {
    notes.push(
      `${diedSessionIds.size} dispatch(es) died before any worker turn (provider outage, kill, or `
      + `abort) and are excluded from the scoreable set — a provider death is not a delegate `
      + `failure, but it is reported here so provider health stays visible.`,
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
    debt: readDebt(repoRoot),
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

/** Count current ratchet debt by parsing the freeze maps — no build step required. */
export function readDebt(repoRoot: string): Scorecard["debt"] {
  const sum = (relative: string, pattern: RegExp): number => {
    try {
      const text = execFileSync("cat", [`${repoRoot}/${relative}`], { encoding: "utf8" });
      let total = 0;
      let match = pattern.exec(text);
      while (match !== null) {
        total += Number(match[1] ?? 0);
        match = pattern.exec(text);
      }
      return total;
    } catch {
      return 0;
    }
  };
  return {
    brokenReferenceCeilings: sum(
      "packages/openclinxr/architecture-rules/src/checks/markdown-references.ts",
      /^\s*"[^"]+":\s*(\d+),/gm,
    ),
    // SIZE_FREEZE entries are `{ maxLines: N, reason }`, not bare numbers — a naive
    // `"path": N` regex silently returned 0, which would have read as "no size debt".
    sizeFreezeEntries: sum(
      "packages/openclinxr/architecture-rules/src/checks/file-size-budgets.ts",
      /maxLines:\s*(\d+)/gm,
    ),
  };
}

export type ScorecardSnapshot = {
  debt: Scorecard["debt"];
  at: string;
  headSha: string;
};

export type DebtDelta = {
  brokenReferenceCeilings: number;
  sizeFreezeEntries: number;
  rose: boolean;
};

function headSha(repoRoot: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function snapshotPath(repoRoot: string): string {
  return resolveSharedCoordinationPath(SCORECARD_SNAPSHOT, repoRoot);
}

export function readScorecardSnapshot(repoRoot: string): ScorecardSnapshot | null {
  const path = snapshotPath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as ScorecardSnapshot;
    if (
      typeof raw?.debt?.brokenReferenceCeilings !== "number"
      || typeof raw?.debt?.sizeFreezeEntries !== "number"
    ) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/** Persist the current card's debt as the accepted baseline (shared coordination root). */
export function writeScorecardSnapshot(repoRoot: string, card: Scorecard): void {
  const path = snapshotPath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  const snapshot: ScorecardSnapshot = {
    debt: { ...card.debt },
    at: new Date().toISOString(),
    headSha: headSha(repoRoot),
  };
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

/**
 * Compare current card debt to the last snapshot.
 * First run (no snapshot): rose=false and writes the baseline so the next run has a floor.
 * Does not overwrite the snapshot when debt changes — the orchestrator (or a deliberate
 * writeScorecardSnapshot after a justified accept) moves the baseline; otherwise rose stays
 * sticky until debt falls back under the last accepted floor.
 */
export function debtDelta(repoRoot: string, card: Scorecard): DebtDelta {
  const prev = readScorecardSnapshot(repoRoot);
  if (!prev) {
    writeScorecardSnapshot(repoRoot, card);
    return {
      brokenReferenceCeilings: 0,
      sizeFreezeEntries: 0,
      rose: false,
    };
  }
  const brokenReferenceCeilings =
    card.debt.brokenReferenceCeilings - prev.debt.brokenReferenceCeilings;
  const sizeFreezeEntries = card.debt.sizeFreezeEntries - prev.debt.sizeFreezeEntries;
  return {
    brokenReferenceCeilings,
    sizeFreezeEntries,
    rose: brokenReferenceCeilings > 0 || sizeFreezeEntries > 0,
  };
}

/**
 * Tripwire evaluation from scorecard debt only.
 * Other signal ids (merge-without-proofs, isolation-leak, fixup-storm) are produced by later
 * layers the orchestrator wires — do not fabricate detectors that never fire and look like coverage.
 */
export function evaluateTripwire(repoRoot: string, card: Scorecard): TripwireSignal[] {
  const delta = debtDelta(repoRoot, card);
  if (!delta.rose) return [];
  return [
    {
      id: "debt-rose",
      detail:
        `Ratchet debt rose vs last snapshot: refsΔ=${delta.brokenReferenceCeilings} `
        + `sizeΔ=${delta.sizeFreezeEntries}`,
      observed: {
        brokenReferenceCeilings: card.debt.brokenReferenceCeilings,
        sizeFreezeEntries: card.debt.sizeFreezeEntries,
        brokenReferenceCeilingsDelta: delta.brokenReferenceCeilings,
        sizeFreezeEntriesDelta: delta.sizeFreezeEntries,
      },
    },
  ];
}

export function formatScorecard(
  card: Scorecard,
  opts?: { debtDelta?: DebtDelta },
): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines = [
    "Delegation scorecard",
    `  dispatched     ${card.totalDispatched}`,
    `  landed         ${card.landed}  (${pct(card.landRate)})`,
    `  reverted       ${card.reverted}  (durability ${pct(card.durabilityRate)})`,
    `  median turns   ${card.medianTurns ?? "n/a"}`,
    `  ratchet debt   refs=${card.debt.brokenReferenceCeilings}  size=${card.debt.sizeFreezeEntries}  (must not rise)`,
  ];
  if (opts?.debtDelta) {
    const d = opts.debtDelta;
    lines.push(
      `  debt delta     refsΔ=${d.brokenReferenceCeilings}  sizeΔ=${d.sizeFreezeEntries}  rose=${d.rose}`,
    );
  }
  lines.push(
    "  by model:",
    ...Object.entries(card.byModel).map(
      ([model, b]) => `    ${model}: ${b.landed}/${b.dispatched} landed`,
    ),
    "  notes:",
    ...card.notes.map((note) => `    - ${note}`),
  );
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const card = buildScorecard(root);
  const delta = debtDelta(root, card);
  console.log(formatScorecard(card, { debtDelta: delta }));
}
