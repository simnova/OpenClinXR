import type { GhCommandRunner } from "./board-cli.js";

/**
 * **Select the next board card by priority — or fail closed. Never rank a truncated prefix.**
 *
 * ## THE MEASURED DEFECT, 2026-08-24
 *
 * An unattended agent dequeued the board nine times with `--limit 200` against a **614-item** board.
 * Its filtering and ranking were CORRECT: `status == "Todo"`, a required `priority`, sorted by tier.
 * The data never arrived.
 *
 *     P0/P1 Todo items on the board .... 17
 *     visible in the first 200 ..........  3
 *     invisible ......................... 14, INCLUDING BOTH P0s
 *
 * `#603` sat at position 597 and `#610` at 604. The agent spent six hours choosing the best work it
 * could see, from a window that excluded almost everything prioritized — and it codified that query
 * into a skill (`31cdc782`), so the defect propagated to every future reader.
 *
 * ## WHY A BIGGER LIMIT IS NOT THE FIX
 *
 * `gh project item-list` returns items in project position order, which here matches insertion. So
 * the newest and most recently prioritized cards are always LAST. Any fixed cap below the board's
 * eventual size fails the same way, silently, and moves the cliff rather than removing it.
 *
 * The invariant is not "fetch more". It is: **never select from an incomplete candidate set.** A
 * truncated read must produce NO candidate and a non-zero exit, because a plausible wrong answer is
 * worse than a refusal — the agent had no way to tell it was reading a third of the queue.
 *
 * claimScope: candidate completeness and priority ordering.
 * notEvidenceFor: whether the selected card is the right work, or whether its contract is sound.
 */

export type BoardItem = {
  /** Lifecycle stage from the board's Factory field: Idle|Planted|Dispatched|Landed|Graded. */
  factory?: string;
  id?: string;
  status?: string;
  priority?: string;
  content?: { number?: number; title?: string };
};

export type BoardPage = { totalCount?: number; items?: BoardItem[] };

export type NextSelection =
  | { ok: true; number: number; priority: string; title: string; fetched: number; totalCount: number }
  | { ok: false; reason: "incomplete-read" | "no-candidate"; detail: string; fetched: number; totalCount: number };

/** P0 before P1 before P2; anything else sorts last but is never silently dropped. */
const TIER = (p: string | undefined): number => {
  const m = /^P(\d)$/u.exec(p ?? "");
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};

/**
 * Choose the next card from a board page.
 *
 * `page.totalCount` is the server's own count of the board. If the fetched item count does not equal
 * it, this refuses — that equality is the whole guard, and it is why the caller must not discard
 * `totalCount` the way the shell one-liner did.
 */
export function selectNextFromBoard(page: BoardPage): NextSelection {
  const items = page.items ?? [];
  const totalCount = page.totalCount ?? -1;
  const fetched = items.length;

  if (totalCount < 0) {
    return {
      ok: false, reason: "incomplete-read", fetched, totalCount,
      detail: "the board response carried no totalCount, so completeness cannot be established — refusing rather than ranking a possible prefix",
    };
  }
  if (fetched !== totalCount) {
    return {
      ok: false, reason: "incomplete-read", fetched, totalCount,
      detail:
        `read ${fetched} of ${totalCount} board items — a truncated read cannot be ranked. `
        + `Measured 2026-08-24: a --limit 200 read of a 614-item board hid 14 of 17 prioritized items including BOTH P0s. `
        + `Raise the page size or paginate until fetched === totalCount; do NOT select from this.`,
    };
  }

  const candidates = items
    .filter((i) => i.status === "Todo" && typeof i.priority === "string" && i.priority.length > 0)
    /**
     * PLANTED ONLY. Added 2026-08-24 after this selector returned a card no worker could run.
     *
     * MEASURED: `pnpm openclaw:run-next` returned #603 — top P0, `Factory: None` — and
     * `briefFromIssue` refused it for having no `## done_when`. Nine cards carrying
     * `Factory: Planted` sat unselected behind it, all of them real product work (#597, #588, #526).
     * Priority alone ranks CARDS; the loop needs the highest-priority RUNNABLE card, and Planted is
     * the lifecycle flag that says a contract has been written.
     *
     * `Landed` and `Graded` are excluded by the same test — #181 and #622 are Todo/Landed on the live
     * board, and selecting one hands a worker finished work.
     *
     * This is a regression in 71156df4/1839a185, both mine: I proved the board hop returned A CARD
     * and never that the card was runnable.
     *
     * Dispatchability itself is NOT checked here. It needs the issue BODY, which this payload does
     * not carry — that check belongs to the caller. `factory` IS in the payload (measured keys:
     * content, factory, id, priority, repository, status, title), so this filter costs no extra call.
     */
    .filter((i) => i.factory === "Planted")
    .filter((i) => typeof i.content?.number === "number")
    .sort((a, b) => TIER(a.priority) - TIER(b.priority) || (a.content!.number! - b.content!.number!));

  const top = candidates[0];
  if (!top) {
    return {
      ok: false, reason: "no-candidate", fetched, totalCount,
      detail: "the board is complete and carries no Todo item that is both prioritized and Factory: Planted — an empty ready set is a result, not a failure",
    };
  }
  return {
    ok: true, number: top.content!.number!, priority: top.priority!,
    title: top.content?.title ?? "", fetched, totalCount,
  };
}

/**
 * Fetch the whole board, then select.
 *
 * The limit is deliberately far above the current board size AND the equality check still runs, so
 * growing past it fails closed instead of silently truncating again.
 */
export function selectNextBoardCard(
  runner: GhCommandRunner,
  opts: { owner?: string; projectNumber?: number; limit?: number } = {},
): NextSelection {
  const owner = opts.owner ?? "simnova";
  const projectNumber = opts.projectNumber ?? 7;
  const limit = opts.limit ?? 5000;
  let page: BoardPage;
  try {
    page = JSON.parse(runner([
      "gh", "project", "item-list", String(projectNumber), "--owner", owner,
      "--limit", String(limit), "--format", "json",
    ])) as BoardPage;
  } catch (cause) {
    return {
      ok: false, reason: "incomplete-read", fetched: 0, totalCount: -1,
      detail: `board read failed or returned unparseable JSON: ${String(cause).slice(0, 160)}`,
    };
  }
  return selectNextFromBoard(page);
}
