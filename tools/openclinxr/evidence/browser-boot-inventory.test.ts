import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BrowserBootInventory,
  buildBrowserBootInventory,
  DEFAULT_PRE_FIX_PATH,
  findRepoRoot,
  parseTestToolsExcludes,
} from "./browser-boot-inventory.js";

/**
 * ISSUE #284 — browser-boot inventory staleness guard.
 *
 * #282, a pure geometry-predicate slice, ran 35 node processes and ~30 headless
 * Chrome shells (load 61) because nothing gates the dev-server / browser class
 * the way #273 gated TRELLIS live bakes. This test does not boot anything — it
 * is a PURE STATIC SCAN that re-derives which `*.test.ts` files under `tools/`
 * transitively reach `spawnPortlessDevServer` / `chromium.launch` and compares
 * that set against the frozen measurement artifact
 * `.openclinxr/evidence/issue-284/pre-fix.json`.
 *
 * THREE ASSERTIONS (per the issue's done_when):
 *   1. the inventory is non-empty,
 *   2. every row names its acquisition mode (own vs shared),
 *   3. the recorded set still matches a fresh scan — a staleness guard, so the
 *      inventory reds when someone adds a browser-booting test rather than
 *      silently drifting.
 *
 * REGENERATION (only when a browser-booting test is added/removed on purpose):
 *   pnpm exec tsx tools/openclinxr/evidence/browser-boot-inventory.ts --write
 *   git add -f .openclinxr/evidence/issue-284/pre-fix.json
 * (the artifact lives under the gitignored .openclinxr/ tree and is force-added
 * on purpose — a deliverable under a gitignored path has no land path otherwise).
 *
 * CLAIM SCOPE: this scan proves STATIC REACHABILITY — which test files COULD
 * boot a browser/server when the suite runs. It does not prove how many
 * processes any single run actually spawns (the isolated-subject-harness caches
 * one server+browser per file; some launchers are conditional). The 34-file set
 * is the load-61 class: zero of its members are excluded from //#test:tools and
 * none is runtime-guarded (no describe.skip / process.env gates measured).
 */

const REPO_ROOT = findRepoRoot();
const PRE_FIX_PATH = path.join(REPO_ROOT, DEFAULT_PRE_FIX_PATH);

function loadRecorded(): BrowserBootInventory {
  let raw: string;
  try {
    raw = readFileSync(PRE_FIX_PATH, "utf8");
  } catch {
    throw new Error(
      `browser-boot-inventory: ${path.relative(REPO_ROOT, PRE_FIX_PATH)} is missing. `
        + "Regenerate it with:\n"
        + "  pnpm exec tsx tools/openclinxr/evidence/browser-boot-inventory.ts --write\n"
        + `then commit it with 'git add -f ${path.relative(REPO_ROOT, PRE_FIX_PATH)}' `
        + "(it lives under the gitignored .openclinxr/ tree).",
    );
  }
  return JSON.parse(raw) as BrowserBootInventory;
}

describe("browser-boot inventory (#284)", () => {
  it("is non-empty and every row names its acquisition mode", () => {
    const fresh = buildBrowserBootInventory();
    expect(fresh.browserBootingTestFiles).toBeGreaterThan(0);
    expect(fresh.rows.length).toBeGreaterThan(0);
    for (const row of fresh.rows) {
      expect(row.acquisitionMode.length).toBeGreaterThan(0);
      expect(["own", "shared"]).toContain(row.acquisitionMode);
    }
  });

  it("recorded pre-fix.json still matches a fresh scan (staleness guard)", () => {
    const recorded = loadRecorded();
    const fresh = buildBrowserBootInventory();

    const byFile = (inv: BrowserBootInventory): Map<string, BrowserBootInventory["rows"][number]> =>
      new Map(inv.rows.map((r) => [r.testFile, r]));
    const rec = byFile(recorded);
    const cur = byFile(fresh);

    const missingInRecord = fresh.rows
      .filter((r) => !rec.has(r.testFile))
      .map((r) => r.testFile)
      .sort();
    const missingInFresh = recorded.rows
      .filter((r) => !cur.has(r.testFile))
      .map((r) => r.testFile)
      .sort();
    const changed = fresh.rows
      .filter((r) => {
        const other = rec.get(r.testFile);
        return (
          other !== undefined
          && (other.excludedFromTestTools !== r.excludedFromTestTools
            || other.acquisitionMode !== r.acquisitionMode
            || other.ownsServer !== r.ownsServer
            || other.ownsBrowser !== r.ownsBrowser)
        );
      })
      .map((r) => r.testFile)
      .sort();

    const problems: string[] = [];
    if (missingInRecord.length > 0) {
      problems.push(`browser-booting test(s) NOT recorded in pre-fix.json: ${missingInRecord.join(", ")}`);
    }
    if (missingInFresh.length > 0) {
      problems.push(`recorded test(s) no longer browser-booting: ${missingInFresh.join(", ")}`);
    }
    if (changed.length > 0) {
      problems.push(`recorded row(s) changed (exclusion / acquisition mode / ownership): ${changed.join(", ")}`);
    }
    if (problems.length > 0) {
      throw new Error(
        "browser-boot inventory is stale.\n"
          + `${problems.join("\n")}\n`
          + "Regenerate the artifact with:\n"
          + "  pnpm exec tsx tools/openclinxr/evidence/browser-boot-inventory.ts --write\n"
          + "and commit the regenerated pre-fix.json (git add -f).",
      );
    }
  });

  it("recorded testToolsExclusions covers every --exclude in //#test:tools", () => {
    const recorded = loadRecorded();
    const parsed = parseTestToolsExcludes(REPO_ROOT);
    const recordedFiles = new Set(recorded.testToolsExclusions.map((e) => e.testFile));
    for (const f of parsed) {
      expect(recordedFiles.has(f), `missing exclusion reason for ${f}`).toBe(true);
    }
    expect(recorded.testToolsExclusions.length).toBe(parsed.length);
  });
});
