/**
 * #336 — Infinigen-generated station environment, selected by `environmentId`.
 *
 * Six Infinigen probe slices (#130/#135/#229/#234/#236/#271) produced evidence but no
 * consumer: `grep -rn "infinigen" apps/ui-xr/src/*.ts` was ZERO matches. This module is
 * the consumer seam — a deterministic generated room under a learner.
 *
 * Parameterisation posture (measured, #271 + #336): `wall_height` is an exact deterministic
 * gin input; absolute footprint and door placement are NOT inputs (soft objectives, sampled).
 * So the factory contract is "one reproducible room per environmentId", not "emit this exact
 * bay from the case". The shipped GLB is baked from `clinical_bay.gin` seed 0 (reproducibility
 * verified: two independent seed-0 runs produced identical floorplan footprints) with a single
 * room extracted post-process (the proven #236 technique) and centered with floor top at y=0.
 *
 * The procedural `buildStationEnvironment` box remains the FALLBACK: this loader only hides
 * the box's shell meshes (floor/walls/ceiling/trim) when its GLB actually loads; the box
 * stays visible if the environmentId is unmapped or the load fails.
 *
 * claimScope: environmentId-keyed loading of a deterministic generated Infinigen room shell
 * in the ui-xr station environment path, with the procedural box as fallback.
 * notEvidenceFor: clinical room semantics (the room is a residential-scale empty shell; clinical
 * identity comes from the parametric fixtures), Quest worn readiness, clinical validity, exact
 * dimension parameterisation of the generator, scoring validity.
 */

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, Group, Mesh, type Object3D, type Scene, Vector3 } from "three";

/** environmentId → shipped Infinigen room GLB. Deterministic bake; add rows as rooms are produced. */
export const INFINIGEN_ENVIRONMENT_ASSETS: Readonly<Record<string, string>> = {
  ed_exam_bay_v1: "/xr-assets/environment/infinigen-ed-exam-bay.glb",
} as const;

export type InfinigenEnvironmentStatus = {
  environmentId: string;
  state: "unmapped" | "pending" | "loaded" | "failed";
  assetPath: string | null;
  error?: string;
};

/** Shell-mesh name prefixes owned by the procedural box (not fixture slots). */
const SHELL_MESH_NAME_PREFIX = "openclinxr.station-environment.";
const FIXTURE_SLOT_PREFIX = "openclinxr.station-environment.fixture-slot.";
const SHELL_MESH_SUFFIXES = [
  "floor",
  "back-wall",
  "left-wall",
  "right-wall",
  "ceiling",
  "wall-trim",
] as const;

export function resolveInfinigenEnvironmentAsset(environmentId: string): string | null {
  return INFINIGEN_ENVIRONMENT_ASSETS[environmentId] ?? null;
}

/**
 * Hide the procedural box's shell meshes (floor/walls/ceiling/trim) while keeping fixtures,
 * so the generated room becomes the visible environment and the box stays as fallback.
 * Returns the number of shell meshes hidden.
 */
export function hideProceduralShellMeshes(stationEnvironment: Group): number {
  let hidden = 0;
  stationEnvironment.traverse((obj: Object3D) => {
    if (obj === stationEnvironment) return;
    if (!obj.name.startsWith(SHELL_MESH_NAME_PREFIX)) return;
    if (obj.name.startsWith(FIXTURE_SLOT_PREFIX)) return;
    const suffix = obj.name.slice(SHELL_MESH_NAME_PREFIX.length);
    if ((SHELL_MESH_SUFFIXES as readonly string[]).includes(suffix)) {
      obj.visible = false;
      obj.userData.openClinXrInfinigenPolicy =
        "hidden_generated_infinigen_room_owns_shell_procedural_box_is_fallback";
      hidden += 1;
    }
  });
  return hidden;
}

/**
 * Position a loaded Infinigen room so its floor TOP sits at y=0 (matching the procedural
 * shell's floor top) and its X/Z center coincides with the shell's floor center.
 *
 * The baked GLB is already centered with the floor slab at y≈0; this re-derives the floor
 * top from the room's OWN ".floor" mesh (never an invented constant) so any bake offset is
 * absorbed. Walls extend below the floor slab (baked as a single shell), which is fine: the
 * slab is the standing surface the actor-floor contracts measure.
 */
export function positionInfinigenRoom(
  roomRoot: Group,
  stationEnvironment: Group,
): { center: Vector3; floorTopY: number; floorCenterZ: number; roomSizeMeters: Vector3 } {
  const box = new Box3().setFromObject(roomRoot);
  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Floor top = world max-y of the room's own floor slab mesh (name ends ".floor").
  let floorTopY = 0;
  const floorProbe = new Box3();
  let foundFloor = false;
  roomRoot.traverse((obj: Object3D) => {
    if (foundFloor) return;
    if (obj instanceof Mesh && obj.isMesh && obj.name.toLowerCase().endsWith(".floor")) {
      floorProbe.setFromObject(obj);
      foundFloor = true;
    }
  });
  if (foundFloor) {
    floorTopY = floorProbe.max.y;
  } else {
    // No ".floor" mesh (unexpected bake): fall back to the lowest y band of the whole room.
    floorTopY = box.min.y + Math.min(0.2, size.y * 0.1);
  }

  const floorCenterZ =
    stationEnvironment.userData.floorMesh instanceof Object
      ? ((stationEnvironment.userData.floorMesh as Mesh).position.z ?? 0)
      : 0;
  roomRoot.position.x -= center.x;
  roomRoot.position.y -= floorTopY;
  roomRoot.position.z = floorCenterZ - center.z;
  roomRoot.userData.openClinXrInfinigenRoom = {
    boundsMin: [box.min.x, box.min.y, box.min.z],
    boundsMax: [box.max.x, box.max.y, box.max.z],
    sizeMeters: [size.x, size.y, size.z],
    floorTopY,
    floorCenterZ,
  };
  return { center, floorTopY, floorCenterZ, roomSizeMeters: size };
}

/**
 * Load the Infinigen room GLB for an environmentId and add it to the station environment.
 * Procedural box is the fallback: on success its shell meshes are hidden; on failure or
 * unmapped id nothing changes and the box stays visible.
 */
export function loadInfinigenEnvironmentIntoStation(input: {
  scene: Scene;
  environmentId: string;
  stationEnvironment: Group;
  onStatus?: (status: InfinigenEnvironmentStatus) => void;
}): InfinigenEnvironmentStatus {
  const assetPath = resolveInfinigenEnvironmentAsset(input.environmentId);
  if (!assetPath) {
    const status: InfinigenEnvironmentStatus = {
      environmentId: input.environmentId,
      state: "unmapped",
      assetPath: null,
      error: `no Infinigen room baked for environmentId ${input.environmentId}`,
    };
    input.onStatus?.(status);
    return status;
  }

  const status: InfinigenEnvironmentStatus = {
    environmentId: input.environmentId,
    state: "pending",
    assetPath,
  };
  input.onStatus?.(status);

  const loader = new GLTFLoader();
  try {
    loader.load(
      assetPath,
      (gltf) => {
        const roomRoot = gltf.scene;
        roomRoot.name = "openclinxr.station-environment.infinigen-room";
        roomRoot.userData.openClinXrEnvironmentSource = "infinigen-generated-room";
        roomRoot.userData.openClinXrEnvironmentId = input.environmentId;
        roomRoot.userData.openClinXrInfinigenPolicy =
          "generated_room_loaded_by_environmentId_procedural_box_is_fallback";
        const placement = positionInfinigenRoom(roomRoot, input.stationEnvironment);
        const hiddenShellMeshes = hideProceduralShellMeshes(input.stationEnvironment);
        roomRoot.userData.openClinXrInfinigenPlacement = placement;
        roomRoot.userData.openClinXrHiddenShellMeshes = hiddenShellMeshes;
        input.stationEnvironment.add(roomRoot);
        const loaded: InfinigenEnvironmentStatus = {
          environmentId: input.environmentId,
          state: "loaded",
          assetPath,
        };
        input.onStatus?.(loaded);
      },
      undefined,
      (error) => {
        const failed: InfinigenEnvironmentStatus = {
          environmentId: input.environmentId,
          state: "failed",
          assetPath,
          error: error instanceof Error ? error.message : String(error),
        };
        input.onStatus?.(failed);
      },
    );
  } catch (error) {
    // Synchronous throw (e.g. unresolvable asset URL in a non-browser environment) is also a
    // failure — the procedural box stays visible as the fallback.
    const failed: InfinigenEnvironmentStatus = {
      environmentId: input.environmentId,
      state: "failed",
      assetPath,
      error: error instanceof Error ? error.message : String(error),
    };
    input.onStatus?.(failed);
  }

  return status;
}
