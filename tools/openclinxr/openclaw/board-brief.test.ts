import { describe, expect, it } from "vitest";
import { briefFromIssue } from "./board-brief.js";

/**
 * Board → brief. The missing direction: board-cli only ever WROTE to the board (open/status/close),
 * so every brief today was hand-written and the board recorded outcomes after the fact.
 *
 * The load-bearing behaviour is REFUSAL. An issue is prose; a dispatch needs machine-checkable
 * proofs. If this synthesises plausible-looking proofs from a title, the whole contract layer
 * becomes decorative — a worker would be judged against criteria nobody chose. Most of the current
 * board is not dispatchable, and saying so is the correct output.
 */

const withProofs = `Fix the deferred strictness deltas.

## done_when
- run:pnpm packages:typecheck:agent
- changed:packages/openclinxr/domain/tsconfig.json
`;

describe("briefFromIssue", () => {
  it("refuses an issue with no done_when block rather than inventing proofs", () => {
    const result = briefFromIssue({ number: 29, title: "Composition maturity", body: "Two builders, unclear." });
    expect(result.dispatchable).toBe(false);
    expect(result.reason).toMatch(/done_when/i);
  });

  it("refuses an issue whose done_when has only narrative rules", () => {
    // Narrative rules read the worker's own handoff — its account of itself.
    const result = briefFromIssue({
      number: 1, title: "x", body: "## done_when\n- skeptic:visible\n",
    });
    expect(result.dispatchable).toBe(false);
    expect(result.reason).toMatch(/tree/i);
  });

  it("refuses a done_when rule the evaluator cannot run", () => {
    const result = briefFromIssue({
      number: 1, title: "x", body: "## done_when\n- prove it works\n",
    });
    expect(result.dispatchable).toBe(false);
  });

  it("produces a brief with proofs taken VERBATIM from the issue", () => {
    const result = briefFromIssue({ number: 28, title: "Strictness deltas", body: withProofs });
    expect(result.dispatchable).toBe(true);
    // Verbatim matters: a proof the orchestrator paraphrased is a proof nobody agreed to.
    expect(result.proofs).toEqual([
      "run:pnpm packages:typecheck:agent",
      "changed:packages/openclinxr/domain/tsconfig.json",
    ]);
    expect(result.slice).toBe("issue-28");
  });

  it("carries the issue body into the brief so the worker sees the ask, not a summary", () => {
    const result = briefFromIssue({ number: 28, title: "Strictness deltas", body: withProofs });
    expect(result.prompt).toContain("Strictness deltas");
    expect(result.prompt).toContain("Fix the deferred strictness deltas.");
  });
});
