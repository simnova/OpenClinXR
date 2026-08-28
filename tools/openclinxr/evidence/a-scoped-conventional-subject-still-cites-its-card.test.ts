/**
 * #743 — CORRECTED. Widening the subject matcher was wrong; machine attribution is the remedy.
 *
 * WHAT I FIRST CLAIMED, AND WHY IT WAS WRONG. This contract originally asserted that
 * `fix(#723 residual): ...` should count as a conventional claim on #723, and I widened the audit's
 * pattern to accept a scope suffix. Measured afterwards, on the peer's objection:
 *
 *   dd4c5829  fix(#723 residual): ...   touches a-frame-label-is-read-at-its-own-screenshot.test.ts
 *   b2b6e94f  test(#723 residual): ...  touches the same file
 *   issue-742's ledger names that exact test
 *   contract-verify-issue-742-merge.json: sliceId=issue-742, headSha=dd4c58298e, proofsOk=true
 *
 * BOTH COMMITS BELONG TO #742 AND CITE #723. The widening therefore promoted a misattribution from
 * a weak MENTION to a deliberate claim on the wrong card — strictly worse than the defect. Reverted.
 *
 * A subject is the AUTHOR'S CLAIM. This author claimed the wrong card, and no pattern should repair
 * that by making the wrong claim stronger.
 *
 * THE REMEDY, which this contract now asserts: a merge-verification artifact naming this issue's
 * sliceId, with passing proofs and a headSha on main, is explicit MACHINE attribution. It reaches
 * exactly the case subject parsing cannot, without weakening what a claim means.
 *
 * TWO REGEX FACTS, kept because they were measured and will otherwise be rediscovered: `\b` is not
 * a word boundary in `git log -E` (POSIX ERE) and a pattern using it silently matches NOTHING; and
 * `[^0-9)]` on a first suffix character is required or #72 matches `(#723 ...)`.
 *
 * THIS HEADER IS IMMUTABLE. Flip the assertion and append a `## FIXED (#743)` block below.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../..");
const AUDIT = resolve(REPO, "tools/openclinxr/openclaw/supervisor-audit.ts");

function subjectMatches(pattern: string): number {
  try {
    return execFileSync("git", ["log", "--all", "--format=%H", `--grep=${pattern}`, "-E"], {
      cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    }).split("\n").filter(Boolean).length;
  } catch {
    return -1;
  }
}

describe("#743 machine attribution reaches what a subject cannot, without weakening a claim", () => {
  it("(1) the audit attributes a land from a passing merge artifact", () => {
    const src = readFileSync(AUDIT, "utf8");
    // The artifact must be consulted, and it must be gated on ALL THREE of sliceId, proofsOk and
    // ancestry — any two of them would let a stale or foreign artifact claim a land.
    expect(src).toContain("landedByArtifact");
    expect(src).toMatch(/sliceId !== `issue-\$\{issue\}`/u);
    expect(src).toMatch(/parsed\.proofsOk !== true/u);
    expect(src).toMatch(/isAncestor\(artifactSha\)/u);
  });

  it("(2) the subject matcher stays STRICT — the widening is not reinstated", () => {
    // This is the counterweight that matters. #742's commits cite #723; a widened pattern counts
    // them as #723 claims. Three is the correct number for #723 and five was the wrong one.
    const src = readFileSync(AUDIT, "utf8");
    // The widened form is the thing that must NOT come back. Asserting its ABSENCE is exact and
    // does not depend on how the strict pattern is escaped in source.
    expect(src).not.toContain("([^0-9)][^)]*)?");
    expect(subjectMatches("^(fix|feat|test|refactor|perf|chore)\\(#723\\)")).toBe(3);
  });

  it("(3) COUNTERWEIGHT: the loose MENTION fallback survives", () => {
    const src = readFileSync(AUDIT, "utf8");
    expect(src).toMatch(/\(\^\|\[\^0-9\]\)#\$\{issue\}\(\[\^0-9\]\|\$\)/u);
  });

  it("(4) the known-good column: #742's artifact is the real fixture and is well formed", () => {
    // If this fails the fixture moved and clause (1) is asserting about nothing.
    const p = resolve(REPO, ".openclinxr/openclaw/contract-verify-issue-742-merge.json");
    expect(existsSync(p), "issue-742 merge artifact").toBe(true);
    const j = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    expect(j.sliceId).toBe("issue-742");
    expect(j.proofsOk).toBe(true);
    expect(String(j.headSha ?? "")).toMatch(/^dd4c5829/u);
  });
});
