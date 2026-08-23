import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **OBSERVABLE: the MPFB→standard bone map names one source per target, and finishes the joint
 * families it starts.** #547's sibling contract is 5/5 green while all three defects below stand,
 * because it checks the KEY side (symmetry, growth, no phantom keys) and never the TARGET side or
 * family completeness. That is §11s: it bounds a QUANTITY, the defect lives in the SHAPE.
 *
 * ## MEASURED ON HEAD — do not re-derive
 *
 * `mpfb2-default-no-toes.json`: 34 keys against a 137-joint subject (`mpfb-ob-patient-aisha.glb`,
 * skins[0].joints).
 *
 * **(a) TWO TARGET COLLISIONS.** Two source joints drive one target, on both sides:
 *     shoulder.L <- [clavicle.L, shoulder01.L]
 *     shoulder.R <- [clavicle.R, shoulder01.R]
 * A retarget cannot honour both; one silently wins and which one is undefined by the map.
 *
 * **(b) THE LIMB TWIST FAMILY IS 3 OF 4.** upperarm02.L/R, lowerarm02.L/R and upperleg02.L/R are all
 * mapped to `*_twist`; `lowerleg02.L/R` exist on the subject and are NOT mapped. **This is the
 * known-good column (§9h): three quarters of the family establish the pattern, so the fourth is an
 * outlier rather than a judgement call.** Note the `*02` suffix ALSO appears on face-muscle helpers
 * (levator02, oculi02, risorius02, temporalis02) which are correctly unmapped — a naive `/02\.[LR]$/`
 * sweep reports 10 "missing" and 8 of them are wrong. The family is LIMB twists, not the suffix.
 *
 * **(c) THE FINGER FAMILY IS 2 OF 5.** finger1-1 (thumb) and finger2-1 (index) map to
 * `f_thumb.01` / `f_index.01`; finger3-1, finger4-1, finger5-1 exist on both hands and are unmapped.
 *
 * ## NOT A DEFECT, and the contract must not treat it as one
 *
 * 103 of 137 joints are unmapped and that is CORRECT — MPFB carries face-muscle, breast, metacarpal
 * and secondary-spine joints with no standard-rig counterpart. **Coverage is not the metric.** A
 * contract that drives the mapped count toward 137 would be the cheap green this refuses.
 *
 * ## UNLOCKED
 *
 * The target names for the three missing fingers and for `lowerleg02` (the existing entries follow
 * Rigify-style `f_thumb.01.L` / `shin.L`, but I am not deciding it); which of `clavicle` or
 * `shoulder01` owns `shoulder.*`, and what the other becomes.
 *
 * ## WITHDRAWN BEFORE DISPATCH (#546) — clauses (2) and (3) as first planted were WRONG
 *
 * The planted diagnosis above is left intact; this corrects it. I measured the SOURCE CLIP that the
 * only consumer (`motion-bind-cli.ts` / `motion_bind_stage.py`) actually retargets —
 * `anny/proof-animations/diag/cmu_07_01_walk.bvh`, 31 joints:
 *
 *     Twist channels: 0.  Clavicle channels: 0.  Shoulder: 2 (LeftShoulder/RightShoulder).
 *     Fingers: LeftFingerBase, LeftHandIndex1, LThumb only — no middle, ring or pinky.
 *
 * And `mpfb-bone-map-coverage.json` (#547): 34 keys, bonesDriven 26, unbound 8, and **every unbound
 * key is declared `optional`** — `unbound - optional` is empty. Six optional keys DID bind
 * (finger1-1, finger2-1, toe1-1 both sides) because the clip carries exactly those channels.
 *
 * So the map is HONEST and near-complete FOR THIS CLIP. Completing the twist family or adding
 * fingers 3-5 would add keys the source cannot drive: bonesDriven would stay 26 while the key count
 * rose — which is precisely the coverage-chasing clause (4) exists to refuse. **My own clauses (2)
 * and (3) mandated the cheap green my own clause (4) forbids.** They are replaced below by guards on
 * the property that is actually true and worth protecting.
 *
 * WHAT SURVIVES: the target collision is real, and the clip explains it — `Clavicle: 0` means
 * `clavicle.*` wins `shoulder.*` and `shoulder01.*` binds nothing. That is one defect, not three.
 *
 * claimScope: internal consistency of the map against the shipped 137-joint subject.
 * notEvidenceFor: whether any clip retargets correctly; motion quality; #546's mixamo_unity question.
 *
 * ## FIXED (#585)
 *
 * Clause (1) collision cleared without deleting keys. Decision: `clavicle.L/R` keep
 * `shoulder.L/R` (clip drives those sources; mhx2/mesh2motion same); `shoulder01.L/R` retarget to
 * `unused.L/R` (retarget_bvh canonical sentinel — smpl.json consumes it; no free distinct shoulder
 * DOF left). `shoulder01.*` stay in `optional`. Clause (4) CONTROL_KEYS raised 34→60 (map-may-only-
 * grow floor = current key count at the guard, not a historical constant).
 */

const RIG = "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json";
const SUBJECT = "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb";
const COVERAGE = "tools/openclinxr/evidence/mpfb-bone-map-coverage.json";

/** Current map key count — floor against deletion (map may only grow). Raised 34→60 in #585. */
const CONTROL_KEYS = 60;
/** The limb twist family, by NAME not by suffix — face helpers share the `02` suffix. */
const LIMB_TWISTS = ["upperarm02", "lowerarm02", "upperleg02", "lowerleg02"] as const;
const FINGERS = [1, 2, 3, 4, 5] as const;

const bones = (): Record<string, string> => JSON.parse(readFileSync(RIG, "utf8")).bones as Record<string, string>;

async function subjectJoints(): Promise<string[]> {
  const { NodeIO } = await import("@gltf-transform/core");
  const doc = await new NodeIO().read(SUBJECT);
  const skin = doc.getRoot().listSkins()[0];
  expect(skin, "the subject must carry a skin").toBeTruthy();
  return skin!.listJoints().map((j) => j.getName());
}

describe("the bone map is unambiguous and complete by family", () => {
  it("(1) RED: no target is claimed by two source joints", () => {
    const inv = new Map<string, string[]>();
    for (const [src, tgt] of Object.entries(bones())) inv.set(tgt, [...(inv.get(tgt) ?? []), src]);
    const collisions = [...inv].filter(([, s]) => s.length > 1).map(([t, s]) => `${t} <- [${s.join(", ")}]`);
    expect(collisions, "targets driven by more than one source joint — a retarget cannot honour both").toEqual([]);
  });

  it("(2) NET: every key that binds nothing is declared optional — the map states its own limits", async () => {
    // Was a RED demanding lowerleg02. WITHDRAWN: the source clip has zero twist channels, so the
    // whole twist family is inert and a fourth member would be a dead key. What matters instead is
    // that the map never hides a non-binding key. Measured today: unbound 8, all 8 in `optional`.
    const rig = JSON.parse(readFileSync(RIG, "utf8")) as { bones: Record<string, string>; optional?: string[] };
    const cov = JSON.parse(readFileSync(COVERAGE, "utf8")) as { unbound?: string[]; bonesDriven?: number };
    const optional = new Set(rig.optional ?? []);
    const undeclared = (cov.unbound ?? []).filter((k) => !optional.has(k));
    expect(undeclared, "keys that bind nothing and are not declared optional — the map must state its limits")
      .toEqual([]);
  });

  it("(3) NET: growth must be earned — a new key binds, or is declared optional", async () => {
    // Was a RED demanding fingers 3-5. WITHDRAWN: the clip carries only FingerBase/Index/Thumb, so
    // middle/ring/pinky have no source. This guards the property that survives: the map may grow,
    // but every key beyond the landed control must either bind or be declared a known limitation.
    const rig = JSON.parse(readFileSync(RIG, "utf8")) as { bones: Record<string, string>; optional?: string[] };
    const cov = JSON.parse(readFileSync(COVERAGE, "utf8")) as { unbound?: string[]; bonesDriven?: number };
    const optional = new Set(rig.optional ?? []);
    const unbound = new Set(cov.unbound ?? []);
    const silentlyDead = Object.keys(rig.bones).filter((k) => unbound.has(k) && !optional.has(k));
    expect(silentlyDead, "keys added that neither bind nor are declared optional").toEqual([]);
    expect(cov.bonesDriven, "the coverage report must record what actually bound").toBeTypeOf("number");
  });

  it("(4) COUNTERWEIGHT: fixing a collision must not delete a key, and coverage is not the metric", async () => {
    const m = bones();
    const joints = new Set(await subjectJoints());
    // Refuses the cheap green on (1): dropping clavicle.* or shoulder01.* removes the ambiguity by
    // removing a joint. The map may only GROW.
    expect(Object.keys(m).length, `map keys vs the ${CONTROL_KEYS} landed control — do not delete to disambiguate`)
      .toBeGreaterThanOrEqual(CONTROL_KEYS);
    for (const k of ["clavicle.L", "clavicle.R", "shoulder01.L", "shoulder01.R"]) {
      expect(k in m, `${k} must still be mapped — disambiguate by retargeting it, not by deleting it`).toBe(true);
    }
    // Refuses the opposite cheap green: mapping everything to raise coverage. Face-muscle, breast and
    // metacarpal joints have no standard-rig counterpart and must stay unmapped.
    const forbidden = [...joints].filter((j) => /^(levator|oculi|risorius|temporalis|orbicularis|breast|metacarpal)/.test(j));
    expect(forbidden.length, "the subject must still carry the no-counterpart joints this guards").toBeGreaterThan(0);
    const overmapped = forbidden.filter((j) => j in m);
    expect(overmapped, "joints with no standard-rig counterpart must NOT be mapped — coverage is not the metric")
      .toEqual([]);
  });
});
