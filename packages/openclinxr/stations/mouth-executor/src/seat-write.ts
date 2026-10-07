/**
 * Seated-GLB byte writer (MADR 0061 mouth executor).
 *
 * `GlbJson`/`writeGlb` move verbatim from
 * tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts;
 * `writeAccessorBytes` and the write block move verbatim from the `main()` of
 * tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts, reworked
 * from file-in-place to bytes-in/bytes-out (`buildSeatedGlb`). The tools CLI keeps
 * its file behavior by calling this module; bytes are unchanged.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { TONGUE_RE, TONGUE_TARGET_NAME } from "./tongue-th.js";
import type { SeatResult } from "./seat-plan.js";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;

export type GlbJson = {
  buffers: { byteLength: number }[];
  bufferViews: { buffer: number; byteOffset: number; byteLength: number; target?: number }[];
  accessors: Record<string, unknown>[];
  meshes: {
    name?: string;
    extras?: { targetNames?: string[] };
    primitives: { targets?: { POSITION: number }[] }[];
  }[];
};

/** Serialize GLB JSON plus buffer into a file. */
export function writeGlb(json: GlbJson, bin: Buffer, glbPath: string): void {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = binPad === 0 ? bin : Buffer.concat([bin, Buffer.alloc(binPad)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(GLB_JSON, 16);
  jsonChunk.copy(out, 20);
  const binAt = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, binAt);
  out.writeUInt32LE(GLB_BIN, binAt + 4);
  binChunk.copy(out, binAt + 8);
  writeFileSync(glbPath, out);
}

/** GLB bytes for JSON plus buffer without touching the filesystem. */
export function glbBytesFor(json: GlbJson, bin: Buffer): Buffer {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = binPad === 0 ? bin : Buffer.concat([bin, Buffer.alloc(binPad)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(GLB_JSON, 16);
  jsonChunk.copy(out, 20);
  const binAt = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, binAt);
  out.writeUInt32LE(GLB_BIN, binAt + 4);
  binChunk.copy(out, binAt + 8);
  return out;
}

/** In-place accessor overwrite honoring interleaved byteStride. Counts and types must match. */
function writeAccessorBytes(
  json: GlbJson,
  bin: Buffer,
  accessorIndex: number,
  values: ArrayLike<number>,
  count: number,
  components: number,
): void {
  const accessor = json.accessors[accessorIndex] as {
    bufferView: number;
    byteOffset?: number;
    count: number;
    componentType: number;
    type: string;
    min?: number[];
    max?: number[];
  };
  const view = json.bufferViews[accessor.bufferView] as
    | { byteOffset?: number; byteLength?: number; byteStride?: number }
    | undefined;
  if (!accessor || !view) throw new Error(`accessor ${accessorIndex} missing`);
  const size =
    accessor.componentType === 5121 ? 1 : accessor.componentType === 5123 ? 2 : accessor.componentType === 5126 ? 4 : 0;
  const expectType = components === 3 ? "VEC3" : "VEC4";
  if (accessor.count !== count || accessor.type !== expectType || size === 0) {
    throw new Error(`accessor ${accessorIndex} is not ${expectType} x${count}`);
  }
  const stride = view.byteStride ?? components * size;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (start + (count - 1) * stride + components * size > bin.length) {
    throw new Error(`accessor ${accessorIndex} overruns the buffer`);
  }
  const min: number[] = [];
  const max: number[] = [];
  for (let axis = 0; axis < components; axis += 1) {
    min.push(Infinity);
    max.push(-Infinity);
  }
  for (let vertex = 0; vertex < count; vertex += 1) {
    for (let axis = 0; axis < components; axis += 1) {
      const value = values[vertex * components + axis] ?? 0;
      const at = start + vertex * stride + axis * size;
      if (size === 1) {
        if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`joint index out of range: ${value}`);
        bin.writeUInt8(value, at);
      } else if (size === 2) {
        bin.writeUInt16LE(value, at);
      } else {
        bin.writeFloatLE(value, at);
      }
      min[axis] = Math.min(min[axis] ?? 0, value);
      max[axis] = Math.max(max[axis] ?? 0, value);
    }
  }
  accessor.min = min;
  accessor.max = max;
}

/** Hex SHA-256 of bytes. */
export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Apply a seat result to GLB bytes: teeth morphs, base, skinning, the pressed
 * body viseme_FF and the solved tongue viseme_TH. The teeth and body accessor
 * overwrites are in place; the tongue append is the only buffer growth, so the
 * untouched accessors carry over verbatim. Mirrors the tools CLI write block.
 */
export function buildSeatedGlb(inputBytes: Uint8Array, seat: SeatResult): Buffer {
  const { plan, newBase, newJoints, newWeights, newDeltas, newBodyFf, newTongueTh } = seat;
  const file = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);
  if (file.readUInt32LE(0) !== 0x46546c67) throw new Error("not a glb");
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson;
  const binHeader = 20 + jsonLength;
  const binLength = json.buffers[0]?.byteLength;
  if (typeof binLength !== "number") throw new Error("missing buffer length");
  let bin = Buffer.from(file.subarray(binHeader + 8, binHeader + 8 + binLength));
  const teeth = json.meshes.find((mesh) => mesh.name !== undefined && /fitted_teeth/i.test(mesh.name));
  const primitive = teeth?.primitives[0];
  if (!teeth || !primitive) throw new Error("teeth primitive missing from JSON");
  const existing = teeth.extras?.targetNames ?? [];
  const plannedNames = Object.keys(newDeltas);
  if (existing.length !== plannedNames.length || !plannedNames.every((name) => existing.includes(name))) {
    throw new Error(`teeth target names moved: ${existing.join(",")}`);
  }
  const existingIndex = new Map(existing.map((name, index) => [name, index]));
  const targets: { POSITION: number }[] = [];
  for (const name of existing) {
    const values = newDeltas[name];
    if (!values) throw new Error(`no delta for ${name}`);
    const prior = existingIndex.get(name);
    const accessorIndex = prior === undefined ? undefined : primitive.targets?.[prior]?.POSITION;
    if (typeof accessorIndex !== "number") throw new Error(`missing POSITION on ${name}`);
    writeAccessorBytes(json, bin, accessorIndex, values, plan.teethCount, 3);
    targets.push({ POSITION: accessorIndex });
  }
  primitive.targets = targets;
  const baseAccessor = (primitive as { attributes?: { POSITION?: number } }).attributes?.POSITION;
  if (typeof baseAccessor !== "number") throw new Error("teeth primitive has no POSITION attribute");
  writeAccessorBytes(json, bin, baseAccessor, newBase, plan.teethCount, 3);
  const jointsAccessor = (primitive as { attributes?: { JOINTS_0?: number } }).attributes?.JOINTS_0;
  const weightsAccessor = (primitive as { attributes?: { WEIGHTS_0?: number } }).attributes?.WEIGHTS_0;
  if (typeof jointsAccessor !== "number" || typeof weightsAccessor !== "number") {
    throw new Error("teeth primitive has no skinning attributes");
  }
  writeAccessorBytes(json, bin, jointsAccessor, newJoints, plan.teethCount, 4);
  writeAccessorBytes(json, bin, weightsAccessor, newWeights, plan.teethCount, 4);
  if (newBodyFf) {
    const body = json.meshes.find((mesh) => mesh.name !== undefined && /_body$/i.test(mesh.name));
    const bodyPrim = body?.primitives[0];
    if (!body || !bodyPrim) throw new Error("body primitive missing from JSON");
    const bodyNames = body.extras?.targetNames ?? [];
    const ffIndex = bodyNames.indexOf("viseme_FF");
    if (ffIndex < 0) throw new Error("body has no viseme_FF target");
    const ffAccessor = bodyPrim.targets?.[ffIndex]?.POSITION;
    if (typeof ffAccessor !== "number") throw new Error("missing POSITION on body viseme_FF");
    const bodyPosAccessor = (bodyPrim as { attributes?: { POSITION?: number } }).attributes?.POSITION;
    if (typeof bodyPosAccessor !== "number") throw new Error("body primitive has no POSITION attribute");
    const bodyCount = (json.accessors[bodyPosAccessor] as { count: number }).count;
    const ffAccess = json.accessors[ffAccessor] as
      | { count: number; type: string; sparse?: unknown; bufferView?: number }
      | undefined;
    if (!ffAccess || ffAccess.count !== bodyCount || ffAccess.type !== "VEC3") {
      throw new Error(`body viseme_FF accessor ${ffAccessor} is not VEC3 x${bodyCount}`);
    }
    if (ffAccess.sparse) {
      // Densify once: body morphs ship sparse; the edited FF field is full.
      // Idempotent: a rerun finds a dense accessor and overwrites in place.
      while (bin.length % 4 !== 0) bin = Buffer.concat([bin, Buffer.alloc(1)]);
      const byteOffset = bin.length;
      const dense = Buffer.alloc(newBodyFf.length * 4);
      for (let i = 0; i < newBodyFf.length; i += 1) dense.writeFloatLE(newBodyFf[i] ?? 0, i * 4);
      bin = Buffer.concat([bin, dense]);
      const viewIndex = json.bufferViews.length;
      json.bufferViews.push({ buffer: 0, byteOffset, byteLength: dense.length, target: 34962 });
      ffAccess.bufferView = viewIndex;
      delete ffAccess.sparse;
    }
    writeAccessorBytes(json, bin, ffAccessor, newBodyFf, bodyCount, 3);
  }
  // Tongue viseme_TH: the tongue ships target-less, so append the solved
  // delta as its first (only) morph target. Teeth and body accessors above
  // are overwritten in place; this append is the only buffer growth, so
  // their bytes carry over verbatim.
  {
    const tongueJson = json.meshes.find((mesh) => mesh.name !== undefined && TONGUE_RE.test(mesh.name));
    const tonguePrimJson = tongueJson?.primitives[0];
    if (!tongueJson || !tonguePrimJson) throw new Error("tongue primitive missing from JSON");
    if ((tonguePrimJson.targets ?? []).length !== 0) throw new Error("tongue already carries targets");
    if ((tongueJson.extras?.targetNames ?? []).length !== 0) throw new Error("tongue already carries targetNames");
    const tonguePosAccessor = (tonguePrimJson as { attributes?: { POSITION?: number } }).attributes?.POSITION;
    if (typeof tonguePosAccessor !== "number") throw new Error("tongue primitive has no POSITION attribute");
    const tongueCount = (json.accessors[tonguePosAccessor] as { count: number }).count;
    if (newTongueTh.length !== tongueCount * 3) {
      throw new Error(`tongue TH delta length moved: ${newTongueTh.length / 3} vs ${tongueCount}`);
    }
    while (bin.length % 4 !== 0) bin = Buffer.concat([bin, Buffer.alloc(1)]);
    const byteOffset = bin.length;
    const dense = Buffer.alloc(newTongueTh.length * 4);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < newTongueTh.length; i += 1) {
      const value = newTongueTh[i] ?? 0;
      dense.writeFloatLE(value, i * 4);
      const axis = i % 3;
      min[axis] = Math.min(min[axis] ?? 0, value);
      max[axis] = Math.max(max[axis] ?? 0, value);
    }
    bin = Buffer.concat([bin, dense]);
    const viewIndex = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: dense.length, target: 34962 });
    const accessorIndex = json.accessors.length;
    json.accessors.push({
      bufferView: viewIndex,
      byteOffset: 0,
      componentType: 5126,
      count: tongueCount,
      type: "VEC3",
      min,
      max,
    });
    tonguePrimJson.targets = [{ POSITION: accessorIndex }];
    tongueJson.extras = { ...(tongueJson.extras ?? {}), targetNames: [TONGUE_TARGET_NAME] };
  }
  const outBuffer = json.buffers[0];
  if (!outBuffer) throw new Error("missing buffer length");
  outBuffer.byteLength = bin.length;
  return glbBytesFor(json, bin);
}
