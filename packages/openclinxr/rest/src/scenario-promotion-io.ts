/**
 * Scenario promotion harness IO (moved from apps/api composition root).
 *
 * In-process harness plumbing (sink, fetch adapter, route readers, resolver loader).
 * The app owns the app instance and the repo root; this package never exports a
 * mutable value and never holds one at module scope. Callers pass what they own
 * as the first parameter.
 */

import { adminGraphqlDocumentByOperationName } from "@openclinxr/graphql";
import { scenarioBank } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";
import type { ApiPersistenceSink, ApiScenarioReviewDecisionRecord } from "./api-types.js";
import { isRecord, reviewStatesFromRecord } from "./promotion-io-validation.js";
import { toAdminGraphqlScenario } from "./admin-scenario-listing.js";
import {
  AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX,
  authoredScenarioContentIdentity,
} from "./scenario-review-promotion.js";

export const BLUEPRINT_ID = "step2cs-seed";
export const IN_PROCESS_ORIGIN = "http://in-process.openclinxr.local";
export const REVIEW_GATES = ["clinical", "psychometric", "legal", "simulationQa"] as const;

/** What the harness needs from the app: how to build an app and where the repo root is. */
export type PromotionHarnessContext = {
  createApp: (persistence?: ApiPersistenceSink) => HonoLikeApp;
  repoRoot: () => string;
};

export type ScenarioGateState = {
  scenarioId: string;
  status: string;
  validationStage: string;
  reviewStates: Record<string, string>;
  queueStatus: string;
  blockers: string[];
};

/** Authored memory sink with the store/decisions exposed so a planted counterweight can seed. */
export type AuthoredMemorySink = ApiPersistenceSink & {
  readonly store: Map<string, Scenario>;
  readonly decisions: ApiScenarioReviewDecisionRecord[];
};

export function createAuthoredMemorySink(): AuthoredMemorySink {
  const store = new Map<string, Scenario>();
  const decisions: ApiScenarioReviewDecisionRecord[] = [];
  return {
    store,
    decisions,
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

export type HonoRequestFn = (input: string, init?: { method?: string; headers?: unknown; body?: unknown }) => Promise<Response> | Response;

export type HonoLikeApp = {
  request: HonoRequestFn;
};

export function requestApp(
  app: HonoLikeApp,
  path: string,
  init: { method?: string; headers?: unknown; body?: unknown } | undefined,
  requestedPaths: string[],
): Promise<Response> {
  requestedPaths.push(path);
  return Promise.resolve(app.request(path, init));
}

export type ApiFetchCall = {
  url: string;
  method: string;
  headers?: unknown;
  body?: unknown;
};

export type ApiFetchDispatcher = (call: ApiFetchCall) => Promise<Response> | Response;

/**
 * fetch-shaped adapter over Hono `app.request` — records paths for transport proof.
 * The caller supplies the fetch transport (apps/api owns `createApiFetchTransport`);
 * this module supplies the in-process dispatch.
 */
export function createInProcessDispatcher(
  app: HonoLikeApp,
  requestedPaths: string[],
): (call: ApiFetchCall) => Promise<Response> {
  return async (call) => {
    const parsed = new URL(call.url, IN_PROCESS_ORIGIN);
    const pathWithQuery = `${parsed.pathname}${parsed.search}`;
    requestedPaths.push(pathWithQuery);

    const initPayload: { method: string; headers?: unknown; body?: unknown } = {
      method: call.method,
    };
    if (call.headers !== undefined) {
      initPayload.headers = call.headers;
    }
    if (call.body !== undefined) {
      initPayload.body = call.body;
    }
    return Promise.resolve(app.request(pathWithQuery, initPayload));
  };
}

export type QueueItemRead = {
  status: string;
  blockers: string[];
  canStartLearnerExam: boolean;
};

type QueueItem = { scenarioId?: string | null; status?: string; blockers?: unknown };
type QueueBody = { stationQueue?: QueueItem[]; canStartLearnerExam?: boolean };
type ReadinessBody = { activationEligibleScenarioIds?: unknown; canAssembleReadyForm?: unknown };

export async function readQueueItem(
  app: HonoLikeApp,
  scenarioId: string,
  requestedPaths: string[],
): Promise<QueueItemRead> {
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
    return {
      status: "not_in_queue",
      blockers: ["scenario_not_in_station_run_queue"],
      canStartLearnerExam: body.canStartLearnerExam === true,
    };
  }
  return {
    status: item.status ?? "unknown",
    blockers: Array.isArray(item.blockers) ? item.blockers.map(String) : [],
    canStartLearnerExam: body.canStartLearnerExam === true,
  };
}

export async function readReadiness(
  app: HonoLikeApp,
  requestedPaths: string[],
): Promise<{ activationEligibleScenarioIds: string[]; canAssembleReadyForm: boolean }> {
  const res = await requestApp(
    app,
    `/exam-blueprints/${BLUEPRINT_ID}/readiness`,
    undefined,
    requestedPaths,
  );
  if (res.status !== 200) {
    throw new Error(`blueprint readiness failed: ${res.status}`);
  }
  const body = (await res.json()) as ReadinessBody;
  return {
    activationEligibleScenarioIds: Array.isArray(body.activationEligibleScenarioIds)
      ? body.activationEligibleScenarioIds.map(String)
      : [],
    canAssembleReadyForm: body.canAssembleReadyForm === true,
  };
}

/**
 * Read the scenario's gate state from the REAL authored route (the persistence sink), or null on
 * 404. Never the GraphQL override map: the override reflects applied decisions even when the
 * authored document was never saved, which is exactly the "no persist" seam this read exists to
 * catch.
 */
export async function readAuthoredGateState(
  app: HonoLikeApp,
  scenarioId: string,
  requestedPaths: string[],
): Promise<ScenarioGateState | null> {
  const getRes = await requestApp(app, `/scenarios/${encodeURIComponent(scenarioId)}`, undefined, requestedPaths);
  if (getRes.status !== 200) {
    return null;
  }
  const envelope = (await getRes.json()) as { scenario?: Scenario };
  const scenario = envelope.scenario;
  if (!scenario) {
    return null;
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
    queueStatus: "unknown",
    blockers: [],
  };
}

export { isRecord, reviewStatesFromRecord };

/**
 * Drive ONE SubmitScenarioReview decision through the real admin GraphQL route.
 * Decision is always APPROVED (a test review decision on a scoped memory clone — not a clinical
 * judgement; nothing here approves a shipped scenario).
 */
export async function submitReviewDecision(
  app: HonoLikeApp,
  input: { scenarioId: string; version: number; reviewerRole: string; reviewerId: string },
  requestedPaths: string[],
): Promise<{ responseStatus: string; responseReviewStates: Record<string, string> }> {
  const submit = adminGraphqlDocumentByOperationName("SubmitScenarioReview");
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
            scenarioId: input.scenarioId,
            version: input.version,
            reviewerRole: input.reviewerRole,
            reviewerId: input.reviewerId,
            decision: "APPROVED",
            comments:
              `${input.reviewerRole} gate approved for #166 promotion-path seam proof `
              + `(local formative only — not clinical validity).`,
            evidenceRefs: [
              `evidence:issue166:${input.scenarioId}:${input.reviewerRole}`,
              `${AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX}${authoredScenarioContentIdentity(
                toAdminGraphqlScenario(findBankFixture(input.scenarioId)),
              )}`,
            ],
          },
        },
      }),
    },
    requestedPaths,
  );
  if (res.status !== 200) {
    const detail = await res.text().catch(() => "");
    throw new Error(`SubmitScenarioReview ${input.reviewerRole} failed: ${res.status} ${detail}`);
  }
  const body = (await res.json()) as {
    errors?: unknown[];
    data?: { submitScenarioReview?: Record<string, unknown> };
  };
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    throw new Error(
      `SubmitScenarioReview ${input.reviewerRole} graphql errors: ${JSON.stringify(body.errors)}`,
    );
  }
  const nextScenario = body.data?.submitScenarioReview;
  if (!nextScenario) {
    throw new Error(`SubmitScenarioReview ${input.reviewerRole} returned no scenario`);
  }
  return {
    responseStatus: typeof nextScenario["status"] === "string" ? nextScenario["status"] : "",
    responseReviewStates: reviewStatesFromRecord(nextScenario["review"]),
  };
}

export type LearnerScenarioResolver = (input: {
  baseUrl?: string;
  blueprintId: string;
  fetch?: typeof fetch;
}) => Promise<{
  scenarios: Array<Record<string, unknown> & { scenarioId: string; bodySource?: string }>;
  scenarioSource: string;
  fallbackActive: boolean;
  fallbackReason?: string;
}>;

/** Resolve the learner scenario resolver. Injected by the caller; the package never imports a consumer. */
export type LearnerScenarioResolverLoader = () => Promise<LearnerScenarioResolver>;

export function findBankFixture(scenarioId: string): Scenario {
  const fixture = scenarioBank.find((s) => s.scenarioId === scenarioId);
  if (!fixture) {
    throw new Error(`bank fixture missing: ${scenarioId}`);
  }
  return fixture;
}
