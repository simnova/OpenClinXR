/**
 * Parametric station shell builder driven by scenario environmentId (#44).
 *
 * Reads the shared environment descriptor from @openclinxr/asset-registry so the
 * runtime and factory plan the same room. Boxes are the extension point for a
 * later kit-bash / generative bake-off — not the destination art style.
 */

import { resolveEnvironmentShellDescriptor } from "@openclinxr/asset-registry";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";

export type BuildStationEnvironmentInput = {
  environmentId: string;
};

/**
 * Build a three.js Group for the encounter-side station shell (floor + walls + trim).
 * userData records the requested environmentId, floor colour, room depth, and whether
 * an unknown id fell back to the generic shell.
 */
export function buildStationEnvironment(input: BuildStationEnvironmentInput): Group {
  const resolved = resolveEnvironmentShellDescriptor(input.environmentId);
  const d = resolved.descriptor;

  const shell = new Group();
  shell.name = "openclinxr.station-environment-shell";
  shell.userData.environmentId = input.environmentId;
  shell.userData.environmentDescriptorId = d.environmentId;
  shell.userData.floorColor = d.floorColor;
  shell.userData.roomDepthMeters = d.roomDepthMeters;
  shell.userData.roomWidthMeters = d.roomWidthMeters;
  shell.userData.roomHeightMeters = d.roomHeightMeters;
  shell.userData.wallColor = d.wallColor;
  shell.userData.wallTrimColor = d.wallTrimColor;
  shell.userData.fixtureSlots = d.fixtureSlots.map((slot) => ({ ...slot, position: { ...slot.position } }));
  shell.userData.environmentFallbackActive = resolved.environmentFallbackActive;
  shell.userData.environmentFallbackReason = resolved.environmentFallbackReason ?? "";
  shell.userData.openClinXrEnvironmentPolicy =
    "parametric_shell_from_shared_environment_descriptor_kitbash_slot";

  const width = d.roomWidthMeters;
  const depth = d.roomDepthMeters;
  const height = d.roomHeightMeters;
  // Place room so doorway (z≈0.9 exterior) opens into negative-Z encounter space.
  const floorZ = -(depth / 2) + 0.95;

  const floor = new Mesh(
    new BoxGeometry(width, 0.08, depth),
    new MeshStandardMaterial({ color: d.floorColor, roughness: 0.8 }),
  );
  floor.name = "openclinxr.station-environment.floor";
  floor.position.set(0, -0.04, floorZ);
  floor.userData.openClinXrSceneNecessityPolicy =
    "dynamic_encounter_world_floor_from_environment_descriptor";
  floor.userData.environmentId = input.environmentId;
  shell.add(floor);
  shell.userData.floorMesh = floor;

  const wallMaterial = new MeshStandardMaterial({
    color: d.wallColor,
    roughness: 0.88,
    metalness: 0,
  });
  const trimMaterial = new MeshStandardMaterial({
    color: d.wallTrimColor,
    roughness: 0.8,
    metalness: 0,
  });

  const backZ = floorZ - depth / 2 + 0.04;
  const sideZ = floorZ;
  const halfW = width / 2 - 0.04;

  const backWall = new Mesh(new BoxGeometry(width, height, 0.08), wallMaterial.clone());
  backWall.name = "openclinxr.station-environment.back-wall";
  backWall.position.set(0, height / 2 - 0.04, backZ);
  backWall.userData.openClinXrDynamicScenePolicy = "environmentId_driven_room_shell";
  shell.add(backWall);

  const leftWall = new Mesh(new BoxGeometry(0.08, height, depth), wallMaterial.clone());
  leftWall.name = "openclinxr.station-environment.left-wall";
  leftWall.position.set(-halfW, height / 2 - 0.04, sideZ);
  leftWall.userData.openClinXrDynamicScenePolicy = "environmentId_driven_room_shell";
  shell.add(leftWall);

  const rightWall = new Mesh(new BoxGeometry(0.08, height, depth), wallMaterial.clone());
  rightWall.name = "openclinxr.station-environment.right-wall";
  rightWall.position.set(halfW, height / 2 - 0.04, sideZ);
  rightWall.userData.openClinXrDynamicScenePolicy = "environmentId_driven_room_shell";
  shell.add(rightWall);

  const wallTrim = new Mesh(new BoxGeometry(width - 0.3, 0.06, 0.035), trimMaterial);
  wallTrim.name = "openclinxr.station-environment.wall-trim";
  wallTrim.position.set(0, 1.02, backZ + 0.06);
  wallTrim.userData.openClinXrDynamicScenePolicy = "environmentId_driven_wall_trim";
  shell.add(wallTrim);

  // Marker meshes for fixture slots — tiny visible cubes so captures differ by layout, not only colour.
  for (const slot of d.fixtureSlots) {
    const marker = new Mesh(
      new BoxGeometry(0.18, 0.06, 0.18),
      new MeshStandardMaterial({
        color: d.wallTrimColor,
        roughness: 0.55,
        emissive: d.wallTrimColor,
        emissiveIntensity: 0.08,
      }),
    );
    marker.name = `openclinxr.station-environment.fixture-slot.${slot.slotId}`;
    marker.position.set(slot.position.x, Math.max(0.03, slot.position.y), slot.position.z);
    marker.userData.fixtureSlotId = slot.slotId;
    marker.userData.fixtureSlotPurpose = slot.purpose;
    shell.add(marker);
  }

  return shell;
}

/** Optional helper for callers that need to hide the parametric shell during comparator captures. */
export function setStationEnvironmentVisible(shell: Object3D, visible: boolean): void {
  shell.visible = visible;
}
