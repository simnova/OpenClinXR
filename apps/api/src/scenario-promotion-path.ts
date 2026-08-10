/**
 * #166 — prove the review-promotion path on a REAL bank draft through REAL routes.
 *
 * The API-assembled 12-station seed exam cannot start: `canStartLearnerExam` requires every one of
 * `STEP2CS_STATION_COUNT = 12` queue slots to be `activation_ready`, and 13 of 14 shipped
 * scenarios sit in one uniform `draft` / `stage_0_synthetic_draft` / four-unapproved-reviews
 * state behind `isActivationEligible` (`assembly.ts:367-373`). That is 52 unmade review decisions
 * plus a stage promotion — a HUMAN gate by design. This slice approves nothing and touches no gate.
 * It proves that IF a reviewer approves, the promotion takes, so nobody spends expert time on a
 * path that silently drops the decision.
 *
 * Isolated seam (extends #165/#167 in-process pattern, does not duplicate — plumbing lives in
 * `scenario-promotion-io.ts`): real `createApiApp()` + `app.request` fetch adapter + the REAL
 * `resolveLearnerExamScenarios`. Zero Vite, zero browser, zero ports. Each review hop is read back
 * through `GET /scenarios/:id` (the persistence sink), NOT the in-memory GraphQL override map — so
 * "wrong field / no persist" cannot hide behind the GraphQL listing overlay
 * (`admin-scenario-listing.ts` applies decision records on top of the store; the exam pool reads
 * the raw authored store only).
 *
 * claimScope: whether four `SubmitScenarioReview` decisions on a REAL bank draft, driven through
 * the real route handlers, persist per hop, flip the stage off `stage_0_synthetic_draft`, flip
 * `isActivationEligible` false → true, surface `activation_ready` on the real station-run-queue,
 * and deliver the promoted body to the learner resolver as `api_authored`.
 * notEvidenceFor: clinical validity of any approval, psychometric readiness, exam equivalence,
 * XR runtime, cast/garments/rooms, auto-promotion of the shipped bank, the 52 unmade human review
 * decisions (still unmade), a startable full 12-station exam (still blocked — one scenario is
 * promoted in a scoped memory sink only), quest readiness.
 *
 * Decisions (named; reject list in commit):
 * 1. Promote `telehealth_diabetes_health_literacy_v1` — bank index 3, present in the first-12
 *    pool mapping used by `createExamStationRunQueue` (stationOrder 4); full dialogue seeds;
 *    uniform stage_0 like the other 12 drafts; distinct from #167's promoted (`peds_asthma`) and
 *    #167's control (`ward_delirium`). Rejected: promoting `ed_chest_pain` (already approved —
 *    vacuous); inventing a synthetic scenario (misses bank-fixture seams).
 * 2. Do NOT pre-seed the authored clone via POST /scenarios. The production path
 *    (`persistAuthoredScenarioReviewPromotion` → `findBankFixtureScenario`, the #176 clone-on-
 *    first-review fix) clones the bank fixture into the authored store on the FIRST review
 *    decision. Pre-seeding would test an already-authored document instead of the exact path a
 *    reviewer drives on a bank scenario. Rejected: store-direct writes for the main promotion.
 * 3. Stage promotion is IMPLIED by four gate approvals (`persistAuthoredScenarioReviewPromotion`
 *    → stage_0 → stage_1 with `validationStageBasis`). No separate stage route exists; none
 *    invented.
 * 4. Counterweight "stage_0 still blocks": a planted approved-gates / stage_0 authored document
 *    (direct store write — the real path cannot produce this state) must read `governance_blocked`
 *    from the real queue route. This proves the stage flip is load-bearing, not decorative.
 */

import type { Scenario } from "@openclinxr/shared-schemas";
import {
  BLUEPRINT_ID,
  IN_PROCESS_ORIGIN,
  REVIEW_GATES,
  createAuthoredMemorySink,
  createInProcessFetch,
  findBankFixture,
  isRecord,
  loadLearnerScenarioResolver,
  readAuthoredGateState,
  readQueueItem,
  readReadiness,
  reviewStatesFromRecord,
  submitReviewDecision,
  type HonoLikeApp,
  type ScenarioGateState,
} from "./scenario-promotion-io.js";
import { createApiApp } from "./index.js";

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

/**
 * The main proof: drive one REAL bank draft through four real SubmitScenarioReview decisions and
 * record every hop. The promotion path itself clones the bank fixture into the authored store on
 * the first decision (clone-on-first-review) — nothing is pre-seeded.
 */
export async function inspectScenarioPromotionPath(): Promise<PromotionPathRun> {
  const fixture = findBankFixture(PROMOTED_SCENARIO_ID);
  const sink = createAuthoredMemorySink();
  const app = createApiApp(undefined, sink);
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

  const resolver = await loadLearnerScenarioResolver();
  const fetchAdapter = createInProcessFetch(app, requestedPaths);
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
export async function inspectStageZeroStaysBlocking(): Promise<StageZeroStuckRun> {
  const fixture = findBankFixture(PROMOTED_SCENARIO_ID);
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
  const app: HonoLikeApp = createApiApp(undefined, sink);
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
