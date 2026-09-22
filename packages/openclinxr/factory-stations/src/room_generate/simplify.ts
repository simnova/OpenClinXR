import { NodeIO, type Primitive } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { meshopt as meshoptFn, simplifyPrimitive as simplifyPrimitiveFn, weldPrimitive as weldPrimitiveFn } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

/**
 * Post-bake room simplification with a trim pass.
 *
 * Runs AFTER the albedo and occlusion bakes (UV bake needs the full mesh;
 * simplifying before the bake destroys the bake target). Two passes:
 *
 * Pass 1 (shell): meshes not matching TRIM_LOCK_RE simplify with
 * MeshoptSimplifier at ratio 0.5 / error 0.01 (the FACE_PRESERVING_ERROR
 * from tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts; error=1
 * on tiny-component meshes is the recorded FAILED treatment there).
 *
 * Pass 2 (trim): locked meshes weld, then simplifyPrimitive at ratio 0.15 /
 * error 0.002. A flat skirting board collapses its tessellation; a door
 * casing keeps its frame because the tight error budget stops the simplifier
 * before it eats real shape. Each locked mesh is then checked: if its AABB
 * diagonal changes by more than 1% of the original diagonal, that mesh alone
 * reverts to its pre-pass-2 vertex buffer.
 *
 * Only the mesh's OWN referencing node names count for the lock (a mesh
 * shared under an unrelated node keeps its own identity). Meshopt compress
 * runs last.
 */

export const TRIM_LOCK_RE = /skirt|casing|door|window/i;

export const ROOM_SIMPLIFY_RATIO = 0.5;

/** Same value as FACE_PRESERVING_ERROR in iterate-optimize.ts. */
export const ROOM_SIMPLIFY_ERROR = 0.01;

/** Trim pass: tight enough that flat boards collapse but frames survive. */
export const ROOM_TRIM_RATIO = 0.15;

export const ROOM_TRIM_ERROR = 0.002;

/** AABB guard: revert a locked mesh whose diagonal drifts more than this. */
export const ROOM_TRIM_AABB_TOLERANCE = 0.01;

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
  trimReverted: string[];
  /** Per-locked-mesh |after-before|/before on live pre-compress buffers. */
  trimDiagonalDrift: Record<string, number>;
};

function meshTriangles(docMesh: { listPrimitives(): Array<{ getIndices(): { getCount(): number } | null }> }): number {
  let tris = 0;
  for (const prim of docMesh.listPrimitives()) {
    const idx = prim.getIndices();
    if (idx) tris += idx.getCount() / 3;
  }
  return Math.round(tris);
}

function primitiveIndexCounts(_docMesh: { listPrimitives(): Array<{ getIndices(): { getCount(): number } | null }> }): number[] {
  return _docMesh.listPrimitives().map((prim) => prim.getIndices()?.getCount() ?? 0);
}

void primitiveIndexCounts;

/**
 * Mesh-space AABB diagonal from live float buffers. Call only pre-compress:
 * after meshopt quantize the POSITION array is normalized SHORT ints and no
 * min/max reading recovers mesh units.
 */
function meshDiagonal(docMesh: { listPrimitives(): Primitive[] }): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const prim of docMesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const arr = pos?.getArray() as ArrayLike<number> | null;
    if (!pos || !arr) continue;
    const count = pos.getCount();
    for (let i = 0; i < count; i++) {
      const x = Number(arr[i * 3]), y = Number(arr[i * 3 + 1]), z = Number(arr[i * 3 + 2]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return 0;
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}

/** Snapshot every attribute + index array behind a locked mesh for AABB-guard revert. */
function snapshotPrimitiveBuffers(mesh: { listPrimitives(): Primitive[] }): Array<Map<string, unknown>> {
  return mesh.listPrimitives().map((prim) => {
    const snap = new Map<string, unknown>();
    const idx = prim.getIndices();
    if (idx?.getArray()) snap.set(":indices", (idx.getArray() as { slice(): unknown }).slice());
    for (const semantic of prim.listSemantics()) {
      const attr = prim.getAttribute(semantic);
      if (attr?.getArray()) snap.set(semantic, (attr.getArray() as { slice(): unknown }).slice());
    }
    return snap;
  });
}

function restorePrimitiveBuffers(
  mesh: { listPrimitives(): Primitive[] },
  snapshots: Array<Map<string, unknown>>,
): void {
  const prims = mesh.listPrimitives();
  for (let i = 0; i < prims.length && i < snapshots.length; i++) {
    const prim = prims[i] as Primitive;
    const snap = snapshots[i] as Map<string, unknown>;
    const idx = prim.getIndices();
    const idxSnap = snap.get(":indices");
    if (idx && idxSnap) idx.setArray(idxSnap as Parameters<typeof idx.setArray>[0]);
    for (const [semantic, arr] of snap) {
      if (semantic === ":indices") continue;
      const attr = prim.getAttribute(semantic);
      if (attr && arr) attr.setArray(arr as Parameters<typeof attr.setArray>[0]);
    }
  }
}

export function trimLockReason(meshName: string, nodeNames: readonly string[]): "mesh" | "node" | null {
  if (TRIM_LOCK_RE.test(meshName)) return "mesh";
  return nodeNames.some((nodeName) => TRIM_LOCK_RE.test(nodeName)) ? "node" : null;
}

export function isTrimLocked(meshName: string, nodeNames: readonly string[]): boolean {
  return trimLockReason(meshName, nodeNames) !== null;
}

/**
 * Simplify options.workGlb in place after both bakes. Pass 1 simplifies
 * shell meshes at ratio 0.5 / error 0.01 with weld first. Pass 2 welds then
 * simplifies locked trim meshes at ratio 0.15 / error 0.002; a locked mesh
 * whose AABB diagonal drifts more than 1% of its original diagonal reverts
 * to its pre-pass-2 vertex buffer (that mesh only). The GLB is
 * meshopt-compressed last.
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
  const lockedByMesh = new Map<string, boolean>();
  for (const mesh of meshes) {
    const locked = isTrimLocked(mesh.getName(), meshNodeNames.get(mesh.getName()) ?? []);
    lockedByMesh.set(mesh.getName(), locked);
    beforeByMesh.set(mesh.getName(), meshTriangles(mesh));
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

  const trimReverted: string[] = [];
  const trimDiagonalDrift: Record<string, number> = {};
  for (const mesh of meshes) {
    if (lockedByMesh.get(mesh.getName()) !== true) continue;
    const diagonalBefore = meshDiagonal(mesh);
    const snapshots = snapshotPrimitiveBuffers(mesh);
    for (const prim of mesh.listPrimitives()) {
      try {
        weldPrimitiveFn(prim);
      } catch {
        // Unweldable primitives still simplify from raw indices.
      }
      simplifyPrimitiveFn(prim, {
        simplifier: MeshoptSimplifier,
        ratio: ROOM_TRIM_RATIO,
        error: ROOM_TRIM_ERROR,
      });
    }
    const diagonalAfter = meshDiagonal(mesh);
    trimDiagonalDrift[mesh.getName()] =
      diagonalBefore > 0 ? Math.abs(diagonalAfter - diagonalBefore) / diagonalBefore : 0;
    const tolerance = diagonalBefore * ROOM_TRIM_AABB_TOLERANCE;
    if (Math.abs(diagonalAfter - diagonalBefore) > tolerance) {
      restorePrimitiveBuffers(mesh, snapshots);
      trimReverted.push(mesh.getName());
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
    trimReverted,
    trimDiagonalDrift,
  };
  for (const mesh of reread.getRoot().listMeshes()) {
    const locked = lockedByMesh.get(mesh.getName()) ?? false;
    const after = meshTriangles(mesh);
    const before = beforeByMesh.get(mesh.getName()) ?? after;
    report.meshes.push({ name: mesh.getName(), locked, before, after });
    if (locked) {
      report.lockedBefore += before;
      report.lockedAfter += after;
    } else {
      report.simplifiedBefore += before;
      report.simplifiedAfter += after;
    }
  }
  return report;
}
