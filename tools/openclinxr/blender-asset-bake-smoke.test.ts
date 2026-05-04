import { describe, expect, it } from "vitest";
import {
  BLENDER_COMMAND_TIMEOUT_MS,
  buildBlenderBakeSmokeReportFromGlb,
  createBlenderBakePythonScript,
} from "./blender-asset-bake-smoke.js";

describe("Blender asset bake smoke", () => {
  it("validates a baked GLB header and records Quest-budget fixture metadata", () => {
    const buffer = Buffer.alloc(32);
    buffer.write("glTF", 0, "utf8");
    buffer.writeUInt32LE(2, 4);
    buffer.writeUInt32LE(buffer.length, 8);

    const report = buildBlenderBakeSmokeReportFromGlb({
      generatedAt: "2026-05-04T00:00:00.000Z",
      blenderVersion: "Blender 5.1.1",
      elapsedMs: 42,
      glb: buffer,
    });

    expect(report.input.fixture).toBe("low_poly_clinical_humanoid");
    expect(report.output).toMatchObject({
      glbBytes: 32,
      magic: "glTF",
      version: 2,
      declaredLength: 32,
    });
    expect(report.verdict).toEqual({ passed: true, blockers: [] });
  });

  it("creates a Python bake script that exports a humanoid GLB without external assets", () => {
    const script = createBlenderBakePythonScript("/tmp/openclinxr-humanoid.glb");

    expect(script).toContain("primitive_uv_sphere_add");
    expect(script).toContain("primitive_cube_add");
    expect(script).toContain("clinical_placeholder_skin");
    expect(script).toContain("bpy.ops.export_scene.gltf");
    expect(script).toContain("/tmp/openclinxr-humanoid.glb");
  });

  it("allows enough time for first-launch Blender startup on local Macs", () => {
    expect(BLENDER_COMMAND_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});
