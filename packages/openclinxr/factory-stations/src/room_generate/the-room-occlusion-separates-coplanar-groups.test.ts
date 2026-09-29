import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AO_UV co-planar-group separation: opposite interior walls must not share texels.
 *
 * SUPERSEDED 2026-09-29 (cycles_emit_ao): the painter/min-reducer/jitter half of this
 * contract retired with paint_bounded_ao — the first `it` now asserts their ABSENCE.
 * Geometric separation itself is KEPT (still the Cycles bake target) and the live
 * GREEN probe below still exercises it. New bake behavior lives in
 * the-room-occlusion-bakes-with-cycles.
 *
 * BACKGROUND: the lattice diagnosis (docs/openclinxr/room-realism/lattice-diagnosis/REPORT.md)
 * measured that box_project_group's single cube-project pass lands co-planar parallel faces
 * (the ward's double-wall construction, walls 0.1-0.35 m apart, plus opposite walls across
 * the room) into OVERLAPPING UV regions, and paint_bounded_ao keeps the per-texel MINIMUM
 * across overlapping painters -- the winner changes at triangle/UV edges including
 * triangulation diagonals, which bilinear/mip filtering renders as the dotted lattice.
 * Reproduced on the real ward wall (bedroom_0/0.wall, bake-equivalent wall-only grouping):
 * 99.6% of painted texels covered by 2+ non-adjacent faces, 98.8% of those with ALL
 * painters interior-visible (opposite walls across the room, not hull -- the exterior
 * object bakes into its own residue image and never reaches the wall's UV space, and no
 * same-wall front/back skin pairs exist inside the wall object). So the fix is geometric
 * UV separation, NOT a different per-texel reducer: each co-planar group (dominant axis
 * + sign + 5 cm plane quantum) packs into its own disjoint atlas cell after projection.
 *
 * RED (pre-fix): eroded overlap fraction ~0.99 on this probe. GREEN: < 0.02.
 * Runs the REAL bake function inside Blender on the shipped ward GLB. Live Blender per dispatch.
 */

const execFileAsync = promisify(execFile);
const SRC = path.dirname(fileURLToPath(import.meta.url));
const BAKE_PY = path.join(SRC, "room-occlusion-bake.py");
const REPO = path.resolve(SRC, "../../../../..");
const WARD_GLB = path.join(REPO, "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb");

const DRIVER = `
import importlib.util, json, sys
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
# Bake-equivalent grouping: the wall object alone (at bake time it wears
# shell_bake_wall while the exterior wears the residue shell_bake_other, so
# hull geometry never reaches the wall's UV image).
wall_obj = max([o for o in bpy.context.scene.objects if o.type == "MESH" and "wall" in o.name.lower() and "exterior" not in o.name.lower()], key=lambda o: len(o.data.polygons))
mod.ensure_ao_uv(wall_obj)
mod.box_project_group([wall_obj], "AO_UV")
RES = 256
me = wall_obj.data
mw = wall_obj.matrix_world
layer = me.uv_layers.get("AO_UV")
uvd = layer.data
faces = []
for poly in me.polygons:
    vkeys = tuple(sorted((round((mw @ me.vertices[vi].co).x, 4), round((mw @ me.vertices[vi].co).y, 4), round((mw @ me.vertices[vi].co).z, 4)) for vi in poly.vertices))
    uvs = [(uvd[li].uv.x, uvd[li].uv.y) for li in poly.loop_indices]
    tris = []
    for k in range(1, len(uvs) - 1):
        tris.append((uvs[0], uvs[k], uvs[k + 1]))
    faces.append((vkeys, tris))
def bary(px, py, a, b, c):
    det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(det) < 1e-12:
        return (1.0/3.0, 1.0/3.0, 1.0/3.0)
    l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det
    l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det
    return (l1, l2, 1.0 - l1 - l2)
cover = [0] * (RES * RES)
second = [0] * (RES * RES)
first = [-1] * (RES * RES)
for fi, (vkeys, tris) in enumerate(faces):
    vset = set(vkeys)
    for (ax, ay), (bx, by), (cx, cy) in tris:
        x0 = max(0, int(min(ax, bx, cx) * RES)); x1 = min(RES - 1, int(max(ax, bx, cx) * RES))
        y0 = max(0, int(min(ay, by, cy) * RES)); y1 = min(RES - 1, int(max(ay, by, cy) * RES))
        for yy in range(y0, y1 + 1):
            py = (yy + 0.5) / RES
            for xx in range(x0, x1 + 1):
                px = (xx + 0.5) / RES
                l1, l2, l3 = bary(px, py, (ax, ay), (bx, by), (cx, cy))
                if l1 >= -0.02 and l2 >= -0.02 and l3 >= -0.02:
                    idx = yy * RES + xx
                    cover[idx] += 1
                    if first[idx] < 0:
                        first[idx] = fi
                    else:
                        f0 = faces[first[idx]][0]
                        if not (set(f0) & vset):
                            second[idx] = 1
painted = [i for i in range(RES * RES) if cover[i] > 0]
pset = set(painted)
interior = [i for i in painted if all(((i % RES + dx, i // RES + dy) == (i % RES, i // RES) or ((i // RES + dy) * RES + (i % RES + dx)) in pset) for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)) if 0 <= i % RES + dx < RES and 0 <= i // RES + dy < RES)]
overlap = sum(1 for i in interior if second[i])
frac = (overlap / len(interior)) if interior else 0.0
nbins = getattr(mod, "LAST_SEPARATION_BIN_COUNT", -1)
report = {"painted": len(painted), "interior": len(interior), "overlap": overlap, "frac": frac, "bins": nbins}
with open(out_path, "w") as fh: json.dump(report, fh)
print(f"SEPARATION-PROBE painted={len(painted)} interior={len(interior)} overlap={overlap} frac={frac:.4f} bins={nbins}")
print("PASS-SEPARATION-PROBE" if (frac < 0.02 and nbins >= 4) else "FAIL-SEPARATION-PROBE")
`;

describe("the room occlusion bake separates co-planar groups into disjoint UV cells", () => {
  it("keeps cube projection and geometric separation; the retired min reducer and jitter are gone", () => {
    const src = readFileSync(BAKE_PY, "utf8");
    expect(src).toContain("box_project_group");
    expect(src).toContain("cube_project");
    // No Smart-UV unwrap CALL (comments may still name it: the skirting-skip
    // note on main documents smart_project slivers on dense trim geometry).
    expect(src).not.toContain("uv.smart_project(");
    // SUPERSEDED 2026-09-29 (cycles_emit_ao): the hand-rolled painter retired, so
    // its per-texel min() reducer is GONE — the Cycles EMIT bake writes each texel
    // once through disjoint UV cells, and there is nothing left to arbitrate. New
    // bake behavior lives in the-room-occlusion-bakes-with-cycles.
    expect(src, "the retired min() reducer must be gone with paint_bounded_ao").not.toContain("if ao < buf[idx]");
    expect(src).toContain("coplanar_bin_key");
    // SUPERSEDED 2026-09-29 (cycles_emit_ao): texel-hashed sampling rotation retired
    // with the painter — Cycles does the hemisphere sampling now, so no rotation
    // field (hashed or sequential) may remain.
    expect(src, "the retired texel_jitter must be gone with paint_bounded_ao").not.toContain("texel_jitter");
    expect(src).not.toContain("rng.random()");
  });

  it("leaves approximately zero doubly-painted wall texels on the real ward wall (GREEN)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "room-ao-sep-"));
    const driver = path.join(work, "ao_sep_driver.py");
    const out = path.join(work, "ao_sep_report.json");
    writeFileSync(driver, DRIVER.replaceAll("${WARD_GLB}", WARD_GLB), "utf8");
    let output = "";
    try {
      const result = await execFileAsync("blender", ["--background", "--python", driver, "--", BAKE_PY, out], {
        cwd: work,
        timeout: 600_000,
      });
      output = `${result.stdout}\n${result.stderr}`;
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}`;
      expect(`Blender driver failed:\n${output.slice(-3000)}`).toBe("");
      return;
    }
    expect(output).toContain("PASS-SEPARATION-PROBE");
  }, 600_000);
});
