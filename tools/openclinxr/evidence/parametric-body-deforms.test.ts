import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#216). Two REDs. Both flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURED ON MAIN — the two parametric bodies #151 landed are STATIC PROPS
 *
 *   body-param-adult_lean_female-library.glb   skins=0  joints=0  skinnedMeshes=0/2  anims=0
 *   body-param-adult_heavy_male-library.glb    skins=0  joints=0  skinnedMeshes=0/2  anims=0
 *
 * Read with glTF-Transform NodeIO. The shipped Anny humanoids carry a 23-bone armature; these carry
 * none. They cannot be posed, animated, or staged as actors.
 *
 * Cause located in the tree: `body_param_stage.py:256` and `:361` export with `export_skins=False`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS A HALF-SLICE OF MINE BEING FINISHED, NOT A NEW ADVENTURE
 *
 * #151's brief flagged the armature rebind, declared it out of scope, and named it a legitimate
 * stopping point. The worker correctly stopped. The result is a body station that produces figures
 * no examination can use — the THIRD "proven and unconsumed" artifact in a row (#215 garment without
 * body, #151 body without rig).
 *
 * A peer round's verdict, verbatim: "#151 without rig was a certainty-max half-slice — girth is easy
 * to prove; skin is the part that makes a humanoid usable." That is correct and the scope error was
 * mine, not the worker's.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE TOOL PATH IS ALREADY IN THE TREE — do not invent a rigger
 *
 * `hm08_rig_carry_stage.py` already has `create_canonical_armature` and auto-weight binding. Blender
 * `ARMATURE_AUTO` weights are exactly the right tool for "new mesh shape, same bone names" — a macro
 * body changes bounds, and that stage builds bones FROM the current AABB.
 *
 *   ORDER IN THE STAGE: macros -> bake body -> fit clothes -> parent body AND garment to the
 *   armature with automatic weights -> export WITH SKINS.
 *
 *   DO NOT: reach for Rigify (authoring convenience, not needed in the dark path), or AniGen
 *           (licence-blocked — NVIDIA-derived, non-commercial, must not be installed).
 *   DO NOT: hand-author weight values in Python. That is directive D1's anti-pattern by name.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MEASUREMENT A "WE RAN AUTO-WEIGHTS" SLICE CANNOT FAKE
 *
 * Bone count and joint names are trivially satisfiable — a skin can exist with all-zero weights and
 * the mesh will not move. So contract (2) requires DEFORMATION UNDER A KNOWN POSE:
 *
 *   control    rest pose, world positions recorded
 *   treatment  ONE named bone rotated by a fixed local angle
 *   metric     max |delta world| of mesh vertices in the driven limb band
 *   pass       displacement >= epsilon, where EPSILON IS SELF-CALIBRATED from the same export
 *              (half the median bone-tip motion) — the same trick that made #151's girth check
 *              un-fakeable. Do NOT invent a millimetre figure and do not take one from me.
 *
 * A skin whose weights are zero produces displacement ~0 and fails. That is the defect this exists
 * to catch.
 *
 * The GARMENT must deform too. A body that moves inside a frozen shirt is not a dressed figure.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * NOT KNOWN TO ME: whether auto-weights on a macro-modified body produce usable joints without
 * manual cleanup, and whether the garment binds cleanly or needs weight transfer from the body.
 * A peer thinks auto-weights is precisely the tool for this, but quality varies. If binding produces
 * visibly broken deformation you cannot fix within the stage, SAY SO AND STOP — `reject_measured`
 * closes this successfully and is far better than hand-tuned weights.
 *
 * DO NOT convert a shipped Anny humanoid. DO NOT change ui-xr defaults. #215 and #151 stay green.
 *
 * ## FIXED (#216)
 *
 * `body_param_stage.py` now binds body + garment to the canonical 23-bone armature
 * (`hm08_rig_carry_stage.create_canonical_armature` + ARMATURE_AUTO, then k-NN + bone-envelope
 * weight projection for the garment so sleeves follow the arm) and exports with `export_skins=True`.
 *
 * Measured after rebind (NodeIO + stage deformationCalibration):
 *
 *   body-param-adult_lean_female-library.glb   skins=1  joints=23  skinnedMeshes=2
 *   body-param-adult_heavy_male-library.glb    skins=1  joints=23  skinnedMeshes=2
 *
 * Driven bone upper_arm.L @ 55°: body band Δ ≥ 0.36 m, garment band Δ ≥ 0.16 m, both clear
 * self-calibrated ε ≈ 0.159 m (half driven-bone tip motion). Grade:
 * `.openclinxr/evidence/issue-216/posed-deformation-grade.png` (EEVEE lit rest|posed).
 */

type BodyRig = {
  bodyClassId: string;
  glbPath: string;
  skinCount: number;
  jointCount: number;
  jointNames: string[];
  skinnedMeshNames: string[];
  /** Max |world delta| of body verts in the driven band, control vs one-bone treatment. */
  bodyDeformationMeters: number;
  /** Same, for the fitted garment. A frozen shirt on a moving body is not dressed. */
  garmentDeformationMeters: number;
  producedByStage: string;
};

type Inspect = () => Promise<{
  bodies: BodyRig[];
  calibration: { drivenBone: string; rotationDegrees: number; deformationEpsilonMeters: number; source: string };
}>;

const load = () =>
  import("./parametric-body-deforms.js") as Promise<Record<string, unknown>>;

describe("a parametric body can be posed (#216)", () => {
  it("both parametric bodies carry a skin with the canonical joints", async () => {
    const mod = await load();
    const inspect = mod["inspectParametricBodyDeforms"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.bodies.length, "fewer than two parametric bodies inspected").toBeGreaterThan(1);

    const bad: string[] = [];
    for (const b of report.bodies) {
      if (b.skinCount < 1) bad.push(`${b.bodyClassId}: skins=${b.skinCount} — still a static prop`);
      if (b.jointCount < 20) {
        bad.push(`${b.bodyClassId}: ${b.jointCount} joints — the shipped cast carries a 23-bone armature`);
      }
      if (b.skinnedMeshNames.length < 2) {
        bad.push(
          `${b.bodyClassId}: ${b.skinnedMeshNames.length} skinned mesh(es) — body AND garment must bind, `
          + `a moving body inside a frozen shirt is not a dressed figure`,
        );
      }
      if (!b.producedByStage || /probe/i.test(b.producedByStage)) {
        bad.push(`${b.bodyClassId}: producedByStage "${b.producedByStage}" — a probe is not a factory stage`);
      }
    }
    expect(bad, `parametric bodies that cannot be posed:\n${bad.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("the mesh actually MOVES when a bone moves (COUNTERWEIGHT)", async () => {
    // A skin can exist with all-zero weights: joints present, mesh frozen, every naming check green.
    // Displacement under one named bone rotation is the only thing that separates a bound mesh from a
    // decorated one. Epsilon is self-calibrated from the same export — do not accept an invented number.
    const mod = await load();
    const inspect = mod["inspectParametricBodyDeforms"] as Inspect;
    const report = await inspect();

    const eps = report.calibration.deformationEpsilonMeters;
    expect(eps, "no deformation epsilon — it must be derived from this export, not chosen").toBeGreaterThan(0);
    expect(
      report.calibration.source,
      "epsilon source must name how it was calibrated from this export",
    ).toMatch(/calibrat/i);

    const frozen: string[] = [];
    for (const b of report.bodies) {
      if (b.bodyDeformationMeters < eps) {
        frozen.push(
          `${b.bodyClassId}: body moved ${b.bodyDeformationMeters.toFixed(4)}m when `
          + `${report.calibration.drivenBone} rotated ${report.calibration.rotationDegrees}deg `
          + `— below the calibrated ${eps.toFixed(4)}m. Skin present, weights not binding.`,
        );
      }
      if (b.garmentDeformationMeters < eps) {
        frozen.push(
          `${b.bodyClassId}: garment moved ${b.garmentDeformationMeters.toFixed(4)}m — the body moves `
          + `inside a frozen shirt`,
        );
      }
    }
    expect(frozen, `meshes that do not deform:\n${frozen.join("\n")}`).toEqual([]);
  }, 1_800_000);
});
