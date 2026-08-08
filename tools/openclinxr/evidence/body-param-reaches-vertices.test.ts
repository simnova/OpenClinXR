import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#151). Two REDs. Both flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * OPERATOR DIRECTIVE D9 — dark factory. This slice moves the `body_param` station.
 *
 * "The ability to take MULTIPLE CASES and run them through it and get a full experience at the end."
 * Today every case gets the same person.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURED ON MAIN — trust these, do not re-derive
 *
 * Seven shipped humanoids carry THREE body topologies (glTF NodeIO, triangles|vertices):
 *
 *   26692 | 13876  ->  4 assets: adult_male_street_casual, ed_chest_pain_adult_cast,
 *                                ed_chest_pain_nurse_adult, peds_nurse_kevin
 *   26692 | 13872  ->  2 assets: ed_chest_pain_spouse_adult, peds_anxious_parent
 *   27420 | 14268  ->  1 asset:  peds_patient_child
 *
 * ALL SIX ADULTS ARE ONE BODY. The two adult variants differ by FOUR vertices. A male street-casual,
 * a chest-pain patient, a nurse, a spouse and an anxious parent are the same person. Phenotype
 * (age / sex / BMI / stature) never reaches a vertex.
 *
 * #215 landed the MakeClothes fit stage: `pnpm asset:makeclothes:fit` drives Blender against
 * `tools/openclinxr/asset-pipeline/makeclothes/fit_stage.py`, which calls
 * `ClothesService.fit_clothes_to_human` at :308. MPFB is a Blender user extension. That stage shape
 * is the model for this one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE COMFORT TRAP, NAMED BY A PEER ROUND BEFORE THIS WAS WRITTEN
 *
 * "'I just learned MPFB, extend the stage' — that is certainty-max." The orchestrator's measured
 * failure mode is choosing slices that maximise the chance of a green report this cycle. So:
 *
 *   REFUSE-SHAPED: apply a macro slider, dump a GLB under evidence, report a manifest number.
 *   ALLOWED:       TWO body classes, phenotype provably in the VERTICES, the garment RE-FITTED per
 *                  body, resolvable by the runtime — the #215 consume shape.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MEASUREMENT A SLIDER SLICE CANNOT FAKE — this is why contract (1) is shaped as it is
 *
 * NOT a manifest field saying `bmi: 30`. NOT overall body height — a stature macro moves height while
 * a weight macro may not, so height alone both false-positives and false-negatives.
 *
 * USE TORSO GIRTH: the radial extent of body vertices inside a fixed height band, control vs
 * treatment, from the EXPORTED glTF. A body that differs only in metadata cannot move it, and
 * changing it requires actually moving vertices.
 *
 * The band and the epsilon are NOT numbers I invented — calibrate them from two real exports and
 * record the calibration in the pre-fix artifact (see §6f: snapshot the calibration BEFORE tuning any
 * threshold; any later change must cite which rows flipped).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A BODY CHANGE INVALIDATES THE GARMENT FIT — do not skip this
 *
 * MakeClothes fits a garment to a SPECIFIC basemesh state. Change the body and the #215 fitted mesh
 * is fitted to the wrong thing. The library key must therefore be `(garmentId, bodyClass)`, not
 * garment alone, and `ClothesService.fit_clothes_to_human` must be re-run per body class.
 *
 * A "two bodies" result where both share one garment mesh fitted to the neutral basemesh is the
 * failure mode contract (2) exists to catch.
 *
 * ALSO NOT FREE, and out of scope for this slice: a macro body changes bounds, so the 23-bone
 * armature and its weights need rebuilding or re-binding. If you find that blocks the export, say so
 * and stop — that is a real finding, not a failure.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * NOT known to me: whether MPFB macro modifiers are driveable headlessly the way ClothesService was.
 * A peer thinks likely, via macro/target APIs after the basemesh load at `fit_stage.py:280+`, and
 * explicitly NOT via `create_human` — #215 already measured that path gives wrong world placement.
 * VERIFY THAT IN A SHORT EXPERIMENT BEFORE BUILDING. If macros are not headless-stable here, say so
 * and stop: `reject_measured` closes this issue successfully.
 *
 * DO NOT convert any shipped Anny humanoid. DO NOT change ui-xr defaults. DO NOT vendor GPL MPFB.
 */

type BodyClassEntry = {
  bodyClassId: string;
  phenotype: Record<string, number | string>;
  glbPath: string;
  bodyMeshName: string;
  bodyVertexCount: number;
  heightMeters: number;
  /** Radial extent of body vertices inside the calibrated torso band, from the exported glTF. */
  torsoGirthProxyMeters: number;
  garmentMeshName: string | null;
  garmentFittedToBodyClass: string | null;
  producedByStage: string;
};

type Inspect = () => Promise<{
  bodyClasses: BodyClassEntry[];
  calibration: { bandLowFraction: number; bandHighFraction: number; girthEpsilonMeters: number };
}>;

const load = () =>
  import("./body-param-reaches-vertices.js") as Promise<Record<string, unknown>>;

describe("phenotype reaches a vertex (#151)", () => {
  it("two body classes differ in TORSO GIRTH, not just in metadata", async () => {
    const mod = await load();
    const inspect = mod["inspectBodyParamReachesVertices"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(
      report.bodyClasses.length,
      "fewer than two body classes — one body is the defect, not the fix",
    ).toBeGreaterThan(1);

    const eps = report.calibration.girthEpsilonMeters;
    expect(eps, "no girth epsilon in the calibration — it must come from two real exports").toBeGreaterThan(0);

    const bad: string[] = [];
    for (const e of report.bodyClasses) {
      if (!e.producedByStage || /probe/i.test(e.producedByStage)) {
        bad.push(`${e.bodyClassId}: producedByStage "${e.producedByStage}" — a probe is not a factory stage`);
      }
      if (e.bodyVertexCount < 1000) bad.push(`${e.bodyClassId}: ${e.bodyVertexCount} body vertices is not a body`);
    }

    // The defining assertion. Metadata cannot move this; only vertices can.
    const girths = report.bodyClasses.map((e) => e.torsoGirthProxyMeters);
    const spread = Math.max(...girths) - Math.min(...girths);
    if (spread < eps) {
      bad.push(
        `torso girth spread across body classes is ${spread.toFixed(4)}m, below the calibrated `
        + `epsilon ${eps.toFixed(4)}m — the bodies differ in metadata, not in geometry`,
      );
    }
    expect(bad, `phenotype did not reach the vertices:\n${bad.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("each body class carries its OWN fitted garment, and no Anny role was converted (COUNTERWEIGHT)", async () => {
    // MakeClothes fits to a specific basemesh state. Two bodies sharing one garment mesh means the
    // garment was fitted to the neutral basemesh and the second body is wearing the wrong fit —
    // which would pass a naive "both have a garment" check.
    const mod = await load();
    const inspect = mod["inspectBodyParamReachesVertices"] as Inspect;
    const report = await inspect();

    const broken: string[] = [];
    for (const e of report.bodyClasses) {
      if (e.garmentMeshName === null) {
        broken.push(`${e.bodyClassId}: no garment — the #215 fit stage must run per body class`);
        continue;
      }
      if (e.garmentFittedToBodyClass !== e.bodyClassId) {
        broken.push(
          `${e.bodyClassId}: garment was fitted to "${e.garmentFittedToBodyClass}" — the library key `
          + `must be (garmentId, bodyClass), not garment alone`,
        );
      }
      if (/generated-humanoids\//.test(e.glbPath)) {
        broken.push(`${e.glbPath}: a shipped Anny humanoid was overwritten — this slice adds candidates`);
      }
    }
    expect(broken, `the counterweight broke:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);
});
