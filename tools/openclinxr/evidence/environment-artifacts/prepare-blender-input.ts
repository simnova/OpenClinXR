import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

export type BlenderInputPreparation = {
  /** Absolute path Blender must import (original when no decode needed). */
  blenderInputPath: string;
  /** True when a decompressed temp copy was produced. */
  decompressed: boolean;
  /** Remove the owned temp root (noop when no temp was created). */
  cleanup: () => Promise<void>;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error ? signal.reason : new Error("prepare blender input aborted");
  }
}

/**
 * Content-based EXT_meshopt_compression detection over the GLB JSON chunk.
 * Never trusts the file extension. Inspects ONLY the actual extension
 * records: extensionsUsed / extensionsRequired lists, the root extensions
 * object, and bufferView extensions encoding entries. An arbitrary JSON
 * string that merely mentions the literal (e.g. inside extras/metadata)
 * is NOT compression and must classify as uncompressed.
 *
 * Malformed JSON always throws; it is never classified as uncompressed.
 */
export function glbJsonTextUsesMeshopt(jsonText: string): boolean {
  const json = JSON.parse(jsonText) as {
    extensionsUsed?: unknown;
    extensionsRequired?: unknown;
    extensions?: unknown;
    bufferViews?: unknown;
  };
  if (Array.isArray(json.extensionsUsed) && json.extensionsUsed.includes("EXT_meshopt_compression")) return true;
  if (Array.isArray(json.extensionsRequired) && json.extensionsRequired.includes("EXT_meshopt_compression")) return true;
  if (typeof json.extensions === "object" && json.extensions !== null && "EXT_meshopt_compression" in json.extensions) return true;
  if (Array.isArray(json.bufferViews)) {
    for (const view of json.bufferViews) {
      if (
        typeof view === "object" &&
        view !== null &&
        "extensions" in view &&
        typeof (view as { extensions?: unknown }).extensions === "object" &&
        (view as { extensions?: Record<string, unknown> }).extensions !== null &&
        "EXT_meshopt_compression" in ((view as { extensions?: Record<string, unknown> }).extensions ?? {})
      ) {
        return true;
      }
    }
  }
  return false;
}

const GLB_MAGIC = "glTF";
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;

function readU32LE(glb: Uint8Array, offset: number): number {
  return Buffer.from(glb.subarray(offset, offset + 4)).readUInt32LE(0);
}

export function glbBytesUseMeshopt(glb: Uint8Array): boolean {
  if (glb.byteLength < 20) throw new Error("prepare blender input refuses non-GLB payload (too short)");
  const magic = Buffer.from(glb.subarray(0, 4)).toString("utf8");
  if (magic !== GLB_MAGIC) throw new Error("prepare blender input refuses non-GLB payload (bad magic)");
  const version = readU32LE(glb, 4);
  if (version !== GLB_VERSION) throw new Error(`prepare blender input refuses GLB version ${version} (expected 2)`);
  const totalLength = readU32LE(glb, 8);
  if (totalLength !== glb.byteLength) {
    throw new Error(`prepare blender input refuses GLB with declared length ${totalLength} but actual ${glb.byteLength}`);
  }
  const jsonLength = readU32LE(glb, 12);
  const chunkType = readU32LE(glb, 16);
  if (chunkType !== JSON_CHUNK_TYPE) throw new Error("prepare blender input refuses GLB with non-JSON first chunk");
  if (12 + 8 + jsonLength > glb.byteLength) throw new Error("prepare blender input refuses truncated GLB JSON chunk");
  const jsonText = Buffer.from(glb.subarray(20, 20 + jsonLength)).toString("utf8");
  try {
    return glbJsonTextUsesMeshopt(jsonText);
  } catch (error) {
    throw new Error(`prepare blender input refuses malformed GLB JSON chunk: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function isMeshoptCompressedGlb(glbPath: string): Promise<boolean> {
  const bytes = await readFile(glbPath);
  return glbBytesUseMeshopt(bytes);
}

/**
 * Provide a genuine semantically-identical decompressed GLB for the Blender
 * 5.1.1 glTF importer, which refuses EXT_meshopt_compression.
 *
 * - Uncompressed input: returns the original path (no-op, idempotent).
 * - Compressed input: decodes with the registered MeshoptDecoder, strips ONLY
 *   the encoding extension after decompression, writes an uncompressed UNIQUE
 *   owned temp, and returns it. All positions/indices/UVs/normals/skins/
 *   anims/morphs/materials/embedded image bytes/node names/transforms/other
 *   extensions are preserved; no resampling.
 * - Invalid/corrupt input: throws and removes any owned temp (fail closed).
 * - The caller keeps passing the canonical work GLB as --output so the
 *   existing simplify-after-bake path re-applies the published final
 *   compression policy; this bridge never changes that policy.
 */
export async function prepareBlenderReadableGlb(
  sourceGlbPath: string,
  options?: { tmpRoot?: string; signal?: AbortSignal },
): Promise<BlenderInputPreparation> {
  const signal = options?.signal;
  throwIfAborted(signal);
  const sourceBytes = await readFile(sourceGlbPath).catch((error: unknown) => {
    throw new Error(`prepare blender input cannot read ${sourceGlbPath}: ${error instanceof Error ? error.message : String(error)}`);
  });
  let compressed: boolean;
  try {
    compressed = glbBytesUseMeshopt(sourceBytes);
  } catch (error) {
    throw new Error(`prepare blender input refuses invalid GLB ${sourceGlbPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  throwIfAborted(signal);
  if (!compressed) {
    return {
      blenderInputPath: sourceGlbPath,
      decompressed: false,
      cleanup: async () => {},
    };
  }
  const tmpRoot = await mkdtemp(path.join(options?.tmpRoot ?? os.tmpdir(), "ocxr-blender-input-"));
  const outPath = path.join(tmpRoot, "blender-input.decompressed.glb");
  const cleanup = async (): Promise<void> => {
    await rm(tmpRoot, { recursive: true, force: true });
  };
  try {
    throwIfAborted(signal);
    await MeshoptDecoder.ready;
    throwIfAborted(signal);
    const io = new NodeIO()
      .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const doc = await io.read(sourceGlbPath);
    throwIfAborted(signal);
    // Buffers are already decoded in memory; dropping the extension record
    // only removes the compression container, never geometry or images.
    doc.createExtension(EXTMeshoptCompression).dispose();
    const plain = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    await plain.write(outPath, doc);
    throwIfAborted(signal);
    // Prove the bridge output is genuinely importable-shaped: valid GLB and
    // no remaining meshopt marker.
    const produced = await readFile(outPath);
    if (glbBytesUseMeshopt(produced)) {
      throw new Error("decompressed bridge output still carries EXT_meshopt_compression");
    }
    return { blenderInputPath: outPath, decompressed: true, cleanup };
  } catch (error) {
    await cleanup();
    if (signal?.aborted === true) {
      throw signal.reason instanceof Error ? signal.reason : new Error("prepare blender input aborted");
    }
    throw new Error(`prepare blender input failed to decompress ${sourceGlbPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
