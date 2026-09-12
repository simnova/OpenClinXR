/**
 * Nurse trousers vs body (measure-only): the scrub trousers are recorded as a
 * body-derived cover shell against the fitted shirt column, not refit here.
 *
 * Diagnosis (measured 2026-09-12, instrument-only, live GLB bytes — no Blender
 * opened). Subject
 * `apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb`
 * (8,396,376 B / 38,958 tris — collar/sleeve + waistband known-goods).
 *
 * Exact vertex-to-body-surface standoff (every garment vertex vs every body
 * triangle, point-triangle distance, 0.05 m spatial hash, identity nodes):
 *
 * | garment | n | min | p5 | p25 | med | p75 | p95 | max |
 * |---|---:|---:|---:|---:|---:|---:|---:|---:|
 * | shirt | 18768 | 0 | 2.87 | 5.11 | 6.5 | 7.89 | 11.08 | 18.7 |
 * | pants | 5404 | 0.175 | 14.56 | 14.97 | 15 | 15 | 15.28 | 15.6 |
 *
 * | garment | <=1mm | <=2mm | <=5mm |
 * |---|---:|---:|---:|
 * | shirt | 0.0091 | 0.0249 | 0.2345 |
 * | pants | 0.003 | 0.0044 | 0.0096 |
 *
 * Verbatim-copy check (1e-6): 0 / 5404 pants verts, 0 / 18768 shirt verts
 * coincide with a body vertex. Both scrub materials are OPAQUE, flat
 * baseColorFactor [0.05, 0.48, 0.52], no bound baseColor texture (GLB textures
 * are MJ-shoes3 / skin-normal / skin-baked / blue_eye only).
 *
 * Comparison column (known-good): mat_makeclothes_library_scrub_shirt on the
 * same body at 9,384 triangles reads as cloth in the same capture.
 *
 * Report: nurse-trouser-shell-2026-09-12.md. This clause asserts the REPORT
 * and that the live bytes still match it. Any refit, rebake, promotion,
 * threshold, or waist-hem work is out of scope.
 *
 * NOT TESTED: the other eight bodies; whether an mhclo refit would clip; any
 * treatment at all — this card measures only.
 *
 * ## FIXED (#0)
 *
 * First planting run. No geometry changed.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const REPORT = join(HERE, "nurse-trouser-shell-2026-09-12.md");

type TriMesh = { verts: Float64Array; tris: number[] };

async function readMesh(match: RegExp): Promise<TriMesh> {
  const doc = await new NodeIO().read(GLB);
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
  const d4 = acx * bpx + acy * bpy + acz * bpz;
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

describe("the nurse trousers are measured against the body", () => {
  it("report exists and records the live shell measurement", () => {
    expect(existsSync(REPORT), `${REPORT} exists`).toBe(true);
    expect(statSync(REPORT).size, "report min-bytes 900").toBeGreaterThanOrEqual(900);
    const text = readFileSync(REPORT, "utf8");
    expect(text.includes("| pants | 5404"), "report records pants population").toBe(true);
    expect(text.includes("15.28"), "report records pants p95 15.28").toBe(true);
    expect(text.includes("6.5"), "report records shirt median 6.5").toBe(true);
    expect(text.includes("NOT TESTED"), "report has NOT TESTED").toBe(true);
  });

  it("live meshes are the fitted-shirt and shell-trouser pair", async () => {
    expect(existsSync(GLB), `${GLB} exists`).toBe(true);
    const shirt = await readMesh(/scrub_shirt/);
    const pants = await readMesh(/scrub_pants/);
    expect(shirt.tris.length / 3, "shirt is the 9,384-tri known-good").toBe(9384);
    expect(pants.tris.length / 3, "pants are 2,704 tris").toBe(2704);
    expect(shirt.verts.length / 3, "shirt verts").toBe(18768);
    expect(pants.verts.length / 3, "pants verts").toBe(5404);
  });

  it("scrub materials are flat untextured colour in the live GLB", async () => {
    const doc = await new NodeIO().read(GLB);
    for (const mat of doc.getRoot().listMaterials()) {
      const name = mat.getName();
      if (!/scrub/i.test(name)) continue;
      expect(mat.getBaseColorTexture(), `${name} has no baseColor texture`).toBe(null);
      expect(JSON.stringify(mat.getBaseColorFactor()), `${name} flat teal`).toBe(
        JSON.stringify([0.05, 0.48, 0.52, 1]),
      );
    }
  });

  it("trousers ride as a uniform shell against the draped shirt column", async () => {
    const body = await readMesh(/nurse_adult_body/);
    const shirt = await readMesh(/scrub_shirt/);
    const pants = await readMesh(/scrub_pants/);
    const shirtD = standoffMm(body, shirt);
    const pantsD = standoffMm(body, pants);
    const quantile = (ds: number[], f: number): number => ds[Math.floor(f * (ds.length - 1))]!;
    const share = (ds: number[], t: number): number =>
      ds.filter((d) => d <= t).length / ds.length;
    expect(quantile(pantsD, 0.5), "pants median is the ~15 mm shell").toBeCloseTo(15, 0);
    expect(quantile(pantsD, 0.05), "pants p5 rides off the skin").toBeGreaterThan(10);
    expect(quantile(pantsD, 0.95) - quantile(pantsD, 0.05), "pants band is narrow").toBeLessThan(2);
    expect(share(pantsD, 5), "pants have <2% within 5 mm").toBeLessThan(0.02);
    expect(quantile(shirtD, 0.5), "shirt median is draped near skin").toBeLessThan(10);
    expect(quantile(shirtD, 0.95) - quantile(shirtD, 0.05), "shirt spread is draped").toBeGreaterThan(5);
    expect(share(shirtD, 5), "shirt has real near-skin share").toBeGreaterThan(0.1);
  }, 300_000);
});
