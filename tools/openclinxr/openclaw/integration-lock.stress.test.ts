import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { acquireIntegrationLock, releaseIntegrationLock, renewIntegrationLock } from "./integration-lock.js";

/**
 * OBSERVABLE: three of the seven properties tsk_f500b82767fc7452 asks for are absent, and its
 * premise line is stale about a fourth.
 *
 * MEASURED at main b3a3771c on 2026-09-03, by the orchestrator, to unblock tsk_c2822f728a7dde77.
 * `only-one-integrator-mutates-main-at-a-time.test.ts` is 11/11 GREEN, and its two concurrency
 * clauses spawn four genuine `tsx` processes each (clause 5 acquire, clause 9 stale takeover), both
 * guarded so a SPAWN_ERROR is reported rather than counted as a loss. Timing confirms the spawns are
 * real: one bare tsx cold start measures 231 ms and clause 5 measures 244 ms of test time, which is
 * four in parallel and not four skipped.
 *
 * So "concurrent acquisition repeatedly admits multiple winners" — the blockedReason on
 * tsk_c2822f728a7dde77 — NO LONGER REPRODUCES. It was fixed under tsk_6fc9f805f9f4eea5 by
 * serializing every mutating transition behind an O_CREAT|O_EXCL op marker, installing the lock dir
 * via an atomic rename, and deriving staleness from the holder heartbeat.
 *
 * WHAT IS STILL ABSENT, and what these three clauses plant:
 *
 *   (1) FENCED OWNERSHIP. `integration-lock.ts` contains zero occurrences of the string "token".
 *       `LockResult` is `{acquired, heldBy?, stoleFrom?}`, and release and renewal authenticate on a
 *       caller-supplied owner STRING. Any process that guesses or reuses an owner name can release
 *       or renew another's lock. f500 asks for >=128-bit opaque handles.
 *   (2) REPEATED STRESS. The green clauses run ONE race of FOUR processes. One sample of a race
 *       cannot distinguish a fix from a lucky scheduling.
 *   (3) FAIL-CLOSED INTEGRATE. `integrate.ts` imports only acquire and release, acquires once at
 *       :604 and releases in `finally` at :725. It never calls `renewIntegrationLock`, never
 *       re-checks ownership, and never reads release's boolean. A 30-minute integration that loses
 *       its lock mid-merge proceeds to mutate main anyway.
 *
 * IMMUTABLE diagnosis. Flip it.fails -> it and append a `## FIXED` block. Do not rewrite these
 * measurements, and do not restore f500's stale premise line.
 *
 * ## WHY 10 ITERATIONS AND NOT f500's 50
 *
 * This is a REGRESSION NET over a defect that is already fixed, not a detection sweep for an open
 * one, so the number derives from the measured pre-fix reproduction rate rather than from caution.
 * The green test's own header records 8 of 8 red at fc3b0aeb and 4 of 8 red on re-measure, so
 * p >= 0.5. At p = 0.5, missing a regression in every one of n iterations is 0.5^n; n = 10 gives
 * 1/1024 < 0.1%. Fifty is a soak, costs five times the wall clock on every land, and buys 0.5^50.
 * If a soak lane is wanted it belongs on a schedule, not in a land proof. EIGHT processes is f500's
 * own escalation from the four that currently pass; its job is contention pressure, not a threshold.
 *
 * claimScope: whether the lock fences ownership with an unforgeable handle, holds exactly one winner
 *   under repeated 8-way contention, and whether integrate refuses to mutate main after losing it.
 * notEvidenceFor: cross-machine safety (this is one filesystem); protection against a process that
 *   predates the lock; that any current integration has actually raced.
 */

const scratch = () => mkdtempSync(join(tmpdir(), "intlock-stress-"));
const REPO_ROOT = join(import.meta.dirname, "../../..");

/** Derived above: 0.5^10 < 0.1% of missing a regression to the measured pre-fix rate. */
const ITERATIONS = 10;
/** f500's escalation from the 4 that currently pass; contention pressure, not a threshold. */
const RACERS = 8;

type LockHandleShape = { acquired: boolean; token?: unknown };

/** One race of N genuine processes against one lock root. Returns each racer's WON/lost line. */
const race = async (root: string, ids: readonly string[]): Promise<string[]> => {
  const modulePath = join(import.meta.dirname, "integration-lock.ts");
  const script = join(root, "race.mts");
  writeFileSync(script, `
    import { acquireIntegrationLock } from ${JSON.stringify(modulePath)};
    const r = acquireIntegrationLock(${JSON.stringify(root)}, process.argv[2]);
    process.stdout.write(r.acquired ? "WON" : "lost");
  `);
  const run = (id: string) => new Promise<string>((resolve) => {
    const child = spawn(join(REPO_ROOT, "node_modules/.bin/tsx"), [script, id], { cwd: REPO_ROOT });
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.on("error", () => resolve("SPAWN_ERROR"));
    child.on("close", (code) => resolve(code === 0 ? out.trim() : "EXIT_NONZERO"));
  });
  return Promise.all(ids.map(run));
};

describe("the integration lock fences ownership and holds under repeated stress", () => {
  it.fails("(1) acquire returns an unforgeable handle, and an owner STRING cannot release or renew", () => {
    // The cheapest way to pass clause (2) is to widen the race harness and leave auth alone, so this
    // clause is first: a lock that admits exactly one winner and then lets any process release it by
    // guessing "integrate" is not fenced.
    const root = scratch();
    const first = acquireIntegrationLock(root, "holder-a") as LockHandleShape;
    expect(first.acquired).toBe(true);
    expect(first.token, "acquire returns no opaque handle — release authenticates on a guessable owner string")
      .toBeTypeOf("string");
    expect(String(first.token ?? "").length, ">=128 bits of handle, hex-encoded, is >=32 chars")
      .toBeGreaterThanOrEqual(32);

    // COUNTERWEIGHT: knowing the owner NAME must not be enough. A second process that has read
    // holder.json — which is world-readable by design, clause (6) of the green suite pins that —
    // knows the owner string and must still be refused.
    const knownOwnerName = JSON.parse(
      readFileSync(join(root, ".openclinxr/openclaw/integration.lock/holder.json"), "utf8"),
    ) as { owner: string };
    expect(releaseIntegrationLock(root, knownOwnerName.owner),
      "a process that merely read the holder name released someone else's lock").toBe(false);
    expect(renewIntegrationLock(root, knownOwnerName.owner),
      "a process that merely read the holder name renewed someone else's lock").toBe(false);
    rmSync(root, { recursive: true, force: true });
  }, 180_000);

  it("(2) SMOKE, NOT YET A NET: one winner in every one of 10 races of 8 — sensitivity UNPROVEN", async () => {
    // Authored as a RED. It PASSED on first run: the lock already holds exactly one winner across
    // 10 races of 8 genuine processes, 2.95 s of test time against a 231 ms tsx cold start, so the
    // spawns are real and the property currently holds.
    //
    // THEN TWO DESTRUCTIVE PROBES FAILED TO TRIP IT, and that is the finding this clause exists to
    // record. Both substitutions were confirmed matched before the run:
    //
    //   A1  integration-lock.ts:144  `{ flag: "wx" }` -> `{ flag: "w" }`   removes the O_CREAT|O_EXCL
    //       exclusive op marker, the documented atomic serialization point.  CLAUSE STILL PASSED.
    //   A2  installLock's `renameSync(staging, lockDir)` -> mkdir + per-file copy,
    //       removing the atomic install.                                     CLAUSE STILL PASSED.
    //
    // So this clause does NOT currently detect two deliberate atomicity defects, and a green here
    // must not be read as evidence the lock is safe. The most likely mechanism is that a tsx cold
    // start is ~231 ms while the critical window is sub-millisecond, so eight "concurrent" racers
    // arrive spread over tens of milliseconds and never overlap at the instant that matters. The
    // original four-racer clauses in only-one-integrator-mutates-main-at-a-time.test.ts share this
    // weakness.
    //
    // THIS IS WHY tsk_f500b82767fc7452 SAYS "barrier-synchronized". The barrier is not a detail of
    // the harness; it is the thing that makes any of these races able to fail. A worker implementing
    // f500 must land the barrier FIRST and re-run probes A1 and A2 against it — if they still do not
    // trip, the harness is measuring nothing and the iteration count is irrelevant.
    //
    // Do not delete this clause to make the file tidy, and do not lower ITERATIONS or RACERS. Its
    // job today is to carry the two probe results to whoever implements the barrier.
    const ids = Array.from({ length: RACERS }, (_, i) => `r${i}`);
    const winnersPerRace: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const root = scratch();
      const results = await race(root, ids);
      const errors = results.filter((r) => r === "SPAWN_ERROR" || r === "EXIT_NONZERO");
      // A spawn failure is REPORTED, never counted as a loss — that is how a broken harness
      // satisfies "exactly one wins" with zero real racers.
      expect(errors, `iteration ${i}: racers failed to run: ${results.join(",")}`).toEqual([]);
      winnersPerRace.push(results.filter((r) => r === "WON").length);
      rmSync(root, { recursive: true, force: true });
    }
    // Asserted over EVERY iteration, not over a mean. A mean of 1.0 is satisfiable by one race with
    // two winners and one with none.
    expect(winnersPerRace, `winners per race across ${ITERATIONS} races of ${RACERS}`)
      .toEqual(Array.from({ length: ITERATIONS }, () => 1));
  }, 600_000);

  it.fails("(3) integrate RENEWS across the shared-main mutation region and fails closed on lost ownership", () => {
    // integrate.ts imports acquire and release only. A 30-minute integration that loses its lock
    // mid-merge keeps mutating main, and release's boolean return is discarded.
    const source = readFileSync(join(REPO_ROOT, "tools/openclinxr/openclaw/integrate.ts"), "utf8");
    expect(source, "integrate.ts never renews the lock it holds across the mutation region")
      .toMatch(/renewIntegrationLock/u);
    // COUNTERWEIGHT: importing the symbol is not calling it, and calling it is not acting on it.
    // The failure path must exist — a renewal whose false return is discarded fences nothing.
    expect(source, "integrate.ts calls renewal but does not fail closed when it returns false")
      .toMatch(/renewIntegrationLock\([^)]*\)[\s\S]{0,400}?(throw|return\s*\{[^}]*ok:\s*false)/u);
    rmSync(scratch(), { recursive: true, force: true });
  }, 180_000);
});
