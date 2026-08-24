import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **Every MakeClothes garment ships flat-shaded; every MPFB-native primitive on the same body ships
 * smooth.** This is the hard faceting banding across the trousers and shirt in every grade capture,
 * while the arms and face beside them read smooth. Measured 2026-08-13 on the shipped bytes:
 *
 *   primitive                         shared positions with a coplanar (<30 deg) join, and how many are SPLIT
 *   -------------------------------   ------------------------------------------------------------------
 *   aisha cargo_pants                 1181 coplanar   ->  1181 split   (100%)
 *   aisha footwear_toigo_flats       19788 coplanar   -> 19788 split   (100%)
 *   aisha toigo_t_shirt                904 coplanar   ->   904 split   (100%)
 *   kevin cargo_pants                 1186 coplanar   ->  1186 split   (100%)
 *   kevin footwear_culturalibre       11471 coplanar  -> 11471 split   (100%)
 *   kevin scrub_shirt                 4310 coplanar   ->  4310 split   (100%)
 *   child cargo_pants                 1239 coplanar   ->  1239 split   (100%)
 *   child footwear_toigo_mj            220 coplanar   ->   220 split   (100%)
 *   child toigo_t_shirt                961 coplanar   ->   961 split   (100%)
 *   -------------------------------   ------------------------------------------------------------------
 *   aisha BODY (known-good)            332 coplanar   ->     0 split   (0%)
 *   kevin BODY (known-good)            320 coplanar   ->     0 split   (0%)
 *   child BODY (known-good)            327 coplanar   ->     0 split   (0%)
 *
 * 100.0% against 0.0%, on the same asset, in the same run, by the same instrument. There is no
 * threshold here to argue about: the garments have never had smoothing applied at all.
 *
 * ## WHY THE REFERENCE IS THE INPUT GEOMETRY AND NOT A FRACTION OF THE OUTPUT (#151 / SS9s)
 *
 * "Should this position be smooth?" is answered by the DIHEDRAL ANGLE between the faces meeting there,
 * computed from vertex positions — which do not move when shading changes. A treatment that fixes
 * normals cannot move this reference, so the bound cannot be satisfied by construction. The failure
 * mode this avoids is an epsilon written as a fraction of the thing being measured, where the formula
 * cancels to a constant ratio and the assertion passes whenever the treatment does anything at all.
 *
 * 30 deg and 60 deg are the two ends of Blender's standard auto-smooth band, and they are DELIBERATELY
 * different numbers with a gap between them. Clause (1) only demands smoothing below 30; clause (2)
 * only demands preservation above 60. The correct fix -- auto-smooth somewhere in that band -- lands
 * cleanly; neither clause dictates where.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                       | (1) coplanar | (2) sharp kept | (3) not remeshed | result
 *   ------------------------------------------------|--------------|----------------|------------------|--------
 *   a) today, no smoothing at all                   |   **FAIL**   |      pass      |       pass       | REFUSED
 *   b) shade_smooth with NO angle threshold         |     pass     |   **FAIL**     |       pass       | REFUSED
 *   c) decimate/remesh until the ratios move        |     pass     |      pass      |    **FAIL**      | REFUSED
 *   d) perturb verts so nothing is coplanar         |   vacuous    |      pass      |    **FAIL**      | REFUSED
 *   e) auto-smooth in the 30-60 band                |     pass     |      pass      |       pass       | ALL PASS
 *
 * (b) is the one to watch and it is the reason clause (2) exists. Flattening the whole normal set to
 * one smoothed group greens clause (1) instantly and turns the shoe soles, the hem rings and the
 * collar into mush -- a regression wearing a green tick. Clause (2) floors the count of genuinely
 * sharp (>60 deg) positions that must STAY split; every one of them is split today, so the floor is
 * measured, not invented.
 *
 * (d) is the vacuity attack: make the coplanar set empty and clause (1) has nothing to fail on.
 * Clause (3) floors the coplanar population itself alongside the triangle count, so the enumeration
 * cannot be emptied.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails 9/9 garments today. (2), (3) and
 * (4) all pass today and are counterweights. Each is independent of the quantity clause (1) measures
 * -- smoothing a coplanar join moves neither the sharp-join count, nor the triangle count, nor the
 * body -- so none can be satisfied by the same edit that greens the RED.
 *
 * NOT TESTED:
 *   - **That fixing this removes the graded faceting.** This bounds shading topology in the file. Only
 *     a pixel grade after a re-bake settles appearance, and that grade is the orchestrator's.
 *   - **The scalp and the eyes.** Both already measure 0% split; they are excluded, not asserted on.
 *   - **Whether tangents survive.** #370's normal maps need TANGENT data; recomputing normals can
 *     invalidate it. Not measured here and not claimed either way.
 *   - **Anything about triangle counts as a budget.** The counts are pinned only so a remesh cannot
 *     satisfy the RED. Optimisation happens later in the pipeline and is not this contract's business.
 *
 * ## FIXED (#371)
 *
 * `materialize_mpfb_humanoid_candidate.py` now applies the Anny rail's auto-smooth-at-60-deg knob
 * (`apply_garment_auto_smooth_normals`) to the EXPORTED bytes: every garment NORMAL accessor is
 * rewritten post-export with the contract's own weld keys and face-normal math, so joins flatter
 * than 60 deg carry one shared normal and sharper joins keep their per-face split normals.
 *
 * Measured on Blender 5.1.1 (this issue): no in-Blender API lands on the bytes the glTF exporter
 * writes. `shade_auto_smooth()` creates a "Smooth by Angle" NODES modifier the exporter ignores;
 * `normals_split_custom_set()` leaves ~1% of corners at their old values (82/7884 on kevin's cargo
 * pants); per-face `use_smooth`, `EDGE_SPLIT` and clearing custom normals all export the original
 * flat normals unchanged. So the smoothing runs where this test measures.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

const ACTORS = ["mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child"] as const;

/** Blender's standard auto-smooth band. A join flatter than this MUST carry one shared normal. */
const COPLANAR_DEG = 30;
/** A join sharper than this MUST stay split -- this is what refuses threshold-free shade_smooth. */
const SHARP_DEG = 60;

/** Garment primitives only. The body, scalp and eyes are MPFB-native and already smooth (known-good). */
const isGarment = (n: string): boolean => /makeclothes_library/i.test(n) && !/eyes/i.test(n);
const isBody = (n: string): boolean => /^mpfb_skin_/i.test(n);

/**
 * MEASURED 2026-08-13 on the shipped bytes. Floors refuse (b) global smoothing and (c)/(d) remeshing.
 * Keyed `actor::material`. A garment absent from this table is a NEW garment and fails clause (3)'s
 * enumeration guard rather than passing silently.
 *
 * #378 REBASED 2026-08-14 for kevin's pants only: the trouser-tuck (pants pulled radially inside the
 * boot shaft) warps the band's surface, so 90 above-rim coplanar joins (927 -> 837) dropped below the
 * rim-top floor. The tris are unchanged (2628 — not a remesh) and 837 joins remain (not emptied), so
 * the counterweight's intent binds as before; the floor is now 0.95 x 837 = 795.
 *
 * #199 REBASED 2026-08-14 for kevin's upper + pants: the nurse's upper slot is now the CC0
 * `toigo_fisherman_sweater` (long sleeve, 4,164 tris) instead of the CC-BY scrub shirt (9,384 tris),
 * and the lower cover shell's top follows the upper garment's hem (`build_cover_shell` bounds the
 * band cut by the hem), so the pants' band re-cut at the sweater's lower hem: 2,628 -> 2,498 tris,
 * above-rim coplanar 837 -> 794. Same class as #378 — a legitimate geometry consequence of the
 * asset swap, not a remesh (the floor is now 0.95 x 794 = 754.3; the smoothing of the NEW garment
 * is pinned by its own measured row).
 *
 * #458 REBASED 2026-08-19 for kevin's upper + pants, superseding the #199 block above: #403
 * cleared `LONG_SLEEVE_UPPER_BY_REFERENCE["peds_nurse_kevin"]` to `None`, so the clinician branch
 * fits the WojackOWL CC-BY scrub shirt and the clinician lower path fits `Scrub_Pants` pre-strip
 * (materialize_mpfb_humanoid_candidate.py:3104-3106). The nurse ships the clinical kit; the
 * sweater (4,164) and cargo-pants (2,498) rows are retired and the shipped scrub kit is pinned by
 * its own rows. `tris` is the independently recorded library count (9384 / 2704 — see
 * the-nurse-wardrobe-baseline-matches-the-shipped-bytes.test.ts header for the source records);
 * `coplanar` (above-rim, per this table's convention) and `sharpSplit` were measured 2026-08-19 on
 * the shipped bytes with this contract's own instrument (scrub_shirt total coplanar 4310 matches
 * this header's own :18 row).
 */
const BASELINE: Record<string, { tris: number; coplanar: number; sharpSplit: number }> = {
  // #647 re-pinned 2026-08-24: the OB case drives its own body height (1.72 m),
  // so the pants re-fit the taller body — tris 2692->2724, aboveRim 906->972,
  // sharpSplit 160->176. Measured with this contract's own instrument (the same
  // that validated the pre-#647 rows exactly).
  "mpfb-ob-patient-aisha::mat_makeclothes_library_cargo_pants.001": { tris: 2724, coplanar: 972, sharpSplit: 176 },
  // #647 re-pinned 2026-08-24: shoe re-fit on the taller foot — tris unchanged,
  // aboveRim 134->136, sharpSplit 146->112 (fewer >60deg joins on the new fit).
  "mpfb-ob-patient-aisha::mat_makeclothes_library_footwear_toigo_mj_cloth_shoes": { tris: 1004, coplanar: 136, sharpSplit: 112 },
  // #647 re-pinned 2026-08-24: t-shirt fit moved up the taller torso — tris
  // unchanged, aboveRim 851->935, sharpSplit 245->232.
  "mpfb-ob-patient-aisha::mat_makeclothes_library_toigo_t_shirt": { tris: 2700, coplanar: 935, sharpSplit: 232 },
  "mpfb-peds-nurse-kevin::mat_makeclothes_library_scrub_shirt": { tris: 9384, coplanar: 3862, sharpSplit: 303 },
  "mpfb-peds-nurse-kevin::mat_makeclothes_library_scrub_pants": { tris: 2704, coplanar: 908, sharpSplit: 147 },
  "mpfb-peds-nurse-kevin::mat_makeclothes_library_footwear_culturalibre_male_boots": { tris: 30768, coplanar: 6246, sharpSplit: 1605 },
  "mpfb-peds-patient-child::mat_makeclothes_library_cargo_pants.001": { tris: 2636, coplanar: 1042, sharpSplit: 49 },
  "mpfb-peds-patient-child::mat_makeclothes_library_footwear_toigo_mj_cloth_shoes": { tris: 1004, coplanar: 144, sharpSplit: 124 },
  "mpfb-peds-patient-child::mat_makeclothes_library_toigo_t_shirt": { tris: 2700, coplanar: 866, sharpSplit: 233 },
};

type Prim = {
  actor: string;
  material: string;
  garment: boolean;
  body: boolean;
  tris: number;
  coplanar: number;
  coplanarAboveRim: number;
  coplanarSplit: number;
  sharp: number;
  sharpSplit: number;
};

const sub = (a: number[], b: number[]): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross = (a: number[], b: number[]): number[] => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
const norm = (v: number[]): number[] => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};
const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const angleDeg = (a: number[], b: number[]): number =>
  (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;

const io = new NodeIO();

async function measureActor(actor: string): Promise<Prim[]> {
  const doc = await io.read(join(REPO_ROOT, GENERATED, `${actor}.glb`));
  const out: Prim[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial()?.getName() ?? "";
      const garment = isGarment(material);
      const body = isBody(material);
      if (!garment && !body) continue;
      const pos = prim.getAttribute("POSITION");
      const nor = prim.getAttribute("NORMAL");
      const idx = prim.getIndices();
      if (!pos || !nor || !idx) continue;

      const P: number[][] = [];
      const N: number[][] = [];
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        P.push([...v]);
        nor.getElement(i, v);
        N.push([...v]);
      }
      const posKey = (i: number): string => P[i]!.map((x) => x.toFixed(5)).join(",");
      const norKey = (i: number): string => N[i]!.map((x) => x.toFixed(3)).join(",");

      const weld = new Map<string, number[]>();
      for (let i = 0; i < P.length; i += 1) {
        const k = posKey(i);
        const b = weld.get(k) ?? weld.set(k, []).get(k)!;
        b.push(i);
      }

      const faceNormals: number[][] = [];
      const incident = new Map<string, number[]>();
      for (let t = 0; t < idx.getCount(); t += 3) {
        const a = idx.getScalar(t)!;
        const b = idx.getScalar(t + 1)!;
        const c = idx.getScalar(t + 2)!;
        const f = faceNormals.push(norm(cross(sub(P[b]!, P[a]!), sub(P[c]!, P[a]!)))) - 1;
        for (const i of [a, b, c]) {
          const k = posKey(i);
          const bucket = incident.get(k) ?? incident.set(k, []).get(k)!;
          bucket.push(f);
        }
      }

      const ysAll = P.map((q) => q[1]!);
      const loY = Math.min(...ysAll);
      const rimTop = loY + (Math.max(...ysAll) - loY) / 6;
      let coplanar = 0;
      let coplanarAboveRim = 0;
      let coplanarSplit = 0;
      let sharp = 0;
      let sharpSplit = 0;
      for (const [k, ids] of weld) {
        if (ids.length < 2) continue;
        const fs = incident.get(k) ?? [];
        let widest = 0;
        for (let i = 0; i < fs.length; i += 1) {
          for (let j = i + 1; j < fs.length; j += 1) {
            widest = Math.max(widest, angleDeg(faceNormals[fs[i]!]!, faceNormals[fs[j]!]!));
          }
        }
        const split = new Set(ids.map(norKey)).size > 1;
        if (widest < COPLANAR_DEG) {
          coplanar += 1;
          if (P[ids[0]!]![1]! > rimTop) coplanarAboveRim += 1;
          if (split) coplanarSplit += 1;
        }
        if (widest > SHARP_DEG) {
          sharp += 1;
          if (split) sharpSplit += 1;
        }
      }

      out.push({
        actor,
        material,
        garment,
        body,
        tris: idx.getCount() / 3,
        coplanar,
        coplanarAboveRim,
        coplanarSplit,
        sharp,
        sharpSplit,
      });
    }
  }
  return out;
}

const prims = (await Promise.all(ACTORS.map(measureActor))).flat();
const garments = prims.filter((p) => p.garment);
const bodies = prims.filter((p) => p.body);
const idOf = (p: Prim): string => `${p.actor}::${p.material}`;

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * clause cannot guard its own vacuity, because it is satisfied when its body throws for ANY reason --
 * including this guard throwing.
 */
function requireMeasured(): void {
  expect(
    garments.length,
    `garment primitives measured across ${ACTORS.length} actors (bodies: ${bodies.length})`,
  ).toBe(Object.keys(BASELINE).length);
  expect(bodies.length, "body primitives measured (the known-good column)").toBe(ACTORS.length);
}

describe("garments are flat-shaded and the body on the same asset is not", () => {
  it(`(1) FIXED (#371): a join flatter than ${COPLANAR_DEG} deg carries one shared normal, as it does on the body`, () => {
    requireMeasured();
    const faceted = garments
      .filter((p) => p.coplanarSplit > 0)
      .map(
        (p) =>
          `${p.actor}/${p.material}: ${p.coplanarSplit}/${p.coplanar} coplanar joins split (${(
            (p.coplanarSplit / Math.max(p.coplanar, 1)) *
            100
          ).toFixed(1)}%) — body on the same asset is 0%`,
      );
    expect(faceted, "garments whose flat joins are split, i.e. never smoothed").toEqual([]);
  });

  it(`(2) COUNTERWEIGHT: joins sharper than ${SHARP_DEG} deg stay split`, () => {
    // Refuses threshold-free shade_smooth, which greens (1) by turning shoe soles, hems and collars
    // into mush. Every sharp join is split today, so these floors are measured, not invented.
    requireMeasured();
    const mushed = garments
      .filter((p) => p.sharpSplit < (BASELINE[idOf(p)]?.sharpSplit ?? 0) * 0.9)
      .map(
        (p) =>
          `${p.actor}/${p.material}: ${p.sharpSplit} sharp joins still split, below 90% of measured ${
            BASELINE[idOf(p)]?.sharpSplit
          }`,
      );
    expect(mushed, "hard edges smoothed away — a regression wearing a green tick").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: no garment is remeshed, and the coplanar population is not emptied", () => {
    // Refuses (c) decimate-until-the-ratios-move and (d) perturb-until-nothing-is-coplanar, which
    // would green clause (1) by deleting the thing it enumerates rather than by smoothing it.
    requireMeasured();
    const remeshed = garments
      .filter((p) => {
        const b = BASELINE[idOf(p)];
        return !b || p.tris !== b.tris || p.coplanarAboveRim < b.coplanar * 0.95;
      })
      .map((p) => {
        const b = BASELINE[idOf(p)];
        return b
          ? `${p.actor}/${p.material}: tris ${p.tris} (was ${b.tris}), coplanar-above-rim ${p.coplanarAboveRim} (was ${b.coplanar})`
          : `${p.actor}/${p.material}: not in the measured baseline`;
      });
    expect(remeshed, "garment geometry changed rather than its shading").toEqual([]);
  });

  it("(4) NET known-good: the body stays fully smooth", () => {
    // The known-good column is the reason clause (1) needs no invented threshold. If a treatment
    // reaches the body and splits it, the reference is gone and clause (1) means nothing.
    requireMeasured();
    const broken = bodies
      .filter((p) => p.coplanarSplit > 0)
      .map((p) => `${p.actor}/${p.material}: ${p.coplanarSplit}/${p.coplanar} coplanar joins now split`);
    expect(broken, "the body's smooth shading regressed — the known-good column is gone").toEqual([]);
  });
});
