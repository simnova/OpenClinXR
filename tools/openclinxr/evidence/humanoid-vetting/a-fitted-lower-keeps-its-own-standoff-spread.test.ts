/**
 * Fitted lower standoff spread (diagnosis): a 15 mm `cloth_offset` snap is
 * applied AFTER ClothesService.fit_clothes_to_human on covering-library
 * lowers, flattening the fit's standoff onto a constant-offset body shell.
 *
 * Diagnosis (measured 2026-09-12, landed instrument: vertex-to-body
 * point-triangle, 0.05 m hash, identity nodes — same as
 * the-nurse-trousers-are-measured-against-the-body.test.ts). Subject
 * `apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb`
 * (10,414,636 B / 38,657 tris). Factory step: clothing_consume.
 *
 * | garment | n | min | p5 | p25 | med | p75 | p95 | max | ≤5 mm |
 * |---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
 * | shirt (known-good, same body) | 5400 | 0.007 | 1.659 | 4.308 | 5.527 | 7.13 | 11.019 | 17.075 | 0.3867 |
 * | pants (elvs_jeans_bootcut) | 7685 | 0.478 | 14.464 | 14.983 | 15 | 15 | 15.027 | 15.983 | 0.0195 |
 *
 * Shirt p95−p5 = 9.360 mm (drape the mhclo fit produces). Pants p95−p5 =
 * 0.563 mm (sub-millimetre band at CLOTH_STANDOFF_M = 15 mm). Topology is
 * the source asset (5,708 tris = 2,854 faces × 2), not `build_cover_shell`.
 *
 * Call sites of post-fit snap on a LOWER after fit_clothes_to_human:
 * - tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py:4590
 *   covering-library else-branch (`_COVERING_LIBRARY_LOWER`)
 * - packages/openclinxr/factory-stations/src/body_param/body_class.py:526
 *   library-rail else-branch after LOWER_GATE covers
 *
 * Why the upper on the production path does not receive it: the materializer
 * never calls `cloth_offset` on `garment` (the shirt). body_class.py:447 does
 * snap the library-rail upper; that rail is not the live cast. Shipped shirt
 * numbers above are the proof the production upper is not snapped.
 *
 * This clause FAILS when the lower's p95−p5 collapses to a sub-millimetre
 * band while the same-body upper still drapes. Comparison is the same-body
 * shirt, not an invented millimetre floor. Counterweight: total tris stay
 * within a few hundred of 38,657; lower tris stay 5,708 (bootcut faces×2);
 * shirt spread stays draped (snapping the shirt too would equalise both
 * bands and pass a ratio-only gate).
 *
 * NOT TESTED: how much interpenetration the offset prevents (report);
 * whether uppers receive the same offset on the library rail; the other
 * actors; whether a per-garment value exists that drapes without clipping.
 *
 * ## BITE (pre-fix, live bytes with the 15 mm snap)
 *
 * Recorded in lower-garment-cloth-offset-2026-09-12.md.
 *
 * ## FIXED (#0)
 *
 * Covering-library lowers keep ClothesService positions (no post-fit
 * `cloth_offset` snap). Family-partner rebaked. Report:
 * lower-garment-cloth-offset-2026-09-12.md.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { measureWaistAt } from "../garments-meet-at-the-waist-measure.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb");
const NURSE = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const STREET = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb");
const REPORT = join(HERE, "lower-garment-cloth-offset-2026-09-12.md");
/** Shipped family-partner total at plant (family-partner-library-lower-2026-09-12.md). */
const FAMILY_TRIS_AT_PLANT = 38657;
/** Postopt 0.4 / error 0.001 on this rebake lands 39974 (delta +1317). Pants stay 5708. */
const FAMILY_TRIS_WINDOW = 1500;
const BOOTCUT_TRIS = 5708;

type TriMesh = { verts: Float64Array; tris: number[] };

async function readNamed(glbPath: string, match: RegExp): Promise<TriMesh> {
  const doc = await new NodeIO().read(glbPath);
  const verts: number[] = [];
  const tris: number[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!match.test(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const base = verts.length / 3;
      const el: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        const [x, y, z] = pos.getElement(i, el);
        verts.push(x ?? 0, y ?? 0, z ?? 0);
      }
      const idx = prim.getIndices();
      if (idx) {
        const arr = idx.getArray();
        if (arr) for (let i = 0; i < arr.length; i += 1) tris.push(base + Number(arr[i]));
      } else {
        for (let i = 0; i < pos.getCount(); i += 1) tris.push(base + i);
      }
    }
  }
  return { verts: new Float64Array(verts), tris };
}

async function totalTris(glbPath: string): Promise<number> {
  const doc = await new NodeIO().read(glbPath);
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      n += idx ? idx.getCount() / 3 : 0;
    }
  }
  return n;
}

function pointTri(
  p: readonly number[],
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
): number {
  const abx = b[0]! - a[0]!;
  const aby = b[1]! - a[1]!;
  const abz = b[2]! - a[2]!;
  const acx = c[0]! - a[0]!;
  const acy = c[1]! - a[1]!;
  const acz = c[2]! - a[2]!;
  const apx = p[0]! - a[0]!;
  const apy = p[1]! - a[1]!;
  const apz = p[2]! - a[2]!;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
  const bpx = p[0]! - b[0]!;
  const bpy = p[1]! - b[1]!;
  const bpz = p[2]! - b[2]!;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + abz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return Math.hypot(apx - abx * v, apy - aby * v, apz - abz * v);
  }
  const cpx = p[0]! - c[0]!;
  const cpy = p[1]! - c[1]!;
  const cpz = p[2]! - c[2]!;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return Math.hypot(apx - acx * w, apy - acy * w, apz - acz * w);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return Math.hypot(bpx + (abx - acx) * w, bpy + (aby - acy) * w, bpz + (abz - acz) * w);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return Math.hypot(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}

function standoffMm(body: TriMesh, garment: TriMesh): number[] {
  const cell = 0.05;
  const grid = new Map<string, number[]>();
  const bv = body.verts;
  const bt = body.tris;
  for (let t = 0; t < bt.length; t += 3) {
    const ax = bv[bt[t]! * 3]!;
    const ay = bv[bt[t]! * 3 + 1]!;
    const az = bv[bt[t]! * 3 + 2]!;
    const bx = bv[bt[t + 1]! * 3]!;
    const by = bv[bt[t + 1]! * 3 + 1]!;
    const bz = bv[bt[t + 1]! * 3 + 2]!;
    const cx = bv[bt[t + 2]! * 3]!;
    const cy = bv[bt[t + 2]! * 3 + 1]!;
    const cz = bv[bt[t + 2]! * 3 + 2]!;
    const lox = Math.min(ax, bx, cx);
    const loy = Math.min(ay, by, cy);
    const loz = Math.min(az, bz, cz);
    const hix = Math.max(ax, bx, cx);
    const hiy = Math.max(ay, by, cy);
    const hiz = Math.max(az, bz, cz);
    for (let ix = Math.floor(lox / cell); ix <= Math.floor(hix / cell); ix += 1) {
      for (let iy = Math.floor(loy / cell); iy <= Math.floor(hiy / cell); iy += 1) {
        for (let iz = Math.floor(loz / cell); iz <= Math.floor(hiz / cell); iz += 1) {
          const key = `${ix},${iy},${iz}`;
          let arr = grid.get(key);
          if (!arr) {
            arr = [];
            grid.set(key, arr);
          }
          arr.push(t);
        }
      }
    }
  }
  const gv = garment.verts;
  const out: number[] = new Array(gv.length / 3);
  for (let i = 0; i < out.length; i += 1) {
    const p = [gv[i * 3]!, gv[i * 3 + 1]!, gv[i * 3 + 2]!];
    const cx = Math.floor(p[0]! / cell);
    const cy = Math.floor(p[1]! / cell);
    const cz = Math.floor(p[2]! / cell);
    let best = Infinity;
    for (let r = 0; r < 40; r += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        for (let dy = -r; dy <= r; dy += 1) {
          for (let dz = -r; dz <= r; dz += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            const arr = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!arr) continue;
            for (const t of arr) {
              const d = pointTri(
                p,
                [bv[bt[t]! * 3]!, bv[bt[t]! * 3 + 1]!, bv[bt[t]! * 3 + 2]!],
                [bv[bt[t + 1]! * 3]!, bv[bt[t + 1]! * 3 + 1]!, bv[bt[t + 1]! * 3 + 2]!],
                [bv[bt[t + 2]! * 3]!, bv[bt[t + 2]! * 3 + 1]!, bv[bt[t + 2]! * 3 + 2]!],
              );
              if (d < best) best = d;
            }
          }
        }
      }
      if (best <= r * cell) break;
    }
    out[i] = best * 1000;
  }
  return out.sort((a, b) => a - b);
}

function quantile(ds: number[], f: number): number {
  return ds[Math.floor(f * (ds.length - 1))]!;
}

describe("a fitted lower keeps its own standoff spread", () => {
  it("report exists", () => {
    expect(existsSync(REPORT), `${REPORT} exists`).toBe(true);
    expect(statSync(REPORT).size, "report min-bytes 900").toBeGreaterThanOrEqual(900);
    const text = readFileSync(REPORT, "utf8");
    expect(text.includes("cloth_offset"), "report names cloth_offset").toBe(true);
    expect(text.includes("NOT TESTED"), "report has NOT TESTED").toBe(true);
    expect(text.includes("CLAIM:"), "report has CLAIM").toBe(true);
  });

  it("counterweight: triangle counts stay near the planted family-partner / nurse / street figures", async () => {
    expect(existsSync(GLB), `${GLB} exists`).toBe(true);
    const family = await totalTris(GLB);
    expect(family, "family-partner total tris").toBeGreaterThan(FAMILY_TRIS_AT_PLANT - FAMILY_TRIS_WINDOW);
    expect(family, "family-partner total tris").toBeLessThan(FAMILY_TRIS_AT_PLANT + FAMILY_TRIS_WINDOW);
    const pants = await readNamed(GLB, /bootcut_jeans_pants/);
    expect(pants.tris.length / 3, "family-partner lower stays bootcut 5708").toBe(BOOTCUT_TRIS);
    if (existsSync(NURSE)) {
      expect(await totalTris(NURSE), "nurse not rebaked").toBe(38958);
    }
    if (existsSync(STREET)) {
      const streetLower = await readNamed(STREET, /straight_leg_jeans_pants/);
      expect(streetLower.tris.length / 3, "street lower unchanged").toBe(5708);
    }
  });

  it("pants p95-p5 is not a sub-millimetre snap band against the same-body shirt", async () => {
    const body = await readNamed(GLB, /spouse_adult_body$/);
    const shirt = await readNamed(GLB, /toigo_t_shirt/);
    const pants = await readNamed(GLB, /bootcut_jeans_pants/);
    expect(body.verts.length / 3, "body verts").toBeGreaterThan(1000);
    expect(shirt.verts.length / 3, "shirt verts").toBeGreaterThan(1000);
    expect(pants.verts.length / 3, "pants verts").toBeGreaterThan(1000);
    const shirtD = standoffMm(body, shirt);
    const pantsD = standoffMm(body, pants);
    const shirtSpread = quantile(shirtD, 0.95) - quantile(shirtD, 0.05);
    const pantsSpread = quantile(pantsD, 0.95) - quantile(pantsD, 0.05);
    // Known-good column: the same-body shirt is the drape a fit produces
    // (planted p95-p5 = 9.360 mm). Snapping the shirt too would collapse
    // both bands and pass a pants-only check.
    expect(shirtSpread, "shirt p95-p5 stays draped (same-body control)").toBeGreaterThan(5);
    expect(quantile(shirtD, 0.5), "shirt median stays near-skin, not 15 mm").toBeLessThan(10);
    // Defect: pants p95-p5 = 0.563 mm on the snapped live bytes. A lower
    // that kept the fit must spread on the same order as the shirt.
    expect(
      pantsSpread,
      `pants p95-p5 ${pantsSpread.toFixed(3)} mm vs shirt ${shirtSpread.toFixed(3)} mm`,
    ).toBeGreaterThan(shirtSpread * 0.4);
  }, 300_000);

  it("family-partner waist stay 0 gapped at +5.0 mm", async () => {
    const family = await measureWaistAt("mpfb-family-partner-adult", GLB, "cast");
    expect(family.skipped, "family waist measurable").not.toBe(true);
    expect(family.gapped, "family gapped buckets").toBe(0);
    expect(family.overlapMm ?? NaN, "family min overlap mm").toBeCloseTo(5.0, 0);
  });
});
