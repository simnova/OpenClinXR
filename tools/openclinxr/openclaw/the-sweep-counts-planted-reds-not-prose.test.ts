import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: the loop enumerates unfinished work before it selects work.
 *
 * MEASURED 2026-08-22, do not re-derive. The superagent diagnosed the loop's missing step:
 *
 *   "Your tick enumerates STATES (harvest -> killed-check -> collision-check) and then calls a
 *    selector. Nothing in the pipeline ever builds the candidate list from the world. Sweep is an
 *    ENUMERATION step, and there is no enumeration step."
 *
 * In one hour the operator found four pieces of unfinished work the loop had not: lip-sync recorded as
 * "on hold" when 8 cards were closed and 1 open; eyebrows/lashes/teeth/tongue already done (#542); a
 * Rhubarb lane assigned and never dispatched; an IWSDK release we were already pinned to. All four are
 * queries, not judgement.
 *
 * THE COUNTER MUST NOT BE A NAIVE GREP — measured, and I walked into it myself:
 *
 *   grep -c 'it\.fails('  a-live-rule-refuses-an-unflipped-plant.test.ts  -> 1   FALSE POSITIVE
 *   live:                 a-live-rule-refuses-an-unflipped-plant.test.ts  -> GREEN, 0 remaining
 *
 * That file DOCUMENTS the marker in prose, so a regex over raw source counts its own header. The
 * correct instrument already ships: `countPlantedItFails` behind the `live:` rule (#570), which strips
 * comments and string bodies before matching. A sweep that over-counts trains the reader to discount
 * it, which is exactly how the pulse's own alarm went unheard for nine hours.
 *
 * KNOWN-GOOD / KNOWN-BAD PAIR, both real files on main:
 *   GREEN by live:, false-positive by grep  -> a-live-rule-refuses-an-unflipped-plant.test.ts
 *   GENUINELY 3 unflipped                   -> shoulder-raycast-coverage.test.ts
 *
 * claimScope: whether a sweep entry point exists and whether its RED count uses the comment/string-
 * stripping counter rather than a raw regex.
 * notEvidenceFor: the other four sweep queries (S2-S5), the SWEEP report line, or whether anyone reads it.
 */

const ROOT = join(import.meta.dirname, "../../..");
const PROSE_FILE = "packages/openclinxr/agent-loop/src/a-live-rule-refuses-an-unflipped-plant.test.ts";
const REAL_REDS = "tools/openclinxr/evidence/shoulder-raycast-coverage.test.ts";

const naiveGrepCount = (rel: string): number =>
  (readFileSync(join(ROOT, rel), "utf8").match(/\bit\.fails\(/gu) ?? []).length;

describe("the sweep counts planted REDs, not prose", () => {
  it("(0) VACUITY GUARD: the known-good/known-bad pair both ship and differ", () => {
    // Without this, (2) could pass by either fixture vanishing rather than by the counter being right.
    expect(existsSync(join(ROOT, PROSE_FILE)), "the prose-documenting plant must ship").toBe(true);
    expect(existsSync(join(ROOT, REAL_REDS)), "the genuinely-red plant must ship").toBe(true);
    expect(naiveGrepCount(PROSE_FILE), "the prose file must still trip a naive grep, or this test is moot")
      .toBeGreaterThan(0);
  });

  it("(1) RED: a sweep entry point exists and reports the unfinished inventory", async () => {
    const mod = await import("./openclaw-sweep.js") as Record<string, unknown>;
    const fn = mod["summariseUnfinishedInventory"];
    expect(
      typeof fn,
      "tools/openclinxr/openclaw/openclaw-sweep.ts does not export summariseUnfinishedInventory() — "
        + "the loop has no enumeration step, which is the whole defect",
    ).toBe("function");
    const out = await (fn as (root: string) => Promise<Record<string, unknown>>)(ROOT);
    for (const k of ["reds", "oldestRedId", "undispatchable", "uncarded", "quietThreads"]) {
      expect(out, `the inventory must report ${k}`).toHaveProperty(k);
    }
  });

  it("(2) RED + COUNTERWEIGHT: the RED count strips prose, and still finds the real ones", async () => {
    // Refuses the cheap fix: shelling out to grep. The prose file must NOT be counted; the genuinely
    // red file must be. A counter that returns 0 for both, or N for both, fails here.
    const mod = await import("./openclaw-sweep.js") as Record<string, unknown>;
    const count = mod["plantedRedCount"] as ((root: string, rel: string) => number) | undefined;
    expect(typeof count, "the sweep must expose its per-file counter for verification").toBe("function");
    expect(count!(ROOT, PROSE_FILE), `${PROSE_FILE} documents it.fails in prose and has none remaining`).toBe(0);
    expect(count!(ROOT, REAL_REDS), `${REAL_REDS} genuinely carries unflipped clauses`).toBeGreaterThanOrEqual(3);
  });

  it("(3) COUNTERWEIGHT: the naive instrument really does disagree — the defect is not hypothetical", () => {
    // Pins the reason clause (2) exists. If a future edit removes the prose, this fails and clause (2)
    // becomes vacuous — that is the signal to re-pick the fixture, not to weaken the counter.
    expect(
      naiveGrepCount(PROSE_FILE),
      "a raw regex over the prose file counts its own documentation — this is the measured false positive",
    ).toBeGreaterThanOrEqual(1);
  });
});

/**
 * ## FIXED (#584)
 *
 * Both REDs flipped to live `it()` after `tools/openclinxr/openclaw/openclaw-sweep.ts` landed:
 *
 * - (1) imports the module, finds all five keys, and `summariseUnfinishedInventory(ROOT)`
 *   resolves in ~850 ms (S1 walk + S2 gh + S3 git log + S4 npm + S5 sessions, parallelised).
 * - (2) `plantedRedCount(ROOT, PROSE_FILE)` = 0 (stripper holds) and
 *   `plantedRedCount(ROOT, REAL_REDS)` = 3 (>= 3 required). The naive grep still counts the
 *   prose file (clause 3 unchanged), so the counter is doing real work.
 *
 * Measured traps fixed on the way, recorded in openclaw-sweep.ts's header: gh ANSI-decorates
 * JSON under FORCE_COLOR (parse failed until NO_COLOR + strip); node_modules vendored tests
 * poisoned the S3 walk (1449 junk hits); worktree mtimes are checkout times, so S3 uses
 * `git log --diff-filter=A` instead.
 */
