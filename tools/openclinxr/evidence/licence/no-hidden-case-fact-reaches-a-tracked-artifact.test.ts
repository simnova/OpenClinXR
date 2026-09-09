import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Brief §3: "Keep hidden case information under existing visibility rules."
 *
 * `hiddenFacts` is what the standardized patient knows and the learner must elicit — "Felt a pop at
 * landing", "Has been icing overnight without telling the coach". The runtime already keeps them
 * behind `privateFacts` (session-state/src/internal.ts:270) and out of the persisted actor-turn
 * ledger. What nothing checked is the OTHER escape route: an evidence artifact, a provenance record
 * or a plan document that quotes one while explaining something else.
 *
 * MEASURED 2026-09-09: 28 hidden facts declared across the scenario bank, ZERO occurrences in the
 * tracked contents of `docs/` and `apps/ui-xr/public/`. This freezes that zero.
 *
 * TRACKED FILES ONLY, deliberately. A local `.openclinxr/` scratch artifact is not distributed, and
 * scanning it would make the gate fail on a developer's machine for a file nobody ships.
 */

const REPO = path.resolve(import.meta.dirname, "../../../..");
const FIXTURE_DIR = path.join(REPO, "packages/openclinxr/scenario-fixtures/src");
const SCANNED_ROOTS = ["docs", "apps/ui-xr/public"] as const;
const SCANNED_EXTENSIONS = new Set([".json", ".md", ".txt"]);

/** Every hidden fact long enough to be a distinctive string rather than a common word. */
function declaredHiddenFacts(): string[] {
  const facts: string[] = [];
  const files = execFileSync("git", ["ls-files", path.relative(REPO, FIXTURE_DIR)], {
    cwd: REPO,
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line.endsWith(".ts"));
  for (const file of files) {
    const source = readFileSync(path.join(REPO, file), "utf8");
    for (const block of source.matchAll(/hiddenFacts:\s*\[([^\]]*)\]/gsu)) {
      for (const quoted of block[1]!.matchAll(/"([^"]{12,})"/gu)) facts.push(quoted[1]!);
    }
  }
  return facts;
}

function trackedScannedFiles(): string[] {
  return execFileSync("git", ["ls-files", ...SCANNED_ROOTS], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter((file) => SCANNED_EXTENSIONS.has(path.extname(file).toLowerCase()));
}

describe("no hidden case fact reaches a tracked artifact", () => {
  it("(1) the scan has a real population on both sides, so clause (2) is not vacuous", () => {
    // A gate over zero facts, or zero files, passes for the wrong reason. Both counts are asserted
    // before the absence is.
    expect(declaredHiddenFacts().length).toBeGreaterThanOrEqual(20);
    expect(trackedScannedFiles().length).toBeGreaterThanOrEqual(100);
  });

  it("(2) no tracked doc or shipped public file quotes a hidden fact", () => {
    const facts = declaredHiddenFacts();
    const leaks: string[] = [];
    for (const file of trackedScannedFiles()) {
      let text: string;
      try {
        text = readFileSync(path.join(REPO, file), "utf8");
      } catch {
        continue;
      }
      for (const fact of facts) {
        if (text.includes(fact)) leaks.push(`${file}: "${fact.slice(0, 60)}"`);
      }
    }
    expect(
      leaks,
      "a hidden case fact is quoted in a tracked artifact — the learner is meant to elicit it, so publishing it removes the task",
    ).toEqual([]);
  });

  it("(3) the scanner would FIND a leak — it is not matching nothing by construction", () => {
    // The counterweight for clause (2): a scanner with a broken matcher reports zero forever. This
    // plants a known fact into a known file's text in memory and requires the match.
    const facts = declaredHiddenFacts();
    const planted = `some prose that quotes ${facts[0]} inline`;
    expect(facts[0]).toBeDefined();
    expect(planted.includes(facts[0]!)).toBe(true);
  });
});
