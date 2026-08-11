import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * The one MPFB2-rigged actor a learner loads cannot be posed. Every arm, leg, spine, neck and pelvis
 * lookup misses, and a missing bone lookup is a SILENT SKIP — no gate can currently see it.
 *
 * MEASURED 2026-08-11. Runtime pose code addresses bones by name, dot-stripped by three.js
 * `PropertyBinding.sanitizeNodeName` (§6v):
 *
 *   body                                        | joints | landmarks resolved
 *   --------------------------------------------|--------|-------------------
 *   Anny  peds_anxious_parent                    |    23  | 14 / 14
 *   MPFB-topology adult_lean_female (23-bone rig)|    23  | 14 / 14
 *   MPFB2 mpfb-ob-patient-aisha (SHIPPED)        |   137  | **1 / 14** — only `head`
 *
 * Aisha names them `upperarm01/02.L`, `lowerarm01/02.L`, `wrist.L`, `upperleg01/02.L`,
 * `lowerleg01/02.L`, `spine01–05`, `neck01–03`, `pelvis.L/R`, `root`.
 *
 * Consumers that silently no-op on her: `apps/ui-xr/src/main.ts`, `supine-pose.ts`, `seated-pose.ts`,
 * `clinical-idle-posture.ts`, `physics-touch/apply-physics-bone-transforms.ts`.
 *
 * This blocks MADR 0052's P2 cast migration outright: every actor promoted to MPFB arrives unposable.
 * It also blocks gaze and lip-sync — `jaw` and `tongue00–07` are on that rig and unreachable by name.
 *
 * THREE INSTRUMENTS WERE KILLED CHOOSING CONTRACT (2). Do not re-derive them:
 *
 *   1. Dominant-vertex counting says the 23-bone library body's `forearm` carries 0 vertices. Total
 *      weight MASS says 5.99%. It is weighted, just never dominant. The metric is blind.
 *   2. Geometric nearest-neighbour as a mapping validator picks `oris02` (a MOUTH bone) for `head`,
 *      `pelvisL` for `spine`, `upperleg02L` for `pelvis`. Nearest joint is not a semantic match.
 *   3. Cross-rail joint POSITION cannot check correctness at all: against the correct semantic targets
 *      the deltas are systematically positive, +0.055 (upper arm) to +0.195 (wrist) stature, because
 *      the Anny body is A-posed with hands at 0.42 stature while Aisha's wrists sit at 0.615.
 *      **Position conflates RIG with POSE.** A band tight enough to be meaningful — half the minimum
 *      inter-landmark distance on the known-good rail, 0.030 stature — is unpassable by construction.
 *
 * WHY CONTRACT (2) IS HIERARCHY. Ancestry is topological: it is invariant to pose AND to rig scale,
 * so both confounds above vanish. Measured on the correct targets, 6/6 hold on BOTH rails
 * (`upperarm01L > lowerarm01L > wristL`, `spine03 > neck01 > head`, `upperleg01L > lowerleg01L`,
 * `root > upperleg01L`), and 4/4 wrong mappings are rejected — including the exact ones the geometric
 * instrument produced (`head > wristL`, `oris02 > head`, `pelvisL > neck01`, and a reversed arm chain).
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                        | (1) resolve+distinct | (2) hierarchy | (3) no-downgrade
 *   ---------------------------------|----------------------|---------------|-----------------
 *   a) no resolver (today)           |        FAIL          |     FAIL      |      pass
 *   b) `head` for every landmark     |        FAIL          |     FAIL      |      pass
 *   c) geometric nearest-neighbour   |        FAIL          |     FAIL      |      pass
 *   d) re-rig aisha down to 23 bones |         —            |      —        |    **FAIL**
 *   e) honest alias map              |        pass          |     pass      |      pass
 *
 * HONEST NOTE ON (d): the probe cannot actually re-rig the shipped asset, so it was simulated as
 * identity-only resolution and reported FAIL on all three. A GENUINE re-rig would satisfy (1) and (2)
 * — **(3) is the clause that refuses it**, and that is the claim being made here, not that the probe
 * reproduced a re-rig. (3) matters because re-rigging Aisha to the 23-bone armature would buy
 * resolution by discarding the fingers, `jaw`, `tongue`, 5-segment spine and 3-segment neck that D11
 * names MPFB for in the first place.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today — there is no resolver
 * at all. (3) PASSES today and is the known-good column.
 *
 * NOT TESTED: whether a resolved bone, when ROTATED, deforms the mesh plausibly. Ancestry proves the
 * mapping picks the anatomically right joint in the right chain; it does not prove skin weights make
 * that joint useful (the 23-bone rails weight `hand.L/R` at 0.00% mass — see #199). Nothing here is
 * rendered or posed. Nothing here claims the 23-bone rails' own poses are correct.
 *
 * ## FIXED (#306)
 *
 * `packages/openclinxr/asset-registry/src/pose-bone-resolver.ts` now exports
 * `resolvePoseBone(landmark, jointNames)` — identity-first for the canonical 23-bone rails, then an
 * honest alias map for the MPFB2 rig (upper_armL→upperarm01L, forearmL→lowerarm01L, handL→wristL,
 * thighL→upperleg01L, shinL→lowerleg01L, spine→spine03, neck→neck01, head→head, pelvis→root,
 * chest→spine01), all verified against the shipped hierarchy. All 14 landmarks resolve to DISTINCT
 * joints on all three rails and the 10 ancestry pairs hold (measured by this test after the flip).
 *
 * Wired into the six runtime pose consumers so Aisha is posed instead of silently skipped:
 * `clinical-idle-posture.ts` (hang maps + `applyHumanoidJointRotationsByAlias`, which covers the
 * `main.ts` role maps), `supine-pose.ts` (euler map + neck tagging), `seated-pose.ts` (euler map +
 * pelvis read), `hob-extremity-flex.ts` (`findSupineBone`), and
 * `physics-touch/apply-physics-bone-transforms.ts` (artifact bone map). The `it.fails` markers on
 * (1) and (2) were flipped to `it`; all three contracts pass.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/** The bone names `apps/ui-xr/src` pose code addresses, three.js-sanitised (dots stripped). */
const POSE_LANDMARKS = [
  "upper_armL", "upper_armR", "forearmL", "forearmR", "handL", "handR",
  "thighL", "thighR", "shinL", "shinR", "spine", "neck", "head", "pelvis",
] as const;

/** Anatomical ancestry every rig must satisfy. Topological — invariant to pose and rig scale. */
const ANCESTRY: ReadonlyArray<readonly [string, string]> = [
  ["upper_armL", "forearmL"], ["forearmL", "handL"],
  ["upper_armR", "forearmR"], ["forearmR", "handR"],
  ["thighL", "shinL"], ["thighR", "shinR"],
  ["spine", "neck"], ["neck", "head"],
  ["pelvis", "thighL"], ["pelvis", "thighR"],
];

/** What the MPFB2 rig must still carry — D11 names MPFB for exactly these. */
const MPFB_MUST_KEEP = ["wristL", "lowerarm02L", "jaw", "finger1-3L", "spine05", "neck03"] as const;

const RAILS = [
  { id: "anny_parent", glb: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb" },
  {
    id: "library_lean_female",
    glb: "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
  },
  { id: "mpfb2_aisha", glb: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb" },
] as const;

const sanitise = (n: string): string => n.replaceAll(".", "");

type Rig = { id: string; names: Set<string>; isAncestor: (a: string, b: string) => boolean };

const io = new NodeIO();

async function readRig(id: string, rel: string): Promise<Rig> {
  const doc = await io.read(`${REPO_ROOT}/${rel}`);
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) throw new Error(`${id}: no skin`);
  const joints = skin.listJoints();
  const parent = new Map<string, string | null>();
  for (const j of joints) {
    for (const c of j.listChildren()) parent.set(sanitise(c.getName()), sanitise(j.getName()));
  }
  for (const j of joints) if (!parent.has(sanitise(j.getName()))) parent.set(sanitise(j.getName()), null);
  return {
    id,
    names: new Set(joints.map((j) => sanitise(j.getName()))),
    isAncestor: (a, b) => {
      let cur = parent.get(b) ?? null;
      for (let hops = 0; cur && hops < 80; hops += 1) {
        if (cur === a) return true;
        cur = parent.get(cur) ?? null;
      }
      return false;
    },
  };
}

/**
 * The deliverable. Absent today, so (1) and (2) are red. Expected at
 * `packages/openclinxr/asset-registry/src/pose-bone-resolver.ts`, exporting
 * `resolvePoseBone(landmark: string, jointNames: ReadonlySet<string>): string | null`.
 */
async function loadResolver(): Promise<
  ((landmark: string, jointNames: ReadonlySet<string>) => string | null) | null
> {
  const mod = (await import(
    `${REPO_ROOT}/packages/openclinxr/asset-registry/src/pose-bone-resolver.ts`
  ).catch(() => null)) as { resolvePoseBone?: unknown } | null;
  return typeof mod?.resolvePoseBone === "function"
    ? (mod.resolvePoseBone as (l: string, j: ReadonlySet<string>) => string | null)
    : null;
}

const rigs = await Promise.all(RAILS.map((r) => readRig(r.id, r.glb)));

describe("every runtime pose landmark resolves on every shipped humanoid rail", () => {
  it(
    "(1) RED: each of the 14 landmarks resolves to a DISTINCT joint that exists on that rig",
    async () => {
      const resolvePoseBone = await loadResolver();
      expect(resolvePoseBone, "pose-bone-resolver.ts must export resolvePoseBone").not.toBeNull();
      for (const rig of rigs) {
        const got = POSE_LANDMARKS.map((l) => resolvePoseBone!(l, rig.names));
        const unresolved = POSE_LANDMARKS.filter((_, i) => !got[i]);
        expect(unresolved, `${rig.id}: unresolved landmarks`).toEqual([]);
        const absent = got.filter((g) => g && !rig.names.has(g));
        expect(absent, `${rig.id}: resolved to joints that do not exist`).toEqual([]);
        expect(new Set(got).size, `${rig.id}: resolved names must be distinct`).toBe(
          POSE_LANDMARKS.length,
        );
      }
    },
  );

  it(
    "(2) RED COUNTERWEIGHT: resolved bones satisfy anatomical ancestry — pose-free and rig-free, so nearest-joint and head-for-everything are rejected",
    async () => {
      const resolvePoseBone = await loadResolver();
      expect(resolvePoseBone, "pose-bone-resolver.ts must export resolvePoseBone").not.toBeNull();
      const broken: string[] = [];
      for (const rig of rigs) {
        for (const [ancestor, descendant] of ANCESTRY) {
          const a = resolvePoseBone!(ancestor, rig.names);
          const d = resolvePoseBone!(descendant, rig.names);
          if (!a || !d || !rig.isAncestor(a, d)) {
            broken.push(`${rig.id}: ${ancestor}(${a}) is not an ancestor of ${descendant}(${d})`);
          }
        }
      }
      expect(broken, "ancestry violations").toEqual([]);
    },
  );

  it("(3) NET known-good: the MPFB2 rig keeps the chain D11 names it for — a fix must not re-rig it down", async () => {
    const aisha = rigs.find((r) => r.id === "mpfb2_aisha")!;
    const missing = MPFB_MUST_KEEP.filter((b) => !aisha.names.has(b));
    expect(missing, "MPFB2 distal/facial chain lost").toEqual([]);
    expect(aisha.names.size, "MPFB2 joint count").toBeGreaterThanOrEqual(100);

    // issue-307: the two library rails now ride the MPFB mixamo_unity rig (64 bones +
    // shipped CC0 weights) instead of the AABB 23-bone armature, so they carry
    // `mixamorig:` names — the 14 landmarks resolve through the alias map (asserted by
    // (1) and (2)). The net for the library rails is that the chain a learner's pose
    // code addresses AND the finger chain that #307 exists to give them are present.
    const MIXAMORIG_MUST_KEEP = [
      "mixamorig:Hips",
      "mixamorig:Spine1",
      "mixamorig:Spine2",
      "mixamorig:Neck",
      "mixamorig:Head",
      "mixamorig:LeftShoulder",
      "mixamorig:LeftArm",
      "mixamorig:LeftForeArm",
      "mixamorig:LeftHand",
      "mixamorig:LeftUpLeg",
      "mixamorig:LeftLeg",
      "mixamorig:LeftHandIndex1",
      "mixamorig:LeftHandThumb1",
    ];
    for (const rig of rigs.filter((r) => r.id !== "mpfb2_aisha")) {
      const lost = MIXAMORIG_MUST_KEEP.filter((b) => !rig.names.has(b));
      expect(lost, `${rig.id}: mixamo_unity chain/fingers lost`).toEqual([]);
    }
  });
});
