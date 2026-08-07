import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#78) — the clothing lane has no generator, and the incumbent is a human
 * editing numbers.
 *
 * ALL THREE ARE `it.fails` AND ALL THREE FLIP TO `it(`. They are not all REDs:
 *   (1) and (2) are REDs — the probe does not exist.
 *   (3) is a COUNTERWEIGHT — it asserts something ALREADY TRUE that your work must not change
 *       (StableGen stays licence-blocked and uninstalled). It is `it.fails` only because the module
 *       is absent; a plain `it(` here would redden main for the whole dispatch window.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * OPERATOR DIRECTION, 2026-08-07, and it is the whole point of this slice
 *
 *   "Please prioritize the cage match for ai generated clothing rather than trying it yourself,
 *    the ai approach is a factory approach, hand adapting is not, we're optimizing for factory
 *    approach."
 *
 * So the question is NOT which tool makes a nicer shirt. It is: WHICH PIPELINE TAKES A BLUEPRINT
 * FIELD AND PRODUCES A FITTED GARMENT FOR ANY ROLE WITHOUT A HUMAN TUNING CONSTANTS.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE INCUMBENT, MEASURED — this is what "hand adapting" costs
 *
 * `apply_role_clothing_material_regions` (`automate_blender.py:1649-2552`). In the shape core alone
 * (`:1989-2500`): ~245 float tokens (~89 unique) and ~145 integers. About 32 refs scale off
 * `body_height` / `body_depth` / `torso_half` / `arm_len`.
 *
 * NOT ONE CONSTANT IS A FREE PARAMETER DERIVED FROM `garmentLayers` CONTENT. The field is read at
 * `:1676-1701` purely to pick a branch — `is_gown`, `is_open_front`, `is_scrub` — and each branch
 * carries its own hardcoded table (open cardigan: `bot_y = body_min_y + body_height * 0.31`,
 * `sleeve_along = arm_len * 0.92`, `front_opening_rad = 0.95`, `:2014-2026`).
 *
 * A new garment class is therefore not a data change. It is a person editing numbers.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE THREE CANDIDATES ARE NOT THE SAME KIND OF THING, and this is the finding that shapes the probe
 *
 *   MakeClothes        GARMENT GEOMETRY. Template garments fitted to a body. CC0 assets, AGPL/GPL
 *                      tool — outputs-only posture per MADR 0016. Registry-cleared already:
 *                      `makehuman_outputs`, `lanes: ["human_base_mesh","clothing"]`,
 *                      `approvalBlockers: []`, but `preferredForInitialBuild: false` and NO
 *                      implementation anywhere.
 *
 *   Imagine→SMPLitex   BODY TEXTURE on an SMPL UV atlas. `smplitex` is an `AssetGenerationMethod`
 *                      STRING LITERAL ONLY (`schemas.ts:257-263`) — no tool entry, no runner.
 *
 *   StableGen          BODY/SCENE TEXTURE. `lanes: ["skin_texture"]`, GPL-3.0,
 *                      `licensePolicy: "blocked_without_exception"` (`index.ts:956-968`).
 *
 * ONLY ONE OF THE THREE MAKES A GARMENT. The other two paint the body. That is why every report
 * entry must carry `outputClass` — the field IS the finding.
 *
 * WHY PAINTED CLOTHING IS BOUNDED RATHER THAN USELESS: a learner who must expose the chest to
 * auscultate or the abdomen to palpate CANNOT LIFT A TEXTURE. Texture clothing is plausibly fine for
 * background and observer actors and not for the patient under examination. A hybrid is coherent.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS ALREADY KNOWN — do not spend turns rediscovering these
 *
 * SMPLitex needs SMPL topology AND its UV atlas, typically with SMPL pose params. Ours is Anny:
 * different mesh, different UVs, 23 joints with different names and rest pose. There is no vertex or
 * UV correspondence, so nothing binds without a full retarget or body proxy. Capture the ACTUAL
 * ERROR; do not build the retarget — that is a project, not this slice.
 *
 * No image→garment-geometry pipeline is wired anywhere in this repo. The existing Comfy/StableGen
 * path is skin PBR texturing behind an approval gate that hard-exits
 * (`orchestrate_character.py:404-405`; Blender only prints "would queue" at `:3147-3149`).
 *
 * The Grok harness has 2D `image_gen` / `image_edit`. Whether that can stand in for "Grok Imagine"
 * is NOT DETERMINED by me — find out and record what you find.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE DELIVERABLE IS A DECISION WITH EVIDENCE, NOT AN ADOPTION.
 *
 * A NEGATIVE CLOSES THIS SUCCESSFULLY. "SMPLitex requires SMPL topology, here is the exact error on
 * our Anny mesh" is a result. So is "MakeClothes garments need MakeHuman topology and ours is Anny,
 * here is what broke." Do not adopt anything. Do not wire a candidate into the shipping pipeline.
 * Do not extend `automate_blender.py`'s procedural shells — that is the thing being replaced.
 *
 * DO NOT INSTALL STABLEGEN. GPL-3.0 `blocked_without_exception` is a licence decision for Patrick,
 * not for an agent. Record what it would give us and leave it blocked. Contract (3) enforces this.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * ANTI-FABRICATION. This repo produced a fabricated `score.json` once (#17) — a bake-off nobody ran,
 * scored by the agent that produced it. Contract (1) makes silent omission impossible: every named
 * candidate is `ran` with measurements or `blocked` with the real error text. Contract (2) demands
 * numbers nobody could write without executing the tool. `min-bytes:` proves a file exists, not that
 * a probe ran — #56 shipped 113 KB of collapsed torsos past exactly that check.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `runClothingFactoryCagematch()`. Change the call
 * sites and say why if a different shape is better. What must not change: every named candidate is
 * accounted for, a ran candidate carries a measurement it could not have without running, and the
 * report records `outputClass` per candidate.
 *
 * REPORT ARTIFACT: `.openclinxr/evidence/clothing-cagematch/probe-report.json`.
 *
 * SCOPE: which pipelines can run here and what class of output they produce. Says NOTHING about
 * whether any resulting garment looks good — that is a render the orchestrator grades — nor whether
 * it is clinically appropriate, which needs a clinician and is not claimed.
 *
 * IN-SCOPE VERDICT required in your report: one line per candidate, "X produced ___". Separately
 * name any out-of-scope wrongness you saw and are not fixing — the object and what it looks like.
 *
 * ## FIXED (#78)
 *
 * Measured on this machine (2026-08-07), worktree issue-78. DECISION WITH EVIDENCE — no adoption.
 *
 * makeclothes (GARMENT GEOMETRY — the only candidate that can make a garment)
 *   - Tool: MPFB MakeClothes ClothesService.fit_clothes_to_human (bl_ext.user_default.mpfb)
 *   - Anny (peds_nurse_kevin.glb anny_base): BLOCKED — exact error:
 *       ValueError: The provided object is not a basemesh
 *     Anny body 13686 verts; MH basemesh 19158 verts; delta -5472; object_is_basemesh=false
 *   - MH topology CONTROL: RAN — synthetic sphere fitted on MH base.obj marked Basemesh
 *       clothes_verts=482, clothes_tris=960, glb_bytes=24668, fit_wall_clock_s≈0.038
 *       artifact: makeclothes-mh-probe-clothes.glb (outputClass=separate_garment_mesh)
 *   - Decision: works only on MakeHuman basemesh topology. Not an Anny factory path without a
 *     full basemesh swap. NOT adopted.
 *
 * imagine_smplitex (BODY TEXTURE on SMPL UV — plus TEXT→image half)
 *   - image_gen REACHABLE from worktree-bound dispatch: YES. Produced teal V-neck scrub top
 *       1024×1024 JPEG, 245941 bytes → imagine-scrub-top.jpg (outputClass=image_only)
 *   - SMPL/SMPLitex loader against Anny: BLOCKED — exact error:
 *       ValueError: SMPL/SMPLitex loader requires SMPL topology with exactly 6890 vertices
 *       and the SMPL UV atlas; loaded mesh 'peds_nurse_kevin.anny_base…' has 13686 vertices
 *       (delta 6796), joint_name_intersection=3/24, uv_loops=80076. Anny joints (thigh.L…) ≠
 *       SMPL (left_hip…). No vertex/UV correspondence — cannot bind SMPLitex texture.
 *   - IMAGE→3D FOSS/cloud attempts on that garment image:
 *       local Hunyuan3D v2: blocked — no hunyuan_3d_v2.1.safetensors under ComfyUI/models
 *         (checkpoints: RealVisXL_V5.0_fp16.safetensors only)
 *       TripoImageToModelNode: blocked — Exception: Unauthorized: Please login first to use this node.
 *       MeshyImageToModelNode: blocked — HTTP 400 Bad Request
 *   - Decision: TEXT→image is free; IMAGE→fitted 3D garment on Anny topology is not available
 *     without SMPL retarget/proxy (a project, not this slice) or paid/logged-in cloud 3D APIs
 *     that still do not bind to Anny. NOT adopted.
 *
 * stablegen (BODY/SCENE TEXTURE — COUNTERWEIGHT)
 *   - NOT installed, NOT run. GPL-3.0 licensePolicy=blocked_without_exception
 *     (packages/openclinxr/asset-registry/src/index.ts stablegen entry).
 *   - Would give: body/scene PBR texture (skin_texture lane), not separate garment geometry.
 *   - License decision remains Patrick's.
 *
 * IN-SCOPE VERDICT
 *   - makeclothes produced separate_garment_mesh on MH basemesh control; refused Anny with
 *     ValueError 'not a basemesh'.
 *   - imagine_smplitex produced image_only (scrub top photo); SMPLitex/SMPL loader and local
 *     image→3D did not produce a fitted Anny garment.
 *   - stablegen produced nothing (licence-blocked; would be body_texture class if ever allowed).
 *
 * OUT-OF-SCOPE WRONGNESS SEEN AND NOT FIXED
 *   - peds_nurse_kevin.glb: openclinxr_declared_upper_layers__scrub_top+scrub_pocket_mesh is a
 *     3-vertex / 1-triangle stub triangle floating with the garment stack (fixture residue).
 *   - Procedural real_garment meshes on the nurse still show strap-like shoulder caps / armpit
 *     gaps relative to the torso (known garment geometry debt; not re-tuned here).
 */

const load = async () =>
  import("./clothing-factory-cagematch.js") as Promise<Record<string, unknown>>;

type OutputClass = "separate_garment_mesh" | "fused_body_mesh" | "body_texture" | "image_only";

type CandidateResult = {
  candidateId: string;
  status: "ran" | "blocked";
  /** Required when blocked — the ACTUAL error or licence clause, not a paraphrase. */
  blockedReason?: string;
  /** What the pipeline actually emitted. This field is the finding. */
  outputClass?: OutputClass;
  /** Numbers that cannot be written without executing the tool. */
  measurements?: Record<string, number | string>;
  /** Files the probe claims to have produced. */
  artifacts?: string[];
};
type Run = () => Promise<{ candidates: CandidateResult[] }>;

/** Every candidate the operator named. Silence about any of them is the #17 failure. */
const NAMED = ["makeclothes", "imagine_smplitex", "stablegen"];

describe("the clothing candidates were actually run (#78)", () => {
  it("every named candidate is accounted for as ran-with-measurements or blocked-with-a-reason", async () => {
    // The anti-fabrication contract. A candidate that is simply missing from the report is how a
    // bake-off that never happened gets filed as one.
    const mod = await load();
    const run = mod["runClothingFactoryCagematch"] as Run | undefined;
    expect(run).toBeTypeOf("function");

    const report = await run!();
    for (const candidateId of NAMED) {
      const entry = report.candidates.find((c) => c.candidateId === candidateId);
      expect(entry, `${candidateId} is absent from the report entirely`).toBeDefined();
      expect(["ran", "blocked"]).toContain(entry!.status);
      if (entry!.status === "blocked") {
        expect(
          String(entry!.blockedReason ?? ""),
          `${candidateId} is blocked with no reason — that is a skip wearing a label`,
        ).not.toHaveLength(0);
      }
    }
  }, 3_600_000);

  it("a candidate that ran records what class of output it produced and a real measurement", async () => {
    // outputClass is the actual finding of this cagematch: only one of the three makes a garment,
    // the other two paint the body, and the clinical constraint turns on exactly that distinction.
    const mod = await load();
    const run = mod["runClothingFactoryCagematch"] as Run | undefined;
    expect(run).toBeTypeOf("function");

    const report = await run!();
    const ran = report.candidates.filter((c) => c.status === "ran");
    expect(ran.length, "no candidate ran at all — if that is the true result, record each as blocked with its error").toBeGreaterThan(0);

    for (const entry of ran) {
      expect(
        ["separate_garment_mesh", "fused_body_mesh", "body_texture", "image_only"],
        `${entry.candidateId} ran without recording an outputClass`,
      ).toContain(entry.outputClass);
      expect(
        Object.keys(entry.measurements ?? {}).length,
        `${entry.candidateId} ran but carries no measurement — a report with no numbers is a narrative`,
      ).toBeGreaterThan(0);
    }
  }, 3_600_000);

  it("StableGen is recorded as blocked and was not installed (COUNTERWEIGHT — asserts what is ALREADY true)", async () => {
    // Guards a licence decision that belongs to Patrick, not to an agent. GPL-3.0
    // blocked_without_exception. A cagematch that "just tried it to see" would violate the boundary
    // this repo is run under, and passing contracts (1) and (2) must not require it.
    const mod = await load();
    const run = mod["runClothingFactoryCagematch"] as Run | undefined;
    expect(run).toBeTypeOf("function");

    const report = await run!();
    const stablegen = report.candidates.find((c) => c.candidateId === "stablegen");
    expect(stablegen, "stablegen missing from the report").toBeDefined();
    expect(stablegen!.status, "stablegen was RUN — it is GPL-3.0 blocked_without_exception").toBe("blocked");
    expect(
      String(stablegen!.blockedReason ?? "").toLowerCase(),
      `stablegen blocked for the wrong reason: ${stablegen!.blockedReason}`,
    ).toMatch(/gpl|licen[cs]e|blocked_without_exception/);
  }, 3_600_000);
});
