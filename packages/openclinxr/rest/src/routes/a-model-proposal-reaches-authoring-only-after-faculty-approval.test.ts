/**
 * Diagnosis: a model-assisted scenario can be POSTed through save-authored-scenario
 * and compilation (exam assembly pool) can read it with no provenance on generated
 * fields, no faculty patch trail, and a client-asserted approved status. There is
 * no draft proposal surface in rest.
 *
 * Known-good: save-authored-scenario already refuses client-asserted exam-pool
 * approval (#39) via coerceAuthoredScenarioWrite.
 *
 * Counterweight: creating a proposal must not write authored persistence. Approving
 * without a faculty patch on a high-uncertainty field (score >= 0.5, midpoint of
 * the 0–1 unit interval) must fail even if acceptedFieldPaths lists that field.
 * Direct POST /scenarios with status approved still demotes to draft.
 *
 * ## FIXED (#0)
 * registerAuthoringRoutes mounts POST/GET /internal/scenario-proposals, POST
 * .../patches, and POST .../approve. Generated fields require model provenance
 * and uncertainty. Faculty patches are append-only. Only approve writes an
 * authored scenario compilation can read.
 */

import { DEFAULT_DEV_AUTH_SECRET, signAuthToken } from "@openclinxr/auth";
import { clinicKneePainScenario } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import {
  ApiApplication,
  type ApiPersistenceSink,
  registerAuthoringRoutes,
  registerExamRoutes,
  routeById,
} from "../index.js";

const PROPOSALS_PATH = "/internal/scenario-proposals";
const SCENARIO_ID = "model_proposal_knee_staging_v1";
const TITLE_PATH = "title";
const OBJECTIVE_PATH = "clinicalObjectives.0";
const MODEL_TITLE = "Model-proposed clinic knee pain return-to-play draft";
const NOW = "2026-09-11T12:00:00.000Z";

type ProposalBody = {
  proposal: {
    proposalId: string;
    status: "draft" | "approved";
    generatedFields: Array<{
      path: string;
      value: unknown;
      provenance: { source: string; providerId: string; generatedAt: string };
      uncertainty: { score: number; rationale: string };
    }>;
    patchTrail: Array<{ path: string; previous: unknown; next: unknown; reviewerId: string }>;
    currentRevision: Scenario;
  };
  scenario?: Scenario;
};

function seedScenario(): Scenario {
  return {
    ...structuredClone(clinicKneePainScenario),
    scenarioId: SCENARIO_ID,
    title: "Placeholder title awaiting model overlay",
  };
}

function clientAssertedApprovedScenario(): Scenario {
  const seed = seedScenario();
  return {
    ...seed,
    status: "approved",
    title: MODEL_TITLE,
    review: {
      clinical: "approved",
      psychometric: "approved",
      legal: "approved",
      simulationQa: "approved",
    },
    governance: {
      ...seed.governance,
      validationStage: "stage_1_expert_reviewed",
    },
  };
}

function generatedFields(titleUncertainty = 0.72) {
  return [
    {
      path: TITLE_PATH,
      value: MODEL_TITLE,
      provenance: {
        source: "model" as const,
        providerId: "mock-model",
        generatedAt: NOW,
      },
      uncertainty: {
        score: titleUncertainty,
        rationale: "Title is a free-text generation with no faculty review yet.",
      },
    },
    {
      path: OBJECTIVE_PATH,
      value: "Elicit mechanism of injury from the athlete without promising clearance",
      provenance: {
        source: "model" as const,
        providerId: "mock-model",
        generatedAt: NOW,
      },
      uncertainty: {
        score: 0.2,
        rationale: "Objective restates an existing fixture line.",
      },
    },
  ];
}

function memoryAuthored(): ApiPersistenceSink & { stored: Map<string, Scenario> } {
  const stored = new Map<string, Scenario>();
  return {
    stored,
    saveAuthoredScenario: (scenario) => {
      stored.set(scenario.scenarioId, scenario);
    },
    listAuthoredScenarios: () => [...stored.values()],
    getAuthoredScenario: (scenarioId) => stored.get(scenarioId),
  };
}

function compose(persistence: ApiPersistenceSink) {
  return ApiApplication.create()
    .withContext(undefined, persistence, { auth: { allowDevDefaultIdentity: false } })
    .withCoreMiddleware()
    .withRoutes((app, ctx) => {
      registerAuthoringRoutes(app, ctx);
      registerExamRoutes(app, ctx);
    })
    .build();
}

function authHeader(role: "learner" | "faculty" | "admin"): Record<string, string> {
  const identity =
    role === "learner"
      ? { subject: "learner_proposal", role, learnerId: "learner_proposal" as const }
      : { subject: `${role}_proposal`, role };
  return {
    authorization: `Bearer ${signAuthToken({
      identity,
      secret: DEFAULT_DEV_AUTH_SECRET,
    })}`,
  };
}

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("a model proposal reaches authoring only after faculty approval", () => {
  it("stores a provenance-tagged draft, an auditable patch trail, and an approval-only authored scenario", async () => {
    const persistence = memoryAuthored();
    const app = compose(persistence).app;
    const faculty = authHeader("faculty");

    const created = await app.request(PROPOSALS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...faculty },
      body: JSON.stringify({ scenario: seedScenario(), generatedFields: generatedFields() }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as ProposalBody;
    expect(createdBody.proposal.status).toBe("draft");
    expect(createdBody.proposal.currentRevision.status).toBe("draft");
    expect(createdBody.proposal.currentRevision.title).toBe(MODEL_TITLE);
    expect(createdBody.proposal.generatedFields).toHaveLength(2);
    for (const field of createdBody.proposal.generatedFields) {
      expect(field.provenance.source).toBe("model");
      expect(field.provenance.providerId.length).toBeGreaterThan(0);
      expect(field.uncertainty.rationale.length).toBeGreaterThan(0);
      expect(field.uncertainty.score).toBeGreaterThanOrEqual(0);
      expect(field.uncertainty.score).toBeLessThanOrEqual(1);
    }
    expect(createdBody.proposal.patchTrail).toEqual([]);
    expect(persistence.stored.size).toBe(0);

    const listedDraft = await app.request(routeById("list-authored-scenarios").path, { headers: faculty });
    expect(((await listedDraft.json()) as { scenarios: Scenario[] }).scenarios).toEqual([]);

    const missingProvenance = await app.request(PROPOSALS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...faculty },
      body: JSON.stringify({
        scenario: seedScenario(),
        generatedFields: [{ path: TITLE_PATH, value: MODEL_TITLE, uncertainty: { score: 0.1, rationale: "x" } }],
      }),
    });
    expect(missingProvenance.status).toBe(400);

    const learnerCreate = await app.request(PROPOSALS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader("learner") },
      body: JSON.stringify({ scenario: seedScenario(), generatedFields: generatedFields() }),
    });
    expect(learnerCreate.status).toBe(403);

    const proposalId = createdBody.proposal.proposalId;
    const prematureApprove = await app.request(`${PROPOSALS_PATH}/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", ...faculty },
      body: JSON.stringify({
        reviewerId: "faculty_proposal",
        comments: "Looks fine.",
        evidenceRefs: ["review://proposal/unchecked"],
        acceptedFieldPaths: [TITLE_PATH, OBJECTIVE_PATH],
      }),
    });
    expect(prematureApprove.status).toBe(409);
    const prematureJson = await jsonOf(prematureApprove);
    expect(JSON.stringify(prematureJson["blockers"])).toContain("high_uncertainty_requires_patch:title");
    expect(persistence.stored.size).toBe(0);

    const patched = await app.request(`${PROPOSALS_PATH}/${proposalId}/patches`, {
      method: "POST",
      headers: { "content-type": "application/json", ...faculty },
      body: JSON.stringify({
        path: TITLE_PATH,
        previous: MODEL_TITLE,
        next: "Clinic knee pain with return-to-play pressure (faculty-edited)",
        reviewerId: "faculty_proposal",
        at: "2026-09-11T12:05:00.000Z",
        rationale: "Remove model hedging; keep sports-clinic wording.",
      }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as ProposalBody;
    expect(patchedBody.proposal.patchTrail).toHaveLength(1);
    expect(patchedBody.proposal.patchTrail[0]?.path).toBe(TITLE_PATH);
    expect(patchedBody.proposal.currentRevision.title).toContain("faculty-edited");
    expect(persistence.stored.size).toBe(0);

    const stalePatch = await app.request(`${PROPOSALS_PATH}/${proposalId}/patches`, {
      method: "POST",
      headers: { "content-type": "application/json", ...faculty },
      body: JSON.stringify({
        path: TITLE_PATH,
        previous: MODEL_TITLE,
        next: "Ignored",
        reviewerId: "faculty_proposal",
        at: "2026-09-11T12:06:00.000Z",
        rationale: "Stale previous must fail.",
      }),
    });
    expect(stalePatch.status).toBe(400);

    const approved = await app.request(`${PROPOSALS_PATH}/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", ...faculty },
      body: JSON.stringify({
        reviewerId: "faculty_proposal",
        comments: "Title patched; remaining low-uncertainty objective accepted.",
        evidenceRefs: ["review://proposal/title-patch"],
        acceptedFieldPaths: [OBJECTIVE_PATH],
      }),
    });
    expect(approved.status).toBe(200);
    const approvedBody = (await approved.json()) as ProposalBody;
    expect(approvedBody.proposal.status).toBe("approved");
    expect(approvedBody.scenario?.status).toBe("approved");
    expect(approvedBody.scenario?.title).toContain("faculty-edited");
    expect(persistence.stored.get(SCENARIO_ID)?.status).toBe("approved");

    const fetched = await app.request(`${routeById("get-authored-scenario").path.replace(":scenarioId", SCENARIO_ID)}`, {
      headers: faculty,
    });
    expect(fetched.status).toBe(200);
    expect(((await fetched.json()) as { scenario: Scenario }).scenario.status).toBe("approved");

    const form = await app.request(routeById("create-exam-form").path, {
      method: "POST",
      headers: { "content-type": "application/json", ...faculty },
      body: JSON.stringify({ examFormId: "form_proposal_compile_001", stationCount: 32 }),
    });
    expect(form.status).toBe(201);
    const formBody = (await form.json()) as { stationRefs: Array<{ scenarioId: string }> };
    expect(formBody.stationRefs.map((ref) => ref.scenarioId)).toContain(SCENARIO_ID);

    const replayApprove = await app.request(`${PROPOSALS_PATH}/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", ...faculty },
      body: JSON.stringify({
        reviewerId: "faculty_proposal",
        comments: "Second approve.",
        evidenceRefs: ["review://proposal/again"],
        acceptedFieldPaths: [OBJECTIVE_PATH],
      }),
    });
    expect(replayApprove.status).toBe(409);

    const clientAsserted = memoryAuthored();
    const assertedApp = compose(clientAsserted).app;
    const save = await assertedApp.request(routeById("save-authored-scenario").path, {
      method: "POST",
      headers: { "content-type": "application/json", ...faculty },
      body: JSON.stringify({ scenario: clientAssertedApprovedScenario() }),
    });
    expect(save.status).toBe(201);
    expect(clientAsserted.stored.get(SCENARIO_ID)?.status).toBe("draft");
  });
});
