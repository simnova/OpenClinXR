import { describe, expect, it } from "vitest";
import { DONE_WHEN_RULE_VOCABULARY, evaluateDoneWhenRule, isKnownDoneWhenRule } from "./done-when-rules.js";

/**
 * OBSERVABLE: a slice's `done_when` can require that its planted REDs actually went green.
 *
 * A planted RED is `it.fails(...)`. Vitest treats a failing `it.fails` as EXPECTED, so the file exits
 * **0** while the defect is still present — which is the whole point of a plant, and why one can sit
 * on main until its slice runs.
 *
 * But `done_when` uses `run:<that file>` as the proof the work HAPPENED. Measured on #569's third
 * attempt, which fixed the real defect a different way and never touched the planted clauses:
 *
 *     Tests 1 passed | 3 expected fail (4)
 *     run: exit code 0            <- the proof passes on undone work
 *
 * `contract-verify-cli` reported "all tree proofs passed". Every `done_when` written this session
 * would pass on work that was never done. Nine landed slices flipped their REDs anyway, so the proof
 * was correct by the workers' diligence rather than by construction — #569 removed that coincidence.
 *
 * `live:<file>` is the missing rule: zero remaining `it.fails` in the named plant. `run:` stays the
 * outcome check and is deliberately NOT changed, because a bare `run:` that inferred expected-fail
 * policy would bind the whole suite and make every legitimately-red plant on main unlandable —
 * `every-cast-actor-has-a-phenotype.test.ts` has sat red for weeks by design. Clause (4) pins that.
 *
 * FIXTURES ARE REAL FILES ON MAIN, not synthetic:
 *   the-iris-factor-is-the-iris-material-s.test.ts   3 expected fail  (#569, unlanded)
 *   a-recovered-session-is-not-a-death.test.ts       0 expected fail  (#567, landed green)
 *
 * claimScope: whether `done_when` can express "the planted REDs are flipped".
 * notEvidenceFor: whether any plant's assertions are correct, or `run:`'s own behaviour, which this
 *   deliberately leaves alone.
 */

/**
 * ## FIXED (#570)
 *
 * `live:<file>` landed as a tree proof in `done-when-rules.ts`: recognised by
 * DONE_WHEN_RULE_VOCABULARY + isKnownDoneWhenRule, classified as a tree proof by partitionDoneWhen
 * (so dispatch's at-least-one-tree-proof gate accepts cards using it), evaluated as zero remaining
 * planted markers via countPlantedItFails (`done-when-live.ts`). The counter strips comments and
 * string bodies before matching `\bit\s*\.\s*fails\s*\(`, so prose that documents the marker does
 * not over-count — the caveat clause (0)'s own regex shares.
 *
 * Detail strings: fail names the FILE and the REMAINING COUNT ("still has 3 unflipped it.fails
 * clause(s)"), pass says "no it.fails clauses remain"; missing/ambiguous targets refuse. `run:`'s
 * behaviour is untouched (clause (4) pins it) — live: binds only a slice's own done_when, which is
 * the only place that should know about expected-fails.
 */

const ROOT = "/Volumes/files/src/openclinxr";
const UNFLIPPED = "tools/openclinxr/evidence/the-iris-factor-is-the-iris-material-s.test.ts";
const FLIPPED = "tools/openclinxr/openclaw/a-recovered-session-is-not-a-death.test.ts";
const evaluate = (rule: string) => evaluateDoneWhenRule(ROOT, rule, "issue-570", {});

describe("a live: rule refuses an unflipped plant", () => {
  it("(0) HARNESS COLUMN: the two fixtures really are unflipped and flipped", async () => {
    // Passes today. Reads the sources rather than trusting my description of them, so the clauses
    // below cannot be green about the wrong files.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const count = (p: string) => (readFileSync(join(ROOT, p), "utf8").match(/\bit\.fails\(/gu) ?? []).length;
    expect(count(UNFLIPPED), `${UNFLIPPED} is the unlanded plant`).toBeGreaterThan(0);
    expect(count(FLIPPED), `${FLIPPED} landed with every RED flipped`).toBe(0);
  });

  it("(1) live: is a recognised done_when rule", () => {
    expect(
      isKnownDoneWhenRule(`live:${FLIPPED}`),
      "an unrecognised rule is refused at brief time, so a slice cannot ask for this at all",
    ).toBe(true);
    expect(DONE_WHEN_RULE_VOCABULARY.prefixes).toContain("live:");
  });

  it("(2) live: FAILS on an unflipped plant, and says WHY", async () => {
    // The detail assertion is the whole clause. An UNKNOWN rule already returns
    // `passed: false, detail: "unsupported rule"`, so asserting `passed === false` alone is green
    // today for the wrong reason — vacuous until `live:` exists. Requiring the detail to name the
    // remaining count is what makes this measure something.
    const check = await evaluate(`live:${UNFLIPPED}`);
    expect(check.passed, "3 it.fails clauses remain — the #569 case where run: exited 0").toBe(false);
    expect(
      String(check.detail),
      "must fail because REDs remain, not because the rule is unrecognised",
    ).not.toMatch(/unsupported rule/iu);
    expect(String(check.detail), "the detail names how many REDs are still unflipped").toMatch(/\b3\b/u);
  });

  it("(3) live: PASSES on a plant that went green", async () => {
    // The landed #567 plant. A rule that refuses everything would satisfy clause (2) alone; this is
    // what stops it.
    const check = await evaluate(`live:${FLIPPED}`);
    expect(check.passed, "zero it.fails remain — the slice's REDs were flipped").toBe(true);
  });

  it("(4) COUNTERWEIGHT: run: is unchanged and still passes on an unflipped plant", async () => {
    // Passes today and MUST survive. A plant is committed to main deliberately red and sits there
    // until its slice runs. If `run:` started failing on expected-fails, every such plant would
    // break the suite and become unlandable. `live:` binds a slice's own done_when; `run:` binds the
    // suite, and only the first should know about it.fails.
    const check = await evaluate(`run:pnpm exec vitest run ${UNFLIPPED}`);
    expect(
      check.passed,
      "vitest exits 0 on expected-fails; run: must keep reporting that as a pass",
    ).toBe(true);
  });
});
