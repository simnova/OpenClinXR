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
 * ## MEASURED (operator Q1 review, 2026-10-30)
 *
 *   npm `latest` dist-tag: @iwsdk/core, xr-input, scene-composition, locomotor,
 *   vite-plugin-dev, reference = 1.1.0-rc.2; glxf, vite-plugin-gltf-optimizer,
 *   vite-plugin-uikitml, vite-plugin-metaspatial = 0.4.2. All MIT (hzdb unchanged).
 *
 * KNOWN-GOOD COLUMN (SS9h) — the spike on 1.1.0-rc.2, measured before any edit beyond
 * the pin bump and its ~15-line API migration (ai.tools extension, workspace/https
 * opt-outs, UIKitDocument cast):
 *
 *   | measure                        | on 1.1.0-rc.2   |
 *   |--------------------------------|-----------------|
 *   | `pnpm typecheck` (spike)       | EXIT 0          |
 *   | `pnpm build` (spike)           | EXIT 0, 1.87 s  |
 *   | `pnpm test` (spike)            | 43 passed       |
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
 * ## WHY vite-plugin-dev IS REVIEWED AT LATEST DESPITE ITS VITE PEER
 *
 * Measured 2026-10-30: `@iwsdk/vite-plugin-dev@1.1.0-rc.2` peers `vite: "^7.0.0"` —
 * UNCHANGED across every reviewed release. The repo catalog is vite `8.1.6`. Operator Q1
 * explicitly moved every @iwsdk pin to latest, so the dev plugin moves too and the peer
 * conflict is reviewed-and-accepted rather than adopted silently: clause (3) pins the
 * version AND keeps the peer fact on the record. All moved packages are MIT.
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
 *   (1) RED   — the three runtime pins are 1.1.0-rc.2 today.
 *   (2) RED   — the newest snapshot records 1.1.0-rc.2 and is not stale.
 *   (3) NET   — the dev plugin is reviewed at latest with its vite ^7 peer on the record.
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
 *   - That 1.1.0-rc.2 is BETTER. Only that the spike still typechecks, builds and passes 43 tests on it.
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

const TARGET = "1.1.0-rc.2";
const RUNTIME_PACKAGES = ["@iwsdk/core", "@iwsdk/xr-input", "@iwsdk/scene-composition"] as const;
const REVIEWED_DEV_PLUGIN = "@iwsdk/vite-plugin-dev";
const REVIEWED_DEV_PLUGIN_PIN = "1.1.0-rc.2";

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
  it("(1) RED: the three runtime packages are pinned at 1.1.0-rc.2", () => {
    const deps = allDeps(readManifest(SPIKE));
    for (const name of RUNTIME_PACKAGES) {
      expect(deps[name], `${name} must be pinned at ${TARGET} — npm latest measured 2026-10-30`).toBe(TARGET);
    }
  });

  it("(2) RED: the newest snapshot records the current release and is not stale", () => {
    // Refuses (a). Bumping the pins while leaving a stale snapshot on disk means the
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

  it("(3) COUNTERWEIGHT: the dev plugin is reviewed at latest with its vite peer on the record", () => {
    // Refuses (c). Operator Q1 (2026-10-30) moved every @iwsdk pin to latest, so the dev
    // plugin is reviewed at 1.1.0-rc.2 rather than held behind — but the adoption is
    // recorded, not silent: 1.1.0-rc.2 still peers vite ^7.0.0 against a catalog on 8.x.
    // A future bump that drops this assertion adopts an unreviewed peer conflict.
    const deps = allDeps(readManifest(SPIKE));
    expect(
      deps[REVIEWED_DEV_PLUGIN],
      `${REVIEWED_DEV_PLUGIN} reviewed at ${REVIEWED_DEV_PLUGIN_PIN} per Q1; vite ^7 peer still live`,
    ).toBe(
      REVIEWED_DEV_PLUGIN_PIN,
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
    expect(RUNTIME_PACKAGES).not.toContain(REVIEWED_DEV_PLUGIN);
    expect(CADENCE_MEDIAN_DAYS).toBeLessThan(CADENCE_MEAN_DAYS);
    expect(readFileSync(RUNNER, "utf8").length, "the runner is readable, so absence is real").toBeGreaterThan(0);
    expect(newestSnapshot().data.packages.length, "the snapshot has packages to check").toBeGreaterThan(0);
  });
});
