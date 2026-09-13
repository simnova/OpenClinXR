import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countLiveWorkers } from "../../openclaw/openclaw-sweep.js";

/**
 * `countLiveWorkers` is BLIND to every worker this fleet currently runs.
 *
 * MEASURED 2026-09-13 against `openclaw-sweep.ts:391`:
 *
 *     const worktreeRe = /%2Fissue-\d+$/u;
 *     for (const dir of dirs) { if (!worktreeRe.test(dir)) continue; ... }
 *
 * Every worker dispatched through the board runs in a worktree named `bothy-tsk_<id>` --
 * `dispatch-card.mts` passes `slice: bothy-<taskId>` and `resolveWorkerWorktree` names the
 * directory after the slice. Tonight's four workers all ran in `bothy-tsk_*`. None of them can
 * match `%2Fissue-\d+$`, so the counter returns 0 WHILE WORKERS ARE RUNNING, and that zero is
 * what `openclaw-sweep.ts:451` hands to `liveWorkers` beside `workerFloor`.
 *
 * WHY THIS IS NOT COSMETIC. A floor comparison against a counter that reads 0 during full
 * occupancy cannot distinguish "no workers" from "every worker invisible". Any admission or
 * scaling decision built on it reads the fleet as permanently idle. This is the first of the four
 * instruments named dead or blind in the parallelism mechanism review, and it is the only one
 * whose repair is a single predicate.
 *
 * THE FIX IS A WIDENING, NEVER A REMOVAL, AND CLAUSE (4) IS WHY.
 * `the-worker-counter-resolves-the-newest-session-not-the-first.test.ts:190` already refuses
 * dropping the filter: the orchestrator's own main-checkout session is live essentially always,
 * so a counter with no worktree predicate reports >= 1 worker with nothing dispatched. The
 * predicate must accept `issue-<n>` AND `bothy-tsk_<id>` and still reject the main checkout.
 *
 * Diagnosis header IMMUTABLE. Flip `it.fails` to `it` and append a `## FIXED` block below; do not
 * rewrite the paths or numbers above.
 *
 * claimScope: what `countLiveWorkers` returns for a controlled sessions fixture whose worktree
 *   directories are named the way the board dispatcher names them.
 * notEvidenceFor: whether WORKER_FLOOR is the right floor, whether any sweep BREACH was correct,
 *   the quiet/live window durations, or anything about dispatch admission policy.
 */

const NOW = Date.now();

type SessionSpec = { uuid: string; mtimeAgeMs: number; stampAgeMs: number };

/** Same construction as the shipped counter tests: nested `<base>/<encoded>/<uuid>/updates.jsonl`. */
function sessionsFixture(dirs: Record<string, SessionSpec[]>): string {
  const base = mkdtempSync(join(tmpdir(), "bothy-counter-fixture-"));
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

const LIVE = { uuid: "01a02f34-27ee-7d63-8134-dddb836bf801", mtimeAgeMs: 10 * 1000, stampAgeMs: 10 * 1000 };
const ALSO_LIVE = { uuid: "019ffffe-1111-7000-8000-000000000000", mtimeAgeMs: 30 * 1000, stampAgeMs: 30 * 1000 };

/** The shape the board dispatcher actually produces. */
const BOTHY_DIR = "%2FUsers%2Fp%2F.grok%2Fworktrees%2Fsrc-openclinxr%2Fbothy-tsk_5c7522f291d4fae0";
/** The legacy shape, which must keep counting. */
const ISSUE_DIR = "%2FUsers%2Fp%2F.grok%2Fworktrees%2Fsrc-openclinxr%2Fissue-593";
/** The orchestrator's own checkout, which must never count. */
const MAIN_CHECKOUT_DIR = "%2FVolumes%2Ffiles%2Fsrc%2Fopenclinxr";

describe("the worker counter sees bothy card worktrees", () => {
  it.fails("(1) RED: a live worker in a bothy-tsk_ worktree is one live worker", () => {
    // Today: the regex rejects the directory outright, so this reads 0 with a worker running.
    const base = sessionsFixture({ [BOTHY_DIR]: [LIVE] });
    expect(countLiveWorkers(base, NOW), "a dispatched board worker is a live worker").toBe(1);
  });

  it.fails("(2) RED: two live sessions in ONE bothy worktree are ONE worker", () => {
    // Pairs with (1) so the cheapest repair -- counting sessions rather than worktrees -- cannot
    // satisfy the RED. A retried worker whose abandoned attempt is also recent must read as 1.
    const base = sessionsFixture({ [BOTHY_DIR]: [ALSO_LIVE, LIVE] });
    expect(countLiveWorkers(base, NOW), "one worktree is one worker however many sessions it holds").toBe(1);
  });

  it("(3) KNOWN-GOOD COLUMN: the legacy issue-<n> worktree still counts", () => {
    // GREEN TODAY, AND MUST STAY GREEN. The repair is a widening; a predicate that swapped
    // issue-<n> for bothy-tsk_ would trade one blindness for another and still pass clause (1).
    const base = sessionsFixture({ [ISSUE_DIR]: [LIVE] });
    expect(countLiveWorkers(base, NOW), "an issue-numbered worktree is still one live worker").toBe(1);
  });

  it("(4) COUNTERWEIGHT: the orchestrator's own live thread is still not a worker", () => {
    // GREEN TODAY, AND MUST STAY GREEN. Refuses the cheapest repair of all -- deleting the
    // predicate. The main checkout is live essentially always, so a filterless counter reports a
    // worker with nothing dispatched. Mirrors clause (6) of
    // the-worker-counter-resolves-the-newest-session-not-the-first.test.ts:190.
    const base = sessionsFixture({ [MAIN_CHECKOUT_DIR]: [LIVE] });
    expect(countLiveWorkers(base, NOW), "the orchestrator's own session is not a dispatched worker").toBe(0);
  });
});
