import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireIntegrationLock, releaseIntegrationLock, renewIntegrationLock,
  INTEGRATION_LOCK_TTL_MS, INTEGRATION_LOCK_INIT_GRACE_MS,
} from "./integration-lock.js";

/**
 * OBSERVABLE: two orchestrators are working this board concurrently. On 2026-08-25 a second one
 * landed #656 and #659 while this one had #642 in flight, and main moved under my feet twice inside
 * one iteration.
 *
 * THE DEFECT, MEASURED — do not re-derive.
 *   - `integrate.ts:568` runs `git merge --no-edit --no-ff --no-commit` DIRECTLY on the shared main
 *     checkout. Grep for lease/lock/flock in that file returns the `mkdirSync` used to create an
 *     output directory and nothing else. There is no integration mutex.
 *   - `setFactoryField` (`board-cli.ts:520`) writes the stage unconditionally, with no expected-stage
 *     compare-and-set, so `Factory=Dispatched` is lifecycle TELEMETRY and not exclusive ownership.
 *     Two orchestrators can both select the same Planted card and both "claim" it.
 *   - The existing automation lease is not a substitute: it deliberately permits disjoint slices, and
 *     acquisition is a non-atomic read-modify-write (plain `writeFile` at
 *     `openclaw-automation-lease.ts:294`).
 *
 * What breaks first is git's own shared mutable state — `index.lock`, a dangling `MERGE_HEAD`, or a
 * ref-lock failure. The quieter failure is worse: a candidate verified against the old base can land
 * after someone else's merge without its contract ever being re-run against the combined main.
 *
 * This uses `mkdir` as the primitive because it is atomic on POSIX — it either creates the directory
 * or fails EEXIST, with no read-then-write window. `writeFile` and `existsSync`-then-create both have
 * that window, which is precisely how the lease above can be held twice.
 *
 * claimScope: that a second integrator cannot hold the lock while a first holds it, that a released
 *   lock is re-acquirable, and that a lock older than its TTL can be taken over.
 * notEvidenceFor: that integrate CALLS this (that is a separate clause in the wiring), that it
 *   protects against a process which predates the lock landing, or that it is safe across machines —
 *   this is one filesystem.
 */

/**
 * ## FIXED (tsk_6fc9f805f9f4eea5)
 *
 * The defect: `mkdirSync(dir)` at integration-lock.ts:81 and the holder `claim()` were separate
 * steps, so a racer that saw the directory before the holder write read "no holder" and stole the
 * lock while its creator was still initializing it. The takeover path had the same read-then-write
 * window, and staleness was a fixed acquisition-time TTL. Measured at HEAD fc3b0aeb: 8/8 red,
 * winners [4,4,4,4,3,4,4,4]; re-measured in this worktree pre-fix: 4/8 red with 4 or 2 winners.
 *
 * The fix serializes every mutating transition (acquire, stale takeover, release, renewal) behind an
 * exclusive op marker created with `O_CREAT|O_EXCL`, installs the lock dir only via a fully
 * initialized staging dir moved into place with an atomic `rename`, captures locks for takeover or
 * release with an atomic `rename` to a tombstone and verifies the captured holder (restoring it if it
 * was refreshed or now belongs to a successor), and derives staleness from the holder's lastSeen
 * heartbeat so renewal beats fixed-TTL theft. Missing holder metadata is HELD for a bounded init
 * grace, then treated as abandoned. No sleeps, no retry loops that narrow the race: losers of the
 * op-marker create answer from the settled state immediately.
 *
 * New clauses: (8) init-grace, (9) exactly one concurrent stale-takeover winner, (10) a predecessor
 * cannot release a successor's lock, (11) renewal/liveness beats fixed-TTL theft.
 */

const scratch = () => mkdtempSync(join(tmpdir(), "intlock-"));

/** Spawn four genuine concurrent racer processes against one lock; returns their WON/lost lines. */
const racerResults = async (root: string, scriptName: string): Promise<string[]> => {
  const modulePath = join(import.meta.dirname, "integration-lock.ts");
  const script = join(root, scriptName);
  writeFileSync(script, `
    import { acquireIntegrationLock } from ${JSON.stringify(modulePath)};
    const r = acquireIntegrationLock(${JSON.stringify(root)}, process.argv[2]);
    process.stdout.write(r.acquired ? "WON" : "lost");
  `);

  const repoRoot = join(import.meta.dirname, "../../..");
  const run = (id: string) => new Promise<string>((resolve) => {
    // The tsx BINARY, not `pnpm exec tsx`: bare `spawn("pnpm", …)` runs without a shell and does
    // not resolve a shim that only exists on an interactive PATH. Measured — it exited non-zero in
    // under a second while the identical command worked by hand.
    const child = spawn(join(repoRoot, "node_modules/.bin/tsx"), [script, id], { cwd: repoRoot });
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.on("error", () => resolve("SPAWN_ERROR"));
    child.on("close", (code) => resolve(code === 0 ? out.trim() : "EXIT_NONZERO"));
  });

  return Promise.all(["a", "b", "c", "d"].map(run));
};

describe("only one integrator mutates main at a time", () => {
  it("(1) a second acquire FAILS while the first holds the lock", () => {
    const root = scratch();
    const first = acquireIntegrationLock(root, "orchestrator-a");
    expect(first.acquired, "the first integrator must get the lock").toBe(true);

    const second = acquireIntegrationLock(root, "orchestrator-b");
    expect(second.acquired, "a second integrator must be refused while the first holds it").toBe(false);
    expect(second.heldBy, "the refusal must name who holds it, or a human cannot act on it")
      .toBe("orchestrator-a");
    rmSync(root, { recursive: true, force: true });
  });

  it("(2) COUNTERWEIGHT: a released lock is acquirable again", () => {
    // Refuses the cheap pass of a lock that never lets go — which would wedge every future land.
    const root = scratch();
    expect(acquireIntegrationLock(root, "a").acquired).toBe(true);
    releaseIntegrationLock(root, "a");
    expect(acquireIntegrationLock(root, "b").acquired, "release must actually free it").toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("(3) COUNTERWEIGHT: a lock older than its TTL can be taken over", () => {
    // A crashed or reaped integrator must not wedge the repo forever. Background dispatches ARE
    // reaped in this environment — four kill events in one session is on record — so a lock with no
    // takeover path is a worse failure than the race it prevents.
    const root = scratch();
    const dir = join(root, ".openclinxr/openclaw/integration.lock");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "holder.json"), JSON.stringify({
      owner: "crashed-orchestrator",
      acquiredAt: new Date(Date.now() - INTEGRATION_LOCK_TTL_MS - 60_000).toISOString(),
    }));
    const taken = acquireIntegrationLock(root, "orchestrator-b");
    expect(taken.acquired, "a stale lock must be takeable or a reap wedges every land").toBe(true);
    expect(taken.stoleFrom, "a takeover must be recorded, never silent").toBe("crashed-orchestrator");
    rmSync(root, { recursive: true, force: true });
  });

  it("(4) COUNTERWEIGHT: a FRESH lock is NOT stolen", () => {
    // Refuses the over-correction of a TTL so permissive that the lock never actually excludes.
    const root = scratch();
    acquireIntegrationLock(root, "busy-orchestrator");
    expect(acquireIntegrationLock(root, "impatient").acquired,
      "a lock inside its TTL must hold").toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("(5) genuinely CONCURRENT acquirers: exactly one wins", async () => {
    // The sequential clauses above prove EXCLUSION. They do not prove ATOMICITY — an
    // existsSync-then-mkdir implementation passes every one of them and still lets two processes
    // through, which is the exact window that makes the automation lease unsafe.
    //
    // MY FIRST VERSION OF THIS CLAUSE WAS VACUOUS and I am recording it rather than quietly fixing
    // it: I used `execFileSync` in a loop, which is SEQUENTIAL. The eight "racers" ran one after
    // another, the first trivially won, and the clause passed while testing nothing. It then failed
    // inside the full suite, which is the only reason I looked. `spawn` + `Promise.all` is what
    // actually overlaps them.
    const root = scratch();
    const modulePath = join(import.meta.dirname, "integration-lock.ts");
    const script = join(root, "race.mts");
    writeFileSync(script, `
      import { acquireIntegrationLock } from ${JSON.stringify(modulePath)};
      const r = acquireIntegrationLock(${JSON.stringify(root)}, process.argv[2]);
      process.stdout.write(r.acquired ? "WON" : "lost");
    `);

    const repoRoot = join(import.meta.dirname, "../../..");
    const run = (id: string) => new Promise<string>((resolve) => {
      // The tsx BINARY, not `pnpm exec tsx`: bare `spawn("pnpm", …)` runs without a shell and does
      // not resolve a shim that only exists on an interactive PATH. Measured — it exited non-zero in
      // under a second while the identical command worked by hand.
      const child = spawn(join(repoRoot, "node_modules/.bin/tsx"), [script, id], { cwd: repoRoot });
      let out = "";
      child.stdout.on("data", (d) => { out += String(d); });
      child.on("error", () => resolve("SPAWN_ERROR"));
      child.on("close", (code) => resolve(code === 0 ? out.trim() : "EXIT_NONZERO"));
    });

    const results = await Promise.all(["a", "b", "c", "d"].map(run));
    const errors = results.filter((r) => r === "SPAWN_ERROR" || r === "EXIT_NONZERO");
    // A spawn failure is reported, never counted as a loss — that is how a broken harness would
    // silently satisfy "exactly one wins" with zero real racers.
    expect(errors, `racers failed to run: ${results.join(",")}`).toEqual([]);
    expect(results.filter((r) => r === "WON").length,
      `exactly one concurrent racer may win; got ${results.join(",")}`).toBe(1);
  }, 180_000);

  it("(7) integrate() ACQUIRES the lock before it merges", () => {
    // THE PLANTED RED, and the one that matters. Clauses (1)-(6) prove the mechanism works; none of
    // them proves anything CALLS it, and this repo has shipped a built-but-unwired mechanism six
    // times — a merge-kill nothing invoked, a contract report integrate ignored, a done_when
    // vocabulary the evaluator bypassed. The question for an added mechanism is never "what reads
    // it" but "what CALLS it, in the real path, without a human remembering".
    //
    // I deleted this clause once while rewriting clause (5) and caught it only because the suite
    // reported 6 tests instead of 7. Count your clauses.
    const src = readFileSync(join(import.meta.dirname, "integrate.ts"), "utf8");
    expect(src.includes("acquireIntegrationLock"),
      "integrate.ts:568 merges onto shared main; it must hold the lock while doing so").toBe(true);
    expect(src.includes("releaseIntegrationLock"),
      "an integrator that never releases wedges every later land").toBe(true);
  });

  it("(6) VACUITY GUARD: the lock leaves a real artifact naming its holder", () => {
    // If acquire were a no-op returning true, clauses (1) and (4) would still read sensibly.
    const root = scratch();
    acquireIntegrationLock(root, "someone");
    expect(existsSync(join(root, ".openclinxr/openclaw/integration.lock/holder.json")),
      "a lock nobody can inspect cannot be diagnosed when it wedges").toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("(8) INIT-GRACE: missing metadata is HELD during bounded init, then takeable as abandoned", () => {
    // A directory with no holder record is either a lock being initialized or a crash remnant.
    // Stealing it during init is the pre-fix defect (mkdir then claim); never taking it over wedges
    // the repo on a crash between the two. Both bounds are asserted: fresh metadata → held,
    // metadata aged past the grace → abandoned takeover.
    const root = scratch();
    const dir = join(root, ".openclinxr/openclaw/integration.lock");
    mkdirSync(dir, { recursive: true });

    const fresh = acquireIntegrationLock(root, "orchestrator-b");
    expect(fresh.acquired,
      "missing metadata inside the init grace must be treated as held, not stolen").toBe(false);
    expect(fresh.heldBy, "the refusal must say why, or a human cannot act")
      .toContain("initializing");

    const ancient = new Date(Date.now() - INTEGRATION_LOCK_INIT_GRACE_MS - 1_000);
    utimesSync(dir, ancient, ancient);
    const abandoned = acquireIntegrationLock(root, "orchestrator-b");
    expect(abandoned.acquired,
      "a grace-expired half-initialized lock must be takeable, or a crash wedges every land").toBe(true);
    expect(abandoned.stoleFrom, "an abandoned-lock takeover must be recorded, never silent").toBeTruthy();
    rmSync(root, { recursive: true, force: true });
  });

  it("(9) genuinely CONCURRENT stale-takeover racers: exactly one wins", async () => {
    // Clause (3) proves a stale lock CAN be taken over sequentially. It does not prove the takeover
    // itself is atomic: two racers can both read "stale", both remove, both install — the pre-fix
    // mkdir/claim race restated at the takeover step. The takeover must go through the same
    // exclusive-op gate as acquisition, so exactly one racer wins and the survivor names a racer.
    const root = scratch();
    const dir = join(root, ".openclinxr/openclaw/integration.lock");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "holder.json"), JSON.stringify({
      owner: "crashed-orchestrator",
      acquiredAt: new Date(Date.now() - INTEGRATION_LOCK_TTL_MS - 60_000).toISOString(),
    }));

    const results = await racerResults(root, "race-stale.mts");
    const errors = results.filter((r) => r === "SPAWN_ERROR" || r === "EXIT_NONZERO");
    expect(errors, `racers failed to run: ${results.join(",")}`).toEqual([]);
    expect(results.filter((r) => r === "WON").length,
      `exactly one concurrent stale-takeover may win; got ${results.join(",")}`).toBe(1);

    const holder = JSON.parse(readFileSync(join(dir, "holder.json"), "utf8")) as { owner: string };
    expect(["a", "b", "c", "d"], "the surviving lock must name one of the racers, not the crashed owner")
      .toContain(holder.owner);
    rmSync(root, { recursive: true, force: true });
  }, 180_000);

  it("(10) PREDECESSOR cannot release a successor's lock", () => {
    // A release that is read-then-rm can land after a takeover and delete the successor's lock —
    // freeing a lock the successor still believes it holds. Release must refuse once the holder is
    // not the caller, and must not disturb the successor's lock.
    const root = scratch();
    acquireIntegrationLock(root, "orchestrator-a");
    const dir = join(root, ".openclinxr/openclaw/integration.lock");
    const stale = new Date(Date.now() - INTEGRATION_LOCK_TTL_MS - 60_000).toISOString();
    writeFileSync(join(dir, "holder.json"), JSON.stringify({ owner: "orchestrator-a", acquiredAt: stale }));

    const taken = acquireIntegrationLock(root, "orchestrator-b");
    expect(taken.acquired, "the successor must be able to take over the stale lock").toBe(true);
    expect(taken.stoleFrom).toBe("orchestrator-a");

    expect(releaseIntegrationLock(root, "orchestrator-a"),
      "the predecessor must not be able to release the successor's lock").toBe(false);
    const holder = JSON.parse(readFileSync(join(dir, "holder.json"), "utf8")) as { owner: string };
    expect(holder.owner, "the successor's lock must survive the predecessor's release attempt")
      .toBe("orchestrator-b");
    expect(releaseIntegrationLock(root, "orchestrator-b"), "the successor releases its own lock")
      .toBe(true);
    expect(acquireIntegrationLock(root, "orchestrator-c").acquired,
      "the released lock must be acquirable again").toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("(11) LIVENESS: renewal beats fixed-TTL theft; a non-owner cannot renew", () => {
    // Fixed-TTL theft is the over-correction the card forbids: a long-running integration is a live
    // holder even when its ORIGINAL acquisition is ancient. Staleness must follow the last heartbeat,
    // and renewal must refuse to refresh a lock that is no longer the caller's.
    const root = scratch();
    const dir = join(root, ".openclinxr/openclaw/integration.lock");
    const holderFile = join(dir, "holder.json");
    const ancient = new Date(Date.now() - INTEGRATION_LOCK_TTL_MS * 3).toISOString();

    // Ancient acquisition AND ancient heartbeat → stale → stealable.
    acquireIntegrationLock(root, "orchestrator-a");
    writeFileSync(holderFile, JSON.stringify({ owner: "orchestrator-a", acquiredAt: ancient, lastSeen: ancient }));
    const stolen = acquireIntegrationLock(root, "orchestrator-b");
    expect(stolen.acquired, "a lock with an ancient heartbeat must be takeable").toBe(true);
    expect(stolen.stoleFrom).toBe("orchestrator-a");

    // Ancient acquisition, FRESH heartbeat → live → not stealable, no matter how old the acquisition.
    acquireIntegrationLock(root, "orchestrator-a");
    writeFileSync(holderFile, JSON.stringify({ owner: "orchestrator-a", acquiredAt: ancient, lastSeen: new Date().toISOString() }));
    const refused = acquireIntegrationLock(root, "orchestrator-b");
    expect(refused.acquired,
      "a long-running integration with a fresh heartbeat must NOT be stolen at a fixed TTL").toBe(false);
    expect(refused.heldBy).toBe("orchestrator-a");

    // Renewal refreshes the heartbeat.
    expect(renewIntegrationLock(root, "orchestrator-a"), "the owner may renew").toBe(true);
    const renewed = JSON.parse(readFileSync(holderFile, "utf8")) as { owner: string; lastSeen: string };
    expect(Date.now() - Date.parse(renewed.lastSeen),
      "renewal must refresh the liveness timestamp").toBeLessThan(INTEGRATION_LOCK_TTL_MS);

    // A non-owner cannot renew, and renewal does not transfer ownership.
    expect(renewIntegrationLock(root, "orchestrator-b"), "a non-owner must not renew").toBe(false);
    const still = JSON.parse(readFileSync(holderFile, "utf8")) as { owner: string };
    expect(still.owner).toBe("orchestrator-a");
    rmSync(root, { recursive: true, force: true });
  });
});
