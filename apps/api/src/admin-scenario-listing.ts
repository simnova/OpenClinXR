import {
  AdminGraphqlReviewDecision,
  type AdminGraphqlScenario,
  AdminGraphqlScenarioStatus,
} from "@openclinxr/graphql";
import { scenarioBank } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";
import type {
  ApiPersistenceSink,
  ApiScenarioReviewDecisionRecord,
  ApiScenarioReviewerRole,
} from "./api-types.js";

/**
 * Admin scenario listing that unions fixture bank + authored persistence.
 *
 * Authored scenarios win over fixtures when scenarioId+version collide.
 * Each entry carries a stable `catalog_source:fixture` or `catalog_source:authored`
 * marker injected into `governance.sourceIds` so GraphQL consumers can distinguish
 * fixture-bundled vs authoring-persisted scenarios without a schema change.
 */

function scenarioVersionKey(scenarioId: string, version: number): string {
  return `${scenarioId}:${version}`;
}

/**
 * Admin scenario listing that unions fixture bank + authored persistence.
 *
 * Authored scenarios win over fixtures when scenarioId+version collide.
 * Each entry carries a stable `catalog_source:fixture` or `catalog_source:authored`
 * marker injected into `governance.sourceIds` so GraphQL consumers can distinguish
 * fixture-bundled vs authoring-persisted scenarios without a schema change.
 */

/** Append a catalog-source marker to governance.sourceIds (non-mutating). */
function withCatalogSourceMarker(
  scenario: AdminGraphqlScenario,
  source: "fixture" | "authored",
): AdminGraphqlScenario {
  const marker = `catalog_source:${source}`;
  const sourceIds = scenario.governance.sourceIds;
  if (sourceIds.includes(marker)) return scenario;
  return {
    ...scenario,
    governance: {
      ...scenario.governance,
      sourceIds: [...sourceIds, marker],
    },
  };
}

function scenarioStatusForReview(review: AdminGraphqlScenario["review"]): AdminGraphqlScenario["status"] {
  if (Object.values(review).every((state) => state === "approved")) {
    return AdminGraphqlScenarioStatus.Approved;
  }
  if (Object.values(review).some((state) => state === "changes_requested")) {
    return AdminGraphqlScenarioStatus.Draft;
  }
  return AdminGraphqlScenarioStatus.ReadyForReview;
}

/**
 * #41 — authored document gates are not authoritative for `approved`.
 *
 * Clients (and stale pre-#41 docs) can store all four gates as approved. Listing used to seed
 * from the document then overlay decisions, so one real decision on any gate completed 4/4 and
 * promoted. Fixtures legitimately ship approved without decision records — do not call this on
 * the fixture branch. In-memory overrides already carry decision-applied state; leave them alone.
 */
function withoutClientAssertedAuthoredApprovals(
  scenario: AdminGraphqlScenario,
): AdminGraphqlScenario {
  const demote = (state: string): string => (state === "approved" ? "draft" : state);
  const review = {
    clinical: demote(scenario.review.clinical),
    psychometric: demote(scenario.review.psychometric),
    legal: demote(scenario.review.legal),
    simulationQa: demote(scenario.review.simulationQa),
  };
  if (
    review.clinical === scenario.review.clinical
    && review.psychometric === scenario.review.psychometric
    && review.legal === scenario.review.legal
    && review.simulationQa === scenario.review.simulationQa
  ) {
    return scenario;
  }
  return {
    ...scenario,
    review,
    status: scenarioStatusForReview(review),
  };
}

function toAdminGraphqlScenarioStatus(status: (typeof scenarioBank)[number]["status"]): AdminGraphqlScenario["status"] {
  switch (status) {
    case "approved":
      return AdminGraphqlScenarioStatus.Approved;
    case "retired":
      return AdminGraphqlScenarioStatus.Archived;
    case "draft":
      return AdminGraphqlScenarioStatus.Draft;
  }
}

export function toAdminGraphqlScenario(scenario: Scenario): AdminGraphqlScenario {
  return {
    scenarioId: scenario.scenarioId,
    version: scenario.version,
    title: scenario.title,
    status: toAdminGraphqlScenarioStatus(scenario.status),
    clinicalObjectives: scenario.clinicalObjectives,
    actors: scenario.actors.map(({ hiddenFacts: _hiddenFacts, ...actor }) => actor),
    requiredTraceTags: scenario.requiredTraceTags,
    review: { ...scenario.review },
    governance: scenario.governance,
    equipment: [...(scenario.equipment ?? [])],
    assetNeeds: [...(scenario.assetNeeds ?? [])],
    ...(scenario.environment === undefined ? {} : { environment: scenario.environment }),
  };
}

function applyScenarioReviewDecision(
  scenario: AdminGraphqlScenario,
  reviewDecision: ApiScenarioReviewDecisionRecord,
): AdminGraphqlScenario {
  const nextReview = {
    ...scenario.review,
    [reviewDecision.reviewerRole]: reviewDecision.decision,
  };

  return {
    ...scenario,
    review: nextReview,
    status: scenarioStatusForReview(nextReview),
  };
}

function compareScenarioReviewDecisions(
  left: ApiScenarioReviewDecisionRecord,
  right: ApiScenarioReviewDecisionRecord,
): number {
  return (
    Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt) ||
    left.scenarioId.localeCompare(right.scenarioId) ||
    left.version - right.version ||
    left.reviewerRole.localeCompare(right.reviewerRole) ||
    left.reviewerId.localeCompare(right.reviewerId)
  );
}

async function listScenarioReviewDecisionRecords(
  persistence: ApiPersistenceSink,
): Promise<ApiScenarioReviewDecisionRecord[]> {
  const reviewDecisions = await Promise.resolve(persistence.listScenarioReviewDecisions?.() ?? []);
  return [...reviewDecisions].sort(compareScenarioReviewDecisions);
}

export async function listAdminGraphqlScenarios(
  persistence: ApiPersistenceSink,
  scenarioOverrides: Map<string, AdminGraphqlScenario>,
): Promise<AdminGraphqlScenario[]> {
  const reviewDecisions = await listScenarioReviewDecisionRecords(persistence);

  // Build fixture entries with catalog_source:fixture marker.
  const fixtureEntries = scenarioBank.map((scenario) => {
    const scenarioKey = scenarioVersionKey(scenario.scenarioId, scenario.version);
    const baseScenario = scenarioOverrides.get(scenarioKey) ?? toAdminGraphqlScenario(scenario);
    const withReviews = reviewDecisions
      .filter((d) => d.scenarioId === baseScenario.scenarioId && d.version === baseScenario.version)
      .sort(compareScenarioReviewDecisions)
      .reduce(applyScenarioReviewDecision, baseScenario);
    return withCatalogSourceMarker(withReviews, "fixture");
  });

  // Build authored entries from persistence.
  const authoredScenarios = (await persistence.listAuthoredScenarios?.()) ?? [];
  const fixtureKeySet = new Set(scenarioBank.map((s) => scenarioVersionKey(s.scenarioId, s.version)));

  const authoredEntries = authoredScenarios.map((scenario) => {
    const key = scenarioVersionKey(scenario.scenarioId, scenario.version);
    // Authored wins over fixture for same id+version; remove fixture duplicate.
    if (fixtureKeySet.has(key)) {
      const idx = fixtureEntries.findIndex(
        (e) => e.scenarioId === scenario.scenarioId && e.version === scenario.version,
      );
      if (idx !== -1) fixtureEntries.splice(idx, 1);
    }
    // Overrides already reflect applied decisions; document seed must not trust client-asserted approvals.
    const fromOverride = scenarioOverrides.get(key);
    const baseScenario = fromOverride
      ?? withoutClientAssertedAuthoredApprovals(toAdminGraphqlScenario(scenario));
    const withReviews = reviewDecisions
      .filter((d) => d.scenarioId === baseScenario.scenarioId && d.version === baseScenario.version)
      .sort(compareScenarioReviewDecisions)
      .reduce(applyScenarioReviewDecision, baseScenario);
    return withCatalogSourceMarker(withReviews, "authored");
  });

  return [...fixtureEntries, ...authoredEntries];
}
