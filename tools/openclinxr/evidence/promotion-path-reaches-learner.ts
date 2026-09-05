/**
 * #167 — prove a real bank draft reaches the learner after promotion via real review routes.
 *
 * Isolated seam (extends #165 harness, does not duplicate): real `createApiApp()` + `app.request`
 * fetch adapter + real `resolveLearnerExamScenarios`. Zero Vite, zero browser, zero ports.
 *
 * claimScope: whether four gate approvals through SubmitScenarioReview on a CLONED bank draft
 * (scoped memory sink) advance status + stage_0→stage_1, surface activation_ready on the
 * station-run-queue, and deliver bodySource api_authored to the learner resolver.
 * notEvidenceFor: clinical validity of any approval, psychometric readiness, exam equivalence,
 * XR runtime, garments, rooms, auto-promotion of the shipped bank, canStartLearnerExam over 12 stations.
 *
 * Decisions (named; reject list in commit):
 * 1. Promote CLONE of peds_asthma_parent_anxiety_v1 in a memory sink — not the shipped bank file.
 *    Why that draft: bank index 2 → present in first-12 pool mapping used by createExamStationRunQueue;
 *    full dialogue seeds; uniform stage_0 like the other 12 drafts. Rejected: inventing a synthetic
 *    scenario (misses bank-fixture seams); promoting ed_chest_pain (already approved — vacuous).
 * 2. Scoped memory sink clone via POST /scenarios — not mutate fixture module. Shipped bank counts
 *    still read 1 approved / 13 stage_0 from scenarioBank.
 * 3. Stage promotion is IMPLIED by four gate approvals (persistAuthoredScenarioReviewPromotion →
 *    stage_0→stage_1 with validationStageBasis). No separate stage route exists; none invented.
 * 4. Distinguishing field = title carrying ISSUE167_PROMOTION_SEAM_MARKER (#165 pattern).
 */

import type { ApiPersistenceSink, ApiScenarioReviewDecisionRecord } from "../../../apps/api/src/api-types.js";
import { createApiApp } from "../../../apps/api/src/index.js";
import { resolveLearnerExamScenarios } from "../../../apps/ui-xr/src/learner-exam-scenario-source.js";
import { adminGraphqlDocumentByOperationName } from "../../../packages/openclinxr/graphql/src/index.js";
import {
  pediatricAsthmaScenario,
  scenarioBank,
} from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import type { Scenario } from "../../../packages/openclinxr/shared-schemas/src/index.js";

/** Present only on the promoted authored body — fixture bank titles cannot carry this marker. */
export const ISSUE167_DISTINGUISHING_MARKER = "ISSUE167_PROMOTION_SEAM_MARKER";

const BLUEPRINT_ID = "step2cs-seed";
const IN_PROCESS_ORIGIN = "http://in-process.openclinxr.local";

/** Chosen draft: bank order guarantees queue presence; seeds already satisfy hasReplayReadyDialogueSeeds. */
export const PROMOTED_SCENARIO_ID = pediatricAsthmaScenario.scenarioId;

/** Untouched control draft — counterweight that the gate still refuses unreviewed cases. */
export const CONTROL_SCENARIO_ID = "ward_delirium_med_rec_v1";

const REVIEW_GATES = ["clinical", "psychometric", "legal", "simulationQa"] as const;

export type ScenarioGateState = {
  scenarioId: string;
  status: string;
  validationStage: string;
  reviewStates: Record<string, string>;
  queueStatus: string;
  blockers: string[];
};

export type PromotionRun = {
  before: ScenarioGateState;
  after: ScenarioGateState;
  requestedPaths: string[];
  learnerBodySource: string | null;
  learnerDistinguishingValue: string | null;
  devServerBoots: number;
  browserLaunches: number;
  control: { scenarioId: string; queueStatus: string };
  shippedBankApprovedCount: number;
  shippedBankStageZeroCount: number;
  /** How stage moved — part of the finding. */
  stagePromotionMechanism: string;
  claimScope: string;
  notEvidenceFor: string[];
};

type HonoLikeApp = {
  request: (input: string, init?: RequestInit) => Promise<Response> | Response;
};

type QueueBody = {
  stationQueue?: Array<{
    scenarioId?: string | null;
    status?: string;
    blockers?: string[];
  }>;
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

/**
 * fetch-shaped adapter over Hono `app.request` — records paths for transport proof.
 * No network, no port bind, no browser. Same shape as #165.
 */
function createInProcessFetch(
  app: HonoLikeApp,
  requestedPaths: string[],
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const parsed = new URL(url, IN_PROCESS_ORIGIN);
    const pathWithQuery = `${parsed.pathname}${parsed.search}`;
    requestedPaths.push(pathWithQuery);

    const method =
      init?.method
      ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET");
    const headers =
      init?.headers
      ?? (typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined);
    const body =
      init?.body
      ?? (typeof input !== "string" && !(input instanceof URL) && method !== "GET" && method !== "HEAD"
        ? input.body
        : undefined);

    const response = await app.request(pathWithQuery, {
      method,
      headers,
      body: body as RequestInit["body"],
    });
    return response;
  }) as typeof fetch;
}

function distinguishingTitle(): string {
  return `${ISSUE167_DISTINGUISHING_MARKER} — ${pediatricAsthmaScenario.title}`;
}

function extractDistinguishingValue(record: Record<string, unknown>): string | null {
  const title = record["title"];
  if (typeof title === "string" && title.includes(ISSUE167_DISTINGUISHING_MARKER)) {
    return title;
  }
  return null;
}

function gateStateFromBank(scenarioId: string): ScenarioGateState {
  const bank = scenarioBank.find((s) => s.scenarioId === scenarioId);
  if (!bank) {
    throw new Error(`bank fixture missing: ${scenarioId}`);
  }
  return {
    scenarioId,
    status: bank.status,
    validationStage: bank.governance.validationStage,
    reviewStates: {
      clinical: bank.review.clinical,
      psychometric: bank.review.psychometric,
      legal: bank.review.legal,
      simulationQa: bank.review.simulationQa,
    },
    // Filled from queue after app is up.
    queueStatus: "unknown",
    blockers: [],
  };
}

async function requestApp(
  app: HonoLikeApp,
  path: string,
  init: RequestInit | undefined,
  requestedPaths: string[],
): Promise<Response> {
  requestedPaths.push(path);
  return app.request(path, init);
}

async function readQueueItem(
  app: HonoLikeApp,
  scenarioId: string,
  requestedPaths: string[],
): Promise<{ status: string; blockers: string[] }> {
  const res = await requestApp(
    app,
    `/exam-blueprints/${BLUEPRINT_ID}/station-run-queue`,
    undefined,
    requestedPaths,
  );
  if (res.status !== 200) {
    throw new Error(`station-run-queue failed: ${res.status}`);
  }
  const body = (await res.json()) as QueueBody;
  const item = body.stationQueue?.find((s) => s.scenarioId === scenarioId);
  if (!item) {
    return { status: "not_in_queue", blockers: ["scenario_not_in_station_run_queue"] };
  }
  return {
    status: item.status ?? "unknown",
    blockers: Array.isArray(item.blockers) ? item.blockers.map(String) : [],
  };
}

async function readAuthoredGateState(
  app: HonoLikeApp,
  scenarioId: string,
  fallback: ScenarioGateState,
  requestedPaths: string[],
): Promise<ScenarioGateState> {
  const getRes = await requestApp(
    app,
    `/scenarios/${encodeURIComponent(scenarioId)}`,
    undefined,
    requestedPaths,
  );
  const queue = await readQueueItem(app, scenarioId, requestedPaths);

  if (getRes.status !== 200) {
    return {
      ...fallback,
      queueStatus: queue.status,
      blockers: queue.blockers,
    };
  }

  const envelope = (await getRes.json()) as { scenario?: Scenario };
  const scenario = envelope.scenario;
  if (!scenario) {
    return {
      ...fallback,
      queueStatus: queue.status,
      blockers: queue.blockers,
    };
  }

  return {
    scenarioId,
    status: scenario.status,
    validationStage: scenario.governance.validationStage,
    reviewStates: {
      clinical: scenario.review.clinical,
      psychometric: scenario.review.psychometric,
      legal: scenario.review.legal,
      simulationQa: scenario.review.simulationQa,
    },
    queueStatus: queue.status,
    blockers: queue.blockers,
  };
}

/**
 * Clone the bank draft into the authored store via the real POST route.
 * Client cannot self-approve (coerce demotes). Review path alone promotes.
 */
async function seedUnpromotedCloneThroughRealRoute(
  app: HonoLikeApp,
  requestedPaths: string[],
): Promise<void> {
  const draft: Scenario = {
    ...pediatricAsthmaScenario,
    scenarioId: PROMOTED_SCENARIO_ID,
    version: pediatricAsthmaScenario.version,
    title: distinguishingTitle(),
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
      // Keep formative_local_only — not a blocker; do not invent validated_summative.
      scoreUseLabel: pediatricAsthmaScenario.governance.scoreUseLabel,
    },
  };

  const save = await requestApp(
    app,
    "/scenarios",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: draft }),
    },
    requestedPaths,
  );
  if (save.status !== 201) {
    const detail = await save.text().catch(() => "");
    throw new Error(`seed POST /scenarios failed: ${save.status} ${detail}`);
  }
}

/**
 * Drive all four review gates through the real admin GraphQL submit path.
 * Stage_0 → stage_1 is a side effect of persistAuthoredScenarioReviewPromotion when status becomes
 * approved and four approved decision records exist — not a separate route.
 */
async function applyFourGateApprovalsThroughRealRoutes(
  app: HonoLikeApp,
  requestedPaths: string[],
): Promise<void> {
  const submit = adminGraphqlDocumentByOperationName("SubmitScenarioReview");
  for (const reviewerRole of REVIEW_GATES) {
    const res = await requestApp(
      app,
      "/admin/graphql",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: submit.source,
          operationName: "SubmitScenarioReview",
          variables: {
            input: {
              scenarioId: PROMOTED_SCENARIO_ID,
              version: pediatricAsthmaScenario.version,
              reviewerRole,
              reviewerId: `issue167_${reviewerRole}`,
              decision: "APPROVED",
              comments:
                `${reviewerRole} gate approved for #167 promotion-path-reaches-learner seam proof `
                + `(local formative only — not clinical validity).`,
              evidenceRefs: [`evidence:issue167:${PROMOTED_SCENARIO_ID}:${reviewerRole}`],
            },
          },
        }),
      },
      requestedPaths,
    );
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
  }
}

/**
 * Prove promotion path: real bank draft clone → four real review routes → activation_ready +
 * learner api_authored body with a fixture-impossible marker. Counterweight: shipped bank + control.
 */
export async function inspectPromotionPathReachesLearner(): Promise<PromotionRun> {
  const beforeFromBank = gateStateFromBank(PROMOTED_SCENARIO_ID);

  const sink = createAuthoredMemorySink();
  const app = createApiApp(undefined, sink);
  const requestedPaths: string[] = [];
  const fetchAdapter = createInProcessFetch(app, requestedPaths);

  // BEFORE any review decision — clone is still unpromoted (or not yet seeded).
  // Seed the authored clone first so GET /scenarios can observe draft state through real routes.
  await seedUnpromotedCloneThroughRealRoute(app, requestedPaths);
  const before = await readAuthoredGateState(app, PROMOTED_SCENARIO_ID, beforeFromBank, requestedPaths);

  // Real promotion path — four SubmitScenarioReview routes (stage advance implied).
  await applyFourGateApprovalsThroughRealRoutes(app, requestedPaths);

  const after = await readAuthoredGateState(app, PROMOTED_SCENARIO_ID, beforeFromBank, requestedPaths);

  const controlQueue = await readQueueItem(app, CONTROL_SCENARIO_ID, requestedPaths);

  const resolution = await resolveLearnerExamScenarios({
    baseUrl: IN_PROCESS_ORIGIN,
    blueprintId: BLUEPRINT_ID,
    fetch: fetchAdapter,
  });

  const promotedBody = resolution.scenarios.find((s) => s.scenarioId === PROMOTED_SCENARIO_ID);
  const learnerBodySource =
    promotedBody && typeof promotedBody.bodySource === "string" ? promotedBody.bodySource : null;
  const learnerDistinguishingValue =
    promotedBody && learnerBodySource === "api_authored"
      ? extractDistinguishingValue(promotedBody)
      : null;

  // Shipped bank = fixture module, never the in-memory sink.
  const shippedBankApprovedCount = scenarioBank.filter((s) => s.status === "approved").length;
  const shippedBankStageZeroCount = scenarioBank.filter(
    (s) => s.governance.validationStage === "stage_0_synthetic_draft",
  ).length;

  return {
    before,
    after,
    requestedPaths: [...requestedPaths],
    learnerBodySource,
    learnerDistinguishingValue,
    devServerBoots: 0,
    browserLaunches: 0,
    control: {
      scenarioId: CONTROL_SCENARIO_ID,
      queueStatus: controlQueue.status,
    },
    shippedBankApprovedCount,
    shippedBankStageZeroCount,
    stagePromotionMechanism:
      "implied_by_four_gate_approvals_via_persistAuthoredScenarioReviewPromotion_stage_0_to_stage_1",
    claimScope:
      "real_bank_draft_clone_promoted_via_submit_scenario_review_routes_reaches_learner_as_api_authored",
    notEvidenceFor: [
      "clinical_validity_of_approvals",
      "psychometric_readiness",
      "exam_equivalence",
      "xr_scene",
      "cast",
      "garments",
      "rooms",
      "auto_promotion_of_shipped_bank",
      "can_start_full_12_station_learner_exam",
      "quest_readiness",
    ],
  };
}
