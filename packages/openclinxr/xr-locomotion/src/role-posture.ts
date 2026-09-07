import { applyHumanoidJointRotationsByAlias } from "@openclinxr/xr-pose";
import type { Group } from "three";
import type { RolePostureContext } from "./types.js";

type JointRotations = Map<string, { x?: number; y?: number; z?: number }>;

export function applyGeneratedHumanoidRoleSpecificPosture(
  ctx: RolePostureContext,
  humanoid: Group,
  actorId: string,
): void {
  const actorRole = ctx.actorRole(actorId);
  if (ctx.isPatient(actorId)) {
    if (ctx.isPediatricAsthmaScenario()) {
      const pediatricRespiratoryDistressRotations: JointRotations = new Map([
        ["head", { x: -0.18, y: 0.1 }],
        ["upper_armL", { x: -1.34, y: 0.16, z: -0.5 }],
        ["forearmL", { x: -0.78, y: -0.2, z: 0.62 }],
        ["handL", { x: 0.18, y: 0.14, z: -0.24 }],
        ["upper_armR", { x: -1.22, y: -0.12, z: 0.44 }],
        ["forearmR", { x: -0.7, y: 0.2, z: -0.58 }],
        ["handR", { x: 0.18, y: -0.14, z: 0.24 }],
      ]);
      applyHumanoidJointRotationsByAlias(
        humanoid,
        pediatricRespiratoryDistressRotations,
        "pediatric_asthma_hunched_hands_near_chest",
      );
      humanoid.scale.set(0.78, 0.74, 0.78);
      humanoid.rotation.x = -0.14;
      humanoid.rotation.y = 0.08;
      humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
        "pediatric_patient_smaller_silhouette_cue",
        "pediatric_asthma_hunched_work_of_breathing_pose_cue",
        "patient_hands_near_chest_respiratory_distress_cue",
        "pediatric_patient_case_role_distinct_from_adult_actor_pose_cue",
      ];
      return;
    }
    const patientRotations: JointRotations = new Map([
      ["head", { x: -0.12, y: 0.08 }],
    ]);
    applyHumanoidJointRotationsByAlias(humanoid, patientRotations, "patient_low_guarded_clinical_attention_pose");
    humanoid.rotation.x = -0.08;
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "patient_chest_pain_guarding_pose_cue",
      "patient_reclined_distress_attention_cue",
    ];
    applyScenarioDerivedPatientPosture(ctx, humanoid);
    return;
  }
  if (ctx.isClinicalTeam(actorId)) {
    const clinicalTeamRotations: JointRotations = new Map([
      ["head", { x: -0.04, y: -0.1 }],
    ]);
    applyHumanoidJointRotationsByAlias(humanoid, clinicalTeamRotations, "clinical_team_low_asymmetric_attention_pose");
    humanoid.scale.set(1.04, 1.08, 1.04);
    humanoid.rotation.y = -0.16;
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      actorRole === "nurse" ? "nurse_adult_clinical_silhouette_cue" : "clinical_team_adult_silhouette_cue",
      "nurse_monitor_workflow_attention_pose_cue",
      "nurse_asymmetric_equipment_attention_pose_cue",
    ];
    applyScenarioDerivedClinicalTeamPosture(ctx, humanoid);
    return;
  }
  if (ctx.isFamily(actorId)) {
    const familyRotations: JointRotations = new Map([
      ["head", { x: -0.08, y: 0.14 }],
    ]);
    applyHumanoidJointRotationsByAlias(humanoid, familyRotations, "family_low_anxious_observer_pose");
    humanoid.scale.set(1.05, 1.04, 1.05);
    humanoid.rotation.y = 0.18;
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "adult_family_member_silhouette_cue",
      "family_worried_observer_pose_cue",
      "parent_asymmetric_anxiety_pose_cue",
    ];
    applyScenarioDerivedFamilyPosture(ctx, humanoid);
  }
}

export function applyScenarioDerivedPatientPosture(ctx: Pick<RolePostureContext, "scenarioId">, humanoid: Group): void {
  const scenarioId = ctx.scenarioId;
  if (scenarioId === "ob_headache_preeclampsia_triage_v1") {
    humanoid.rotation.x = -0.04;
    humanoid.rotation.y = -0.18;
    humanoid.rotation.z = 0.04;
    humanoid.scale.set(1.02, 1, 1.04);
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "ob_preeclampsia_seated_headache_attention_pose_cue",
      "ob_pregnancy_weight_shift_silhouette_cue",
      "case_definition_driven_patient_pose_not_chest_pain_default",
    ];
    humanoid.userData["openClinXrScenarioDerivedPosture"] = "ob_preeclampsia_headache_weight_shift";
    return;
  }
  if (scenarioId === "clinic_abdominal_pain_interpreter_v1") {
    humanoid.rotation.x = -0.16;
    humanoid.rotation.y = 0.2;
    humanoid.rotation.z = -0.06;
    humanoid.scale.set(0.98, 0.96, 1);
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "clinic_rlq_pain_forward_guarding_pose_cue",
      "interpreter_mediated_attention_shift_pose_cue",
      "case_definition_driven_patient_pose_not_chest_pain_default",
    ];
    humanoid.userData["openClinXrScenarioDerivedPosture"] = "clinic_abdominal_pain_forward_guarding";
    return;
  }
  if (scenarioId === "oncology_bad_news_family_v1") {
    humanoid.rotation.x = -0.03;
    humanoid.rotation.y = 0.12;
    humanoid.rotation.z = -0.035;
    humanoid.scale.set(0.96, 0.94, 0.98);
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "oncology_serious_news_softened_seated_pose_cue",
      "family_conversation_attention_pose_cue",
      "case_definition_driven_patient_pose_not_chest_pain_default",
    ];
    humanoid.userData["openClinXrScenarioDerivedPosture"] = "oncology_bad_news_softened_seated";
    return;
  }
  if (scenarioId === "postop_fever_consult_pressure_v1") {
    humanoid.rotation.x = -0.1;
    humanoid.rotation.y = -0.08;
    humanoid.rotation.z = 0.05;
    humanoid.scale.set(1, 0.97, 1.02);
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "postop_fever_guarded_abdominal_dressing_pose_cue",
      "consult_pressure_attention_pose_cue",
      "case_definition_driven_patient_pose_not_chest_pain_default",
    ];
    humanoid.userData["openClinXrScenarioDerivedPosture"] = "postop_fever_guarded_abdomen";
  }
}

export function applyScenarioDerivedClinicalTeamPosture(ctx: Pick<RolePostureContext, "scenarioId">, humanoid: Group): void {
  const scenarioId = ctx.scenarioId;
  if (scenarioId === "ob_headache_preeclampsia_triage_v1") {
    humanoid.rotation.y = -0.28;
    humanoid.rotation.z = -0.04;
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "ob_bp_repeat_workflow_attention_pose_cue",
      "preeclampsia_escalation_clinician_pose_cue",
      "case_definition_driven_clinical_team_pose",
    ];
    humanoid.userData["openClinXrScenarioDerivedPosture"] = "ob_bp_escalation_clinical_team";
  } else if (scenarioId === "clinic_abdominal_pain_interpreter_v1") {
    humanoid.rotation.y = 0.34;
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "clinic_interpreter_triangle_attention_pose_cue",
      "case_definition_driven_clinical_team_pose",
    ];
    humanoid.userData["openClinXrScenarioDerivedPosture"] = "clinic_interpreter_triangle";
  } else if (scenarioId === "oncology_bad_news_family_v1") {
    humanoid.rotation.y = -0.08;
    humanoid.rotation.x = -0.03;
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "oncology_soft_consult_seated_attention_pose_cue",
      "case_definition_driven_clinical_team_pose",
    ];
    humanoid.userData["openClinXrScenarioDerivedPosture"] = "oncology_soft_consult_attention";
  } else if (scenarioId === "postop_fever_consult_pressure_v1") {
    humanoid.rotation.y = -0.34;
    humanoid.rotation.z = 0.05;
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "postop_surgery_resident_time_pressure_pose_cue",
      "case_definition_driven_clinical_team_pose",
    ];
    humanoid.userData["openClinXrScenarioDerivedPosture"] = "postop_time_pressure_consult";
  }
}

export function applyScenarioDerivedFamilyPosture(ctx: Pick<RolePostureContext, "scenarioId">, humanoid: Group): void {
  const scenarioId = ctx.scenarioId;
  if (scenarioId === "clinic_abdominal_pain_interpreter_v1") {
    humanoid.rotation.y = -0.32;
    humanoid.rotation.z = 0.035;
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "clinic_interpreter_attention_pose_cue",
      "case_definition_driven_family_or_interpreter_pose",
    ];
    humanoid.userData["openClinXrScenarioDerivedPosture"] = "clinic_interpreter_attention";
  } else if (scenarioId === "oncology_bad_news_family_v1") {
    humanoid.rotation.y = 0.26;
    humanoid.rotation.x = -0.06;
    humanoid.rotation.z = 0.05;
    humanoid.userData["openClinXrRoleSpecificPostureCueIds"] = [
      "oncology_family_emotion_support_pose_cue",
      "case_definition_driven_family_or_interpreter_pose",
    ];
    humanoid.userData["openClinXrScenarioDerivedPosture"] = "oncology_family_emotional_support";
  } else if (scenarioId === "peds_asthma_parent_anxiety_v1") {
    humanoid.userData["openClinXrScenarioDerivedPosture"] = "pediatric_parent_anxiety_support";
  }
}
