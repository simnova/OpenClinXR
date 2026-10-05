import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withComputeSlot } from "@openclinxr/compute-slots/slots";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Repo root without importing the station internals (keeps the test import ceiling flat). */
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("repo root not found");
}

/**
 * Textured shell-bake materials (shell_bake_wall/floor/trim/ceiling/other)
 * must keep their COLOR-only albedo image wired as Base Color instead of
 * getting the lit DIFFUSE re-bake: with --restore-albedo defaulting True,
 * restore_bright_albedo() disconnects the shell COLOR image and the pass
 * then bakes DIRECT+INDIRECT+COLOR over a flat, discarding Infinigen's
 * textures and folding bake lighting into the albedo (measured 2026-09-29:
 * wall box 226.8 vs v2 ref 203.6 on the uncalibrated chain). A bank material
 * (shader_plaster, no shell_bake_ prefix) must still bake normally.
 *
 * Runs the REAL bake_materials (imported from the shipped
 * room-albedo-ao-bake.py, not a reimplementation) inside Blender with
 * restore_albedo=True (the production default) on a probe shell_bake_wall
 * carrying a distinctive albedo image plus a probe shader_plaster flat.
 * Live Blender per dispatch.
 */

const execFileAsync = promisify(execFile);

const DRIVER = `
import importlib.util
import sys

bake_path = sys.argv[sys.argv.index("--") + 1]
spec = importlib.util.spec_from_file_location("room_bake_under_test", bake_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

bpy.ops.mesh.primitive_plane_add(size=2)
shell_probe = bpy.context.active_object
shell_probe.name = "ShellTexturedProbe"

shell_mat = bpy.data.materials.new("shell_bake_wall")
shell_mat.use_nodes = True
shell_bsdf = next(n for n in shell_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
alb = bpy.data.images.new("shell_bake_albedo_wall", width=16, height=16, alpha=True)
alb.colorspace_settings.name = "sRGB"
alb.pixels.foreach_set([0.2, 0.4, 0.6, 1.0] * (16 * 16))
alb.pack()
alb_tex = shell_mat.node_tree.nodes.new("ShaderNodeTexImage")
alb_tex.image = alb
shell_mat.node_tree.links.new(alb_tex.outputs["Color"], shell_bsdf.inputs["Base Color"])
shell_probe.data.materials.append(shell_mat)

bpy.ops.mesh.primitive_plane_add(size=2, location=(4, 0, 0))
bank_probe = bpy.context.active_object
bank_probe.name = "BankProbe"
bank_mat = bpy.data.materials.new("shader_plaster")
bank_mat.use_nodes = True
bank_bsdf = next(n for n in bank_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bank_bsdf.inputs["Base Color"].default_value = (0.85, 0.84, 0.82, 1.0)
bank_probe.data.materials.append(bank_mat)

bpy.context.scene.render.engine = "CYCLES"
bpy.context.scene.cycles.samples = 1

results = mod.bake_materials(32, True)

shell_meta = results.get("shell_bake_wall")
print("shell textured probe results: %r" % (shell_meta,))
if not shell_meta or shell_meta.get("image") != "shell_bake_albedo_wall":
    print("FAIL: shell_bake_wall did not ship its baked COLOR image (got %r)" % (shell_meta,))
    raise SystemExit(1)
if shell_meta.get("skipReason") != "shell-textured-albedo":
    print("FAIL: shell_bake_wall skip reason is %r, not shell-textured-albedo" % (shell_meta.get("skipReason"),))
    raise SystemExit(1)
base = shell_bsdf.inputs["Base Color"]
linked = [l.from_node.image.name for l in base.links
          if l.from_node and l.from_node.type == "TEX_IMAGE" and l.from_node.image]
if linked != ["shell_bake_albedo_wall"]:
    print("FAIL: shell_bake_wall Base Color link was altered (now %r)" % (linked,))
    raise SystemExit(1)
if "openclinxr_room_bake_surface_wall_shell_bake_wall" in bpy.data.images:
    print("FAIL: a lit re-bake image was created for shell_bake_wall")
    raise SystemExit(1)
print("PASS: shell_bake_wall kept its COLOR albedo image with no lit re-bake")

bank_meta = results.get("shader_plaster")
print("bank probe results: %r" % (bank_meta,))
if not bank_meta or not str(bank_meta.get("image") or "").startswith("openclinxr_room_bake_"):
    print("FAIL: shader_plaster was not baked normally (got %r)" % (bank_meta,))
    raise SystemExit(1)
if bank_meta.get("skipped"):
    print("FAIL: shader_plaster was skipped by the shell prefix gate")
    raise SystemExit(1)
print("PASS: shader_plaster still bakes through the shared pipeline")
`;

describe("the room bake leaves textured shell materials on their COLOR albedo", () => {
  it("bake_materials skips shell_bake_wall with its image while baking shader_plaster", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "room-bake-shell-"));
    const driver = path.join(work, "shell_textured_driver.py");
    writeFileSync(driver, DRIVER, "utf8");
    const bakePy = path.join(
      findRepoRoot(),
      "packages/openclinxr/factory-stations/src/room_generate/room-albedo-ao-bake.py",
    );
    let output = "";
    try {
      const result = await withComputeSlot("blender", { label: "test:bake-skips-shell-texture" }, () => execFileAsync("blender", ["--background", "--python", driver, "--", bakePy], {
        cwd: findRepoRoot(),
        timeout: 300_000,
      }));
      output = `${result.stdout}\n${result.stderr}`;
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}`;
      expect(`Blender driver failed:\n${output.slice(-3000)}`).toBe("");
      return;
    }
    expect(output).toContain("PASS: shell_bake_wall kept its COLOR albedo image with no lit re-bake");
    expect(output).toContain("PASS: shader_plaster still bakes through the shared pipeline");
  }, 300_000);
});
