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
  it.fails("(1) RED: the peds parent's iris is the case's brown, not the family default green", async () => {
    const got = await iris("mpfb-peds-parent-aisha");
    expect(got.sha, `case authors brown; shipped is ${got.name}`).toBe(BROWN);
  });

  it.fails("(2) RED: the peds nurse's iris is the case's brown, not the nurse default blue", async () => {
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

  it("(4) NET: Maya is untouched — hazel is unbuildable and her colour is not ours to pick", async () => {
    // Refuses (d), and any silent hazel resolution. #518's selector RAISES on hazel; a rebake of
    // this actor crashes, and making it stop requires a decision nobody in this slice may take.
    const got = await iris("mpfb-peds-patient-child");
    expect(got.sha, "mpfb-peds-patient-child must be byte-identical to today").toBe(BROWN);
    expect(got.name, "and still the same declared texture").toBe("brown_eye");
  });
});
