import { describe, it, expect } from "vitest";
import { selectNextBothyCard } from "./board-bothy-dequeue.js";
import type { BothyNextSnapshot } from "./board-bothy-dequeue.js";

/**
 * NOTHING RECORDS A NON-EVENT, so an idle fleet cannot afterwards be told from a quiet board.
 *
 * MEASURED 2026-09-13 against `board-bothy-dequeue.ts:160-176`. `selectNextBothyCard` takes
 * `{pat, fetch, env, machineName, store, repoRoot}` and writes nothing anywhere. Its two callers --
 * `openclaw-slice-runner.ts:530` (the lawful dequeue) and `openclaw-sweep.ts:463` (a read-only
 * probe) -- are INDISTINGUISHABLE after the fact, because neither identifies itself and no attempt
 * is recorded at all.
 *
 * What survives a call today: `bothy-next-cache.json`, overwritten per call. That is it. A
 * `{task: null}` leaves no trace, and an orchestrator that never asked leaves no trace either, so
 * "the board was empty" and "nobody asked" are the same silence.
 *
 * WHY THIS IS THE MISSING SIGNAL. `nextClass` (landed at `:64-70`) now says WHICH kind of nothing a
 * call found. It is returned to the caller and then discarded. Without a record of the calls and
 * their classes, the fleet's idle time cannot be decomposed into: orchestrator absent, board
 * genuinely empty, cap jammed by dead claims, stale cache replay, or provisioning failure. Those
 * five have five different remedies and today they are one undifferentiated gap.
 *
 * WHY `caller` IS MANDATORY AND NOT A NICETY. The sweep calls the same function as a probe. If the
 * row does not say who called, a sweep probe forges an orchestrator attempt, and the resulting
 * "the orchestrator asked N times an hour" is fabricated. Clause (2) exists to make that fail.
 *
 * THE JOURNAL IS EVIDENCE, NEVER A GATE. `.openclinxr/` is gitignored (`.gitignore:9`), so a check
 * that inspected the real file would pass vacuously on a clean clone. Every clause below drives an
 * INJECTED sink, in the same way `fetch` and `store` are already injected here. No clause reads or
 * writes the real path.
 *
 * Diagnosis header IMMUTABLE. Flip `it.fails` to `it` and append a `## FIXED` block below; do not
 * rewrite the paths or numbers above.
 *
 * claimScope: whether `selectNextBothyCard` reports each attempt, its class, and its caller to an
 *   injected sink, for controlled fetch/store fixtures.
 * notEvidenceFor: where the journal is stored, its retention, whether anything reads it, what the
 *   fleet's idle time actually decomposes to, or any admission, scaling or wake policy.
 *
 * ## FIXED (#0)
 * Added optional `journal` sink and `caller` identifier to `selectNextBothyCard`
 * (`board-bothy-dequeue.ts:169-178`). The function now calls the sink exactly once per invocation
 * before each return point (8 total), carrying `caller`, `nextClass`, and `result` (the taskId or
 * null). When no sink is injected the function behaves identically (clause 4 stays green).
 * `nextClass` is recorded from the value already computed at each return; `result` is the taskId
 * when one is handed out and null otherwise. The `withJournal` cast helper in the test was the
 * compilation bridge before the options existed and is now a direct pass-through.
 */

type Row = Record<string, unknown>;

function withJournal(
  base: Record<string, unknown>,
  rows: Row[],
): Parameters<typeof selectNextBothyCard>[0] {
  return { ...base, journal: (row: Row) => rows.push(row) };
}

const EMPTY_FETCH = async () => ({ structuredContent: { task: null }, httpStatus: 200 });
const NO_STORE = { read: () => null, write: () => undefined };

const KEPT: BothyNextSnapshot = {
  task: { id: "tsk_keep", title: "kept", body: "## factory_step: staging\n" },
  spawnCommand: "grok -s old -w",
  cacheToken: "bb-r1",
};

describe("the dequeue records every attempt and who made it", () => {
  it("(1) RED: an attempt that finds nothing is still recorded, with its class", async () => {
    const rows: Row[] = [];
    await selectNextBothyCard(
      withJournal({ pat: "bb_pat_test", machineName: "box", store: NO_STORE, fetch: EMPTY_FETCH }, rows),
    );
    expect(rows.length, "a call that returned nothing must leave a trace").toBe(1);
    expect(rows[0]?.nextClass, "the row carries the class the call resolved to").toBe("fresh_null");
  });

  it("(2) RED: the row says WHO called, so a sweep probe cannot forge an orchestrator attempt", async () => {
    const runner: Row[] = [];
    await selectNextBothyCard(
      withJournal(
        { pat: "bb_pat_test", machineName: "box", store: NO_STORE, fetch: EMPTY_FETCH, caller: "run-next" },
        runner,
      ),
    );
    const probe: Row[] = [];
    await selectNextBothyCard(
      withJournal(
        { pat: "bb_pat_test", machineName: "box", store: NO_STORE, fetch: EMPTY_FETCH, caller: "sweep" },
        probe,
      ),
    );
    expect(runner[0]?.caller).toBe("run-next");
    expect(probe[0]?.caller, "a read-only probe must not be counted as a dequeue attempt").toBe("sweep");
  });

  it("(3) RED: a SUCCESSFUL dequeue is recorded too, not only the empties", async () => {
    // Without the successes the denominator is missing: "3 attempts, 3 empty" and "3 attempts, 3
    // dispatched" would both be read as three rows of nothing.
    const rows: Row[] = [];
    const mem: { snap: BothyNextSnapshot | null } = { snap: KEPT };
    const v = await selectNextBothyCard(
      withJournal(
        {
          pat: "bb_pat_test",
          machineName: "box",
          store: { read: () => mem.snap, write: (s: BothyNextSnapshot) => { mem.snap = s; } },
          fetch: async () => ({ structuredContent: { unchanged: true, cacheToken: "bb-r2" }, httpStatus: 200 }),
        },
        rows,
      ),
    );
    expect(v.ok).toBe(true);
    expect(rows.length, "a successful pick is an attempt and belongs in the record").toBe(1);
    expect(rows[0]?.result, "the row names the card that was handed out").toBe("tsk_keep");
  });

  it("(4) KNOWN-GOOD COLUMN: with no sink injected the dequeue behaves exactly as it does today", async () => {
    // GREEN TODAY, AND MUST STAY GREEN. The journal must never become load-bearing: a caller that
    // passes no sink, and a machine with no writable path, must still get the same answer.
    const v = await selectNextBothyCard({
      pat: "bb_pat_test",
      machineName: "box",
      store: NO_STORE,
      fetch: EMPTY_FETCH,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("no-candidate");
    expect(v.nextClass).toBe("fresh_null");
  });

  it("(5) COUNTERWEIGHT: exactly ONE row per call, however many hops it makes internally", async () => {
    // Refuses a writer that logs per retry or per inner `tasks.get` hop. Attempt counts are the
    // whole point of the record; a call that writes twice inflates "how often did we ask" and every
    // rate derived from it. The body-less task path below makes a SECOND fetch internally.
    const rows: Row[] = [];
    let calls = 0;
    await selectNextBothyCard(
      withJournal(
        {
          pat: "bb_pat_test",
          machineName: "box",
          store: NO_STORE,
          fetch: async ({ tool }: { tool: string }) => {
            calls += 1;
            if (tool === "bothy-board.tasks.next") {
              return {
                structuredContent: { task: { id: "tsk_nobody", title: "t", factory: "Planted", status: "ready" } },
                httpStatus: 200,
              };
            }
            return {
              structuredContent: { task: { id: "tsk_nobody", body: "## factory_step: staging\n## done_when\n- exists:x\n" } },
              httpStatus: 200,
            };
          },
        },
        rows,
      ),
    );
    expect(calls, "fixture precondition: this path makes more than one fetch").toBeGreaterThan(1);
    expect(rows.length, "one call is one attempt, however many hops it took").toBe(1);
  });
});
