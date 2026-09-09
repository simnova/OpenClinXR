/**
 * #123 — actor placement SSOT helpers for staged humanoid slots.
 *
 * Decisions (named; rejected alternatives):
 * 1. WHERE additional_cast goes: team-adjacent clinical secondary
 *    `(1.95, 0.95, 0.15)` — beside clinical_team `(1.45, 0.55)`, deeper into the room
 *    (lower z) than the doorway. Rejected: doorway-forward `(0.35, 1.15)` from #122;
 *    rejected: roomCam-tuned nudge.
 * 2. Factory emits N keys when regenerated; runtime ALSO ensures missing keys for
 *    staged slots so stations whose shipped JSON never had actorPlacements still
 *    declare records. Rejected: JSON-only (leaves ward/psych orphans forever).
 * 3. physician included in factory team-role map (same allow-list gap as #122).
 * 4. Hardcoded main.ts fourth position removed — uses runtimeActorPlacement + anchors.
 *
 * ADDS missing actorPlacements keys, and RE-ANCHORS a record whose slotKind disagrees with the
 * slot assignment (#136 below). The header used to claim it "only ADDS ... never overwrites an
 * existing record", which was FALSE: the re-anchor at the loop below rewrites position and scale.
 * The overwrite is deliberate and must stay — suppressing it reintroduces #136 — but it was
 * invisible, incrementing neither addedActorIds nor any other count, so nothing downstream could
 * tell a carried-through placement from a rewritten one. rewrittenActorIds now names them.
 */

import type { EncounterRuntimeActorPlacement } from "@openclinxr/asset-registry/runtime-bundles";
import type { RuntimeSlotAssignment } from "./runtime-actor-slots.js";

export type SlotKind = EncounterRuntimeActorPlacement["slotKind"];

/** Local alias of the package placement record (includes posture: standing|seated|supine). */
export type ActorPlacementRecord = EncounterRuntimeActorPlacement;

/** Slot-kind anchors matching main.ts first-three fallbacks + clinical secondary. */
export const SLOT_PLACEMENT_ANCHORS: Record<SlotKind, ActorPlacementRecord> = {
  primary_patient: {
    slotKind: "primary_patient",
    position: { x: -0.72, y: 1.06, z: -0.12 },
    scale: { x: 1.1, y: 1.1, z: 1.1 },
    verticalOffsetMeters: -0.98,
    labelPrefix: "Patient",
  },
  clinical_team: {
    slotKind: "clinical_team",
    position: { x: 1.45, y: 0.95, z: 0.55 },
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: "Team",
  },
  family_or_observer: {
    slotKind: "family_or_observer",
    position: { x: -2.0, y: 0.95, z: 0.7 },
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: "Family",
  },
  /** Team-adjacent secondary (senior resident / second clinical) — not the doorway. */
  additional_cast: {
    slotKind: "additional_cast",
    position: { x: 1.95, y: 0.95, z: 0.15 },
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: "Cast",
  },
};

/** Live framing XZ for additional_cast (floor y=0), team-adjacent — not doorway z=1.15. */
export const ADDITIONAL_CAST_FRAMING_XZ = { x: 1.95, z: 0.15 } as const;

/**
 * Minimal bundle surface — matches LearnerRuntimeAssetBundle.sceneManifest.actorPlacements
 * without requiring the full bundle graph.
 */
type BundleWithPlacements = {
  sceneManifest: {
    actorPlacements?: Record<string, EncounterRuntimeActorPlacement>;
  };
};

const SLOT_FOR_INDEX: readonly SlotKind[] = [
  "primary_patient",
  "clinical_team",
  "family_or_observer",
  "additional_cast",
];

/**
 * Ensure every filled staged slot has a declared actorPlacements entry.
 * Mutates the in-memory bundle the runtime holds (shipped SSOT for this session).
 */
export function ensureActorPlacementsForStagedSlots(
  bundle: BundleWithPlacements,
  slots: RuntimeSlotAssignment,
): { declaredActorIds: string[]; addedActorIds: string[]; rewrittenActorIds: string[] } {
  const placements: Record<string, EncounterRuntimeActorPlacement> = {
    ...(bundle.sceneManifest.actorPlacements ?? {}),
  };
  const addedActorIds: string[] = [];
  const rewrittenActorIds: string[] = [];

  for (let i = 0; i < SLOT_FOR_INDEX.length; i += 1) {
    const actorId = slots.stagedActorIds[i] ?? "";
    if (!actorId.trim()) continue;
    const slotKind = SLOT_FOR_INDEX[i];
    // The loop is bounded by SLOT_FOR_INDEX.length, so this cannot be missing. Guarded rather
    // than asserted: an undefined slot kind would silently anchor an actor under no slot at
    // all, which the placement record would then carry forward as if it were authored.
    if (slotKind === undefined) continue;
    const anchor = SLOT_PLACEMENT_ANCHORS[slotKind];
    const existing = placements[actorId];
    // #136: shipped factory JSON sometimes tags a second clinical actor as family_or_observer
    // while assignRuntimeActorSlots places them in additional_cast. Correct the slotKind and
    // re-anchor so main.ts does not mount them under a colliding kind or wrong station position.
    if (existing && existing.slotKind === slotKind) continue;
    // WHAT THE RE-ANCHOR MAY AND MAY NOT DISCARD.
    //
    // Position and scale are the POINT of the repair: a record tagged with the wrong slotKind sits
    // at the wrong station anchor, and #136 is that collision. Everything the CASE decided is a
    // different kind of value and must survive, because a repair that silently drops authored
    // intent is indistinguishable from a case that never authored it.
    //
    // Measured on the unchanged tree: this carried `verticalOffsetMeters`, `labelPrefix` and
    // `posture`, and dropped `headingRadians`, `placementProvenance`, `plantOffsetMeters` and
    // `supportInstanceId`. The clinical slot's authored -0.26 heading survived the repair as
    // `undefined`, so an actor whose facing a clinician chose was framed by a default instead.
    placements[actorId] = {
      ...anchor,
      slotKind,
      position: { ...anchor.position },
      scale: { ...anchor.scale },
      ...(existing?.verticalOffsetMeters !== undefined
        ? { verticalOffsetMeters: existing.verticalOffsetMeters }
        : {}),
      ...(existing?.labelPrefix ? { labelPrefix: existing.labelPrefix } : {}),
      ...(existing?.posture ? { posture: existing.posture } : {}),
      // 0 is a real heading and is not the same as absent, so test the TYPE rather than truthiness.
      ...(typeof existing?.headingRadians === "number"
        ? { headingRadians: existing.headingRadians }
        : {}),
      ...(existing?.placementProvenance ? { placementProvenance: existing.placementProvenance } : {}),
      ...(existing?.plantOffsetMeters
        ? { plantOffsetMeters: { ...existing.plantOffsetMeters } }
        : {}),
      ...(existing?.supportInstanceId ? { supportInstanceId: existing.supportInstanceId } : {}),
    };
    if (existing) rewrittenActorIds.push(actorId);
    else addedActorIds.push(actorId);
  }

  bundle.sceneManifest.actorPlacements = placements;
  return { declaredActorIds: Object.keys(placements), addedActorIds, rewrittenActorIds };
}

export type ActorPlacementSsotEvidence = {
  declaredActorIds: string[];
  addedActorIds: string[];
  /** Ids whose position and scale the re-anchor REWROTE. See the header: this was invisible. */
  rewrittenActorIds: string[];
  actorPlacements: Record<string, EncounterRuntimeActorPlacement>;
};

/** Ensure missing placement keys and publish evidence for live inspectors. */
export function ensureAndPublishActorPlacementSsot(
  bundle: BundleWithPlacements,
  slots: RuntimeSlotAssignment,
): void {
  const result = ensureActorPlacementsForStagedSlots(bundle, slots);
  if (typeof window !== "undefined") {
    const evidence: ActorPlacementSsotEvidence = {
      declaredActorIds: result.declaredActorIds,
      addedActorIds: result.addedActorIds,
      rewrittenActorIds: result.rewrittenActorIds,
      actorPlacements: bundle.sceneManifest.actorPlacements ?? {},
    };
    window.__openClinXrActorPlacementSsot = evidence;
  }
}

export function additionalCastPlacementFallback(): EncounterRuntimeActorPlacement {
  const a = SLOT_PLACEMENT_ANCHORS.additional_cast;
  return {
    ...a,
    position: { ...a.position },
    scale: { ...a.scale },
  };
}

declare global {
  interface Window {
    __openClinXrActorPlacementSsot?: ActorPlacementSsotEvidence;
  }
}
