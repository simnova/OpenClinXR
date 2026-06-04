import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLENDER_COMMAND_TIMEOUT_MS,
  buildBlenderBakeSmokeReportFromGlb,
  createBlenderBakePythonScript,
  runBlenderBakeSmokeCli,
  validateBlenderBakeSmokeReport,
} from "./blender-asset-bake-smoke.js";

describe("Blender asset bake smoke", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:blender:bake"]).toBe(
      "tsx tools/openclinxr/evidence/blender-asset-bake-smoke.ts",
    );
    expect(rootPackage.scripts["asset:blender:bake:validate"]).toBe(
      "tsx tools/openclinxr/evidence/blender-asset-bake-smoke.ts --validate-latest",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm asset:blender:bake:validate");
  });

  it("validates a baked GLB header and records Quest-budget fixture metadata", () => {
    const placeholderObjectNames = clinicalAssetPackObjectNames();
    const buffer = glbBufferWithJson({
      scene: 0,
      scenes: [{ name: "ed_chest_pain_clinical_asset_pack_scene", nodes: placeholderObjectNames.map((_, index) => index) }],
      nodes: placeholderObjectNames.map((name, index) => ({ name, mesh: index })),
      meshes: placeholderObjectNames.map((name) => ({ name: `${name}_mesh` })),
      materials: [{ name: "clinical_equipment_matte_metal" }],
    });

    const report = buildBlenderBakeSmokeReportFromGlb({
      generatedAt: "2026-05-04T00:00:00.000Z",
      blenderVersion: "Blender 5.1.1",
      elapsedMs: 42,
      glb: buffer,
    });

    expect(report.input.fixture).toBe("ed_chest_pain_clinical_asset_pack");
    expect(report.output).toMatchObject({
      glbBytes: buffer.length,
      magic: "glTF",
      version: 2,
      declaredLength: buffer.length,
      semanticInventory: {
        sceneCount: 1,
        nodeCount: placeholderObjectNames.length,
        meshCount: placeholderObjectNames.length,
        materialCount: 1,
        requiredObjectNames: clinicalAssetPackObjectNames(),
        missingRequiredObjectNames: [],
      },
    });
    expect(report.verdict).toEqual({ passed: true, blockers: [] });
  });

  it("records reviewed local clinical asset-pack metadata without external assets", () => {
    const objectNames = clinicalAssetPackObjectNames();
    const buffer = glbBufferWithJson({
      scene: 0,
      scenes: [{ name: "ed_chest_pain_clinical_asset_pack_scene", nodes: objectNames.map((_, index) => index) }],
      nodes: objectNames.map((name, index) => ({ name, mesh: index })),
      meshes: objectNames.map((name) => ({ name: `${name}_mesh` })),
      materials: [
        { name: "patient_skin_tone_reviewed_local" },
        { name: "clinical_equipment_matte_metal" },
      ],
    });

    const report = buildBlenderBakeSmokeReportFromGlb({
      generatedAt: "2026-05-06T00:00:00.000Z",
      blenderVersion: "Blender 5.1.1",
      elapsedMs: 42,
      glb: buffer,
      fixture: "ed_chest_pain_clinical_asset_pack",
    });

    expect(report.input).toEqual({
      fixture: "ed_chest_pain_clinical_asset_pack",
      externalAssetsUsed: false,
      sourceLicensePosture: "reviewed_local_clinical_asset_fixture",
      expectedObjectCount: clinicalAssetPackObjectNames().length,
    });
    expect(report.output.semanticInventory).toMatchObject({
      sceneCount: 1,
      nodeCount: clinicalAssetPackObjectNames().length,
      meshCount: clinicalAssetPackObjectNames().length,
      materialCount: 2,
      requiredObjectNames: clinicalAssetPackObjectNames(),
      missingRequiredObjectNames: [],
    });
    expect(report.verdict).toEqual({ passed: true, blockers: [] });
  });

  it("validates report schema and blocker consistency before downstream reuse", () => {
    const objectNames = clinicalAssetPackObjectNames();
    const buffer = glbBufferWithJson({
      scene: 0,
      scenes: [{ name: "ed_chest_pain_clinical_asset_pack_scene", nodes: objectNames.map((_, index) => index) }],
      nodes: objectNames.map((name, index) => ({ name, mesh: index })),
      meshes: objectNames.map((name) => ({ name: `${name}_mesh` })),
      materials: [{ name: "patient_skin_tone_reviewed_local" }],
    });
    const report = buildBlenderBakeSmokeReportFromGlb({
      generatedAt: "2026-05-06T00:00:00.000Z",
      blenderVersion: "Blender 5.1.1",
      elapsedMs: 42,
      glb: buffer,
      fixture: "ed_chest_pain_clinical_asset_pack",
    });
    expect(validateBlenderBakeSmokeReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report) as Record<string, unknown>;
    const output = invalid.output as Record<string, unknown>;
    const semanticInventory = output.semanticInventory as Record<string, unknown>;
    semanticInventory.missingRequiredObjectNames = ["ecg_cart_12_lead"];
    const verdict = invalid.verdict as { blockers: string[] };
    verdict.blockers = [];

    expect(validateBlenderBakeSmokeReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/verdict/blockers must include glb_required_object_missing:ecg_cart_12_lead",
      ]),
    });

    const missingInventory = structuredClone(report) as Record<string, unknown>;
    (missingInventory.output as Record<string, unknown>).semanticInventory = null;
    (missingInventory.verdict as { blockers: string[] }).blockers = [];

    expect(validateBlenderBakeSmokeReport(missingInventory)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/verdict/blockers must include glb_json_chunk_missing",
        "/verdict/blockers must include glb_node_count_below_expected_object_count",
      ]),
    });
  });

  it("validates committed bake reports from the CLI without launching Blender", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-blender-bake-validate-"));
    const reportPath = path.join(tempDir, "blender-asset-bake-smoke.json");
    const invalidPath = path.join(tempDir, "blender-asset-bake-smoke-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      const report = buildBlenderBakeSmokeReportFromGlb({
        generatedAt: "2026-05-06T00:00:00.000Z",
        blenderVersion: "Blender 5.1.1",
        elapsedMs: 42,
        glb: glbBufferWithJson({
          scene: 0,
          scenes: [{ name: "ed_chest_pain_clinical_asset_pack_scene", nodes: clinicalAssetPackObjectNames().map((_, index) => index) }],
          nodes: clinicalAssetPackObjectNames().map((name, index) => ({ name, mesh: index })),
          meshes: clinicalAssetPackObjectNames().map((name) => ({ name: `${name}_mesh` })),
          materials: [{ name: "clinical_equipment_matte_metal" }],
        }),
      });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

      await expect(runBlenderBakeSmokeCli(["--validate", reportPath])).resolves.toBeUndefined();
      await expect(runBlenderBakeSmokeCli(["--validate-latest"])).resolves.toBeUndefined();

      const invalidReport = structuredClone(report) as Record<string, unknown>;
      delete invalidReport.tool;
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runBlenderBakeSmokeCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks reviewed clinical asset-pack GLBs when required semantic objects are missing", () => {
    const buffer = glbBufferWithJson({
      scene: 0,
      scenes: [{ name: "ed_chest_pain_clinical_asset_pack_scene", nodes: [0, 1] }],
      nodes: [
        { name: "patient_robert_hayes_canonical_skeleton_anchor", mesh: 0 },
        { name: "ecg_cart_12_lead", mesh: 1 },
      ],
      meshes: [{ name: "patient_anchor_mesh" }, { name: "ecg_cart_12_lead_mesh" }],
      materials: [{ name: "clinical_equipment_matte_metal" }],
    });

    const report = buildBlenderBakeSmokeReportFromGlb({
      generatedAt: "2026-05-06T00:00:00.000Z",
      blenderVersion: "Blender 5.1.1",
      elapsedMs: 42,
      glb: buffer,
      fixture: "ed_chest_pain_clinical_asset_pack",
    });

    expect(report.output.semanticInventory?.missingRequiredObjectNames).toEqual(
      clinicalAssetPackObjectNames().filter((name) => name !== "patient_robert_hayes_canonical_skeleton_anchor" && name !== "ecg_cart_12_lead"),
    );
    expect(report.verdict.passed).toBe(false);
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "glb_required_object_missing:ed_exam_bay_floor_panel",
      "glb_required_object_missing:nurse_maria_alvarez_canonical_skeleton_anchor",
    ]));
  });

  it("blocks malformed GLBs that do not expose a JSON chunk for semantic inspection", () => {
    const buffer = Buffer.alloc(32);
    buffer.write("glTF", 0, "utf8");
    buffer.writeUInt32LE(2, 4);
    buffer.writeUInt32LE(buffer.length, 8);

    const report = buildBlenderBakeSmokeReportFromGlb({
      generatedAt: "2026-05-06T00:00:00.000Z",
      blenderVersion: "Blender 5.1.1",
      elapsedMs: 42,
      glb: buffer,
      fixture: "ed_chest_pain_clinical_asset_pack",
    });

    expect(report.output.semanticInventory).toBeNull();
    expect(report.verdict).toEqual({
      passed: false,
      blockers: [
        "glb_json_chunk_missing",
        "glb_node_count_below_expected_object_count",
        ...clinicalAssetPackObjectNames().map((name) => `glb_required_object_missing:${name}`),
      ],
    });
  });

  it("rejects the removed legacy low-poly humanoid fixture", async () => {
    await expect(runBlenderBakeSmokeCli(["--fixture", "low_poly_clinical_humanoid"])).rejects.toThrow(
      "Unsupported Blender bake fixture: low_poly_clinical_humanoid",
    );
  });

  it("creates a reviewed ED chest-pain clinical asset-pack script with named equipment and rig anchors", () => {
    const script = createBlenderBakePythonScript(
      "/tmp/openclinxr-ed-pack.glb",
      "ed_chest_pain_clinical_asset_pack",
    );

    expect(script).toContain("patient_robert_hayes_canonical_skeleton_anchor");
    expect(script).toContain("nurse_maria_alvarez_canonical_skeleton_anchor");
    expect(script).toContain("ed_exam_bay_wall_monitor");
    expect(script).toContain("ecg_cart_12_lead");
    expect(script).toContain("iv_pole_with_pump");
    expect(script).not.toContain("placeholder");
    expect(script).toContain("bpy.ops.export_scene.gltf");
  });

  it("allows enough time for first-launch Blender startup on local Macs", () => {
    expect(BLENDER_COMMAND_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

function glbBufferWithJson(json: Record<string, unknown>): Buffer {
  const jsonText = `${JSON.stringify(json)} `;
  const paddingLength = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
  const jsonChunk = Buffer.from(`${jsonText}${" ".repeat(paddingLength)}`, "utf8");
  const buffer = Buffer.alloc(12 + 8 + jsonChunk.length);
  buffer.write("glTF", 0, "utf8");
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(jsonChunk.length, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(buffer, 20);
  return buffer;
}

function clinicalAssetPackObjectNames(): string[] {
  return [
    "ed_exam_bay_floor_panel",
    "ed_exam_bay_back_wall",
    "ed_exam_bay_privacy_curtain_rail",
    "stretcher_frame_with_side_rails",
    "stretcher_mattress_linen",
    "stretcher_left_side_rail",
    "stretcher_right_side_rail",
    "patient_robert_hayes_head",
    "patient_robert_hayes_torso_hospital_gown",
    "patient_robert_hayes_left_arm_diaphoretic_pose",
    "patient_robert_hayes_right_arm_chest_guarding_pose",
    "patient_robert_hayes_canonical_skeleton_anchor",
    "nurse_maria_alvarez_head",
    "nurse_maria_alvarez_torso_scrubs",
    "nurse_maria_alvarez_tablet",
    "nurse_maria_alvarez_canonical_skeleton_anchor",
    "ed_exam_bay_wall_monitor",
    "ecg_cart_12_lead",
    "iv_pole_with_pump",
    "oxygen_flowmeter_wall_unit",
    "asset_pack_scale_and_origin_marker",
  ];
}
