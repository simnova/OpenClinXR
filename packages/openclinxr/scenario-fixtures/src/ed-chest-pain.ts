import type { Scenario } from "@openclinxr/shared-schemas";

export const edChestPainScenario: Scenario = {
  scenarioId: "ed_chest_pain_priority_v1",
  version: 1,
  title: "ED Chest Pain With Nurse Interruption And Family Pressure",
  status: "approved",
  review: {
    clinical: "approved",
    psychometric: "approved",
    legal: "approved",
    simulationQa: "approved",
  },
  clinicalObjectives: [
    "Elicit focused chest pain history and risk factors",
    "Recognize possible acute coronary syndrome",
    "Request ECG and urgent escalation",
    "Communicate clearly with nurse, patient, and family",
    "Document a concise patient note",
  ],
  actors: [
    {
      actorId: "patient_robert_hayes_v1",
      role: "patient",
      displayName: "Robert Hayes",
      demeanor: "anxious, diaphoretic, protective of chest",
      hiddenFacts: ["Pain started while walking upstairs", "Father died of myocardial infarction at 54"],
    },
    {
      actorId: "spouse_anna_hayes_v1",
      role: "family",
      displayName: "Anna Hayes",
      demeanor: "worried and interrupting when she feels ignored",
      hiddenFacts: ["Knows patient skipped blood pressure medication this week"],
    },
    {
      actorId: "nurse_maria_alvarez_v1",
      role: "nurse",
      displayName: "Maria Alvarez",
      demeanor: "focused, direct, escalating concern as vitals change",
      hiddenFacts: ["Repeat blood pressure is falling and patient looks worse at minute seven"],
    },
  ],
  requiredTraceTags: [
    "history_opqrst",
    "risk_factor_question",
    "associated_symptom_question",
    "vitals_review",
    "ecg_request",
    "urgent_escalation",
    "team_communication",
    "family_communication",
    "empathy_statement",
    "patient_note_submitted",
  ],
  eventSchedule: [
    {
      eventId: "nurse_vitals_change",
      atSecond: 420,
      actorId: "nurse_maria_alvarez_v1",
      tag: "vitals_review",
    },
  ],
  reviewRubric: [
    {
      rubricId: "history_focus",
      label: "Focused history",
      requiredTraceTags: ["history_opqrst", "risk_factor_question", "associated_symptom_question"],
    },
    {
      rubricId: "urgent_recognition",
      label: "Urgent recognition and escalation",
      requiredTraceTags: ["vitals_review", "ecg_request", "urgent_escalation"],
    },
    {
      rubricId: "communication_team_family",
      label: "Team and family communication",
      requiredTraceTags: ["team_communication", "family_communication", "empathy_statement"],
    },
    {
      rubricId: "documentation",
      label: "Patient note",
      requiredTraceTags: ["patient_note_submitted"],
    },
  ],
  governance: {
    scoreUseLabel: "formative_local_only",
    syntheticCaseDisclosure: "Synthetic local training scenario inspired by public clinical-skills exam patterns; not a validated summative assessment.",
    validationStage: "stage_1_expert_reviewed",
    validationLimitations: [
      "No learner-outcome, reliability, fairness, generalizability, or consequence-validity evidence exists for score use.",
      "Current approvals mean fixture completeness for prototype development, not production clinical assessment validity.",
    ],
    requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
    sourceIds: ["src-step2cs-public-archive", "src-ama-clinical-skills-competencies", "src-llm-vsp-literature-2025"],
    safetyCriticalTraceTags: ["vitals_review", "ecg_request", "urgent_escalation", "team_communication"],
    hiddenFactPolicy: {
      learnerView: "redact_hidden_facts",
      disclosureRequiresTrigger: true,
    },
  },
  environment: {
    environmentId: "ed_exam_bay_v1",
    name: "Emergency Department Exam Bay",
    description: "Curtained ED bay with stretcher, bedside monitor, ECG cart nearby, and hallway interruptions.",
  },
  equipment: ["12-lead ECG machine", "bedside monitor", "stretcher", "IV pole", "oxygen nasal cannula", "wall clock"],
  assetNeeds: [
    {
      assetId: "patient_robert_hayes_character",
      assetType: "character",
      description: "Middle-aged patient in hospital gown with anxious expression and chest discomfort poses",
      licenseStatus: "placeholder-approved",
    },
    {
      assetId: "nurse_maria_alvarez_character",
      assetType: "character",
      description: "ED nurse with badge, scrubs, clipboard/tablet, and urgent escalation gestures",
      licenseStatus: "placeholder-approved",
    },
    {
      assetId: "ed_exam_bay_environment",
      assetType: "environment",
      description: "Optimized Quest 3 ED bay with monitor, ECG cart, stretcher, and readable doorway panel",
      licenseStatus: "placeholder-approved",
    },
  ],
};
