import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * Both room bakes select their Cycles backend explicitly (albedo issue:
 * CPU-only floor-forced 4096px DIFFUSE at 32 samples exceeds the unchanged
 * 300 s test budget; occlusion issue: the environment-artifacts override
 * args replace runRoomGenerate's metal defaults and omitted --device, so
 * the AO stage baked on CPU).
 *
 * No Blender in this test and no static source-text mirrors: each selection
 * is a pure function (resolve_albedo_device / resolve_occlusion_device,
 * importable with bpy/mathutils stubbed) exercised live in a child python3,
 * and each script is parsed live with the compile() builtin. The real Metal
 * bakes are proven separately by full-resolution bake-offs, not here.
 */

const ALBEDO_REL = "room-albedo-ao-bake.py";
const OCCLUSION_REL = "room-occlusion-bake.py";

const DRIVER = `
import importlib.util, json, sys, types
albedo_path, occlusion_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
sys.modules["bpy"] = types.ModuleType("bpy")
mu = types.ModuleType("mathutils")
mu.Vector = tuple
sys.modules["mathutils"] = mu

def load(name, bake_path):
    spec = importlib.util.spec_from_file_location(name, bake_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

albedo = load("room_albedo_under_test", albedo_path)
occlusion = load("room_occlusion_under_test", occlusion_path)

def exercise(resolve):
    checks = {
        "metal_present": resolve("metal", ["CPU", "METAL"]),
        "cpu_ignores_metal": resolve("cpu", ["CPU", "METAL"]),
        "cpu_no_metal": resolve("cpu", ["CPU"]),
        "auto_metal": resolve("auto", ["CPU", "METAL"]),
        "auto_cpu": resolve("auto", ["CPU"]),
        "auto_empty": resolve("auto", []),
    }
    errors = {}
    for name, req, avail in [
        ("metal_absent", "metal", ["CPU"]),
        ("metal_empty", "metal", []),
        ("bogus", "frob", ["CPU", "METAL"]),
    ]:
        try:
            resolve(req, avail)
            errors[name] = "NO_RAISE"
        except RuntimeError as e:
            errors[name] = str(e)
    return {"checks": checks, "errors": errors}

with open(out_path, "w", encoding="utf8") as fh:
    json.dump({
        "albedo": exercise(albedo.resolve_albedo_device),
        "occlusion": exercise(occlusion.resolve_occlusion_device),
    }, fh)
`;

const EXPECTED_CHECKS = {
  metal_present: "metal",
  cpu_ignores_metal: "cpu",
  cpu_no_metal: "cpu",
  auto_metal: "metal",
  auto_cpu: "cpu",
  auto_empty: "cpu",
};

describe("the room bakes select their cycles device", () => {
  it("resolves auto|metal|cpu with fail-closed metal without Blender (albedo and occlusion)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "room-bake-device-"));
    try {
      const driver = path.join(work, "driver.py");
      const out = path.join(work, "result.json");
      writeFileSync(driver, DRIVER, "utf8");
      // PYTHONDONTWRITEBYTECODE=1: importing the product files must not leave
      // bytecode beside them (py_compile always writes, so it is not used).
      const run = await execFileAsync(
        "python3",
        [driver, path.join(SRC, ALBEDO_REL), path.join(SRC, OCCLUSION_REL), out],
        {
          timeout: 60_000,
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        },
      )
        .then(() => ({ code: 0 }))
        .catch((err: { code?: number }) => ({ code: err.code ?? 1 }));
      expect(run.code).toBe(0);
      const result = JSON.parse(readFileSync(out, "utf8")) as {
        albedo: { checks: Record<string, string>; errors: Record<string, string> };
        occlusion: { checks: Record<string, string>; errors: Record<string, string> };
      };
      for (const stage of [result.albedo, result.occlusion] as const) {
        expect(stage.checks).toEqual(EXPECTED_CHECKS);
        expect(stage.errors["metal_absent"]).toContain("no METAL Cycles device found");
        expect(stage.errors["metal_empty"]).toContain("no METAL Cycles device found");
        expect(stage.errors["bogus"]).toContain("must be auto|metal|cpu");
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("parses both bake scripts as Python without writing bytecode", async () => {
    // In-memory compile() builtin: parses each adjacent product file without
    // executing it and without touching the filesystem (no .pyc anywhere).
    for (const rel of [ALBEDO_REL, OCCLUSION_REL]) {
      const run = await execFileAsync(
        "python3",
        ["-c", "import sys; compile(open(sys.argv[1], encoding='utf8').read(), sys.argv[1], 'exec')",
          path.join(SRC, rel)],
        { timeout: 60_000 },
      )
        .then(() => ({ code: 0 }))
        .catch((err: { code?: number }) => ({ code: err.code ?? 1 }));
      expect(run.code).toBe(0);
    }
  });
});
