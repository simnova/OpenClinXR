import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DONE_WHEN_RULE_VOCABULARY,
  evaluateDoneWhenRule,
  isKnownDoneWhenRule,
  SLICE_BASELINE_SCHEMA,
  type SliceBaselineHashes,
} from "./done-when-rules.js";

/**
 * #177: seven workers have independently asked for the pre-fix measurement to be GATED, and it is
 * still prose. §9n recorded why the prose cannot bind: "a `done_when` rule can only check that the
 * artifact EXISTS, not WHEN it was written."
 *
 * MEASURED 2026-08-12, by enumeration rather than inference:
 *
 *   rule prefix   | recorded proofs | can express ordering?
 *   --------------|-----------------|----------------------
 *   run:          |       529       | no
 *   exists:       |       233       | no — existence only
 *   changed:      |       205       | no — "differs from the spawn baseline", not "before what"
 *   min-bytes:    |        58       | no
 *   handoff:      |         -       | narrative (the worker's own account; §1 forbids trusting it)
 *   skeptic:      |         -       | narrative
 *
 *   pre-fix `exists:` proofs shipped: 108, across 106 slices.
 *
 * So 106 slices have asked a rule to prove ordering that no rule in
 * `DONE_WHEN_RULE_VOCABULARY` can express. #106 is the measured failure: its pre-fix artifact
 * arrived AFTER the resolver already embodied the fix, so it proved the fix rather than observing
 * the defect. #171 shipped "reconstructed ambient 0s" — honest, disclosed, and not a before-column.
 *
 * A PREMISE OF MINE DIED WHILE MEASURING THIS, and it is recorded rather than quietly dropped
 * (§10s): I first read `writeBaselineHashes` as having no non-test caller and was about to file
 * "the trusted baseline is never written". FALSE — `dispatch-worker.ts:1047` writes it BEFORE the
 * worker runs, into the trusted dir the worker cannot write, and 168 of 301 slice dirs carry one.
 * The baseline mechanism is sound and this slice must not disturb it. My grep had searched three
 * plausible function names and not the real one.
 *
 * WHAT THE BASELINE GIVES US, and what it does not: `files: Record<rel, sha256>` hashed at spawn
 * answers "did this file change during the slice". It cannot answer "did the artifact land before
 * the edit", because both files simply differ from their spawn state. Ordering is a separate fact
 * and the worktree already carries it — mtimes in the window between the worker exiting and the
 * merge are the worker's own writes, which is exactly when `contract-verify-cli` runs.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                     | (1) orders | (2) refuses late | (3) not vacuous | result
 *   ----------------------------------------------|------------|------------------|-----------------|--------
 *   a) today — `exists:<artifact>` alone           |  **FAIL**  |    **FAIL**      |    **FAIL**     | REFUSED
 *   b) `exists:` + `changed:<product>` together    |  **FAIL**  |    **FAIL**      |      pass       | REFUSED
 *   c) require the artifact to carry a timestamp   |    pass    |    **FAIL**      |      pass       | REFUSED
 *   d) `measured-before:<artifact>:<product>`      |    pass    |      pass        |      pass       | ALL PASS
 *
 * (b) is what every one of the 106 slices actually shipped, and it is the one to worry about: both
 * clauses go green on the #106 ordering exactly as they do on a correct one. (c) is the fix a
 * worker reaches for second — a self-declared `measuredAt` inside the artifact is the worker's own
 * account of itself, which is the class §1 exists not to trust; clause (2) refuses it by taking the
 * ordering from the filesystem instead.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1), (2), (3) are REDs — the rule does not exist, so
 * `isKnownDoneWhenRule` rejects it and `evaluateDoneWhenRule` cannot evaluate it. (4) PASSES today
 * and is the known-good column: the six existing prefixes and the exact rule must keep evaluating
 * unchanged. A fix that reworks the vocabulary to add ordering is not a fix.
 *
 * NOT TESTED — and this residual is the whole scope statement, so read it before extending the rule
 * (§3b, §11c: conjunction does not create a new predicate):
 *   - This asserts ORDERING ONLY. It says nothing about the artifact's CONTENT. An empty `{}`
 *     written first satisfies it. Compose `min-bytes:` for substance; do not grow this rule to
 *     cover both, or it becomes a rule that is green about neither.
 *   - It does not defend against ACTIVE forgery. `touch -t` backwards defeats it. The failure mode
 *     it is built for is the measured one — an honest worker reconstructing a before-column after
 *     the fact (#106, #171) — not a worker trying to cheat.
 *   - It does not make the pre-fix artifact MANDATORY on any slice. Which contracts adopt it is a
 *     briefing decision, gated by `changed:` on the briefs, not by this contract.
 *   - No pixel is graded here and nothing about product appearance is claimed.
 */

/**
 * ## FIXED (#177) 2026-08-19
 *
 * `measured-before:<artifact>:<product>` landed in `done-when-rules.ts` as a tree proof:
 *   - vocabulary admits it (`DONE_WHEN_RULE_VOCABULARY.prefixes`), `isKnownDoneWhenRule`
 *     recognises it, and `partitionDoneWhen` classifies it as a tree proof so dispatch's
 *     at-least-one-tree-proof gate accepts cards that use it;
 *   - the artifact must exist (`missing` detail, distinct from ordering);
 *   - every product file matching the product glob that differs from the trusted spawn baseline
 *     must have an mtime STRICTLY GREATER than the artifact's — ordering comes from the filesystem,
 *     never from a self-declared timestamp in the artifact;
 *   - if no product file changed since the baseline, the rule FAILS (not vacuous, §7t);
 *   - baseline load for this kind skips the exact `targets` membership check (writeBaselineHashes
 *     records only `changed:` rules) but keeps every other fail-closed validation, including an
 *     absent baseline refusing.
 *
 * Existing vocabulary untouched: the six prefixes and `handoffs:all-done` still evaluate exactly
 * as before, and no existing card's rule block needs rewriting.
 */
const RULE = "measured-before:";

function tmpTree(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** Set mtime to a fixed epoch second, so ordering in the test is explicit rather than incidental. */
function stampMtime(file: string, epochSeconds: number): void {
  utimesSync(file, epochSeconds, epochSeconds);
}

function writeBaseline(baselineDir: string, files: Record<string, string>, targets: string[]): void {
  mkdirSync(baselineDir, { recursive: true });
  const record: SliceBaselineHashes = {
    schemaVersion: SLICE_BASELINE_SCHEMA,
    sliceId: "slice-177",
    recordedAt: new Date(0).toISOString(),
    treeRoot: "/tree",
    targets,
    files,
  };
  writeFileSync(path.join(baselineDir, "baseline-hashes.json"), JSON.stringify(record));
}

/**
 * A worktree in the state `contract-verify-cli` sees it: a pre-fix artifact and a product file,
 * with the caller choosing which was written first.
 *
 * @param artifactFirst - true models the correct ordering; false models the #106 shape, where the
 *   artifact was reconstructed after the resolver already embodied the fix.
 */
function sliceTree(artifactFirst: boolean): { tree: string; baselineDir: string } {
  const tree = tmpTree("measured-before-");
  const baselineDir = tmpTree("measured-before-trusted-");

  mkdirSync(path.join(tree, "evidence"), { recursive: true });
  mkdirSync(path.join(tree, "src"), { recursive: true });

  const artifact = path.join(tree, "evidence/pre-fix.json");
  const product = path.join(tree, "src/resolver.ts");

  // The product file existed at spawn and its pre-work hash is in the trusted baseline; the
  // artifact did not exist at spawn, which is why it is absent from baseline.files.
  writeFileSync(product, "export const before = 1;\n");
  writeBaseline(baselineDir, { "src/resolver.ts": "spawn-hash-not-the-current-one" }, [
    "changed:src/resolver.ts",
  ]);

  writeFileSync(artifact, JSON.stringify({ offenders: ["a", "b"] }));
  writeFileSync(product, "export const after = 2;\n");

  stampMtime(artifact, artifactFirst ? 1_000 : 2_000);
  stampMtime(product, artifactFirst ? 2_000 : 1_000);

  return { tree, baselineDir };
}

describe("a done_when can prove the pre-fix measurement came FIRST", () => {
  it("(1) RED: the vocabulary admits an ordering rule", () => {
    // The single source of truth must list it, or callers that validate proofs before dispatch
    // (board-brief, dispatch-worker) reject every contract that uses it.
    expect(
      DONE_WHEN_RULE_VOCABULARY.prefixes as readonly string[],
      "DONE_WHEN_RULE_VOCABULARY must admit an ordering rule",
    ).toContain(RULE);
    expect(
      isKnownDoneWhenRule(`${RULE}evidence/pre-fix.json:src/resolver.ts`),
      "isKnownDoneWhenRule must recognise it",
    ).toBe(true);
  });

  it("(2) RED COUNTERWEIGHT: a LATE artifact is refused — existence is not ordering", async () => {
    // This is the #106 shape and the reason clause (1) alone is not enough. Both orderings below
    // satisfy `exists:` and `changed:` identically; only ordering separates them.
    const good = sliceTree(true);
    const late = sliceTree(false);
    const rule = `${RULE}evidence/pre-fix.json:src/resolver.ts`;

    const onGood = await evaluateDoneWhenRule(good.tree, rule, "slice-177", {}, {
      baselineDir: good.baselineDir,
    });
    const onLate = await evaluateDoneWhenRule(late.tree, rule, "slice-177", {}, {
      baselineDir: late.baselineDir,
    });

    expect(onGood.passed, `artifact written first: ${onGood.detail}`).toBe(true);
    expect(onLate.passed, `artifact reconstructed after the edit: ${onLate.detail}`).toBe(false);

    // And prove the existing vocabulary genuinely cannot separate them, so this rule is not
    // duplicating a capability the tree already has (D1).
    for (const t of [good, late]) {
      const exists = await evaluateDoneWhenRule(t.tree, "exists:evidence/pre-fix.json", "slice-177", {}, {
        baselineDir: t.baselineDir,
      });
      const changed = await evaluateDoneWhenRule(t.tree, "changed:src/resolver.ts", "slice-177", {}, {
        baselineDir: t.baselineDir,
      });
      expect(exists.passed, "exists: is blind to ordering").toBe(true);
      expect(changed.passed, "changed: is blind to ordering").toBe(true);
    }
  });

  it("(3) RED COUNTERWEIGHT: it is not vacuous — an untouched product file refuses", async () => {
    // §7t: a rule that passes when no product edit happened is green about nothing. An artifact
    // written into a tree nobody edited must NOT satisfy an ordering claim about that edit.
    const tree = tmpTree("measured-before-vacuous-");
    const baselineDir = tmpTree("measured-before-vacuous-trusted-");
    mkdirSync(path.join(tree, "evidence"), { recursive: true });
    mkdirSync(path.join(tree, "src"), { recursive: true });

    const product = path.join(tree, "src/resolver.ts");
    writeFileSync(product, "export const untouched = 1;\n");
    // The baseline records the file's CURRENT hash, so it is unchanged since spawn.
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update("export const untouched = 1;\n").digest("hex");
    writeBaseline(baselineDir, { "src/resolver.ts": sha }, ["changed:src/resolver.ts"]);

    const artifact = path.join(tree, "evidence/pre-fix.json");
    writeFileSync(artifact, JSON.stringify({ offenders: [] }));
    stampMtime(artifact, 1_000);
    stampMtime(product, 2_000);

    const check = await evaluateDoneWhenRule(
      tree,
      `${RULE}evidence/pre-fix.json:src/resolver.ts`,
      "slice-177",
      {},
      { baselineDir },
    );
    expect(check.passed, `no product file changed: ${check.detail}`).toBe(false);

    // A missing artifact must also refuse, and say so distinctly from the ordering failure.
    const noArtifact = await evaluateDoneWhenRule(
      tree,
      `${RULE}evidence/absent.json:src/resolver.ts`,
      "slice-177",
      {},
      { baselineDir },
    );
    expect(noArtifact.passed).toBe(false);
    expect(noArtifact.detail).toMatch(/missing/i);
  });

  it("(4) NET known-good: the six existing prefixes and the exact rule still evaluate", async () => {
    // The vocabulary is load-bearing for every shipped contract — 1,025 recorded proofs across the
    // ledger. A fix that reshapes it to add ordering is not a fix.
    for (const prefix of ["exists:", "min-bytes:", "run:", "changed:", "handoff:", "skeptic:"]) {
      expect(
        DONE_WHEN_RULE_VOCABULARY.prefixes as readonly string[],
        `existing prefix ${prefix} must survive`,
      ).toContain(prefix);
      expect(isKnownDoneWhenRule(`${prefix}anything`), `${prefix} must stay recognised`).toBe(true);
    }
    expect(DONE_WHEN_RULE_VOCABULARY.exact as readonly string[]).toContain("handoffs:all-done");
    expect(isKnownDoneWhenRule("handoffs:all-done")).toBe(true);
    expect(isKnownDoneWhenRule("prose: the reviewer is happy")).toBe(false);

    // And the baseline mechanism this slice must not disturb — the premise that died above.
    const tree = tmpTree("measured-before-net-");
    const baselineDir = tmpTree("measured-before-net-trusted-");
    writeFileSync(path.join(tree, "tracked.ts"), "after\n");
    writeBaseline(baselineDir, { "tracked.ts": "before-hash" }, ["changed:tracked.ts"]);
    const changed = await evaluateDoneWhenRule(tree, "changed:tracked.ts", "slice-177", {}, {
      baselineDir,
    });
    expect(changed.passed, "changed: against a trusted spawn baseline still works").toBe(true);
  });
});
