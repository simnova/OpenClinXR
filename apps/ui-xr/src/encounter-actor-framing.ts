/**
 * Deterministic clean-encounter actor framing extracted from main.ts (#72 paydown).
 *
 * Rewrites slot positions for visual review. When it places actors on the floor
 * (y=0), load-time vertical offsets must use resolveEffectiveVerticalOffsetMeters
 * so legacy mid-height offsets do not bury feet-near-origin humanoids.
 *
 * #81: telehealth primary patient parks at patient_chair (not floor-standing mid-bay).
 */

import type { Group } from "three";
import { DEFAULT_PATIENT_CHAIR_POSITION } from "@openclinxr/asset-registry";

export type EncounterActorFramingInput = {
  actor: Group;
  actorId: string;
  scenarioId: string;
  role: string;
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
      actor.position.set(-1.34, 0.58, -0.3);
      actor.rotation.y = 0.18;
      actor.scale.set(0.44, 0.42, 0.44);
      actor.userData.openClinXrEncounterStaging =
        "ob_patient_seated_recliner_proof_frame_not_free_standing_on_bed";
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

  if (role.includes("patient")) {
    actor.position.set(-0.9, 0, 0.08);
    actor.rotation.y = 0.16;
    actor.scale.setScalar(0.88);
  } else if (
    role.includes("nurse")
    || role.includes("clinical")
    || role.includes("consultant")
    || role.includes("therapist")
  ) {
    actor.position.set(0.64, 0, 0.3);
    actor.rotation.y = -0.18;
    actor.scale.setScalar(0.86);
  } else if (role.includes("family") || role.includes("parent") || role.includes("spouse")) {
    actor.position.set(1.42, 0, 0.04);
    actor.rotation.y = -0.34;
    actor.scale.setScalar(0.82);
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
