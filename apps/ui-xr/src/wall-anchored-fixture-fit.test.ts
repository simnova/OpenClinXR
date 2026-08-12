/**
 * #342c — a wall_anchor fixture must lie flat AGAINST its named wall, not across it.
 *
 * THE DEFECT, MEASURED (immutable — flip the assertion, append below, do not rewrite
 * these paths or numbers).
 *
 * The slice was filed on the premise that fixtures are placed for the old 7 m parametric
 * box and would fit once placement tracked the generated room's smaller bounds. That
 * premise is HALF FALSE, and the measurement is what says so:
 *
 *   resolveWallAnchorPosition (environment-zone-templates.ts:252-295) places a wall_anchor
 *   slot at `x = ±roomHalfW ∓ wallInsetMeters`. For ed_exam_bay_v1 (roomWidthMeters 7,
 *   environment-descriptors.ts:140) that is:
 *
 *     wall_board  wall "-x", inset 0.08  ->  root x = -3.5 + 0.08 = -3.42
 *     door_leaf   wall "+x", inset 0.50  ->  root x =  3.5 - 0.50 =  3.00
 *
 *   The parametric side walls are 0.08-thick boxes centred at ±(width/2 - 0.04) = ±3.46
 *   (station-environment.ts:210,218-228), so their INNER faces are at ±3.42 — exactly the
 *   board's root. The root is meant to sit ON the wall surface.
 *
 *   But NEITHER builder ever rotates. buildWallBoardFixture (station-architecture-fixtures.ts
 *   :91-118) builds a frame BoxGeometry(1.15, 0.72, 0.04) — 1.15 m wide along X, 0.04 m thin
 *   along Z — i.e. a panel whose normal is ±Z. buildDoorLeafFixture (:59-88) is the same
 *   shape: 1.04 m of header along X, 0.1 m thin along Z. Both are then anchored to an ±X
 *   wall and left unrotated, so their WIDTH runs into the wall instead of along it:
 *
 *     wall_board.frame   world x -3.995 .. -2.845   penetrates the -3.42 inner face by 0.575 m
 *                                                   and exits the -3.50 outer face by 0.495 m
 *     door_leaf.jamb.right / .header   world x max 3.52   past the 3.42 inner face by 0.10 m
 *
 * THE CONSEQUENCE THAT KILLS THE FILED PLAN: the overhang past the anchor plane is
 * `halfExtentAlongWallNormal - wallInsetMeters`, which contains NO room dimension. It is
 * 0.495 m for the board at EVERY room width. Feeding the generated room's measured width
 * (6.376 m -> roomHalfW 3.188 -> root -3.108 -> frame min -3.683) still leaves it 0.56 m
 * outside. Scaling the room cannot fix this; only orienting the fixture can.
 *
 * So this contract asserts the property that IS width-independent: a wall_anchor fixture's
 * world AABB must not cross its named wall's inner plane. It fails today on the SHIPPED
 * parametric box — before any generated room is involved — which is the evidence that the
 * defect was never about the Infinigen bake being smaller.
 *
 * claimScope: world-AABB containment of wall_anchor fixture meshes against the parametric
 * shell's own measured wall planes, for the environments enumerated from the registry.
 * notEvidenceFor: appearance, clinical realism, the generated room (measured separately by
 * the live scene-graph dump), fraction-placed furniture, actors.
 */

import { ENVIRONMENT_SHELL_DESCRIPTORS } from "@openclinxr/asset-registry";
import {
  fixturePlacementRule,
  resolveFixtureSlotPosition,
} from "@openclinxr/asset-registry/environment-zone-templates";
import type { NamedShellWall } from "@openclinxr/asset-registry/fixture-wall-mounting";
import { Box3, type Group, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import {
  buildStationEnvironment,
  parametricWallInnerPlane,
} from "./station-environment.js";

type WallAnchoredSlot = { slotId: string; wall: NamedShellWall };

function wallAnchoredSlotsFor(environmentId: string): WallAnchoredSlot[] {
  const descriptor = ENVIRONMENT_SHELL_DESCRIPTORS[environmentId];
  if (!descriptor) return [];
  const out: WallAnchoredSlot[] = [];
  for (const slot of descriptor.fixtureSlots) {
    if (fixturePlacementRule(slot) !== "wall_anchor") continue;
    if (!slot.wall) continue;
    out.push({ slotId: slot.slotId, wall: slot.wall });
  }
  return out;
}

function findFixtureRoot(shell: Group, slotId: string): Object3D | null {
  let found: Object3D | null = null;
  shell.traverse((obj: Object3D) => {
    if (found) return;
    if (obj.userData?.fixtureSlotId === slotId && obj.userData?.isMarkerCube === false) found = obj;
  });
  return found;
}

/** Metres the fixture's world AABB crosses the wall's inner plane. <= 0 means it clears. */
function penetrationMetres(
  root: Object3D,
  wall: NamedShellWall,
  widthMeters: number,
  depthMeters: number,
): number {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const plane = parametricWallInnerPlane(wall, widthMeters, depthMeters);
  const axis: "x" | "z" = wall === "+x" || wall === "-x" ? "x" : "z";
  // Interior lies at greater coordinate for -x / -z, so the fixture's MIN must not go below the plane.
  const interiorIsGreater = wall === "-x" || wall === "-z";
  const edge = interiorIsGreater ? box.min[axis] : box.max[axis];
  return interiorIsGreater ? plane - edge : edge - plane;
}

/** Enumerated from the registry, not listed — a new bay must satisfy this too. */
const ENVIRONMENTS_WITH_WALL_ANCHORS = Object.keys(ENVIRONMENT_SHELL_DESCRIPTORS).filter(
  (id) => wallAnchoredSlotsFor(id).length > 0,
);

describe("#342c wall-anchored fixtures lie against their named wall", () => {
  it("has wall-anchored slots to measure in more than one environment", () => {
    expect(ENVIRONMENTS_WITH_WALL_ANCHORS.length).toBeGreaterThan(1);
  });

  it("no wall_anchor fixture crosses its named wall's inner plane", () => {
    const offenders: string[] = [];
    for (const environmentId of ENVIRONMENTS_WITH_WALL_ANCHORS) {
      const descriptor = ENVIRONMENT_SHELL_DESCRIPTORS[environmentId];
      if (!descriptor) continue;
      const shell = buildStationEnvironment({ environmentId });
      for (const slot of wallAnchoredSlotsFor(environmentId)) {
        const root = findFixtureRoot(shell, slot.slotId);
        if (!root) continue;
        const over = penetrationMetres(
          root,
          slot.wall,
          descriptor.roomWidthMeters,
          descriptor.roomDepthMeters,
        );
        if (over > 0.001) {
          offenders.push(`${environmentId}/${slot.slotId} wall ${slot.wall} crosses by ${over.toFixed(3)} m`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Counterweight, and it is ORIENTATION-SPECIFIC on purpose.
   *
   * An earlier version of this test measured `max(xSpan, zSpan) > 1.1`, which is blind to
   * which axis the board lies on — so a DESTRUCTIVE PROBE that disabled the wall-facing
   * rotation still passed 4/4. Near-face anchoring alone satisfies "does not cross the
   * plane" by sliding an unrotated, Z-normal panel 1.15 m out into the room: in bounds, and
   * a board floating edge-on in mid-air. The quantity was bounded and the SHAPE was free.
   *
   * So the two axes are asserted separately: along the wall the board keeps its full
   * authored width, and along the wall's NORMAL it must be thin, which is only true if it
   * has actually been turned to face the room.
   */
  it("mounts the board flat on the wall: full width along it, thin across it", () => {
    const environmentId = "ed_exam_bay_v1";
    const descriptor = ENVIRONMENT_SHELL_DESCRIPTORS[environmentId];
    expect(descriptor).toBeDefined();
    if (!descriptor) return;
    const shell = buildStationEnvironment({ environmentId });
    const root = findFixtureRoot(shell, "wall_board");
    expect(root).not.toBeNull();
    if (!root) return;
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    // The board hangs on a -X wall, so Z runs ALONG it and X runs ACROSS it.
    const alongWall = box.max.z - box.min.z;
    const acrossWall = box.max.x - box.min.x;
    expect(alongWall).toBeGreaterThan(1.1); // full authored 1.15 m frame survives
    expect(acrossWall).toBeLessThan(0.2); // a panel, not a slab poking into the room
    // And it must still be mounted: no further from the -X inner face than a shallow cabinet.
    const plane = parametricWallInnerPlane("-x", descriptor.roomWidthMeters, descriptor.roomDepthMeters);
    expect(box.min.x - plane).toBeLessThan(0.25);
  });

  /**
   * The width-independence that killed the filed plan, asserted directly: resolving the
   * SAME slot into a much smaller room must not change how far the fixture sits from its
   * wall. If someone "fixes" fit by scaling the room, this stays green and the assertion
   * above stays red — which is the point.
   */
  it("anchors at the same distance from the wall in a small room as a large one", () => {
    const descriptor = ENVIRONMENT_SHELL_DESCRIPTORS.ed_exam_bay_v1;
    expect(descriptor).toBeDefined();
    if (!descriptor) return;
    const board = descriptor.fixtureSlots.find((s) => s.slotId === "wall_board");
    expect(board).toBeDefined();
    if (!board) return;
    const authoredFor = {
      widthMeters: descriptor.roomWidthMeters,
      depthMeters: descriptor.roomDepthMeters,
    };
    const big = resolveFixtureSlotPosition(board, { widthMeters: 7, depthMeters: 3.45 }, authoredFor);
    const small = resolveFixtureSlotPosition(board, { widthMeters: 5.5, depthMeters: 3.5 }, authoredFor);
    const gapBig = big.x - -(7 / 2);
    const gapSmall = small.x - -(5.5 / 2);
    expect(Math.abs(gapBig - gapSmall)).toBeLessThan(1e-9);
  });
});
