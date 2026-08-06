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
  | { dispatchable: true; slice: string; proofs: string[]; prompt: string };

/** Pull `done_when` bullets verbatim. Paraphrasing a proof means nobody agreed to it. */
function extractDoneWhen(body: string): string[] {
  const section = /##\s*done_when\s*\n([\s\S]*?)(?:\n##|\s*$)/i.exec(body);
  if (!section?.[1]) return [];
  return section[1]
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function briefFromIssue(issue: BoardIssue): BriefResult {
  const rules = extractDoneWhen(issue.body);
  if (rules.length === 0) {
    return {
      dispatchable: false,
      reason:
        `Issue #${issue.number} has no "## done_when" block, so there is nothing a worker could be `
        + `held to. Add machine-checkable rules (run:, changed:, exists:, min-bytes:) to dispatch it.`,
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

  return {
    dispatchable: true,
    slice: `issue-${issue.number}`,
    proofs: rules,
    prompt: [
      `TARGET REPO: /Volumes/files/src/openclinxr (your own worktree — sole writer).`,
      ``,
      `GitHub issue #${issue.number}: ${issue.title}`,
      ``,
      // The body verbatim: a worker should see the ask, not my summary of it.
      issue.body.trim(),
      ``,
      `VERIFY (stop at first failure): pnpm packages:typecheck:agent && pnpm test && pnpm architecture`,
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
