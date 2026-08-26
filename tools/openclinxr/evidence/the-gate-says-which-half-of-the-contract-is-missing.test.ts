import { describe, expect, it } from "vitest";
import { briefFromIssue } from "../openclaw/board-brief.js";

/**
 * OBSERVABLE: the dispatch gate reports "has no `## done_when` block" for a card whose
 * `## done_when` block is present, and tells the reader to add the thing they already added.
 *
 * MEASURED on the live board. Five cards refuse with `proofs: undefined`; four are genuinely
 * missing the heading, and one is not:
 *
 *   #34, #51, #663, #667   no `## done_when` heading anywhere        message is CORRECT
 *   #625                   `## done_when` at body line 31            message is WRONG
 *
 * #625's block exists and holds prose: "Not operationalized. This needs a disposition decision
 * first (revive vs delete); a `done_when` written before that decision would be inventing proofs
 * for a choice nobody has made." That is exactly the right thing for that card to say, and the
 * gate is right to refuse it - a card with no machine-checkable rules is not dispatchable.
 *
 * `extractDoneWhen` returns [] for both cases (`board-brief.ts:41` no heading, `:47` heading but
 * no bullets), and `briefFromIssue` collapses them at `:190` into one message. The two need
 * different actions: one is "add the block", the other is "the block is there, it needs RULES -
 * or it is deliberately un-operationalized and should be left alone".
 *
 * WHY THIS COSTS MORE THAN A WORD: the remediation named in the message is the one thing that
 * cannot help. Someone acting on it adds a second `## done_when` heading, and `extractDoneWhen`
 * takes the FIRST match, so the new rules below the second heading are never read. A misleading
 * diagnostic in a gate is worse than a vague one, because it is actionable and the action is wrong.
 *
 * claimScope: which refusal message the gate emits for each of the two empty-rules cases.
 * notEvidenceFor: whether either card SHOULD be dispatchable - both are correctly refused; whether
 *   any card's rules are good ones.
 */

const BODY_NO_HEADING = `Some prose about a defect.\n\n## factory_step: instrument\n`;
const BODY_HEADING_NO_RULES = `Some prose.\n\n## done_when\n\nNot operationalized. This needs a disposition decision first.\n`;
// `instrument` would additionally demand an `unblocks:` line, so this control uses a real station:
// the counterweight must prove a VALID contract still dispatches, not trip on a second rule.
const BODY_HEADING_WITH_RULES = `Prose.\n\n## factory_step: room_generate\n## done_when\n\n- run:pnpm exec vitest run tools/openclinxr/evidence/x.test.ts\n`;

const brief = (body: string) => briefFromIssue({ number: 1, title: "t", body }) as any;

describe("the gate says which half of the contract is missing", () => {
  it("(1) RED: a card WITH the block and no rules is not told to add the block", () => {
    const b = brief(BODY_HEADING_NO_RULES);
    expect(b.dispatchable, "still correctly refused - prose is not a contract").toBe(false);
    expect(b.reason, "the block IS there; saying otherwise sends the reader to add a second one")
      .not.toMatch(/has no "## done_when" block/);
  });

  it("(2) RED: and it is told what is actually missing", () => {
    expect(brief(BODY_HEADING_NO_RULES).reason).toMatch(/rule|bullet|machine-checkable/i);
  });

  it("(3) COUNTERWEIGHT: a card genuinely missing the heading still says so", () => {
    const b = brief(BODY_NO_HEADING);
    expect(b.dispatchable).toBe(false);
    expect(b.reason, "the true case must keep its accurate message").toMatch(/has no "## done_when" block/);
  });

  it("(4) COUNTERWEIGHT: a real contract still passes", () => {
    const b = brief(BODY_HEADING_WITH_RULES);
    expect(b.dispatchable, "narrowing a message must not narrow what dispatches").toBe(true);
    expect(b.proofs).toHaveLength(1);
  });

  it("(5) VACUITY GUARD: the two bodies genuinely differ to the extractor", () => {
    // Both refuse today with the SAME message - that identity is the defect, and if these two
    // bodies ever stop differing this contract is testing nothing.
    expect(BODY_NO_HEADING).not.toContain("## done_when");
    expect(BODY_HEADING_NO_RULES).toContain("## done_when");
  });
});
