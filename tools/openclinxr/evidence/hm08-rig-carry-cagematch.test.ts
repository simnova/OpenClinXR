import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#134) — LANE C CAGEMATCH. Can MakeHuman `hm08` topology carry our 23-bone
 * runtime rig? #131 returned `adopt_mh_body` for garment FIT; this is the rig/runtime carry residual.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A CAGEMATCH'S CONTRACT PROVES THE BAKE-OFF RAN AND WAS RECORDED — NEVER THAT A CANDIDATE WON.
 *
 * `verdict: reject_measured` is a SUCCESSFUL outcome and closes this issue. "hm08 cannot carry the
 * rig without N hours of retarget, here is the measured reason" is exactly as valuable as adopting.
 * Do not tune anything to make hm08 look good. If it loses, say so with numbers.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURE OUR OWN BAKE FIRST. THIS MAY END THE SLICE.
 *
 * #134 records an UNMEASURED claim: the raw `*.anny_base.obj` looks BETTER than the GLB we bake from
 * it — clean shoulders, deltoids and neck, where the shipped humanoids arrive visibly worse. A peer
 * round's reading, which I accept: **if our own bake is what degrades the figure, hm08 does not fix
 * that, and this whole comparison is answering the wrong question.**
 *
 * So contract (1) is the base-vs-bake measurement and it comes FIRST, before any MPFB2 work. If it
 * shows the bake is subtracting quality, STOP, report that, and do not build the candidate — that is
 * a successful outcome too, and it redirects the lane.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * HARD FREEZE — WITHOUT THIS THE SLICE IS UNBOUNDED, AND A PEER ROUND SAID SO
 *
 * "Apply our 23-bone rig to hm08" can mean rename bones, auto-weight, or weeks of retargeting. The
 * canonical armature in `automate_blender.py` is hand-built for anny topology, and bind pose (#67),
 * weights, morphs, garment shells and the seated/supine maps all assume that mesh.
 *
 * **In scope:** name the 23 canonical joints on an hm08 body, auto-weight, export, load.
 * **OUT of scope, and do NOT attempt any of them:**
 *   - morph-target parity (visemes, affect) — record the gap as a number, do not close it
 *   - garment rebinding or any wardrobe work
 *   - bind-pose correction beyond what auto-weight gives
 *   - touching `generated-humanoids/` or any shipped asset
 *   - making hm08 the default humanoid anywhere
 *
 * **STOP RULE:** if the rig is not named-and-skinned after **two** export attempts, stop and report
 * `reject_measured` with what blocked it. Do not attempt a third. Two failed attempts at the same
 * predicate is this repo's signal to stop guessing (§6s), and it has cost whole slices before.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURE THROUGH THE LOADER THE RUNTIME USES — §6v, and it has already burned this project once
 *
 * `gltf-transform` NodeIO reports our joints as `thigh.L`, `upper_arm.L`. **three.js strips the dots
 * on load** (`PropertyBinding.sanitizeNodeName` — `.` is a path separator in animation binding), so
 * the running scene sees `thighL`, `upper_armL`, and `clinical-idle-posture.ts` / `supine-pose.ts`
 * bind to the UNDOTTED names. #83 was filed with a confident, measured, WRONG headline for exactly
 * this reason.
 *
 * So the joint-name comparison must be made **as three.js sees it**, not as the file spells it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * LICENCE — MPFB2 IS GPL-3 AND DEFERRED BY OPERATOR DECISION, NOT RESOLVED
 *
 * MADR 0044's posture: MPFB2 is an **out-of-repo authoring tool**; it is never vendored or imported;
 * meshes it produces are not derivative of the addon. That covers producing a candidate **provided
 * it stays under an evidence/probe path with provenance and is NOT promoted** to
 * `generated-humanoids/`.
 *
 * The CC-BY scrub allowlist question from MADR 0044 stays open. Do not ship any MakeHuman system
 * asset or community garment into a learner-visible path in this slice.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - How the 23 joints are named on hm08. MPFB2's own rig renamed, a fresh armature, or a mapping
 *    table. I do not know which is robust and finding out is part of the answer.
 *  - What "carries the rig" means numerically — I have deliberately not defined a pass mark for the
 *    weight quality, only for name resolution. Say what you measured and why.
 *  - Whether the base-vs-bake comparison uses rendered pixels, surface statistics from the exported
 *    glTF, or both. Both is better; say what you chose.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands the base-vs-bake question be answered first and is satisfiable by a hand-wave. (2)
 * forbids that by requiring a candidate GLB whose joints resolve through the runtime's own loader,
 * OR an explicit `reject_measured` naming what blocked it. (3) is green today and forbids buying
 * either by touching a shipped asset or promoting the candidate.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectHm08RigCarry()`. What must not change:
 * joint names are read **through three.js**, and the candidate is enumerated from where it was
 * written rather than hardcoded.
 *
 * CALIBRATION — per-subject rows, written BEFORE any MPFB2 work (§8o, five workers have asked for
 * this). `.openclinxr/evidence/issue-134/pre-fix.json`, one row per shipped humanoid:
 *
 *   assetPath | baseObjTris | glbTris | jointCount | jointNamesAsThreeJsSeesThem | morphTargetCount
 *   | materialRegionCount | weightSource
 *
 * I have NOT measured most of these. If they come back different from anything stated above, that is
 * data about my premises, not a reason to change the target — report it.
 *
 * REQUIRED, the observable half: the candidate GLB must LOAD in the running app and be captured.
 * Reuse `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts` or the Model Vetting path; do
 * not write another capture script. **If contract (1) stops the slice, this requirement lapses with
 * it** — say so rather than producing an empty capture.
 *
 * IN-SCOPE VISUAL — answer EVERY line. Do not replace this with a sentence:
 *     base_obj_vs_shipped_glb:  base_better | same | glb_better | not_compared
 *     where_they_differ:        <name the body region, e.g. "shoulders/deltoid", not "quality">
 *     hm08_candidate_loads:     yes | no | not_attempted
 *     hm08_figure_intact:       yes | no | not_attempted
 *
 * OUT-OF-SCOPE WRONGNESS you saw and are not fixing: name the body part or object and what it looks
 * like. Known and not yours: bare feet, the supine patient's raised arm (#153), rooms reading empty.
 * Report anything else anyway, including on the same body part.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether hm08 can carry the runtime rig, and whether our bake degrades the base. Says NOTHING
 * about garment fit (#131 settled it), body parametrics (#151), or whether to migrate.
 *
 * ## FIXED (#134)
 *
 * Contract (1) primary measure is position-merged connected components across body primitives
 * (5dp quantised verts). Side-by-side: index-based still reports 14/20 (multi-material islands);
 * position-merged matches base (adults 1, child 4) and uniqueVertPositions == base vert count.
 * Withdrawn: treating index islands as bake degradation. Bake does not stop the slice.
 * Rig: attempt1 ARMATURE_AUTO failed empty weights; attempt2 ARMATURE_ENVELOPE ok →
 * evidence candidate with 23/23 joints as three.js sees them, 36972 tris, morphs=0.
 * Verdict `adopt_hm08` (rig carry / evidence path only). MADR 0047 corrected claim first.
 */

const load = async () => import("./hm08-rig-carry-cagematch.js") as Promise<Record<string, unknown>>;

type BakeComparison = {
  assetPath: string;
  /** Triangles in the tracked *.anny_base.obj this GLB was baked from. */
  baseObjTriangles: number;
  /** Triangles in the shipped GLB. */
  glbTriangles: number;
  /** Whatever the implementer chose as the surface-quality measure. Name it in `measureName`. */
  measureName: string;
  baseValue: number;
  bakedValue: number;
  /** True when the bake is measurably worse on that measure. */
  bakeDegrades: boolean;
};

type RigCarry = {
  /** Where the candidate was written. Empty when contract (1) stopped the slice. */
  candidatePath: string;
  /** Joint names AS THREE.JS SEES THEM — dots stripped. Never the raw glTF spelling. */
  runtimeJointNames: string[];
  /** Canonical 23 that the runtime posture modules bind to. */
  canonicalJointNames: string[];
  /** Canonical joints with no match in the candidate. */
  missingCanonicalJoints: string[];
  triangleCount: number;
  morphTargetCount: number;
  /** Set when the attempt was abandoned under the stop rule. */
  rejectReason: string | null;
  attempts: number;
};

type Inspect = () => Promise<{ bake: BakeComparison[]; rig: RigCarry; verdict: string }>;

const VERDICTS = ["adopt_hm08", "reject_measured", "inconclusive_blocked"];

/** Per-asset ceiling — asset-registry/src/index.ts:595. */
const MAX_TRIANGLES = 60_000;

describe("can hm08 carry the runtime rig (#134)", () => {
  it("the bake is compared against its own base before any MPFB2 work", async () => {
    // #134 records this as UNMEASURED: the raw anny base looks better than the GLB we bake from it.
    // If true, hm08 does not fix it and this comparison answers the wrong question.
    const mod = await load();
    const inspect = mod["inspectHm08RigCarry"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.bake.length, "no shipped humanoid was compared against its base").toBeGreaterThan(0);

    for (const b of report.bake) {
      expect(b.measureName.length, `${b.assetPath}: the bake measure was not named`).toBeGreaterThan(0);
      expect(
        Number.isFinite(b.baseValue) && Number.isFinite(b.bakedValue),
        `${b.assetPath}: base/baked values are not both finite — the comparison did not run`,
      ).toBe(true);
      expect(b.baseObjTriangles, `${b.assetPath}: base OBJ was not read`).toBeGreaterThan(0);
    }
  }, 1_800_000);

  it("the bake-off reached a recorded verdict", async () => {
    // The cagematch deliverable is a DECISION WITH EVIDENCE, not working code. reject_measured is a
    // successful outcome. What is forbidden is finishing without one, or without saying what blocked
    // it — a candidate that was never attempted must carry a rejectReason.
    const mod = await load();
    const inspect = mod["inspectHm08RigCarry"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(VERDICTS, `verdict "${report.verdict}" is not one of ${VERDICTS.join(" | ")}`)
      .toContain(report.verdict);

    if (report.verdict === "adopt_hm08") {
      // Only an adopt has to show a loadable candidate that resolves the canonical joints.
      expect(report.rig.candidatePath.length, "adopt_hm08 with no candidate written").toBeGreaterThan(0);
      expect(
        report.rig.missingCanonicalJoints,
        `canonical joints the candidate does not expose to three.js:\n${report.rig.missingCanonicalJoints.join(", ")}`,
      ).toHaveLength(0);
      expect(report.rig.triangleCount, "candidate exceeds the per-asset ceiling")
        .toBeLessThanOrEqual(MAX_TRIANGLES);
    } else {
      expect(
        report.rig.rejectReason ?? "",
        `verdict is ${report.verdict} but no rejectReason was recorded`,
      ).not.toHaveLength(0);
    }

    // The stop rule is part of the contract, not advice.
    expect(report.rig.attempts, "more than two export attempts — the stop rule was ignored")
      .toBeLessThanOrEqual(2);
  }, 1_800_000);

  it("no shipped asset was touched and nothing was promoted (COUNTERWEIGHT)", async () => {
    // The cheap satisfactions are promoting the candidate into generated-humanoids/ so it "loads",
    // or rebaking a shipped humanoid to make the comparison flattering. MPFB2 is GPL-3 and deferred;
    // MADR 0044's posture only holds while the candidate stays on an evidence path.
    const mod = await load();
    const inspect = mod["inspectHm08RigCarry"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    if (report.rig.candidatePath.length > 0) {
      expect(
        report.rig.candidatePath.includes("generated-humanoids"),
        `candidate was written into a shipped asset path: ${report.rig.candidatePath}`,
      ).toBe(false);
    }
    // The base comparison must read the tracked bases, so it proves they are still the shipped ones.
    expect(report.bake.length, "the counterweight has nothing to check").toBeGreaterThan(0);
  }, 1_800_000);
});
