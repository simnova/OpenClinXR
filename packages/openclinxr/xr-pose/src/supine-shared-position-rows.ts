/**
 * Shared-POSITION row ownership for the aisha-sweater consumer fix (moved verbatim
 * out of supine-support-skin-cache.ts and supine-hand-rest.ts so both stay under
 * the 500-line zone budget; no behaviour change). Every skinned mesh that shares
 * one POSITION attribute set (aisha's appended hide primitive reuses the body
 * arrays) may claim only its own index-referenced rows via the ONE helper
 * contract in shared-attribute-index-union.ts. Meshes alone on their set resolve
 * null and their callers keep the legacy all-rows path.
 */
import type { Material, Matrix4, Object3D, Vector3 } from "three";
import {
  resolveSharedAttributeRows,
  type SharedAttributeCarrier,
} from "./shared-attribute-index-union.js";

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

export function isMaterialRendered(material: unknown): boolean {
  const view = material as Material | undefined;
  return !!view && !!view.visible && !(view.opacity <= view.alphaTest || (view.transparent && view.opacity <= 0));
}

export type SharedAttributeCacheEntry = {
  siblings: SkinnedLike[];
  geometries: unknown[];
  indexAttrs: unknown[];
  indexVersions: unknown[];
  siblingMaterialKeys: string[];
  siblingAnatomical: boolean[];
  union: Set<number>;
  /** This mesh's own index-referenced rows, aligned with `siblings`. */
  ownRows: Array<Set<number>>;
};

/**
 * Union of index-referenced rows across every skinned mesh sharing one POSITION
 * attribute set (aisha's appended hide primitive reuses the body arrays), or null
 * when this mesh is alone on its set — then the caller keeps its legacy path.
 * Cached per attribute set and validated by sibling/index/material versions; a mesh
 * added or removed mid-session is not detected (static GLBs only, as before).
 */
const sharedAttributeCache = new WeakMap<object, SharedAttributeCacheEntry>();

function siblingMaterialKey(sibling: SkinnedLike): string {
  const materials = Array.isArray(sibling.material) ? sibling.material : [sibling.material];
  return materials
    .map((material) => {
      const view = material as unknown as {
        visible?: unknown; opacity?: unknown; alphaTest?: unknown; transparent?: unknown; uuid?: unknown;
      } | undefined;
      return `${String(view?.visible)}|${String(view?.opacity)}|${String(view?.alphaTest)}|${String(view?.transparent)}|${String(view?.uuid)}`;
    })
    .join(";");
}

function isAnatomicalBodyMesh(mesh: SkinnedLike): boolean {
  return /mpfb.*body|reference_body/iu.test(mesh.name ?? "");
}

export function sharedPositionEntryFor(mesh: SkinnedLike): SharedAttributeCacheEntry | null {
  const geometry = mesh.geometry;
  const position = geometry?.attributes?.position;
  if (!mesh.isSkinnedMesh || !position) return null;
  const cached = sharedAttributeCache.get(position as object);
  if (cached) {
    let valid = cached.siblings.length > 1;
    for (let i = 0; valid && i < cached.siblings.length; i += 1) {
      const sibling = cached.siblings[i]!;
      const siblingGeometry = sibling.geometry;
      if (!siblingGeometry || cached.geometries[i] !== siblingGeometry) { valid = false; break; }
      const siblingIndex = siblingGeometry.index as unknown as { version?: unknown } | undefined;
      if (cached.indexAttrs[i] !== (siblingIndex ?? null)
        || cached.indexVersions[i] !== siblingIndex?.version) { valid = false; break; }
      if (cached.siblingMaterialKeys[i] !== siblingMaterialKey(sibling)) { valid = false; break; }
      if (cached.siblingAnatomical[i] !== isAnatomicalBodyMesh(sibling)) { valid = false; break; }
    }
    if (valid) return cached;
  }
  let top: object = mesh;
  let cursor = mesh.parent as unknown;
  while (cursor !== null && cursor !== undefined && typeof cursor === "object") {
    top = cursor;
    cursor = (cursor as { parent?: unknown }).parent;
  }
  const siblings: SkinnedLike[] = [];
  (top as { traverse?: (visit: (object: SkinnedLike) => void) => void }).traverse?.((object) => {
    if (object.isSkinnedMesh && object.geometry?.attributes?.position === position) siblings.push(object);
  });
  if (siblings.length < 2) return null;
  const carriers: SharedAttributeCarrier[] = [];
  for (const sibling of siblings) {
    const siblingGeometry = sibling.geometry!;
    const siblingGroups = siblingGeometry.groups;
    const siblingIndex = siblingGeometry.index;
    const siblingMaterials = Array.isArray(sibling.material) ? sibling.material : [sibling.material];
    const anatomical = isAnatomicalBodyMesh(sibling);
    let ranges: Array<{ start: number; count: number }> | undefined;
    if (siblingGroups?.length) {
      ranges = [];
      for (const group of siblingGroups) {
        if (!anatomical && !isMaterialRendered(siblingMaterials[group.materialIndex ?? 0])) continue;
        ranges.push({ start: group.start, count: group.count });
      }
    }
    carriers.push({
      set: position,
      index: siblingIndex ? { count: siblingIndex.count, getX: (at: number) => siblingIndex.getX(at) } : null,
      vertexCount: position.count,
      ...(ranges ? { ranges } : {}),
    });
  }
  const resolution = resolveSharedAttributeRows(carriers).get(position);
  if (!resolution || !resolution.shared) return null;
  const ownRows = carriers.map((carrier) => new Set(resolution.perCarrier.get(carrier) ?? []));
  const entry: SharedAttributeCacheEntry = {
    siblings,
    geometries: siblings.map((sibling) => sibling.geometry),
    indexAttrs: siblings.map((sibling) => sibling.geometry!.index ?? null),
    indexVersions: siblings.map((sibling) => (sibling.geometry!.index as unknown as { version?: unknown } | undefined)?.version),
    siblingMaterialKeys: siblings.map(siblingMaterialKey),
    siblingAnatomical: siblings.map(isAnatomicalBodyMesh),
    union: new Set(resolution.union),
    ownRows,
  };
  sharedAttributeCache.set(position as object, entry);
  return entry;
}

type LimbAttribute = { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number; getW: (i: number) => number };
type LimbSkin = Object3D & {
  isSkinnedMesh?: boolean;
  geometry?: {
    index?: { count: number; getX: (i: number) => number; version?: unknown } | null;
    attributes?: { position?: LimbAttribute; skinIndex?: LimbAttribute; skinWeight?: LimbAttribute };
  };
  skeleton?: { bones: Object3D[]; update: () => void };
  getVertexPosition?: (index: number, target: Vector3) => Vector3;
};

/**
 * Rows this mesh may claim: its own index-referenced rows when it shares its
 * POSITION set with another skinned mesh (aisha's appended hide primitive
 * reuses the body arrays), or null when it is alone on its set — then the
 * caller keeps its legacy all-rows path. Same ONE helper contract as the
 * support sampler; the traversal here carries no material/group ranges because
 * limbPoints never group-filters.
 */
export function ownLimbRows(root: Object3D, mesh: LimbSkin): Set<number> | null {
  const position = mesh.geometry?.attributes?.position;
  if (!position) return null;
  let top: object = mesh;
  let cursor = mesh.parent as unknown;
  while (cursor !== null && cursor !== undefined && typeof cursor === "object") {
    top = cursor;
    cursor = (cursor as { parent?: unknown }).parent;
  }
  const siblings: LimbSkin[] = [];
  (top as { traverse?: (visit: (object: LimbSkin) => void) => void }).traverse?.((object) => {
    if (object.isSkinnedMesh && object.geometry?.attributes?.position === position) siblings.push(object);
  });
  if (siblings.length < 2) return null;
  const carriers: SharedAttributeCarrier[] = siblings.map((sibling) => {
    const siblingIndex = sibling.geometry?.index;
    return {
      set: position,
      index: siblingIndex ? { count: siblingIndex.count, getX: (row: number) => siblingIndex.getX(row) } : null,
      vertexCount: position.count,
    };
  });
  const resolution = resolveSharedAttributeRows(carriers).get(position);
  if (!resolution || !resolution.shared) return null;
  const at = siblings.indexOf(mesh);
  if (at < 0) return null;
  return new Set(resolution.perCarrier.get(carriers[at]!) ?? []);
}
