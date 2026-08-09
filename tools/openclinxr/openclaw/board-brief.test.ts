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

const withProofs = `## factory_step: body_param
Fix the deferred strictness deltas.

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
      number: 1, title: "x", body: "## factory_step: room_generate\n## done_when\n- skeptic:visible\n",
    });
    expect(result.dispatchable).toBe(false);
    expect(result.reason).toMatch(/tree/i);
  });

  it("refuses a done_when rule the evaluator cannot run", () => {
    const result = briefFromIssue({
      number: 1, title: "x", body: "## factory_step: lip_sync\n## done_when\n- prove it works\n",
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

describe("done_when extraction stops at the bullet list", () => {
  // INCIDENT: the first real issue written for this pipeline was REFUSED by it. The done_when block
  // was well-formed; the extractor ran to the next `##` heading and swallowed a trailing prose
  // paragraph that began with bold text, then reported that prose as an unrunnable rule. A parser
  // that rejects correct input teaches people to write for the parser instead of for the reader.
  it("ignores prose that follows the bullets without a new heading", () => {
    const body = [
      "## factory_step: equipment_generate",
      "## done_when",
      "",
      "- run:pnpm architecture",
      "- changed:src/a.ts",
      "",
      "**Notes for whoever takes this.** Do not weaken the test to fit an easier implementation.",
    ].join("\n");
    const result = briefFromIssue({ number: 1, title: "x", body });
    expect(result.dispatchable).toBe(true);
    if (result.dispatchable) expect(result.proofs).toEqual(["run:pnpm architecture", "changed:src/a.ts"]);
  });

  it("still stops at a following heading", () => {
    const body = "## factory_step: motion_retarget\n## done_when\n- run:true\n\n## notes\n- not a proof\n";
    const result = briefFromIssue({ number: 1, title: "x", body });
    expect(result.dispatchable).toBe(true);
    if (result.dispatchable) expect(result.proofs).toEqual(["run:true"]);
  });
});

describe("factory_step gate (D9 dark factory)", () => {
  it("refuses an issue with a done_when block but no factory_step line", () => {
    const result = briefFromIssue({ number: 1, title: "x", body: "## done_when\n- run:true\n" });
    expect(result.dispatchable).toBe(false);
    expect(result.reason).toMatch(/factory_step/i);
  });

  it("refuses a factory_step value that is not a known station", () => {
    const result = briefFromIssue({
      number: 1, title: "x", body: "## factory_step: magic\n## done_when\n- run:true\n",
    });
    expect(result.dispatchable).toBe(false);
    expect(result.reason).toMatch(/factory_step/i);
  });

  it("refuses factory_step: instrument with no unblocks line", () => {
    const result = briefFromIssue({
      number: 1, title: "x", body: "## factory_step: instrument\n## done_when\n- run:true\n",
    });
    expect(result.dispatchable).toBe(false);
    expect(result.reason).toMatch(/unblocks/i);
  });

  it("refuses factory_step: instrument that unblocks instrument", () => {
    const result = briefFromIssue({
      number: 1, title: "x",
      body: "## factory_step: instrument\nunblocks: instrument\n## done_when\n- run:true\n",
    });
    expect(result.dispatchable).toBe(false);
    expect(result.reason).toMatch(/unblocks/i);
  });

  it("dispatches a valid factory_step with tree proofs", () => {
    const result = briefFromIssue({
      number: 1, title: "x", body: "## factory_step: room_generate\n## done_when\n- run:true\n",
    });
    expect(result.dispatchable).toBe(true);
    if (result.dispatchable) expect(result.proofs).toEqual(["run:true"]);
  });

  it("dispatches factory_step: instrument with a valid non-instrument unblocks", () => {
    const result = briefFromIssue({
      number: 1, title: "x",
      body: "## factory_step: instrument\nunblocks: room_generate\n## done_when\n- run:true\n",
    });
    expect(result.dispatchable).toBe(true);
    if (result.dispatchable) expect(result.proofs).toEqual(["run:true"]);
  });
});
