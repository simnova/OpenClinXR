import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { meshopt as meshoptFn, simplifyPrimitive as simplifyPrimitiveFn, weldPrimitive as weldPrimitiveFn } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

/**
 * Post-bake room trim-locked simplification.
 *
 * Runs AFTER the albedo and occlusion bakes (UV bake needs the full mesh;
 * simplifying before the bake destroys the bake target). Meshes whose own
 * name or whose referencing node name matches TRIM_LOCK_RE are never passed
 * to the simplifier — their triangle counts are bit-identical after the run.
 * Everything else simplifies with MeshoptSimplifier at ratio 0.5 / error 0.01
 * (the FACE_PRESERVING_ERROR from
 * tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts; error=1 on
 * tiny-component meshes is the recorded FAILED treatment there), weld first,
 * then meshopt-compresses the GLB.
 */

export const TRIM_LOCK_RE = /skirt|casing|door|window/i;

export const ROOM_SIMPLIFY_RATIO = 0.5;

/** Same value as FACE_PRESERVING_ERROR in iterate-optimize.ts. */
export const ROOM_SIMPLIFY_ERROR = 0.01;

export type RoomSimplifySplit = {
  name: string;
  locked: boolean;
  before: number;
  after: number;
};

export type RoomSimplifyReport = {
  meshes: RoomSimplifySplit[];
  lockedBefore: number;
  lockedAfter: number;
  simplifiedBefore: number;
  simplifiedAfter: number;
};

function meshTriangles(docMesh: { listPrimitives(): Array<{ getIndices(): { getCount(): number } | null }> }): number {
  let tris = 0;
  for (const prim of docMesh.listPrimitives()) {
    const idx = prim.getIndices();
    if (idx) tris += idx.getCount() / 3;
  }
  return Math.round(tris);
}

function primitiveIndexCounts(docMesh: { listPrimitives(): Array<{ getIndices(): { getCount(): number } | null }> }): number[] {
  return docMesh.listPrimitives().map((prim) => prim.getIndices()?.getCount() ?? 0);
}

export function isTrimLocked(meshName: string, nodeNames: readonly string[]): boolean {
  if (TRIM_LOCK_RE.test(meshName)) return true;
  return nodeNames.some((nodeName) => TRIM_LOCK_RE.test(nodeName));
}

/**
 * Simplify options.workGlb in place after both bakes. Locked meshes keep
 * identical triangle counts; other meshes simplify at ratio 0.5 / error 0.01
 * with weld first; the GLB is meshopt-compressed last, with the lock asserted
 * on primitive index counts after compress so a compress that reorders or
 * merges primitives fails loudly instead of silently eating trim.
 */
export async function simplifyRoomAfterBake(workGlb: string): Promise<RoomSimplifyReport> {
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });
  const doc = await io.read(workGlb);

  const meshNodeNames = new Map<string, string[]>();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const list = meshNodeNames.get(mesh.getName()) ?? [];
    list.push(node.getName());
    meshNodeNames.set(mesh.getName(), list);
  }

  const meshes = doc.getRoot().listMeshes();
  const beforeByMesh = new Map<string, number>();
  const lockedIndexCounts = new Map<string, number[]>();
  const lockedByMesh = new Map<string, boolean>();
  for (const mesh of meshes) {
    const locked = isTrimLocked(mesh.getName(), meshNodeNames.get(mesh.getName()) ?? []);
    lockedByMesh.set(mesh.getName(), locked);
    beforeByMesh.set(mesh.getName(), meshTriangles(mesh));
    if (locked) lockedIndexCounts.set(mesh.getName(), primitiveIndexCounts(mesh));
  }

  for (const mesh of meshes) {
    if (lockedByMesh.get(mesh.getName()) === true) continue;
    for (const prim of mesh.listPrimitives()) {
      try {
        weldPrimitiveFn(prim);
      } catch {
        // Unweldable primitives still simplify from raw indices.
      }
      simplifyPrimitiveFn(prim, {
        simplifier: MeshoptSimplifier,
        ratio: ROOM_SIMPLIFY_RATIO,
        error: ROOM_SIMPLIFY_ERROR,
      });
    }
  }

  await doc.transform(meshoptFn({ encoder: MeshoptEncoder }));
  await io.write(workGlb, doc);

  const reread = await io.read(workGlb);
  const report: RoomSimplifyReport = {
    meshes: [],
    lockedBefore: 0,
    lockedAfter: 0,
    simplifiedBefore: 0,
    simplifiedAfter: 0,
  };
  for (const mesh of reread.getRoot().listMeshes()) {
    const locked = lockedByMesh.get(mesh.getName()) ?? false;
    const after = meshTriangles(mesh);
    const before = beforeByMesh.get(mesh.getName()) ?? after;
    report.meshes.push({ name: mesh.getName(), locked, before, after });
    if (locked) {
      report.lockedBefore += before;
      report.lockedAfter += after;
      const counts = primitiveIndexCounts(mesh);
      const expected = lockedIndexCounts.get(mesh.getName()) ?? [];
      if (counts.length !== expected.length || counts.some((count, i) => count !== expected[i])) {
        throw new Error(
          `simplifyRoomAfterBake: locked mesh ${JSON.stringify(mesh.getName())} changed ` +
            `(${expected.join(",")} -> ${counts.join(",")}); trim must be unchanged`,
        );
      }
    } else {
      report.simplifiedBefore += before;
      report.simplifiedAfter += after;
    }
  }
  return report;
}
