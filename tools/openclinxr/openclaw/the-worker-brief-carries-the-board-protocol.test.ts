import { describe, expect, it } from "vitest";
import { boardProtocolSection, briefFromIssue } from "./board-brief.js";

/**
 * A dispatched worker has every BothyBoard tool and has never once called one.
 *
 * MEASURED 2026-09-14 on slice `bothy-tsk_34afd6c6670236b9` (session fb925961), a two-hour
 * nemotron-ultra run:
 *
 *   tools registered in the session   26   (sessions_bind, tasks_get, mailbox_poll, release, …)
 *   board tool CALLS in its transcript 0
 *   run_terminal_command              28
 *   search_replace                    18
 *   write                              4
 *
 * Every `bothy` string in its prompt was the slice id `bothy-tsk_34afd6c6670236b9` and nothing
 * else. Its system prompt mentioned the board zero times. So access was never the gap: the brief
 * never told a worker the board exists.
 *
 * The cost is not theoretical. While that worker ran, the orchestrator posted a mailbox note saying
 * its new test was at the wrong path and it had modified a file outside every write root. The
 * worker could not read it, kept both defects, and earned a full round-trip handback. `mailbox.poll`
 * is the ONLY channel that reaches a live child — `tasks.comment` is an audit log — so a worker that
 * does not poll cannot be steered at all.
 *
 * The counterweight clause is the one that matters. The cheapest way to satisfy an injection test is
 * to emit the block unconditionally, which would tell every GitHub-issue worker to bind to a card
 * that does not exist and to report `status=review` on a board with no row for it.
 */

const CARD_BODY = `## factory_step: instrument
unblocks: staging
Observe whether the settled correction executes.

## done_when
- run:pnpm architecture
`;

const card = (taskId?: string) => ({
  number: 0,
  title: "Observe whether the settled correction executes",
  body: CARD_BODY,
  ...(taskId === undefined ? {} : { taskId }),
});

describe("the worker brief carries the board protocol", () => {
  it("names the card id so the worker can bind to the right row", () => {
    const result = briefFromIssue(card("tsk_4c0f66ebb0453372"));
    expect(result.dispatchable).toBe(true);
    if (!result.dispatchable) return;
    expect(result.prompt).toContain("tsk_4c0f66ebb0453372");
    expect(result.prompt).toContain("bothy-board_sessions_bind");
  });

  it("gives the registered tool names literally, without inventing a cost for guessing them", () => {
    // CORRECTED 2026-09-14, same day. This clause previously asserted that the first worker "spent
    // FOUR of its five calls inventing prefixed variants" and that "those four turns bought
    // nothing", and board-brief.ts shipped that sentence to every dispatched worker. IT WAS FALSE,
    // and it was false because of how I counted rather than what happened.
    //
    // The session log emits SEVERAL events per tool call (tool_call, tool_call_update, ...), each
    // carrying the tool name, so a grep over tool_name double- and triple-counts. Recounting by
    // DISTINCT toolCallId across every worker that touched the board that day:
    //
    //   session    distinctCalls  carriedBothNames  onlyDoubledPrefix  statuses
    //   2c870428        12              12                  0          12 completed
    //   27ec8e94        19              18                  1          17 completed, 1 failed
    //   4f214c20        10              10                  0          10 completed
    //
    // 41 distinct board calls, ONE failure. Every other call carries BOTH the `<server>__`-prefixed
    // name the model emitted and the registered name, because the harness resolves the prefixed
    // form transparently. So guessing a prefix costs nothing, no turns were wasted, and the premise
    // behind the deleted sentence never existed.
    //
    // What survives is the plain instruction: the names below are the registered ones, copy them as
    // written. That is harmless and correct on its own, and needs no invented measurement to justify
    // it. A fabricated number in a prompt every worker reads is worse than no number.
    const result = briefFromIssue(card("tsk_4c0f66ebb0453372"));
    if (!result.dispatchable) throw new Error("expected dispatchable brief");
    expect(result.prompt).toMatch(/LITERAL/u);
    expect(result.prompt).toMatch(/no added prefix/iu);
    // COUNTERWEIGHT, and it still holds for a different reason: the block must not MODEL the
    // doubled shape. Not because it is costly — it is not — but because quoting a malformed
    // example teaches it, and the prompt should carry only names that are correct as written.
    expect(result.prompt).not.toContain("bothy-board__");
    // The deleted claim must not come back: no turn-cost assertion about prefix guessing.
    expect(result.prompt).not.toMatch(/bought nothing/iu);
    expect(result.prompt).not.toMatch(/of its five calls/iu);
  });

  it("instructs the four calls a worker needs to stay steerable and alive", () => {
    const result = briefFromIssue(card("tsk_4c0f66ebb0453372"));
    if (!result.dispatchable) throw new Error("expected dispatchable brief");
    // tasks_get: the live card is the contract; the prompt is a snapshot taken at dispatch.
    expect(result.prompt).toContain("bothy-board_tasks_get");
    // mailbox_poll: the only channel that reaches a running worker.
    expect(result.prompt).toContain("bothy-board_mailbox_poll");
    // `since` is not decoration: without it the response is ~339 KB instead of ~308 bytes.
    expect(result.prompt).toContain("since");
    // heartbeat: a silent worker is reaped at ~10 minutes and its uncommitted tree is discarded.
    expect(result.prompt).toContain("bothy-board_agents_heartbeat");
  });

  it("tells the worker how to fail honestly instead of silently", () => {
    const result = briefFromIssue(card("tsk_4c0f66ebb0453372"));
    if (!result.dispatchable) throw new Error("expected dispatchable brief");
    expect(result.prompt).toContain("bothy-board_tasks_treatments_fail");
    expect(result.prompt).toContain("bothy-board_tasks_release");
  });

  it("states the transitions a worker may not make", () => {
    const result = briefFromIssue(card("tsk_4c0f66ebb0453372"));
    if (!result.dispatchable) throw new Error("expected dispatchable brief");
    expect(result.prompt).toContain("status=review");
    // Workers cannot self-certify. Landing is an orchestrator attestation after re-running proofs.
    expect(result.prompt).toMatch(/Landed/u);
    // doneWhen/writeRoots/depIds are create-only: the contract cannot move to meet the worker.
    expect(result.prompt).toMatch(/create-only/iu);
  });

  it("COUNTERWEIGHT: a GitHub issue with no card id carries no board block at all", () => {
    // Telling a worker to bind to a card that does not exist is worse than saying nothing: it
    // spends turns and invites a fabricated task id.
    const result = briefFromIssue(card(undefined));
    expect(result.dispatchable).toBe(true);
    if (!result.dispatchable) return;
    expect(result.prompt).not.toContain("bothy-board_");
    expect(result.prompt).not.toContain("BothyBoard");
  });

  it("COUNTERWEIGHT: an empty or whitespace card id is treated as absent, not interpolated", () => {
    for (const blank of ["", "   "]) {
      const result = briefFromIssue(card(blank));
      expect(result.dispatchable).toBe(true);
      if (!result.dispatchable) return;
      expect(result.prompt).not.toContain("bothy-board_");
    }
  });

  it("VACUITY GUARD: the section builder really emits content for a card id", () => {
    // If this returned [] the assertions above could only be satisfied by text living elsewhere,
    // and the block would be green about nothing.
    const lines = boardProtocolSection("tsk_ABC");
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.join("\n")).toContain("tsk_ABC");
    expect(boardProtocolSection("")).toEqual([]);
    expect(boardProtocolSection(undefined)).toEqual([]);
  });
});
