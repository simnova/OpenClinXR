import { describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-relative-parent-imports -- the hook lives outside the package tree by design
import { buildPreflight } from "../../../.claude/hooks/skill-preflight.js";

/**
 * Pins the UserPromptSubmit skill routing in `.claude/hooks/skill-preflight.js`.
 *
 * WHY THIS EXISTS, measured 2026-08-29. The vendored `bothy-board` skill was AVAILABLE and LISTED
 * for a full session while raw curl was hand-rolled against the MCP endpoint. Both efficiency
 * parameters were already documented at `.agents/skills/bothy-board/SKILL.md:39` (cacheToken) and
 * `:69` (mailbox since), and `board-bothy-dequeue.ts` already persists cacheToken with its own test.
 * Three sources carried the knowledge and none fired, because nothing FORCED a read:
 *
 *   sync          310,977 B  ->  248 B  with cacheToken ({unchanged:true})   1254x
 *   mailbox.poll  339,390 B  ->  308 B  with since                           1101x
 *
 * The hook's own header records the same defect for operator-prose (fired 1x) and contract-design
 * (0x) under automatic description-matching. Routing is the mechanism that binds; this test is what
 * stops the routing regressing silently.
 *
 * Negative cases 6-8 are VERBATIM operator prompts from that session. They are the counterweight:
 * without them a regex of `.*` satisfies every positive case and the guard means nothing.
 */
describe("skill preflight routing", () => {
  const names = (prompt: string): string[] =>
    buildPreflight(prompt).systemMessage.replace("Skill preflight: ", "").split(", ");

  it("routes board-shaped turns to the bothy-board skill", () => {
    expect(names("check the board and grab a card")).toContain("bothy-board");
    expect(names("poll the mailbox for tsk_d1bec24e1959e9d8")).toContain("bothy-board");
    expect(names("what does agt_d85152e0024f10cd own")).toContain("bothy-board");
    expect(names("pass the cacheToken on the next sync")).toContain("bothy-board");
  });

  it("COUNTERWEIGHT: does NOT route unrelated turns to bothy-board", () => {
    // A pattern broad enough to match these would pass the clause above while carrying no signal.
    for (const prompt of [
      "fix the failing typecheck in main.ts",
      "ELI20",
      "which peer - is it another codex or openai?",
    ]) {
      expect(names(prompt), `"${prompt}" must not load the board skill`).not.toContain("bothy-board");
    }
  });

  it("keeps contract routing independent of board routing", () => {
    expect(names("plant a RED with a counterweight")).toContain("contract-design");
    expect(names("plant a RED with a counterweight")).not.toContain("bothy-board");
    const both = names("file a card with done_when proofs");
    expect(both).toEqual(expect.arrayContaining(["contract-design", "bothy-board"]));
  });

  it("carries the measured payload numbers, so deleting the evidence fails", () => {
    const context = buildPreflight("check the board").hookSpecificOutput.additionalContext;
    expect(context).toContain("cacheToken");
    expect(context).toContain("since");
    // The numbers are the argument. Prose alone did not bind for a whole session.
    expect(context).toMatch(/310,?977/);
    expect(context).toMatch(/339,?390/);
  });

  it("operator-prose still routes on every turn", () => {
    for (const prompt of ["anything at all", "check the board", "plant a RED"]) {
      expect(names(prompt)[0]).toBe("operator-prose");
    }
  });
});
