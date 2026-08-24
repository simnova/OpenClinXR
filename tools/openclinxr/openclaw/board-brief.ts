import { partitionDoneWhen } from "../../../packages/openclinxr/agent-loop/src/done-when-rules.js";

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
  const m = /^\s*unblocks:\s*([a-z_]+)\s*$/im.exec(body);
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
const FORMATTING = /[`"'*\[\]()]/u;

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

export function briefFromIssue(issue: BoardIssue): BriefResult {
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
  if (rules.length === 0) {
    return {
      dispatchable: false,
      reason:
        `Issue #${issue.number} has no "## done_when" block, so there is nothing a worker could be `
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
