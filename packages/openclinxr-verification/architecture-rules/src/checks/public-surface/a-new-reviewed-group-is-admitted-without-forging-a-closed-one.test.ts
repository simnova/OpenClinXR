import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REVIEW_GROUPS, resolveApplyId } from "./apply-map.js";
import { workspaceRoot } from "./resolve.js";

/**
 * A package that legitimately needs new public API has no route that is not forgery.
 *
 * MEASURED 2026-09-14 on origin/main at a896db48. The bake vertical landed and necessarily
 * publishes six names its own contract requires, because the gateway and UI-XR halves consume the
 * bake module and the plant's BAKE_MODULE = "./motion-glb-bake.js" must resolve:
 *
 *   psr-01c  packages/openclinxr/motion-compiler        MotionGlbBakeClip, MotionGlbBakeTrack,
 *                                                       MotionGlbReadback, bakeMotionProgramToGlb,
 *                                                       readMotionGlb
 *   psr-01e  packages/openclinxr/xr-humanoid-animation  playManifestMotionClip
 *
 * `pnpm arch:public-surface:acceptance` therefore returns `verdict: refuse` on criterion 5, where
 * hours earlier at 0517a635 it returned `verdict: close`. Two landed programmes collide: the
 * reduction programme admits only names carrying an approval keep row, and the factory needs new
 * API to wire a new capability.
 *
 * THE OBVIOUS FIX IS FORGERY, AND THIS MACHINERY EXISTS TO CATCH IT. gates.ts:14-22 states it:
 * "an implementation card cannot satisfy its semantic proof by editing an approval manifest or
 * setting a completion flag. Every gate recomputes the compiler-derived current surface and
 * compares it against immutable approved dispositions." Appending six rows to psr-01c and
 * recomputing its groupHash defeats exactly the control it implements. It was not done.
 *
 * THE REAL DEFECT is that the legal counterpart does not exist. A new reviewed group is not
 * admissible at all, and the group set is declared THREE times rather than once:
 *
 *   apply-map.ts:12        export const REVIEW_GROUPS = ["psr-01b","psr-01c","psr-01d","psr-01e"]
 *   gates.ts:448           const groups = ["psr-01b","psr-01c","psr-01d","psr-01e"]   (local literal)
 *   gates.ts:456           const groups = ["psr-01b","psr-01c","psr-01d","psr-01e"]   (local literal)
 *
 * acceptance-criteria.ts imports the exported constant (:161, :211, :225). requireAllReviewed does
 * not. So adding a fifth id to REVIEW_GROUPS would be iterated by criterion 4 and criterion 5's
 * apply loop while requireAllReviewed silently kept checking four — a new group that is half
 * admitted is worse than one that is refused outright.
 *
 * Diagnosis IMMUTABLE. Flip `it.fails` -> `it` and append ## FIXED. Do not rewrite this header's
 * measured paths, line numbers or symbol lists.
 *
 * live: is valid here (raw it.fails, no helper indirection).
 *
 * WHAT THIS TEST IS NOT. It does not assert that acceptance returns `close`. A verdict in a
 * contract becomes the design target, and the two cheapest routes to `close` are both destructive:
 * forge a closed group's hash, or delete the six exports the bake vertical needs. Clause (3) is the
 * counterweight and must keep passing after any fix.
 */

const ROOT = workspaceRoot();
const GATES = join(ROOT, "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/gates.ts");
const APPLY_MAP = join(ROOT, "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/apply-map.ts");

/** Any array literal of psr group ids, e.g. ["psr-01b", "psr-01c", "psr-01d", "psr-01e"]. */
const GROUP_ID_ARRAY_LITERAL = /\[\s*"psr-[^"]+"(?:\s*,\s*"psr-[^"]+")*\s*,?\s*\]/gu;

describe("a new reviewed group is admitted without forging a closed one", () => {
  it("(0) VACUITY: the sources this test reads exist, so a failure below is never a missing file", () => {
    expect(readFileSync(GATES, "utf8").length, `unreadable: ${GATES}`).toBeGreaterThan(1000);
    expect(readFileSync(APPLY_MAP, "utf8").length, `unreadable: ${APPLY_MAP}`).toBeGreaterThan(200);
    expect(REVIEW_GROUPS.length, "REVIEW_GROUPS is empty").toBeGreaterThan(0);
  });

  it("(1) RED: the group set is declared once, not re-literalled inside gates.ts", () => {
    const source = readFileSync(GATES, "utf8");
    const literals = source.match(GROUP_ID_ARRAY_LITERAL) ?? [];
    expect(
      literals,
      `gates.ts re-declares the review-group set ${literals.length} time(s) instead of importing ` +
        `REVIEW_GROUPS from apply-map.ts. A fifth group added to the exported constant would be ` +
        `iterated by acceptance-criteria.ts (:161, :211) and silently ignored by requireAllReviewed.`,
    ).toEqual([]);
  });

  it("(2) INVERTED GUARD: no admission path exists for a well-formed new reviewed group id", () => {
    // This clause originally asserted that a well-formed new group id resolves, which is the
    // admission path the programme still lacks. It is inverted because the only two ways to
    // satisfy the original were totality (removed here) or listing a fictional id in
    // REVIEW_GROUPS (which would make criteria 4 and 5 iterate a group that does not exist and
    // refuse on its missing manifest). It is RESTORED to `.toBeDefined()` when a real group with
    // a real approvals/<id>.json and an independent reviewer exists; widening or deleting this
    // clause instead of restoring it is wrong.
    const resolution = resolveApplyId("psr-01f");
    expect(
      resolution,
      "resolveApplyId must return undefined for psr-01f: no admission path exists until a real " +
        "group with a real approvals/<id>.json and an independent reviewer exists",
    ).toBeUndefined();
  });

  it("(3) COUNTERWEIGHT: a closed group is still keyed to its reviewed rows, and must stay that way", () => {
    // This passes today and MUST keep passing after any fix. If admitting a new group is bought by
    // relaxing how an existing one is verified, the control is gone and the fix is worse than the
    // defect. Restoration: requireAllReviewed must keep comparing each group's stored groupHash
    // against groupHash(rawInventory.rows, approvalPackages(rows)) and its rawInventoryHash against
    // the checked-in raw inventory. Widening or deleting this clause is wrong.
    const source = readFileSync(GATES, "utf8");
    expect(source, "requireAllReviewed no longer compares groupHash against the raw inventory rows").toMatch(
      /groupHash\(raw\.rows \?\? \[\], approvalPackages\(read\.rows\)\) !== read\.value\.groupHash/u,
    );
    expect(source, "requireAllReviewed no longer refuses a group whose rawInventoryHash has moved").toMatch(
      /is stale: raw inventory hash moved/u,
    );
    expect(source, "the self-attestation refusal was removed").toMatch(/completionFlag/u);
  });

  // (4) RED — THE RESOLVER MUST NOT BE TOTAL OVER A GRAMMAR.
  //
  // Added 2026-09-14 after an independent grok-4.6 review of the tsk_140554d3e5e30d4e land returned
  // "unsafe-as-specified-but-fixable: keep the single-source fix, reject the totality branch".
  //
  // MEASURED on main at b66a94ba by CALLING resolveApplyId, not by reading it:
  //   psr-99z  -> { group: "psr-99z", scope: { kind: "group" } }
  //   psr-01f  -> { group: "psr-01f", scope: { kind: "group" } }
  //   nonsense -> undefined
  // An id for a group that has never existed resolves as a REVIEWED GROUP, while REVIEW_GROUPS
  // (apply-map.ts:12), requireAllReviewed and acceptance-criteria.ts:161/:211 still know only four.
  // That is the same split clause (1) exists to close, relocated from "two literals" to "resolver
  // grammar versus allowlist" — and clause (2) cannot see it, because toBeDefined() is satisfied by
  // totality. apply-map.ts:67 still documents "Unknown ids resolve to undefined", now false.
  //
  // THE FIX: delete the /^psr-\d{2}[a-z]$/ branch at apply-map.ts:82. That makes clause (2) fail,
  // and clause (2) is then SUPERSEDED rather than deleted: mark it `it.fails` and record that it is
  // unsatisfiable until a REAL group with a manifest exists, because the only ways to satisfy it
  // are totality or listing a fictional id in REVIEW_GROUPS, which would make criteria 4 and 5
  // iterate a group that does not exist and refuse on its missing manifest.
  // MEASURED as a plain `it(` on 2026-09-14 before being marked: 1 failed | 4 passed (5), the
  // failure reading "expected { group: 'psr-99z', scope: { kind: 'group' } } to be undefined".
  it("(4) RED: the resolver is not total — an id no allowlist knows stays unresolvable", () => {
    expect(
      resolveApplyId("psr-99z"),
      "resolveApplyId routes psr-99z as a reviewed group, but REVIEW_GROUPS, requireAllReviewed "
        + "and criteria 4 and 5 have never heard of it: routing admits what the allowlist refuses",
    ).toBeUndefined();
  });
});

/**
 * ## FIXED (tsk_140554d3e5e30d4e)
 *
 * Clauses (1) and (2) flipped from `it.fails` to `it`; header untouched.
 * gates.ts now imports REVIEW_GROUPS from apply-map.ts and both
 * requireAllReviewed branches iterate `[...REVIEW_GROUPS]` (zero psr-group
 * array literals remain). resolveApplyId gained a LAST-branch
 * well-formedness route (/^psr-\d{2}[a-z]$/) returning a whole-group scope,
 * after REVIEW_GROUPS, psr-08, and APPLY_TARGETS, so psr-02/psr-08 keep
 * their subset/complement scope and psr-01f resolves without a manifest.
 * Header staleness noted, not corrected: it lists six motion-compiler
 * symbols, but MotionGlbBakeTrack, MotionGlbReadback and readMotionGlb were
 * removed by tsk_e133db2e0e13d261, leaving four unapproved symbols.
 */
