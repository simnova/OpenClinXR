import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDynamicEncounterFactoryPlanningProjection } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import {
  buildCaseDefinedActorRealismLaunchBadges,
  buildHumanoidRealismGateReport,
  type HumanoidRealismGateReport,
  validateHumanoidRealismGateReport,
} from "./humanoid-realism-gate.js";

describe("humanoid realism gate", () => {
  it("exposes package scripts for generated humanoid animation and morph-target gating", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["asset:humanoid-realism:gate"]).toBe("tsx tools/openclinxr/humanoid-realism-gate.ts");
    expect(rootPackage.scripts["asset:humanoid-realism:validate"]).toBe("tsx tools/openclinxr/humanoid-realism-gate.ts --validate-latest");
  });

  it("classifies the current neutral generated humanoid without production-quality visual claims", async () => {
    const report = await buildHumanoidRealismGateReport({
      inputPath: "apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb",
      generatedAt: "2026-05-23T00:00:00.000Z",
    });

    expect(report.metrics.skinCount).toBeGreaterThan(0);
    expect(report.metrics.animationCount).toBeGreaterThan(0);
    expect(report.metrics.morphTargetPrimitiveCount).toBeGreaterThan(0);
    expect(report.metrics.annyBaseMeshNodeCount).toBeGreaterThan(0);
    expect(report.metrics.primitiveVisualProxyNodeCount).toBe(0);
    expect(report.metrics.clinicalIdlePoseClipCount).toBeGreaterThan(0);
    expect(report.verdict).toMatchObject({
      status: "generated_human_base_mesh_ready",
      blockers: [],
    });
    expect(report.productionReadinessClaimed).toBe(false);
    expect(validateHumanoidRealismGateReport(report)).toEqual({ ok: true });
  });

  it("rejects procedural fallback reports without blockers", () => {
    const invalid = {
      schemaVersion: "openclinxr.humanoid-realism-gate.v1",
      generatedAt: "2026-05-23T00:00:00.000Z",
      inputPath: "neutral.glb",
      metrics: {
        sceneCount: 1,
        meshCount: 1,
        skinCount: 1,
        animationCount: 0,
        morphTargetPrimitiveCount: 0,
        vertexCount: 42,
        primitiveVisualProxyNodeCount: 0,
        annyBaseMeshNodeCount: 0,
        clinicalIdlePoseClipCount: 0,
      },
      verdict: {
        status: "procedural_fallback_only",
        blockers: [],
        nextPipelineActions: [],
      },
      productionReadinessClaimed: false,
    };

    expect(validateHumanoidRealismGateReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining(["/verdict/blockers required for procedural_fallback_only"]),
    });
  });

  it("requires posture-debt reports to include the missing clinical idle clip blocker", () => {
    const invalid = {
      schemaVersion: "openclinxr.humanoid-realism-gate.v1",
      generatedAt: "2026-05-23T00:00:00.000Z",
      inputPath: "neutral.glb",
      metrics: {
        sceneCount: 1,
        meshCount: 1,
        skinCount: 1,
        animationCount: 2,
        morphTargetPrimitiveCount: 1,
        vertexCount: 42,
        primitiveVisualProxyNodeCount: 0,
        annyBaseMeshNodeCount: 1,
        clinicalIdlePoseClipCount: 0,
      },
      verdict: {
        status: "generated_human_base_mesh_with_posture_debt",
        blockers: [],
        nextPipelineActions: [],
      },
      productionReadinessClaimed: false,
    };

    expect(validateHumanoidRealismGateReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining(["/verdict/blockers must include clinical_idle_pose_clip_missing for posture debt"]),
    });
  });

  it("maps case-defined actor requirements to readiness badges backed by humanoid gate evidence", async () => {
    const report = await buildHumanoidRealismGateReport({
      inputPath: "apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb",
      generatedAt: "2026-05-23T00:00:00.000Z",
    });

    const badges = buildCaseDefinedActorRealismLaunchBadges([
      {
        actorId: "peds_asthma_patient_jordan_williams_v1",
        role: "patient",
        baselineMood: ["breathless", "scared"],
        locomotionRequired: true,
        expressionRequired: true,
        gazeRequired: true,
        lipSyncRequired: true,
        interactionRequired: true,
        requiredCueIds: [
          "case_definition_driven_expression_selection",
          "dialogue_viseme_and_gaze_mapping",
          "actor_target_gaze_from_trace_intent",
        ],
      },
    ], report);

    expect(badges).toEqual([expect.objectContaining({
      actorId: "peds_asthma_patient_jordan_williams_v1",
      actorRole: "patient",
      status: "realismReady",
      readyDimensions: ["locomotion", "expression", "gaze", "lip_sync", "interaction"],
      blockedDimensions: [],
      blockers: [],
      claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only",
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"] as [
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    })]);
  });

  it("blocks actor readiness badges when humanoid gate evidence or case cues are missing", () => {
    const blockedReport: HumanoidRealismGateReport = {
      schemaVersion: "openclinxr.humanoid-realism-gate.v1" as const,
      generatedAt: "2026-05-23T00:00:00.000Z",
      inputPath: "neutral.glb",
      tool: {
        package: "@gltf-transform/core" as const,
        purpose: "humanoid_animation_morph_target_realism_gate" as const,
      },
      metrics: {
        sceneCount: 1,
        meshCount: 1,
        skinCount: 0,
        animationCount: 0,
        morphTargetPrimitiveCount: 0,
        vertexCount: 42,
        primitiveVisualProxyNodeCount: 0,
        annyBaseMeshNodeCount: 0,
        clinicalIdlePoseClipCount: 0,
      },
      verdict: {
        status: "procedural_fallback_only" as const,
        blockers: ["humanoid_animation_clips_missing", "humanoid_morph_targets_missing"],
        nextPipelineActions: [],
      },
      productionReadinessClaimed: false as const,
      notEvidenceFor: [
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    };

    const [badge] = buildCaseDefinedActorRealismLaunchBadges([
      {
        actorId: "family_tanya_williams_v1",
        role: "family",
        baselineMood: [],
        locomotionRequired: false,
        expressionRequired: true,
        gazeRequired: true,
        lipSyncRequired: true,
        interactionRequired: true,
        requiredCueIds: [],
      },
    ], blockedReport);

    expect(badge).toMatchObject({
      status: "realismBlocked",
      readyDimensions: [],
      blockedDimensions: ["expression", "gaze", "lip_sync", "interaction"],
      blockers: [
        "humanoid_animation_clips_missing",
        "humanoid_morph_targets_missing",
        "actor_required_cue_ids_missing",
        "actor_baseline_mood_missing",
        "humanoid_realism_gate_not_ready",
      ],
    });
  });

  it("builds launch badges from scenario-bank-derived actor runtime realism requirements", async () => {
    const planningProjection = buildDynamicEncounterFactoryPlanningProjection();
    const pediatricPlanningScenario = planningProjection.scenarios.find((scenario) =>
      scenario.scenarioId === "peds_asthma_parent_anxiety_v1"
    );
    const gateReport = await buildHumanoidRealismGateReport({
      inputPath: "apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb",
      generatedAt: "2026-05-23T00:00:00.000Z",
    });

    if (!pediatricPlanningScenario) {
      throw new Error("Expected pediatric planning scenario fixture");
    }

    const badges = buildCaseDefinedActorRealismLaunchBadges(
      pediatricPlanningScenario.humanoidPerformanceContract.actorRuntimeRealismRequirements,
      gateReport,
    );

    expect(badges.map((badge) => badge.actorRole).sort()).toEqual(["family", "nurse", "patient"]);
    expect(badges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorId: "patient_maya_johnson_v1",
        actorRole: "patient",
        baselineMood: ["frightened", "breathless", "seeking reassurance"],
        status: "realismReady",
        readyDimensions: ["locomotion", "expression", "gaze", "lip_sync", "interaction"],
        requiredCueIds: expect.arrayContaining([
          "case_definition_driven_expression_selection",
          "dialogue_viseme_and_gaze_mapping",
          "actor_target_gaze_from_trace_intent",
          "scenario_timeline_locomotion_or_posture_change",
        ]),
      }),
    ]));
  });
});
