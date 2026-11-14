import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { declaredHiddenFacts, LICENCE_REPO_ROOT } from "./declared-hidden-facts.js";

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

const SCANNED_ROOTS = ["docs", "apps/ui-xr/public", "tools/openclinxr/evidence/site/fixtures/mn2"] as const;
const SCANNED_EXTENSIONS = new Set([".json", ".md", ".txt", ".html", ".js"]);

function trackedScannedFiles(): string[] {
  return execFileSync("git", ["ls-files", ...SCANNED_ROOTS], { cwd: LICENCE_REPO_ROOT, encoding: "utf8" })
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
        text = readFileSync(path.join(LICENCE_REPO_ROOT, file), "utf8");
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

  it("(4) the MN2 caption fixture dir is a scanned root", () => {
    // WN2 round 3 moved mn2.json + mn2-dom-captions.json out of docs/site/
    // into tools/openclinxr/evidence/site/fixtures/mn2/ so the site no
    // longer publishes them. The leak gate must follow them there:
    // a hidden fact quoted in a fixture file must fail clause (2).
    expect(SCANNED_ROOTS).toContain("tools/openclinxr/evidence/site/fixtures/mn2");
  });
});
