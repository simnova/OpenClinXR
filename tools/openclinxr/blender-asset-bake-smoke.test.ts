import { describe, expect, it } from "vitest";
import {
  BLENDER_COMMAND_TIMEOUT_MS,
  buildBlenderBakeSmokeReportFromGlb,
  createBlenderBakePythonScript,
} from "./blender-asset-bake-smoke.js";

describe("Blender asset bake smoke", () => {
  it("validates a baked GLB header and records Quest-budget fixture metadata", () => {
    const placeholderObjectNames = [
      "patient_placeholder_head",
      "patient_placeholder_torso",
      "patient_placeholder_left_arm",
      "patient_placeholder_right_arm",
      "patient_placeholder_left_leg",
      "patient_placeholder_right_leg",
      "clinical_scale_marker",
    ];
    const buffer = glbBufferWithJson({
      scene: 0,
      scenes: [{ name: "clinical_placeholder_scene", nodes: placeholderObjectNames.map((_, index) => index) }],
      nodes: placeholderObjectNames.map((name, index) => ({ name, mesh: index })),
      meshes: placeholderObjectNames.map((name) => ({ name: `${name}_mesh` })),
      materials: [{ name: "clinical_placeholder_skin" }],
    });

    const report = buildBlenderBakeSmokeReportFromGlb({
      generatedAt: "2026-05-04T00:00:00.000Z",
      blenderVersion: "Blender 5.1.1",
      elapsedMs: 42,
      glb: buffer,
    });

    expect(report.input.fixture).toBe("low_poly_clinical_humanoid");
    expect(report.output).toMatchObject({
      glbBytes: buffer.length,
      magic: "glTF",
      version: 2,
      declaredLength: buffer.length,
      semanticInventory: {
        sceneCount: 1,
        nodeCount: 7,
        meshCount: 7,
        materialCount: 1,
        requiredObjectNames: [],
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

  it("creates a Python bake script that exports a humanoid GLB without external assets", () => {
    const script = createBlenderBakePythonScript("/tmp/openclinxr-humanoid.glb");

    expect(script).toContain("primitive_uv_sphere_add");
    expect(script).toContain("primitive_cube_add");
    expect(script).toContain("clinical_placeholder_skin");
    expect(script).toContain("bpy.ops.export_scene.gltf");
    expect(script).toContain("/tmp/openclinxr-humanoid.glb");
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
