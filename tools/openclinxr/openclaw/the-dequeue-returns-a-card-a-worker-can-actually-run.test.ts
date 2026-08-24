import { describe, expect, it } from "vitest";
import { selectNextFromBoard } from "./board-next-selector.js";

/**
 * OBSERVABLE: the dequeue returns the highest-priority CARD, not the highest-priority RUNNABLE card.
 *
 * MEASURED 2026-08-24, live. `pnpm openclaw:run-next` returns **#603** — top P0, `Factory: None`.
 * `briefFromIssue` then refuses it: *"has no `## done_when` block, so there is nothing a worker could
 * be held to."* The loop is handed a card it cannot dispatch.
 *
 * Meanwhile the queue measured through `briefFromIssue` over all 69 open issues:
 *
 *     DISPATCHABLE:  11 of 69
 *     refused, no "## done_when":            55
 *     refused, instrument without unblocks:   2
 *     refused, no factory_step:               1
 *
 * NINE of the eleven carry `Factory: Planted` — the loop's own documented selection criterion — and
 * they are real product work (#597 eyebrow poly cost, #588 the seated parent with no chair, #526 the
 * wall AO map). All nine sat unselected behind one unrunnable P0.
 *
 * THIS IS A REGRESSION IN MY OWN WORK. `71156df4` and `1839a185` repointed run-next at the board
 * this morning and I verified the hop end-to-end — but only that it returned *a card*, never that a
 * worker could run it. The selector filters `status === "Todo" && priority` and nothing else.
 *
 * PROTO_BOARD_LOOP.md:198 makes broken land-path integrity a substrate priority override, and a
 * dequeue that feeds the loop refused cards is exactly that class.
 *
 * SCOPE, and it is deliberately narrow. `Factory` IS present in the `gh project item-list --format
 * json` payload — measured, keys are content/factory/id/priority/repository/status/title — so THIS
 * function can filter on it with data it already holds. Dispatchability needs issue BODIES, which the
 * payload does not carry, so that check belongs one layer up at the CLI and is not asserted here.
 *
 * (A peer round claimed Factory was absent from the payload, citing a skill doc. That doc is stale;
 * the live payload was checked before this contract was written.)
 *
 * ## FIXED (dequeue repair) — clauses (1)-(3) flipped `it.fails` -> `it`, 2026-08-24.
 *
 * `selectNextFromBoard` now filters `factory === "Planted"` (board-next-selector.ts:102) using the
 * field already present in the item-list payload, so no extra call. Priority still orders WITHIN the
 * Planted set, and an empty ready set returns `no-candidate` rather than falling back to an
 * unplanted card.
 *
 * claimScope: that the selector picks only `Factory: Planted` cards, and reports Planted-but-absent
 *   rather than falling back to an unplanted one.
 * notEvidenceFor: whether the chosen card's contract is dispatchable (that needs the issue body and
 *   is the CLI's job), the truncated-read refusal (its own contract), or priority ordering itself.
 */

type Item = {
  id?: string; status?: string; priority?: string; factory?: string;
  content?: { number?: number };
};
const page = (items: Item[]) => ({ totalCount: items.length, items });

const P0_UNPLANTED: Item = { id: "i603", status: "Todo", priority: "P0", content: { number: 603 } };
const P1_PLANTED: Item = { id: "i597", status: "Todo", priority: "P1", factory: "Planted", content: { number: 597 } };
const P2_PLANTED: Item = { id: "i600", status: "Todo", priority: "P2", factory: "Planted", content: { number: 600 } };
const P0_LANDED: Item = { id: "i181", status: "Todo", priority: "P0", factory: "Landed", content: { number: 181 } };

describe("the dequeue returns a card a worker can actually run", () => {
  it("(1) an unplanted P0 does not outrank a Planted P1", () => {
    // The live defect, reduced: #603 is P0 with Factory None and no done_when; #597 is P1, Planted,
    // and dispatchable. Today the selector takes #603 and the loop stalls on it.
    const r = selectNextFromBoard(page([P0_UNPLANTED, P1_PLANTED]));
    expect(r.ok).toBe(true);
    expect(r.number, "#603 is not Planted; #597 is, and is runnable").toBe(597);
  });

  it("(2) a Landed card is not re-dequeued as if it were new work", () => {
    // #181 and #622 are both Todo/Landed on the live board — already through the pipeline. Selecting
    // one hands a worker finished work.
    const r = selectNextFromBoard(page([P0_LANDED, P2_PLANTED]));
    expect(r.number, "Landed is not Planted").toBe(600);
  });

  it("(3) no Planted card at all is a distinct, honest outcome", () => {
    // NOT a silent fallback to an unplanted card. An empty ready set is a real state the loop must
    // be able to see — PROTO_BOARD_LOOP's step B (operationalize one item) fires on exactly this.
    const r = selectNextFromBoard(page([P0_UNPLANTED, P0_LANDED]));
    expect(r.ok, "nothing is Planted, so nothing is dequeuable").toBe(false);
    expect(String(r.reason)).toContain("no-candidate");
  });

  it("(4) COUNTERWEIGHT: priority still orders WITHIN the Planted set", () => {
    // Refuses the over-correction of filtering so hard that ordering stops mattering.
    const r = selectNextFromBoard(page([P2_PLANTED, P1_PLANTED]));
    expect(r.number, "P1 outranks P2 among Planted cards").toBe(597);
  });

  it("(5) COUNTERWEIGHT: the truncated-read refusal still fires first", () => {
    // A partial board must never be ranked, Planted filter or not. Guards 71156df4's own contract.
    const r = selectNextFromBoard({ totalCount: 614, items: [P1_PLANTED] });
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toContain("incomplete-read");
  });
});
