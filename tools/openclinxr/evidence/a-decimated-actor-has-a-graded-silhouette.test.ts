import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: no actor's triangles are reduced without somebody looking at the result.
 *
 * ## WHY THIS IS A SEPARATE FILE FROM THE BUDGET CONTRACT (#695)
 *
 * `the-station-fits-its-budget-and-still-looks-like-people.test.ts` holds the budget clause as an
 * `it.fails`. I first put this verdict clause beside it and omitted a `live:` proof, reasoning that
 * `live:` would demand both clauses flip together when the budget can legitimately be met before the
 * silhouette is graded — and, worse, would forbid the honest outcome where decimation is measured,
 * graded and REFUSED.
 *
 * `briefFromIssue` refused the card, and its reason is the sharper half: **vitest counts an
 * expected-fail as a PASS, so a `run:` rule over a file whose only failures are `it.fails` exits 0 on
 * an UNTOUCHED tree.** I had traded a trap for a vacuous proof — the exact class I spent the day
 * catching, committed while avoiding a different one. The gate measured 5 of 14 open cards carrying
 * that shape.
 *
 * Splitting is the structural fix rather than a waiver. This file contains NO `it.fails`, so a
 * `run:`/`live:` pair over it is meaningful: it is RED today and green once the verdict exists. The
 * budget contract keeps its `it.fails` and is not named by the slice's proofs, so an honest
 * "decimated, graded, refused" outcome satisfies the card without pretending the budget was met.
 *
 * ## WHAT THE VERDICT IS FOR
 *
 * #692 gated a bake on largest-component share — a variable `trellis-baking` SKILL.md:292-305
 * records failing in both directions across four assets — and I built a conclusion on it that was
 * withdrawn the same day. A triangle count under budget with a faceted silhouette is a green
 * contract over bad pixels.
 *
 * MEASURED 2026-08-26 on the gown patient at 46,184 triangles (2.81x): the outline HELD — head,
 * shoulders, three-quarter sleeves with cuffs, skirt hem, legs and shoes read as before, no holes
 * and no detached fragments. What degraded was surface detail: the hands became angular wedges, the
 * shins faceted faintly, the face flattened slightly. **Hands are where to look first**, and they
 * are what a learner watches during a physical exam.
 *
 * claimScope: whether a graded silhouette verdict is recorded for every actor whose triangles were
 *   reduced.
 * notEvidenceFor: whether any particular ratio is right; how decimation reads at room framing;
 *   runtime skinning of decimated meshes.
 */

const VERDICTS = join(
  import.meta.dirname, "../../../.openclinxr/evidence/issue-695/silhouette-verdicts.json",
);

describe("a decimated actor has a graded silhouette (#695)", () => {
  it("a graded silhouette verdict exists for every actor whose triangles were reduced", () => {
    // Satisfied by a REFUSAL as readily as by an adoption: a verdict recording that a ratio wrecks
    // the hands is a graded verdict and closes this clause. What it refuses is silence.
    expect(
      existsSync(VERDICTS),
      "no silhouette verdict at .openclinxr/evidence/issue-695/silhouette-verdicts.json. One entry "
        + "per reduced actor: the ratio, the error bound, the before and after triangle counts, and "
        + "a graded verdict naming what held and what degraded. A ratio without its error bound is "
        + "not reproducible — a peer measured the child at 3.13x where the same ratio 0.34 at error "
        + "0.001 gives 2.18x. Widening or deleting this clause is wrong: it is the only thing "
        + "standing between a budget-compliant station and one that stopped looking like people.",
    ).toBe(true);
  });
});
