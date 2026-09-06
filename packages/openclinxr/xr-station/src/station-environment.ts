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
  type NamedShellWall,
  wallFacingYawRadians,
} from "@openclinxr/asset-registry/fixture-wall-mounting";
// #196: subpath avoids growing the frozen asset-registry barrel (index.ts freeze 2843).
import {
  fixturePlacementRule,
  resolveFixtureSlotsForRoom,
} from "@openclinxr/asset-registry/environment-zone-templates";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
  type Object3D,
} from "three";
import {
  anchorFixtureNearFaceToPlane,
  tryBuildArchitectureFixture,
} from "./station-architecture-fixtures.js";
import {
  ownedRolesFromFixtureSlots,
  roleClassFromFixtureSlotId,
} from "./fixture-role-ownership.js";
import { buildPatientChair, isPatientChairSlotId } from "./station-chair.js";
import { buildPatientStretcher, isStretcherSlotId } from "./station-stretcher.js";
import {
  hasCompiledRoomAssetUrl,
  loadCompiledRoomShell,
  type CompiledRoomLoadInput,
} from "./compiled-room-loader.js";

export type BuildStationEnvironmentInput = {
  environmentId: string;
  /**
   * When both this URL and `compileNodeId` are present, `resolveStationEnvironment`
   * loads the compiled GLB as the primary shell and does not spawn the parametric box.
   */
  compiledRoomAssetUrl?: string;
  compileNodeId?: string;
  loadGltf?: CompiledRoomLoadInput["loadGltf"];
  /**
   * Optional dimension overrides for in-process generator sweeps (#194/#196).
   * When set, shell geometry uses these instead of the registry descriptor values.
   * Fixture slots authored for the descriptor dimensions are re-resolved so
   * non-learner positions track width/depth (#196 fraction layout). Product
   * callers leave these unset (identity resolve → same as authored).
   */
  roomWidthMeters?: number;
  roomDepthMeters?: number;
  roomHeightMeters?: number;
};

/** Spawn anchor — never furniture (#133). */
export function isLearnerStartSlotId(slotId: string): boolean {
  return slotId.toLowerCase() === "learner_start";
}

/** Parametric wall/ceiling slab thickness. One source for the builder and the wall planes. */
export const PARAMETRIC_WALL_THICKNESS_M = 0.08;
const HALF_WALL = PARAMETRIC_WALL_THICKNESS_M / 2;

/** Floor centre Z of the parametric shell (doorway opens +Z). */
export function parametricShellFloorCenterZ(depthMeters: number): number {
  return -(depthMeters / 2) + 0.95;
}

/**
 * #342c — world coordinate of a named parametric wall's INNER face.
 *
 * Derived from the same expressions the wall meshes are built from below (`halfW`,
 * `backZ`, slab thickness), so a fixture anchored to a plane and the wall it is anchored
 * to cannot drift apart. `+z` has no wall — the shell is deliberately open at the front
 * for capture framing — so its plane is the floor's front edge.
 */
export function parametricWallInnerPlane(
  wall: NamedShellWall,
  widthMeters: number,
  depthMeters: number,
): number {
  const halfW = widthMeters / 2 - HALF_WALL;
  const floorZ = parametricShellFloorCenterZ(depthMeters);
  const backZ = floorZ - depthMeters / 2 + HALF_WALL;
  if (wall === "+x") return halfW - HALF_WALL;
  if (wall === "-x") return -halfW + HALF_WALL;
  if (wall === "-z") return backZ + HALF_WALL;
  return floorZ + depthMeters / 2;
}

/**
 * Cheap multi-mesh layout prop for residual non-architecture fixture slots
 * (monitor, laptop_desk, cart). Clinical surfaces (exam / overbed / work) are
 * architecture fixtures — see station-architecture-fixtures.ts (#207).
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

  // Explicit residual kinds — not open-ended "surface" matching (architecture owns those).
  const id = input.slotId.toLowerCase();
  const kind: "monitor_stand" | "laptop_desk" | "generic_cart" =
    id.includes("monitor") || id.includes("shelf")
      ? "monitor_stand"
      : id.includes("desk") || id.includes("laptop")
        ? "laptop_desk"
        : "generic_cart";

  if (kind === "monitor_stand") {
    const stand = new Mesh(new BoxGeometry(0.08, 1.1, 0.08), frame);
    stand.position.set(0, 0.55, 0);
    stand.name = `${root.name}.stand`;
    const panel = new Mesh(new BoxGeometry(0.42, 0.32, 0.05), accent);
    panel.position.set(0, 1.2, 0);
    panel.name = `${root.name}.panel`;
    root.add(stand, panel);
  } else if (kind === "laptop_desk") {
    const legs = new Mesh(new BoxGeometry(0.7, 0.72, 0.4), frame);
    legs.position.set(0, 0.36, 0);
    legs.name = `${root.name}.legs`;
    const top = new Mesh(new BoxGeometry(0.78, 0.04, 0.48), accent);
    top.position.set(0, 0.74, 0);
    top.name = `${root.name}.top`;
    root.add(legs, top);
  } else {
    // Generic cart / layout block (ecg_cart and similar residual ids)
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
  root.userData.openClinXrLayoutPropKind = kind;
  root.userData.openClinXrDynamicScenePolicy = "non_support_fixture_slot_builds_layout_prop_not_marker";
  return root;
}

/**
 * Prefer a compiled room GLB from encounter materialization when a URL + compile
 * node id are present. Otherwise keep the parametric box (fallback).
 */
export async function resolveStationEnvironment(
  input: BuildStationEnvironmentInput,
): Promise<Group> {
  const compiledUrl = input.compiledRoomAssetUrl?.trim() ?? "";
  const compileNodeId = input.compileNodeId?.trim() ?? "";
  if (hasCompiledRoomAssetUrl({ compiledRoomAssetUrl: compiledUrl, compileNodeId })) {
    return loadCompiledRoomShell({
      environmentId: input.environmentId,
      compiledRoomAssetUrl: compiledUrl,
      compileNodeId,
      ...(input.loadGltf ? { loadGltf: input.loadGltf } : {}),
    });
  }
  return buildStationEnvironment(input);
}

/**
 * Build a three.js Group for the encounter-side station shell (floor + walls + ceiling + fixtures).
 * userData records the requested environmentId, floor colour, room depth, and whether
 * an unknown id fell back to the generic shell.
 *
 * Parametric-only. Call `resolveStationEnvironment` when a compiled room asset URL may be present.
 */
export function buildStationEnvironment(input: BuildStationEnvironmentInput): Group {
  const resolved = resolveEnvironmentShellDescriptor(input.environmentId);
  const d = resolved.descriptor;

  // #194 harness may override shell dimensions without mutating the registry descriptor.
  const width = typeof input.roomWidthMeters === "number" ? input.roomWidthMeters : d.roomWidthMeters;
  const depth = typeof input.roomDepthMeters === "number" ? input.roomDepthMeters : d.roomDepthMeters;
  const height = typeof input.roomHeightMeters === "number" ? input.roomHeightMeters : d.roomHeightMeters;
  const dimensionOverridesActive =
    typeof input.roomWidthMeters === "number"
    || typeof input.roomDepthMeters === "number"
    || typeof input.roomHeightMeters === "number";

  const shell = new Group();
  shell.name = "openclinxr.station-environment-shell";
  shell.userData.environmentId = input.environmentId;
  shell.userData.environmentDescriptorId = d.environmentId;
  shell.userData.floorColor = d.floorColor;
  shell.userData.roomDepthMeters = depth;
  shell.userData.roomWidthMeters = width;
  shell.userData.roomHeightMeters = height;
  shell.userData.dimensionOverridesActive = dimensionOverridesActive;
  shell.userData.wallColor = d.wallColor;
  shell.userData.wallTrimColor = d.wallTrimColor;
  // #196: authored slot metres are relative to the descriptor plan; re-resolve so
  // door/board/furniture track shell width/depth under harness overrides (and stay
  // byte-identical at shipped dimensions — identity scale).
  const resolvedSlots = resolveFixtureSlotsForRoom(
    d.fixtureSlots,
    { widthMeters: width, depthMeters: depth, heightMeters: height },
    {
      widthMeters: d.roomWidthMeters,
      depthMeters: d.roomDepthMeters,
      heightMeters: d.roomHeightMeters,
    },
  );
  shell.userData.fixtureSlots = resolvedSlots.map((slot) => ({
    ...slot,
    position: { ...slot.position },
  }));
  // #203: per-slot rules — wall_anchor for door/board, fraction for furniture, absolute learner.
  shell.userData.fixtureLayoutDerivation = "per_slot:wall_anchor|fraction|absolute";
  shell.userData.environmentFallbackActive = resolved.environmentFallbackActive;
  shell.userData.environmentFallbackReason = resolved.environmentFallbackReason ?? "";
  shell.userData.openClinXrEnvironmentPolicy =
    "parametric_shell_from_shared_environment_descriptor_kitbash_slot";
  shell.userData.hasCeiling = true;
  // Place room so doorway (z≈0.9 exterior) opens into negative-Z encounter space.
  const floorZ = parametricShellFloorCenterZ(depth);

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

  const backZ = floorZ - depth / 2 + HALF_WALL;
  const sideZ = floorZ;
  const halfW = width / 2 - HALF_WALL;

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
  // Positions come from resolveFixtureSlotsForRoom (tracks shell under #196).
  // #186 / #209: family_seating also claims seating ownership so parent_chair /
  // chairs_equipment do not dual-mount beside FAMILY_CHAIR.
  shell.userData.fixtureOwnedRoles = [...ownedRolesFromFixtureSlots(resolvedSlots)];

  for (const slot of resolvedSlots) {
    const arch = tryBuildArchitectureFixture({
      slotId: slot.slotId,
      purpose: slot.purpose,
      position: slot.position,
      trimColor: d.wallTrimColor,
      // #342c: turn a wall-MOUNTED fixture to face its named wall before it is anchored.
      ...(slot.facesWall === true && slot.wall
        ? { rotationY: wallFacingYawRadians(slot.wall) }
        : {}),
    });
    if (arch) {
      // #342c: anchor by the assembly's NEAR FACE, not its origin. resolveFixtureSlotPosition
      // places the origin at `plane ∓ inset`, which leaves whatever the assembly extends
      // about that origin inside the wall — measured on main as 0.575 m for the board and
      // 0.100 m for the door, identically at every room width.
      if (slot.wall && fixturePlacementRule(slot) === "wall_anchor") {
        const plane = parametricWallInnerPlane(slot.wall, width, depth);
        const insetMeters = slot.wallInsetMeters ?? 0;
        anchorFixtureNearFaceToPlane({
          root: arch,
          wall: slot.wall,
          planeCoordinate: plane,
          insetMeters,
        });
        // #342c: carry the anchor contract on the fixture so a generated room loading LATER
        // can re-anchor it to ITS measured walls without re-deriving intent from the id.
        arch.userData.openClinXrWallAnchor = { wall: slot.wall, insetMeters };
      }
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
