import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #455 — the IWSDK sidecar spike runs 0.5.1 while npm publishes 0.5.3.
 *
 * This is the operator's ask ("simulation of headset should be done locally using the updated
 * latest version of IWSDK") reduced to the one thing that was blocking it. #454 fixed the
 * instrument that was lying about it; this is the bump the instrument now demands.
 *
 * ## MEASURED (orchestrator, 2026-08-19)
 *
 *   pnpm iwsdk:npm-currentness:validate  ->  EXIT 1, six blockers, five of them
 *     npm_latest_version_moved:<pkg>:snapshot_0.5.1_live_0.5.3
 *     npm_metadata_snapshot_too_old:captured_2026-08-02_age_days_17_max_days_14
 *
 * KNOWN-GOOD COLUMN (SS9h) — the spike on 0.5.1, measured before any edit. The bump must hold
 * every one of these, and the `done_when` re-runs all three:
 *
 *   | measure                        | on 0.5.1        |
 *   |--------------------------------|-----------------|
 *   | `pnpm typecheck` (spike)       | EXIT 0          |
 *   | `pnpm build` (spike)           | EXIT 0, 1.35 s  |
 *   | `dist/assets/iwsdk-vendor-*.js`| 6,842.37 kB     |
 *   | `pnpm test` (spike)            | 36 passed       |
 *
 * ## THE TRAP THIS SLICE MUST NOT WALK INTO — measured, not predicted
 *
 * I simulated an honest snapshot re-capture (every 0.5.1 -> 0.5.3, live agreeing) and the gate
 * STILL fails, on the OTHER mechanism:
 *
 *   npm_latest_version_moved:@iwsdk/core:expected_0.5.1_actual_0.5.3      <- the hand-coded table
 *
 * There are two comparisons in that runner and they mean DIFFERENT THINGS. Do not collapse them:
 *
 *   | column                        | means                                    | source |
 *   |-------------------------------|------------------------------------------|--------|
 *   | snapshot `latestVersion`      | what npm said when we last looked        | OBSERVATION |
 *   | `expectedPackages.latestVersion` | the version a human last REVIEWED     | POLICY |
 *   | the spike's `package.json` pin| what we actually run                     | CHOICE |
 *
 * `expected_X_actual_Y` is not vestigial — it means "a release shipped that nobody reviewed."
 * **This slice IS that review**, so updating the expected table to 0.5.3 is correct and honest.
 * Deleting the mechanism is not (SS6p: a contract that removes something must say what replaces it).
 * And `expected_latest_version` is NOT the pin: `@iwsdk/vite-plugin-dev` is reviewed at 0.5.3 and
 * still PINNED at 0.5.1. Conflating those two columns is the whole trap.
 *
 * ## WHY vite-plugin-dev STAYS PINNED
 *
 * Measured: `@iwsdk/vite-plugin-dev@0.5.3` peers `vite: "^7.0.0"` — UNCHANGED from 0.5.1. The
 * repo catalog is vite `8.0.16` (`pnpm-workspace.yaml:14`). `@iwsdk/core@0.5.3` and
 * `@iwsdk/scene-composition@0.5.3` declare NO peers; `@iwsdk/xr-input@0.5.3` peers only
 * `three: ">=0.160.0"` and the catalog is `0.184.0`. So the three runtime packages move and the
 * dev plugin does not. All four are MIT.
 *
 * ## TWO FINDINGS FROM #454's RETRO, BOTH INHERITED HERE
 *
 * 1. **The 14-day bound was fitted, and its author said so unprompted** — mirrored from a number
 *    in my own vacuity guard, "not derived from any policy or observed cadence." Clause (5) below
 *    fixes that by bounding it against npm's ACTUAL release history for `@iwsdk/core`, measured
 *    over the last 10 releases: gaps min 0, **median 10**, mean 16.8, max 63 days. A bound inside
 *    [10, 17] catches a median release before the next one lands. That is an external floor, not
 *    a taste. Any value outside the measured band is refused — including the current 14 if the
 *    cadence later moves.
 * 2. **Clause (4) of #454 is string containment** and its author flagged that it could be
 *    satisfied by text in a comment or a dead branch. Clause (4) here asserts the FENCE
 *    BEHAVIOURALLY instead — no `@iwsdk` key in the ui-xr manifest's resolved dependency map.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED   — the three runtime pins are 0.5.1 today.
 *   (2) RED   — the newest snapshot records 0.5.1 and is 17 days old.
 *   (3) NET   — vite-plugin-dev stays 0.5.1. Passes today, must keep passing.
 *   (4) NET   — the ui-xr fence. Passes today, must keep passing.
 *   (5) RED   — the age bound is not exported and carries no derivation.
 *   (6) GUARD — the fixture axes are distinct.
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) bump the pins, leave the snapshot stale        -> (2) fails
 *   b) re-capture the snapshot, leave the pins        -> (1) fails
 *   c) bump vite-plugin-dev too, "for consistency"    -> (3) fails; its vite ^7 peer is unchanged
 *   d) widen the age bound to hide the stale snapshot -> (5) fails; 14 -> 60 leaves the band
 *   e) add @iwsdk to apps/ui-xr                       -> (4) fails
 *
 * NOT TESTED:
 *   - Anything in a headset, or in a browser. `pnpm build` and `pnpm test` are the bar here.
 *   - That 0.5.3 is BETTER. Only that the spike still typechecks, builds and passes 36 tests on it.
 *   - `@iwsdk/vite-plugin-dev` on vite 8. Unchanged peer, still blocked, still recorded.
 *   - `apps/ui-xr`. Vanilla three.js, sidecar-only, fence up.
 *   - Bundle SIZE as a budget. The known-good column records 6,842.37 kB as a FACT to compare
 *     against, not a ceiling to defend — a legitimate upstream change may move it either way.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const SPIKE = join(REPO_ROOT, "apps/arena/ui-xr-iwsdk-spike/package.json");
const UI_XR = join(REPO_ROOT, "apps/ui-xr/package.json");
const RUNNER = join(HERE, "iwsdk-npm-currentness-check.ts");
/** Computed so TypeScript cannot resolve a not-yet-exported symbol at compile time (#383/#352). */
const SPECIFIER = ["./iwsdk-npm-currentness", "check.js"].join("-");

const TARGET = "0.5.3";
const RUNTIME_PACKAGES = ["@iwsdk/core", "@iwsdk/xr-input", "@iwsdk/scene-composition"] as const;
const PINNED_BEHIND = "@iwsdk/vite-plugin-dev";

/**
 * npm release history for @iwsdk/core, last 10 releases, measured 2026-08-19:
 * gaps 0, 33, 27, 8, 10, 63, 0, 10, 0 days -> median 10, mean 16.8.
 * A staleness bound inside this band expires roughly one release cycle after capture.
 */
const CADENCE_MEDIAN_DAYS = 10;
const CADENCE_MEAN_DAYS = 17;

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const readManifest = (p: string): Manifest => JSON.parse(readFileSync(p, "utf8")) as Manifest;
const allDeps = (m: Manifest): Record<string, string> => ({ ...m.dependencies, ...m.devDependencies });

type Snapshot = { capturedAt: string; packages: Array<{ name: string; latestVersion: string }> };

/** The snapshot the runner would load: newest by filename, the same rule `latestPath` uses. */
function newestSnapshot(): { file: string; data: Snapshot } {
  const dir = join(REPO_ROOT, "docs/openclinxr");
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(dir)
    .filter((f) => /^iwsdk-npm-metadata-snapshot-.*\.json$/u.test(f))
    .sort();
  const file = files[files.length - 1] as string;
  return { file, data: JSON.parse(readFileSync(join(dir, file), "utf8")) as Snapshot };
}

const mod = await (async () => {
  try {
    return (await import(SPECIFIER)) as { SNAPSHOT_MAX_AGE_DAYS?: number };
  } catch {
    return {};
  }
})();

describe("the IWSDK sidecar runs the current release", () => {
  it("(1) RED: the three runtime packages are pinned at 0.5.3", () => {
    const deps = allDeps(readManifest(SPIKE));
    for (const name of RUNTIME_PACKAGES) {
      expect(deps[name], `${name} must be pinned at ${TARGET} — npm published it on 2026-08-11`).toBe(TARGET);
    }
  });

  it("(2) RED: the newest snapshot records the current release and is not stale", () => {
    // Refuses (a). Bumping the pins while leaving a 17-day-old 0.5.1 snapshot on disk means the
    // gate that motivated this slice still exits 1.
    const { file, data } = newestSnapshot();
    const byName = new Map(data.packages.map((p) => [p.name, p.latestVersion]));
    for (const name of RUNTIME_PACKAGES) {
      expect(byName.get(name), `${file} must record ${name} at ${TARGET}`).toBe(TARGET);
    }
    const bound = mod.SNAPSHOT_MAX_AGE_DAYS ?? 14;
    const ageDays = (Date.now() - new Date(data.capturedAt).getTime()) / 86_400_000;
    expect(ageDays, `${file} was captured ${ageDays.toFixed(1)} days ago; the bound is ${bound}`).toBeLessThan(
      bound,
    );
  });

  it("(3) COUNTERWEIGHT: the dev plugin stays pinned — its vite peer is unchanged at 0.5.3", () => {
    // Refuses (c). Measured: @iwsdk/vite-plugin-dev@0.5.3 still peers vite ^7.0.0 against a
    // catalog on 8.0.16. Bumping it "for consistency" adopts a peer conflict for no gain.
    const deps = allDeps(readManifest(SPIKE));
    expect(deps[PINNED_BEHIND], `${PINNED_BEHIND} stays at 0.5.1 until its vite peer accepts 8.x`).toBe(
      "0.5.1",
    );
  });

  it("(4) COUNTERWEIGHT: apps/ui-xr carries no @iwsdk dependency — sidecar-only holds", () => {
    // Refuses (e). Behavioural, not a source-string check: #454's retro flagged that its own
    // containment check could be satisfied by text in a comment. This reads the resolved map.
    const deps = allDeps(readManifest(UI_XR));
    const leaked = Object.keys(deps).filter((k) => k.startsWith("@iwsdk/"));
    expect(leaked, `apps/ui-xr stays vanilla three.js; IWSDK is a sidecar spike`).toEqual([]);
  });

  it("(5) RED: the staleness bound is exported and sits inside the measured release cadence", () => {
    // Refuses (d). Widening the bound to hide a stale snapshot leaves the band and fails. The
    // band comes from npm's own release history, not from taste — see the header.
    expect(
      mod.SNAPSHOT_MAX_AGE_DAYS,
      `iwsdk-npm-currentness-check.ts must export SNAPSHOT_MAX_AGE_DAYS — today the bound is an `
        + `unexported literal at :74 whose author recorded it as "not derived from any policy or `
        + `observed cadence"`,
    ).toBeTypeOf("number");
    const bound = mod.SNAPSHOT_MAX_AGE_DAYS as number;
    expect(bound, `below the median 10-day release gap the gate reds on healthy snapshots`).toBeGreaterThanOrEqual(
      CADENCE_MEDIAN_DAYS,
    );
    expect(bound, `above the ${CADENCE_MEAN_DAYS}-day mean gap a whole release can pass unnoticed`).toBeLessThanOrEqual(
      CADENCE_MEAN_DAYS,
    );
  });

  it("(6) VACUITY GUARD: the axes under test are distinct and the inputs are really there", () => {
    expect(RUNTIME_PACKAGES).not.toContain(PINNED_BEHIND);
    expect(CADENCE_MEDIAN_DAYS).toBeLessThan(CADENCE_MEAN_DAYS);
    expect(readFileSync(RUNNER, "utf8").length, "the runner is readable, so absence is real").toBeGreaterThan(0);
    expect(newestSnapshot().data.packages.length, "the snapshot has packages to check").toBeGreaterThan(0);
  });
});
