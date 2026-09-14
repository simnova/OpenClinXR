import { createHash } from "node:crypto";

import type { CompiledMotionClipV1 } from "../compile-motion-program.js";

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const GLB_VERSION = 2;
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON" little-endian
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0" little-endian

interface GLTFBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target?: number;
}

interface GLTFAccessor {
  bufferView: number;
  byteOffset: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

interface GLTFAnimationChannel {
  sampler: number;
  target: {
    node: number;
    path: "rotation" | "translation";
  };
}

interface GLTFAnimationSampler {
  input: number;
  interpolation: "LINEAR";
  output: number;
}

interface GLTFNode {
  name: string;
  rotation?: [number, number, number, number];
  translation?: [number, number, number];
  children?: number[];
}

interface GLTFAnimation {
  name: string;
  channels: GLTFAnimationChannel[];
  samplers: GLTFAnimationSampler[];
}

interface GLTF {
  asset: { version: "2.0"; generator: string };
  buffers: Array<{ byteLength: number; uri?: string }>;
  bufferViews: GLTFBufferView[];
  accessors: GLTFAccessor[];
  nodes: GLTFNode[];
  animations: GLTFAnimation[];
  scene: number;
  scenes: Array<{ nodes: number[] }>;
}

/** Component type constants for glTF accessors */
const COMPONENT_TYPE_FLOAT = 5126;

/** glTF accessor types */
const ACCESSOR_TYPE_VEC3 = "VEC3";
const ACCESSOR_TYPE_VEC4 = "VEC4";

/**
 * Bakes a CompiledMotionClipV1 into a GLB (binary glTF) with animation tracks.
 * The output is deterministic: same clip produces byte-identical GLB.
 */
export function bakeMotionProgramToGlb(clip: CompiledMotionClipV1): Uint8Array {
  // Build node index by boneName
  const boneNames = [...new Set(clip.tracks.map((t) => t.boneName))].sort();
  const boneToNodeIndex = new Map<string, number>();
  boneNames.forEach((name, idx) => boneToNodeIndex.set(name, idx));

  // Create nodes
  const nodes: GLTFNode[] = boneNames.map((boneName) => ({
    name: boneName,
    rotation: [0, 0, 0, 1],
    translation: [0, 0, 0],
  }));

  // Collect all animation data
  const accessors: GLTFAccessor[] = [];
  const bufferViews: GLTFBufferView[] = [];
  const animationSamplers: GLTFAnimationSampler[] = [];
  const animationChannels: GLTFAnimationChannel[] = [];

  // Binary data chunks
  const binaryChunks: Uint8Array[] = [];
  let binaryOffset = 0;

  // For each track, create accessor for times (input) and values (output)
  const trackAccessorIndices: { times: number; values: number }[] = [];

  for (const track of clip.tracks) {
    const nodeIndex = boneToNodeIndex.get(track.boneName)!;

    // Times accessor (input for sampler)
    const timesArray = new Float32Array(track.times);
    const timesByteLength = timesArray.byteLength;
    const timesBufferViewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: binaryOffset,
      byteLength: timesByteLength,
      target: 34962, // ARRAY_BUFFER
    });
    binaryChunks.push(new Uint8Array(timesArray.buffer, timesArray.byteOffset, timesByteLength));
    binaryOffset += timesByteLength;

    const timesMin = Math.min(...track.times);
    const timesMax = Math.max(...track.times);
    const timesAccessorIndex = accessors.length;
    accessors.push({
      bufferView: timesBufferViewIndex,
      byteOffset: 0,
      componentType: COMPONENT_TYPE_FLOAT,
      count: track.times.length,
      type: "SCALAR",
      min: [timesMin],
      max: [timesMax],
    });

    // Values accessor (output for sampler)
    let valuesArray: Float32Array;
    let valuesType: string;
    let valuesMin: number[];
    let valuesMax: number[];

    if (track.property === "rotationAbsoluteNodeLocal") {
      // Quaternions: [x, y, z, w] - already in glTF order
      valuesArray = new Float32Array(track.values.flat());
      valuesType = ACCESSOR_TYPE_VEC4;
      // For rotation, min/max are component-wise
      const allValues = track.values.flat();
      valuesMin = [
        Math.min(...allValues.filter((_, i) => i % 4 === 0)),
        Math.min(...allValues.filter((_, i) => i % 4 === 1)),
        Math.min(...allValues.filter((_, i) => i % 4 === 2)),
        Math.min(...allValues.filter((_, i) => i % 4 === 3)),
      ];
      valuesMax = [
        Math.max(...allValues.filter((_, i) => i % 4 === 0)),
        Math.max(...allValues.filter((_, i) => i % 4 === 1)),
        Math.max(...allValues.filter((_, i) => i % 4 === 2)),
        Math.max(...allValues.filter((_, i) => i % 4 === 3)),
      ];
    } else {
      // Translation: [x, y, z]
      valuesArray = new Float32Array(track.values.flat());
      valuesType = ACCESSOR_TYPE_VEC3;
      const allValues = track.values.flat();
      valuesMin = [
        Math.min(...allValues.filter((_, i) => i % 3 === 0)),
        Math.min(...allValues.filter((_, i) => i % 3 === 1)),
        Math.min(...allValues.filter((_, i) => i % 3 === 2)),
      ];
      valuesMax = [
        Math.max(...allValues.filter((_, i) => i % 3 === 0)),
        Math.max(...allValues.filter((_, i) => i % 3 === 1)),
        Math.max(...allValues.filter((_, i) => i % 3 === 2)),
      ];
    }

    const valuesByteLength = valuesArray.byteLength;
    const valuesBufferViewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: binaryOffset,
      byteLength: valuesByteLength,
      target: 34962, // ARRAY_BUFFER
    });
    binaryChunks.push(new Uint8Array(valuesArray.buffer, valuesArray.byteOffset, valuesByteLength));
    binaryOffset += valuesByteLength;

    const valuesAccessorIndex = accessors.length;
    accessors.push({
      bufferView: valuesBufferViewIndex,
      byteOffset: 0,
      componentType: COMPONENT_TYPE_FLOAT,
      count: track.values.length,
      type: valuesType,
      min: valuesMin,
      max: valuesMax,
    });

    trackAccessorIndices.push({ times: timesAccessorIndex, values: valuesAccessorIndex });

    // Create sampler
    const samplerIndex = animationSamplers.length;
    animationSamplers.push({
      input: timesAccessorIndex,
      interpolation: "LINEAR",
      output: valuesAccessorIndex,
    });

    // Create channel
    const path = track.property === "rotationAbsoluteNodeLocal" ? "rotation" : "translation";
    animationChannels.push({
      sampler: samplerIndex,
      target: {
        node: nodeIndex,
        path,
      },
    });
  }

  // Create animation
  const animation: GLTFAnimation = {
    name: clip.clipId,
    channels: animationChannels,
    samplers: animationSamplers,
  };

  // Build GLTF JSON
  const gltf: GLTF = {
    asset: {
      version: "2.0",
      generator: "openclinxr-motion-compiler",
    },
    buffers: [
      {
        byteLength: binaryOffset,
      },
    ],
    bufferViews,
    accessors,
    nodes,
    animations: [animation],
    scene: 0,
    scenes: [{ nodes: boneNames.map((_, i) => i) }],
  };

  // Write GLB
  return writeGlb(gltf, binaryChunks, clip.clipId, binaryOffset);
}

/**
 * Writes a GLB (binary glTF) from JSON and binary chunks.
 * The clipId is embedded in the JSON for readback verification.
 */
function writeGlb(gltf: GLTF, binaryChunks: Uint8Array[], clipId: string, binaryOffset: number): Uint8Array {
  // Embed clipId in the asset.extras for readback
  const jsonWithClipId = {
    ...gltf,
    asset: {
      ...gltf.asset,
      extras: { openclinxrClipId: clipId },
    },
  };

  const jsonText = JSON.stringify(jsonWithClipId);
  const jsonBytes = new TextEncoder().encode(jsonText);
  const jsonPaddedLength = alignTo4(jsonBytes.length);
  const jsonPadding = new Uint8Array(jsonPaddedLength - jsonBytes.length).fill(0x20); // space padding

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

  // Header
  view.setUint32(0, GLB_MAGIC, true); // magic
  view.setUint32(4, GLB_VERSION, true); // version
  view.setUint32(8, totalLength, true); // total length

  // JSON chunk
  let chunkOffset = 12;
  view.setUint32(chunkOffset, jsonPaddedLength, true); // chunk length
  view.setUint32(chunkOffset + 4, CHUNK_TYPE_JSON, true); // chunk type
  glb.set(jsonBytes, chunkOffset + 8);
  glb.set(jsonPadding, chunkOffset + 8 + jsonBytes.length);
  chunkOffset += 8 + jsonPaddedLength;

  // Binary chunk
  view.setUint32(chunkOffset, binaryPaddedLength, true); // chunk length
  view.setUint32(chunkOffset + 4, CHUNK_TYPE_BIN, true); // chunk type
  glb.set(binaryData, chunkOffset + 8);
  // Binary padding (zeros) - already zero-initialized

  return glb;
}

/**
 * Reads the clipId from a baked GLB by parsing the JSON chunk.
 */
export function readMotionGlbClipId(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Verify GLB magic
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    throw new Error("Not a valid GLB file: invalid magic");
  }

  const version = view.getUint32(4, true);
  if (version !== GLB_VERSION) {
    throw new Error(`Unsupported GLB version: ${version}`);
  }

  // Parse chunks
  let offset = 12;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      throw new Error("Truncated GLB chunk header");
    }
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;

    if (chunkType === CHUNK_TYPE_JSON) {
      if (offset + chunkLength > bytes.byteLength) {
        throw new Error("Truncated GLB JSON chunk");
      }
      const jsonBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + offset, chunkLength);
      // Remove padding (spaces)
      const jsonText = new TextDecoder().decode(jsonBytes).trimEnd();
      const gltf = JSON.parse(jsonText) as { asset?: { extras?: { openclinxrClipId?: string } } };
      const clipId = gltf.asset?.extras?.openclinxrClipId;
      if (!clipId) {
        throw new Error("GLB does not contain openclinxrClipId in asset.extras");
      }
      return clipId;
    }

    offset += alignTo4(chunkLength);
  }

  throw new Error("GLB does not contain a JSON chunk");
}

function alignTo4(value: number): number {
  return (value + 3) & ~3;
}