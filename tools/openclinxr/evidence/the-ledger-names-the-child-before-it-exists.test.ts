import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SUBSTRATE — THE ID IS CHOSEN BEFORE THE CHILD, BUT THE LEDGER STILL LEARNS IT AFTERWARDS.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * #439 (`41fa754a`) made `dispatch()` CHOOSE the session UUID up front (`:1202`,
 * `--session-id` at `:619`). Half the wound closed. The other half did not:
 *
 *   `const child = spawn(...)`   dispatch-worker.ts:1280
 *   first `recordSession(...)`   dispatch-worker.ts:1336   <-- AFTER the child
 *
 * So a dispatch that dies before returning still leaves **no ledger entry**, and recovery is still
 * scavenging `~/.grok/sessions/<url-encoded-worktree>/` newest-first and grepping `updates.jsonl`
 * to confirm identity — where a wrong id does not error, it CONFABULATES.
 *
 * **This gap is the orchestrator's fault, not the worker's.** #439's brief said verbatim: *"Do NOT
 * move recordSession before spawn in this slice."* The worker complied exactly. The brief was
 * narrower than the gate that later depended on it.
 *
 * ## WHY IT IS SAFE TO WRITE EARLY
 *
 * `DispatchLedgerEntry` requires only `sessionId`, `model` and `at`. `turns`, `stopReason`,
 * `proofsOk` and `proofs` are OPTIONAL — they are post-exit knowledge. And `recordSession` is an
 * `appendFileSync` to JSONL, so an early line costs nothing structurally.
 *
 * It does create **two lines per dispatch**, and that is the risk this contract guards. SS6b-bis
 * already records a slice logging two sessions where the reported turn count came from the wrong
 * one. A ledger that is ambiguous about which entry is authoritative is worse than a late one.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                   | (1) | (2) | (3) | (4) | result
 *   --------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — first write happens after spawn                  |FAIL | pass| pass| pass| REFUSED
 *   b) move the write early and DROP the post-exit one          | pass|FAIL | pass| pass| REFUSED
 *   c) write both, no way to tell which is authoritative        | pass| pass|FAIL | pass| REFUSED
 *   d) write early but regress --session-id / --prompt-file     | pass| pass| pass|FAIL | REFUSED
 *   e) early entry + post-exit entry, phase-distinguished       | pass| pass| pass| pass| ALL PASS
 *
 * **(b) is the tempting one** — one write, no duplicates, and it silently destroys `turns`,
 * `stopReason` and `proofsOk`, which is the evidence `integrate` and every retro depend on.
 *
 * **(c) is the SS6b-bis trap.** Two lines with the same `sessionId` and no discriminator means a
 * later reader picks one by luck. Clause (3) requires the entries to be distinguishable.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **(1) and (3) are RED** — corrected from probe output.
 * I declared (1) sole; (3) also fails because no discriminator exists yet, so today's single entry
 * cannot be labelled either. That is the third mis-declaration this session — the pattern is that I
 * predict which clauses a MISSING feature trips, when several clauses read the same absent surface.
 * (2) and (4) pass today and are the nets.
 *
 * NOT TESTED: that a killed dispatch is now genuinely recoverable end-to-end. That needs a real
 * kill to demonstrate and is the follow-up. This contract asserts the ledger is written first and
 * remains unambiguous — necessary, not sufficient.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const DISPATCHER = join(REPO_ROOT, "tools/openclinxr/openclaw/dispatch-worker.ts");
const src = (): string => readFileSync(DISPATCHER, "utf8");

/** Source-order check: the first ledger write must precede the spawn that creates the child. */
function orderOf(hay: string, needle: RegExp): number {
  const m = needle.exec(hay);
  return m ? m.index : -1;
}

describe("the ledger names the child before it exists", () => {
  it("(1) RED: the first recordSession call precedes the spawn", () => {
    const s = src();
    const spawnAt = orderOf(s, /const child = spawn\(/);
    const recordAt = orderOf(s, /^\s*recordSession\(/m);
    expect(spawnAt, "spawn site must be findable").toBeGreaterThan(0);
    expect(recordAt, "a recordSession call must be findable").toBeGreaterThan(0);
    expect(
      recordAt,
      `the ledger must hold the id before the child exists — spawn@${spawnAt}, first recordSession@${recordAt}`,
    ).toBeLessThan(spawnAt);
  });

  it("(2) COUNTERWEIGHT: post-exit knowledge is still recorded", () => {
    // Refuses (b). turns/stopReason/proofsOk are what integrate and every retro read; an early-only
    // write silently destroys them.
    const s = src();
    expect(s, "turns must still be captured").toMatch(/turns/);
    expect(s, "proofsOk must still be captured").toMatch(/proofsOk/);
    const writes = (s.match(/recordSession\(/g) ?? []).length;
    expect(writes, "there must still be a post-exit write as well as the early one").toBeGreaterThanOrEqual(2);
  });

  it("(3) COUNTERWEIGHT: two entries for one dispatch are distinguishable", () => {
    // Refuses (c), the SS6b-bis trap: a slice logging two sessions where the reported turn count
    // came from the wrong one. Same sessionId twice with no discriminator is worse than a late write.
    const s = src();
    expect(
      /phase|dispatchPhase|"spawned"|"completed"|preSpawn/.test(s),
      "the early and final entries need a discriminator a reader can rely on",
    ).toBe(true);
  });

  it("(4) NET: #437 and #439 are not regressed", () => {
    const s = src();
    expect(s, "--prompt-file must remain (embedded-flag hang)").toMatch(/"--prompt-file"/);
    expect(s, "--session-id must remain").toMatch(/"--session-id"/);
    expect(s, "resume must still take its id from the child").toMatch(/options\.resume/);
  });
});
