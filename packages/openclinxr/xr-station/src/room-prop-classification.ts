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

/**
 * #347 split — the roomProp→builder-arm resolution block moved here from
 * station-equipment.ts so that file stays under the apps/ 600-line zone budget.
 * This module is a leaf (imports nothing from station-equipment), so there is no
 * cycle: station-equipment imports PARAMETRIC_KINDS + the resolver and re-exports
 * the three functions for its existing consumers (room-prop-geometry, main).
 */

/** Kinds that get purpose-built multi-mesh geometry (parametric path). */
export const PARAMETRIC_KINDS: ReadonlySet<string> = new Set([
  "fetal_monitor_equipment",
  "exam_table_equipment",
  "blood_pressure_cuff_equipment",
  "abdominal_exam_zone_equipment",
  "monitor_equipment",
  "iv_pump_equipment",
  "pulse_oximeter_equipment",
  "nebulizer_mask_equipment",
  "oxygen_wall_port_equipment",
  "pediatric_stretcher_equipment",
  "parent_chair_equipment",
  "inhaler_spacer_equipment",
  "chairs_equipment",
  "tissue_box_equipment",
  "post_op_bed_equipment",
  "abdominal_dressing_equipment",
  // #198 support surfaces — distinct silhouettes (not exam-table clones).
  "hospital_bed_equipment",
  "stretcher_equipment",
  "side_rails_equipment",
  // #202 family closures — grey-pole residual + deck/pump collisions.
  "safe_room_chair_equipment",
  "ehr_screen_equipment",
  "lab_results_panel_equipment",
  "tablet_visit_equipment",
  "iv_pole_equipment",
  "antipyretic_tray_equipment",
  "hydration_supplies_equipment",
  "digital_thermometer_equipment",
  "glucometer_review_equipment",
  "oxygen_nasal_cannula_equipment",
  "surgical_consult_phone_equipment",
  "observation_station_equipment",
  "12_lead_ecg_machine_equipment",
  "abdominal_exam_light_equipment",
  // #223 physical roomProp ids that need dedicated geometry (not unit-box fallback).
  "safety_plan_whiteboard_equipment",
  "ekg_leads_on_bed_equipment",
  // Architect tick 16 closure: family-fill ids with dedicated builder case arms
  // were mounted source="fallback" (planStationEquipmentMounts consults
  // PARAMETRIC_KINDS, not the dispatcher). Registering them makes the mount
  // ledger match the catalogue's runtimeSource=parametric.
  "medication_cart_equipment",
  "call_bell_equipment",
  "panic_button_equipment",
  "privacy_curtain_equipment",
  "small_table_equipment",
  "consultation_desk_equipment",
  "wall_sign_equipment",
  "medication_bottles_equipment",
  "urine_cup_equipment",
  "drain_equipment",
  "incentive_spirometer_equipment",
  "blood_culture_kit_equipment",
  // #347 MADR 0055 item 5 — scale-setting wall props (metric, origin-centred).
  "outlet_plate_equipment",
  "light_switch_equipment",
  "hand_gel_dispenser_equipment",
  "curtain_track_equipment",
]);

/**
 * Manifest roomProp id → parametric builder arm when hyphen/suffix alone is insufficient.
 * e.g. safe-room-soft-chair → safe_room_chair_equipment (not safe_room_soft_chair_equipment).
 */
const ROOM_PROP_BUILDER_ALIASES: Readonly<Record<string, string>> = {
  "safe-room-soft-chair": "safe_room_chair_equipment",
  safe_room_soft_chair: "safe_room_chair_equipment",
  "telehealth-tablet-stand": "tablet_visit_equipment",
  telehealth_tablet_stand: "tablet_visit_equipment",
  "observer-station": "observation_station_equipment",
  observer_station: "observation_station_equipment",
  "safety-plan-whiteboard": "safety_plan_whiteboard_equipment",
  safety_plan_whiteboard: "safety_plan_whiteboard_equipment",
  "ekg-leads-on-bed": "ekg_leads_on_bed_equipment",
  ekg_leads_on_bed: "ekg_leads_on_bed_equipment",
  "chest-pain-monitor": "monitor_equipment",
  chest_pain_monitor: "monitor_equipment",
  "handoff-whiteboard": "safety_plan_whiteboard_equipment",
  handoff_whiteboard: "safety_plan_whiteboard_equipment",
  "parent-coaching-chair": "parent_chair_equipment",
  parent_coaching_chair: "parent_chair_equipment",
  "pediatric-pulse-ox-monitor": "pulse_oximeter_equipment",
  pediatric_pulse_ox_monitor: "pulse_oximeter_equipment",
  "pediatric-nebulizer-station": "nebulizer_mask_equipment",
  pediatric_nebulizer_station: "nebulizer_mask_equipment",
  // #347 MADR 0055 item 5 — live ED-bundle props upgraded from flat box / cue.
  "hand-sanitizer": "hand_gel_dispenser_equipment",
  hand_sanitizer: "hand_gel_dispenser_equipment",
  "curtain-track-rings": "curtain_track_equipment",
  curtain_track_rings: "curtain_track_equipment",
};

/**
 * #185 — resolve a roomProp propId to a parametric builder arm, or null.
 * Exact match first, then hyphen→underscore, then `_equipment` suffix.
 * Manifest ids like `monitor` / `wall-clock` map to `monitor_equipment` /
 * `wall_clock_equipment` without a second geometry SSOT.
 */
export function resolveRoomPropBuilderEquipmentId(propId: string): string | null {
  if (!propId) return null;
  if (PARAMETRIC_KINDS.has(propId)) return propId;
  const alias = ROOM_PROP_BUILDER_ALIASES[propId] ?? ROOM_PROP_BUILDER_ALIASES[propId.replace(/-/gu, "_")];
  if (alias && PARAMETRIC_KINDS.has(alias)) return alias;
  const normalized = propId.replace(/-/gu, "_");
  if (PARAMETRIC_KINDS.has(normalized)) return normalized;
  if (!normalized.endsWith("_equipment")) {
    const withSuffix = `${normalized}_equipment`;
    if (PARAMETRIC_KINDS.has(withSuffix)) return withSuffix;
  }
  return null;
}

/**
 * #223 — reverse map: builder equipment id → roomProp propIds that alias to it.
 * Stamp these as openClinXrEquipmentIdAliases so #209 declared-equipment matching
 * sees the roomProp declaration fulfilled when only the equipment channel mounts.
 */
export function roomPropIdsAliasedToEquipment(equipmentId: string): string[] {
  if (!equipmentId) return [];
  const out: string[] = [];
  for (const [propId, arm] of Object.entries(ROOM_PROP_BUILDER_ALIASES)) {
    if (arm === equipmentId && !out.includes(propId) && propId.includes("-")) {
      // Prefer hyphenated manifest propIds over underscore duplicates.
      out.push(propId);
    }
  }
  return out;
}

/** Stamp reverse roomProp aliases onto an equipment root (no extra geometry). */
export function stampRoomPropAliasesOnEquipmentRoot(
  root: { userData: Record<string, unknown> },
  equipmentId: string,
): void {
  const propIds = roomPropIdsAliasedToEquipment(equipmentId);
  if (propIds.length === 0) return;
  const aliases = Array.isArray(root.userData.openClinXrEquipmentIdAliases)
    ? (root.userData.openClinXrEquipmentIdAliases as string[])
    : [];
  for (const propId of propIds) {
    if (!aliases.includes(propId)) aliases.push(propId);
  }
  root.userData.openClinXrEquipmentIdAliases = aliases;
}
