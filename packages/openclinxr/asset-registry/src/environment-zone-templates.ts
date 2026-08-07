/**
 * Zone templates + clinical fixture staging for environment descriptors (#44/#133).
 * Split from environment-descriptors.ts to stay under the 500-line packages budget.
 */

import type { EnvironmentFixtureSlot, EnvironmentZoneTemplate } from "./environment-descriptors.js";

export const ED_BAY_ZONES: readonly EnvironmentZoneTemplate[] = [
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

export const TELEHEALTH_HOME_ZONES: readonly EnvironmentZoneTemplate[] = [
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

export const GENERIC_CLINIC_ZONES: readonly EnvironmentZoneTemplate[] = [
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

/**
 * #133 clinical staging helpers — declare real support slot ids (stretcher / patient_chair)
 * or none. Never use primary_patient as a furniture class (actor placement purpose only).
 *
 * Positions for stretchers/chairs on ambulatory rooms are offset from the standing
 * actor anchor (-0.72, z≈-0.12) so a floor-planted figure is not embedded in the deck.
 * ED bay keeps the historical stretcher position (supine patient on deck via #150).
 */
export const LEARNER_START: EnvironmentFixtureSlot = {
  slotId: "learner_start",
  purpose: "Learner entry standing position",
  position: { x: 0, y: 0, z: 1.4 },
};

/** ED-style stretcher under the supine patient plant. */
export const ED_STRETCHER: EnvironmentFixtureSlot = {
  slotId: "stretcher",
  purpose: "ED stretcher / bedside",
  position: { x: -0.9, y: 0, z: -0.1 },
};

/**
 * Ward/stepdown/OB stretcher offset from standing actor anchor so the deck does not
 * contain a floor-planted ambulatory patient (contract counterweight).
 * Stretcher footprint is ~2.2×0.9 m; center must keep the primary standing plant
 * (-0.72, z≈-0.12) outside the deck.
 */
export const OFFSET_STRETCHER: EnvironmentFixtureSlot = {
  slotId: "stretcher",
  purpose: "Patient bed / stretcher (beside standing exam zone)",
  position: { x: -2.05, y: 0, z: -0.75 },
};

/** Consult / clinic seating offset from standing anchor. */
export const OFFSET_CHAIR: EnvironmentFixtureSlot = {
  slotId: "patient_chair",
  purpose: "Patient seating",
  position: { x: -1.55, y: 0, z: -0.85 },
};
