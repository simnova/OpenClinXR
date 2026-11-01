import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#368). Face-detail capture mode must not force the hand-authored
 * face-cue primitives on, because those spheres/boxes sit in front of the real face at
 * exactly the distance a face-detail camera frames, so every face capture photographs the
 * instrument instead of the MPFB face.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, LOCATED — capture mode is a reason to show the face overlay
 *
 * `apps/ui-xr/src/main.ts` `shouldShowProceduralHumanoidDetailCues(faceCueMode)` returned
 *   faceCueMode === "primitive_fallback" || isHumanoidFaceDetailCaptureMode() || shouldShowRuntimeAffordanceMarkers()
 * so `openclinxrCaptureMode=face-detail` alone flipped the gate, and
 * `addActorSpecificIdentityVariantCue` then added hairCap / faceTonePatch / left+right eye
 * spheres / mouth box / brow as children of the loaded humanoid at hardcoded heights. They
 * render in front of the real face.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) asserts the LIVE scene under face-detail mode: every actor with real face morph targets
 *     carries ZERO face-cue primitives. (2) refuses the cheap fix — deleting the cues — by
 *     checking the cue-adding code still exists AND that `primitive_fallback` still gates them
 *     on. (3) fails loudly when the probe enumerates nothing.
 *
 * COUNTERWEIGHT CONSTRUCTION (stated, not dropped): no shipped actor is in primitive_fallback
 * mode (the issue's "known-good I could not find"), so (2) is a SOURCE-LEVEL construction over
 * `shouldShowProceduralHumanoidDetailCues` rather than a live fallback actor. It asserts the
 * gate still returns true for `primitive_fallback` and that capture mode is no longer a term in
 * the predicate. The live (1)/(3) use `inspectFaceCueTruth()`.
 *
 * SIGNATURE IS YOURS. These read `inspectFaceCueTruth()`. What must not change:
 *  - cast slots are enumerated from `resolveScenarioActorCast`, never hardcoded per-actor.
 *  - faceCueMode / faceMorphTargetCount / cuePrimitiveNames come from the LIVE scene graph
 *    (userData.openClinXrActorSpecificIdentityVariantCue.faceCueMode and the real skinned-mesh
 *    morphTargetDictionary), never restated from the SSOT.
 */

type FaceCueTruthRow = {
  scenarioId: string;
  actorId: string;
  role: string;
  faceCueMode: string | null;
  faceMorphTargetCount: number;
  cuePrimitiveCount: number;
  cuePrimitiveNames: string[];
  staged: boolean;
};

type InspectFaceCueTruth = () => Promise<{ scenarioIds: string[]; captureMode: string; rows: FaceCueTruthRow[] }>;

const load = () =>
  import("../the-loaded-mesh-matches-the-cast.js") as Promise<Record<string, unknown>>;

import { analyzeProducerContract, evaluateActualGate, gateBehavior } from "../face-cue-source-contract/producer-contract.js";

const ROLE_VISUALS_SOURCE_URL = new URL("../../../../packages/openclinxr/xr-asset-loading/src/role-visuals.ts", import.meta.url);

describe("real faces are not covered by face-cue primitives under face-detail (#368)", () => {
  it("(1) RED: every actor with real face morph targets renders zero face-cue primitives", async () => {
    const mod = await load();
    const inspect = mod["inspectFaceCueTruth"] as InspectFaceCueTruth | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const withMorphs = report.rows.filter((r) => r.staged && r.faceMorphTargetCount > 0);
    expect(
      withMorphs.length,
      "no staged actor with face morph targets was measured — a silent empty load must fail loudly",
    ).toBeGreaterThanOrEqual(1);

    const covered = withMorphs.filter((r) => r.cuePrimitiveCount > 0);
    expect(
      covered.map((r) =>
        `${r.scenarioId}/${r.actorId}: ${r.cuePrimitiveCount} face-cue primitive(s) — ${r.cuePrimitiveNames.join(", ")}`,
      ),
      "actors whose real face is still covered by hand-authored face-cue primitives:\n",
    ).toEqual([]);
  }, 900_000);

  it("(2) COUNTERWEIGHT: primitive_fallback still gates the face cues on — capture mode no longer does", () => {
    const roleVisualsSource = readFileSync(ROLE_VISUALS_SOURCE_URL, "utf8");
    const contract = analyzeProducerContract(roleVisualsSource);
    for (const cueName of ["actor-specific-hair-cap-variant-cue", "actor-specific-face-tone-and-cheek-volume-cue", "left-eye-gaze-anchor-cue", "right-eye-gaze-anchor-cue", "emotion-mouth-line-viseme-anchor-cue", "emotion-brow-tension-cue"]) {
      expect(contract.producerStrings, `the face-cue primitive ${cueName} must live inside the real producer body`).toContain(cueName);
    }
    expect(contract.realProducerCalls, "real producer CallExpression addActorSpecificIdentityVariantCue(...) missing outside its declaration").toBeGreaterThanOrEqual(1);
    expect(contract.gateCallsInProducer, "actual gate CallExpression missing inside the producer body").toBeGreaterThanOrEqual(1);
    expect(contract.gateText).toContain('faceCueMode === "primitive_fallback"');
    expect(contract.gateText).toContain("shouldShowAffordanceMarkers");
    expect(contract.gateText).not.toContain("isHumanoidFaceDetailCaptureMode");
    expect(contract.gateText).not.toContain("captureMode");
    const gate = evaluateActualGate(contract.gateText);
    const behavior = gateBehavior(gate);
    expect(behavior.fallback, "fallback arm must be true").toBe(true);
    expect(behavior.realFace, "real-face mode must be false").toBe(false);
    expect(behavior.marker, "affordance marker must still gate on").toBe(true);
  });
  it("(3) VACUITY GUARD: at least three slots enumerated, one with a non-zero morph-target count", async () => {
    const mod = await load();
    const inspect = mod["inspectFaceCueTruth"] as InspectFaceCueTruth | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(
      report.rows.length,
      "no cast slots were measured — enumerate from the cast SSOT",
    ).toBeGreaterThanOrEqual(3);

    expect(
      report.rows.filter((r) => r.faceMorphTargetCount > 0).length,
      "no actor with face morph targets was found — a probe that enumerates nothing must fail loudly",
    ).toBeGreaterThanOrEqual(1);
  }, 900_000);
});
