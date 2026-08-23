import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countLiveWorkers, countQuietThreads } from "../openclaw/openclaw-sweep.js";
import { measureProductLaneState } from "../openclaw/product-lane-gate.js";

/**
 * **OBSERVABLE: a session directory holding more than one uuid is read at its NEWEST uuid.**
 *
 * ## MEASURED ON HEAD 81d06dd6, 2026-08-23 — do not re-derive
 *
 * This file was filed (#593) as a discovery suite for four counters that had never been probed
 * against a known-broken input. Three of the four premises were re-measured on this head and are
 * DEAD. Only one defect reproduces, and it is the one below. The framing is therefore
 * REGRESSION-PREVENTION, not discovery, and the clauses say which is which.
 *
 *     premise (#593 as filed)   status on 81d06dd6            measured how
 *     merge blindness           FIXED by #590                 product-lane-gate.ts:93-97 passes
 *                                                             `--first-parent -m`
 *     quiet nested path         FIXED by #586                 openclaw-sweep.ts:238 walks
 *                                                             <encoded>/<uuid>/updates.jsonl
 *     stale cast literal        FIXED by #592                 `pnpm --filter @openclinxr/api test`
 *                                                             133/133; the guard is already on main
 *                                                             at a-cast-recast-does-not-red-the-api-
 *                                                             shell.test.ts:69,78 and is NOT
 *                                                             duplicated here (D1)
 *     first-vs-newest uuid      **REPRODUCES**                below
 *
 * ## THE ONE LIVE DEFECT
 *
 * `resolveSessionUpdatesPath` (openclaw-sweep.ts:236-247) returns the FIRST uuid under an encoded
 * directory that carries an `updates.jsonl`, in `readdirSync` order. It never compares mtimes. Both
 * S5 counters resolve through it, so both read whichever session happens to sort first.
 *
 * Measured against the real sessions root (~/.grok/sessions), 2026-08-23:
 *
 *     encoded session directories                              886
 *     directories holding >1 uuid WITH an updates.jsonl         181
 *     countQuietThreads  shipped 19   newest-uuid reference 20  <- DISAGREES
 *     countLiveWorkers   shipped  0   newest-uuid reference  0  <- agrees, by luck
 *
 * The single quiet-thread delta is `%2FVolumes%2Ffiles%2Fsrc%2Fopenclinxr`: its first uuid
 * (`019fc042-…`) is older than the 24h ACTIVE window and is skipped, so the directory is scored as
 * not-quiet, while its newest uuid (`01a02f34-…`) is inside the window and IS quiet.
 *
 * `countLiveWorkers` agreeing today is not evidence of health. It agrees because at this instant no
 * worktree session is live at all, so both readings are 0. When a worker is retried the retry lands
 * under a NEW uuid beside the old one, and the shipped resolver reads the abandoned first session.
 * That case cannot be produced by observation on demand — hence a fixture.
 *
 * ## WHY `readdirSync` ORDER IS THE MECHANISM AND NOT AN ACCIDENT
 *
 * Probed on this machine's tmpfs: three uuid-shaped directories created in the order
 * `01a02f34…`, `019fc042…`, `019ffffe…` come back from `readdirSync` in ASCENDING lexicographic
 * order. Session ids are uuidv7, whose leading field is a millisecond timestamp, so lexicographic
 * ascending IS oldest-first. "First in readdir" is therefore systematically the STALEST session,
 * not an arbitrary one. Every fixture below asserts that ordering as a precondition rather than
 * assuming it, so a filesystem that ordered differently fails loudly instead of passing silently.
 *
 * ## HERMETIC BY CONSTRUCTION
 *
 * Every fixture is a throwaway directory under `tmpdir()` with hand-set mtimes, and every counter
 * is called with an injected `base` and an injected `now`. Nothing here reads the real
 * `~/.grok/sessions`, the real `$HOME`, or the real git history. A fixture that needed them would
 * measure the machine instead of the instrument, and would be unrunnable the moment a worker
 * started.
 *
 * claimScope: whether the S5 session counters resolve a multi-uuid directory at its newest session,
 *   and whether the three counters repaired by #586/#590/#592 still behave as repaired.
 * notEvidenceFor: whether WORKER_FLOOR is the right floor; whether any sweep BREACH was correct;
 *   whether the quiet/live windows are the right windows; anything about #592's product assets.
 */

const NOW = Date.now();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** One session directory: how long ago its updates.jsonl was written, and its newest stamp. */
type SessionSpec = {
  uuid: string;
  /** mtime age. LIVE_WINDOW_MS is 3 min; ACTIVE_WINDOW_MS is 24h. */
  mtimeAgeMs: number;
  /** Age of the newest `timestamp` line. QUIET_WINDOW_MS is 30 min. */
  stampAgeMs: number;
};

/**
 * Builds `<base>/<encodedDir>/<uuid>/updates.jsonl` for each spec, with mtimes set by hand.
 * Returns the base so the counters can be pointed at it.
 */
function sessionsFixture(dirs: Record<string, SessionSpec[]>): string {
  const base = mkdtempSync(join(tmpdir(), "sessions-fixture-"));
  for (const [encoded, specs] of Object.entries(dirs)) {
    for (const spec of specs) {
      const dir = join(base, encoded, spec.uuid);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, "updates.jsonl");
      // Epoch SECONDS — readUpdatesFile multiplies by 1000 (openclaw-sweep.ts:271).
      writeFileSync(path, `${JSON.stringify({ timestamp: Math.floor((NOW - spec.stampAgeMs) / 1000) })}\n`);
      const mtimeSeconds = (NOW - spec.mtimeAgeMs) / 1000;
      utimesSync(path, mtimeSeconds, mtimeSeconds);
    }
  }
  return base;
}

/** Fails the fixture, not the product, if this filesystem does not hand back oldest-uuid-first. */
function assertStalestSortsFirst(base: string, encoded: string, expectedFirst: string): void {
  const order = readdirSync(join(base, encoded)).filter((n) => !n.startsWith("."));
  expect(order[0], `FIXTURE PRECONDITION: readdir must hand back ${expectedFirst} first, got ${order.join(",")}`)
    .toBe(expectedFirst);
}

/** uuidv7-shaped ids whose lexicographic order is their chronological order. */
const OLDEST = "019fc042-d8ac-7b61-9c4b-100ff041dc5d";
const MIDDLE = "019ffffe-1111-7000-8000-000000000000";
const NEWEST = "01a02f34-27ee-7d63-8134-dddb836bf801";

const WORKTREE_DIR = "%2Ftmp%2Fwt%2Fissue-593";
const MAIN_CHECKOUT_DIR = "%2FVolumes%2Ffiles%2Fsrc%2Fopenclinxr";

describe("the worker counter resolves the newest session, not the first", () => {
  it.fails("(1) RED: a retried worker is live under its NEWEST uuid, and must be counted", () => {
    // The shape observation cannot produce on demand: one worktree, three sessions, the two
    // abandoned attempts stale and the running one newest. resolveSessionUpdatesPath takes the
    // stalest, countLiveWorkers' mtime gate then `continue`s, and a running worker reads as 0.
    const base = sessionsFixture({
      [WORKTREE_DIR]: [
        { uuid: OLDEST, mtimeAgeMs: 90 * MINUTE, stampAgeMs: 90 * MINUTE },
        { uuid: MIDDLE, mtimeAgeMs: 40 * MINUTE, stampAgeMs: 40 * MINUTE },
        { uuid: NEWEST, mtimeAgeMs: 10 * 1000, stampAgeMs: 10 * 1000 },
      ],
    });
    assertStalestSortsFirst(base, WORKTREE_DIR, OLDEST);
    expect(countLiveWorkers(base, NOW), "one worktree with a live newest session is one live worker")
      .toBe(1);
  });

  it.fails("(2) RED: a quiet thread behind a long-dead first uuid is still a quiet thread", () => {
    // This is the live 19-vs-20 delta reproduced hermetically. The first uuid is outside the 24h
    // ACTIVE window so statSessionUpdates' caller skips the whole directory; the newest uuid is
    // inside the window with a stamp older than 30 min and is genuinely quiet.
    const base = sessionsFixture({
      [MAIN_CHECKOUT_DIR]: [
        { uuid: OLDEST, mtimeAgeMs: 72 * HOUR, stampAgeMs: 72 * HOUR },
        { uuid: NEWEST, mtimeAgeMs: 90 * MINUTE, stampAgeMs: 90 * MINUTE },
      ],
    });
    assertStalestSortsFirst(base, MAIN_CHECKOUT_DIR, OLDEST);
    expect(countQuietThreads(base, NOW), "the newest session is active-but-silent — one quiet thread")
      .toBe(1);
  });

  it("(3) KNOWN-GOOD COLUMN, #586 regression guard: the nested layout is read at all", () => {
    // GREEN AS A GUARD, NOT A DISCOVERY. #586 fixed a FLAT read that found 0 of 2301 real files and
    // returned 0 unconditionally. A regression to the flat layout returns 0 here. This also pins the
    // premise of clause (1): without it, (1) could be satisfied by returning 1 unconditionally.
    const base = sessionsFixture({
      [WORKTREE_DIR]: [{ uuid: NEWEST, mtimeAgeMs: 10 * 1000, stampAgeMs: 10 * 1000 }],
    });
    expect(countLiveWorkers(base, NOW), "one nested live worktree session is one live worker").toBe(1);
  });

  it("(4) KNOWN-GOOD COLUMN, #586 regression guard: a quiet nested session is counted", () => {
    // GREEN AS A GUARD, NOT A DISCOVERY. Same flat-read regression, second consumer. Pins the
    // premise of clause (2) the same way (3) pins (1).
    const base = sessionsFixture({
      [MAIN_CHECKOUT_DIR]: [{ uuid: NEWEST, mtimeAgeMs: 90 * MINUTE, stampAgeMs: 90 * MINUTE }],
    });
    expect(countQuietThreads(base, NOW), "an active-but-silent nested session is one quiet thread").toBe(1);
  });

  it("(5) COUNTERWEIGHT: two live sessions in ONE worktree are ONE worker, not two", () => {
    // Refuses the cheapest fix for (1) — "iterate every uuid and count each live one". A retried
    // worker whose abandoned attempt is ALSO recent would then read as 2 concurrent workers, and
    // the floor this counter feeds (WORKER_FLOOR) would be satisfied by one worker retried once.
    // The unit is the WORKTREE, not the session.
    const base = sessionsFixture({
      [WORKTREE_DIR]: [
        { uuid: OLDEST, mtimeAgeMs: 30 * 1000, stampAgeMs: 30 * 1000 },
        { uuid: NEWEST, mtimeAgeMs: 10 * 1000, stampAgeMs: 10 * 1000 },
      ],
    });
    expect(countLiveWorkers(base, NOW), "one worktree is one worker however many sessions it holds")
      .toBe(1);
  });

  it("(6) COUNTERWEIGHT: the orchestrator's own live thread is not a worker", () => {
    // Refuses the second cheap fix for (1) — dropping the `%2Fissue-\d+$` filter so that "some
    // session is live" satisfies the floor. The main checkout is live essentially always; without
    // this the counter would report >=1 worker with no worker dispatched.
    const base = sessionsFixture({
      [MAIN_CHECKOUT_DIR]: [{ uuid: NEWEST, mtimeAgeMs: 5 * 1000, stampAgeMs: 5 * 1000 }],
    });
    expect(countLiveWorkers(base, NOW), "a live main-checkout session is not a dispatched worker").toBe(0);
  });

  it("(7) #590 regression guard: a merge behind newer commits still resets the clock", () => {
    // GREEN AS A GUARD, NOT A DISCOVERY. #590 taught the lane gate to pass `--first-parent -m`.
    // the-lane-gate-sees-what-a-merge-carried.test.ts covers merge-as-NEWEST-commit; this covers the
    // case that file does not — a merge with evidence commits stacked on top, which is the shape
    // every real window has. A regression to bare --name-only reads the merge as touching nothing
    // and keeps walking past it, inflating the count and naming a commit behind the merge.
    const root = mkdtempSync(join(tmpdir(), "lane-merge-behind-"));
    const git = (args: string[]): string =>
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
      });
    const write = (rel: string, body: string): void => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), body);
    };
    git(["init", "-q", "-b", "main"]);
    write("seed.txt", "seed");
    git(["add", "-A"]);
    git(["commit", "-qm", "seed"]);
    git(["checkout", "-q", "-b", "wt/slice"]);
    write("packages/openclinxr/thing.ts", "carried by the merge");
    git(["add", "-A"]);
    git(["commit", "-qm", "slice work"]);
    git(["checkout", "-q", "main"]);
    git(["merge", "--no-ff", "--no-edit", "-q", "wt/slice"]);
    for (let i = 0; i < 2; i += 1) {
      write("tools/openclinxr/evidence/probe.ts", `probe ${i}`);
      git(["add", "-A"]);
      git(["commit", "-qm", `evidence ${i}`]);
    }
    const state = measureProductLaneState(root);
    expect(state.evidenceOnlyCommits, "exactly the two evidence commits stacked above the merge").toBe(2);
    expect(state.lastProductCommit?.subject ?? "", "the reset must name the merge, not a commit behind it")
      .toMatch(/Merge/u);
  });
});
