/**
 * #743 — a conventional subject with a scope suffix is downgraded to MENTION ONLY.
 *
 * THE DEFECT, MEASURED 2026-08-28 — do not re-derive this.
 *
 *   supervisor-audit.ts matches a deliberate claim with
 *     ^(fix|feat|test|refactor|perf|chore)\(#N\)
 *   which requires the close paren IMMEDIATELY after the number. Two real commits on #723 carry a
 *   word inside the scope and are therefore not counted as claims:
 *
 *     dd4c5829  fix(#723 residual): record the dominant read on both sides of each frame's screenshot
 *     b2b6e94f  test(#723 residual): plant RED — a frame's label is read before its own screenshot
 *
 *   Counted with `git log --all --grep -E`: strict 3, loose fallback 7, so those two fall through to
 *   the fallback the audit treats as the weaker MENTION ONLY signal. One trailing word demotes a
 *   conventional commit to a mention.
 *
 * THE OBVIOUS FIX IS WRONG AND WAS MEASURED BEFORE PROPOSING. `\(#N\b[^)]*\)` returns ZERO matches:
 * `git log -E` is POSIX ERE, where `\b` is not a word boundary. A pattern that silently matches
 * nothing is worse than the defect it replaces, and this is the one place that would not have shown
 * up as a test failure — it would have looked like "no commits cite this card".
 *
 * WHAT THIS DOES NOT FIX: #742, which is how it surfaced. Its work landed in dd4c5829, whose subject
 * cites #723. No matcher attributes a commit to a card the commit does not name. That stays
 * correctly flagged and is recorded on #742 as a provenance error.
 *
 * THIS HEADER IS IMMUTABLE. Flip the assertion and append a `## FIXED (#743)` block below.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../..");
const AUDIT = resolve(REPO, "tools/openclinxr/openclaw/supervisor-audit.ts");

/** Count commits whose SUBJECT matches an ERE, through the same engine the audit uses. */
function subjectMatches(pattern: string): number {
  try {
    return execFileSync("git", ["log", "--all", "--format=%H", `--grep=${pattern}`, "-E"], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\n")
      .filter(Boolean).length;
  } catch {
    return -1;
  }
}

/** The pattern the audit currently ships, read from source so this cannot drift from it. */
function shippedSubjectPattern(issue: number): string {
  const src = readFileSync(AUDIT, "utf8");
  const m = src.match(/--grep=\^\(fix\|feat\|test\|refactor\|perf\|chore\)([^"`]*)/u);
  if (!m) throw new Error("could not read the subject pattern from supervisor-audit.ts");
  return `^(fix|feat|test|refactor|perf|chore)${m[1]!.replace(/\\\\/gu, "\\").replace(/\$\{issue\}/u, String(issue))}`;
}

describe("#743 a conventional subject with a scope suffix still cites its card", () => {
  it.fails("(1) RED: fix(#723 residual) counts as a claim on #723", () => {
    const n = subjectMatches(shippedSubjectPattern(723));
    // 3 today; the two `residual` commits bring it to 5.
    expect(n, "subject-form claims on #723").toBeGreaterThanOrEqual(5);
  });

  it("(2) the known-good column: the plain form has always counted", () => {
    // If this fails the pattern stopped matching ordinary subjects and clause (1) is measuring a
    // broken matcher rather than a narrow one.
    expect(subjectMatches("^fix\\(#723\\)")).toBeGreaterThanOrEqual(2);
  });

  it("(3) COUNTERWEIGHT: a shorter number does not swallow a longer one", () => {
    // The cheapest wrong fix is `\\(#N[^)]*\\)`, which lets #72 match `(#723 ...)`. The leading
    // [^0-9)] in the accepted form is what prevents that, and this clause is why it is there.
    const asIf72 = "^(fix|feat|test|refactor|perf|chore)\\(#72([^0-9)][^)]*)?\\)";
    expect(subjectMatches(asIf72), "#72 must not match #723's commits").toBe(0);
  });

  it("(4) COUNTERWEIGHT: the loose fallback survives", () => {
    // MENTION ONLY is a real signal the audit reports differently. Widening the strict pattern must
    // not delete the fallback that catches a body-only reference.
    const src = readFileSync(AUDIT, "utf8");
    expect(src).toMatch(/\(\^\|\[\^0-9\]\)#\$\{issue\}\(\[\^0-9\]\|\$\)/u);
  });

  it("(5) COUNTERWEIGHT: the pattern is still anchored to the subject start", () => {
    // Dropping the ^ would match a #N mentioned anywhere in a body and erase the distinction
    // between a deliberate claim and a mention entirely.
    const src = readFileSync(AUDIT, "utf8");
    expect(src).toContain("--grep=^(fix|feat|test|refactor|perf|chore)");
  });
});
