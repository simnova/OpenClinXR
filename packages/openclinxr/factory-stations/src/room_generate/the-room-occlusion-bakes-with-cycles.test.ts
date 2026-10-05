import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withComputeSlot } from "@openclinxr/compute-slots/slots";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Cycles EMIT+AO bake (cycles_emit_ao): the retired hand-rolled BVH raycaster
 * (paint_bounded_ao / bounded_ao_at / build_scene_bvh / texel_jitter, removed
 * 2026-09-29) is replaced by a real Cycles pass — per material group, a throwaway
 * override material (Emission lit only by an Ambient Occlusion node at
 * AO_REACH_METERS) shades the group's objects while bpy.ops.object.bake(type='EMIT')
 * writes the group's AO image through the kept box-projected AO_UV layer.
 *
 * MEASURED (Blender 5.1.1, box fixture 4.3 x 3.9 x 2.4 m, 2026-09-29):
 * - bpy.ops.object.bake(type='AO') ignores scene.render.bake.max_ray_distance
 *   (byte-identical maps at 0.0 vs 1.0) — the native AO bake type cannot ship.
 * - The AO node's Distance input IS honoured by an EMIT bake (0.0 = unbounded
 *   cave; 0.3/0.5/1.0 = graded contact falloff, room centre fully open; 3.0 =
 *   the 2.4 m ceiling re-enters).
 * - Reach 0.5 m: wall-base gradient ~0.5 m, corner 0.45 / edge 0.67, centre 1.0;
 *   reveals (0.1-0.35 m) and skirting (~0.1 m) inside, ceiling (2.4 m) outside.
 * - Samples 64: noise knee (mean |S-128| = 0.45/0.29/0.12 at 16/32/64).
 *
 * Runs the REAL bake_ao_per_material inside Blender on a small closed-room
 * fixture. Live Blender per dispatch.
 */

const execFileAsync = promisify(execFile);
const SRC = path.dirname(fileURLToPath(import.meta.url));
const BAKE_PY = path.join(SRC, "room-occlusion-bake.py");

const DRIVER = `
import importlib.util, json, sys
bake_path = sys.argv[sys.argv.index("--") + 1]
out_path = sys.argv[sys.argv.index("--") + 2]
spec = importlib.util.spec_from_file_location("room_occlusion_under_test", bake_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
import bpy
from mathutils import Vector

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
for block in (bpy.data.materials, bpy.data.images, bpy.data.meshes):
    for item in list(block):
        try: block.remove(item)
        except Exception: pass

# Closed box: 4x4 floor (8x8 subdivided so face centres tile it), one wall at
# x=-2, ceiling at 2.4. One Principled material everywhere.
bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0))
floor = bpy.context.active_object
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.subdivide(number_cuts=15)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.mesh.primitive_plane_add(size=4, location=(-2, 0, 1.2), rotation=(0, 1.5708, 0))
wall = bpy.context.active_object
wall.scale = (1.0, 1.0, 0.6)
bpy.context.view_layer.update()
bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 2.4), rotation=(3.14159, 0, 0))
ceil = bpy.context.active_object
mat = bpy.data.materials.new("cycles_probe_mat")
mat.use_nodes = True
for o in (floor, wall, ceil):
    o.data.materials.clear()
    o.data.materials.append(mat)

results = mod.bake_ao_per_material(64, "cpu")
res = results.get("cycles_probe_mat")
assert res is not None, "probe material missing from bake results"

def lum_at(target):
    me = floor.data
    mw = floor.matrix_world
    layer = me.uv_layers.get("AO_UV")
    assert layer is not None, "AO_UV missing after bake"
    uvd = layer.data
    best = None
    best_d = None
    for poly in me.polygons:
        c = mw @ poly.center
        d = (c.x - target[0]) ** 2 + (c.y - target[1]) ** 2
        if best_d is None or d < best_d:
            us = [uvd[li].uv for li in poly.loop_indices]
            best = (sum(u.x for u in us) / len(us), sum(u.y for u in us) / len(us))
            best_d = d
    img = bpy.data.images.get(res["image"])
    assert img is not None, "baked image missing"
    W, H = img.size
    px = list(img.pixels)
    xx = max(0, min(W - 1, int(best[0] * W)))
    yy = max(0, min(H - 1, int(best[1] * H)))
    return px[(yy * W + xx) * 4]

# Near band: darkest face-centre within 0.15-0.5 m of the wall (the contact
# gradient is narrower than one coarse grid cell, so a single nearest sample
# would grid-snap past it — take the band minimum like the locality fixture).
me = floor.data
mw = floor.matrix_world
layer = me.uv_layers.get("AO_UV")
uvd = layer.data
img = bpy.data.images.get(res["image"])
W, H = img.size
px = list(img.pixels)
def lum_uv(u, v):
    xx = max(0, min(W - 1, int(u * W)))
    yy = max(0, min(H - 1, int(v * H)))
    return px[(yy * W + xx) * 4]
near = 1.0
for poly in me.polygons:
    c = mw @ poly.center
    if -2.0 + 0.1 <= c.x <= -2.0 + 0.55 and abs(c.y) <= 0.6:
        us = [uvd[li].uv for li in poly.loop_indices]
        u = sum(x.x for x in us) / len(us)
        v = sum(x.y for x in us) / len(us)
        near = min(near, lum_uv(u, v))
far = lum_at((0.0, 0.0))     # 2 m from walls, 2.4 below ceiling: must stay open

# Determinism: a second production bake is byte-identical.
img1 = list(bpy.data.images.get(res["image"]).pixels)
results2 = mod.bake_ao_per_material(64, "cpu")
img2 = list(bpy.data.images.get(res["image"]).pixels)
deterministic = (img1 == img2)

# Restoration: no throwaway override material survives; every slot is original.
leftover = [m.name for m in bpy.data.materials if m.name.startswith("__openclinxr_ao_bake_")]
slots_ok = all(
    len(o.data.materials) == 1 and o.data.materials[0] is mat
    for o in (floor, wall, ceil)
)
# Wiring: the shipped tree carries the image node + AO_UV link + Occlusion link.
nt = mat.node_tree
has_img = any(n.type == "TEX_IMAGE" and n.image is not None and n.image.name == res["image"] for n in nt.nodes)
has_uv = any(n.type == "UVMAP" and n.uv_map == "AO_UV" for n in nt.nodes)
has_occ = any(
    n.type == "GROUP" and any(
        lk.from_node is not None and lk.from_node.type == "TEX_IMAGE"
        for inp in [n.inputs.get("Occlusion")] if inp is not None
        for lk in inp.links
    )
    for n in nt.nodes
)

report = {
    "near": round(near, 4), "far": round(far, 4),
    "darkening": round(near / far, 4) if far > 0 else None,
    "wired": bool(res["wired"]), "sd255": res["luminanceSd255"],
    "mechanism": getattr(mod, "AO_MECHANISM", "?"),
    "reach": getattr(mod, "AO_REACH_METERS", -1),
    "samples": getattr(mod, "AO_SAMPLES", -1),
    "deterministic": bool(deterministic),
    "noLeftoverMaterials": len(leftover) == 0,
    "slotsRestored": bool(slots_ok),
    "wiredImageNode": bool(has_img), "wiredUvMap": bool(has_uv), "wiredOcclusion": bool(has_occ),
}
with open(out_path, "w") as fh: json.dump(report, fh)
ok = (near < 0.8 and far > 0.9 and (near / far) < 0.9 and deterministic
      and len(leftover) == 0 and slots_ok and has_img and has_uv and has_occ
      and res["wired"] and report["mechanism"] == "cycles_emit_ao")
print("CYCLES-AO-PROBE " + json.dumps(report))
print("PASS-CYCLES-AO-PROBE" if ok else "FAIL-CYCLES-AO-PROBE")
`;

describe("the room occlusion bake uses a bounded Cycles pass", () => {
  it("declares the Cycles mechanism with measured reach/samples and no retired raycaster", () => {
    const src = readFileSync(BAKE_PY, "utf8");
    expect(src).toContain('AO_MECHANISM = "cycles_emit_ao"');
    expect(src).toContain("AO_REACH_METERS = 0.5");
    expect(src).toContain("AO_SAMPLES = 64");
    expect(src).toContain('bpy.ops.object.bake(type="EMIT"');
    expect(src).toContain("ShaderNodeAmbientOcclusion");
    // The retired hand-rolled painter and its raycasting/BVH machinery are gone.
    for (const dead of ["paint_bounded_ao", "texel_jitter", "bounded_ao_at", "build_scene_bvh",
      "sample_points_for_object", "bounded_raycast_v2", "AO_SAMPLES_PER_RING"]) {
      expect(src, `retired ${dead} must be gone`).not.toContain(dead);
    }
    // The kept UV layout + wiring contract the bake targets.
    for (const kept of ["box_project_group", "separate_coplanar_uv_groups", "coplanar_bin_key",
      "COPLANAR_PLANE_QUANTUM_M", "dilate_unpainted_texels", "rasterize_coverage",
      "AO_DEFAULT_RESOLUTION", "if sd255 < 6.0:"]) {
      expect(src, `kept ${kept} must survive`).toContain(kept);
    }
  });

  it("bakes bounded, deterministic, restoring AO on a closed-room fixture (GREEN)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "room-ao-cycles-"));
    const driver = path.join(work, "ao_cycles_driver.py");
    const out = path.join(work, "ao_cycles_report.json");
    writeFileSync(driver, DRIVER, "utf8");
    let output = "";
    try {
      const result = await withComputeSlot("blender", { label: "test:occlusion-cycles" }, () => execFileAsync("blender", ["--background", "--python", driver, "--", BAKE_PY, out], {
        cwd: work,
        timeout: 300_000,
      }));
      output = `${result.stdout}\n${result.stderr}`;
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}`;
      expect(`Blender driver failed:\n${output.slice(-3000)}`).toBe("");
      return;
    }
    expect(output).toContain("PASS-CYCLES-AO-PROBE");
  }, 300_000);
});
