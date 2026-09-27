import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
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
 * Finish materials meant to keep a flat Base Color must skip the albedo bake
 * (defect: bake_materials bakes every material, and the bake lighting turns
 * these vinyl-cove/T-bar flats near-black against the reference).
 *
 * Runs the REAL bake_materials (imported from the shipped
 * room-albedo-ao-bake.py, not a reimplementation) inside Blender on a probe
 * material named openclinxr_finish_wall with a distinctive flat Base Color,
 * and asserts the result records no bake image. Live Blender per dispatch.
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
plane = bpy.context.active_object
plane.name = "FinishFlatProbe"

mat = bpy.data.materials.new("openclinxr_finish_wall")
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
FLAT = (0.9, 0.1, 0.2, 1.0)
bsdf.inputs["Base Color"].default_value = FLAT
plane.data.materials.append(mat)

bpy.context.scene.render.engine = "CYCLES"
bpy.context.scene.cycles.samples = 1

results = mod.bake_materials(32, False)
meta = results.get("openclinxr_finish_wall")
print("finish-flat probe results: %r" % (meta,))
if not meta or meta.get("image"):
    print("FAIL: openclinxr_finish_wall was baked instead of skipped")
    raise SystemExit(1)
base = bsdf.inputs["Base Color"]
import math
current = tuple(base.default_value)
if base.links or not all(math.isclose(a, b, abs_tol=1e-6) for a, b in zip(current, FLAT)):
    print("FAIL: flat Base Color was altered by the bake")
    raise SystemExit(1)
print("PASS: openclinxr_finish_wall kept its flat Base Color with no bake image")
`;

describe("the room bake leaves finish flat materials unbaked", () => {
  it("bake_materials skips openclinxr_finish_wall with no bake image", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "room-bake-flat-"));
    const driver = path.join(work, "finish_flat_driver.py");
    writeFileSync(driver, DRIVER, "utf8");
    const bakePy = path.join(
      findRepoRoot(),
      "packages/openclinxr/factory-stations/src/room_generate/room-albedo-ao-bake.py",
    );
    let output = "";
    try {
      const result = await execFileAsync("blender", ["--background", "--python", driver, "--", bakePy], {
        cwd: findRepoRoot(),
        timeout: 300_000,
      });
      output = `${result.stdout}\n${result.stderr}`;
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}`;
      expect(`Blender driver failed:\n${output.slice(-3000)}`).toBe("");
      return;
    }
    expect(output).toContain("PASS: openclinxr_finish_wall kept its flat Base Color");
  }, 300_000);
});
