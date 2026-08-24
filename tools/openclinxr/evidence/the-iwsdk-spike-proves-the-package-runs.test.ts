import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

/**
 * OBSERVABLE: the IWSDK spike's evidence depends on the package EXISTING, not on the string
 * `import("@iwsdk/core")` appearing in a source file.
 *
 * MEASURED 2026-08-24, do not re-derive.
 *
 *   require.resolve("@iwsdk/core")              -> MODULE_NOT_FOUND
 *   declared                                     -> apps/arena/ui-xr-iwsdk-spike/package.json:15 "0.5.3"
 *   registry latest @iwsdk/core                  -> 0.5.3   (the pin is CURRENT; that is not the defect)
 *   apps/ui-xr (learner runtime) @iwsdk refs     -> 0
 *   tools/openclinxr/dark-factory @iwsdk refs    -> 0
 *   DARK_FACTORY_CHAIN_STATIONS                  -> 9 stations, none is iwsdk
 *
 * HOW AN UNINSTALLED DEPENDENCY STAYED GREEN — the spike's tests assert on SOURCE TEXT:
 *
 *   sidecar-state.test.ts:282  expect(source).toContain('import("@iwsdk/core")');
 *   sidecar-state.test.ts:283  expect(source).toContain('import("@iwsdk/xr-input")');
 *   readFileSync calls: sidecar-state 15, uikitml-spatial-text 5
 *
 * Those pass whether or not the package exists. It does not exist. This is the marker-check pattern
 * this repo has withdrawn repeatedly — a name match standing in for substance — living inside the
 * evidence for a capability nobody can run.
 *
 * WHY THIS BEFORE ANY IWSDK STATION: a factory station built on a dependency that does not resolve is
 * a station that cannot run. rhubarb was the counter-example — installed, and I proved it end to end
 * before planting #608. I can make no equivalent claim here: I have never seen an IWSDK code path
 * execute.
 *
 * KNOWN-GOOD COLUMN: `three`, which the same spike imports and which DOES resolve. Clause (3) pins it,
 * so the resolver used here is proven to succeed on a package that is genuinely installed — a failing
 * resolver would otherwise make clause (1) pass for the wrong reason.
 *
 * COUNTERWEIGHT: the cheap fix is to delete the spike or drop the dependency and call the red gone.
 * Clause (4) requires the declaration to survive: this slice must be resolved by making the package
 * REAL, or by an explicit recorded decision — never by quietly removing the evidence.
 *
 * claimScope: whether @iwsdk/core resolves, and whether the spike's evidence depends on that.
 * notEvidenceFor: whether IWSDK is the right technology; whether any 0.5.3 feature works on this
 * machine; Quest behaviour; anything about the learner runtime, which imports none of it.
 */

const req = createRequire(import.meta.url);

/** Declared at apps/arena/ui-xr-iwsdk-spike/package.json:15. Measured as MODULE_NOT_FOUND. */
const IWSDK_PACKAGES = ["@iwsdk/core", "@iwsdk/xr-input"] as const;

function resolves(spec: string): boolean {
  try { req.resolve(spec); return true; } catch { return false; }
}

describe("the iwsdk spike proves the package runs", () => {
  it.fails("(1) RED: every declared @iwsdk package resolves", () => {
    // Today none of them do. The spike's tests never noticed because they read source text.
    for (const p of IWSDK_PACKAGES) {
      expect(resolves(p), `${p} is declared in the spike's package.json but does not resolve`).toBe(true);
    }
  });

  it.fails("(2) RED: @iwsdk/core can be imported and exposes a callable surface", async () => {
    // Resolution alone is not execution. A package can resolve and still fail to import on this
    // platform, which is exactly the claim the spike has never established.
    const mod = (await import("@iwsdk/core")) as Record<string, unknown>;
    expect(typeof mod, "@iwsdk/core must import").toBe("object");
    expect(Object.keys(mod).length, "@iwsdk/core must expose at least one export").toBeGreaterThan(0);
  });

  it("(3) KNOWN-GOOD COLUMN: the resolver succeeds on a package that IS installed", () => {
    // Pins the instrument. `three` is imported by the same spike and is genuinely present, so a
    // broken resolver cannot be the reason clause (1) fails.
    expect(resolves("three"), "the resolver must work — otherwise clause (1) fails for the wrong reason")
      .toBe(true);
  });

  it("(4) COUNTERWEIGHT: the declaration is not deleted to clear the red", () => {
    // Refuses the cheap fix. Removing @iwsdk from package.json, or deleting the spike, would make
    // clauses (1) and (2) vacuous rather than satisfied. The dependency must still be DECLARED —
    // resolve it by installing, or by a recorded decision to drop the technology, not by erasing
    // the evidence that it was ever intended.
    const pkg = req("../../../apps/arena/ui-xr-iwsdk-spike/package.json") as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(all["@iwsdk/core"], "the spike must still DECLARE @iwsdk/core — do not clear the red by deleting it")
      .toBeDefined();
  });
});
