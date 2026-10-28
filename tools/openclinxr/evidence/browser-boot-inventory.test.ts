import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveExclusionPatterns,
  isExcludedRepoRel,
  readStringArrayLiteral,
} from "./browser-boot-inventory/exclusions.js";
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

/**
 * EPOCH NOTE (2026-10-28): the header block above is the HISTORICAL original
 * contract and is preserved verbatim, including the old `--write` pre-fix.json
 * regeneration lines and the 34-file historical reference. That historical
 * regeneration path is superseded for current freshness: current staleness and
 * exclusion obligations compare the NEW dated artifact
 * tools/openclinxr/evidence/browser-boot-inventory/current-20261028.json,
 * generated with the ACTUAL existing scanner CLI (which already supports --out):
 *   pnpm exec tsx tools/openclinxr/evidence/browser-boot-inventory.ts --write --out tools/openclinxr/evidence/browser-boot-inventory/current-20261028.json
 * The explicit --out is mandatory so the historical pre-fix.json bytes stay
 * unchanged. The historical file is still hash-guarded below (case 2); any byte
 * change to it fails the suite.
 */

const REPO_ROOT = findRepoRoot();
const HISTORICAL_PRE_FIX_PATH = path.join(REPO_ROOT, DEFAULT_PRE_FIX_PATH);
const EXPECTED_HISTORICAL_SHA256 =
  "f14d17bc79e904a8fdb802cd292a5c7da35fe4c2349a72f0be8e6964402661a5";
const CURRENT_PATH = path.join(
  REPO_ROOT,
  "tools",
  "openclinxr",
  "evidence",
  "browser-boot-inventory",
  "current-20261028.json",
);

function loadRecorded(): BrowserBootInventory {
  let raw: string;
  try {
    raw = readFileSync(CURRENT_PATH, "utf8");
  } catch {
    throw new Error(
      `browser-boot-inventory: ${path.relative(REPO_ROOT, CURRENT_PATH)} is missing. `
        + "Regenerate it with:\n"
        + "  pnpm exec tsx tools/openclinxr/evidence/browser-boot-inventory.ts --write --out tools/openclinxr/evidence/browser-boot-inventory/current-20261028.json\n"
        + "(explicit --out is mandatory so the historical pre-fix.json stays unchanged).",
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
    const historicalBytes = readFileSync(HISTORICAL_PRE_FIX_PATH);
    expect(
      createHash("sha256").update(historicalBytes).digest("hex"),
    ).toBe(EXPECTED_HISTORICAL_SHA256);
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
          + "  pnpm exec tsx tools/openclinxr/evidence/browser-boot-inventory.ts --write --out tools/openclinxr/evidence/browser-boot-inventory/current-20261028.json",
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

  it("derives wrapper exclusions from injected actual sources (9/3/2/2, non-empty)", () => {
    const pkg = { scripts: { "//#test:tools": "tsx tools/openclinxr/openclaw/run-tools-tests.ts" } };
    const runner = [
      'export const MANUAL_EXCLUDES: readonly string[] = ["m1","m2","m3","m4","m5","m6","m7","m8","m9"];',
      'export const ROOT_CONFIG_EXCLUDES: readonly string[] = ["r1","r2","r3"];',
      'import { PROJECT_ARCHIVE_EXCLUDES } from "./project-test-scope.js";',
      'export { PROJECT_ARCHIVE_EXCLUDES };',
      'export const SHARED_EXCLUDES_MODULE = "packages/cellix/config-vitest/src/worktree-excludes.ts";',
    ].join("\n");
    const patterns = deriveExclusionPatterns("/repo", {
      packageJsonText: JSON.stringify(pkg),
      runnerText: runner,
      sharedText: 'export const worktreeExcludePatterns = ["s1","s2"] as const;',
      scopeText: 'export const PROJECT_ARCHIVE_EXCLUDES: readonly string[] = ["a1","a2"];',
    });
    expect(patterns).toHaveLength(9 + 3 + 2 + 2);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("keeps legacy direct --exclude support", () => {
    const pkg = { scripts: { "//#test:tools": "vitest run tools --exclude a.test.ts --exclude b.test.ts" } };
    expect(deriveExclusionPatterns("/repo", { packageJsonText: JSON.stringify(pkg) })).toEqual(["a.test.ts", "b.test.ts"]);
  });

  it("fails closed on missing/non-literal/unsupported sources", () => {
    const pkg = { scripts: { "//#test:tools": "tsx tools/openclinxr/openclaw/run-tools-tests.ts" } };
    const base = {
      packageJsonText: JSON.stringify(pkg),
      runnerText: 'export const MANUAL_EXCLUDES: readonly string[] = ["m"];',
      sharedText: 'export const worktreeExcludePatterns = ["s"] as const;',
      scopeText: 'export const PROJECT_ARCHIVE_EXCLUDES: readonly string[] = ["a"];',
    };
    expect(() => deriveExclusionPatterns("/repo", { ...base, runnerText: "export const X = 1;" })).toThrow();
    expect(() => readStringArrayLiteral('export const A = [foo];', "A", "f.ts")).toThrow();
    expect(() => deriveExclusionPatterns("/repo", { packageJsonText: JSON.stringify({ scripts: {} }) })).toThrow();
    expect(() => deriveExclusionPatterns("/repo", { ...base, packageJsonText: JSON.stringify({ scripts: { "//#test:tools": "echo tsx tools/openclinxr/openclaw/run-tools-tests.ts" } }) })).toThrow();
  });

  it("classifies rows with matchesGlob, not Set.has (glob patterns cover files)", () => {
    expect(isExcludedRepoRel("x/audible-lip-sync-proof/capture.test.mjs", ["**/audible-lip-sync-proof/capture.test.mjs"])).toBe(true);
    expect(isExcludedRepoRel("tools/openclinxr/evidence/other.test.ts", ["**/audible-lip-sync-proof/capture.test.mjs"])).toBe(false);
    expect(isExcludedRepoRel("tools/a.test.ts", ["tools/a.test.ts"])).toBe(true);
  });

  it("reads shared as-const initializer ([...] as const)", () => {
    expect(readStringArrayLiteral('export const worktreeExcludePatterns = ["s1","s2"] as const;', "worktreeExcludePatterns", "s.ts")).toEqual(["s1", "s2"]);
  });

  it("derives Root wrapper tsx tools/openclinxr/openclaw/run-tools-tests.ts with frozen actual SHARED as-const", () => {
    const pkg = { scripts: { "//#test:tools": "tsx tools/openclinxr/openclaw/run-tools-tests.ts" } };
    const runner = [
      'export const MANUAL_EXCLUDES: readonly string[] = ["m"];',
      'export const ROOT_CONFIG_EXCLUDES: readonly string[] = ["r"];',
      'import { PROJECT_ARCHIVE_EXCLUDES } from "./project-test-scope.js";',
      'export const SHARED_EXCLUDES_MODULE = "shared.ts";',
    ].join("\n");
    const patterns = deriveExclusionPatterns("/repo", {
      packageJsonText: JSON.stringify(pkg),
      runnerText: runner,
      sharedText: 'export const worktreeExcludePatterns = (["s"]) as const;',
      scopeText: 'export const PROJECT_ARCHIVE_EXCLUDES: readonly string[] = ["a"];',
    });
    expect(patterns).toEqual(["a", "m", "r", "s"]);
  });

  it("fails closed on namespace decoy, comment import decoy, and wrapper-with-flags", () => {
    const pkg = { scripts: { "//#test:tools": "tsx tools/openclinxr/openclaw/run-tools-tests.ts" } };
    const good = {
      packageJsonText: JSON.stringify(pkg),
      runnerText: [
        'export const MANUAL_EXCLUDES = ["m"];',
        'export const ROOT_CONFIG_EXCLUDES = ["r"];',
        'import { PROJECT_ARCHIVE_EXCLUDES } from "./project-test-scope.js";',
        'export const SHARED_EXCLUDES_MODULE = "s.ts";',
      ].join("\n"),
      sharedText: 'export const worktreeExcludePatterns = ["s"] as const;',
      scopeText: 'export const PROJECT_ARCHIVE_EXCLUDES = ["a"];',
    };
    const ns = { ...good, scopeText: 'namespace N { export const PROJECT_ARCHIVE_EXCLUDES = ["fake"]; }' };
    expect(() => deriveExclusionPatterns("/repo", ns)).toThrow();
    const comment = {
      ...good,
      runnerText: [
        '// import { PROJECT_ARCHIVE_EXCLUDES } from "./evil.js";',
        'export const MANUAL_EXCLUDES = ["m"];',
        'export const ROOT_CONFIG_EXCLUDES = ["r"];',
        'export const SHARED_EXCLUDES_MODULE = "s.ts";',
      ].join("\n"),
    };
    expect(() => deriveExclusionPatterns("/repo", comment)).toThrow();
    const withFlags = { ...good, packageJsonText: JSON.stringify({ scripts: { "//#test:tools": "tsx tools/openclinxr/openclaw/run-tools-tests.ts --exclude x" } }) };
    expect(() => deriveExclusionPatterns("/repo", withFlags)).toThrow();
  });

  it("matchesGlob handles ? and [] metacharacters", () => {
    expect(isExcludedRepoRel("tools/ab.test.ts", ["tools/a?.test.ts"])).toBe(true);
    expect(isExcludedRepoRel("tools/abc.test.ts", ["tools/a?.test.ts"])).toBe(false);
    expect(isExcludedRepoRel("tools/ab.test.ts", ["tools/a[ab].test.ts"])).toBe(true);
  });

  it("supports legacy direct vitest without excludes (empty list)", () => {
    const pkg = { scripts: { "//#test:tools": "vitest run tools" } };
    expect(deriveExclusionPatterns("/repo", { packageJsonText: JSON.stringify(pkg) })).toEqual([]);
  });

  it("supports recognized pnpm exec vitest and rejects unknown wrappers even with flags", () => {
    const pkg = { scripts: { "//#test:tools": "pnpm exec vitest run tools" } };
    expect(deriveExclusionPatterns("/repo", { packageJsonText: JSON.stringify(pkg) })).toEqual([]);
    const unknown = { scripts: { "//#test:tools": "myrunner --exclude x" } };
    expect(() => deriveExclusionPatterns("/repo", { packageJsonText: JSON.stringify(unknown) })).toThrow();
    const echo = { scripts: { "//#test:tools": 'echo "tsx tools/openclinxr/openclaw/run-tools-tests.ts"' } };
    expect(() => deriveExclusionPatterns("/repo", { packageJsonText: JSON.stringify(echo) })).toThrow();
  });

  it("counts suite minima over eligible rows only (excluded file still listed)", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "browser-inventory-eligible-"));
    try {
      const toolsDir = path.join(tempRoot, "tools");
      mkdirSync(toolsDir, { recursive: true });
      const marker = "chromium.launch()\nspawnPortlessDevServer()\n";
      writeFileSync(path.join(toolsDir, "kept.test.ts"), `// kept\n${marker}`, "utf8");
      writeFileSync(path.join(toolsDir, "excluded.test.ts"), `// excluded\n${marker}`, "utf8");
      writeFileSync(
        path.join(tempRoot, "package.json"),
        JSON.stringify({ scripts: { "//#test:tools": "vitest run tools --exclude tools/excluded.test.ts" } }),
        "utf8",
      );
      const inv = buildBrowserBootInventory(tempRoot);
      expect(inv.rows.length).toBe(2);
      expect(inv.rows.filter((r) => r.excludedFromTestTools).length).toBe(1);
      expect(inv.minBrowsersPerSuiteRun).toBe(1);
      expect(inv.minServersPerSuiteRun).toBe(1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
