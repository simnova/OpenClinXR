import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * PLANTED CONTRACTS (#210). Multi-shell garment contracts — role-distinguish + wardrobe
 * must not pick a single under-layer by accident after #208 collectGarmentShells.
 *
 * Two modules were NOT migrated to under-aware shells:
 *   garment-role-distinguish.ts
 *   actor-identity-and-wardrobe.ts
 *
 * Assets with open outer over closed under: adult_male_street_casual, ed_chest_pain_spouse_adult,
 * peds_anxious_parent (and any library figure with outer+under after #220).
 *
 * Header IMMUTABLE — append ## FIXED (#210).
 */

type Report = {
  verdict: "multi_shell_contracts_migrated" | "measure_only_already_correct" | "inconclusive_blocked";
  verdictReason: string;
  modulesMigrated: string[];
  dualLayerAssetsChecked: string[];
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;
const load = () =>
  import("./garment-multi-shell-contracts.js") as Promise<Record<string, unknown>>;

describe("garment multi-shell contracts after #208 (#210)", () => {
  it("multi-shell contract migration reached a named verdict", async () => {
    const mod = await load();
    const inspect = mod["inspectGarmentMultiShellContracts"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect(["multi_shell_contracts_migrated", "measure_only_already_correct", "inconclusive_blocked"]).toContain(
      r.verdict,
    );
    expect(r.verdictReason.length).toBeGreaterThan(20);
    expect(r.notEvidenceFor.join(" ")).toMatch(/quest|clinical|ready/i);
  }, 600_000);

  it("role-distinguish and wardrobe paths do not rely on a single primary shell only (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectGarmentMultiShellContracts"] as Inspect;
    const r = await inspect();
    if (r.verdict === "inconclusive_blocked") return;
    // Product path: both named modules must appear as migrated or explicitly measured correct
    const joined = [...r.modulesMigrated, r.verdictReason].join(" ");
    expect(joined).toMatch(/garment-role-distinguish|role.distinguish/i);
    expect(joined).toMatch(/actor-identity|wardrobe/i);
    expect(r.dualLayerAssetsChecked.length).toBeGreaterThanOrEqual(2);
    // Live contracts still green
    expect(existsSync("tools/openclinxr/evidence/garment-role-distinguish.ts")).toBe(true);
  }, 600_000);
});
