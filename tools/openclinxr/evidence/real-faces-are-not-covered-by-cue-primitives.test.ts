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
  import("./the-loaded-mesh-matches-the-cast.js") as Promise<Record<string, unknown>>;

const MAIN_SOURCE_URL = new URL("../../../apps/ui-xr/src/main.ts", import.meta.url);

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
    const mainSource = readFileSync(MAIN_SOURCE_URL, "utf8");

    // Refuse deleting the cues outright — the cue-adding code must still exist.
    for (const cueName of [
      "actor-specific-hair-cap-variant-cue",
      "actor-specific-face-tone-and-cheek-volume-cue",
      "left-eye-gaze-anchor-cue",
      "right-eye-gaze-anchor-cue",
      "emotion-mouth-line-viseme-anchor-cue",
      "emotion-brow-tension-cue",
    ]) {
      expect(mainSource, `the face-cue primitive ${cueName} must not be deleted`).toContain(cueName);
    }

    // Construct the gate predicate from source: primitive_fallback still shows, capture mode
    // must not be a reason. A future edit that reintroduces the capture-mode term (or drops
    // the fallback term) fails here.
    const gate = mainSource.match(
      /function shouldShowProceduralHumanoidDetailCues\(faceCueMode: HumanoidCueMode\): boolean \{\s*\n([\s\S]*?)\n\}/,
    )?.[1];
    expect(gate, "could not locate shouldShowProceduralHumanoidDetailCues in main.ts").toBeTruthy();
    expect(gate).toContain('faceCueMode === "primitive_fallback"');
    expect(gate).not.toContain("isHumanoidFaceDetailCaptureMode");
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
