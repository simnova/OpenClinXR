import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as ajvFormatsModule from "ajv-formats";
import {
  ActorCardSchema,
  AssetManifestSchema,
  CommunicationProfileSchema,
  DynamicEncounterFactoryPlanningProjectionSchema,
  DynamicEncounterFactoryProjectionArtifactSchema,
  EnvironmentManifestSchema,
  ExamBlueprintSchema,
  ModelProviderAuditSchema,
  PatientNoteSchema,
  ProviderAuditRecordSchema,
  ProviderHealthSchema,
  ReviewPacketSchema,
  ScenarioSchema,
  SharedAssetLibraryReuseSchema,
  StationRunSchema,
  TraceEventSchema,
  VoiceProviderAuditSchema,
} from "./schemas.js";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const addFormats = ("default" in ajvFormatsModule ? ajvFormatsModule.default : ajvFormatsModule) as unknown as (
  ajv: Ajv2020,
) => void;
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);

const actorCardValidator = ajv.compile(ActorCardSchema);
const assetManifestValidator = ajv.compile(AssetManifestSchema);
const communicationProfileValidator = ajv.compile(CommunicationProfileSchema);
const environmentManifestValidator = ajv.compile(EnvironmentManifestSchema);
const examBlueprintValidator = ajv.compile(ExamBlueprintSchema);
const scenarioValidator = ajv.compile(ScenarioSchema);
const traceEventValidator = ajv.compile(TraceEventSchema);
const patientNoteValidator = ajv.compile(PatientNoteSchema);
const stationRunValidator = ajv.compile(StationRunSchema);
const reviewPacketValidator = ajv.compile(ReviewPacketSchema);
const providerHealthValidator = ajv.compile(ProviderHealthSchema);
const providerAuditRecordValidator = ajv.compile(ProviderAuditRecordSchema);
const modelProviderAuditValidator = ajv.compile(ModelProviderAuditSchema);
const voiceProviderAuditValidator = ajv.compile(VoiceProviderAuditSchema);
const sharedAssetLibraryReuseValidator = ajv.compile(SharedAssetLibraryReuseSchema);
const dynamicEncounterFactoryPlanningProjectionValidator = ajv.compile(DynamicEncounterFactoryPlanningProjectionSchema);
const dynamicEncounterFactoryProjectionArtifactValidator = ajv.compile(DynamicEncounterFactoryProjectionArtifactSchema);

function toResult(valid: boolean, errors: ErrorObject[] | null | undefined): ValidationResult {
  if (valid) {
    return { ok: true };
  }

  return {
    ok: false,
    errors: (errors ?? []).map((error) => `${error.instancePath} ${error.message ?? "is invalid"}`.trim()),
  };
}

function validateWith(validate: ValidateFunction, value: unknown): ValidationResult {
  return toResult(validate(value), validate.errors);
}

export function validateActorCard(value: unknown): ValidationResult {
  return validateWith(actorCardValidator, value);
}

export function validateAssetManifest(value: unknown): ValidationResult {
  const structural = validateWith(assetManifestValidator, value);
  if (!structural.ok) {
    return structural;
  }

  const manifest = value as {
    assetId: string;
    scenarioId: string;
    displayName: string;
    description: string;
    provenance: { sourceRefs: string[] };
    generationEvidence?: Record<string, string | undefined>;
    optimizationEvidence?: {
      lodTiers?: string[];
      textureCompressionFormat?: string;
      textureBudgetReportId?: string;
      colliderSimplificationReportId?: string;
    };
    questQaStatus: { limitations: string[] };
    pipelineStages: { notes: string }[];
    tags: string[];
  };
  const errors = [
    ...(manifest.assetId.trim().length === 0 ? ["asset manifest assetId is required"] : []),
    ...(manifest.scenarioId.trim().length === 0 ? ["asset manifest scenarioId is required"] : []),
    ...(manifest.displayName.trim().length === 0 ? ["asset manifest displayName is required"] : []),
    ...(manifest.description.trim().length === 0 ? ["asset manifest description is required"] : []),
    ...(manifest.provenance.sourceRefs.some((sourceRef) => sourceRef.trim().length === 0)
      ? ["asset manifest provenance sourceRefs cannot contain blank refs"]
      : []),
    ...(manifest.questQaStatus.limitations.some((limitation) => limitation.trim().length === 0)
      ? ["asset manifest Quest QA limitations cannot contain blank entries"]
      : []),
    ...(manifest.pipelineStages.some((stage) => stage.notes.trim().length === 0)
      ? ["asset manifest pipeline stage notes cannot be blank"]
      : []),
    ...(manifest.tags.some((tag) => tag.trim().length === 0)
      ? ["asset manifest tags cannot contain blank tags"]
      : []),
    ...semanticBlankRecordErrors(manifest.generationEvidence, "asset manifest generation evidence"),
    ...semanticBlankOptimizationErrors(manifest.optimizationEvidence),
  ];

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateCommunicationProfile(value: unknown): ValidationResult {
  return validateWith(communicationProfileValidator, value);
}

export function validateEnvironmentManifest(value: unknown): ValidationResult {
  return validateWith(environmentManifestValidator, value);
}

export function validateExamBlueprint(value: unknown): ValidationResult {
  return validateWith(examBlueprintValidator, value);
}

export function validateScenario(value: unknown): ValidationResult {
  const structural = validateWith(scenarioValidator, value);
  if (!structural.ok) {
    return structural;
  }

  const scenario = value as {
    status: string;
    review: Record<string, string>;
    requiredTraceTags: string[];
    governance: {
      scoreUseLabel: string;
      validationStage: string;
      safetyCriticalTraceTags: string[];
      hiddenFactPolicy: {
        disclosureRequiresTrigger: boolean;
      };
    };
  };
  if (scenario.status === "approved" && Object.values(scenario.review).some((state) => state !== "approved")) {
    return {
      ok: false,
      errors: ["approved scenarios require clinical, psychometric, legal, and simulation QA approval"],
    };
  }

  if (scenario.status === "approved" && scenario.governance.validationStage === "stage_0_synthetic_draft") {
    return {
      ok: false,
      errors: ["approved scenarios require at least stage_1_expert_reviewed governance"],
    };
  }

  if (scenario.governance.scoreUseLabel === "validated_summative" && scenario.governance.validationStage !== "stage_3_validated") {
    return {
      ok: false,
      errors: ["validated summative score use requires stage_3_validated governance evidence"],
    };
  }

  if (!scenario.governance.hiddenFactPolicy.disclosureRequiresTrigger) {
    return {
      ok: false,
      errors: ["hidden facts require explicit disclosure triggers"],
    };
  }

  const blankTraceTagErrors = [
    ...(scenario.requiredTraceTags.some((tag) => tag.trim().length === 0)
      ? ["scenario requiredTraceTags cannot contain blank tags"]
      : []),
    ...(scenario.governance.safetyCriticalTraceTags.some((tag) => tag.trim().length === 0)
      ? ["scenario safetyCriticalTraceTags cannot contain blank tags"]
      : []),
  ];
  if (blankTraceTagErrors.length > 0) {
    return {
      ok: false,
      errors: blankTraceTagErrors,
    };
  }

  const requiredTraceTags = new Set(scenario.requiredTraceTags);
  const unknownSafetyTags = scenario.governance.safetyCriticalTraceTags.filter((tag) => !requiredTraceTags.has(tag));
  if (unknownSafetyTags.length > 0) {
    return {
      ok: false,
      errors: [`safety-critical trace tags must also be required trace tags: ${unknownSafetyTags.join(", ")}`],
    };
  }

  return { ok: true };
}

export function validateTraceEvent(value: unknown): ValidationResult {
  const structural = validateWith(traceEventValidator, value);
  if (!structural.ok) {
    return structural;
  }

  const trace = value as {
    stationRunId: string;
    sequence: number;
    eventType: string;
    source: string;
    actorId?: string;
    tag?: string;
    payload?: Record<string, unknown> & { durableEventRef?: unknown };
  };
  const durableEventRef = typeof trace.payload?.durableEventRef === "string" ? trace.payload.durableEventRef : undefined;
  const errors = [
    ...(trace.stationRunId.trim().length === 0 ? ["trace event stationRunId is required"] : []),
    ...(trace.eventType.trim().length === 0 ? ["trace event eventType is required"] : []),
    ...(trace.source.trim().length === 0 ? ["trace event source is required"] : []),
    ...(trace.actorId !== undefined && trace.actorId.trim().length === 0 ? ["trace event actorId cannot be blank"] : []),
    ...(trace.tag !== undefined && trace.tag.trim().length === 0 ? ["trace event tag cannot be blank"] : []),
    ...(trace.payload && Object.hasOwn(trace.payload, "durableEventRef") && durableEventRef === undefined
      ? ["trace event payload durableEventRef must be string"]
      : []),
    ...(durableEventRef !== undefined && durableEventRef !== expectedDurableEventRef(trace.stationRunId, trace.sequence)
      ? [`trace event payload durableEventRef must match durable://station-runs/${trace.stationRunId}/events/${trace.sequence}`]
      : []),
  ];

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

function expectedDurableEventRef(stationRunId: string, sequence: number): string {
  return `durable://station-runs/${stationRunId}/events/${sequence}`;
}

export function validatePatientNote(value: unknown): ValidationResult {
  const structural = validateWith(patientNoteValidator, value);
  if (!structural.ok) {
    return structural;
  }

  const errors = patientNoteSemanticErrors(value as { stationRunId: string; text: string });
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateStationRun(value: unknown): ValidationResult {
  const structural = validateWith(stationRunValidator, value);
  if (!structural.ok) {
    return structural;
  }

  const stationRun = value as { stationRunId: string; note?: { stationRunId: string } };
  const noteErrors = stationRun.note ? patientNoteSemanticErrors(stationRun.note as { stationRunId: string; text: string }) : [];
  if (noteErrors.length > 0) {
    return { ok: false, errors: noteErrors };
  }
  if (stationRun.note && stationRun.note.stationRunId !== stationRun.stationRunId) {
    return {
      ok: false,
      errors: ["station run note must belong to the same stationRunId"],
    };
  }

  return { ok: true };
}

export function validateSharedAssetLibraryReuse(value: unknown): ValidationResult {
  return validateWith(sharedAssetLibraryReuseValidator, value);
}

export function validateDynamicEncounterFactoryPlanningProjection(value: unknown): ValidationResult {
  return validateWith(dynamicEncounterFactoryPlanningProjectionValidator, value);
}

export function validateDynamicEncounterFactoryProjectionArtifact(value: unknown): ValidationResult {
  return validateWith(dynamicEncounterFactoryProjectionArtifactValidator, value);
}

export function validateReviewPacket(value: unknown): ValidationResult {
  const structural = validateWith(reviewPacketValidator, value);
  if (!structural.ok) {
    return structural;
  }

  const packet = value as {
    stationRunId: string;
    patientNote?: { stationRunId: string; text: string };
    facultyScoreDraft: { reviewerId: string };
    missingRequiredTraceTags: string[];
    unsafeEvents: string[];
    timeline: { sequence: number; eventType: string }[];
    traceQuality: {
      eventCount: number;
      modelGeneratedEventCount: number;
      modelFailedEventCount: number;
      voiceAudioEventCount: number;
      unsafeEventCount: number;
      missingRequiredTraceTagCount: number;
      hasPatientNote: boolean;
      hasModelProvenance: boolean;
    };
  };
  const noteErrors = packet.patientNote ? patientNoteSemanticErrors(packet.patientNote) : [];
  if (noteErrors.length > 0) {
    return { ok: false, errors: noteErrors };
  }
  if (packet.patientNote && packet.patientNote.stationRunId !== packet.stationRunId) {
    return {
      ok: false,
      errors: ["review packet patient note must belong to the same stationRunId"],
    };
  }
  if (packet.facultyScoreDraft.reviewerId.trim().length === 0) {
    return {
      ok: false,
      errors: ["review packet faculty score draft requires reviewer identity"],
    };
  }
  if (hasDuplicateTimelineSequences(packet.timeline)) {
    return {
      ok: false,
      errors: ["review packet timeline sequence values must be unique for deterministic replay"],
    };
  }
  const traceQualityErrors = [
    ...(packet.traceQuality.eventCount !== packet.timeline.length
      ? ["review packet traceQuality.eventCount must match timeline length"]
      : []),
    ...(packet.traceQuality.unsafeEventCount !== packet.unsafeEvents.length
      ? ["review packet traceQuality.unsafeEventCount must match unsafeEvents length"]
      : []),
    ...(packet.traceQuality.missingRequiredTraceTagCount !== packet.missingRequiredTraceTags.length
      ? ["review packet traceQuality.missingRequiredTraceTagCount must match missingRequiredTraceTags length"]
      : []),
    ...(packet.traceQuality.hasPatientNote !== Boolean(packet.patientNote)
      ? ["review packet traceQuality.hasPatientNote must match patientNote presence"]
      : []),
    ...(packet.traceQuality.modelGeneratedEventCount !== countTimelineEvents(packet.timeline, "actor.response.generated")
      ? ["review packet traceQuality.modelGeneratedEventCount must match actor.response.generated timeline events"]
      : []),
    ...(packet.traceQuality.modelFailedEventCount !== countTimelineEvents(packet.timeline, "actor.response.failed")
      ? ["review packet traceQuality.modelFailedEventCount must match actor.response.failed timeline events"]
      : []),
    ...(packet.traceQuality.voiceAudioEventCount !== countTimelineEvents(packet.timeline, "voice.audio.generated")
      ? ["review packet traceQuality.voiceAudioEventCount must match voice.audio.generated timeline events"]
      : []),
    ...(packet.traceQuality.hasModelProvenance && packet.traceQuality.modelGeneratedEventCount === 0
      ? ["review packet traceQuality.hasModelProvenance cannot be true without model-generated events"]
      : []),
  ];
  if (traceQualityErrors.length > 0) {
    return { ok: false, errors: traceQualityErrors };
  }

  return { ok: true };
}

function patientNoteSemanticErrors(note: { stationRunId: string; text: string }): string[] {
  return [
    ...(note.stationRunId.trim().length === 0 ? ["patient note stationRunId is required"] : []),
    ...(note.text.trim().length === 0 ? ["patient note text is required"] : []),
  ];
}

function semanticBlankRecordErrors(record: Record<string, string | undefined> | undefined, label: string): string[] {
  if (!record) {
    return [];
  }
  const blankFields = Object.entries(record)
    .filter(([, value]) => value !== undefined && value.trim().length === 0)
    .map(([field]) => field);
  return blankFields.length > 0 ? [`${label} fields must be nonblank: ${blankFields.join(", ")}`] : [];
}

function semanticBlankOptimizationErrors(
  evidence: {
    lodTiers?: string[];
    textureCompressionFormat?: string;
    textureBudgetReportId?: string;
    colliderSimplificationReportId?: string;
  } | undefined,
): string[] {
  if (!evidence) {
    return [];
  }
  return [
    ...((evidence.lodTiers ?? []).some((lodTier) => lodTier.trim().length === 0)
      ? ["asset manifest optimization evidence lodTiers cannot contain blank tiers"]
      : []),
    ...semanticBlankRecordErrors({
      textureCompressionFormat: evidence.textureCompressionFormat,
      textureBudgetReportId: evidence.textureBudgetReportId,
      colliderSimplificationReportId: evidence.colliderSimplificationReportId,
    }, "asset manifest optimization evidence"),
  ];
}

function hasDuplicateTimelineSequences(timeline: readonly { sequence: number }[]): boolean {
  return new Set(timeline.map((entry) => entry.sequence)).size !== timeline.length;
}

function countTimelineEvents(timeline: readonly { eventType: string }[], eventType: string): number {
  return timeline.filter((event) => event.eventType === eventType).length;
}

export function validateProviderHealth(value: unknown): ValidationResult {
  const structural = validateWith(providerHealthValidator, value);
  if (!structural.ok) {
    return structural;
  }

  const health = value as { providerId: string; status: string; blockers?: string[] };
  if (health.providerId.trim().length === 0) {
    return {
      ok: false,
      errors: ["provider health requires a nonblank providerId"],
    };
  }
  if (health.status === "ready" && (health.blockers?.length ?? 0) > 0) {
    return {
      ok: false,
      errors: ["ready provider health must not include blockers"],
    };
  }

  return { ok: true };
}

export function validateProviderAuditRecord(value: unknown): ValidationResult {
  const structural = validateWith(providerAuditRecordValidator, value);
  if (!structural.ok) {
    return structural;
  }

  const audit = value as Record<string, unknown>;
  const blankFields = [
    "requestId",
    "providerId",
    "modelId",
    "modelVersion",
    "modelRuntimeName",
    "requestPolicyId",
    "safetyPolicyVersion",
  ].filter((field) => typeof audit[field] === "string" && audit[field].trim().length === 0);

  if (blankFields.length > 0) {
    return {
      ok: false,
      errors: [`provider audit fields must be nonblank: ${blankFields.join(", ")}`],
    };
  }

  return { ok: true };
}

export function validateModelProviderAudit(value: unknown): ValidationResult {
  const structural = validateWith(modelProviderAuditValidator, value);
  return structural.ok ? validateProviderAuditRecord(value) : structural;
}

export function validateVoiceProviderAudit(value: unknown): ValidationResult {
  const structural = validateWith(voiceProviderAuditValidator, value);
  return structural.ok ? validateProviderAuditRecord(value) : structural;
}
