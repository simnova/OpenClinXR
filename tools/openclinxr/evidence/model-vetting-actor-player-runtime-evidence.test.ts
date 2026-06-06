import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildModelVettingActorPlayerRuntimeEvidence,
  validateModelVettingActorPlayerRuntimeEvidence,
} from "./model-vetting-actor-player-runtime-evidence.js";
import type { ModelVettingRuntimeHookBindingsEvidence } from "./model-vetting-runtime-hook-bindings.js";

const sourceRuntimeHookBindingsEvidencePath = "docs/openclinxr/model-vetting-runtime-hook-bindings-peds-asthma-parent-anxiety-2026-06-05.json";

describe("model-vetting actor-player runtime evidence", () => {
  it("exposes package scripts for guarded actor-player runtime evidence", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["asset:model-vetting:actor-player-runtime"]).toBe("tsx tools/openclinxr/evidence/model-vetting-actor-player-runtime-evidence.ts");
    expect(rootPackage.scripts["asset:model-vetting:actor-player-runtime:validate"]).toBe("tsx tools/openclinxr/evidence/model-vetting-actor-player-runtime-evidence.ts --validate-latest");
  });

  it("executes guarded local actor-player hook samples without scene or learner promotion", async () => {
    const evidence = buildModelVettingActorPlayerRuntimeEvidence({
      generatedAt: "2026-06-05T20:30:00.000Z",
      sourceRuntimeHookBindingsEvidencePath,
      runtimeHookBindingsEvidence: JSON.parse(await readFile(sourceRuntimeHookBindingsEvidencePath, "utf8")) as ModelVettingRuntimeHookBindingsEvidence,
    });

    expect(evidence).toMatchObject({
      schemaVersion: "openclinxr.model-vetting-actor-player-runtime-evidence.v1",
      claimScope: "guarded_local_actor_player_stub_execution_only",
      executionSurface: {
        executionMode: "local_deterministic_non_scene",
        providerExecutionPerformed: false,
        sceneExecutionPerformed: false,
        learnerRuntimeExecuted: false,
      },
      decision: {
        localActorPlayerRuntimeEvidenceExecuted: true,
        actorPlayerRuntimeEvidenceComplete: true,
        multiTurnCaseSequenceProjected: true,
        runtimeActorMappingReady: false,
        scenePlacementEvidenceAllowed: false,
        runtimePromotionAllowed: false,
        productionManifestPromotionAllowed: false,
        learnerLaunchAllowed: false,
        providerExecutionPerformed: false,
      },
    });
    expect(evidence.actors.map((actor) => actor.actorId)).toEqual([
      "patient_maya_johnson_v1",
      "parent_tara_johnson_v1",
      "nurse_kevin_lee_v1",
    ]);
    for (const actor of evidence.actors) {
      expect(actor.executedHookCount).toBe(4);
      expect(actor.caseDerivedTurnSequence.length).toBeGreaterThan(0);
      expect(actor.caseDerivedTurnSequence.every((turn) => turn.localActorPlayerStatus === "projected_in_guarded_actor_player_stub")).toBe(true);
      expect(actor.caseDerivedTurnSequence.every((turn) => turn.sceneExecutionStatus === "not_scene_executed")).toBe(true);
      expect(actor.caseDerivedTurnSequence.every((turn) => turn.samples.length === 3)).toBe(true);
      expect(actor.hookExecutions).toHaveLength(4);
      expect(actor.hookExecutions.every((hook) => hook.runtimeSurfaceStatus === "executed_in_guarded_local_actor_player_stub")).toBe(true);
      expect(actor.hookExecutions.every((hook) => hook.sceneExecutionStatus === "not_scene_executed")).toBe(true);
      expect(actor.hookExecutions.every((hook) => hook.sourceEvidenceArtifactCount > 0)).toBe(true);
      expect(actor.hookExecutions.every((hook) => hook.sourceEvidenceArtifactPaths.length === hook.sourceEvidenceArtifactCount)).toBe(true);
      expect(actor.hookExecutions.every((hook) => hook.samples.length === 3)).toBe(true);
      expect(actor.hookExecutions[0]?.remainingBlockers).toContain("scene_runtime_not_executed");
      expect(actor.hookExecutions[0]?.remainingBlockers).toContain("learner_runtime_not_enabled");
    }
    const nurse = evidence.actors.find((actor) => actor.actorId === "nurse_kevin_lee_v1");
    expect(nurse?.sourceCaptureArtifacts).toMatchObject({
      speechVisemeTimelineVideoPath: "docs/openclinxr/model-vetting-captures/peds_nurse_kevin_viseme_timeline_2026-06-05.webm",
      emotionTransitionVideoPath: "docs/openclinxr/model-vetting-captures/peds_nurse_kevin_emotion_transition_2026-06-05.webm",
      gazeBlinkTurntableVideoPath: "docs/openclinxr/model-vetting-captures/peds_nurse_kevin_turntable_2026-06-05.webm",
    });
    expect(nurse?.sourceCaptureArtifacts.postureAndMaterialArtifactPaths).toEqual(expect.arrayContaining([
      "docs/openclinxr/model-vetting-captures/peds_nurse_kevin_front_2026-06-05.png",
      "docs/openclinxr/model-vetting-captures/peds_nurse_kevin_viseme_timeline_2026-06-05.webm",
    ]));
    expect(nurse?.roleAnimationHandoff).toMatchObject({
      roleSpecificClipNames: ["openclinxr_role_nurse_clinical_check_reassure"],
      claimScope: "deterministic_role_specific_procedural_gesture_not_mocap_or_speech2motion",
      notEvidenceFor: expect.arrayContaining(["production_asset_readiness"]),
    });
    expect(nurse?.hookExecutions[0]?.samples[0]?.roleAnimationClipName).toBe("openclinxr_role_nurse_clinical_check_reassure");
    expect(nurse?.caseDerivedTurnSequence[0]?.roleAnimationClipName).toBe("openclinxr_role_nurse_clinical_check_reassure");
    expect(nurse?.caseDerivedTurnSequence[0]?.sourceCaptureArtifacts).toEqual(nurse?.sourceCaptureArtifacts);
    expect(evidence.notEvidenceFor).toEqual(expect.arrayContaining([
      "real_anny_model_output",
      "b_plus_visual_realism_gate",
      "scene_placement_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ]));
    expect(validateModelVettingActorPlayerRuntimeEvidence(evidence)).toEqual({ ok: true });
  });

  it("rejects scene, learner, provider, or production promotion", async () => {
    const evidence = buildModelVettingActorPlayerRuntimeEvidence({
      sourceRuntimeHookBindingsEvidencePath,
      runtimeHookBindingsEvidence: JSON.parse(await readFile(sourceRuntimeHookBindingsEvidencePath, "utf8")) as ModelVettingRuntimeHookBindingsEvidence,
    });
    evidence.executionSurface.sceneExecutionPerformed = true as never;
    evidence.executionSurface.learnerRuntimeExecuted = true as never;
    evidence.decision.runtimePromotionAllowed = true as never;
    evidence.decision.providerExecutionPerformed = true as never;
    evidence.decision.multiTurnCaseSequenceProjected = false;
    evidence.actors[0]!.hookExecutions[0]!.sceneExecutionStatus = "scene_executed" as never;
    evidence.actors[0]!.caseDerivedTurnSequence[0]!.sceneExecutionStatus = "scene_executed" as never;
    evidence.notEvidenceFor = evidence.notEvidenceFor.filter((claim) => claim !== "scoring_validity") as never;

    expect(validateModelVettingActorPlayerRuntimeEvidence(evidence)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/executionSurface/sceneExecutionPerformed must be false",
        "/executionSurface/learnerRuntimeExecuted must be false",
        "/decision/runtimePromotionAllowed must be false",
        "/decision/providerExecutionPerformed must be false",
        "/actors/0/hookExecutions/0/sceneExecutionStatus must be not_scene_executed",
        "/actors/0/caseDerivedTurnSequence/0/sceneExecutionStatus must be not_scene_executed",
        "/notEvidenceFor must include scoring_validity",
      ]),
    });
  });
});
