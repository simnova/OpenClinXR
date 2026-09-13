import { describe, it, expect } from "vitest";
import { selectNextBothyCard } from "./board-bothy-dequeue.js";
import type { BothyNextSnapshot } from "./board-bothy-dequeue.js";

/**
 * A dequeue that returns nothing cannot say WHY it returned nothing, and the difference is the
 * whole decomposition of the fleet's idle time.
 *
 * MEASURED 2026-09-13 against `board-bothy-dequeue.ts:222-248`. Both of these return the SAME
 * `reason: "no-candidate"` with `fetched: 0, totalCount: 0`:
 *
 *   - an `unchanged: true` cache replay whose replayed snapshot holds no task
 *   - a genuinely empty board returning `{task: null}`
 *
 * They differ ONLY in the prose of `detail` -- "ready set unchanged and empty" versus "ready set is
 * empty". `incomplete-read` is worse: a missing PAT (:170), a non-200 (:191), a thrown fetch (:201)
 * and `rate_limited` (:211) all collapse into one `reason`, again separable only by matching prose.
 *
 * WHY PROSE IS NOT A CONTRACT. A caller that greps `detail` is pinned to wording nobody promised to
 * keep. `BothyNextFail` is `{ok, reason, detail, fetched, totalCount}` (:64-70) and carries no
 * machine-readable class, so every consumer either ignores the distinction or invents a regex.
 *
 * WHY IT MATTERS BEYOND TIDINESS. "The orchestrator asked and the board was empty", "the
 * orchestrator asked and got a stale cache replay", and "the board could not be read at all" are
 * three different states of the world with three different remedies, and today they are one value.
 * Nothing records a non-event: `bothy-next-cache.json` is overwritten per call and a `{task:null}`
 * leaves no trace, so absence cannot be told from a quiet board after the fact.
 *
 * THE FIX IS AN ADDITION, NEVER A REPLACEMENT, AND CLAUSES (3) AND (4) ARE WHY.
 * `reason` is load-bearing for existing callers and is pinned by
 * `the-bothy-dequeue-does-not-fall-back-to-github.test.ts`. Add a structured class ALONGSIDE it.
 *
 * Diagnosis header IMMUTABLE. Flip `it.fails` to `it` and append a `## FIXED` block below; do not
 * rewrite the paths or numbers above.
 *
 * claimScope: what `selectNextBothyCard` returns for controlled fetch/store fixtures.
 * notEvidenceFor: whether any journal should be written, where it should live, what the fleet's
 *   idle time actually decomposes to, or any admission/scaling policy.
 */

/** The field does not exist yet, so read it without asserting a type that would not compile. */
function classOf(v: unknown): string | undefined {
  return (v as { nextClass?: string } | null)?.nextClass;
}

const KEPT: BothyNextSnapshot = {
  task: { id: "tsk_keep", title: "kept", body: "## factory_step: staging\n" },
  spawnCommand: "grok -s old -w",
  cacheToken: "bb-r1",
};

describe("the dequeue says which kind of empty it found", () => {
  it.fails("(1) RED: a genuinely empty board is classed fresh_null", async () => {
    const v = await selectNextBothyCard({
      pat: "bb_pat_test",
      machineName: "box",
      store: { read: () => null, write: () => undefined },
      fetch: async () => ({ structuredContent: { task: null }, httpStatus: 200 }),
    });
    expect(v.ok).toBe(false);
    expect(classOf(v), "an empty board must be machine-distinguishable from a cache replay").toBe(
      "fresh_null",
    );
  });

  it.fails("(2) RED: an unchanged replay that holds no task is classed unchanged_replay", async () => {
    // Same reason, same counts, different world. Today only the prose of `detail` separates them.
    const v = await selectNextBothyCard({
      pat: "bb_pat_test",
      machineName: "box",
      store: { read: () => ({ task: null, cacheToken: "bb-empty" }), write: () => undefined },
      fetch: async () => ({ structuredContent: { unchanged: true, cacheToken: "bb-r2" }, httpStatus: 200 }),
    });
    expect(v.ok).toBe(false);
    expect(classOf(v), "a stale cache replay is not evidence the board is empty").toBe(
      "unchanged_replay",
    );
  });

  it.fails("(3) RED: the four incomplete-read causes are four classes", async () => {
    // One `reason` today for four unrelated faults: no credential, a bad status, a thrown call, and
    // a throttle. A caller cannot tell "I am not allowed to read" from "the board is rate limited".
    const noPat = await selectNextBothyCard({ pat: "", env: {} });
    const http = await selectNextBothyCard({
      pat: "bb_pat_test",
      fetch: async () => ({ structuredContent: {}, httpStatus: 503 }),
    });
    const threw = await selectNextBothyCard({
      pat: "bb_pat_test",
      fetch: async () => {
        throw new Error("socket hang up");
      },
    });
    const limited = await selectNextBothyCard({
      pat: "bb_pat_test",
      fetch: async () => ({ structuredContent: { code: "rate_limited", retryAfterSec: 30 }, httpStatus: 200 }),
    });
    expect([classOf(noPat), classOf(http), classOf(threw), classOf(limited)]).toEqual([
      "no_pat",
      "http_error",
      "fetch_threw",
      "rate_limited",
    ]);
  });

  it("(4) KNOWN-GOOD COLUMN: `reason` keeps its existing values", async () => {
    // GREEN TODAY, AND MUST STAY GREEN. The class is an ADDITION. Replacing or renaming `reason`
    // breaks every existing consumer and the clauses of
    // the-bothy-dequeue-does-not-fall-back-to-github.test.ts that pin it.
    const noPat = await selectNextBothyCard({ pat: "", env: {} });
    expect(noPat.ok).toBe(false);
    if (noPat.ok) return;
    expect(noPat.reason).toBe("incomplete-read");

    const empty = await selectNextBothyCard({
      pat: "bb_pat_test",
      store: { read: () => null, write: () => undefined },
      fetch: async () => ({ structuredContent: { task: null }, httpStatus: 200 }),
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.reason).toBe("no-candidate");
  });

  it("(5) COUNTERWEIGHT: an unchanged replay that HOLDS a task is still a success", async () => {
    // GREEN TODAY, AND MUST STAY GREEN. Refuses the cheapest repair of clause (2) -- classing every
    // `unchanged: true` as an empty replay. A replay that carries a task is a dispatchable card and
    // must keep returning ok:true with the replayed identity.
    const mem: { snap: BothyNextSnapshot | null } = { snap: KEPT };
    const v = await selectNextBothyCard({
      pat: "bb_pat_test",
      machineName: "box",
      store: {
        read: () => mem.snap,
        write: (s) => {
          mem.snap = s;
        },
      },
      fetch: async () => ({ structuredContent: { unchanged: true, cacheToken: "bb-r2" }, httpStatus: 200 }),
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.taskId).toBe("tsk_keep");
    expect(v.spawnCommand).toBe("grok -s old -w");
  });
});
