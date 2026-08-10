import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#275). The hm08 rail hands every body a scrub shirt because the
 * case definition never reaches the garment choice.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED (pre-fix.json — force-added beside this test)
 *
 * Live traversal of `ed_chest_pain_priority_v2` shows the spouse loading
 * `makeclothes_library_scrub_shirt_adult_lean_female` (9,384 tris). The same string is
 * a DEFAULT at five sites (fit_stage.py:56, fit-cli.ts:476, body-param-cli.ts:402 and
 * :742, body_param_stage.py:67), and the shipped catalog is 2 of 2 on it:
 *
 *   adult_lean_female  garmentId wojackowl_scrubs_shirt_hm08  mesh makeclothes_library_scrub_shirt_adult_lean_female
 *   adult_heavy_male   garmentId wojackowl_scrubs_shirt_hm08  mesh makeclothes_library_scrub_shirt_adult_heavy_male
 *
 * Yet the actor-casting SSOT casts the two body classes into DIFFERENT roles:
 *   adult_lean_female -> family (ED spouse, peds parent)
 *   adult_heavy_male  -> nurse  (peds nurse)
 *
 * A family member at the bedside therefore renders as clinical staff — #85's class
 * (a cast member wearing the wrong role's clothes) arriving through a default rather
 * than through a casting bug. This is a Q1 defect: the case definition is supposed to
 * drive the runtime (`phenotype.garmentLayers` on the Anny rail), and the hm08 rail
 * ignores it.
 *
 * WHAT FIELD DRIVES THE CHOICE (reported per the issue): the scenario bank carries no
 * `phenotype` field (verified: zero matches in packages/openclinxr/scenario-fixtures),
 * so `phenotype.garmentLayers` is NOT populated for hm08-cast actors. The case
 * definition that IS populated is the cast ROLE in the actor-casting SSOT, resolved
 * through the SAME case-actor presets the Anny rail uses
 * (orchestrate_character.py CASE_ACTOR_PRESETS phenotype.garmentLayers):
 *
 *   nurse  -> ["scrub_top","scrub_pocket"]  -> wojackowl_scrubs_shirt_hm08  (library .mhclo)
 *   family -> ["casual_top","open_cardigan"]-> openclinxr_hm08_upper_cover_shell
 *              (deterministic body-derived cover shell — the ONLY upper .mhclo in the
 *               library is the scrub shirt; a garment id pointing at a missing .mhclo
 *               would be the #256 trap, so the factory fallback mechanism from #277 is
 *               used instead, never an invented asset)
 *
 * THE THREE CONTRACTS ARE THE SAME PREDICATE OVER BOTH RAILS (#222/#279 pattern):
 *   (1) Anny rail (known-good): two roles resolve to different garment ids. Passes today.
 *   (2) hm08 rail: two body classes cast into different roles resolve to different
 *       garment ids. Fails today (2 of 2 scrub).
 *   (3) COUNTERWEIGHT: every generated body still carries an upper garment. Contract
 *       (2) alone is satisfiable by mapping one role to a garment that does not exist;
 *       (3) is what stops that — the default is the FALLBACK, not removed.
 *
 * The hm08 assertions read the SHIPPED catalog and SHIPPED GLBs, so the production
 * path must reflect the resolution — a pure function nobody wired would stay red here.
 */

const load = async () =>
  import("./garment-selection-by-role.js") as Promise<Record<string, unknown>>;

type AnnyRailRow = { role: string; garmentLayers: string[]; garmentIds: string[] };
type Hm08RailRow = {
  bodyClassId: string;
  castRoles: Array<{ scenarioId: string; actorId: string; role: string }>;
  resolved: { garmentId: string; kind: string; garmentLayers: string[] };
  catalogGarmentId: string;
  catalogGarmentMeshName: string;
  glbUpperMeshNames: string[];
};
type Inspect = () => Promise<{
  annyRail: AnnyRailRow[];
  hm08Rail: Hm08RailRow[];
  hm08TwoBodyClassesDiffer: boolean;
  allBodiesCarryUpperGarment: boolean;
}>;

describe("the case definition reaches the hm08 garment choice (#275)", () => {
  it("Anny rail (KNOWN-GOOD): two roles resolve to different garment ids", async () => {
    // The target behaviour exists on the Anny rail — the ED nurse gets scrub_top +
    // scrub_pocket, the ED patient a hospital_gown, both named from the case definition.
    const mod = await load();
    const inspect = mod["inspectGarmentSelectionByRole"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const nurse = report.annyRail.find((r) => r.role === "nurse");
    const family = report.annyRail.find((r) => r.role === "family" || r.role === "parent" || r.role === "spouse");

    expect(nurse, "no nurse row — the Anny rail known-good cannot be compared").toBeDefined();
    expect(family, "no family row — the Anny rail known-good cannot be compared").toBeDefined();
    // The same predicate over both rails: two roles from the case definition resolve
    // to different garment ids on the Anny rail (this is the KNOWN-GOOD column — it
    // must keep passing, so the hm08 assertion below cannot be vacuous).
    expect(nurse!.garmentIds.join(",")).not.toBe(family!.garmentIds.join(","));
  }, 120_000);

  it("hm08 rail: two body classes cast into different roles resolve to different garment ids", async () => {
    const mod = await load();
    const inspect = mod["inspectGarmentSelectionByRole"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    // Two distinct body classes must both be present.
    expect(report.hm08Rail.length, "fewer than two hm08 body classes measured").toBeGreaterThanOrEqual(2);

    // Both must actually be cast into roles (never hardcode the role list here).
    for (const row of report.hm08Rail) {
      expect(row.castRoles.length, `${row.bodyClassId}: no cast roles from the actor-casting SSOT`).toBeGreaterThan(0);
    }

    // The resolved ids must differ...
    const resolvedIds = report.hm08Rail.map((r) => r.resolved.garmentId);
    expect(new Set(resolvedIds).size, `resolved ids were ${resolvedIds.join(", ")}`).toBeGreaterThanOrEqual(2);

    // ...AND the shipped catalog must reflect it (the production path, not only the pure function).
    const catalogIds = report.hm08Rail.map((r) => r.catalogGarmentId);
    expect(new Set(catalogIds).size, `shipped catalog ids were ${catalogIds.join(", ")}`).toBeGreaterThanOrEqual(2);

    expect(report.hm08TwoBodyClassesDiffer).toBe(true);
  }, 120_000);

  it("COUNTERWEIGHT: every generated body still carries an upper garment", async () => {
    // Contract (2) alone is satisfiable by mapping one role to a garment that does not
    // exist; this is what stops that. A role→garment map with no fallback produces a
    // naked figure the first time a case omits the field — #73's topless parent, shipped
    // once already. The default is the FALLBACK, never removed.
    const mod = await load();
    const inspect = mod["inspectGarmentSelectionByRole"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const row of report.hm08Rail) {
      expect(row.resolved.garmentId, `${row.bodyClassId}: no resolved upper garment id`).toBeTruthy();
      // Presence on the shipped artifact, not only in the resolution function.
      expect(
        Boolean(row.catalogGarmentMeshName) || row.glbUpperMeshNames.length > 0,
        `${row.bodyClassId}: catalog ${row.catalogGarmentMeshName} / glb ${row.glbUpperMeshNames.join(", ")} — no upper garment shipped`,
      ).toBe(true);
    }
    expect(report.allBodiesCarryUpperGarment).toBe(true);
  }, 120_000);
});
