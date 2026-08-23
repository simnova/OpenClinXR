import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateDoneWhenRule, writeBaselineHashes } from "./done-when-rules.js";

/**
 * A `changed:` rule whose target is a DIRECTORY crashes the dispatch instead of being handled or
 * refused. #93, hit twice in one night by the orchestrator, on two different slices.
 *
 * MEASURED 2026-08-11 against this tree, calling the current API:
 *
 *   changed:docs/madr      -> EISDIR: illegal operation on a directory, read
 *   changed:package.json   -> OK, fileCount=1
 *
 * CAUSE, located: `done-when-rules.ts:78-82` (`resolveExistsTargets`) returns the path itself for any
 * non-wildcard target that exists — directory or not — and `sha256File` (`:97-99`) then calls
 * `readFileSync` on the directory inode.
 *
 * The crash fires at DISPATCH, after `briefFromIssue` has already accepted the rule and after a
 * worktree exists. `briefFromIssue` is the layer whose whole job is refusing malformed contracts, and
 * it passes this straight through. The message names neither the rule, the path, nor the constraint.
 *
 * DECISION — DIRECTORIES ARE SUPPORTED. Taken by the orchestrator, not left to the implementer.
 * "Some file under `apps/ui-xr/src` changed" is a legitimate assertion and is what was meant both
 * times. `walkFiles` (`:63-76`, recursive, files-only) already exists and is already used by the
 * wildcard branch, so supporting directories WIRES A PROVEN HELPER (D1); refusing them would add a
 * gate and force brittle file enumeration in every brief.
 *
 * Rejected alternative: refuse at brief time with a message naming the rule and path. It is coherent
 * and cheaper, and it loses a genuinely useful assertion. If you think it is the better call, say so
 * in your report and implement the decided design anyway.
 *
 * AGGREGATION POLICY — AT-LEAST-ONE, AND ONLY FOR DIRECTORIES. This is the part that cannot be left
 * implicit. The current rule is `passed = unchanged.length === 0 && changed.length > 0`: EVERY matched
 * file must change. For a directory that is unsatisfiable — no real slice rewrites every file under a
 * subtree — so a directory target means "at least one file beneath it changed".
 *
 * **File and wildcard targets keep all-must-change semantics, untouched.** Contract (3) is the
 * known-good column that pins this: the narrowest change that fixes the crash is the whole change.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                          | (1) dir works | (2) outside-only | (3) file semantics
 *   -----------------------------------|---------------|------------------|-------------------
 *   today: EISDIR throw                |     FAIL      |      FAIL        |       pass
 *   directory target always passes     |     pass      |    **FAIL**      |       pass
 *   hash the whole tree root, not dir  |     pass      |    **FAIL**      |       pass
 *   walkFiles under the directory      |     pass      |      pass        |       pass
 *
 * (2) is what stops a directory rule becoming a free pass: a rule naming `sub/` must NOT go green
 * because some unrelated file elsewhere in the tree moved. Both cheap fixes are caught by it, and it
 * is demonstrably able to fail.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today — (2) fails for the
 * same EISDIR reason as (1), because the baseline cannot even be written. (3) PASSES today and is the
 * known-good column.
 *
 * NOT TESTED: whether an at-least-one directory rule over a very broad root (`changed:apps`) is
 * usefully strict — it is nearly free to satisfy, but that is a property of the rule an orchestrator
 * chooses to write, not of this evaluator, and gating it would need a breadth threshold nobody has
 * measured. Also untested: whether `briefFromIssue` should warn on broad directory targets, and
 * whether symlinks under a directory target should be followed (`walkFiles` currently takes
 * `entry.isFile()`, so a symlinked file is skipped).
 */

type Fixture = { root: string; baselineDir: string };

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "dwr-dir-"));
  const baselineDir = mkdtempSync(path.join(tmpdir(), "dwr-bl-"));
  mkdirSync(path.join(root, "sub", "nested"), { recursive: true });
  writeFileSync(path.join(root, "sub", "a.txt"), "a-original\n");
  writeFileSync(path.join(root, "sub", "nested", "b.txt"), "b-original\n");
  writeFileSync(path.join(root, "outside.txt"), "outside-original\n");
  return { root, baselineDir };
}

const NO_HANDOFFS = {};

describe("a changed: rule can name a directory", () => {
  it(
    "(1) RED: a directory target snapshots the files beneath it and goes green when one of them changes",
    async () => {
      const { root, baselineDir } = makeFixture();
      const rules = ["changed:sub"];

      const snapshot = await writeBaselineHashes({
        treeRoot: root,
        baselineDir,
        sliceId: "dir-target",
        rules,
      });
      expect(snapshot.fileCount, "both files beneath sub/ are in the baseline").toBe(2);

      // exactly one file beneath the directory changes — the ordinary case
      writeFileSync(path.join(root, "sub", "a.txt"), "a-MODIFIED\n");

      const check = await evaluateDoneWhenRule(root, "changed:sub", "dir-target", NO_HANDOFFS, {
        baselineDir,
      });
      expect(check.passed, check.detail).toBe(true);
    },
  );

  it(
    "(2) RED COUNTERWEIGHT: a directory target stays RED when only a file OUTSIDE it changed — it is not a free pass",
    async () => {
      const { root, baselineDir } = makeFixture();

      await writeBaselineHashes({
        treeRoot: root,
        baselineDir,
        sliceId: "dir-outside",
        rules: ["changed:sub"],
      });

      // nothing beneath sub/ moves; an unrelated file elsewhere in the tree does
      writeFileSync(path.join(root, "outside.txt"), "outside-MODIFIED\n");

      const check = await evaluateDoneWhenRule(root, "changed:sub", "dir-outside", NO_HANDOFFS, {
        baselineDir,
      });
      expect(check.passed, check.detail).toBe(false);
    },
  );

  it("(3) NET known-good: a FILE target keeps all-must-change semantics exactly as today", async () => {
    const { root, baselineDir } = makeFixture();
    const rules = ["changed:outside.txt", "changed:sub/a.txt"];

    const snapshot = await writeBaselineHashes({
      treeRoot: root,
      baselineDir,
      sliceId: "file-target",
      rules,
    });
    expect(snapshot.fileCount).toBe(2);

    writeFileSync(path.join(root, "outside.txt"), "outside-MODIFIED\n");

    const changedFile = await evaluateDoneWhenRule(
      root,
      "changed:outside.txt",
      "file-target",
      NO_HANDOFFS,
      { baselineDir },
    );
    expect(changedFile.passed, changedFile.detail).toBe(true);

    const untouchedFile = await evaluateDoneWhenRule(
      root,
      "changed:sub/a.txt",
      "file-target",
      NO_HANDOFFS,
      { baselineDir },
    );
    expect(untouchedFile.passed, untouchedFile.detail).toBe(false);
  });
});

/**
 * ## FIXED (#579)
 *
 * Both REDs flipped; the header's diagnosis and measured table are untouched above.
 *
 * - `resolveExistsTargets` (done-when-tree.ts) now expands a non-wildcard DIRECTORY target to the
 *   files beneath it via the proven `walkFiles` helper (recursive, files-only) — the same helper
 *   the wildcard branch already used. The EISDIR crash at baseline-write and eval time is gone,
 *   and `measured-before:`'s identical hashing exposure is repaired by the same change.
 * - The `changed:` branch (done-when-rules.ts) aggregates DIRECTORY targets AT-LEAST-ONE
 *   (`passed = changed.length > 0`); file and wildcard targets keep all-must-change semantics
 *   exactly as before (clause (3) pins this and passes unmodified).
 * - DECISION (header-mandated, restated): a directory target means "at least one file beneath it
 *   changed". It is not refused at brief time and not every-file.
 *
 * NOT TESTED (unchanged from header, plus): breadth strictness of a broad root like
 * `changed:apps`; symlinked files under a directory target are still skipped by `walkFiles`.
 */
