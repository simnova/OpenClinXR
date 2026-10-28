/**
 * room-interior-clear.ts — wall-inner-face interior-clear measurement for shipped room GLBs.
 *
 * Source authority: `packages/openclinxr/factory-stations/src/room_generate/infinigen_generate/probe_door.py`
 * (the generate-step Blender probe). Its wall-plane derivation is ported here verbatim in method, adapted
 * only in frame: the blend frame is Z-up with the depth axis on blend-Y, while the shipped GLB frame is
 * Y-up with the depth axis on glTF-Z. So blend-X -> glTF-X, blend-Y -> glTF-Z, blend-Z -> glTF-Y; the wall
 * axes measured here are X and Z, and horizontal (Y-normal) faces are skipped exactly as the probe skips
 * Z-normal faces.
 *
 * Why this exists: the finished-room shell floor runs through the doorway opening to the outer wall face
 * (the threshold tab, +0.11 m on the door wall only — facade-executed Blender probe on the real chain bytes:
 * inpatient interiorClear 4.300 x 3.900 exact, only in-door-band floor verts reach the outer face). The floor
 * AABB therefore overreads depth by the tab while the wall inner faces land the `configure()` interior-clear
 * contract (interior clear floor W x D centred on origin) exactly on both axes, fleet-wide. Instruments that
 * assert "the room matches its declared footprint" must read the wall inner faces, never the floor AABB.
 *
 * What this does NOT do (by contract, not by omission):
 * - No recipe import, no declared bounds, no wall-thickness subtraction. The planes are measured from the
 *   shipped triangles in world frame; a blind `- wt/2` would fake the tab away instead of measuring it.
 * - No tolerance fitting: the large-plane floor (1.0 m^2) and mm quantization are the probe's own constants.
 * - Missing planes THROW (fail-closed); they are never defaulted from the declaration.
 * - The raw floor slab is preserved as a separate diagnostic (`floorSlabExtents`): it is real geometry (the
 *   tab is correct construction) and the actual area signal — it is simply not the interior-clear quantity.
 *
 * claimScope: interior-clear + floor-slab diagnostics on shipped finished-room GLBs.
 * notEvidenceFor: extract-time gating (the predicate's own floor-part semantics are chain-owned).
 */
import type { Document, Node as GltfNode } from "@gltf-transform/core";

export type V3 = [number, number, number];
export type Tri = [V3, V3, V3];

/** Plane-offset quantization, mm — probe_door.py `round(v0[ax], 3)`. */
export const WALL_PLANE_QUANT_MM = 3;
/** Only faces above this area name a wall — probe_door.py `a > 1.0`. Doorway trim is below it. */
export const LARGE_WALL_PLANE_MIN_M2 = 1.0;

export type RoomFaces = { "+x": number; "-x": number; "+z": number; "-z": number };

export type InteriorClear = {
  width: number;
  depth: number;
  faces: RoomFaces;
};

export type FloorSlab = {
  width: number;
  depth: number;
  area: number;
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** Unit face normal from winding (three.js convention: CCW front faces), null on degenerate tris. */
const unitNormal = (a: V3, b: V3, c: V3): V3 | null => {
  const n = cross(sub(b, a), sub(c, a));
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-12) return null;
  return [n[0] / len, n[1] / len, n[2] / len];
};

function isFinishDressing(node: GltfNode): boolean {
  return (node.getExtras() as Record<string, unknown> | null)?.["openClinXrFinishDecoration"] === true;
}

/** World-space triangles of the nodes matching `nameTest`, finish dressing excluded (runtime shell rule). */
export function wallWorldTriangles(doc: Document, nameTest: (name: string) => boolean): Tri[] {
  const out: Tri[] = [];
  for (const node of doc.getRoot().listNodes()) {
    if (isFinishDressing(node)) continue;
    if (!nameTest(node.getName())) continue;
    const mesh = node.getMesh();
    if (!mesh) continue;
    const t = node.getWorldMatrix();
    const wx = (x: number, y: number, z: number): V3 => [
      t[0]! * x + t[4]! * y + t[8]! * z + t[12]!,
      t[1]! * x + t[5]! * y + t[9]! * z + t[13]!,
      t[2]! * x + t[6]! * y + t[10]! * z + t[14]!,
    ];
    for (const prim of mesh.listPrimitives()) {
      const arr = prim.getAttribute("POSITION")?.getArray();
      if (!arr) continue;
      const count = arr.length / 3;
      const pts: V3[] = [];
      for (let i = 0; i < count; i += 1) pts.push(wx(Number(arr[i * 3]), Number(arr[i * 3 + 1]), Number(arr[i * 3 + 2])));
      const idx = prim.getIndices()?.getArray();
      if (idx) {
        for (let i = 0; i + 2 < idx.length; i += 3) out.push([pts[idx[i]!]!, pts[idx[i + 1]!]!, pts[idx[i + 2]!]!]);
      } else {
        for (let i = 0; i + 2 < count; i += 3) out.push([pts[i]!, pts[i + 1]!, pts[i + 2]!]!);
      }
    }
  }
  return out;
}

/**
 * Interior clear from wall inner faces, pure on world triangles (no GLB, no recipe).
 * Port of probe_door.py: per-side large-area axis-aligned planes, inner face = closest to centre.
 * Throws when any side lacks a large-area face — a missing plane is an error, never a default.
 */
export function interiorClearFromWorldTriangles(tris: Tri[]): InteriorClear {
  const planes = new Map<string, number>();
  for (const [a, b, c] of tris) {
    const n = unitNormal(a, b, c);
    if (!n) continue;
    const ax = Math.abs(n[0]) >= Math.abs(n[1]) ? (Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : 2) : (Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2);
    if (Math.abs(n[ax]!) < 0.999) continue;
    if (ax === 1) continue;
    const side = n[ax]! > 0 ? 1 : -1;
    const mm = (Math.round(a[ax]! * 1000) / 1000).toFixed(WALL_PLANE_QUANT_MM);
    const key = `${ax},${side},${mm}`;
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const cr = cross(e1, e2);
    planes.set(key, (planes.get(key) ?? 0) + Math.hypot(cr[0], cr[1], cr[2]) / 2);
  }
  const offsets = (ax: 0 | 2, sign: 1 | -1): number[] => {
    const out: number[] = [];
    for (const [key, area] of planes) {
      const [kax, , kmm] = key.split(",");
      if (Number(kax) !== ax || area <= LARGE_WALL_PLANE_MIN_M2) continue;
      const mm = Number(kmm);
      if ((sign > 0 && mm > 0) || (sign < 0 && mm < 0)) out.push(mm);
    }
    return out;
  };
  const xPos = offsets(0, 1);
  const xNeg = offsets(0, -1);
  const zPos = offsets(2, 1);
  const zNeg = offsets(2, -1);
  if (!(xPos.length > 0 && xNeg.length > 0 && zPos.length > 0 && zNeg.length > 0)) {
    throw new Error(
      `[interior-clear] missing large-area wall face: +x:${xPos.length} -x:${xNeg.length} +z:${zPos.length} -z:${zNeg.length}`,
    );
  }
  const faces: RoomFaces = {
    "+x": Math.min(...xPos),
    "-x": Math.max(...xNeg),
    "+z": Math.min(...zPos),
    "-z": Math.max(...zNeg),
  };
  return {
    width: faces["+x"] - faces["-x"],
    depth: faces["+z"] - faces["-z"],
    faces,
  };
}

const SHELL_WALL = /\.wall$/iu;
const SHELL_FLOOR = /floor$/iu;

/** Interior clear from the shell `.wall` node's world triangles. Throws on missing planes. */
export function measureInteriorClear(doc: Document): InteriorClear {
  return interiorClearFromWorldTriangles(wallWorldTriangles(doc, (name) => SHELL_WALL.test(name)));
}

/**
 * Raw floor-slab world AABB diagnostic (finish dressing excluded, world transforms applied).
 * Returns null when no shell floor exists — the slab is diagnostic-only, never the clear quantity.
 */
export function floorSlabExtents(doc: Document): FloorSlab | null {
  const tris = wallWorldTriangles(doc, (name) => SHELL_FLOOR.test(name));
  if (tris.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const tri of tris) {
    for (const v of tri) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  const width = maxX - minX;
  const depth = maxZ - minZ;
  return { width, depth, area: width * depth };
}
