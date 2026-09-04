import { adminGraphqlDocumentByOperationName } from "@openclinxr/graphql";
import { pediatricAsthmaScenario } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import { toAdminGraphqlScenario } from "./admin-scenario-listing.js";
import { createApiApp } from "./index.js";
import type { ApiPersistenceSink, ApiScenarioReviewDecisionRecord } from "./api-types.js";
import {
  AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX,
  authoredScenarioContentIdentity,
  STALE_AUTHORED_SCENARIO_REVIEW_IDENTITY_ERROR,
} from "./scenario-review-promotion.js";

/**
 * API-domain contract for identity-bound faculty review (BothyBoard tsk_cb14bedfb55b0f28).
 *
 * UI slice bfc98fcb hashes the COMPLETE authored scenario minus documented non-authored
 * keys (`review`, `status`, nested `__typename`). Direct GraphQL callers must not promote
 * an obsolete review by omitting that bind. Promotion copies only current-identity gates.
 */

const GATES = ["clinical", "psychometric", "legal", "simulationQa"] as const;
const SCENARIO_ID = "stale_identity_case_v1";

function memorySink(): ApiPersistenceSink {
  const store = new Map<string, Scenario>();
  const decisions: ApiScenarioReviewDecisionRecord[] = [];
  return {
    saveAuthoredScenario: (scenario) => {
      store.set(`${scenario.scenarioId}::${scenario.version}`, scenario);
    },
    listAuthoredScenarios: () => Array.from(store.values()),
    getAuthoredScenario: (scenarioId) =>
      Array.from(store.values())
        .filter((scenario) => scenario.scenarioId === scenarioId)
        .sort((left, right) => right.version - left.version)[0],
    saveScenarioReviewDecision: (record) => {
      decisions.push(record);
    },
    listScenarioReviewDecisions: () => decisions,
  };
}

function draftScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    ...pediatricAsthmaScenario,
    scenarioId: SCENARIO_ID,
    title: "authored stale_identity_case_v1",
    status: "draft",
    review: {
      clinical: "draft",
      psychometric: "draft",
      legal: "draft",
      simulationQa: "draft",
    },
    ...overrides,
  };
}

function listingIdentity(scenario: Scenario): string {
  const graphqlScenario = toAdminGraphqlScenario(scenario);
  const marker = "catalog_source:authored";
  const dressed = graphqlScenario.governance.sourceIds.includes(marker)
    ? graphqlScenario
    : {
        ...graphqlScenario,
        governance: {
          ...graphqlScenario.governance,
          sourceIds: [...graphqlScenario.governance.sourceIds, marker],
        },
      };
  return authoredScenarioContentIdentity(dressed);
}

async function submitReview(
  app: ReturnType<typeof createApiApp>,
  input: {
    scenarioId?: string;
    version?: number;
    reviewerRole: string;
    identity?: string;
    comments?: string;
  },
): Promise<{ status: number; body: { data?: { submitScenarioReview?: { status: string; review: Record<string, string> } }; errors?: Array<{ message: string }> } }> {
  const document = adminGraphqlDocumentByOperationName("SubmitScenarioReview");
  const evidenceRefs = [
    `evidence:${SCENARIO_ID}:${input.reviewerRole}`,
    ...(input.identity === undefined ? [] : [`${AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX}${input.identity}`]),
  ];
  const response = await app.request("/admin/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: document.source,
      operationName: "SubmitScenarioReview",
      variables: {
        input: {
          scenarioId: input.scenarioId ?? SCENARIO_ID,
          version: input.version ?? draftScenario().version,
          reviewerRole: input.reviewerRole,
          reviewerId: `reviewer_${input.reviewerRole}`,
          decision: "APPROVED",
          comments: input.comments ?? `${input.reviewerRole} gate approved for local formative review.`,
          evidenceRefs,
        },
      },
    }),
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      data?: { submitScenarioReview?: { status: string; review: Record<string, string> } };
      errors?: Array<{ message: string }>;
    },
  };
}

async function consideredIds(app: ReturnType<typeof createApiApp>): Promise<string[]> {
  const response = await app.request("/exam-blueprints/step2cs-seed/readiness");
  const body = (await response.json()) as { consideredScenarioIds?: string[] };
  return body.consideredScenarioIds ?? [];
}

describe("the API refuses stale scenario review identity", () => {
  it("hashes complete authored content, not a field subset", () => {
    const base = toAdminGraphqlScenario(draftScenario());
    const titleEdited = toAdminGraphqlScenario(draftScenario({ title: "authored stale_identity_case_v1 (edited stem)" }));
    const environmentEdited = toAdminGraphqlScenario({
      ...draftScenario(),
      environment: { environmentId: "telehealth_home_visit_v1", name: "Home visit", description: "Bay 2" },
    } as Scenario);
    const actor = draftScenario().actors[0]!;
    const nestedEdited = toAdminGraphqlScenario({
      ...draftScenario(),
      actors: [
        {
          ...actor,
          emotionPolicy: {
            ...(actor as { emotionPolicy?: Record<string, string> }).emotionPolicy,
            peakAffect: "panic",
          },
        },
      ],
    } as Scenario);
    const labelsOnly = toAdminGraphqlScenario(
      draftScenario({
        status: "approved",
        review: {
          clinical: "approved",
          psychometric: "approved",
          legal: "changes_requested",
          simulationQa: "approved",
        },
      }),
    );

    expect(authoredScenarioContentIdentity(base)).not.toBe(authoredScenarioContentIdentity(titleEdited));
    expect(authoredScenarioContentIdentity(base)).not.toBe(authoredScenarioContentIdentity(environmentEdited));
    expect(authoredScenarioContentIdentity(base)).not.toBe(authoredScenarioContentIdentity(nestedEdited));
    expect(authoredScenarioContentIdentity(base)).toBe(authoredScenarioContentIdentity(labelsOnly));

    const reordered = {
      version: base.version,
      title: base.title,
      scenarioId: base.scenarioId,
      clinicalObjectives: base.clinicalObjectives,
      requiredTraceTags: base.requiredTraceTags,
      governance: base.governance,
      equipment: base.equipment,
      actors: base.actors,
      assetNeeds: base.assetNeeds,
      ...(base.environment === undefined ? {} : { environment: base.environment }),
      review: base.review,
      status: base.status,
    };
    expect(authoredScenarioContentIdentity(base)).toBe(authoredScenarioContentIdentity(reordered));
  });

  it("records an approval bound to the current listing identity", async () => {
    const sink = memorySink();
    const app = createApiApp(undefined, sink);
    const scenario = draftScenario();
    await app.request("/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario }),
    });

    const identity = listingIdentity(scenario);
    const submitted = await submitReview(app, { reviewerRole: "clinical", identity });
    expect(submitted.status).toBe(200);
    expect(submitted.body.errors).toBeUndefined();
    expect(submitted.body.data?.submitScenarioReview?.review.clinical).toBe("approved");

    const stored = (await Promise.resolve(sink.listScenarioReviewDecisions?.() ?? []))[0];
    expect(authoredContentIdentityFromStored(stored)).toBe(identity);
  });

  it("refuses an approval whose submitted identity no longer matches persisted content", async () => {
    const app = createApiApp(undefined, memorySink());
    const original = draftScenario();
    await app.request("/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: original }),
    });

    const staleIdentity = listingIdentity(original);
    await app.request("/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenario: draftScenario({ title: "authored stale_identity_case_v1 (edited stem)" }),
      }),
    });

    const submitted = await submitReview(app, { reviewerRole: "clinical", identity: staleIdentity });
    expect(submitted.status).toBe(200);
    expect(submitted.body.errors?.[0]?.message).toContain(STALE_AUTHORED_SCENARIO_REVIEW_IDENTITY_ERROR);
    expect(submitted.body.data?.submitScenarioReview).toBeFalsy();
  });

  it("four current-identity approvals still promote into the exam assembly pool", async () => {
    const sink = memorySink();
    const app = createApiApp(undefined, sink);
    const scenario = draftScenario();
    await app.request("/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
    const identity = listingIdentity(scenario);

    for (const reviewerRole of GATES) {
      const submitted = await submitReview(app, { reviewerRole, identity });
      expect(submitted.body.errors).toBeUndefined();
    }

    expect(await consideredIds(app)).toContain(SCENARIO_ID);
    const stored = (await Promise.resolve(sink.listAuthoredScenarios?.() ?? []))
      .find((candidate) => candidate.scenarioId === SCENARIO_ID);
    expect(stored?.status).toBe("approved");
    expect(stored?.governance.validationStage).toBe("stage_1_expert_reviewed");
  });

  it("does not promote leftover gate labels after authored content identity moves", async () => {
    const sink = memorySink();
    const app = createApiApp(undefined, sink);
    const original = draftScenario();
    await app.request("/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: original }),
    });
    const originalIdentity = listingIdentity(original);

    for (const reviewerRole of GATES) {
      const submitted = await submitReview(app, { reviewerRole, identity: originalIdentity });
      expect(submitted.body.errors).toBeUndefined();
    }
    expect(await consideredIds(app)).toContain(SCENARIO_ID);

    const edited = draftScenario({ title: "authored stale_identity_case_v1 (edited stem)" });
    await app.request("/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: edited }),
    });

    const currentIdentity = listingIdentity(edited);
    expect(currentIdentity).not.toBe(originalIdentity);

    const clinicalAgain = await submitReview(app, { reviewerRole: "clinical", identity: currentIdentity });
    expect(clinicalAgain.body.errors).toBeUndefined();
    expect(clinicalAgain.body.data?.submitScenarioReview?.status).not.toBe("APPROVED");
    expect(clinicalAgain.body.data?.submitScenarioReview?.review.psychometric).not.toBe("approved");

    expect(await consideredIds(app)).not.toContain(SCENARIO_ID);
    const stored = (await Promise.resolve(sink.listAuthoredScenarios?.() ?? []))
      .find((candidate) => candidate.scenarioId === SCENARIO_ID);
    expect(stored?.status).not.toBe("approved");
    expect(stored?.review.clinical).toBe("approved");
    expect(stored?.review.psychometric).not.toBe("approved");
    expect(stored?.governance.validationStage).not.toBe("stage_1_expert_reviewed");
  });

  it("legacy submits without an identity ref still promote when content is unchanged", async () => {
    const app = createApiApp(undefined, memorySink());
    await app.request("/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: draftScenario() }),
    });

    for (const reviewerRole of GATES) {
      const submitted = await submitReview(app, { reviewerRole });
      expect(submitted.body.errors).toBeUndefined();
    }

    expect(await consideredIds(app)).toContain(SCENARIO_ID);
  });
});

function authoredContentIdentityFromStored(
  record: ApiScenarioReviewDecisionRecord | undefined,
): string | undefined {
  if (record === undefined) {
    return undefined;
  }
  const fromRefs = record.evidenceRefs.find((ref) => ref.startsWith(AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX));
  if (fromRefs !== undefined) {
    return fromRefs.slice(AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX.length);
  }
  const extra = (record as { authoredContentIdentity?: unknown }).authoredContentIdentity;
  return typeof extra === "string" ? extra : undefined;
}
