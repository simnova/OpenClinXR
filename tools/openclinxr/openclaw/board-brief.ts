import { parseRunArgv, partitionDoneWhen } from "../../../packages/openclinxr/agent-loop/src/done-when-rules.js";

/**
 * Board → brief: the missing direction.
 *
 * `board-cli.ts` only ever wrote TO the board (open/status/close/review/merge), so every brief was
 * hand-written and the board recorded outcomes after the fact. "Driven by the GitHub board" needs
 * this step, and this step is mostly about REFUSING.
 *
 * An issue is prose; a dispatch needs machine-checkable proofs. If this synthesised plausible proofs
 * from a title, the contract layer would become decorative — a worker judged against criteria nobody
 * chose, which is worse than no contract because it looks like one. Most of the current board is not
 * dispatchable. Saying so is the correct output, not a failure of this function.
 */

export type BoardIssue = { number: number; title: string; body: string };

export type BriefResult =
  | { dispatchable: false; reason: string }
  | {
      dispatchable: true;
      slice: string;
      proofs: string[];
      prompt: string;
      /**
       * #66: repo-relative paths from `## asset_paths` bullets. Land in trusted brief.json so
       * prepareWorktreeForWorker → provisionWorktreeAssets copies them into the worker tree.
       */
      assetPaths?: string[];
    };

/**
 * Pull `done_when` BULLETS verbatim. Paraphrasing a proof means nobody agreed to it.
 *
 * Collect bullet lines only, and stop at the first non-bullet, non-blank line. An earlier version
 * ran to the next `##` heading and swallowed a trailing prose paragraph that began with bold text —
 * refusing the first real issue written for this pipeline, whose done_when block was fine. A parser
 * that rejects correct input teaches people to write for the parser rather than for the reader.
 */
/**
 * Bullets that `extractDoneWhen` would DISCARD: any bullet appearing after the first interrupting
 * line, still inside the `## done_when` section.
 *
 * The parser stops at the first non-bullet line, so a sentence of commentary between two rules
 * silently truncates the contract. Measured before this existed: a card declaring three rules
 * dispatched with one, green, against criteria its author never chose. That is the failure
 * `PROTO_BOARD_LOOP` calls "worse than no contract because it looks like one".
 *
 * REFUSE rather than repair. A card whose rules are split by prose may have meant either shape,
 * and silently skipping the prose would substitute this parser's judgement for the author's.
 *
 * Blank lines are NOT interruptions — `extractDoneWhen` already skips them and markdown authors
 * space bullets routinely.
 */
export function droppedDoneWhenRules(body: string): string[] {
  const start = /##\s*done_when\s*\n/i.exec(body);
  if (!start) return [];
  const section = body.slice(start.index + start[0].length).split(/\n##\s/)[0] ?? "";
  const dropped: string[] = [];
  let interrupted = false;
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (!bullet?.[1]) { interrupted = true; continue; }
    if (interrupted) dropped.push(bullet[1].trim());
  }
  return dropped;
}

function extractDoneWhen(body: string): string[] {
  const start = /##\s*done_when\s*\n/i.exec(body);
  if (!start) return [];
  const rules: string[] = [];
  for (const line of body.slice(start.index + start[0].length).split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (!bullet?.[1]) break; // prose or a new heading ends the list
    rules.push(bullet[1].trim());
  }
  return rules;
}

/**
 * #66: optional `## asset_paths` bullet list of repo-relative files/dirs to provision into the
 * worker worktree (gitignored GLBs, cagematch lanes, etc.). Same bullet parser as done_when.
 */
function extractAssetPaths(body: string): string[] {
  const start = /##\s*asset_paths\s*\n/i.exec(body);
  if (!start) return [];
  const paths: string[] = [];
  for (const line of body.slice(start.index + start[0].length).split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (!bullet?.[1]) break;
    const path = bullet[1].trim();
    if (path) paths.push(path);
  }
  return paths;
}


/**
 * OPERATOR DIRECTIVE D9 (dark factory) enforcement.
 *
 * "Build a dark software factory with minimal LLM involvement necessary... it's a pipeline so each
 * step is part of the factory... capable of allowing an examination to perform with no further LLM
 * involvement." — operator, 2026-08-08
 *
 * WHY THIS IS A GATE AND NOT PROSE. The operator observed that coaching lands and then behaviour
 * reverts. A peer round diagnosed the mechanism as CYCLE-CERTAINTY MAXIMISATION: the orchestrator
 * selects slices that maximise the chance of a green report this cycle, and any directive costing
 * current-cycle certainty is deprioritised regardless of what was written down. Prose cannot beat
 * that; a refusal can. The same peer scored a weaker proposal (`## automation:`) against ten real
 * dispatched slices and it would have refused ONE. This check refuses the comfort cluster —
 * measure-only instrumentation and hand-authored clothing — while letting real factory work through.
 *
 * Every board issue already passes through briefFromIssue, so this sits on the path by construction
 * rather than being another mechanism that is built and never wired.
 */
export const FACTORY_STEPS = [
  "body_param",
  "clothing_consume",
  "clothing_generate",
  "motion_retarget",
  "lip_sync",
  "room_generate",
  "equipment_generate",
  "staging",
  "dialogue_runtime",
  "instrument",
] as const;

export type FactoryStep = (typeof FACTORY_STEPS)[number];

/** Reads `## factory_step: <enum>` from an issue body. */
export function extractFactoryStep(body: string): string | null {
  const m = /^##\s*factory_step:\s*([a-z_]+)\s*$/im.exec(body);
  return m ? m[1]! : null;
}

/** Reads an `unblocks: <step>` line — required when the step is `instrument`. */
export function extractUnblocks(body: string): string | null {
  /**
   * Accepts BOTH `## unblocks: <step>` and a bare `unblocks: <step>`.
   *
   * The sibling directive one function up REQUIRES `##` (factory_step, :109) while this one's
   * original `^\s*` could not match it — so a card writing both to the documented convention had its
   * factory_step parsed and its unblocks silently dropped, and was refused as "no valid unblocks
   * line". MEASURED on the live board: #614, #613 and #612 all use the `##` form; only #635 uses the
   * bare one. The trap fires when someone operationalizes an instrument card, i.e. on correct
   * behaviour.
   *
   * Permissive on purpose: tightening this to demand `##` would instead refuse #635. `^#{0,3}\s*`
   * still anchors to a line start, so prose mentioning the word mid-sentence is not a directive.
   */
  const m = /^#{0,3}\s*unblocks:\s*([a-z_]+)\s*$/im.exec(body);
  return m ? m[1]! : null;
}

/**
 * D1: a clothing slice that describes new hand-authored shells without naming the adopted tooling is
 * the anti-pattern the operator called out by name — "a handful of LLMs toiling in non-deterministic
 * ways building things in the factory".
 */
export function clothingSliceLacksToolPath(step: string, body: string, title: string): boolean {
  if (step !== "clothing_generate" && step !== "clothing_consume") return false;
  const haystack = `${title}\n${body}`.toLowerCase();
  const namesTool = /makeclothes|mhclo|hm08|mpfb/.test(haystack);
  return !namesTool;
}

/**
 * Rules whose target is a PATH. A markdown-formatted target parses as a literal path containing the
 * formatting, so it can never match a file and the proof can never pass.
 *
 * MEASURED 2026-08-24 across 62 proof failures in the dispatch ledger: 24 of them were
 * `changed:`-ONLY — every other proof green, the worker did real work, and one named file did not
 * change. One of those rules was literally:
 *
 *     changed: `tools/openclinxr/openclaw/dispatch-worker.ts`
 *
 * `done-when-rules.ts:261` does `rule.slice("changed:".length).trim()`, so the target is
 * "`tools/...`" WITH the backticks. No such file exists. A worker cannot satisfy that rule by any
 * action, and it was discovered only after the dispatch had already spent its turns.
 *
 * This refuses it at brief time, where a refusal costs nothing.
 */
const PATH_RULES = ["changed:", "exists:", "min-bytes:", "live:"] as const;
/** Characters that cannot appear in a repo path here and indicate markdown leaked into the rule. */
/**
 * Characters that make a path target unsatisfiable. `*` is deliberately NOT here.
 *
 * It was, and that refused rules the evaluator supports: `done-when-tree.ts`'s `globMatch` branches
 * on `pattern.includes("*")` and builds a regex from the segments, so a wildcard is a first-class
 * form. Worse than a false refusal, the remediation was destructive — stripping the `*` from
 * `exists:evidence/*.json` yields `exists:evidence/.json`, converting a working contract into the
 * broken one the message accused it of being.
 *
 * The rest stay: a backtick, quote, bracket or paren in a path is a markdown artifact
 * (`exists:[evidence](path/x.json)`), and those genuinely cannot resolve.
 */
const FORMATTING = /[`"'\[\]()]/u;

export function malformedPathTargets(rules: readonly string[]): string[] {
  const bad: string[] = [];
  for (const rule of rules) {
    const prefix = PATH_RULES.find((p) => rule.startsWith(p));
    if (!prefix) continue;
    let target = rule.slice(prefix.length).trim();
    // min-bytes: carries "<path>:<n>" — the count is not part of the path.
    if (prefix === "min-bytes:") target = target.replace(/:\d+\s*$/u, "");
    if (target.length > 0 && FORMATTING.test(target)) bad.push(rule);
  }
  return bad;
}

import { existsSync, readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";


/**
 * A `run:` naming an `it.fails` plant is a VACUOUS proof — measured 2026-08-26:
 *
 *   worker does nothing (it.fails + throwing) -> exit 0   <- satisfied before any work
 *   fixed + flipped to it()                   -> exit 0
 *   fixed, flip forgotten                     -> exit 1   <- the only state it refuses
 *
 * `done-when-rules.ts:386` diagnosed this against #569/#570 and landed the remedy: `live:<file>`
 * asserts zero remaining `it.fails` in the named plant. The remedy is sound and under-adopted —
 * 5 of 14 open cards with a `run:` rule carry an it.fails plant and neither `live:` nor
 * `measured-before:`.
 *
 * Returns the plant paths that are unprotected. Empty when no tree root is available, because the
 * check requires reading the file: the rule text alone cannot tell an it.fails plant from a plain
 * one, which is why the gate could never catch this before.
 */
export function unprotectedItFailsPlants(
  rules: readonly string[],
  treeRoot: string | undefined,
): string[] {
  if (!treeRoot) return [];
  // ONLY `live:` protects. It asserts zero remaining `it.fails` in the named plant
  // (done-when-rules.ts:413 `countPlantedItFails(...) === 0`), which is exactly the guarantee a
  // bare `run:` cannot give.
  //
  // CORRECTED 2026-08-26, same day, after a consult caught it: `measured-before:` was in this set
  // and was wrong on two counts. Its payload is `<artifact>:<product>` (done-when-rules.ts:321-324),
  // so the string added here could never equal a `.test.ts` token and the branch was dead. And even
  // matching, it would not protect: `measured-before:` asserts ORDERING ONLY — that an artifact was
  // written before a product edit, by mtime (done-when-rules.ts:310-319). It says nothing about
  // whether a plant was flipped. Advertising it as protection was the more serious half; the dead
  // comparison merely hid it. Zero open cards used it, so removing it changes protection for none.
  const covered = new Set<string>();
  for (const rule of rules) {
    if (rule.startsWith("live:")) covered.add(rule.slice("live:".length).trim());
  }
  const bad: string[] = [];
  for (const rule of rules) {
    if (!rule.startsWith("run:")) continue;
    for (const tok of rule.split(/\s+/u)) {
      // .tsx and .mts plants are real vitest targets — every ui-admin worldview plant is .tsx —
      // so a .ts-only filter silently skipped them and their run: proofs stayed unprotected.
      if (!/\.test\.(?:ts|tsx|mts)$/u.test(tok)) continue;
      if (tok.includes("*")) continue; // a glob is a different shape; do not guess
      if (covered.has(tok)) continue;
      const abs = isAbsolute(tok) ? tok : join(treeRoot, tok);
      if (!existsSync(abs)) continue; // someone else's refusal, not this gate's business
      let source: string;
      try {
        source = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      if (/\bit\.fails\s*\(/u.test(source) && !bad.includes(tok)) bad.push(tok);
    }
  }
  return bad;
}

export function briefFromIssue(issue: BoardIssue, treeRoot?: string): BriefResult {
  const rules = extractDoneWhen(issue.body);
  const malformed = malformedPathTargets(rules);
  if (malformed.length > 0) {
    return {
      dispatchable: false,
      reason:
        `Issue #${issue.number} has ${malformed.length} done_when rule(s) whose path target carries `
        + `markdown formatting, so the target is a literal string no file can match and the proof can `
        + `NEVER pass: ${malformed.join(" | ")}. Strip the backticks/quotes/brackets from the path. `
        + `Measured: 24 of 62 ledger proof failures were changed:-only, one of them exactly this shape.`,
    };
  }

  const unprotected = unprotectedItFailsPlants(rules, treeRoot);
  if (unprotected.length > 0) {
    return {
      dispatchable: false,
      reason:
        `Issue #${issue.number} has ${unprotected.length} run: proof(s) naming a plant that contains `
        + `it.fails, with no live: rule covering it: ${unprotected.join(" | ")}. `
        + `vitest counts an expected-fail as a PASS, so that run: exits 0 on an UNTOUCHED tree — the `
        + `proof is satisfied before the work starts and cannot tell done from not-started. Add `
        + `live:<plant path> for each, which asserts zero remaining it.fails once the slice flips `
        + `them. Measured 2026-08-26: 5 of 14 open cards with a run: rule carried this shape.`,
    };
  }
  /**
   * A contract that is SILENTLY partial is worse than one that is refused: the slice goes green
   * against rules the author did not choose. Checked before the empty-rules branch so a card whose
   * ONLY rules sit below an interruption gets this message rather than "no rules at all".
   */
  const dropped = droppedDoneWhenRules(issue.body);
  if (dropped.length > 0) {
    return {
      dispatchable: false,
      reason:
        `Issue #${issue.number} would dispatch on a PARTIAL contract: ${dropped.length} done_when `
        + `rule(s) sit below an interrupting line and the parser stops at the first non-bullet, so `
        + `they would be silently dropped — the slice would go green against rules you did not `
        + `choose. Lost: ${dropped.join(" | ")}. Move the commentary above the heading or below the `
        + `list; blank lines between bullets are fine.`,
    };
  }
  if (rules.length === 0) {
    /**
     * TWO DIFFERENT FAILURES, and they need different actions. `extractDoneWhen` returns [] both
     * when the heading is absent and when it is present above prose, and this branch used to
     * describe only the first — so a card whose block exists was told to add the block.
     *
     * Measured on the live board: #34, #51, #663 and #667 have no heading (message was correct);
     * #625 has `## done_when` at body line 31 above a deliberate "not operationalized" note
     * (message was wrong). The named remediation is the one thing that cannot help there: adding a
     * second heading is inert, because the extractor takes the FIRST match and would never read the
     * new rules beneath it.
     */
    const hasHeading = /##\s*done_when\s*\n/i.test(issue.body);
    return {
      dispatchable: false,
      reason: hasHeading
        ? `Issue #${issue.number} has a "## done_when" block but no machine-checkable RULES in it — `
          + `only prose, so there is nothing a worker could be held to. Add bullets (run:, changed:, `
          + `exists:, min-bytes:, measured-before:) UNDER THE EXISTING HEADING; a second `
          + `"## done_when" is inert because only the first is read. If the card is deliberately `
          + `un-operationalized, that is a valid state and it should stay un-dispatchable.`
        : `Issue #${issue.number} has no "## done_when" block, so there is nothing a worker could be `
          + `held to. Add machine-checkable rules (run:, changed:, exists:, min-bytes:, measured-before:) to dispatch it.`,
    };
  }

  const factoryStep = extractFactoryStep(issue.body);
  if (factoryStep === null || !(FACTORY_STEPS as readonly string[]).includes(factoryStep)) {
    return {
      dispatchable: false,
      reason:
        `Issue #${issue.number} has no valid "## factory_step:" line. The factory is a pipeline and `
        + `every slice must say which station it moves (operator directive D9). Allowed: `
        + `${FACTORY_STEPS.join(", ")}.`,
    };
  }
  if (factoryStep === "instrument") {
    const unblocks = extractUnblocks(issue.body);
    if (unblocks === null || unblocks === "instrument"
      || !(FACTORY_STEPS as readonly string[]).includes(unblocks)) {
      return {
        dispatchable: false,
        reason:
          `Issue #${issue.number} is "factory_step: instrument" with no valid "unblocks: <step>" line. `
          + `Measuring is not building. Name the non-instrument station this unblocks, or scope the `
          + `slice to that station instead.`,
      };
    }
  }
  if (clothingSliceLacksToolPath(factoryStep, issue.body, issue.title ?? "")) {
    return {
      dispatchable: false,
      reason:
        `Issue #${issue.number} is a clothing slice that names no adopted tool path (makeclothes, `
        + `mhclo, hm08, mpfb). Hand-authored garment geometry is the anti-pattern directive D1 names. `
        + `Cite the tool, or say explicitly why it cannot be used.`,
    };
  }

  // #718: a `run:` rule whose first token is not an allow-listed binary can never pass — the same
  // parser gates dispatch, merge-time verify and the post-merge re-run. #715 shipped
  // `run:tools/.../x.test.ts` (a PATH where a binary belongs), briefFromIssue accepted it because
  // it validated rule SHAPE only, and a 60-turn worker ran against an unsatisfiable first proof.
  //
  // Refusing here changes WHEN a card is refused, never WHETHER, so there is no false-positive
  // cost. It proves syntactic executability only: an allow-listed binary can still be absent from
  // PATH or name a target that does not exist, and those stay runtime failures.
  //
  // The allow-list is NOT restated here. parseRunArgv owns it; two copies would drift.
  for (const rule of rules) {
    if (!rule.startsWith("run:")) continue;
    const parsed = parseRunArgv(rule.slice("run:".length).trim());
    if ("error" in parsed) {
      return {
        dispatchable: false,
        reason:
          `Issue #${issue.number} has a "run:" rule that cannot execute: ${parsed.error} `
          + `Rule: "${rule}". A proof that no implementation could satisfy is worse than no proof, `
          + `because it looks like a contract. Name a command, not a path — e.g. `
          + `"run:pnpm exec vitest run <file>".`,
      };
    }
  }

  const { treeProofs, narrative, unknown } = partitionDoneWhen(rules);
  if (unknown.length > 0) {
    return {
      dispatchable: false,
      reason:
        `Issue #${issue.number} has done_when entries the evaluator cannot run: ${unknown.join(", ")}. `
        + `Prose is not a proof — nothing would evaluate it and the contract would pass vacuously.`,
    };
  }
  if (treeProofs.length === 0) {
    return {
      dispatchable: false,
      reason:
        `Issue #${issue.number} has only narrative rules (${narrative.join(", ")}), which read the `
        + `worker's own handoff JSON — its account of itself. At least one TREE proof is required.`,
    };
  }

  const assetPaths = extractAssetPaths(issue.body);
  return {
    dispatchable: true,
    slice: `issue-${issue.number}`,
    proofs: rules,
    ...(assetPaths.length > 0 ? { assetPaths } : {}),
    prompt: [
      `TARGET REPO: /Volumes/files/src/openclinxr (your own worktree — sole writer).`,
      ``,
      `GitHub issue #${issue.number}: ${issue.title}`,
      ``,
      // The body verbatim: a worker should see the ask, not my summary of it.
      issue.body.trim(),
      ``,
      `VERIFY (stop at first failure): pnpm packages:typecheck:agent && pnpm architecture, then the`,
      `test task for every package you touched: pnpm exec turbo run test --filter <pkg> --force.`,
      ``,
      `DO NOT run repo-wide \`pnpm test\` and treat its reds as yours. Your worktree is a real git`,
      `worktree, so gitignored assets are ABSENT BY DESIGN — apps/ui-xr/public/cagematch (~352 MB)`,
      `and most of .openclinxr/evidence do not exist here and are not copied, on cost. Tests and`,
      `reference checks that read those paths fail for that reason alone, in every worktree, on every`,
      `slice. Five consecutive retros have named this as the single largest waste of worker turns.`,
      `If you see a red you believe is pre-existing environment rather than your change, say so in`,
      `your report with the failing name and move on — do not spend turns provisioning around it.`,
      `The orchestrator re-runs every contract proof against your tree and a full forced test run on`,
      `main after integration, from a complete checkout. That is where repo-wide coverage comes from.`,
      `Then commit in this worktree (no push, never --no-verify).`,
      ``,
      `FORBIDDEN, automatic failure: weakening or deleting an architecture rule; raising a file-size`,
      `ceiling (split the file instead); @ts-ignore or suppressions to force green; flipping a`,
      `promotion gate.`,
      ``,
      `A clean revert with a precise diagnosis is a SUCCESS. Do not force a green.`,
      `End your report with two lines: "CLAIM: <what you demonstrated>" and`,
      `"NOT TESTED: <the residual>".`,
    ].join("\n"),
  };
}
