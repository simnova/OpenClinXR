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
import { plantedRedCount } from "./openclaw-sweep.js";

export const READY_DEPTH_TARGET = 10;

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
export function classifyDoneClaims(claims: DoneClaim[]): Finding[] {
  const out: Finding[] = [];
  for (const c of claims.filter((x) => !x.ok)) {
    out.push({ duty: 3, key: `done-unverified-${c.issue}`, detail: `#${c.issue} (${c.stage}): ${c.why}` });
  }
  for (const c of claims.filter((x) => x.ok)) {
    out.push(String(c.stage) === "Graded"
      ? {
        duty: 3, key: `done-but-open-${c.issue}`,
        detail: `#${c.issue} verified Graded on main but the issue is still OPEN — a human signed off and nobody closed it`,
      }
      : {
        duty: 3, key: `awaiting-grade-${c.issue}`,
        detail: `#${c.issue} verified ${c.stage} on main and open pending its grade — the expected state between merge and review`,
      });
  }
  return out;
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
        + (verified ? ", contract-verify artifact present" : "; NO contract-verify artifact — verified at dispatch only")
      : `${shas.length} commit(s) cite #${issue} but NONE is an ancestor of main — work exists on a branch, not in the product`;
  const residue = verified ? expectedFailureResidue(root, artifact) : undefined;
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
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    // Same stripping rule as plantedRedCount, applied to historical content.
    const stripped = src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    return (stripped.match(/\bit\.fails\s*\(/gu) ?? []).length;
  } catch { return -1; }
}

export function expectedFailureResidue(
  root: string, artifactPath: string, measuredHeadSha?: string,
): ResidueReport {
  const counted = proofFilesFromArtifact(artifactPath)
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
