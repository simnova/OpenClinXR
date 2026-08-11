import { Bone, Group } from "three";
import { describe, expect, it } from "vitest";

/**
 * "Gaze" rotates the actor's whole body. The eye bones exist on every rail, are skinned, and nothing
 * drives them.
 *
 * MEASURED 2026-08-11:
 *
 *   main.ts:8170-8173
 *     const gaze = generatedDriveScalar(drive.gazeAversion ?? drive.gaze);
 *     if (gaze !== null) {
 *       slot.root.rotation.y = gaze * 0.7;      // <- the ACTOR ROOT. the entire figure turns.
 *     }
 *
 * A grep for `eyeL` / `eyeR` / `eye.L` / `eye.R` / `LeftEye` / `RightEye` across `apps/ui-xr/src` and
 * `packages/openclinxr/*​/src` returns **zero** non-test hits. No runtime code addresses an eye bone.
 *
 * The bones are there and they are skinned — measured from the shipped GLBs:
 *
 *   rail                          | joints | eyeL / eyeR weight mass | eye-dominant verts
 *   ------------------------------|--------|-------------------------|-------------------
 *   mpfb2 ob-patient-aisha        |   137  |     0.436% / 0.478%     |        197
 *   peds_anxious_parent (Anny)    |    23  |     2.037% / 0.514%     |          0
 *   body-param-adult_lean_female  |    23  |     3.456% / 3.456%     |      4,446
 *
 * WHY THIS LOOKED HANDLED. `anny-candidate-preflight.ts:473` supplies the gaze evidence field as
 *
 *     gazeEyeNodesPresent: nodeNames.some((name) => /eye|gaze/i.test(name))
 *
 * — a NAME REGEX asserting a node exists, and `anny-candidate-preflight.test.ts:95` asserts it is true.
 * Presence is not drive (§7k: a name match tells you what something is called). MADR 0052's 08:00 tick
 * asks for eyes "confirmed live, not merely present in the file", and this is exactly the gap it names.
 *
 * WHAT A LEARNER SEES TODAY: an actor asked to look away pivots its entire body on Y, feet included,
 * rather than moving its eyes or head.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                                  | (1) eyes rotate | (2) root untouched | result
 *   -------------------------------------------|-----------------|--------------------|--------
 *   a) today — no applyGazeToHumanoid at all    |      FAIL       |        FAIL        | REFUSED
 *   b) today's behaviour (root.rotation.y only) |      FAIL       |      **FAIL**      | REFUSED
 *   c) rotate the root AND the eyes             |      pass       |      **FAIL**      | REFUSED
 *   d) rotate the eye bones only                |      pass       |        pass        | ALL PASS
 *
 * (c) is the tempting one: keeping the body spin and adding eye rotation on top satisfies "the eyes
 * move" while leaving the defect a learner actually sees. (2) is what refuses it.
 *
 * SCOPE (D4). This contract is a pure scene-graph unit test on a synthetic skeleton — no renderer, no
 * booted scene, no GLB read. It asserts WHICH NODES a gaze drive rotates, nothing about how far or how
 * plausibly. Head rotation is deliberately NOT asserted either way: a real gaze usually combines eye
 * and head motion, and this contract does not prejudge that split — it only refuses rotating the ROOT.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today — there is no
 * `applyGazeToHumanoid` at all. (3) PASSES today and is the fixture check: it proves the skeleton this
 * test builds really does expose `eyeL`/`eyeR`, so a red on (1) means the function is missing rather
 * than the fixture being wrong.
 *
 * NOT TESTED: nothing rendered, no GLB loaded, no learner-visible capture. Whether the resulting eye
 * rotation LOOKS like a person looking somewhere is a pixel grade this cannot make. Whether `head`
 * should also rotate is left open. The three rails' eye weighting anomalies — Anny's 4x asymmetry and
 * zero eye-dominant vertices, the library body's 4,446 — are recorded on #296 and are not this
 * contract's business.
 */

/** three.js `PropertyBinding.sanitizeNodeName` strips dots at load, so the scene graph sees `eyeL`. */
const EYE_BONE_NAMES = ["eyeL", "eyeR"] as const;

/** A minimal actor slot root: root → hips → spine → head → eyes, as the loaded graph names them. */
function buildActorSkeleton(): { root: Group; bones: Map<string, Bone> } {
  const root = new Group();
  root.name = "actor_root";
  const bones = new Map<string, Bone>();
  const chain = ["hips", "spine", "neck", "head"];
  let parent: Group | Bone = root;
  for (const name of chain) {
    const bone = new Bone();
    bone.name = name;
    parent.add(bone);
    bones.set(name, bone);
    parent = bone;
  }
  for (const name of EYE_BONE_NAMES) {
    const eye = new Bone();
    eye.name = name;
    parent.add(eye);
    bones.set(name, eye);
  }
  return { root, bones };
}

/**
 * The deliverable. Absent today, so (1) and (2) are red. Expected in `apps/ui-xr/src` exporting
 * `applyGazeToHumanoid(root: Object3D, gaze: number): void` — resolve the eye bones on whatever rig
 * the root carries and rotate them; do not touch the root's own rotation.
 */
async function loadGazeApplier(): Promise<((root: Group, gaze: number) => void) | null> {
  // Non-literal specifier on purpose: the module does not exist yet, and a literal import path
  // would fail `tsgo --noEmit` (TS2307) and leave the package typecheck red the way a planted
  // contract of mine did in #93. Resolution is deliberately a runtime concern here.
  const specifier = "./gaze-drives-eyes.js";
  const mod = (await import(/* @vite-ignore */ specifier).catch(() => null)) as
    | { applyGazeToHumanoid?: unknown }
    | null;
  return typeof mod?.applyGazeToHumanoid === "function"
    ? (mod.applyGazeToHumanoid as (root: Group, gaze: number) => void)
    : null;
}

const GAZE = 0.6;

describe("a gaze drive moves the eyes, not the whole actor", () => {
  it.fails("(1) RED: applying gaze rotates both eye bones", async () => {
    const applyGazeToHumanoid = await loadGazeApplier();
    expect(applyGazeToHumanoid, "apps/ui-xr/src must export applyGazeToHumanoid").not.toBeNull();

    const { root, bones } = buildActorSkeleton();
    applyGazeToHumanoid!(root, GAZE);

    const unmoved = EYE_BONE_NAMES.filter((name) => {
      const b = bones.get(name)!;
      return b.rotation.x === 0 && b.rotation.y === 0 && b.rotation.z === 0;
    });
    expect(unmoved, "eye bones left unrotated by a nonzero gaze").toEqual([]);
  });

  it.fails(
    "(2) RED COUNTERWEIGHT: applying gaze leaves the actor ROOT unrotated — spinning the body and adding eyes on top is refused",
    async () => {
      const applyGazeToHumanoid = await loadGazeApplier();
      expect(applyGazeToHumanoid, "apps/ui-xr/src must export applyGazeToHumanoid").not.toBeNull();

      const { root } = buildActorSkeleton();
      applyGazeToHumanoid!(root, GAZE);

      expect(
        [root.rotation.x, root.rotation.y, root.rotation.z],
        `actor root was rotated by a gaze drive (y=${root.rotation.y})`,
      ).toEqual([0, 0, 0]);
    },
  );

  it("(3) NET fixture check: the synthetic skeleton really exposes the eye bones a fix must find", () => {
    const { root, bones } = buildActorSkeleton();
    for (const name of EYE_BONE_NAMES) {
      expect(bones.has(name), `fixture bone ${name}`).toBe(true);
    }
    const found: string[] = [];
    root.traverse((o) => {
      if ((EYE_BONE_NAMES as readonly string[]).includes(o.name)) found.push(o.name);
    });
    expect(found.sort(), "eye bones reachable by traverse from the root").toEqual(["eyeL", "eyeR"]);
    expect(root.rotation.y, "fixture root starts unrotated").toBe(0);
  });
});
