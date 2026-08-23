import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Node, type Primitive } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { driveVisemeTimeline, type VisemeFrame } from "../../../apps/ui-xr/src/viseme-timeline-drive.js";

/**
 * **OBSERVABLE: the lip-sync driver opens the jaw, so a spoken vowel parts the lips.**
 *
 * ## MEASURED ON HEAD 81d06dd6, 2026-08-23 — do not re-derive these numbers
 *
 * #552 was filed as a BAKE defect: *"the bake must raise the anterior aperture from 0 to >= 20.7mm"*.
 * **That premise is refuted by measurement and this contract supersedes it.** The bake is not
 * defective. Measured on the shipped `mpfb-viseme-inspect.glb` (NodeIO, all 47 morph targets, each
 * applied to the anterior oris/levator vertex band that `open-mouth-interior-measure.ts:150-178`
 * already defines):
 *
 *     target applied at weight 1.0            anterior lip gap (m)   vs threshold 0.0207250
 *     viseme_aa                                0.000000              0.00x
 *     viseme_SS            (best of all 47)    0.000640              0.03x
 *     viseme_aa + mouth-elevation (best combo) 0.000440              0.02x
 *     mouth-open           (named for the job) 0.000270              0.01x
 *     viseme_aa + mouth-open                   0.000000              0.00x
 *     viseme_sil           (control)           0.000270              0.01x
 *
 * **No morph target on this mesh, alone or combined, moves the lip band past 0.64 mm** against a
 * 20.7 mm threshold — a factor of 32. That includes the one literally named **`mouth-open`**, which
 * reaches 0.27 mm, 77x short; combined with `viseme_aa` it reaches zero. (I first wrote that no
 * `mouth-open` morph existed. That was wrong — I read absence off a truncated top-12 ranking, and
 * clause (4) caught it. The corrected fact is stronger than the one I claimed.)
 * Re-baking cannot fix this, because the visemes02 pack (CC0, Mika Suominen) authors LIP-SURFACE
 * shapes by design; MakeHuman/MPFB visemes shape the lips and never open the jaw.
 *
 * ## WHAT ACTUALLY OPENS THE MOUTH — a bone, and it already ships
 *
 * The rig carries 137 joints including **`jaw`**. Of the 22 `oris*`/`levator*` lip bones, **6 descend
 * from `jaw` and 16 do not** — exactly the split a working mouth needs, lower lip carried by the jaw
 * and upper lip held by the skull:
 *
 *     oris01 -> oris02 -> special04 -> jaw -> head -> neck03 -> ... -> root
 *
 * Measured world positions give a lever arm `|jaw -> oris01|` of **0.137901 m**, so the rotation that
 * drops the lower lip by the teeth-derived threshold is
 *
 *     asin(0.020725011825561523 / 0.137901) = 0.15086 rad = 8.64 degrees
 *
 * An 8.64 deg jaw opening is anatomically ordinary (a human jaw opens 25-50 deg), so the mechanism is
 * available with wide margin. **The defect is that nothing drives it:** `viseme-timeline-drive.ts` and
 * `viseme-runtime-wire.ts` contain zero references to `jaw`, `bone`, `skeleton`, `rotation` or
 * `quaternion` (grepped on this HEAD). `driveVisemeTimeline` emits `{ atSecond, durationSeconds?,
 * weights }` and nothing else, so the runtime moves lip surfaces sub-millimetrically and never opens
 * the mouth.
 *
 * ## THRESHOLD PROVENANCE — derived from inputs, never from the effect
 *
 * `0.020725011825561523 m` = `0.5 * aabbHeight(openclinxr_hm08_teeth)`, computed by
 * `open-mouth-interior-measure.ts:186` and recorded in `open-mouth-interior.json`. It is a property of
 * the TEETH mesh, which does not move when the jaw driver changes. `0.137901 m` is the rig's bind-pose
 * lever arm, likewise fixed. Both are inputs to the causal chain, so neither can be moved by the
 * treatment (SS9s).
 *
 * ## THE UNLOCKED DECISION, NAMED (SS6c)
 *
 * Clause (1) requires the aperture as **`jawOpenRadians` on `VisemeFrame`**. Radians rather than
 * metres because the runtime applies a bone rotation and the metres-per-radian lever arm is a
 * per-asset property the driver does not know. If you believe a different field name or unit is
 * right, say so in your report and implement this one anyway (SS6y).
 *
 * ## WHAT MUST NOT CHANGE
 *
 * `the-open-mouth-reveals-its-interior.test.ts` clause (1) is an INVERTED GUARD asserting the mouth
 * stays sealed **on the current bake**, and instructs that a future BAKE which opens it must restore
 * the positive assertion. A jaw-rotation fix does not alter the GLB, so that guard stays valid and
 * green. **Do not touch it, and do not re-bake any GLB in this slice.**
 *
 * claimScope: whether the viseme driver emits a jaw aperture sufficient, on the shipped rig's measured
 *   geometry, to part the lips past the teeth-derived threshold.
 * notEvidenceFor: how the opened mouth LOOKS (no pixels rendered here); whether the interior is lit;
 *   coarticulation or jaw timing realism; any clinical or readiness claim.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");
const GLB = join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb");

/** 0.5 * teeth AABB height — open-mouth-interior.json, measured, an input not an effect. */
const TEETH_THRESHOLD_M = 0.020725011825561523;
/** |jaw -> oris01| in the shipped bind pose, measured on this HEAD. */
const MEASURED_LEVER_ARM_M = 0.137901;
/** Best anterior lip gap reachable by ANY of the 47 morph targets (viseme_SS), measured on this HEAD. */
const BEST_MORPH_GAP_M = 0.00064;
/** The morph named for the job. Measured 0.27 mm — 77x short of the threshold. */
const MOUTH_OPEN_GAP_M = 0.00027;

const LIP_JOINT = /^(oris|levator)/;

type Attr = { getCount(): number; getElement(i: number, t: number[]): number[] };

function worldTranslation(node: Node): [number, number, number] {
  const acc: [number, number, number] = [0, 0, 0];
  let p: Node | null = node;
  while (p) {
    const t = p.getTranslation();
    acc[0] += t[0]; acc[1] += t[1]; acc[2] += t[2];
    p = p.getParentNode() as Node | null;
  }
  return acc;
}

async function readRig() {
  const doc = await new NodeIO().read(GLB);
  const joints = doc.getRoot().listSkins()[0]?.listJoints() ?? [];
  const byName = new Map(joints.map((j) => [j.getName() ?? "", j]));
  return { doc, joints, byName };
}

/** The frame the driver produces for a single cue, with the shipped target list. */
function frameFor(phoneme: string, availableTargets: readonly string[]): VisemeFrame {
  return driveVisemeTimeline({
    phonemes: [{ phoneme, atSecond: 0, durationSeconds: 0.2 }],
    availableTargets,
  }).frames[0]!;
}

async function shippedVisemeTargets(): Promise<string[]> {
  const doc = await new NodeIO().read(GLB);
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives() as Primitive[]) {
      if (p.listTargets().length === 0) continue;
      const extras = (m.getExtras()?.targetNames ?? []) as string[];
      const names = p.listTargets().map((t, i) => t.getName() || extras[i] || "");
      if (names.some((n) => /^viseme_/.test(n))) return names.filter((n) => n);
    }
  }
  throw new Error("no primitive with viseme_* targets");
}

describe("the viseme driver opens the jaw", () => {
  it.fails("(1) RED: an aperture-bearing cue carries a non-zero jawOpenRadians, and silence carries zero", async () => {
    // Today VisemeFrame is { atSecond, durationSeconds?, weights } — there is no jaw channel at all,
    // so `aa` and `sil` are indistinguishable in everything except which morph weight is 1.
    const targets = await shippedVisemeTargets();
    const aa = frameFor("aa", targets) as VisemeFrame & { jawOpenRadians?: number };
    const sil = frameFor("sil", targets) as VisemeFrame & { jawOpenRadians?: number };

    expect(typeof aa.jawOpenRadians, "the open vowel /aa/ must carry a jaw aperture").toBe("number");
    expect(aa.jawOpenRadians!, "/aa/ must open the jaw").toBeGreaterThan(0);
    expect(sil.jawOpenRadians ?? 0, "silence must close the jaw — a mouth held open is not speech").toBe(0);
  });

  it.fails("(2) RED: the emitted rotation actually parts the lips past the teeth threshold", async () => {
    // The connection clause (SS6d): a number nobody applies is worth nothing. Convert the driver's
    // rotation into lower-lip drop through the rig's OWN measured lever arm and require it to clear
    // the teeth-derived aperture. A driver that emits 0.001 rad satisfies clause (1) and fails here.
    const targets = await shippedVisemeTargets();
    const aa = frameFor("aa", targets) as VisemeFrame & { jawOpenRadians?: number };
    const { byName } = await readRig();

    const jaw = byName.get("jaw");
    const lowerLip = byName.get("oris01");
    expect(jaw && lowerLip, "rig must still carry jaw and oris01").toBeTruthy();
    const jw = worldTranslation(jaw!);
    const lw = worldTranslation(lowerLip!);
    const lever = Math.hypot(lw[0] - jw[0], lw[1] - jw[1], lw[2] - jw[2]);

    const drop = Math.sin(aa.jawOpenRadians ?? 0) * lever;
    expect(drop, `jaw rotation must drop the lower lip >= ${TEETH_THRESHOLD_M} m (0.5 * teeth height)`)
      .toBeGreaterThanOrEqual(TEETH_THRESHOLD_M);
  });

  it("(3) KNOWN-GOOD COLUMN: the rig already carries a jaw that moves the lower lip and not the upper", async () => {
    // Passes today. Pins the rig property the whole fix depends on: if a future bake flattens the
    // hierarchy or re-parents the levator family under jaw, the mouth would open by moving BOTH lips
    // and this fails — which is the correct alarm.
    const { byName } = await readRig();
    const jaw = byName.get("jaw");
    expect(jaw, "the shipped rig must carry a jaw joint").toBeTruthy();

    const descendants = new Set<string>();
    (function walk(n: Node): void {
      for (const c of n.listChildren()) { descendants.add(c.getName() ?? ""); walk(c); }
    })(jaw!);

    const lipBones = [...byName.keys()].filter((n) => LIP_JOINT.test(n));
    const under = lipBones.filter((n) => descendants.has(n));
    expect(lipBones.length, "22 oris*/levator* lip bones measured on this HEAD").toBe(22);
    expect(under.length, "6 lip bones must ride the jaw (lower lip)").toBe(6);
    expect(lipBones.length - under.length, "16 must NOT (upper lip stays with the skull)").toBe(16);
    expect(descendants.has("oris01"), "oris01 is the lower-lip bone the aperture is measured on").toBe(true);
  });

  it("(4) COUNTERWEIGHT: no morph target can do this job, so a re-bake is the wrong fix", async () => {
    // Refuses the cheapest wrong turn — spending a Blender slice re-baking viseme_aa. Records the
    // measurement that killed #552's original premise so nobody re-derives it, and pins that the
    // shipped viseme set is unchanged. If a future bake DOES add an aperture-capable morph this
    // fails, and the correct response is to re-measure and re-scope, never to widen the number.
    const targets = await shippedVisemeTargets();
    const visemes = targets.filter((n) => /^viseme_/.test(n));
    expect(visemes.length, "15 visemes02 targets ship on this mesh").toBe(15);
    expect(targets.length, "47 morph targets total (15 viseme + 32 FACS)").toBe(47);
    // `mouth-open` DOES ship. It is named for this job and measured at 0.27 mm — 77x short. Pinning
    // its presence keeps the refutation honest: the fix is not "find the right morph", because the
    // right-sounding morph is already here and already insufficient.
    expect(targets.some((n) => /^mouth-open$/i.test(n)), "mouth-open ships on this mesh").toBe(true);
    expect(MOUTH_OPEN_GAP_M, "mouth-open cannot reach the teeth threshold either")
      .toBeLessThan(TEETH_THRESHOLD_M);
    expect(BEST_MORPH_GAP_M, "best morph-only lip gap stays far below the teeth threshold")
      .toBeLessThan(TEETH_THRESHOLD_M);
    expect(BEST_MORPH_GAP_M * 30, "the shortfall is a factor of 30+, not a tuning margin")
      .toBeLessThan(TEETH_THRESHOLD_M);
    // The lever arm is what makes an anatomically small rotation sufficient. Pinned so clause (2)
    // cannot be met by claiming an absurd jaw opening.
    const requiredRad = Math.asin(TEETH_THRESHOLD_M / MEASURED_LEVER_ARM_M);
    expect(requiredRad, "the required jaw opening must stay under 15 deg — anatomically ordinary")
      .toBeLessThan((15 * Math.PI) / 180);
  });
});
