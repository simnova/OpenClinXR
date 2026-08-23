/**
 * Deterministic clean-encounter actor framing extracted from main.ts (#72 paydown).
 *
 * Rewrites slot positions for visual review. When it places actors on the floor
 * (y=0), load-time vertical offsets must use resolveEffectiveVerticalOffsetMeters
 * so legacy mid-height offsets do not bury feet-near-origin humanoids.
 *
 * #81: telehealth primary patient parks at patient_chair (not floor-standing mid-bay).
 * #123: prefer openClinXrSlotKind so additional_cast / second clinical do not collapse
 * onto the single clinical_team framing point (coincident nurse+RT / nurse+consultant).
 */

import type { Group } from "three";
import { DEFAULT_PATIENT_CHAIR_POSITION } from "@openclinxr/asset-registry";
import { ADDITIONAL_CAST_FRAMING_XZ } from "./runtime-actor-placements.js";

export type EncounterActorFramingInput = {
  actor: Group;
  actorId: string;
  scenarioId: string;
  role: string;
  /** Resolved posture when the caller has it before the slot tag exists (seated keeps seat anchor). */
  posture?: "standing" | "seated" | "supine" | undefined;
  /** Face / pose / close-realism captures keep placement tables untouched. */
  skipFraming: boolean;
  onWardrobeCue?: (actor: Group, roleCue: "patient" | "clinical" | "family") => void;
};

/**
 * Apply deterministic floor-standing (or OB seated) framing for clean encounter
 * visual review. Sets openClinXrEncounterStaging on the actor slot.
 */
export function applyCleanEncounterVisualReviewActorFraming(
  input: EncounterActorFramingInput,
): void {
  const { actor, scenarioId, role: roleRaw, skipFraming, onWardrobeCue } = input;
  if (skipFraming) return;

  const role = roleRaw.toLowerCase();

  if (scenarioId === "ob_headache_preeclampsia_triage_v1") {
    if (role.includes("patient")) {
      // #209: prior frame (-1.34, -0.3) sat inside OFFSET_STRETCHER (center -2.05,
      // half-length 1.1 → maxX≈-0.95) at 57% footprint overlap while posture stayed
      // standing. Keep the bed at OFFSET (clears WORK_SURFACE 1.75,-0.85); move the
      // ambulatory patient to the shared standing plant, clear of the deck.
      // Rejected: re-authoring another local +X bed that re-collides the desk (#206).
      actor.position.set(-0.72, 0, 0.08);
      actor.rotation.y = 0.16;
      actor.scale.setScalar(0.88);
      actor.userData.openClinXrEncounterStaging =
        "ob_patient_standing_beside_offset_stretcher_clear_of_deck_and_work_surface";
      actor.userData.openClinXrFloorStandingFrame = true;
      onWardrobeCue?.(actor, "patient");
      return;
    }

    if (
      role.includes("nurse")
      || role.includes("clinical")
      || role.includes("consultant")
      || role.includes("therapist")
    ) {
      actor.position.set(-0.22, 0.42, -0.04);
      actor.rotation.y = -0.24;
      actor.scale.setScalar(0.5);
      actor.userData.openClinXrEncounterStaging = "ob_nurse_bedside_escalation_plan_position";
      onWardrobeCue?.(actor, "clinical");
      return;
    }

    if (role.includes("family") || role.includes("spouse") || role.includes("parent")) {
      actor.position.set(0.26, 0.42, -0.2);
      actor.rotation.y = -0.34;
      actor.scale.setScalar(0.46);
      actor.userData.openClinXrEncounterStaging =
        "ob_partner_peripheral_observer_without_occluding_patient";
      onWardrobeCue?.(actor, "family");
      return;
    }
  }

  // Telehealth home visit: patient sits on the procedural patient_chair (#81).
  if (scenarioId.includes("telehealth") && role.includes("patient")) {
    actor.position.set(
      DEFAULT_PATIENT_CHAIR_POSITION.x,
      0,
      DEFAULT_PATIENT_CHAIR_POSITION.z,
    );
    actor.rotation.y = 0.12;
    actor.scale.setScalar(0.88);
    actor.userData.openClinXrEncounterStaging = "telehealth_patient_seated_on_patient_chair";
    actor.userData.openClinXrFloorStandingFrame = false;
    actor.userData.openClinXrActorPosture = "seated";
    onWardrobeCue?.(actor, "patient");
    return;
  }

  // Slot-kind first (#123): second clinical in additional_cast must not share clinical_team XZ.
  const slotKind =
    typeof actor.userData.openClinXrSlotKind === "string"
      ? actor.userData.openClinXrSlotKind
      : "";

  // #591: a SEATED actor's XZ is owned by her authored seat anchor (runtimeActorPlacement
  // #574 family_chair resolution). The generic floor-standing frames below unseat her —
  // pre-fix live: seated parent slot (1.42, 0.04) vs chair (−0.55, −0.75), feet 0.256 m
  // above the floor. Only rotation/scale are framed; the chair owns position.
  if (
    (actor.userData.openClinXrActorPosture ?? "") === "seated"
    || (input.posture ?? "") === "seated"
  ) {
    actor.rotation.y = -0.26;
    actor.scale.setScalar(0.82);
    actor.userData.openClinXrEncounterStaging = "seated_actor_keeps_authored_seat_anchor_framed_in_place";
    return;
  }

  if (slotKind === "additional_cast") {
    actor.position.set(ADDITIONAL_CAST_FRAMING_XZ.x, 0, ADDITIONAL_CAST_FRAMING_XZ.z);
    actor.rotation.y = -0.12;
    actor.scale.setScalar(0.86);
    actor.userData.openClinXrEncounterStaging =
      "additional_cast_team_adjacent_secondary_not_doorway";
  } else if (slotKind === "family_or_observer" || role.includes("family") || role.includes("parent") || role.includes("spouse")) {
    actor.position.set(1.42, 0, 0.04);
    actor.rotation.y = -0.34;
    actor.scale.setScalar(0.82);
  } else if (role.includes("patient") || slotKind === "primary_patient") {
    actor.position.set(-0.9, 0, 0.08);
    actor.rotation.y = 0.16;
    actor.scale.setScalar(0.88);
  } else if (
    role.includes("nurse")
    || role.includes("clinical")
    || role.includes("consultant")
    || role.includes("therapist")
    || role.includes("physician")
    || slotKind === "clinical_team"
  ) {
    actor.position.set(0.64, 0, 0.3);
    actor.rotation.y = -0.18;
    actor.scale.setScalar(0.86);
  }

  actor.userData.openClinXrEncounterStaging ??=
    "deterministic_clean_encounter_review_framing_keeps_case_defined_actors_visible_without_cropping";
  // Floor-standing frame: slot y=0. Pair with resolveEffectiveVerticalOffsetMeters at load.
  actor.userData.openClinXrFloorStandingFrame = Math.abs(actor.position.y) < 0.2;
}

export function addGeneratedHumanoidRoleContinuityWardrobeCue(
  actor: Group,
  roleCue: "patient" | "clinical" | "family",
): void {
  actor.userData.openClinXrDynamicWardrobeCuePolicy =
    "suppressed_in_default_runtime_after_visual_evidence_showed_overlay_artifacts_reduce_realism";
  actor.userData.openClinXrDynamicWardrobeCueRole = roleCue;
}
