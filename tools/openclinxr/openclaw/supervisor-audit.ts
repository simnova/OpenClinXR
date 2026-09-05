/**
 * The supervisor audit — four duties, measured deterministically, run every iteration.
 *
 * Operator directive 2026-08-24: each iteration must (1) review agentic logs for issues that are NOT
 * self-correcting, (2) keep at least 10 prioritized, ready items that move the PRODUCT forward,
 * (3) re-verify work that was reported done, and (4) issue corrections as cards or config changes.
 *
 * WHY THIS IS CODE AND NOT A PROMPT. D9 says build a dark factory with minimal LLM involvement, and
 * every duty above except (4) is a measurement. A supervisor that re-derives these by reading logs
 * each cycle is an LLM doing arithmetic — expensive, non-reproducible, and unable to answer the one
 * question that matters for duty (1): "have I seen this before?" Judgement stays with the reviewers;
 * counting does not.
 *
 * DUTY 1 NEEDS HISTORY, which is the whole reason this module carries state. "Not self-correcting"
 * is not a property of a finding — it is a property of a finding SEEN AGAIN. A single audit cannot
 * distinguish a transient from a chronic defect, so each run appends to a history file and the next
 * run diffs against it. A finding present in N consecutive audits is chronic; one that vanishes
 * corrected itself and is reported as resolved rather than silently dropped.
 *
 * WHAT "PRODUCT FORWARD" MEANS, and it is not my opinion. `board-brief.ts` already enumerates the
 * factory's stations in FACTORY_STEPS, with `instrument` as the explicit non-station. A ready item
 * counts toward the floor only if its factory_step is a real station — so ten instrument cards do
 * not satisfy a directive about moving the product forward. This is the same rule the dispatch gate
 * enforces ("measuring is not building"), read from the same source.
 *
 * WHAT THIS DOES NOT VERIFY, stated because duty 3 invites over-claiming. A "done" card is checked
 * for a commit that cites it AND is an ancestor of main AND a contract-verify artifact. That proves
 * the work LANDED and was verified at merge. It does NOT re-run the contract now, does not grade
 * pixels, and cannot see whether the change was the right one. Those need the reviewers.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";
import { plantedRedCount } from "./openclaw-sweep.js";

/**
 * #721: what the DISPATCH record says about this slice's proofs, or undefined when no row exists.
 *
 * The `why` line used to assert a dispatch verification it never read, for any Landed card without
 * a merge artifact. It was false for the two cards that produced it — issue-692
 * and issue-693 both carry proofsOk:false — and an orchestrator acting on that wording advanced both
 * to Landed on git ancestry alone. `ok` was right the whole time; only the sentence a human reads
 * was wrong, which is the half that changes what someone does.
 */
function dispatchProofVerdict(
  root: string,
  issue: number,
): { proofsOk: boolean; failing: string[] } | { phase: string } | undefined {
  let newestSession: string | undefined;
  let newestPhase: string | undefined;
  let lines: string[];
  try {
    lines = readFileSync(join(root, ".openclinxr/openclaw/worker-sessions.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean);
  } catch {
    return undefined;
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (!line.includes(`"slice":"issue-${issue}"`)) continue;
    let row: {
      proofsOk?: boolean;
      phase?: string;
      sessionId?: string;
      proofs?: Array<{ rule?: string; passed?: boolean }>;
    };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue;
    }
    /**
     * #722: bind to the NEWEST SESSION, then answer only about that session.
     *
     * The first version skipped any row without a boolean proofsOk and walked on, so a `spawned`
     * or `died` row hid the newest attempt and an OLDER session's verdict came back. Measured on
     * issue-638: newest session spawned 20:05 and DIED 20:06, while a different session ninety
     * minutes earlier carried proofsOk:true — and the audit reported "proofs passed".
     */
    if (newestSession === undefined) newestSession = row.sessionId ?? "";
    if ((row.sessionId ?? "") !== newestSession) break;
    if (typeof row.proofsOk !== "boolean") {
      newestPhase = newestPhase ?? row.phase;
      continue;
    }
    const failing = (row.proofs ?? [])
      .filter((entry) => entry.passed === false)
      .map((entry) => String(entry.rule ?? "").split(":")[0] ?? "")
      .filter(Boolean);
    return { proofsOk: row.proofsOk, failing: [...new Set(failing)] };
  }
  return newestPhase === undefined ? undefined : { phase: newestPhase };
}

/** #721: the dispatch-record half of the `why` line — a read fact, never an assumption. */
export function describeDispatchProofs(root: string, issue: number): string {
  const verdict = dispatchProofVerdict(root, issue);
  if (!verdict) return " and no dispatch record — verification state UNKNOWN";
  // #722: the newest session exists but carries no verdict — say which state it is in rather than
  // reaching past it for an older session's answer.
  if (!("proofsOk" in verdict)) {
    const phase = verdict.phase === "died" ? "DIED" : verdict.phase === "spawned" ? "IN FLIGHT" : verdict.phase;
    return `, and the newest dispatch session is ${phase} — it carries no proof verdict`;
  }
  if (!verdict.proofsOk) {
    const which = verdict.failing.length > 0 ? ` (${verdict.failing.join(", ")})` : "";
    return `, and the dispatch record says proofs FAILED${which}`;
  }
  return ", and the dispatch record says proofs passed — but against a tree that may no longer be main";
}


/**
 * Maximum concurrent workers this pipeline has ever reached.
 *
 * MEASURED 2026-08-26 from `.openclinxr/openclaw/worker-sessions.jsonl` — 183 paired spawn/terminal
 * dispatches over ~162h, walking the events as a +1/-1 sweep:
 *
 *     0 workers  63.9% of wall-clock
 *     1 worker   31.7%
 *     2 workers   4.0%
 *     3 workers   0.4%   <- the maximum, ever
 *
 * Re-take it when lanes scale. That is the point of deriving the floor from a measurement instead
 * of typing a literal: the number goes stale visibly rather than silently.
 */
export const OBSERVED_MAX_CONCURRENT_WORKERS = 3;

/**
 * The ready-depth floor, DERIVED.
 *
 * The floor's only job is to stop a dequeue starving, and a dequeue starves when the ready set is
 * smaller than the number of lanes that can be filled at once. That is the observed max
 * concurrency — below it a lane provably idles for want of a card; at or above it, none does.
 *
 * NO BUFFER IS ADDED. A buffer hedges refill latency, and sizing one needs a refill-rate
 * measurement. The only data is 12 windows of ready-set membership (~10h): 3 cards left, 0 entered,
 * 0.00 cards/hour. Too thin to derive from, and picking a buffer anyway would repeat the defect
 * this replaces.
 *
 * PRIOR VALUE: a bare `= 10`, which fired in 33 consecutive audits and never cleared (#654). It was
 * 3.3x the maximum concurrency ever observed and ~10x the typical load. A finding that fires
 * against a number with no basis is not a signal.
 */
export function deriveReadyDepthTarget(maxConcurrentWorkers: number): number {
  if (!Number.isInteger(maxConcurrentWorkers) || maxConcurrentWorkers < 1) {
    throw new Error(
      `deriveReadyDepthTarget: max concurrency must be a positive integer, got `
      + `${String(maxConcurrentWorkers)}. A floor of 0 is worse than a wrong floor — the finding `
      + `could never fire again and the gauge would die silently.`,
    );
  }
  return maxConcurrentWorkers;
}

export const READY_DEPTH_TARGET = deriveReadyDepthTarget(OBSERVED_MAX_CONCURRENT_WORKERS);

/** Consecutive appearances before a finding is called chronic rather than transient. */
export const CHRONIC_AFTER = 2;

/**
 * How far back PERSISTENCE is counted — a different question from whether a finding is CHRONIC.
 *
 * MEASURED 2026-08-24: `ready-depth-below-floor` sat in all 15 rows of the live history and the audit
 * reported "seen 3x", because one bounded window fed both questions. CHRONIC_AFTER must stay small
 * (clause 11: unbounded counting made everything chronic when the operator re-ran the audit three
 * times in five minutes). Persistence must not — severity IS persistence, and a gauge pinned at
 * CHRONIC_AFTER + 1 says a 15-run failure and a 3-run failure are the same thing.
 */
export const PERSISTENCE_WINDOW = 200;

export type Duty = 1 | 2 | 3 | 4;

export type Finding = {
  duty: Duty;
  /** Stable across runs — this is the recurrence key. Must not embed timestamps or counts. */
  key: string;
  detail: string;
  occurrences?: number;
  chronic?: boolean;
};

export type ReadyDepth = {
  target: number;
  /** Dispatchable AND Factory=Planted AND prioritized AND a real factory station. */
  productForward: number;
  /** Same, but including `instrument` cards — the gap is the instrument-heaviness signal. */
  includingInstrument: number;
  shortfall: number;
  cards: number[];
};

/** A landed card waiting on a human grade. Telemetry — reported, never counted as a defect. */
export type PendingReview = { issue: number; stage: string; detail: string };

export type DoneClaim = {
  issue: number;
  stage: string;
  commitOnMain: boolean;
  contractVerified: boolean;
  ok: boolean;
  why: string;
  /** Proof files that still carry an unflipped `it.fails`. A WARNING, not a verdict — see
   *  expectedFailureResidue(). Empty when the artifact is missing or nothing is unflipped. */
  residue?: ResidueReport;
};

export type SupervisorAudit = {
  schemaVersion: "openclinxr.supervisor-audit.v1";
  at: string;
  head: string;
  readyDepth: ReadyDepth;
  doneClaims: DoneClaim[];
  /** Graded-but-open claims: telemetry, never a finding, never chronic-eligible. */
  pendingReviews: PendingReview[];
  findings: Finding[];
  /** Findings from the previous audit that are GONE — they self-corrected. Reported, not dropped. */
  resolved: string[];
};

const HISTORY = ".openclinxr/openclaw/supervisor-audit-history.jsonl";

const sh = (argv: string[], cwd: string): string => {
  try {
    return execFileSync(argv[0] as string, argv.slice(1),
      { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch { return ""; }
};

/**
 * Reads the prior audits' finding keys, newest first.
 *
 * Bounded to the last `limit` runs on purpose: a finding fixed months ago and reintroduced today is
 * a NEW finding, not a chronic one, and treating it as chronic would misreport a regression as
 * long-standing neglect.
 */
export const MIN_AUDIT_GAP_MS = 20 * 60 * 1000;

/**
 * Collapse history rows that are closer together than `MIN_AUDIT_GAP_MS` to the newest, newest-first,
 * bounded to `limit` distinct windows and to rows at or before `nowMs`.
 *
 * ONE window rule, TWO callers. This was inlined in `priorFindingKeys` while `priorReadyWindows`
 * used a bare `.slice(-limit)`, so the chronic predicate and the trend answered the same duty-1
 * question over different windows. MEASURED 2026-08-26: eight history rows at 13:34, 14:37, 14:39,
 * 16:09, 16:21, 16:22, 16:25 and 16:32 — five audits inside 23 minutes of one supervisor iteration —
 * made the trend compare 16:09 against 16:32 and report `CHURNING; entered 683` when nothing had
 * been dequeued and a human had set one board Priority field between two re-runs.
 *
 * The error direction is the damaging one: CHURNING reads as "the shortfall is throughput", which is
 * what tells duty 1 to stand down.
 */
export function spaceByAuditGap<T extends { at?: string }>(
  rows: readonly T[],
  limit: number,
  nowMs: number,
): T[] {
  const spaced: T[] = [];
  let lastMs = Number.POSITIVE_INFINITY;
  for (const r of [...rows].reverse()) {
    const t = Date.parse(String(r.at ?? ""));
    // A row with no parseable timestamp cannot be placed in a window, and a future-dated row
    // (clock skew) would manufacture one — both are dropped rather than guessed at.
    if (!Number.isFinite(t) || t > nowMs) continue;
    if (lastMs - t < MIN_AUDIT_GAP_MS) continue;
    spaced.push(r);
    lastMs = t;
    if (spaced.length >= limit) break;
  }
  return spaced;
}

export function priorFindingKeys(root: string, limit = CHRONIC_AFTER, nowMs = Date.now()): string[][] {
  const p = join(root, HISTORY);
  if (!existsSync(p)) return [];
  const rows = readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as { at?: string; keys?: string[] }; } catch { return null; } })
    .filter((r): r is { at?: string; keys?: string[] } => r !== null);

  /**
   * DISTINCT TIME WINDOWS, not distinct runs.
   *
   * MEASURED on the first live day: running the audit three times inside five minutes marked every
   * finding CHRONIC, because recurrence counted invocations. That makes "not self-correcting" a
   * function of how often the operator hits enter — the metric would scream loudest exactly when
   * someone is iterating on the audit itself.
   *
   * Runs closer together than MIN_AUDIT_GAP_MS collapse to the newest, so a finding is chronic only
   * if it survived genuinely separate observations. Bounded by nowMs so a clock-skewed future row
   * cannot manufacture a window.
   */
  return spaceByAuditGap(rows, limit, nowMs).map((r) => r.keys ?? []);
}

/**
 * Marks findings chronic when they appear in every one of the prior `CHRONIC_AFTER` audits.
 *
 * EVERY, not ANY. A finding that flickers — present, gone, present — is self-correcting under load
 * and reporting it as chronic would drown the real ones. Requiring an unbroken run is the
 * conservative direction, and duty 1 asks specifically for what is NOT self-correcting.
 */
export function markChronic(
  findings: Finding[],
  prior: string[][],
  persistence: string[][] = prior,
): Finding[] {
  return findings.map((f) => {
    if (prior.length < CHRONIC_AFTER) return f;
    const runs = prior.filter((keys) => keys.includes(f.key)).length;
    const occurrences = consecutiveStreak(f.key, persistence) + 1;
    return runs >= CHRONIC_AFTER
      ? { ...f, occurrences, chronic: true }
      : { ...f, occurrences };
  });
}

/**
 * Unbroken appearances counting back from the most recent observation, stopping at the first gap.
 *
 * A STREAK, not a lifetime tally. A finding that fired twelve times, cleared, and returned twice has
 * not persisted for fourteen runs — it self-corrected once, and that is the most important thing
 * duty 1 can say about it. `prior` arrives newest-first because `priorFindingKeys` walks the jsonl in
 * reverse, so this reads forward from index 0.
 */
export function consecutiveStreak(key: string, windows: string[][]): number {
  let n = 0;
  for (const keys of windows) {
    if (!keys.includes(key)) break;
    n += 1;
  }
  return n;
}

/**
 * Turn verified done-claims into duty-3 findings, distinguishing the lifecycle's NORMAL intermediate
 * state from real drift.
 *
 * MEASURED 2026-08-25: the classifier previously emitted `done-but-open` for every verified open
 * claim regardless of stage. `integrate.ts:500` writes Factory=Landed MECHANICALLY on merge, and
 * `board-cli` advances to Graded only on a reviewed close — so Open+Landed is where every slice sits
 * between merging and being graded, and duty 3 was reporting its own happy path as a defect.
 *
 * That is not cosmetic. The pressure a false finding creates is to CLOSE the card to silence it,
 * which marks ungraded work as done — the exact inflation `board-cli`'s own `--no-grade` escape was
 * built to prevent.
 *
 * Open + Landed -> awaiting grade (expected). Open + Graded -> drift (a human signed off and nobody
 * closed it). No age threshold: "overdue" needs a number nobody has calibrated, and inventing one
 * here would be fitting a gate to an observation.
 */
/**
 * Which board rows duty 3 must verify.
 *
 * A row counts when it CLAIMS completion (`Landed` or `Graded`) and the audit knows the issue —
 * whether it is open or CLOSED. Closing is the normal successful end state, so an open-only rule
 * verifies exactly the work that is not yet finished and drops the work that is. Measured: the
 * moment #646 was graded and closed, `doneClaims` went from one entry to zero, and #665 landed and
 * closed between two audits without duty 3 ever seeing it.
 *
 * An unknown number is skipped rather than verified: it would cost a `gh` round-trip per phantom
 * and report failures for issues this audit never fetched.
 */
export function doneClaimRowsToVerify(
  rows: ReadonlyArray<{ factory: string; content?: { number?: number } }>,
  openNumbers: ReadonlySet<number>,
  closedNumbers: ReadonlySet<number>,
): number[] {
  const out: number[] = [];
  for (const row of rows) {
    if (row.factory !== "Landed" && row.factory !== "Graded") continue;
    const n = row.content?.number;
    if (typeof n !== "number") continue;
    if (!openNumbers.has(n) && !closedNumbers.has(n)) continue;
    out.push(n);
  }
  return out;
}

export function classifyDoneClaims(
  claims: DoneClaim[],
  /**
   * Issue numbers that are OPEN. When supplied, a `Graded` claim whose issue is NOT in this set is
   * correctly finished and produces no drift finding — it was graded and then closed, which is the
   * intended end state. Omitting it preserves the original behaviour (every claim treated as open),
   * which was safe only while the caller fetched open issues exclusively.
   */
  openIssueNumbers?: ReadonlySet<number>,
): {
  findings: Finding[];
  pendingReviews: PendingReview[];
} {
  const findings: Finding[] = [];
  const pendingReviews: PendingReview[] = [];

  for (const c of claims.filter((x) => !x.ok)) {
    findings.push({ duty: 3, key: `done-unverified-${c.issue}`, detail: `#${c.issue} (${c.stage}): ${c.why}` });
  }
  for (const c of claims.filter((x) => x.ok)) {
    const isOpen = openIssueNumbers ? openIssueNumbers.has(c.issue) : true;
    if (!isOpen) continue; // graded/landed AND closed: the finished state, nothing to report
    if (String(c.stage) === "Graded") {
      findings.push({
        duty: 3, key: `done-but-open-${c.issue}`,
        detail: `#${c.issue} verified Graded on main but the issue is still OPEN — a human signed off and nobody closed it`,
      });
      continue;
    }
    pendingReviews.push({
      issue: c.issue,
      stage: String(c.stage),
      detail: `#${c.issue} verified ${c.stage} on main and open pending its grade — the expected state between merge and review`,
    });
  }
  return { findings, pendingReviews };
}

/** Prior findings absent from this run — they corrected themselves. */
export function resolvedSince(current: Finding[], prior: string[][]): string[] {
  const now = new Set(current.map((f) => f.key));
  const last = prior[0] ?? [];
  return last
    .filter((k) => !now.has(k))
    // A key that stopped being a FINDING because it was RECLASSIFIED as telemetry did not resolve.
    // `awaiting-grade-*` moved to `pendingReviews` on 2026-08-25, and without this the next audit
    // announces each one as self-corrected while the card sits there ungraded. "Resolved" is a claim
    // about the world, not about this module's bookkeeping.
    .filter((k) => !k.startsWith("awaiting-grade-"));
}

export type ReadyDepthTrend = {
  status: "stagnant" | "churning" | "draining" | "unknown";
  entered: number[];
  left: number[];
};

/**
 * Is the ready queue MOVING, across recorded windows?
 *
 * Duty 1 asks whether a finding is self-correcting. For `ready-depth-below-floor` — chronic for 24
 * audits — that was unanswerable, because a history row recorded finding KEYS and nothing else. A
 * queue that burns two cards and refills two, and a queue frozen for a day, wrote identical rows.
 *
 *   stagnant  same membership throughout: the finding is NOT self-correcting and the shortfall is
 *             real work not being queued
 *   churning  cards both leave and arrive: dequeue is flowing and the number is throughput
 *   draining  cards only leave: the peer's "net thinning" reading, now checkable instead of inferred
 *   unknown   fewer than two windows, or any window with no recorded membership
 *
 * `unknown` on missing membership is load-bearing: every row written before card recording has no
 * `cards`, and reading that as an empty queue would report DRAINING across the whole backfill —
 * a fabricated signal burying the real one.
 */
/** The last `limit` recorded windows, newest last, for readyDepthTrend. */
export function priorReadyWindows(
  root: string,
  limit = 6,
  nowMs = Date.now(),
): Array<{ at: string; cards?: number[] }> {
  const p = join(root, HISTORY);
  if (!existsSync(p)) return [];
  const rows = readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as { at?: string; cards?: number[] }; } catch { return null; } })
    .filter((r): r is { at: string; cards?: number[] } => r !== null && typeof r.at === "string");
  // SAME window rule as the chronic predicate. A bare slice here read the operator's re-run cadence
  // as queue movement; see spaceByAuditGap for the measured instance.
  return spaceByAuditGap(rows, limit, nowMs).reverse();
}

export function readyDepthTrend(
  windows: ReadonlyArray<{ at: string; cards?: readonly number[] }>,
): ReadyDepthTrend {
  if (windows.length < 2) return { status: "unknown", entered: [], left: [] };
  if (windows.some((w) => !Array.isArray(w.cards))) return { status: "unknown", entered: [], left: [] };

  const first = new Set(windows[0]!.cards!);
  const last = new Set(windows[windows.length - 1]!.cards!);
  const entered = [...last].filter((n) => !first.has(n)).sort((a, b) => a - b);
  const left = [...first].filter((n) => !last.has(n)).sort((a, b) => a - b);

  if (entered.length === 0 && left.length === 0) return { status: "stagnant", entered, left };
  if (entered.length === 0) return { status: "draining", entered, left };
  return { status: "churning", entered, left };
}

export function appendHistory(root: string, audit: SupervisorAudit): void {
  const p = join(root, HISTORY);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify({
    at: audit.at,
    head: audit.head,
    keys: audit.findings.map((f) => f.key),
    // Ready-card MEMBERSHIP, not just the count: without it `readyDepthTrend` cannot tell a queue
    // that burns and refills from one that is frozen, which is what made the chronic ready-depth
    // finding uninterpretable for 24 windows.
    cards: audit.readyDepth.cards,
  })}\n`, "utf8");
}

/**
 * Duty 3: was work reported done actually landed and verified?
 *
 * Three independent signals, all cheap and none of them the worker's own account:
 *   - a commit whose message cites the issue exists
 *   - that commit is an ANCESTOR OF MAIN (a commit on an abandoned branch is not landed)
 *   - a contract-verify artifact exists for the slice
 *
 * The ancestry check is the one that matters. MEASURED 2026-08-24: I closed #596 on a `grep VERIFIED`
 * that also matched the word UNVERIFIED, against a commit that was never on main. Reopened four
 * minutes later. A commit existing is not a commit landing.
 */
/**
 * Does a contract-verify artifact record a verification that actually PASSED?
 *
 * EXISTENCE IS NOT CONTENT. `contract-verify-cli.ts:128` writes the report unconditionally and only
 * then, at `:184`, exits 2 when `proofsOk` is false — so a FAILED merge verification leaves a file
 * on disk that is byte-for-byte as present as a passing one. Reading `existsSync` alone made duty 3
 * report `contractVerified: true` for a verification that failed. Four such artifacts already sit in
 * `.openclinxr/openclaw/` (issues 241, 349, 355, 635); none was in the audit window when this was
 * found, so the defect was latent rather than live.
 *
 * Reads BOTH the summary flag and the checks it summarises: a hand-edited or writer-bugged artifact
 * can carry `proofsOk: true` beside a failed check, and trusting the summary over its own evidence
 * is the same substitution one level down.
 *
 * Unreadable or unparseable is NOT verified. Defaulting a corrupt artifact to true would satisfy the
 * headline clause while re-opening the hole underneath it.
 */
export function contractVerifiedFromArtifact(artifactPath: string): boolean {
  if (!existsSync(artifactPath)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const record = parsed as { proofsOk?: unknown; checks?: unknown };
  if (record.proofsOk !== true) return false;
  // A missing checks array is not an implicit pass: an artifact that records no checks recorded no
  // verification. An explicit empty array is equally not evidence of a proof having run.
  if (!Array.isArray(record.checks) || record.checks.length === 0) return false;
  return record.checks.every((c) => (c as { passed?: unknown })?.passed === true);
}

export function verifyDoneClaim(root: string, issue: number, stage: string): DoneClaim {
  // `\b` is NOT supported by git's ERE and silently matches NOTHING — measured 2026-08-24, the
  // counterweight clause caught it: `--grep=#627\b -E` returned zero commits while `--grep=#627`
  // returned two. An explicit digit boundary is required, or #627 also matches #6270.
  /**
   * SUBJECT-LINE citation, not any mention.
   *
   * MEASURED on this module's own first live run: #181 and #622 matched FOUR commits each, two of
   * which were my own supervisor commits whose BODIES say "#181 and #622 are verified Landed and
   * still OPEN" — the audit's own prose counted as a claim that the work was done. A commit
   * discussing an issue is not a commit fixing it, and treating them alike lets any card be
   * "verified" by being talked about.
   *
   * The conventional-commit subject (`fix(#N):`, `feat(#N):`, `test(#N):`) is the deliberate claim.
   * Body mentions are collected separately so a genuinely-fixed card whose author skipped the
   * convention is reported as UNCONVENTIONAL rather than silently failed — refusing real work is a
   * worse failure than admitting a weaker signal.
   */
  /**
   * #743 WITHDRAWN 2026-08-28 — widening this pattern was WRONG and is reverted.
   *
   * I widened it to accept a scope suffix so `fix(#723 residual): ...` would count as a claim on
   * #723. Measured afterwards: BOTH `residual` commits touch
   * a-frame-label-is-read-at-its-own-screenshot.test.ts, which issue-742's ledger names, and
   * contract-verify-issue-742-merge.json records sliceId=issue-742, headSha=dd4c58298e,
   * proofsOk=true. They belong to #742 and cite #723 in their subject.
   *
   * So the widening PROMOTED a misattribution from a weak MENTION to a deliberate claim. Strict is
   * correct here: a subject is the author's claim, and this author claimed the wrong card.
   *
   * If a suffix form is ever wanted, note that `\b` is not a word boundary in `git log -E` (POSIX
   * ERE) and silently matches NOTHING, and that `[^0-9)]` on the first suffix character is required
   * or #72 matches `(#723 ...)`. Both were measured.
   *
   * The real remedy is machine attribution, not subject parsing — see attributionFromMergeArtifact.
   */
  const subjectShas = sh(["git", "log", "--all", "--format=%H",
    `--grep=^(fix|feat|test|refactor|perf|chore)\\(#${issue}\\)`, "-E"], root).split("\n").filter(Boolean);
  const anyShas = sh(["git", "log", "--all", "--format=%H",
    `--grep=(^|[^0-9])#${issue}([^0-9]|$)`, "-E"], root).split("\n").filter(Boolean);
  const shas = subjectShas.length > 0 ? subjectShas : anyShas;
  // `git merge-base --is-ancestor` signals by EXIT CODE, not stdout — it prints nothing either way.
  // Reading its stdout (which is what a `sh()` helper returns) cannot tell "is an ancestor" from
  // "command failed", so this must be a try/catch on the exit status.
  const isAncestor = (sha: string): boolean => {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", sha, "main"], {
        cwd: root,
        stdio: "ignore",
        env: gitEnvWithoutInheritedRepoVars(),
      });
      return true;
    } catch { return false; }
  };
  /**
   * #743 (corrected): MACHINE attribution, used when the git subject does not name the card.
   *
   * A merge-verification artifact is written by contract-verify against a specific slice and a
   * specific head. When it records this issue's sliceId, passing proofs, and a headSha that is an
   * ancestor of main, the work demonstrably landed for THIS card regardless of what any commit
   * subject says.
   *
   * Measured cause: #742's work landed in dd4c5829, subjected `fix(#723 residual)`. Its ledger and
   * its artifact both name issue-742. Subject parsing cannot attribute that and should not try —
   * widening the matcher to reach it promoted the misattribution to #723 instead, which is why that
   * approach was reverted above. The artifact is explicit where the subject is wrong.
   */
  const artifactSha = ((): string | null => {
    const path = join(root, `.openclinxr/openclaw/contract-verify-issue-${issue}-merge.json`);
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as {
        sliceId?: unknown; headSha?: unknown; proofsOk?: unknown;
      };
      if (parsed.sliceId !== `issue-${issue}`) return null;
      if (parsed.proofsOk !== true) return null;
      return typeof parsed.headSha === "string" && parsed.headSha.length >= 7 ? parsed.headSha : null;
    } catch {
      return null;
    }
  })();
  const landedByArtifact = artifactSha !== null && isAncestor(artifactSha);
  const onMain = shas.some(isAncestor) || landedByArtifact;
  const artifact = join(root, `.openclinxr/openclaw/contract-verify-issue-${issue}-merge.json`);
  const verified = contractVerifiedFromArtifact(artifact);
  /**
   * VERIFIED means landed AND re-proved at merge, not landed alone.
   *
   * FOUND ON ITERATION 1 by the peer, verified against the tree: `verified` was computed and then
   * never used here, so a card whose work landed but whose proofs were never re-run at merge
   * reported ok=true. That is duty 3's own blind spot, inside the duty whose entire purpose is
   * refusing to take "done" on trust.
   *
   * `contract-verify-cli` exists precisely because verifying only at dispatch lets a LATER commit
   * drop the proof before the branch is merged — its report is anchored to the head sha being
   * landed. A claim without it has been verified against a tree that may no longer be the one on
   * main.
   */
  const ok = onMain && shas.length > 0 && verified;
  const bySubject = subjectShas.length > 0;
  const why = shas.length === 0
    ? `no commit cites #${issue} — the card says ${stage} and nothing in git claims it`
    : onMain
      ? `${bySubject ? "subject-line fix commit" : "MENTION ONLY — no conventional fix(#N) subject"} on main`
        + (verified
          ? ", contract-verify artifact present"
          : `; NO contract-verify artifact${describeDispatchProofs(root, issue)}`)
      : `${shas.length} commit(s) cite #${issue} but NONE is an ancestor of main — work exists on a branch, not in the product`;
  /**
   * Files this card's OWN commits modified. Residue in a shared proof file the card never opened
   * belongs to whoever planted it — see residueFilesOwnedByCard. A git failure yields undefined,
   * which falls back to counting every proof file rather than silently clearing them.
   */
  let touchedFiles: Set<string> | undefined;
  try {
    const names = shas.flatMap((sha) =>
      execFileSync("git", ["show", "--name-only", "--format=", sha], {
        cwd: root,
        encoding: "utf8",
        env: gitEnvWithoutInheritedRepoVars(),
      })
        .split("\n").map((l) => l.trim()).filter(Boolean));
    touchedFiles = names.length > 0 ? new Set(names) : undefined;
  } catch {
    touchedFiles = undefined;
  }
  const residue = verified ? expectedFailureResidue(root, artifact, undefined, touchedFiles) : undefined;
  /**
   * A card whose own RED was unflipped AT THE VERIFIED SHA was never verified, whatever the artifact
   * says. This is the contradiction the audit reported for four iterations: "ok: true" beside "its
   * own proof file still carries an unflipped it.fails".
   */
  const okFinal = ok && residue?.status !== "unflipped_at_verification";
  return { issue, stage, commitOnMain: onMain, contractVerified: verified, ok: okFinal,
    why: residue?.status === "unflipped_at_verification"
      ? `${why} — BUT its RED was already unflipped at the verified sha, so "verified" was never true`
      : why,
    ...(residue && residue.status !== "none" ? { residue } : {}) };
}


/**
 * Proof files a card's merge artifact actually ran, read from the artifact rather than guessed.
 *
 * The artifact's `checks` array carries the literal rule it executed, e.g.
 *   { "rule": "run:pnpm exec vitest run tools/openclinxr/evidence/the-supine-head-rests-on-its-pillow.test.ts",
 *     "passed": true }
 * so the files belonging to a card are DERIVABLE. The alternative — matching filenames against issue
 * numbers — fails on this repo by construction, because the plant-naming convention here is a prose
 * observable ("the-supine-head-rests-on-its-pillow"), not an id.
 */
export function proofFilesFromArtifact(artifactPath: string): string[] {
  try {
    const d = JSON.parse(readFileSync(artifactPath, "utf8")) as { checks?: Array<{ rule?: string }> };
    const files = new Set<string>();
    for (const c of d.checks ?? []) {
      const rule = String(c.rule ?? "");
      if (!rule.startsWith("run:")) continue;
      for (const m of rule.matchAll(/(\S+\.test\.ts)\b/gu)) files.add(m[1] as string);
    }
    return [...files];
  } catch { return []; }
}

/**
 * EXPECTED-FAILURE RESIDUE — a card whose own proof file still carries an unflipped `it.fails`.
 *
 * WHY EXISTENCE OF THE ARTIFACT WAS NEVER ENOUGH. MEASURED on #181: its merge artifact reports
 * `proofsOk: true` and the check `passed: true`, while the principal assertion at
 * the-supine-head-rests-on-its-pillow.test.ts:59 is STILL `it.fails`. Vitest counts an expected
 * failure as a pass, so a green artifact is entirely consistent with a defect nobody fixed. `ok`
 * requiring the artifact (landed in ef24debb) cannot see this and never could.
 *
 * DELIBERATELY A SEPARATE FIELD, NOT FOLDED INTO `ok`. A proof file can legitimately carry planted
 * REDs for OTHER, unrelated work — this repo runs several plants concurrently in one directory. So
 * residue is a signal that a human must look, not a verdict that the card is unfinished. Overloading
 * `ok` would turn an honest warning into a false failure and train people to ignore it.
 *
 * Reuses `plantedRedCount` rather than writing a second counter: it already strips comments and
 * strings, and its own contract pins that a prose mention of `it.fails` is not a planted RED.
 */
export type ResidueReport = {
  status: "none" | "warning" | "not_determined" | "unflipped_at_verification";
  /** Proof files whose RED was ALREADY unflipped at the artifact's own headSha — verification was
   *  never true for this card, as distinct from a RED planted later by someone else. */
  unflippedAtVerification?: string[];
  total: number;
  files: Array<{ file: string; count: number }>;
  /** Tree the artifact was verified against, and the tree residue was counted in. See below. */
  artifactHeadSha?: string;
  measuredHeadSha?: string;
};

/**
 * Counts planted REDs in a file AS IT WAS at a given commit, not as it is now.
 *
 * This is what separates "the card shipped with its own RED unflipped" from "somebody planted a RED
 * in that file afterwards". Reading the current tree cannot tell those apart — the module said so in
 * its own comment and the peer review turned that admission into the fix.
 */
function plantedRedCountAtSha(root: string, sha: string, rel: string): number {
  try {
    const src = execFileSync("git", ["show", `${sha}:${rel}`],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        env: gitEnvWithoutInheritedRepoVars(),
      });
    // Same stripping rule as plantedRedCount, applied to historical content.
    const stripped = src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    return (stripped.match(/\bit\.fails\s*\(/gu) ?? []).length;
  } catch { return -1; }
}

/**
 * The proof files whose expected-failure residue a card is answerable for.
 *
 * A card's `done_when` may name a shared proof file that carries ANOTHER issue's standing
 * `it.fails` — the counterweight convention actively encourages exactly that. Counting it makes
 * duty 3 permanently red on a card whose own contract was flipped and verified, and a permanent
 * false red buries the real unflipped-RED it exists to surface.
 *
 * Measured on #664: of its two named proofs, the one it flipped carried 0 residue and the one it
 * never opened carried 5, planted for #293 and labelled as such in its own header.
 *
 * `touched === undefined` means ownership could not be determined, and that falls back to counting
 * EVERY proof file. Narrowing on unknown input would report clean about files nobody inspected,
 * which is the defect class this module already warns about at `expectedFailureResidue`.
 */
export function residueFilesOwnedByCard(
  proofFiles: readonly string[],
  touched: ReadonlySet<string> | undefined,
): string[] {
  if (!touched) return [...proofFiles];
  return proofFiles.filter((f) => touched.has(f));
}

export function expectedFailureResidue(
  root: string, artifactPath: string, measuredHeadSha?: string,
  /** Files the card's own commits modified. Undefined = unknown, so every proof file counts. */
  touchedFiles?: ReadonlySet<string>,
): ResidueReport {
  const counted = residueFilesOwnedByCard(proofFilesFromArtifact(artifactPath), touchedFiles)
    .map((file) => ({ file, count: plantedRedCount(root, file) }));

  /**
   * A NEGATIVE COUNT IS NOT ZERO. `plantedRedCount` returns -1 when a file cannot be read
   * (openclaw-sweep.ts:105-109, and its own comment says "unreadable is not zero reds"). The first
   * version of this filtered on `count > 0`, which silently turned -1 into "no residue" — a check
   * reporting clean about a file it never opened, which is the defect class this audit exists to
   * catch. Caught by peer review before it landed.
   */
  const unreadable = counted.filter((r) => r.count < 0);
  const withResidue = counted.filter((r) => r.count > 0);
  if (unreadable.length > 0) {
    return { status: "not_determined", total: -1, files: unreadable,
      ...(measuredHeadSha ? { measuredHeadSha } : {}), ...shaOf(artifactPath) };
  }
  /**
   * RESIDUE AT THE ARTIFACT'S OWN SHA IS A FAILURE, NOT A WARNING.
   *
   * The distinction the earlier version could not draw. If the RED was already unflipped at the
   * commit the contract was verified against, then "verified" was never true for that card — the
   * artifact records only that vitest exited zero, and vitest counts an expected failure as a pass.
   * MEASURED on #181: artifact headSha ec5cbd42, and the principal clause is `it.fails` there too.
   *
   * Residue introduced AFTER that sha is a different thing: the card may have shipped honestly and a
   * later slice planted a RED in the same file. That stays a warning, which is what the peer review
   * asked for and what removes the contradiction of reporting "ok" and "its own RED is unflipped"
   * about the same card in the same breath.
   */
  const artifactSha = shaOf(artifactPath).artifactHeadSha;
  const atSha = artifactSha
    ? withResidue.filter((r) => plantedRedCountAtSha(root, artifactSha, r.file) > 0)
    : [];
  return {
    status: atSha.length > 0 ? "unflipped_at_verification" : (withResidue.length > 0 ? "warning" : "none"),
    total: withResidue.reduce((n, r) => n + r.count, 0),
    files: withResidue,
    ...(atSha.length > 0 ? { unflippedAtVerification: atSha.map((r) => r.file) } : {}),
    ...(measuredHeadSha ? { measuredHeadSha } : {}),
    ...shaOf(artifactPath),
  };
}

/**
 * The artifact's headSha, so a reader can see the TEMPORAL gap this measurement has.
 *
 * The proof file is named by an artifact verified at one tree; the residue is counted in the CURRENT
 * tree. A card can therefore land legitimately and later show residue because a DIFFERENT card
 * planted a new RED in the same file. That false positive is real and is not detected here — both
 * shas are reported so the reader can see when they diverge. Whether it has occurred in this repo is
 * NOT DETERMINED.
 */
function shaOf(artifactPath: string): { artifactHeadSha?: string } {
  try {
    const d = JSON.parse(readFileSync(artifactPath, "utf8")) as { headSha?: string };
    return d.headSha ? { artifactHeadSha: d.headSha } : {};
  } catch { return {}; }
}

/** Duty 2: is the ready set deep enough, and is it real product work? */
/**
 * Can this card's own proofs tell whether its RED was FLIPPED?
 *
 * The third axis of readiness. `dispatchable` says a contract exists; `flippable` says a RED exists;
 * neither says the contract can SEE the flip.
 *
 * Structural, not per-card: **vitest counts an expected failure as a pass.** A planted `it.fails`
 * that is still failing exits 0; flip it to `it` and it exits 0. A `run:` rule is satisfied
 * identically before and after the work, and `changed:<file>` is satisfied by touching the file.
 *
 * MEASURED 2026-08-26 across every dispatchable card: detects 1, CANNOT detect 8, no run: proof 2.
 * Found by the delegator on #644, whose four proofs all passed while its three planted `it.fails`
 * were byte-identical to pre-dispatch.
 *
 * `undefined` = undetermined (nothing executable was run). Undetermined is NOT "cannot" — reporting
 * an unmeasured card as undetectable manufactures a finding out of an absence of measurement.
 */
export function proofsCanDetectFlip(
  proofs: ReadonlyArray<{ rule: string; exitsNonZeroToday?: boolean }>,
): boolean | undefined {
  const executable = proofs.filter((p) => typeof p.exitsNonZeroToday === "boolean");
  if (executable.length === 0) return undefined;
  return executable.some((p) => p.exitsNonZeroToday === true);
}

export function readyDepth(
  cards: Array<{
    number: number; dispatchable: boolean; factoryStep: string | null; planted: boolean; prioritized: boolean;
    /**
     * Does at least one of this card's proofs currently FAIL?
     *
     * `false` means every proof is already satisfied, so a worker dispatched here has nothing to
     * flip. #510 satisfied dispatchable+planted+prioritized while being a COMPLETED measurement —
     * its proof runs `3 passed (3)` because `reject_measured` closed it successfully. A delegator
     * probed it before dispatch and stopped; the gauge would have kept offering it forever.
     *
     * `planted` does not cover this: it is the board's `factory == "Planted"` LABEL, somebody's
     * CLAIM that a RED exists, never a measurement of one.
     *
     * `undefined` means undetermined — a `run:` proof nobody executed. Undetermined COUNTS, because
     * dropping it would make the queue read low for a reason no reader can see.
     */
    flippable?: boolean;
    /**
     * Can this card's contract land bytes on a PRODUCT path — i.e. reset the product clock?
     *
     * `factory_step != instrument` is NOT that question, and the gap ran for 38 consecutive audits.
     * #577 is `room_generate` and its only `changed:` target is a docs file, so it was counted as
     * product-forward while `assertProductLaneNotStarved` refused every non-product dispatch on a
     * 17-commit clock. The gauge said the queue had product work; the gate said it did not; the
     * gate was right.
     *
     * Derive it from the card's `changed:` targets through `isProductPath` — the SAME predicate the
     * refusing gate uses (product-lane-gate.ts:63) — so the two definitions cannot drift.
     *
     * `undefined` preserves the old factory-step behaviour exactly, so callers that do not supply it
     * are unchanged. A gauge fix that silently reclassifies unmeasured cards is worse than the
     * defect it replaces.
     */
    landsProductBytes?: boolean;
  }>,
): ReadyDepth {
  const ready = cards.filter((c) => c.dispatchable && c.planted && c.prioritized && c.flippable !== false);
  // CONJUNCTIVE, deliberately: a product STATION that can actually deliver. `instrument` stays
  // excluded even when it touches a product path — FACTORY_STEPS names it the non-station and this
  // is not the place to relitigate that. Strictly tighter than the old rule; it promotes nothing.
  const product = ready.filter(
    (c) => c.factoryStep !== null && c.factoryStep !== "instrument" && c.landsProductBytes !== false,
  );
  return {
    target: READY_DEPTH_TARGET,
    productForward: product.length,
    includingInstrument: ready.length,
    shortfall: Math.max(0, READY_DEPTH_TARGET - product.length),
    cards: product.map((c) => c.number).sort((a, b) => a - b),
  };
}
