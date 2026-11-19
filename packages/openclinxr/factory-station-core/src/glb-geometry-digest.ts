import { createHash } from "node:crypto";

const NCOMP: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

const CSIZE: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

type SparseSection = {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
};

type Accessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  normalized?: boolean;
  type: string;
  sparse?: {
    count?: number;
    indices?: SparseSection;
    values?: SparseSection;
  };
};

type BufferView = {
  buffer?: number;
  byteOffset?: number;
  byteLength?: number;
  byteStride?: number;
};

type Primitive = {
  attributes?: Record<string, number>;
  indices?: number;
  mode?: number;
  targets?: Array<Record<string, number>>;
};

type Mesh = {
  name?: string;
  primitives?: Primitive[];
};

type Skin = {
  name?: string;
  inverseBindMatrices?: number;
  joints?: number[];
};

type GlNode = {
  matrix?: number[];
  rotation?: number[];
  scale?: number[];
  translation?: number[];
};

type GltfDoc = {
  accessors?: Accessor[];
  buffers?: Array<{ byteLength?: number; uri?: string }>;
  bufferViews?: BufferView[];
  meshes?: Mesh[];
  nodes?: GlNode[];
  skins?: Skin[];
};

/** Geometry-plus-rig-identity sha256 over decoded mesh, morph, mode, skin-IBM and joint data, keyed by role. */
export function glbGeometryDigest(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("glbGeometryDigest: not a GLB");
  }
  if (view.getUint32(4, true) !== 2) throw new Error("glbGeometryDigest: unsupported version");
  if (view.getUint32(8, true) !== bytes.length) {
    throw new Error("glbGeometryDigest: header length disagrees with byte length");
  }
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK || 20 + jsonLen > bytes.length) {
    throw new Error("glbGeometryDigest: JSON chunk out of bounds");
  }
  const doc = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)),
  ) as GltfDoc;
  const next = 20 + jsonLen;
  let binary: Uint8Array;
  if (next === bytes.length) {
    binary = new Uint8Array(0);
  } else {
    if (next + 8 > bytes.length) throw new Error("glbGeometryDigest: BIN header out of bounds");
    const binLen = view.getUint32(next, true);
    if (view.getUint32(next + 4, true) !== BIN_CHUNK || next + 8 + binLen !== bytes.length) {
      throw new Error("glbGeometryDigest: BIN chunk out of bounds");
    }
    binary = bytes.subarray(next + 8, next + 8 + binLen);
  }
  for (const [bi, buf] of (doc.buffers ?? []).entries()) {
    if (buf.uri !== undefined) {
      throw new Error(`glbGeometryDigest: buffer ${bi} has a uri (GLB BIN chunk only)`);
    }
  }
  for (const [bi, bv] of (doc.bufferViews ?? []).entries()) {
    if ((bv.buffer ?? 0) !== 0) {
      throw new Error(`glbGeometryDigest: bufferView ${bi} selects buffer ${bv.buffer} (GLB BIN chunk only)`);
    }
    if (
      bv.byteLength === undefined ||
      (bv.byteOffset ?? 0) < 0 ||
      bv.byteLength < 0 ||
      (bv.byteOffset ?? 0) + bv.byteLength > binary.length
    ) {
      throw new Error(`glbGeometryDigest: bufferView ${bi} outside the BIN chunk`);
    }
  }
  const roleHex = new Map<string, string>();
  const setRole = (role: string, hex: string): void => {
    if (roleHex.has(role)) throw new Error(`glbGeometryDigest: duplicate role ${role}`);
    roleHex.set(role, hex);
  };
  for (const [mi, mesh] of (doc.meshes ?? []).entries()) {
    const meshKey = `mesh${mi}:${mesh.name ?? `mesh${mi}`}`;
    for (const [pi, prim] of (mesh.primitives ?? []).entries()) {
      const tag = `${meshKey}#prim${pi}`;
      setRole(`${tag}/mode`, shaUtf8(String(prim.mode ?? 4)));
      if (prim.indices !== undefined) {
        setRole(`${tag}/indices`, shaAccessor(doc, binary, prim.indices));
      }
      for (const [attr, ai] of Object.entries(prim.attributes ?? {})) {
        setRole(`${tag}/${attr}`, shaAccessor(doc, binary, ai));
      }
      for (const [ti, target] of (prim.targets ?? []).entries()) {
        for (const [attr, ai] of Object.entries(target ?? {})) {
          setRole(`${tag}/target${ti}/${attr}`, shaAccessor(doc, binary, ai));
        }
      }
    }
  }
  for (const [si, skin] of (doc.skins ?? []).entries()) {
    const skinKey = `skin${si}:${skin.name ?? `skin${si}`}`;
    if (skin.inverseBindMatrices !== undefined) {
      setRole(`${skinKey}/ibm`, shaAccessor(doc, binary, skin.inverseBindMatrices));
    }
    if (skin.joints !== undefined) {
      setRole(`${skinKey}/joints`, shaUtf8(JSON.stringify(skin.joints)));
      for (const [n, joint] of skin.joints.entries()) {
        const node = doc.nodes?.[joint];
        if (node === undefined) throw new Error(`glbGeometryDigest: joint ${joint} has no node`);
        setRole(`${skinKey}/joint${n}`, shaUtf8(`node:${joint} ${nodeTransform(node)}`));
      }
    }
  }
  const lines = [...roleHex.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([role, hex]) => `${escapeRole(role)}=${hex}\n`)
    .join("");
  return createHash("sha256").update(lines, "utf8").digest("hex");
}

/**
 * rv6 F1: role names come from author-controlled JSON (mesh/skin/attribute names), so the
 * `role=hex` line format must not let a name forge a record boundary. Backslash-escaping
 * `\\`, `=`, and newline keeps the encoding injective while leaving every shipped role
 * byte-identical (none contains those characters), so committed pins do not move.
 */
function escapeRole(role: string): string {
  return role.replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\n/g, "\\n");
}

function shaUtf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function nodeTransform(node: GlNode): string {
  if (node.matrix !== undefined) return `matrix:${node.matrix.join(",")}`;
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  return `trs:${t.join(",")};${r.join(",")};${s.join(",")}`;
}

function shaAccessor(doc: GltfDoc, binary: Uint8Array, ai: number): string {
  const acc = doc.accessors?.[ai];
  if (acc === undefined) throw new Error(`glbGeometryDigest: missing accessor ${ai}`);
  const ncomp = NCOMP[acc.type] ?? 0;
  const size = CSIZE[acc.componentType] ?? 0;
  if (
    ncomp === 0 ||
    size === 0 ||
    !Number.isInteger(acc.count) ||
    acc.count < 0 ||
    !Number.isInteger(acc.componentType)
  ) {
    throw new Error(`glbGeometryDigest: unknown accessor layout ${ai}`);
  }
  const elem = ncomp * size;
  const hash = createHash("sha256");
  hash.update(`${acc.count},${acc.type},${acc.componentType},${acc.normalized ?? false}\n`, "utf8");
  const payload = new Uint8Array(acc.count * elem);
  if (acc.bufferView !== undefined) {
    const bv = doc.bufferViews?.[acc.bufferView];
    if (bv === undefined) throw new Error(`glbGeometryDigest: missing bufferView ${acc.bufferView}`);
    const stride = bv.byteStride ?? elem;
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    if (
      (acc.byteOffset ?? 0) < 0 ||
      stride < elem ||
      base + (acc.count - 1) * stride + elem > (bv.byteOffset ?? 0) + (bv.byteLength ?? 0)
    ) {
      throw new Error(`glbGeometryDigest: accessor ${ai} outside its bufferView`);
    }
    for (let i = 0; i < acc.count; i += 1) {
      payload.set(binary.subarray(base + i * stride, base + i * stride + elem), i * elem);
    }
  }
  const sparse = acc.sparse;
  if (sparse !== undefined) {
    const sparseCount = sparse.count ?? 0;
    if (!Number.isInteger(sparseCount) || sparseCount < 0 || sparseCount > acc.count) {
      throw new Error(`glbGeometryDigest: bad sparse count on accessor ${ai}`);
    }
    const idxSection = sparse.indices;
    const valSection = sparse.values;
    if (idxSection?.bufferView === undefined || valSection?.bufferView === undefined) {
      throw new Error(`glbGeometryDigest: sparse section without bufferView on accessor ${ai}`);
    }
    const idxSize = CSIZE[idxSection.componentType ?? 0] ?? 0;
    if (
      idxSection.componentType !== 5121 &&
      idxSection.componentType !== 5123 &&
      idxSection.componentType !== 5125
    ) {
      throw new Error(`glbGeometryDigest: bad sparse index type on accessor ${ai}`);
    }
    const idxBytes = sectionBytes(doc, binary, idxSection, sparseCount * idxSize, `sparse indices ${ai}`);
    const valBytes = sectionBytes(doc, binary, valSection, sparseCount * elem, `sparse values ${ai}`);
    const idxView = new DataView(idxBytes.buffer, idxBytes.byteOffset, idxBytes.byteLength);
    for (let k = 0; k < sparseCount; k += 1) {
      const at = k * idxSize;
      const index =
        idxSize === 1 ? idxView.getUint8(at) : idxSize === 2 ? idxView.getUint16(at, true) : idxView.getUint32(at, true);
      if (index >= acc.count) throw new Error(`glbGeometryDigest: sparse index out of range ${ai}`);
      payload.set(valBytes.subarray(k * elem, k * elem + elem), index * elem);
    }
  }
  hash.update(payload);
  return hash.digest("hex");
}

function sectionBytes(
  doc: GltfDoc,
  binary: Uint8Array,
  section: SparseSection,
  length: number,
  what: string,
): Uint8Array {
  const bv = doc.bufferViews?.[section.bufferView ?? -1];
  if (bv === undefined) throw new Error(`glbGeometryDigest: missing bufferView for ${what}`);
  const base = (bv.byteOffset ?? 0) + (section.byteOffset ?? 0);
  if ((section.byteOffset ?? 0) < 0 || base + length > (bv.byteOffset ?? 0) + (bv.byteLength ?? 0)) {
    throw new Error(`glbGeometryDigest: ${what} outside its bufferView`);
  }
  return binary.subarray(base, base + length);
}
