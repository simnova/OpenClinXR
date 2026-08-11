import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { packagesNeedingRebuild } from "../openclaw/integrate.ts";

/**
 * #152 / #196 SURVIVED THEIR OWN FIX — the land path rebuilds the right PACKAGES in the WRONG ORDER.
 *
 * MEASURED 2026-08-10 on the #291 land (merge 87eb8cb2, head a880669f). `integrate` merged cleanly
 * and then threw:
 *
 *   integrate: landed, but rebuilding @openclinxr/scenario-fixtures FAILED — the checkout is stale
 *
 * main was briefly un-buildable. The cause is one line, `integrate.ts:243`:
 *
 *   return [...names].sort();
 *
 * That is ALPHABETICAL, and the caller builds in the order returned. For the #291 change set the
 * order was measured to be exactly:
 *
 *   [ '@openclinxr/scenario-fixtures', '@openclinxr/shared-schemas' ]
 *
 * and `packages/openclinxr/scenario-fixtures/package.json` declares
 * `"@openclinxr/shared-schemas": "workspace:*"`. So the CONSUMER was rebuilt before its DEPENDENCY,
 * against a `dist/` that predated the new `ActorPhenotypeSchema` field. tsgo reported
 * `TS2353: 'phenotype' does not exist in type` three times — which reads like the worker authored a
 * bad fixture, when in fact the fixture was correct and the type it was checked against was stale.
 * Building `@openclinxr/shared-schemas` first and re-running the identical command cleared all four
 * errors with no source change.
 *
 * WHY ALPHABETICAL IS NOT MERELY "USUALLY FINE": measured across the workspace there are 27
 * build-emitting packages and 48 intra-workspace dependency edges. 5+ of those edges are ordered
 * wrongly by ASCENDING sort and 8+ by DESCENDING sort. Both directions are broken; they are just
 * broken on different pairs.
 *
 * THE CHEAP FIX THIS CONTRACT REFUSES. Reversing the sort makes the #291 case pass — `shared-schemas`
 * sorts after `scenario-fixtures`, so descending puts the dependency first. Contract (2) exists
 * solely to kill that: `@openclinxr/asset-registry` must precede `@openclinxr/scenario-runtime`, and
 * descending sort puts them the other way round. No alphabetical order in either direction satisfies
 * (1) and (2) at once. Only a real topological sort does.
 *
 * KNOWN-GOOD COLUMN. Contract (3) is the shape that already works today and must keep working: a
 * change set with no intra-set edge is unconstrained, so ordering must not drop, duplicate, or
 * invent a package. A topological sort that returns [] would satisfy (1) and (2) vacuously.
 *
 * NOT TESTED: whether every build-emitting package's manifest declares its real build inputs. A
 * dependency that exists only as a deep import and not in package.json is invisible to this ordering
 * and to the fix. That residual is the reason this contract asserts on edges it can SEE.
 *
 * ## FIXED (#292)
 *
 * `integrate.ts` now exports `orderPackagesForRebuild(names, repoRoot)` — a pure topological sort
 * over declared `workspace:*` dependencies restricted to the changed set — and
 * `packagesNeedingRebuild` delegates its ordering to it. The measured #291 pair now orders
 * dependency-first (`shared-schemas` before `scenario-fixtures`), the
 * `asset-registry`-before-`scenario-runtime` counterweight holds (no alphabetical direction
 * satisfies both), and the known-good unconstrained set is preserved exactly once. A dependency
 * cycle among the changed set throws rather than falling back to alphabetical order.
 */

const REPO_ROOT = "/Volumes/files/src/openclinxr";

/** The land that exposed this. Permanent history, so the refs are stable. */
const MERGE_BASE_REF = "87eb8cb2^";
const MERGE_HEAD_REF = "a880669f";

function declaredWorkspaceDependencies(pkgDir: string): string[] {
  const manifestPath = join(REPO_ROOT, pkgDir, "package.json");
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
}

function packageDirForName(name: string): string | undefined {
  const out = execFileSync("git", ["ls-files", "packages/*/*/package.json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  for (const line of out.split("\n")) {
    const path = line.trim();
    if (!path) continue;
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, path), "utf8")) as { name?: string };
    if (manifest.name === name) return path.replace(/\/package\.json$/u, "");
  }
  return undefined;
}

function indexOfOrFail(order: string[], name: string): number {
  const index = order.indexOf(name);
  expect(index, `${name} missing from rebuild order ${JSON.stringify(order)}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("integrate rebuilds changed packages in dependency order", () => {
  it(
    "(1) puts @openclinxr/shared-schemas before its consumer @openclinxr/scenario-fixtures — the measured #291 land",
    () => {
      const order = packagesNeedingRebuild(REPO_ROOT, MERGE_BASE_REF, MERGE_HEAD_REF);

      // Guard the fixture itself: if this change set stops containing both packages the contract is
      // vacuous and must say so rather than pass.
      expect(order).toContain("@openclinxr/shared-schemas");
      expect(order).toContain("@openclinxr/scenario-fixtures");

      // And the dependency edge this rests on must really be declared.
      const consumerDir = packageDirForName("@openclinxr/scenario-fixtures");
      expect(consumerDir, "scenario-fixtures package dir").toBeTruthy();
      expect(declaredWorkspaceDependencies(consumerDir!)).toContain("@openclinxr/shared-schemas");

      expect(indexOfOrFail(order, "@openclinxr/shared-schemas")).toBeLessThan(
        indexOfOrFail(order, "@openclinxr/scenario-fixtures"),
      );
    },
  );

  it(
    "(2) COUNTERWEIGHT: puts @openclinxr/asset-registry before @openclinxr/scenario-runtime — refuses a reversed alphabetical sort",
    async () => {
      // asset-registry < scenario-runtime alphabetically, so DESCENDING order breaks this pair while
      // fixing contract (1). Both must hold simultaneously.
      const consumerDir = packageDirForName("@openclinxr/scenario-runtime");
      expect(consumerDir, "scenario-runtime package dir").toBeTruthy();
      expect(declaredWorkspaceDependencies(consumerDir!)).toContain("@openclinxr/asset-registry");

      const order = await orderForNames([
        "@openclinxr/scenario-runtime",
        "@openclinxr/asset-registry",
      ]);
      expect(indexOfOrFail(order, "@openclinxr/asset-registry")).toBeLessThan(
        indexOfOrFail(order, "@openclinxr/scenario-runtime"),
      );
    },
  );

  it(
    "(3) KNOWN-GOOD: an unconstrained set keeps every package exactly once — a topological sort must not drop or invent",
    async () => {
      const input = ["@openclinxr/shared-schemas", "@openclinxr/asset-registry"];
      const order = await orderForNames(input);
      expect([...order].sort()).toEqual([...input].sort());
      expect(new Set(order).size).toBe(order.length);
    },
  );
});

/**
 * The ordering entry point this contract requires. `packagesNeedingRebuild` currently discovers AND
 * orders in one step, which makes the ordering untestable without a git ref for every case. The fix
 * exposes ordering as its own pure function over package names; this shim keeps the contract honest
 * about that requirement and fails loudly until it exists.
 */
async function orderForNames(names: string[]): Promise<string[]> {
  const integrateModule = (await import("../openclaw/integrate.ts")) as {
    orderPackagesForRebuild?: (names: string[], repoRoot: string) => string[];
  };
  if (typeof integrateModule.orderPackagesForRebuild !== "function") {
    throw new Error(
      "integrate.ts must export orderPackagesForRebuild(names, repoRoot) so rebuild ordering is testable without a git ref per case",
    );
  }
  return integrateModule.orderPackagesForRebuild(names, REPO_ROOT);
}
