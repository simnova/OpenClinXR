/**
 * The peds parent ships the keeper UV sheet on mpfb_skin_peds_anxious_parent.
 *
 * Albedo is the unwrapped body map in the station directory. Cavity stays,
 * packed with roughness the way Blender 5.1.1 exports the glTF Occlusion
 * socket. Fitted teeth keep viseme_aa, viseme_PP, and their vertex count.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const GLB = path.join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb");
const SCRIPT = path.join(REPO, "tools/openclinxr/asset-pipeline/skin/mpfb_skin_sheet.py");

describe("the Aisha skin sheet is on the factory material", () => {
  it("resolves only the peds parent sheet", () => {
    const out = execFileSync("python3", [SCRIPT, "--check"], { encoding: "utf8" });
    expect(out).toContain("SKIN_SHEET_CHECK ok");
  });

  it("wires albedo, normal, roughness, and cavity without moving the teeth", async () => {
    const doc = await new NodeIO().read(GLB);
    const material = doc.getRoot().listMaterials().find((item) => item.getName() === "mpfb_skin_peds_anxious_parent");
    expect(material, "factory skin material").toBeTruthy();
    expect(material!.getBaseColorTexture()?.getName()).toBe("skin-sheet-albedo");
    expect(material!.getNormalTexture()?.getName()).toBe("skin-sheet-normal");
    const roughness = material!.getMetallicRoughnessTexture();
    const occlusion = material!.getOcclusionTexture();
    expect(roughness?.getName()).toBe("skin-sheet-cavity-roughness");
    expect(occlusion).toBe(roughness);
    expect(material!.getMetallicFactor()).toBe(0);
    expect(material!.getRoughnessFactor()).toBe(1);
    const teeth = doc.getRoot().listMeshes().find((mesh) => mesh.getName() === "openclinxr_fitted_teeth_mpfb_parent_tara_johnson_v1_mesh");
    expect(teeth).toBeTruthy();
    const primitive = teeth!.listPrimitives()[0]!;
    expect(primitive.getAttribute("POSITION")?.getCount()).toBe(4494);
    const names = teeth!.getExtras()?.targetNames as string[];
    expect(names).toContain("viseme_aa");
    expect(names).toContain("viseme_PP");
  });
});
