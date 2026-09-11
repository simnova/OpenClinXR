import { createHash } from "node:crypto";
import { type Scenario, validateScenario } from "@openclinxr/shared-schemas";
import { coerceAuthoredScenarioWrite } from "../../scenario-review-promotion.js";
import { getByPath, setByPath, sameJson } from "./field-paths.js";
import {
  HIGH_UNCERTAINTY_REQUIRES_PATCH,
  type ScenarioProposalPatch,
  type ScenarioProposalRecord,
} from "./types.js";

export function proposalRevisionDigest(
  currentRevision: Scenario,
  patchTrail: readonly ScenarioProposalPatch[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ currentRevision, patchTrail }))
    .digest("hex");
}

export function applyFacultyPatch(
  record: ScenarioProposalRecord,
  patch: ScenarioProposalPatch,
): { ok: true; record: ScenarioProposalRecord } | { ok: false; reason: string } {
  if (record.status !== "draft") {
    return { ok: false, reason: "proposal_already_approved" };
  }
  const current = getByPath(record.currentRevision, patch.path);
  if (!current.ok) {
    return { ok: false, reason: `unknown_patch_path:${patch.path}` };
  }
  if (!sameJson(current.value, patch.previous)) {
    return { ok: false, reason: "stale_patch_previous" };
  }
  const nextRoot = setByPath(record.currentRevision, patch.path, patch.next);
  if (nextRoot === undefined) {
    return { ok: false, reason: `unknown_patch_path:${patch.path}` };
  }
  const validation = validateScenario(nextRoot);
  if (!validation.ok) {
    return { ok: false, reason: "patch_broke_scenario" };
  }
  const currentRevision = { ...(nextRoot as Scenario), status: "draft" as const };
  const patchTrail = [...record.patchTrail, patch];
  return {
    ok: true,
    record: {
      ...record,
      currentRevision,
      patchTrail,
      revisionDigest: proposalRevisionDigest(currentRevision, patchTrail),
    },
  };
}

export function approvalBlockers(
  record: ScenarioProposalRecord,
  acceptedFieldPaths: readonly string[],
): string[] {
  const patched = new Set(record.patchTrail.map((patch) => patch.path));
  const accepted = new Set(acceptedFieldPaths);
  const blockers: string[] = [];
  for (const field of record.generatedFields) {
    if (patched.has(field.path)) continue;
    if (field.uncertainty.score >= HIGH_UNCERTAINTY_REQUIRES_PATCH) {
      blockers.push(`high_uncertainty_requires_patch:${field.path}`);
      continue;
    }
    if (!accepted.has(field.path)) {
      blockers.push(`generated_field_unreviewed:${field.path}`);
    }
  }
  return blockers;
}

/** Faculty proposal approval writes an authored draft. Review submit alone promotes. */
export function approvedAuthoredScenario(record: ScenarioProposalRecord): Scenario {
  return coerceAuthoredScenarioWrite(record.currentRevision);
}
