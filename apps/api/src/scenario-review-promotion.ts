import {
  type AdminGraphqlScenario,
  AdminGraphqlScenarioStatus,
} from "@openclinxr/graphql";
import { scenarioBank } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";
import type { ApiPersistenceSink, ApiScenarioReviewDecisionRecord } from "./api-types.js";

/**
 * #39 — review promotion must reach the store exam assembly reads.
 *
 * `applyScenarioReviewDecision` already derives status from gates. The submit path used to
 * keep that result only in the in-memory GraphQL override map. Exam assembly reads
 * `listAuthoredScenarios()`, so promotion was discarded unless the client self-set status.
 *
 * Promote on review gates only (not publication readiness — that gates on status already
 * approved and would never fire). Client POST cannot self-approve (see authoring-routes).
 *
 * #42 — stage_0 → stage_1 is a claim-bearing advance (claim-language "Expert reviewed for
 * prototype use."). It remains derived from four gate approvals, but must carry a retrievable
 * basis naming the decisions. Never auto-advance stage_2 / stage_3 / validated_summative.
 */

type DomainScenarioStatus = Scenario["status"];
type DomainReviewGate = Scenario["review"]["clinical"];

/**
 * Retrievable basis for a derived stage_0 → stage_1 claim.
 * Stored on governance (not a separate audit store) so a later reader of the scenario document
 * can see which approved gate decisions justified the stage without reconstructing history.
 * Shape choice recorded in commit: decision set by reviewerRole + reviewerId + reviewedAt
 * (records have no stable id). validateScenario does not yet require this when it sees stage_1
 * (out of scope — historical fixtures would fail).
 */
export type ValidationStageBasis = {
  kind: "derived_from_review_gate_approvals";
  fromStage: "stage_0_synthetic_draft";
  toStage: "stage_1_expert_reviewed";
  derivedAt: string;
  claimScope: "stage_1_expert_reviewed_from_four_gate_approvals";
  notEvidenceFor: readonly [
    "stage_2_pilot_ready",
    "stage_3_validated",
    "validated_summative",
    "clinical_validity",
    "exam_equivalence",
  ];
  justifyingDecisions: ReadonlyArray<{
    reviewerRole: ApiScenarioReviewDecisionRecord["reviewerRole"];
    reviewerId: string;
    decision: "approved";
    reviewedAt: string;
    evidenceRefs: readonly string[];
  }>;
};

type ScenarioGovernanceWithBasis = Scenario["governance"] & {
  validationStageBasis?: ValidationStageBasis;
};

const STAGE1_GATE_ROLES = ["clinical", "psychometric", "legal", "simulationQa"] as const;

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
 * Build stage_1 basis from persisted approved gate decisions for this scenario version.
 * Returns undefined when any of the four gates lacks an approved decision — never stamp
 * stage_1 with an empty or partial basis.
 */
async function buildStage1ValidationStageBasis(
  persistence: Pick<ApiPersistenceSink, "listScenarioReviewDecisions">,
  scenarioId: string,
  version: number,
): Promise<ValidationStageBasis | undefined> {
  const records = (await Promise.resolve(persistence.listScenarioReviewDecisions?.() ?? []))
    .filter(
      (record) =>
        record.scenarioId === scenarioId
        && record.version === version
        && record.decision === "approved",
    )
    .slice()
    .sort((left, right) => Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt));

  // Latest approved decision per gate role (re-review after changes_requested is allowed).
  const latestByRole = new Map<ApiScenarioReviewDecisionRecord["reviewerRole"], ApiScenarioReviewDecisionRecord>();
  for (const record of records) {
    latestByRole.set(record.reviewerRole, record);
  }

  const justifyingDecisions = STAGE1_GATE_ROLES.map((role) => latestByRole.get(role)).filter(
    (record): record is ApiScenarioReviewDecisionRecord => record !== undefined,
  );
  if (justifyingDecisions.length !== STAGE1_GATE_ROLES.length) {
    return undefined;
  }

  return {
    kind: "derived_from_review_gate_approvals",
    fromStage: "stage_0_synthetic_draft",
    toStage: "stage_1_expert_reviewed",
    derivedAt: new Date().toISOString(),
    claimScope: "stage_1_expert_reviewed_from_four_gate_approvals",
    notEvidenceFor: [
      "stage_2_pilot_ready",
      "stage_3_validated",
      "validated_summative",
      "clinical_validity",
      "exam_equivalence",
    ],
    justifyingDecisions: justifyingDecisions.map((record) => ({
      reviewerRole: record.reviewerRole,
      reviewerId: record.reviewerId,
      decision: "approved" as const,
      reviewedAt: record.reviewedAt,
      evidenceRefs: [...record.evidenceRefs],
    })),
  };
}

/**
 * stage_0 → stage_1 only, and only with a non-empty basis from four approved gate decisions.
 * No basis ⇒ no advance (do not invent attribution).
 */
async function nextGovernanceForPromotion(
  persistence: ApiPersistenceSink,
  base: Scenario,
  domainStatus: DomainScenarioStatus,
): Promise<ScenarioGovernanceWithBasis> {
  if (domainStatus !== "approved" || base.governance.validationStage !== "stage_0_synthetic_draft") {
    return base.governance;
  }

  const validationStageBasis = await buildStage1ValidationStageBasis(
    persistence,
    base.scenarioId,
    base.version,
  );
  if (!validationStageBasis) {
    return base.governance;
  }

  return {
    ...base.governance,
    validationStage: "stage_1_expert_reviewed",
    validationStageBasis,
  };
}

/**
 * Bank fixtures are TypeScript catalog entries, not authored documents. On first review decision,
 * clone the matching fixture into the authored store so subsequent promotion updates reach
 * `buildExamAssemblyScenarioPool` (authored ∪ bank, authored wins when approved).
 *
 * Chosen over "promotion reads bank directly" (would leave no durable authored document for
 * governance.validationStageBasis / later edits) and over requiring a separate human "import to
 * authored" click before any gate can land (extra step with no safety benefit once a reviewer has
 * already decided).
 */
function findBankFixtureScenario(scenarioId: string, version: number): Scenario | undefined {
  return scenarioBank.find(
    (candidate) => candidate.scenarioId === scenarioId && candidate.version === version,
  );
}

/**
 * Persist review-derived status/gates onto the authored scenario document so
 * `buildExamAssemblyScenarioPool` (listAuthoredScenarios + status === approved) sees promotion.
 * Clone-on-first-review for bank fixtures; no-op when save is unavailable or no base exists.
 */
export async function persistAuthoredScenarioReviewPromotion(
  persistence: ApiPersistenceSink,
  nextScenario: AdminGraphqlScenario,
): Promise<void> {
  if (!persistence.saveAuthoredScenario) return;

  let base = await findAuthoredScenarioDocument(
    persistence,
    nextScenario.scenarioId,
    nextScenario.version,
  );
  // #176 — bank fixtures were never cloned: decisions recorded, GraphQL listing updated, promotion
  // silently no-oped. Clone the fixture into the authored store on first review so the pool can
  // see approved gates after a complete four-gate set.
  if (!base) {
    base = findBankFixtureScenario(nextScenario.scenarioId, nextScenario.version);
  }
  if (!base) return;

  const domainStatus = toDomainScenarioStatus(nextScenario.status);
  const nextGovernance = await nextGovernanceForPromotion(persistence, base, domainStatus);

  const promoted: Scenario = {
    ...base,
    status: domainStatus,
    review: {
      clinical: toDomainReviewGate(nextScenario.review.clinical),
      psychometric: toDomainReviewGate(nextScenario.review.psychometric),
      legal: toDomainReviewGate(nextScenario.review.legal),
      simulationQa: toDomainReviewGate(nextScenario.review.simulationQa),
    },
    // Basis is additive claim metadata; Scenario static type does not yet model it (schema optional
    // field deferred — historical stage_1 fixtures have no basis; validateScenario unchanged).
    governance: nextGovernance as Scenario["governance"],
  };

  await persistence.saveAuthoredScenario(promoted);
}

/**
 * Authoring POST must not admit client-asserted approval into the exam pool.
 *
 * #39 demoted `status: "approved"`. #41 also strips client-asserted `review` gates that read
 * `approved`: `scenarioStatusForReview` promotes when all four gates are approved, so a client
 * that POSTs four pre-approved gates needs only one genuine submit to enter the pool. Gate
 * approvals are server-owned and written only by the submit path (plus listing seed neutralize
 * for documents already stored with asserted gates).
 *
 * Promotion is exclusive to submitScenarioReview → persistAuthoredScenarioReviewPromotion.
 * Does not touch governance.validationStage (tracked separately).
 */
export function coerceAuthoredScenarioWrite(scenario: Scenario): Scenario {
  const status = scenario.status === "approved" ? "draft" : scenario.status;
  const review = neutralizeClientAssertedApprovedGates(scenario.review);
  if (status === scenario.status && review === scenario.review) return scenario;
  return { ...scenario, status, review };
}

/** Demote only the dangerous claim (`approved`); leave draft/in_review/rejected intact. */
export function neutralizeClientAssertedApprovedGates(
  review: Scenario["review"],
): Scenario["review"] {
  const demote = (gate: Scenario["review"]["clinical"]): Scenario["review"]["clinical"] =>
    gate === "approved" ? "draft" : gate;
  const next = {
    clinical: demote(review.clinical),
    psychometric: demote(review.psychometric),
    legal: demote(review.legal),
    simulationQa: demote(review.simulationQa),
  };
  if (
    next.clinical === review.clinical
    && next.psychometric === review.psychometric
    && next.legal === review.legal
    && next.simulationQa === review.simulationQa
  ) {
    return review;
  }
  return next;
}
