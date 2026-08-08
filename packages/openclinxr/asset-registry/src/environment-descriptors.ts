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

/**
 * How a fixture slot remaps when the shell is rebuilt at non-authored dimensions (#196/#203).
 * - fraction: offset scales with room extents (furniture / conversation layout).
 * - wall_anchor: fixed inset from a named wall plane (doors / wall-mounted boards).
 * - absolute: authored metres unchanged (person standing markers).
 */
export type FixturePlacementRule = "absolute" | "fraction" | "wall_anchor";

/**
 * Named shell wall for wall_anchor slots. Never derive the wall from sign(x) —
 * that silently breaks when a room is not centred on the origin (#203).
 */
export type NamedShellWall = "+x" | "-x" | "+z" | "-z";

export type EnvironmentFixtureSlot = {
  slotId: string;
  purpose: string;
  position: { x: number; y: number; z: number };
  /**
   * Optional head-of-bed incline degrees for stretcher slots (#171).
   * Descriptor-driven so MADR 0048 placement anchors stay co-located with position.
   * Staging only — not a clinical positioning claim. Default (absent) = 0 flat.
   */
  inclineDegrees?: number;
  /**
   * Placement remap rule under shell dimension overrides (#196/#203).
   * Absent → absolute for learner_start ids, otherwise fraction.
   */
  placementRule?: FixturePlacementRule;
  /** Required when placementRule is wall_anchor. Named wall plane, not sign-derived. */
  wall?: NamedShellWall;
  /**
   * #204: fixed metres from the named wall plane into the room when placementRule is
   * wall_anchor. ONE value for the bank — a door frame does not scale with room width.
   * When set, wall-normal placement uses this inset at every environment size (not
   * `halfWidth − authored.x`, which made every room a different accident from the
   * shared DOOR_LEAF absolute coordinate). Along-wall axes still fraction-scale.
   */
  wallInsetMeters?: number;
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


import {
  ED_BAY_ZONES,
  TELEHEALTH_HOME_ZONES,
  GENERIC_CLINIC_ZONES,
  LEARNER_START,
  ED_STRETCHER,
  OFFSET_STRETCHER,
  PLANT_ALIGNED_STRETCHER,
  OFFSET_CHAIR,
  DOOR_LEAF,
  WALL_BOARD,
  WORK_SURFACE,
  FAMILY_CHAIR,
  OVERBED_SURFACE,
  EXAM_WORK_SURFACE,
} from "./environment-zone-templates.js";

function shell(
  partial: Omit<EnvironmentShellDescriptor, "zoneTemplates" | "fixtureSlots"> & {
    zoneTemplates: readonly EnvironmentZoneTemplate[];
    fixtureSlots?: readonly EnvironmentFixtureSlot[];
  },
): EnvironmentShellDescriptor {
  return {
    ...partial,
    // Default: closed room with no patient support fixture — environments that need
    // a surface declare stretcher/patient_chair explicitly. Equipment-mounted beds
    // (postop, peds stretcher, exam table) intentionally use learner_start only so
    // the fixture path cannot double-bed those stations (#143 counterweight).
    fixtureSlots: partial.fixtureSlots ?? [LEARNER_START],
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
    // Prefer ED_STRETCHER helper so inclineDegrees stays in one place (#171).
    // #186: door + wall board — architecture shared with all bays (not psych-only).
    fixtureSlots: [
      ED_STRETCHER,
      { slotId: "monitor", purpose: "Bedside monitor wall mount", position: { x: -1.6, y: 1.4, z: -1.2 } },
      { slotId: "ecg_cart", purpose: "ECG cart parking", position: { x: 1.1, y: 0, z: 0.4 } },
      DOOR_LEAF,
      WALL_BOARD,
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
    // Stroke bank patient is standing — offset stretcher so they are not planted through the deck.
    fixtureSlots: [OFFSET_STRETCHER, DOOR_LEAF, WALL_BOARD, LEARNER_START],
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
    fixtureSlots: [OFFSET_STRETCHER, DOOR_LEAF, WALL_BOARD, LEARNER_START],
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
    // laptop_desk remains layout prop (not work_surface role — avoids dual desk with architecture).
    fixtureSlots: [
      { slotId: "patient_chair", purpose: "Home seating facing camera", position: { x: -0.4, y: 0, z: -0.2 } },
      { slotId: "laptop_desk", purpose: "Video visit device surface", position: { x: 0.5, y: 0.75, z: 0.3 } },
      { slotId: "medication_shelf", purpose: "Home medication props", position: { x: -1.6, y: 1.1, z: -0.9 } },
      DOOR_LEAF,
      WALL_BOARD,
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
    // #186 staging: two chairs + door + board. Identity is architecture + absence
    // (no IV pole / rail / hanging cord / sharp tray — enforced by not declaring them
    // and by equipment ownership filters; cleared zone is metadata, no mesh).
    fixtureSlots: [OFFSET_CHAIR, FAMILY_CHAIR, DOOR_LEAF, WALL_BOARD, LEARNER_START],
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
    // #186: fixture seating + door + work surface; chairs_equipment suppressed by ownership.
    fixtureSlots: [OFFSET_CHAIR, FAMILY_CHAIR, DOOR_LEAF, WORK_SURFACE, LEARNER_START],
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
    // Staging: seating + door + counter. Support stays exam_table_equipment (one bed).
    // One work_surface only — dual counter/exam_surface would fail ownership counterweight.
    fixtureSlots: [OFFSET_CHAIR, DOOR_LEAF, WORK_SURFACE, LEARNER_START],
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
    // Fixture bed owns support — post_op_bed_equipment suppressed by ownership.
    fixtureSlots: [PLANT_ALIGNED_STRETCHER, OVERBED_SURFACE, DOOR_LEAF, WALL_BOARD, LEARNER_START],
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
    // #179: recumbent plant-aligned stretcher. #186: door + board.
    fixtureSlots: [PLANT_ALIGNED_STRETCHER, DOOR_LEAF, WALL_BOARD, LEARNER_START],
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
    // #169: support parked away from framed patient plant. #186: door + counter.
    // #206: was inline stretcher at (1.85, −0.9) — same volume as WORK_SURFACE (1.75, −0.85).
    // OFFSET_STRETCHER (−2.05, −0.75) is the bank constant for "beside standing plant" and
    // clears the desk; rejected re-authoring another local +X bed that re-collides the desk.
    fixtureSlots: [OFFSET_STRETCHER, DOOR_LEAF, WORK_SURFACE, LEARNER_START],
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
    // #179 plant-aligned stretcher + #186 door / board / overbed identity.
    fixtureSlots: [PLANT_ALIGNED_STRETCHER, OVERBED_SURFACE, DOOR_LEAF, WALL_BOARD, LEARNER_START],
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
    fixtureSlots: [OFFSET_CHAIR, DOOR_LEAF, WORK_SURFACE, LEARNER_START],
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
    fixtureSlots: [OFFSET_STRETCHER, DOOR_LEAF, WALL_BOARD, LEARNER_START],
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
    // Staging: exam surface + parent seating + door. Keep equipment stretcher as
    // sole support (no second bed); exam_surface is work_surface role.
    fixtureSlots: [EXAM_WORK_SURFACE, FAMILY_CHAIR, DOOR_LEAF, WALL_BOARD, LEARNER_START],
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
  // #97: unknown ids (telehealth_consult_room_v1) still get real chair geometry.
  fixtureSlots: [
    { slotId: "patient_chair", purpose: "Fallback seating", position: { x: -0.4, y: 0, z: -0.2 } },
    { slotId: "learner_start", purpose: "Learner entry", position: { x: 0, y: 0, z: 1.2 } },
  ],
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
