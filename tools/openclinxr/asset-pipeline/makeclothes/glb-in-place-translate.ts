/**
 * glb-in-place-translate.ts — translate one mesh's POSITION accessor on z inside the GLB bytes.
 *
 * Only the matched POSITION floats and that accessor's min/max change. Every other byte of the BIN
 * chunk, every extension (including ones gltf-transform does not know, such as
 * OPENCLINXR_skin_shade) and every accessor index stay as they were. A gltf-transform NodeIO
 * round-trip drops unregistered extensions and renumbers accessors; this does neither.
 *
 * Refuses: zero or several matching meshes, a sparse or bufferView-less POSITION, a non-float32
 * VEC3 layout, an interleaved view (byteStride other than 12), a view another accessor shares, or a
 * POSITION accessor that any other attribute or morph target also references.
 *
 * After writing, it re-reads the file and asserts its own diff: the JSON deep-equals the input
 * except accessors[touched].min/max, and the BIN chunk differs only inside the touched byte ranges.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

type Accessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  sparse?: unknown;
  min?: number[];
  max?: number[];
};
type Gltf = {
  accessors: Accessor[];
  bufferViews: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
  meshes: Array<{
    name?: string;
    primitives: Array<{ attributes: Record<string, number>; targets?: Array<Record<string, number>> }>;
  }>;
};

export type InPlaceRow = { mesh: string; accessor: number; verts: number; beforeMaxZ: number; afterMaxZ: number };

function parseGlb(raw: Buffer, glbPath: string): { gltf: Gltf; bin: Buffer; tail: Buffer } {
  if (raw.toString("ascii", 0, 4) !== "glTF" || raw.readUInt32LE(4) !== 2) throw new Error(`${glbPath}: expected GLB v2`);
  const jsonLength = raw.readUInt32LE(12);
  if (raw.readUInt32LE(16) !== JSON_CHUNK) throw new Error(`${glbPath}: JSON chunk missing`);
  const gltf = JSON.parse(raw.subarray(20, 20 + jsonLength).toString("utf8")) as Gltf;
  const binHeader = 20 + jsonLength;
  const binLength = raw.readUInt32LE(binHeader);
  if (raw.readUInt32LE(binHeader + 4) !== BIN_CHUNK) throw new Error(`${glbPath}: BIN chunk missing`);
  const bin = Buffer.from(raw.subarray(binHeader + 8, binHeader + 8 + binLength));
  const tail = raw.subarray(binHeader + 8 + binLength);
  return { gltf, bin, tail };
}

export function translateMeshZInPlace(glbPath: string, meshRe: RegExp, dz: number, dry = false): InPlaceRow[] {
  const raw = readFileSync(glbPath);
  const { gltf, bin, tail } = parseGlb(raw, glbPath);
  const inputJson = structuredClone(gltf);
  const inputBin = Buffer.from(bin);
  const referenceCount = new Map<number, number>();
  for (const m of gltf.meshes) for (const pr of m.primitives) {
    for (const a of Object.values(pr.attributes)) referenceCount.set(a, (referenceCount.get(a) ?? 0) + 1);
    for (const t of pr.targets ?? []) for (const a of Object.values(t)) referenceCount.set(a, (referenceCount.get(a) ?? 0) + 1);
  }
  const touchedRanges: Array<[number, number]> = [];

  const matches = gltf.meshes.filter((candidate) => meshRe.test(candidate.name ?? ""));
  if (matches.length !== 1) {
    throw new Error(`refusing: ${matches.length} meshes match ${meshRe} in ${glbPath}: ${matches.map((m) => m.name).join(", ")}`);
  }
  const mesh = matches[0]!;
  const viewUsers = new Map<number, number>();
  for (const accessor of gltf.accessors) {
    if (accessor.bufferView !== undefined) viewUsers.set(accessor.bufferView, (viewUsers.get(accessor.bufferView) ?? 0) + 1);
  }
  const rows: InPlaceRow[] = [];
  for (const primitive of mesh.primitives) {
    const index = primitive.attributes["POSITION"];
    if (index === undefined) continue;
    const accessor = gltf.accessors[index]!;
    if (accessor.sparse || accessor.bufferView === undefined) throw new Error(`refusing: POSITION ${index} is sparse or has no bufferView`);
    if (accessor.componentType !== 5126 || accessor.type !== "VEC3") throw new Error(`refusing: POSITION ${index} is not float32 VEC3`);
    const view = gltf.bufferViews[accessor.bufferView]!;
    if (view.byteStride !== undefined && view.byteStride !== 12) throw new Error(`refusing: POSITION ${index} view is interleaved`);
    if (viewUsers.get(accessor.bufferView) !== 1) throw new Error(`refusing: POSITION ${index} shares bufferView ${accessor.bufferView}`);
    if (referenceCount.get(index) !== 1) throw new Error(`refusing: POSITION ${index} is referenced ${referenceCount.get(index)} times (attribute or morph target)`);
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    touchedRanges.push([start, start + accessor.count * 12]);
    const floats = new Float32Array(bin.buffer, bin.byteOffset + start, accessor.count * 3);
    let beforeMaxZ = -Infinity;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let vertex = 0; vertex < accessor.count; vertex += 1) {
      const z = floats[vertex * 3 + 2]!;
      if (z > beforeMaxZ) beforeMaxZ = z;
      if (!dry) floats[vertex * 3 + 2] = z + dz;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = dry && axis === 2 ? Math.fround(z + dz) : floats[vertex * 3 + axis]!;
        if (value < lo[axis]!) lo[axis] = value;
        if (value > hi[axis]!) hi[axis] = value;
      }
    }
    accessor.min = lo;
    accessor.max = hi;
    rows.push({ mesh: mesh.name ?? "", accessor: index, verts: accessor.count, beforeMaxZ, afterMaxZ: hi[2]! });
  }
  if (rows.length === 0) throw new Error(`no POSITION on ${mesh.name} in ${glbPath}`);
  if (!dry) {
    let json = Buffer.from(JSON.stringify(gltf), "utf8");
    const pad = (4 - (json.length % 4)) % 4;
    json = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
    const header = Buffer.alloc(12);
    header.write("glTF", 0, "ascii");
    header.writeUInt32LE(2, 4);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(json.length, 0);
    jsonHeader.writeUInt32LE(JSON_CHUNK, 4);
    const binHeaderOut = Buffer.alloc(8);
    binHeaderOut.writeUInt32LE(bin.length, 0);
    binHeaderOut.writeUInt32LE(BIN_CHUNK, 4);
    const out = Buffer.concat([header, jsonHeader, json, binHeaderOut, bin, tail]);
    out.writeUInt32LE(out.length, 8);
    writeFileSync(glbPath, out);
    assertOwnDiff(glbPath, inputJson, inputBin, rows.map((r) => r.accessor), touchedRanges);
  }
  return rows;
}

/** D1 (a): the written file differs from the input only where this tool said it would. */
function assertOwnDiff(glbPath: string, inputJson: Gltf, inputBin: Buffer, touched: number[], ranges: Array<[number, number]>): void {
  const { gltf, bin } = parseGlb(readFileSync(glbPath), glbPath);
  const strip = (doc: Gltf): Gltf => {
    const copy = structuredClone(doc);
    for (const index of touched) {
      delete copy.accessors[index]!.min;
      delete copy.accessors[index]!.max;
    }
    return copy;
  };
  if (!isDeepStrictEqual(strip(gltf), strip(inputJson))) {
    throw new Error(`${glbPath}: in-place write changed JSON outside accessors[${touched.join(",")}].min/max`);
  }
  if (bin.length !== inputBin.length) throw new Error(`${glbPath}: in-place write changed the BIN length`);
  const inside = (offset: number): boolean => ranges.some(([lo, hi]) => offset >= lo && offset < hi);
  for (let offset = 0; offset < bin.length; offset += 1) {
    if (bin[offset] !== inputBin[offset] && !inside(offset)) {
      throw new Error(`${glbPath}: in-place write changed BIN byte ${offset} outside the touched POSITION range`);
    }
  }
}
