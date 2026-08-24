import { describe, expect, it } from "vitest";
import { briefFromIssue, malformedPathTargets } from "./board-brief.js";

/**
 * **OBSERVABLE: a done_when rule whose path can never match is refused before a worker is spawned.**
 *
 * ## MEASURED 2026-08-24 over the dispatch ledger — do not re-derive
 *
 * Of 62 proof failures across 440 verdict-covered sessions, **24 were `changed:`-ONLY**: every other
 * proof green, the worker did real work, and one named file did not change. The failure detail on 29
 * of them reads "unchanged since slice baseline (present before the work began)".
 *
 * One of those rules, verbatim from the ledger:
 *
 *     changed: `tools/openclinxr/openclaw/dispatch-worker.ts`
 *
 * `done-when-rules.ts:261` takes `rule.slice("changed:".length).trim()`, so the target is the string
 * "`tools/...`" WITH backticks. No file has that name. No worker action could satisfy it. It was
 * discovered only after the dispatch had already spent its turns.
 *
 * claimScope: whether a path-target rule is syntactically satisfiable.
 * notEvidenceFor: whether the named file SHOULD change, or whether the rest of the contract is sound.
 */
const issue = (rules: string[]) => ({
  number: 999,
  title: "probe",
  body: `## factory_step: body_param\n\n## lane: A\n\n## done_when\n\n${rules.map((r) => `- ${r}`).join("\n")}\n`,
});

describe("a proof that can never pass is refused at brief time", () => {
  it("(1) refuses the REAL malformed rule that reached a live dispatch", () => {
    const real = "changed: `tools/openclinxr/openclaw/dispatch-worker.ts`";
    expect(malformedPathTargets([real]), "backticked path is unsatisfiable").toEqual([real]);
    const brief = briefFromIssue(issue([real, "run:pnpm -s exec vitest run x.test.ts"]));
    expect(brief.dispatchable, "a brief carrying an unpassable proof must not dispatch").toBe(false);
    expect(String((brief as { reason?: string }).reason)).toMatch(/never pass/iu);
  });

  it("(2) COUNTERWEIGHT: ordinary path rules stay dispatchable", () => {
    // Without this, a guard that refuses everything satisfies clause (1).
    const good = [
      "changed:tools/openclinxr/openclaw/dispatch-worker.ts",
      "exists:.openclinxr/evidence/issue-576/pre-fix.json",
      "live:tools/openclinxr/evidence/a-declared-body-shape-reaches-the-baked-body.test.ts",
      "min-bytes:tools/openclinxr/evidence/garment-class-sheet.png:60000",
    ];
    expect(malformedPathTargets(good), "these are the shapes that ship every day").toEqual([]);
    expect(briefFromIssue(issue(good)).dispatchable).toBe(true);
  });

  it("(3) a run: rule is NOT a path rule — its command legitimately contains quotes", () => {
    // run: carries a shell command. Applying path validation to it would refuse most real contracts.
    const run = `run:pnpm -s exec vitest run x.test.ts -t "some name"`;
    expect(malformedPathTargets([run])).toEqual([]);
  });

  it("(4) min-bytes: keeps its trailing count out of the path check", () => {
    expect(malformedPathTargets(["min-bytes:a/b/c.png:60000"])).toEqual([]);
    expect(malformedPathTargets(["min-bytes:`a/b/c.png`:60000"]).length).toBe(1);
  });
});
