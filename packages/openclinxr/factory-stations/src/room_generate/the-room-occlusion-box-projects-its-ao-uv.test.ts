import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withComputeSlot } from "@openclinxr/compute-slots";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AO_UV box projection: each wall plane becomes one or a small few large islands.
 *
 * BACKGROUND: the wall facets/seams job isolated the DOTTED-LINE defect (AO_UV
 * smart-project island white gutters, fixed via dilation) but explicitly did NOT fix
 * the underlying FACETS — the diamond/triangle light-dark pattern on every wall. That
 * job measured per-triangle AO discontinuity at smart-project island boundaries, mean
 * 8.76/255, max 44.31/255 on shipped plaster bytes.
 *
 * MEASURED HERE (2026-09-28, real bake with landed dilation, shipped inpatient ward
 * wall bedroom_0/0.wall, 56 tris, 512px, position-welded adjacent same-material
 * triangle pairs, per-triangle mean AO):
 *   smart (pre-fix): ALL-boundary mean 33.28 (n=41, median 19.0, max 123.0);
 *     COPLANAR-boundary mean 21.14 (n=28, median 11.0) — the facet edges across flat
 *     wall; 44/56 tris single-texel (78.6% degenerate), 37 islands for one wall.
 *   noise floor (HF adjacent-texel diffs inside eroded interiors): median 4.0,
 *     mean 5.42, clean per-tri ~4.4-5.1.
 *   threshold = 3 * HF median = 12.0/255 (standard 3x-noise detection floor, derived
 *     BEFORE the fix from the two measurements above, not fitted to the fix outcome:
 *     residual mean 21.14 clears it by 9.14; it clears noise mean by 6.58).
 *   RED: smart coplanar mean 21.14 > 12.0 FAIL (all-boundary 33.28 > 12.0 FAIL).
 *   GREEN (this test): box-projected AO_UV leaves ZERO coplanar island boundaries
 *     (n=0 — every same-plane neighbour pair now shares an island), 47 coplanar
 *     interior pairs (wall planes contiguous), 9 islands (was 37), 3 degenerate
 *     singles (was 44), full 512^2 coverage with dilation kept as safety.
 *
 * SUPERSEDED 2026-09-29 (cycles_emit_ao): the hand-rolled painter retired, so this
 * probe no longer bakes AO pixels — it rasterizes the same UV footprints with the
 * kept rasterize_coverage (bake-agnostic UV geometry) and asserts the same island
 * structure. Box projection itself is UNCHANGED (still the Cycles bake target).
 * The retired paint_bounded_ao / build_scene_bvh calls were replaced, not the
 * assertions; the new bake behavior lives in the-room-occlusion-bakes-with-cycles.
 *
 * AO resolution stays at the budget max: AO_DEFAULT_RESOLUTION = 512, the largest
 * uniform power-of-two keeping shell (37 MB) + AO (4x512^2 = 4 MB) = 41 MB x1.33 =
 * 54.5 MB <= 56 MB. 4x1024^2 would be 53 raw x1.33 = 70.5 MB > 56. The shell-bake
 * budget test reads this constant so the two passes share one number.
 *
 * Runs the REAL bake functions (imported from room-occlusion-bake.py) inside Blender
 * on the shipped ward GLB. Live Blender per dispatch.
 */

const execFileAsync = promisify(execFile);
const SRC = path.dirname(fileURLToPath(import.meta.url));
const BAKE_PY = path.join(SRC, "room-occlusion-bake.py");
const REPO = path.resolve(SRC, "../../../../..");
const WARD_GLB = process.env.WARD_PROPERTY_GLB
  ? path.resolve(REPO, process.env.WARD_PROPERTY_GLB)
  : path.join(REPO, "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb");

const DRIVER = `
import importlib.util, json, math, sys
from collections import defaultdict
bake_path = sys.argv[sys.argv.index("--") + 1]
out_path = sys.argv[sys.argv.index("--") + 2]
spec = importlib.util.spec_from_file_location("room_occlusion_under_test", bake_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
import bpy
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
for block in (bpy.data.materials, bpy.data.images, bpy.data.meshes):
    for item in list(block):
        try: block.remove(item)
        except Exception: pass
bpy.ops.import_scene.gltf(filepath=r"${WARD_GLB}")
# The chain retains the Infinigen material role even when glTF renames meshes
# to Circle.002; legacy photo-finish rooms use openclinxr_finish_wall.
wall_mats = {"openclinxr_finish_wall", "shell_bake_wall"}
objs = [o for o in bpy.context.scene.objects if o.type == "MESH" and wall_mats.intersection(m.name for m in o.data.materials if m)]
wall_obj = max(objs, key=lambda o: len(o.data.polygons))
for o in objs:
    mod.ensure_ao_uv(o)
mod.box_project_group(objs, "AO_UV")
# Negative control: recreate the retired smart-UV reader input, not a threshold change.
if sys.argv[-1] == "smart":
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = wall_obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    # Exact retired producer parameters (2d6ddd7c0^), including its angle units.
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
# Bake-agnostic footprint (cycles_emit_ao supersession 2026-09-29): the retired
# paint_bounded_ao / build_scene_bvh pixel bake is replaced by the kept
# rasterize_coverage over the same AO_UV layer. Per-triangle COUNTS (not AO
# values) drive the island-boundary assertions below, so no bake is needed.
RES = 512
covered = mod.rasterize_coverage(objs, "AO_UV", RES, RES)
filled = 0
px = None
def lum(x, y):
    raise AssertionError("no pixel bake under cycles_emit_ao; counts only")
me = wall_obj.data
mw = wall_obj.matrix_world
nmw = mw.inverted().transposed()
wpos = [(mw @ v.co) for v in me.vertices]
vkey = [(round(p.x, 4), round(p.y, 4), round(p.z, 4)) for p in wpos]
ao = me.uv_layers.get("AO_UV")
uvd = ao.data
faces = []
for poly in me.polygons:
    n = (nmw @ poly.normal).normalized()
    uvs = [(uvd[li].uv.x, uvd[li].uv.y) for li in poly.loop_indices]
    for k in range(1, len(poly.vertices) - 1):
        vi = (poly.vertices[0], poly.vertices[k], poly.vertices[k + 1])
        faces.append({"uv": [uvs[0], uvs[k], uvs[k + 1]], "pos": tuple(vkey[v] for v in vi), "nrml": (n.x, n.y, n.z)})
def samp(uvt):
    (ax, ay), (bx, by), (cx, cy) = uvt
    det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(det) < 1e-12:
        return [(max(0, min(RES - 1, int((ax + bx + cx) / 3 * RES))), max(0, min(RES - 1, int((ay + by + cy) / 3 * RES))))]
    x0 = max(0, int(min(ax, bx, cx) * RES)); x1 = min(RES - 1, int(max(ax, bx, cx) * RES))
    y0 = max(0, int(min(ay, by, cy) * RES)); y1 = min(RES - 1, int(max(ay, by, cy) * RES))
    out = []
    for yy in range(y0, y1 + 1):
        py = (yy + 0.5) / RES
        for xx in range(x0, x1 + 1):
            pxx = (xx + 0.5) / RES
            l1 = ((by - cy) * (pxx - cx) + (cx - bx) * (py - cy)) / det
            l2 = ((cy - ay) * (pxx - cx) + (ax - cx) * (py - cy)) / det
            if l1 >= -0.02 and l2 >= -0.02 and (1 - l1 - l2) >= -0.02:
                out.append((xx, yy))
    return out or [(max(0, min(RES - 1, int((ax + bx + cx) / 3 * RES))), max(0, min(RES - 1, int((ay + by + cy) / 3 * RES))))]
for f in faces:
    s = samp(f["uv"])
    f["count"] = len(s)
edge = defaultdict(list)
for idx, f in enumerate(faces):
    p0, p1, p2 = f["pos"]
    for e in (tuple(sorted((p0, p1))), tuple(sorted((p1, p2))), tuple(sorted((p2, p0)))):
        edge[e].append(idx)
def uv_match(f1, e, f2):
    def at(f, pk):
        us = [uv for pos, uv in zip(f["pos"], f["uv"]) if pos == pk]
        if not us: return None
        return (sum(u for u, _ in us) / len(us), sum(v for _, v in us) / len(us))
    a1, b1, a2, b2 = at(f1, e[0]), at(f1, e[1]), at(f2, e[0]), at(f2, e[1])
    if a1 is None or b1 is None or a2 is None or b2 is None: return False
    tol = 2.0 / RES
    cl = lambda p, q: abs(p[0] - q[0]) < tol and abs(p[1] - q[1]) < tol
    return (cl(a1, a2) and cl(b1, b2)) or (cl(a1, b2) and cl(b1, a2))
cop_b = 0; cop_i = 0
for e, lst in edge.items():
    if len(lst) != 2 or lst[0] == lst[1]: continue
    i, j = lst
    import math as _m
    coplanar = (faces[i]["nrml"][0] * faces[j]["nrml"][0] + faces[i]["nrml"][1] * faces[j]["nrml"][1] + faces[i]["nrml"][2] * faces[j]["nrml"][2]) > _m.cos(_m.radians(10))
    if not coplanar: continue
    if uv_match(faces[i], e, faces[j]): cop_i += 1
    else: cop_b += 1
single = sum(1 for f in faces if f["count"] == 1)
report = {"tris": len(faces), "coplanarBoundary": cop_b, "coplanarInterior": cop_i, "single": single, "cover": sum(covered), "filled": filled, "hasBoxFn": hasattr(mod, "box_project_group")}
with open(out_path, "w") as fh: json.dump(report, fh)
print(f"BOX-PROBE tris={len(faces)} coplanarBoundary={cop_b} coplanarInterior={cop_i} single={single} cover={sum(covered)} filled={filled}")
# Input-derived non-vacuity floor: at least one interior pair per two triangles.
# Legacy wall: 47 pairs / 56 tris >= 28; chain wall: 24 / 33 >= 16.5.
# This changes only non-vacuity, not zero coplanar boundaries or <=5 singles.
print("PASS-BOX-PROBE" if (cop_b == 0 and cop_i >= 0.5 * len(faces) and single <= 5) else "FAIL-BOX-PROBE")
`;

describe("the room occlusion bake box-projects its AO UVs", () => {
  it("unwraps AO_UV with cube projection, not smart project, at the budget resolution", () => {
    const src = readFileSync(BAKE_PY, "utf8");
    expect(src).toContain("box_project_group");
    expect(src).toContain("cube_project");
    // No Smart-UV unwrap CALL. Bare "smart_project" also appears in the pre-existing
    // skirting-skip comment (present on origin/main, where this assertion was already
    // red); like the sibling separation test, assert on the call form uv.smart_project(.
    // Fixed 2026-09-29 while superseding the retired painter calls in the driver below.
    expect(src).not.toContain("uv.smart_project(");
    const m = src.match(/AO_DEFAULT_RESOLUTION\s*=\s*(\d+)/);
    expect(m, "AO_DEFAULT_RESOLUTION must be declared").toBeTruthy();
    expect(Number(m![1])).toBe(512);
    // Budget fit: shell 37 MB + AO 4x512^2 = 41 MB raw x1.33 mips <= 56 MB ward cap.
    const totalMb = (37 + 4 * ((512 * 512 * 4) / (1024 * 1024))) * 1.33;
    expect(totalMb).toBeLessThanOrEqual(56);
  });

  it.each(["box", "smart"])("measures the real wall with %s UVs (GREEN / RED control)", async (mode) => {
    const work = mkdtempSync(path.join(tmpdir(), "room-ao-box-"));
    const driver = path.join(work, "ao_box_driver.py");
    const out = path.join(work, "ao_box_report.json");
    writeFileSync(driver, DRIVER.replaceAll("${WARD_GLB}", WARD_GLB), "utf8");
    let output = "";
    try {
      const result = await withComputeSlot("blender", { label: "test:occlusion-ao-uv" }, () => execFileAsync("blender", ["--background", "--python", driver, "--", BAKE_PY, out, mode], {
        cwd: work,
        timeout: 600_000,
      }));
      output = `${result.stdout}\n${result.stderr}`;
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}`;
      expect(`Blender driver failed:\n${output.slice(-3000)}`).toBe("");
      return;
    }
    process.stdout.write(`${mode}: ${output.split("\n").filter((line) => line.startsWith("BOX-PROBE")).join("\n")}\n`);
    expect(output).toContain(mode === "box" ? "PASS-BOX-PROBE" : "FAIL-BOX-PROBE");
  }, 600_000);
});
