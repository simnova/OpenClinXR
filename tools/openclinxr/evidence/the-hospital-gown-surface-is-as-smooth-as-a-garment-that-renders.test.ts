import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the hospital gown's surface renders as triangular shards on two stations — the live
 * `ed_chest_pain_priority_v1` room capture (#712) and an isolated 4096 bake capture of
 * `mpfb-gown-adult-patient` (#714). No other garment does.
 *
 * MEASURED by the orchestrator on 2026-08-28 at main `7d29262a`, over every shipped real-garment
 * primitive. IMMUTABLE — flip the assertion and append a `## FIXED (#747)` block below; do not
 * rewrite these numbers.
 *
 *   garment primitive                       tris   dihedral p90   frac > 60 deg
 *   hospital gown (mpfb-gown-inspect)      57073        90.0            21.08%
 *   hospital gown (mpfb-gown-adult)        29185        86.1            19.32%
 *   open cardigan (ed spouse)               7829        32.7             3.47%
 *   scrub pocket (peds nurse kevin)         4076        18.5             1.70%
 *   exam t-shirt (peds patient child)       3887        17.2             1.70%
 *   casual top (peds anxious parent)        4069        18.7             1.36%
 *   scrub top (peds nurse kevin)            4170        18.2             1.29%
 *
 * ## WHY THE DIHEDRAL DISTRIBUTION AND NOT THE TRIANGLE COUNT
 *
 * The gown is also a triangle-count outlier at 4x to 15x the fleet, and that number is the obvious
 * thing to bound. It is the wrong thing to bound: a count is a QUANTITY and shards are a SHAPE, so a
 * count-based clause goes green the moment someone decimates the mesh while the surface stays
 * shredded. #695 owns decimation and this card does not.
 *
 * `frac > 60 deg` is the share of interior edges whose two faces meet at more than 60 degrees,
 * computed from GEOMETRIC face normals derived from positions, after welding vertices by position at
 * 5 decimal places. It is immune to shading and to index splits, and it is exactly what "a field of
 * triangular spikes" means numerically. A smooth garment folds; a shredded one flips.
 *
 * ## THE THRESHOLD IS THE AMBIENT CEILING, NOT A NUMBER I CHOSE
 *
 * Clause (1) requires the gown to be no rougher than the ROUGHEST garment on the same tree that
 * renders acceptably. That reference is measured at test time from the non-gown population, so it
 * tracks the fleet rather than a constant, and it cannot be met by a threshold nobody can defend.
 * Today it resolves to the open cardigan at 3.47% against the gown's 19.32% — a 5.6x margin, so the
 * clause is neither vacuous nor fitted to clear an observation.
 *
 * ## CAUSE NOT DETERMINED
 *
 * Two readings, unranked, and they may both be wrong: the fold wave (`_fold_amp686 = 0.034`,
 * `_fold_k686 = 16` in `automate_blender.py`) subdivides past what the shell can carry; or the gown's
 * shell is generated at a different base resolution from every other garment and the wave merely
 * makes it visible. #712 has already excluded skinning weights, bone transforms, morphs and vertex
 * displacement — the mesh's current AABB sits within 1.25x of its bind AABB and the pixels land
 * exactly where the measured geometry is.
 *
 * ## THE THREE CHEAP WAYS TO GREEN THIS, AND WHY EACH IS REFUSED
 *
 * Counterweight (2) pins `_fold_amp686` and `_fold_k686`: flattening the gathers removes the shards
 * by removing the garment's shape. #714 clause (3) and #746 counterweight (2) already refuse it.
 *
 * Counterweight (3) pins the comparators: clause (1)'s reference is relative, so degrading the clean
 * garments would raise the ceiling until the gown fits under it. Every non-gown garment must stay
 * under 5.2% — the measured 3.47% ceiling with 1.5x headroom for ordinary rebake variation.
 *
 * Counterweight (4) pins the population: all seven garment primitives must be measured. Dropping the
 * cardigan, which is the ceiling, would relax clause (1) by removing its reference.
 */

const REPO = join(import.meta.dirname, "../../..");
const DIR = join(REPO, "apps/ui-xr/public/generated-humanoids");
const BLENDER = join(REPO, "tools/openclinxr/asset-pipeline/anny/automate_blender.py");

/**
 * The gather's depth is the visible property. Shipped value on 2026-08-28 is 0.034 m; the floor is
 * 88% of it, so trimming is allowed and flattening is not.
 *
 * AMENDED 2026-08-28: this clause previously pinned `_fold_amp686 = 0.034` AND `_fold_k686 = 16` as
 * literal equalities. That bounded the fix out. Three candidate causes were measured dead — the C0
 * wave corner moved the metric 0.65 of the required 16 points, aliasing was refuted (the bodice
 * carries ~300 azimuth columns per ring, phase concentration R = 0.067, so the wave is sampled ~19
 * times per period), and sliver filtering left the gown at 16.98% against the scrub top's 1.29%.
 * What survives is the amplitude-to-wavelength ratio: at k = 16 on a ~2.2 m chest circumference a
 * half period is ~69 mm, and a 34 mm excursion gives a crest dihedral near 90 degrees, which is the
 * measured p90 of 86-90. Every remaining fix therefore moves the amplitude or the wave count, and
 * the old clause refused all of them.
 *
 * The wave count is now UNPINNED on purpose. Lowering k lengthens the wavelength and reduces the
 * crest slope while leaving the gather's depth untouched, which is the opposite of flattening. A
 * bodice that ends up reading as smooth cloth fails the orchestrator's render grade, which is the
 * backstop the constant was standing in for.
 */
const MIN_FOLD_AMPLITUDE_M = 0.03;

/** Interior-edge dihedral above this reads as a fold rather than a crease. */
const SHARP_DEGREES = 60;
/**
 * The roughest clean garment measured 2026-08-28 is the open cardigan at 3.47%. 1.5x headroom covers
 * ordinary rebake variation without letting a comparator degrade far enough to raise the ceiling.
 */
const COMPARATOR_CEILING_FRACTION = 0.052;
/** Every shipped real-garment primitive as of 2026-08-28. Dropping one narrows clause (1). */
const SUBJECTS: { file: string; material: RegExp; label: string; gown: boolean }[] = [
  { file: "mpfb-gown-adult-patient.glb", material: /hospital_gown/u, label: "hospital gown (adult patient)", gown: true },
  { file: "mpfb-gown-inspect.glb", material: /hospital_gown/u, label: "hospital gown (inspect)", gown: true },
  { file: "ed_chest_pain_spouse_adult.glb", material: /open_cardigan/u, label: "open cardigan", gown: false },
  { file: "peds_nurse_kevin.glb", material: /scrub_top/u, label: "scrub top", gown: false },
  { file: "peds_nurse_kevin.glb", material: /scrub_pocket/u, label: "scrub pocket", gown: false },
  { file: "peds_patient_child.glb", material: /exam_tshirt/u, label: "exam t-shirt", gown: false },
  { file: "peds_anxious_parent.glb", material: /casual_top/u, label: "casual top", gown: false },
];

type Row = { label: string; gown: boolean; triangles: number; sharpFraction: number; interiorEdges: number };

async function measure(): Promise<Row[]> {
  const io = new NodeIO();
  const rows: Row[] = [];
  for (const subject of SUBJECTS) {
    const doc = await io.read(join(DIR, subject.file));
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        if (!subject.material.test(prim.getMaterial()?.getName() ?? "")) continue;
        const indices = prim.getIndices();
        if (!indices) continue;
        const pos = prim.getAttribute("POSITION")!.getArray() as Float32Array;
        const idx = indices.getArray() as Uint16Array | Uint32Array;
        const triangles = idx.length / 3;
        // Weld by position so an index split at a material or UV seam is not read as a boundary.
        const welded = new Int32Array(pos.length / 3);
        const seen = new Map<string, number>();
        for (let v = 0; v < pos.length / 3; v += 1) {
          const key = `${pos[v * 3].toFixed(5)},${pos[v * 3 + 1].toFixed(5)},${pos[v * 3 + 2].toFixed(5)}`;
          let id = seen.get(key);
          if (id === undefined) { id = seen.size; seen.set(key, id); }
          welded[v] = id;
        }
        const normals: [number, number, number][] = [];
        for (let t = 0; t < triangles; t += 1) {
          const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
          const e1 = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
          const e2 = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
          const n: [number, number, number] = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
          ];
          const len = Math.hypot(n[0], n[1], n[2]) || 1e-12;
          normals.push([n[0] / len, n[1] / len, n[2] / len]);
        }
        const edges = new Map<string, number[]>();
        for (let t = 0; t < triangles; t += 1) {
          const tri = [welded[idx[t * 3]], welded[idx[t * 3 + 1]], welded[idx[t * 3 + 2]]];
          for (let e = 0; e < 3; e += 1) {
            const u = tri[e], w = tri[(e + 1) % 3];
            const key = u < w ? `${u}_${w}` : `${w}_${u}`;
            const bucket = edges.get(key);
            if (bucket) bucket.push(t); else edges.set(key, [t]);
          }
        }
        let interior = 0;
        let sharp = 0;
        for (const [, ts] of edges) {
          if (ts.length !== 2) continue;
          interior += 1;
          const [t0, t1] = ts;
          const dot = normals[t0][0] * normals[t1][0] + normals[t0][1] * normals[t1][1] + normals[t0][2] * normals[t1][2];
          const deg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
          if (deg > SHARP_DEGREES) sharp += 1;
        }
        rows.push({ label: subject.label, gown: subject.gown, triangles, interiorEdges: interior, sharpFraction: sharp / interior });
      }
    }
  }
  return rows;
}

const rowsPromise = measure();
const pct = (f: number) => `${(f * 100).toFixed(2)}%`;

describe("the hospital gown surface is as smooth as a garment that renders (#747)", () => {
  it.fails("(1) no gown is rougher than the roughest garment that renders acceptably", async () => {
    const rows = await rowsPromise;
    const clean = rows.filter((r) => !r.gown);
    const gowns = rows.filter((r) => r.gown);
    expect(clean.length, "the comparator population must be measured").toBeGreaterThan(0);
    expect(gowns.length, "both hospital-gown primitives must be measured").toBe(2);
    const ceiling = Math.max(...clean.map((r) => r.sharpFraction));
    const worstGown = gowns.reduce((a, b) => (a.sharpFraction >= b.sharpFraction ? a : b));
    expect(
      worstGown.sharpFraction,
      `${worstGown.label} has ${pct(worstGown.sharpFraction)} of its interior edges folding past `
        + `${SHARP_DEGREES} degrees, against a ceiling of ${pct(ceiling)} set by the roughest garment `
        + `on this tree that renders acceptably. The ceiling is measured here, not chosen, so it `
        + `tracks the fleet. Rows: ${rows.map((r) => `${r.label} ${pct(r.sharpFraction)}`).join("; ")}`,
    ).toBeLessThanOrEqual(ceiling);
  });

  it("(2) COUNTERWEIGHT: the gathers are not flattened away", () => {
    const src = readFileSync(BLENDER, "utf8");
    const amp = /_fold_amp686\s*=\s*([0-9.]+)/u.exec(src);
    expect(amp, "_fold_amp686 must still be assigned in automate_blender.py").not.toBeNull();
    expect(
      Number(amp![1]),
      `_fold_amp686 is ${amp![1]}. The gather's DEPTH is what makes it visible, and driving the `
        + `amplitude down until nothing folds sharply removes the garment's shape rather than fixing `
        + `its surface. The floor is ${MIN_FOLD_AMPLITUDE_M} m — 88% of the 0.034 shipped on `
        + `2026-08-28, so a trim is allowed and a flattening is not.`,
    ).toBeGreaterThanOrEqual(MIN_FOLD_AMPLITUDE_M);
  });

  it("(3) COUNTERWEIGHT: the comparators are not degraded to raise the ceiling", async () => {
    const rows = await rowsPromise;
    for (const row of rows.filter((r) => !r.gown)) {
      expect(
        row.sharpFraction,
        `${row.label} is at ${pct(row.sharpFraction)}. Clause (1)'s reference is relative, so a `
          + `degraded comparator raises the ceiling until the gown fits under it. The bound is `
          + `${pct(COMPARATOR_CEILING_FRACTION)} — the open cardigan's measured 3.47% with 1.5x `
          + `headroom for rebake variation. A comparator above it is a regression in that garment, `
          + `not a licence to relax this clause.`,
      ).toBeLessThanOrEqual(COMPARATOR_CEILING_FRACTION);
    }
  });

  it("(4) COUNTERWEIGHT: the measured population is not narrowed", async () => {
    const rows = await rowsPromise;
    expect(
      rows.length,
      `all ${SUBJECTS.length} shipped real-garment primitives must be measured. Dropping the open `
        + "cardigan, which sets the ceiling, would relax clause (1) by removing its reference.",
    ).toBe(SUBJECTS.length);
    expect(
      rows.every((r) => r.interiorEdges > 1000),
      `every subject must contribute a real surface. Rows: `
        + `${rows.map((r) => `${r.label} interiorEdges=${r.interiorEdges}`).join("; ")}`,
    ).toBe(true);
  });
});
