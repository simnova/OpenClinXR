/**
 * Scenario promotion path proof (moved from apps/api composition root).
 *
 * Proves the review-promotion path on a REAL bank draft through REAL routes.
 * The app owns the app instance; the package receives it through the harness
 * context and never holds one at module scope.
 */

import type { Scenario } from "@openclinxr/shared-schemas";
import {
  BLUEPRINT_ID,
  IN_PROCESS_ORIGIN,
  REVIEW_GATES,
  createAuthoredMemorySink,
  isRecord,
  readAuthoredGateState,
  readQueueItem,
  readReadiness,
  reviewStatesFromRecord,
  submitReviewDecision,
  type HonoLikeApp,
  type LearnerScenarioResolverLoader,
  type PromotionHarnessContext,
  type ScenarioGateState,
} from "./scenario-promotion-io.js";

/** Chosen draft — bank index 3, in the first-12 queue mapping, seeds present. */
export const PROMOTED_SCENARIO_ID = "telehealth_diabetes_health_literacy_v1";
/** Untouched control draft — counterweight that the gate still refuses unreviewed cases. */
export const CONTROL_SCENARIO_ID = "ob_headache_preeclampsia_triage_v1";

export { REVIEW_GATES, BLUEPRINT_ID, IN_PROCESS_ORIGIN };

export type PromotionHop = {
  reviewerRole: string;
  /** Status returned by the GraphQL mutation response (GraphQL enum string). */
  responseStatus: string;
  /** Review gates returned by the GraphQL mutation response (in-memory override path). */
  responseReviewStates: Record<string, string>;
  /** Persisted decision-record count in the sink after this hop. */
  decisionRecordCount: number;
  /** Persisted status read back from GET /scenarios/:id (null = no authored document). */
  persistedStatus: string | null;
  /** Persisted review gates read back from GET /scenarios/:id. */
  persistedReview: Record<string, string>;
  /** Persisted validationStage read back from GET /scenarios/:id. */
  persistedValidationStage: string | null;
  /** Queue slot status after this hop ("activation_ready" | "draft_blocked" | "governance_blocked"). */
  queueStatus: string;
  queueBlockers: string[];
};

export type PromotionPathRun = {
  scenarioId: string;
  version: number;
  /** GET /scenarios/:id before any decision — null proves the scenario was NOT already authored. */
  beforeAuthored: ScenarioGateState | null;
  beforeQueueStatus: string;
  beforeQueueBlockers: string[];
  hops: PromotionHop[];
  after: ScenarioGateState;
  /** Real gate: readiness route's activationEligibleScenarioIds membership. */
  afterEligible: boolean;
  canStartLearnerExam: boolean;
  learner:
    | {
        scenarioSource: string;
        bodySource: string | null;
        status: string | null;
        validationStage: string | null;
        reviewStates: Record<string, string>;
      }
    | null;
  requestedPaths: string[];
  devServerBoots: 0;
  browserLaunches: 0;
};

export type StageZeroStuckRun = {
  scenarioId: string;
  queueStatus: string;
  blockers: string[];
  inActivationEligibleSet: boolean;
};

export type PromotionPathContext = PromotionHarnessContext & {
  loadLearnerScenarioResolver: LearnerScenarioResolverLoader;
  wrapFetch: (
    dispatch: (
      call: { url: string; method: string; headers?: unknown; body?: unknown },
    ) => Promise<Response> | Response,
  ) => typeof fetch;
};

/**
 * The main proof: drive one REAL bank draft through four real SubmitScenarioReview decisions and
 * record every hop. The promotion path itself clones the bank fixture into the authored store on
 * the first decision (clone-on-first-review) — nothing is pre-seeded.
 */
export async function inspectScenarioPromotionPath(ctx: PromotionPathContext): Promise<PromotionPathRun> {
  const { findBankFixture: findFixture } = await import("./scenario-promotion-io.js");
  const fixture = findFixture(PROMOTED_SCENARIO_ID);
  const sink = createAuthoredMemorySink();
  const app = ctx.createApp(sink);
  const requestedPaths: string[] = [];

  const beforeAuthored = await readAuthoredGateState(app, PROMOTED_SCENARIO_ID, requestedPaths);
  const beforeQueue = await readQueueItem(app, PROMOTED_SCENARIO_ID, requestedPaths);

  const hops: PromotionHop[] = [];
  for (const reviewerRole of REVIEW_GATES) {
    const submitted = await submitReviewDecision(
      app,
      {
        scenarioId: PROMOTED_SCENARIO_ID,
        version: fixture.version,
        reviewerRole,
        reviewerId: `issue166_${reviewerRole}`,
      },
      requestedPaths,
    );
    const persisted = await readAuthoredGateState(app, PROMOTED_SCENARIO_ID, requestedPaths);
    const queue = await readQueueItem(app, PROMOTED_SCENARIO_ID, requestedPaths);
    hops.push({
      reviewerRole,
      responseStatus: submitted.responseStatus,
      responseReviewStates: submitted.responseReviewStates,
      decisionRecordCount: sink.decisions.length,
      persistedStatus: persisted?.status ?? null,
      persistedReview: persisted?.reviewStates ?? {},
      persistedValidationStage: persisted?.validationStage ?? null,
      queueStatus: queue.status,
      queueBlockers: queue.blockers,
    });
  }

  const afterAuthored = await readAuthoredGateState(app, PROMOTED_SCENARIO_ID, requestedPaths);
  if (!afterAuthored) {
    throw new Error("promoted scenario has no authored document after four decisions");
  }
  const afterQueue = await readQueueItem(app, PROMOTED_SCENARIO_ID, requestedPaths);
  const readiness = await readReadiness(app, requestedPaths);
  const afterEligible = readiness.activationEligibleScenarioIds.includes(PROMOTED_SCENARIO_ID);

  const resolver = await ctx.loadLearnerScenarioResolver();
  const dispatcher = await import("./scenario-promotion-io.js").then((m) =>
    m.createInProcessDispatcher(app, requestedPaths),
  );
  const fetchAdapter = ctx.wrapFetch(
    (call) => dispatcher({ url: call.url, method: call.method, headers: call.headers, body: call.body }),
  );
  const resolution = await resolver({
    baseUrl: IN_PROCESS_ORIGIN,
    blueprintId: BLUEPRINT_ID,
    fetch: fetchAdapter,
  });

  const promotedBody = resolution.scenarios.find((s) => s.scenarioId === PROMOTED_SCENARIO_ID);
  const learner = promotedBody
    ? {
        scenarioSource: resolution.scenarioSource,
        bodySource: typeof promotedBody.bodySource === "string" ? promotedBody.bodySource : null,
        status: typeof promotedBody["status"] === "string" ? (promotedBody["status"] as string) : null,
        validationStage:
          isRecord(promotedBody["governance"])
          && typeof promotedBody["governance"]["validationStage"] === "string"
            ? (promotedBody["governance"]["validationStage"] as string)
            : null,
        reviewStates: reviewStatesFromRecord(promotedBody["review"]),
      }
    : null;

  return {
    scenarioId: PROMOTED_SCENARIO_ID,
    version: fixture.version,
    beforeAuthored,
    beforeQueueStatus: beforeQueue.status,
    beforeQueueBlockers: beforeQueue.blockers,
    hops,
    after: {
      ...afterAuthored,
      queueStatus: afterQueue.status,
      blockers: afterQueue.blockers,
    },
    afterEligible,
    canStartLearnerExam: afterQueue.canStartLearnerExam,
    learner,
    requestedPaths: [...requestedPaths],
    devServerBoots: 0,
    browserLaunches: 0,
  };
}

/**
 * COUNTERWEIGHT — the stage condition is load-bearing. Plant an authored document with all four
 * gates approved and status approved but `validationStage` STILL `stage_0_synthetic_draft` (the
 * real path cannot produce this state — it always advances the stage; the plant isolates the
 * gate). The real queue route must REFUSE it.
 */
export async function inspectStageZeroStaysBlocking(ctx: PromotionHarnessContext): Promise<StageZeroStuckRun> {
  const { findBankFixture: findFixture } = await import("./scenario-promotion-io.js");
  const fixture = findFixture(PROMOTED_SCENARIO_ID);
  const planted: Scenario = {
    ...fixture,
    status: "approved",
    review: {
      clinical: "approved",
      psychometric: "approved",
      legal: "approved",
      simulationQa: "approved",
    },
    governance: {
      ...fixture.governance,
      validationStage: "stage_0_synthetic_draft",
    },
  };

  const sink = createAuthoredMemorySink();
  sink.store.set(`${planted.scenarioId}::${planted.version}`, planted);
  const app: HonoLikeApp = ctx.createApp(sink);
  const requestedPaths: string[] = [];

  const queue = await readQueueItem(app, PROMOTED_SCENARIO_ID, requestedPaths);
  const readiness = await readReadiness(app, requestedPaths);

  return {
    scenarioId: PROMOTED_SCENARIO_ID,
    queueStatus: queue.status,
    blockers: queue.blockers,
    inActivationEligibleSet: readiness.activationEligibleScenarioIds.includes(PROMOTED_SCENARIO_ID),
  };
}
