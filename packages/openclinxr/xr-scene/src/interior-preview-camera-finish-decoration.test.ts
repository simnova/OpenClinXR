import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { roomInteriorAndHull } from "./interior-preview-camera.js";

/**
 * A full-span finish ceiling (edges exactly on the shell outer span) must not
 * pollute the INTERIOR measurement. Without the finish-decoration exclusion
 * it pins the interior union to the hull on every side, collapsing the
 * derived wall thickness toward zero.
 */

function shellRoom(): Group {
  const room = new Group();
  const interior = new Mesh(new BoxGeometry(6, 3, 6), new MeshStandardMaterial());
  interior.name = "interior_bounds";
  interior.position.y = 1.5;
  room.add(interior);
  const hull = new Mesh(new BoxGeometry(6.4, 3.4, 6.4), new MeshStandardMaterial());
  hull.name = "exterior";
  hull.position.y = 1.5;
  room.add(hull);
  return room;
}

function wallThicknessMeters(room: Group): number {
  const { interior, hull } = roomInteriorAndHull(room);
  if (interior === null || hull === null) throw new Error("expected measured interior and hull");
  return hull.max.z - interior.max.z;
}

describe("finish dressing does not collapse the interior-to-hull gap", () => {
  it("bare shell measures a 0.2 m wall thickness", () => {
    expect(wallThicknessMeters(shellRoom())).toBeCloseTo(0.2, 5);
  });

  it("a full-span tagged finish ceiling leaves the gap intact", () => {
    const room = shellRoom();
    const ceiling = new Mesh(new BoxGeometry(6.4, 0.05, 6.4), new MeshStandardMaterial());
    ceiling.name = "openclinxr_ceiling_field";
    ceiling.position.set(0, 2.4, 0);
    ceiling.userData["openClinXrFinishDecoration"] = true;
    room.add(ceiling);
    room.updateMatrixWorld(true);
    const { interior } = roomInteriorAndHull(room);
    if (interior === null) throw new Error("expected measured interior");
    expect(interior.max.z).toBeCloseTo(3.0, 5);
    expect(wallThicknessMeters(room)).toBeGreaterThan(0.1);
  });
});
