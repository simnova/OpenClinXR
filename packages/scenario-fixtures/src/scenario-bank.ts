import type { Scenario } from "@openclinxr/shared-schemas";
import { edChestPainScenario } from "./ed-chest-pain.js";

export type LearnerScenarioView = Omit<Scenario, "actors"> & {
  actors: Array<Omit<Scenario["actors"][number], "hiddenFacts">>;
};

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

export const scenarioBank = [
  edChestPainScenario,
  pediatricAsthmaScenario,
  psychiatricSafetyScenario,
  telehealthDiabetesScenario,
] as const satisfies readonly Scenario[];

export type ScenarioBankMaturityReport = {
  scenarioCount: number;
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
};

export function evaluateScenarioBankMaturity(scenarios: readonly Scenario[]): ScenarioBankMaturityReport {
  const activationEligibleScenarioIds: string[] = [];
  const blockedScenarioIds: ScenarioBankMaturityReport["blockedScenarioIds"] = [];

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
    statusCounts: countBy(["approved", "draft", "retired"], scenarios.map((scenario) => scenario.status)),
    validationStageCounts: countBy(
      ["stage_0_synthetic_draft", "stage_1_expert_reviewed", "stage_2_pilot_ready", "stage_3_validated"],
      scenarios.map((scenario) => scenario.governance.validationStage),
    ),
    activationEligibleScenarioIds,
    blockedScenarioIds,
    clinicalSettings: uniqueSorted(scenarios.map((scenario) => scenario.environment?.environmentId).filter((value): value is string => Boolean(value))),
    actorRoleCoverage: uniqueSorted(scenarios.flatMap((scenario) => scenario.actors.map((actor) => actor.role))),
    safetyCriticalTraceTags: uniqueSorted(scenarios.flatMap((scenario) => scenario.governance.safetyCriticalTraceTags)),
    hiddenFactPolicy: {
      redactsAll: scenarios.every((scenario) => scenario.governance.hiddenFactPolicy.learnerView === "redact_hidden_facts"),
      requiresTriggerForAll: scenarios.every((scenario) => scenario.governance.hiddenFactPolicy.disclosureRequiresTrigger),
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
