import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #454 — the IWSDK currentness gate reports `passed: true` while two releases behind.
 *
 * The operator asked for "the updated latest version of IWSDK". The instrument that is
 * supposed to answer that question cannot: it is green by construction.
 *
 * ## MEASURED BEFORE THIS CARD EXISTED (orchestrator, 2026-08-19)
 *
 *   live npm         @iwsdk/core, xr-input, scene-composition, vite-plugin-dev  = 0.5.3  (all MIT)
 *   newest snapshot  docs/openclinxr/iwsdk-npm-metadata-snapshot-2026-08-02.json = 0.5.1  (17 days old)
 *   expected table   iwsdk-npm-currentness-check.ts:73-101, hand-coded           = 0.5.1
 *   spike pins       apps/arena/ui-xr-iwsdk-spike/package.json                   = 0.5.1
 *
 *   `pnpm iwsdk:npm-currentness` -> currentness: { passed: true, blockers: [] }
 *
 * Four different numbers for one version, and the gate says everything is current. The cause
 * is that BOTH SIDES of the comparison are hand-authored and must be hand-edited together:
 * the snapshot is a manual `npm view` capture with no staleness bound, and the expectation is
 * a literal table in the same file. They can only ever agree. **Currentness that cannot expire
 * is not currentness** — it is a self-consistency check wearing a currentness name.
 *
 * ## THE SECOND DEFECT — the vite comparison is computed against a non-version
 *
 * `readRepoViteVersion()` (`:323-334`) reads `apps/arena/ui-xr-iwsdk-spike/package.json`, whose
 * vite entry is the pnpm catalog reference `"catalog:"`, and returns that string verbatim. So
 * every adoption blocker reads:
 *
 *   vite_peer_range_does_not_accept_repo_vite_major:@iwsdk/vite-plugin-dev:^7.0.0_vs_catalog:
 *
 * `^7.0.0` is being compared against the literal `"catalog:"`. `pnpm-workspace.yaml:14` says the
 * catalog's vite is **8.0.16**, so the blocker's VERDICT is right by luck — but the computation
 * is meaningless and would report identically if the catalog said `7.5.0`, which IS compatible.
 * This matters more than it looks: the vite peer range is the ONLY recorded reason IWSDK is not
 * adopted at runtime, and it is derived from a string that is not a version.
 *
 * ## WHY THE EXISTING TEST FILE DID NOT CATCH EITHER
 *
 * `iwsdk-npm-currentness-check.test.ts` builds its report from a `metadataSnapshot()` fixture
 * written INSIDE the test, matching the hand-coded expectation by construction. It never loads
 * the on-disk snapshot and never consults npm. It is 4/4 green and always will be.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED   — `evaluateSnapshotFreshness` does not exist. No staleness surface at all.
 *   (2) RED   — a snapshot at 0.5.3 against live 0.5.3 must PASS. Today the hand-coded table
 *               pins 0.5.1, so a CORRECT snapshot is reported as moved. This is what makes the
 *               hardcoded expectation impossible to keep: the only way both (1) and (2) pass is
 *               to derive the expectation rather than type it.
 *   (3) RED   — `resolveRepoViteVersion` does not exist; the literal `"catalog:"` is returned.
 *   (4) NET   — passes today and must keep passing: adoption stays false, sidecar-only holds.
 *   (5) GUARD — the fixtures differ on the axis under test, so (1) and (2) can discriminate.
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   treatment                                          | (1)  | (2)  | (3)  | (4)  | result
 *   ---------------------------------------------------|------|------|------|------|--------
 *   a) today                                           | FAIL | FAIL | FAIL | pass | REFUSED
 *   b) hand-edit snapshot + table to 0.5.3             | FAIL | pass | FAIL | pass | REFUSED
 *   c) resolve the catalog, leave the table hand-coded | FAIL | FAIL | pass | pass | REFUSED
 *   d) hardcode viteVersion = "8.0.16"                 | FAIL | FAIL | FAIL | pass | REFUSED
 *   e) flip ready_for_runtime_adoption to make it look adopted | -- | -- | -- | FAIL | REFUSED
 *
 * **(b) is the one to watch.** Bumping both hand-written numbers to 0.5.3 is the obvious
 * one-liner and it reproduces this exact defect one release later. Clause (1) refuses it: a
 * pinned pair with no staleness surface still cannot expire.
 *
 * NOT TESTED:
 *   - Whether 0.5.3 WORKS. This is the instrument, not the bump. The spike stays on 0.5.1 here.
 *   - `@iwsdk/vite-plugin-dev` compatibility. Measured: it still peers `vite ^7.0.0` at 0.5.3,
 *     unchanged from 0.5.1, so it stays pinned regardless of what this gate reports.
 *   - Live registry behaviour. Freshness is a PURE function taking live versions as an argument
 *     so this contract stays offline and deterministic; the runner supplies real npm data.
 *   - Anything in `apps/ui-xr`. It stays vanilla three.js, sidecar-only, fence up.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const RUNNER = join(HERE, "iwsdk-npm-currentness-check.ts");
/** Computed so TypeScript cannot resolve a not-yet-exported symbol at compile time (#383/#352). */
const SPECIFIER = ["./iwsdk-npm-currentness", "check.js"].join("-");

/** pnpm-workspace.yaml:14 — the value `catalog:` must resolve to. Read, not typed. */
const CATALOG_VITE = (() => {
  const yaml = readFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
  return /^\s+vite:\s*"([^"]+)"/mu.exec(yaml)?.[1] ?? null;
})();

type Freshness = {
  stale: boolean;
  blockers: string[];
};

type Mod = {
  evaluateSnapshotFreshness?: (input: {
    snapshot: { capturedAt: string; packages: Array<{ name: string; latestVersion: string }> };
    liveLatestVersions: Record<string, string>;
    now: string;
  }) => Freshness;
  resolveRepoViteVersion?: (manifestVersion: string) => string;
  buildIwsdkNpmCurrentnessReport?: (input: unknown) => { adoption: { ready_for_runtime_adoption: boolean } };
};

const mod: Mod = await (async () => {
  try {
    return (await import(SPECIFIER)) as Mod;
  } catch {
    return {};
  }
})();

/** SS7t: an absent surface must FAIL loudly, never pass vacuously. */
function requireFreshness(): NonNullable<Mod["evaluateSnapshotFreshness"]> {
  expect(
    mod.evaluateSnapshotFreshness,
    `iwsdk-npm-currentness-check.ts must export evaluateSnapshotFreshness({snapshot, liveLatestVersions, now}) `
      + `— today the module has no staleness surface at all and reports passed:true while 17 days and two `
      + `releases behind`,
  ).toBeTypeOf("function");
  return mod.evaluateSnapshotFreshness as NonNullable<Mod["evaluateSnapshotFreshness"]>;
}

/** A snapshot captured today, agreeing with live npm. The healthy case. */
const FRESH_SNAPSHOT = {
  capturedAt: "2026-08-19T00:00:00.000Z",
  packages: [
    { name: "@iwsdk/core", latestVersion: "0.5.3" },
    { name: "@iwsdk/xr-input", latestVersion: "0.5.3" },
  ],
};

/** The snapshot actually on disk: 17 days old, two releases behind. */
const STALE_SNAPSHOT = {
  capturedAt: "2026-08-02T21:37:45.242Z",
  packages: [
    { name: "@iwsdk/core", latestVersion: "0.5.1" },
    { name: "@iwsdk/xr-input", latestVersion: "0.5.1" },
  ],
};

const LIVE_NOW: Record<string, string> = { "@iwsdk/core": "0.5.3", "@iwsdk/xr-input": "0.5.3" };
const NOW = "2026-08-19T18:00:00.000Z";

describe("the IWSDK currentness gate can expire", () => {
  it("(1) RED: a snapshot behind live npm is reported STALE", () => {
    const result = requireFreshness()({
      snapshot: STALE_SNAPSHOT,
      liveLatestVersions: LIVE_NOW,
      now: NOW,
    });
    expect(result.stale, `snapshot pins 0.5.1 while npm publishes 0.5.3 — that is stale`).toBe(true);
    expect(
      result.blockers.join(" "),
      `the blocker must name the package and both versions so the reader can act on it`,
    ).toMatch(/@iwsdk\/core.*0\.5\.1.*0\.5\.3|@iwsdk\/core.*0\.5\.3.*0\.5\.1/u);
  });

  it("(2) RED: a snapshot that AGREES with live npm passes — no hand-coded expectation may contradict it", () => {
    // Refuses (b) and (c). A correct, current snapshot must be accepted. Today the expected table
    // is a literal pinned to 0.5.1 (iwsdk-npm-currentness-check.ts:73-101), so a snapshot telling
    // the truth about 0.5.3 is reported as "moved". The only way (1) and (2) hold together is to
    // DERIVE the expectation from captured or live data instead of typing it.
    const result = requireFreshness()({
      snapshot: FRESH_SNAPSHOT,
      liveLatestVersions: LIVE_NOW,
      now: NOW,
    });
    expect(result.stale, `0.5.3 snapshot against 0.5.3 live is current, whatever a literal table says`).toBe(
      false,
    );
    expect(result.blockers, `a current snapshot has nothing to report`).toEqual([]);
  });

  it("(3) RED: the repo Vite version resolves the catalog reference, not the literal string", () => {
    // Refuses (d). Hardcoding "8.0.16" passes a naive equality and re-breaks the day the catalog
    // moves, so the assertion is against the value READ from pnpm-workspace.yaml, not a literal here.
    expect(CATALOG_VITE, `pnpm-workspace.yaml must declare a catalog vite version`).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(
      mod.resolveRepoViteVersion,
      `iwsdk-npm-currentness-check.ts must export resolveRepoViteVersion(manifestVersion) — today `
        + `readRepoViteVersion returns the literal "catalog:" and every vite peer blocker compares `
        + `^7.0.0 against a string that is not a version`,
    ).toBeTypeOf("function");
    const resolve = mod.resolveRepoViteVersion as NonNullable<Mod["resolveRepoViteVersion"]>;
    expect(resolve("catalog:"), `"catalog:" must resolve through pnpm-workspace.yaml`).toBe(CATALOG_VITE);
    // A constant-returning stub — `() => "8.0.16"` — satisfies the line above AND a pass-through
    // check written against the catalog value itself. Probed 2026-08-19: it did. So the pass-through
    // must use a version that is NOT the catalog value, or cheat (d) walks straight through.
    expect(resolve("7.1.0"), `an explicit version passes through unchanged, and is not the catalog value`).toBe(
      "7.1.0",
    );
    expect(resolve("7.1.0"), `a constant-returning stub is refused here`).not.toBe(CATALOG_VITE);
  });

  it("(4) COUNTERWEIGHT: runtime adoption stays false — this is the instrument, not a promotion", () => {
    // Refuses (e). Sidecar-only holds. apps/ui-xr stays vanilla three.js.
    const source = readFileSync(RUNNER, "utf8");
    expect(
      source,
      `ready_for_runtime_adoption must remain typed false — fixing the instrument does not adopt IWSDK`,
    ).toContain("ready_for_runtime_adoption: false");
    expect(
      readFileSync(join(REPO_ROOT, "apps/arena/ui-xr-iwsdk-spike/package.json"), "utf8"),
      `the dev plugin still peers vite ^7.0.0 at 0.5.3 — it stays pinned in this slice`,
    ).toContain('"@iwsdk/vite-plugin-dev": "0.5.1"');
  });

  it("(5) VACUITY GUARD: the two fixtures differ on the axis under test", () => {
    // If someone later makes both fixtures current, (1) becomes unfalsifiable and (2) trivial.
    expect(FRESH_SNAPSHOT.packages[0]?.latestVersion, "fresh fixture matches live").toBe(
      LIVE_NOW["@iwsdk/core"],
    );
    expect(STALE_SNAPSHOT.packages[0]?.latestVersion, "stale fixture is behind live").not.toBe(
      LIVE_NOW["@iwsdk/core"],
    );
    expect(
      new Date(NOW).getTime() - new Date(STALE_SNAPSHOT.capturedAt).getTime(),
      "the stale fixture is genuinely old, so an age bound has something to bite on",
    ).toBeGreaterThan(14 * 24 * 60 * 60 * 1000);
    expect(readFileSync(RUNNER, "utf8").length, "the runner is readable, so absence is real").toBeGreaterThan(0);
  });
});
