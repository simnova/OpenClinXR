/**
 * Deterministic synthetic bake fixture for the room-bake harness suites.
 *
 * Replaces the historical asset-state oracles (fully-baked shipped albedo
 * images no longer carry black padding, so strict occupied>whole cannot hold
 * on them) with controlled GLBs whose pixel means are known independently:
 *
 * - wall:    10x10 field at luminance 180 with a 4x4 black island
 *            occupiedMean = 180, wholeMean = 151.2, occupiedCount = 84
 * - floor:   10x10 uniform field at luminance 100 (fully occupied)
 * - ceiling: 10x10 field at luminance 50 with a 2x2 black island
 *            occupiedMean = 50, wholeMean = 48, occupiedCount = 96
 *
 * Two role-naming schemas exercise both measurement paths in
 * measureSurfaceMeans: "node-role" (bedroom_0/0.{wall,floor,ceiling} nodes,
 * surface_-prefixed texture names hit the preferred-texture path) and
 * "bake-name" (generic node names, openclinxr_room_bake_surface_* material
 * names hit the bake-name fallback path).
 *
 * Negative controls: buildAllBlackBakeGlb() yields occupiedCount 0 on every
 * surface; buildMissingTextureBakeGlb() omits a surface texture so the
 * measure throws "missing ... bake image".
 *
 * PNG encoding uses node:zlib deflateSync plus an inline CRC32 (no new
 * dependencies); GLB assembly uses glTF-Transform Document + NodeIO with
 * ALL_EXTENSIONS, the same registration the harness uses to read.
 */
import { deflateSync } from "node:zlib";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

export const SYNTHETIC_WALL_BRIGHT = 180;
export const SYNTHETIC_WALL_SIZE = 10;
export const SYNTHETIC_WALL_ISLAND = 4;
export const SYNTHETIC_WALL_WHOLE_MEAN = 151.2;
export const SYNTHETIC_WALL_OCCUPIED = 84;
export const SYNTHETIC_FLOOR_MEAN = 100;
export const SYNTHETIC_CEILING_MEAN = 50;
export const SYNTHETIC_CEILING_ISLAND = 2;
export const SYNTHETIC_CEILING_WHOLE_MEAN = 48;
export const SYNTHETIC_CEILING_OCCUPIED = 96;

export type SyntheticNaming = "node-role" | "bake-name";

/** Row-major luminance field with a top-left black island. */
export function syntheticField(size: number, bright: number, island: number): number[] {
  const out = new Array<number>(size * size).fill(bright);
  for (let y = 0; y < island; y += 1) {
    for (let x = 0; x < island; x += 1) {
      out[y * size + x] = 0;
    }
  }
  return out;
}

export function syntheticWallSamples(): number[] {
  return syntheticField(SYNTHETIC_WALL_SIZE, SYNTHETIC_WALL_BRIGHT, SYNTHETIC_WALL_ISLAND);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Minimal 8-bit greyscale PNG encoder (filter 0, one IDAT). */
export function encodeGreyPng(size: number, samples: ArrayLike<number>): Uint8Array {
  const raw = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size + 1)] = 0;
    for (let x = 0; x < size; x += 1) raw[y * (size + 1) + 1 + x] = samples[y * size + x] ?? 0;
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const idat = new Uint8Array(deflateSync(raw));
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function addTexturedQuad(
  doc: Document,
  nodeName: string,
  textureName: string,
  materialName: string,
  png: Uint8Array,
): void {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const pos = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(positions)
    .setBuffer(buffer);
  const uv = doc
    .createAccessor()
    .setType("VEC2")
    .setArray(uvs)
    .setBuffer(buffer);
  const idx = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2, 0, 2, 3]))
    .setBuffer(buffer);
  const tex = doc.createTexture(textureName).setMimeType("image/png").setImage(png);
  const mat = doc
    .createMaterial(materialName)
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(1);
  mat.setBaseColorTexture(tex);
  const prim = doc.createPrimitive().setAttribute("POSITION", pos).setAttribute("TEXCOORD_0", uv).setIndices(idx).setMaterial(mat);
  const mesh = doc.createMesh(`${nodeName}-mesh`).addPrimitive(prim);
  doc.createNode(nodeName).setMesh(mesh);
}

export async function buildSyntheticBakeGlb(naming: SyntheticNaming = "node-role"): Promise<Uint8Array> {
  const doc = new Document();
  doc.createBuffer();
  const size = SYNTHETIC_WALL_SIZE;
  const surfaces = [
    { role: "wall", png: encodeGreyPng(size, syntheticWallSamples()) },
    { role: "floor", png: encodeGreyPng(size, new Array<number>(size * size).fill(SYNTHETIC_FLOOR_MEAN)) },
    {
      role: "ceiling",
      png: encodeGreyPng(size, syntheticField(size, SYNTHETIC_CEILING_MEAN, SYNTHETIC_CEILING_ISLAND)),
    },
  ] as const;
  const bakeMaterial: Record<string, string> = {
    wall: "openclinxr_room_bake_surface_wall_shader_hexagon",
    floor: "openclinxr_room_bake_surface_floor_shader_square_tile",
    ceiling: "openclinxr_room_bake_surface_ceiling_shader_plaster",
  };
  for (const { role, png } of surfaces) {
    if (naming === "node-role") {
      addTexturedQuad(doc, `bedroom_0/0.${role}`, `surface_${role}_synthetic`, `shell_bake_${role}`, png);
    } else {
      addTexturedQuad(doc, `room_part_${role}`, `bake_image_${role}`, bakeMaterial[role]!, png);
    }
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  return new Uint8Array(await io.writeBinary(doc));
}

/** Urgent-care shape: black wall, black ceiling, padded bright floor. */
export async function buildUrgentCareShapeGlb(): Promise<Uint8Array> {
  const doc = new Document();
  doc.createBuffer();
  const size = SYNTHETIC_WALL_SIZE;
  const black = encodeGreyPng(size, new Array<number>(size * size).fill(0));
  const floor = encodeGreyPng(size, syntheticField(size, SYNTHETIC_FLOOR_MEAN, SYNTHETIC_WALL_ISLAND));
  const ceiling = encodeGreyPng(size, new Array<number>(size * size).fill(SYNTHETIC_CEILING_MEAN));
  addTexturedQuad(doc, "bedroom_0/0.wall", "surface_wall_synthetic", "shell_bake_wall", black);
  addTexturedQuad(doc, "bedroom_0/0.floor", "surface_floor_synthetic", "shell_bake_floor", floor);
  addTexturedQuad(doc, "bedroom_0/0.ceiling", "surface_ceiling_synthetic", "shell_bake_ceiling", ceiling);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  return new Uint8Array(await io.writeBinary(doc));
}

/** Every surface fully black: occupiedCount must be 0 on all three surfaces. */
export async function buildAllBlackBakeGlb(): Promise<Uint8Array> {
  const doc = new Document();
  doc.createBuffer();
  const size = SYNTHETIC_WALL_SIZE;
  const black = encodeGreyPng(size, new Array<number>(size * size).fill(0));
  for (const role of ["wall", "floor", "ceiling"] as const) {
    addTexturedQuad(doc, `bedroom_0/0.${role}`, `surface_${role}_synthetic`, `shell_bake_${role}`, black);
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  return new Uint8Array(await io.writeBinary(doc));
}

/** Ceiling primitive carries no texture: measureSurfaceMeans must throw. */
export async function buildMissingTextureBakeGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const size = SYNTHETIC_WALL_SIZE;
  for (const role of ["wall", "floor"] as const) {
    const bright = role === "wall" ? SYNTHETIC_WALL_BRIGHT : SYNTHETIC_FLOOR_MEAN;
    addTexturedQuad(
      doc,
      `bedroom_0/0.${role}`,
      `surface_${role}_synthetic`,
      `shell_bake_${role}`,
      encodeGreyPng(size, new Array<number>(size * size).fill(bright)),
    );
  }
  const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array(12)).setBuffer(buffer);
  const idx = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer);
  const bare = doc.createMaterial("shell_bake_ceiling");
  const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx).setMaterial(bare);
  doc.createNode("bedroom_0/0.ceiling").setMesh(doc.createMesh("bedroom_0/0.ceiling-mesh").addPrimitive(prim));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  return new Uint8Array(await io.writeBinary(doc));
}
