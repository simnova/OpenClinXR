import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  acquireIntegrationLock, releaseIntegrationLock, renewIntegrationLock, INTEGRATION_LOCK_TTL_MS,
} from "./integration-lock.js";

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
 *
 * ## FIXED (tsk_f500b82767fc7452)
 *
 * Landed on top of the diagnosis above, which stays intact as the historical record:
 *
 *   (a) BARRIER LANDED. The racers now rendezvous before acquiring: each writes a `ready.<id>` file
 *       and spins until every racer has arrived, so the acquires overlap the critical section
 *       instead of arriving spread over tsx cold-start time (~231 ms vs a sub-ms window). This was
 *       the change the diagnosis said must come FIRST.
 *   (b) PROBES RE-RUN AGAINST THE BARRIER (clause 2's iteration loop, 50 races, MEASURED 2026-09-02
 *       in the f500 worktree). A1 alone (op marker `wx` -> `w`, removing O_CREAT|O_EXCL) TRIPS the
 *       net: iteration 0 returned EXIT_NONZERO racers, because with two mutators inside the region
 *       one racer's `sweepOrphans` deletes another's live staging dir and the holder write then
 *       throws ENOENT. A2 alone (install's atomic rename -> mkdir + per-file copy) STILL HOLDS
 *       exactly one winner across all 50 races: the exclusive op marker alone admits one mutator,
 *       so a non-atomic install is not independently reachable by a race. The COMBINED probe
 *       (A1+A2 — both serialization points removed) TRIPS with MULTI-WINNER races (iteration 2:
 *       6 of 8 racers WON) plus crashes. The pre-barrier harness passed all three, so the barrier
 *       is what gives the net sensitivity to the serialization-loss class the diagnosis names.
 *   (c) ITERATIONS = 50 per the card's floor ("at least 50 iterations each of fresh-init and
 *       stale-takeover races"). The "why 10" reasoning above priced a NON-barrier harness whose
 *       per-iteration detection depended on accidental scheduling overlap (p >= 0.5 measured). The
 *       barrier removes that lottery: each race is a genuine collision at ~0.3 s, so 50 races buy
 *       real rare-interleaving coverage at a cost the land proof tolerates, and the card's floor is
 *       honoured. RACERS stays at the card's 8.
 *   (d) FENCED OWNERSHIP (clause 1, flipped below): `acquire` returns an opaque >=128-bit token;
 *       `holder.json` stores only its SHA-256 digest; release and renewal authenticate on the token,
 *       never on the owner string.
 *   (e) FAIL-CLOSED INTEGRATE (clause 3, flipped below): `integrate.ts` renews at every boundary of
 *       the shared-main mutation region and throws when a renewal stops authenticating.
 */

const scratch = () => mkdtempSync(join(tmpdir(), "intlock-stress-"));
const REPO_ROOT = join(import.meta.dirname, "../../..");

/** Card floor: >=50 barrier races each for fresh-init and stale-takeover (see ## FIXED (c) above). */
const ITERATIONS = 50;
/** f500's escalation from the 4 that currently pass; contention pressure, not a threshold. */
const RACERS = 8;

type LockHandleShape = { acquired: boolean; token?: unknown };

/**
 * One race of N barrier-synchronized genuine processes against one lock root. Each racer writes a
 * `ready.<id>` file and spins until ALL racers have arrived, so the acquires overlap the critical
 * section rather than arriving spread over tsx cold-start time. Returns each racer's WON/lost line.
 */
const race = async (root: string, ids: readonly string[]): Promise<string[]> => {
  const modulePath = join(import.meta.dirname, "integration-lock.ts");
  const barrierDir = join(root, "barrier");
  const script = join(root, "race.mts");
  writeFileSync(script, `
    import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    import { acquireIntegrationLock } from ${JSON.stringify(modulePath)};
    const root = ${JSON.stringify(root)};
    const id = process.argv[2];
    const barrierDir = ${JSON.stringify(barrierDir)};
    mkdirSync(barrierDir, { recursive: true });
    writeFileSync(join(barrierDir, "ready." + id), String(process.pid), { flag: "wx" });
    const need = ${ids.length};
    // A racer that never reaches the rendezvous (spawn failure elsewhere) must not hang the race:
    // bound the wait and exit nonzero so the parent REPORTS the failure instead of spinning.
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (Date.now() > deadline) process.exit(3);
      let ready = 0;
      try {
        ready = readdirSync(barrierDir).filter((f) => f.startsWith("ready.")).length;
      } catch { /* barrier dir momentarily absent */ }
      if (ready >= need) break;
    }
    const r = acquireIntegrationLock(root, id);
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
  it("(1) acquire returns an unforgeable handle, and an owner STRING cannot release or renew", () => {
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

  it("(2) fresh-init BARRIER net: exactly one winner in every one of 50 races of 8", async () => {
    // HISTORY (pre-barrier; recorded because it shaped this clause): authored as a RED, this clause
    // passed on first run, and destructive probes A1 (op marker wx -> w) and A2 (install rename ->
    // mkdir + per-file copy) failed to trip it — arrivals spread over a ~231 ms tsx cold start never
    // overlapped the sub-ms critical section. The barrier below is that fix; the probe re-runs
    // against it are recorded in the ## FIXED block in the header.
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
    expect(winnersPerRace, `winners per race across ${ITERATIONS} barrier races of ${RACERS}`)
      .toEqual(Array.from({ length: ITERATIONS }, () => 1));
  }, 600_000);

  it("(3) integrate RENEWS across the shared-main mutation region and fails closed on lost ownership", () => {
    // Pre-fix, integrate.ts imported acquire and release only: a 30-minute integration that lost
    // its lock mid-merge kept mutating main, and release's boolean return was discarded. The clause
    // now asserts both halves of the fix are present in the source.
    const source = readFileSync(join(REPO_ROOT, "tools/openclinxr/openclaw/integrate.ts"), "utf8");
    expect(source, "integrate.ts never renews the lock it holds across the mutation region")
      .toMatch(/renewIntegrationLock/u);
    // COUNTERWEIGHT: importing the symbol is not calling it, and calling it is not acting on it.
    // The failure path must exist — a renewal whose false return is discarded fences nothing.
    expect(source, "integrate.ts calls renewal but does not fail closed when it returns false")
      .toMatch(/renewIntegrationLock\([^)]*\)[\s\S]{0,400}?(throw|return\s*\{[^}]*ok:\s*false)/u);
    rmSync(scratch(), { recursive: true, force: true });
  }, 180_000);

  it("(4) stale-takeover BARRIER net: a stopped-renewing holder yields exactly one successor in every one of 50 races of 8", async () => {
    // "Stopped renewal permits exactly one successor", under contention: a crashed holder with an
    // ancient heartbeat is seeded, then 8 barrier-synchronized racers all try to take it over.
    const ids = Array.from({ length: RACERS }, (_, i) => `s${i}`);
    const winnersPerRace: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const root = scratch();
      // Seed a crashed holder that stopped renewing long ago. It is deliberately a pre-token
      // remnant (owner string, no token digest): such a record cannot be released or renewed by
      // anyone, so a stale takeover is the only way it clears.
      const lockDir = join(root, ".openclinxr/openclaw/integration.lock");
      mkdirSync(lockDir, { recursive: true });
      const ancient = new Date(Date.now() - INTEGRATION_LOCK_TTL_MS - 60_000).toISOString();
      writeFileSync(
        join(lockDir, "holder.json"),
        JSON.stringify({ owner: "crashed-orchestrator", acquiredAt: ancient, lastSeen: ancient }),
      );
      const results = await race(root, ids);
      const errors = results.filter((r) => r === "SPAWN_ERROR" || r === "EXIT_NONZERO");
      expect(errors, `iteration ${i}: racers failed to run: ${results.join(",")}`).toEqual([]);
      winnersPerRace.push(results.filter((r) => r === "WON").length);
      // The surviving lock must name one of the racers, never the crashed holder the race stole.
      const survivor = JSON.parse(readFileSync(join(lockDir, "holder.json"), "utf8")) as { owner: string };
      expect(ids, `iteration ${i}: the survivor lock names ${survivor.owner}, not a racer`)
        .toContain(survivor.owner);
      rmSync(root, { recursive: true, force: true });
    }
    expect(winnersPerRace, `stale-takeover winners per race across ${ITERATIONS} races of ${RACERS}`)
      .toEqual(Array.from({ length: ITERATIONS }, () => 1));
  }, 600_000);
});
