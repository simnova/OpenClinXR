import type { EncounterRuntimeRoomProp } from "./runtime-bundles.js";

/**
 * Ward/ED room-prop data, split out of runtime-bundles.ts 2026-09-26 (room-obstacles) to keep
 * that file's builder/validate/shape logic under its frozen line ceiling — this module is pure
 * data (position/scale/label per prop), no bundle assembly.
 */

function runtimeRoomProp(
  propId: string,
  label: string,
  colorHex: string,
  accentColorHex: string,
  position: EncounterRuntimeRoomProp["position"],
  scale: EncounterRuntimeRoomProp["scale"],
  interactionTags: string[],
): EncounterRuntimeRoomProp {
  return {
    propId,
    label,
    semanticRole: "environmental_detail",
    evidenceCue: `${propId}:environmental_detail_cue`,
    colorHex,
    accentColorHex,
    position,
    scale,
    interactionTags,
    affordanceCueIds: [`${propId}:visual_context`, `${propId}:runtime_scene_manifest_prop`],
    generatedBy: "scene_manifest",
  };
}

/**
 * The 17 room props shared (id, label, colours, position, scale, tags) as defaults across
 * both clinical environments. Shared defaults are retained; the Ward-only wall-clock
 * wall-anchor override (z=-2.35) lives in `wardRoomProps` and ED defaults are unchanged.
 * Ward and ED each append their own privacy-curtain, curtain-track-rings, and
 * doorway-station-sign label (positions differ per room layout), and ED appends ten more
 * cardiac/urgent workflow items on top (see `edExamBayRoomProps` below). Deduplicated
 * 2026-09-26 (room-obstacles): the two lists were 20/30 fully-written entries with only these
 * three actually differing per environment; kept in one place so a shared value changes once.
 */
const SHARED_ROOM_PROPS: readonly EncounterRuntimeRoomProp[] = [
  runtimeRoomProp("oxygen-panel", "O2", "c7d8df", "305a6c", { x: 1.85, y: 1.35, z: -1.46 }, { x: 0.36, y: 0.22, z: 0.04 }, ["equipment_wall"]),
  runtimeRoomProp("suction-canister", "Suction", "e7f5f8", "2e7280", { x: 1.34, y: 1.06, z: -1.42 }, { x: 0.12, y: 0.2, z: 0.08 }, ["equipment_wall"]),
  runtimeRoomProp("glove-box-stack", "Gloves", "f1f5f7", "7c8c96", { x: -2.14, y: 1.3, z: 0.58 }, { x: 0.08, y: 0.24, z: 0.3 }, ["clinical_supplies"]),
  runtimeRoomProp("sharps-bin", "Sharps", "d94c3d", "6f1e17", { x: -2.0, y: 0.48, z: -1.22 }, { x: 0.22, y: 0.34, z: 0.16 }, ["clinical_supplies"]),
  runtimeRoomProp("biohazard-trash", "Biohazard", "9e2f27", "5c1714", { x: -2.04, y: 0.3, z: 0.85 }, { x: 0.24, y: 0.3, z: 0.22 }, ["clinical_supplies"]),
  runtimeRoomProp("supply-cabinet", "Supplies", "e9ece8", "7a837f", { x: -2.08, y: 1.05, z: 1.05 }, { x: 0.34, y: 0.72, z: 0.26 }, ["clinical_supplies"]),
  runtimeRoomProp("hand-sanitizer", "Foam", "e8fbff", "3c9eb2", { x: -2.18, y: 1.02, z: 1.48 }, { x: 0.08, y: 0.18, z: 0.05 }, ["clinical_supplies"]),
  runtimeRoomProp("wall-clock", "Clock", "ffffff", "24313a", { x: 0.95, y: 1.55, z: -1.42 }, { x: 0.18, y: 0.18, z: 0.035 }, ["ambient_safety"]),
  runtimeRoomProp("floor-scuff-path", "Traffic", "8e989d", "5e686d", { x: -0.18, y: 0.012, z: 0.62 }, { x: 1.22, y: 0.01, z: 0.045 }, ["environmental_texture"]),
  runtimeRoomProp("infection-control-sign", "Wash", "f7fbff", "2f6f9f", { x: -2.18, y: 1.55, z: 1.28 }, { x: 0.08, y: 0.2, z: 0.28 }, ["environmental_texture"]),
  runtimeRoomProp("patient-handoff-whiteboard", "Handoff", "f3f8f7", "276f66", { x: -1.15, y: 1.52, z: -1.42 }, { x: 0.58, y: 0.25, z: 0.035 }, ["environmental_texture"]),
  runtimeRoomProp("supply-drawer-labels", "Drawers", "f6f0df", "8a6c2b", { x: -1.78, y: 0.82, z: 1.24 }, { x: 0.3, y: 0.14, z: 0.035 }, ["environmental_texture"]),
  runtimeRoomProp("privacy-zone-floor-tape", "Zone", "f2c94c", "8c6d1f", { x: 0.82, y: 0.015, z: 1.08 }, { x: 0.68, y: 0.01, z: 0.035 }, ["environmental_texture"]),
  runtimeRoomProp("patient-blanket", "Blanket", "d8e6ef", "6e8795", { x: 0.18, y: 0.54, z: 0.1 }, { x: 0.5, y: 0.045, z: 0.62 }, ["patient_bedside"]),
  runtimeRoomProp("bed-wheel-locks", "Locks", "38424a", "d24a34", { x: -0.82, y: 0.2, z: 0.82 }, { x: 0.1, y: 0.055, z: 0.1 }, ["environmental_texture"]),
  runtimeRoomProp("clipboard-case-notes", "Notes", "f8f1d7", "74663b", { x: 1.15, y: 0.86, z: 1.1 }, { x: 0.26, y: 0.025, z: 0.36 }, ["patient_bedside"]),
  runtimeRoomProp("trash-liner-fold", "Liner", "e8eef0", "9e2f27", { x: -2.04, y: 0.56, z: 0.85 }, { x: 0.2, y: 0.035, z: 0.18 }, ["environmental_texture"]),
];

/**
 * Room props specific to the inpatient ward room environment: the shared 17 (with the
 * Ward-only wall-clock wall-anchor override to z=-2.35; ED defaults unchanged) plus a
 * ward-layout curtain parked OPEN at the rear (behind the review camera eye z=-1.60,
 * plane z~-1.9, footprint X[-1.8,-0.2], top 2.215 under measured ceiling underside 2.34)
 * and ward-labelled doorway sign. No ED cardiac/urgent items. The curtain's own
 * source-built track sits at local Y1.9; the separate rings row records the existing
 * perpendicular rail branch (axis residual) and is NOT a global renderer rewrite.
 */
function wardRoomProps(): EncounterRuntimeRoomProp[] {
  return [
    ...SHARED_ROOM_PROPS.map((prop) =>
      prop.propId === "wall-clock"
        ? { ...prop, position: { ...prop.position, z: -2.35 } }
        : prop
    ),
    runtimeRoomProp("privacy-curtain", "Curtain", "7fb6c7", "3f7482", { x: -1.0, y: 0.30, z: -1.9 }, { x: 1.0, y: 0.86, z: 0.035 }, ["ambient_safety"]),
    runtimeRoomProp("curtain-track-rings", "Rings", "dfe9ee", "5e8292", { x: -1.0, y: 2.2, z: -1.6 }, { x: 1.0, y: 0.035, z: 0.035 }, ["environmental_texture"]),
    runtimeRoomProp("doorway-station-sign", "Ward Room", "f4d35e", "7c6220", { x: -1.02, y: 1.92, z: 1.86 }, { x: 0.34, y: 0.09, z: 0.025 }, ["room_identification"]),
  ];
}

/**
 * Room props specific to the ED exam bay environment: the shared 17, an ED-layout curtain and
 * doorway sign, plus ten ED cardiac/urgent workflow items.
 */
function edExamBayRoomProps(): EncounterRuntimeRoomProp[] {
  return [
    ...SHARED_ROOM_PROPS,
    runtimeRoomProp("privacy-curtain", "Curtain", "7fb6c7", "3f7482", { x: 2.18, y: 1.12, z: 0.25 }, { x: 0.035, y: 0.86, z: 1.25 }, ["ambient_safety"]),
    runtimeRoomProp("curtain-track-rings", "Rings", "dfe9ee", "5e8292", { x: 2.12, y: 1.98, z: 0.25 }, { x: 0.035, y: 0.035, z: 0.62 }, ["environmental_texture"]),
    runtimeRoomProp("doorway-station-sign", "ED Bay", "f4d35e", "7c6220", { x: -1.02, y: 1.92, z: 1.86 }, { x: 0.34, y: 0.09, z: 0.025 }, ["room_identification"]),
    runtimeRoomProp("ceiling-exam-light", "Light", "ffefb0", "b68b22", { x: 0.45, y: 2.0, z: -0.35 }, { x: 0.48, y: 0.035, z: 0.22 }, ["urgent_escalation"]),
    runtimeRoomProp("ekg-leads-on-bed", "Leads", "f6f1e6", "4f5a60", { x: -0.18, y: 0.62, z: -0.12 }, { x: 0.34, y: 0.025, z: 0.2 }, ["ecg_request"]),
    runtimeRoomProp("monitor-lead-cable", "Cable", "2f3437", "8a969c", { x: -0.52, y: 0.76, z: -0.42 }, { x: 0.04, y: 0.025, z: 0.62 }, ["environmental_texture"]),
    runtimeRoomProp("iv-tubing-line", "Line", "dff7ff", "6fb2c6", { x: 0.75, y: 1.05, z: 0.54 }, { x: 0.025, y: 0.42, z: 0.025 }, ["environmental_texture"]),
    runtimeRoomProp("monitor-waveform-card", "Sinus", "07121c", "55f0a6", { x: -0.92, y: 1.34, z: -0.82 }, { x: 0.34, y: 0.18, z: 0.035 }, ["vitals_review"]),
    runtimeRoomProp("monitor-vitals-badge", "HR", "ffd166", "b05d16", { x: -0.5, y: 1.36, z: -0.82 }, { x: 0.12, y: 0.07, z: 0.025 }, ["vitals_review"]),
    runtimeRoomProp("ecg-paper-strip", "ECG", "f8f5e6", "4b5d67", { x: 1.35, y: 0.86, z: 0.28 }, { x: 0.36, y: 0.018, z: 0.08 }, ["ecg_request"]),
    runtimeRoomProp("nurse-task-tray", "Tray", "e7edf2", "5a6f9f", { x: 1.08, y: 0.9, z: 0.72 }, { x: 0.32, y: 0.035, z: 0.2 }, ["ecg_request"]),
    runtimeRoomProp("doorway-escalation-badge", "STAT", "f25f5c", "7f1d1d", { x: -0.62, y: 1.9, z: 1.86 }, { x: 0.09, y: 0.075, z: 0.025 }, ["urgent_escalation"]),
    runtimeRoomProp("call-light-remote", "Call", "fff4bf", "ba8d1c", { x: 0.62, y: 0.72, z: 0.54 }, { x: 0.09, y: 0.035, z: 0.2 }, ["ecg_request"]),
  ];
}

/**
 * An authored physical room prop whose identity, position, and semantic role come from the
 * shipped case manifest (tools/openclinxr/factory/generated-ed-station-runtime-bundle.ts) —
 * not the shared ED/ward environmental-detail vocabulary. Roles stay authored so
 * xr-capture-evidence/visual-review-filter.ts permits scene_manifest props whose
 * semanticRole != environmental_detail.
 */
function authoredPhysicalRoomProp(
  propId: string,
  label: string,
  semanticRole: EncounterRuntimeRoomProp["semanticRole"],
  evidenceCue: string,
  colorHex: string,
  accentColorHex: string,
  position: EncounterRuntimeRoomProp["position"],
  interactionTags: string[],
): EncounterRuntimeRoomProp {
  return {
    propId,
    label,
    semanticRole,
    evidenceCue,
    colorHex,
    accentColorHex,
    position,
    scale: { x: 1, y: 1, z: 1 },
    interactionTags,
    affordanceCueIds: [`${propId}:visual_context`, `${propId}:runtime_scene_manifest_prop`],
    generatedBy: "scene_manifest",
  };
}

/**
 * Room props for the behavioral-health private room: the three physical props the shipped
 * psych case manifest authors (safe-room-soft-chair, observer-station, safety-plan-whiteboard)
 * at their authored positions with their authored roles. The ligature-risk-cleared-zone is a
 * cue/overlay, not furniture — it does not ship here.
 */
function behavioralHealthRoomProps(): EncounterRuntimeRoomProp[] {
  return [
    authoredPhysicalRoomProp("safe-room-soft-chair", "Safe room chair", "scenario_context", "safe_room_context_cue", "e5e7eb", "4b5563", { x: -0.8, y: 0, z: -0.2 }, ["seating_furniture"]),
    authoredPhysicalRoomProp("observer-station", "Observer station", "communication_cue", "observer_escalation_cue", "e0f2fe", "0284c7", { x: 1.65, y: 0, z: -1.0 }, ["observation_furniture"]),
    authoredPhysicalRoomProp("safety-plan-whiteboard", "Safety plan prompts", "review_cue", "safety_plan_review_cue", "fefce8", "ca8a04", { x: 0.4, y: 0, z: -0.95 }, ["review_surface"]),
  ];
}

/**
 * Room props for the telehealth home visit: the one physical prop the shipped telehealth case
 * manifest authors (telehealth-tablet-stand) at its authored position with its authored role.
 * The plan card / log review / cost cue are pedagogy overlays, not furniture.
 */
function telehealthHomeRoomProps(): EncounterRuntimeRoomProp[] {
  return [
    authoredPhysicalRoomProp("telehealth-tablet-stand", "Telehealth tablet stand", "scenario_context", "telehealth_visit_context_cue", "e0f2fe", "0284c7", { x: 0.5, y: -0.1, z: 0.3 }, ["visit_device_furniture"]),
  ];
}

/** Select room props based on environment id. */
export function roomPropsForEnvironment(environmentId: string): EncounterRuntimeRoomProp[] {
  switch (environmentId) {
    case "inpatient_ward_room_v1":
      return wardRoomProps();
    case "ed_exam_bay_v1":
      return edExamBayRoomProps();
    case "behavioral_health_private_room_v1":
      return behavioralHealthRoomProps();
    case "telehealth_home_visit_v1":
      return telehealthHomeRoomProps();
    default:
      // Environment-specific fixtures and scenario equipment already describe every other
      // shipped room. Falling through to the ED set populated homes and clinics with oxygen,
      // sharps, bed locks, IV lines and task trays that their encounter never requested.
      return [];
  }
}
