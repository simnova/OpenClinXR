/**
 * Per-decile sharp-edge measurement over every shipped real-garment primitive.
 *
 * Extracted 2026-08-28 so #747 (the fold-band excess) and #750 (the shell floor) measure the same
 * quantity the same way. Sharpness is the share of interior edges whose two faces meet past 60
 * degrees, from GEOMETRIC face normals derived from positions, after welding vertices by position at
 * 5 decimal places. It is immune to shading and to index splits at material or UV seams.
 */
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";

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

const ORIGIN = join(REPO, "tools/openclinxr/evidence/the-hospital-gown-surface-is-as-smooth-as-a-garment-that-renders.test.ts");

/** The fold wave runs in d4-d8; d1-d3 is skirt the fold never touches. d0 is ambient rim creasing. */
const SKIRT_DECILES = [1, 2, 3];
/**
 * The roughest clean garment in the skirt bands measured 2026-08-28 is the open cardigan at 7.4%.
 * 1.5x headroom covers ordinary rebake variation without letting a comparator degrade far enough to
 * raise clause (2)'s ceiling.
 */
const COMPARATOR_SKIRT_CEILING = 0.111;

type DecileRow = { label: string; gown: boolean; deciles: (number | null)[] };

async function measureDeciles(): Promise<DecileRow[]> {
  const io = new NodeIO();
  const out: DecileRow[] = [];
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
        let lo = Infinity, hi = -Infinity;
        for (let i = 1; i < pos.length; i += 3) { if (pos[i] < lo) lo = pos[i]; if (pos[i] > hi) hi = pos[i]; }
        const welded = new Int32Array(pos.length / 3);
        const seen = new Map<string, number>();
        for (let v = 0; v < pos.length / 3; v += 1) {
          const key = `${pos[v * 3].toFixed(5)},${pos[v * 3 + 1].toFixed(5)},${pos[v * 3 + 2].toFixed(5)}`;
          let id = seen.get(key);
          if (id === undefined) { id = seen.size; seen.set(key, id); }
          welded[v] = id;
        }
        const normals: [number, number, number][] = [];
        const triY: number[] = [];
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
          triY.push((pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3);
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
        const bins = Array.from({ length: 10 }, () => ({ interior: 0, sharp: 0 }));
        for (const [, ts] of edges) {
          if (ts.length !== 2) continue;
          const [t0, t1] = ts;
          const y = (triY[t0] + triY[t1]) / 2;
          const b = Math.min(9, Math.max(0, Math.floor(((y - lo) / (hi - lo)) * 10)));
          bins[b].interior += 1;
          const dot = normals[t0][0] * normals[t1][0] + normals[t0][1] * normals[t1][1] + normals[t0][2] * normals[t1][2];
          if ((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI > SHARP_DEGREES) bins[b].sharp += 1;
        }
        out.push({
          label: subject.label,
          gown: subject.gown,
          deciles: bins.map((b) => (b.interior ? b.sharp / b.interior : null)),
        });
      }
    }
  }
  return out;
}


export const SKIRT_DECILES_DEFAULT = [1, 2, 3];
export { measure, measureDeciles, SUBJECTS, SHARP_DEGREES, DIR, REPO, BLENDER };
export type { Row, DecileRow };
