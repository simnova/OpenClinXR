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

export const READY_DEPTH_TARGET = 10;

/** Consecutive appearances before a finding is called chronic rather than transient. */
export const CHRONIC_AFTER = 2;

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

export type DoneClaim = {
  issue: number;
  stage: string;
  commitOnMain: boolean;
  contractVerified: boolean;
  ok: boolean;
  why: string;
};

export type SupervisorAudit = {
  schemaVersion: "openclinxr.supervisor-audit.v1";
  at: string;
  head: string;
  readyDepth: ReadyDepth;
  doneClaims: DoneClaim[];
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
  const spaced: Array<{ at?: string; keys?: string[] }> = [];
  let lastMs = Number.POSITIVE_INFINITY;
  for (const r of [...rows].reverse()) {
    const t = Date.parse(String(r.at ?? ""));
    if (!Number.isFinite(t) || t > nowMs) continue;
    if (lastMs - t < MIN_AUDIT_GAP_MS) continue;
    spaced.push(r);
    lastMs = t;
    if (spaced.length >= limit) break;
  }
  return spaced.map((r) => r.keys ?? []);
}

/**
 * Marks findings chronic when they appear in every one of the prior `CHRONIC_AFTER` audits.
 *
 * EVERY, not ANY. A finding that flickers — present, gone, present — is self-correcting under load
 * and reporting it as chronic would drown the real ones. Requiring an unbroken run is the
 * conservative direction, and duty 1 asks specifically for what is NOT self-correcting.
 */
export function markChronic(findings: Finding[], prior: string[][]): Finding[] {
  return findings.map((f) => {
    if (prior.length < CHRONIC_AFTER) return f;
    const runs = prior.filter((keys) => keys.includes(f.key)).length;
    return runs >= CHRONIC_AFTER
      ? { ...f, occurrences: runs + 1, chronic: true }
      : { ...f, occurrences: runs + 1 };
  });
}

/** Prior findings absent from this run — they corrected themselves. */
export function resolvedSince(current: Finding[], prior: string[][]): string[] {
  const now = new Set(current.map((f) => f.key));
  const last = prior[0] ?? [];
  return last.filter((k) => !now.has(k));
}

export function appendHistory(root: string, audit: SupervisorAudit): void {
  const p = join(root, HISTORY);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify({ at: audit.at, head: audit.head, keys: audit.findings.map((f) => f.key) })}\n`, "utf8");
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
      execFileSync("git", ["merge-base", "--is-ancestor", sha, "main"], { cwd: root, stdio: "ignore" });
      return true;
    } catch { return false; }
  };
  const onMain = shas.some(isAncestor);
  const artifact = join(root, `.openclinxr/openclaw/contract-verify-issue-${issue}-merge.json`);
  const verified = existsSync(artifact);
  const ok = onMain && shas.length > 0;
  const bySubject = subjectShas.length > 0;
  const why = shas.length === 0
    ? `no commit cites #${issue} — the card says ${stage} and nothing in git claims it`
    : onMain
      ? `${bySubject ? "subject-line fix commit" : "MENTION ONLY — no conventional fix(#N) subject"} on main`
        + (verified ? ", contract-verify artifact present" : "; NO contract-verify artifact — verified at dispatch only")
      : `${shas.length} commit(s) cite #${issue} but NONE is an ancestor of main — work exists on a branch, not in the product`;
  return { issue, stage, commitOnMain: onMain, contractVerified: verified, ok, why };
}

/** Duty 2: is the ready set deep enough, and is it real product work? */
export function readyDepth(
  cards: Array<{ number: number; dispatchable: boolean; factoryStep: string | null; planted: boolean; prioritized: boolean }>,
): ReadyDepth {
  const ready = cards.filter((c) => c.dispatchable && c.planted && c.prioritized);
  const product = ready.filter((c) => c.factoryStep !== null && c.factoryStep !== "instrument");
  return {
    target: READY_DEPTH_TARGET,
    productForward: product.length,
    includingInstrument: ready.length,
    shortfall: Math.max(0, READY_DEPTH_TARGET - product.length),
    cards: product.map((c) => c.number).sort((a, b) => a - b),
  };
}
