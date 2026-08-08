/**
 * Parametric station shell builder driven by scenario environmentId (#44, #133).
 *
 * Reads the shared environment descriptor from @openclinxr/asset-registry so the
 * runtime and factory plan the same room. Boxes are the extension point for a
 * later kit-bash / generative bake-off — not the destination art style.
 *
 * #81: patient_chair fixture builds real chair geometry with seatHeightMeters
 * (see station-chair.ts).
 * #97: stretcher fixture builds real horizontal bed geometry with deckTopYMeters
 * (see station-stretcher.ts).
 * #133: ceiling closes the open-top void; non-support slots get layout props (not
 * 0.18³ markers). learner_start stays a spawn-anchor marker. Patient support is
 * declared per environment (stretcher / patient_chair / none) — never primary_patient.
 *
 * claimScope: closed parametric shell + fixture-driven patient support geometry.
 * notEvidenceFor: Quest viability, trim/detail kit, clinical furniture realism.
 */

import { resolveEnvironmentShellDescriptor } from "@openclinxr/asset-registry";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
  type Object3D,
} from "three";
import { tryBuildArchitectureFixture } from "./station-architecture-fixtures.js";
import { roleClassFromFixtureSlotId } from "./fixture-role-ownership.js";
import { buildPatientChair, isPatientChairSlotId } from "./station-chair.js";
import { buildPatientStretcher, isStretcherSlotId } from "./station-stretcher.js";

export type BuildStationEnvironmentInput = {
  environmentId: string;
};

/** Spawn anchor — never furniture (#133). */
export function isLearnerStartSlotId(slotId: string): boolean {
  return slotId.toLowerCase() === "learner_start";
}

/**
 * Cheap multi-mesh layout prop for non-support fixture slots (monitor, desk, cart).
 * Not a marker cube: isMarkerCube=false, larger than 0.18³, multi-part silhouette.
 */
export function buildFixtureLayoutProp(input: {
  slotId: string;
  purpose?: string;
  position: { x: number; y: number; z: number };
  trimColor: ColorRepresentation;
}): Group {
  const root = new Group();
  root.name = `openclinxr.station-environment.fixture-slot.${input.slotId}`;
  root.position.set(input.position.x, 0, input.position.z);

  const frame = new MeshStandardMaterial({
    color: 0x8b939c,
    roughness: 0.62,
    metalness: 0.18,
  });
  const accent = new MeshStandardMaterial({
    color: input.trimColor,
    roughness: 0.55,
    metalness: 0.08,
  });

  const id = input.slotId.toLowerCase();
  if (id.includes("monitor") || id.includes("shelf")) {
    const stand = new Mesh(new BoxGeometry(0.08, 1.1, 0.08), frame);
    stand.position.set(0, 0.55, 0);
    stand.name = `${root.name}.stand`;
    const panel = new Mesh(new BoxGeometry(0.42, 0.32, 0.05), accent);
    panel.position.set(0, 1.2, 0);
    panel.name = `${root.name}.panel`;
    root.add(stand, panel);
  } else if (id.includes("desk") || id.includes("laptop")) {
    const legs = new Mesh(new BoxGeometry(0.7, 0.72, 0.4), frame);
    legs.position.set(0, 0.36, 0);
    legs.name = `${root.name}.legs`;
    const top = new Mesh(new BoxGeometry(0.78, 0.04, 0.48), accent);
    top.position.set(0, 0.74, 0);
    top.name = `${root.name}.top`;
    root.add(legs, top);
  } else {
    // Generic cart / layout block
    const body = new Mesh(new BoxGeometry(0.45, 0.55, 0.35), frame);
    body.position.set(0, 0.35, 0);
    body.name = `${root.name}.body`;
    const top = new Mesh(new BoxGeometry(0.5, 0.05, 0.4), accent);
    top.position.set(0, 0.65, 0);
    top.name = `${root.name}.top`;
    root.add(body, top);
  }

  root.userData.fixtureSlotId = input.slotId;
  root.userData.fixtureSlotPurpose = input.purpose ?? "layout prop";
  root.userData.isMarkerCube = false;
  root.userData.openClinXrFixtureKind = "procedural_layout_prop";
  root.userData.openClinXrDynamicScenePolicy = "non_support_fixture_slot_builds_layout_prop_not_marker";
  return root;
}

/**
 * Build a three.js Group for the encounter-side station shell (floor + walls + ceiling + fixtures).
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
  shell.userData.hasCeiling = true;

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

  // #133 — ceiling closes the open top (capture camera at y=2.05 inside a ~2.65 m room).
  // No fourth/front wall: doorway framing for room captures stays open.
  const ceilingMat = new MeshStandardMaterial({
    color: d.wallColor,
    roughness: 0.92,
    metalness: 0,
    // Slight lift so closed rooms do not go fully black under hemisphere light alone.
    emissive: d.wallColor,
    emissiveIntensity: 0.06,
  });
  const ceiling = new Mesh(new BoxGeometry(width, 0.06, depth), ceilingMat);
  ceiling.name = "openclinxr.station-environment.ceiling";
  ceiling.position.set(0, height - 0.03, floorZ);
  ceiling.userData.openClinXrDynamicScenePolicy = "environmentId_driven_room_ceiling_closes_open_top";
  ceiling.userData.isCeiling = true;
  shell.add(ceiling);
  shell.userData.ceilingMesh = ceiling;

  const wallTrim = new Mesh(new BoxGeometry(width - 0.3, 0.06, 0.035), trimMaterial);
  wallTrim.name = "openclinxr.station-environment.wall-trim";
  wallTrim.position.set(0, 1.02, backZ + 0.06);
  wallTrim.userData.openClinXrDynamicScenePolicy = "environmentId_driven_wall_trim";
  shell.add(wallTrim);

  // Fixtures: architecture (door/board/surface) / stretcher / chair / layout;
  // learner_start stays a marker cube. #186 ownership roles stamped on each root.
  const ownedRoles = new Set<string>();
  for (const slot of d.fixtureSlots) {
    ownedRoles.add(roleClassFromFixtureSlotId(slot.slotId));
  }
  shell.userData.fixtureOwnedRoles = [...ownedRoles];

  for (const slot of d.fixtureSlots) {
    const arch = tryBuildArchitectureFixture({
      slotId: slot.slotId,
      purpose: slot.purpose,
      position: slot.position,
      trimColor: d.wallTrimColor,
    });
    if (arch) {
      shell.add(arch);
      continue;
    }
    if (isPatientChairSlotId(slot.slotId)) {
      const chair = buildPatientChair({
        slotId: slot.slotId,
        purpose: slot.purpose,
        position: slot.position,
        trimColor: d.wallTrimColor,
      });
      chair.userData.openClinXrFixtureRole = roleClassFromFixtureSlotId(slot.slotId);
      shell.add(chair);
      continue;
    }
    if (isStretcherSlotId(slot.slotId)) {
      const stretcher = buildPatientStretcher({
        slotId: slot.slotId,
        purpose: slot.purpose,
        position: slot.position,
        trimColor: d.wallTrimColor,
        // Descriptor-driven HOB incline (#171) — slot carries position + angle together.
        ...(typeof slot.inclineDegrees === "number" ? { inclineDegrees: slot.inclineDegrees } : {}),
      });
      stretcher.userData.openClinXrFixtureRole = roleClassFromFixtureSlotId(slot.slotId);
      shell.add(stretcher);
      continue;
    }
    if (isLearnerStartSlotId(slot.slotId)) {
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
      marker.userData.isMarkerCube = true;
      marker.userData.openClinXrFixtureRole = "learner_start";
      shell.add(marker);
      continue;
    }
    // Other declared slots (monitor, desk, cart): real layout props, not marker cubes.
    const layout = buildFixtureLayoutProp({
      slotId: slot.slotId,
      purpose: slot.purpose,
      position: slot.position,
      trimColor: d.wallTrimColor,
    });
    layout.userData.openClinXrFixtureRole = roleClassFromFixtureSlotId(slot.slotId);
    shell.add(layout);
  }

  return shell;
}

/** Optional helper for callers that need to hide the parametric shell during comparator captures. */
export function setStationEnvironmentVisible(shell: Object3D, visible: boolean): void {
  shell.visible = visible;
}
