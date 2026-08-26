import { describe, expect, it } from "vitest";
import { briefFromIssue, malformedPathTargets } from "../openclaw/board-brief.js";

/**
 * OBSERVABLE: the dispatch gate refuses a wildcard path rule the evaluator fully supports, and
 * tells the author to strip the wildcard — which destroys the rule.
 *
 * MEASURED on HEAD before this fix:
 *
 *   exists:tools/openclinxr/evidence/x.json              PASS
 *   exists:tools/openclinxr/evidence/*.json              REFUSED
 *   exists:.openclinxr/evidence/**\/pre-fix.json          REFUSED
 *   changed:apps/ui-xr/public/.../infinigen-*.glb        REFUSED
 *
 * The refusal reads: "whose path target carries markdown formatting, so the target is a literal
 * string no file can match... Strip the backticks/quotes/brackets from the path."
 *
 * That is false for `*`. `done-when-tree.ts` implements `globMatch`, which branches on
 * `normalizedPattern.includes("*")` and builds a regex from the segments — a wildcard is a
 * FIRST-CLASS supported form in the thing that evaluates these rules. `FORMATTING` at
 * `board-brief.ts:193` is `/[\`"'*\[\]()]/u`, and `*` sits in that character class beside genuine
 * markdown artifacts.
 *
 * WHY THIS IS THE WORST SHAPE OF THE CLASS: the remediation is actionable, confident, and
 * destructive. Stripping the `*` from `exists:evidence/*.json` yields `exists:evidence/.json`,
 * a path that really cannot match — so following the advice converts a working contract into the
 * broken one the message accused it of being. A vague message wastes a reader's minute; this one
 * damages the card.
 *
 * The backtick, quote, bracket and paren cases are REAL and stay refused — a markdown link like
 * `exists:[evidence](path/x.json)` genuinely cannot resolve, and no test here weakens that.
 *
 * claimScope: whether `*` alone marks a path rule unsatisfiable.
 * notEvidenceFor: whether any glob rule is a GOOD rule; whether the evaluator's glob semantics are
 *   right; the other refusal branches.
 */

const issue = (rules: string[]) => ({
  number: 1,
  title: "t",
  body: `P.\n\n## factory_step: room_generate\n## done_when\n\n${rules.map((r) => `- ${r}`).join("\n")}\n`,
});

describe("a glob is not markdown formatting", () => {
  it("(1) RED: a wildcard path rule is not reported as unsatisfiable", () => {
    expect(malformedPathTargets(["exists:tools/openclinxr/evidence/*.json"])).toEqual([]);
    expect(malformedPathTargets(["exists:.openclinxr/evidence/**/pre-fix.json"])).toEqual([]);
    expect(malformedPathTargets(["changed:apps/ui-xr/public/xr-assets/environment/infinigen-*.glb"])).toEqual([]);
  });

  it("(2) RED: and a card carrying one dispatches", () => {
    const b: any = briefFromIssue(issue([
      "run:pnpm exec vitest run a.test.ts",
      "exists:tools/openclinxr/evidence/*.json",
    ]));
    expect(b.dispatchable).toBe(true);
    expect(b.proofs).toHaveLength(2);
  });

  it("(3) COUNTERWEIGHT: genuine markdown artifacts stay refused", () => {
    // These really cannot resolve, and the original guard was written for them. Measured: 24 of 62
    // ledger proof failures were changed:-only, one of them exactly the backticked shape.
    expect(malformedPathTargets(["exists:`tools/x.json`"]).length).toBe(1);
    expect(malformedPathTargets(['exists:"tools/x.json"']).length).toBe(1);
    expect(malformedPathTargets(["exists:[evidence](tools/x.json)"]).length).toBe(1);
    expect(malformedPathTargets(["min-bytes:`a/b/c.png`:60000"]).length).toBe(1);
  });

  it("(4) COUNTERWEIGHT: a wildcard INSIDE a backticked path is still refused", () => {
    // The fix must narrow the character class, not stop checking. A path that is both globbed and
    // backticked is still unsatisfiable, and must not slip through on the wildcard exemption.
    expect(malformedPathTargets(["exists:`tools/evidence/*.json`"]).length).toBe(1);
  });

  it("(5) VACUITY GUARD: the evaluator really does implement globs", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("packages/openclinxr/agent-loop/src/done-when-tree.ts", "utf8"));
    expect(src, "if globMatch ever disappears, refusing `*` becomes correct and this contract is wrong")
      .toMatch(/function globMatch/);
    expect(src).toMatch(/includes\("\*"\)/);
  });
});
