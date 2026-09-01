import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runChainWorldCompileBaker } from "../dark-factory/multi-case-runner.js";
import {
  compileEncounterMaterialization,
  type CompilePlanNode,
} from "./encounter-materialization-compile.js";
import {
  invokePlannedWorldCompileBakers,
  type WorldCompileBakerRunnerInput,
} from "./invoke-planned-world-compile-bakers.js";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";

/**
 * OBSERVABLE: world-compile wouldInvoke is blender-only; EquipVariant nodes
 * never invoke equipment_generate.plan even with a valid catalog payload.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (equipment_generate trellis wouldInvoke)
 * EquipVariant with a valid equipment_generate payload (or a known TRELLIS
 * subject id) records wouldInvoke: "trellis". Locked equipment stays skipped.
 * invokePlannedWorldCompileBakers hands trellis nodes to the runner. The chain
 * baker records equipment_generate.plan (no GPU).
 */

const IMAGINE = "ecg-cart-imagine-box";

describe("the world compile plan invokes equipment TRELLIS", () => {
  it("(1) invokePlannedWorldCompileBakers runs trellis nodes and skips locked equipment", async () => {
    const calls: WorldCompileBakerRunnerInput[] = [];
    const report = await invokePlannedWorldCompileBakers(
      [
        wardrobeNode("actor:patient_maya_johnson_v1:wardrobe", "blender"),
        equipmentNode(`equip:${IMAGINE}`, "trellis", { locked: false }),
        equipmentNode("equip:locked_cart", null, { locked: true }),
      ],
      (input) => {
        calls.push(input);
      },
      { runnerName: "fake-runner" },
    );
    expect(calls.map((c) => c.node.nodeId)).toEqual([
      "actor:patient_maya_johnson_v1:wardrobe",
      `equip:${IMAGINE}`,
    ]);
    expect(calls[1]?.node.wouldInvoke).toBe("trellis");
    expect(report.invokedCount).toBe(2);
    expect(report.skippedCount).toBe(1);
    expect(report.skippedNodeIds).toEqual(["equip:locked_cart"]);
  });

  it("(2) compile of imagine-box equipment records wouldInvoke trellis; lock skip stays", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: imagineBoxBundle() });
    const equip = (first.report.compileNodes ?? []).find((n) => n.nodeId === `equip:${IMAGINE}`) as CompilePlanNode | undefined;
    expect(equip?.family).toBe("EquipVariant");
    expect(equip?.wouldInvoke).toBe("trellis");
    expect(first.skippedBakers).not.toContain(`equip:${IMAGINE}`);

    const lockedPrior = {
      ...first.report,
      compileNodes: (first.report.compileNodes ?? []).map((node) =>
        node.nodeId === `equip:${IMAGINE}`
          ? { ...node, lock: { locked: true, lockKind: "faculty_keep_artifact" } }
          : node,
      ),
    };
    const second = await compileEncounterMaterialization({ prior: lockedPrior });
    const locked = (second.report.compileNodes ?? []).find((n) => n.nodeId === `equip:${IMAGINE}`) as CompilePlanNode | undefined;
    expect(locked?.wouldInvoke).toBeNull();
    expect(second.skippedBakers).toContain(`equip:${IMAGINE}`);
  });

  it("(3) chain baker records equipment_generate.plan viewCount 4 without GPU", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wcg-trellis-"));
    try {
      await runChainWorldCompileBaker({
        node: equipmentNode(`equip:${IMAGINE}`, "trellis", { locked: false }) as CompilePlanNode & {
          wouldInvoke: "trellis";
        },
        artifactPath: null,
        bakeOutDir: path.join(dir, "bakes"),
        invocationOutDir: path.join(dir, "invocations"),
      });
      const record = JSON.parse(
        await readFile(path.join(dir, "invocations", `equip_${IMAGINE}.json`), "utf8"),
      ) as { status: string; equipmentGeneratePlan?: { viewCount?: number; mode?: string } };
      expect(record.status).toBe("planned");
      expect(record.equipmentGeneratePlan?.mode).toBe("dry-run");
      expect(record.equipmentGeneratePlan?.viewCount).toBe(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("(4) injected equipmentGenerateRun is invoked instead of stopping at plan()", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wcg-trellis-live-"));
    try {
      let ran: Record<string, unknown> | null = null;
      await runChainWorldCompileBaker({
        node: equipmentNode(`equip:${IMAGINE}`, "trellis", { locked: false }) as CompilePlanNode & {
          wouldInvoke: "trellis";
        },
        artifactPath: null,
        bakeOutDir: path.join(dir, "bakes"),
        invocationOutDir: path.join(dir, "invocations"),
        equipmentGenerateRun: (payload) => {
          ran = payload;
          return { status: "fake-run", subjectId: payload["subjectId"] };
        },
      });
      expect(ran?.["subjectId"]).toBe(IMAGINE);
      const record = JSON.parse(
        await readFile(path.join(dir, "invocations", `equip_${IMAGINE}.json`), "utf8"),
      ) as { status: string; equipmentGenerateRun?: { status?: string } };
      expect(record.status).toBe("invoked");
      expect(record.equipmentGenerateRun?.status).toBe("fake-run");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function wardrobeNode(nodeId: string, wouldInvoke: "blender"): CompilePlanNode {
  return {
    nodeId,
    family: "ActorVariant",
    bakerId: "wardrobe_character",
    spec: {
      scenarioId: "peds_asthma_parent_anxiety_v1",
      actorId: "patient_maya_johnson_v1",
      variantSemanticKey: "peds",
      sourceBlobName: "base.glb",
    },
    parents: [],
    cacheKey: "recipe-1",
    contentHash: "sha256:wardrobe",
    lock: { locked: false },
    status: "planned_split",
    wouldInvoke,
    bakeDecision: { bake: true, stale: false, reason: "first_bake" },
  } as CompilePlanNode;
}

function equipmentNode(
  nodeId: string,
  wouldInvoke: "trellis" | null,
  lock: { locked: boolean },
): CompilePlanNode {
  return {
    nodeId,
    family: "EquipVariant",
    bakerId: "unsplit_equipment",
    spec: {
      scenarioId: "peds_asthma_parent_anxiety_v1",
      equipmentId: IMAGINE,
      variantSemanticKey: `${IMAGINE}:variant`,
      sourceBlobName: "pack",
      equipmentGenerate: {
        subjectId: IMAGINE,
        packId: IMAGINE,
        seed: 0,
        remesh: false,
        viewCount: 4,
        decimationTarget: 1_000_000,
      },
    },
    parents: [],
    cacheKey: null,
    contentHash: null,
    lock,
    status: "planned_unsplit",
    wouldInvoke,
  } as CompilePlanNode;
}

function imagineBoxBundle(): GeneratedEdStationRuntimeBundleReport {
  return {
    schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1",
    generatedAt: "2026-05-28T00:00:00.000Z",
    status: "bundle_ready",
    bundle: null,
    learnerBundle: null,
    actorHumanoidMaterializationContract: {
      schemaVersion: "openclinxr.actor-humanoid-materialization-contract.v1",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      source: "generated_station_runtime_bundle",
      actorSpecificVariantKeysRequired: true,
      sharedNeutralMeshReuseDetected: false,
      sharedNeutralMeshReuseActorIds: [],
      actorVariants: [],
      materializationBlockers: [],
      caveats: [],
      recommendedNextAction: "none",
      notEvidenceFor: [
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
        "animation_quality",
      ],
    },
    equipmentMaterializationContract: {
      schemaVersion: "openclinxr.equipment-materialization-contract.v1",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      source: "generated_station_runtime_bundle",
      equipmentSpecificVariantKeysRequired: true,
      genericEquipmentReuseDetected: false,
      genericEquipmentReuseEquipmentIds: [],
      equipmentVariants: [
        {
          equipmentId: IMAGINE,
          modelAssetId: "openclinxr.trellis.ecg-cart-imagine-box",
          variantSemanticKey: `peds_asthma_parent_anxiety_v1:${IMAGINE}:equipment_materialization_variant`,
          sourceBlobName: "tools/openclinxr/asset-pipeline/trellis/packs/ecg-cart-imagine-box/front.png",
          equipmentVariantProfile: {
            equipmentFamily: "ecg_cart",
            pediatricUseRequired: false,
            scenarioPlacementRequired: true,
            scaleValidationRequired: true,
            interactionAffordanceRequired: false,
          },
          requiredMaterializationCueIds: ["equipment_specific_mesh_required"],
          requiredEvidenceRefs: ["scenario_specific_equipment_variant_evidence"],
        },
      ],
      materializationBlockers: [],
      caveats: [],
      recommendedNextAction: "none",
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    },
    bundleBlobName: null,
    runtimeAssetReviewDecisions: [],
    blockers: [],
    productionCloudCall: false,
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  };
}

// NOT TESTED: live TRELLIS GPU; Quest; clinical validity.
