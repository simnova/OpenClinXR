/**
 * Zone templates + clinical fixture staging for environment descriptors (#44/#133).
 * Split from environment-descriptors.ts to stay under the 500-line packages budget.
 */

import type {
  EnvironmentFixtureSlot,
  EnvironmentZoneTemplate,
  FixturePlacementRule,
  NamedShellWall,
} from "./environment-descriptors.js";

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
 *
 * #196/#203/#204: authored positions below are absolute metres for furniture
 * *descriptor* dimensions. `resolveFixtureSlotPosition` remaps slots when the shell
 * is rebuilt at a different width/depth:
 * - **fraction** (default furniture): X scales with width; Z offset from floor-center
 *   scales with depth. Correct for chairs, beds, work surfaces.
 * - **wall_anchor** (DOOR_LEAF, WALL_BOARD): fixed inset from a *named* wall plane
 *   (`wallInsetMeters` bank-wide — #204) so the gap does not grow with the room
 *   (#203) and is the same accident in every environment (#204).
 * - **absolute** (`learner_start`): person standing marker, never remapped.
 * Y stays absolute for all rules (board height stays readable).
 */

/** Floor center Z matching station-environment shell placement (doorway opens +Z). */
export function shellFloorCenterZ(roomDepthMeters: number): number {
  return -(roomDepthMeters / 2) + 0.95;
}

export type RoomPlanDimensions = {
  widthMeters: number;
  depthMeters: number;
  heightMeters?: number;
};

/**
 * True when the slot is a person spawn / standing marker and must not track walls.
 */
export function isAbsoluteFixtureSlotId(slotId: string): boolean {
  return /learner[_-]?start/iu.test(slotId);
}

/**
 * Effective placement rule for a slot. Explicit placementRule wins; otherwise
 * learner_start → absolute, everything else → fraction.
 */
export function fixturePlacementRule(
  slot: Pick<EnvironmentFixtureSlot, "slotId" | "placementRule">,
): FixturePlacementRule {
  if (slot.placementRule) return slot.placementRule;
  if (isAbsoluteFixtureSlotId(slot.slotId)) return "absolute";
  return "fraction";
}

/** Fraction remap: relative layout of floor furniture about shell center. */
function resolveFractionPosition(
  authored: { x: number; y: number; z: number },
  room: RoomPlanDimensions,
  authoredFor: RoomPlanDimensions,
): { x: number; y: number; z: number } {
  const refW = Math.max(authoredFor.widthMeters, 1e-6);
  const refD = Math.max(authoredFor.depthMeters, 1e-6);
  const scaleX = room.widthMeters / refW;
  const scaleZ = room.depthMeters / refD;
  const authoredCenterZ = shellFloorCenterZ(authoredFor.depthMeters);
  const roomCenterZ = shellFloorCenterZ(room.depthMeters);
  const localZ = authored.z - authoredCenterZ;
  return {
    x: authored.x * scaleX,
    y: authored.y,
    z: localZ * scaleZ + roomCenterZ,
  };
}

/**
 * Wall-anchor remap: fixed inset from the named wall plane.
 * Shell is centred on X=0; Z walls use the same floor-center convention as fraction.
 * Along-wall axes still fraction-scale so a door walks with depth changes.
 *
 * #204: when `wallInsetMeters` is set it is the bank-wide gap (same in a 5 m clinic and
 * a 7.2 m stroke bay). Without it, inset is derived from authored coords relative to
 * `authoredFor` (the #203 behaviour — constant across width overrides of one room, but
 * a different accident per environment when a shared absolute was reused).
 */
function resolveWallAnchorPosition(
  authored: { x: number; y: number; z: number },
  wall: NamedShellWall,
  room: RoomPlanDimensions,
  authoredFor: RoomPlanDimensions,
  wallInsetMeters?: number,
): { x: number; y: number; z: number } {
  const authHalfW = authoredFor.widthMeters / 2;
  const roomHalfW = room.widthMeters / 2;
  const authCenterZ = shellFloorCenterZ(authoredFor.depthMeters);
  const roomCenterZ = shellFloorCenterZ(room.depthMeters);
  const authHalfD = authoredFor.depthMeters / 2;
  const roomHalfD = room.depthMeters / 2;
  const scaleX = room.widthMeters / Math.max(authoredFor.widthMeters, 1e-6);
  const scaleZ = room.depthMeters / Math.max(authoredFor.depthMeters, 1e-6);
  const explicitInset =
    typeof wallInsetMeters === "number" && Number.isFinite(wallInsetMeters)
      ? wallInsetMeters
      : undefined;

  if (wall === "+x") {
    // Inset from +X wall toward interior (metres).
    const inset = explicitInset ?? authHalfW - authored.x;
    const localZ = authored.z - authCenterZ;
    return { x: roomHalfW - inset, y: authored.y, z: localZ * scaleZ + roomCenterZ };
  }
  if (wall === "-x") {
    const inset = explicitInset ?? authored.x - (-authHalfW);
    const localZ = authored.z - authCenterZ;
    return { x: -roomHalfW + inset, y: authored.y, z: localZ * scaleZ + roomCenterZ };
  }
  if (wall === "+z") {
    // +Z wall plane at center + halfDepth (open-front shell exterior side).
    const authPlaneZ = authCenterZ + authHalfD;
    const roomPlaneZ = roomCenterZ + roomHalfD;
    const inset = explicitInset ?? authPlaneZ - authored.z;
    return { x: authored.x * scaleX, y: authored.y, z: roomPlaneZ - inset };
  }
  // wall === "-z" — back wall
  const authPlaneZ = authCenterZ - authHalfD;
  const roomPlaneZ = roomCenterZ - roomHalfD;
  const inset = explicitInset ?? authored.z - authPlaneZ;
  return { x: authored.x * scaleX, y: authored.y, z: roomPlaneZ + inset };
}

/**
 * Map an authored fixture position from `authoredFor` room plan into `room` plan.
 *
 * Per-slot rules (#203/#204): wall_anchor for door_leaf / wall_board (bank-wide
 * wallInsetMeters when set); fraction for furniture; absolute for learner_start.
 * #204 deliberately moves default rooms when wallInsetMeters replaces the accidental
 * halfWidth−2.15 gaps — identity preservation of absolute x is no longer the goal.
 */
export function resolveFixtureSlotPosition(
  slot: Pick<
    EnvironmentFixtureSlot,
    "slotId" | "position" | "placementRule" | "wall" | "wallInsetMeters"
  >,
  room: RoomPlanDimensions,
  authoredFor: RoomPlanDimensions,
): { x: number; y: number; z: number } {
  const authored = slot.position;
  const rule = fixturePlacementRule(slot);
  if (rule === "absolute") {
    return { x: authored.x, y: authored.y, z: authored.z };
  }
  if (rule === "wall_anchor") {
    const wall = slot.wall;
    if (!wall) {
      // Fail soft to fraction rather than invent a wall from sign(x) (#203 rejected that).
      return resolveFractionPosition(authored, room, authoredFor);
    }
    return resolveWallAnchorPosition(
      authored,
      wall,
      room,
      authoredFor,
      slot.wallInsetMeters,
    );
  }
  return resolveFractionPosition(authored, room, authoredFor);
}

/** Resolve every fixture slot for a room plan under its placement rule. */
export function resolveFixtureSlotsForRoom(
  slots: readonly EnvironmentFixtureSlot[],
  room: RoomPlanDimensions,
  authoredFor: RoomPlanDimensions,
): EnvironmentFixtureSlot[] {
  return slots.map((slot) => ({
    ...slot,
    position: resolveFixtureSlotPosition(slot, room, authoredFor),
    ...(typeof slot.inclineDegrees === "number" ? { inclineDegrees: slot.inclineDegrees } : {}),
  }));
}

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
  /**
   * #171 staging semi-Fowler: graded 30° from #159 contact sheet (15≈flat, 45 sits up).
   * Shared env `ed_exam_bay_v1` serves chest-pain v1+v2 — both inherit this angle.
   * claimScope: staging. notEvidenceFor: clinical positioning correctness.
   */
  inclineDegrees: 30,
};

/**
 * Ward/stepdown/OB stretcher offset from standing actor anchor so the deck does not
 * contain a floor-planted ambulatory patient (contract counterweight).
 * Stretcher footprint is ~2.2×0.9 m; center must keep the primary standing plant
 * (-0.72, z≈-0.12) outside the deck.
 *
 * Use for stations whose primary patient remains standing. Do NOT use for
 * recumbent inpatient staging (#179) — runtime supine plant hard-centers on
 * DEFAULT_STRETCHER_POSITION via supineActorWorldPosition(); use PLANT_ALIGNED_STRETCHER.
 */
export const OFFSET_STRETCHER: EnvironmentFixtureSlot = {
  slotId: "stretcher",
  purpose: "Patient bed / stretcher (beside standing exam zone)",
  position: { x: -2.05, y: 0, z: -0.75 },
};

/**
 * #179: fixture stretcher co-located with the runtime supine plant center
 * (`DEFAULT_STRETCHER_POSITION` / `supineActorWorldPosition` in actor-posture.ts).
 * Flat (no inclineDegrees) — #171 keeps undeclared incline at 0; semi-Fowler for
 * these rooms is a follow-on once that counterweight is retuned.
 * claimScope: staging placement. notEvidenceFor: ward-bed skin / clinical angle.
 */
export const PLANT_ALIGNED_STRETCHER: EnvironmentFixtureSlot = {
  slotId: "stretcher",
  purpose: "Patient bed under recumbent plant (aligned with default supine plant)",
  position: { x: -0.9, y: 0, z: -0.1 },
};

/** Consult / clinic seating offset from standing anchor. */
export const OFFSET_CHAIR: EnvironmentFixtureSlot = {
  slotId: "patient_chair",
  purpose: "Patient seating",
  position: { x: -1.55, y: 0, z: -0.85 },
};

/**
 * #186 shell architecture vocabulary — door / board / work surface.
 * Shared across rooms (never psych-only). Positions keep clear of actor plants
 * (-0.72, z≈-0.12) and known support decks (#169).
 */
/**
 * #204 bank-wide door inset (metres from +X wall plane to door root).
 * Picked from inset-sweep-sheet.png: 0.50 m — outer jamb (~0.52 m half-span of the
 * multi-mesh leaf/frame assembly) sits at the wall plane; flush (≤0.15) buries most of
 * the assembly in the wall; the legacy 1.35 m (halfWidth−2.15 at 7 m) reads as a free
 * prop. Same value in every environment; chairs/beds stay fraction.
 */
export const DOOR_WALL_INSET_METERS = 0.5;

/**
 * #204 board inset — SEPARATE from the door. A board is mounted on the wall (thin
 * frame), not fitted as an entrance assembly. 0.08 m ≈ frame/mount setback.
 */
export const BOARD_WALL_INSET_METERS = 0.08;

export const DOOR_LEAF: EnvironmentFixtureSlot = {
  slotId: "door_leaf",
  purpose: "Solid door leaf at learner entry",
  // Open front of shell is +Z; park leaf toward doorway corner, clear of plant.
  // position.x is documentation / fallback only when wallInsetMeters is absent;
  // #204 places by wallInsetMeters so every room shares one gap.
  position: { x: 3.0, y: 0, z: 1.05 },
  // #203: a door is architecture — fixed inset from the named wall, not a fraction.
  placementRule: "wall_anchor",
  wall: "+x",
  wallInsetMeters: DOOR_WALL_INSET_METERS,
};

export const WALL_BOARD: EnvironmentFixtureSlot = {
  slotId: "wall_board",
  purpose: "Wall-mounted clinical board",
  // Mounted on −X; position.x is fallback only. wallInsetMeters is bank-wide (#204).
  position: { x: -3.42, y: 1.4, z: -1.05 },
  placementRule: "wall_anchor",
  wall: "-x",
  wallInsetMeters: BOARD_WALL_INSET_METERS,
};

export const WORK_SURFACE: EnvironmentFixtureSlot = {
  slotId: "work_surface",
  purpose: "Room work counter / desk",
  position: { x: 1.75, y: 0, z: -0.85 },
};

/**
 * Second seat for family / parent — builds via patient-chair path (`*_chair`).
 *
 * #206: was x=0.95 (0.80 m from WORK_SURFACE, 0.70 m from EXAM_WORK_SURFACE). Procedural
 * chair seat is 0.48 m wide and work-surface top is 1.15 m — half-widths sum 0.815 m, so
 * any co-declaration of FAMILY_CHAIR + a work surface AABB-overlapped. Moved to the patient
 * seating half (−X), clear of desks; not a per-room override (the collision is in the shared
 * constant pair, same shape as the door's absolute x=2.15).
 */
export const FAMILY_CHAIR: EnvironmentFixtureSlot = {
  slotId: "family_chair",
  purpose: "Family or parent seating",
  position: { x: -0.55, y: 0, z: -0.75 },
};

export const OVERBED_SURFACE: EnvironmentFixtureSlot = {
  slotId: "overbed_surface",
  purpose: "Overbed table surface beside bed",
  position: { x: 0.15, y: 0, z: -0.35 },
};

/**
 * Clinic exam bay table (exam-table length, role = work_surface for ownership — not a second bed).
 *
 * #207: was x=1.65 with a 1.15 m desk silhouette. Real exam table is EXAM_TABLE_LENGTH_M=1.85 m
 * on local Z (depth). Placed at (0.15, −0.9) so half-width ~0.35 clears:
 *   - family_chair (−0.55) and patient plant (−0.72)
 *   - family framing (1.42, 0.04) and clinical_team framing (1.45, 0.55) on +X
 *   - door leaf at z≈+1 (Z-separated)
 * Length-on-X at +X bay collides family framing; do not reintroduce without re-framing actors.
 */
export const EXAM_WORK_SURFACE: EnvironmentFixtureSlot = {
  slotId: "exam_surface",
  purpose: "Exam table surface (clinic bay)",
  position: { x: 0.15, y: 0, z: -0.9 },
};
