import {
  type AdminGraphqlScenario,
  AdminGraphqlScenarioStatus,
} from "@openclinxr/graphql";
import type { Scenario } from "@openclinxr/shared-schemas";
import type { ApiPersistenceSink } from "./api-types.js";

/**
 * #39 — review promotion must reach the store exam assembly reads.
 *
 * `applyScenarioReviewDecision` already derives status from gates. The submit path used to
 * keep that result only in the in-memory GraphQL override map. Exam assembly reads
 * `listAuthoredScenarios()`, so promotion was discarded unless the client self-set status.
 *
 * Promote on review gates only (not publication readiness — that gates on status already
 * approved and would never fire). Client POST cannot self-approve (see authoring-routes).
 */

type DomainScenarioStatus = Scenario["status"];
type DomainReviewGate = Scenario["review"]["clinical"];

function toDomainScenarioStatus(status: AdminGraphqlScenario["status"]): DomainScenarioStatus {
  switch (status) {
    case AdminGraphqlScenarioStatus.Approved:
      return "approved";
    case AdminGraphqlScenarioStatus.Archived:
      return "retired";
    case AdminGraphqlScenarioStatus.Draft:
    case AdminGraphqlScenarioStatus.ReadyForReview:
    default:
      return "draft";
  }
}

function toDomainReviewGate(state: string): DomainReviewGate {
  if (state === "approved") return "approved";
  if (state === "in_review") return "in_review";
  if (state === "changes_requested" || state === "rejected") return "rejected";
  return "draft";
}

async function findAuthoredScenarioDocument(
  persistence: Pick<ApiPersistenceSink, "listAuthoredScenarios" | "getAuthoredScenario">,
  scenarioId: string,
  version: number,
): Promise<Scenario | undefined> {
  const listed = (await Promise.resolve(persistence.listAuthoredScenarios?.() ?? [])) as Scenario[];
  const exact = listed.find((candidate) => candidate.scenarioId === scenarioId && candidate.version === version);
  if (exact) return exact;
  // Fallback: latest by id when list is sparse (some sinks only implement getAuthoredScenario).
  const latest = await Promise.resolve(persistence.getAuthoredScenario?.(scenarioId));
  if (latest && latest.version === version) return latest;
  return undefined;
}

/**
 * Persist review-derived status/gates onto the authored scenario document so
 * `buildExamAssemblyScenarioPool` (listAuthoredScenarios + status === approved) sees promotion.
 * No-op when the scenario is fixture-only (not in authored store) or save is unavailable.
 */
export async function persistAuthoredScenarioReviewPromotion(
  persistence: ApiPersistenceSink,
  nextScenario: AdminGraphqlScenario,
): Promise<void> {
  if (!persistence.saveAuthoredScenario) return;

  const base = await findAuthoredScenarioDocument(
    persistence,
    nextScenario.scenarioId,
    nextScenario.version,
  );
  if (!base) return;

  const domainStatus = toDomainScenarioStatus(nextScenario.status);
  const nextGovernance =
    domainStatus === "approved" && base.governance.validationStage === "stage_0_synthetic_draft"
      ? { ...base.governance, validationStage: "stage_1_expert_reviewed" as const }
      : base.governance;

  const promoted: Scenario = {
    ...base,
    status: domainStatus,
    review: {
      clinical: toDomainReviewGate(nextScenario.review.clinical),
      psychometric: toDomainReviewGate(nextScenario.review.psychometric),
      legal: toDomainReviewGate(nextScenario.review.legal),
      simulationQa: toDomainReviewGate(nextScenario.review.simulationQa),
    },
    governance: nextGovernance,
  };

  await persistence.saveAuthoredScenario(promoted);
}

/**
 * Authoring POST must not admit client-asserted approval into the exam pool.
 * Saves remain legitimate for drafts/imports; only status is demoted. Promotion is exclusive
 * to the submitScenarioReview path (persistAuthoredScenarioReviewPromotion).
 */
export function coerceAuthoredScenarioWrite(scenario: Scenario): Scenario {
  if (scenario.status !== "approved") return scenario;
  return { ...scenario, status: "draft" };
}
