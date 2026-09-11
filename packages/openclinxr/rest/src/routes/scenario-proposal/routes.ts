import { randomUUID } from "node:crypto";
import { hasFacultyAccess } from "@openclinxr/auth";
import { validateScenario } from "@openclinxr/shared-schemas";
import type { Hono } from "hono";
import type { ApiAppContext } from "../../api-app-context.js";
import type { ApiAppVariables } from "../../api-types.js";
import {
  applyFacultyPatch,
  approvalBlockers,
  approvedAuthoredScenario,
  proposalRevisionDigest,
} from "./approve.js";
import { parseApproveBody, parseCreateBody, parsePatchBody } from "./parse.js";
import { proposalStoreFor } from "./store.js";
import {
  SCENARIO_PROPOSAL_CLAIM_BOUNDARY,
  SCENARIO_PROPOSAL_NOT_EVIDENCE_FOR,
  SCENARIO_PROPOSALS_PATH,
  type ScenarioProposalRecord,
} from "./types.js";

function facultyDenied() {
  return { error: "forbidden", reason: "faculty_role_required" } as const;
}

export function registerScenarioProposalRoutes(
  app: Hono<{ Variables: ApiAppVariables }>,
  ctx: ApiAppContext,
): void {
  const store = proposalStoreFor(ctx);
  const { persistence } = ctx;

  app.post(SCENARIO_PROPOSALS_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(facultyDenied(), 403);
    }
    const parsed = parseCreateBody(await context.req.json().catch(() => ({})));
    if (!parsed.ok) {
      return context.json(
        {
          error: parsed.error,
          reason: parsed.reason,
          ...(parsed.fieldPath ? { fieldPath: parsed.fieldPath } : {}),
        },
        parsed.status ?? 400,
      );
    }
    const proposalId = parsed.value.proposalId ?? `proposal_${randomUUID()}`;
    if (store.has(proposalId)) {
      return context.json({ error: "conflict", reason: "proposal_id_exists" }, 409);
    }
    const record: ScenarioProposalRecord = {
      proposalId,
      status: "draft",
      generatedFields: parsed.value.generatedFields,
      patchTrail: [],
      currentRevision: parsed.value.scenario,
      revisionDigest: proposalRevisionDigest(parsed.value.scenario, []),
      claimBoundary: SCENARIO_PROPOSAL_CLAIM_BOUNDARY,
      notEvidenceFor: [...SCENARIO_PROPOSAL_NOT_EVIDENCE_FOR],
    };
    store.set(proposalId, record);
    return context.json({ proposal: record }, 201);
  });

  app.get(`${SCENARIO_PROPOSALS_PATH}/:proposalId`, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(facultyDenied(), 403);
    }
    const proposalId = context.req.param("proposalId");
    const record = store.get(proposalId);
    if (!record) {
      return context.json({ error: "proposal_not_found" }, 404);
    }
    return context.json({ proposal: record });
  });

  app.post(`${SCENARIO_PROPOSALS_PATH}/:proposalId/patches`, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(facultyDenied(), 403);
    }
    const proposalId = context.req.param("proposalId");
    const existing = store.get(proposalId);
    if (!existing) {
      return context.json({ error: "proposal_not_found" }, 404);
    }
    const parsed = parsePatchBody(await context.req.json().catch(() => ({})));
    if (!parsed.ok) {
      return context.json({ error: parsed.error, reason: parsed.reason }, 400);
    }
    const applied = applyFacultyPatch(existing, parsed.value);
    if (!applied.ok) {
      const status = applied.reason === "proposal_already_approved" ? 409 : 400;
      return context.json({ error: "invalid_patch", reason: applied.reason }, status);
    }
    store.set(proposalId, applied.record);
    return context.json({ proposal: applied.record });
  });

  app.post(`${SCENARIO_PROPOSALS_PATH}/:proposalId/approve`, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(facultyDenied(), 403);
    }
    const proposalId = context.req.param("proposalId");
    const existing = store.get(proposalId);
    if (!existing) {
      return context.json({ error: "proposal_not_found" }, 404);
    }
    if (existing.status !== "draft") {
      return context.json({ error: "conflict", reason: "proposal_already_approved" }, 409);
    }
    const parsed = parseApproveBody(await context.req.json().catch(() => ({})));
    if (!parsed.ok) {
      return context.json({ error: parsed.error, reason: parsed.reason }, 400);
    }
    if (parsed.value.revisionDigest !== existing.revisionDigest) {
      return context.json(
        {
          error: "stale",
          reason: "stale_revision_digest",
          currentRevisionDigest: existing.revisionDigest,
          submittedRevisionDigest: parsed.value.revisionDigest,
        },
        409,
      );
    }
    const blockers = approvalBlockers(existing, parsed.value.acceptedFieldPaths);
    if (blockers.length > 0) {
      return context.json({ error: "unreviewed_generated_fields", blockers }, 409);
    }
    if (!persistence.saveAuthoredScenario) {
      return context.json({ error: "authored_scenario_persistence_unavailable" }, 503);
    }
    const authored = approvedAuthoredScenario(existing);
    const authoredValidation = validateScenario(authored);
    if (!authoredValidation.ok) {
      return context.json({ error: "invalid_scenario", reason: "approved_revision_invalid" }, 400);
    }
    await persistence.saveAuthoredScenario(authored);
    const approvedAt = new Date().toISOString();
    const approved: ScenarioProposalRecord = {
      ...existing,
      status: "approved",
      currentRevision: authored,
      approvedBy: parsed.value.reviewerId,
      approvedAt,
      revisionDigest: existing.revisionDigest,
    };
    store.set(proposalId, approved);
    return context.json({ proposal: approved, scenario: authored });
  });
}
