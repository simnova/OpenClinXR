import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withComputeSlot } from "@openclinxr/compute-slots";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Wall-facets-ao-seams: the AO bake's smart_project islands ship with white
 * gutters between them, and the runtime's bilinear/mip sampling blends those
 * into every island border as bright dotted seams (measured on a shipped 512px
 * plaster AO map: 41.7% white background, +10.4/255 edge brightening, 28.7%
 * white-ish at mip level 3). paint_bounded_ao now returns a coverage mask and
 * dilate_unpainted_texels nearest-fills the gutters, so borders blend with
 * edge-like tones. Covered texels are never touched.
 *
 * Runs the REAL function (imported from the shipped room-occlusion-bake.py,
 * not a reimplementation) inside Blender on a two-quad probe with a deliberate
 * UV gutter. Live Blender per dispatch.
 *
 * SUPERSEDED 2026-09-29 (cycles_emit_ao): the retired paint_bounded_ao no longer
 * produces the island values — the probe fills them directly (0.4 content vs 1.0
 * clear gutter) and rasterizes coverage with the kept rasterize_coverage.
 * dilate_unpainted_texels itself is UNCHANGED and bake-agnostic; every assertion
 * below exercises it, not the retired painter. New bake behavior lives in
 * the-room-occlusion-bakes-with-cycles.
 */

const execFileAsync = promisify(execFile);
const SRC = path.dirname(fileURLToPath(import.meta.url));

const DRIVER = `
import importlib.util
import sys

bake_path = sys.argv[sys.argv.index("--") + 1]
spec = importlib.util.spec_from_file_location("room_occlusion_under_test", bake_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

# Two quads with a world gap (the occluder cube the retired painter needed for
# non-white islands is gone: island values are filled directly below).
bpy.ops.mesh.primitive_plane_add(size=1, location=(-0.8, 0, 0))
left = bpy.context.active_object
bpy.ops.mesh.primitive_plane_add(size=1, location=(0.8, 0, 0))
right = bpy.context.active_object

# Manual AO_UV split: left quad in u [0, 0.4], right quad in u [0.6, 1.0].
# The middle 0.2 band is gutter no face covers, whatever the packer does.
for obj, u0, u1 in ((left, 0.0, 0.4), (right, 0.6, 1.0)):
    me = obj.data
    if "AO_UV" not in [u.name for u in me.uv_layers]:
        me.uv_layers.new(name="AO_UV")
    me.uv_layers.active = me.uv_layers["AO_UV"]
    base = me.uv_layers[0]
    ao = me.uv_layers["AO_UV"]
    for i in range(len(me.loops)):
        bx, by = base.data[i].uv
        ao.data[i].uv = (u0 + bx * (u1 - u0), by)

bpy.context.scene.render.engine = "CYCLES"

RES = 64
# Bake-agnostic coverage (cycles_emit_ao supersession 2026-09-29): footprints
# rasterized from the AO_UV geometry, not painted by the retired painter.
covered = mod.rasterize_coverage([left, right], "AO_UV", RES, RES)

def bake_once():
    img = bpy.data.images.new("probe_ao", width=RES, height=RES, alpha=False, float_buffer=False)
    # Synthetic island content: painted texels get a real value (0.4), gutter
    # stays at the clear white (1.0) — the shape the retired painter produced.
    px = []
    for i in range(RES * RES):
        v = 0.4 if covered[i] else 1.0
        px.extend((v, v, v, 1.0))
    img.pixels.foreach_set(px)
    pre = list(img.pixels)
    filled = mod.dilate_unpainted_texels(img, covered)
    post = list(img.pixels)
    return covered, pre, post, filled

covered, pre, post, filled = bake_once()
n = RES * RES
n_covered = sum(covered)
n_gutter = n - n_covered
print(f"probe coverage: painted={n_covered} gutter={n_gutter} filled={filled}")
if n_covered == 0 or n_gutter == 0:
    print("FAIL: probe has no islands+GUTTER structure")
    raise SystemExit(1)

# RED premise (defect shape, still true of paint): gutter texels leave paint white.
gutter_white = sum(1 for i in range(n) if not covered[i] and pre[i * 4] >= 0.999)
print(f"gutter texels white after paint: {gutter_white}/{n_gutter}")
if gutter_white != n_gutter:
    print("FAIL: paint should leave every gutter texel white")
    raise SystemExit(1)

# GREEN: every gutter texel filled.
if filled != n_gutter:
    print(f"FAIL: dilate filled {filled} of {n_gutter} gutter texels")
    raise SystemExit(1)

# Covered texels are never touched by the dilation.
touched = sum(1 for i in range(n) if covered[i] and abs(post[i * 4] - pre[i * 4]) > 1e-9)
print(f"covered texels altered by dilate: {touched}")
if touched != 0:
    print("FAIL: dilate must not touch painted texels")
    raise SystemExit(1)

# No high-contrast seam remains: every gutter texel touching a painted island
# must carry one of its painted neighbours' own values (nearest-edge fill), so
# border sampling under bilinear/mip blends with edge-like tones. (Painted open
# texels may legitimately read white next to a painted island; those are real
# content, not background, and the dilation leaves them alone.)
W = RES
bad = 0
deep = 0
for y in range(RES):
    for x in range(RES):
        i = y * W + x
        if covered[i]:
            continue
        neighbours = []
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < RES and 0 <= ny < RES and covered[ny * W + nx]:
                neighbours.append(pre[(ny * W + nx) * 4])
        if not neighbours:
            deep += 1
            continue
        if min(abs(post[i * 4] - v) for v in neighbours) > 1e-6:
            bad += 1
print(f"gutter texels matching a painted neighbour: bad={bad} deep={deep}")
if bad != 0:
    print("FAIL: island borders still touch contrasting background")
    raise SystemExit(1)

# Determinism: a second paint+dilate run is byte-identical.
covered2, pre2, post2, filled2 = bake_once()
if filled2 != filled or post2 != post:
    print("FAIL: bake is not byte-deterministic across runs")
    raise SystemExit(1)
print("PASS: gutters dilated, painted texels untouched, borders padded, deterministic")
`;

describe("the room occlusion bake dilates its UV gutters", () => {
  it("nearest-fills unpainted gutters without touching painted texels", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "room-ao-dilate-"));
    const driver = path.join(work, "ao_dilate_driver.py");
    writeFileSync(driver, DRIVER, "utf8");
    const bakePy = path.join(SRC, "room-occlusion-bake.py");
    let output = "";
    try {
      const result = await withComputeSlot("blender", { label: "test:occlusion-gutters", cwd: work }, () => execFileAsync(
        "blender",
        ["--background", "--python", driver, "--", bakePy],
        { cwd: work, timeout: 300_000 },
      ));
      output = `${result.stdout}\n${result.stderr}`;
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}`;
      expect(`Blender driver failed:\n${output.slice(-3000)}`).toBe("");
      return;
    }
    expect(output).toContain("PASS: gutters dilated, painted texels untouched, borders padded, deterministic");
  }, 300_000);
});
