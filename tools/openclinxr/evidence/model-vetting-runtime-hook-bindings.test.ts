import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildModelVettingRuntimeHookBindingsEvidence,
  validateModelVettingRuntimeHookBindingsEvidence,
} from "./model-vetting-runtime-hook-bindings.js";
import type { ModelVettingRuntimeMappingEvidence } from "./model-vetting-runtime-mapping-evidence.js";

const sourceRuntimeMappingEvidencePath = "docs/openclinxr/model-vetting-runtime-mapping-evidence-peds-asthma-parent-anxiety-2026-06-05.json";

describe("model-vetting runtime hook bindings evidence", () => {
  it("exposes package scripts for guarded hook binding generation and validation", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["asset:model-vetting:runtime-hook-bindings"]).toBe("tsx tools/openclinxr/evidence/model-vetting-runtime-hook-bindings.ts");
    expect(rootPackage.scripts["asset:model-vetting:runtime-hook-bindings:validate"]).toBe("tsx tools/openclinxr/evidence/model-vetting-runtime-hook-bindings.ts --validate-latest");
  });

  it("attaches three actor hook inputs to guarded actor-player metadata without promotion", async () => {
    const evidence = buildModelVettingRuntimeHookBindingsEvidence({
      generatedAt: "2026-06-05T20:20:00.000Z",
      sourceRuntimeMappingEvidencePath,
      runtimeMappingEvidence: JSON.parse(await readFile(sourceRuntimeMappingEvidencePath, "utf8")) as ModelVettingRuntimeMappingEvidence,
    });

    expect(evidence).toMatchObject({
      schemaVersion: "openclinxr.model-vetting-runtime-hook-bindings.v1",
      claimScope: "guarded_actor_player_hook_binding_metadata_only",
      decision: {
        actorPlayerHookInputsAttached: true,
        actorPlayerHookEvidenceComplete: true,
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
      expect(actor.hookBindings).toHaveLength(4);
      expect(actor.hookBindings.every((binding) => binding.actorPlayerInputStatus === "attached_to_guarded_actor_player_stub")).toBe(true);
      expect(actor.hookBindings.every((binding) => binding.runtimeVerificationStatus === "not_scene_executed")).toBe(true);
      expect(actor.hookBindings.every((binding) => binding.sourceEvidenceArtifactPaths.length > 0)).toBe(true);
      expect(actor.hookBindings[0]?.deterministicRuntimeInputs.turnText).toBe(actor.turnText);
      expect(actor.hookBindings[0]?.blockers).toContain("guarded_actor_player_not_executed_in_scene");
      expect(actor.hookBindings[0]?.blockers).toContain("runtime_selector_disabled_guard_not_wired");
    }
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
    expect(validateModelVettingRuntimeHookBindingsEvidence(evidence)).toEqual({ ok: true });
  });

  it("rejects runtime or learner promotion", async () => {
    const evidence = buildModelVettingRuntimeHookBindingsEvidence({
      sourceRuntimeMappingEvidencePath,
      runtimeMappingEvidence: JSON.parse(await readFile(sourceRuntimeMappingEvidencePath, "utf8")) as ModelVettingRuntimeMappingEvidence,
    });
    evidence.decision.runtimePromotionAllowed = true as never;
    evidence.decision.learnerLaunchAllowed = true as never;
    evidence.decision.providerExecutionPerformed = true as never;
    evidence.actors[0]!.hookBindings[0]!.runtimeVerificationStatus = "executed" as never;
    evidence.notEvidenceFor = evidence.notEvidenceFor.filter((claim) => claim !== "clinical_validity") as never;

    expect(validateModelVettingRuntimeHookBindingsEvidence(evidence)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/decision/runtimePromotionAllowed must be false",
        "/decision/learnerLaunchAllowed must be false",
        "/decision/providerExecutionPerformed must be false",
        "/actors/0/hookBindings/0/runtimeVerificationStatus must be not_scene_executed",
        "/notEvidenceFor must include clinical_validity",
      ]),
    });
  });
});
