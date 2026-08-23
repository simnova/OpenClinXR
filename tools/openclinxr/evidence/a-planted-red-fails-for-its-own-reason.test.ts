import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **A planted RED on main imports a module that was deliberately never landed, so it fails at IMPORT
 * rather than at assertion.** It can never go green and can never meaningfully fail. That is a broken
 * marker, not a red one — and it is the last error standing between the tools typecheck and exit 0.
 *
 * Measured 2026-08-14:
 *
 *   tools/openclinxr/evidence/shoulder-raycast-coverage.test.ts   ON MAIN, 8,810 bytes
 *   tools/openclinxr/evidence/shoulder-raycast-coverage.ts        ABSENT from the tree entirely
 *   319cdd14 "fix(#82): area-weighted shoulder raycast"           NOT an ancestor of HEAD
 *   branch containing it                                          wt/issue-82, unmerged
 *
 *   tsgo -p tsconfig.tools-relaxed.json  ->  1 error, and this is it:
 *     shoulder-raycast-coverage.test.ts:75:10
 *     TS2307: Cannot find module './shoulder-raycast-coverage.js'
 *
 * ## THE UNMERGED BRANCH IS NOT AN ACCIDENT — DO NOT LAND IT
 *
 * #82 is closed, and its closing comment is explicit:
 *
 *   > "**NOT LANDED — deliberately.** `wt/issue-82` is left unmerged at `319cdd1`; main stays at the
 *   > planted RED. … A clean revert with a precise diagnosis is the outcome here."
 *
 * The render it produced was *"two detached teal blades floating in mid-air a hand's width off each
 * shoulder"* with every contract green — the fifth successive scalar shoulder metric defeated by
 * detached geometry (§6t). Landing that branch to clear a compile error would resurrect an approach
 * its own author measured and rejected.
 *
 * ## SO THE INTENT MUST SURVIVE THE FIX
 *
 * "Main stays at the planted RED" is a deliberate marker: shoulder coverage is unsolved, and the file
 * is there to say so. The defect is only that it says so by **failing to compile**, which is
 * indistinguishable from rot. A planted RED should fail on its own assertion, loudly and for its own
 * stated reason.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) typecheck | (2) marker kept | (3) no stub | result
 *   -------------------------------------------------|---------------|-----------------|-------------|--------
 *   a) today                                         |   **FAIL**    |      pass       |    pass     | REFUSED
 *   b) delete the test                               |     pass      |    **FAIL**     |    pass     | REFUSED
 *   c) create a stub `shoulder-raycast-coverage.ts`  |     pass      |      pass       |  **FAIL**   | REFUSED
 *   d) land wt/issue-82                              |     pass      |      pass       |    pass     | REFUSED — see above
 *   e) make the RED self-contained; it fails on its  |     pass      |      pass       |    pass     | ALL PASS
 *      own assertion instead of on an import         |               |                 |             |
 *
 * **(b) is the one to watch and it is why clause (2) exists.** Deleting the file makes the typecheck
 * green and silently retires a known-unsolved problem. That is the single worst outcome available
 * here — worse than leaving it broken, because a broken file is at least visible.
 *
 * **(c) is why clause (3) exists.** A stub module satisfies the import and makes the assertions run
 * against nothing. §6x: a fixture that does not exhibit the failure class proves the wrong thing.
 *
 * **(d) is refused by #82's own author, not by me.** I am recording that decision rather than
 * re-litigating it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails today. (2) and (3) are
 * counterweights and pass today. They are independent of what (1) measures: making a file compile
 * cannot delete it and cannot conjure a module.
 *
 * NOT TESTED:
 *   - **Whether shoulder coverage is solved.** It is not, and nothing here claims otherwise. This
 *     makes the marker honest; it does not move the problem.
 *   - **Whether the planted assertions are still the right ones.** #82 concluded the scalar approach
 *     cannot work and that an occlusion measure or a human is needed. Re-specifying that contract is a
 *     separate decision and this contract does not make it.
 *   - **The other planted REDs.** Only this one is uncompilable; no sweep was done for others in the
 *     same state.
 *
 * ## FIXED (#383)
 *
 * Treatment (e) executed: `shoulder-raycast-coverage.test.ts` is self-contained. `load()` is
 * declared inline (returns an empty module record) instead of importing the deliberately-unlanded
 * module, so the file compiles and its three `it.fails` REDs fail at their own first assertion —
 * the instrument does not exist — for their own stated reason, instead of at import. The module
 * file stays absent (clause 3) and the `it.fails` markers survive (clause 2).
 *
 * (1) is flipped to `it` because its assertion now holds: the planted contract no longer imports
 * the absent module, so "planted contracts that fail to compile rather than to assert" is a live
 * assertion rather than a RED. Shoulder coverage itself remains unsolved — nothing here claims
 * otherwise, and (2) keeps the marker that says so.
 *
 * ## FIXED (#583)
 *
 * The premise above is now DEAD, superseded rather than deleted: issue #583 implemented
 * `shoulder-raycast-coverage.ts` for real (area-weighted outward-normal raycast, calibrated on the
 * same graded-bare blobs), regenerated parent+nurse, and flipped all three `it.fails` in the
 * planted contract per its own header instruction. wt/issue-82 stays unmerged — the rejected
 * approach was NOT resurrected.
 *
 * What each clause guards AFTER resolution:
 *   (1) unchanged — the planted file must never again fail at IMPORT.
 *   (2) inverted from "marker kept" to "resolution recorded": the planted file still exists and
 *       carries ## FIXED (#583). Deleting the record is still the worst outcome; silently keeping
 *       a solved `it.fails` is now the second worst (an `it.fails` on a passing suite reads as a
 *       failing test and breaks CI semantics).
 *   (3) inverted from "no stub module" to "no STUB masquerading as the implementation": the module
 *       must exist AND export the two contract entrypoints. An empty-record stub would make the
 *       planted assertions run against nothing (§6x) — exactly what this clause refused before,
 *       one step later in the pipeline.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const EVIDENCE = join(REPO_ROOT, "tools/openclinxr/evidence");
const PLANTED = join(EVIDENCE, "shoulder-raycast-coverage.test.ts");
/** Landed by #583; must exist and be a real implementation, never a stub. */
const IMPL_MODULE = join(EVIDENCE, "shoulder-raycast-coverage.ts");

const source = existsSync(PLANTED) ? readFileSync(PLANTED, "utf8") : "";

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requirePlanted(): void {
  expect(existsSync(PLANTED), `${PLANTED} exists — the marker must not be deleted`).toBe(true);
  expect(source.length, "the planted contract is non-empty").toBeGreaterThan(2000);
}

describe("a planted RED fails for its own reason", () => {
  it("(1) RED: the planted shoulder contract compiles", () => {
    requirePlanted();
    // It cannot compile while it imports a module that was deliberately never landed. Asserting on
    // the import rather than shelling out to tsgo keeps this cheap and names the exact cause.
    const importsAbsent = /from\s+["']\.\/shoulder-raycast-coverage\.js["']/u.test(source);
    expect(
      importsAbsent ? [`${PLANTED} imports ./shoulder-raycast-coverage.js, which is absent from the tree (deliberately — #82 left wt/issue-82 unmerged). The file fails at IMPORT, so its assertions never run.`] : [],
      "planted contracts that fail to compile rather than to assert",
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT (inverted #583): the resolution is recorded, not silently kept or deleted", () => {
    // Refuses (b): deleting the file retires the record entirely. The #583 inversion also refuses
    // the mirror failure: keeping the it.fails markers AFTER the module exists, which would read
    // as failing tests on a green suite.
    requirePlanted();
    expect(
      /##\s*FIXED\s*\(#583\)/u.test(source),
      `${PLANTED} must carry a ## FIXED (#583) block — shoulder coverage was implemented; the record must say so`,
    ).toBe(true);
    const stillRed = /(?<![`\w])it\.fails\(/u.test(source);
    expect(
      stillRed ? [`${PLANTED} still contains executable it.fails(...) after #583 landed the implementation — a solved contract left as it.fails reads as a failing test`] : [],
      "solved contracts are flipped, not kept red",
    ).toEqual([]);
  });

  it("(3) COUNTERWEIGHT (inverted #583): the implementation exists and is not a stub", () => {
    // Refuses (c), one step later: before #583 the module had to stay absent; now it must EXIST
    // and export the contract entrypoints. A stub (empty record, missing exports) would make the
    // planted assertions run against nothing (§6x) — the same defect this clause always refused.
    requirePlanted();
    expect(
      existsSync(IMPL_MODULE),
      `${IMPL_MODULE} must exist after #583 — the implementation was accepted and landed`,
    ).toBe(true);
    const impl = readFileSync(IMPL_MODULE, "utf8");
    expect(impl.length, "implementation is non-trivial").toBeGreaterThan(1000);
    for (const symbol of ["assessShoulderRaycastCoverage", "coverageFractionVerdict"]) {
      expect(
        impl.includes(`export function ${symbol}`) || impl.includes(`export async function ${symbol}`) || impl.includes(`export const ${symbol}`),
        `${IMPL_MODULE} must export ${symbol} — a stub would make the planted assertions run against nothing`,
      ).toBe(true);
    }
  });
});
