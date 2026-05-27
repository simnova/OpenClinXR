import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_HUMANOID_BONES,
  CANONICAL_HUMANOID_EMBODIMENT_NODES,
  buildCanonicalSkeletonBindingReport,
  buildGeneratedHumanRiggingReportFromGlb,
  buildGeneratedHumanRiggingRuntimeAssetReference,
  buildGeneratedHumanoidRealismManifest,
  buildSkinWeightQualityReport,
  GENERATED_HUMAN_RIGGING_BODY_PROFILES,
  runGeneratedHumanRiggingArtifactsCli,
  validateGeneratedHumanRiggingArtifactsReport,
} from "./generated-human-rigging-artifacts.js";

describe("generated human rigging artifacts", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:human-rigging:generate"]).toBe(
      "tsx tools/openclinxr/generated-human-rigging-artifacts.ts",
    );
    expect(rootPackage.scripts["asset:human-rigging:validate"]).toBe(
      "tsx tools/openclinxr/generated-human-rigging-artifacts.ts --validate-latest",
    );
    expect(rootPackage.scripts["asset:human-rigging:variant-matrix"]).toBe(
      "tsx tools/openclinxr/generated-human-rigging-variant-matrix.ts",
    );
    expect(rootPackage.scripts["asset:human-rigging:variant-matrix:validate"]).toBe(
      "tsx tools/openclinxr/generated-human-rigging-variant-matrix.ts --validate-latest",
    );
  });

  it("records a skinned canonical humanoid skeleton without production claims", () => {
    const nodeNames = [
      "neutral_generated_human_skinned_mesh",
      "openclinxr_canonical_humanoid_armature",
      "patient_robert_hayes_canonical_skeleton_anchor",
      "nurse_maria_alvarez_canonical_skeleton_anchor",
      ...CANONICAL_HUMANOID_EMBODIMENT_NODES,
      ...CANONICAL_HUMANOID_BONES,
    ];
    const report = buildGeneratedHumanRiggingReportFromGlb({
      generatedAt: "2026-05-21T00:00:00.000Z",
      blenderVersion: "Blender 5.1.1",
      elapsedMs: 42,
      glb: glbBufferWithJson({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ name: "generated_human_rigging_fixture", nodes: nodeNames.map((_, index) => index) }],
        nodes: nodeNames.map((name, index) => ({
          name,
          mesh: name === "neutral_generated_human_skinned_mesh" ? 0 : undefined,
          skin: name === "neutral_generated_human_skinned_mesh" ? 0 : undefined,
          children: index === 1
            ? CANONICAL_HUMANOID_BONES.map((_, boneIndex) => boneIndex + 4 + CANONICAL_HUMANOID_EMBODIMENT_NODES.length)
            : undefined,
        })),
        meshes: [{
          name: "neutral_generated_human_skinned_mesh_data",
          extras: { targetNames: ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"] },
        }],
        skins: [{ name: "openclinxr_canonical_humanoid_skin", joints: CANONICAL_HUMANOID_BONES.map((_, index) => index + 4 + CANONICAL_HUMANOID_EMBODIMENT_NODES.length) }],
        materials: [{ name: "reviewed_local_fixture_skin" }],
      }),
    });

    expect(report.policy).toMatchObject({
      localOnly: true,
      cloudApisUsed: false,
      paidApisUsed: false,
      externalAssetsUsed: false,
      productionAssetReadinessClaimed: false,
    });
    expect(report.output.semanticInventory.skinJointNames).toEqual([...CANONICAL_HUMANOID_BONES].sort());
    expect(report.output.semanticInventory.missingRequiredBoneNames).toEqual([]);
    expect(report.output.semanticInventory.missingRequiredEmbodimentNodeNames).toEqual([]);
    expect(report.output.semanticInventory.missingRequiredMorphTargetNames).toEqual([]);
    expect(report.output.semanticInventory.morphTargetNames).toEqual([
      "openclinxr_brow_concern",
      "openclinxr_cheek_tension",
      "openclinxr_mouth_open",
    ]);
    expect(report.output.embodimentRigging).toMatchObject({
      sourceGeneratorRequired: "anny",
      faceRigPresent: true,
      lipSyncControlsPresent: true,
      eyeGazeControlsPresent: true,
      eyelidBlinkControlsPresent: true,
      ragdollCollisionProxyPresent: true,
      physicianInteractionTargetPresent: true,
      runtimeDialogueLipSyncRequired: true,
      runtimeDialogueGazeRequired: true,
      runtimeMorphTargetVisemeRequired: true,
    });
    expect(report.verdict).toEqual({
      passed: true,
      readyForProductionAssets: false,
      blockers: [],
    });
    expect(report.artifacts.humanoidRealismManifestPath).toBe(
      ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human-realism-manifest.json",
    );

    const binding = buildCanonicalSkeletonBindingReport(report);
    const quality = buildSkinWeightQualityReport(report);

    expect(binding.bindings).toHaveLength(CANONICAL_HUMANOID_BONES.length);
    expect(binding.verdict.passed).toBe(true);
    expect(quality.metrics.observedRequiredBoneCount).toBe(CANONICAL_HUMANOID_BONES.length);
    expect(quality.verdict.passed).toBe(true);

    const runtimeAsset = buildGeneratedHumanRiggingRuntimeAssetReference(report);
    expect(runtimeAsset).toMatchObject({
      assetId: "neutral_generated_humanoid_model_glb",
      kind: "humanoid_model",
      reviewStatus: "approved_for_local_runtime",
      scenarioAssetId: "patient_robert_hayes_character",
      blob: {
        storeKind: "azurite_blob",
        containerName: "openclinxr-assets",
        contentType: "model/gltf-binary",
      },
    });
    expect(runtimeAsset.blob.url).toBe(
      "http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets/.openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
    );
    expect(runtimeAsset.provenanceRefs).toContain("generated_human_morph_target_viseme_contract");
  });

  it("builds a realism-focused manifest for humanoid evidence capture", () => {
    const nodeNames = [
      "neutral_generated_human_skinned_mesh",
      "openclinxr_canonical_humanoid_armature",
      "patient_robert_hayes_canonical_skeleton_anchor",
      "nurse_maria_alvarez_canonical_skeleton_anchor",
      ...CANONICAL_HUMANOID_EMBODIMENT_NODES,
      ...CANONICAL_HUMANOID_BONES,
      "local_fixture_scrub_tunic",
      "local_fixture_left_shoe",
    ];
    const skinJointStartIndex = 4 + CANONICAL_HUMANOID_EMBODIMENT_NODES.length;

    const report = buildGeneratedHumanRiggingReportFromGlb({
      generatedAt: "2026-05-21T00:00:00.000Z",
      blenderVersion: "Blender 5.1.1",
      elapsedMs: 42,
      glb: glbBufferWithJson({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{
          name: "generated_human_rigging_manifest_fixture",
          nodes: nodeNames.map((_, index) => index),
        }],
        nodes: [
          ...nodeNames.map((nodeName, index) => ({
            name: nodeName,
            mesh: index === 0 ? 0 : undefined,
            skin: index === 0 ? 0 : undefined,
          })),
        ],
        meshes: [{
          name: "neutral_generated_human_skinned_mesh_data",
          extras: { targetNames: ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"] },
        }],
        skins: [{
          name: "openclinxr_canonical_humanoid_skin",
          joints: CANONICAL_HUMANOID_BONES.map((_, index) => index + skinJointStartIndex),
        }],
        materials: [{ name: "reviewed_local_fixture_skin" }],
      }),
    });

    const realismManifest = buildGeneratedHumanoidRealismManifest(report);

    expect(realismManifest.evidence.rigging.canonicalBoneCoverageComplete).toBe(true);
    expect(realismManifest.evidence.poseLocomotionPosture).toMatchObject({
      hasAnimationCurves: false,
      primaryPostureIntent: "neutral-clinical-stand",
      locomotionProxyPosture: "asset_pose_static",
    });
    expect(realismManifest.evidence.eyesAndGaze.eyeGazeControlsPresent).toBe(true);
    expect(realismManifest.evidence.lipsAndVisemes.lipSyncControlsPresent).toBe(true);
    expect(realismManifest.evidence.sharedAssetLibraryReuse.enabled).toBe(true);
    expect(realismManifest.caveats[0]).toContain("artifact-level realism support signals");
  });

  it("keeps the canonical rigging contract stable across generated human body profiles", () => {
    for (const bodyProfile of GENERATED_HUMAN_RIGGING_BODY_PROFILES) {
      const nodeNames = [
        "neutral_generated_human_skinned_mesh",
        "openclinxr_canonical_humanoid_armature",
        "patient_robert_hayes_canonical_skeleton_anchor",
        "nurse_maria_alvarez_canonical_skeleton_anchor",
        ...CANONICAL_HUMANOID_EMBODIMENT_NODES,
        ...CANONICAL_HUMANOID_BONES,
      ];
      const report = buildGeneratedHumanRiggingReportFromGlb({
        generatedAt: "2026-05-25T00:00:00.000Z",
        blenderVersion: "Blender 5.1.1",
        elapsedMs: 42,
        bodyProfile,
        glb: glbBufferWithJson({
          asset: { version: "2.0" },
          scene: 0,
          scenes: [{ name: `generated_human_rigging_${bodyProfile}`, nodes: nodeNames.map((_, index) => index) }],
          nodes: nodeNames.map((name, index) => ({
            name,
            mesh: name === "neutral_generated_human_skinned_mesh" ? 0 : undefined,
            skin: name === "neutral_generated_human_skinned_mesh" ? 0 : undefined,
            children: index === 1
              ? CANONICAL_HUMANOID_BONES.map((_, boneIndex) => boneIndex + 4 + CANONICAL_HUMANOID_EMBODIMENT_NODES.length)
              : undefined,
          })),
          meshes: [{
            name: "neutral_generated_human_skinned_mesh_data",
            extras: { targetNames: ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"] },
          }],
          skins: [{ name: "openclinxr_canonical_humanoid_skin", joints: CANONICAL_HUMANOID_BONES.map((_, index) => index + 4 + CANONICAL_HUMANOID_EMBODIMENT_NODES.length) }],
          materials: [{ name: "reviewed_local_fixture_skin" }],
        }),
      });

      expect(report.input.bodyProfile).toBe(bodyProfile);
      expect(report.verdict.blockers).toEqual([]);
      expect(report.output.semanticInventory.missingRequiredBoneNames).toEqual([]);
      expect(report.output.semanticInventory.missingRequiredEmbodimentNodeNames).toEqual([]);
      expect(report.output.semanticInventory.missingRequiredMorphTargetNames).toEqual([]);
      expect(report.output.embodimentRigging).toMatchObject({
        faceRigPresent: true,
        lipSyncControlsPresent: true,
        eyeGazeControlsPresent: true,
        eyelidBlinkControlsPresent: true,
        ragdollCollisionProxyPresent: true,
        physicianInteractionTargetPresent: true,
      });
    }
  });

  it("blocks GLBs that do not expose the canonical skin and anchors", () => {
    const report = buildGeneratedHumanRiggingReportFromGlb({
      generatedAt: "2026-05-21T00:00:00.000Z",
      blenderVersion: "Blender 5.1.1",
      elapsedMs: 42,
      glb: glbBufferWithJson({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ name: "unrigged_fixture", nodes: [0] }],
        nodes: [{ name: "neutral_generated_human_skinned_mesh", mesh: 0 }],
        meshes: [{ name: "neutral_generated_human_skinned_mesh_data" }],
        materials: [{ name: "reviewed_local_fixture_skin" }],
      }),
    });

    expect(report.verdict.passed).toBe(false);
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "glb_skin_missing",
      "canonical_bone_missing:pelvis",
      "anchor_node_missing:openclinxr_canonical_humanoid_armature",
      "anchor_node_missing:patient_robert_hayes_canonical_skeleton_anchor",
      "embodiment_node_missing:openclinxr_face_rig_root",
    ]));
    expect(validateGeneratedHumanRiggingArtifactsReport(report)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/output/embodimentRigging/faceRigPresent must be true",
        "/output/embodimentRigging/lipSyncControlsPresent must be true",
        "/output/embodimentRigging/eyeGazeControlsPresent must be true",
        "/output/embodimentRigging/ragdollCollisionProxyPresent must be true",
        "/output/embodimentRigging/physicianInteractionTargetPresent must be true",
      ]),
    });
  });

  it("validates report schema and blocker consistency", () => {
    const report = buildGeneratedHumanRiggingReportFromGlb({
      generatedAt: "2026-05-21T00:00:00.000Z",
      blenderVersion: "Blender 5.1.1",
      elapsedMs: 42,
      glb: glbBufferWithJson({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ name: "empty", nodes: [] }],
        nodes: [],
      }),
    });
    expect(validateGeneratedHumanRiggingArtifactsReport(report)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/output/embodimentRigging/faceRigPresent must be true",
        "/output/embodimentRigging/lipSyncControlsPresent must be true",
        "/output/embodimentRigging/eyeGazeControlsPresent must be true",
        "/output/embodimentRigging/ragdollCollisionProxyPresent must be true",
        "/output/embodimentRigging/physicianInteractionTargetPresent must be true",
      ]),
    });

    const invalid = structuredClone(report) as unknown as {
      policy: { productionAssetReadinessClaimed: boolean };
      verdict: { blockers: string[] };
    };
    invalid.policy.productionAssetReadinessClaimed = true;
    invalid.verdict.blockers = [];

    expect(validateGeneratedHumanRiggingArtifactsReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/policy/productionAssetReadinessClaimed must be false",
        "/verdict/blockers must include glb_mesh_missing",
        "/verdict/blockers must include glb_skin_missing",
      ]),
    });
  });

  it("validates generated human rigging reports from the CLI without launching Blender", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-generated-human-rigging-validate-"));
    const reportPath = path.join(tempDir, "generated-human-rigging-artifacts.json");
    const invalidPath = path.join(tempDir, "generated-human-rigging-artifacts-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      const report = buildGeneratedHumanRiggingReportFromGlb({
        generatedAt: "2026-05-21T00:00:00.000Z",
        blenderVersion: "Blender 5.1.1",
        elapsedMs: 42,
        glb: glbBufferWithJson({
          asset: { version: "2.0" },
          scene: 0,
          scenes: [{ name: "empty", nodes: [] }],
          nodes: [],
        }),
      });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

      await expect(runGeneratedHumanRiggingArtifactsCli(["--validate", reportPath])).resolves.toBeUndefined();

      const invalidReport = structuredClone(report) as Record<string, unknown>;
      delete invalidReport.schemaVersion;
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runGeneratedHumanRiggingArtifactsCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function glbBufferWithJson(json: Record<string, unknown>): Buffer {
  const jsonBuffer = padBuffer(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "utf8");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuffer.length, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);

  return Buffer.concat([header, jsonChunkHeader, jsonBuffer]);
}

function padBuffer(buffer: Buffer, padByte: number): Buffer {
  const paddingLength = (4 - (buffer.length % 4)) % 4;
  if (paddingLength === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(paddingLength, padByte)]);
}
