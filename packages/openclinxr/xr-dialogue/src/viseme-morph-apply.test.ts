import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#62) — the runtime drives morph index 0, not the phoneme's viseme.
 *
 * MEASURED in `main.ts:8496-8502`:
 *
 *     object.morphTargetInfluences[0] = Math.min(0.95, Math.max(0, weight));
 *
 * Index zero. No name resolution, no `morphTargetDictionary` lookup. On a mesh carrying 26 shape
 * keys — 9 of them viseme-named — every phoneme drives whichever target happens to sit at index 0.
 * The mouth can only ever reach one shape.
 *
 * The other runtime path (`applyHumanoidMorphTargetCue`, ~`:9168`) drives project-specific
 * `openclinxr_*` targets (mouth open, brow, cheek), not the GLB's `viseme_*` set. So #45's
 * `driveVisemeTimeline` — which resolves phonemes to real viseme target NAMES — has nothing
 * downstream that can apply its output. It landed correct and unconnected.
 *
 * That also explains why the existing capture gate is weak: `morphTargetAppliedTargetCount > 0`
 * (`ui-xr-peds-school-age-mouth-gaze-capture.ts:51-54`) is satisfied by the mouth-open target alone,
 * so it has been green this whole time while no viseme was ever applied.
 *
 * THE TWO CONTRACTS PULL APART.
 *
 * The first requires weights to land on indices resolved BY NAME from `morphTargetDictionary`.
 * The second requires index 0 to be left alone unless it IS the named target — which is what kills
 * the current implementation. Writing index 0 always fails the second; writing nothing fails the
 * first. Passing both means a real name lookup.
 *
 * SCOPE: this is the mouth, and only the mouth. It says nothing about whether the motion reads as
 * speech, and nothing about body proportions — the school-age patient assets still fail bind-pose
 * checks per the #58 scope map. A capture from this slice is evidence about morph application,
 * `notEvidenceFor` anatomy.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `applyVisemeWeights(target, weights)` where
 * `target` carries `morphTargetDictionary` and `morphTargetInfluences` — the three.js shape. Change
 * the call sites and say why if a different shape is better. What must not change: resolution is by
 * name, and index 0 is not privileged.
 */

const load = async () => import("./viseme-morph-apply.js") as Promise<Record<string, unknown>>;

type MorphTarget = {
  morphTargetDictionary: Record<string, number>;
  morphTargetInfluences: number[];
};
type Apply = (target: MorphTarget, weights: Record<string, number>) => void;

/** Mirrors a shipped GLB: viseme_silence is NOT at index 0, so index-0 writes are detectable. */
function meshLike(): MorphTarget {
  return {
    morphTargetDictionary: {
      basis_neutral: 0,
      viseme_silence: 1,
      viseme_AA: 2,
      viseme_E: 3,
      viseme_OU: 4,
    },
    morphTargetInfluences: [0, 0, 0, 0, 0],
  };
}

describe("viseme weights are applied by name, not by index (#62)", () => {
  it("writes each weight to the index its name maps to", async () => {
    const mod = await load();
    const apply = mod["applyVisemeWeights"] as Apply | undefined;
    expect(apply).toBeTypeOf("function");

    const target = meshLike();
    apply!(target, { viseme_AA: 0.9, viseme_OU: 0.4 });

    expect(target.morphTargetInfluences[2]).toBeCloseTo(0.9);
    expect(target.morphTargetInfluences[4]).toBeCloseTo(0.4);
  });

  it("leaves index 0 untouched when it is not the named target", async () => {
    // This is the one that kills main.ts:8496 — it writes influences[0] unconditionally, so every
    // phoneme lands on whatever sits at index 0 regardless of which viseme was requested.
    const mod = await load();
    const apply = mod["applyVisemeWeights"] as Apply | undefined;
    expect(apply).toBeTypeOf("function");

    const target = meshLike();
    apply!(target, { viseme_AA: 0.9 });

    expect(target.morphTargetInfluences[0]).toBe(0);
  });

  it("caps FACS mouth-open at 0.3 — direct name and the viseme_AA alias (#460)", async () => {
    // #460: the shipped parent carries no viseme_AA, so the runtime's AA maps onto mouth-open.
    // The sweep graded 0.3 ACCEPTABLE, 0.6 DEGRADING, 1.0 UNACCEPTABLE; the cap applies on the
    // RESOLVED name, so both entry paths land at the cap, and other targets keep full range.
    const mod = await load();
    const apply = mod["applyVisemeWeights"] as Apply | undefined;
    expect(apply).toBeTypeOf("function");

    const direct = {
      morphTargetDictionary: { "mouth-open": 0, "mouth-eversion": 1 },
      morphTargetInfluences: [0, 0],
    };
    apply!(direct, { "mouth-open": 1 });
    expect(direct.morphTargetInfluences[0]).toBe(0.3);
    expect(direct.morphTargetInfluences[1]).toBe(0);

    // Alias rail: viseme_AA resolves to mouth-open on an MPFB FACS-only body.
    const viaAlias = {
      morphTargetDictionary: { "mouth-open": 0, "mouth-eversion": 1 },
      morphTargetInfluences: [0, 0],
    };
    apply!(viaAlias, { viseme_AA: 1 });
    expect(viaAlias.morphTargetInfluences[0]).toBe(0.3);

    // Counterweight: only the swept target is capped.
    const other = {
      morphTargetDictionary: { "mouth-open": 0, "mouth-eversion": 1 },
      morphTargetInfluences: [0, 0],
    };
    apply!(other, { "mouth-eversion": 1 });
    expect(other.morphTargetInfluences[1]).toBe(1);
  });
});
