import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Accessor, Document, NodeIO, Primitive } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import {
  MAX_ORPHAN_EXTENT_MM,
  ORPHAN_MAX_VERTS,
  countVisibleSkinPrims,
  measure,
  measureDocument,
} from "../lib/orphan-sliver-measure.js";
import type { OrphanSliverDetail } from "../lib/orphan-sliver-measure.js";
import { classifyGarmentMeshName } from "../lib/garment-mesh-class.js";

/**
 * R1: the merged-mode orphan count joins the per-prim count exactly where the
 * recon/merge probe said it would, and nowhere else.
 *
 * Expected merged counts below are the `m` column of
 * `/Volumes/files/openclinxr-assets/store/st-teeth/orphan-slivers-fleet/merge/merge-summary.json`
 * at sha b74790d66 (cross-checked against that file on 2026-11-19: every cell
 * matches, including kevin 16->2, physician 10->3, nurse 1->0, street 3->0).
 * The per-prim (`p`) column at the same sha reproduces this file's step-1
 * table byte-for-byte, so `p` is the control and `m` is the RED under test.
 *
 * CW1: on every shipped GLB whose body has ONE visible skin primitive, the
 * per-prim and merged paths return the same count AND the same per-sliver
 * faces/verts/extent/centroid (both paths run here; single-prim pooling is
 * the identity, so any divergence is a mode bug, not geometry).
 * CW2 (keepers): the kevin ankle pair (2 x 9 verts, 11.71 mm, prim 0) and the
 * physician ankle pair (2 x 12 verts, 47.07 mm, prim 0) survive merged mode
 * with extent within 0.01 mm
 * (merge-b74790d66-{kevin,physician}.json residuals).
 * CW3: in-memory fixture — appended skin prim sharing >= 2 position keys with
 * prim 0 joins it under merged (0 slivers) while staying a genuine sliver
 * candidate per-prim (1 sliver), so the fixture cannot pass vacuously.
 * CW4: appended-prim island sharing NO key, nearest vertex 26 mm from prim-0
 * skin, is 1 sliver under merged (values illustrative, physician-waist shape:
 * merge-detail.json records the real waist residual's mutual minD at
 * 26.16 mm; the point is key-equality, not distance merging).
 * CW5: fixture A with the appended prim offset 0.5 mm (keys no longer shared)
 * is 1 sliver under merged.
 * S3 (key boundary, no tolerance): pair P — the appended prim 0.009 mm off
 * prim 0, close enough to share four-decimal keys but rounding to DIFFERENT
 * five-decimal keys — stays a separate sliver under merged (1 sliver); pair
 * Q — the same fixture 0.004 mm off, sharing five-decimal keys — joins
 * (0 slivers). Values illustrative; the point is exact key equality, not
 * distance merging. A toFixed(4) instrument joins P and fails this clause.
 * S4 (physician residual exact): merged mode on the shipped physician GLB
 * carries the waist residual with exactly 5 faces / 8 verts / 80.13 mm
 * (+/- 0.01) and contributors [8, 10]; plus a two-triangle joined fixture
 * (2 faces, 4 unique verts, contributors [0, 1]) so first-contributor-only
 * attribution fails both halves. S5 (non-triangles): a skin-classified
 * LINES prim with 2 vertices 30 mm apart is skipped before allocation —
 * 0 slivers, 0 skin tris, listed in skippedNonTriangles (the old eager
 * `new Array(indexCount / 3)` allocation threw RangeError on it).
 *
 * Fixtures run through the SAME isSkin/hidden predicate as shipped GLBs
 * (measureDocument, not a reimplementation) and assert their prims classify
 * skin+visible plus skinTris > 0, so a predicate miss fails loudly instead of
 * passing with zero slivers.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

const FILES = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .sort()
  .map((n: string) => `${GENERATED}/${n}`);

/** b74790d66 merged (`m`) column of merge-summary.json, keyed by file. */
const EXPECTED_MERGED: Record<string, number> = {
  "mpfb-peds-nurse-kevin.glb": 2,
  "mpfb-street-adult-male.glb": 0,
  "mpfb-clinical-nurse-adult.glb": 0,
  "mpfb-clinical-physician-adult.glb": 3,
  "mpfb-ob-patient-aisha.glb": 6,
  "mpfb-viseme-inspect.glb": 6,
  "mpfb-peds-parent-aisha.glb": 5,
  "mpfb-family-partner-adult.glb": 4,
  "mpfb-gown-adult-patient.glb": 3,
  "mpfb-gown-inspect.glb": 3,
  "mpfb-gown-ed-robert-hayes.glb": 3,
  "mpfb-peds-patient-child.glb": 0,
};

/** Bodies with exactly one visible skin prim at b74790d66 (merge meshInfo). */
const EXPECTED_SINGLE_PRIM = [
  "mpfb-ob-patient-aisha.glb",
  "mpfb-peds-patient-child.glb",
  "mpfb-gown-adult-patient.glb",
  "mpfb-gown-inspect.glb",
  "mpfb-peds-parent-aisha.glb",
  "mpfb-family-partner-adult.glb",
  "mpfb-gown-ed-robert-hayes.glb",
  "mpfb-viseme-inspect.glb",
].sort();

const io = new NodeIO();
const rows = await Promise.all(FILES.map((f) => measure(f, "merged")));
const docs = await Promise.all(
  FILES.map(async (f) => ({ file: f.split("/").pop()!, doc: await io.read(join(REPO_ROOT, f)) })),
);

function sortedDetail(detail: OrphanSliverDetail[]): OrphanSliverDetail[] {
  return [...detail].sort(
    (a, b) =>
      a.faces - b.faces ||
      a.verts - b.verts ||
      a.extentMm - b.extentMm ||
      a.centroid[0] - b.centroid[0] ||
      a.centroid[1] - b.centroid[1] ||
      a.centroid[2] - b.centroid[2],
  );
}

describe("the orphan sliver count joins skin primitives", () => {
  it("R1: merged counts on the 12 shipped GLBs", () => {
    expect(
      FILES.map((f) => f.split("/").pop()),
      "shipped GLB file list changed; re-pin EXPECTED_MERGED",
    ).toEqual(Object.keys(EXPECTED_MERGED).sort());
    const got: Record<string, number> = {};
    for (const r of rows) got[r.file] = r.sliverDetail.length;
    expect(got, "merged orphan counts differ from merge-summary.json m column @b74790d66").toEqual(
      EXPECTED_MERGED,
    );
  });

  it("CW1: single-prim bodies agree per-prim vs merged", () => {
    const singles = docs.filter(({ doc }) => countVisibleSkinPrims(doc) === 1);
    expect(
      singles.map(({ file }) => file).sort(),
      "single-visible-skin-prim set changed; re-derive from merge meshInfo",
    ).toEqual(EXPECTED_SINGLE_PRIM);
    expect(singles.length, "no single-prim body found; CW1 would pass vacuously").toBeGreaterThan(0);
    for (const { file, doc } of singles) {
      const perPrim = sortedDetail(measureDocument(doc, file, "per-prim").sliverDetail);
      const merged = sortedDetail(measureDocument(doc, file, "merged").sliverDetail);
      expect(merged.length, `${file}: merged count != per-prim count`).toBe(perPrim.length);
      expect(merged, `${file}: merged detail != per-prim detail`).toEqual(perPrim);
    }
  });

  it("CW2: keepers survive merged (kevin 2x9v/11.71mm, physician 2x12v/47.07mm, prim 0)", () => {
    const kevin = rows.find((r) => r.file === "mpfb-peds-nurse-kevin.glb")!;
    const physician = rows.find((r) => r.file === "mpfb-clinical-physician-adult.glb")!;
    const kevinKeepers = kevin.sliverDetail.filter(
      (s) => s.verts === 9 && Math.abs(s.extentMm - 11.71) <= 0.01 && s.prims.join(",") === "0",
    );
    expect(kevinKeepers.length, `kevin keepers under merged: ${JSON.stringify(kevin.sliverDetail)}`).toBe(2);
    const physKeepers = physician.sliverDetail.filter(
      (s) => s.verts === 12 && Math.abs(s.extentMm - 47.07) <= 0.01 && s.prims.join(",") === "0",
    );
    expect(physKeepers.length, `physician keepers under merged: ${JSON.stringify(physician.sliverDetail)}`).toBe(2);
  });

  it("CW3: appended prim sharing >= 2 keys joins prim 0 under merged", () => {
    // prim 0: 5x5 grid, 25 unique verts, 80 mm extent (never a sliver).
    const grid = gridPatch(5, 0.02);
    // Island quad: two corners position-coincident with grid points (0,0,0) and
    // (0.02,0,0); 4 unique verts, 30 mm extent (a genuine sliver per-prim).
    const island = {
      pos: [[0, 0, 0], [0.02, 0, 0], [0, 0, 0.03], [0.02, 0, 0.03]],
      idx: [0, 1, 2, 1, 3, 2],
    };
    const doc = skinDoc(grid, island);
    assertSkinVisible(doc, 2);
    const merged = measureDocument(doc, "fixture-a", "merged");
    expect(merged.sliverDetail, "shared-key island must join prim 0 under merged").toEqual([]);
    const perPrim = measureDocument(doc, "fixture-a", "per-prim");
    expect(perPrim.sliverDetail.length, "island must be a genuine sliver per-prim").toBe(1);
    expect(perPrim.sliverDetail[0]!.verts).toBe(4);
    expect(perPrim.sliverDetail[0]!.extentMm).toBeGreaterThan(MAX_ORPHAN_EXTENT_MM);
  });

  it("CW4: key-disjoint island 26 mm off prim 0 stays 1 sliver under merged", () => {
    const grid = gridPatch(5, 0.02);
    // Nearest island vertex (0,0,0.026) sits exactly 26 mm above grid (0,0,0).
    const island = {
      pos: [[0, 0, 0.026], [0.03, 0, 0.026], [0, 0, 0.056], [0.03, 0, 0.056]],
      idx: [0, 1, 2, 1, 3, 2],
    };
    const doc = skinDoc(grid, island);
    assertSkinVisible(doc, 2);
    const dx = minDistanceToPrim0(grid.pos, island.pos);
    expect(Math.abs(dx * 1000 - 26) < 1e-6, `island nearest vertex must be 26 mm off prim 0 (got ${dx * 1000})`).toBe(true);
    expect(sharedKeyCount(grid.pos, island.pos), "fixture B must share no position keys").toBe(0);
    const merged = measureDocument(doc, "fixture-b", "merged");
    expect(merged.sliverDetail.length, "key-disjoint island must stay a sliver").toBe(1);
    expect(merged.sliverDetail[0]!.verts).toBe(4);
    expect(merged.sliverDetail[0]!.faces).toBe(2);
    expect(merged.sliverDetail[0]!.extentMm).toBeGreaterThan(MAX_ORPHAN_EXTENT_MM);
    expect(merged.sliverDetail[0]!.verts).toBeLessThanOrEqual(ORPHAN_MAX_VERTS);
  });

  it("CW5: fixture A island offset 0.5 mm is 1 sliver under merged", () => {
    const grid = gridPatch(5, 0.02);
    const DX = 0.0005;
    const island = {
      pos: [
        [DX, 0, 0],
        [0.02 + DX, 0, 0],
        [DX, 0, 0.03],
        [0.02 + DX, 0, 0.03],
      ],
      idx: [0, 1, 2, 1, 3, 2],
    };
    const doc = skinDoc(grid, island);
    assertSkinVisible(doc, 2);
    expect(sharedKeyCount(grid.pos, island.pos), "0.5 mm offset must break all shared keys").toBe(0);
    const merged = measureDocument(doc, "fixture-c", "merged");
    expect(merged.sliverDetail.length, "offset island must stay a sliver").toBe(1);
    const perPrim = measureDocument(doc, "fixture-c", "per-prim");
    expect(perPrim.sliverDetail.length).toBe(1);
    expect(perPrim.sliverDetail[0]!.extentMm).toBeGreaterThan(MAX_ORPHAN_EXTENT_MM);
  });

  it("S3: toFixed(5) key has no tolerance (P 0.009mm separates, Q 0.004mm joins)", () => {
    // Pair P: island 0.009 mm off the grid — under 0.01 mm yet rounding to
    // DIFFERENT five-decimal keys (0.00001 vs 0.00000, 0.02001 vs 0.02000),
    // while sharing four-decimal keys (0.0000, 0.0200).
    const grid = gridPatch(5, 0.02);
    const DX_P = 0.000009;
    const islandP = {
      pos: [
        [DX_P, 0, 0],
        [0.02 + DX_P, 0, 0],
        [DX_P, 0, 0.03],
        [0.02 + DX_P, 0, 0.03],
      ],
      idx: [0, 1, 2, 1, 3, 2],
    };
    const docP = skinDoc(grid, islandP);
    assertSkinVisible(docP, 2);
    const gapP = minDistanceToPrim0(grid.pos, islandP.pos);
    expect(gapP, "P must sit closer than 0.01 mm to prim 0").toBeGreaterThan(0);
    expect(gapP * 1000, "P must sit closer than 0.01 mm to prim 0").toBeLessThan(0.01);
    expect(sharedKeyCount(grid.pos, islandP.pos), "P must share no five-decimal key").toBe(0);
    const mergedP = measureDocument(docP, "fixture-s3p", "merged");
    expect(mergedP.sliverDetail.length, "P must stay a separate sliver (no tolerance)").toBe(1);
    expect(mergedP.sliverDetail[0]!.verts).toBe(4);
    // Pair Q: the same island 0.004 mm off — sharing five-decimal keys — joins.
    const DX_Q = 0.000004;
    const islandQ = {
      pos: [
        [DX_Q, 0, 0],
        [0.02 + DX_Q, 0, 0],
        [DX_Q, 0, 0.03],
        [0.02 + DX_Q, 0, 0.03],
      ],
      idx: [0, 1, 2, 1, 3, 2],
    };
    const docQ = skinDoc(grid, islandQ);
    assertSkinVisible(docQ, 2);
    expect(sharedKeyCount(grid.pos, islandQ.pos), "Q must share five-decimal keys").toBe(2);
    const mergedQ = measureDocument(docQ, "fixture-s3q", "merged");
    expect(mergedQ.sliverDetail, "Q must join prim 0 under merged").toEqual([]);
    const perPrimQ = measureDocument(docQ, "fixture-s3q", "per-prim");
    expect(perPrimQ.sliverDetail.length, "Q island must be a genuine sliver per-prim").toBe(1);
  });

  it("S4: physician waist residual exact (5f/8v/80.13mm/prims[8,10]) + joined pair attributes both prims", () => {
    const physician = rows.find((r) => r.file === "mpfb-clinical-physician-adult.glb")!;
    const waist = physician.sliverDetail.filter(
      (s) => s.faces === 5 && s.verts === 8 && Math.abs(Math.round(s.extentMm * 100) - 8013) <= 1,
    );
    expect(waist.length, `waist residual missing: ${JSON.stringify(physician.sliverDetail)}`).toBe(1);
    expect(waist[0]!.prims, "waist residual must join skin primitives 8 and 10").toEqual([8, 10]);
    // Two triangles sharing an edge: merged they are one 2-face / 4-vert
    // sliver with contributors [0, 1]; per-prim each is a genuine sliver.
    const t0 = { pos: [[0, 0, 0], [0.03, 0, 0], [0, 0, 0.03]], idx: [0, 1, 2] };
    const t1 = { pos: [[0, 0, 0], [0.03, 0, 0], [0.03, 0, 0.03]], idx: [0, 1, 2] };
    const doc = skinDoc(t0, t1);
    assertSkinVisible(doc, 2);
    const merged = measureDocument(doc, "fixture-s4", "merged");
    expect(merged.sliverDetail.length, "joined triangles must be one merged sliver").toBe(1);
    expect(merged.sliverDetail[0]).toMatchObject({ faces: 2, verts: 4, prims: [0, 1] });
    expect(merged.sliverDetail[0]!.extentMm).toBeGreaterThan(MAX_ORPHAN_EXTENT_MM);
    const perPrim = measureDocument(doc, "fixture-s4", "per-prim");
    expect(perPrim.sliverDetail.length, "each triangle must be a genuine sliver per-prim").toBe(2);
  });

  it("S5: skin LINES prim is skipped before allocation (0 slivers, listed)", () => {
    // Two vertices 30 mm apart as LINES: the old eager per-prim allocation
    // (`new Array(indexCount / 3)` on indexCount 2) threw RangeError here.
    const doc = new Document();
    const buffer = doc.createBuffer("fixture");
    const mat = doc.createMaterial(FIXTURE_MAT);
    mat.setAlphaMode("OPAQUE");
    const mesh = doc.createMesh(FIXTURE_MESH);
    const vec3 = Accessor.Type["VEC3"];
    if (vec3 === undefined) throw new Error("gltf-transform: Accessor.Type VEC3 is missing");
    const scalar = Accessor.Type["SCALAR"];
    if (scalar === undefined) throw new Error("gltf-transform: Accessor.Type SCALAR is missing");
    const posAcc = doc
      .createAccessor("POSITION")
      .setType(vec3)
      .setArray(new Float32Array([0, 0, 0, 0.03, 0, 0]))
      .setBuffer(buffer);
    const idxAcc = doc
      .createAccessor("indices")
      .setType(scalar)
      .setArray(new Uint16Array([0, 1]))
      .setBuffer(buffer);
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute("POSITION", posAcc)
        .setIndices(idxAcc)
        .setMaterial(mat)
        .setMode(Primitive.Mode.LINES),
    );
    expect(classifyGarmentMeshName(FIXTURE_MESH)).toBe("body");
    expect(classifyGarmentMeshName(FIXTURE_MAT)).toBe("body");
    for (const mode of ["per-prim", "merged"] as const) {
      const row = measureDocument(doc, "fixture-lines", mode);
      expect(row.sliverDetail, `${mode}: LINES prim must yield no slivers`).toEqual([]);
      expect(row.orphanSlivers, `${mode}: LINES prim must yield no slivers`).toEqual([]);
      expect(row.skinTris, `${mode}: LINES prim must count no skin triangles`).toBe(0);
      expect(row.skippedNonTriangles, `${mode}: LINES prim must be listed as skipped`).toEqual([
        `${FIXTURE_MESH}#0`,
      ]);
    }
    mesh.addPrimitive(doc.createPrimitive().setAttribute("POSITION", posAcc).setIndices(doc.createAccessor("tri").setType(scalar).setArray(new Uint16Array([0, 1, 0])).setBuffer(buffer)).setMaterial(mat));
    expect(countVisibleSkinPrims(doc), "counter must count the tri prim and exclude the LINES prim").toBe(1);
  });
});

/** Mesh/material names classify body through the shared classifier. */
const FIXTURE_MESH = "fixture_body";
const FIXTURE_MAT = "fixture_skin_surface";

function gridPatch(n: number, step: number): { pos: number[][]; idx: number[] } {
  const pos: number[][] = [];
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) pos.push([ix * step, iy * step, 0]);
  const idx: number[] = [];
  for (let iy = 0; iy < n - 1; iy++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = iy * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  return { pos, idx };
}

/** Two visible skin primitives on one body mesh, in-memory (no binary file). */
function skinDoc(
  prim0: { pos: number[][]; idx: number[] },
  prim1: { pos: number[][]; idx: number[] },
): Document {
  const doc = new Document();
  const buffer = doc.createBuffer("fixture");
  const mat = doc.createMaterial(FIXTURE_MAT);
  mat.setAlphaMode("OPAQUE");
  const mesh = doc.createMesh(FIXTURE_MESH);
  for (const p of [prim0, prim1]) {
    const vec3 = Accessor.Type["VEC3"];
    if (vec3 === undefined) throw new Error("gltf-transform: Accessor.Type VEC3 is missing");
    const scalar = Accessor.Type["SCALAR"];
    if (scalar === undefined) throw new Error("gltf-transform: Accessor.Type SCALAR is missing");
    const posAcc = doc
      .createAccessor("POSITION")
      .setType(vec3)
      .setArray(new Float32Array(p.pos.flat()))
      .setBuffer(buffer);
    const idxAcc = doc
      .createAccessor("indices")
      .setType(scalar)
      .setArray(new Uint16Array(p.idx))
      .setBuffer(buffer);
    mesh.addPrimitive(
      doc.createPrimitive().setAttribute("POSITION", posAcc).setIndices(idxAcc).setMaterial(mat),
    );
  }
  return doc;
}

/**
 * The fixture passes the same gate as shipped GLBs: names classify body, the
 * material is visible (OPAQUE), and the instrument counts skin triangles.
 * skinTris > 0 proves the prims were not skipped by the predicate.
 */
function assertSkinVisible(doc: Document, expectedSkinPrims: number): void {
  expect(classifyGarmentMeshName(FIXTURE_MESH)).toBe("body");
  expect(classifyGarmentMeshName(FIXTURE_MAT)).toBe("body");
  expect(countVisibleSkinPrims(doc)).toBe(expectedSkinPrims);
  const row = measureDocument(doc, "fixture", "merged");
  expect(row.skinTris, "fixture prims must count as visible skin").toBeGreaterThan(0);
}

function keySet(pos: number[][]): Set<string> {
  return new Set(pos.map((v) => v.map((x) => x.toFixed(5)).join(",")));
}

function sharedKeyCount(a: number[][], b: number[][]): number {
  const keys = keySet(a);
  return [...keySet(b)].filter((k) => keys.has(k)).length;
}

function minDistanceToPrim0(prim0: number[][], island: number[][]): number {
  let best = Infinity;
  for (const q of island) {
    for (const p of prim0) {
      const d = Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!);
      if (d < best) best = d;
    }
  }
  return best;
}
