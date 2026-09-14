const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const GLB_VERSION = 2;
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON" little-endian
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0" little-endian
const COMPONENT_TYPE_FLOAT = 5126;

export type MotionGlbBakeTrack = {
  property: "rotationAbsoluteNodeLocal" | "translationAbsoluteNodeLocal";
  boneName: string;
  interpolation: "LINEAR";
  times: readonly number[];
  values: readonly (readonly number[])[];
};

/**
 * Bake input. Narrower than the compiler clip: the baker needs clip identity, the seed
 * (mutation counterweight), and absolute node-local tracks. Extra compile fields are ignored.
 */
export type MotionGlbBakeClip = {
  clipId: string;
  compileIdentity: { deterministicSeed: string };
  tracks: readonly MotionGlbBakeTrack[];
};

export type MotionGlbReadback = {
  clipId: string;
  deterministicSeed: string;
  channels: ReadonlyArray<{ sampler: number; target: { node: number; path: "rotation" | "translation" } }>;
  samplers: ReadonlyArray<{ input: number; interpolation: "LINEAR"; output: number }>;
  rotations: ReadonlyArray<{ boneName: string; values: ReadonlyArray<readonly [number, number, number, number]> }>;
};

type GLTF = {
  asset: { version: "2.0"; generator: string; extras: { openclinxrClipId: string; openclinxrDeterministicSeed: string } };
  buffers: Array<{ byteLength: number }>;
  bufferViews: Array<{ buffer: number; byteOffset: number; byteLength: number; target: number }>;
  accessors: Array<{
    bufferView: number;
    byteOffset: number;
    componentType: number;
    count: number;
    type: string;
    min: number[];
    max: number[];
  }>;
  nodes: Array<{ name: string; rotation: [number, number, number, number]; translation: [number, number, number] }>;
  animations: Array<{
    name: string;
    channels: Array<{ sampler: number; target: { node: number; path: "rotation" | "translation" } }>;
    samplers: Array<{ input: number; interpolation: "LINEAR"; output: number }>;
  }>;
  scene: number;
  scenes: Array<{ nodes: number[] }>;
};

/**
 * Bakes a compiled clip into a GLB with animation channels/samplers.
 * Same clip → byte-identical output. Seed or clipId mutation changes bytes.
 */
export function bakeMotionProgramToGlb(clip: MotionGlbBakeClip): Uint8Array {
  const boneNames = [...new Set(clip.tracks.map((t) => t.boneName))].sort();
  const boneToNodeIndex = new Map<string, number>();
  for (let idx = 0; idx < boneNames.length; idx += 1) {
    const name = boneNames[idx];
    if (name !== undefined) boneToNodeIndex.set(name, idx);
  }

  const nodes = boneNames.map((boneName) => ({
    name: boneName,
    rotation: [0, 0, 0, 1] as [number, number, number, number],
    translation: [0, 0, 0] as [number, number, number],
  }));

  const accessors: GLTF["accessors"] = [];
  const bufferViews: GLTF["bufferViews"] = [];
  const animationSamplers: GLTF["animations"][number]["samplers"] = [];
  const animationChannels: GLTF["animations"][number]["channels"] = [];
  const binaryChunks: Uint8Array[] = [];
  let binaryOffset = 0;

  for (const track of clip.tracks) {
    const nodeIndex = boneToNodeIndex.get(track.boneName);
    if (nodeIndex === undefined) {
      throw new Error(`bakeMotionProgramToGlb: unknown bone "${track.boneName}"`);
    }

    const timesArray = new Float32Array(track.times);
    binaryOffset = pushView(bufferViews, binaryChunks, binaryOffset, timesArray);
    const timesMin = Math.min(...track.times);
    const timesMax = Math.max(...track.times);
    const timesAccessorIndex = accessors.length;
    accessors.push({
      bufferView: bufferViews.length - 1,
      byteOffset: 0,
      componentType: COMPONENT_TYPE_FLOAT,
      count: track.times.length,
      type: "SCALAR",
      min: [timesMin],
      max: [timesMax],
    });

    const isRotation = track.property === "rotationAbsoluteNodeLocal";
    const stride = isRotation ? 4 : 3;
    const writtenValues = isRotation
      ? track.values.map((q) => normalizeQuat(q))
      : track.values.map((v) => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0]);
    const valuesArray = new Float32Array(writtenValues.flat());
    binaryOffset = pushView(bufferViews, binaryChunks, binaryOffset, valuesArray);

    const columns = columnMinMax(writtenValues, stride);
    const valuesAccessorIndex = accessors.length;
    accessors.push({
      bufferView: bufferViews.length - 1,
      byteOffset: 0,
      componentType: COMPONENT_TYPE_FLOAT,
      count: track.values.length,
      type: isRotation ? "VEC4" : "VEC3",
      min: columns.min,
      max: columns.max,
    });

    const samplerIndex = animationSamplers.length;
    animationSamplers.push({
      input: timesAccessorIndex,
      interpolation: "LINEAR",
      output: valuesAccessorIndex,
    });
    animationChannels.push({
      sampler: samplerIndex,
      target: { node: nodeIndex, path: isRotation ? "rotation" : "translation" },
    });
  }

  const gltf: GLTF = {
    asset: {
      version: "2.0",
      generator: "openclinxr-motion-compiler",
      extras: {
        openclinxrClipId: clip.clipId,
        openclinxrDeterministicSeed: clip.compileIdentity.deterministicSeed,
      },
    },
    buffers: [{ byteLength: binaryOffset }],
    bufferViews,
    accessors,
    nodes,
    animations: [
      {
        name: clip.clipId,
        channels: animationChannels,
        samplers: animationSamplers,
      },
    ],
    scene: 0,
    scenes: [{ nodes: boneNames.map((_, i) => i) }],
  };

  return writeGlb(gltf, binaryChunks, binaryOffset);
}

export function readMotionGlbClipId(bytes: Uint8Array): string {
  return parseGlbJson(bytes).asset.extras.openclinxrClipId;
}

export function readMotionGlb(bytes: Uint8Array): MotionGlbReadback {
  const gltf = parseGlbJson(bytes);
  const animation = gltf.animations[0];
  if (!animation) {
    throw new Error("GLB has no animation");
  }
  const rotations = gltf.nodes
    .map((node, nodeIndex) => {
      const channel = animation.channels.find((c) => c.target.node === nodeIndex && c.target.path === "rotation");
      if (!channel) return undefined;
      const sampler = animation.samplers[channel.sampler];
      if (!sampler) return undefined;
      const accessor = gltf.accessors[sampler.output];
      if (!accessor) return undefined;
      const view = gltf.bufferViews[accessor.bufferView];
      if (!view) return undefined;
      const bin = glbBinChunk(bytes);
      const floats = new Float32Array(bin.buffer, bin.byteOffset + view.byteOffset, accessor.count * 4);
      const values: Array<readonly [number, number, number, number]> = [];
      for (let i = 0; i < accessor.count; i += 1) {
        const q = normalizeQuat([
          floats[i * 4] ?? 0,
          floats[i * 4 + 1] ?? 0,
          floats[i * 4 + 2] ?? 0,
          floats[i * 4 + 3] ?? 1,
        ]);
        values.push(q);
      }
      return { boneName: node.name, values };
    })
    .filter((entry): entry is { boneName: string; values: Array<readonly [number, number, number, number]> } => entry !== undefined);

  return {
    clipId: gltf.asset.extras.openclinxrClipId,
    deterministicSeed: gltf.asset.extras.openclinxrDeterministicSeed,
    channels: animation.channels,
    samplers: animation.samplers,
    rotations,
  };
}

function pushView(
  bufferViews: GLTF["bufferViews"],
  binaryChunks: Uint8Array[],
  binaryOffset: number,
  values: Float32Array,
): number {
  const byteLength = values.byteLength;
  bufferViews.push({
    buffer: 0,
    byteOffset: binaryOffset,
    byteLength,
    target: 34962,
  });
  binaryChunks.push(new Uint8Array(values.buffer, values.byteOffset, byteLength));
  return binaryOffset + byteLength;
}

function writeGlb(gltf: GLTF, binaryChunks: Uint8Array[], binaryOffset: number): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPaddedLength = alignTo4(jsonBytes.length);
  const jsonPadding = new Uint8Array(jsonPaddedLength - jsonBytes.length).fill(0x20);

  const binaryData = new Uint8Array(binaryOffset);
  let offset = 0;
  for (const chunk of binaryChunks) {
    binaryData.set(chunk, offset);
    offset += chunk.length;
  }
  const binaryPaddedLength = alignTo4(binaryData.length);
  const totalLength = 12 + 8 + jsonPaddedLength + 8 + binaryPaddedLength;

  const glb = new Uint8Array(totalLength);
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLength, true);

  let chunkOffset = 12;
  view.setUint32(chunkOffset, jsonPaddedLength, true);
  view.setUint32(chunkOffset + 4, CHUNK_TYPE_JSON, true);
  glb.set(jsonBytes, chunkOffset + 8);
  glb.set(jsonPadding, chunkOffset + 8 + jsonBytes.length);
  chunkOffset += 8 + jsonPaddedLength;

  view.setUint32(chunkOffset, binaryPaddedLength, true);
  view.setUint32(chunkOffset + 4, CHUNK_TYPE_BIN, true);
  glb.set(binaryData, chunkOffset + 8);
  return glb;
}

function parseGlbJson(bytes: Uint8Array): GLTF {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("Not a valid GLB file: invalid magic");
  }
  if (view.getUint32(4, true) !== GLB_VERSION) {
    throw new Error(`Unsupported GLB version: ${view.getUint32(4, true)}`);
  }
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    if (chunkType === CHUNK_TYPE_JSON) {
      const jsonBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + offset, chunkLength);
      return JSON.parse(new TextDecoder().decode(jsonBytes).trimEnd()) as GLTF;
    }
    offset += alignTo4(chunkLength);
  }
  throw new Error("GLB does not contain a JSON chunk");
}

function glbBinChunk(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    if (chunkType === CHUNK_TYPE_BIN) {
      return new Uint8Array(bytes.buffer, bytes.byteOffset + offset, chunkLength);
    }
    offset += alignTo4(chunkLength);
  }
  throw new Error("GLB does not contain a BIN chunk");
}

function normalizeQuat(q: readonly number[]): [number, number, number, number] {
  const x0 = q[0] ?? 0;
  const y0 = q[1] ?? 0;
  const z0 = q[2] ?? 0;
  const w0 = q[3] ?? 1;
  const n = Math.hypot(x0, y0, z0, w0);
  if (n === 0) return [0, 0, 0, 1];
  let x = x0 / n;
  let y = y0 / n;
  let z = z0 / n;
  let w = w0 / n;
  if (w < 0 || (w === 0 && (x < 0 || (x === 0 && (y < 0 || (y === 0 && z < 0)))))) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  return [x, y, z, w];
}

function columnMinMax(rows: readonly (readonly number[])[], stride: number): { min: number[]; max: number[] } {
  const min = Array.from({ length: stride }, () => Number.POSITIVE_INFINITY);
  const max = Array.from({ length: stride }, () => Number.NEGATIVE_INFINITY);
  for (const row of rows) {
    for (let i = 0; i < stride; i += 1) {
      const v = row[i] ?? 0;
      const currentMin = min[i] ?? Number.POSITIVE_INFINITY;
      const currentMax = max[i] ?? Number.NEGATIVE_INFINITY;
      if (v < currentMin) min[i] = v;
      if (v > currentMax) max[i] = v;
    }
  }
  return { min, max };
}

function alignTo4(value: number): number {
  return (value + 3) & ~3;
}
