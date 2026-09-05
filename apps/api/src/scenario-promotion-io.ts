/**
 * #166 — in-process harness plumbing (sink, fetch adapter, route readers, resolver loader).
 *
 * Shared by `scenario-promotion-path.ts` (the promotion drive) and
 * `scenario-promotion-baseline.ts` (the pre-fix measurement). Same in-process shape as the
 * #165/#167 evidence harnesses: real `createApiApp()` + `app.request` fetch adapter + the REAL
 * `resolveLearnerExamScenarios`. Zero Vite, zero browser, zero ports.
 *
 * The learner resolver is loaded at runtime via an absolute file URL constructed from this
 * module's location. apps/ui-xr source cannot be a static import inside this app: the composite
 * tsconfig rejects out-of-program files (TS6307) and the app's stricter index-signature settings
 * reject ui-xr's source (TS4111). A RELATIVE dynamic specifier is resolved by vite-node against
 * the filesystem root under `vitest --root .`, so it must be made absolute here.
 */

import { adminGraphqlDocumentByOperationName } from "@openclinxr/graphql";
import { scenarioBank } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";
import { fileURLToPath } from "node:url";
import { createApiFetchTransport } from "./api-fetch-transport.js";
import type { ApiPersistenceSink, ApiScenarioReviewDecisionRecord } from "./api-types.js";
import { createApiApp } from "./index.js";
import { toAdminGraphqlScenario } from "./admin-scenario-listing.js";
import {
  AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX,
  authoredScenarioContentIdentity,
} from "./scenario-review-promotion.js";

export const BLUEPRINT_ID = "step2cs-seed";
export const IN_PROCESS_ORIGIN = "http://in-process.openclinxr.local";
export const REVIEW_GATES = ["clinical", "psychometric", "legal", "simulationQa"] as const;

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

export type HonoLikeApp = {
  request: (input: string, init?: RequestInit) => Promise<Response> | Response;
};

export function requestApp(
  app: HonoLikeApp,
  path: string,
  init: RequestInit | undefined,
  requestedPaths: string[],
): Promise<Response> {
  requestedPaths.push(path);
  return Promise.resolve(app.request(path, init));
}

/**
 * fetch-shaped adapter over Hono `app.request` — records paths for transport proof.
 * No network, no port bind, no browser. Same shape as #165/#167.
 *
 * Input/body typing lives in `api-fetch-transport.ts` so this file does not depend on
 * ambient DOM `RequestInfo` / `BodyInit`.
 */
export function createInProcessFetch(app: HonoLikeApp, requestedPaths: string[]): typeof fetch {
  return createApiFetchTransport(async (call) => {
    const parsed = new URL(call.url, IN_PROCESS_ORIGIN);
    const pathWithQuery = `${parsed.pathname}${parsed.search}`;
    requestedPaths.push(pathWithQuery);

    const initPayload: RequestInit = { method: call.method };
    if (call.headers !== undefined) {
      initPayload.headers = call.headers as RequestInit["headers"];
    }
    if (call.body !== undefined) {
      initPayload.body = call.body as RequestInit["body"];
    }
    return app.request(pathWithQuery, initPayload);
  }) as typeof fetch;
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function reviewStatesFromRecord(review: unknown): Record<string, string> {
  if (!isRecord(review)) return {};
  const read = (role: string): string =>
    typeof review[role] === "string" ? (review[role] as string) : "";
  return {
    clinical: read("clinical"),
    psychometric: read("psychometric"),
    legal: read("legal"),
    simulationQa: read("simulationQa"),
  };
}

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

/**
 * Load the REAL `resolveLearnerExamScenarios` from apps/ui-xr at runtime. The specifier is
 * constructed so apps/ui-xr source never enters this app's static typecheck program, while the
 * resolver itself is the same module the #165/#167 evidence harnesses call statically from tools/.
 */
export async function loadLearnerScenarioResolver(): Promise<LearnerScenarioResolver> {
  // Absolute file URL from THIS module's location — a relative specifier is resolved against the
  // vite-node runtime (filesystem root under `vitest --root .`), not this module, so it must be
  // made absolute here.
  const moduleSpecifier = new URL(
    ["..", "..", "ui-xr", "src", "learner-exam-scenario-source.js"].join("/"),
    import.meta.url,
  );
  const mod = (await import(/* @vite-ignore */ moduleSpecifier.href)) as Record<string, unknown>;
  const resolve = mod["resolveLearnerExamScenarios"];
  if (typeof resolve !== "function") {
    throw new Error("real resolveLearnerExamScenarios not found in apps/ui-xr source");
  }
  return resolve as LearnerScenarioResolver;
}

export function findBankFixture(scenarioId: string): Scenario {
  const fixture = scenarioBank.find((s) => s.scenarioId === scenarioId);
  if (!fixture) {
    throw new Error(`bank fixture missing: ${scenarioId}`);
  }
  return fixture;
}

/** Repo root computed from this module's location (apps/api/src → ../../..). */
export function repoRoot(): string {
  return fileURLToPath(new URL("../../..", import.meta.url));
}
