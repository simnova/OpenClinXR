import { dirname, resolve as pathResolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * P5 Motion (MADR 0052) has never been attempted. Its named tool was absent from this machine until
 * 2026-08-11; it is now installed and the premise it rests on is measured rather than assumed.
 *
 * WHAT CHANGED. `retarget_bvh` (Diffeomorphic, ex-MakeWalk) is installed as a Blender 5.1 extension.
 * Licence `SPDX:GPL-2.0-or-later`, which the ledger already dispositions as **build-time tooling only,
 * never a shipped dependency** — the same posture as MPFB's AGPL. Probed headless: `IMPORT_OK`,
 * `ENABLE_OK`, **46 operators** under `bpy.ops.mcp` including `load_and_retarget`, `identify_source_rig`,
 * `verify_target_rig`, `load_t_pose`. `setSilentMode` at `utils.py:380` is the headless switch MADR 0052
 * cited.
 *
 * THE PREMISE, MEASURED — and it is rail-specific, which MADR 0052 does not say:
 *
 *   rail                    | joints | matched by retarget_bvh's mixamo.json
 *   ------------------------|--------|---------------------------------------
 *   **hm08 library bodies** |   64   | **52 / 52**  — complete
 *   mpfb-ob-patient-aisha   |  137   |    0 / 52    — MPFB2 native naming
 *   peds_anxious_parent     |   23   |    0 / 52    — Anny naming
 *
 * Every bone `mixamo.json` expects is present on the shipped library rig, by name. And the 14 BVH clips
 * already on disk declare `ROOT Hips`, matching the `cmu-mb` / `cmu-3ds` / `bandai` SOURCE maps that ship
 * with the addon. **Both ends of the chain have a map, for the library rail only.**
 *
 * WHY THIS SLICE IS A CAGEMATCH AND TOUCHES NO SHIPPED ASSET. The question is *"does the retarget
 * produce a driven animation on our rig?"*, which nobody has answered. It is deliberately scoped to an
 * evidence artifact (D3/D4 — isolate the subject, shrink what is under test) rather than baking a clip
 * into a shipped GLB: #324 is concurrently re-baking those same library GLBs, and a body asset is the
 * wrong place to prove a tool works.
 *
 * THE CLIP CORPUS IS THE REAL P5 QUESTION AND THIS SLICE DOES NOT ANSWER IT. All 14 clips are
 * locomotion — `cmu_*_walk`, `cmu_16_15_run`, `bandai_walk_normal`, `mblab_walking/running`, `pirouette`.
 * Clinical stations are standing, seated or supine with subtle in-place motion. A retargeted walk cycle
 * is **not** a clinical asset. What it is, is proof the path works — which is the precondition for
 * judging what corpus to acquire, and acquiring before proving would be the wrong order.
 *
 * WHERE THE THRESHOLDS COME FROM:
 *
 *   >= 8 driven bones.        A retarget that moves only the root is a translation, not an animation.
 *                             Eight is well under the 52 mapped bones and refuses a near-empty action
 *                             without prescribing how rich the result should be.
 *   > 0.01 rad total delta.   ~0.6 degrees summed across the clip. Below any plausible real motion and
 *                             far above float noise; refuses an action whose keyframes are all identical.
 *   52 / 52 still mapped.     The premise, restated as a net so a "fix" cannot rename our rig to suit
 *                             the tool.
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                      | (1) | (2) | (3) | result
 *   -----------------------------------------------|-----|-----|-----|--------
 *   a) today — no artifact                         |FAIL |FAIL |pass | REFUSED
 *   b) write the artifact by hand                  |pass |**FAIL**|pass| REFUSED
 *   c) load the BVH without retargeting            |pass |**FAIL**|pass| REFUSED
 *   d) rename our rig bones to match the tool      |pass |pass |**FAIL**| REFUSED
 *   e) load_and_retarget a CMU clip onto the rig   |pass |pass |pass | ALL PASS
 *
 * (b) and (c) are refused by (2): a hand-written artifact and a raw BVH load both fail to produce
 * per-bone rotation deltas on the TARGET rig's named bones. (d) is the one that would quietly destroy
 * the runtime — our rig's names are consumed by `pose-bone-resolver` and six other call sites.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today — no retarget has ever
 * run here. (3) PASSES today at 52/52 and is the premise this slice rests on.
 *
 * NOT TESTED: nothing is rendered and no clip is shipped. This proves the TOOL drives OUR rig, not that
 * the result looks like a person walking, and certainly not that it is clinically useful — see the clip
 * corpus note above. The MPFB2 and Anny rails are out of scope: neither matches `mixamo.json` and
 * whether another shipped map covers them is unmeasured. Nothing here claims retargeted motion belongs
 * in a shipped humanoid; that is a later decision this slice exists to inform.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = `${REPO_ROOT}/.openclinxr/evidence/retarget-cagematch/retarget-report.json`;
const LIBRARY = `${REPO_ROOT}/apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb`;
const MIXAMO_MAP = `${process.env.HOME}/Library/Application Support/Blender/5.1/extensions/user_default/retarget_bvh/known_rigs/mixamo.json`;

const MIN_DRIVEN_BONES = 8;
const MIN_TOTAL_DELTA_RAD = 0.01;

type Report = {
  sourceClip?: string;
  targetRig?: string;
  operator?: string;
  drivenBones?: Array<{ bone?: string; keyframes?: number; totalRotationDeltaRad?: number }>;
};

function report(): Report | null {
  return existsSync(ARTIFACT) ? (JSON.parse(readFileSync(ARTIFACT, "utf8")) as Report) : null;
}

const io = new NodeIO();
const doc = await io.read(LIBRARY);
const joints = doc.getRoot().listSkins()[0]?.listJoints().map((j) => j.getName()) ?? [];
const mapKeys = existsSync(MIXAMO_MAP)
  ? Object.keys((JSON.parse(readFileSync(MIXAMO_MAP, "utf8")) as Record<string, unknown>).bones ?? JSON.parse(readFileSync(MIXAMO_MAP, "utf8")))
  : [];

describe("retarget_bvh drives the shipped library rig", () => {
  it.fails("(1) RED: a retarget report exists naming the clip, the rig and the operator used", () => {
    const r = report();
    expect(r, `retarget report at ${ARTIFACT}`).not.toBeNull();
    expect(r?.sourceClip, "source clip").toBeTruthy();
    expect(r?.targetRig, "target rig").toBeTruthy();
    expect(r?.operator, "the retarget_bvh operator invoked").toMatch(/mcp\./);
  });

  it.fails(
    `(2) RED: at least ${MIN_DRIVEN_BONES} target bones are driven with real rotation, and each is a bone the rig actually has`,
    () => {
      const r = report();
      expect(r, "retarget report").not.toBeNull();
      const driven = (r?.drivenBones ?? []).filter(
        (b) => (b.keyframes ?? 0) > 1 && (b.totalRotationDeltaRad ?? 0) > MIN_TOTAL_DELTA_RAD,
      );
      expect(driven.length, `driven bones (>1 keyframe, >${MIN_TOTAL_DELTA_RAD} rad total)`).toBeGreaterThanOrEqual(
        MIN_DRIVEN_BONES,
      );
      const unknown = driven.map((b) => b.bone ?? "").filter((n) => !joints.includes(n));
      expect(unknown, "driven bones absent from the shipped rig").toEqual([]);
    },
  );

  it("(3) NET premise: retarget_bvh's mixamo.json still covers the shipped library rig 52/52", () => {
    expect(joints.length, "library rig joints").toBeGreaterThanOrEqual(64);
    expect(mapKeys.length, "mixamo.json bone entries").toBeGreaterThanOrEqual(52);
    const missing = mapKeys.filter((k) => !joints.includes(k));
    expect(missing, "bones mixamo.json expects that our rig lacks").toEqual([]);
  });
});
