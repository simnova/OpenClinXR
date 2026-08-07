/**
 * #165 — authored exam reaches the learner resolver from a real in-process API.
 *
 * Isolated seam proof (operator §9a): real `createApiApp()` + `app.request` fetch adapter +
 * real `resolveLearnerExamScenarios`. Zero Vite, zero browser, zero listening ports.
 *
 * claimScope: whether an authored, approved scenario BODY reaches the learner resolver over the
 * real station-run-queue + GET /scenarios/:id routes with bodySource api_authored.
 * notEvidenceFor: XR scene, cast, garments, rooms, clinical validity, exam equivalence,
 * product end-to-end learner runtime rendering.
 *
 * Decisions (named; reject list in commit):
 * 1. Seed via real POST /scenarios + four SubmitScenarioReview gates (not store-direct approved).
 * 2. Distinguishing field = title carrying ISSUE165_AUTHORED_SEAM_MARKER (fixture bank cannot produce).
 * 3. In-process fetch adapter lives in this module only (one caller; not a framework).
 */

import type { ApiPersistenceSink, ApiScenarioReviewDecisionRecord } from "../../../apps/api/src/api-types.js";
import { createApiApp } from "../../../apps/api/src/index.js";
import { resolveLearnerExamScenarios } from "../../../apps/ui-xr/src/learner-exam-scenario-source.js";
import { adminGraphqlDocumentByOperationName } from "../../../packages/openclinxr/graphql/src/index.js";
import { edChestPainScenario } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import type { Scenario } from "../../../packages/openclinxr/shared-schemas/src/index.js";

/** Present only on the seeded authored body — fixture bank titles cannot carry this marker. */
export const ISSUE165_DISTINGUISHING_MARKER = "ISSUE165_AUTHORED_SEAM_MARKER";

const BLUEPRINT_ID = "step2cs-seed";
const IN_PROCESS_ORIGIN = "http://in-process.openclinxr.local";

export type ResolvedStation = {
  scenarioId: string;
  bodySource: string;
  distinguishingValue: string | null;
};

export type SeamRun = {
  activationReadyCount: number;
  canStartLearnerExam: boolean;
  queueStationCount: number;
  scenarioSource: string;
  stations: ResolvedStation[];
  requestedPaths: string[];
  devServerBoots: number;
  browserLaunches: number;
  offline: { scenarioSource: string; stationCount: number; fetchCount: number };
  claimScope: string;
  notEvidenceFor: string[];
};

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

/**
 * fetch-shaped adapter over Hono `app.request` — records paths for transport proof.
 * No network, no port bind, no browser.
 */
function createInProcessFetch(
  app: HonoLikeApp,
  requestedPaths: string[],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const parsed = new URL(url, IN_PROCESS_ORIGIN);
    const pathWithQuery = `${parsed.pathname}${parsed.search}`;
    requestedPaths.push(pathWithQuery);

    const method = init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET");
    const headers = init?.headers
      ?? (typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined);
    const body =
      init?.body
      ?? (typeof input !== "string" && !(input instanceof URL) && method !== "GET" && method !== "HEAD"
        ? input.body
        : undefined);

    const response = await app.request(pathWithQuery, {
      method,
      headers,
      body: body as BodyInit | undefined,
    });
    return response;
  }) as typeof fetch;
}

function distinguishingTitle(): string {
  return `${ISSUE165_DISTINGUISHING_MARKER} — ${edChestPainScenario.title}`;
}

function extractDistinguishingValue(record: Record<string, unknown>): string | null {
  const title = record["title"];
  if (typeof title === "string" && title.includes(ISSUE165_DISTINGUISHING_MARKER)) {
    return title;
  }
  return null;
}

async function seedAuthoredExamThroughRealRoutes(app: HonoLikeApp): Promise<void> {
  // Draft write — client cannot self-approve (coerce demotes). Review path alone promotes.
  const draft: Scenario = {
    ...edChestPainScenario,
    scenarioId: edChestPainScenario.scenarioId,
    version: edChestPainScenario.version,
    title: distinguishingTitle(),
    status: "draft",
    review: {
      clinical: "draft",
      psychometric: "draft",
      legal: "draft",
      simulationQa: "draft",
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

  const submit = adminGraphqlDocumentByOperationName("SubmitScenarioReview");
  for (const reviewerRole of ["clinical", "psychometric", "legal", "simulationQa"] as const) {
    const res = await app.request("/admin/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: submit.source,
        operationName: "SubmitScenarioReview",
        variables: {
          input: {
            scenarioId: draft.scenarioId,
            version: draft.version,
            reviewerRole,
            reviewerId: `issue165_${reviewerRole}`,
            decision: "APPROVED",
            comments: `${reviewerRole} gate approved for #165 authored-exam-reaches-learner seam proof (local formative only).`,
            evidenceRefs: [`evidence:issue165:${draft.scenarioId}:${reviewerRole}`],
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
      throw new Error(`SubmitScenarioReview ${reviewerRole} graphql errors: ${JSON.stringify(body.errors)}`);
    }
  }
}

/**
 * Prove the authored→learner seam: seed via real authoring/review routes, resolve via the real
 * learner function against an in-process API. Offline control runs in the same pass.
 */
export async function inspectAuthoredExamReachesLearner(): Promise<SeamRun> {
  // COUNTERWEIGHT first — no app, no fetch, deliberate offline mode.
  let offlineFetchCount = 0;
  const offlineFetch: typeof fetch = (async () => {
    offlineFetchCount += 1;
    throw new Error("offline control must not fetch");
  }) as typeof fetch;
  const offlineResult = await resolveLearnerExamScenarios({
    blueprintId: BLUEPRINT_ID,
    fetch: offlineFetch,
  });

  const sink = createAuthoredMemorySink();
  const app = createApiApp(undefined, sink);
  const requestedPaths: string[] = [];
  const fetchAdapter = createInProcessFetch(app, requestedPaths);

  await seedAuthoredExamThroughRealRoutes(app);

  const queueRes = await app.request(`/exam-blueprints/${BLUEPRINT_ID}/station-run-queue`);
  const queueBody = (await queueRes.json()) as {
    canStartLearnerExam?: boolean;
    stationQueue?: Array<{ scenarioId?: string | null; status?: string }>;
    summary?: { activationReady?: number };
  };

  const resolution = await resolveLearnerExamScenarios({
    baseUrl: IN_PROCESS_ORIGIN,
    blueprintId: BLUEPRINT_ID,
    fetch: fetchAdapter,
  });

  const stations: ResolvedStation[] = resolution.scenarios.map((record) => {
    const bodySource = typeof record.bodySource === "string" ? record.bodySource : "unknown";
    return {
      scenarioId: record.scenarioId,
      bodySource,
      distinguishingValue:
        bodySource === "api_authored" ? extractDistinguishingValue(record) : null,
    };
  });

  return {
    activationReadyCount: queueBody.summary?.activationReady ?? 0,
    canStartLearnerExam: queueBody.canStartLearnerExam === true,
    queueStationCount: queueBody.stationQueue?.length ?? 0,
    scenarioSource: resolution.scenarioSource,
    stations,
    requestedPaths: [...requestedPaths],
    // Isolated seam — never boots Vite or launches a browser.
    devServerBoots: 0,
    browserLaunches: 0,
    offline: {
      scenarioSource: offlineResult.scenarioSource,
      stationCount: offlineResult.scenarios.length,
      fetchCount: offlineFetchCount,
    },
    claimScope:
      "authored_approved_scenario_body_reaches_learner_resolver_via_real_api_routes_in_process",
    notEvidenceFor: [
      "xr_scene",
      "cast",
      "garments",
      "rooms",
      "clinical_validity",
      "exam_equivalence",
      "product_end_to_end_learner_runtime_render",
      "quest_readiness",
    ],
  };
}
