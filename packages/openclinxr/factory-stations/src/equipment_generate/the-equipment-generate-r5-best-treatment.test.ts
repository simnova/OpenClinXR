import { describe, expect, it } from "vitest";
import { planEquipmentGenerate } from "../index.js";

/**
 * MADR 0059 round 5b: equipment_generate gains the opt-in R5-BEST export
 * treatment (cpu_fill_holes -> weld_5dp -> guarded island_filter ->
 * to_glb decimate 40000 -> uv_unwrap -> pbr_bake 512). Proven through the
 * package entrypoint, not internal imports.
 */

const IMAGINE_BOX_BASE = {
  subjectId: "ecg-cart-imagine-box",
  packId: "ecg-cart-imagine-box",
  seed: 42,
  remesh: false,
  viewCount: 4,
  decimationTarget: 40_000,
};

describe("equipment_generate r5-best export treatment", () => {
  it("(1) plans the R5-BEST treatment when exportTreatment is 'r5-best'", () => {
    const planned = planEquipmentGenerate({ ...IMAGINE_BOX_BASE, exportTreatment: "r5-best" });
    expect(planned.issues).toBeUndefined();
    if (planned.issues !== undefined) return;
    expect(planned.plan["exportTreatment"]).toBe("r5-best");
    expect(planned.plan["treatmentPipeline"]).toEqual([
      "cpu_fill_holes",
      "weld_5dp",
      "island_filter",
      "to_glb_decimate_40000",
      "uv_unwrap",
      "pbr_bake_512",
    ]);
  });

  it("(2) refuses an unknown exportTreatment value at plan time", () => {
    const planned = planEquipmentGenerate({ ...IMAGINE_BOX_BASE, exportTreatment: "ultra-hd" });
    expect(planned.issues).not.toBeUndefined();
  });

  it("(3) absent exportTreatment leaves the plan unchanged (legacy path)", () => {
    const planned = planEquipmentGenerate({ ...IMAGINE_BOX_BASE });
    expect(planned.issues).toBeUndefined();
    if (planned.issues !== undefined) return;
    expect(planned.plan["exportTreatment"]).toBeNull();
    expect(planned.plan["treatmentPipeline"]).toBeNull();
    expect(planned.plan["subjectId"]).toBe("ecg-cart-imagine-box");
    expect(planned.plan["viewCount"]).toBe(4);
    expect(planned.plan["conditioning"]).toBe("multi-view");
  });

  it("(4) r5-best on ecg-cart resolves the round-5b conditioning image", () => {
    const planned = planEquipmentGenerate({
      subjectId: "ecg-cart",
      packId: "ecg-cart",
      seed: 42,
      remesh: false,
      viewCount: 1,
      decimationTarget: 40_000,
      exportTreatment: "r5-best",
    });
    expect(planned.issues).toBeUndefined();
    if (planned.issues !== undefined) return;
    expect(planned.plan["exportTreatment"]).toBe("r5-best");
    expect(planned.plan["viewCount"]).toBe(1);
    expect(planned.plan["conditioning"]).toBe("single-view");
    expect(String(planned.plan["inputImagePath"])).toMatch(/ecg-cart-oracle-matted\.png$/);
  });
});

// NOT TESTED: live TRELLIS GPU bake with the treatment; publish+freeze on a real mesh_exported run.
