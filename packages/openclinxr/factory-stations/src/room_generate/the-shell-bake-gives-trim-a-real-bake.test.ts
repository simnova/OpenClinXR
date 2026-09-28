import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SRC = path.dirname(fileURLToPath(import.meta.url));
const BAKE_PY = path.join(SRC, "infinigen_generate", "bake_shell_materials.py");

/**
 * Trim RED: the S2 shell bake must give Infinigen's door/casing/skirting
 * trim a dedicated bake that captures what Infinigen put there.
 *
 * Measured on the real seed-205 ward bake (work.blend audit): the metal
 * door casing (`bedroom_0/0.door_casing`, hammered_metal) and the glass
 * door leaf land in the "other" role, whose DIFFUSE COLOR-only pass bakes
 * metallic diffuse -- which is ~black for metals -- so trim ships
 * near-black, and the shared-atlas islands are majority-degenerate slivers
 * the downstream albedo pass then deletes (collapsing normal/roughness to
 * the wrong UV set). This test runs the REAL script in Blender on a probe
 * blend (dielectric wall control + metallic casing in room naming + a raw
 * Infinigen-named casing twin) and asserts:
 *  (1) a shell_bake_trim material exists and both trim probes carry it
 *      (today they land in shell_bake_other);
 *  (2) the metallic trim's baked footprint mean luminance clears 40/255 --
 *      black metal-diffuse reads < 10, a captured metal tint reads ~150+,
 *      so 40 separates "baked black" from "baked something" with margin;
 *  (3) the dielectric wall control keeps shell_bake_wall and bakes bright
 *      (regression guard: passes before and after).
 *  (4) a material-less residue object leaves its role atlas neutral fill
 *      (mean luminance > 150/255) instead of opaque black: a role with no
 *      bakeable object runs no bake op, so the script must flood it.
 *
 * Raw `execFile`, no package-internal imports (same convention as the
 * sibling shell-bake test): the probe only needs Blender + the script.
 */

const SETUP_DRIVER = `
import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

def probe_cube(name, location, metallic, base_color):
    bpy.ops.mesh.primitive_cube_add(size=2, location=location)
    obj = bpy.context.active_object
    obj.name = name
    mat = bpy.data.materials.new(f"probe_{name.split('/')[-1].split('.')[-1]}")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (base_color[0], base_color[1], base_color[2], 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = 0.4
    obj.data.materials.append(mat)
    return obj

# Dielectric wall control (room naming): must stay shell_bake_wall.
probe_cube("probe_0/0.wall", (0, 0, 2), 0.0, (0.75, 0.60, 0.78))
# Metallic trim in room naming: must become shell_bake_trim, not "other".
probe_cube("probe_0/0.door_casing", (4, 0, 1), 1.0, (0.70, 0.68, 0.65))
# Raw Infinigen factory name (pre-strip shape): same trim bucket.
probe_cube("DoorCasingFactory(8790525).spawn_asset(0)", (-4, 0, 1), 1.0, (0.70, 0.68, 0.65))
# Material-less residue: must not ship an opaque-black atlas. A role whose
# objects carry no material runs no bake op; its image must be neutral fill.
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 4, 0.5))
bpy.context.active_object.name = "probe_0/0.exterior"
bpy.ops.wm.save_as_mainfile(filepath=r"__WORK_BLEND__")
print("probe setup saved")
`;

const MEASURE_DRIVER = `
import bpy

bpy.ops.wm.open_mainfile(filepath=r"__BAKED_BLEND__")

def footprint_stats(obj_name, image_name, uv_layer):
    obj = bpy.data.objects.get(obj_name)
    img = bpy.data.images.get(image_name)
    if obj is None or img is None:
        print(f"STAT {obj_name} MISSING")
        return
    me = obj.data
    layer = me.uv_layers.get(uv_layer)
    if layer is None:
        print(f"STAT {obj_name} NO_UV_LAYER")
        return
    W, H = img.size
    px = img.pixels[:]
    me.calc_loop_triangles()
    lum_sum = 0.0
    lum_sq = 0.0
    n = 0
    for tri in me.loop_triangles:
        uvs = [(layer.data[l].uv.x, layer.data[l].uv.y) for l in tri.loops]
        # Centroid sample per tri: robust for cube islands, no rasterizer.
        cx = sum(u[0] for u in uvs) / 3
        cy = sum(u[1] for u in uvs) / 3
        if not (0.0 <= cx <= 1.0 and 0.0 <= cy <= 1.0):
            continue
        xx = min(int(cx * W), W - 1)
        yy = min(int((1 - cy) * H), H - 1)
        o = (yy * W + xx) * 4
        lum = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) * 255.0
        lum_sum += lum
        lum_sq += lum * lum
        n += 1
    if n == 0:
        print(f"STAT {obj_name} NO_TRIS")
    else:
        mean = lum_sum / n
        print(f"STAT {obj_name} mat={me.materials[0].name if len(me.materials) else None} tris={n} meanL={mean:.2f}")

for name in ("probe_0/0.wall", "probe_0/0.door_casing", "DoorCasingFactory(8790525).spawn_asset(0)"):
    mat = bpy.data.objects.get(name).data.materials[0].name if bpy.data.objects.get(name) else None
    role = mat.split("shell_bake_")[-1] if mat and mat.startswith("shell_bake_") else "?"
    footprint_stats(name, f"shell_bake_albedo_{role}", f"ALB_{role}")
# Material-less residue bakes nothing: its atlas must read neutral fill
# (luminance ~203), never opaque black (~0).
footprint_stats("probe_0/0.exterior", "shell_bake_albedo_other", "ALB_other")
print("MEASURE_DONE")
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

function statFor(output: string, objName: string): { mat: string; meanL: number } {
  const match = output.match(new RegExp(`STAT ${objName.replace(/[().]/g, "\\$&")} mat=(\\S+) tris=\\d+ meanL=([\\d.]+)`));
  expect(`measure output for ${objName}:\n${output.slice(-1500)}`).toContain(`STAT ${objName} mat=`);
  return { mat: String(match?.[1]), meanL: Number(match?.[2]) };
}

describe("the shell bake gives trim a real bake", () => {
  it("classifies trim into shell_bake_trim and bakes metal trim non-black", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "shell-bake-trim-"));
    const workBlend = path.join(work, "work.blend");
    const bakedBlend = path.join(work, "baked.blend");
    writeFileSync(path.join(work, "setup.py"), SETUP_DRIVER.replaceAll("__WORK_BLEND__", workBlend), "utf8");
    writeFileSync(
      path.join(work, "measure.py"),
      MEASURE_DRIVER.replaceAll("__BAKED_BLEND__", bakedBlend),
      "utf8",
    );
    const setupOut = await runBlender(["--background", "--python", path.join(work, "setup.py")], work);
    expect(`setup:\n${setupOut.slice(-2000)}`).toContain("probe setup saved");
    const bakeOut = await runBlender(
      ["--background", "--python", BAKE_PY, "--", "--blend", workBlend, "--output", bakedBlend, "--seed", "205"],
      work,
    );
    expect(`bake:\n${bakeOut.slice(-3000)}`).toContain("[shell-bake] saved");
    expect(bakeOut).not.toContain("[blender-nonzero]");
    const measureOut = await runBlender(["--background", "--python", path.join(work, "measure.py")], work);
    expect(`measure:\n${measureOut.slice(-2000)}`).toContain("MEASURE_DONE");

    const wall = statFor(measureOut, "probe_0/0.wall");
    expect(wall.mat).toBe("shell_bake_wall");
    expect(wall.meanL).toBeGreaterThan(40);

    const casing = statFor(measureOut, "probe_0/0.door_casing");
    expect(casing.mat).toBe("shell_bake_trim");
    expect(casing.meanL).toBeGreaterThan(40);

    const raw = statFor(measureOut, "DoorCasingFactory(8790525).spawn_asset(0)");
    expect(raw.mat).toBe("shell_bake_trim");
    expect(raw.meanL).toBeGreaterThan(40);

    const residue = statFor(measureOut, "probe_0/0.exterior");
    expect(residue.mat).toBe("shell_bake_other");
    expect(residue.meanL).toBeGreaterThan(150);
  }, 900_000);
});
