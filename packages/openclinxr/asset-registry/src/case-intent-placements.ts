import type { AuthoredCasePlacement } from "./case-actor-placements-mod.js";
import type { EncounterRuntimeActorPlacement } from "./runtime-bundles.js";

/**
 * Carry a PERSISTED case's placement intent onto the runtime scene manifest.
 *
 * WHY THIS EXISTS. Two decisions a case author makes — which support the patient lies on, and how
 * far along that support she lies — were both resolved DOWNSTREAM through the module-level
 * `scenarioBank`, which contains only the in-repo fixture cases. An authored case is by definition
 * not in the bank, so for exactly the encounters that authored these values both resolved to
 * nothing and the runtime fell back to a room default.
 *
 * Measured 2026-09-09 on the unchanged tree at dc2ad3b8: `scene_closure_supine_bedside_v1` authors
 * `plantOffsetMeters {x: 0.12, y: 0, z: -0.08}` for `patient_margaret_ellis_v1`;
 * `authoredPlantOffsetMeters` returned `undefined`; the composition fell back to the bare
 * `DEFAULT_STRETCHER_POSITION` at x = -0.9. Nothing warned, because a case that authors no offset
 * looks identical to one whose offset was dropped.
 *
 * Putting both on the manifest record makes the frozen case the source and takes the bank out of
 * the path. `supported-actor-placement.ts` still falls back to the bank for the fixture cases that
 * genuinely live there.
 *
 * This module is deliberately NOT re-exported from the package root: `asset-registry` publishes
 * through `export *` walls under an exact-equality ceiling of 240 symbols, and it lives beside
 * `runtime-bundles.ts` rather than inside it because that file sits at a shrink-only 1,638-line
 * freeze.
 */

/**
 * The runtime's verdict on a supported placement, and the observation it hands the acceptance
 * owner.
 *
 * `accepted` is the gate dependent behaviour reads: a pending or refused placement does not
 * promote and motion bound to it does not run. `observation` is shaped as
 * `SceneRequirementObservation` (`scenario-runtime/src/encounter-admission.ts`) MINUS its
 * transport binding — `stationRunId`, `caseRevision` and `requirementRevision` bind a record to a
 * session and are the session's to supply. A scene consumer that invented them would be authoring
 * its own admissible evidence, which `recordRequirementObservation` refuses at intake for exactly
 * that reason. It is produced by `acceptanceForPlacement`
 * (`xr-runtime-state/src/supported-actor-placement.ts`).
 *
 * Declared here rather than in `runtime-bundles.ts` because that file sits at a shrink-only
 * 1,638-line freeze, and it is not re-exported from the package root because that root sits at an
 * exact-equality 240-symbol ceiling. Consumers read it structurally off the placement record.
 */
export type SupportedPlacementAcceptance = {
  /** The instance the placement requires, or null when the posture requires none. */
  requiredSupportInstanceId: string | null;
  /** Every support instance mounted when this placement resolved, so a refusal is legible. */
  observedSupportInstanceIds: string[];
  readiness: "not_required" | "mounted" | "pending";
  accepted: boolean;
  refusalReason: string | null;
  observation: {
    requirementId: string;
    capability: "patient_support_mounted";
    /** The instance the requirement is BOUND to, never whichever one happened to be mounted. */
    instanceId: string;
    instanceVersion: string;
    observedValue: boolean;
    outcome: "satisfied" | "unsatisfied" | "pending" | "unknown";
    observedAtMs: number;
    source: "runtime_consumer_observation";
  } | null;
};

/**
 * The exact support instance a posture depends on inside `environmentId`.
 *
 * The fixture slot ids come from `environment-zone-templates.ts`: a room that stages a recumbent
 * patient mounts a slot called `stretcher`, a room that seats one mounts `patient_chair`, and the
 * family slot sits on `family_chair`.
 *
 * A KIND IS NOT AN INSTANCE, and qualifying the slot with the room is the whole point. Every ward
 * and every ED bay mounts a slot called `stretcher`; putting a ward patient on the ED bay's bed
 * because both are called "stretcher" is the substitution A04 forbids, and an unqualified id makes
 * it undetectable.
 *
 * Standing returns null: a standing actor depends on the floor frame, not on a support.
 */
export function supportInstanceIdForPlacement(input: {
  environmentId: string;
  posture: "standing" | "seated" | "supine";
  slotKind: string;
}): string | null {
  if (input.posture === "supine") return `${input.environmentId}:stretcher`;
  if (input.posture === "seated") {
    return input.slotKind === "family_or_observer"
      ? `${input.environmentId}:family_chair`
      : `${input.environmentId}:patient_chair`;
  }
  return null;
}

/**
 * Every placement, with the case's own intent attached.
 *
 * A malformed authored offset is copied through UNCHANGED rather than screened out here: refusing
 * a non-finite component belongs to `composeSupportedActorWorldPosition`, which names the axis and
 * returns a refusal. Filtering it here would turn a refusal into a silent drop.
 */
export function placementsWithPersistedCaseIntent(
  records: Record<string, EncounterRuntimeActorPlacement>,
  input: { environmentId: string; authored: Record<string, AuthoredCasePlacement> },
): Record<string, EncounterRuntimeActorPlacement> {
  return Object.fromEntries(
    Object.entries(records).map(([actorId, placement]) => {
      const supportInstanceId = supportInstanceIdForPlacement({
        environmentId: input.environmentId,
        posture: placement.posture ?? "standing",
        slotKind: placement.slotKind,
      });
      const offset = input.authored[actorId]?.plantOffsetMeters;
      return [
        actorId,
        {
          ...placement,
          ...(supportInstanceId ? { supportInstanceId } : {}),
          ...(offset ? { plantOffsetMeters: { x: offset.x, y: offset.y, z: offset.z } } : {}),
        },
      ];
    }),
  );
}
