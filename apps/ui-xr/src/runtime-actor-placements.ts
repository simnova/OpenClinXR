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
 * Only ADDS missing actorPlacements keys; never overwrites an existing record
 * (protects first-three counterweight positions in the bundle).
 */

import type { RuntimeSlotAssignment } from "./runtime-actor-slots.js";

export type SlotKind =
  | "primary_patient"
  | "clinical_team"
  | "family_or_observer"
  | "additional_cast";

export type ActorPlacementRecord = {
  slotKind: SlotKind;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  verticalOffsetMeters: number;
  labelPrefix: string;
  posture?: "standing" | "seated" | "supine";
};

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

/** Minimal bundle surface — accepts package LearnerRuntimeAssetBundle without coupling. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BundleWithPlacements = {
  sceneManifest: {
    // any: package posture includes "supine"; we only add missing keys.
    actorPlacements?: Record<string, any>;
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
): { declaredActorIds: string[]; addedActorIds: string[] } {
  const placements: Record<string, ActorPlacementRecord> = {
    ...(bundle.sceneManifest.actorPlacements ?? {}),
  };
  const addedActorIds: string[] = [];

  for (let i = 0; i < SLOT_FOR_INDEX.length; i += 1) {
    const actorId = slots.stagedActorIds[i] ?? "";
    if (!actorId.trim() || placements[actorId]) continue;
    const slotKind = SLOT_FOR_INDEX[i]!;
    const anchor = SLOT_PLACEMENT_ANCHORS[slotKind];
    placements[actorId] = {
      ...anchor,
      slotKind,
      position: { ...anchor.position },
      scale: { ...anchor.scale },
    };
    addedActorIds.push(actorId);
  }

  bundle.sceneManifest.actorPlacements = placements;
  return { declaredActorIds: Object.keys(placements), addedActorIds };
}

/** Ensure missing placement keys and publish evidence for live inspectors. */
export function ensureAndPublishActorPlacementSsot(
  bundle: BundleWithPlacements,
  slots: RuntimeSlotAssignment,
): void {
  const result = ensureActorPlacementsForStagedSlots(bundle, slots);
  if (typeof window !== "undefined") {
    (window as unknown as { __openClinXrActorPlacementSsot?: unknown }).__openClinXrActorPlacementSsot = {
      declaredActorIds: result.declaredActorIds,
      addedActorIds: result.addedActorIds,
      actorPlacements: bundle.sceneManifest.actorPlacements ?? {},
    };
  }
}

export function additionalCastPlacementFallback(): ActorPlacementRecord {
  const a = SLOT_PLACEMENT_ANCHORS.additional_cast;
  return {
    ...a,
    position: { ...a.position },
    scale: { ...a.scale },
  };
}
