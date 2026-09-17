/**
 * Equipment GLB finalize station: the deterministic cleanup pass every promoted
 * medical-equipment GLB should go through before it is written into
 * apps/ui-xr/public/xr-assets/medical-equipment/, regardless of source rail
 * (Kenney CC0 promote, Sketchfab CC-BY normalize, or TRELLIS bake/decimate).
 *
 * MEASURED defects this closes (2026-09-16, real shipped equipment GLBs):
 *  - exam-table-sketchfab-ccby.glb: 15 materials each embedded a byte-identical
 *    203,149-byte PNG (verified via sha256 on the decoded image bytes). dedup()
 *    collapses 15 textures + 15 materials -> 1 each: 3,381,996 -> 532,224 bytes
 *    (84.3% smaller), lossless (all 15 materials were already property-identical:
 *    same roughness/metallic/alphaMode/doubleSided/emissive/alphaCutoff, same UV
 *    set). @gltf-transform/functions:dedup was already an installed dependency,
 *    already imported elsewhere in this pipeline (trellis-pack-cli.ts,
 *    vr-postopt-ladder.ts) for OTHER passes, and never run on this asset.
 *  - clinic-chair-kenney-cc0.glb: 8 of 170 triangles (4.7%) are zero-area
 *    (cross-product length < epsilon) — geometry baked in by the raw Kenney
 *    source mesh, carried through kenney-promote-cli.ts's bakeTransformsAndScale
 *    untouched. 170 -> 162 real triangles, 10,424 -> 9,320 bytes.
 *  - bedside-monitor-generated.glb: 15 of 60,000 triangles are zero-area, AND
 *    (the dominant defect) 49,511 of 136,548 vertices (36.3%) are referenced by
 *    NO triangle at all — orphaned POSITION/NORMAL/TEXCOORD_0 data left behind by
 *    the meshopt decimation ladder in .openclinxr/evidence/issue-250 before its
 *    "copy byte-identical" promote. compactPrimitive() (already an installed
 *    @gltf-transform/functions export, never called on this asset) removes them:
 *    8,375,032 -> 6,790,504 bytes (18.9% smaller), same 59,985 real triangles,
 *    same AABB, same visible surface.
 *
 * Verified NOT present on wall-clock-analog.glb, exam-table's siblings
 * (hospital-bed, privacy-curtain, stretcher), iv-pole-with-pump.glb, and
 * ecg-cart-12-lead.glb: 0 orphaned vertices, 0 degenerate triangles, textures
 * (where present) already unique by content hash. Do not re-run this station as
 * a hypothesis generator against those; the measurement already says clean.
 *
 * claimScope: geometry/texture-datablock cleanup only (dedup + degenerate-triangle
 * removal + unreferenced-vertex compaction + prune). notEvidenceFor: visual
 * realism, clinical validity, Quest frame-budget readiness, KTX2/texture-resize
 * (MADR 0050 steps 6-7 remain unimplemented; the local machine has no toktx/
 * basisu/ktx binary and the installed gltfpack npm build was compiled without
 * BasisU support — measured 2026-09-16, `gltfpack -tc` refuses with "gltfpack was
 * built without BasisU support" and `gltf-transform optimize --texture-compress
 * ktx2` fails the same way on `command -v ktx`).
 */
import { NodeIO, type Document, type Primitive } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { compactPrimitive, dedup, prune } from "@gltf-transform/functions";
import { readFileSync, statSync, writeFileSync } from "node:fs";

export type FinalizeEquipmentGlbReport = {
  /** Sum of triangles across unique Mesh datablocks — correlates with file bytes and dedup savings. */
  trianglesBefore: number;
  trianglesAfter: number;
  degenerateTrianglesRemoved: number;
  /** Sum of vertices across unique Mesh datablocks — correlates with file bytes and compaction savings. */
  verticesBefore: number;
  verticesAfter: number;
  orphanedVerticesRemoved: number;
  texturesBefore: number;
  texturesAfter: number;
  materialsBefore: number;
  materialsAfter: number;
  bytesBefore: number;
  bytesAfter: number;
  /**
   * Triangles as they actually render: a Mesh referenced by N scene nodes
   * (glTF node-level instancing — measured on iv-pole-with-pump.glb and
   * ecg-cart-12-lead.glb, 8 legs/segments each referencing their own Mesh)
   * counts N times. dedup() can legitimately collapse several node-instanced
   * Mesh OBJECTS sharing byte-identical geometry into one shared Mesh —
   * `trianglesBefore/After` above would then report that consolidation as a
   * ~75% geometry loss (fewer unique Mesh datablocks) when every node and its
   * rendered triangle survives unchanged. These two fields are the ground
   * truth for "did anything visible change"; finalizeEquipmentGlbDocument
   * THROWS rather than return a report if they disagree with
   * degenerateTrianglesRemoved (see the invariant check below).
   */
  renderedTrianglesBefore: number;
  renderedTrianglesAfter: number;
};

function countTriangles(doc: Document): number {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) {
        tris += Math.floor(idx.getCount() / 3);
      } else {
        const pos = prim.getAttribute("POSITION");
        if (pos) tris += Math.floor(pos.getCount() / 3);
      }
    }
  }
  return tris;
}

function countVertices(doc: Document): number {
  let v = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (pos) v += pos.getCount();
    }
  }
  return v;
}

/** Walks every node instance in every scene, so a Mesh referenced by N nodes counts N times. */
function countRenderedTriangles(doc: Document): number {
  let tris = 0;
  const visit = (node: import("@gltf-transform/core").Node): void => {
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const idx = prim.getIndices();
        if (idx) {
          tris += Math.floor(idx.getCount() / 3);
        } else {
          const pos = prim.getAttribute("POSITION");
          if (pos) tris += Math.floor(pos.getCount() / 3);
        }
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const scene of doc.getRoot().listScenes()) {
    for (const child of scene.listChildren()) visit(child);
  }
  return tris;
}

function triangleArea2(a: number[], b: number[], c: number[]): number {
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
  const nrm = [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
  return Math.hypot(nrm[0]!, nrm[1]!, nrm[2]!);
}

/**
 * Removes zero-area triangles from an indexed primitive's index buffer, then
 * compacts the primitive so vertices no longer referenced by any surviving
 * triangle are dropped from the vertex attribute streams. Non-indexed
 * primitives are left untouched (rare for shipped equipment; none measured).
 *
 * @param epsilon Cross-product length below which a triangle is degenerate.
 *   1e-12 catches exact and near-exact zero-area triangles (coincident or
 *   colinear vertices) without touching legitimately thin real geometry —
 *   the smallest triangle observed across every clean shipped equipment GLB
 *   measured for this station is many orders of magnitude larger.
 * @returns number of triangles removed from this primitive.
 */
export function removeDegenerateTrianglesFromPrimitive(prim: Primitive, epsilon = 1e-12): number {
  const pos = prim.getAttribute("POSITION");
  const idx = prim.getIndices();
  if (!pos || !idx) return 0;
  const posArr = pos.getArray();
  if (!posArr) return 0;
  const size = pos.getElementSize();
  const idxArr = idx.getArray();
  if (!idxArr) return 0;
  const at = (vertexIndex: number): number[] => [
    posArr[vertexIndex * size]!,
    posArr[vertexIndex * size + 1]!,
    posArr[vertexIndex * size + 2]!,
  ];
  const kept: number[] = [];
  let removed = 0;
  for (let i = 0; i + 2 < idxArr.length; i += 3) {
    const ia = idxArr[i]!;
    const ib = idxArr[i + 1]!;
    const ic = idxArr[i + 2]!;
    if (triangleArea2(at(ia), at(ib), at(ic)) < epsilon) {
      removed++;
      continue;
    }
    kept.push(ia, ib, ic);
  }
  if (removed === 0) return 0;
  const IndexArrayCtor = idxArr.constructor as new (values: number[]) => typeof idxArr;
  idx.setArray(new IndexArrayCtor(kept));
  compactPrimitive(prim);
  return removed;
}

/**
 * Mutates `doc` in place: dedup (Accessor/Mesh/Texture/Material) -> per-primitive
 * degenerate-triangle removal + compaction -> prune (drops now-unreferenced
 * textures/materials/accessors). Order matters: dedup first so degenerate-triangle
 * detection and compaction run once per de-duplicated primitive, not once per
 * (still-duplicated) copy; prune last so accessors/textures orphaned by either
 * earlier step are actually dropped from the written GLB.
 */
export async function finalizeEquipmentGlbDocument(doc: Document): Promise<FinalizeEquipmentGlbReport> {
  const trianglesBefore = countTriangles(doc);
  const verticesBefore = countVertices(doc);
  const texturesBefore = doc.getRoot().listTextures().length;
  const materialsBefore = doc.getRoot().listMaterials().length;
  const renderedTrianglesBefore = countRenderedTriangles(doc);

  await doc.transform(dedup());

  let degenerateTrianglesRemoved = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      degenerateTrianglesRemoved += removeDegenerateTrianglesFromPrimitive(prim);
    }
  }

  await doc.transform(prune());

  const renderedTrianglesAfter = countRenderedTriangles(doc);
  const expectedRenderedTrianglesAfter = renderedTrianglesBefore - degenerateTrianglesRemoved;
  if (renderedTrianglesAfter !== expectedRenderedTrianglesAfter) {
    // Fail closed: dedup()/prune() must never remove rendered geometry beyond
    // the zero-area triangles this station explicitly counted and removed.
    // If a future gltf-transform version (or a future edit to this file)
    // makes dedup less conservative, this stops a silent geometry loss from
    // shipping instead of surfacing it as a passing report with a smaller
    // triangle count — the exact confusion this check was written to end.
    throw new Error(
      `finalizeEquipmentGlbDocument: rendered triangle count changed by more than the ` +
        `${degenerateTrianglesRemoved} degenerate triangles removed ` +
        `(before=${renderedTrianglesBefore}, after=${renderedTrianglesAfter}, ` +
        `expected=${expectedRenderedTrianglesAfter}). Refusing to report success.`,
    );
  }

  return {
    trianglesBefore,
    trianglesAfter: countTriangles(doc),
    degenerateTrianglesRemoved,
    verticesBefore,
    verticesAfter: countVertices(doc),
    orphanedVerticesRemoved: 0, // filled in by caller once vertex counts are known (see below)
    texturesBefore,
    texturesAfter: doc.getRoot().listTextures().length,
    materialsBefore,
    materialsAfter: doc.getRoot().listMaterials().length,
    bytesBefore: 0,
    bytesAfter: 0,
    renderedTrianglesBefore,
    renderedTrianglesAfter,
  };
}

/** Reads sourcePath, finalizes, writes targetPath (or back to sourcePath). Returns the measured report. */
export async function finalizeEquipmentGlbFile(
  sourcePath: string,
  targetPath: string,
): Promise<FinalizeEquipmentGlbReport> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const bytesBefore = statSync(sourcePath).size;
  const doc = await io.readBinary(readFileSync(sourcePath));
  const report = await finalizeEquipmentGlbDocument(doc);
  const out = await io.writeBinary(doc);
  writeFileSync(targetPath, out);
  return {
    ...report,
    orphanedVerticesRemoved: report.verticesBefore - report.verticesAfter,
    bytesBefore,
    bytesAfter: out.length,
  };
}
