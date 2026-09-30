import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withComputeSlot } from "@openclinxr/compute-slots";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SRC = path.dirname(fileURLToPath(import.meta.url));
const BAKE_PY = path.join(SRC, "infinigen_generate", "bake_shell_materials.py");

/**
 * Skirting RED: the S2 shell bake must give Infinigen's skirting (floor cove
 * + ceiling cornice) its OWN matte role, not the metal-aware trim bucket.
 *
 * Measured on the real seed-205 ward bake: skirting arrives as dielectric
 * white plastic (skirting_board.py geometry-nodes SetMaterial, plastic_rough)
 * but role_for_object() groups every skirting name shape into "trim", so the
 * cove shares the door frame's metal treatment -- GLOSSY COLOR screen plus a
 * shared low-roughness atlas -- and renders as a dark streaked metallic strip
 * instead of the specced 100mm grey vinyl cove. This test runs the REAL script
 * in Blender on a probe blend (dielectric skirting in room naming + a raw
 * Infinigen-named skirting twin + a metallic casing control) and asserts:
 *  (1) both skirting probes carry shell_bake_skirting (today shell_bake_trim);
 *  (2) the skirting material is flat: Base Color == SKIRTING_BASE_COLOR_LINEAR
 *      (read from the script source, not hardcoded), Roughness 0.9, Metallic 0,
 *      with NO shell_bake_albedo_skirting image (nothing baked, pinned flat);
 *  (3) the metallic casing control keeps shell_bake_trim with a real albedo
 *      image (regression guard: the split stole nothing from trim).
 *
 * Raw `execFile`, no package-internal imports (same convention as the sibling
 * shell-bake tests): the probe only needs Blender + the script.
 */

const SETUP_DRIVER = `
import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

def probe_cube(name, location, metallic, base_color, roughness):
    bpy.ops.mesh.primitive_cube_add(size=2, location=location)
    obj = bpy.context.active_object
    obj.name = name
    mat = bpy.data.materials.new(f"probe_{name.split('/')[-1].split('.')[-1]}")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (base_color[0], base_color[1], base_color[2], 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    obj.data.materials.append(mat)
    return obj

# Dielectric skirting in room naming (post-strip shape): must become shell_bake_skirting.
probe_cube("probe_0/0.skirting_floor", (0, 0, 1), 0.0, (0.9, 0.9, 0.88), 0.8)
# Raw Infinigen factory name (pre-strip shape): same skirting bucket.
probe_cube("skirtingboard_support", (-4, 0, 1), 0.0, (0.9, 0.9, 0.88), 0.8)
# Metallic casing control: must stay shell_bake_trim.
probe_cube("probe_0/0.door_casing", (4, 0, 1), 1.0, (0.70, 0.68, 0.65), 0.4)
bpy.ops.wm.save_as_mainfile(filepath=r"__WORK_BLEND__")
print("probe setup saved")
`;

const MEASURE_DRIVER = `
import bpy

bpy.ops.wm.open_mainfile(filepath=r"__BAKED_BLEND__")

def mat_of(obj_name):
    obj = bpy.data.objects.get(obj_name)
    if obj is None or not len(obj.data.materials):
        print(f"STAT {obj_name} MISSING")
        return
    print(f"STAT {obj_name} mat={obj.data.materials[0].name}")

for name in ("probe_0/0.skirting_floor", "skirtingboard_support", "probe_0/0.door_casing"):
    mat_of(name)

mat = bpy.data.materials.get("shell_bake_skirting")
if mat is None:
    print("STAT shell_bake_skirting MISSING")
else:
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    base = tuple(bsdf.inputs["Base Color"].default_value) if bsdf else None
    linked = bool(bsdf.inputs["Base Color"].links) if bsdf else True
    rough = float(bsdf.inputs["Roughness"].default_value) if bsdf else -1.0
    rough_linked = bool(bsdf.inputs["Roughness"].links) if bsdf else True
    metal = float(bsdf.inputs["Metallic"].default_value) if bsdf else -1.0
    print(f"STAT shell_bake_skirting base={base[0]:.4f},{base[1]:.4f},{base[2]:.4f} linked={linked} rough={rough:.4f} rough_linked={rough_linked} metal={metal:.4f}")

print(f"STAT images has_skirting_albedo={bpy.data.images.get('shell_bake_albedo_skirting') is not None}")
print(f"STAT images has_trim_albedo={bpy.data.images.get('shell_bake_albedo_trim') is not None}")

obj = bpy.data.objects.get("probe_0/0.skirting_floor")
if obj is not None:
    print(f"STAT layers skirting_floor={[u.name for u in obj.data.uv_layers]} active={obj.data.uv_layers.active.name}")
print("MEASURE_DONE")
`;

async function runBlender(args: string[], cwd: string): Promise<string> {
  try {
    const result = await withComputeSlot("blender", { label: "test:skirting-matte", cwd }, () =>
      execFileAsync("blender", args, { cwd, timeout: 600_000 }));
    return `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    return `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}\n[blender-nonzero]`;
  }
}

function pinnedBaseColor(): [number, number, number] {
  const src = readFileSync(BAKE_PY, "utf8");
  const match = src.match(/SKIRTING_BASE_COLOR_LINEAR\s*=\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  expect(`SKIRTING_BASE_COLOR_LINEAR in bake_shell_materials.py:\n${src.slice(0, 500)}`).toContain("SKIRTING_BASE_COLOR_LINEAR");
  return [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])];
}

function pinnedRoughness(): number {
  const src = readFileSync(BAKE_PY, "utf8");
  const match = src.match(/SKIRTING_ROUGHNESS\s*=\s*([\d.]+)/);
  expect(src).toContain("SKIRTING_ROUGHNESS");
  return Number(match?.[1]);
}

describe("the shell bake gives skirting its own matte role", () => {
  it("classifies skirting into shell_bake_skirting as pinned flat grey, trim untouched", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "shell-bake-skirting-"));
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

    expect(measureOut).toContain("STAT probe_0/0.skirting_floor mat=shell_bake_skirting");
    expect(measureOut).toContain("STAT skirtingboard_support mat=shell_bake_skirting");
    expect(measureOut).toContain("STAT probe_0/0.door_casing mat=shell_bake_trim");

    const [er, eg, eb] = pinnedBaseColor();
    const baseMatch = measureOut.match(/STAT shell_bake_skirting base=([\d.]+),([\d.]+),([\d.]+) linked=(\S+) rough=([\d.]+) rough_linked=(\S+) metal=([\d.]+)/);
    expect(`skirting flat stats:\n${measureOut.slice(-1500)}`).toContain("STAT shell_bake_skirting base=");
    expect(Math.abs(Number(baseMatch?.[1]) - er)).toBeLessThan(1e-3);
    expect(Math.abs(Number(baseMatch?.[2]) - eg)).toBeLessThan(1e-3);
    expect(Math.abs(Number(baseMatch?.[3]) - eb)).toBeLessThan(1e-3);
    expect(baseMatch?.[4]).toBe("False");
    expect(Math.abs(Number(baseMatch?.[5]) - pinnedRoughness())).toBeLessThan(1e-6);
    expect(baseMatch?.[6]).toBe("False");
    expect(Math.abs(Number(baseMatch?.[7]) - 0.0)).toBeLessThan(1e-6);

    expect(measureOut).toContain("STAT images has_skirting_albedo=False");
    expect(measureOut).toContain("STAT images has_trim_albedo=True");
    expect(measureOut).toContain("STAT layers skirting_floor=['ALB_skirting', 'BAKE_UV'] active=ALB_skirting");
  }, 900_000);
});
