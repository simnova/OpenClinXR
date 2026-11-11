/**
 * GLB reading and closest-point geometry for teeth-seat-measure.ts (tsk_2a74bbdb3f03cb3e).
 * Split out to keep the measure within the 500-line zone budget.
 */
import { readFileSync } from "node:fs";

type Accessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
};

type Primitive = {
  indices?: number;
  attributes?: Record<string, number>;
  material?: number;
};

type Mesh = { name?: string; primitives?: Primitive[] };

type GlbNode = {
  name?: string;
  mesh?: number;
  skin?: number;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
};

type Document = {
  accessors: Accessor[];
  bufferViews: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
  meshes: Mesh[];
  nodes: GlbNode[];
  materials?: Array<{ name?: string }>;
};

type Glb = { document: Document; binary: Buffer };

const component = {
  5120: { bytes: 1, read: (b: Buffer, o: number) => b.readInt8(o) },
  5121: { bytes: 1, read: (b: Buffer, o: number) => b.readUInt8(o) },
  5122: { bytes: 2, read: (b: Buffer, o: number) => b.readInt16LE(o) },
  5123: { bytes: 2, read: (b: Buffer, o: number) => b.readUInt16LE(o) },
  5125: { bytes: 4, read: (b: Buffer, o: number) => b.readUInt32LE(o) },
  5126: { bytes: 4, read: (b: Buffer, o: number) => b.readFloatLE(o) },
} as const;

const widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGlb(path: string): Glb {
  const raw = readFileSync(path);
  if (raw.toString("ascii", 0, 4) !== "glTF" || raw.readUInt32LE(4) !== 2) {
    throw new Error(`${path}: expected GLB v2`);
  }
  const jsonLength = raw.readUInt32LE(12);
  if (raw.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${path}: JSON chunk missing`);
  const document = JSON.parse(raw.subarray(20, 20 + jsonLength).toString("utf8")) as Document;
  const binHeader = 20 + jsonLength;
  const binLength = raw.readUInt32LE(binHeader);
  if (raw.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error(`${path}: BIN chunk missing`);
  return { document, binary: raw.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

/** Dense base bytes of a bufferView-backed accessor. */
function denseBytes(glb: Glb, index: number): Buffer {
  const accessor = glb.document.accessors[index]!;
  if (accessor.bufferView === undefined) throw new Error(`accessor ${index}: no bufferView`);
  const layout = component[accessor.componentType as keyof typeof component];
  const width = widths[accessor.type];
  if (!layout || !width) throw new Error(`accessor ${index}: unsupported layout`);
  const view = glb.document.bufferViews[accessor.bufferView];
  if (!view) throw new Error(`accessor ${index}: missing bufferView`);
  const itemBytes = layout.bytes * width;
  const stride = view.byteStride ?? itemBytes;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const rows: Buffer[] = [];
  for (let row = 0; row < accessor.count; row += 1) {
    rows.push(glb.binary.subarray(start + row * stride, start + row * stride + itemBytes));
  }
  return Buffer.concat(rows);
}

export function readVec3(glb: Glb, index: number): Float64Array {
  const accessor = glb.document.accessors[index]!;
  if (accessor.type !== "VEC3" || accessor.componentType !== 5126) {
    throw new Error(`accessor ${index}: VEC3 float required`);
  }
  const bytes = denseBytes(glb, index);
  const out = new Float64Array(accessor.count * 3);
  for (let row = 0; row < accessor.count; row += 1) {
    out[row * 3] = bytes.readFloatLE(row * 12);
    out[row * 3 + 1] = bytes.readFloatLE(row * 12 + 4);
    out[row * 3 + 2] = bytes.readFloatLE(row * 12 + 8);
  }
  return out;
}

export function readScalarIndices(glb: Glb, index: number): Uint32Array {
  const accessor = glb.document.accessors[index]!;
  if (accessor.type !== "SCALAR") throw new Error(`accessor ${index}: SCALAR indices required`);
  const layout = component[accessor.componentType as keyof typeof component];
  if (!layout) throw new Error(`accessor ${index}: unsupported index componentType`);
  const bytes = denseBytes(glb, index);
  const out = new Uint32Array(accessor.count);
  for (let row = 0; row < accessor.count; row += 1) {
    out[row] = layout.read(bytes, row * layout.bytes);
  }
  return out;
}

export function isFittedTeeth(name: string): boolean {
  return name.toLowerCase().startsWith("openclinxr_fitted_teeth");
}

export function isFittedTongue(name: string): boolean {
  return name.toLowerCase().startsWith("openclinxr_fitted_tongue");
}

export function isBody(name: string): boolean {
  return name.endsWith("_body");
}

export function meshNode(glb: Glb, path: string, predicate: (name: string) => boolean, what: string): { node: GlbNode; mesh: Mesh } {
  const meshHits = glb.document.meshes.flatMap((mesh, meshIndex) =>
    predicate(String(mesh.name ?? "")) ? [{ meshIndex, mesh }] : [],
  );
  if (meshHits.length !== 1) throw new Error(`${path}: expected exactly one ${what} mesh, found ${meshHits.length}`);
  const hit = meshHits[0]!;
  const nodeHits = glb.document.nodes.filter((node) => node.mesh === hit.meshIndex);
  if (nodeHits.length !== 1) throw new Error(`${path}: expected exactly one ${what} node, found ${nodeHits.length}`);
  return { node: nodeHits[0]!, mesh: hit.mesh };
}

/**
 * Closest point on triangle (a, b, c) to p (Ericson 5.1.5). Writes q into out,
 * returns the squared distance |p - q|^2.
 */
export function closestPointTriangle(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  out: number[],
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out[0] = ax;
    out[1] = ay;
    out[2] = az;
  } else {
    const bpx = px - bx;
    const bpy = py - by;
    const bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) {
      out[0] = bx;
      out[1] = by;
      out[2] = bz;
    } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        out[0] = ax + v * abx;
        out[1] = ay + v * aby;
        out[2] = az + v * abz;
      } else {
        const cpx = px - cx;
        const cpy = py - cy;
        const cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) {
          out[0] = cx;
          out[1] = cy;
          out[2] = cz;
        } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            out[0] = ax + w * acx;
            out[1] = ay + w * acy;
            out[2] = az + w * acz;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              out[0] = bx + w * (cx - bx);
              out[1] = by + w * (cy - by);
              out[2] = bz + w * (cz - bz);
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom;
              const w = vc * denom;
              out[0] = ax + abx * v + acx * w;
              out[1] = ay + aby * v + acy * w;
              out[2] = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  const dx = px - out[0]!;
  const dy = py - out[1]!;
  const dz = pz - out[2]!;
  return dx * dx + dy * dy + dz * dz;
}
