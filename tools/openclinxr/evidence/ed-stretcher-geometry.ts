/**
 * #97 — station fixture geometry inspector for ED stretcher / chair.
 *
 * World-space bounds from the *built* station shell (`buildStationEnvironment`),
 * not descriptor declared numbers and not the axis-broken shell GLB nodes.
 *
 * claimScope: stretcher deck proportions + chair counterweight from fixture builder.
 * notEvidenceFor: clinical stretcher realism, supine placement, Quest readiness.
 */

import { buildStationEnvironment } from "../../../apps/ui-xr/src/station-environment.js";

export type FixtureGeometry = {
  fixtureId: string;
  /** World-space bounds of what the built scene actually contains, not declared descriptor numbers. */
  widthMeters: number;
  heightMeters: number;
  lengthMeters: number;
  /** Top surface Y — where a body would rest. */
  deckTopY: number;
  isMarkerCube: boolean;
  visible: boolean;
};

export type FixtureGeometryReport = {
  environmentId: string;
  fixtures: FixtureGeometry[];
};

type Bounds = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
type MeshLike = {
  isMesh?: boolean;
  geometry?: {
    computeBoundingBox?: () => void;
    boundingBox?: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    } | null;
  };
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
};

/** Expand `into` by a mesh's local geometry AABB at a given local origin (no parent chain). */
function expandMeshAt(obj: MeshLike, origin: { x: number; y: number; z: number }, into: Bounds): void {
  if (!obj.isMesh || !obj.geometry) return;
  obj.geometry.computeBoundingBox?.();
  const bb = obj.geometry.boundingBox;
  if (!bb) return;
  const sx = obj.scale.x;
  const sy = obj.scale.y;
  const sz = obj.scale.z;
  const xs = [bb.min.x * sx, bb.max.x * sx];
  const ys = [bb.min.y * sy, bb.max.y * sy];
  const zs = [bb.min.z * sz, bb.max.z * sz];
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        const wx = origin.x + x;
        const wy = origin.y + y;
        const wz = origin.z + z;
        into.minX = Math.min(into.minX, wx);
        into.minY = Math.min(into.minY, wy);
        into.minZ = Math.min(into.minZ, wz);
        into.maxX = Math.max(into.maxX, wx);
        into.maxY = Math.max(into.maxY, wy);
        into.maxZ = Math.max(into.maxZ, wz);
      }
    }
  }
}

/**
 * World AABB of a fixture root. Procedural fixtures are a Group of direct Mesh children
 * (no intermediate transforms / rotations). Marker cubes are a single Mesh root.
 */
function fixtureWorldBounds(root: MeshLike & {
  traverse: (fn: (o: unknown) => void) => void;
}): Bounds | null {
  const local: Bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  // Root mesh (marker cube): geometry at local origin, then root.position applied below.
  if (root.isMesh) {
    expandMeshAt(root, { x: 0, y: 0, z: 0 }, local);
  }
  root.traverse((o) => {
    if (o === root) return;
    const mesh = o as MeshLike;
    // Direct children only — procedural chair/stretcher never nest further.
    expandMeshAt(mesh, mesh.position, local);
  });
  if (!Number.isFinite(local.minX)) return null;
  return {
    minX: local.minX + root.position.x,
    minY: local.minY + root.position.y,
    minZ: local.minZ + root.position.z,
    maxX: local.maxX + root.position.x,
    maxY: local.maxY + root.position.y,
    maxZ: local.maxZ + root.position.z,
  };
}

/**
 * Inspect fixture slot geometry from the parametric station shell builder.
 * Dimensions come from world-space bounds of each fixture-slot root (built meshes).
 */
export async function inspectStationFixtureGeometry(input: {
  environmentId: string;
}): Promise<FixtureGeometryReport> {
  const shell = buildStationEnvironment({ environmentId: input.environmentId });
  const fixtures: FixtureGeometry[] = [];

  for (const child of shell.children) {
    const slotId = String(child.userData?.fixtureSlotId ?? "");
    if (!slotId) continue;

    const box = fixtureWorldBounds(child as MeshLike & {
      traverse: (fn: (o: unknown) => void) => void;
    });
    if (!box) continue;

    const sizeX = box.maxX - box.minX;
    const sizeY = box.maxY - box.minY;
    const sizeZ = box.maxZ - box.minZ;
    // Length = long horizontal axis; width = short horizontal axis.
    const lengthMeters = Math.max(sizeX, sizeZ);
    const widthMeters = Math.min(sizeX, sizeZ);
    const heightMeters = sizeY;
    const declaredDeck =
      typeof child.userData?.deckTopYMeters === "number"
        ? child.userData.deckTopYMeters
        : typeof child.userData?.seatHeightMeters === "number"
          ? child.userData.seatHeightMeters
          : box.maxY;

    fixtures.push({
      fixtureId: slotId,
      widthMeters,
      heightMeters,
      lengthMeters,
      deckTopY: declaredDeck,
      isMarkerCube: child.userData?.isMarkerCube === true,
      visible: child.visible !== false,
    });
  }

  return {
    environmentId: input.environmentId,
    fixtures,
  };
}
