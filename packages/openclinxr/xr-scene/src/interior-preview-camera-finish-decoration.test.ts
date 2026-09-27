import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { deriveInteriorPreviewCamera } from "./index.js";

/**
 * A full-span finish ceiling (edges exactly on the shell outer span) must not
 * pollute the INTERIOR measurement. Without the finish-decoration exclusion
 * it pins the interior union to the hull on every side, collapsing the
 * derived wall thickness toward zero and pushing the preview eye out.
 *
 * Routed through the public entrypoint (deriveInteriorPreviewCamera), which
 * measures via roomInteriorAndHull internally.
 */

const ACTORS = [{ min: [-0.4, 0, -1] as const, max: [0.4, 1.8, -0.5] as const }];

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

describe("finish dressing does not collapse the interior-to-hull gap", () => {
  it("bare shell measures a 0.2 m wall thickness", () => {
    const result = deriveInteriorPreviewCamera({ roomRoot: shellRoom(), actorWorldBoxes: ACTORS });
    expect(result).not.toBeNull();
    expect(result!.wallThicknessMeters).toBeCloseTo(0.2, 5);
  });

  it("a full-span tagged finish ceiling leaves the camera measurement intact", () => {
    const room = shellRoom();
    const ceiling = new Mesh(new BoxGeometry(6.4, 0.05, 6.4), new MeshStandardMaterial());
    ceiling.name = "openclinxr_ceiling_field";
    ceiling.position.set(0, 2.4, 0);
    ceiling.userData["openClinXrFinishDecoration"] = true;
    room.add(ceiling);
    room.updateMatrixWorld(true);
    const result = deriveInteriorPreviewCamera({ roomRoot: room, actorWorldBoxes: ACTORS });
    expect(result).not.toBeNull();
    expect(result!.wallThicknessMeters).toBeGreaterThan(0.1);
    const bare = deriveInteriorPreviewCamera({ roomRoot: shellRoom(), actorWorldBoxes: ACTORS });
    expect(result!.wallThicknessMeters).toBeCloseTo(bare!.wallThicknessMeters, 5);
    expect(result!.eye.toArray()).toEqual(bare!.eye.toArray());
  });
});
