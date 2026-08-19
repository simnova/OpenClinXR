import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * # THE DEFECT, MEASURED 2026-08-19 on main d082d5b9 — do not re-derive these rows
 *
 * #448 landed the Factory writer. It cannot write. Run live against project 7:
 *
 *   $ board-cli.ts factory --slice-id issue-448 --stage Landed
 *   spawnSync gh ENOBUFS
 *   $ board-cli.ts factory --slice-id issue-449 --stage Planted
 *   spawnSync gh ENOBUFS
 *
 * Board occupancy is unchanged afterwards. `#448` is still `Planted`, never `Landed`.
 *
 * ## CAUSE, MEASURED
 *
 *   gh project item-list 7 --owner simnova --format json --limit 500  =  2,518,167 bytes
 *   node spawnSync default maxBuffer                                   =  1,048,576 bytes
 *   spawnSync( sites in board-cli.ts                                   =  6
 *   maxBuffer occurrences in board-cli.ts                              =  0
 *
 * Resolving a slice id to a project item LISTS THE WHOLE BOARD. The board is 460 items and its
 * JSON is 2.4x Node's default child-process buffer, so the command dies before the `item-edit`
 * is ever issued. **This is not rate-limiting** — #448's worker recorded it as
 * "rate-limited this session" in its own NOT TESTED, and the mutation was never reached at all.
 *
 * ## WHY #448's UNIT TESTS PASS
 *
 * They inject a runner, so the real `spawnSync` and its buffer are never exercised. The argv is
 * correct — I read it and it is right — but argv correctness is not the command completing.
 * The repo's recurring "wired but produces nothing usable", in the substrate this time.
 *
 * ## THE FIX IS DERIVED, NOT GUESSED — TWO CANDIDATES, BOTH MEASURED
 *
 *   route                                                    response bytes
 *   gh project item-list 7 --format json --limit 500          2,518,167    <- today
 *   gh project item-list 7 --format json --query factory:X        6,754    <- server-side filter
 *   gh api graphql  issue(number) -> projectItems.nodes.id          155    <- exact item, 1 hop
 *
 * The GraphQL hop returns `PVTI_lADOAAIjts4BW0-vzg3L_rI` for issue 448 — byte-identical to the
 * item id I used by hand last tick to set `Factory: Planted`, so the id shape is confirmed
 * against a write that actually worked. **155 bytes versus 2.4 MB, and no listing.**
 *
 * `--query` is the right tool for the POLL (`factory:Planted`, 6,754 B). It is the wrong tool
 * for slice-id resolution: it filters by field value, not by issue number, and the lead already
 * measured that `number:447` is not a valid Projects filter (totalCount 0 for a card that is
 * on the board).
 *
 * ## THE KNOWN-GOOD COLUMN (SS9h)
 *
 * `gh project item-edit` DOES work from this machine — I set `Factory: Planted` on #448 by hand
 * and `factory:Planted` returned `[448]`. So GitHub, the field id and the option id are all
 * fine. Clause (4) pins them, because the failure is entirely Node-side and a "fix" that moves
 * to a different field would be treating the wrong layer.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today                                           |FAIL |FAIL |pass |pass | REFUSED
 *   b) bump maxBuffer, keep listing the whole board    |FAIL | ?   |pass |pass | REFUSED
 *   c) raise --limit until it "fits"                    |FAIL |FAIL |**FAIL**|pass| REFUSED
 *   d) write a different, smaller field                 |pass |pass |pass |**FAIL**| REFUSED
 *   e) resolve via GraphQL + maxBuffer on every site    |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the obvious one and it is why clause (1) exists.** A buffer bump makes today's
 * command succeed and leaves the CLI shelling 2.4 MB of JSON to find one item — it grows with
 * the board and fails again silently at some future size. The cause is the listing, not the
 * buffer; the buffer is the symptom that surfaced it.
 *
 * **(c) is the same error wearing a smaller hat.** Lowering `--limit` to fit the buffer means
 * the resolution silently misses cards beyond the limit — exactly the false instrument that had
 * me reporting "zero of my issues are on the board" when all seven were, because I listed the
 * oldest 200.
 *
 * ## DESTRUCTIVE PROBE, RUN 2026-08-19 — one row fully confirmed, one PARTIAL, and I say which
 *
 * **First attempt did not apply at all.** A regex-based mutation left `maxBuffer` count at 0 and
 * `"120"` count at 0, and the suite reported the same 2 failures as the clean tree. An unmatched
 * substitution proves nothing — it passes identically to no probe. Redone against the real code
 * shape (`spawnSync(bin!, args, { encoding, env })`, and `--limit "1000"` at :538).
 *
 *   cheat (c) --limit 1000 -> 120, substitution CONFIRMED applied ("120" x1)
 *             -> 3 failed: clauses (1), (2) AND (3). Row (c) matches the table exactly.
 *
 *   cheat (b) maxBuffer added, substitution CONFIRMED applied to 2 sites (count 0 -> 2)
 *             -> 2 failed: clauses (1) and (2). Clause (1) refuses the kept listing, which is
 *                the load-bearing half of row (b) and is now proven.
 *
 * **My table said row (b) would PASS clause (2). It did not, and the cell is now `?`.** The
 * probe bound 2 of the 6 `spawnSync(` occurrences, so clause (2)'s `bounded >= sites` correctly
 * stayed red. Whether a COMPLETE buffer bump greens clause (2) is UNTESTED — the remaining four
 * matches were not patched and I did not verify whether they are real call sites or docstring
 * text. Stated rather than papered over: (b) is refused by clause (1) regardless, which is the
 * behaviour that matters, but I have not demonstrated the (2) cell either way.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1) is a RED — the resolution path lists the board today.
 *   (2) is a RED — 6 spawnSync sites, 0 maxBuffer.
 *   (3) PASSES TODAY — no `--limit` tuning has been attempted. Pure net against (c).
 *   (4) PASSES TODAY — it reads the field and option ids. Pure net against (d).
 *   (5) PASSES TODAY — vacuity guard on the file itself.
 *
 * NOT TESTED:
 *   - **That the live write then succeeds.** This contract asserts the MECHANISM. The
 *     `done_when` carries the live CLI invocation, which throws ENOBUFS today; that is the
 *     decisive proof and it is deliberately outside this file.
 *   - **The other five spawnSync sites' response sizes.** Only the board listing was measured;
 *     `gh pr view` and friends are presumably small and are unmeasured.
 *   - **Whether GraphQL projectItems paginates** for an issue on many boards. `first:5` was
 *     enough here (one board) and is untested beyond that.
 *   - Rate limits. Nothing here measures them, and they were never the cause.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const BOARD_CLI = join(REPO_ROOT, "tools/openclinxr/openclaw/board-cli.ts");

const BLOCK = /\/\*[\s\S]*?\*\//gu;
const LINE = /^[ \t]*\/\/.*$/gmu;
/** Comment-stripped — a symbol in a docstring is not a call site (the #397 trap). */
const src = readFileSync(BOARD_CLI, "utf8").replace(BLOCK, "").replace(LINE, "");
const raw = readFileSync(BOARD_CLI, "utf8");

/** The field and option ids that a hand-run `item-edit` already proved work. */
const FACTORY_FIELD_ID = "PVTSSF_lADOAAIjts4BW0-vzhfup8E";
const PLANTED_OPTION_ID = "53aeb5a6";

describe("the Factory writer resolves an item without listing the board", () => {
  it("(1) RED: slice-id resolution does not list the whole board", () => {
    // Refuses (b): a buffer bump leaves 2.4 MB shelled to find one item and fails again
    // silently as the board grows. Measured alternatives: --query 6,754 B, GraphQL 155 B.
    const resolvesByGraphql = /api\s+graphql|projectItems/u.test(src);
    expect(
      resolvesByGraphql,
      `board-cli.ts resolves a slice id by listing the project (2,518,167 bytes against a `
        + `1,048,576-byte default buffer). Resolve the item id from the ISSUE instead — `
        + `gh api graphql issue(number) -> projectItems.nodes.id returned the correct id in 155 bytes`,
    ).toBe(true);
  });

  it("(2) RED: every spawnSync bounds its output", () => {
    const sites = (src.match(/spawnSync\s*\(/gu) ?? []).length;
    const bounded = (src.match(/maxBuffer/gu) ?? []).length;
    expect(sites, "the CLI must still shell out — if this is 0 the classifier is broken").toBeGreaterThan(0);
    expect(
      bounded,
      `${String(sites)} spawnSync sites and ${String(bounded)} maxBuffer settings — an unbounded `
        + `child-process buffer is what turned a working item-edit into ENOBUFS`,
    ).toBeGreaterThanOrEqual(sites);
  });

  it("(3) COUNTERWEIGHT: no --limit tuning to make a listing 'fit'", () => {
    // Refuses (c). Lowering the limit hides cards beyond it — the false instrument that had me
    // reporting zero of my issues on a board that held all seven, because I listed the oldest 200.
    const limits = [...src.matchAll(/--limit["'\s,]+(\d+)/gu)].map((m) => Number(m[1]));
    const suspicious = limits.filter((n) => n > 0 && n < 500);
    expect(
      suspicious,
      `a --limit below 500 in the resolution path silently misses cards beyond it; resolve by `
        + `issue instead of listing`,
    ).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the Factory field and option ids are unchanged", () => {
    // Refuses (d). The failure is entirely Node-side — `gh project item-edit` works from this
    // machine, proven by a hand-run that set Factory: Planted on #448. Moving to a different
    // field would be treating the wrong layer.
    expect(raw, "the Factory field id must not change").toContain(FACTORY_FIELD_ID);
    expect(raw, "the Planted option id must not change").toContain(PLANTED_OPTION_ID);
  });

  it("(5) VACUITY GUARD: the CLI is readable and still shells gh", () => {
    // Reads the file, not the absent surface, so it passes today and keeps passing: if someone
    // stubs the CLI out, this goes red before the clauses above become unfalsifiable.
    expect(raw.length, "board-cli.ts must be readable").toBeGreaterThan(1000);
    expect(/["']gh["']/u.test(src), "the CLI still invokes gh").toBe(true);
  });
});
