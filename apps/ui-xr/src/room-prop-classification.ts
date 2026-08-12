/**
 * #223 — roomProp vocabulary: physical furniture vs pedagogical cue/overlay.
 *
 * The slab problem is boxes representing abstract review/context concepts.
 * Cues keep affordanceCueIds + scene tags; they must not render a scaled unit box.
 * Physical props consume station-equipment-builders (or keep a honest fallback until
 * a builder exists).
 *
 * claimScope: room-prop render channel classification.
 * notEvidenceFor: clinical staging, faculty-review product UX, Quest readiness.
 */

export type RoomPropClass = "physical_object" | "cue_or_overlay";

export type RoomPropClassification = {
  classification: RoomPropClass;
  /** ≥8 chars — recorded reason for contracts and pre-fix tables. */
  classificationReason: string;
};

/**
 * Furniture / device ids a learner can look at as objects in the room.
 * Alias targets for builders live in station-equipment resolveRoomPropBuilderEquipmentId.
 */
const PHYSICAL_PROP_IDS = new Set([
  "monitor",
  "ekg-leads-on-bed",
  "safe-room-soft-chair",
  "safety-plan-whiteboard",
  "telehealth-tablet-stand",
  "observer-station",
  // Factory residual vocabulary (not always shipped) — still objects when present.
  "chest-pain-monitor",
  "handoff-whiteboard",
  "pediatric-nebulizer-station",
  "parent-coaching-chair",
  "pediatric-pulse-ox-monitor",
  // Local ED set dressing (runtime-bundles) — freestanding room objects.
  "oxygen-panel",
  "suction-canister",
  "glove-box-stack",
  "sharps-bin",
  "biohazard-trash",
  "supply-cabinet",
  "hand-sanitizer",
  "privacy-curtain",
  "wall-clock",
  "ceiling-exam-light",
  "doorway-station-sign",
  "patient-handoff-whiteboard",
  "patient-blanket",
  "bed-wheel-locks",
  "clipboard-case-notes",
  "nurse-task-tray",
  "call-light-remote",
  "ecg-paper-strip",
  "monitor-lead-cable",
  "iv-tubing-line",
  // #347 MADR 0055 item 5 — scale-setting wall props are physical room objects.
  "curtain-track-rings",
  "outlet-plate",
  "light-switch",
  "hand-gel-dispenser",
]);

/**
 * Explicit cue / overlay ids (pedagogy, badges, zones, cards).
 * Includes factory residual names that never should become furniture builders.
 */
const CUE_OR_OVERLAY_PROP_IDS = new Set([
  "monitor-vitals-badge",
  "monitor-waveform-card",
  "cost-access-barrier-cue",
  "plain-language-plan-card",
  "glucometer-log-review",
  "ligature-risk-cleared-zone",
  "ecg-priority-zone",
  "family-communication-zone",
  "child-calm-breathing-card",
  // Local ED overlays / decals / badges (not freestanding furniture bodies).
  "doorway-escalation-badge",
  "floor-scuff-path",
  "infection-control-sign",
  "supply-drawer-labels",
  "privacy-zone-floor-tape",
  "trash-liner-fold",
]);

/**
 * Classify a roomProp id. Prefer explicit tables; fall back to name/role heuristics.
 * `monitor` ships with semanticRole objective_cue but is physical furniture — tables win.
 */
export function classifyRoomProp(
  propId: string,
  meta?: { label?: string | null; semanticRole?: string | null },
): RoomPropClassification {
  const id = propId.trim();
  if (!id) {
    return {
      classification: "cue_or_overlay",
      classificationReason: "empty propId — not furniture",
    };
  }

  if (PHYSICAL_PROP_IDS.has(id)) {
    return {
      classification: "physical_object",
      classificationReason: physicalReason(id),
    };
  }

  if (CUE_OR_OVERLAY_PROP_IDS.has(id)) {
    return {
      classification: "cue_or_overlay",
      classificationReason: cueReason(id, meta),
    };
  }

  // Generic factory quartet (#149) and any residual slug patterns.
  if (
    /-primary-context$/u.test(id)
    || /-objective-cue$/u.test(id)
    || /-communication-cue$/u.test(id)
    || /-review-cue$/u.test(id)
  ) {
    return {
      classification: "cue_or_overlay",
      classificationReason: "generic factory cue suffix — pedagogy, not furniture",
    };
  }

  if (/-cue$/u.test(id) || /-badge$/u.test(id) || /-card$/u.test(id) || /-zone$/u.test(id)) {
    return {
      classification: "cue_or_overlay",
      classificationReason: "name marks cue/badge/card/zone overlay, not freestanding furniture",
    };
  }

  const label = (meta?.label ?? "").trim();
  if (label === "Faculty review evidence cue") {
    return {
      classification: "cue_or_overlay",
      classificationReason: "faculty review concept label — not a room object",
    };
  }

  const role = meta?.semanticRole ?? "";
  if (
    role === "review_cue"
    || role === "communication_cue"
    || role === "scenario_context"
  ) {
    // objective_cue alone is ambiguous (monitor uses it); only treat as cue when not physical.
    return {
      classification: "cue_or_overlay",
      classificationReason: `semanticRole=${role} without physical id — affordance/trace overlay`,
    };
  }

  // Unknown residual: default to cue so we never invent furniture for pedagogy.
  return {
    classification: "cue_or_overlay",
    classificationReason: "unknown residual — default cue_or_overlay (do not invent furniture)",
  };
}

export function isRoomPropCueOrOverlay(
  propId: string,
  meta?: { label?: string | null; semanticRole?: string | null },
): boolean {
  return classifyRoomProp(propId, meta).classification === "cue_or_overlay";
}

export function isRoomPropPhysicalObject(
  propId: string,
  meta?: { label?: string | null; semanticRole?: string | null },
): boolean {
  return classifyRoomProp(propId, meta).classification === "physical_object";
}

function physicalReason(id: string): string {
  switch (id) {
    case "monitor":
    case "chest-pain-monitor":
    case "pediatric-pulse-ox-monitor":
      return "clinical monitor hardware a learner can look at";
    case "ekg-leads-on-bed":
      return "ECG leads on the deck — physical leads bundle";
    case "safe-room-soft-chair":
    case "parent-coaching-chair":
      return "seating furniture";
    case "safety-plan-whiteboard":
    case "handoff-whiteboard":
      return "wall whiteboard / board furniture";
    case "telehealth-tablet-stand":
      return "tablet stand furniture for telehealth visit";
    case "observer-station":
      return "observation station furniture / desk";
    case "pediatric-nebulizer-station":
      return "nebulizer station equipment object";
    default:
      return "listed physical room object for builder geometry";
  }
}

function cueReason(
  id: string,
  meta?: { label?: string | null; semanticRole?: string | null },
): string {
  switch (id) {
    case "monitor-vitals-badge":
      return "vitals readout badge overlay on/near monitor — not freestanding furniture";
    case "monitor-waveform-card":
      return "waveform card overlay — pedagogy/readout, not a separate device body";
    case "cost-access-barrier-cue":
      return "named communication cue about cost/access — not an object";
    case "plain-language-plan-card":
      return "plain-language plan card — teach-back overlay, not furniture";
    case "glucometer-log-review":
      return "log review action cue (review_cue) — not a freestanding glucometer mesh";
    case "ligature-risk-cleared-zone":
      return "cleared safety zone marker — volume/overlay, not solid furniture";
    case "ecg-priority-zone":
    case "family-communication-zone":
      return "workflow zone cue — not furniture";
    case "child-calm-breathing-card":
      return "breathing coaching card overlay";
    default:
      return `cue/overlay id (${meta?.semanticRole ?? "no-role"}) — keep affordances, no unit box`;
  }
}
