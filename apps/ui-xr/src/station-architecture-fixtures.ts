/**
 * Parametric room-architecture fixtures (#186): door leaf, wall board, work surface.
 *
 * Same pattern as station-chair / station-stretcher — multi-mesh identity geometry
 * with plant tags. Not generic 1×1×1 boxes and not buildGenericClinicalEquipmentFallback.
 *
 * claimScope: shell identity dressing (door / board / counter) for environment shells.
 * notEvidenceFor: clinical furniture realism, kit-bashed rooms, Quest readiness.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
} from "three";
import { roleClassFromFixtureSlotId } from "./fixture-role-ownership.js";

export type BuildArchitectureFixtureInput = {
  slotId: string;
  purpose?: string;
  position: { x: number; y: number; z: number };
  trimColor: ColorRepresentation;
};

function mat(color: ColorRepresentation, roughness = 0.62, metalness = 0.08): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function tagArchitectureRoot(
  root: Group,
  input: BuildArchitectureFixtureInput,
  kind: "door_leaf" | "wall_board" | "work_surface" | "overbed_surface",
): void {
  root.userData.fixtureSlotId = input.slotId;
  root.userData.fixtureSlotPurpose = input.purpose ?? kind;
  root.userData.isMarkerCube = false;
  root.userData.openClinXrFixtureKind = kind;
  root.userData.openClinXrFixtureRole = roleClassFromFixtureSlotId(input.slotId);
  root.userData.openClinXrDynamicScenePolicy = "architecture_fixture_multi_mesh_identity";
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

/** Overbed table — inpatient / surgical identity surface (fourth kind). */
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

export function isDoorSlotId(slotId: string): boolean {
  return slotId.toLowerCase().includes("door");
}

export function isWallBoardSlotId(slotId: string): boolean {
  const id = slotId.toLowerCase();
  return id.includes("board") || id.includes("whiteboard");
}

export function isWorkSurfaceSlotId(slotId: string): boolean {
  const id = slotId.toLowerCase();
  return (
    id.includes("work_surface")
    || id.includes("counter")
    || (id.includes("surface") && !id.includes("exam_surface") && !id.includes("laptop"))
  );
}

export function isOverbedSurfaceSlotId(slotId: string): boolean {
  return slotId.toLowerCase().includes("overbed");
}

export function isExamSurfaceSlotId(slotId: string): boolean {
  const id = slotId.toLowerCase();
  return id.includes("exam_surface") || id === "exam_table";
}

/**
 * Dispatch architecture / identity fixture builders. Returns null when the slot is
 * not an architecture identity kind (caller continues to chair/stretcher/layout).
 */
export function tryBuildArchitectureFixture(input: BuildArchitectureFixtureInput): Group | null {
  if (isDoorSlotId(input.slotId)) return buildDoorLeafFixture(input);
  if (isWallBoardSlotId(input.slotId)) return buildWallBoardFixture(input);
  if (isOverbedSurfaceSlotId(input.slotId)) return buildOverbedSurfaceFixture(input);
  if (isWorkSurfaceSlotId(input.slotId) || isExamSurfaceSlotId(input.slotId)) {
    // exam_surface uses the work-surface silhouette with a longer top for bay identity
    if (isExamSurfaceSlotId(input.slotId)) {
      const desk = buildWorkSurfaceFixture(input);
      desk.userData.openClinXrFixtureKind = "work_surface";
      desk.userData.openClinXrExamSurface = true;
      return desk;
    }
    return buildWorkSurfaceFixture(input);
  }
  return null;
}
