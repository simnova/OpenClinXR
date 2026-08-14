/**
 * #176 — faculty review gate is operable and its output reaches the exam assembly pool.
 *
 * Isolated seam: real `createApiApp()` + `app.request` (no Vite, no browser).
 * UI capability read from ScenarioReviewGatePanel exports (component tests cover React).
 *
 * claimScope: four dimensions recordable with caller-supplied rationale; fully reviewed
 * TEST-SCOPED bank-derived clone reaches authored store + assembly pool.
 * notEvidenceFor: clinical validity of any approval, auto-promotion of shipped bank,
 * exam equivalence, psychometric readiness, per-dimension authorization.
 *
 * Decisions (named; reject list in commit):
 * 1. Clone-on-first-review into authored store — rejected: explicit import click; rejected:
 *    promotion reading bank directly (no durable authored document for stage basis).
 * 2. Unmade decisions render as `pending` (not absent) — reviewers see remaining work.
 * 3. Rationale required; evidenceRefs optional for human (client supplies local procedural ref).
 */

import type { ApiPersistenceSink, ApiScenarioReviewDecisionRecord } from "../../../apps/api/src/api-types.js";
import { createApiApp } from "../../../apps/api/src/index.js";
import { buildExamAssemblyScenarioPool } from "../../../apps/api/src/exam-assembly-pool.js";
import { adminGraphqlDocumentByOperationName } from "../../../packages/openclinxr/graphql/src/index.js";
import {
  createExamStationRunQueue,
  createStep2CsStyleSeedBlueprint,
} from "../../../packages/openclinxr/exam-assembly/src/index.js";
import {
  pediatricAsthmaScenario,
  scenarioBank,
} from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import type { Scenario } from "../../../packages/openclinxr/shared-schemas/src/index.js";
import {
  SCENARIO_REVIEW_RATIONALE_IS_CALLER_SUPPLIED,
  SCENARIO_REVIEW_RECORDABLE_DIMENSIONS,
} from "../../../apps/ui-admin/src/scenario-review-gate-constants.js";

export type ReviewDimension = "clinical" | "psychometric" | "legal" | "simulationQa";

export type ScenarioGateRow = {
  scenarioId: string;
  status: string;
  validationStage: string;
  review: Record<ReviewDimension, string>;
  inAuthoredStore: boolean;
  activationEligible: boolean;
  ineligibleMechanism: string | null;
};

export type FacultyReviewGateReport = {
  rows: ScenarioGateRow[];
  recordableDimensions: ReviewDimension[];
  rationaleIsCallerSupplied: boolean;
  fixturePromotionProbe: {
    clonedScenarioId: string;
    dimensionsSubmitted: ReviewDimension[];
    reachedAuthoredStore: boolean;
    visibleToAssemblyPool: boolean;
    mechanism: string;
  } | null;
  claimScope: string;
  notEvidenceFor: string[];
};

const ALL_DIMENSIONS: ReviewDimension[] = ["clinical", "psychometric", "legal", "simulationQa"];

/** Test-scoped id — must not appear in shipped scenarioBank (counterweight). */
export const ISSUE176_CLONE_SCENARIO_ID = "issue176_faculty_review_gate_clone_v1";
const ISSUE176_MARKER = "ISSUE176_FACULTY_REVIEW_GATE_CLONE";

type HonoLikeApp = {
  request: (input: string, init?: RequestInit) => Promise<Response> | Response;
};

function createAuthoredMemorySink(): ApiPersistenceSink {
  const store = new Map<string, Scenario>();
  const decisions: ApiScenarioReviewDecisionRecord[] = [];
  return {
    saveAuthoredScenario: (scenario) => {
      store.set(`${scenario.scenarioId}::${scenario.version}`, scenario);
    },
    listAuthoredScenarios: () =>
      Array.from(store.values()).sort(
        (a, b) => a.scenarioId.localeCompare(b.scenarioId) || a.version - b.version,
      ),
    getAuthoredScenario: (scenarioId) =>
      Array.from(store.values())
        .filter((s) => s.scenarioId === scenarioId)
        .sort((a, b) => b.version - a.version)[0],
    saveScenarioReviewDecision: (record) => {
      decisions.push(record);
    },
    listScenarioReviewDecisions: () => decisions,
  };
}

function ineligibleMechanism(
  scenario: Scenario,
  inAuthoredStore: boolean,
  activationEligible: boolean,
): string | null {
  if (activationEligible) return null;
  const parts: string[] = [];
  if (scenario.status !== "approved") parts.push(`status_${scenario.status}`);
  for (const [role, state] of Object.entries(scenario.review)) {
    if (state !== "approved") parts.push(`${role}_review_${state}`);
  }
  if (scenario.governance.validationStage === "stage_0_synthetic_draft") {
    parts.push("stage_0_synthetic_draft");
  }
  if (!inAuthoredStore && scenario.status !== "approved") {
    parts.push("promotion_noop_not_in_authored_store");
  }
  if (scenario.governance.scoreUseLabel === "validated_summative") {
    parts.push("validated_summative_forbidden");
  }
  return parts.join("|") || "unknown_ineligible";
}

async function buildShippedBankRows(
  sink: ApiPersistenceSink,
): Promise<ScenarioGateRow[]> {
  // Shipped bank view: empty or ambient authored only — probe clone is not part of shipped rows.
  const pool = await buildExamAssemblyScenarioPool(sink);
  const blueprint = createStep2CsStyleSeedBlueprint();
  const queue = createExamStationRunQueue(blueprint, pool);
  const authored = (await Promise.resolve(sink.listAuthoredScenarios?.() ?? [])) as Scenario[];
  const authoredIds = new Set(authored.map((s) => `${s.scenarioId}::${s.version}`));

  // Enumerate from scenarioBank (what ships), not only pool mapping — report needs every fixture.
  return scenarioBank.map((bankScenario) => {
    const poolScenario = pool.find((s) => s.scenarioId === bankScenario.scenarioId) ?? bankScenario;
    const queueItem = queue.stationQueue.find((item) => item.scenarioId === bankScenario.scenarioId);
    const activationEligible = queueItem?.status === "activation_ready";
    const inAuthoredStore = authoredIds.has(`${bankScenario.scenarioId}::${bankScenario.version}`);
    return {
      scenarioId: bankScenario.scenarioId,
      status: poolScenario.status,
      validationStage: poolScenario.governance.validationStage,
      review: {
        clinical: poolScenario.review.clinical,
        psychometric: poolScenario.review.psychometric,
        legal: poolScenario.review.legal,
        simulationQa: poolScenario.review.simulationQa,
      },
      inAuthoredStore,
      activationEligible: Boolean(activationEligible),
      ineligibleMechanism: ineligibleMechanism(poolScenario, inAuthoredStore, Boolean(activationEligible)),
    };
  });
}

async function seedCloneThroughRealRoute(app: HonoLikeApp): Promise<void> {
  const draft: Scenario = {
    ...pediatricAsthmaScenario,
    scenarioId: ISSUE176_CLONE_SCENARIO_ID,
    version: pediatricAsthmaScenario.version,
    title: `${ISSUE176_MARKER} — ${pediatricAsthmaScenario.title}`,
    status: "draft",
    review: {
      clinical: "draft",
      psychometric: "draft",
      legal: "draft",
      simulationQa: "draft",
    },
    governance: {
      ...pediatricAsthmaScenario.governance,
      validationStage: "stage_0_synthetic_draft",
      scoreUseLabel: pediatricAsthmaScenario.governance.scoreUseLabel,
    },
  };

  const save = await app.request("/scenarios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: draft }),
  });
  if (save.status !== 201) {
    const detail = await save.text().catch(() => "");
    throw new Error(`seed POST /scenarios failed: ${save.status} ${detail}`);
  }
}

async function applyFourGateApprovals(app: HonoLikeApp): Promise<ReviewDimension[]> {
  const submit = adminGraphqlDocumentByOperationName("SubmitScenarioReview");
  const submitted: ReviewDimension[] = [];
  for (const reviewerRole of ALL_DIMENSIONS) {
    const res = await app.request("/admin/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: submit.source,
        operationName: "SubmitScenarioReview",
        variables: {
          input: {
            scenarioId: ISSUE176_CLONE_SCENARIO_ID,
            version: pediatricAsthmaScenario.version,
            reviewerRole,
            reviewerId: `issue176_${reviewerRole}`,
            decision: "APPROVED",
            comments:
              `${reviewerRole} rationale for #176 faculty-review-gate seam proof `
              + `(local formative only — not clinical validity).`,
            evidenceRefs: [`evidence:issue176:${ISSUE176_CLONE_SCENARIO_ID}:${reviewerRole}`],
          },
        },
      }),
    });
    if (res.status !== 200) {
      const detail = await res.text().catch(() => "");
      throw new Error(`SubmitScenarioReview ${reviewerRole} failed: ${res.status} ${detail}`);
    }
    const body = (await res.json()) as { errors?: unknown[] };
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      throw new Error(
        `SubmitScenarioReview ${reviewerRole} graphql errors: ${JSON.stringify(body.errors)}`,
      );
    }
    submitted.push(reviewerRole);
  }
  return submitted;
}

async function submitOneGate(
  app: HonoLikeApp,
  scenarioId: string,
  version: number,
  reviewerRole: ReviewDimension,
): Promise<void> {
  const submit = adminGraphqlDocumentByOperationName("SubmitScenarioReview");
  const res = await app.request("/admin/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: submit.source,
      operationName: "SubmitScenarioReview",
      variables: {
        input: {
          scenarioId,
          version,
          reviewerRole,
          reviewerId: `issue176_${reviewerRole}`,
          decision: "APPROVED",
          comments: `${reviewerRole} rationale for #176 bank-fixture clone-on-first-review proof.`,
          evidenceRefs: [`evidence:issue176:${scenarioId}:${reviewerRole}`],
        },
      },
    }),
  });
  if (res.status !== 200) {
    const detail = await res.text().catch(() => "");
    throw new Error(`SubmitScenarioReview ${reviewerRole} on ${scenarioId} failed: ${res.status} ${detail}`);
  }
  const body = (await res.json()) as { errors?: unknown[] };
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    throw new Error(`SubmitScenarioReview graphql errors: ${JSON.stringify(body.errors)}`);
  }
}

/**
 * Prove bank-fixture clone-on-first-review: peds draft is NOT pre-seeded; first review decision
 * must clone the fixture into the authored store (the #176 silent no-op path).
 */
async function proveBankFixtureCloneOnFirstReview(): Promise<{ cloned: boolean; mechanism: string }> {
  const sink = createAuthoredMemorySink();
  const app = createApiApp(undefined, sink);
  const before = (await Promise.resolve(sink.listAuthoredScenarios?.() ?? [])) as Scenario[];
  if (before.some((s) => s.scenarioId === pediatricAsthmaScenario.scenarioId)) {
    return { cloned: false, mechanism: "bank_fixture_unexpectedly_already_in_authored_store" };
  }
  await submitOneGate(app, pediatricAsthmaScenario.scenarioId, pediatricAsthmaScenario.version, "clinical");
  const after = (await Promise.resolve(sink.listAuthoredScenarios?.() ?? [])) as Scenario[];
  const cloned = after.some(
    (s) =>
      s.scenarioId === pediatricAsthmaScenario.scenarioId
      && s.version === pediatricAsthmaScenario.version
      && s.review.clinical === "approved",
  );
  return {
    cloned,
    mechanism: cloned
      ? "bank_fixture_clone_on_first_review_via_persistAuthoredScenarioReviewPromotion"
      : "bank_fixture_still_missing_from_authored_store_after_review",
  };
}

/**
 * Prove: four real SubmitScenarioReview routes on a test-scoped bank-derived clone land the
 * document in the authored store and make it visible to buildExamAssemblyScenarioPool as approved.
 * Also proves the bank-fixture (no pre-seed) clone-on-first-review path.
 */
async function runFixturePromotionProbe(sink: ApiPersistenceSink): Promise<FacultyReviewGateReport["fixturePromotionProbe"]> {
  const bankClone = await proveBankFixtureCloneOnFirstReview();

  const app = createApiApp(undefined, sink);
  // Unique-id clone for pool visibility without touching shipped bank ids (counterweight).
  await seedCloneThroughRealRoute(app);
  const dimensionsSubmitted = await applyFourGateApprovals(app);

  const authored = (await Promise.resolve(sink.listAuthoredScenarios?.() ?? [])) as Scenario[];
  const stored = authored.find((s) => s.scenarioId === ISSUE176_CLONE_SCENARIO_ID);
  const reachedAuthoredStore = Boolean(stored && stored.status === "approved") && bankClone.cloned;

  const pool = await buildExamAssemblyScenarioPool(sink);
  const poolEntry = pool.find((s) => s.scenarioId === ISSUE176_CLONE_SCENARIO_ID);
  const visibleToAssemblyPool = Boolean(
    poolEntry
    && poolEntry.status === "approved"
    && poolEntry.title.includes(ISSUE176_MARKER),
  );

  return {
    clonedScenarioId: ISSUE176_CLONE_SCENARIO_ID,
    dimensionsSubmitted,
    reachedAuthoredStore,
    visibleToAssemblyPool,
    mechanism: reachedAuthoredStore && visibleToAssemblyPool
      ? `${bankClone.mechanism}+four_gates_on_test_clone_visible_to_assembly_pool`
      : !bankClone.cloned
        ? bankClone.mechanism
        : !reachedAuthoredStore
          ? "promotion_failed_test_clone_not_approved_in_authored_store"
          : "authored_but_not_visible_to_assembly_pool",
  };
}

/**
 * Inspect faculty review gate: UI recordable dimensions + bank rows + promotion probe.
 * Probe uses a separate sink so shipped-bank rows stay at ambient 1 approved / 13 stage_0.
 */
export async function inspectFacultyReviewGate(): Promise<FacultyReviewGateReport> {
  // Shipped bank measurement — empty authored sink (ambient).
  const ambientSink = createAuthoredMemorySink();
  const rows = await buildShippedBankRows(ambientSink);

  // Promotion probe — isolated sink with test-scoped clone (not a shipped id).
  const probeSink = createAuthoredMemorySink();
  const fixturePromotionProbe = await runFixturePromotionProbe(probeSink);

  const recordableDimensions = [...SCENARIO_REVIEW_RECORDABLE_DIMENSIONS] as ReviewDimension[];
  const rationaleIsCallerSupplied = SCENARIO_REVIEW_RATIONALE_IS_CALLER_SUPPLIED === true;

  return {
    rows,
    recordableDimensions,
    rationaleIsCallerSupplied,
    fixturePromotionProbe,
    claimScope:
      "four_dimension_faculty_review_with_caller_rationale_and_bank_fixture_clone_reaches_assembly_pool",
    notEvidenceFor: [
      "clinical_validity",
      "clinical_content_approval",
      "psychometric_readiness",
      "exam_equivalence",
      "auto_promotion_of_shipped_bank",
      "per_dimension_authorization",
      "validated_summative",
      "quest_readiness",
    ],
  };
}
