import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countQuietThreads } from "../openclaw/openclaw-sweep.js";

/**
 * **OBSERVABLE: the sweep's `quiet=` count is a measurement, and the tick knows how many workers
 * are alive.** S5 of #584 reads `~/.grok/sessions/<encoded>/updates.jsonl`. Sessions do not live
 * there. They nest one level deeper, under a per-session UUID.
 *
 * ## MEASURED ON HEAD 730ed56f, 2026-08-23 — do not re-derive
 *
 *     glob  <encoded>/updates.jsonl        ->    0 files
 *     glob  <encoded>/<uuid>/updates.jsonl -> 2301 files
 *
 *     true values via the nested glob:  active_24h=25  quiet_gt30min=21  fresh_le30min=4
 *     sweep prints:                     quiet=0
 *
 * Every directory hits `if (!existsSync(updatesPath)) continue`, so the function returns 0
 * unconditionally. `quiet=0` is not a reading — it is the shape of the bug, and the orchestrator
 * cited that zero in a tick report. This is the vacuous-instrument class: it cannot ever be nonzero,
 * so it is green about nothing.
 *
 * ## WHY IT IS UNTESTABLE TODAY, AND WHAT THAT FORCES
 *
 * `countQuietThreads` hardcodes `join(process.env.HOME, ".grok/sessions")`. A contract cannot build a
 * fixture for a function that only ever reads the real machine. The fix therefore takes an injectable
 * base as its FIRST parameter, keeping `now` after it. That is not gold-plating: it is the only way
 * clause (2)'s known-good column can exist at all.
 *
 * ## THE SECOND DEFECT — the worker floor has no implementation
 *
 * The standing parallelism floor is 3 concurrent live workers with a self-reporting breach line.
 * Nothing computes it; the orchestrator has been counting by hand. A hand count is not a gate, and
 * on the tick that opened at n=1 nothing fired. `countLiveWorkers` closes that.
 *
 * ## NOT A DEFECT, and the contract must not "fix" it
 *
 * An UNREADABLE sessions root returns -1, deliberately: a section error must stay distinguishable
 * from "no quiet threads". Clause (4) pins that, because the obvious rewrite drops it to 0 and the
 * SWEEP line would then read the same for a broken scan and a clean one.
 *
 * claimScope: what countQuietThreads/countLiveWorkers return for a controlled sessions fixture.
 * notEvidenceFor: whether any real thread is stuck; whether the floor of 3 is the right number;
 *   whether anyone acts on the printed line.
 */

const MIN = 60_000;

/** Builds `<root>/<encoded>/<uuid>/updates.jsonl` — the REAL layout, not the one S5 assumes. */
function session(root: string, encoded: string, uuid: string, ageMs: number, now: number): void {
  const dir = join(root, encoded, uuid);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "updates.jsonl");
  // A real line carries numeric epoch SECONDS (measured: "timestamp":1787451692), not ISO.
  writeFileSync(file, `${JSON.stringify({ timestamp: Math.floor((now - ageMs) / 1000) })}\n`);
  const when = new Date(now - ageMs);
  utimesSync(file, when, when);
}

const NOW = 1_787_500_000_000;
const WT = (n: number): string => `%2FUsers%2Fp%2F.grok%2Fworktrees%2Fsrc-openclinxr%2Fissue-${n}`;

describe("the sweep sees quiet threads and counts live workers", () => {
  it.fails("(1) RED: a nested session stale for 60 min counts as quiet", () => {
    const root = mkdtempSync(join(tmpdir(), "sweep-quiet-"));
    session(root, WT(901), "aaaaaaaa-0000-0000-0000-000000000001", 60 * MIN, NOW);
    expect(
      (countQuietThreads as unknown as (base: string, now: number) => number)(root, NOW),
      "a session whose only updates.jsonl is one level deeper must still be seen; reading "
        + "<encoded>/updates.jsonl finds 0 of 2301 real files and returns 0 forever",
    ).toBe(1);
  });

  it("(2) KNOWN-GOOD COLUMN: a nested session touched 1 min ago is NOT quiet", () => {
    // Pins the other direction so clause (1) cannot be satisfied by counting every directory.
    // HONEST NOTE: this passes TODAY for the wrong reason — the blind function returns 0 for
    // everything. It becomes load-bearing the moment the injectable base lands, which is why it is
    // `it` and not a plant. Do not treat today's green as evidence of anything.
    const root = mkdtempSync(join(tmpdir(), "sweep-fresh-"));
    session(root, WT(902), "aaaaaaaa-0000-0000-0000-000000000002", 1 * MIN, NOW);
    expect(
      (countQuietThreads as unknown as (base: string, now: number) => number)(root, NOW),
      "a fresh thread is not a quiet thread",
    ).toBe(0);
  });

  it.fails("(3) RED: countLiveWorkers reports the concurrent worker count the floor needs", async () => {
    const root = mkdtempSync(join(tmpdir(), "sweep-live-"));
    session(root, WT(903), "aaaaaaaa-0000-0000-0000-000000000003", 5_000, NOW);      // live
    session(root, WT(904), "aaaaaaaa-0000-0000-0000-000000000004", 20_000, NOW);     // live
    session(root, WT(905), "aaaaaaaa-0000-0000-0000-000000000005", 45 * MIN, NOW);   // not live
    const mod = (await import("../openclaw/openclaw-sweep.js")) as unknown as {
      countLiveWorkers?: (base: string, now: number) => number;
    };
    expect(typeof mod.countLiveWorkers, "countLiveWorkers must exist for the floor to be computable")
      .toBe("function");
    expect(mod.countLiveWorkers!(root, NOW), "two worktree sessions are live within the window").toBe(2);
  });

  it.fails("(4) COUNTERWEIGHT: an unreadable root stays -1, and a non-worktree session is not a worker", async () => {
    // Refuses the cheap rewrite. Returning 0 for an unreadable root makes a broken scan and a clean
    // scan print the same line — the exact failure this card exists to remove.
    expect(
      (countQuietThreads as unknown as (base: string, now: number) => number)(
        join(tmpdir(), "sweep-does-not-exist-", String(NOW)),
        NOW,
      ),
      "an unreadable sessions root is a SECTION ERROR (-1), never 'no quiet threads' (0)",
    ).toBe(-1);

    const mod = (await import("../openclaw/openclaw-sweep.js")) as unknown as {
      countLiveWorkers?: (base: string, now: number) => number;
    };
    if (typeof mod.countLiveWorkers === "function") {
      const root = mkdtempSync(join(tmpdir(), "sweep-nonwt-"));
      // A live session in the MAIN checkout is not a worker; counting it would let the floor be
      // satisfied by the orchestrator's own thread.
      session(root, "%2FVolumes%2Ffiles%2Fsrc%2Fopenclinxr", "bbbbbbbb-0000-0000-0000-000000000001", 5_000, NOW);
      expect(mod.countLiveWorkers(root, NOW), "only worktree sessions are workers").toBe(0);
    }
  });
});
