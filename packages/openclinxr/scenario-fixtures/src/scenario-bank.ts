import type { Scenario } from "@openclinxr/shared-schemas";
import { edChestPainScenario } from "./ed-chest-pain.js";

export type LearnerScenarioView = Omit<Scenario, "actors"> & {
  actors: Array<Omit<Scenario["actors"][number], "hiddenFacts">>;
};

type DraftScenarioInput = {
  scenarioId: string;
  title: string;
  clinicalObjectives: string[];
  actors: Scenario["actors"];
  requiredTraceTags: string[];
  eventSchedule: Scenario["eventSchedule"];
  reviewRubric: Scenario["reviewRubric"];
  requiredReviewerRoles: string[];
  safetyCriticalTraceTags: string[];
  environment: NonNullable<Scenario["environment"]>;
  equipment: string[];
  assetNeeds: NonNullable<Scenario["assetNeeds"]>;
  syntheticCaseDisclosure: string;
};

function draftScenario(input: DraftScenarioInput): Scenario {
  return {
    scenarioId: input.scenarioId,
    version: 1,
    title: input.title,
    status: "draft",
    review: {
      clinical: "draft",
      psychometric: "draft",
      legal: "draft",
      simulationQa: "draft",
    },
    clinicalObjectives: input.clinicalObjectives,
    actors: input.actors,
    requiredTraceTags: input.requiredTraceTags,
    eventSchedule: input.eventSchedule,
    reviewRubric: input.reviewRubric,
    governance: {
      scoreUseLabel: "formative_local_only",
      syntheticCaseDisclosure: input.syntheticCaseDisclosure,
      validationStage: "stage_0_synthetic_draft",
      validationLimitations: ["Requires specialty clinician, psychometric, legal, and simulation QA review before learner use."],
      requiredReviewerRoles: input.requiredReviewerRoles,
      sourceIds: ["src-openclinxr-sample-case-bank-v1"],
      safetyCriticalTraceTags: input.safetyCriticalTraceTags,
      hiddenFactPolicy: {
        learnerView: "redact_hidden_facts",
        disclosureRequiresTrigger: true,
      },
    },
    environment: input.environment,
    equipment: input.equipment,
    assetNeeds: input.assetNeeds,
  };
}

function actor(
  actorId: string,
  role: Scenario["actors"][number]["role"],
  displayName: string,
  demeanor: string,
  hiddenFacts: string[],
): Scenario["actors"][number] {
  return { actorId, role, displayName, demeanor, hiddenFacts };
}

function rubric(rubricId: string, label: string, requiredTraceTags: string[]): Scenario["reviewRubric"][number] {
  return { rubricId, label, requiredTraceTags };
}

function event(eventId: string, atSecond: number, actorId: string, tag: string): Scenario["eventSchedule"][number] {
  return { eventId, atSecond, actorId, tag };
}

function asset(assetId: string, assetType: string, description: string): NonNullable<Scenario["assetNeeds"]>[number] {
  return { assetId, assetType, description, licenseStatus: "placeholder-approved" };
}

export const pediatricAsthmaScenario: Scenario = {
  scenarioId: "peds_asthma_parent_anxiety_v1",
  version: 1,
  title: "Pediatric Asthma With Parent Anxiety",
  status: "draft",
  review: {
    clinical: "draft",
    psychometric: "draft",
    legal: "draft",
    simulationQa: "draft",
  },
  clinicalObjectives: [
    "Assess pediatric respiratory distress",
    "Elicit asthma trigger and medication history from parent and child",
    "Request oxygen and bronchodilator support",
    "Communicate calmly with an anxious parent",
    "Document urgency and response plan",
  ],
  actors: [
    {
      actorId: "patient_maya_johnson_v1",
      role: "patient",
      displayName: "Maya Johnson",
      demeanor: "short sentences, scared, audible wheeze",
      hiddenFacts: ["Rescue inhaler ran out yesterday", "Symptoms worsened after visiting a relative with cats"],
    },
    {
      actorId: "parent_tara_johnson_v1",
      role: "family",
      displayName: "Tara Johnson",
      demeanor: "anxious, protective, interrupts when respiratory distress is not acknowledged",
      hiddenFacts: ["Has delayed coming in because of transportation issues"],
    },
    {
      actorId: "nurse_kevin_lee_v1",
      role: "nurse",
      displayName: "Kevin Lee",
      demeanor: "focused pediatric urgent-care nurse watching oxygen saturation",
      hiddenFacts: ["Pulse oximetry falls to 91% if oxygen is not requested"],
    },
  ],
  requiredTraceTags: [
    "work_of_breathing_assessment",
    "inhaler_history",
    "trigger_history",
    "oxygen_request",
    "bronchodilator_plan",
    "urgent_escalation",
    "parent_communication",
    "empathy_statement",
    "patient_note_submitted",
  ],
  eventSchedule: [
    {
      eventId: "nurse_spo2_drop",
      atSecond: 300,
      actorId: "nurse_kevin_lee_v1",
      tag: "oxygen_request",
    },
  ],
  reviewRubric: [
    {
      rubricId: "respiratory_assessment",
      label: "Respiratory assessment",
      requiredTraceTags: ["work_of_breathing_assessment", "inhaler_history", "trigger_history"],
    },
    {
      rubricId: "pediatric_escalation",
      label: "Pediatric escalation",
      requiredTraceTags: ["oxygen_request", "bronchodilator_plan", "urgent_escalation"],
    },
    {
      rubricId: "guardian_communication",
      label: "Guardian communication",
      requiredTraceTags: ["parent_communication", "empathy_statement"],
    },
    {
      rubricId: "documentation",
      label: "Patient note",
      requiredTraceTags: ["patient_note_submitted"],
    },
  ],
  governance: {
    scoreUseLabel: "formative_local_only",
    syntheticCaseDisclosure: "Synthetic pediatric communication and urgent-care training draft; not validated for summative assessment.",
    validationStage: "stage_0_synthetic_draft",
    validationLimitations: ["Requires pediatric clinician, psychometric, legal, and simulation QA review before learner use."],
    requiredReviewerRoles: ["pediatrician", "psychometrician", "legal", "simulation_qa"],
    sourceIds: ["src-openclinxr-sample-case-bank-v1"],
    safetyCriticalTraceTags: ["work_of_breathing_assessment", "oxygen_request", "urgent_escalation"],
    hiddenFactPolicy: {
      learnerView: "redact_hidden_facts",
      disclosureRequiresTrigger: true,
    },
  },
  environment: {
    environmentId: "pediatric_urgent_care_bay_v1",
    name: "Pediatric Urgent Care Bay",
    description: "Child-sized urgent-care bay with pulse oximeter, nebulizer setup, parent chair, and pediatric distraction items.",
  },
  equipment: ["pulse oximeter", "nebulizer mask", "oxygen wall port", "pediatric stretcher", "parent chair", "inhaler spacer"],
  assetNeeds: [
    {
      assetId: "patient_maya_johnson_character",
      assetType: "character",
      description: "School-aged child with wheeze, anxious facial animation, and seated respiratory-distress poses",
      licenseStatus: "placeholder-approved",
    },
    {
      assetId: "parent_tara_johnson_character",
      assetType: "character",
      description: "Concerned parent actor with anxious interruption and reassurance response gestures",
      licenseStatus: "placeholder-approved",
    },
    {
      assetId: "pediatric_urgent_care_bay_environment",
      assetType: "environment",
      description: "Quest-optimized pediatric bay with nebulizer, pulse oximeter, oxygen port, and parent seating",
      licenseStatus: "placeholder-approved",
    },
  ],
};

export const psychiatricSafetyScenario: Scenario = {
  scenarioId: "psych_suicidal_ideation_safety_v1",
  version: 1,
  title: "Suicidal Ideation With Safety Planning And Confidentiality",
  status: "draft",
  review: {
    clinical: "draft",
    psychometric: "draft",
    legal: "draft",
    simulationQa: "draft",
  },
  clinicalObjectives: [
    "Ask directly about suicidal ideation, intent, plan, means, and protective factors",
    "Explain confidentiality and safety limits",
    "Create a safe escalation and observation plan",
    "Use empathic, nonjudgmental communication",
    "Document risk assessment and next steps",
  ],
  actors: [
    {
      actorId: "patient_jordan_reed_v1",
      role: "patient",
      displayName: "Jordan Reed",
      demeanor: "withdrawn, tearful, initially guarded",
      hiddenFacts: ["Has thought about overdosing on medication at home", "A close friend died recently"],
    },
    {
      actorId: "partner_sam_reed_v1",
      role: "family",
      displayName: "Sam Reed",
      demeanor: "frightened and asks what can be shared",
      hiddenFacts: ["Found a concerning text message last night"],
    },
    {
      actorId: "behavioral_health_nurse_owens_v1",
      role: "nurse",
      displayName: "Nurse Owens",
      demeanor: "quiet, ready to initiate safety observation",
      hiddenFacts: ["Can arrange one-to-one observation and remove belongings if escalated"],
    },
  ],
  requiredTraceTags: [
    "direct_suicide_question",
    "intent_plan_means_assessment",
    "protective_factors",
    "confidentiality_explanation",
    "suicide_safety_plan",
    "urgent_escalation",
    "empathy_statement",
    "family_communication",
    "patient_note_submitted",
  ],
  eventSchedule: [
    {
      eventId: "partner_confidentiality_pressure",
      atSecond: 360,
      actorId: "partner_sam_reed_v1",
      tag: "confidentiality_explanation",
    },
  ],
  reviewRubric: [
    {
      rubricId: "suicide_risk_assessment",
      label: "Suicide risk assessment",
      requiredTraceTags: ["direct_suicide_question", "intent_plan_means_assessment", "protective_factors"],
    },
    {
      rubricId: "safety_and_confidentiality",
      label: "Safety and confidentiality",
      requiredTraceTags: ["confidentiality_explanation", "suicide_safety_plan", "urgent_escalation"],
    },
    {
      rubricId: "trauma_informed_communication",
      label: "Trauma-informed communication",
      requiredTraceTags: ["empathy_statement", "family_communication"],
    },
    {
      rubricId: "documentation",
      label: "Patient note",
      requiredTraceTags: ["patient_note_submitted"],
    },
  ],
  governance: {
    scoreUseLabel: "formative_local_only",
    syntheticCaseDisclosure: "Synthetic behavioral-health safety draft for local training design only; not validated for assessment or care decisions.",
    validationStage: "stage_0_synthetic_draft",
    validationLimitations: ["Requires psychiatry, legal/privacy, psychometric, and simulation QA review before learner use."],
    requiredReviewerRoles: ["psychiatrist", "psychometrician", "legal", "simulation_qa"],
    sourceIds: ["src-openclinxr-sample-case-bank-v1"],
    safetyCriticalTraceTags: ["direct_suicide_question", "intent_plan_means_assessment", "suicide_safety_plan", "urgent_escalation"],
    hiddenFactPolicy: {
      learnerView: "redact_hidden_facts",
      disclosureRequiresTrigger: true,
    },
  },
  environment: {
    environmentId: "behavioral_health_private_room_v1",
    name: "Behavioral Health Private Interview Room",
    description: "Quiet room with safe furniture, visible door, privacy constraints, and nurse access for safety observation.",
  },
  equipment: ["two chairs", "small table", "panic button", "privacy notice", "observation checklist", "tissue box"],
  assetNeeds: [
    {
      assetId: "patient_jordan_reed_character",
      assetType: "character",
      description: "Adult patient with guarded affect, tearful expressions, and seated body-language variations",
      licenseStatus: "placeholder-approved",
    },
    {
      assetId: "behavioral_health_room_environment",
      assetType: "environment",
      description: "Private behavioral-health room with safe furniture, readable privacy signage, and controlled sightlines",
      licenseStatus: "placeholder-approved",
    },
  ],
};

export const telehealthDiabetesScenario: Scenario = {
  scenarioId: "telehealth_diabetes_health_literacy_v1",
  version: 1,
  title: "Telehealth Diabetes Follow-Up With Health Literacy Barriers",
  status: "draft",
  review: {
    clinical: "draft",
    psychometric: "draft",
    legal: "draft",
    simulationQa: "draft",
  },
  clinicalObjectives: [
    "Reconcile medication use and barriers",
    "Use teach-back for hypoglycemia and medication changes",
    "Address food insecurity and access constraints",
    "Collaboratively create a realistic follow-up plan",
    "Document patient-centered counseling",
  ],
  actors: [
    {
      actorId: "patient_luis_martinez_v1",
      role: "patient",
      displayName: "Luis Martinez",
      demeanor: "polite, embarrassed about not understanding instructions",
      hiddenFacts: ["Sometimes skips medication to save money", "Has trouble reading portal instructions"],
    },
    {
      actorId: "daughter_elena_martinez_v1",
      role: "family",
      displayName: "Elena Martinez",
      demeanor: "helpful but takes over if the clinician ignores the patient",
      hiddenFacts: ["Can help with video visits but is not always available"],
    },
    {
      actorId: "telehealth_system_v1",
      role: "system",
      displayName: "Telehealth Platform",
      demeanor: "intermittent low-bandwidth audio and frozen-video prompts",
      hiddenFacts: ["Connection drops if the learner depends only on visual cues"],
    },
  ],
  requiredTraceTags: [
    "medication_reconciliation",
    "hypoglycemia_education",
    "teach_back",
    "social_determinants_screen",
    "shared_plan",
    "family_communication",
    "patient_note_submitted",
  ],
  eventSchedule: [
    {
      eventId: "telehealth_audio_drop",
      atSecond: 240,
      actorId: "telehealth_system_v1",
      tag: "teach_back",
    },
  ],
  reviewRubric: [
    {
      rubricId: "chronic_care_history",
      label: "Chronic-care medication and barrier history",
      requiredTraceTags: ["medication_reconciliation", "social_determinants_screen"],
    },
    {
      rubricId: "health_literacy_counseling",
      label: "Health-literacy counseling",
      requiredTraceTags: ["hypoglycemia_education", "teach_back", "shared_plan"],
    },
    {
      rubricId: "telehealth_family_workflow",
      label: "Telehealth and family workflow",
      requiredTraceTags: ["family_communication"],
    },
    {
      rubricId: "documentation",
      label: "Patient note",
      requiredTraceTags: ["patient_note_submitted"],
    },
  ],
  governance: {
    scoreUseLabel: "formative_local_only",
    syntheticCaseDisclosure: "Synthetic telehealth chronic-care counseling draft for local formative design only.",
    validationStage: "stage_0_synthetic_draft",
    validationLimitations: ["Requires primary-care, health-literacy, psychometric, legal, and simulation QA review before learner use."],
    requiredReviewerRoles: ["family_medicine", "psychometrician", "legal", "simulation_qa"],
    sourceIds: ["src-openclinxr-sample-case-bank-v1"],
    safetyCriticalTraceTags: ["medication_reconciliation", "hypoglycemia_education", "teach_back"],
    hiddenFactPolicy: {
      learnerView: "redact_hidden_facts",
      disclosureRequiresTrigger: true,
    },
  },
  environment: {
    environmentId: "telehealth_home_visit_v1",
    name: "Telehealth Home Visit",
    description: "Video visit view of patient at home with low-bandwidth interruptions, medication bottles, and caregiver offscreen/on-screen transitions.",
  },
  equipment: ["video visit frame", "simulated EHR panel", "medication bottles", "home glucose log", "low-bandwidth indicator", "caption panel"],
  assetNeeds: [
    {
      assetId: "patient_luis_martinez_character",
      assetType: "character",
      description: "Adult telehealth patient with subtle confusion, teach-back responses, and home environment seated poses",
      licenseStatus: "placeholder-approved",
    },
    {
      assetId: "telehealth_home_environment",
      assetType: "environment",
      description: "Home video-call frame with medication props, captions, and low-bandwidth visual states",
      licenseStatus: "placeholder-approved",
    },
  ],
};

export const wardDeliriumScenario = draftScenario({
  scenarioId: "ward_delirium_med_rec_v1",
  title: "Inpatient Ward Delirium And Medication Reconciliation",
  clinicalObjectives: [
    "Distinguish delirium from baseline cognitive impairment",
    "Obtain collateral history and medication reconciliation",
    "Identify infection and medication adverse-effect clues",
    "Mitigate fall risk and communicate a concise team plan",
  ],
  actors: [
    actor("patient_margaret_ellis_v1", "patient", "Margaret Ellis", "fluctuating confusion, hard of hearing, frail, trying to leave bed", [
      "Recently started diphenhydramine for sleep",
      "Burning urination and frequency are present but not volunteered",
      "Baseline is independent and oriented",
    ]),
    actor("daughter_lena_ellis_v1", "family", "Lena Ellis", "concerned daughter with medication list on phone", [
      "Can provide baseline cognition and home medication list if invited",
    ]),
    actor("ward_nurse_patel_v1", "nurse", "Nurse Patel", "practical ward nurse worried about nighttime agitation and falls", [
      "Patient tried to get out of bed overnight and has poor sleep",
    ]),
    actor("senior_resident_ward_v1", "physician", "Senior Resident", "asks for concise oral summary and safety plan at minute ten", [
      "Wants delirium, medication, infection, and fall-risk priorities",
    ]),
  ],
  requiredTraceTags: [
    "orientation_assessment",
    "collateral_history",
    "medication_reconciliation",
    "infection_symptom_question",
    "fall_risk_action",
    "oral_summary",
    "team_escalation",
    "patient_note_submitted",
  ],
  eventSchedule: [
    event("nurse_fall_risk_update", 240, "ward_nurse_patel_v1", "fall_risk_action"),
    event("daughter_med_list_offer", 360, "daughter_lena_ellis_v1", "medication_reconciliation"),
    event("senior_resident_summary_request", 600, "senior_resident_ward_v1", "oral_summary"),
  ],
  reviewRubric: [
    rubric("delirium_assessment", "Delirium assessment", ["orientation_assessment", "collateral_history"]),
    rubric("medication_and_infection", "Medication and infection clues", ["medication_reconciliation", "infection_symptom_question"]),
    rubric("ward_safety_handoff", "Ward safety and handoff", ["fall_risk_action", "oral_summary", "team_escalation"]),
    rubric("documentation", "Patient note", ["patient_note_submitted"]),
  ],
  requiredReviewerRoles: ["internist", "geriatrician", "psychometrician", "legal", "simulation_qa"],
  safetyCriticalTraceTags: ["orientation_assessment", "fall_risk_action", "team_escalation"],
  environment: {
    environmentId: "inpatient_ward_room_v1",
    name: "Inpatient Medical Ward Room",
    description: "Medical ward room with bed rails, medication cart, IV pump, whiteboard, call bell, fall-risk sign, and EHR laptop.",
  },
  equipment: ["hospital bed", "side rails", "medication cart", "IV pump", "whiteboard", "call bell", "EHR laptop", "fall-risk sign"],
  assetNeeds: [
    asset("patient_margaret_ellis_character", "character", "Older adult with frailty, confusion, hearing difficulty, and bed-exit motion clips"),
    asset("daughter_lena_ellis_character", "character", "Concerned adult daughter with phone medication-list prop"),
    asset("ward_room_environment", "environment", "Ward room with fall-risk signage, bed alarm affordance, medication cart, and EHR laptop"),
  ],
  syntheticCaseDisclosure: "Synthetic inpatient delirium and medication-reconciliation draft; not validated for summative assessment.",
});

export const obPreeclampsiaScenario = draftScenario({
  scenarioId: "ob_headache_preeclampsia_triage_v1",
  title: "OB Triage Headache In Pregnancy",
  clinicalObjectives: [
    "Elicit pregnancy-specific red flags for severe headache",
    "Recognize possible preeclampsia and severe-range blood pressure",
    "Collaborate with OB nursing and escalate urgently",
    "Explain risk to patient and partner respectfully",
  ],
  actors: [
    actor("patient_aisha_khan_v1", "patient", "Aisha Khan", "34 weeks pregnant, worried, headache with visual symptoms", [
      "Headache has persistent pressure quality",
      "Visual spots and swelling are present if asked",
      "First pregnancy and no seizure history",
    ]),
    actor("partner_omar_khan_v1", "family", "Omar Khan", "concerned partner asking about baby and urgency", [
      "Asks about fetal risk if learner does not explain",
    ]),
    actor("ob_nurse_williams_v1", "nurse", "Nurse Williams", "calm OB triage nurse reporting blood pressure and fetal-monitor setup", [
      "Severe-range blood pressure appears at minute five",
    ]),
  ],
  requiredTraceTags: [
    "pregnancy_red_flag_question",
    "bp_review",
    "visual_symptom_question",
    "edema_question",
    "urgent_ob_escalation",
    "patient_partner_explanation",
    "patient_note_submitted",
  ],
  eventSchedule: [
    event("partner_baby_question", 180, "partner_omar_khan_v1", "patient_partner_explanation"),
    event("nurse_severe_bp", 300, "ob_nurse_williams_v1", "bp_review"),
    event("worsening_headache", 480, "patient_aisha_khan_v1", "urgent_ob_escalation"),
  ],
  reviewRubric: [
    rubric("preeclampsia_red_flags", "Pregnancy red flags", ["pregnancy_red_flag_question", "visual_symptom_question", "edema_question"]),
    rubric("ob_escalation", "OB escalation", ["bp_review", "urgent_ob_escalation"]),
    rubric("respectful_explanation", "Patient and partner explanation", ["patient_partner_explanation"]),
    rubric("documentation", "Patient note", ["patient_note_submitted"]),
  ],
  requiredReviewerRoles: ["obgyn", "psychometrician", "legal", "simulation_qa"],
  safetyCriticalTraceTags: ["bp_review", "urgent_ob_escalation"],
  environment: {
    environmentId: "ob_triage_room_v1",
    name: "OB Triage Room",
    description: "OB triage bay with bed, fetal monitor prop, blood-pressure cuff, urine cup, call light, fetal-heart audio placeholder, and privacy curtain.",
  },
  equipment: ["fetal monitor", "blood-pressure cuff", "urine cup", "call light", "privacy curtain", "OB triage bed"],
  assetNeeds: [
    asset("patient_aisha_khan_character", "character", "Pregnant patient with seated/bed posture, headache discomfort, and swelling cues"),
    asset("partner_omar_khan_character", "character", "Concerned partner actor with baby-risk interruption gestures"),
    asset("ob_triage_room_environment", "environment", "Privacy-aware OB triage room with fetal monitor, BP cuff, and call-light affordance"),
  ],
  syntheticCaseDisclosure: "Synthetic OB triage preeclampsia draft; not validated for summative assessment.",
});

export const strokeAlertScenario = draftScenario({
  scenarioId: "ed_stroke_alert_handoff_v1",
  title: "Stroke Alert With Time Pressure And Handoff",
  clinicalObjectives: [
    "Elicit last-known-well and focused stroke history",
    "Recognize neurologic red flags and activate stroke pathway",
    "Communicate with nurse, family, and consultant under time pressure",
    "Deliver concise oral handoff",
  ],
  actors: [
    actor("patient_samuel_brooks_v1", "patient", "Samuel Brooks", "slurred speech, right arm weakness, frustrated by word-finding difficulty", [
      "Last known well was 70 minutes ago",
      "Takes aspirin and blood pressure medication, not anticoagulants",
      "Has diabetes and hypertension",
    ]),
    actor("son_eric_brooks_v1", "family", "Eric Brooks", "anxious son who knows last-known-well and gets frustrated if ignored", [
      "Saw patient normal at breakfast at 7:30",
    ]),
    actor("stroke_nurse_chen_v1", "nurse", "Nurse Chen", "focused stroke nurse asking for last-known-well and glucose", [
      "Needs concise facts for stroke-team activation",
    ]),
    actor("neurology_consultant_phone_v1", "consultant", "Neurology Consultant", "phone consultant asking for age, deficits, last-known-well, anticoagulants, and glucose", [
      "Will push back if handoff omits anticoagulants or glucose",
    ]),
  ],
  requiredTraceTags: [
    "last_known_well",
    "focused_neuro_assessment",
    "anticoagulant_question",
    "glucose_or_vitals_review",
    "stroke_team_activation",
    "oral_handoff",
    "family_communication",
    "patient_note_submitted",
  ],
  eventSchedule: [
    event("nurse_last_known_well_prompt", 120, "stroke_nurse_chen_v1", "last_known_well"),
    event("son_frustration", 300, "son_eric_brooks_v1", "family_communication"),
    event("consultant_handoff_request", 480, "neurology_consultant_phone_v1", "oral_handoff"),
  ],
  reviewRubric: [
    rubric("stroke_history", "Stroke history", ["last_known_well", "anticoagulant_question"]),
    rubric("neuro_assessment", "Neurologic assessment", ["focused_neuro_assessment", "glucose_or_vitals_review"]),
    rubric("activation_and_handoff", "Activation and handoff", ["stroke_team_activation", "oral_handoff", "family_communication"]),
    rubric("documentation", "Patient note", ["patient_note_submitted"]),
  ],
  requiredReviewerRoles: ["neurologist", "emergency_physician", "psychometrician", "legal", "simulation_qa"],
  safetyCriticalTraceTags: ["last_known_well", "stroke_team_activation", "oral_handoff"],
  environment: {
    environmentId: "ed_stroke_bay_v1",
    name: "ED Stroke Bay",
    description: "ED hallway-to-stroke-bay setting with bed, monitor, wall clock, CT direction sign, neuro exam props, and family chair.",
  },
  equipment: ["wall clock", "bedside monitor", "CT direction sign", "glucose meter", "neuro exam card", "family chair"],
  assetNeeds: [
    asset("patient_samuel_brooks_character", "character", "Older adult with facial droop, right-arm weakness pose, and slurred-speech audio style"),
    asset("son_eric_brooks_character", "character", "Anxious son actor for last-known-well and family-pressure interactions"),
    asset("ed_stroke_bay_environment", "environment", "Stroke bay with wall clock, CT sign, monitor, and neuro exam props"),
  ],
  syntheticCaseDisclosure: "Synthetic stroke-alert handoff draft; not validated for summative assessment.",
});

export const stepdownSepsisScenario = draftScenario({
  scenarioId: "stepdown_sepsis_nurse_escalation_v1",
  title: "Sepsis In ICU Stepdown With Nurse Escalation",
  clinicalObjectives: [
    "Recognize sepsis and clinical deterioration",
    "Review vital-sign trends and infection source clues",
    "Communicate priorities with nurse and respiratory therapist",
    "Initiate early management plan and document urgency",
  ],
  actors: [
    actor("patient_helen_carter_v1", "patient", "Helen Carter", "feverish, confused, shivering, short of breath", [
      "Sepsis from pneumonia is possible",
      "Penicillin allergy was a childhood rash",
      "Productive cough and hypotension trend are present",
    ]),
    actor("stepdown_nurse_rivera_v1", "nurse", "Nurse Rivera", "worried, assertive, reports worsening vitals", [
      "Blood pressure dropped compared with one hour ago",
    ]),
    actor("respiratory_therapist_ng_v1", "respiratory_therapist", "Respiratory Therapist Ng", "asks for respiratory priorities when oxygen saturation falls", [
      "Can escalate oxygen support if learner prioritizes it",
    ]),
  ],
  requiredTraceTags: [
    "sepsis_recognition",
    "vitals_trend_review",
    "infection_source_question",
    "allergy_question",
    "team_priority_communication",
    "initial_management_plan",
    "patient_note_submitted",
  ],
  eventSchedule: [
    event("nurse_bp_drop", 180, "stepdown_nurse_rivera_v1", "vitals_trend_review"),
    event("oxygen_saturation_drop", 360, "patient_helen_carter_v1", "team_priority_communication"),
    event("rt_priority_request", 540, "respiratory_therapist_ng_v1", "initial_management_plan"),
  ],
  reviewRubric: [
    rubric("sepsis_detection", "Sepsis detection", ["sepsis_recognition", "vitals_trend_review"]),
    rubric("source_and_allergy", "Source and allergy", ["infection_source_question", "allergy_question"]),
    rubric("team_management", "Team management", ["team_priority_communication", "initial_management_plan"]),
    rubric("documentation", "Patient note", ["patient_note_submitted"]),
  ],
  requiredReviewerRoles: ["critical_care_physician", "infectious_disease_physician", "psychometrician", "legal", "simulation_qa"],
  safetyCriticalTraceTags: ["sepsis_recognition", "vitals_trend_review", "initial_management_plan"],
  environment: {
    environmentId: "stepdown_room_v1",
    name: "ICU Stepdown Room",
    description: "Stepdown room with monitor, IV pump, oxygen, blood-culture kit prop, medication cart, and sepsis alert panel.",
  },
  equipment: ["monitor", "IV pump", "oxygen cannula", "blood-culture kit", "medication cart", "sepsis alert panel"],
  assetNeeds: [
    asset("patient_helen_carter_character", "character", "Feverish confused patient with oxygen cannula, shivering, and dyspnea cues"),
    asset("stepdown_nurse_rivera_character", "character", "Assertive stepdown nurse with urgent body language"),
    asset("stepdown_room_environment", "environment", "Stepdown room with changing monitor vitals, oxygen, IV props, and sepsis alert panel"),
  ],
  syntheticCaseDisclosure: "Synthetic sepsis deterioration draft; not validated for summative assessment.",
});

export const abdominalPainInterpreterScenario = draftScenario({
  scenarioId: "clinic_abdominal_pain_interpreter_v1",
  title: "Abdominal Pain With Parent Interpreter Issue",
  clinicalObjectives: [
    "Elicit migratory abdominal pain and associated symptoms",
    "Use a qualified interpreter and manage family dynamics",
    "Establish privacy for sensitive adolescent history",
    "Recognize surgical red flags and document escalation",
  ],
  actors: [
    actor("patient_lucia_morales_v1", "patient", "Lucia Morales", "quiet teen with guarded posture and right-lower-quadrant pain", [
      "Pain migrated from periumbilical area to right lower quadrant",
      "Nausea and decreased appetite are present",
      "Sensitive history requires privacy",
    ]),
    actor("father_carlos_morales_v1", "family", "Carlos Morales", "Spanish-speaking father who tries to answer for patient", [
      "Believes patient ate something bad and may resist private history",
    ]),
    actor("remote_interpreter_tablet_v1", "interpreter", "Remote Interpreter", "neutral interpreter through tablet UI", [
      "Will interpret everything said in the room when requested",
    ]),
  ],
  requiredTraceTags: [
    "pain_migration_question",
    "associated_gi_symptoms",
    "privacy_request",
    "interpreter_use",
    "surgical_red_flag_recognition",
    "abdominal_exam_action",
    "patient_note_submitted",
  ],
  eventSchedule: [
    event("father_answers_for_patient", 180, "father_carlos_morales_v1", "interpreter_use"),
    event("interpreter_available", 360, "remote_interpreter_tablet_v1", "interpreter_use"),
    event("private_sensitive_detail", 540, "patient_lucia_morales_v1", "privacy_request"),
  ],
  reviewRubric: [
    rubric("abdominal_history", "Abdominal history", ["pain_migration_question", "associated_gi_symptoms"]),
    rubric("communication_and_privacy", "Interpreter and privacy", ["privacy_request", "interpreter_use"]),
    rubric("surgical_red_flags", "Surgical red flags", ["surgical_red_flag_recognition", "abdominal_exam_action"]),
    rubric("documentation", "Patient note", ["patient_note_submitted"]),
  ],
  requiredReviewerRoles: ["surgeon", "pediatrician", "legal", "psychometrician", "simulation_qa"],
  safetyCriticalTraceTags: ["privacy_request", "interpreter_use", "surgical_red_flag_recognition"],
  environment: {
    environmentId: "urgent_care_clinic_room_v1",
    name: "Urgent Care Clinic Room",
    description: "Urgent care room with exam table, stool, abdominal exam zone, tablet interpreter station, and vitals panel.",
  },
  equipment: ["exam table", "abdominal exam zone", "tablet interpreter station", "vitals panel", "privacy curtain"],
  assetNeeds: [
    asset("patient_lucia_morales_character", "character", "Teen patient with guarded posture, abdominal pain flinch, and quiet affect"),
    asset("father_carlos_morales_character", "character", "Concerned father actor for interpreter and family-dynamics pressure"),
    asset("urgent_care_clinic_room_environment", "environment", "Urgent care clinic room with tablet interpreter UI and abdominal exam affordance"),
  ],
  syntheticCaseDisclosure: "Synthetic abdominal-pain interpreter-use draft; not validated for summative assessment.",
});

export const oncologyBadNewsScenario = draftScenario({
  scenarioId: "oncology_bad_news_family_v1",
  title: "Breaking Bad News In Oncology Clinic",
  clinicalObjectives: [
    "Deliver serious news using plain language",
    "Pause for emotion and respond empathically",
    "Check understanding and discuss next steps",
    "Support family presence while centering the patient",
  ],
  actors: [
    actor("patient_david_miller_v1", "patient", "David Miller", "anxious, awaiting biopsy results, hopes it is inflammation", [
      "Biopsy shows pancreatic adenocarcinoma",
      "Wants plain language and time to process",
    ]),
    actor("sister_rachel_miller_v1", "family", "Rachel Miller", "quiet supportive sister who becomes tearful", [
      "Will ask about next steps after patient absorbs diagnosis",
    ]),
  ],
  requiredTraceTags: [
    "warning_shot",
    "plain_language_diagnosis",
    "pause_for_emotion",
    "empathy_statement",
    "check_understanding",
    "next_steps_discussion",
    "patient_note_submitted",
  ],
  eventSchedule: [
    event("patient_direct_cancer_question", 240, "patient_david_miller_v1", "plain_language_diagnosis"),
    event("sister_next_steps", 420, "sister_rachel_miller_v1", "next_steps_discussion"),
    event("patient_silence_if_abrupt", 660, "patient_david_miller_v1", "pause_for_emotion"),
  ],
  reviewRubric: [
    rubric("bad_news_delivery", "Bad news delivery", ["warning_shot", "plain_language_diagnosis", "pause_for_emotion"]),
    rubric("empathy_and_understanding", "Empathy and understanding", ["empathy_statement", "check_understanding"]),
    rubric("planning", "Next steps", ["next_steps_discussion"]),
    rubric("documentation", "Patient note", ["patient_note_submitted"]),
  ],
  requiredReviewerRoles: ["oncologist", "palliative_care_clinician", "psychometrician", "legal", "simulation_qa"],
  safetyCriticalTraceTags: ["plain_language_diagnosis", "pause_for_emotion", "next_steps_discussion"],
  environment: {
    environmentId: "oncology_consult_room_v1",
    name: "Oncology Consultation Room",
    description: "Calm oncology room with desk, chairs, tissue box, imaging report panel, and subdued lighting.",
  },
  equipment: ["chairs", "tissue box", "imaging report panel", "consultation desk", "soft lighting"],
  assetNeeds: [
    asset("patient_david_miller_character", "character", "Seated anxious patient with hand-wringing, stunned silence, and grief-response animations"),
    asset("sister_rachel_miller_character", "character", "Supportive sister actor with tearful listening and next-step question gestures"),
    asset("oncology_consult_room_environment", "environment", "Consult room with tissue box, report panel, and calm lighting"),
  ],
  syntheticCaseDisclosure: "Synthetic oncology communication draft; not validated for summative assessment.",
});

export const postopFeverScenario = draftScenario({
  scenarioId: "postop_fever_consult_pressure_v1",
  title: "Postoperative Fever With Surgical Consultant Pressure",
  clinicalObjectives: [
    "Develop focused postoperative fever differential",
    "Ask about wound, respiratory, device, urinary, and thrombotic clues",
    "Manage consultant pressure with concise handoff",
    "Communicate uncertainty and document next steps",
  ],
  actors: [
    actor("patient_priya_shah_v1", "patient", "Priya Shah", "post-op day 2, feverish, sore, worried about another surgery", [
      "Mild cough and poor incentive spirometer use",
      "Wound pain without obvious purulence unless examined",
      "Foley was removed yesterday",
    ]),
    actor("floor_nurse_bennett_v1", "nurse", "Nurse Bennett", "floor nurse reporting fever and asking about cultures", [
      "Needs orders and prioritization if learner hesitates",
    ]),
    actor("surgery_resident_kim_v1", "consultant", "Surgery Resident Kim", "impatient consultant asking for concise assessment", [
      "Wants differential and what the learner needs from surgery",
    ]),
  ],
  requiredTraceTags: [
    "postop_day_identified",
    "focused_fever_differential",
    "wound_symptom_question",
    "respiratory_symptom_question",
    "device_catheter_question",
    "consult_handoff",
    "patient_note_submitted",
  ],
  eventSchedule: [
    event("nurse_culture_question", 240, "floor_nurse_bennett_v1", "focused_fever_differential"),
    event("resident_interrupts", 480, "surgery_resident_kim_v1", "consult_handoff"),
    event("patient_surgery_fear", 660, "patient_priya_shah_v1", "consult_handoff"),
  ],
  reviewRubric: [
    rubric("postop_fever_differential", "Postoperative fever differential", ["postop_day_identified", "focused_fever_differential"]),
    rubric("focused_history", "Focused history", ["wound_symptom_question", "respiratory_symptom_question", "device_catheter_question"]),
    rubric("consult_communication", "Consult communication", ["consult_handoff"]),
    rubric("documentation", "Patient note", ["patient_note_submitted"]),
  ],
  requiredReviewerRoles: ["surgeon", "internist", "psychometrician", "legal", "simulation_qa"],
  safetyCriticalTraceTags: ["focused_fever_differential", "consult_handoff"],
  environment: {
    environmentId: "surgical_ward_room_v1",
    name: "Surgical Ward Room",
    description: "Post-op ward room with abdominal dressing, drain, incentive spirometer, vitals board, medication list, and IV props.",
  },
  equipment: ["post-op bed", "abdominal dressing", "drain", "incentive spirometer", "vitals board", "medication list"],
  assetNeeds: [
    asset("patient_priya_shah_character", "character", "Postoperative patient with abdominal dressing, limited movement, and fever discomfort"),
    asset("floor_nurse_bennett_character", "character", "Floor nurse with vitals tablet and blood-culture pressure"),
    asset("surgical_ward_room_environment", "environment", "Surgical ward room with post-op props, drain, and incentive spirometer"),
  ],
  syntheticCaseDisclosure: "Synthetic postoperative fever draft; not validated for summative assessment.",
});

export const primaryCareDyslipidemiaScenario = draftScenario({
  scenarioId: "primary_care_dyslipidemia_joint_pain_v1",
  title: "Dyslipidemia And Joint Pain Primary Care Visit",
  clinicalObjectives: [
    "Characterize chronic joint pain and screen inflammatory red flags",
    "Explore statin adherence and medication fears",
    "Counsel cardiovascular risk with shared decision-making",
    "Address work and diet constraints in a longitudinal plan",
  ],
  actors: [
    actor("patient_mario_guzman_v1", "patient", "Mario Guzman", "construction worker with knee and hand pain, worried about cholesterol medication", [
      "Stopped statin because of muscle-pain fear",
      "Joint pain pattern is more consistent with osteoarthritis",
      "Diet is shaped by quick food near job sites",
    ]),
    actor("medical_assistant_jones_v1", "medical_assistant", "Medical Assistant Jones", "optional vitals and lab handoff", [
      "Can surface EHR lab panel at minute eight",
    ]),
  ],
  requiredTraceTags: [
    "joint_pain_characterization",
    "inflammatory_red_flag_question",
    "medication_adherence_question",
    "risk_counseling",
    "shared_decision_making",
    "documentation",
  ],
  eventSchedule: [
    event("statin_fear_question", 300, "patient_mario_guzman_v1", "medication_adherence_question"),
    event("ehr_labs_available", 480, "medical_assistant_jones_v1", "risk_counseling"),
    event("stronger_pain_med_request", 660, "patient_mario_guzman_v1", "shared_decision_making"),
  ],
  reviewRubric: [
    rubric("joint_pain_history", "Joint pain history", ["joint_pain_characterization", "inflammatory_red_flag_question"]),
    rubric("risk_and_adherence", "Risk and adherence", ["medication_adherence_question", "risk_counseling"]),
    rubric("shared_plan", "Shared decision-making", ["shared_decision_making"]),
    rubric("documentation", "Documentation", ["documentation"]),
  ],
  requiredReviewerRoles: ["family_physician", "rheumatologist", "psychometrician", "legal", "simulation_qa"],
  safetyCriticalTraceTags: ["medication_adherence_question", "risk_counseling"],
  environment: {
    environmentId: "primary_care_clinic_room_v1",
    name: "Primary Care Clinic Room",
    description: "Primary care room with exam table, chairs, EHR screen, lab results, joint diagram, and medication list.",
  },
  equipment: ["EHR screen", "lab results panel", "joint diagram", "medication list", "exam table", "chairs"],
  assetNeeds: [
    asset("patient_mario_guzman_character", "character", "Middle-aged construction worker with hand and knee pain gestures"),
    asset("primary_care_room_environment", "environment", "Clinic room with EHR labs, joint diagram, and medication-list panel"),
  ],
  syntheticCaseDisclosure: "Synthetic primary-care dyslipidemia and joint-pain draft; not validated for summative assessment.",
});

export const scenarioBank = [
  edChestPainScenario,
  pediatricAsthmaScenario,
  wardDeliriumScenario,
  telehealthDiabetesScenario,
  obPreeclampsiaScenario,
  psychiatricSafetyScenario,
  strokeAlertScenario,
  stepdownSepsisScenario,
  abdominalPainInterpreterScenario,
  oncologyBadNewsScenario,
  postopFeverScenario,
  primaryCareDyslipidemiaScenario,
] as const satisfies readonly Scenario[];

export type ScenarioBankMaturityReport = {
  scenarioCount: number;
  targetScenarioCount: number;
  missingScenarioCount: number;
  statusCounts: Record<Scenario["status"], number>;
  validationStageCounts: Record<Scenario["governance"]["validationStage"], number>;
  activationEligibleScenarioIds: string[];
  blockedScenarioIds: Array<{ scenarioId: string; reason: "not_approved" | "governance_not_ready" }>;
  clinicalSettings: string[];
  actorRoleCoverage: string[];
  safetyCriticalTraceTags: string[];
  hiddenFactPolicy: {
    redactsAll: boolean;
    requiresTriggerForAll: boolean;
  };
  fixtureCompleteness: {
    completeScenarioIds: string[];
    incompleteScenarioIds: Array<{ scenarioId: string; blockers: string[] }>;
    requiredActorRoles: string[];
    missingRequiredActorRoles: string[];
  };
};

const targetStep2CsStyleStationCount = 12;
const requiredCaseBankActorRoles = [
  "consultant",
  "family",
  "interpreter",
  "medical_assistant",
  "nurse",
  "patient",
  "physician",
  "respiratory_therapist",
  "system",
] as const;

export function evaluateScenarioBankMaturity(scenarios: readonly Scenario[]): ScenarioBankMaturityReport {
  const activationEligibleScenarioIds: string[] = [];
  const blockedScenarioIds: ScenarioBankMaturityReport["blockedScenarioIds"] = [];
  const actorRoleCoverage = uniqueSorted(scenarios.flatMap((scenario) => scenario.actors.map((actor) => actor.role)));
  const incompleteScenarioIds = scenarios
    .map((scenario) => ({ scenarioId: scenario.scenarioId, blockers: scenarioFixtureCompletenessBlockers(scenario) }))
    .filter((result) => result.blockers.length > 0);

  for (const scenario of scenarios) {
    if (isActivationEligible(scenario)) {
      activationEligibleScenarioIds.push(scenario.scenarioId);
    } else {
      blockedScenarioIds.push({
        scenarioId: scenario.scenarioId,
        reason: scenario.status !== "approved" ? "not_approved" : "governance_not_ready",
      });
    }
  }

  return {
    scenarioCount: scenarios.length,
    targetScenarioCount: targetStep2CsStyleStationCount,
    missingScenarioCount: Math.max(targetStep2CsStyleStationCount - scenarios.length, 0),
    statusCounts: countBy(["approved", "draft", "retired"], scenarios.map((scenario) => scenario.status)),
    validationStageCounts: countBy(
      ["stage_0_synthetic_draft", "stage_1_expert_reviewed", "stage_2_pilot_ready", "stage_3_validated"],
      scenarios.map((scenario) => scenario.governance.validationStage),
    ),
    activationEligibleScenarioIds,
    blockedScenarioIds,
    clinicalSettings: uniqueSorted(scenarios.map((scenario) => scenario.environment?.environmentId).filter((value): value is string => Boolean(value))),
    actorRoleCoverage,
    safetyCriticalTraceTags: uniqueSorted(scenarios.flatMap((scenario) => scenario.governance.safetyCriticalTraceTags)),
    hiddenFactPolicy: {
      redactsAll: scenarios.every((scenario) => scenario.governance.hiddenFactPolicy.learnerView === "redact_hidden_facts"),
      requiresTriggerForAll: scenarios.every((scenario) => scenario.governance.hiddenFactPolicy.disclosureRequiresTrigger),
    },
    fixtureCompleteness: {
      completeScenarioIds: scenarios
        .filter((scenario) => !incompleteScenarioIds.some((result) => result.scenarioId === scenario.scenarioId))
        .map((scenario) => scenario.scenarioId),
      incompleteScenarioIds,
      requiredActorRoles: [...requiredCaseBankActorRoles],
      missingRequiredActorRoles: requiredCaseBankActorRoles.filter((role) => !actorRoleCoverage.includes(role)),
    },
  };
}

export function createLearnerScenarioView(scenario: Scenario): LearnerScenarioView {
  return {
    ...scenario,
    actors: scenario.actors.map(({ hiddenFacts: _hiddenFacts, ...actor }) => actor),
  };
}

function isActivationEligible(scenario: Scenario): boolean {
  return scenario.status === "approved"
    && Object.values(scenario.review).every((state) => state === "approved")
    && scenario.governance.validationStage !== "stage_0_synthetic_draft"
    && scenario.governance.scoreUseLabel !== "validated_summative";
}

function scenarioFixtureCompletenessBlockers(scenario: Scenario): string[] {
  const assetNeeds = scenario.assetNeeds ?? [];
  const assetTypes = new Set(assetNeeds.map((assetNeed) => assetNeed.assetType));
  const actorRoles = new Set(scenario.actors.map((actor) => actor.role));
  const blockers = [
    scenario.actors.length >= 2 ? undefined : "actors_under_2",
    actorRoles.has("patient") ? undefined : "missing_patient_actor",
    scenario.eventSchedule.length > 0 ? undefined : "missing_event_schedule",
    scenario.reviewRubric.length >= 4 ? undefined : "review_rubric_under_4",
    assetTypes.has("character") ? undefined : "missing_character_asset",
    assetTypes.has("environment") ? undefined : "missing_environment_asset",
    scenario.governance.sourceIds.length > 0 ? undefined : "missing_governance_source",
    scenario.governance.requiredReviewerRoles.length >= 4 ? undefined : "missing_review_governance_roles",
    scenario.governance.safetyCriticalTraceTags.length > 0 ? undefined : "missing_safety_critical_trace_tags",
  ];

  return blockers.filter((blocker): blocker is string => typeof blocker === "string");
}

function countBy<T extends string>(knownValues: readonly T[], values: readonly T[]): Record<T, number> {
  const counts = Object.fromEntries(knownValues.map((value) => [value, 0])) as Record<T, number>;
  for (const value of values) {
    counts[value] += 1;
  }
  return counts;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
