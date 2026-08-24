import { describe, expect, it } from "vitest";
import { selectNextBoardCard, selectNextFromBoard, type BoardItem } from "./board-next-selector.js";

/**
 * **OBSERVABLE: a truncated board read yields NO candidate, not a plausible wrong one.**
 *
 * MEASURED 2026-08-24 against the live 614-item board. An unattended agent read it nine times with
 * `--limit 200`. Its filter and sort were correct; the data never arrived:
 *
 *     P0/P1 Todo on the board .... 17
 *     visible in the first 200 ....  3
 *     invisible ................... 14, INCLUDING BOTH P0s (#603 at 597, #610 at 604)
 *
 * The failure is silent by construction — a ranked list of three looks exactly like a ranked list of
 * seventeen. That is why the guard is an equality against the server's own `totalCount` rather than
 * a larger number.
 */
/**
 * AMENDED 2026-08-24: `factory: "Planted"` added.
 *
 * `selectNextFromBoard` now also filters `factory === "Planted"` (board-next-selector.ts:102),
 * because it was returning cards no worker could run — #603 was selected as top P0 while nine
 * Planted, dispatchable cards sat behind it. These fixtures predate that field and set no factory,
 * so every one of them became invisible to the selector and clauses (1), (5) and (6) went red.
 *
 * This is an ASSUMPTION change, not a weakening: this contract is about truncated reads and priority
 * ordering, and defaulting the fixtures to Planted keeps every one of its assertions exactly as
 * written. Nothing here asserted anything about lifecycle stage, before or after.
 */
const item = (n: number, priority: string | undefined, status = "Todo", factory = "Planted"): BoardItem => ({
  id: `PVTI_${n}`, status, priority, factory, content: { number: n, title: `card ${n}` },
});

/** The real shape: P1s early, both P0s at the tail, exactly as the live board was ordered. */
const REAL_SHAPE: BoardItem[] = [
  ...Array.from({ length: 120 }, (_, k) => item(100 + k, undefined, "Done")),
  item(126, "P1"), item(162, "P1"), item(181, "P1"),
  ...Array.from({ length: 100 }, (_, k) => item(300 + k, undefined, "Done")),
  item(603, "P0"), item(610, "P0"),
];

describe("the queue refuses a truncated board", () => {
  it("(1) picks the tail P0 when the read is COMPLETE", () => {
    const v = selectNextFromBoard({ totalCount: REAL_SHAPE.length, items: REAL_SHAPE });
    expect(v.ok, "a complete read must produce a candidate").toBe(true);
    if (v.ok) {
      // Under the old 200-prefix behaviour this returned #126. Both P0s were unreachable.
      expect(v.number).toBe(603);
      expect(v.priority).toBe("P0");
    }
  });

  it("(2) REFUSES a 200-item prefix of the same board — the measured bug", () => {
    const truncated = REAL_SHAPE.slice(0, 200);
    const v = selectNextFromBoard({ totalCount: REAL_SHAPE.length, items: truncated });
    expect(v.ok, "a prefix must NOT be ranked").toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe("incomplete-read");
      expect(v.fetched).toBe(200);
      expect(v.totalCount).toBe(REAL_SHAPE.length);
      // The refusal must say what to do, or the caller just raises the limit and moves the cliff.
      expect(v.detail).toMatch(/paginate until fetched === totalCount/u);
    }
  });

  it("(3) COUNTERWEIGHT: a complete board with no prioritized Todo is a RESULT, not a failure", () => {
    // Without this, a selector that refuses everything satisfies clause (2) forever.
    const done = [item(1, undefined, "Done"), item(2, "P1", "Done")];
    const v = selectNextFromBoard({ totalCount: 2, items: done });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason, "an empty queue is not an incomplete read").toBe("no-candidate");
  });

  it("(4) a missing totalCount refuses — completeness cannot be assumed", () => {
    const v = selectNextFromBoard({ items: REAL_SHAPE });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("incomplete-read");
  });

  it("(5) P0 outranks P1 and ties break by issue number", () => {
    const items = [item(9, "P1"), item(50, "P0"), item(20, "P0"), item(3, "P2")];
    const v = selectNextFromBoard({ totalCount: 4, items });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.number, "lowest issue number among P0s").toBe(20);
  });

  it("(6) DESTRUCTIVE PROBE: a runner that truncates makes the selector refuse, not guess", () => {
    // Simulates the exact historical failure: gh returns a prefix while reporting the true total.
    const truncatingRunner = () => JSON.stringify({ totalCount: REAL_SHAPE.length, items: REAL_SHAPE.slice(0, 200) });
    const v = selectNextBoardCard(truncatingRunner);
    expect(v.ok, "the old behaviour returned #126 here").toBe(false);
    if (!v.ok) expect(v.reason).toBe("incomplete-read");

    const completeRunner = () => JSON.stringify({ totalCount: REAL_SHAPE.length, items: REAL_SHAPE });
    const good = selectNextBoardCard(completeRunner);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.number).toBe(603);
  });

  it("(7) an unparseable or failing board read refuses rather than returning a stale pick", () => {
    expect(selectNextBoardCard(() => "not json").ok).toBe(false);
    expect(selectNextBoardCard(() => { throw new Error("gh: network down"); }).ok).toBe(false);
  });
});
