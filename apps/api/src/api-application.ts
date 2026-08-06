import { Hono } from "hono";
import type { ScenarioRuntime } from "@openclinxr/scenario-runtime";
import { type ApiAppContext, createApiAppContext } from "./api-app-context.js";
import { registerCoreMiddleware } from "./api-middleware.js";
import type { ApiAppOptions, ApiAppVariables, ApiPersistenceSink } from "./api-types.js";

export type ApiApp = Hono<{ Variables: ApiAppVariables }>;

/**
 * Lifecycle contract for anything the app owns that must be started and stopped
 * (connections, pollers, sidecars). Kept to two methods deliberately — no base class,
 * no decorators. Adapted from cellixjs `@cellix/api-services-spec` `ServiceBase`.
 *
 * Configuration should be validated inside `startUp()` rather than a constructor, so a
 * misconfiguration surfaces during the start phase with the service name attached instead
 * of as an opaque import-time crash.
 *
 * Process-facing adapters may use the shorter `start`/`stop` names (see {@link normalizeLifecycleService});
 * both shapes are accepted at registration so callers do not need an adapter wrapper.
 */
export type ApiLifecycleService = {
  readonly name: string;
  startUp(): Promise<void>;
  shutDown(): Promise<void>;
};

/** Registration-time input: cellix-style `startUp`/`shutDown` or process-style `start`/`stop`. */
export type ApiLifecycleServiceInput =
  | ApiLifecycleService
  | {
      readonly name: string;
      start(): Promise<void>;
      stop(): Promise<void>;
    };

function normalizeLifecycleService(service: ApiLifecycleServiceInput): ApiLifecycleService {
  if ("startUp" in service && typeof service.startUp === "function") {
    return service;
  }
  const processStyle = service as { readonly name: string; start(): Promise<void>; stop(): Promise<void> };
  return {
    name: processStyle.name,
    startUp: () => processStyle.start(),
    shutDown: () => processStyle.stop(),
  };
}

/**
 * Process-facing entry for ordered reverse shutdown. Prefer this over calling `stop()` so
 * process hosts (and future SIGTERM handlers) share one call site. Idempotent via
 * {@link ComposedApiApp.stop}.
 */
export async function shutdownApiApp(app: ComposedApiApp): Promise<void> {
  await app.stop();
}

/**
 * Composition phases, expressed as segregated interfaces so that ORDER IS A COMPILE ERROR:
 * each phase returns only the interface exposing the legal next call. Adapted from cellixjs
 * `cellix.ts` (Cellix implements five stage interfaces over one class).
 *
 * Ordering is a correctness property here, not bookkeeping — middleware must wrap every route,
 * so routes registered before middleware would be unauthenticated and un-instrumented.
 */
export interface ApiContextStage {
  /** Phase 1 — resolve options into the typed context (deps + shared in-memory state). */
  withContext(
    runtime?: ScenarioRuntime,
    persistence?: ApiPersistenceSink,
    options?: ApiAppOptions,
  ): ApiMiddlewareStage;
}

export interface ApiMiddlewareStage {
  /** Phase 2 — CORS, auth identity, telemetry spans. Must precede routes. */
  withCoreMiddleware(): ApiRoutesStage;
}

export interface ApiRoutesStage {
  /**
   * Phase 3 — register per-domain route modules. Registration happens inside the callback so
   * the mutating surface is unreachable from the chain itself (cellixjs scoped-callback pattern).
   */
  withRoutes(register: (app: ApiApp, ctx: ApiAppContext) => void): ApiBuildStage;
  /** Optional — services started/stopped with the app. Accepts startUp/shutDown or start/stop. */
  withLifecycleServices(...services: readonly ApiLifecycleServiceInput[]): ApiRoutesStage;
}

export interface ApiBuildStage {
  build(): ComposedApiApp;
}

/**
 * Terminal, read-only composition result: no registration methods exist on this type, so
 * post-build code physically cannot re-register (cellixjs `StartedApplication`).
 */
export type ComposedApiApp = {
  readonly app: ApiApp;
  readonly context: ApiAppContext;
  /** Start owned services. Safe to call once; awaits each service in registration order. */
  start(): Promise<void>;
  /**
   * Stop owned services in REVERSE registration order, settling all of them so one failure
   * cannot hide the rest. Idempotent. (Improves on cellixjs, which uses unordered `Promise.all`
   * with no idempotency guard — and on atlantis-cameras-v2, which has no shutdown at all.)
   */
  stop(): Promise<void>;
};

/**
 * Fluent API application builder — the composition root for apps/api.
 *
 * The chain stays SYNCHRONOUS; all async work is deferred to `start()` on the built result, so
 * no `await` is needed mid-chain and route binding never blocks on I/O (cellixjs's key decision).
 *
 * Feature logic lives in packages and in the per-domain `registerXRoutes(app, ctx)` modules; this
 * class sequences phases and holds nothing domain-specific.
 */
export class ApiApplication implements ApiContextStage, ApiMiddlewareStage, ApiRoutesStage, ApiBuildStage {
  private phase: "new" | "context" | "middleware" | "routes" | "built" = "new";
  private app: ApiApp | undefined;
  private ctx: ApiAppContext | undefined;
  private readonly services: ApiLifecycleService[] = [];

  private constructor() {}

  static create(): ApiContextStage {
    return new ApiApplication();
  }

  /** Defence in depth for JS callers / package boundaries; TS callers are already type-gated. */
  private assertPhase(expected: ApiApplication["phase"], method: string): void {
    if (this.phase !== expected) {
      throw new Error(`ApiApplication.${method}: expected phase '${expected}', was '${this.phase}'`);
    }
  }

  withContext(
    runtime?: ScenarioRuntime,
    persistence: ApiPersistenceSink = {},
    options: ApiAppOptions = {},
  ): ApiMiddlewareStage {
    this.assertPhase("new", "withContext");
    this.app = new Hono<{ Variables: ApiAppVariables }>();
    this.ctx = runtime
      ? createApiAppContext(runtime, persistence, options)
      : createApiAppContext(undefined, persistence, options);
    this.phase = "context";
    return this;
  }

  withCoreMiddleware(): ApiRoutesStage {
    this.assertPhase("context", "withCoreMiddleware");
    registerCoreMiddleware(this.requireApp("withCoreMiddleware"), this.requireCtx("withCoreMiddleware"));
    this.phase = "middleware";
    return this;
  }

  withLifecycleServices(...services: readonly ApiLifecycleServiceInput[]): ApiRoutesStage {
    this.assertPhase("middleware", "withLifecycleServices");
    this.services.push(...services.map(normalizeLifecycleService));
    return this;
  }

  withRoutes(register: (app: ApiApp, ctx: ApiAppContext) => void): ApiBuildStage {
    this.assertPhase("middleware", "withRoutes");
    register(this.requireApp("withRoutes"), this.requireCtx("withRoutes"));
    this.phase = "routes";
    return this;
  }

  build(): ComposedApiApp {
    this.assertPhase("routes", "build");
    const app = this.requireApp("build");
    const context = this.requireCtx("build");
    const services = [...this.services];
    this.phase = "built";

    let started: ApiLifecycleService[] = [];
    let stopping = false;

    return {
      app,
      context,
      async start(): Promise<void> {
        started = [];
        for (const service of services) {
          try {
            await service.startUp();
            started.push(service);
          } catch (error) {
            // Compensate: stop whatever already started so a partial boot cannot leak resources.
            for (const openService of [...started].reverse()) {
              await openService.shutDown().catch(() => undefined);
            }
            started = [];
            throw new Error(`ApiApplication.start: service '${service.name}' failed to start`, { cause: error });
          }
        }
      },
      async stop(): Promise<void> {
        if (stopping) return;
        stopping = true;
        const results = await Promise.allSettled([...started].reverse().map((service) => service.shutDown()));
        started = [];
        stopping = false;
        const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
        if (failures.length > 0) {
          throw new AggregateError(failures, "ApiApplication.stop: one or more services failed to shut down");
        }
      },
    };
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
