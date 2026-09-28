import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * S2 pre-export shell material bake.
 *
 * The post-extract albedo pass bakes from the GLB, but Blender's exporter
 * writes no image for a procedural node tree, so hue is gone before that
 * bake starts. generate.ts therefore bakes from the live work.blend between
 * the strip step and the extract step. This test pins that order, the bake
 * technique (BAKE_UV atlas, DIFFUSE COLOR-only, NORMAL, ROUGHNESS, Image
 * Texture -> Principled replacement, no lights), the texture budget, and
 * runs the REAL script inside Blender on a two-cube procedural probe.
 */

const execFileAsync = promisify(execFile);
const SRC = path.dirname(fileURLToPath(import.meta.url));
const BAKE_PY = path.join(SRC, "infinigen_generate", "bake_shell_materials.py");
const GENERATE_TS = path.join(SRC, "generate.ts");

/** Decoded RGBA8 MB for a square image, with mips. */
function decodedMbWithMips(size: number): number {
  return ((size * size * 4) / (1024 * 1024)) * 1.33;
}

const SETUP_DRIVER = `
import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

def probe_cube(name, location, base_color):
    bpy.ops.mesh.primitive_cube_add(size=2, location=location)
    obj = bpy.context.active_object
    obj.name = name
    mat = bpy.data.materials.new(f"probe_proc_{name.split('.')[-1]}")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    # Procedural color: nothing a GLB export could preserve without a bake.
    # No flat colour constant feeds the BSDF anywhere in this graph -- a
    # bare RGB node's default value survives a plain glTF export/reimport
    # (measured: Blender's exporter picks it up even though it is one hop
    # from Base Color through a Mix node), which would let the "no bake"
    # comparison pass by accident. A ColorRamp driven by the Voronoi
    # distance is a real per-texel evaluation with no static fallback
    # value the exporter can substitute.
    tex = nt.nodes.new("ShaderNodeTexVoronoi")
    tex.location = (-600, 200)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-350, 200)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (base_color[0] * 0.6, base_color[1] * 0.6, base_color[2] * 0.6, 1.0)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (min(base_color[0] * 1.4, 1.0), min(base_color[1] * 1.4, 1.0), min(base_color[2] * 1.4, 1.0), 1.0)
    nt.links.new(tex.outputs["Distance"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.location = (-400, -200)
    nt.links.new(noise.outputs["Fac"], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = 0.0
    obj.data.materials.append(mat)
    return obj

probe_cube("probe_0/0.floor", (0, 0, -1), (0.8, 0.6, 0.2))
probe_cube("probe_0/0.wall", (0, 0, 2), (0.4, 0.7, 0.5))
bpy.ops.wm.save_as_mainfile(filepath=r"__WORK_BLEND__")
print("probe setup saved")
`;

const CHECK_DRIVER = `
import bpy
import sys

bpy.ops.wm.open_mainfile(filepath=r"__BAKED_BLEND__")
mats = {m.name for m in bpy.data.materials if m.use_nodes}
for role in ("floor", "wall"):
    name = f"shell_bake_{role}"
    if name not in mats:
        print(f"FAIL: consolidated material {name} missing")
        raise SystemExit(1)
    mat = bpy.data.materials[name]
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        print(f"FAIL: {name} has no Principled BSDF")
        raise SystemExit(1)
    if not bsdf.inputs["Base Color"].links or not bsdf.inputs["Roughness"].links:
        print(f"FAIL: {name} albedo/roughness not wired to Principled")
        raise SystemExit(1)
    if not bsdf.inputs["Normal"].links:
        print(f"FAIL: {name} normal not wired to Principled")
        raise SystemExit(1)
albedo = bpy.data.images.get("shell_bake_albedo_floor")
if albedo is None or min(albedo.size) < 1024:
    print("FAIL: floor albedo missing or below the 1024 px resolution floor")
    raise SystemExit(1)
for img_name in ("shell_bake_normal", "shell_bake_roughness"):
    img = bpy.data.images.get(img_name)
    if img is None or min(img.size) < 1024:
        print(f"FAIL: shared image {img_name} missing or below 1024 px")
        raise SystemExit(1)
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    layers = [u.name for u in obj.data.uv_layers]
    role = "floor" if ".floor" in obj.name else "wall"
    if layers != [f"ALB_{role}", "BAKE_UV"]:
        print(f"FAIL: {obj.name} UV layers {layers} (want [ALB_{role}, BAKE_UV])")
        raise SystemExit(1)
    if obj.data.uv_layers.active.name != f"ALB_{role}":
        print(f"FAIL: {obj.name} active layer is not the albedo layout")
        raise SystemExit(1)
if list(bpy.data.lights):
    print("FAIL: bake added lights to the blend")
    raise SystemExit(1)
print("PASS: shell bake consolidated, wired, >= 1024 px, albedo layout first, no lights")
`;

/** Opens a baked .blend, saves each shell_bake_* image to disk, prints its sha256+bytes. */
const EXTRACT_IMAGES_DRIVER = `
import bpy, hashlib
bpy.ops.wm.open_mainfile(filepath=r"__BAKED_BLEND__")
for img in bpy.data.images:
    if not img.name.startswith("shell_bake_"):
        continue
    path = r"__OUT_DIR__" + "/" + img.name + ".png"
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    with open(path, "rb") as f:
        data = f.read()
    print(f"IMG {img.name} sha256={hashlib.sha256(data).hexdigest()} bytes={len(data)}")
`;

function extractImageHashes(output: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of output.matchAll(/IMG (\S+) sha256=([0-9a-f]{64})/g)) {
    out.set(match[1], match[2]);
  }
  return out;
}

/** Opens __BLEND__, reads image __IMAGE__'s pixels, prints mean R and B over opaque texels. */
const MEASURE_RB_DRIVER = `
import bpy
bpy.ops.wm.open_mainfile(filepath=r"__BLEND__")
img = bpy.data.images.get("__IMAGE__")
if img is None:
    print("RB_MISSING")
else:
    px = img.pixels[:]
    w, h = img.size
    n = w * h
    sum_r = 0.0
    sum_b = 0.0
    painted = 0
    for i in range(n):
        o = i * 4
        a = px[o + 3]
        if a <= 0.001:
            continue
        sum_r += px[o]
        sum_b += px[o + 2]
        painted += 1
    if painted == 0:
        print("RB_NO_PAINTED_TEXELS")
    else:
        mean_r = (sum_r / painted) * 255.0
        mean_b = (sum_b / painted) * 255.0
        print(f"RB_MEAN r={mean_r:.3f} b={mean_b:.3f} painted={painted} total={n}")
`;

/** Skips bake_shell_materials: exports work.blend's probe straight to GLB, re-imports, reads the floor material's flat Base Color (no bake => no procedural hue survives). */
const NO_BAKE_DRIVER = `
import bpy
bpy.ops.wm.open_mainfile(filepath=r"__WORK_BLEND__")
bpy.ops.export_scene.gltf(filepath=r"__NOBAKE_GLB__", export_format="GLB")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"__NOBAKE_GLB__")
mat = None
for o in bpy.data.objects:
    if ".floor" in o.name and o.data and o.data.materials:
        mat = o.data.materials[0]
        break
if mat is None or not mat.use_nodes:
    print("NOBAKE_NO_MATERIAL")
else:
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        print("NOBAKE_NO_BSDF")
    else:
        c = bsdf.inputs["Base Color"]
        if c.links:
            print("NOBAKE_STILL_LINKED")
        else:
            r, g, b, a = c.default_value
            print(f"NOBAKE_RB r={r*255.0:.3f} b={b*255.0:.3f}")
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

describe("the shell bake runs before the extract", () => {
  it("(1) generate.ts spawns the bake between the strip and the extract", () => {
    const src = readFileSync(GENERATE_TS, "utf8");
    const stripAt = src.indexOf("strip_room_shell_placeholders.py");
    const bakeAt = src.indexOf("bake_shell_materials.py");
    const extractAt = src.indexOf('durationsMs["extractMs"]');
    expect(stripAt).toBeGreaterThanOrEqual(0);
    expect(bakeAt).toBeGreaterThan(stripAt);
    expect(extractAt).toBeGreaterThan(bakeAt);
    expect(src).toContain('durationsMs["shellBakeMs"]');
    expect(src).toContain("room shell bake failed");
  });

  it("(2) the script bakes COLOR-only albedo plus normal and roughness, no lights", () => {
    const src = readFileSync(BAKE_PY, "utf8");
    expect(src).toContain('pass_filter={"COLOR"}');
    expect(src).toContain('"NORMAL"');
    expect(src).toContain('"ROUGHNESS"');
    expect(src).toContain("BAKE_UV");
    expect(src).toContain("smart_project");
    expect(src).toContain("ShaderNodeBsdfPrincipled");
    // Trim has its own role (never "other"): door/casing/skirting patterns
    // classify there, and a GLOSSY COLOR pass added onto the diffuse keeps
    // metallic trim from baking black (metals have no diffuse response).
    expect(src).toContain("door_leaf");
    expect(src).toContain('"GLOSSY"');
    expect(src).toContain("combine_diffuse_glossy");
    // Collapsed smart-project faces are snapped to painted texels; cleared
    // backgrounds are neutral-filled (never sampled as garbage).
    expect(src).toContain("snap_degenerate_faces");
    expect(src).toContain("fill_unpainted_texels");
    expect(src).not.toContain("data.lights.new");
    // Fail closed: Blender exits 0 on uncaught exceptions, so force exit 1.
    expect(src).toContain("os._exit(1)");
  });

  it("(3) the baked images fit the 56 MB decoded ward budget", () => {
    const src = readFileSync(BAKE_PY, "utf8");
    const albedoByRole = new Map(
      [...src.matchAll(/"(floor|wall|ceiling|trim|other)":\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
    );
    expect(albedoByRole.size).toBeGreaterThanOrEqual(5);
    const normalSize = Number(src.match(/SHARED_NORMAL_SIZE\s*=\s*(\d+)/)?.[1]);
    const roughSize = Number(src.match(/SHARED_ROUGHNESS_SIZE\s*=\s*(\d+)/)?.[1]);
    expect(normalSize).toBeGreaterThanOrEqual(1024);
    expect(roughSize).toBeGreaterThanOrEqual(1024);
    // Shell images plus the untouched AO pass (4x512^2) must stay under budget.
    const shellMb =
      [...albedoByRole.values()].reduce((acc, s) => acc + (s * s * 4) / (1024 * 1024), 0) +
      ((normalSize * normalSize * 4) + (roughSize * roughSize * 4)) / (1024 * 1024);
    const totalMb = (shellMb + 4 * ((512 * 512 * 4) / (1024 * 1024))) * 1.33;
    expect(totalMb).toBeLessThanOrEqual(56);
    // Resolution floor: every SURFACE image >= 1024 px on its long edge.
    // The "other" residue atlas (exterior hull faces, boolean cutters --
    // never a primary visible surface) is the documented exception at 512.
    for (const [role, s] of albedoByRole) {
      if (role === "other") expect(s).toBe(512);
      else expect(s).toBeGreaterThanOrEqual(1024);
    }
    for (const s of [normalSize, roughSize]) {
      expect(s).toBeGreaterThanOrEqual(1024);
    }
    expect(decodedMbWithMips(1024)).toBeCloseTo(5.32, 2);
  });

  it("(4) the real script bakes a procedural probe inside Blender", async () => {
    expect(existsSync(BAKE_PY)).toBe(true);
    const work = mkdtempSync(path.join(tmpdir(), "shell-bake-"));
    const workBlend = path.join(work, "work.blend");
    const bakedBlend = path.join(work, "baked.blend");
    writeFileSync(path.join(work, "setup.py"), SETUP_DRIVER.replaceAll("__WORK_BLEND__", workBlend), "utf8");
    writeFileSync(
      path.join(work, "check.py"),
      CHECK_DRIVER.replaceAll("__BAKED_BLEND__", bakedBlend),
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
    const checkOut = await runBlender(["--background", "--python", path.join(work, "check.py")], work);
    expect(`check:\n${checkOut.slice(-2000)}`).toContain(
      "PASS: shell bake consolidated, wired, >= 1024 px, albedo layout first, no lights",
    );
  }, 900_000);

  it("(5) the same seed produces bit-identical baked image bytes on two runs", async () => {
    // Same probe blend, baked twice with the same --seed. If any bake step
    // (UV unwrap ordering, texel fill, sample count) carries hidden
    // nondeterminism, the sha256 of at least one image will differ.
    const workA = mkdtempSync(path.join(tmpdir(), "shell-bake-det-a-"));
    const workB = mkdtempSync(path.join(tmpdir(), "shell-bake-det-b-"));
    const blendA = path.join(workA, "work.blend");
    const blendB = path.join(workB, "work.blend");
    writeFileSync(path.join(workA, "setup.py"), SETUP_DRIVER.replaceAll("__WORK_BLEND__", blendA), "utf8");
    writeFileSync(path.join(workB, "setup.py"), SETUP_DRIVER.replaceAll("__WORK_BLEND__", blendB), "utf8");
    await runBlender(["--background", "--python", path.join(workA, "setup.py")], workA);
    await runBlender(["--background", "--python", path.join(workB, "setup.py")], workB);
    const bakedA = path.join(workA, "baked.blend");
    const bakedB = path.join(workB, "baked.blend");
    const bakeOutA = await runBlender(
      ["--background", "--python", BAKE_PY, "--", "--blend", blendA, "--output", bakedA, "--seed", "205"],
      workA,
    );
    const bakeOutB = await runBlender(
      ["--background", "--python", BAKE_PY, "--", "--blend", blendB, "--output", bakedB, "--seed", "205"],
      workB,
    );
    expect(bakeOutA).toContain("[shell-bake] saved");
    expect(bakeOutB).toContain("[shell-bake] saved");
    writeFileSync(
      path.join(workA, "extract.py"),
      EXTRACT_IMAGES_DRIVER.replaceAll("__BAKED_BLEND__", bakedA).replaceAll("__OUT_DIR__", workA),
      "utf8",
    );
    writeFileSync(
      path.join(workB, "extract.py"),
      EXTRACT_IMAGES_DRIVER.replaceAll("__BAKED_BLEND__", bakedB).replaceAll("__OUT_DIR__", workB),
      "utf8",
    );
    const hashesA = extractImageHashes(await runBlender(["--background", "--python", path.join(workA, "extract.py")], workA));
    const hashesB = extractImageHashes(await runBlender(["--background", "--python", path.join(workB, "extract.py")], workB));
    expect(hashesA.size).toBeGreaterThanOrEqual(4);
    expect([...hashesA.keys()].sort()).toEqual([...hashesB.keys()].sort());
    for (const [name, hashA] of hashesA) {
      expect(`${name}: ${hashB(hashesB, name)}`).toBe(`${name}: ${hashA}`);
    }
  }, 900_000);

  it("(6) the floor bake keeps real hue; skipping the bake does not (measured both ways, this run)", async () => {
    // Not a pinned constant: bakes the same probe THIS test run bakes (a
    // fresh work.blend + bake_shell_materials pass), reads the floor
    // image's own pixels for |R-B|, and separately proves the negative --
    // export the SAME probe straight to GLB with no bake_shell_materials
    // step at all, and show its Base Color (Principled default, no
    // procedural hue) reads <= 8. A tautology asserting two hardcoded
    // constants would pass even if the bake technique broke; this fails
    // the moment either number moves.
    const work = mkdtempSync(path.join(tmpdir(), "shell-bake-rb-"));
    const workBlend = path.join(work, "work.blend");
    writeFileSync(path.join(work, "setup.py"), SETUP_DRIVER.replaceAll("__WORK_BLEND__", workBlend), "utf8");
    await runBlender(["--background", "--python", path.join(work, "setup.py")], work);

    // WITH the bake: real floor albedo image, mean R/B over opaque texels.
    const bakedBlend = path.join(work, "baked.blend");
    const bakeOut = await runBlender(
      ["--background", "--python", BAKE_PY, "--", "--blend", workBlend, "--output", bakedBlend, "--seed", "205"],
      work,
    );
    expect(bakeOut).toContain("[shell-bake] saved");
    writeFileSync(
      path.join(work, "measure.py"),
      MEASURE_RB_DRIVER.replaceAll("__BLEND__", bakedBlend).replaceAll("__IMAGE__", "shell_bake_albedo_floor"),
      "utf8",
    );
    const measureOut = await runBlender(["--background", "--python", path.join(work, "measure.py")], work);
    const withBake = measureOut.match(/RB_MEAN r=([\d.]+) b=([\d.]+) painted=(\d+) total=(\d+)/);
    expect(`measure:\n${measureOut.slice(-1000)}`).toMatch(/RB_MEAN/);
    const rWith = Number(withBake![1]);
    const bWith = Number(withBake![2]);
    const rbWith = Math.abs(rWith - bWith);

    // WITHOUT the bake: same probe, plain glTF export/reimport, Principled
    // default Base Color (procedural node tree dropped, nothing baked).
    const nobakeGlb = path.join(work, "nobake.glb");
    writeFileSync(
      path.join(work, "nobake.py"),
      NO_BAKE_DRIVER.replaceAll("__WORK_BLEND__", workBlend).replaceAll("__NOBAKE_GLB__", nobakeGlb),
      "utf8",
    );
    const nobakeOut = await runBlender(["--background", "--python", path.join(work, "nobake.py")], work);
    const noBake = nobakeOut.match(/NOBAKE_RB r=([\d.]+) b=([\d.]+)/);
    expect(`nobake:\n${nobakeOut.slice(-1000)}`).toMatch(/NOBAKE_RB/);
    const rNo = Number(noBake![1]);
    const bNo = Number(noBake![2]);
    const rbNo = Math.abs(rNo - bNo);

    // Recorded here (not asserted as a constant) so a failure shows both
    // numbers: with-bake must clear the floor, without-bake must not.
    expect(`with-bake |R-B|=${rbWith.toFixed(2)} (r=${rWith.toFixed(1)} b=${bWith.toFixed(1)})`).toMatch(/.*/);
    expect(rbWith).toBeGreaterThan(8);
    expect(`no-bake |R-B|=${rbNo.toFixed(2)} (r=${rNo.toFixed(1)} b=${bNo.toFixed(1)})`).toMatch(/.*/);
    expect(rbNo).toBeLessThanOrEqual(8);
  }, 900_000);
});

function hashB(hashesB: Map<string, string>, name: string): string {
  return hashesB.get(name) ?? "MISSING";
}
