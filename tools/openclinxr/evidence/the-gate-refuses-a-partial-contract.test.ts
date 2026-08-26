import { describe, expect, it } from "vitest";
import { briefFromIssue } from "../openclaw/board-brief.js";

/**
 * OBSERVABLE: a card can declare three `done_when` rules and dispatch with one, silently. The
 * worker is then judged against a contract nobody wrote.
 *
 * MEASURED on HEAD before this fix. `extractDoneWhen` (`board-brief.ts:43-49`) walks lines after
 * the heading and `break`s on the first non-bullet — the comment says "prose or a new heading ends
 * the list". Everything below that point is discarded without a word:
 *
 *   done_when shape              declared   parsed   dispatchable
 *   all bullets                      3        3        true
 *   prose BETWEEN bullets            3        1        true    <- SILENT LOSS
 *   blank lines between              2        2        true
 *   sub-heading between              2        1        true    <- SILENT LOSS
 *
 * This is a worse class than a wrong refusal message. A refusal is loud and costs a cycle; this is
 * quiet and produces a GREEN slice verified against criteria the author did not choose — which is
 * precisely what `PROTO_BOARD_LOOP` means by "a worker judged against criteria nobody chose, which
 * is worse than no contract because it looks like one".
 *
 * NOT CURRENTLY ACTIVE: scanned all 89 open issues at the time of writing — ZERO dispatch on a
 * partial contract today. This is a latent trap, not present harm. It is worth closing because
 * writing a sentence between two bullets is an ordinary thing for an author to do, and nothing
 * anywhere warns them.
 *
 * The fix is to REFUSE, not to silently repair by skipping prose: a card whose rules are separated
 * by commentary may have meant either, and guessing would substitute the parser's judgement for the
 * author's. Loud is correct here.
 *
 * claimScope: whether bullets below an interrupting line are silently dropped or refused.
 * notEvidenceFor: whether any rule is a GOOD rule; the other refusal branches; the first-match
 *   behaviour of a duplicated `## done_when` heading (separate, and recorded on #625's fix).
 */

const body = (dw: string) => `Prose.\n\n## factory_step: room_generate\n## done_when\n\n${dw}\n`;
const brief = (dw: string) => briefFromIssue({ number: 1, title: "t", body: body(dw) }) as any;

const THREE_WITH_PROSE =
  "- run:pnpm exec vitest run a.test.ts\n\nA sentence of explanation.\n\n- run:pnpm exec vitest run b.test.ts\n- changed:tools/x.py";
const TWO_WITH_SUBHEADING =
  "- run:pnpm exec vitest run a.test.ts\n\n### note\n\n- run:pnpm exec vitest run b.test.ts";
const CLEAN_THREE =
  "- run:pnpm exec vitest run a.test.ts\n- run:pnpm exec vitest run b.test.ts\n- changed:tools/x.py";
const CLEAN_WITH_BLANKS =
  "- run:pnpm exec vitest run a.test.ts\n\n- run:pnpm exec vitest run b.test.ts";

describe("the gate refuses a partial contract", () => {
  it("(1) RED: prose between bullets refuses instead of dropping the rules below it", () => {
    const b = brief(THREE_WITH_PROSE);
    expect(b.dispatchable, "dispatching on 1 of 3 declared rules is a contract nobody wrote").toBe(false);
    expect(b.reason).toMatch(/done_when|rule/i);
  });

  it("(2) RED: a sub-heading between bullets refuses too", () => {
    expect(brief(TWO_WITH_SUBHEADING).dispatchable).toBe(false);
  });

  it("(3) the refusal names how many rules would have been lost", () => {
    // A count is what makes this actionable: "2 of 3" tells the author exactly what to look for.
    expect(brief(THREE_WITH_PROSE).reason).toMatch(/2|two/i);
  });

  it("(4) COUNTERWEIGHT: a clean list still dispatches with ALL of its rules", () => {
    const b = brief(CLEAN_THREE);
    expect(b.dispatchable, "refusing more must not refuse valid contracts").toBe(true);
    expect(b.proofs).toHaveLength(3);
  });

  it("(5) COUNTERWEIGHT: blank lines between bullets are NOT an interruption", () => {
    // Markdown authors space bullets routinely. Treating that as a partial contract would refuse
    // most well-written cards, so this pins the distinction the fix must preserve.
    const b = brief(CLEAN_WITH_BLANKS);
    expect(b.dispatchable).toBe(true);
    expect(b.proofs).toHaveLength(2);
  });

  it("(6) VACUITY GUARD: the interrupted bodies really do declare more than one rule", () => {
    const count = (s: string) => s.split("\n").filter((l) => /^\s*[-*]\s+\S/.test(l)).length;
    expect(count(THREE_WITH_PROSE)).toBe(3);
    expect(count(TWO_WITH_SUBHEADING)).toBe(2);
  });
});
