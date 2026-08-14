import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **WITHDRAWN AND RE-PLANTED 2026-08-14 15:5x. The previous RED here — "14 of 60 modules spawn a
 * portless dev server and never kill it" — was FALSE, and it was mine.**
 *
 * A dispatched worker refused to satisfy it and was right to. Verified against the tree afterwards:
 *
 *   - **`model-vetting-turntable-capture.ts` never calls `spawnPortlessDevServer`.** Line 50 only
 *     mentions it in a comment recommending it. It spawns its own server and tears it down through
 *     `stopServer()` -> `server.kill("SIGTERM")` (`:273`).
 *   - `ui-xr-environment-room-capture.test.ts`, `browser-boot-inventory.ts` and
 *     `isolated-subject-harness.test.ts` reference the symbol **only in prose** — docstrings saying
 *     "reuse `spawnPortlessDevServer`" or "64 files call `spawnPortlessDevServer`".
 *   - Nine of the fourteen already tear down under a different spelling (`server.kill(`,
 *     `stopServer(`), which the old classifier did not look for.
 *
 * **The population was defined by `git grep -l` on a symbol name, so it counted comments.**
 * `browser-boot-inventory.ts:24` warns about this exact trap in its own header — *"literals so prose
 * like 'Prefer spawnPortlessDevServer() ...' does not count"* — and I walked into a hole the tree had
 * signposted. Six counts were published on #397 (one in the issue, five mine) before this one.
 *
 * ## WHAT THE WORKER FOUND THAT ACTUALLY EXPLAINS THE ORPHANS
 *
 * > *"the observed orphans came from parents reaped before their `finally` ran, which no in-process
 * > teardown call fixes."*
 *
 * That matches the incident exactly: seven wrappers accumulated in ~43 minutes when **I** killed a
 * worker's runaway `vitest run tools/` sweep. Its `finally` never executed. Adding teardown calls to
 * more callers would not have prevented a single one of them.
 *
 * **Per-caller teardown is therefore the wrong layer.** The orphan is the `pnpm ... dev:portless`
 * wrapper re-parented to init (`ppid=1`) — measured live: `kill` and `kill -9` on the Vite pid did
 * nothing, and killing the wrappers took all seven children with them.
 *
 * ## THE RE-PLANTED DEFECT — the helper has no orphan protection at all
 *
 * Measured on `lib/portless-server.ts`: **zero** occurrences of `ppid`, `orphan`, `sweep`, `pgid` or
 * `detached`. Nothing detects a pre-existing orphan, nothing spawns into its own process group, and
 * nothing can reap a wrapper whose parent died. Six survived three days in main (#397's original
 * report); seven accumulated in 43 minutes here.
 *
 * A spawn cannot guarantee its own cleanup when its parent is SIGKILLed — on macOS there is no
 * `PR_SET_PDEATHSIG`. **What it can do is refuse to accumulate**: sweep pre-existing `dev:portless`
 * wrappers with `ppid=1` before spawning a new one. That converts an unbounded leak into at most one.
 *
 * ## NO KNOWN-GOOD EXISTS IN THIS TREE, AND THAT IS ITSELF THE FINDING (SS9h)
 *
 * Every other contract planted today had a known-good column — the child's hem against aisha's, the
 * nurse's palette against the parent's. **There is none here.** No module in the repo sweeps orphans
 * or uses process-group teardown, so the bound is derived from the mechanism rather than observed
 * from a working example. Stated rather than papered over.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                         | (1) sweeps | (2) spares live | (3) wrapper | result
 *   ---------------------------------------------------|------------|-----------------|-------------|--------
 *   a) today — no sweep at all                        |  **FAIL**  |      pass       |    pass     | REFUSED
 *   b) kill every `dev:portless` process              |    pass    |    **FAIL**     |    pass     | REFUSED
 *   c) sweep by matching `vite` instead of the wrapper |    pass    |      pass       |  **FAIL**   | REFUSED
 *   d) select wrappers whose ppid is 1                 |    pass    |      pass       |    pass     | ALL PASS
 *
 * **(b) is the one to watch.** A blanket `pkill -f dev:portless` is the obvious one-liner and it kills
 * the server of any capture currently running — including a concurrent worker's. SS11f records that
 * exact mistake costing a live dispatch. Clause (2) requires a wrapper with a live parent to survive.
 *
 * **(c) is why clause (3) exists.** Matching `vite` is the intuitive target and is measurably useless:
 * the Vite child has a live parent that immediately outlives the kill, which is why `kill -9` on it
 * did nothing.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED** — the surface does not exist.
 * **(2) and (3) also fail today** because they interrogate that absent surface; they are what stops
 * (1) being satisfied by a blanket kill. **(4) passes today** — it reads the fixture, not the surface.
 *
 * NOT TESTED:
 *   - **That sweeping prevents the leak.** It bounds accumulation to one; it cannot stop a SIGKILLed
 *     parent from orphaning its child in the first place.
 *   - **Process-group teardown** (`process.kill(-pgid)`), which nothing in the tree uses and which
 *     would be strictly stronger than a sweep. Deliberately not required here — one mechanism per slice.
 *   - **The 53 callers' own teardown.** They tear down on the normal path; whether each fires on the
 *     throw path is unmeasured and is not this contract's subject.
 *   - **Non-macOS behaviour.** `PR_SET_PDEATHSIG` would make this moot on Linux.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const HELPER = join(REPO_ROOT, "tools/openclinxr/evidence/lib/portless-server.ts");
/** Computed so TypeScript cannot resolve a not-yet-exported symbol at compile time (#383/#352). */
const SPECIFIER = ["./lib/portless", "server.js"].join("-");

/** One process row as `ps -eo pid,ppid,command` would yield it. */
type ProcRow = { pid: number; ppid: number; command: string };

/** Two orphaned wrappers (ppid=1), one live wrapper, one Vite child with a live parent. */
const FIXTURE: ProcRow[] = [
  { pid: 21940, ppid: 1, command: "pnpm --filter @openclinxr/ui-xr dev:portless" },
  { pid: 23448, ppid: 1, command: "pnpm --filter @openclinxr/ui-xr dev:portless" },
  { pid: 30001, ppid: 29999, command: "pnpm --filter @openclinxr/ui-xr dev:portless" },
  { pid: 22149, ppid: 21940, command: "node .../vite/bin/vite.js --host 127.0.0.1 --port 50899" },
];
const ORPHANS = [21940, 23448];
const LIVE_WRAPPER = 30001;
const VITE_CHILD = 22149;

async function loadSweeper(): Promise<((rows: readonly ProcRow[]) => number[]) | null> {
  if (!existsSync(HELPER)) return null;
  try {
    const mod = (await import(SPECIFIER)) as {
      selectOrphanedDevServerPids?: (rows: readonly ProcRow[]) => number[];
    };
    return mod.selectOrphanedDevServerPids ?? null;
  } catch {
    return null;
  }
}

const sweep = await loadSweeper();

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireSweeper(): NonNullable<typeof sweep> {
  expect(
    sweep,
    `lib/portless-server.ts must export selectOrphanedDevServerPids(rows) — today the module contains zero occurrences of ppid, orphan, sweep, pgid or detached`,
  ).not.toBeNull();
  return sweep as NonNullable<typeof sweep>;
}

describe("the dev server spawn refuses to accumulate orphans", () => {
  it.fails("(1) RED: orphaned dev:portless wrappers are selectable", () => {
    const selected = requireSweeper()(FIXTURE);
    expect(
      [...selected].sort((a, b) => a - b),
      `wrappers with ppid=1 are the orphans; both must be selected`,
    ).toEqual(ORPHANS);
  });

  it.fails("(2) COUNTERWEIGHT: a wrapper with a live parent is spared", () => {
    // Refuses (b). `pkill -f dev:portless` is the obvious one-liner and it kills the server of any
    // capture running concurrently — SS11f records that exact mistake killing a live dispatch.
    const selected = requireSweeper()(FIXTURE);
    expect(selected, `pid ${LIVE_WRAPPER} has a live parent and belongs to a running capture`).not.toContain(
      LIVE_WRAPPER,
    );
  });

  it.fails("(3) COUNTERWEIGHT: the Vite child is never targeted directly", () => {
    // Refuses (c). Measured live 2026-08-14: kill and kill -9 on the Vite pid did nothing, because its
    // wrapper parent was alive. Killing the wrappers took all seven children with them.
    const selected = requireSweeper()(FIXTURE);
    expect(selected, `pid ${VITE_CHILD} is a Vite child — killing it is measurably a no-op`).not.toContain(
      VITE_CHILD,
    );
  });

  it("(4) VACUITY GUARD: the fixture contains both classes, so the selector can discriminate", () => {
    // Reads the fixture, not the absent surface, so it passes today and keeps passing: if someone
    // later trims the fixture to only orphans, clauses (2) and (3) become unfalsifiable.
    expect(FIXTURE.filter((r) => r.ppid === 1).length, "orphaned wrappers in the fixture").toBe(2);
    expect(FIXTURE.filter((r) => r.ppid !== 1).length, "non-orphan rows in the fixture").toBe(2);
    expect(
      readFileSync(HELPER, "utf8").length,
      "the helper module is readable, so the absence of a sweep is a real absence",
    ).toBeGreaterThan(0);
  });
});
