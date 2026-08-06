import { describe, expect, it } from "vitest";

/**
 * Imported LAZILY inside each test, on purpose.
 *
 * `it.fails` inverts an assertion; it cannot rescue a suite that dies at IMPORT time. A planted
 * contract naming a module that does not exist yet fails to load, and the whole file counts as a
 * failed suite regardless of the marker. Deferring the import turns "module missing" into an
 * assertion failure, which is what `it.fails` can actually absorb.
 */
const load = async () => (await import("./planted-contract.js")) as {
  plantedContractsAreHonest: (entries: unknown[]) => string[];
};

/**
 * Planted contracts: how a RED coexists with a green health gate.
 *
 * The loop required two contradictory things — commit a RED before the issue exists (so a green
 * cannot be by construction), and keep `pnpm test` green (health). A committed RED makes the suite
 * red BY DESIGN. Cycle 4 opened with a failing suite that was my own planted RED, and under a
 * literal reading the loop should have halted and "fixed" it — where the only fixes are deleting
 * the test or implementing the feature inline, both destroying the property the RED exists for.
 * It resolved only because dispatching happened to turn it green. That was luck.
 *
 * Resolution, measured on vitest 4.1.5 rather than assumed:
 *   it.fails + failing assertion  → suite PASSES ("1 expected fail")
 *   it.fails + passing assertion  → suite FAILS  ("Expect test to fail")
 *
 * So a planted contract keeps main green while the feature is absent, and goes red the moment a
 * worker implements it without flipping `it.fails` back to `it` — forcing the marker's removal in
 * the same slice.
 *
 * These are marked it.fails — the practice #35 establishes. The suite stays GREEN while the module
 * is missing, and goes RED the moment a worker implements it without flipping the markers back to
 * plain it(), forcing removal in the same slice. Measured on vitest 4.1.5, not assumed.
 *
 * HONEST TRADE, recorded because it is a real loss: anti-green-by-construction can no longer be
 * proven by "main was red before dispatch". Main is green by design now. The residual property is
 * git-diff evidence — the test existed at the issue SHA with real assertions, and after landing it
 * is a plain `it` with those same assertions passing.
 */
describe("planted contracts stay honest", () => {
  it("rejects a planted test whose assertions are vacuous", async () => {
    // The failure this cannot prevent by construction: `expect(true).toBe(false)` keeps main green
    // forever and encodes nothing about the product. Same junk-RED risk as any test.
    const { plantedContractsAreHonest } = await load();
    const violations = plantedContractsAreHonest([
      { name: "vacuous", planted: true, assertions: ["expect(true).toBe(false)"] },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/vacuous|no product/i);
  });

  it("accepts a planted test that asserts something about the code under test", async () => {
    const { plantedContractsAreHonest } = await load();
    expect(
      plantedContractsAreHonest([
        { name: "real", planted: true, assertions: ["expect(shutdownApiApp(app)).resolves"] },
      ]),
    ).toEqual([]);
  });

  it("flags a test still marked planted after its feature landed", async () => {
    // Diagnostic should name the stale contract rather than leaving "Expect test to fail" alone.
    const { plantedContractsAreHonest } = await load();
    const violations = plantedContractsAreHonest([
      { name: "stale", planted: true, assertions: ["expect(x).toBe(1)"], currentlyPasses: true },
    ]);
    expect(violations[0]).toMatch(/landed|flip|no longer/i);
  });
});
