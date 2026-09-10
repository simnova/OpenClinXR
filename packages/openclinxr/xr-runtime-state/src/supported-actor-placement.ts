import {
  composeSupportedActorWorldPosition,
  resolveEnvironmentShellDescriptor,
  seatedActorWorldPosition,
  supineActorWorldPosition,
} from "@openclinxr/asset-registry";
// #196 pattern: subpath avoids growing the frozen asset-registry barrel.
import { FAMILY_CHAIR, resolveFixtureSlotPosition } from "@openclinxr/asset-registry/environment-zone-templates";
import type { EncounterRuntimeActorPlacement } from "@openclinxr/asset-registry/runtime-bundles";
import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";

type Vector3 = { x: number; y: number; z: number };

/**
 * Where a resolved placement came from.
 *
 * Brief §3: *"With no intent, retain the existing resolved defaults and label their provenance; do
 * not copy them back into the case as faculty decisions."* The label is the whole point — a default
 * and an authored value are indistinguishable once composed, so a reviewer reading the runtime
 * cannot tell which decisions a clinician actually made without it. This package never writes back
 * to the case; the scenario bank is read-only here.
 */
export type PlacementProvenance = "authored_intent" | "resolved_default";

/**
 * Whether the support this placement depends on is actually mounted yet.
 *
 * Brief §3: *"runtime acceptance must check the actual mounted support after loading, footprint
 * fitting and grounding... Keep placement provisional until that geometry is ready; a pending exact
 * support withholds promotion while loading, without silently selecting another instance."*
 *
 * `pending` is the brief's own word and its own rule: it does not promote. The dangerous branch is
 * the third one — the named instance is absent while a DIFFERENT instance of the same kind is
 * mounted, which is exactly when substituting looks harmless and puts the patient on the wrong bed.
 */
export type SupportReadiness =
  | { status: "mounted"; supportInstanceId: string }
  | { status: "pending"; supportInstanceId: string; reason: string }
  | { status: "not_required" };

/**
 * Is the exact support this placement names mounted?
 *
 * REFUSES SUBSTITUTION BY CONSTRUCTION: the only question asked of the mounted set is whether it
 * contains the NAMED id. Other mounted instances are reported in the reason so a reader can see
 * what was available and that it was not taken.
 */
function supportReadinessForPlacement(input: {
  posture: "standing" | "seated" | "supine";
  /** The exact instance the placement depends on. Absent means the placement names none. */
  supportInstanceId?: string | undefined;
  mountedSupportInstanceIds: readonly string[];
}): SupportReadiness {
  if (input.posture === "standing" || !input.supportInstanceId) return { status: "not_required" };
  const mounted = new Set(input.mountedSupportInstanceIds);
  if (mounted.has(input.supportInstanceId)) {
    return { status: "mounted", supportInstanceId: input.supportInstanceId };
  }
  const others = input.mountedSupportInstanceIds.filter((id) => id !== input.supportInstanceId);
  return {
    status: "pending",
    supportInstanceId: input.supportInstanceId,
    reason:
      `support ${input.supportInstanceId} is not mounted yet, so this ${input.posture} placement stays provisional. `
      + (others.length > 0
        ? `${others.length} other support instance(s) ARE mounted (${others.join(", ")}) and none was substituted: a patient on the wrong bed is a worse answer than a placement that is still loading.`
        : "No other support instance is mounted either."),
  };
}

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
  // `globalThis`, not a bare `window`: this module is in the tools-relaxed program, which has no
  // `dom` lib, and a bare `window` is TS2304 there. The guard is unchanged. Through `unknown`
  // first, because a direct cast is TS2352 in a program that DOES have the dom lib.
  const browser = (globalThis as unknown as { window?: { location?: { search?: string } } }).window;
  const search = browser?.location?.search;
  if (typeof search !== "string") return false;
  return new URLSearchParams(search).get("openclinxrSuppressAuthoredPlantOffset") === "1";
}

/**
 * The authored plant offset for `actorId`, taken from the PERSISTED case first.
 *
 * `persisted` is what the runtime scene manifest carries
 * (`EncounterRuntimeActorPlacement.plantOffsetMeters`), written by the manifest producer from the
 * case document the API resolved. The `scenarioBank` lookup below is the FALLBACK and is now only
 * reached for the in-repo fixture cases that live in the bank.
 *
 * MEASURED 2026-09-09 on the unchanged tree: `scene_closure_supine_bedside_v1` authors
 * `plantOffsetMeters {x: 0.12, y: 0, z: -0.08}` for `patient_margaret_ellis_v1`, is not in the
 * bank, and this function returned `undefined` — so the composition fell back to the bare
 * stretcher anchor and the persisted intent reached nothing a learner could see. Every authored
 * case has that property, because "authored" and "in the in-repo bank" are opposites.
 */
export function authoredPlantOffsetMeters(
  scenarioId: string,
  actorId: string,
  persisted?: Vector3 | undefined,
): Vector3 | undefined {
  if (authoredPlantOffsetSuppressed()) return undefined;
  // A malformed persisted offset is passed THROUGH, not filtered here: refusing a non-finite
  // component is composeSupportedActorWorldPosition's job and it names the axis. Screening it out
  // here would turn a refusal into a silent drop, which is the failure mode this card exists to
  // close.
  if (persisted) return { x: persisted.x, y: persisted.y, z: persisted.z };
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
  /** The exact support instance this placement depends on, when the case names one. */
  supportInstanceId?: string | undefined;
  /** Support instances mounted RIGHT NOW. Absent means the caller did not observe, not that none is. */
  mountedSupportInstanceIds?: readonly string[] | undefined;
  /** The PERSISTED case's authored offset, carried on the manifest record. Beats the bank. */
  authoredOffsetMeters?: Vector3 | undefined;
  /**
   * The named floor frame a STANDING offset is authored against, observed off the live room.
   *
   * Without it a standing actor's authored offset is refused as `"none" is not a frame`, which is
   * correct when nobody named one. Measured on the unchanged tree at 86dc0300: the ward case authors
   * the physician's start at `{x: -1.95, y: 0, z: 1.72}`, this caller supplied no frame, the
   * composition refused, and the refusal made `supportAcceptance.accepted` false — so the physician's
   * placement was NOT accepted and `openClinXrDependentMotionAllowed` was false. An actor who may not
   * move cannot walk to a bedside.
   */
  floorFrame?: { frameId: string; originY: number; originXz: { x: number; z: number } } | undefined;
  /** Injected clock, so a recorded observation time is reproducible in a test. */
  nowMs?: number | undefined;
}): {
  position: Vector3;
  refusalReason?: string;
  provenance: PlacementProvenance;
  supportReadiness: SupportReadiness;
  supportAcceptance: NonNullable<EncounterRuntimeActorPlacement["supportAcceptance"]>;
} {
  const authoredOffsetMeters = authoredPlantOffsetMeters(
    input.scenarioId,
    input.actorId,
    input.authoredOffsetMeters,
  );
  // Standing used to RETURN HERE, before composeSupportedActorWorldPosition ran. That made its
  // "`none` is not a frame" refusal correct and unreachable — the repo's characteristic defect —
  // because the only standing caller never asked. The anchor argument is unused for standing; the
  // resolved position stands whether the compose accepts or refuses.
  const fixtureAnchor = input.posture === "standing"
    ? input.resolvedPosition
    : input.posture === "seated"
      ? ((input.slotKind === "family_or_observer"
          ? familyChairFixtureWorldPosition(input.environmentId)
          : null) ?? seatedActorWorldPosition({}))
      : supineActorWorldPosition({});
  const composed = composeSupportedActorWorldPosition({
    posture: input.posture,
    fixtureAnchor,
    ...(authoredOffsetMeters ? { authoredOffsetMeters } : {}),
    ...(input.floorFrame ? { floorFrame: input.floorFrame } : {}),
    resolvedPosition: input.resolvedPosition,
  });
  const supportReadiness = supportReadinessForPlacement({
    posture: input.posture,
    ...(input.supportInstanceId ? { supportInstanceId: input.supportInstanceId } : {}),
    mountedSupportInstanceIds: input.mountedSupportInstanceIds ?? [],
  });
  const refusalReason = "refused" in composed ? composed.reason : null;
  const supportAcceptance = acceptanceForPlacement({
    actorId: input.actorId,
    readiness: supportReadiness,
    observedSupportInstanceIds: [...(input.mountedSupportInstanceIds ?? [])],
    refusalReason,
    nowMs: input.nowMs ?? Date.now(),
  });
  if ("refused" in composed) {
    // A refusal falls back to the anchor, so the label is the DEFAULT: nothing the author asked
    // for was applied, and calling it authored would be the false claim this field exists to stop.
    return {
      position: fixtureAnchor,
      refusalReason: composed.reason,
      provenance: "resolved_default",
      supportReadiness,
      supportAcceptance,
    };
  }
  return {
    // A placement whose exact support is NOT mounted must not promote onto that support: composing
    // a support-relative offset asserts a contact plane that is not in the scene. The resolved
    // position stands until the mount is observed, which is what `pending` means.
    position: supportAcceptance.accepted ? composed : input.resolvedPosition,
    provenance: supportAcceptance.accepted && authoredOffsetMeters ? "authored_intent" : "resolved_default",
    supportReadiness,
    supportAcceptance,
  };
}

/**
 * Turn an observed readiness and a composition refusal into the runtime's ACCEPTANCE verdict and
 * the observation record the acceptance owner consumes.
 *
 * THE DEFECT THIS REPLACES, measured at `apps/ui-xr/src/main.ts:840` on the unchanged tree: the
 * live caller supplied neither `supportInstanceId` nor `mountedSupportInstanceIds`, so the
 * readiness above was `not_required` for every supine patient and its substitution refusal was
 * unreachable; and the one refusal that WAS reached was written to `console.warn` while the
 * anchor was returned anyway. `proof-contract-v2.md`: "Warn-and-place is not refusal."
 *
 * The observation is deliberately partial. `stationRunId`, `caseRevision` and `requirementRevision`
 * bind a record to a session and are the session's to supply; a scene consumer that invented them
 * would be authoring its own admissible evidence, which
 * `recordRequirementObservation` refuses at intake for exactly that reason.
 */
function acceptanceForPlacement(input: {
  actorId: string;
  readiness: SupportReadiness;
  observedSupportInstanceIds: string[];
  refusalReason: string | null;
  nowMs: number;
}): NonNullable<EncounterRuntimeActorPlacement["supportAcceptance"]> {
  const required = input.readiness.status === "not_required" ? null : input.readiness.supportInstanceId;
  const mounted = input.readiness.status === "mounted";
  const accepted = input.refusalReason === null && (required === null || mounted);
  const outcome = input.refusalReason !== null
    ? "unsatisfied"
    : required === null
      ? "satisfied"
      : mounted
        ? "satisfied"
        : "pending";
  return {
    requiredSupportInstanceId: required,
    observedSupportInstanceIds: input.observedSupportInstanceIds,
    readiness: input.readiness.status,
    accepted,
    refusalReason: input.refusalReason,
    observation: required === null
      ? null
      : {
          requirementId: `patient_support_mounted:${input.actorId}`,
          capability: "patient_support_mounted",
          // The instance the requirement is BOUND to, never whichever one happened to be mounted.
          // Reporting the mounted one here is how a substitution becomes invisible.
          instanceId: required,
          instanceVersion: mounted ? "observed_mounted" : "not_observed",
          observedValue: mounted && input.refusalReason === null,
          outcome,
          observedAtMs: input.nowMs,
          source: "runtime_consumer_observation",
        },
  };
}
