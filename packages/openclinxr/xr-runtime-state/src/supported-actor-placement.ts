import {
  composeSupportedActorWorldPosition,
  resolveEnvironmentShellDescriptor,
  seatedActorWorldPosition,
  supineActorWorldPosition,
} from "@openclinxr/asset-registry";
// #196 pattern: subpath avoids growing the frozen asset-registry barrel.
import { FAMILY_CHAIR, resolveFixtureSlotPosition } from "@openclinxr/asset-registry/environment-zone-templates";
import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";

type Vector3 = { x: number; y: number; z: number };

/**
 * #574: world XZ of the family/parent chair fixture for `environmentId`, resolved with
 * the same fraction mapping the environment builder uses (resolveFixtureSlotsForRoom),
 * so a seated family actor lands ON the authored seat instead of the patient-chair
 * default anchor. Returns null when the environment does not author family seating —
 * callers keep the seatedActorWorldPosition default.
 *
 * Moved out of apps/ui-xr/src/main.ts with the composition below. The two are one job — resolve
 * the fixture anchor, then compose the authored offset onto it — and an app is a composition
 * root, so runtime placement logic belongs in this package beside ensureActorPlacementsForStagedSlots.
 */
export function familyChairFixtureWorldPosition(environmentId: string): Vector3 | null {
  const resolved = resolveEnvironmentShellDescriptor(environmentId);
  const familyChair = resolved.descriptor.fixtureSlots.find((slot) => slot.slotId === FAMILY_CHAIR.slotId);
  if (!familyChair) return null;
  const room = {
    widthMeters: resolved.descriptor.roomWidthMeters,
    depthMeters: resolved.descriptor.roomDepthMeters,
    heightMeters: resolved.descriptor.roomHeightMeters,
  };
  return resolveFixtureSlotPosition(familyChair, room, room);
}

/** The authored plant offset for `actorId` in `scenarioId`, or undefined when none is authored. */
/**
 * Capture-time suppression of the authored offset, for the CONTROL half of a control/treatment
 * measurement.
 *
 * Brief §7 step 2 wants the authored delta proven on the loaded humanoid. The only quantity an
 * instrument can sample there is the skinned mesh's world centre, which carries the body's own
 * offset from its origin — so comparing it against `anchor + authoredOffset` compares two
 * different things and needs a fudge term to agree. That is a threshold fitted to clear an
 * observation, which this repo has paid for before.
 *
 * The honest comparison is the same station sampled TWICE, with the offset and without it: the
 * body-origin bias is identical in both and subtracts out exactly, so the delta between the two
 * skinned centres is the authored offset and nothing else. This flag is the "without".
 *
 * Read LAZILY, never at module load. A module-level `window.location.search` read is what made
 * capture-clock-validation un-importable in node (ad714748); this returns false with no window.
 */
export function authoredPlantOffsetSuppressed(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("openclinxrSuppressAuthoredPlantOffset") === "1";
}

export function authoredPlantOffsetMeters(scenarioId: string, actorId: string): Vector3 | undefined {
  if (authoredPlantOffsetSuppressed()) return undefined;
  const offset = scenarioBank
    .find((candidate) => candidate.scenarioId === scenarioId)
    ?.actors?.find((actor) => actor.actorId === actorId)
    ?.placement?.plantOffsetMeters;
  if (!offset || typeof offset.x !== "number" || typeof offset.y !== "number" || typeof offset.z !== "number") {
    return undefined;
  }
  return { x: offset.x, y: offset.y, z: offset.z };
}

/**
 * The authored plant offset reaches the posed humanoid HERE, and nowhere earlier. main.ts used
 * to SUBSTITUTE a fixture anchor for the resolved position on the two supported postures, so
 * every upstream card — schema, admin control, staging station, compile node — changed nothing
 * a learner could see. Composition is what makes them visible.
 *
 * Frame: x/z are TANGENT to the contact plane, y is its NORMAL. A nonzero y on a supported
 * posture is REFUSED by composeSupportedActorWorldPosition rather than clamped; a patient does
 * not hover above the chair her weight is on. On a refusal the anchor stands, so a bad authoring
 * value degrades to the previous behaviour instead of floating an actor, and the reason is
 * returned for the caller to log.
 */
export function supportedActorPlacementPosition(input: {
  posture: "standing" | "seated" | "supine";
  actorId: string;
  scenarioId: string;
  environmentId: string;
  resolvedPosition: Vector3;
  slotKind: string;
}): { position: Vector3; refusalReason?: string } {
  if (input.posture === "standing") return { position: input.resolvedPosition };
  const fixtureAnchor = input.posture === "seated"
    ? ((input.slotKind === "family_or_observer"
        ? familyChairFixtureWorldPosition(input.environmentId)
        : null) ?? seatedActorWorldPosition({}))
    : supineActorWorldPosition({});
  const composed = composeSupportedActorWorldPosition({
    posture: input.posture,
    fixtureAnchor,
    authoredOffsetMeters: authoredPlantOffsetMeters(input.scenarioId, input.actorId),
    resolvedPosition: input.resolvedPosition,
  });
  if ("refused" in composed) return { position: fixtureAnchor, refusalReason: composed.reason };
  return { position: composed };
}
