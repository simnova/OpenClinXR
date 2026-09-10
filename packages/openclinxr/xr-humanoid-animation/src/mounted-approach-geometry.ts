import type {
  ObservedApproachGeometry,
  ObservedFloorFrame,
} from "@openclinxr/asset-registry/case-approach-intent";
import { Box3, type Object3D, Vector3 as ThreeVector3 } from "three";

/**
 * What the runtime can SEE of the geometry an approach has to respect, right now.
 *
 * The sibling of `mounted-support-observation.ts`, and it exists for the same reason: the approach
 * planner has accepted a `MeasuredObstacle[]` since it was written and nothing ever measured one. A
 * route checked against an empty list is a route nobody checked, and `acceptance-v2.md` says so in
 * as many words — "Do not claim a route clear from empty obstacle input."
 *
 * WHAT COUNTS AS AN OBSTACLE. A fixture root the environment shell mounted, taken at its actual
 * world `Box3`. MARKER CUBES ARE EXCLUDED and the exclusion is not cosmetic: `learner_start` is a
 * 0.18 x 0.06 x 0.18 m pad on the floor that a body walks over, and calling it a blockage would get
 * the check disbelieved on the first real route. The bed IS included — a clinician must not walk
 * through it either — and its own instance is what the destination standoff is measured from.
 *
 * WHAT COUNTS AS THE FLOOR FRAME. The shell's floor mesh, which `buildStationEnvironment` stamps
 * with the environment id. Its frame id is `<environmentId>:floor` — a kind is not an instance here
 * either — and its plane is the TOP of that mesh, because a slab has thickness and a body stands on
 * top of it. `originXz` is the SHELL ROOT's world XZ, not the slab centroid: the room's fixtures are
 * placed in the shell root's frame, so an authored standing offset composes against the same frame
 * the case author was looking at.
 *
 * claimScope: world bounds of the fixtures actually in one scene graph at one moment.
 * notEvidenceFor: that the room is complete, that a route is safe, or that anything ran.
 */

type Vector3 = { x: number; y: number; z: number };
type WorldAabb = { min: Vector3; max: Vector3 };

export type MountedApproachGeometry = ObservedApproachGeometry & {
  /** Every fixture slot skipped, with why, so a short obstacle list is legible rather than blank. */
  excludedFixtureSlotIds: Array<{ fixtureSlotId: string; reason: string }>;
};

const EMPTY_BOUNDS: WorldAabb = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };

function worldAabb(node: Object3D): WorldAabb {
  const box = new Box3().setFromObject(node);
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  };
}

function environmentIdForNode(node: Object3D): string {
  let current: Object3D | null = node;
  while (current) {
    const declared = (current.userData as Record<string, unknown>)["environmentId"];
    if (typeof declared === "string" && declared.length > 0) return declared;
    current = current.parent;
  }
  return "";
}

/** True for the shell's floor slab: it declares the environment and its own floor policy. */
function isFloorSlab(data: Record<string, unknown>): boolean {
  return (
    typeof data["environmentId"] === "string"
    && String(data["openClinXrSceneNecessityPolicy"] ?? "").includes("floor")
  );
}

/**
 * Observe the floor frame, the named support and every mounted obstacle under `root`.
 *
 * `supportInstanceId` names the instance the approach measures its standoff from. A support that is
 * not in the scene leaves `supportBounds` at zero extent with its id unchanged, so the caller sees
 * "named but not mounted" rather than a silently substituted box.
 */
export function observeMountedApproachGeometry(
  root: Object3D,
  input: { supportInstanceId: string },
): MountedApproachGeometry {
  root.updateMatrixWorld(true);
  const obstacles: Array<{ id: string; bounds: WorldAabb }> = [];
  const excludedFixtureSlotIds: Array<{ fixtureSlotId: string; reason: string }> = [];
  const seen = new Set<string>();
  let floorFrame: ObservedFloorFrame | null = null;
  let supportBounds: WorldAabb = EMPTY_BOUNDS;
  let monitorBounds: WorldAabb | null = null;
  let monitorInstanceId: string | null = null;
  let roomCentre: Vector3 = { x: 0, y: 0, z: 0 };

  root.traverse((node) => {
    const data = node.userData as Record<string, unknown>;
    if (floorFrame === null && isFloorSlab(data)) {
      const bounds = worldAabb(node);
      const shellRoot = node.parent ?? node;
      const origin = shellRoot.getWorldPosition(new ThreeVector3());
      floorFrame = {
        frameId: `${String(data["environmentId"])}:floor`,
        originY: bounds.max.y,
        originXz: { x: origin.x, z: origin.z },
        normal: { x: 0, y: 1, z: 0 },
      };
      roomCentre = {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: bounds.max.y,
        z: (bounds.min.z + bounds.max.z) / 2,
      };
      return;
    }
    const fixtureSlotId = data["fixtureSlotId"];
    if (typeof fixtureSlotId !== "string" || fixtureSlotId.length === 0) return;
    const instanceId = `${environmentIdForNode(node)}:${fixtureSlotId}`;
    if (seen.has(instanceId)) return;
    seen.add(instanceId);
    const bounds = worldAabb(node);
    if (instanceId === input.supportInstanceId) supportBounds = bounds;
    // The clinical wall board is the display this encounter's monitor-view check reads. It is
    // found by its own declared PURPOSE, not by a name match on the word "monitor".
    const purpose = String(data["fixtureSlotPurpose"] ?? "");
    if (monitorBounds === null && /board|monitor|screen|display/iu.test(purpose)) {
      monitorBounds = bounds;
      monitorInstanceId = instanceId;
    }
    if (data["isMarkerCube"] === true) {
      excludedFixtureSlotIds.push({
        fixtureSlotId,
        reason: "marker cube: a floor pad a body walks over, not something it walks into",
      });
      return;
    }
    obstacles.push({ id: instanceId, bounds });
  });

  return {
    floorFrame,
    supportInstanceId: input.supportInstanceId,
    supportBounds,
    obstacles,
    monitorBounds,
    monitorInstanceId,
    roomCentre,
    excludedFixtureSlotIds,
  };
}
