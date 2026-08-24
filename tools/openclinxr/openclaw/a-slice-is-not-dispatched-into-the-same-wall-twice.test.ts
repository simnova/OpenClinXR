import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mergeSessions, shouldRefuseDispatch, type BreakerRow } from "./retry-circuit-breaker.js";

/**
 * **OBSERVABLE: the breaker fires on the two measured storms and on nothing else.**
 *
 * The fixture is REAL ledger rows, not a synthetic stand-in — `issue-341` and `issue-436` are the
 * actual storms, and the six control slices are ordinary multi-session slices from the same ledger
 * that must stay dispatchable. A fixture that does not exhibit the failure class proves nothing.
 *
 * MEASURED: 33 of 584 dispatch sessions went to those two slices; they hold 16 of 62 proof failures.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "fixtures/retry-storm-ledger.json");
const fx = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  stormSlices: string[]; controlSlices: string[]; rows: BreakerRow[];
};
/** Evaluate as of just after the newest row, so the windows are live. */
const NOW = Math.max(...fx.rows.map((r) => (r.at ? Date.parse(r.at) : 0))) + 1000;

describe("a slice is not dispatched into the same wall twice", () => {
  // MEASURED trigger instants — the moment a LIVE breaker would have seen the second event.
  // issue-436: one-turn cancellations at 03:57:06.139Z and 03:57:21.389Z, FIFTEEN SECONDS apart.
  // issue-341: 150-turn cancellations at 08:58:41.705Z and 10:11:02.825Z, 1.2 h apart.
  // Evaluating at the END of a storm instead measures nothing: issue-341's last ceiling sits 45.1 h
  // after its sixth, so a 24 h window at that point legitimately holds one event. The breaker is a
  // live gate, and testing it at a dead time was my error, not the module's.
  const T436 = Date.parse("2026-08-19T03:57:21.389Z") + 1000;
  const T341 = Date.parse("2026-08-12T10:11:02.825Z") + 1000;

  it("(1) refuses issue-436 at its second one-turn cancellation — the environment is the wall", () => {
    const v = shouldRefuseDispatch(fx.rows, "issue-436", T436);
    expect(v.refuse, "issue-436 is a measured startup storm").toBe(true);
    if (v.refuse) expect(v.clause).toBe("startup-storm");
  });

  it("(2) refuses issue-341 at its second 150-turn ceiling — scope exceeds the budget", () => {
    const v = shouldRefuseDispatch(fx.rows, "issue-341", T341);
    expect(v.refuse, "issue-341 repeatedly cancelled at one ceiling").toBe(true);
    if (v.refuse) expect(v.clause).toBe("repeated-ceiling");
  });

  it("(3) counts only sessions that FAILED or had no verdict as saved — never passes", () => {
    // CORRECTED. The first version counted every later session as "saved". On issue-341 four of
    // them had proofsOk:true, including 12:52 which was CANCELLED at 150 turns and still passed
    // its contract. Counting a pass as waste is a wrong-direction assertion.
    const wasted = (slice: string, t: number) =>
      mergeSessions(fx.rows).filter(
        (r) => r.slice === slice && r.at && Date.parse(r.at) > t && r.proofsOk !== true,
      ).length;
    expect(wasted("issue-436", T436), "issue-436 non-passing sessions after its trigger")
      .toBeGreaterThanOrEqual(9);
    expect(wasted("issue-341", T341), "issue-341 non-passing sessions after its trigger")
      .toBeGreaterThanOrEqual(2);
  });

  it("(4) FALSE-REFUSAL COUNTERWEIGHT: a slice that PASSES again is not refused", () => {
    // The defect a peer found in the first version: after issue-341's second ceiling, four sessions
    // inside the 24 h window passed their proofs — 12:52 (cancelled at 150 AND passing), 16:41,
    // 18:16, 22:10. The original breaker refused all four. Success must reset the gate, or the
    // breaker blocks the recovery it exists to allow.
    // CORRECTED AGAIN. This clause used to evaluate ONE SECOND AFTER the 12:52 PASS row, which let
    // that row reset its own gate — vacuous. A breaker runs BEFORE a dispatch, when the pass it
    // would produce does not exist yet. Measured at the honest instant:
    //
    //     1 ms BEFORE the recovery dispatch  -> REFUSE (repeated-ceiling)
    //     1 s  AFTER it recorded its PASS    -> ALLOW
    //
    // So success-reset alone is CIRCULAR: the breaker refuses the recovery, so the pass that would
    // reset it can never be recorded. Only an explicit reasoned override breaks that loop.
    const justBeforeTheRecovery = Date.parse("2026-08-12T12:52:15.920Z") - 1;
    const v = shouldRefuseDispatch(fx.rows, "issue-341", justBeforeTheRecovery);
    // The PURE breaker is RIGHT to refuse here — it cannot see a pass that has not happened. The
    // circularity is a SYSTEM property, and the escape is the reasoned override at the dispatch
    // layer, pinned by the override clauses below. Asserting `false` here would demand clairvoyance.
    expect(v.refuse, "the pure gate cannot see the future and correctly refuses").toBe(true);
    if (v.refuse) {
      expect(v.lastPassAt, "no pass had happened yet — lastPassAt cannot discriminate here").toBeNull();
    }
  });

  it("(5) a ceiling hit that PASSED its proofs never counts toward the ceiling clause", () => {
    // issue-341 12:52 was cancelled at exactly 150 turns and returned proofsOk:true. Cancellation
    // is a budget outcome, not a verdict on the work.
    const passingCeiling = mergeSessions(fx.rows).find(
      (r) => r.slice === "issue-341" && r.turns === 150 && r.stopReason === "cancelled" && r.proofsOk === true,
    );
    expect(passingCeiling, "the fixture must contain a passing ceiling hit or this proves nothing")
      .toBeDefined();
  });

  it("(6) COUNTERWEIGHT: ordinary multi-session slices stay dispatchable", () => {
    // Without this, a breaker that refuses everything passes clauses (1) and (2).
    const refused = fx.controlSlices.filter((s) => shouldRefuseDispatch(fx.rows, s, NOW).refuse);
    expect(refused, `these are normal slices and must not trip: ${refused.join(", ")}`).toEqual([]);
    expect(fx.controlSlices.length, "the control set must be non-trivial").toBeGreaterThanOrEqual(4);
  });

  it("(7) counts by sessionId, not by row — the ledger writes up to 3 rows per session", () => {
    const rows436 = fx.rows.filter((r) => r.slice === "issue-436");
    const sessions436 = mergeSessions(rows436);
    expect(rows436.length, "rows outnumber sessions — this is why row counting trips early")
      .toBeGreaterThan(sessions436.length);
    // A single session, duplicated into many rows, must NOT look like a storm.
    const one = rows436.find((r) => r.stopReason === "cancelled" && (r.turns ?? 0) <= 1)!;
    const cloned = Array.from({ length: 6 }, () => ({ ...one }));
    expect(
      shouldRefuseDispatch(cloned, one.slice!, Date.parse(one.at!) + 1000).refuse,
      "six rows of ONE session is one attempt, not six",
    ).toBe(false);
  });

  it("(8) an empty or unrelated history never refuses", () => {
    expect(shouldRefuseDispatch([], "issue-999", NOW).refuse).toBe(false);
    expect(shouldRefuseDispatch(fx.rows, "issue-999", NOW).refuse).toBe(false);
  });
});

/**
 * A SILENT GATE CANNOT BE AUDITED. The breaker runs before the board update and before any session
 * ledger row, so without a durable record nothing explains why a slice stopped dispatching.
 *
 * `lastPassAt` beside `triggeredBy` is what lets a later reader spot a FALSE refusal without
 * re-running the breaker: a refusal whose last pass is recent relative to its triggering sessions is
 * the shape measured on issue-341 and fixed in 3baa71af.
 */
describe("a breaker refusal leaves a durable record", () => {
  it("writes clause, triggering sessions and lastPassAt to breaker-events.jsonl", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join: j } = await import("node:path");
    const { assertNotRepeatingIntoTheSameWall } = await import("./dispatch-worker.js");

    const root = mkdtempSync(j(tmpdir(), "breaker-"));
    mkdirSync(j(root, ".openclinxr/openclaw"), { recursive: true });
    const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
    writeFileSync(
      j(root, ".openclinxr/openclaw/worker-sessions.jsonl"),
      [
        { sessionId: "s1", slice: "probe-slice", at: iso(10), turns: 1, stopReason: "cancelled" },
        { sessionId: "s2", slice: "probe-slice", at: iso(5), turns: 1, stopReason: "cancelled" },
      ].map((r) => JSON.stringify(r)).join("\n") + "\n",
    );

    expect(() => assertNotRepeatingIntoTheSameWall(root, "probe-slice")).toThrow(/REFUSED/u);

    const ev = j(root, ".openclinxr/openclaw/breaker-events.jsonl");
    expect(existsSync(ev), "the refusal must be durable, not only thrown").toBe(true);
    const rec = JSON.parse(readFileSync(ev, "utf8").trim()) as {
      clause: string; lastPassAt: string | null; triggeredBy: { sessionId?: string }[];
    };
    expect(rec.clause).toBe("startup-storm");
    expect(rec.triggeredBy.map((t) => t.sessionId), "name the sessions, do not make the reader re-derive them")
      .toEqual(["s1", "s2"]);
    expect(rec.lastPassAt, "null here means no pass was ignored — the refusal is sound").toBeNull();
  });

  it("a failed append never blocks the refusal — the record is evidence, not a gate", async () => {
    const { assertNotRepeatingIntoTheSameWall } = await import("./dispatch-worker.js");
    // A nonexistent repo root makes both the ledger read and the event append fail.
    expect(() => assertNotRepeatingIntoTheSameWall("/nonexistent-root-xyz", "probe-slice")).not.toThrow();
  });
});


/**
 * THE CIRCULARITY, AND ITS ONLY ESCAPE.
 *
 * MEASURED on issue-341: the breaker refuses the 12:52 dispatch one millisecond before it runs, and
 * that dispatch went on to PASS its proofs. Success-reset cannot fix this by itself —
 *
 *     breaker must permit recovery -> recovery PASS resets breaker
 *     breaker refuses recovery     -> PASS can never be recorded
 *
 * — so a reasoned override is the only way out, and it is RECORDED rather than silent.
 */
describe("a reasoned override is the only escape from the breaker", () => {
  const stormRoot = async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join: j } = await import("node:path");
    const root = mkdtempSync(j(tmpdir(), "breaker-ovr-"));
    mkdirSync(j(root, ".openclinxr/openclaw"), { recursive: true });
    const iso = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    writeFileSync(j(root, ".openclinxr/openclaw/worker-sessions.jsonl"),
      [{ sessionId: "s1", slice: "recovery-slice", at: iso(10), turns: 1, stopReason: "cancelled" },
       { sessionId: "s2", slice: "recovery-slice", at: iso(5), turns: 1, stopReason: "cancelled" }]
        .map((r) => JSON.stringify(r)).join("\n") + "\n");
    return root;
  };

  it("(1) refuses without a reason", async () => {
    const { assertNotRepeatingIntoTheSameWall } = await import("./dispatch-worker.js");
    const root = await stormRoot();
    expect(() => assertNotRepeatingIntoTheSameWall(root, "recovery-slice")).toThrow(/REFUSED/u);
  });

  it("(2) an EMPTY reason is not a reason", async () => {
    const { assertNotRepeatingIntoTheSameWall } = await import("./dispatch-worker.js");
    const root = await stormRoot();
    expect(() => assertNotRepeatingIntoTheSameWall(root, "recovery-slice", "   ")).toThrow(/REFUSED/u);
  });

  it("(3) a reasoned override dispatches AND is recorded, not silenced", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join: j } = await import("node:path");
    const { assertNotRepeatingIntoTheSameWall } = await import("./dispatch-worker.js");
    const root = await stormRoot();
    const reason = "worktree reprovisioned; the startup death was a missing node_modules";
    expect(() => assertNotRepeatingIntoTheSameWall(root, "recovery-slice", reason)).not.toThrow();

    const ev = j(root, ".openclinxr/openclaw/breaker-events.jsonl");
    expect(existsSync(ev), "an override must still leave a record").toBe(true);
    const rec = JSON.parse(readFileSync(ev, "utf8").trim()) as Record<string, unknown>;
    expect(rec["kind"]).toBe("dispatch-breaker-overridden");
    expect(rec["overrideReason"]).toBe(reason);
    expect((rec["triggeredBy"] as unknown[]).length, "the record still names what fired").toBe(2);
  });
});

/**
 * CLAUSE D — sessions that never reach a verdict are invisible to A-C.
 *
 * MEASURED: 11 terminal `died` across 7 slices, 13 terminal `spawned` across 10. The threshold is 3
 * rather than 2 because OUTCOME separates them, not because 3 looked right: issue-594 and issue-569
 * had three events each and NEVER recovered; issue-585 and issue-591 had two each and both went on
 * to pass. At a threshold of 2 this clause interrupts two genuine recoveries.
 */
/**
 * CLAUSE D WAS BUILT AND WITHDRAWN THE SAME HOUR. The tests go with it. Kept as a record so the gap
 * is not rediscovered as if it were new: sessions that never reach a verdict ARE invisible to A-C
 * (11 died across 7 slices, 13 spawned across 10), but a historical replay of a died-only clause at
 * threshold 3 fires ZERO times, and at threshold 2 it refuses two dispatches that went on to PASS.
 * See the withdrawal note in retry-circuit-breaker.ts for what evidence would make it buildable.
 */

/**
 * THE GATE WAS INERT IN A WORKTREE, which is where dispatches actually run.
 *
 * PROVEN 2026-08-24 for root `/Users/patrick/.grok/worktrees/src-openclinxr/issue-576`:
 *
 *     resolveSharedCoordinationPath -> /Volumes/files/src/openclinxr/.openclinxr/.../worker-sessions.jsonl
 *     join(repoRoot, LEDGER)        -> <worktree>/.openclinxr/.../worker-sessions.jsonl
 *
 * The ledger WRITERS use the resolver. My breaker read used a raw join, so a worktree-bound dispatch
 * read a file that does not exist, saw no history, and failed open. A guard that is silent exactly
 * where it is needed is not a guard.
 */
describe("the breaker reads the same ledger the dispatcher writes", () => {
  it("resolves the ledger and the event log through the shared coordination root", async () => {
    const { readFileSync } = await import("node:fs");
    const { join: j } = await import("node:path");
    const src = readFileSync(j(import.meta.dirname, "dispatch-worker.ts"), "utf8");
    // The breaker's own reads/writes must not use a bare repoRoot join for these two files.
    expect(src, "ledger read must go through the shared resolver")
      .not.toMatch(/readFileSync\(join\(repoRoot, LEDGER\)/u);
    expect(src, "breaker events must go through the shared resolver")
      .not.toMatch(/join\(repoRoot, BREAKER_EVENTS\)/u);
    expect(src).toMatch(/resolveSharedCoordinationPath\(LEDGER, repoRoot\)/u);
    expect(src).toMatch(/resolveSharedCoordinationPath\(BREAKER_EVENTS, repoRoot\)/u);
  });

  it("a worktree root and the main root resolve to the SAME shared file", async () => {
    const { resolveSharedCoordinationPath } = await import("./coordination-root.js");
    const main = resolveSharedCoordinationPath(".openclinxr/openclaw/worker-sessions.jsonl", "/Volumes/files/src/openclinxr");
    const wt = resolveSharedCoordinationPath(".openclinxr/openclaw/worker-sessions.jsonl", "/Users/patrick/.grok/worktrees/src-openclinxr/issue-576");
    expect(wt, "if these ever diverge the breaker goes blind in worktrees again").toBe(main);
  });
});

/**
 * END-TO-END: the reader and the writer compose through the SHARED root at runtime.
 *
 * The clauses above assert source shape and resolver equivalence. Neither invokes the breaker with a
 * ledger that exists ONLY in the shared root — which is exactly the production arrangement and
 * exactly the case that was broken. Before 9efe964a a worktree-bound dispatch read
 * `<worktree>/.openclinxr/...`, found nothing, and failed open, so the gate had no real enforcement
 * in the only context dispatches run in.
 */
describe("the breaker enforces from a worktree against the shared ledger", () => {
  it("refuses using history it can only see through the coordination root, and records there", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join: j } = await import("node:path");
    const { resetCoordinationRootCache } = await import("./coordination-root.js");
    const { assertNotRepeatingIntoTheSameWall } = await import("./dispatch-worker.js");

    const sharedRoot = mkdtempSync(j(tmpdir(), "shared-"));
    const worktreeRoot = mkdtempSync(j(tmpdir(), "worktree-"));
    const prev = process.env["OPENCLINXR_COORDINATION_ROOT"];
    process.env["OPENCLINXR_COORDINATION_ROOT"] = sharedRoot;
    resetCoordinationRootCache();
    try {
      // History exists ONLY in the shared root. The worktree has nothing.
      mkdirSync(j(sharedRoot, ".openclinxr/openclaw"), { recursive: true });
      const iso = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
      writeFileSync(
        j(sharedRoot, ".openclinxr/openclaw/worker-sessions.jsonl"),
        [
          { sessionId: "w1", slice: "wt-slice", at: iso(9), turns: 1, stopReason: "cancelled" },
          { sessionId: "w2", slice: "wt-slice", at: iso(3), turns: 1, stopReason: "cancelled" },
        ].map((r) => JSON.stringify(r)).join("\n") + "\n",
      );

      expect(
        () => assertNotRepeatingIntoTheSameWall(worktreeRoot, "wt-slice"),
        "the breaker must see history the worktree does not contain",
      ).toThrow(/REFUSED/u);

      const sharedEvents = j(sharedRoot, ".openclinxr/openclaw/breaker-events.jsonl");
      expect(existsSync(sharedEvents), "the refusal must be recorded in the SHARED root").toBe(true);
      expect(JSON.parse(readFileSync(sharedEvents, "utf8").trim())["slice"]).toBe("wt-slice");

      expect(
        existsSync(j(worktreeRoot, ".openclinxr/openclaw/breaker-events.jsonl")),
        "nothing may be written inside the worktree — a record there is invisible to the next dispatch",
      ).toBe(false);
    } finally {
      if (prev === undefined) delete process.env["OPENCLINXR_COORDINATION_ROOT"];
      else process.env["OPENCLINXR_COORDINATION_ROOT"] = prev;
      resetCoordinationRootCache();
    }
  });
});
