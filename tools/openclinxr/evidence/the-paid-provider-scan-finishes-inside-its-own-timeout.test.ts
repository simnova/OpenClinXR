import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **The land path is closed: no commit staging `apps/**` can pass pre-commit.** The paid-provider
 * credential scan in `packages/openclinxr/architecture-rules/src/workspace-architecture.test.ts`
 * exceeds its own 5,000 ms timeout, so `architecture` fails, so the commit is refused.
 *
 * ## CORRECTED PREMISE — #352 says "times out under contention". IT ALSO FAILS AT REST.
 *
 * That is the claim to act on. The withdrawn half, kept only as a fence: contention was blamed and
 * contention is real but secondary — it inflates the number, it does not cause the failure.
 *
 * Measured 2026-08-14:
 *
 *   condition                                    duration    timeout   result
 *   -------------------------------------------  ----------  --------  ------
 *   standalone, `-t "paid-provider"`, quiet       **9,409ms**  5,000ms   FAIL
 *   inside pre-commit, 15 worker processes         7,619ms    5,000ms   FAIL
 *   inside pre-commit, 49 worker processes        13,542ms    5,000ms   FAIL
 *
 * Contention moves it 7.6s -> 13.5s. The floor is already 1.9x the timeout.
 *
 * ## THE MECHANISM, MEASURED — do not re-derive
 *
 * `workspaceConfigAndEnvFiles()` (`workspace-architecture.test.ts:1795-1806`):
 *
 *   1. `walk(workspaceRoot)` — a full-tree walk. **55,650 files** excluding `.git` and
 *      `node_modules`, ~3.2 s per walk. The tree grew: provider caches, `glb-grade-staging`,
 *      evidence artifacts.
 *   2. filters to ~**100 candidates**, then calls `isGitIgnoredWorkspacePath` on each, and that
 *      helper (`:1808-1812`) **spawns `git check-ignore` via `execFileSync` once per file** —
 *      ~10.4 ms per spawn, ~1.0 s total.
 *   3. `paidProviderPolicyTextFiles()` (`:1787`) is called **three times inside the one failing
 *      test**, with **no memoisation**. So: 3 walks + 300 subprocess spawns.
 *
 * Predicted 3 x (3.2 + 1.0) = 12.6 s against an observed 9.4 s — same order, and the walk dominates.
 *
 * ## THE FIX IS TO WIRE A PROVEN TOOL, NOT TO TUNE A NUMBER (D1)
 *
 * `git ls-files` returns **3,073** tracked files in one subprocess. That is an **18x** smaller
 * enumeration and it is *already* the semantically correct set — the scan spends 100 subprocesses
 * re-deriving "not gitignored", which is precisely what `git ls-files` means. One call replaces a
 * 55,650-file walk plus 100 spawns.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                    | (1) cold | (2) memoised | (3) anchors | (4) excludes | (5) timeout | result
 *   ---------------------------------------------|----------|--------------|-------------|--------------|-------------|--------
 *   a) today (no module at all)                  | **FAIL** |   **FAIL**   |   **FAIL**  |   **FAIL**   |    pass     | REFUSED
 *   b) raise the timeout to 30s                  | **FAIL** |   **FAIL**   |   **FAIL**  |   **FAIL**   |  **FAIL**   | REFUSED
 *   c) stop calling check-ignore (fastest "fix") |   pass   |     pass     |    pass     |   **FAIL**   |    pass     | REFUSED
 *   d) narrow the scan to a hardcoded file list  |   pass   |     pass     |  **FAIL**   |     pass     |    pass     | REFUSED
 *   e) enumerate via `git ls-files`, memoised    |   pass   |     pass     |    pass     |     pass     |    pass     | ALL PASS
 *
 * **(c) is the one to watch and it is why clause (4) exists.** Deleting the ignore check removes 100
 * subprocesses and makes everything fast — and silently starts scanning developers' real local
 * secrets, which is the exact property the companion test was written to guarantee. `.envrc` exists
 * on this machine and IS gitignored, so clause (4) is not vacuous. **(b) is why clause (5) exists**
 * (SS9s: a threshold moved to cover a residual is fitting, not fixing).
 *
 * ## THE BOUND IN CLAUSE (1) IS DERIVED, NOT FITTED (SS9s)
 *
 * 2,500 ms sits between today's ~4,200 ms for ONE cold call and the ~200 ms a `git ls-files`
 * enumeration costs. It fails today by 1.7x and the correct implementation clears it by ~12x, so it
 * is not a number chosen to be just-passable. It is deliberately generous because this runs on a
 * contended machine — the point is to force the mechanism, not to police milliseconds.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1), (2) and (3) are REDS and fail today because the
 * module does not exist. (4) and (5) are counterweights; (5) passes today, and (4) fails today ONLY
 * because there is nothing to ask — it becomes meaningful the moment the module exists, which is why
 * it asserts the property rather than the module's presence.
 *
 * NOT TESTED:
 *   - **That the architecture suite as a whole now passes.** This bounds the scan helper. Whether
 *     every other test in that suite fits its own timeout is a separate question.
 *   - **Contention.** Nothing here runs under load; the claim is that the AT-REST floor is fixed.
 *   - **That `git ls-files` is the right enumeration for every future caller.** It is right for a
 *     scan that already excludes gitignored files. A caller wanting untracked files needs something
 *     else, and this contract does not speak for it.
 *   - **Whether the scan finds real credentials.** Only that it enumerates the same files.
 */

/**
 * ## FIXED (#352) 2026-08-14
 *
 * The scan moved to `packages/openclinxr/architecture-rules/src/checks/paid-provider-scan.ts`
 * (`collectPaidProviderPolicyFiles()`): a single `git ls-files` subprocess (~3,074 tracked files,
 * gitignored excluded by construction) replaces the 55,650-file walk plus ~100 per-file
 * `git check-ignore` spawns, and the result is memoised per process. The suite's
 * `paidProviderPolicyTextFiles()` delegates to it; the old walk-based `runtimePolicySourceFiles()`
 * and `workspaceConfigAndEnvFiles()` helpers were removed from the suite.
 *
 * Measured on this worktree, standalone:
 *
 *   cold enumeration:    22 ms   (budget 2,500 ms; old helper ~4,200 ms for one call)
 *   warm (memoised):      0 ms   (budget 50 ms)
 *   policy file count:   872     (tracked set; anchors all present, `.envrc` excluded)
 *   architecture suite: 73/73    in 7.55 s
 *
 * Clauses (1)–(4) flipped from `it.fails` to live assertions; clause (5) counterweight unchanged.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const SUITE = join(
  REPO_ROOT,
  "packages/openclinxr/architecture-rules/src/workspace-architecture.test.ts",
);

/**
 * Computed specifier: the module does not exist yet, and a literal would fail `pnpm typecheck`
 * before the slice starts. Resolves normally once written.
 */
const SCAN_MODULE = [
  "..",
  "..",
  "..",
  "packages",
  "openclinxr",
  "architecture-rules",
  "src",
  "checks",
  "paid-provider-scan.js",
].join("/");

/** Derived in the header: today ~4,200 ms for one cold call; `git ls-files` costs ~200 ms. */
const COLD_BUDGET_MS = 2_500;
/** A memoised second call is a return, not a scan. Generous by 3 orders of magnitude. */
const WARM_BUDGET_MS = 50;

/** Anchors the scan must still reach. Taken from the suite's own arrayContaining assertion. */
const REQUIRED_ANCHORS = [
  ".env.openclinxr.local.example",
  "package.json",
  "turbo.json",
  "vitest.config.ts",
  "apps/ui-xr/vite.config.ts",
];

/** Exists on this machine AND is gitignored — the scan must never return it. */
const MUST_EXCLUDE = ".envrc";

type Scan = { collectPaidProviderPolicyFiles: () => string[] };

async function loadScan(): Promise<Scan | null> {
  try {
    const mod: Record<string, unknown> = await import(SCAN_MODULE);
    const fn = mod.collectPaidProviderPolicyFiles;
    return typeof fn === "function" ? { collectPaidProviderPolicyFiles: fn as () => string[] } : null;
  } catch {
    return null;
  }
}

const scan = await loadScan();

/** Cold timing is taken ONCE, before any other clause warms the memo. */
const cold = (() => {
  if (!scan) return { ms: Number.POSITIVE_INFINITY, files: [] as string[] };
  const t0 = performance.now();
  const files = scan.collectPaidProviderPolicyFiles();
  return { ms: performance.now() - t0, files };
})();

const warm = (() => {
  if (!scan) return { ms: Number.POSITIVE_INFINITY, files: [] as string[] };
  const t0 = performance.now();
  const files = scan.collectPaidProviderPolicyFiles();
  return { ms: performance.now() - t0, files };
})();

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireSuite(): void {
  expect(readFileSync(SUITE, "utf8").length, `${SUITE} is readable and non-empty`).toBeGreaterThan(
    1000,
  );
}

describe("the paid-provider scan finishes inside its own timeout", () => {
  it("(1) RED: a cold enumeration completes well inside the suite's 5s timeout", () => {
    requireSuite();
    expect(
      scan,
      "packages/openclinxr/architecture-rules/src/checks/paid-provider-scan.ts exporting collectPaidProviderPolicyFiles",
    ).not.toBeNull();
    expect(
      Math.round(cold.ms),
      `cold enumeration ms (budget ${COLD_BUDGET_MS}; today the in-suite helper walks 55,650 files and spawns 100 subprocesses)`,
    ).toBeLessThanOrEqual(COLD_BUDGET_MS);
  });

  it("(2) RED: a second enumeration is memoised, not re-walked", () => {
    requireSuite();
    expect(scan, "the extracted scan module").not.toBeNull();
    expect(
      Math.round(warm.ms),
      `warm enumeration ms (budget ${WARM_BUDGET_MS}); the failing test calls this helper THREE times and pays the full walk each time`,
    ).toBeLessThanOrEqual(WARM_BUDGET_MS);
  });

  it("(3) RED: the enumeration still reaches every documented anchor", () => {
    // Refuses (d): making it fast by scanning less. These names come from the suite's own
    // arrayContaining assertion, not from a list I invented.
    requireSuite();
    expect(scan, "the extracted scan module").not.toBeNull();
    const missing = REQUIRED_ANCHORS.filter((a) => !cold.files.includes(a));
    expect(missing, "documented anchors the scan no longer returns").toEqual([]);
  });

  it("(4) COUNTERWEIGHT: a gitignored local env file is still excluded", () => {
    // Refuses (c), the FASTEST wrong fix: deleting the ignore check removes 100 subprocesses and
    // starts scanning a developer's real secrets. `.envrc` exists here and is gitignored.
    // This is `it.fails` today only because the module does not exist; it asserts a PROPERTY, so it
    // becomes a live counterweight the moment it does.
    requireSuite();
    expect(scan, "the extracted scan module").not.toBeNull();
    expect(cold.files, `${MUST_EXCLUDE} is gitignored and must never be scanned`).not.toContain(
      MUST_EXCLUDE,
    );
  });

  it("(5) COUNTERWEIGHT: neither paid-provider test grows a per-test timeout", () => {
    // Refuses (b): raising the number to cover the residual (SS9s). Both tests currently take the
    // default timeout — they end `});`, with no `}, N);` argument. The file's existing 20_000 and
    // 60_000 literals belong to other tests and are untouched by this clause.
    requireSuite();
    const source = readFileSync(SUITE, "utf8");
    const offenders: string[] = [];
    for (const title of [
      "keeps gitignored local env files out of paid-provider policy scans",
      "scans package scripts, config files, env templates, and tools for paid provider credentials",
    ]) {
      const start = source.indexOf(title);
      if (start < 0) {
        offenders.push(`test "${title}" no longer exists — it must not be deleted to reach green`);
        continue;
      }
      const block = source.slice(start, start + 4000);
      const end = block.search(/\n {2}\}(?:,\s*[0-9_]+)?\);/u);
      const closing = end >= 0 ? block.slice(end, end + 40) : "";
      if (/\n {2}\},\s*[0-9_]+\);/u.test(closing)) {
        offenders.push(`test "${title}" gained an explicit timeout: ${closing.trim().slice(0, 24)}`);
      }
    }
    expect(offenders, "paid-provider tests whose timeout was raised instead of fixed").toEqual([]);
  });
});
