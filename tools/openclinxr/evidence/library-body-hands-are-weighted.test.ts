import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * The library bodies a learner loads have hands that cannot move. Their whole arm — shoulder to
 * fingertip — collapses onto ONE bone.
 *
 * MEASURED 2026-08-11, total weight MASS per bone (not dominant-vertex counts, which are blind here
 * — see #306's header):
 *
 *   body                     | hand/wrist | fingers | arm collapse
 *   -------------------------|------------|---------|-------------------------------------------
 *   library adult_lean_female|   0.00%    |  0.00%  | 20,216 vertices dominant on `upper_armL`
 *   mpfb2 ob-patient-aisha   | 0.52–0.65% |  weighted | upperarm/lowerarm/wrist/fingers all carry
 *
 * `hand.L/R` exist in the 23-bone armature and **no vertex references them**. The fingers are present
 * in the mesh (#295's structure pass shows well-formed fingers and thumbs) — they simply have nothing
 * to move them.
 *
 * CAUSE, located: `body_param_stage.py:684-713` (`bind_meshes_to_canonical_armature`) builds an
 * **AABB-driven 23-bone armature** via `hm08_rig_carry_stage.create_canonical_armature`, then binds
 * with Blender `ARMATURE_AUTO` heuristic weights. A bounding-box skeleton has no finger chain, and
 * auto-weights put the whole limb on the nearest bone.
 *
 * THE D1 VIOLATION, and the fix. MPFB **ships both halves** and neither is being used:
 *
 *   ~/Library/.../mpfb/data/rigs/standard/rig.mixamo_unity.json      64 bones
 *   ~/Library/.../mpfb/data/rigs/standard/weights.mixamo_unity.json  3.3 MB, 64 bone groups,
 *                                                                    `mixamorig:LeftHand` = 592
 *                                                                    vertex entries, full finger chains
 *                                                                    **license: CC0**
 *
 * Seven rigs ship with seven matching weight maps. This is "wire the proven tool, never hand-author"
 * (D1) with the tool sitting on disk. MADR 0052 already decided `mixamo_unity` — a strict superset of
 * `mixamo` (64 vs 52 bones, nothing dropped), adding jaw, eyes, orbicularis and root.
 *
 * TRAP, and it bit me while measuring this: the rig JSONs use TWO schemas. `rig.mixamo.json` and
 * `rig.openpose.json` are WRAPPED (`{bones:{…}}`); the other six are FLAT. Unwrap with
 * `d.get("bones", d)` — a naive `d["bones"]` reports 4 bones for mixamo, and my own first read
 * reported 0 for `mixamo_unity`. Verified counts: mixamo 52, mixamo_unity 64, default 163.
 *
 * WHY CONTRACT (2) IS WITHIN-BODY ORDERING. #306 established that CROSS-rail joint position conflates
 * rig with pose and cannot validate anything. Distance ordering measured WITHIN one body has no such
 * confound: however the arm is posed, the hand centroid is farther from the clavicle than the forearm
 * centroid, which is farther than the upper arm's. Measured:
 *
 *   library_lean_female  upper 0.439 m (n=20216)  fore NONE   hand NONE   -> not monotonic
 *   mpfb2_aisha          upper 0.218 m (n=494)    fore 0.428  hand 0.609  -> MONOTONIC
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                          | (1) hand weighted | (2) distal ordering | result
 *   -----------------------------------|-------------------|---------------------|--------
 *   a) today (library, measured)       |       FAIL        |        FAIL         | REFUSED
 *   b) paint the whole arm onto handL  |       pass        |      **FAIL**       | REFUSED
 *   c) add finger bones, zero weight   |     **FAIL**      |        FAIL         | REFUSED
 *   d) MPFB rig + shipped CC0 weights  |       pass        |        pass         | ALL PASS
 *
 * (b) is the one that matters: satisfying "hands are weighted" by dumping the whole limb onto the hand
 * bone passes a naive mass check and is caught by the ordering clause.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs — they fail on the two library bodies
 * today. (3) PASSES today and is the known-good column: `mpfb2_aisha` already satisfies both, so a fix
 * must not regress the rail that already works.
 *
 * NOT TESTED: nothing here rotates a bone or renders anything. Weight mass and centroid ordering say a
 * hand bone OWNS hand vertices in the right place; they do not say the resulting deformation looks
 * right. Nothing here claims the shipped CC0 weights are anatomically ideal, only that they exist,
 * cover the hand, and are permissively licensed. Garment weight transfer
 * (`transfer_weights_body_to_garment`) reads the body's groups and will be affected by any rig change
 * — that interaction is unmeasured here.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/** Bodies that reach a learner. `mpfb2_aisha` is the known-good column. */
const BODIES = [
  {
    id: "library_lean_female",
    glb: "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
    knownGood: false,
  },
  {
    id: "library_heavy_male",
    glb: "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_heavy_male-library.glb",
    knownGood: false,
  },
  {
    id: "mpfb2_aisha",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    knownGood: true,
  },
] as const;

/** Rig-agnostic region matchers — both the 23-bone and the MPFB naming conventions. */
const UPPER_ARM = /^(upper_armL|upperarm0[12]L|mixamorig:LeftArm)$/;
const FOREARM = /^(forearmL|lowerarm0[12]L|mixamorig:LeftForeArm)$/;
const HAND = /^(handL|wristL|finger\d+-\d+L|mixamorig:LeftHand.*)$/;
const CLAVICLE = /^(clavicleL|mixamorig:LeftShoulder)$/;

/** A hand that owns any real share of the mesh. Well below aisha's 0.52%, far above zero. */
const MIN_HAND_MASS_FRACTION = 0.001;

const io = new NodeIO();

type Region = { mass: number; vertexCount: number; distanceFromClavicle: number | null };

async function measure(rel: string): Promise<{ upper: Region; fore: Region; hand: Region }> {
  const doc = await io.read(`${REPO_ROOT}/${rel}`);
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) throw new Error(`${rel}: no skin`);
  const joints = skin.listJoints();
  const names = joints.map((j) => j.getName().replaceAll(".", ""));

  const clavicleIndex = names.findIndex((n) => CLAVICLE.test(n));
  const clavicle = clavicleIndex >= 0 ? joints[clavicleIndex]!.getWorldTranslation() : [0, 0, 0];

  const mass = new Map<string, number>();
  const centroid = new Map<string, { n: number; x: number; y: number; z: number }>();
  let totalMass = 0;
  const je: number[] = [];
  const we: number[] = [];
  const el: number[] = [];

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const J = prim.getAttribute("JOINTS_0");
      const W = prim.getAttribute("WEIGHTS_0");
      const P = prim.getAttribute("POSITION");
      if (!J || !W || !P) continue;
      for (let i = 0; i < J.getCount(); i += 1) {
        J.getElement(i, je);
        W.getElement(i, we);
        P.getElement(i, el);
        let best = 0;
        for (let k = 1; k < 4; k += 1) if ((we[k] ?? 0) > (we[best] ?? 0)) best = k;
        for (let k = 0; k < 4; k += 1) {
          const w = we[k] ?? 0;
          if (w <= 0) continue;
          const n = names[je[k]!] ?? "?";
          mass.set(n, (mass.get(n) ?? 0) + w);
          totalMass += w;
        }
        if ((we[best] ?? 0) > 0) {
          const n = names[je[best]!] ?? "?";
          const c = centroid.get(n) ?? { n: 0, x: 0, y: 0, z: 0 };
          c.n += 1;
          c.x += el[0]!;
          c.y += el[1]!;
          c.z += el[2]!;
          centroid.set(n, c);
        }
      }
    }
  }

  const region = (re: RegExp): Region => {
    let m = 0;
    let n = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const [bone, v] of mass) if (re.test(bone)) m += v;
    for (const [bone, c] of centroid) {
      if (!re.test(bone)) continue;
      n += c.n;
      x += c.x;
      y += c.y;
      z += c.z;
    }
    return {
      mass: totalMass > 0 ? m / totalMass : 0,
      vertexCount: n,
      distanceFromClavicle: n
        ? Math.hypot(x / n - clavicle[0]!, y / n - clavicle[1]!, z / n - clavicle[2]!)
        : null,
    };
  };

  return { upper: region(UPPER_ARM), fore: region(FOREARM), hand: region(HAND) };
}

const measured = await Promise.all(
  BODIES.map(async (b) => ({ ...b, ...(await measure(b.glb)) })),
);

describe("a library body's hand can be moved by its own rig", () => {
  it.fails("(1) RED: the hand region carries a real share of the skin weight on every shipped body", () => {
    const starved = measured
      .filter((m) => m.hand.mass < MIN_HAND_MASS_FRACTION)
      .map((m) => `${m.id}: hand mass ${(m.hand.mass * 100).toFixed(2)}%`);
    expect(starved, "bodies whose hand bones own no skin").toEqual([]);
  });

  it.fails(
    "(2) RED COUNTERWEIGHT: upper arm -> forearm -> hand centroids are monotonically distal — dumping the whole limb on the hand bone is refused",
    () => {
      const broken: string[] = [];
      for (const m of measured) {
        const { upper, fore, hand } = m;
        if (upper.distanceFromClavicle === null || fore.distanceFromClavicle === null || hand.distanceFromClavicle === null) {
          broken.push(
            `${m.id}: a region owns no vertices (upper=${upper.vertexCount} fore=${fore.vertexCount} hand=${hand.vertexCount})`,
          );
          continue;
        }
        if (!(upper.distanceFromClavicle < fore.distanceFromClavicle && fore.distanceFromClavicle < hand.distanceFromClavicle)) {
          broken.push(
            `${m.id}: not monotonic — upper ${upper.distanceFromClavicle.toFixed(3)} fore ${fore.distanceFromClavicle.toFixed(3)} hand ${hand.distanceFromClavicle.toFixed(3)}`,
          );
        }
      }
      expect(broken, "arm regions not ordered along the limb").toEqual([]);
    },
  );

  it("(3) NET known-good: the MPFB2 rail already satisfies both — a fix must not regress it", () => {
    const aisha = measured.find((m) => m.id === "mpfb2_aisha")!;
    expect(aisha.hand.mass, "aisha hand mass").toBeGreaterThanOrEqual(MIN_HAND_MASS_FRACTION);
    expect(aisha.upper.distanceFromClavicle).not.toBeNull();
    expect(aisha.fore.distanceFromClavicle).not.toBeNull();
    expect(aisha.hand.distanceFromClavicle).not.toBeNull();
    expect(aisha.upper.distanceFromClavicle!).toBeLessThan(aisha.fore.distanceFromClavicle!);
    expect(aisha.fore.distanceFromClavicle!).toBeLessThan(aisha.hand.distanceFromClavicle!);
  });
});
