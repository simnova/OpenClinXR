import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as ajvFormatsModule from "ajv-formats";
import {
  ActorCardSchema,
  PatientNoteSchema,
  ProviderHealthSchema,
  ReviewPacketSchema,
  ScenarioSchema,
  TraceEventSchema,
} from "./schemas.js";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const addFormats = ("default" in ajvFormatsModule ? ajvFormatsModule.default : ajvFormatsModule) as unknown as (
  ajv: Ajv2020,
) => void;
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);

const actorCardValidator = ajv.compile(ActorCardSchema);
const scenarioValidator = ajv.compile(ScenarioSchema);
const traceEventValidator = ajv.compile(TraceEventSchema);
const patientNoteValidator = ajv.compile(PatientNoteSchema);
const reviewPacketValidator = ajv.compile(ReviewPacketSchema);
const providerHealthValidator = ajv.compile(ProviderHealthSchema);

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
  return validateWith(traceEventValidator, value);
}

export function validatePatientNote(value: unknown): ValidationResult {
  return validateWith(patientNoteValidator, value);
}

export function validateReviewPacket(value: unknown): ValidationResult {
  return validateWith(reviewPacketValidator, value);
}

export function validateProviderHealth(value: unknown): ValidationResult {
  return validateWith(providerHealthValidator, value);
}
