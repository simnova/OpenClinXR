#!/usr/bin/env pnpm exec tsx
/**
 * ship-superset.ts — loss gate: the candidate GLB must carry every shipped
 * loss class the main GLB carries.
 *
 * Fails (exit 1, one line per loss) when:
 * - an animation name in main is missing from candidate; a name-present
 *   candidate animation with 0 channels, 0 samplers, a different channel
 *   count, a retargeted channel (different target node/path), an invalid
 *   sampler/accessor reference, a changed sampler (different interpolation,
 *   input/output accessor layout, or resolved input/output keyframe bytes)
 *   is also a loss;
 * - a main mesh name is absent from candidate (`mesh missing in
 *   candidate: <name>`), except nothing: --decimated-mesh excuses only a
 *   tri DROP, never absence (a rise is a loss);
 * - a non-decimated mesh tri count differs (mode-aware: TRIANGLES n/3,
 *   STRIP/FAN n-2, n = indices count else POSITION count);
 * - a non-decimated mesh primitive structure differs (primitive count,
 *   per-primitive mode, attribute key set, per-accessor full layout:
 *   componentType/type/count + bufferView/byteOffset/byteStride/
 *   normalized/sparse) or morph targets differ (target count, per-target
 *   attribute keys, per-target accessor layouts);
 * - a referenced accessor's BIN bytes differ (sha256 over the exact
 *   bytes the accessor references: strided gather plus sparse
 *   indices/values, with a zero base when no bufferView is present; only
 *   pure zero-fill accessors and the no-BIN-on-both-sides layout-only mode
 *   skip, and a missing/asymmetric required BIN payload is an unreadable
 *   loss, never a skip);
 * - candidate asset.copyright is empty (always a loss) or does not
 *   contain main's copyright text (only checked when main carries a
 *   non-empty notice);
 * - an asset.extras key of main is missing from candidate own keys.
 *
 * Exits 0 otherwise. Usage/file/malformed-primitive errors exit 2,
 * naming the mesh and primitive index (unsupported primitive mode,
 * missing POSITION on a non-indexed primitive, missing/non-numeric
 * accessor, empty or duplicate mesh names in either file, empty or
 * duplicate animation names in either file, or a --decimated-mesh name
 * matching no main mesh).
 *
 * Triangle counts and layout signatures come from the JSON chunk; the
 * exact referenced geometry bytes are hashed from the BIN chunk
 * (stride/sparse aware). Texture-image bytes and materials are never
 * compared (the colour stage legitimately changes baseColorFactor).
 * The reduced tri-only rule for declared decimation is unchanged:
 * decimated meshes skip structure/accessor-count comparison entirely.
 *
 * Index-layout relaxation: when both sides have BIN payloads, compare
 * TRIANGLES by a multiset of cyclic POSITION keys and material indices.
 * An opening-unhide stage may trim hidden indices and append triangles on
 * the writer's skin slot. Attribute and morph payloads on any appended
 * primitive must match the source. Other modes and unsupported layouts are
 * refused by the BIN triangle decoder. Without both BIN payloads the strict
 * layout check applies.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

interface GltfPrimitive {
  indices?: number;
  mode?: number;
  material?: number;
  attributes?: Record<string, number>;
  targets?: Array<Record<string, number>>;
}

interface GltfMesh {
  name?: string;
  primitives?: GltfPrimitive[];
}

interface GltfChannelTarget {
  node?: number;
  path?: string;
}

interface GltfChannel {
  sampler?: number;
  target?: GltfChannelTarget;
}

interface GltfSampler {
  input?: number;
  output?: number;
  interpolation?: string;
}

interface GltfAnimation {
  name?: string;
  channels?: GltfChannel[];
  samplers?: GltfSampler[];
}

interface GltfSparseIndices {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
}

interface GltfSparseValues {
  bufferView?: number;
  byteOffset?: number;
}

interface GltfSparse {
  count?: number;
  indices?: GltfSparseIndices;
  values?: GltfSparseValues;
}

export interface GltfAccessor {
  count?: unknown;
  componentType?: unknown;
  type?: unknown;
  bufferView?: number;
  byteOffset?: number;
  normalized?: boolean;
  sparse?: GltfSparse;
}

export interface GltfBufferView {
  buffer?: number;
  byteOffset?: number;
  byteLength?: number;
  byteStride?: number;
}

export interface GltfRoot {
  asset?: { copyright?: unknown; extras?: unknown };
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  meshes?: GltfMesh[];
  animations?: GltfAnimation[];
  materials?: Array<{ name?: string }>;
}

/** Optional per-side BIN chunks; without them only layout is compared. */
export interface GlbBins {
  main?: Uint8Array;
  candidate?: Uint8Array;
}

/** Read and parse the JSON chunk of a .glb file. Throws on bad magic. */
export function readGlbJson(path: string): GltfRoot {
  return readGlb(path).json;
}

/** Read the JSON chunk and the BIN chunk of a .glb file. Throws on bad magic. */
export function readGlb(path: string): { json: GltfRoot; bin: Buffer } {
  const bytes = readFileSync(path);
  if (bytes.length < 20 || bytes.subarray(0, 4).toString("binary") !== "glTF") {
    throw new Error(`ship-superset: not a GLB file: ${path}`);
  }
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as GltfRoot;
  let bin = Buffer.alloc(0);
  const binHeaderAt = 20 + jsonLength;
  if (binHeaderAt + 8 <= bytes.length) {
    const binLength = bytes.readUInt32LE(binHeaderAt);
    const binType = bytes.readUInt32LE(binHeaderAt + 4);
    if (binType === 0x004e4942 && binLength > 0 && binHeaderAt + 8 + binLength <= bytes.length) {
      bin = bytes.subarray(binHeaderAt + 8, binHeaderAt + 8 + binLength);
    }
  }
  return { json, bin };
}

function accessorCount(accessors: GltfAccessor[], index: number, where: string): number {
  const accessor = accessors[index];
  if (accessor === undefined) {
    throw new Error(`ship-superset: ${where} references missing accessor ${index}`);
  }
  if (typeof accessor.count !== "number" || !Number.isFinite(accessor.count)) {
    throw new Error(`ship-superset: accessor ${index} carries no numeric count (${where})`);
  }
  return accessor.count;
}

/**
 * Triangle count of one primitive. Throws (exit 2 upstream) naming the
 * mesh and primitive index on malformed structure.
 */
function primTris(
  prim: GltfPrimitive,
  accessors: GltfAccessor[],
  meshName: string,
  primIndex: number,
): number {
  const where = `mesh ${JSON.stringify(meshName)} primitive ${primIndex}`;
  const mode = prim.mode ?? 4;
  let n: number;
  if (prim.indices !== undefined) {
    n = accessorCount(accessors, prim.indices, where);
  } else {
    const position = prim.attributes?.["POSITION"];
    if (position === undefined) {
      throw new Error(`ship-superset: ${where} has no indices and no POSITION attribute`);
    }
    n = accessorCount(accessors, position, where);
  }
  if (mode === 4) return Math.floor(n / 3);
  if (mode === 5 || mode === 6) return Math.max(0, n - 2);
  throw new Error(`ship-superset: ${where} carries unsupported mode ${mode} (only TRIANGLES/STRIP/FAN = 4/5/6)`);
}

/**
 * Per-mesh triangle counts keyed by mesh name. Validates names (exit 2
 * upstream): empty or duplicate mesh names in either file are rejected.
 */
export function meshTris(gltf: GltfRoot, file = "glb"): Map<string, number> {
  const accessors = gltf.accessors ?? [];
  const out = new Map<string, number>();
  const meshes = gltf.meshes ?? [];
  for (let i = 0; i < meshes.length; i += 1) {
    const mesh = meshes[i] as GltfMesh;
    const name = mesh.name;
    if (typeof name !== "string" || name === "") {
      throw new Error(`ship-superset: empty mesh name at mesh index ${i} in ${file}`);
    }
    if (out.has(name)) {
      throw new Error(`ship-superset: duplicate mesh name ${JSON.stringify(name)} in ${file}`);
    }
    let tris = 0;
    const prims = mesh.primitives ?? [];
    for (let p = 0; p < prims.length; p += 1) {
      tris += primTris(prims[p] as GltfPrimitive, accessors, name, p);
    }
    out.set(name, tris);
  }
  return out;
}

/**
 * Animation clips keyed by name. Validates names (exit 2 upstream):
 * empty or duplicate animation names in either file are rejected, so one
 * same-named clip can never stand in for two.
 */
function animNameMap(anims: GltfAnimation[] | undefined, file: string): Map<string, GltfAnimation> {
  const out = new Map<string, GltfAnimation>();
  const list = anims ?? [];
  for (let i = 0; i < list.length; i += 1) {
    const clip = list[i] as GltfAnimation;
    const name = clip?.name;
    if (typeof name !== "string" || name === "") {
      throw new Error(`ship-superset: empty animation name at animation index ${i} in ${file}`);
    }
    if (out.has(name)) {
      throw new Error(`ship-superset: duplicate animation name ${JSON.stringify(name)} in ${file}`);
    }
    out.set(name, clip);
  }
  return out;
}

const COMPONENT_SIZES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

function elementSize(componentType: unknown, type: unknown): number {
  if (typeof componentType !== "number" || typeof type !== "string") return 0;
  return (COMPONENT_SIZES[componentType] ?? 0) * (TYPE_COMPONENTS[type] ?? 0);
}

/** Resolved stride for an accessor: interleaved view stride else tight. */
function viewStride(views: GltfBufferView[], index: number | undefined): number {
  if (index === undefined) return 0;
  const stride = views[index]?.byteStride;
  return typeof stride === "number" ? stride : 0;
}

function sparseSig(sparse: GltfSparse | undefined): string {
  if (sparse === undefined) return "x";
  const count = typeof sparse.count === "number" ? String(sparse.count) : "?";
  const idx = sparse.indices;
  const val = sparse.values;
  const idxSig = idx === undefined ? "x" : `${idx.bufferView ?? "x"},${idx.byteOffset ?? 0},${idx.componentType ?? "?"}`;
  const valSig = val === undefined ? "x" : `${val.bufferView ?? "x"},${val.byteOffset ?? 0}`;
  return `c${count}/i${idxSig}/v${valSig}`;
}

/** Full layout signature: base sig plus placement, stride, flags, sparse. */
function accessorLayoutSig(accessor: GltfAccessor | undefined, views: GltfBufferView[]): string {
  if (accessor === undefined) return "missing";
  const ct = typeof accessor.componentType === "number" ? String(accessor.componentType) : "?";
  const ty = typeof accessor.type === "string" ? accessor.type : "?";
  const n = typeof accessor.count === "number" ? String(accessor.count) : "?";
  const bv = accessor.bufferView === undefined ? "x" : String(accessor.bufferView);
  const off = typeof accessor.byteOffset === "number" ? String(accessor.byteOffset) : "0";
  const stride = String(viewStride(views, accessor.bufferView));
  const norm = accessor.normalized === true ? "1" : "0";
  return `${ct}/${ty}/${n}/bv${bv}/off${off}/st${stride}/n${norm}/sp${sparseSig(accessor.sparse)}`;
}

function viewBytes(bin: Uint8Array, base: number, len: number): Buffer | null {
  if (!Number.isInteger(base) || !Number.isInteger(len) || base < 0 || len < 0) return null;
  if (base + len > bin.length) return null;
  return Buffer.from(bin.subarray(base, base + len));
}

type AccessorBytes = { kind: "skip" } | { kind: "unreadable"; reason: string } | { kind: "ok"; digest: string };

/**
 * sha256 over the exact bytes an accessor references: strided gather of
 * the base range plus sparse indices/values when present. "skip" only when
 * there is no BIN chunk (layout-only mode) or the accessor is pure
 * zero-fill (no bufferView and no sparse patches: per glTF spec the base
 * is zeros and layout equality already decides it). A sparse accessor
 * without a base bufferView still hashes its sparse indices/values over a
 * zero base — sparse payload is never skipped.
 */
function accessorBytes(accessor: GltfAccessor, views: GltfBufferView[], bin: Uint8Array | undefined): AccessorBytes {
  if (bin === undefined || bin.length === 0) return { kind: "skip" };
  const count = accessor.count;
  const elem = elementSize(accessor.componentType, accessor.type);
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || elem <= 0) {
    return { kind: "unreadable", reason: "bad count/type" };
  }
  const sparse = accessor.sparse;
  let scount = 0;
  if (sparse !== undefined) {
    if (typeof sparse.count !== "number" || !Number.isInteger(sparse.count) || sparse.count < 0) {
      return { kind: "unreadable", reason: "bad sparse count" };
    }
    scount = sparse.count;
  }
  const parts: Buffer[] = [];
  if (accessor.bufferView === undefined) {
    if (scount === 0) return { kind: "skip" };
    if (count > 0) parts.push(Buffer.alloc(count * elem));
  } else {
    const view = views[accessor.bufferView];
    if (view === undefined) return { kind: "unreadable", reason: "missing bufferView" };
    const stride = view.byteStride ?? elem;
    if (!Number.isInteger(stride) || stride < elem) return { kind: "unreadable", reason: "bad stride" };
    const accOff = typeof accessor.byteOffset === "number" ? accessor.byteOffset : 0;
    const base = (view.byteOffset ?? 0) + accOff;
    if (count > 0) {
      if (stride === elem) {
        const flat = viewBytes(bin, base, count * elem);
        if (flat === null) return { kind: "unreadable", reason: "geometry range" };
        parts.push(flat);
      } else {
        const out = Buffer.alloc(count * elem);
        for (let i = 0; i < count; i += 1) {
          const piece = viewBytes(bin, base + i * stride, elem);
          if (piece === null) return { kind: "unreadable", reason: "geometry range" };
          piece.copy(out, i * elem);
        }
        parts.push(out);
      }
    }
  }
  if (scount > 0) {
    const idx = sparse?.indices;
    const val = sparse?.values;
    if (idx === undefined || val === undefined) return { kind: "unreadable", reason: "sparse half missing" };
    if (idx.componentType !== 5121 && idx.componentType !== 5123 && idx.componentType !== 5125) {
      return { kind: "unreadable", reason: "bad sparse index type" };
    }
    const idxSize = COMPONENT_SIZES[idx.componentType] ?? 0;
    const idxView = idx.bufferView === undefined ? undefined : views[idx.bufferView];
    const valView = val.bufferView === undefined ? undefined : views[val.bufferView];
    if (idxView === undefined || valView === undefined) {
      return { kind: "unreadable", reason: "sparse view missing" };
    }
    const idxBytes = viewBytes(bin, (idxView.byteOffset ?? 0) + (idx.byteOffset ?? 0), scount * idxSize);
    const valBytes = viewBytes(bin, (valView.byteOffset ?? 0) + (val.byteOffset ?? 0), scount * elem);
    if (idxBytes === null || valBytes === null) return { kind: "unreadable", reason: "sparse range" };
    parts.push(idxBytes, valBytes);
  }
  return { kind: "ok", digest: createHash("sha256").update(Buffer.concat(parts)).digest("hex") };
}

/** Byte-hash comparison for one accessor reference; layout diffs are handled by the caller. */
function compareRefBytes(
  ref: string,
  mainIdx: number | undefined,
  candIdx: number | undefined,
  mainAccessors: GltfAccessor[],
  candAccessors: GltfAccessor[],
  mainViews: GltfBufferView[],
  candViews: GltfBufferView[],
  bins: GlbBins,
  meshName: string,
  primIndex: number,
): string[] {
  if (mainIdx === undefined || candIdx === undefined) return [];
  const m = mainAccessors[mainIdx];
  const c = candAccessors[candIdx];
  if (m === undefined || c === undefined) return [];
  if (accessorLayoutSig(m, mainViews) !== accessorLayoutSig(c, candViews)) return [];
  const mainHas = bins.main !== undefined && bins.main.length > 0;
  const candHas = bins.candidate !== undefined && bins.candidate.length > 0;
  if (!mainHas && !candHas) return [];
  if (mainHas !== candHas) {
    const missing = mainHas ? "candidate BIN missing" : "main BIN missing";
    return [`mesh bytes unreadable: ${meshName} primitive ${primIndex} ${ref} (${missing})`];
  }
  const mb = accessorBytes(m, mainViews, bins.main);
  const cb = accessorBytes(c, candViews, bins.candidate);
  if (mb.kind === "skip" && cb.kind === "skip") return [];
  if (mb.kind === "skip" || cb.kind === "skip") {
    return [`mesh bytes unreadable: ${meshName} primitive ${primIndex} ${ref} (asymmetric payload)`];
  }
  if (mb.kind === "unreadable" || cb.kind === "unreadable") {
    const why = mb.kind === "unreadable" ? `main ${mb.reason}` : `candidate ${cb.kind === "unreadable" ? cb.reason : "?"}`;
    return [`mesh bytes unreadable: ${meshName} primitive ${primIndex} ${ref} (${why})`];
  }
  if (mb.digest !== cb.digest) {
    return [`mesh bytes mismatch: ${meshName} primitive ${primIndex} ${ref} main=${mb.digest} candidate=${cb.digest}`];
  }
  return [];
}

function readIndexList(accessor: GltfAccessor, views: GltfBufferView[], bin: Uint8Array): number[] | string {
  const count = accessor.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return "invalid count";
  const ct = accessor.componentType;
  const size = ct === 5121 ? 1 : ct === 5123 ? 2 : ct === 5125 ? 4 : ct === 5122 ? 2 : 0;
  if (count === 0) return [];
  if (size === 0) return "unsupported component type";
  if (accessor.sparse !== undefined) return "sparse";
  if (accessor.bufferView === undefined) return "missing bufferView reference";
  const view = views[accessor.bufferView];
  if (view === undefined) return "missing bufferView";
  const stride = view.byteStride ?? size;
  if (!Number.isInteger(stride) || stride < size) return "invalid byte stride";
  const accOff = typeof accessor.byteOffset === "number" ? accessor.byteOffset : 0;
  const base = (view.byteOffset ?? 0) + accOff;
  const out: number[] = [];
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < count; i += 1) {
    const at = base + i * stride;
    if (at + size > bin.length) return "index bytes exceed BIN length";
    if (ct === 5121) out.push(dv.getUint8(at));
    else if (ct === 5123) out.push(dv.getUint16(at, true));
    else if (ct === 5125) out.push(dv.getUint32(at, true));
    else out.push(dv.getInt16(at, true));
  }
  return out;
}

/** Dense accessor payload bytes with sparse patches applied. */
function resolveAccessorPayload(accessor: GltfAccessor, views: GltfBufferView[], bin: Uint8Array): Buffer | null {
  const count = accessor.count;
  const elem = elementSize(accessor.componentType, accessor.type);
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || elem <= 0) return null;
  let dense: Buffer;
  if (accessor.bufferView === undefined) {
    dense = Buffer.alloc(count * elem);
  } else {
    const view = views[accessor.bufferView];
    if (view === undefined) return null;
    const stride = view.byteStride ?? elem;
    if (!Number.isInteger(stride) || stride < elem) return null;
    const accOff = typeof accessor.byteOffset === "number" ? accessor.byteOffset : 0;
    const base = (view.byteOffset ?? 0) + accOff;
    dense = Buffer.alloc(count * elem);
    for (let i = 0; i < count; i += 1) {
      const at = base + i * stride;
      const bytes = viewBytes(bin, at, elem);
      if (bytes === null) return null;
      bytes.copy(dense, i * elem);
    }
  }
  const sparse = accessor.sparse;
  if (sparse !== undefined && (sparse.count ?? 0) > 0) {
    const scount = sparse.count as number;
    if (!Number.isInteger(scount) || scount < 0) return null;
    const idx = sparse.indices;
    const val = sparse.values;
    if (idx === undefined || val === undefined) return null;
    const idxSize = idx.componentType === 5121 ? 1 : idx.componentType === 5123 ? 2 : idx.componentType === 5125 ? 4 : 0;
    if (idxSize === 0) return null;
    const idxView = idx.bufferView === undefined ? undefined : views[idx.bufferView];
    const valView = val.bufferView === undefined ? undefined : views[val.bufferView];
    if (idxView === undefined || valView === undefined) return null;
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let k = 0; k < scount; k += 1) {
      const iat = (idxView.byteOffset ?? 0) + (idx.byteOffset ?? 0) + k * idxSize;
      if (iat + idxSize > bin.length) return null;
      const vi = idxSize === 1 ? dv.getUint8(iat) : idxSize === 2 ? dv.getUint16(iat, true) : dv.getUint32(iat, true);
      if (vi >= count) return null;
      const vat = (valView.byteOffset ?? 0) + (val.byteOffset ?? 0) + k * elem;
      if (vat + elem > bin.length) return null;
      Buffer.from(bin.subarray(vat, vat + elem)).copy(dense, vi * elem);
    }
  }
  return dense;
}

function resolveVertexBytes(accessor: GltfAccessor, views: GltfBufferView[], bin: Uint8Array): Buffer[] | null {
  const dense = resolveAccessorPayload(accessor, views, bin);
  if (dense === null) return null;
  const elem = elementSize(accessor.componentType, accessor.type);
  const out: Buffer[] = [];
  for (let at = 0; at < dense.length; at += elem) out.push(dense.subarray(at, at + elem));
  return out;
}

/** Multiset of material-keyed triangle positions for one mesh. */
function meshTriangleKeys(prims: GltfPrimitive[], parts: string[][]): Map<string, number> {
  const keys = new Map<string, number>();
  prims.forEach((prim, i) => {
    const material = prim.material ?? -1;
    for (const pos of parts[i] ?? []) {
      const key = `${pos}#mat${material}`;
      keys.set(key, (keys.get(key) ?? 0) + 1);
    }
  });
  return keys;
}

// Same material-name predicate as unhide-neckline-opening.py.
function isHiddenMaterial(materials: Array<{ name?: string }>, index: number): boolean {
  return (materials[index]?.name ?? "").includes("hidden");
}

/** Resolve the material index assigned by skin_material_index in unhide-neckline-opening.py main(). */
function skinMaterialSlot(
  name: string,
  mainPrims: GltfPrimitive[],
  mainMats: Array<{ name?: string }>,
  candMats: Array<{ name?: string }>,
): number {
  const sourceSlots = new Set<number>();
  for (const { material } of mainPrims) {
    if (material !== undefined && mainMats[material] !== undefined && !isHiddenMaterial(mainMats, material)) {
      sourceSlots.add(material);
    }
  }
  const describeSlots = (mats: Array<{ name?: string }>, slots: Iterable<number>): string =>
    [...slots].map((slot) => `${slot}:${mats[slot]?.name ?? "(unnamed)"}`).join(", ") || "(none)";
  const [skinSlot] = sourceSlots;
  if (sourceSlots.size !== 1 || skinSlot === undefined) {
    throw new Error(
      `ship-superset R6: skin-material identity failed for mesh ${JSON.stringify(name)}: source candidates [${describeSlots(mainMats, sourceSlots)}] (expected one non-hidden slot)`,
    );
  }

  // The writer appends primitives with the original slot index. Reject a
  // missing or ambiguous candidate counterpart, even if the alias is unused.
  const skinName = mainMats[skinSlot]?.name ?? "";
  const candidateSlots = candMats.flatMap((mat, index) => (mat.name ?? "") === skinName ? [index] : []);
  if (candidateSlots.length !== 1 || candidateSlots[0] !== skinSlot) {
    throw new Error(
      `ship-superset R6: skin-material identity failed for mesh ${JSON.stringify(name)}: candidate slots [${describeSlots(candMats, candidateSlots)}] (expected only source slot ${skinSlot}:${skinName})`,
    );
  }
  return skinSlot;
}

/** Require exact material-keyed copies, except for hidden-to-skin moves. */
function compareTriangleMultiset(
  main: GltfRoot,
  candidate: GltfRoot,
  name: string,
  mainPrims: GltfPrimitive[],
  candPrims: GltfPrimitive[],
  mainParts: string[][],
  candParts: string[][],
): string[] {
  const mKeys = meshTriangleKeys(mainPrims, mainParts);
  const cKeys = meshTriangleKeys(candPrims, candParts);
  const mainMats = main.materials ?? [];
  const candMats = candidate.materials ?? [];
  const matOfKey = (key: string): number => Number(key.slice(key.lastIndexOf("#mat") + 4));
  const posOfKey = (key: string): string => key.slice(0, key.lastIndexOf("#mat"));
  const mainHasHidden = [...mKeys.keys()].some((key) => isHiddenMaterial(mainMats, matOfKey(key)));
  const skinSlot = mainHasHidden ? skinMaterialSlot(name, mainPrims, mainMats, candMats) : undefined;
  const candSkinQual = new Map<string, number>();
  for (const [key, count] of cKeys) {
    if (matOfKey(key) !== skinSlot) continue;
    // Reserve all exact skin matches before considering any hidden deficit.
    const surplus = count - (mKeys.get(key) ?? 0);
    if (surplus > 0) candSkinQual.set(posOfKey(key), surplus);
  }
  const lines: string[] = [];
  for (const [key, mCount] of [...mKeys.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const cCount = cKeys.get(key) ?? 0;
    if (cCount >= mCount) continue;
    if (isHiddenMaterial(mainMats, matOfKey(key))) {
      const pos = posOfKey(key);
      const available = candSkinQual.get(pos) ?? 0;
      const deficit = mCount - cCount;
      const moved = Math.min(deficit, available);
      candSkinQual.set(pos, available - moved);
      if (moved === deficit) continue;
    }
    lines.push(
      `mesh structure mismatch: ${name} triangle missing in candidate: ${key} mainCount=${mCount} candidateCount=${cCount}`,
    );
  }
  return lines;
}

/** Choose the smallest cyclic rotation without changing winding. */
function cyclicTriangleKey(a: string, b: string, c: string): string {
  const ab = `${a}|${b}|${c}`;
  const bc = `${b}|${c}|${a}`;
  const ca = `${c}|${a}|${b}`;
  const first = ab < bc ? ab : bc;
  return first < ca ? first : ca;
}

/** Resolve each primitive's TRIANGLES as cyclic POSITION keys or return a refusal reason. */
function meshPrimTriPosParts(
  gltf: GltfRoot,
  prims: GltfPrimitive[],
  name: string,
  bin: Uint8Array,
): string[][] | string {
  const accessors = gltf.accessors ?? [];
  const views = gltf.bufferViews ?? [];
  // Check modes before returning any payload refusal.
  prims.forEach((prim, i) => {
    const mode = prim.mode ?? 4;
    if (mode !== 4) {
      throw new Error(`ship-superset R3: mesh ${JSON.stringify(name)} primitive ${i} has unsupported mode ${mode}; BIN triangle comparison requires TRIANGLES (4)`);
    }
  });
  const out: string[][] = [];
  for (const [primitiveIndex, prim] of prims.entries()) {
    const posIdx = prim.attributes?.["POSITION"];
    const posAcc = posIdx === undefined ? undefined : accessors[posIdx];
    if (posAcc === undefined) return `primitive ${primitiveIndex} missing POSITION accessor`;
    const verts = resolveVertexBytes(posAcc, views, bin)?.map((v) => v.toString("hex"));
    if (verts === undefined) return `unreadable POSITION accessor ${posIdx}`;
    let order: number[];
    if (prim.indices !== undefined) {
      const idxAcc = accessors[prim.indices];
      if (idxAcc === undefined) return `missing index accessor ${prim.indices}`;
      const list = readIndexList(idxAcc, views, bin);
      if (list === "sparse") return `sparse index accessor ${prim.indices}`;
      if (typeof list === "string") return `index accessor ${prim.indices}: ${list}`;
      order = list;
    } else {
      order = verts.map((_, i) => i);
    }
    if (order.length % 3 !== 0) return `primitive ${primitiveIndex} element count is not divisible by 3`;
    const parts: string[] = [];
    for (let i = 0; i < order.length; i += 3) {
      const a = verts[order[i] ?? -1];
      const b = verts[order[i + 1] ?? -1];
      const c = verts[order[i + 2] ?? -1];
      if (a === undefined || b === undefined || c === undefined) {
        return `primitive ${primitiveIndex} index references a vertex outside POSITION accessor ${posIdx}`;
      }
      parts.push(cyclicTriangleKey(a, b, c));
    }
    out.push(parts);
  }
  return out;
}

function primAttrSig(prim: GltfPrimitive): string {
  return Object.keys(prim.attributes ?? {}).sort().join(",");
}

function primMorphSig(prim: GltfPrimitive): string {
  const targets = prim.targets ?? [];
  return `${targets.length}:[${targets.map((t) => Object.keys(t ?? {}).sort().join("+")).join(";")}]`;
}

function equalAccessorPayload(
  source: GltfAccessor | undefined,
  dest: GltfAccessor | undefined,
  main: GltfRoot,
  candidate: GltfRoot,
  mainBin: Uint8Array,
  candBin: Uint8Array,
): boolean {
  if (
    source === undefined || dest === undefined ||
    source.componentType !== dest.componentType || source.type !== dest.type ||
    source.count !== dest.count || (source.normalized ?? false) !== (dest.normalized ?? false)
  ) return false;

  const sourceBytes = resolveAccessorPayload(source, main.bufferViews ?? [], mainBin);
  const destBytes = resolveAccessorPayload(dest, candidate.bufferViews ?? [], candBin);
  return sourceBytes !== null && destBytes !== null && sourceBytes.equals(destBytes);
}

/** Compare each appended triangle with an eligible source primitive's
 * attribute and morph payloads. Original primitives keep the rehomed
 * semantic check in addition to their pairwise layout and byte checks. */
function compareRehomedPrimStructure(
  main: GltfRoot,
  candidate: GltfRoot,
  name: string,
  mainPrims: GltfPrimitive[],
  candPrims: GltfPrimitive[],
  mainParts: string[][],
  candParts: string[][],
  mainBin: Uint8Array,
  candBin: Uint8Array,
): string[] {
  const mainMats = main.materials ?? [];
  const candMats = candidate.materials ?? [];
  // POSITION part -> main primitive indices holding it.
  const sourcesByPosition = new Map<string, Set<number>>();
  for (const [si, parts] of mainParts.entries()) {
    for (const pos of parts) {
      const sources = sourcesByPosition.get(pos) ?? new Set<number>();
      sources.add(si);
      sourcesByPosition.set(pos, sources);
    }
  }
  const lines: string[] = [];
  candPrims.forEach((cp, j) => {
    const cm = cp.material ?? -1;
    const appended = j >= mainPrims.length;
    const destHidden = isHiddenMaterial(candMats, cm);
    const checked = new Map<number, string[]>();
    const compareSource = (s: number): string[] => {
      const sp = mainPrims[s];
      if (sp === undefined) return [];
      const mismatches: string[] = [];
      if (primAttrSig(cp) !== primAttrSig(sp)) {
        mismatches.push(
          `mesh structure mismatch: ${name} primitive ${j} attributes [${primAttrSig(cp)}] do not match rehomed source primitive ${s} [${primAttrSig(sp)}]`,
        );
      }
      if (primMorphSig(cp) !== primMorphSig(sp)) {
        mismatches.push(
          `mesh morph mismatch: ${name} primitive ${j} targets ${primMorphSig(cp)} do not match rehomed source primitive ${s} ${primMorphSig(sp)}`,
        );
      }
      if (!appended || mismatches.length > 0) return mismatches;

      const checkRefs = (label: string, src: Record<string, number>, dst: Record<string, number>): void => {
        for (const [semantic, sourceIdx] of Object.entries(src)) {
          const destIdx = dst[semantic];
          if (!equalAccessorPayload(
            main.accessors?.[sourceIdx], destIdx === undefined ? undefined : candidate.accessors?.[destIdx],
            main, candidate, mainBin, candBin,
          )) {
            mismatches.push(`R1 appended accessor mismatch: ${name} primitive ${j} ${label} ${semantic} differs from source primitive ${s}`);
          }
        }
      };
      checkRefs("attribute", sp.attributes ?? {}, cp.attributes ?? {});
      for (const [i, target] of (sp.targets ?? []).entries()) {
        checkRefs(`target ${i}`, target, cp.targets?.[i] ?? {});
      }
      return mismatches;
    };
    const reported = new Set<string>();
    for (const pos of candParts[j] ?? []) {
      const possible = [...(sourcesByPosition.get(pos) ?? [])].filter((s) => {
        const material = mainPrims[s]?.material ?? -1;
        return (appended && material === cm) || (!destHidden && isHiddenMaterial(mainMats, material));
      });
      const mismatches = possible.map((s) => {
        const result = checked.get(s) ?? compareSource(s);
        checked.set(s, result);
        return result;
      });
      if (appended && mismatches.some((result) => result.length === 0)) continue;
      if (appended && possible.length === 0) {
        reported.add(`R1 appended primitive has no matching source triangle: ${name} primitive ${j}`);
      }
      for (const result of mismatches) for (const line of result) reported.add(line);
    }
    lines.push(...reported);
  });
  return lines;
}

/** Per-primitive structure + morph + payload-byte lines for one mesh present in both files.
 * With relaxIndex (BIN-backed multiset mode), the primitive-count line
 * and the indices-accessor layout/byte lines are skipped: the trim-and-
 * append change class moves triangles across primitives, so counts and
 * index layouts legitimately change. Attribute key sets, modes, morphs
 * and attribute payload bytes stay strict; the moved triangles are
 * covered by the multiset comparison instead. */
function comparePrimitiveStructure(
  main: GltfRoot,
  candidate: GltfRoot,
  name: string,
  bins: GlbBins,
  relaxIndex = false,
): string[] {
  const lines: string[] = [];
  const mainMesh = (main.meshes ?? []).find((m) => m.name === name) as GltfMesh | undefined;
  const candMesh = (candidate.meshes ?? []).find((m) => m.name === name) as GltfMesh | undefined;
  const mainPrims = mainMesh?.primitives ?? [];
  const candPrims = candMesh?.primitives ?? [];
  if (!relaxIndex && mainPrims.length !== candPrims.length) {
    lines.push(
      `mesh primitive count mismatch: ${name} mainPrimitives=${mainPrims.length} candidatePrimitives=${candPrims.length}`,
    );
  }
  const mainAccessors = main.accessors ?? [];
  const candAccessors = candidate.accessors ?? [];
  const mainViews = main.bufferViews ?? [];
  const candViews = candidate.bufferViews ?? [];
  const n = Math.min(mainPrims.length, candPrims.length);
  for (let i = 0; i < n; i += 1) {
    const mp = mainPrims[i] as GltfPrimitive;
    const cp = candPrims[i] as GltfPrimitive;
    const mainMode = mp.mode ?? 4;
    const candMode = cp.mode ?? 4;
    if (mainMode !== candMode) {
      lines.push(`mesh structure mismatch: ${name} primitive ${i} mode main=${mainMode} candidate=${candMode}`);
    }
    const mainKeys = Object.keys(mp.attributes ?? {}).sort();
    const candKeys = Object.keys(cp.attributes ?? {}).sort();
    if (mainKeys.join(",") !== candKeys.join(",")) {
      lines.push(
        `mesh structure mismatch: ${name} primitive ${i} attributes main=[${mainKeys.join(",")}] candidate=[${candKeys.join(",")}]`,
      );
    }
    const refs: Array<[string, number | undefined, number | undefined]> = [
      ["indices", mp.indices, cp.indices],
    ];
    for (const key of [...new Set([...mainKeys, ...candKeys])].sort()) {
      refs.push([`attribute ${key}`, mp.attributes?.[key], cp.attributes?.[key]]);
    }
    for (const [ref, mainIdx, candIdx] of refs) {
      if (relaxIndex && ref === "indices") continue;
      const mainSig = mainIdx === undefined ? "absent" : accessorLayoutSig(mainAccessors[mainIdx], mainViews);
      const candSig = candIdx === undefined ? "absent" : accessorLayoutSig(candAccessors[candIdx], candViews);
      if (mainSig !== candSig) {
        lines.push(`mesh structure mismatch: ${name} primitive ${i} ${ref} main=${mainSig} candidate=${candSig}`);
      }
      lines.push(
        ...compareRefBytes(ref, mainIdx, candIdx, mainAccessors, candAccessors, mainViews, candViews, bins, name, i),
      );
    }
    const mainTargets = mp.targets ?? [];
    const candTargets = cp.targets ?? [];
    if (mainTargets.length !== candTargets.length) {
      lines.push(
        `mesh morph mismatch: ${name} primitive ${i} targets main=${mainTargets.length} candidate=${candTargets.length}`,
      );
    }
    const t = Math.min(mainTargets.length, candTargets.length);
    for (let k = 0; k < t; k += 1) {
      const mt = mainTargets[k] as Record<string, number>;
      const ct = candTargets[k] as Record<string, number>;
      const mtKeys = Object.keys(mt ?? {}).sort();
      const ctKeys = Object.keys(ct ?? {}).sort();
      if (mtKeys.join(",") !== ctKeys.join(",")) {
        lines.push(
          `mesh morph mismatch: ${name} primitive ${i} target ${k} attributes main=[${mtKeys.join(",")}] candidate=[${ctKeys.join(",")}]`,
        );
      }
      for (const key of [...new Set([...mtKeys, ...ctKeys])].sort()) {
        const mi = mt?.[key];
        const ci = ct?.[key];
        const mSig = mi === undefined ? "absent" : accessorLayoutSig(mainAccessors[mi], mainViews);
        const cSig = ci === undefined ? "absent" : accessorLayoutSig(candAccessors[ci], candViews);
        if (mSig !== cSig) {
          lines.push(`mesh morph mismatch: ${name} primitive ${i} target ${k} ${key} main=${mSig} candidate=${cSig}`);
        }
        lines.push(
          ...compareRefBytes(
            `target ${k} ${key}`,
            mi,
            ci,
            mainAccessors,
            candAccessors,
            mainViews,
            candViews,
            bins,
            name,
            i,
          ),
        );
      }
    }
  }
  return lines;
}

/** Sampler resolved to interpolation plus input/output accessor layout sigs. */
function samplerSig(
  samplers: GltfSampler[] | undefined,
  index: number | undefined,
  accessors: GltfAccessor[],
  views: GltfBufferView[],
): { interp: string; input: string; output: string } {
  const s = (typeof index === "number" ? samplers?.[index] : undefined) as GltfSampler | undefined;
  if (s === undefined) return { interp: "missing", input: "missing", output: "missing" };
  const interp = typeof s.interpolation === "string" ? s.interpolation : "LINEAR";
  const input = typeof s.input === "number" ? accessorLayoutSig(accessors[s.input], views) : "absent";
  const output = typeof s.output === "number" ? accessorLayoutSig(accessors[s.output], views) : "absent";
  return { interp, input, output };
}

/**
 * Resolved sampler input/output payload comparison for one animation
 * channel. Rejects invalid sampler or accessor references outright, then
 * compares sha256 digests of the resolved input/output keyframe bytes
 * whenever both sides carry a BIN payload, so repointing a channel at a
 * same-layout sampler (or editing keyframe bytes in place) is refused.
 * Layout diffs are reported by the caller.
 */
function compareSamplerPayload(
  name: string,
  channel: number,
  mainSamplerIdx: number | undefined,
  candSamplerIdx: number | undefined,
  mainSamplers: GltfSampler[],
  candSamplers: GltfSampler[],
  mainAccessors: GltfAccessor[],
  candAccessors: GltfAccessor[],
  mainViews: GltfBufferView[],
  candViews: GltfBufferView[],
  bins: GlbBins,
): string[] {
  const ms = (typeof mainSamplerIdx === "number" ? mainSamplers[mainSamplerIdx] : undefined) as GltfSampler | undefined;
  const cs = (typeof candSamplerIdx === "number" ? candSamplers[candSamplerIdx] : undefined) as GltfSampler | undefined;
  if (ms === undefined || cs === undefined) {
    return [
      `animation sampler mismatch: ${name} channel ${channel} invalid sampler reference main=${String(mainSamplerIdx)} candidate=${String(candSamplerIdx)}`,
    ];
  }
  const lines: string[] = [];
  for (const ref of ["input", "output"] as const) {
    const mIdx = ms[ref];
    const cIdx = cs[ref];
    const mAcc = typeof mIdx === "number" ? mainAccessors[mIdx] : undefined;
    const cAcc = typeof cIdx === "number" ? candAccessors[cIdx] : undefined;
    if (mAcc === undefined || cAcc === undefined) {
      lines.push(
        `animation sampler mismatch: ${name} channel ${channel} ${ref} invalid accessor reference main=${String(mIdx)} candidate=${String(cIdx)}`,
      );
      continue;
    }
    if (accessorLayoutSig(mAcc, mainViews) !== accessorLayoutSig(cAcc, candViews)) continue;
    const mainHas = bins.main !== undefined && bins.main.length > 0;
    const candHas = bins.candidate !== undefined && bins.candidate.length > 0;
    if (!mainHas && !candHas) continue;
    if (mainHas !== candHas) {
      lines.push(
        `animation sampler bytes unreadable: ${name} channel ${channel} ${ref} (${mainHas ? "candidate BIN missing" : "main BIN missing"})`,
      );
      continue;
    }
    const mb = accessorBytes(mAcc, mainViews, bins.main);
    const cb = accessorBytes(cAcc, candViews, bins.candidate);
    if (mb.kind === "skip" && cb.kind === "skip") continue;
    if (mb.kind === "skip" || cb.kind === "skip") {
      lines.push(`animation sampler bytes unreadable: ${name} channel ${channel} ${ref} (asymmetric payload)`);
      continue;
    }
    if (mb.kind === "unreadable" || cb.kind === "unreadable") {
      const why = mb.kind === "unreadable" ? `main ${mb.reason}` : `candidate ${cb.kind === "unreadable" ? cb.reason : "?"}`;
      lines.push(`animation sampler bytes unreadable: ${name} channel ${channel} ${ref} (${why})`);
      continue;
    }
    if (mb.digest !== cb.digest) {
      lines.push(
        `animation sampler bytes mismatch: ${name} channel ${channel} ${ref} main=${mb.digest} candidate=${cb.digest}`,
      );
    }
  }
  return lines;
}

/**
 * Loss lines for candidate vs main. Empty means the candidate is a superset
 * (exit 0). `decimated` names meshes that may only go DOWN in tris; a
 * decimated name must still exist in both files. `bins` carries the per-side
 * BIN chunks for payload-byte hashing; without them only layout is compared.
 */
export function findLosses(
  main: GltfRoot,
  candidate: GltfRoot,
  decimated: Set<string>,
  bins: GlbBins = {},
): string[] {
  const losses: string[] = [];
  const mainAccessors = main.accessors ?? [];
  const candAccessors = candidate.accessors ?? [];
  const mainViews = main.bufferViews ?? [];
  const candViews = candidate.bufferViews ?? [];

  for (const name of decimated) {
    if (!(main.meshes ?? []).some((m) => m.name === name)) {
      throw new Error(`ship-superset: --decimated-mesh ${JSON.stringify(name)} matches no main mesh`);
    }
  }

  const mainTris = meshTris(main, "main");
  const candTris = meshTris(candidate, "candidate");

  const mainAnims = animNameMap(main.animations, "main");
  const candAnims = animNameMap(candidate.animations, "candidate");
  for (const name of [...mainAnims.keys()].sort()) {
    const mainClip = mainAnims.get(name) as GltfAnimation;
    const candClip = candAnims.get(name);
    if (candClip === undefined) {
      losses.push(`animation missing in candidate: ${name}`);
      continue;
    }
    const mainChannels = Array.isArray(mainClip.channels) ? mainClip.channels : [];
    const candChannels = Array.isArray(candClip.channels) ? candClip.channels : [];
    const candSamplers = Array.isArray(candClip.samplers) ? candClip.samplers : [];
    if (candChannels.length === 0) {
      losses.push(`animation has no channels in candidate: ${name}`);
    } else if (candSamplers.length === 0) {
      losses.push(`animation has no samplers in candidate: ${name}`);
    } else if (candChannels.length !== mainChannels.length) {
      losses.push(`animation channel mismatch: ${name} mainChannels=${mainChannels.length} candidateChannels=${candChannels.length}`);
    } else {
      const mainSamplers = Array.isArray(mainClip.samplers) ? mainClip.samplers : [];
      for (let i = 0; i < mainChannels.length; i += 1) {
        const mc = mainChannels[i] as GltfChannel | undefined;
        const cc = candChannels[i] as GltfChannel | undefined;
        const mNode = mc?.target?.node;
        const cNode = cc?.target?.node;
        const mPath = mc?.target?.path;
        const cPath = cc?.target?.path;
        if (mNode !== cNode || mPath !== cPath) {
          losses.push(
            `animation channel target mismatch: ${name} channel ${i} main=${String(mNode)}/${String(mPath)} candidate=${String(cNode)}/${String(cPath)}`,
          );
        }
        const ms = samplerSig(mainSamplers, mc?.sampler, mainAccessors, mainViews);
        const cs = samplerSig(candSamplers, cc?.sampler, candAccessors, candViews);
        if (ms.interp !== cs.interp) {
          losses.push(`animation sampler mismatch: ${name} channel ${i} interpolation main=${ms.interp} candidate=${cs.interp}`);
        }
        if (ms.input !== cs.input) {
          losses.push(`animation sampler mismatch: ${name} channel ${i} input main=${ms.input} candidate=${cs.input}`);
        }
        if (ms.output !== cs.output) {
          losses.push(`animation sampler mismatch: ${name} channel ${i} output main=${ms.output} candidate=${cs.output}`);
        }
        losses.push(
          ...compareSamplerPayload(
            name,
            i,
            mc?.sampler,
            cc?.sampler,
            mainSamplers,
            candSamplers,
            mainAccessors,
            candAccessors,
            mainViews,
            candViews,
            bins,
          ),
        );
      }
    }
  }

  for (const [name, mainCount] of [...mainTris.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!candTris.has(name)) {
      losses.push(`mesh missing in candidate: ${name}`);
      continue;
    }
    const candCount = candTris.get(name) as number;
    if (candCount === mainCount) continue;
    if (decimated.has(name)) {
      if (candCount > mainCount) {
        losses.push(`decimated mesh rises: ${name} mainTris=${mainCount} candidateTris=${candCount}`);
      }
    } else {
      losses.push(`mesh tri mismatch: ${name} mainTris=${mainCount} candidateTris=${candCount}`);
    }
  }

  const mainCopyright = typeof main.asset?.copyright === "string" ? main.asset.copyright : "";
  const candCopyright = typeof candidate.asset?.copyright === "string" ? candidate.asset.copyright : "";
  if (candCopyright === "") {
    losses.push(`asset.copyright missing in candidate (main: ${JSON.stringify(mainCopyright)})`);
  } else if (mainCopyright !== "" && !candCopyright.includes(mainCopyright)) {
    losses.push(
      `asset.copyright does not contain main text: candidate=${JSON.stringify(candCopyright)} main=${JSON.stringify(mainCopyright)}`,
    );
  }

  const mainExtras =
    typeof main.asset?.extras === "object" && main.asset.extras !== null
      ? (main.asset.extras as Record<string, unknown>)
      : {};
  const candExtras =
    typeof candidate.asset?.extras === "object" && candidate.asset.extras !== null
      ? (candidate.asset.extras as Record<string, unknown>)
      : {};
  for (const key of Object.keys(mainExtras).sort()) {
    if (!Object.hasOwn(candExtras, key)) losses.push(`asset.extras key missing in candidate: ${key}`);
  }

  const mainBin = bins.main;
  const candBin = bins.candidate;
  for (const [name] of [...mainTris.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (decimated.has(name) || !candTris.has(name)) continue;
    if (mainBin?.length && candBin?.length) {
      const mainPrims = main.meshes?.find((mesh) => mesh.name === name)?.primitives ?? [];
      const candPrims = candidate.meshes?.find((mesh) => mesh.name === name)?.primitives ?? [];
      const mainParts = meshPrimTriPosParts(main, mainPrims, name, mainBin);
      const candParts = meshPrimTriPosParts(candidate, candPrims, name, candBin);
      if (typeof mainParts === "string" || typeof candParts === "string") {
        const reason = typeof candParts === "string" ? `candidate ${candParts}` : `main ${mainParts}`;
        losses.push(`mesh structure mismatch: ${name} unsupported index layout: ${reason}`);
        continue;
      }
      losses.push(...compareTriangleMultiset(main, candidate, name, mainPrims, candPrims, mainParts, candParts));
      losses.push(...comparePrimitiveStructure(main, candidate, name, bins, true));
      losses.push(...compareRehomedPrimStructure(
        main, candidate, name, mainPrims, candPrims, mainParts, candParts, mainBin, candBin,
      ));
      continue;
    }
    losses.push(...comparePrimitiveStructure(main, candidate, name, bins));
  }

  return losses;
}

function parseCli(argv: string[]): { candidate: string; main: string; decimated: Set<string> } {
  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const candidate = val("--candidate");
  const main = val("--main");
  if (!candidate || !main) {
    throw new Error("usage: ship-superset.ts --candidate <glb> --main <glb> [--decimated-mesh <name>]...");
  }
  const decimated = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--decimated-mesh") {
      const name = argv[i + 1];
      if (name === undefined || name === "") throw new Error("usage: ship-superset.ts --candidate <glb> --main <glb> [--decimated-mesh <name>]...");
      decimated.add(name);
    }
  }
  return { candidate, main, decimated };
}

function cli(): void {
  try {
    const { candidate, main, decimated } = parseCli(process.argv.slice(2));
    const mainGlb = readGlb(main);
    const candGlb = readGlb(candidate);
    const losses = findLosses(mainGlb.json, candGlb.json, decimated, {
      main: mainGlb.bin,
      candidate: candGlb.bin,
    });
    if (losses.length > 0) {
      for (const line of losses) process.stdout.write(`${line}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`ship-superset OK: ${candidate} carries every loss class of ${main}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) cli();
