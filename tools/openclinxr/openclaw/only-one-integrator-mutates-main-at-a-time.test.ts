import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireIntegrationLock, releaseIntegrationLock, INTEGRATION_LOCK_TTL_MS,
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

const scratch = () => mkdtempSync(join(tmpdir(), "intlock-"));

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
});
