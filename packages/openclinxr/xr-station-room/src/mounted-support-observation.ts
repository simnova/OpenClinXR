import type { Object3D } from "three";

/**
 * What the runtime can SEE of the supports mounted in a station scene, right now.
 *
 * WHY THIS EXISTS. `supportedActorPlacementPosition` has taken `mountedSupportInstanceIds` since
 * the placement-provisionality card, and its refusal to substitute a different instance of the
 * same kind is written and tested. Nothing ever supplied the argument: `apps/ui-xr/src/main.ts:840`
 * called it with neither the required instance nor the observed set, so the readiness was
 * `not_required` for every supine patient and the refusal was unreachable. A correct helper the
 * live caller never calls is the class this package exists to close, and the missing half was
 * always this one — an observation of the actual scene.
 *
 * WHAT COUNTS AS A SUPPORT. A fixture root the environment shell mounted that declares a contact
 * surface: `deckTopYMeters` for a bed or stretcher, `seatHeightMeters` for a chair. Both are
 * written by the shipped builders (`station-stretcher.ts:191-192`, `station-chair.ts`), and a
 * layout prop that declares neither is not something a body can rest on. Reading the surface
 * rather than the slot NAME is deliberate: a room that renames its bed slot still mounts a deck.
 *
 * WHAT AN INSTANCE ID IS. `<environmentId>:<fixtureSlotId>` — the room that mounted it, then the
 * slot. A kind is not an instance: every ward and every ED bay mounts a slot called `stretcher`,
 * and putting a ward patient on the ED bay's bed because both are called "stretcher" is precisely
 * the substitution A04 forbids. The environment id comes from the nearest ancestor that declares
 * one, which is the shell root `buildStationEnvironment` stamps at station-environment.ts:224.
 */
export type MountedSupportInstance = {
  /** `<environmentId>:<fixtureSlotId>`. */
  supportInstanceId: string;
  environmentId: string;
  fixtureSlotId: string;
  /** Signed height of the contact surface in the fixture's own frame, when it declares one. */
  deckTopYMeters: number | null;
  /** Seat height for a chair, when it declares one. */
  seatHeightMeters: number | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The environment id of the nearest ancestor that declares one, or "" when none does. */
function environmentIdForFixture(fixture: Object3D): string {
  let node: Object3D | null = fixture;
  while (node) {
    const declared = (node.userData as Record<string, unknown>)["environmentId"];
    if (typeof declared === "string" && declared.length > 0) return declared;
    node = node.parent;
  }
  return "";
}

/**
 * Every support instance mounted under `root`, in traversal order.
 *
 * An empty result is a real answer — "nothing a body can rest on is in this scene yet" — and is
 * what keeps a placement pending during load rather than promoting it onto a support that has not
 * arrived. It is NOT the same as the caller declining to observe, which is why
 * `supportedActorPlacementPosition` distinguishes an absent argument from an empty one.
 */
export function observeMountedSupportInstances(root: Object3D): MountedSupportInstance[] {
  const found: MountedSupportInstance[] = [];
  const seen = new Set<string>();
  root.traverse((node) => {
    const data = node.userData as Record<string, unknown>;
    const fixtureSlotId = data["fixtureSlotId"];
    if (typeof fixtureSlotId !== "string" || fixtureSlotId.length === 0) return;
    const deckTopYMeters = numberOrNull(data["deckTopYMeters"]);
    const seatHeightMeters = numberOrNull(data["seatHeightMeters"]);
    if (deckTopYMeters === null && seatHeightMeters === null) return;
    const environmentId = environmentIdForFixture(node);
    const supportInstanceId = `${environmentId}:${fixtureSlotId}`;
    if (seen.has(supportInstanceId)) return;
    seen.add(supportInstanceId);
    found.push({ supportInstanceId, environmentId, fixtureSlotId, deckTopYMeters, seatHeightMeters });
  });
  return found;
}
