/**
 * #717 — integrate must re-run the slice's `run:` proofs against the MERGED tree.
 *
 * THE DEFECT, MEASURED (2026-08-27) — do not re-derive this.
 *
 *   #712 landed contract-green and three of its clauses went red on main within a minute.
 *   Its measurement lives at .openclinxr/evidence/ed-patient-upper-body/scene-sample.json,
 *   a gitignored path. `integrate` landed the test and the CLI; the 982 KB artifact stayed
 *   in the worker's worktree. The proofs had passed against the CANDIDATE tree, where the
 *   artifact existed, and were never re-run against what main actually received.
 *
 *   The existing guard does not cover this and is not at fault. proof-target-preflight.ts:48
 *   reads `if (!rule.startsWith("exists:") && !rule.startsWith("min-bytes:")) continue;` —
 *   it evaluates proof TARGETS. #712's proofs were `run:` and `live:`, whose targets are
 *   TRACKED test files; the untracked dependency lives inside the test body, where a target
 *   check cannot see it.
 *
 *   integrate.ts verifies the candidate tree (:140) and rebuilds after the merge (:614-630).
 *   It never re-runs a proof against the post-merge checkout.
 *
 * WHY NOT A STATIC SCAN. 31 evidence tests name an .openclinxr/evidence artifact that is
 * untracked AND absent on main. Most of them BOOT VITE AND REGENERATE IT, so absence is by
 * design and flagging them would be false positives. How many genuinely fail is NOT
 * DETERMINED — a 300 s run over all 31 did not finish. Re-running the proof answers the
 * real question and cannot false-positive, which is why this is the shape chosen.
 *
 * THIS HEADER IS IMMUTABLE. Flip the assertion and append a `## FIXED (#717)` block below.
 * Do not rewrite the paths or numbers above.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../..");
const INTEGRATE = resolve(REPO, "tools/openclinxr/openclaw/integrate.ts");

/**
 * A `run:` proof that passes anywhere, and one that cannot. Both are real invocations through
 * the SAME evaluator the contract layer uses (evaluateDoneWhenRule), not a second executor.
 */
const GREEN = "run:node -e \"process.exit(0)\"";
const RED = "run:node -e \"process.exit(3)\"";
const NON_RUN = "exists:package.json";

describe("#717 a landed slice proves itself on the tree main actually received", () => {
  it("(1) integrate exports a post-merge proof re-run", async () => {
    const mod = (await import(INTEGRATE)) as {
      rerunTreeProofsAfterMerge?: (
        repoRoot: string,
        proofs: readonly string[],
        sliceId: string,
      ) => Array<{ rule: string; ok: boolean }>;
    };
    expect(typeof mod.rerunTreeProofsAfterMerge).toBe("function");
    const verdicts = mod.rerunTreeProofsAfterMerge!(REPO, [GREEN, RED, NON_RUN], "issue-717");
    // Only `run:` rules are re-executed; a target-shaped rule is already covered by
    // proof-target-preflight and must not be shelled out here.
    expect(verdicts.map((v) => v.rule)).toEqual([GREEN, RED]);
    expect(verdicts.find((v) => v.rule === GREEN)?.ok).toBe(true);
    // The counterweight that matters: a failing proof must come back FAILING. A re-run that
    // reports everything green is the #55 class and worse than no re-run at all.
    expect(verdicts.find((v) => v.rule === RED)?.ok).toBe(false);
  });

  it("(2) the known-good column: the candidate-tree verification it must not replace", () => {
    // contract-verify-cli already re-runs proofs against the WORKTREE. This card adds a second
    // run against MAIN; it does not remove the first. If this clause ever fails, the fix
    // deleted the existing verification instead of adding to it.
    const src = readFileSync(INTEGRATE, "utf8");
    expect(src).toContain("contract-verify-cli.ts");
    expect(existsSync(resolve(REPO, "tools/openclinxr/openclaw/contract-verify-cli.ts"))).toBe(true);
  });

  it("(3) COUNTERWEIGHT: the existing exists:/min-bytes: preflight is not widened away", () => {
    // Refuses "make proof-target-preflight scan run: rules too", which was considered and
    // rejected: 31 tests would false-positive because they regenerate their own artifact.
    const preflight = readFileSync(
      resolve(REPO, "tools/openclinxr/openclaw/proof-target-preflight.ts"),
      "utf8",
    );
    expect(preflight).toContain('rule.startsWith("exists:")');
    expect(preflight).toContain('rule.startsWith("min-bytes:")');
  });

  it("(4) COUNTERWEIGHT: the post-merge rebuild step survives", () => {
    // #152/#196: packages are rebuilt after the merge so contracts do not run against a stale
    // dist. A proof re-run placed BEFORE that rebuild would measure the wrong tree.
    const src = readFileSync(INTEGRATE, "utf8");
    expect(src).toContain("rebuildTargets");
    expect(src).toMatch(/Rebuild AFTER the commit/);
  });

  it("(5) COUNTERWEIGHT: this card does not silently become a revert mechanism", () => {
    // A post-merge failure is REPORTED, not auto-reverted. Reverting a landed merge without a
    // human decision is a larger change than this card bought, and #448 already settled that a
    // post-commit failure is a loud warning rather than a refusal.
    const src = readFileSync(INTEGRATE, "utf8");
    expect(src).toContain("the land is already committed");
  });
});

/**
 * ## FIXED (#717)
 *
 * integrate.ts now exports `rerunTreeProofsAfterMerge(repoRoot, proofs, sliceId)`, wired into the
 * post-merge phase AFTER the package rebuild so it measures the tree main actually has. It filters
 * to `run:` rules and delegates each to `evaluateDoneWhenRule` — the same evaluator the contract
 * layer uses — so no second executor exists to drift.
 *
 * Verified against a real green/red pair (`node -e process.exit(0)` and `exit(3)`): the failing
 * proof comes back `ok: false`. A re-run that reported everything green would be worse than no
 * re-run, so that is the clause that matters.
 *
 * Reports, never reverts: a post-merge failure prints and is recorded on the integration event.
 */
