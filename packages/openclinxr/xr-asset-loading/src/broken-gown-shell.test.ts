import { describe, expect, it } from "vitest";
import { Group, Mesh } from "three";

import { suppressBrokenAdultGownShell } from "./broken-gown-shell.js";

describe("broken adult gown shell suppression", () => {
  it("hides only the corrupt gown node on the affected asset", () => {
    const root = new Group();
    const broken = new Mesh();
    broken.name = "openclinxr_real_garment_from_phenotype_hospital_gown";
    const body = new Mesh();
    body.name = "mpfb_robert_reference_body";
    const cleanUnderlayer = new Mesh();
    cleanUnderlayer.name = "makeclothes_library_toigo_t_shirt";
    root.add(broken, body, cleanUnderlayer);

    expect(suppressBrokenAdultGownShell(root, "/generated-humanoids/mpfb-gown-adult-patient.glb")).toEqual([broken.name]);
    expect(broken.visible).toBe(false);
    expect(body.visible).toBe(true);
    expect(cleanUnderlayer.visible).toBe(true);
    expect(root.userData.openClinXrSuppressedBrokenGarmentNodes).toEqual([broken.name]);
  });

  it("does not suppress similarly named nodes on another asset", () => {
    const root = new Group();
    const garment = new Mesh();
    garment.name = "openclinxr_real_garment_from_phenotype_hospital_gown";
    root.add(garment);
    expect(suppressBrokenAdultGownShell(root, "/generated-humanoids/another.glb")).toEqual([]);
    expect(garment.visible).toBe(true);
  });
});
