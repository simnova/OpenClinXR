import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { boardCardFromSelection, buildOpenClawRunNextPlan, selectNextSlice } from "./openclaw-slice-runner.js";

/**
 * OBSERVABLE: `pnpm openclaw:run-next` returns a slice id scraped out of English prose, and reports
 * it with a source label that claims it came from an authoritative header.
 *
 * `AGENTS.md:7` is the top of this repo's source-of-truth order and instructs every agent:
 *   "Dequeue from `PROJECT_STATUS.md` **Next dequeue** — not chat. Run `pnpm openclaw:run-next`"
 *
 * MEASURED on the live tree, 2026-08-24T13:41Z. `pnpm openclaw:run-next` returned:
 *     { "selectedSlice": "re-selection", "source": "next-dequeue",
 *       "nextCommand": "pnpm openclaw:team-spawn -- --slice-id re-selection --phase scout" }
 *
 * There is no `**Next dequeue:**` HEADER in PROJECT_STATUS.md. The regex at
 * `openclaw-slice-runner.ts:90` is unanchored, so across a 1,900-line file it matched PROSE inside a
 * dated checkpoint at line 1474 (committed `bca24017a`, 2026-06-07) which is *describing this very
 * bug*:
 *
 *     "...did not advance the canonical header "Next dequeue" or mark the slice closed in Active
 *      Work / Active Work that selectNextSlice parses. This caused re-selection of the just-..."
 *
 * `extractSliceIdFromText` then lifted the token `re-selection` out of the phrase "caused
 * re-selection of the just-[completed slice]" and returned it as the work to do. The dequeue
 * pointer is a false positive on documentation ABOUT the dequeue pointer.
 *
 * ANCHORING ALONE DOES NOT FIX IT — measured, not assumed. With the regex anchored to a line start,
 * tier 1 misses and tier 2's backlog-table regex returns the token `lateral`, scraped from a table
 * cell. Every tier is a prose-scraper; none reads an authoritative queue.
 *
 * WHY THIS IS FAIL-OPEN, which is the part that matters. The chain never returns null while the
 * ledger has any prose in it, so no agent ever learns the queue is empty. It emits a plausible
 * kebab-case id and a dispatch command for it. A worker sent to `--slice-id re-selection` has no
 * brief, no issue, and no done_when — the class this repo calls "green about nothing".
 *
 * WHAT THE QUEUE ACTUALLY IS. `agents/rules/EXEC_REHYDRATE.md:38` (two-plane discipline, 2026-08-04)
 * places the "status roll-up + dequeue queue" on the GitHub project board and says in as many words
 * that it "replaces the `PROJECT_STATUS.md` per-slice churn". `source-of-truth.md:18` separately
 * demotes `AUTONOMOUS_WORK_PLAN.md` — tiers 3 and 4 of this chain — to "historical audit ledgers
 * only ... evidence, not active marching orders". The selector reads two retired planes and not the
 * live one.
 *
 * NOT A THRESHOLD. Nothing here asserts which card is correct to pick. It asserts that a scraped
 * English word is never returned as dispatchable work, and that a supplied board card wins.
 *
 * claimScope: that selectNextSlice refuses a slice id it cannot tie to a real queue, and prefers a
 *   board card when one is supplied.
 * notEvidenceFor: whether the board card chosen is the right priority (that is
 *   `the-queue-refuses-a-truncated-board.test.ts`), the watchdog, epic continuity, lease behaviour,
 *   or anything about how a worker is dispatched once a slice is chosen.
 */

const LIVE_STATUS = readFileSync(new URL("../../../PROJECT_STATUS.md", import.meta.url), "utf8");

describe("the dequeue refuses a slice id scraped from prose", () => {
  it("(1) RED: the live ledger yields no dispatchable slice, and says so", () => {
    const selection = selectNextSlice({ "PROJECT_STATUS.md": LIVE_STATUS });
    expect(
      selection.sliceId,
      "MEASURED: returns 're-selection', lifted from a June checkpoint's sentence about the "
        + "header failing to advance. Anchoring alone yields 'lateral' from a table cell. With no "
        + "real header present the honest answer is null",
    ).toBeNull();
  });

  it("(2) RED: a board card is preferred over anything in the markdown ledgers", () => {
    // EXEC_REHYDRATE.md:38 puts the dequeue queue on the board. When a card is in hand, no amount of
    // prose in a historical file may override it.
    const selection = selectNextSlice(
      { "PROJECT_STATUS.md": LIVE_STATUS },
      { boardCard: { sliceId: "issue-603", priority: "P0" } },
    );
    expect(selection.sliceId).toBe("issue-603");
    expect(selection.source).toBe("board");
  });

  it("(3) COUNTERWEIGHT: a REAL anchored header is still honoured", () => {
    // Refuses the over-correction of ignoring PROJECT_STATUS entirely. The board is the queue, but a
    // human or agent who parks a genuine pointer at a line start must still be obeyed.
    const status = "# S\n\n**Next dequeue:** `peds-parent-nurse-garment-asset` (Q1) — wire it\n";
    const selection = selectNextSlice({ "PROJECT_STATUS.md": status });
    expect(selection.sliceId).toBe("peds-parent-nurse-garment-asset");
    expect(selection.source).toBe("next-dequeue");
  });

  it("(4) COUNTERWEIGHT: prose that merely QUOTES the header syntax is not a pointer", () => {
    // This is the live defect reduced to its smallest reproducing form: the VERBATIM substring
    // from PROJECT_STATUS.md:1474 that the unanchored regex matches. A paraphrase does not
    // reproduce it — the prose uses the exact `**Next dequeue:**` markup mid-sentence, which is why
    // the match fires at all.
    const status =
      "# S\n\n## Checkpoint 2026-06-07\n\n"
      + "...the integrator only appended the per-slice checkpoint body without refreshing the "
      + "top-level **Next dequeue:** / Active Work that selectNextSlice parses. This caused "
      + "re-selection of the just-closed slice on subsequent runs.\n";
    const selection = selectNextSlice({ "PROJECT_STATUS.md": status });
    expect(
      selection.sliceId,
      "the header appears only inside a sentence describing it; nothing is queued",
    ).toBeNull();
  });

  it("(5) COUNTERWEIGHT: an empty tree refuses rather than inventing work", () => {
    expect(selectNextSlice({}).sliceId).toBeNull();
    expect(selectNextSlice({}).source).toBeNull();
  });

  it("(6) the plan builder threads the board card into the dispatch command", () => {
    // The hop between the selector and what an agent actually runs. Without this, the board tier is
    // reachable in a unit test and unreachable in practice — the built-but-unwired class this repo
    // records four times in PROTO_BOARD_LOOP.md.
    //
    // The remaining hop, main() -> boardCardOrNull() -> `gh`, is proven live rather than here; it
    // shells out, and a test that mocks it would prove only the mock.
    const plan = buildOpenClawRunNextPlan({
      stateFiles: { "PROJECT_STATUS.md": LIVE_STATUS },
      gitStatusShort: "## main",
      boardCard: { sliceId: "issue-603", priority: "P0" },
    });
    expect(plan.selectedSlice).toBe("issue-603");
    expect(plan.sliceTeam.teamSpawnCommand).toContain("--slice-id issue-603");
  });

  it("(7) COUNTERWEIGHT: no board card and no anchored header emits no dispatch command", () => {
    // MEASURED live 2026-08-24T13:47Z, before this fix:
    //   { "selectedSlice": "re-selection",
    //     "nextCommand": "pnpm openclaw:team-spawn -- --slice-id re-selection --phase scout" }
    // A dispatch command for a slice with no brief, no issue and no done_when.
    const plan = buildOpenClawRunNextPlan({
      stateFiles: { "PROJECT_STATUS.md": LIVE_STATUS },
      gitStatusShort: "## main",
      boardCard: null,
    });
    expect(plan.selectedSlice).toBeNull();
    expect(plan.nextCommand, "an empty queue must not name work").toBeNull();
    expect(plan.sliceTeam.teamSpawnCommand).toBeNull();
  });

  it("(8) the board hop maps the selector's ACTUAL shape, not the raw board JSON's", () => {
    // MEASURED LIVE, and this is why the clause exists. The first version of this mapping read
    // `picked.item.content.number` — the nested path of the raw `gh project item-list` payload —
    // while `selectNextBoardCard` returns a FLAT object. A successful read therefore yielded null,
    // the board tier never fired, and clauses (2) and (6) stayed green throughout because they
    // inject a BoardCardSelection and never exercise this hop.
    //
    // The literal below is the selector's real return, captured 2026-08-24 from a 620/620 read.
    const real = {
      ok: true, number: 603, priority: "P0",
      title: "FRONTIER AFTER #601: 38 of 42 shipped actors have no numeric phenotype",
      fetched: 620, totalCount: 620,
    };
    expect(boardCardFromSelection(real)).toEqual({ sliceId: "issue-603", priority: "P0" });
  });

  it("(9) COUNTERWEIGHT: a refused or shapeless read maps to null, never to a fabricated slice", () => {
    expect(boardCardFromSelection({ ok: false, number: 603 }), "a refusal is not a card").toBeNull();
    expect(boardCardFromSelection({ ok: true }), "ok with no number is not a card").toBeNull();
    // The nested shape the first version expected. If someone reintroduces that reading, this is
    // what it looks like — and it must not silently become issue-undefined.
    expect(
      boardCardFromSelection({ ok: true, ...{ item: { content: { number: 603 } } } } as never),
      "the raw board JSON shape carries no top-level number and must refuse",
    ).toBeNull();
  });
});
