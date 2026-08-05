import { Hono } from "hono";
import type { ScenarioRuntime } from "@openclinxr/scenario-runtime";
import { type ApiAppContext, createApiAppContext } from "./api-app-context.js";
import { registerCoreMiddleware } from "./api-middleware.js";
import type { ApiAppOptions, ApiAppVariables, ApiPersistenceSink } from "./api-types.js";

export type ApiApp = Hono<{ Variables: ApiAppVariables }>;

/**
 * Ordered composition phases. The chain is order-sensitive: middleware must be registered
 * before routes (CORS/auth/telemetry wrap every handler), and the context must exist before
 * either. Calling out of order throws rather than silently producing a mis-wired app.
 */
type Phase = "new" | "context" | "middleware" | "routes" | "built";

/**
 * Fluent API application builder — the composition root for apps/api.
 *
 * Feature logic lives in packages and in the per-domain `registerXRoutes(app, ctx)` modules;
 * this class only sequences the phases and holds nothing domain-specific. Adding a route domain
 * is a one-line registration inside the `withRoutes` callback (see `createApiApp`), which keeps
 * the composition root thin as the API grows.
 *
 * Adapted from atlantis-cameras-v2 `apps/api/src/icd-api-application.ts`. Like that builder,
 * ordering is enforced at runtime via `assertPhase` (not a type-state pattern), which keeps the
 * chain ergonomic while still failing loudly on misuse.
 */
export class ApiApplication {
  private phase: Phase = "new";
  private app: ApiApp | undefined;
  private ctx: ApiAppContext | undefined;

  private constructor() {}

  static create(): ApiApplication {
    return new ApiApplication();
  }

  private assertPhase(expected: Phase, method: string): void {
    if (this.phase !== expected) {
      throw new Error(`ApiApplication.${method}: expected phase '${expected}', was '${this.phase}'`);
    }
  }

  /** Phase 1 — resolve options into the typed context (deps + shared in-memory state). */
  withContext(
    runtime?: ScenarioRuntime,
    persistence: ApiPersistenceSink = {},
    options: ApiAppOptions = {},
  ): this {
    this.assertPhase("new", "withContext");
    this.app = new Hono<{ Variables: ApiAppVariables }>();
    this.ctx = runtime
      ? createApiAppContext(runtime, persistence, options)
      : createApiAppContext(undefined, persistence, options);
    this.phase = "context";
    return this;
  }

  /** Phase 2 — CORS, auth identity, telemetry spans. Must precede routes. */
  withCoreMiddleware(): this {
    this.assertPhase("context", "withCoreMiddleware");
    registerCoreMiddleware(this.requireApp("withCoreMiddleware"), this.requireCtx("withCoreMiddleware"));
    this.phase = "middleware";
    return this;
  }

  /** Phase 3 — register per-domain route modules. */
  withRoutes(register: (app: ApiApp, ctx: ApiAppContext) => void): this {
    this.assertPhase("middleware", "withRoutes");
    register(this.requireApp("withRoutes"), this.requireCtx("withRoutes"));
    this.phase = "routes";
    return this;
  }

  /** Terminal phase — hand back the composed Hono app. */
  build(): ApiApp {
    this.assertPhase("routes", "build");
    const app = this.requireApp("build");
    this.phase = "built";
    return app;
  }

  /** Escape hatch for callers that need the context (tests, host wiring). */
  context(): ApiAppContext {
    return this.requireCtx("context");
  }

  private requireApp(method: string): ApiApp {
    if (!this.app) throw new Error(`ApiApplication.${method}: incomplete composition (no app)`);
    return this.app;
  }

  private requireCtx(method: string): ApiAppContext {
    if (!this.ctx) throw new Error(`ApiApplication.${method}: incomplete composition (no context)`);
    return this.ctx;
  }
}
