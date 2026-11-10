/**
 * Sample-list + skinning cache for multi-region supine support contact. Holds the whole
 * sample-list cache (SampleRow, SampleCacheEntry, sampleCache, signature check, row build)
 * plus the skinning fast path, so supine-support-contact.ts stays under its file budget.
 * Re-skinning repeats the three.js (r184) SkinnedMesh.getVertexPosition floating-point
 * operations in the same order instead of regrouping them, so cached gaps are bit-identical.
 */
import { type Material, Matrix4, Mesh, Vector3, type Object3D } from "three";
import type { SupineSupportPlane, SupineSupportRegion } from "./supine-support-contact.js";

export type SkinnedLike = Object3D & {
  isSkinnedMesh?: boolean;
  material?: Material | Material[];
  geometry?: {
    computeBoundingBox?: () => void; boundingBox?: { max: Vector3 }; index?: Attribute;
    groups?: Array<{ start: number; count: number; materialIndex?: number }>;
    attributes?: { position?: Attribute; normal?: Attribute; skinIndex?: Attribute; skinWeight?: Attribute };
    morphAttributes?: { position?: unknown[] }; morphTargetsRelative?: unknown;
  };
  skeleton?: { bones: Object3D[]; boneInverses?: Matrix4[]; update?: () => void };
  getVertexPosition?: (index: number, target: Vector3) => Vector3;
  morphTargetInfluences?: number[]; bindMatrix?: Matrix4; bindMatrixInverse?: Matrix4;
};

type Attribute = {
  count: number;
  getX: (index: number) => number; getY: (index: number) => number;
  getZ: (index: number) => number; getW?: (index: number) => number;
};

const PELVIS = /pelvis|hips/iu;
const LUMBAR = /spine0?[2-5]|spine1$|spine$|abdomen|lumbar/iu;
const THORAX = /spine01$|spine2$|chest|breast|clavicle|shoulder/iu;

function regionForVertex(mesh: SkinnedLike, index: number): SupineSupportRegion | null {
  const indices = mesh.geometry?.attributes?.skinIndex;
  const weights = mesh.geometry?.attributes?.skinWeight;
  if (!indices || !weights || !mesh.skeleton?.bones) return null;
  let bestWeight = 0;
  let bestName = "";
  for (let lane = 0; lane < 4; lane += 1) {
    const weight = lane === 0 ? weights.getX(index) : lane === 1 ? weights.getY(index)
      : lane === 2 ? weights.getZ(index) : (weights.getW?.(index) ?? 0);
    if (weight <= bestWeight) continue;
    const boneIndex = lane === 0 ? indices.getX(index) : lane === 1 ? indices.getY(index)
      : lane === 2 ? indices.getZ(index) : (indices.getW?.(index) ?? 0);
    bestWeight = weight;
    bestName = mesh.skeleton.bones[boneIndex]?.name ?? "";
  }
  bestName = bestName.replace(/\./gu, "");
  if (/^head$/iu.test(bestName)) return "occiput";
  if (/foot|heel/iu.test(bestName)) return /L$|left/iu.test(bestName) ? "heelL" : "heelR";
  if (bestName === "root" || PELVIS.test(bestName)) return "pelvis";
  if (THORAX.test(bestName)) return "thorax";
  if (LUMBAR.test(bestName)) return "lumbar";
  return null;
}

export function isMaterialRendered(material: unknown): boolean {
  const view = material as Material | undefined;
  return !!view && !!view.visible && !(view.opacity <= view.alphaTest || (view.transparent && view.opacity <= 0));
}

export type SampleRow = { index: number; region: SupineSupportRegion; skipContact: boolean };

type SampleCacheEntry = {
  anatomicalBody: boolean; geometry: unknown;
  position: unknown; positionVersion: unknown;
  skinIndexAttr: unknown; skinIndexVersion: unknown;
  skinWeightAttr: unknown; skinWeightVersion: unknown;
  normalAttr: unknown; normalVersion: unknown;
  indexAttr: unknown; indexVersion: unknown;
  groupsCopy: Array<[number, number, number | undefined]>;
  bones: Object3D[]; boneNames: string[]; materialCount: number;
  materialVisible: unknown[]; materialOpacity: unknown[];
  materialAlphaTest: unknown[]; materialTransparent: unknown[]; materialUuid: unknown[];
  morphInfluencesCopy: number[] | undefined; morphTargetsRelative: unknown; morphPositionRef: unknown;
  bindMatrixCopy: Float64Array; bindMatrixInverseCopy: Float64Array;
  rows: SampleRow[];
  base: Float64Array; skinIdx: Int32Array; skinW: Float64Array;
  boneRowStart: Int32Array; boneRows: Int32Array; boneUsed: Uint8Array;
  current: Float64Array; previous: Float64Array; prevMatrixWorld: Float64Array;
  lastPlanes: unknown; hasPrevious: boolean;
  kind: Uint8Array; gapValue: Float64Array;
  stamp: Uint32Array; callId: number; dirty: Int32Array;
};

const sampleCache = new WeakMap<object, SampleCacheEntry>();

const scratchBase = new Vector3();
const scratchOut = new Vector3();
const scratchLane = new Vector3();
const scratchGap = new Vector3();
const scratchUnderlying = new Vector3();
const scratchBone = new Matrix4();
const scratchCurrent = new Matrix4();

function elementsMatch(stored: Float64Array, live: ReadonlyArray<number> | undefined): boolean {
  if (!live || live.length !== stored.length) return false;
  for (let element = 0; element < stored.length; element += 1) {
    if (stored[element] !== live[element]) return false;
  }
  return true;
}

function ensureSupportSampleEntry(
  mesh: SkinnedLike,
  anatomicalBody: boolean,
  materials: ReadonlyArray<unknown>,
): SampleCacheEntry | null {
  const geometry = mesh.geometry;
  const position = geometry?.attributes?.position;
  const bones = mesh.skeleton?.bones;
  if (!mesh.isSkinnedMesh || !position || !mesh.getVertexPosition || !bones) return null;
  if (!mesh.visible) return null;
  const skinIndexAttr = geometry?.attributes?.skinIndex;
  const skinWeightAttr = geometry?.attributes?.skinWeight;
  const normalAttr = geometry?.attributes?.normal;
  const indexAttr = geometry?.index;
  const groups = geometry?.groups;
  const positionVersion = (position as unknown as { version?: unknown }).version;
  const skinIndexVersion = (skinIndexAttr as unknown as { version?: unknown } | undefined)?.version;
  const skinWeightVersion = (skinWeightAttr as unknown as { version?: unknown } | undefined)?.version;
  const normalVersion = (normalAttr as unknown as { version?: unknown } | undefined)?.version;
  const indexVersion = (indexAttr as unknown as { version?: unknown } | undefined)?.version;
  const cached = sampleCache.get(mesh);
  if (cached
    && cached.anatomicalBody === anatomicalBody && cached.geometry === geometry
    && cached.position === position && cached.positionVersion === positionVersion
    && cached.skinIndexAttr === skinIndexAttr && cached.skinIndexVersion === skinIndexVersion
    && cached.skinWeightAttr === skinWeightAttr && cached.skinWeightVersion === skinWeightVersion
    && cached.normalAttr === normalAttr && cached.normalVersion === normalVersion
    && cached.indexAttr === indexAttr && cached.indexVersion === indexVersion
    && cached.bones === bones && cached.materialCount === materials.length) {
    let signatureMatches = cached.boneNames.length === bones.length;
    if (signatureMatches) {
      for (let boneIndex = 0; boneIndex < bones.length; boneIndex += 1) {
        if (bones[boneIndex]!.name !== cached.boneNames[boneIndex]) { signatureMatches = false; break; }
      }
    }
    if (signatureMatches) {
      const groupCount = groups?.length ?? 0;
      if (cached.groupsCopy.length !== groupCount) signatureMatches = false;
      else for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
        const group = groups![groupIndex]!;
        const stored = cached.groupsCopy[groupIndex]!;
        if (group.start !== stored[0] || group.count !== stored[1] || group.materialIndex !== stored[2]) {
          signatureMatches = false; break;
        }
      }
    }
    if (signatureMatches) {
      for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
        const view = materials[materialIndex] as unknown as { visible?: unknown; opacity?: unknown; alphaTest?: unknown; transparent?: unknown; uuid?: unknown } | undefined;
        if (view?.visible !== cached.materialVisible[materialIndex] || view?.opacity !== cached.materialOpacity[materialIndex]
          || view?.alphaTest !== cached.materialAlphaTest[materialIndex]
          || view?.transparent !== cached.materialTransparent[materialIndex]
          || view?.uuid !== cached.materialUuid[materialIndex]) { signatureMatches = false; break; }
      }
    }
    if (signatureMatches) {
      const influences = mesh.morphTargetInfluences;
      const storedInfluences = cached.morphInfluencesCopy;
      if (influences === undefined || influences === null) {
        if (storedInfluences !== undefined) signatureMatches = false;
      } else if (storedInfluences === undefined || storedInfluences.length !== influences.length) {
        signatureMatches = false;
      } else for (let influenceIndex = 0; influenceIndex < influences.length; influenceIndex += 1) {
        if (influences[influenceIndex] !== storedInfluences[influenceIndex]) { signatureMatches = false; break; }
      }
    }
    if (signatureMatches && cached.morphTargetsRelative !== geometry?.morphTargetsRelative) signatureMatches = false;
    if (signatureMatches && cached.morphPositionRef !== (geometry?.morphAttributes?.position ?? null)) signatureMatches = false;
    if (signatureMatches && !elementsMatch(cached.bindMatrixCopy, mesh.bindMatrix?.elements)) signatureMatches = false;
    if (signatureMatches && !elementsMatch(cached.bindMatrixInverseCopy, mesh.bindMatrixInverse?.elements)) signatureMatches = false;
    if (signatureMatches) {
      mesh.skeleton?.update?.();
      return cached;
    }
  }
  const visibleIndices = new Set<number>();
  if (groups?.length) for (const group of groups) {
    if (!anatomicalBody && !isMaterialRendered(materials[group.materialIndex ?? 0])) continue;
    for (let i = group.start; i < group.start + group.count; i += 1) visibleIndices.add(geometry?.index?.getX(i) ?? i);
  }
  mesh.skeleton?.update?.();
  const stride = Math.max(1, Math.floor(position.count / 6000));
  const built: SampleRow[] = [];
  for (let index = 0; index < position.count; index += stride) {
    if (groups?.length && !visibleIndices.has(index)) continue;
    const region = regionForVertex(mesh, index);
    if (!region) continue;
    built.push({ index, region, skipContact: region === "occiput" && normalAttr !== undefined && normalAttr.getZ(index) >= 0 });
  }
  const rowCount = built.length;
  const boneCount = bones.length;
  const bindMatrix = mesh.bindMatrix as Matrix4;
  const base = new Float64Array(rowCount * 3);
  const skinIdx = new Int32Array(rowCount * 4);
  const skinW = new Float64Array(rowCount * 4);
  for (let row = 0; row < rowCount; row += 1) {
    const index = built[row]!.index;
    Mesh.prototype.getVertexPosition.call(mesh as unknown as Mesh, index, scratchBase);
    scratchBase.applyMatrix4(bindMatrix);
    base[row * 3] = scratchBase.x; base[row * 3 + 1] = scratchBase.y; base[row * 3 + 2] = scratchBase.z;
    if (skinIndexAttr && skinWeightAttr) for (let lane = 0; lane < 4; lane += 1) {
      skinW[row * 4 + lane] = lane === 0 ? skinWeightAttr.getX(index) : lane === 1 ? skinWeightAttr.getY(index)
        : lane === 2 ? skinWeightAttr.getZ(index) : (skinWeightAttr.getW?.(index) ?? 0);
      skinIdx[row * 4 + lane] = lane === 0 ? skinIndexAttr.getX(index) : lane === 1 ? skinIndexAttr.getY(index)
        : lane === 2 ? skinIndexAttr.getZ(index) : (skinIndexAttr.getW?.(index) ?? 0);
    }
  }
  const boneRowCounts = new Int32Array(Math.max(0, boneCount));
  const boneUsed = new Uint8Array(Math.max(0, boneCount));
  for (let row = 0; row < rowCount; row += 1) for (let lane = 0; lane < 4; lane += 1) {
    if (skinW[row * 4 + lane] !== 0) {
      const bone = skinIdx[row * 4 + lane]!;
      if (bone >= 0 && bone < boneCount) { boneRowCounts[bone] = boneRowCounts[bone]! + 1; boneUsed[bone] = 1; }
    }
  }
  const boneRowStart = new Int32Array(boneCount + 1);
  for (let bone = 0; bone < boneCount; bone += 1) boneRowStart[bone + 1] = boneRowStart[bone]! + boneRowCounts[bone]!;
  const boneRows = new Int32Array(boneRowStart[boneCount]!);
  const boneRowCursor = Int32Array.from(boneRowStart.subarray(0, boneCount));
  for (let row = 0; row < rowCount; row += 1) for (let lane = 0; lane < 4; lane += 1) {
    if (skinW[row * 4 + lane] !== 0) {
      const bone = skinIdx[row * 4 + lane]!;
      if (bone >= 0 && bone < boneCount) {
        boneRows[boneRowCursor[bone]!] = row; boneRowCursor[bone] = boneRowCursor[bone]! + 1;
      }
    }
  }
  const boneNames: string[] = [];
  for (let boneIndex = 0; boneIndex < bones.length; boneIndex += 1) boneNames.push(bones[boneIndex]!.name);
  const groupsCopy: Array<[number, number, number | undefined]> = [];
  if (groups?.length) for (const group of groups) groupsCopy.push([group.start, group.count, group.materialIndex]);
  const materialVisible: unknown[] = []; const materialOpacity: unknown[] = [];
  const materialAlphaTest: unknown[] = []; const materialTransparent: unknown[] = []; const materialUuid: unknown[] = [];
  for (const material of materials) {
    const view = material as unknown as { visible?: unknown; opacity?: unknown; alphaTest?: unknown; transparent?: unknown; uuid?: unknown } | undefined;
    materialVisible.push(view?.visible); materialOpacity.push(view?.opacity); materialAlphaTest.push(view?.alphaTest);
    materialTransparent.push(view?.transparent); materialUuid.push(view?.uuid);
  }
  const influences = mesh.morphTargetInfluences;
  const entry: SampleCacheEntry = {
    anatomicalBody, geometry, position, positionVersion,
    skinIndexAttr, skinIndexVersion, skinWeightAttr, skinWeightVersion,
    normalAttr, normalVersion, indexAttr, indexVersion,
    groupsCopy, bones, boneNames, materialCount: materials.length,
    materialVisible, materialOpacity, materialAlphaTest, materialTransparent, materialUuid,
    morphInfluencesCopy: influences === undefined || influences === null ? undefined : [...influences],
    morphTargetsRelative: geometry?.morphTargetsRelative,
    morphPositionRef: geometry?.morphAttributes?.position ?? null,
    bindMatrixCopy: Float64Array.from(bindMatrix.elements),
    bindMatrixInverseCopy: Float64Array.from((mesh.bindMatrixInverse as Matrix4).elements),
    rows: built, base, skinIdx, skinW, boneRowStart, boneRows, boneUsed,
    current: new Float64Array(boneCount * 16), previous: new Float64Array(boneCount * 16),
    prevMatrixWorld: Float64Array.from(mesh.matrixWorld.elements),
    lastPlanes: null, hasPrevious: false,
    kind: new Uint8Array(rowCount), gapValue: new Float64Array(rowCount),
    stamp: new Uint32Array(rowCount), callId: 0, dirty: new Int32Array(rowCount),
  };
  sampleCache.set(mesh, entry);
  return entry;
}

export function resolveSupportSampleRows(
  mesh: SkinnedLike, anatomicalBody: boolean, materials: ReadonlyArray<unknown>,
): SampleRow[] {
  const entry = ensureSupportSampleEntry(mesh, anatomicalBody, materials);
  return entry ? entry.rows : [];
}

function skinSupportRowToWorld(entry: SampleCacheEntry, row: number, bindInverse: Matrix4, matrixWorld: Matrix4): void {
  scratchBase.set(entry.base[row * 3]!, entry.base[row * 3 + 1]!, entry.base[row * 3 + 2]!);
  scratchOut.set(0, 0, 0);
  for (let lane = 0; lane < 4; lane += 1) {
    const weight = entry.skinW[row * 4 + lane]!;
    if (weight !== 0) {
      const bone = entry.skinIdx[row * 4 + lane]!;
      scratchBone.fromArray(entry.current, bone * 16);
      scratchOut.addScaledVector(scratchLane.copy(scratchBase).applyMatrix4(scratchBone), weight);
    }
  }
  scratchOut.applyMatrix4(bindInverse);
  scratchOut.applyMatrix4(matrixWorld);
}

function storeSupportRow(
  entry: SampleCacheEntry,
  planes: Readonly<Record<SupineSupportRegion, SupineSupportPlane>>,
  row: number, world: Vector3,
): void {
  const region = entry.rows[row]!.region;
  const plane = planes[region];
  if (plane.contains && !plane.contains(world)) {
    const underlying = plane.outsideCollisionPlane;
    if (underlying && (!underlying.contains || underlying.contains(world))) {
      entry.kind[row] = 1;
      entry.gapValue[row] = underlying.normal.dot(scratchUnderlying.copy(world).sub(underlying.origin));
    } else {
      entry.kind[row] = 0; entry.gapValue[row] = 0;
    }
    return;
  }
  const gap = plane.normal.dot(scratchGap.copy(world).sub(plane.origin));
  entry.kind[row] = 2; entry.gapValue[row] = gap;
}

function aggregateSupportEntry(
  entry: SampleCacheEntry,
  gaps: Record<SupineSupportRegion, number[]>, minimum: Record<SupineSupportRegion, number>,
): void {
  for (let row = 0; row < entry.rows.length; row += 1) {
    const region = entry.rows[row]!.region;
    const kind = entry.kind[row]!;
    if (kind === 1 || kind === 2) minimum[region] = Math.min(minimum[region]!, entry.gapValue[row]!);
    if (kind === 2 && !entry.rows[row]!.skipContact) gaps[region]!.push(entry.gapValue[row]!);
  }
}

export function accumulateSupportGapsFast(
  mesh: SkinnedLike, anatomicalBody: boolean, materials: ReadonlyArray<unknown>,
  planes: Readonly<Record<SupineSupportRegion, SupineSupportPlane>>,
  gaps: Record<SupineSupportRegion, number[]>, minimum: Record<SupineSupportRegion, number>,
): void {
  const entry = ensureSupportSampleEntry(mesh, anatomicalBody, materials);
  if (!entry || entry.rows.length === 0) return;
  const bones = mesh.skeleton?.bones;
  const inverses = mesh.skeleton?.boneInverses;
  const bindInverse = mesh.bindMatrixInverse;
  const matrixWorld = mesh.matrixWorld;
  if (!bones || !inverses || !bindInverse) {
    for (let row = 0; row < entry.rows.length; row += 1) {
      mesh.getVertexPosition!(entry.rows[row]!.index, scratchBase);
      scratchOut.copy(scratchBase).applyMatrix4(matrixWorld);
      storeSupportRow(entry, planes, row, scratchOut);
    }
    aggregateSupportEntry(entry, gaps, minimum);
    return;
  }
  const boneCount = bones.length;
  for (let bone = 0; bone < boneCount; bone += 1) {
    if (entry.boneUsed[bone] !== 1) continue;
    scratchCurrent.multiplyMatrices(bones[bone]!.matrixWorld, inverses[bone]!);
    entry.current.set(scratchCurrent.elements, bone * 16);
  }
  let allDirty = !entry.hasPrevious || entry.lastPlanes !== planes;
  if (!allDirty && !elementsMatch(entry.bindMatrixInverseCopy, bindInverse.elements)) allDirty = true;
  if (!allDirty && !elementsMatch(entry.prevMatrixWorld, matrixWorld.elements)) allDirty = true;
  let dirtyCount = 0;
  if (allDirty) {
    for (let row = 0; row < entry.rows.length; row += 1) entry.dirty[dirtyCount++] = row;
  } else {
    entry.callId += 1;
    if (entry.callId === 0) { entry.stamp.fill(0); entry.callId = 1; }
    const mark = entry.callId;
    for (let bone = 0; bone < boneCount; bone += 1) {
      if (entry.boneUsed[bone] !== 1) continue;
      let changed = false;
      for (let element = 0; element < 16; element += 1) {
        if (entry.current[bone * 16 + element] !== entry.previous[bone * 16 + element]) { changed = true; break; }
      }
      if (!changed) continue;
      for (let slot: number = entry.boneRowStart[bone]!; slot < entry.boneRowStart[bone + 1]!; slot += 1) {
        const row = entry.boneRows[slot]!;
        if (entry.stamp[row] !== mark) { entry.stamp[row] = mark; entry.dirty[dirtyCount++] = row; }
      }
    }
  }
  for (let dirtyIndex = 0; dirtyIndex < dirtyCount; dirtyIndex += 1) {
    const row = entry.dirty[dirtyIndex]!;
    skinSupportRowToWorld(entry, row, bindInverse, matrixWorld);
    storeSupportRow(entry, planes, row, scratchOut);
  }
  entry.previous.set(entry.current);
  entry.bindMatrixInverseCopy.set(bindInverse.elements);
  entry.prevMatrixWorld.set(matrixWorld.elements);
  entry.lastPlanes = planes; entry.hasPrevious = true;
  aggregateSupportEntry(entry, gaps, minimum);
}

export function selectContactGap(values: ReadonlyArray<number> | ArrayLike<number>): number | null {
  const length = values.length;
  if (length === 0) return null;
  const target = Math.max(0, Math.min(length - 1, Math.floor((length - 1) * 0.08)));
  const work = Float64Array.from(values as ArrayLike<number>);
  selectKth(work, target);
  return work[target] ?? null;
}

function selectKth(data: Float64Array, target: number): void {
  let low = 0; let high = data.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (data[middle]! < data[low]!) swapKth(data, middle, low);
    if (data[high]! < data[low]!) swapKth(data, high, low);
    if (data[high]! < data[middle]!) swapKth(data, high, middle);
    const pivot = data[high]!;
    let store = low;
    for (let scan = low; scan < high; scan += 1) {
      if (data[scan]! < pivot) { swapKth(data, scan, store); store += 1; }
    }
    swapKth(data, store, high);
    if (store === target) return;
    if (store < target) low = store + 1;
    else high = store - 1;
  }
}

function swapKth(data: Float64Array, left: number, right: number): void {
  const held = data[left]!;
  data[left] = data[right]!; data[right] = held;
}
