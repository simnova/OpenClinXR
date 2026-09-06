/**
 * Parametric room-architecture fixtures (#186 / #207): door, board, work surface,
 * overbed table, exam table.
 *
 * Same pattern as station-chair / station-stretcher — multi-mesh identity geometry
 * with plant tags. Not generic 1×1×1 boxes and not buildGenericClinicalEquipmentFallback.
 *
 * #207: exam_surface is a full-length exam table (EXAM_TABLE_LENGTH_M), not a desk.
 * Geometry is pure fixture builders on the descriptor path — never equipment kinds
 * (would dual-place with the mount planner; #133 double-bed class).
 *
 * claimScope: shell identity dressing (door / board / counter / exam table) for shells.
 * notEvidenceFor: clinical furniture realism, kit-bashed rooms, Quest readiness.
 */

import {
  Box3,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
  type Object3D,
} from "three";
import type { NamedShellWall } from "@openclinxr/asset-registry/fixture-wall-mounting";
import { roleClassFromFixtureSlotId } from "./fixture-role-ownership.js";
import { EXAM_TABLE_LENGTH_M } from "./station-equipment-builders.js";

export type BuildArchitectureFixtureInput = {
  slotId: string;
  purpose?: string;
  position: { x: number; y: number; z: number };
  trimColor: ColorRepresentation;
  /**
   * #342c — yaw applied to the assembled root so a wall-mounted fixture FACES its named
   * wall. Every architecture builder authors its geometry facing +Z (width along X, thin
   * along Z); nothing ever turned it, so a slot declaring `wall: "-x"` produced a panel
   * lying ACROSS the left wall rather than against it. Supplied by the caller from the
   * slot's `wall`, never inferred from sign(x) — #203 rejected that.
   */
  rotationY?: number;
};

export type ArchitectureFixtureKind =
  | "door_leaf"
  | "wall_board"
  | "work_surface"
  | "overbed_surface"
  | "exam_surface";

function mat(color: ColorRepresentation, roughness = 0.62, metalness = 0.08): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function tagArchitectureRoot(
  root: Group,
  input: BuildArchitectureFixtureInput,
  kind: ArchitectureFixtureKind,
): void {
  root.userData.fixtureSlotId = input.slotId;
  root.userData.fixtureSlotPurpose = input.purpose ?? kind;
  root.userData.isMarkerCube = false;
  root.userData.openClinXrFixtureKind = kind;
  root.userData.openClinXrFixtureRole = roleClassFromFixtureSlotId(input.slotId);
  root.userData.openClinXrDynamicScenePolicy = "architecture_fixture_multi_mesh_identity";
  if (typeof input.rotationY === "number" && Number.isFinite(input.rotationY)) {
    root.rotation.y = input.rotationY;
    root.userData.openClinXrWallFacingYaw = input.rotationY;
  }
}

/**
 * #342c — slide a fixture along its wall's NORMAL so its nearest face sits `insetMeters`
 * from the wall's inner plane.
 *
 * This is the anchoring the `wallInsetMeters` doc already describes ("fixed metres from
 * the named wall plane into the room ... so the gap does not grow with the room") but that
 * `resolveWallAnchorPosition` could not deliver, because it positions the fixture's ORIGIN
 * and a multi-mesh assembly's extent about that origin is not zero. Measured on main: the
 * board's origin lands exactly on the wall's inner face while 0.575 m of frame continues
 * THROUGH it, and the door's assembly crosses by 0.100 m — identically in all 14
 * environments, because `halfExtent - inset` contains no room dimension.
 *
 * The offset is read from the fixture's own world AABB after it is built, so it needs no
 * per-fixture constant and stays correct if a builder's geometry changes. `planeCoordinate`
 * is the wall's inner face in world units — measured from the room that is actually
 * present (generated or parametric), never a room-width constant.
 *
 * Returns the metres moved, so a caller can record it as evidence rather than assume.
 */
export function anchorFixtureNearFaceToPlane(input: {
  root: Object3D;
  wall: NamedShellWall;
  planeCoordinate: number;
  insetMeters: number;
}): number {
  const { root, wall, planeCoordinate, insetMeters } = input;
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  if (box.isEmpty() || !Number.isFinite(box.min.x)) return 0;
  const axis: "x" | "z" = wall === "+x" || wall === "-x" ? "x" : "z";
  // Interior lies at greater coordinate for the -x / -z walls, lesser for +x / +z.
  const interiorIsGreater = wall === "-x" || wall === "-z";
  const nearFace = interiorIsGreater ? box.min[axis] : box.max[axis];
  const target = interiorIsGreater ? planeCoordinate + insetMeters : planeCoordinate - insetMeters;
  const delta = target - nearFace;
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-6) return 0;
  root.position[axis] += delta;
  root.updateMatrixWorld(true);
  return delta;
}

/** Solid door leaf at the open front of the shell (learner entry). */
export function buildDoorLeafFixture(input: BuildArchitectureFixtureInput): Group {
  const root = new Group();
  root.name = `openclinxr.station-environment.fixture-slot.${input.slotId}`;
  root.position.set(input.position.x, 0, input.position.z);

  const frameMat = mat(0x5c6570, 0.7, 0.12);
  const leafMat = mat(input.trimColor, 0.55, 0.06);
  const handleMat = mat(0xc0c8d0, 0.35, 0.55);

  const jambL = new Mesh(new BoxGeometry(0.08, 2.05, 0.1), frameMat);
  jambL.name = `${root.name}.jamb.left`;
  jambL.position.set(-0.48, 1.02, 0);
  const jambR = new Mesh(new BoxGeometry(0.08, 2.05, 0.1), frameMat.clone());
  jambR.name = `${root.name}.jamb.right`;
  jambR.position.set(0.48, 1.02, 0);
  const header = new Mesh(new BoxGeometry(1.04, 0.1, 0.1), frameMat.clone());
  header.name = `${root.name}.header`;
  header.position.set(0, 2.08, 0);
  const leaf = new Mesh(new BoxGeometry(0.88, 1.95, 0.05), leafMat);
  leaf.name = `${root.name}.leaf`;
  leaf.position.set(0, 0.98, 0.02);
  const handle = new Mesh(new CylinderGeometry(0.025, 0.025, 0.12, 10), handleMat);
  handle.name = `${root.name}.handle`;
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.32, 1.0, 0.08);

  root.add(jambL, jambR, header, leaf, handle);
  tagArchitectureRoot(root, input, "door_leaf");
  return root;
}

/** Wall-mounted clinical board (not a 1×1×1 prop cube). */
export function buildWallBoardFixture(input: BuildArchitectureFixtureInput): Group {
  const root = new Group();
  root.name = `openclinxr.station-environment.fixture-slot.${input.slotId}`;
  // Y from descriptor is board center height when provided; default ~1.4 m.
  const boardY = input.position.y > 0.3 ? input.position.y : 1.4;
  root.position.set(input.position.x, 0, input.position.z);

  const frameMat = mat(0x3d4450, 0.55, 0.15);
  const surfaceMat = mat(0xf4f8f2, 0.75, 0.02);
  const accentMat = mat(input.trimColor, 0.5, 0.08);

  const frame = new Mesh(new BoxGeometry(1.15, 0.72, 0.04), frameMat);
  frame.name = `${root.name}.frame`;
  frame.position.set(0, boardY, 0);
  const surface = new Mesh(new BoxGeometry(1.05, 0.62, 0.02), surfaceMat);
  surface.name = `${root.name}.surface`;
  surface.position.set(0, boardY, 0.03);
  const rail = new Mesh(new BoxGeometry(0.7, 0.03, 0.05), accentMat);
  rail.name = `${root.name}.marker_rail`;
  rail.position.set(0, boardY - 0.3, 0.05);
  const tray = new Mesh(new BoxGeometry(0.55, 0.04, 0.1), frameMat.clone());
  tray.name = `${root.name}.tray`;
  tray.position.set(0, boardY - 0.42, 0.06);

  root.add(frame, surface, rail, tray);
  tagArchitectureRoot(root, input, "wall_board");
  return root;
}

/** Floor-standing work counter / desk (work_surface vocabulary). */
export function buildWorkSurfaceFixture(input: BuildArchitectureFixtureInput): Group {
  const root = new Group();
  root.name = `openclinxr.station-environment.fixture-slot.${input.slotId}`;
  root.position.set(input.position.x, 0, input.position.z);

  const bodyMat = mat(0x8b939c, 0.62, 0.12);
  const topMat = mat(input.trimColor, 0.55, 0.06);

  const legs = new Mesh(new BoxGeometry(1.05, 0.78, 0.42), bodyMat);
  legs.name = `${root.name}.base`;
  legs.position.set(0, 0.39, 0);
  const top = new Mesh(new BoxGeometry(1.15, 0.045, 0.5), topMat);
  top.name = `${root.name}.top`;
  top.position.set(0, 0.8, 0);
  const backsplash = new Mesh(new BoxGeometry(1.1, 0.22, 0.04), bodyMat.clone());
  backsplash.name = `${root.name}.backsplash`;
  backsplash.position.set(0, 0.93, -0.2);
  const drawer = new Mesh(new BoxGeometry(0.35, 0.12, 0.38), mat(0x6b7280, 0.6, 0.1));
  drawer.name = `${root.name}.drawer`;
  drawer.position.set(-0.28, 0.45, 0.02);

  root.add(legs, top, backsplash, drawer);
  tagArchitectureRoot(root, input, "work_surface");
  root.userData.workSurfaceHeightMeters = 0.8;
  return root;
}

/** Overbed table — inpatient / surgical identity surface (mobile tray on a column). */
export function buildOverbedSurfaceFixture(input: BuildArchitectureFixtureInput): Group {
  const root = new Group();
  root.name = `openclinxr.station-environment.fixture-slot.${input.slotId}`;
  root.position.set(input.position.x, 0, input.position.z);

  const metal = mat(0x9aa3ad, 0.45, 0.35);
  const topMat = mat(input.trimColor, 0.55, 0.08);

  const column = new Mesh(new CylinderGeometry(0.04, 0.05, 0.95, 10), metal);
  column.name = `${root.name}.column`;
  column.position.set(0, 0.48, 0);
  const base = new Mesh(new BoxGeometry(0.45, 0.04, 0.35), metal.clone());
  base.name = `${root.name}.base`;
  base.position.set(0, 0.02, 0);
  const top = new Mesh(new BoxGeometry(0.55, 0.035, 0.35), topMat);
  top.name = `${root.name}.top`;
  top.position.set(0, 0.98, 0);

  root.add(column, base, top);
  tagArchitectureRoot(root, input, "overbed_surface");
  root.userData.workSurfaceHeightMeters = 0.98;
  return root;
}

/**
 * Exam table fixture — reuses EXAM_TABLE_LENGTH_M (1.85 m) from equipment builders for
 * size identity, but remains a fixture root (fixtureSlotId / openClinXrFixtureKind).
 * Does NOT emit equipment userData or equipment kinds (mount planner must not place it).
 *
 * Orientation (unlocked decision): long axis on local **Z** (room depth). Equipment's
 * buildExamTableEquipment uses length on X for mount-planner placement; the clinic bay
 * co-declares family_chair on −X, so a 1.85 m X-span collides the chair. Depth-axis
 * length keeps half-width ~0.36 m and clears the chair without shrinking the table.
 */
export function buildExamSurfaceFixture(input: BuildArchitectureFixtureInput): Group {
  const root = new Group();
  root.name = `openclinxr.station-environment.fixture-slot.${input.slotId}`;
  root.position.set(input.position.x, 0, input.position.z);

  const frame = mat(0x6b7280, 0.5, 0.25);
  const mattressMat = mat(0xd1d5db, 0.75, 0.02);
  const pillowMat = mat(0xf3f4f6, 0.8, 0);
  const railMat = mat(input.trimColor, 0.45, 0.35);

  // Length on Z, width on X — see orientation note above.
  const base = new Mesh(new BoxGeometry(0.62, 0.12, EXAM_TABLE_LENGTH_M * 0.9), frame);
  base.name = `${root.name}.base`;
  base.position.set(0, 0.35, 0);
  const mattress = new Mesh(new BoxGeometry(0.7, 0.1, EXAM_TABLE_LENGTH_M), mattressMat);
  mattress.name = `${root.name}.mattress`;
  mattress.position.set(0, 0.5, 0);
  const pillow = new Mesh(new BoxGeometry(0.4, 0.08, 0.28), pillowMat);
  pillow.name = `${root.name}.pillow`;
  pillow.position.set(0, 0.58, -EXAM_TABLE_LENGTH_M * 0.35);
  const rail = new Mesh(new BoxGeometry(0.03, 0.04, EXAM_TABLE_LENGTH_M * 0.7), railMat);
  rail.name = `${root.name}.rail`;
  rail.position.set(0.36, 0.62, 0);
  // Pedestal feet — multi-mesh identity (not a single slab).
  const legHead = new Mesh(new BoxGeometry(0.5, 0.28, 0.12), frame.clone());
  legHead.name = `${root.name}.leg.head`;
  legHead.position.set(0, 0.14, -EXAM_TABLE_LENGTH_M * 0.32);
  const legFoot = new Mesh(new BoxGeometry(0.5, 0.28, 0.12), frame.clone());
  legFoot.name = `${root.name}.leg.foot`;
  legFoot.position.set(0, 0.14, EXAM_TABLE_LENGTH_M * 0.32);

  root.add(base, mattress, pillow, rail, legHead, legFoot);
  tagArchitectureRoot(root, input, "exam_surface");
  // Deck top for any future plant/clearance reader — mattress top ≈ 0.55 m.
  root.userData.deckTopYMeters = 0.55;
  root.userData.workSurfaceHeightMeters = 0.55;
  root.userData.openClinXrExamSurface = true;
  root.userData.openClinXrExamTableLengthM = EXAM_TABLE_LENGTH_M;
  root.userData.openClinXrExamTableLongAxis = "z";
  return root;
}

export function isDoorSlotId(slotId: string): boolean {
  const id = slotId.toLowerCase();
  return id === "door_leaf" || id.startsWith("door_");
}

export function isWallBoardSlotId(slotId: string): boolean {
  const id = slotId.toLowerCase();
  return id === "wall_board" || id.includes("whiteboard") || id.endsWith("_board");
}

export function isWorkSurfaceSlotId(slotId: string): boolean {
  const id = slotId.toLowerCase();
  // Explicit ids only — do not match exam_surface / overbed_surface via "surface" substring.
  // laptop_desk stays a layout prop (telehealth dual-desk avoid — environment-descriptors).
  return id === "work_surface" || id.includes("counter");
}

export function isOverbedSurfaceSlotId(slotId: string): boolean {
  const id = slotId.toLowerCase();
  return id === "overbed_surface" || id.includes("overbed");
}

export function isExamSurfaceSlotId(slotId: string): boolean {
  const id = slotId.toLowerCase();
  return id === "exam_surface" || id === "exam_table";
}

/**
 * Explicit slot-id → architecture kind map (preferred over open-ended substring match).
 * Unknown / unlisted ids fall through to the predicate helpers below.
 */
const ARCHITECTURE_SLOT_KIND: Readonly<Record<string, ArchitectureFixtureKind>> = {
  door_leaf: "door_leaf",
  wall_board: "wall_board",
  work_surface: "work_surface",
  overbed_surface: "overbed_surface",
  exam_surface: "exam_surface",
};

function buildByKind(kind: ArchitectureFixtureKind, input: BuildArchitectureFixtureInput): Group {
  switch (kind) {
    case "door_leaf":
      return buildDoorLeafFixture(input);
    case "wall_board":
      return buildWallBoardFixture(input);
    case "work_surface":
      return buildWorkSurfaceFixture(input);
    case "overbed_surface":
      return buildOverbedSurfaceFixture(input);
    case "exam_surface":
      return buildExamSurfaceFixture(input);
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Dispatch architecture / identity fixture builders. Returns null when the slot is
 * not an architecture identity kind (caller continues to chair/stretcher/layout).
 *
 * #207: explicit map first; predicates only for legacy/alias ids not in the bank map.
 */
export function tryBuildArchitectureFixture(input: BuildArchitectureFixtureInput): Group | null {
  const mapped = ARCHITECTURE_SLOT_KIND[input.slotId.toLowerCase()];
  if (mapped) return buildByKind(mapped, input);

  if (isDoorSlotId(input.slotId)) return buildDoorLeafFixture(input);
  if (isWallBoardSlotId(input.slotId)) return buildWallBoardFixture(input);
  if (isExamSurfaceSlotId(input.slotId)) return buildExamSurfaceFixture(input);
  if (isOverbedSurfaceSlotId(input.slotId)) return buildOverbedSurfaceFixture(input);
  if (isWorkSurfaceSlotId(input.slotId)) return buildWorkSurfaceFixture(input);
  return null;
}
