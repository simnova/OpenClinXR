/**
 * Two shipped humanoid mesh defects found by the bx_audit mesh-defects lane (2026-10-30).
 *
 * 1. Street jeans collapse. `mpfb-street-adult-male.glb` was baked at e59925fc6 while the
 *    post-fit `cloth_offset` snap (garment_coverage.py, nearest body vertex + 15 mm) still ran
 *    on covering-library lowers. 0f460d098 removed the snap and rebaked family-partner only.
 *    The snap folds distinct source vertices onto one shell point, so separate triangles land
 *    on the same three positions. Measured on the shipped bytes before the fix:
 *
 *    | subject | coincident tri pairs | unique positions (source obj 3109) |
 *    |---|---:|---:|
 *    | street jeans (e59925fc6 lineage) | 37 | 1078 |
 *    | family-partner jeans (control, rebaked by 0f460d098) | 4 | 3028 |
 *
 * 2. Parent bob crown. c240327c3 (a teeth commit) rewrote only the hair POSITION accessor of
 *    `mpfb-peds-parent-aisha.glb` (mean dy -13.8 mm, non-rigid; normals, joints, weights and
 *    indices untouched). Body skin at the crown now sits above the lowered hair. Instrument:
 *    skin samples on triangles within 30 mm of the hair top, cast +Y; count samples whose
 *    vertical column crosses the hair but has no hair hit above the sample.
 *
 *    | subject | crown samples under hair | skin above hair |
 *    |---|---:|---:|
 *    | parent bob, c240327c3 to 33ec9cefe | 657 | 20 |
 *    | parent bob, 80eea4620 (pre-regression) | 261 | 0 |
 *    | clinical-nurse-adult (control) | - | 2 |
 *
 * Thresholds come from the controls: pairs <= 4 (family-partner), unique >= 0.9 x 3109,
 * skin-above-hair <= 2 (nurse). Counterweights: the jeans keep their source triangle count
 * (5708) so deleting triangles cannot pass; the bob keeps its crown samples (>= 200) so
 * shrinking the sampled crown cannot pass.
 *
 * NOT TESTED: drape quality, waist meet, hair strand appearance, any other actor's hair.
 */

import { join } from "node:path";
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";

const HUMANOIDS = join(repoRoot(), "apps/ui-xr/public/generated-humanoids");
const STREET = join(HUMANOIDS, "mpfb-street-adult-male.glb");
const FAMILY = join(HUMANOIDS, "mpfb-family-partner-adult.glb");
const PARENT = join(HUMANOIDS, "mpfb-peds-parent-aisha.glb");
const NURSE = join(HUMANOIDS, "mpfb-clinical-nurse-adult.glb");

const JEANS_SOURCE_VERTS = 3109;
const JEANS_SOURCE_TRIS = 5708;
const MAX_COINCIDENT_PAIRS = 4;
const MAX_SKIN_ABOVE_HAIR = 2;
const MIN_CROWN_SAMPLES = 200;

type Tri = { p: Float64Array; i: Uint32Array };

async function read(path: string): Promise<Document> {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
}

function collect(doc: Document, keep: (meshName: string, materialName: string) => boolean): Tri {
  const p: number[] = [];
  const i: number[] = [];
  const el = [0, 0, 0];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!keep(mesh.getName(), prim.getMaterial()?.getName() ?? "")) continue;
      const pos = prim.getAttribute("POSITION");
      const idx = prim.getIndices()?.getArray();
      if (!pos || !idx) continue;
      const base = p.length / 3;
      for (let v = 0; v < pos.getCount(); v += 1) {
        pos.getElement(v, el);
        p.push(el[0]!, el[1]!, el[2]!);
      }
      for (let k = 0; k < idx.length; k += 1) i.push(base + Number(idx[k]));
    }
  }
  return { p: new Float64Array(p), i: Uint32Array.from(i) };
}

const isLower = (mesh: string): boolean => /jeans|pants|cargo/i.test(mesh);

/** Coincident triangle pairs: same three welded positions (0.5 mm), no shared vertex index. */
function jeansCollapse(m: Tri): { pairs: number; uniquePositions: number; tris: number } {
  const n = m.p.length / 3;
  const tol = 5e-4;
  const parent = Int32Array.from({ length: n }, (_, k) => k);
  const find = (k: number): number => {
    while (parent[k] !== k) {
      parent[k] = parent[parent[k]!]!;
      k = parent[k]!;
    }
    return k;
  };
  const cell = (x: number): number => Math.floor(x / tol);
  const grid = new Map<string, number[]>();
  for (let v = 0; v < n; v += 1) {
    const key = `${cell(m.p[3 * v]!)},${cell(m.p[3 * v + 1]!)},${cell(m.p[3 * v + 2]!)}`;
    const list = grid.get(key);
    if (list) list.push(v);
    else grid.set(key, [v]);
  }
  for (let v = 0; v < n; v += 1) {
    const cx = cell(m.p[3 * v]!);
    const cy = cell(m.p[3 * v + 1]!);
    const cz = cell(m.p[3 * v + 2]!);
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const w of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (w <= v) continue;
            const d = Math.hypot(
              m.p[3 * v]! - m.p[3 * w]!,
              m.p[3 * v + 1]! - m.p[3 * w + 1]!,
              m.p[3 * v + 2]! - m.p[3 * w + 2]!,
            );
            if (d <= tol) {
              const a = find(v);
              const b = find(w);
              if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
            }
          }
        }
  }
  const byKey = new Map<string, number[]>();
  const tris = m.i.length / 3;
  for (let f = 0; f < tris; f += 1) {
    const g = [find(m.i[3 * f]!), find(m.i[3 * f + 1]!), find(m.i[3 * f + 2]!)].sort((a, b) => a - b);
    if (g[0] === g[1] || g[1] === g[2]) continue;
    const key = g.join(",");
    const list = byKey.get(key);
    if (list) list.push(f);
    else byKey.set(key, [f]);
  }
  let pairs = 0;
  for (const fs of byKey.values()) {
    for (let x = 0; x < fs.length; x += 1)
      for (let y = x + 1; y < fs.length; y += 1) {
        const a = new Set([m.i[3 * fs[x]!], m.i[3 * fs[x]! + 1], m.i[3 * fs[x]! + 2]]);
        const shared = [m.i[3 * fs[y]!], m.i[3 * fs[y]! + 1], m.i[3 * fs[y]! + 2]].some((k) => a.has(k));
        if (!shared) pairs += 1;
      }
  }
  const unique = new Set<string>();
  for (let v = 0; v < n; v += 1) {
    unique.add(`${m.p[3 * v]!.toFixed(5)},${m.p[3 * v + 1]!.toFixed(5)},${m.p[3 * v + 2]!.toFixed(5)}`);
  }
  return { pairs, uniquePositions: unique.size, tris };
}

const isHair = (mesh: string): boolean => /hair/i.test(mesh) && !/eyebrow/i.test(mesh);
const isSkin = (_mesh: string, material: string): boolean => /skin/i.test(material);

/** Crown skin samples whose vertical column crosses the hair but has no hair above them. */
function crownSkinAboveHair(hair: Tri, skin: Tri): { crownSamples: number; aboveHair: number } {
  let hairTop = -Infinity;
  for (let v = 1; v < hair.p.length; v += 3) hairTop = Math.max(hairTop, hair.p[v]!);
  const band = hairTop - 0.03;
  const samples = new Set<string>();
  const pts: number[][] = [];
  for (let f = 0; f < skin.i.length / 3; f += 1) {
    const a = skin.i[3 * f]!;
    const b = skin.i[3 * f + 1]!;
    const c = skin.i[3 * f + 2]!;
    if (Math.min(skin.p[3 * a + 1]!, skin.p[3 * b + 1]!, skin.p[3 * c + 1]!) <= band) continue;
    for (let s = 0; s <= 4; s += 1)
      for (let t = 0; s + t <= 4; t += 1) {
        const u = s / 4;
        const w = t / 4;
        const r = 1 - u - w;
        const q = [0, 1, 2].map((k) => u * skin.p[3 * a + k]! + w * skin.p[3 * b + k]! + r * skin.p[3 * c + k]!);
        const key = q.map((x) => x.toFixed(6)).join(",");
        if (samples.has(key)) continue;
        samples.add(key);
        pts.push(q);
      }
  }
  let crownSamples = 0;
  let aboveHair = 0;
  const nt = hair.i.length / 3;
  for (const o of pts) {
    let crossed = false;
    let above = false;
    for (let f = 0; f < nt && !above; f += 1) {
      const ia = 3 * hair.i[3 * f]!;
      const ib = 3 * hair.i[3 * f + 1]!;
      const ic = 3 * hair.i[3 * f + 2]!;
      // 2D point-in-triangle in XZ, then the Y of the hair plane at that column.
      const ax = hair.p[ia]!, az = hair.p[ia + 2]!;
      const bx = hair.p[ib]!, bz = hair.p[ib + 2]!;
      const cx = hair.p[ic]!, cz = hair.p[ic + 2]!;
      const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((o[0]! - ax) * (cz - az) - (cx - ax) * (o[2]! - az)) / det;
      const l2 = ((bx - ax) * (o[2]! - az) - (o[0]! - ax) * (bz - az)) / det;
      if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
      crossed = true;
      const y = hair.p[ia + 1]! + l1 * (hair.p[ib + 1]! - hair.p[ia + 1]!) + l2 * (hair.p[ic + 1]! - hair.p[ia + 1]!);
      if (y > o[1]!) above = true;
    }
    if (!crossed) continue;
    crownSamples += 1;
    if (!above) aboveHair += 1;
  }
  return { crownSamples, aboveHair };
}

describe("shipped street jeans keep distinct fitted triangles", () => {
  it("family-partner jeans (the 0f460d098 rebake) pass the instrument", async () => {
    const r = jeansCollapse(collect(await read(FAMILY), isLower));
    expect(r.pairs).toBeLessThanOrEqual(MAX_COINCIDENT_PAIRS);
    expect(r.uniquePositions).toBeGreaterThanOrEqual(0.9 * JEANS_SOURCE_VERTS);
  });

  it("street jeans have no snap-collapsed triangles and keep the source vertex spread", async () => {
    const r = jeansCollapse(collect(await read(STREET), isLower));
    expect(r.tris).toBe(JEANS_SOURCE_TRIS);
    expect(r.pairs).toBeLessThanOrEqual(MAX_COINCIDENT_PAIRS);
    expect(r.uniquePositions).toBeGreaterThanOrEqual(0.9 * JEANS_SOURCE_VERTS);
  });
});

describe("shipped bob hair covers the crown skin", () => {
  it("clinical-nurse-adult hair passes the instrument", async () => {
    const doc = await read(NURSE);
    const r = crownSkinAboveHair(collect(doc, isHair), collect(doc, isSkin));
    expect(r.aboveHair).toBeLessThanOrEqual(MAX_SKIN_ABOVE_HAIR);
  });

  it("peds-parent bob has no crown skin above the hair", async () => {
    const doc = await read(PARENT);
    const r = crownSkinAboveHair(collect(doc, isHair), collect(doc, isSkin));
    expect(r.crownSamples).toBeGreaterThanOrEqual(MIN_CROWN_SAMPLES);
    expect(r.aboveHair).toBeLessThanOrEqual(MAX_SKIN_ABOVE_HAIR);
  });
});
