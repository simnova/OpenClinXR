import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * # THE DEFECT, MEASURED 2026-08-19 on main 559c033a — do not re-derive these counts
 *
 * #397 fixed dev-server teardown IN THE HELPER and left the callers behind. The fix landed
 * three mechanisms in `lib/portless-server.ts`:
 *
 *   1. GROUP KILL   — spawn `detached: true` so the pnpm wrapper leads its own process group,
 *                     and signal `-pgid`, because "`proc.kill("SIGTERM")` signalled the pnpm
 *                     wrapper only; the signal never reached the Vite child" (#397's own header).
 *   2. AWAITED EXIT — teardown waits for the wrapper to actually exit.
 *   3. REJECT       — `stopPortlessDevServer` THROWS if the wrapper is still alive after
 *                     SIGTERM+SIGKILL, so a teardown can fail instead of printing into the void.
 *
 * **1 of 51 real spawn sites gets all three.**
 *
 * ## THE POPULATION, CLASSIFIED PROPERLY
 *
 * A bare `git grep -l` on the symbol counts docstrings. The withdrawn header in
 * `every-dev-server-spawn-has-a-teardown.test.ts` records that exact trap costing a whole
 * slice ("the population was defined by `git grep -l` on a symbol name, so it counted
 * comments"). This contract strips block and line comments first, then counts only files
 * containing a REAL `spawnPortlessDevServer(` invocation.
 *
 *   72  files mention the symbol
 *   51  contain a real call            21  are prose-only (docstrings, JSON evidence records)
 *
 * Of the 51:
 *
 *   route                                              | files | group kill | awaited | rejects
 *   ---------------------------------------------------|------:|:----------:|:-------:|:-------:
 *   `server.proc.kill("SIGTERM")` hand-rolled          |  47   |     NO     |   NO    |   NO
 *   `stopPortlessDevServer(server)`  — HANDLE          |   2   |     NO     |   NO    |   NO
 *   `stopPortlessDevServer(server.proc)` — correct     |   1   |    yes     |   yes   |   yes
 *
 * 57 occurrences of `server.proc.kill("SIGTERM")` across those 47 files.
 *
 * ## THE HANDLE CASE IS WORSE THAN THE HAND-ROLLED ONE, AND IT LOOKS CORRECT
 *
 * `clinical-touch-smoke.ts:393` and `humanoid-vision-score.ts:911` call the fixed helper and
 * pass the `PortlessDevServer` HANDLE where a `ChildProcess` is required. Traced through
 * `killProc` (`lib/portless-server.ts:198-210`) with the handle as the argument:
 *
 *   handle.exitCode            === undefined
 *   handle.exitCode !== null   === true    -> killProc RETURNS AT LINE 200, signalling nothing
 *   handle.exitCode === null   === false   -> stopPortlessDevServer does NOT throw
 *
 * So the reject-if-alive guard — the whole point of mechanism (3) — is bypassed by the type
 * error it was built to catch. **It is a silent no-op that reports success.** Two callers
 * that read as fixed tear down nothing.
 *
 * ## THE KNOWN-GOOD COLUMN IS EXACTLY ONE FILE, AND THAT IS ITSELF THE FINDING (SS9h)
 *
 * `garment-class-sheet.ts:274` — `if (server) await stopPortlessDevServer(server.proc);` — is
 * the only site in the repo that gets group kill, awaited exit and rejection. Clause (5)
 * asserts it, so if a later edit blinds the classifier this file goes red rather than vacuous.
 * There is no second example to cross-check against; stated rather than papered over.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today                                           |FAIL |FAIL |pass |pass | REFUSED
 *   b) delete the kill line at each of the 47 sites    |pass |FAIL |pass |**FAIL**| REFUSED
 *   c) rename the call but keep signalling the wrapper |**FAIL**|FAIL|pass|pass | REFUSED
 *   d) relax the helper so the handle shape "works"    |pass |pass |**FAIL**|pass| REFUSED
 *   e) route all 51 through the helper with `.proc`    |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the obvious one and it is the reason clause (4) exists.** Deleting 57 lines makes
 * clause (1) green in one pass and leaves 47 dev servers with no teardown at all — strictly
 * worse than today, and #397's original report was six orphans surviving three days in main.
 *
 * **(d) is the subtle one.** Making `killProc` tolerate a handle would green clause (2) by
 * weakening the mechanism that catches the mistake. Clause (3) pins all three mechanisms in
 * the helper source so the fix cannot be moved backwards into it.
 *
 * ## DESTRUCTIVE PROBE, RUN 2026-08-19 — the substitution MATCHED
 *
 * Planted row (b) on one file: deleted the single `server.proc.kill("SIGTERM")` line from
 * `idle-arm-hang.ts`, re-ran, reverted with `git checkout --` (tracked file, SS11a).
 *
 *   before: 2 failed | 3 passed   clause (1) reports 57 occurrences across 47 files
 *   after:  3 failed | 2 passed   clause (1) reports 56 occurrences across 46 files
 *                                 clause (4) FIRES, naming exactly the stripped file
 *
 * Two things confirmed, not assumed. Deleting the line genuinely moves clause (1) toward
 * green — so (b) is a real path a worker could take, not a strawman. And clause (4) catches
 * it on the first file, with the offender named. The counterweight is load-bearing.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1) is a RED — 57 occurrences across 47 files exist today.
 *   (2) is a RED — 2 of the 3 helper callers pass the handle today.
 *   (3) PASSES TODAY — it reads the helper, which is already fixed. Pure net against (d).
 *   (4) PASSES TODAY — every one of the 51 tears down by SOME spelling. Pure net against (b).
 *   (5) PASSES TODAY — it reads the one known-good site and the classifier's own inputs.
 *
 * NOT TESTED:
 *   - **That any of the 51 currently leaks.** The historical evidence is six orphans in three
 *     days (#397) and seven in 43 minutes; no leak was reproduced for this contract and none
 *     is required. This asserts the ROUTE, not an observed orphan.
 *   - Whether each site's teardown fires on the THROW path as well as the normal path.
 *     A `finally` audit is a different slice.
 *   - Non-macOS behaviour. `PR_SET_PDEATHSIG` would make the orphan class moot on Linux.
 *   - The 21 prose-only mentions. They are docstrings and JSON; nothing to route.
 *
 * ## FIXED (#443, 2026-08-19) — all 51 real spawn sites now go through the fixed helper
 *
 * Re-measured after the sweep (this test's own classifier, same logic):
 *
 *   route                                              | files | group kill | awaited | rejects
 *   ---------------------------------------------------|------:|:----------:|:-------:|:-------:
 *   `stopPortlessDevServer(server.proc)` — correct     |  51   |    yes     |   yes   |   yes
 *
 *   0 occurrences of `.proc.kill(` across 0 files (was 57 across 47).
 *   0 helper callers passing a handle (was 2: clinical-touch-smoke.ts:393,
 *   humanoid-vision-score.ts:911 — both now pass `server.proc`).
 *   The known-good column (`garment-class-sheet.ts:274`) is unchanged.
 *
 * What changed per site: `server.proc.kill("SIGTERM")` → `await
 * stopPortlessDevServer(server.proc)`, inside the site's existing `finally`
 * (no second teardown added). Every enclosing function was already async, so
 * the call is awaited; sites whose cleanup pre-existed as a best-effort
 * `try { … } catch { /* ignore *\/ }` kept that wrapper (behaviour-preserving).
 * The two handle callers were one-token fixes. Imports gained
 * `stopPortlessDevServer` next to the existing `spawnPortlessDevServer`.
 *
 * The only edit to this file's code is the clause (2) message template: the
 * message now renders the helper name from a constant (`HELPER_FN`) so the
 * classifier does not match its own source — the assertion logic is unchanged.
 * The diagnosis and measured tables above remain the record — not deleted.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const HELPER_REL = "tools/openclinxr/evidence/lib/portless-server.ts";

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//gu;
const LINE_COMMENT = /^[ \t]*\/\/.*$/gmu;

/** Comment-stripped source. A symbol in a docstring is not a call site (the #397 trap). */
function codeOf(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8").replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
}

/** Every tracked file that mentions the symbol at all — prose included; filtered below. */
function candidateFiles(): string[] {
  const out = execFileSync("git", ["grep", "-l", "spawnPortlessDevServer", "--", "tools", "apps", "packages"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.includes("node_modules") && !l.includes("/dist/"))
    .map((l) => relative(".", l));
}

/** Files with a REAL invocation, excluding the helper itself (it defines, it does not consume). */
function realSpawnSites(): { rel: string; code: string }[] {
  return candidateFiles()
    .filter((rel) => rel !== HELPER_REL)
    .map((rel) => ({ rel, code: codeOf(rel) }))
    .filter((f) => f.code.includes("spawnPortlessDevServer("));
}

const sites = realSpawnSites();

/** SS7t: an empty population must FAIL, never pass vacuously. */
function requireSites(): { rel: string; code: string }[] {
  expect(sites.length, "the classifier found no real spawn sites — it is measuring nothing").toBeGreaterThan(10);
  return sites;
}

/** `server.proc.kill(...)` / `<handle>.proc.kill(...)` — the pre-#397 wrapper-only signal. */
const HANDROLLED_KILL = /\.proc\.kill\s*\(/gu;
/** A `stopPortlessDevServer(x)` call; group 1 is the argument expression. */
const HELPER_CALL = /stopPortlessDevServer\s*\(\s*([^),]*)/gu;
/** Any teardown route at all — clause (4) accepts every spelling, it only refuses NONE. */
const ANY_TEARDOWN = /\.kill\s*\(|stopPortlessDevServer\s*\(|stopServer\s*\(/u;
/** Helper name rendered into clause (2)'s message. Kept in a constant so the classifier
 * (which scans this file's own comment-stripped source) does not match its own template. */
const HELPER_FN = "stopPortlessDevServer";

describe("every dev-server teardown goes through the fixed helper", () => {
  it("(1) RED: no site signals the wrapper directly", () => {
    const offenders: string[] = [];
    let occurrences = 0;
    for (const { rel, code } of requireSites()) {
      const hits = code.match(HANDROLLED_KILL);
      if (hits) {
        offenders.push(rel);
        occurrences += hits.length;
      }
    }
    expect(
      offenders,
      `${String(occurrences)} occurrence(s) of a direct wrapper signal across ${String(offenders.length)} file(s). `
        + `#397 measured that this signals the pnpm wrapper only and never reaches the Vite child. `
        + `Route each through stopPortlessDevServer(server.proc) — do NOT delete the teardown (clause 4 refuses that)`,
    ).toEqual([]);
  });

  it("(2) RED: every helper call passes the PROC, never the handle", () => {
    // clinical-touch-smoke.ts:393 and humanoid-vision-score.ts:911 pass the handle today.
    // killProc:200 reads `proc.exitCode !== null`; on a handle that is `undefined !== null` ===
    // true, so it returns having signalled nothing, and stopPortlessDevServer's
    // `exitCode === null` reject is likewise false. A silent no-op that reports success.
    const wrong: string[] = [];
    for (const { rel, code } of requireSites()) {
      for (const m of code.matchAll(HELPER_CALL)) {
        const arg = (m[1] ?? "").trim();
        if (arg.length === 0) continue;
        if (!/\.proc\b/u.test(arg)) wrong.push(`${rel}: ${HELPER_FN}(${arg})`);
      }
    }
    expect(
      wrong,
      `a PortlessDevServer handle where a ChildProcess is required — killProc returns at line 200 and the reject guard cannot fire`,
    ).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the helper still carries all three #397 mechanisms", () => {
    // Refuses (d). Greening clause (2) by teaching killProc to accept a handle would weaken
    // the exact guard that catches the mistake. Pin the mechanisms in the source.
    const helper = readFileSync(join(REPO_ROOT, HELPER_REL), "utf8");
    expect(helper, "group leadership: the wrapper must be spawned detached").toMatch(/detached:\s*true/u);
    expect(helper, "group kill: teardown must signal the negative pgid").toMatch(/-\s*pgid|\(-pid|-pid\b/u);
    expect(helper, "awaited exit").toMatch(/waitForExit/u);
    expect(helper, "SIGKILL escalation").toMatch(/SIGKILL/u);
    expect(helper, "reject-if-alive: a teardown must be able to FAIL").toMatch(/still alive after SIGTERM\+SIGKILL/u);
  });

  it("(4) COUNTERWEIGHT: no site is left with no teardown at all", () => {
    // Refuses (b). Deleting the 57 kill lines greens clause (1) in one pass and leaves 47 dev
    // servers unreaped — strictly worse than today. #397's report was six orphans over three days.
    const naked = requireSites()
      .filter(({ code }) => !ANY_TEARDOWN.test(code))
      .map(({ rel }) => rel);
    expect(naked, `spawns a dev server and never tears it down by any route`).toEqual([]);
  });

  it("(5) KNOWN-GOOD: the one correct site exists and the classifier can discriminate", () => {
    // There is exactly ONE fully-correct site in the repo (SS9h: no second example exists).
    const all = requireSites();
    const correct = all.filter(({ code }) =>
      [...code.matchAll(HELPER_CALL)].some((m) => /\.proc\b/u.test((m[1] ?? "").trim())),
    );
    expect(correct.map((c) => c.rel), "the known-good column must remain in the population").toContain(
      "tools/openclinxr/evidence/garment-class-sheet.ts",
    );
    // The classifier must see BOTH classes, or clauses (1)/(2) are unfalsifiable.
    expect(candidateFiles().length, "files mentioning the symbol").toBeGreaterThan(all.length);
    expect(readFileSync(join(REPO_ROOT, HELPER_REL), "utf8").length, "helper readable").toBeGreaterThan(0);
  });
});
