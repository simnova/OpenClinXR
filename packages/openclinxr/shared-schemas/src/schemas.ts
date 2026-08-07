import { type Static, Type } from "@sinclair/typebox";

export const ReviewGateStateSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("in_review"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
]);

export const ScenarioStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("approved"),
  Type.Literal("retired"),
]);

export const ActorRoleSchema = Type.Union([
  Type.Literal("patient"),
  Type.Literal("family"),
  Type.Literal("nurse"),
  Type.Literal("physician"),
  Type.Literal("consultant"),
  Type.Literal("interpreter"),
  Type.Literal("medical_assistant"),
  Type.Literal("respiratory_therapist"),
  Type.Literal("system"),
]);

export const CommunicationProfileSchema = Type.Object({
  styleFamily: Type.Union([
    Type.Literal("satir"),
    Type.Literal("custom"),
  ]),
  style: Type.Union([
    Type.Literal("congruent"),
    Type.Literal("accuser"),
    Type.Literal("rationalizer"),
    Type.Literal("appeaser"),
    Type.Literal("distractor"),
    Type.Literal("withdrawn_guarded"),
    Type.Literal("angry_family_member"),
    Type.Literal("custom"),
  ]),
  intensity: Type.Number({ minimum: 0, maximum: 1 }),
  baselineMood: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  communicativeness: Type.String({ minLength: 1 }),
  topicsToAvoid: Type.Array(Type.String({ minLength: 1 })),
  adverseResponse: Type.String({ minLength: 1 }),
  deescalationTriggers: Type.Array(Type.String({ minLength: 1 })),
  escalationTriggers: Type.Array(Type.String({ minLength: 1 })),
  culturalLanguageNotes: Type.Array(Type.String({ minLength: 1 })),
});

/**
 * Body region a physician can touch/examine. Vocabulary mirrors the
 * physics-touch-contract `ComplianceRegion` so the same case config can later
 * drive live physics behind the same interaction trigger.
 */
export const ComplianceRegionSchema = Type.Union([
  Type.Literal("abdomen_ruq"),
  Type.Literal("abdomen_rlq"),
  Type.Literal("abdomen_luq"),
  Type.Literal("abdomen_llq"),
  Type.Literal("abdomen_epigastric"),
  Type.Literal("abdomen_suprapubic"),
  Type.Literal("chest_R"),
  Type.Literal("chest_L"),
  Type.Literal("neck_anterior"),
  Type.Literal("neck_posterior"),
]);

/**
 * Emotions the runtime expression system can transition to
 * (`expressionWeightsForEmotion` in apps/ui-xr/src/main.ts).
 */
export const InteractionEmotionSchema = Type.Union([
  Type.Literal("pain"),
  Type.Literal("anxious"),
  Type.Literal("concerned"),
  Type.Literal("reassured"),
  Type.Literal("neutral"),
]);

export const EmotionEventKindSchema = Type.Union([
  Type.Literal("learner_empathetic"),
  Type.Literal("learner_dismissive"),
  Type.Literal("learner_interruption"),
  Type.Literal("actor_silence_timeout"),
  Type.Literal("learner_acknowledgement"),
  Type.Literal("learner_clinical_question"),
  Type.Literal("learner_personal_question"),
]);

export const EmotionTransitionRuleSchema = Type.Object({
  from: InteractionEmotionSchema,
  triggeredBy: EmotionEventKindSchema,
  to: InteractionEmotionSchema,
});

export const CaseEmotionPolicySchema = Type.Object({
  baseline: InteractionEmotionSchema,
  upperBound: InteractionEmotionSchema,
  lowerBound: InteractionEmotionSchema,
  transitions: Type.Array(EmotionTransitionRuleSchema),
});

/**
 * Case-driven examinee-touch response for one body region. When the examinee
 * touches `region`, the runtime plays `responseClip`, transitions emotion via
 * `emotionEventId`/`emotion`, speaks `dialogueLine`, and records `traceTag`.
 * `notEvidenceFor` clinical validity — this is interaction behavior, not a finding.
 */
export const TouchResponseSchema = Type.Object({
  region: ComplianceRegionSchema,
  responseKind: Type.Union([
    Type.Literal("guarding"),
    Type.Literal("palpation"),
    Type.Literal("passive_rom"),
    Type.Literal("positioning"),
  ]),
  forceThreshold: Type.Number({ minimum: 0, maximum: 1 }),
  emotionEventId: Type.String({ minLength: 1 }),
  emotion: InteractionEmotionSchema,
  responseClip: Type.String({ minLength: 1 }),
  dialogueLine: Type.String({ minLength: 1 }),
  traceTag: Type.String({ minLength: 1 }),
});

/**
 * Optional per-actor body-mechanics interaction config (additive). Mirrors the
 * physics-touch-contract `PhenotypeBodyMechanics` habitus and supplies the
 * runtime touch-response map. Absence = no touch interactions, so every existing
 * case remains valid without change.
 */
export const BodyMechanicsSchema = Type.Object({
  habitus: Type.Optional(
    Type.Union([Type.Literal("average"), Type.Literal("obese"), Type.Literal("frail")]),
  ),
  touchResponses: Type.Array(TouchResponseSchema),
});

export const ActorCardSchema = Type.Object({
  actorId: Type.String({ minLength: 1 }),
  role: ActorRoleSchema,
  displayName: Type.String({ minLength: 1 }),
  demeanor: Type.Optional(Type.String()),
  /**
   * Patient cold-open speech for Mock Dialogue / stationContext.initialDialogueText.
   * First-class authored utterance on the patient actor (not scenario root; not learner seeds).
   * Optional in schema so non-patient roles omit it; bank patients are expected to set it.
   * Do not put demeanor here — demeanor is stage direction for emotion, not spoken words.
   */
  openingUtterance: Type.Optional(Type.String({ minLength: 1 })),
  hiddenFacts: Type.Optional(Type.Array(Type.String())),
  communicationProfile: Type.Optional(CommunicationProfileSchema),
  bodyMechanics: Type.Optional(BodyMechanicsSchema),
});

export const EventScheduleEntrySchema = Type.Object({
  eventId: Type.String({ minLength: 1 }),
  atSecond: Type.Integer({ minimum: 0 }),
  actorId: Type.String({ minLength: 1 }),
  tag: Type.String({ minLength: 1 }),
});

export const ExamBlueprintTimingSchema = Type.Object({
  doorwaySeconds: Type.Integer({ minimum: 0 }),
  encounterSeconds: Type.Integer({ minimum: 0 }),
  noteSeconds: Type.Integer({ minimum: 0 }),
  breakAfterStationOrders: Type.Array(Type.Integer({ minimum: 1 })),
});

export const ExamStationSlotSchema = Type.Object({
  slotId: Type.String({ minLength: 1 }),
  order: Type.Integer({ minimum: 1 }),
  label: Type.String({ minLength: 1 }),
  requiredEnvironmentIds: Type.Array(Type.String({ minLength: 1 })),
  requiredTraceTags: Type.Array(Type.String({ minLength: 1 })),
});

export const ExamBlueprintSchema = Type.Object({
  blueprintId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  stationSlots: Type.Array(ExamStationSlotSchema, { minItems: 1 }),
  timing: ExamBlueprintTimingSchema,
  requiredTraceTags: Type.Array(Type.String({ minLength: 1 })),
  requiredSafetyCriticalTraceTags: Type.Array(Type.String({ minLength: 1 })),
});

export const ReviewRubricItemSchema = Type.Object({
  rubricId: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  requiredTraceTags: Type.Array(Type.String({ minLength: 1 })),
});

export const ScoreUseLabelSchema = Type.Union([
  Type.Literal("formative_local_only"),
  Type.Literal("pilot_research_only"),
  Type.Literal("validated_summative"),
]);

export const ValidationStageSchema = Type.Union([
  Type.Literal("stage_0_synthetic_draft"),
  Type.Literal("stage_1_expert_reviewed"),
  Type.Literal("stage_2_pilot_ready"),
  Type.Literal("stage_3_validated"),
]);

export const HiddenFactPolicySchema = Type.Object({
  learnerView: Type.Literal("redact_hidden_facts"),
  disclosureRequiresTrigger: Type.Boolean(),
});

export const ScenarioGovernanceSchema = Type.Object({
  scoreUseLabel: ScoreUseLabelSchema,
  syntheticCaseDisclosure: Type.String({ minLength: 1 }),
  validationStage: ValidationStageSchema,
  validationLimitations: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  requiredReviewerRoles: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  sourceIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  safetyCriticalTraceTags: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  hiddenFactPolicy: HiddenFactPolicySchema,
});

export const EnvironmentSchema = Type.Object({
  environmentId: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
});

export const AssetKindSchema = Type.Union([
  Type.Literal("character"),
  Type.Literal("environment"),
  Type.Literal("equipment"),
  Type.Literal("prop"),
  Type.Literal("texture"),
  Type.Literal("audio"),
]);

export const AssetNeedSchema = Type.Object({
  assetId: Type.String({ minLength: 1 }),
  assetType: AssetKindSchema,
  description: Type.String({ minLength: 1 }),
  licenseStatus: Type.String({ minLength: 1 }),
});

export const EnvironmentManifestSchema = Type.Object({
  environment: EnvironmentSchema,
  equipment: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  assetNeeds: Type.Array(AssetNeedSchema, { minItems: 1 }),
});

export const AssetManifestSchema = Type.Object({
  assetId: Type.String({ minLength: 1 }),
  scenarioId: Type.String({ minLength: 1 }),
  kind: AssetKindSchema,
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  requiredForScenario: Type.Boolean(),
  targetRuntime: Type.Union([
    Type.Literal("quest3_webxr"),
    Type.Literal("desktop_webxr"),
  ]),
  provenance: Type.Object({
    generationMethod: Type.Union([
      Type.Literal("procedural_placeholder"),
      Type.Literal("makehuman2"),
      Type.Literal("anny"),
      Type.Literal("stablegen"),
      Type.Literal("smplitex"),
      Type.Literal("manual_modeling"),
    ]),
    sourceRefs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    licenseStatus: Type.Union([
      Type.Literal("approved"),
      Type.Literal("permissive_review_required"),
      Type.Literal("copyleft_blocked"),
      Type.Literal("unknown"),
    ]),
  }),
  generationEvidence: Type.Optional(Type.Object({
    generatedHumanRiggingReportId: Type.Optional(Type.String({ minLength: 1 })),
    skinClothingProvenanceId: Type.Optional(Type.String({ minLength: 1 })),
    medicalEquipmentLibraryRecordId: Type.Optional(Type.String({ minLength: 1 })),
    animationRetargetingReportId: Type.Optional(Type.String({ minLength: 1 })),
  })),
  optimizationEvidence: Type.Optional(Type.Object({
    lodTiers: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    textureCompressionFormat: Type.Optional(Type.String({ minLength: 1 })),
    textureBudgetReportId: Type.Optional(Type.String({ minLength: 1 })),
    colliderSimplificationReportId: Type.Optional(Type.String({ minLength: 1 })),
  })),
  questQaStatus: Type.Object({
    status: Type.Union([
      Type.Literal("not_reviewed"),
      Type.Literal("placeholder_dev_ready"),
      Type.Literal("sim_qa_ready"),
      Type.Literal("failed"),
    ]),
    reviewedAt: Type.String({ format: "date-time" }),
    limitations: Type.Array(Type.String({ minLength: 1 })),
  }),
  geometryBudget: Type.Object({
    maxTriangles: Type.Integer({ minimum: 1 }),
    maxTextureMegabytes: Type.Number({ minimum: 0 }),
    maxDrawCalls: Type.Integer({ minimum: 1 }),
  }),
  pipelineStages: Type.Array(Type.Object({
    stage: Type.Union([
      Type.Literal("requested"),
      Type.Literal("source_reviewed"),
      Type.Literal("mesh_generated"),
      Type.Literal("rigged"),
      Type.Literal("optimized"),
      Type.Literal("qa_ready"),
    ]),
    completedAt: Type.String({ format: "date-time" }),
    notes: Type.String({ minLength: 1 }),
  }), { minItems: 1 }),
  tags: Type.Array(Type.String({ minLength: 1 })),
});

export const ScenarioSchema = Type.Object({
  scenarioId: Type.String({ minLength: 1 }),
  version: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1 }),
  status: ScenarioStatusSchema,
  review: Type.Object({
    clinical: ReviewGateStateSchema,
    psychometric: ReviewGateStateSchema,
    legal: ReviewGateStateSchema,
    simulationQa: ReviewGateStateSchema,
  }),
  clinicalObjectives: Type.Array(Type.String({ minLength: 1 })),
  actors: Type.Array(ActorCardSchema),
  requiredTraceTags: Type.Array(Type.String({ minLength: 1 })),
  eventSchedule: Type.Array(EventScheduleEntrySchema),
  reviewRubric: Type.Array(ReviewRubricItemSchema),
  governance: ScenarioGovernanceSchema,
  environment: Type.Optional(EnvironmentSchema),
  equipment: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  assetNeeds: Type.Optional(Type.Array(AssetNeedSchema)),
  emotionPolicy: Type.Optional(CaseEmotionPolicySchema),
});

