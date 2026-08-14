import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * **14 of 60 modules spawn a portless dev server and never kill it. Four of them are the capture tools
 * this orchestrator ran all day, which is where the orphans came from.**
 *
 * Measured 2026-08-14 15:0x. Every module referencing `spawnPortlessDevServer`, classified by what it
 * actually does with the handle — **not** by whether it mentions the shared helper, which is a name
 * match and was wrong twice before this table (§7k):
 *
 *   teardown mechanism                            callers
 *   --------------------------------------------  -------
 *   stopPortlessDevServer() — SIGTERM then SIGKILL       2
 *   bare proc.kill() — no escalation                    44
 *   **none at all**                                  **14**
 *   total callers (excluding the helper itself)         60
 *
 * `#397`'s own headline says *"4 of 60 spawn callers have no teardown"*. Wrong — and I produced three
 * wrong replacements before this one, all by grepping for a symbol instead of reading the module:
 *
 *   pass  predicate                                      result
 *   ----  ---------------------------------------------  --------------------------
 *   1     grep `killProc`                                "20+" — missed proc.kill()
 *   2     classify by mechanism                          1 / 44 / 16
 *   3     same, excluding the helper file                escalating count fell to 0
 *   4     **read the module's exports**                  **2 / 44 / 14**
 *
 * `killProc` is **module-private**. The exported escalating teardown is **`stopPortlessDevServer(proc)`**
 * (`lib/portless-server.ts:254`), a thin public wrapper around it. Three of my four passes searched for
 * a symbol no caller can reach. `multi-case-runner.ts:895` and `actor-floor-contact-all-stations.ts:225`
 * call `server.proc.kill("SIGTERM")` — real teardown, no escalation.
 *
 * ## WHY THIS IS NOT COSMETIC
 *
 * The orphan is **not** the Vite process. Measured on a live instance the same day: `kill <vite pid>`
 * and even `kill -9` did nothing, because each Vite child has a live parent —
 * `pnpm --filter @openclinxr/ui-xr dev:portless`, re-parented to init (`ppid=1`). Killing the seven
 * wrappers took all seven children with them. **A leaked server therefore survives as a wrapper +
 * child pair that no pid-based cleanup of "vite" will ever find.**
 *
 * Seven of these accumulated in ~43 minutes during one worker's sweep and drove load to 67. #397
 * records six surviving in main for three days.
 *
 * ## THE KNOWN-GOOD IS 46 OF THE 60 (§9h)
 *
 * This is not a design that has never worked. Forty-six callers already tear down — two through
 * `stopPortlessDevServer`, forty-four through `proc.kill()` on the handle `spawnPortlessDevServer`
 * returns. The contract asks the remaining fourteen to do what the majority already does.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) all torn down | (2) spawns kept | (3) helper | result
 *   ----------------------------------------------------|-------------------|-----------------|------------|--------
 *   a) today                                           |     **FAIL**      |      pass       |    pass    | REFUSED
 *   b) delete the 14 callers, or their spawn calls     |       pass        |    **FAIL**     |    pass    | REFUSED
 *   c) drop the 2 escalating callers to bare-kill        |       pass        |      pass       |  **FAIL**  | REFUSED
 *   d) add teardown to the 14                          |       pass        |      pass       |    pass    | ALL PASS
 *
 * **(b) is the one to watch.** Every one of the fourteen is an evidence or capture module, and the
 * cheapest way to make a spawn stop leaking is to stop spawning. Clause (2) pins the caller count so
 * the fix cannot be a deletion.
 *
 * **(c) is why clause (3) exists.** The two escalating callers are the only ones that survive a process
 * ignoring SIGTERM; converting them to bare `proc.kill()` for "consistency" would be a regression
 * dressed as tidying.
 *
 * **NOT asserted: that every caller must use `stopPortlessDevServer`.** Forty-four bare `proc.kill()` callers are
 * accepted as-is. Consolidating them may be right and it is not this contract's business — the defect
 * is *no teardown*, not *inconsistent teardown*.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED**, failing on fourteen modules today.
 * **(2), (3) and (4) all pass today** and are true nets over quantities the fix must not move.
 *
 * NOT TESTED:
 *   - **That the 44 bare-kill callers actually reap on abnormal exit.** They have teardown; whether it
 *     fires when the parent is reaped before `finally` is unmeasured, and that is the case that
 *     produced today's orphans.
 *   - **Whether `server.proc` is always the pnpm wrapper.** Read as the wrapper handle; not confirmed
 *     across every spawn shape. If any spawn returns the Vite child instead, its teardown is a no-op.
 *   - **Process-group teardown.** `process.kill(-pgid)` would be strictly more robust than either
 *     mechanism here and nothing in the tree does it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const SPAWN = "spawnPortlessDevServer";
/** The module that defines both the spawn and the teardown — references the symbols, is not a caller. */
const HELPER = "tools/openclinxr/evidence/lib/portless-server.ts";

/** Measured 2026-08-14: 60 modules call the spawn; a fix may not shrink the population. */
const CALLER_FLOOR = 55;
/** At least one caller must keep SIGTERM→SIGKILL escalation. */
const ESCALATING_FLOOR = 1;

type Caller = { file: string; hasEscalatingStop: boolean; hasBareKill: boolean };

function callers(): Caller[] {
  const out = execFileSync("git", ["grep", "-l", SPAWN, "--", "tools", "apps", "packages"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.includes("/dist/") && l !== HELPER);
  return out.map((file) => {
    const src = readFileSync(join(REPO_ROOT, file), "utf8");
    return {
      file,
      hasEscalatingStop: /\bstopPortlessDevServer\s*\(/u.test(src),
      hasBareKill: /\.proc\.kill\s*\(|\bproc\.kill\s*\(/u.test(src),
    };
  });
}

const found = callers();

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireCallers(): Caller[] {
  expect(found.length, `modules calling ${SPAWN} (60 measured 2026-08-14, excluding the helper)`).toBeGreaterThanOrEqual(CALLER_FLOOR);
  return found;
}

describe("every dev server spawn has a teardown", () => {
  it.fails("(1) RED: every module that spawns a portless dev server also kills it", () => {
    const leaking = requireCallers()
      .filter((c) => !c.hasEscalatingStop && !c.hasBareKill)
      .map((c) => relative(REPO_ROOT, join(REPO_ROOT, c.file)));
    expect(
      leaking,
      `modules spawning a dev server with no kill path — 14 measured 2026-08-14, including model-vetting-turntable-capture and ui-xr-environment-room-capture, the tools this loop runs`,
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the spawn population is not shrunk to pass", () => {
    // Refuses (b). Every leaking module is an evidence or capture tool, and deleting the spawn — or
    // the module — is the cheapest possible green. The population is pinned against today's 61.
    expect(
      found.length,
      `callers of ${SPAWN}: ${found.length} against 61 measured 2026-08-14 (floor ${CALLER_FLOOR})`,
    ).toBeGreaterThanOrEqual(CALLER_FLOOR);
  });

  it("(3) COUNTERWEIGHT: at least one caller keeps SIGTERM→SIGKILL escalation", () => {
    // Refuses (c). Bare proc.kill() cannot reap a process that ignores SIGTERM. Deleting the one
    // escalating caller to make the codebase uniform would be a regression dressed as tidying.
    const escalating = requireCallers().filter((c) => c.hasEscalatingStop);
    expect(
      escalating.length,
      `callers using stopPortlessDevServer's SIGTERM→SIGKILL escalation (2 measured 2026-08-14)`,
    ).toBeGreaterThanOrEqual(ESCALATING_FLOOR);
  });

  it("(4) VACUITY GUARD: the classifier actually finds both teardown mechanisms", () => {
    // If either bucket is empty the classifier has stopped discriminating and clause (1) means
    // nothing — the same shape as a name-match that silently matches everything or nothing.
    const withTeardown = found.filter((c) => c.hasEscalatingStop || c.hasBareKill);
    expect(withTeardown.length, "callers with SOME teardown (46 measured 2026-08-14)").toBeGreaterThan(20);
    expect(found.filter((c) => c.hasBareKill).length, "callers using bare proc.kill()").toBeGreaterThan(20);
  });
});
