import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **The wall receives 0.168 of its own albedo while the ceiling receives 0.816, and roughness is the
 * only material property that separates them.** Measured on `#543`'s landed combined capture (IBL +
 * `aoMapIntensity 0` + materialised hull), normalised by each surface's albedo measured INSIDE its
 * UV coverage:
 *
 *   surface   albedo(in)  rendered  rend/albedo  roughness  metal
 *   wall        190.5        32       0.168        0.10      0.00
 *   floor       247.0       104       0.421        0.10      0.00
 *   ceiling     254.8       208       0.816        0.77      0.00
 *
 * `rend/albedo` is how much light a surface actually receives, normalised for how bright its own
 * texture is — so the wall's dimmer albedo is not a confound.
 *
 * **Wall and floor are the same material family at identical roughness 0.10 and metalness 0.00, and
 * they differ by 2.5x.** So roughness alone does not separate wall from floor. But the single
 * high-roughness surface is the brightest by nearly 2x, which is the one untested lead.
 *
 * ## HYPOTHESIS, LABELLED AS ONE
 *
 * A smooth dielectric at roughness 0.10 behaves like a mirror under IBL: it reflects the environment
 * rather than diffusing it. Under `RoomEnvironment` the overhead hemisphere is bright and the lateral
 * band is dark, which would produce exactly this ordering — rough ceiling diffuses the average
 * (0.816); smooth floor mirrors the bright overhead (0.421); smooth wall mirrors the dark opposite
 * wall (0.168).
 *
 * **It fits all three rows, which is not the same as being true.** It is the FOURTH mechanism
 * proposed for this room and two of the previous three were withdrawn — #536 (whole-atlas albedo
 * mean, diluted by 93% empty texels) and the #529 sd bound. Treat it as a candidate with a
 * discriminator, not a finding.
 *
 * ## WHAT DIED BEFORE THIS — do not re-derive
 *
 *   the albedo is dark          WITHDRAWN #536 — 0.747 inside coverage, my mean averaged empty texels
 *   the AO map is the term      TRUE FOR HORIZONTALS ONLY — #543: ao=0 lifted ceiling to 208 and floor
 *                               to ~104, wall stayed 26-39
 *   the hull occludes it        NO — #534 materialised it, #543 shows no change in the mid-band
 *   normals face outward        NO — wall is 85.8% inward in world space
 *
 * ## RECTS ARE CORRECTED — do NOT reuse the #543 ones
 *
 * `#543` reported wall meanL 93.7 / sd 86.08 and cleared its ratio bound at 0.848, and my pixel grade
 * said the wall was black. My rect spanned y 18-66%, straddling a lit ceiling and a dark wall. Row
 * profile of that capture at x 8-50%:
 *
 *   y 10-35%  mean 208.0  sd  0.5    CEILING
 *   y 40-65%  mean  26-39 sd 5-46    WALL
 *   y 75-90%  mean  98-111 sd 21-26  FLOOR
 *
 * Use those bands. Clause (2) refuses any region whose sd approaches its mean — the guard that would
 * have caught my rectangle, and the third instance of the bimodal-mean error in this campaign.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                   | (1) both cells | (2) unimodal | (3) control holds | (4) no asset | result
 *   --------------------------------------------|----------------|--------------|-------------------|--------------|--------
 *   a) today — no roughness probe               |   **FAIL**     |   **FAIL**   |       pass        |    pass      | REFUSED
 *   b) edit roughness in the GLB                |     pass       |     pass     |       pass        |  **FAIL**    | REFUSED — campaign CLOSED
 *   c) reuse #543's straddling rect             |     pass       |   **FAIL**   |       pass        |    pass      | REFUSED
 *   d) raise exposure so the wall lifts anyway  |     pass       |     pass     |     **FAIL**      |    pass      | REFUSED — ceiling moves too
 *   e) runtime roughness override, both cells   |     pass       |     pass     |       pass        |    pass      | ALL PASS, whatever it shows
 *
 * (d) is the one to watch: anything global lifts the wall AND the ceiling, and the ceiling is the
 * control. Clause (3) pins it.
 *
 * ## NO INVENTED THRESHOLD, AND NO REQUIRED DIRECTION
 *
 * This contract does NOT assert that roughness fixes anything. It asserts that the probe RAN with
 * both cells at the corrected rects and recorded `rend/albedo` for each. **If the wall does not move,
 * the hypothesis is dead and that is a successful outcome** — it leaves the environment's lateral
 * darkness as the remaining candidate, which is a lighting-rig question, not a material one.
 *
 * claimScope: whether a runtime roughness override on the wall material changes how much light it
 *   receives, measured as rend/albedo at corrected per-surface rects on one room.
 * notEvidenceFor: the product lighting default; whether the room LOOKS right (orchestrator grades);
 *   the other 13 rooms; whether marble should be smooth as authored.
 */

const ARTIFACT = "tools/openclinxr/evidence/wall-roughness-probe.json";

/** Measured INSIDE UV coverage on the shipped GLB. The #536 lesson: never a whole-atlas mean. */
const ALBEDO = { wall: 190.5, ceiling: 254.8, floor: 247.0 } as const;
/** #543's landed control, at the CORRECTED rects. */
const CONTROL_REND_OVER_ALBEDO = { wall: 0.168, ceiling: 0.816 } as const;
/** A region whose sd approaches its mean is straddling two surfaces. Derived from my own #543 rect. */
const MAX_SD_TO_MEAN = 0.5;
/** The ceiling is the control: a global exposure change moves it, a wall-material change must not. */
const CEILING_TOLERANCE = 0.10;

type Region = { id?: string; meanL?: number; sd?: number; rect?: number[]; rendOverAlbedo?: number };
type Cell = { id?: string; wallRoughness?: number; regions?: Region[] };
type Probe = { camera?: string; image?: string; cells?: Cell[]; glbSha256?: string; assetEdited?: boolean };

const probe = (): Probe => (existsSync(ARTIFACT) ? JSON.parse(readFileSync(ARTIFACT, "utf8")) as Probe : {});
const cell = (id: string): Cell | undefined => (probe().cells ?? []).find((c) => c.id === id);
const reg = (c: Cell | undefined, id: string): Region | undefined => (c?.regions ?? []).find((r) => r.id === id);

describe("the wall receives what its roughness allows", () => {
  it.fails("(1) RED: both cells rendered — wall roughness as authored (0.10) and overridden", () => {
    const lo = cell("wall_rough_010"), hi = cell("wall_rough_070");
    expect(lo?.regions, `${ARTIFACT} missing the as-authored cell`).toBeTypeOf("object");
    expect(hi?.regions, `${ARTIFACT} missing the overridden cell`).toBeTypeOf("object");
    expect(lo!.wallRoughness, "control cell must be the authored 0.10").toBeCloseTo(0.10, 2);
    expect(hi!.wallRoughness, "treatment cell must raise roughness").toBeGreaterThan(0.5);
    for (const c of [lo!, hi!]) {
      for (const id of ["wall", "ceiling", "floor"]) {
        const r = reg(c, id);
        expect(r?.meanL, `${c.id}/${id} meanL missing`).toBeTypeOf("number");
        expect(r?.rendOverAlbedo, `${c.id}/${id} rendOverAlbedo missing`).toBeTypeOf("number");
        expect(Array.isArray(r?.rect) && r!.rect!.length === 4, `${c.id}/${id} must record its rect`).toBe(true);
      }
    }
  });

  it("(2) RED: no region is bimodal — sd must not approach its own mean", () => {
    // #543 reported wall mean 93.7 / sd 86.08 and cleared its bound; the wall was black. The rect
    // straddled a lit ceiling and a dark wall. A single surface under one light does not do that.
    const bad: string[] = [];
    for (const c of probe().cells ?? []) {
      for (const r of c.regions ?? []) {
        if (typeof r.meanL !== "number" || typeof r.sd !== "number") continue;
        if (r.sd / Math.max(1, r.meanL) > MAX_SD_TO_MEAN) bad.push(`${c.id}/${r.id}: mean ${r.meanL} sd ${r.sd}`);
      }
    }
    expect(bad, "regions straddling two surfaces").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the ceiling is the control and must not move", () => {
    // Refuses treatment (d). Anything global — exposure, light intensity, tone mapping — lifts the
    // wall AND the ceiling. A wall-material change must leave the ceiling where #543 measured it.
    const lo = cell("wall_rough_010"), hi = cell("wall_rough_070");
    if (!lo || !hi) return; // clause (1) owns the missing-cell failure
    for (const c of [lo, hi]) {
      const v = reg(c, "ceiling")?.rendOverAlbedo;
      if (typeof v !== "number") continue;
      expect(Math.abs(v - CONTROL_REND_OVER_ALBEDO.ceiling),
        `${c.id} ceiling rend/albedo ${v} drifted from the ${CONTROL_REND_OVER_ALBEDO.ceiling} control`)
        .toBeLessThanOrEqual(CEILING_TOLERANCE);
    }
  });

  it("(4) COUNTERWEIGHT: no asset was edited — this is a runtime override", async () => {
    // Rooms campaign is CLOSED. Editing roughness in the GLB satisfies (1)(2)(3) and is refused.
    const GLB = "apps/ui-xr/public/xr-assets/environment/infinigen-primary-care-clinic.glb";
    expect(existsSync(GLB), "the shipped room GLB must still exist").toBe(true);
    const { NodeIO } = await import("@gltf-transform/core");
    const doc = await new NodeIO().read(GLB);
    for (const m of doc.getRoot().listMaterials()) {
      if (!/hexagon/.test(m.getName() ?? "")) continue;
      expect(m.getRoughnessFactor(),
        "the wall material's authored roughness must stay 0.10 in the asset").toBeCloseTo(0.10, 2);
    }
    expect(probe().assetEdited ?? false, "the probe must declare it edited no asset").toBe(false);
  });

  it("(5) VACUITY: a real image at a stated camera", () => {
    const p = probe();
    if (!p.image) return; // clause (1) owns the missing-artifact failure
    const img = `tools/openclinxr/evidence/${p.image}`;
    expect(existsSync(img), `image missing at ${img}`).toBe(true);
    // A byte floor proves a renderer ran and nothing more. I grade the pixels.
    expect(statSync(img).size, "too small to be a render").toBeGreaterThan(20_000);
    expect(typeof p.camera, "the capture must state its camera").toBe("string");
    void ALBEDO;
  });
});
