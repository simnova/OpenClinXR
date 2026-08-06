/**
 * Shared parametric environment descriptors (#44).
 *
 * Single source of truth for room shell geometry/materials AND factory spatial-zone
 * plans. Runtime (`apps/ui-xr/src/station-environment.ts`) and
 * `buildEnvironmentGenerationPacket` both resolve from this table so the factory
 * cannot invent an ED bay when the encounter declares a home visit (and vice versa).
 *
 * Boxes are the extension point — kit-bashed / generated rooms plug into the same
 * shell dimensions, materials, fixture slots, and lighting later. Do not treat this
 * as art; treat it as the slot a cagematch measures against.
 */

export type EnvironmentSpatialZoneId =
  | "learner_entry"
  | "patient_bedside"
  | "nurse_workflow"
  | "family_interrupt"
  | "diagnostic_equipment";

export type EnvironmentZoneTemplate = {
  zoneId: EnvironmentSpatialZoneId;
  label: string;
  purpose: string;
  preferredAssetIds: readonly string[];
  spatialAnchors: readonly string[];
  clinicalFidelityNotes: readonly string[];
};

export type EnvironmentFixtureSlot = {
  slotId: string;
  purpose: string;
  position: { x: number; y: number; z: number };
};

/** Parametric shell a kit-bash or generated room plugs into later. */
export type EnvironmentShellDescriptor = {
  environmentId: string;
  displayName: string;
  roomWidthMeters: number;
  roomDepthMeters: number;
  roomHeightMeters: number;
  /** 0xRRGGBB floor albedo used by the parametric builder. */
  floorColor: number;
  wallColor: number;
  wallTrimColor: number;
  ambientHemisphereSky: number;
  ambientHemisphereGround: number;
  keyLightIntensity: number;
  fixtureSlots: readonly EnvironmentFixtureSlot[];
  zoneTemplates: readonly EnvironmentZoneTemplate[];
};

export type ResolvedEnvironmentShell = {
  /** Requested id, always. */
  environmentId: string;
  descriptor: EnvironmentShellDescriptor;
  environmentFallbackActive: boolean;
  environmentFallbackReason: string | null;
};

const ED_BAY_ZONES: readonly EnvironmentZoneTemplate[] = [
  {
    zoneId: "learner_entry",
    label: "Learner entry and orientation",
    purpose:
      "Give the examinee a clear start position, doorway sightline, and safe movement envelope before the encounter timer starts.",
    preferredAssetIds: [],
    spatialAnchors: ["doorway_panel", "hand_hygiene_marker", "exam_timer_sightline"],
    clinicalFidelityNotes: [
      "Doorway framing should support first-impression scan and interruption timing without cluttering controller movement.",
    ],
  },
  {
    zoneId: "patient_bedside",
    label: "Patient bedside interaction",
    purpose:
      "Anchor history-taking, pain-response observation, focused exam prompts, and patient gaze/gesture alignment.",
    preferredAssetIds: ["patient_robert_hayes_character", "ed_stretcher_bed_equipment"],
    spatialAnchors: ["patient_head_position", "left_bed_rail", "examiner_standing_zone"],
    clinicalFidelityNotes: [
      "Bed height, patient posture, and reach distance should remain readable in Quest/WebXR without requiring unsafe leaning.",
    ],
  },
  {
    zoneId: "nurse_workflow",
    label: "Nurse workflow and escalation",
    purpose:
      "Support nurse handoff, medication/order clarification, vital-sign changes, and team-communication pressure.",
    preferredAssetIds: ["nurse_maria_alvarez_character", "bedside_monitor_equipment"],
    spatialAnchors: ["nurse_standing_zone", "monitor_glance_target", "handoff_tablet_marker"],
    clinicalFidelityNotes: [
      "Nurse position should be visible from bedside while preserving conversational turn-taking and de-escalation cues.",
    ],
  },
  {
    zoneId: "family_interrupt",
    label: "Family interruption lane",
    purpose:
      "Provide a believable doorway/side-chair location for family concern, emotional pressure, and consent-boundary beats.",
    preferredAssetIds: ["spouse_anna_hayes_character"],
    spatialAnchors: ["doorway_interrupt_position", "family_waiting_spot", "privacy_boundary_marker"],
    clinicalFidelityNotes: [
      "Family placement should increase pressure without blocking learner access to the patient or nurse.",
    ],
  },
  {
    zoneId: "diagnostic_equipment",
    label: "Diagnostic equipment cluster",
    purpose:
      "Place ECG cart, IV stand, and monitor affordances where diagnostic-order and interpretation trace events can be observed.",
    preferredAssetIds: ["bedside_monitor_equipment", "ecg_cart_equipment", "iv_stand_equipment"],
    spatialAnchors: ["ecg_cart_parking_spot", "iv_stand_side_position", "vital_sign_display_plane"],
    clinicalFidelityNotes: [
      "Equipment should be recognizable but low-poly, with readable silhouettes and no production-readiness claim until review gates clear.",
    ],
  },
];

const TELEHEALTH_HOME_ZONES: readonly EnvironmentZoneTemplate[] = [
  {
    zoneId: "learner_entry",
    label: "Video-visit start frame",
    purpose:
      "Orient the learner to the telehealth session chrome: call frame, captions, and connection state before history-taking begins.",
    preferredAssetIds: [],
    spatialAnchors: ["video_call_frame", "caption_panel_plane", "connection_status_marker"],
    clinicalFidelityNotes: [
      "Home video frame should read as a remote visit, not a curtained ED bay.",
    ],
  },
  {
    zoneId: "patient_bedside",
    label: "Patient seating and teach-back zone",
    purpose:
      "Anchor seated history-taking, medication teach-back, and camera-facing gestures in a home living space.",
    preferredAssetIds: ["patient_luis_martinez_character"],
    spatialAnchors: ["patient_chair_position", "home_camera_frame", "examiner_screen_plane"],
    clinicalFidelityNotes: [
      "No stretcher rails or bedside monitors — this is a living-room chair facing a laptop or tablet.",
    ],
  },
  {
    zoneId: "nurse_workflow",
    label: "Caregiver / off-screen support",
    purpose:
      "Allow an optional caregiver presence or off-screen interruption without hospital staffing cues.",
    preferredAssetIds: [],
    spatialAnchors: ["caregiver_seat_marker", "offscreen_audio_cue", "home_doorway_background"],
    clinicalFidelityNotes: [
      "Caregiver placement is optional home context, not a nurse standing zone with a handoff tablet.",
    ],
  },
  {
    zoneId: "family_interrupt",
    label: "Household interruption lane",
    purpose:
      "Model doorbell, child, or bandwidth interruptions that break telehealth turn-taking.",
    preferredAssetIds: [],
    spatialAnchors: ["household_interrupt_position", "bandwidth_drop_marker", "privacy_boundary_marker"],
    clinicalFidelityNotes: [
      "Interruptions should feel domestic (noise, connection drop), not ED hallway pressure.",
    ],
  },
  {
    zoneId: "diagnostic_equipment",
    label: "Home medication and self-monitoring props",
    purpose:
      "Place medication bottles, glucose log, and caption/EHR panels for literacy and reconciliation beats.",
    preferredAssetIds: [],
    spatialAnchors: ["medication_bottle_shelf", "glucose_log_marker", "home_ehr_panel_plane"],
    clinicalFidelityNotes: [
      "Home self-monitoring props only — no ECG cart parking or IV stand positions.",
    ],
  },
];

const GENERIC_CLINIC_ZONES: readonly EnvironmentZoneTemplate[] = [
  {
    zoneId: "learner_entry",
    label: "Learner entry and orientation",
    purpose: "Doorway and exam-timer orientation for a generic clinical room.",
    preferredAssetIds: [],
    spatialAnchors: ["doorway_panel", "exam_timer_sightline", "hand_hygiene_marker"],
    clinicalFidelityNotes: ["Keep movement envelope clear of furniture clutter."],
  },
  {
    zoneId: "patient_bedside",
    label: "Patient interaction zone",
    purpose: "Seated or exam-table patient interaction without ED stretcher assumptions.",
    preferredAssetIds: [],
    spatialAnchors: ["patient_seat_position", "examiner_standing_zone", "chart_table_marker"],
    clinicalFidelityNotes: ["Avoid ED rail and cart anchors unless the environment profile is ed_bay."],
  },
  {
    zoneId: "nurse_workflow",
    label: "Clinical support zone",
    purpose: "Optional clinical support standing zone for multi-actor encounters.",
    preferredAssetIds: [],
    spatialAnchors: ["support_standing_zone", "chart_glance_target", "door_sightline"],
    clinicalFidelityNotes: ["Support placement must not block learner-patient sightline."],
  },
  {
    zoneId: "family_interrupt",
    label: "Family or interpreter lane",
    purpose: "Side-chair or doorway placement for family/interpreter pressure.",
    preferredAssetIds: [],
    spatialAnchors: ["side_chair_position", "doorway_interrupt_position", "privacy_boundary_marker"],
    clinicalFidelityNotes: ["Keep interpreter/family visible without crowding the exam table."],
  },
  {
    zoneId: "diagnostic_equipment",
    label: "Room equipment cluster",
    purpose: "Low-poly room equipment appropriate to a clinic or ward shell.",
    preferredAssetIds: [],
    spatialAnchors: ["wall_vitals_display", "supply_cart_parking", "waste_bin_marker"],
    clinicalFidelityNotes: ["No ED-only ECG cart or IV stand anchors for generic clinic rooms."],
  },
];

function shell(
  partial: Omit<EnvironmentShellDescriptor, "zoneTemplates" | "fixtureSlots"> & {
    zoneTemplates: readonly EnvironmentZoneTemplate[];
    fixtureSlots?: readonly EnvironmentFixtureSlot[];
  },
): EnvironmentShellDescriptor {
  return {
    ...partial,
    fixtureSlots: partial.fixtureSlots ?? [
      {
        slotId: "primary_patient",
        purpose: "Primary patient placement",
        position: { x: -0.9, y: 0, z: 0.08 },
      },
      {
        slotId: "learner_start",
        purpose: "Learner entry standing position",
        position: { x: 0, y: 0, z: 1.4 },
      },
    ],
  };
}

/**
 * Known environment ids from scenario fixtures. Start deep on the seam (ED vs telehealth);
 * other ids share a clinic shell so they do not silently render an ED bay plan.
 */
export const ENVIRONMENT_SHELL_DESCRIPTORS: Readonly<Record<string, EnvironmentShellDescriptor>> = {
  ed_exam_bay_v1: shell({
    environmentId: "ed_exam_bay_v1",
    displayName: "Emergency department exam bay",
    // Deeper clinical bay — matches today's ~3.45 m encounter depth.
    roomWidthMeters: 7,
    roomDepthMeters: 3.45,
    roomHeightMeters: 2.65,
    floorColor: 0x59636b,
    wallColor: 0xf1f5f9,
    wallTrimColor: 0xdc2626,
    ambientHemisphereSky: 0xf4f0dc,
    ambientHemisphereGround: 0x223042,
    keyLightIntensity: 2.5,
    zoneTemplates: ED_BAY_ZONES,
    fixtureSlots: [
      { slotId: "stretcher", purpose: "ED stretcher / bedside", position: { x: -0.9, y: 0, z: -0.1 } },
      { slotId: "monitor", purpose: "Bedside monitor wall mount", position: { x: -1.6, y: 1.4, z: -1.2 } },
      { slotId: "ecg_cart", purpose: "ECG cart parking", position: { x: 1.1, y: 0, z: 0.4 } },
      { slotId: "learner_start", purpose: "Learner entry", position: { x: 0, y: 0, z: 1.4 } },
    ],
  }),
  ed_stroke_bay_v1: shell({
    environmentId: "ed_stroke_bay_v1",
    displayName: "Emergency department stroke bay",
    roomWidthMeters: 7.2,
    roomDepthMeters: 3.6,
    roomHeightMeters: 2.65,
    floorColor: 0x4f5a63,
    wallColor: 0xeef2f6,
    wallTrimColor: 0xb91c1c,
    ambientHemisphereSky: 0xf4f0dc,
    ambientHemisphereGround: 0x223042,
    keyLightIntensity: 2.55,
    zoneTemplates: ED_BAY_ZONES,
  }),
  adult_ed_abdominal_bay_v1: shell({
    environmentId: "adult_ed_abdominal_bay_v1",
    displayName: "Adult ED abdominal bay",
    roomWidthMeters: 6.8,
    roomDepthMeters: 3.4,
    roomHeightMeters: 2.65,
    floorColor: 0x555f68,
    wallColor: 0xf1f5f9,
    wallTrimColor: 0xea580c,
    ambientHemisphereSky: 0xf4f0dc,
    ambientHemisphereGround: 0x223042,
    keyLightIntensity: 2.45,
    zoneTemplates: ED_BAY_ZONES,
  }),
  telehealth_home_visit_v1: shell({
    environmentId: "telehealth_home_visit_v1",
    displayName: "Telehealth home visit",
    // Shallower domestic room — visibly different depth from the ED bay.
    roomWidthMeters: 5.2,
    roomDepthMeters: 2.55,
    roomHeightMeters: 2.4,
    // Warm wood-tone floor vs clinical grey.
    floorColor: 0x8b6914,
    wallColor: 0xf5ebe0,
    wallTrimColor: 0x0d9488,
    ambientHemisphereSky: 0xfff5e6,
    ambientHemisphereGround: 0x3d2c1e,
    keyLightIntensity: 1.85,
    zoneTemplates: TELEHEALTH_HOME_ZONES,
    fixtureSlots: [
      { slotId: "patient_chair", purpose: "Home seating facing camera", position: { x: -0.4, y: 0, z: -0.2 } },
      { slotId: "laptop_desk", purpose: "Video visit device surface", position: { x: 0.5, y: 0.75, z: 0.3 } },
      { slotId: "medication_shelf", purpose: "Home medication props", position: { x: -1.6, y: 1.1, z: -0.9 } },
      { slotId: "learner_start", purpose: "Learner / examiner virtual frame", position: { x: 0, y: 0, z: 1.1 } },
    ],
  }),
  behavioral_health_private_room_v1: shell({
    environmentId: "behavioral_health_private_room_v1",
    displayName: "Behavioral health private room",
    roomWidthMeters: 5.6,
    roomDepthMeters: 3.0,
    roomHeightMeters: 2.5,
    floorColor: 0x6b7280,
    wallColor: 0xe8eef5,
    wallTrimColor: 0x6366f1,
    ambientHemisphereSky: 0xf0f4ff,
    ambientHemisphereGround: 0x2a3040,
    keyLightIntensity: 1.95,
    zoneTemplates: GENERIC_CLINIC_ZONES,
  }),
  oncology_consult_room_v1: shell({
    environmentId: "oncology_consult_room_v1",
    displayName: "Oncology consult room",
    roomWidthMeters: 5.8,
    roomDepthMeters: 3.1,
    roomHeightMeters: 2.55,
    floorColor: 0x686273,
    wallColor: 0xf8f5ff,
    wallTrimColor: 0x7c3aed,
    ambientHemisphereSky: 0xf8f5ff,
    ambientHemisphereGround: 0x2a2438,
    keyLightIntensity: 2.0,
    zoneTemplates: GENERIC_CLINIC_ZONES,
  }),
  urgent_care_clinic_room_v1: shell({
    environmentId: "urgent_care_clinic_room_v1",
    displayName: "Urgent care clinic room",
    roomWidthMeters: 5.5,
    roomDepthMeters: 2.9,
    roomHeightMeters: 2.5,
    floorColor: 0x5f7167,
    wallColor: 0xf0fdf4,
    wallTrimColor: 0x16a34a,
    ambientHemisphereSky: 0xf0fdf4,
    ambientHemisphereGround: 0x1e2e28,
    keyLightIntensity: 2.1,
    zoneTemplates: GENERIC_CLINIC_ZONES,
  }),
  surgical_ward_room_v1: shell({
    environmentId: "surgical_ward_room_v1",
    displayName: "Surgical ward room",
    roomWidthMeters: 6.0,
    roomDepthMeters: 3.2,
    roomHeightMeters: 2.6,
    floorColor: 0x73665d,
    wallColor: 0xfff7ed,
    wallTrimColor: 0xea580c,
    ambientHemisphereSky: 0xfff7ed,
    ambientHemisphereGround: 0x2a2218,
    keyLightIntensity: 2.15,
    zoneTemplates: GENERIC_CLINIC_ZONES,
  }),
  stepdown_room_v1: shell({
    environmentId: "stepdown_room_v1",
    displayName: "Stepdown room",
    roomWidthMeters: 6.2,
    roomDepthMeters: 3.25,
    roomHeightMeters: 2.6,
    floorColor: 0x5c6670,
    wallColor: 0xeef2f6,
    wallTrimColor: 0x0284c7,
    ambientHemisphereSky: 0xeef6ff,
    ambientHemisphereGround: 0x1e2834,
    keyLightIntensity: 2.2,
    zoneTemplates: GENERIC_CLINIC_ZONES,
  }),
  ob_triage_room_v1: shell({
    environmentId: "ob_triage_room_v1",
    displayName: "OB triage room",
    roomWidthMeters: 5.9,
    roomDepthMeters: 3.05,
    roomHeightMeters: 2.55,
    floorColor: 0x756f78,
    wallColor: 0xfff4f2,
    wallTrimColor: 0xdb2777,
    ambientHemisphereSky: 0xfff4f2,
    ambientHemisphereGround: 0x2a2228,
    keyLightIntensity: 2.05,
    zoneTemplates: GENERIC_CLINIC_ZONES,
  }),
  inpatient_ward_room_v1: shell({
    environmentId: "inpatient_ward_room_v1",
    displayName: "Inpatient ward room",
    roomWidthMeters: 6.0,
    roomDepthMeters: 3.15,
    roomHeightMeters: 2.55,
    floorColor: 0x5a646e,
    wallColor: 0xf1f5f9,
    wallTrimColor: 0x0f766e,
    ambientHemisphereSky: 0xf1f5f9,
    ambientHemisphereGround: 0x1e2830,
    keyLightIntensity: 2.1,
    zoneTemplates: GENERIC_CLINIC_ZONES,
  }),
  primary_care_clinic_room_v1: shell({
    environmentId: "primary_care_clinic_room_v1",
    displayName: "Primary care clinic room",
    roomWidthMeters: 5.0,
    roomDepthMeters: 2.8,
    roomHeightMeters: 2.45,
    floorColor: 0x64748b,
    wallColor: 0xf8fafc,
    wallTrimColor: 0x2563eb,
    ambientHemisphereSky: 0xf8fafc,
    ambientHemisphereGround: 0x1e293b,
    keyLightIntensity: 1.9,
    zoneTemplates: GENERIC_CLINIC_ZONES,
  }),
  pediatric_fever_urgent_care_bay_v1: shell({
    environmentId: "pediatric_fever_urgent_care_bay_v1",
    displayName: "Pediatric fever urgent care bay",
    roomWidthMeters: 5.4,
    roomDepthMeters: 2.95,
    roomHeightMeters: 2.5,
    floorColor: 0x60737a,
    wallColor: 0xeef9ff,
    wallTrimColor: 0x0ea5e9,
    ambientHemisphereSky: 0xeef9ff,
    ambientHemisphereGround: 0x1a2a32,
    keyLightIntensity: 2.05,
    zoneTemplates: GENERIC_CLINIC_ZONES,
  }),
  pediatric_urgent_care_bay_v1: shell({
    environmentId: "pediatric_urgent_care_bay_v1",
    displayName: "Pediatric urgent care bay",
    roomWidthMeters: 5.4,
    roomDepthMeters: 2.95,
    roomHeightMeters: 2.5,
    floorColor: 0x60737a,
    wallColor: 0xeef9ff,
    wallTrimColor: 0x0ea5e9,
    ambientHemisphereSky: 0xeef9ff,
    ambientHemisphereGround: 0x1a2a32,
    keyLightIntensity: 2.05,
    zoneTemplates: GENERIC_CLINIC_ZONES,
  }),
};

/** Explicit fallback shell — used when environmentId is unknown. Not an ED bay in disguise. */
export const FALLBACK_ENVIRONMENT_SHELL: EnvironmentShellDescriptor = shell({
  environmentId: "environment_fallback_v1",
  displayName: "Unknown environment fallback shell",
  roomWidthMeters: 5.5,
  roomDepthMeters: 3.0,
  roomHeightMeters: 2.5,
  floorColor: 0x55606b,
  wallColor: 0xeef7f4,
  wallTrimColor: 0x0f766e,
  ambientHemisphereSky: 0xf4f0dc,
  ambientHemisphereGround: 0x223042,
  keyLightIntensity: 2.0,
  zoneTemplates: GENERIC_CLINIC_ZONES,
});

export function resolveEnvironmentShellDescriptor(environmentId: string): ResolvedEnvironmentShell {
  const known = ENVIRONMENT_SHELL_DESCRIPTORS[environmentId];
  if (known) {
    return {
      environmentId,
      descriptor: known,
      environmentFallbackActive: false,
      environmentFallbackReason: null,
    };
  }
  return {
    environmentId,
    descriptor: {
      ...FALLBACK_ENVIRONMENT_SHELL,
      // Keep requested id on the resolved shell so consumers can stamp userData correctly.
      environmentId,
      displayName: `Fallback shell for unknown environmentId ${environmentId}`,
    },
    environmentFallbackActive: true,
    environmentFallbackReason: `unknown_environment_id:${environmentId}`,
  };
}
