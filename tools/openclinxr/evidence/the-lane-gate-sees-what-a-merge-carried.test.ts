import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { measureProductLaneState, PRODUCT_IDLE_LIMIT } from "../openclaw/product-lane-gate.js";

/**
 * **OBSERVABLE: the product-lane clock counts what a merge actually carried.**
 *
 * ## MEASURED ON HEAD fa1e1918, 2026-08-23 — do not re-derive
 *
 * `measureProductLaneState` reads history with
 * `git log --pretty=... --name-only -n 400`. **`git log --name-only` emits ZERO file lines for a
 * merge commit** unless `-m` is passed. Every `integrate()` lands via `git merge --no-ff`, so every
 * landing adds a commit the gate scores as touching nothing — i.e. as evidence-only.
 *
 *     commit     default --name-only   with -m   subject
 *     f9d42d61        0 files            34      Merge commit '1d8cb218'   <- carried pregnancy_target.py
 *     9b15c143        0 files             3      Merge commit '39897710'
 *
 * Same 20-commit window, same product-path list, `-m` the only difference:
 *
 *     current   (no -m)   evidenceOnly = 9   firstProduct = bf103dbb   (#585)
 *     corrected (with -m) evidenceOnly = 1   firstProduct = f9d42d61   (#581 merge)
 *
 * **9 versus 1 against a limit of 4.** The gate refused dispatch on a window a correct measurement
 * passes with three to spare, and the counter ratchets toward permanent refusal because every
 * landing inflates the clock it is supposed to reset.
 *
 * ## WHAT THIS DOES NOT CHANGE — and the fix must not touch
 *
 * `PRODUCT_IDLE_LIMIT` stays 4. Merges get no exemption. `integrate` gets no special case. A
 * measurement bug is a reason to measure correctly, never to loosen a threshold — the refusals
 * earlier today were EARNED, on a genuine instrument-only stretch.
 *
 * ## HERMETIC BY CONSTRUCTION
 *
 * Every fixture below is a throwaway git repo in tmp. The gate must read HISTORY, never the working
 * tree, so a fixture that needed the real repo would be measuring the machine instead of the code.
 *
 * claimScope: whether the evidence-only clock sees files carried by a merge commit.
 * notEvidenceFor: whether the limit of 4 is right; whether any dispatch should have been refused.
 */

const PRODUCT_FILE = "packages/openclinxr/thing.ts";
const EVIDENCE_FILE = "tools/openclinxr/evidence/probe.ts";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
}

function write(root: string, rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
}

/** A repo whose newest commit is a --no-ff MERGE carrying `carried`, on top of `depth` evidence commits. */
function repoWithMerge(carried: string, depth: number): string {
  const root = mkdtempSync(join(tmpdir(), "lane-gate-"));
  git(root, ["init", "-q", "-b", "main"]);
  write(root, "seed.txt", "seed");
  git(root, ["add", "-A"]); git(root, ["commit", "-qm", "seed"]);
  for (let i = 0; i < depth; i += 1) {
    write(root, EVIDENCE_FILE, `probe ${i}`);
    git(root, ["add", "-A"]); git(root, ["commit", "-qm", `evidence ${i}`]);
  }
  git(root, ["checkout", "-q", "-b", "wt/slice"]);
  write(root, carried, "carried by the merge");
  git(root, ["add", "-A"]); git(root, ["commit", "-qm", "slice work"]);
  git(root, ["checkout", "-q", "main"]);
  git(root, ["merge", "--no-ff", "--no-edit", "-q", "wt/slice"]);
  return root;
}

describe("the lane gate sees what a merge carried", () => {
  it.fails("(1) RED: a merge carrying a product path resets the evidence-only clock", () => {
    // 6 evidence commits then a merge carrying packages/**. The clock must read 0 — the newest
    // commit IS a product landing. Today --name-only reports the merge as touching nothing.
    const root = repoWithMerge(PRODUCT_FILE, 6);
    const state = measureProductLaneState(root);
    expect(state.evidenceOnlyCommits, "the merge carried a product path and must reset the clock").toBe(0);
  });

  it.fails("(2) RED: the reset names the merge, not a commit behind it", () => {
    const root = repoWithMerge(PRODUCT_FILE, 6);
    const state = measureProductLaneState(root);
    expect(state.lastProductCommit?.subject ?? "", "lastProductCommit must be the merge itself")
      .toMatch(/Merge/u);
  });

  it("(3) KNOWN-GOOD COLUMN: a plain evidence commit still counts as evidence-only", () => {
    // Pins the behaviour that must NOT change. Without this, clause (1) could be satisfied by
    // returning 0 unconditionally, and the gate would stop measuring anything at all.
    const root = mkdtempSync(join(tmpdir(), "lane-gate-plain-"));
    git(root, ["init", "-q", "-b", "main"]);
    // Seed with a PRODUCT file so the walk terminates there and the count is exactly the evidence
    // commits above it. Seeding with a neutral file made this 4, not 3 — my fixture arithmetic, not
    // the code: the root commit touches no product path and is itself evidence-only.
    write(root, PRODUCT_FILE, "seed");
    git(root, ["add", "-A"]); git(root, ["commit", "-qm", "seed product"]);
    for (let i = 0; i < 3; i += 1) {
      write(root, EVIDENCE_FILE, `probe ${i}`);
      git(root, ["add", "-A"]); git(root, ["commit", "-qm", `evidence ${i}`]);
    }
    expect(measureProductLaneState(root).evidenceOnlyCommits, "three evidence commits must count as three")
      .toBe(3);
  });

  it("(4) COUNTERWEIGHT: a merge carrying NO product path is still evidence-only", () => {
    // Refuses the cheap green on (1) — "a merge always resets the clock" would make every landing
    // a free reset and delete the anti-toil signal entirely. This one carries evidence only.
    const root = repoWithMerge("tools/openclinxr/evidence/other-probe.ts", 4);
    const state = measureProductLaneState(root);
    expect(state.evidenceOnlyCommits, "a merge carrying only evidence must NOT reset the clock")
      .toBeGreaterThan(0);
    expect(PRODUCT_IDLE_LIMIT, "the threshold is not what this card changes").toBe(4);
  });
});
