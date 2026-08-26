import { createHash } from "node:crypto";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * 2026-08-21 — THE PEDS CAST'S SHIPPED IRIS IS ITS ROLE DEFAULT, NOT ITS AUTHORED COLOUR.
 *
 * `#518` made the selector read the case's `eye_color` and refuse an unbuildable one. It rebaked
 * NOTHING, so no learner sees any of it: every shipped iris is still the role default baked before
 * that landed. This slice carries the case colour into two shipped bodies.
 *
 * ## THE DEFECT, MEASURED on the shipped bytes — do not re-derive this
 *
 *   actor                    | shipped iris | sha256[0:12] | bytes   | case authors | verdict
 *   -------------------------|--------------|--------------|---------|--------------|--------
 *   mpfb-peds-parent-aisha   | green_eye    | b9864ac4f4fa | 662,241 | **brown**    | WRONG
 *   mpfb-peds-nurse-kevin    | blue_eye     | 572ddc93ab3e | 666,029 | **brown**    | WRONG
 *   (target)                 | brown_eye    | 4659691c7295 | 610,817 |              |
 *
 * Both authored colours are IN the staged pack, so both are buildable today. green and blue are
 * what `_EYE_IRIS_BY_ROLE` hands a family member and a nurse when nobody asks for anything.
 *
 * ## MAYA IS DELIBERATELY OUT OF SCOPE — this is the counterweight, not an omission
 *
 * `patient_maya_johnson_v1` authors `eye_color: "hazel"`. There is no `hazel.mhmat` in the CC0
 * pack, so `#518`'s selector raises `ValueError` — correctly. Rebaking her would CRASH, and the
 * two ways to make that stop (map hazel to a staged colour, or edit the bank) are both refused:
 * the first re-hides the gap `#518` exposed, the second is a decision about a specific paediatric
 * patient's identity, which is not an implementer's to make (§8d) and is not mine. It sits with
 * the operator, or with an authoring surface that offers the nine buildable colours.
 *
 * **So clause (4) asserts Maya's iris is BYTE-IDENTICAL to today.** A worker that "helpfully"
 * rebakes the whole cast, or quietly resolves hazel, fails there.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                    | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — role defaults baked in                            |FAIL |FAIL |pass |pass | REFUSED
 *   b) hand-swap the iris texture on the two GLBs                |pass |pass |pass |pass | see below
 *   c) change _EYE_IRIS_BY_ROLE family/nurse to brown            |pass |pass |FAIL |pass | REFUSED
 *   d) rebake the whole cast including Maya                      |pass |pass |pass |FAIL | REFUSED
 *   e) rebake the two through the #518 selector, Maya untouched  |pass |pass |pass |pass | ALL PASS
 *
 * **(c) is the trap this contract can see:** flipping the role defaults to brown turns both greens
 * and blues brown for every actor that authors nothing, which clause (3) catches — the fallbacks
 * are the §9h known-good and must survive.
 *
 * **(b) is the trap it CANNOT see, and the orchestrator owns it.** A hand-swapped texture produces
 * byte-identical bytes to a correct rebake. The defence is the provenance record and the pixel
 * grade, not this file. Stated here so nobody mistakes green for proof of a wired pipeline.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1)(2) are RED today. (3)(4) are NETS — true now and
 * asserted so a fix cannot buy its green by breaking them.
 *
 * KNOWN-GOOD COLUMN (§9h): the four actors that author NO eye colour and must keep their role
 * default — clinical-nurse blue, family-partner green, ob-patient brown, street-male brown.
 *
 * NOT TESTED:
 *   - Whether the iris LOOKS right. The orchestrator grades an isolated crop; this bounds identity
 *     of the texture, not appearance.
 *   - Maya. Blocked on an identity decision, deliberately.
 *   - Any non-peds station.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED = pathResolve(HERE, "../../../apps/ui-xr/public/generated-humanoids");

const BROWN = "4659691c7295";
const GREEN = "b9864ac4f4fa";
const BLUE = "572ddc93ab3e";

async function iris(actor: string): Promise<{ name: string; sha: string }> {
  const doc = await new NodeIO().read(join(GENERATED, `${actor}.glb`));
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!/eye/i.test(mat?.getName() ?? "")) continue;
      const tex = mat?.getBaseColorTexture();
      const img = tex?.getImage();
      if (!img) continue;
      return {
        name: tex?.getName() ?? "",
        sha: createHash("sha256").update(Buffer.from(img)).digest("hex").slice(0, 12),
      };
    }
  }
  throw new Error(`${actor}: no iris texture`);
}

describe("the peds cast's iris matches its authored eye colour", () => {
  it("(1) RED: the peds parent's iris is the case's brown, not the family default green", async () => {
    const got = await iris("mpfb-peds-parent-aisha");
    expect(got.sha, `case authors brown; shipped is ${got.name}`).toBe(BROWN);
  });

  it("(2) RED: the peds nurse's iris is the case's brown, not the nurse default blue", async () => {
    const got = await iris("mpfb-peds-nurse-kevin");
    expect(got.sha, `case authors brown; shipped is ${got.name}`).toBe(BROWN);
  });

  it("(3) NET: actors authoring NO eye colour keep their role default", async () => {
    // Refuses (c). Repainting the role table brown would satisfy (1) and (2) and destroy this.
    expect((await iris("mpfb-clinical-nurse-adult")).sha, "nurse fallback stays blue").toBe(BLUE);
    expect((await iris("mpfb-family-partner-adult")).sha, "family fallback stays green").toBe(GREEN);
    expect((await iris("mpfb-ob-patient-aisha")).sha, "patient fallback stays brown").toBe(BROWN);
    expect((await iris("mpfb-street-adult-male")).sha, "patient fallback stays brown").toBe(BROWN);
  });

  it("(4) NET: Maya ships her RECORDED case colour, and the refusal still fires on hazel", async () => {
    // Refuses (d) — a blanket "rebake the whole cast" that buys (1)/(2) green — and refuses a
    // SILENT hazel resolution. #681 is the operator decision this header's NOT TESTED deferred
    // ("sits with the operator, or with an authoring surface that offers the nine buildable
    // colours"): hazel resolved to green IN THE CASE (pediatric-asthma.ts:122, rationale in a
    // comment), the manifest updated, the GLB re-baked. Not silent: recorded, seeded, frozen.
    const got = await iris("mpfb-peds-patient-child");
    expect(got.sha, "mpfb-peds-patient-child ships her resolved case colour (green, #681)").toBe(GREEN);
    expect(got.name, "and the declared texture is the pack's green_eye").toBe("green_eye");
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#519) — appended, planted header above is immutable
 *
 * (1)(2) Rebaked `mpfb-peds-parent-aisha` and `mpfb-peds-nurse-kevin` through
 * `materialize_mpfb_humanoid_candidate.py` so `eye_iris_colour` reads the case's
 * `eye_color: "brown"` (parent via `--eye-colour-reference peds_anxious_parent`; nurse via
 * `--reference peds_nurse_kevin`). Both ship `brown_eye` sha256[0:12]=4659691c7295.
 *
 * (3) Role-default actors untouched — clinical-nurse blue, family-partner green, ob-patient /
 * street-male brown.
 *
 * (4) Maya (`mpfb-peds-patient-child`) byte-identical; hazel still raises ValueError; bank unedited.
 *
 * Texture regression on the first rebake (incomplete worktree garment cache missing .mhmat +
 * diffuse PNGs) was re-run after provisioning those files; Shoe / T-shirt_basic / boot bindings
 * restored to main's hashes alongside the brown iris.
 *
 * NOT TESTED: pixel grade of the brown iris or garment appearance (orchestrator); whether a
 * worktree that lacks garment .mhmat files can ever green without provisioning.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## FIXED (#681) — appended; the planted header above is immutable
 *
 * Clause (4) re-keyed: #681 took the D13 pick this header deferred to the operator and recorded it
 * in the case — pediatric-asthma.ts:122 resolves hazel -> green (rationale in a comment), the
 * tracked anny manifest matches, and `mpfb-peds-patient-child.glb` was re-baked through the #518
 * selector. Maya now ships green_eye (sha256[0:12] b9864ac4f4fa, 662,241 B) — her case's colour,
 * not the patient role default. The refusal is untouched: `eye_iris_colour` still raises
 * ValueError on any unbuildable name (see the-case-eye-colour-reaches-the-iris-selector clause (3)
 * and (5)). Clauses (1)(2)(3) unchanged.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
