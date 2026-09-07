import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { createApiFetchTransport } from "./api-fetch-transport.js";
import type { ApiAppVariables, ApiPersistenceSink } from "@openclinxr/rest";
import {
  createInProcessDispatcher,
  type HonoLikeApp,
  type LearnerScenarioResolver,
} from "@openclinxr/rest";
import { createApiApp } from "./index.js";

export type { HonoLikeApp };

/** Repo root computed from this module's location (apps/api/src → ../../..). */
export function repoRoot(): string {
  return fileURLToPath(new URL("../../..", import.meta.url));
}

type BridgeApp = Hono<{ Variables: ApiAppVariables }> & HonoLikeApp;

/** The harness context the moved promotion modules take as their first parameter. */
export function createApiAppHarnessBridge(): {
  repoRoot: () => string;
  createApp: (persistence?: ApiPersistenceSink) => HonoLikeApp;
} {
  return {
    repoRoot,
    createApp: (persistence) => {
      const app: BridgeApp = (
        persistence === undefined ? createApiApp() : createApiApp(undefined, persistence)
      ) as BridgeApp;
      return app;
    },
  };
}

/** fetch-shaped adapter over Hono `app.request` — records paths for transport proof. */
export function createInProcessFetch(app: HonoLikeApp, requestedPaths: string[]): typeof fetch {
  return createApiFetchTransport((call) =>
    createInProcessDispatcher(app, requestedPaths)({
      url: call.url,
      method: call.method,
      ...(call.headers !== undefined ? { headers: call.headers } : {}),
      ...(call.body !== undefined ? { body: call.body } : {}),
    }),
  ) as typeof fetch;
}

/** Load the REAL `resolveLearnerExamScenarios` from its package home. */
export async function loadLearnerScenarioResolver(): Promise<LearnerScenarioResolver> {
  const { resolveLearnerExamScenarios } = await import("@openclinxr/xr-scene");
  return resolveLearnerExamScenarios as LearnerScenarioResolver;
}
