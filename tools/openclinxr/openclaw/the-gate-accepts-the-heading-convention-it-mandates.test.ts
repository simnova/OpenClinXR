import { describe, expect, it } from "vitest";
import { extractFactoryStep, extractUnblocks } from "./board-brief.js";

/**
 * OBSERVABLE: two sibling directives on the same card demand INCOMPATIBLE syntax, so a card written
 * to the repo's own convention is silently undispatchable.
 *
 *   board-brief.ts:109   /^##\\s*factory_step:\\s*([a-z_]+)\\s*$/im    <- REQUIRES "## "
 *   board-brief.ts:115   /^\\s*unblocks:\\s*([a-z_]+)\\s*$/im          <- FORBIDS it ("^\\s*" cannot match "#")
 *
 * MEASURED across the live board 2026-08-24, three of four cards carrying an `unblocks` line use the
 * `##` form — #614, #613, #612 all write `## unblocks: <step>` — and every one of them is refused
 * with *"is factory_step: instrument with no valid unblocks: <step> line"*. Only #635 uses the bare
 * form that actually parses.
 *
 * I HIT THIS MYSELF while operationalizing #610. Reverting its `factory_step` to
 * `instrument` + `## unblocks: staging` — the documented convention, copied from its own original
 * body — made a previously-dispatchable card refuse.
 *
 * WHY IT IS LATENT AND STILL WORTH FIXING. #612/#613/#614 currently fail EARLIER, on the missing
 * `## done_when`, so nobody has seen this. It fires the moment someone does the right thing and
 * operationalizes an instrument card — the trap is sprung by correct behaviour, which is the worst
 * kind.
 *
 * THE FIX IS THE PERMISSIVE DIRECTION, deliberately. `factory_step` requires `##`, the cards use
 * `##`, and #635 proves the bare form is also in use. Accepting BOTH breaks nothing and matches what
 * is written; tightening `unblocks` to demand `##` would instead refuse #635.
 *
 * claimScope: that `unblocks` parses the same heading forms `factory_step` does.
 * notEvidenceFor: whether any card's `unblocks` VALUE is correct, the instrument/station rule
 *   itself, or anything about done_when.
 */

describe("the gate accepts the heading convention it mandates", () => {
  it("(1) `## unblocks: staging` — the form three live cards use — parses", () => {
    expect(
      extractUnblocks("## factory_step: instrument\n\n## unblocks: staging\n"),
      "#612, #613 and #614 all write it this way and are all refused",
    ).toBe("staging");
  });

  it("(2) COUNTERWEIGHT: the bare form keeps working", () => {
    // #635 writes `unblocks: room_generate` with no hashes. The fix must not refuse it — that would
    // trade one silently-broken convention for another.
    expect(extractUnblocks("unblocks: room_generate\n")).toBe("room_generate");
  });

  it("(3) COUNTERWEIGHT: factory_step is unchanged and still needs its heading", () => {
    // Guards against 'fixing' this by loosening both until neither means anything.
    expect(extractFactoryStep("## factory_step: staging\n")).toBe("staging");
    expect(extractFactoryStep("some prose mentioning factory_step: staging inline\n")).toBeNull();
  });

  it("(4) COUNTERWEIGHT: prose mentioning the word does not become a directive", () => {
    // The same class as the dequeue reading `**Next dequeue:**` out of a checkpoint's prose.
    expect(
      extractUnblocks("The card explains what it unblocks: staging comes later.\n"),
      "a sentence is not a directive",
    ).toBeNull();
  });
});
