import { type Scenario, validateScenario } from "@openclinxr/shared-schemas";
import { getByPath, setByPath } from "./field-paths.js";
import type {
  ScenarioProposalGeneratedField,
  ScenarioProposalPatch,
} from "./types.js";

export type ParseFailure = {
  ok: false;
  error: string;
  reason: string;
  fieldPath?: string;
  status?: 400 | 422;
};
export type ParseOk<T> = { ok: true; value: T };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonblank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseProvenance(value: unknown): ScenarioProposalGeneratedField["provenance"] | undefined {
  if (!isRecord(value)) return undefined;
  if (value["source"] !== "model") return undefined;
  const providerId = nonblank(value["providerId"]);
  const generatedAt = nonblank(value["generatedAt"]);
  if (!providerId || !generatedAt || Number.isNaN(Date.parse(generatedAt))) return undefined;
  return { source: "model", providerId, generatedAt };
}

function parseUncertainty(value: unknown): ScenarioProposalGeneratedField["uncertainty"] | undefined {
  if (!isRecord(value)) return undefined;
  const score = value["score"];
  const rationale = nonblank(value["rationale"]);
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) return undefined;
  if (!rationale) return undefined;
  return { score, rationale };
}

function parseGeneratedField(
  value: unknown,
): ParseOk<ScenarioProposalGeneratedField> | ParseFailure {
  if (!isRecord(value)) {
    return { ok: false, error: "invalid_body", reason: "generated_field_object_required" };
  }
  const path = nonblank(value["path"]);
  if (!path) {
    return { ok: false, error: "invalid_body", reason: "generated_field_path_required" };
  }
  const provenance = parseProvenance(value["provenance"]);
  if (provenance === undefined) {
    return {
      ok: false,
      error: "generated_field_provenance_required",
      reason: `generated_field_provenance_required:${path}`,
      fieldPath: path,
      status: 422,
    };
  }
  const uncertainty = parseUncertainty(value["uncertainty"]);
  if (uncertainty === undefined) {
    return { ok: false, error: "invalid_body", reason: `generated_field_uncertainty_required:${path}` };
  }
  if (!("value" in value)) {
    return { ok: false, error: "invalid_body", reason: `generated_field_value_required:${path}` };
  }
  return { ok: true, value: { path, value: value["value"], provenance, uncertainty } };
}

export function parseGeneratedFields(value: unknown): ParseOk<ScenarioProposalGeneratedField[]> | ParseFailure {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "invalid_body", reason: "generated_fields_required" };
  }
  const fields: ScenarioProposalGeneratedField[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const field = parseGeneratedField(entry);
    if (!field.ok) return field;
    if (seen.has(field.value.path)) {
      return { ok: false, error: "invalid_body", reason: "duplicate_generated_field_path" };
    }
    seen.add(field.value.path);
    fields.push(field.value);
  }
  return { ok: true, value: fields };
}

export function applyGeneratedFieldsToScenario(
  scenario: Scenario,
  fields: readonly ScenarioProposalGeneratedField[],
): ParseOk<Scenario> | ParseFailure {
  let next: unknown = scenario;
  for (const field of fields) {
    const existing = getByPath(next, field.path);
    if (!existing.ok) {
      return { ok: false, error: "invalid_body", reason: `unknown_generated_field_path:${field.path}` };
    }
    const written = setByPath(next, field.path, field.value);
    if (written === undefined) {
      return { ok: false, error: "invalid_body", reason: `unknown_generated_field_path:${field.path}` };
    }
    next = written;
  }
  const validation = validateScenario(next);
  if (!validation.ok) {
    return { ok: false, error: "invalid_scenario", reason: "generated_fields_broke_scenario" };
  }
  return { ok: true, value: { ...(next as Scenario), status: "draft" } };
}

export function parseCreateBody(body: unknown): ParseOk<{
  proposalId: string | undefined;
  scenario: Scenario;
  generatedFields: ScenarioProposalGeneratedField[];
}> | ParseFailure {
  if (!isRecord(body)) {
    return { ok: false, error: "invalid_body", reason: "object_required" };
  }
  const rawScenario = body["scenario"];
  const scenarioValidation = validateScenario(rawScenario);
  if (!scenarioValidation.ok) {
    return { ok: false, error: "invalid_scenario", reason: "scenario_required" };
  }
  const generated = parseGeneratedFields(body["generatedFields"]);
  if (!generated.ok) return generated;
  const applied = applyGeneratedFieldsToScenario(rawScenario as Scenario, generated.value);
  if (!applied.ok) return applied;
  const rawProposalId = body["proposalId"];
  const proposalId = rawProposalId === undefined ? undefined : nonblank(rawProposalId);
  if (rawProposalId !== undefined && proposalId === undefined) {
    return { ok: false, error: "invalid_body", reason: "proposalId_required" };
  }
  return { ok: true, value: { proposalId, scenario: applied.value, generatedFields: generated.value } };
}

export function parsePatchBody(body: unknown): ParseOk<ScenarioProposalPatch> | ParseFailure {
  if (!isRecord(body)) {
    return { ok: false, error: "invalid_body", reason: "object_required" };
  }
  const path = nonblank(body["path"]);
  const reviewerId = nonblank(body["reviewerId"]);
  const at = nonblank(body["at"]);
  const rationale = nonblank(body["rationale"]);
  if (!path) return { ok: false, error: "invalid_body", reason: "path_required" };
  if (!reviewerId) return { ok: false, error: "invalid_body", reason: "reviewerId_required" };
  if (!at || Number.isNaN(Date.parse(at))) return { ok: false, error: "invalid_body", reason: "at_required" };
  if (!rationale) return { ok: false, error: "invalid_body", reason: "rationale_required" };
  if (!("previous" in body) || !("next" in body)) {
    return { ok: false, error: "invalid_body", reason: "previous_and_next_required" };
  }
  return {
    ok: true,
    value: {
      path,
      previous: body["previous"],
      next: body["next"],
      reviewerId,
      at,
      rationale,
    },
  };
}

export function parseApproveBody(body: unknown): ParseOk<{
  reviewerId: string;
  comments: string;
  evidenceRefs: string[];
  acceptedFieldPaths: string[];
  revisionDigest: string;
}> | ParseFailure {
  if (!isRecord(body)) {
    return { ok: false, error: "invalid_body", reason: "object_required" };
  }
  const reviewerId = nonblank(body["reviewerId"]);
  const comments = nonblank(body["comments"]);
  const revisionDigest = nonblank(body["revisionDigest"]);
  if (!reviewerId) return { ok: false, error: "invalid_body", reason: "reviewerId_required" };
  if (!comments) return { ok: false, error: "invalid_body", reason: "comments_required" };
  if (!revisionDigest) return { ok: false, error: "invalid_body", reason: "revisionDigest_required" };
  const rawRefs = body["evidenceRefs"];
  if (!Array.isArray(rawRefs) || rawRefs.length === 0) {
    return { ok: false, error: "invalid_body", reason: "evidenceRefs_required" };
  }
  const evidenceRefs: string[] = [];
  for (const ref of rawRefs) {
    const text = nonblank(ref);
    if (!text) return { ok: false, error: "invalid_body", reason: "evidenceRefs_required" };
    evidenceRefs.push(text);
  }
  const acceptedFieldPaths: string[] = [];
  const rawAccepted = body["acceptedFieldPaths"];
  if (rawAccepted !== undefined) {
    if (!Array.isArray(rawAccepted)) {
      return { ok: false, error: "invalid_body", reason: "acceptedFieldPaths_invalid" };
    }
    for (const path of rawAccepted) {
      const text = nonblank(path);
      if (!text) return { ok: false, error: "invalid_body", reason: "acceptedFieldPaths_invalid" };
      acceptedFieldPaths.push(text);
    }
  }
  return { ok: true, value: { reviewerId, comments, evidenceRefs, acceptedFieldPaths, revisionDigest } };
}
