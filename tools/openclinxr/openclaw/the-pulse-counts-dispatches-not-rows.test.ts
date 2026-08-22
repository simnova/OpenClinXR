import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the hourly pulse counts DISPATCHES, not ledger lines.
 *
 * `factory-pulse.ts:50-65` computes its four ledger metrics by filtering rows:
 *
 *     const done = rows.filter((r) => r.phase === "completed");
 *     completions = done.length;
 *     ...
 *     for (const r of rows.filter((r) => r.phase === "spawned")) perSlice.set(...)
 *     rework = [...perSlice.values()].filter((n) => n > 1).length;
 *
 * One dispatch occupies two `completed` lines - dispatch writes one at exit, contract verification
 * re-appends another with `proofsOk` resolved. And one slice occupies one `spawned` line per attempt,
 * including attempts that died before a worker existed.
 *
 * MEASURED on the live ledger, 2026-08-22:
 *   last 24 rows: 15 `completed` rows across 9 DISTINCT sessions; 6 sessions carry two rows each,
 *     the first with proofsOk=null and the second resolved. completions overcounts 1.67x.
 *   issue-560: 3 `spawned` rows, of which ONE ran a worker (turns=21). The other two were a
 *     deepseek-v4-pro 402 and an ox-alpha 401, neither of which started anything.
 *     rework as computed = 1. Honest rework = 0.
 *
 * The rework case is the same error as #565 from the other side: a provider outage scored as if a
 * delegate had needed a second go.
 *
 * SCOPE. #562 originally also claimed the pass rate could not fall when dispatch broke. #563 landed
 * `phase: "died"` and dead rows no longer reach `completed` at all, so that half is resolved and is
 * NOT re-litigated here - clause (5) guards it instead.
 *
 * This contract requires an exported pure summariser so the counting can be measured without running
 * the hook, its 9-second board query, or its 55-minute throttle. The NAME below is mine; the
 * mechanism is the implementer's.
 *
 * NOTE ON THE OWNER'S SPEC. `docs/openclinxr/owner-memory/PULSE-PROTOCOL.md` is the SSOT for what
 * these metrics mean. "Completions" counting dispatches rather than lines is a reading of intent, not
 * a redefinition - but if the implementer believes it changes the metric, say so in the report rather
 * than deciding it in code.
 *
 * claimScope: how the pulse aggregates ledger rows into completions, pass rate and rework.
 * notEvidenceFor: the verdict thresholds, the board query, the throttle, provider-failure counts, or
 *   whether any dispatch was correct.
 */

type Row = Record<string, unknown>;

/** Mirrors the measured shape of the live ledger. Values are MEASURED, not chosen as targets. */
const LEDGER_WINDOW: Row[] = [
  // a slice dispatched three times: two provider deaths, then a real run that proofed green
  { slice: "issue-a", sessionId: "s-dead-402", phase: "spawned", at: "2026-08-22T07:10:00Z" },
  { slice: "issue-a", sessionId: "s-dead-402", phase: "died", at: "2026-08-22T07:10:05Z" },
  { slice: "issue-a", sessionId: "s-dead-401", phase: "spawned", at: "2026-08-22T07:12:00Z" },
  { slice: "issue-a", sessionId: "s-dead-401", phase: "died", at: "2026-08-22T07:12:07Z" },
  { slice: "issue-a", sessionId: "s-ran", phase: "spawned", at: "2026-08-22T07:20:00Z" },
  { slice: "issue-a", sessionId: "s-ran", phase: "completed", turns: 21, at: "2026-08-22T07:41:00Z" },
  { slice: "issue-a", sessionId: "s-ran", phase: "completed", turns: 21, proofsOk: true, at: "2026-08-22T07:41:30Z" },
  // an ordinary slice: one dispatch, two completed lines
  { slice: "issue-b", sessionId: "s-b", phase: "spawned", at: "2026-08-22T07:50:00Z" },
  { slice: "issue-b", sessionId: "s-b", phase: "completed", turns: 32, at: "2026-08-22T08:10:00Z" },
  { slice: "issue-b", sessionId: "s-b", phase: "completed", turns: 32, proofsOk: true, at: "2026-08-22T08:10:20Z" },
  // a slice whose worker ran and failed its proofs
  { slice: "issue-c", sessionId: "s-c", phase: "spawned", at: "2026-08-22T08:15:00Z" },
  { slice: "issue-c", sessionId: "s-c", phase: "completed", turns: 200, proofsOk: false, at: "2026-08-22T08:40:00Z" },
];

async function summarise(rows: Row[]): Promise<Record<string, number>> {
  const mod = await import("./factory-pulse.js") as Record<string, unknown>;
  const fn = mod["summariseLedgerWindow"];
  if (typeof fn !== "function") {
    throw new Error(
      "factory-pulse.ts does not export summariseLedgerWindow(rows). The counting currently lives "
      + "inline in main() with hardcoded paths, so it cannot be measured without running the hook.",
    );
  }
  return (fn as (r: Row[]) => Record<string, number>)(rows);
}

describe("the pulse counts dispatches, not rows", () => {
  it("(0) HARNESS COLUMN: the module loads and its existing export behaves", async () => {
    // Proves this file can observe factory-pulse at all, so the it.fails clauses below mean "the
    // summariser is absent", not "the test is broken".
    //
    // MEASURED SIDE EFFECT, 2026-08-22: factory-pulse.ts calls main() at module scope, so THIS
    // import runs the hook. A test run at 08:51:35 appended a row to the owner's tracked
    // docs/openclinxr/owner-memory/pulse.jsonl and rewrote the state file. Only the 55-minute
    // throttle keeps that from happening on every run. The module is untestable by construction and
    // the fix must make it importable without running.
    const mod = await import("./factory-pulse.js") as Record<string, unknown>;
    expect(typeof mod["staleLine"]).toBe("function");
    const line = (mod["staleLine"] as () => string | null)();
    expect(line === null || line.startsWith("FACTORY PULSE STALE")).toBe(true);
  });

  it.fails("(1) RED: two completed lines for one session are one completion", async () => {
    const s = await summarise(LEDGER_WINDOW);
    expect(
      s["completions"],
      "three dispatches ran (s-ran, s-b, s-c); five completed LINES describe them. On the live "
        + "ledger this reads 15 lines for 9 dispatches",
    ).toBe(3);
  });

  it.fails("(2) RED: a slice re-dispatched after a provider death is not rework", async () => {
    const s = await summarise(LEDGER_WINDOW);
    expect(
      s["rework"],
      "issue-a was spawned three times and a worker ran once; the other two never started. "
        + "Counting that as rework scores a provider outage against the delegate",
    ).toBe(0);
  });

  it.fails("(3) POST-FIX GUARD: the pass rate over resolved proofs must stay right", async () => {
    // This one is NOT broken today by the row/session confusion - each dispatch contributes exactly
    // one row carrying a boolean proofsOk. It is here so a fix cannot disturb it while repairing the
    // counts. It is marked it.fails only because the export it calls does not exist yet.
    const s = await summarise(LEDGER_WINDOW);
    expect(s["passed"], "s-ran and s-b proofed green").toBe(2);
    expect(s["failed"], "s-c ran and failed its proofs").toBe(1);
  });

  it.fails("(4) COUNTERWEIGHT: a genuine re-dispatch after a worker RAN is still rework", async () => {
    // Refuses the over-correction of ignoring repeat spawns entirely. A worker that ran, failed and
    // was sent again is exactly what this metric exists to see.
    const genuine: Row[] = [
      ...LEDGER_WINDOW,
      { slice: "issue-d", sessionId: "s-d1", phase: "spawned", at: "2026-08-22T08:41:00Z" },
      { slice: "issue-d", sessionId: "s-d1", phase: "completed", turns: 44, proofsOk: false, at: "2026-08-22T08:50:00Z" },
      { slice: "issue-d", sessionId: "s-d2", phase: "spawned", at: "2026-08-22T08:52:00Z" },
      { slice: "issue-d", sessionId: "s-d2", phase: "completed", turns: 51, proofsOk: true, at: "2026-08-22T08:59:00Z" },
    ];
    const s = await summarise(genuine);
    expect(s["rework"], "issue-d ran twice; that is the rework this metric is for").toBe(1);
  });

  it.fails("(5) COUNTERWEIGHT: a died row is never a completion", async () => {
    // Guards #563's landing. Before it, the two dead issue-560 rows were labelled "completed" and
    // scored as throughput.
    const allDead: Row[] = LEDGER_WINDOW.filter((r) => r["phase"] !== "completed");
    const s = await summarise(allDead);
    expect(s["completions"], "nothing completed in this window").toBe(0);
    expect(s["passed"]).toBe(0);
    expect(s["failed"]).toBe(0);
  });
});
