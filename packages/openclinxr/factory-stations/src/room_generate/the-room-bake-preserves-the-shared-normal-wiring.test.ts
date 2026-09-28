import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SRC = path.dirname(fileURLToPath(import.meta.url));
const ALBEDO_PY = path.join(SRC, "room-albedo-ao-bake.py");

/**
 * Shared-atlas wiring RED: the post-extract albedo pass must not orphan the
 * S2 normal/roughness images.
 *
 * Measured on the real seed-205 ward bake: S2's shared BAKE_UV islands for
 * wall/trim are majority-degenerate slivers, so the albedo pass's <0.5
 * non-degenerate rule deleted the BAKE_UV layer and every normal/roughness
 * lookup collapsed onto the albedo UV set (fullrun.glb: wall+trim normal
 * and roughness on TEXCOORD_0 instead of TEXCOORD_1 -- dark faceted walls,
 * chrome-streaked trim at runtime). This test builds an S2-shaped fixture
 * (two UV layers, albedo on the first, a linked normal map on the second
 * with the second layer fully collapsed) and runs the REAL albedo script:
 * the exported GLB must keep the normal texture on TEXCOORD_1 (today it
 * collapses to 0).
 *
 * External @gltf-transform imports only (package dependency, not an
 * internal relative import); raw execFile for Blender like its siblings.
 */

const SETUP_DRIVER = `
import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=2)
obj = bpy.context.active_object
obj.name = "probe_0/0.wall"
me = obj.data
me.uv_layers[0].name = "ALB_wall"
me.uv_layers.new(name="BAKE_UV")
# Fully collapsed shared-atlas layer, like the ward trim islands.
for poly in me.polygons:
    for li in poly.loop_indices:
        me.uv_layers["BAKE_UV"].data[li].uv = (0.01, 0.01)
mat = bpy.data.materials.new("probe_plaster_wall")
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.75, 0.60, 0.78, 1.0)
bsdf.inputs["Metallic"].default_value = 0.0
alb_img = bpy.data.images.new("probe_alb", width=32, height=32)
alb_tex = nt.nodes.new("ShaderNodeTexImage")
alb_tex.image = alb_img
alb_um = nt.nodes.new("ShaderNodeUVMap")
alb_um.uv_map = "ALB_wall"
nt.links.new(alb_um.outputs["UV"], alb_tex.inputs["Vector"])
nt.links.new(alb_tex.outputs["Color"], bsdf.inputs["Base Color"])
nrm_img = bpy.data.images.new("probe_nrm", width=32, height=32)
nrm_tex = nt.nodes.new("ShaderNodeTexImage")
nrm_tex.image = nrm_img
nrm_um = nt.nodes.new("ShaderNodeUVMap")
nrm_um.uv_map = "BAKE_UV"
nt.links.new(nrm_um.outputs["UV"], nrm_tex.inputs["Vector"])
nmap = nt.nodes.new("ShaderNodeNormalMap")
nmap.uv_map = "BAKE_UV"
nt.links.new(nrm_tex.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
me.materials.append(mat)
bpy.ops.export_scene.gltf(filepath=r"__FIXTURE_GLB__", export_format="GLB", use_selection=True)
print("fixture exported")
`;

async function runBlender(args: string[], cwd: string): Promise<string> {
  try {
    const result = await execFileAsync("blender", args, { cwd, timeout: 600_000 });
    return `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    return `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}\n[blender-nonzero]`;
  }
}

describe("the room bake preserves the shared normal wiring", () => {
  it("keeps a referenced collapsed layer so normal stays on TEXCOORD_1", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "room-bake-wiring-"));
    const fixtureGlb = path.join(work, "fixture.glb");
    const outputGlb = path.join(work, "baked.glb");
    writeFileSync(
      path.join(work, "setup.py"),
      SETUP_DRIVER.replaceAll("__FIXTURE_GLB__", fixtureGlb),
      "utf8",
    );
    const setupOut = await runBlender(["--background", "--python", path.join(work, "setup.py")], work);
    expect(`setup:\n${setupOut.slice(-2000)}`).toContain("fixture exported");
    const bakeOut = await runBlender(
      ["--background", "--python", ALBEDO_PY, "--", "--input", fixtureGlb, "--output", outputGlb, "--resolution", "64"],
      work,
    );
    expect(`bake:\n${bakeOut.slice(-3000)}`).toContain("[room-bake] baked");
    expect(bakeOut).not.toContain("[blender-nonzero]");

    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(outputGlb);
    const root = doc.getRoot();
    expect(root.listMeshes().length).toBeGreaterThan(0);
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        expect(prim.getAttribute("TEXCOORD_0")).not.toBeNull();
        expect(prim.getAttribute("TEXCOORD_1")).not.toBeNull();
      }
    }
    for (const mat of root.listMaterials()) {
      const normal = mat.getNormalTextureInfo();
      expect(normal).not.toBeNull();
      expect(normal?.getTexCoord()).toBe(1);
    }
  }, 900_000);
});
