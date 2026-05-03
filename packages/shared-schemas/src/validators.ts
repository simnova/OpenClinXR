import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import {
  ActorCardSchema,
  PatientNoteSchema,
  ReviewPacketSchema,
  ScenarioSchema,
  TraceEventSchema,
} from "./schemas.js";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);

const actorCardValidator = ajv.compile(ActorCardSchema);
const scenarioValidator = ajv.compile(ScenarioSchema);
const traceEventValidator = ajv.compile(TraceEventSchema);
const patientNoteValidator = ajv.compile(PatientNoteSchema);
const reviewPacketValidator = ajv.compile(ReviewPacketSchema);

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

  const scenario = value as { status: string; review: Record<string, string> };
  if (scenario.status === "approved" && Object.values(scenario.review).some((state) => state !== "approved")) {
    return {
      ok: false,
      errors: ["approved scenarios require clinical, psychometric, legal, and simulation QA approval"],
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
