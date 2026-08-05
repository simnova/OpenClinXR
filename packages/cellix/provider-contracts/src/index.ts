import { type Static, Type } from "@sinclair/typebox";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import * as ajvFormatsModule from "ajv-formats";

/**
 * Generic provider + trace contracts — seedwork tier (`packages/cellix/*`).
 *
 * These describe *any* pluggable provider (model, voice, capability) and the trace events a
 * runtime emits. They carry no product or domain semantics, which is what makes the gateway
 * packages that depend on them genuinely hot-swappable: an adapter implements a port described
 * here, and the host selects an implementation at composition time.
 *
 * Product packages may re-export these for back-compat; new generic packages should depend on
 * this package directly rather than on a product schema package.
 */

const addFormats = ("default" in ajvFormatsModule ? ajvFormatsModule.default : ajvFormatsModule) as unknown as (
  ajv: Ajv2020,
) => void;
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

function toResult(valid: boolean, errors: ErrorObject[] | null | undefined): ValidationResult {
  if (valid) {
    return { ok: true };
  }
  return {
    ok: false,
    errors: (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`.trim()),
  };
}

// ── Trace ────────────────────────────────────────────────────────────────────

/** One append-only runtime trace event. Deliberately domain-agnostic: `eventType`/`tag` are free strings. */
export const TraceEventSchema = Type.Object({
  stationRunId: Type.String({ minLength: 1 }),
  sequence: Type.Integer({ minimum: 0 }),
  eventType: Type.String({ minLength: 1 }),
  occurredAt: Type.String({ format: "date-time" }),
  atSecond: Type.Integer({ minimum: 0 }),
  source: Type.String({ minLength: 1 }),
  actorId: Type.Optional(Type.String({ minLength: 1 })),
  tag: Type.Optional(Type.String({ minLength: 1 })),
  payload: Type.Record(Type.String(), Type.Unknown()),
});

// ── Provider health + audit ──────────────────────────────────────────────────

/** Readiness of a pluggable provider, with optional evidence for gate decisions. */
export const ProviderHealthSchema = Type.Object({
  providerId: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal("ready"),
    Type.Literal("not_configured"),
    Type.Literal("blocked"),
  ]),
  blockers: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  evidence: Type.Optional(Type.Object({
    evidenceId: Type.String({ minLength: 1 }),
    sourceFile: Type.String({ minLength: 1 }),
    generatedAt: Type.String({ format: "date-time" }),
    summary: Type.Record(Type.String({ minLength: 1 }), Type.Unknown()),
  })),
});

/** Provenance for one provider invocation (cost, latency, policy, safety posture). */
export const ProviderAuditRecordSchema = Type.Object({
  requestId: Type.String({ minLength: 1 }),
  providerId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  modelVersion: Type.String({ minLength: 1 }),
  modelRuntimeName: Type.String({ minLength: 1 }),
  requestPolicyId: Type.String({ minLength: 1 }),
  safetyPolicyVersion: Type.String({ minLength: 1 }),
  latencyMs: Type.Number({ minimum: 0 }),
  costEstimateUsd: Type.Number({ minimum: 0 }),
  safetyStatus: Type.Union([
    Type.Literal("not_exercised"),
    Type.Literal("pass"),
    Type.Literal("blocked"),
  ]),
});

export const ModelProviderAuditSchema = ProviderAuditRecordSchema;
export const VoiceProviderAuditSchema = ProviderAuditRecordSchema;

// ── Static types ─────────────────────────────────────────────────────────────

export type TraceEvent = Static<typeof TraceEventSchema>;
export type ProviderHealth = Static<typeof ProviderHealthSchema>;
export type ProviderAuditRecord = Static<typeof ProviderAuditRecordSchema>;
export type ModelProviderAudit = Static<typeof ModelProviderAuditSchema>;
export type VoiceProviderAudit = Static<typeof VoiceProviderAuditSchema>;

// ── Validators ───────────────────────────────────────────────────────────────

const traceEventValidator = ajv.compile(TraceEventSchema);
const providerHealthValidator = ajv.compile(ProviderHealthSchema);
const providerAuditRecordValidator = ajv.compile(ProviderAuditRecordSchema);

function validateWith(
  validator: (value: unknown) => boolean,
  errors: () => ErrorObject[] | null | undefined,
  value: unknown,
): ValidationResult {
  return toResult(validator(value), errors());
}

function expectedDurableEventRef(stationRunId: string, sequence: number): string {
  return `durable://station-runs/${stationRunId}/events/${sequence}`;
}

/** Structural + semantic validation: nonblank identifiers and a well-formed durableEventRef. */
export function validateTraceEvent(value: unknown): ValidationResult {
  const structural = validateWith(traceEventValidator, () => traceEventValidator.errors, value);
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

/** Structural + semantic: nonblank providerId, and `ready` must not carry blockers. */
export function validateProviderHealth(value: unknown): ValidationResult {
  const structural = validateWith(providerHealthValidator, () => providerHealthValidator.errors, value);
  if (!structural.ok) {
    return structural;
  }

  const health = value as { providerId: string; status: string; blockers?: string[] };
  if (health.providerId.trim().length === 0) {
    return { ok: false, errors: ["provider health requires a nonblank providerId"] };
  }
  if (health.status === "ready" && (health.blockers?.length ?? 0) > 0) {
    return { ok: false, errors: ["ready provider health must not include blockers"] };
  }

  return { ok: true };
}

/** Structural + semantic: identity/policy fields must be nonblank. */
export function validateProviderAuditRecord(value: unknown): ValidationResult {
  const structural = validateWith(providerAuditRecordValidator, () => providerAuditRecordValidator.errors, value);
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
  ].filter((field) => typeof audit[field] === "string" && (audit[field] as string).trim().length === 0);

  if (blankFields.length > 0) {
    return { ok: false, errors: [`provider audit fields must be nonblank: ${blankFields.join(", ")}`] };
  }

  return { ok: true };
}

export function validateModelProviderAudit(value: unknown): ValidationResult {
  return validateProviderAuditRecord(value);
}

export function validateVoiceProviderAudit(value: unknown): ValidationResult {
  return validateProviderAuditRecord(value);
}
