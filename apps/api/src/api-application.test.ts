import { describe, expect, it } from "vitest";
import { ApiApplication, type ApiLifecycleService } from "./api-application.js";
import { createDefaultScenarioRuntime } from "@openclinxr/scenario-runtime";
import { shutdownApiApp } from "./api-application.js";

/**
 * The composition chain is order-sensitive: middleware must wrap every route, so routes
 * registered before middleware would be unauthenticated and un-instrumented.
 *
 * Ordering is enforced twice — at COMPILE time by segregated stage interfaces (each phase returns
 * only the legal next call), and at RUNTIME by assertPhase for JS callers crossing the package
 * boundary. The `@ts-expect-error` assertions below fail the build if the type-state ever regresses.
 */
describe("ApiApplication fluent phases", () => {
  it("makes out-of-order composition a COMPILE error (type-state)", () => {
    const stage = ApiApplication.create();
    // @ts-expect-error — withCoreMiddleware is not on ApiContextStage; context must come first.
    expect(() => stage.withCoreMiddleware()).toThrow();

    const middlewareStage = ApiApplication.create().withContext();
    // @ts-expect-error — withRoutes is not on ApiMiddlewareStage; middleware must precede routes.
    expect(() => middlewareStage.withRoutes(() => undefined)).toThrow();

    const routesStage = ApiApplication.create().withContext().withCoreMiddleware();
    // @ts-expect-error — build is not on ApiRoutesStage; routes must be registered first.
    expect(() => routesStage.build()).toThrow();
  });

  it("still guards at runtime for untyped callers", () => {
    const application = ApiApplication.create().withContext() as unknown as {
      withContext: () => unknown;
    };
    expect(() => application.withContext()).toThrow(/expected phase 'new'/);
  });

  it("composes an app through the full ordered chain", () => {
    let registered = false;
    const composed = ApiApplication.create()
      .withContext()
      .withCoreMiddleware()
      .withRoutes(() => {
        registered = true;
      })
      .build();

    expect(registered).toBe(true);
    expect(typeof composed.app.fetch).toBe("function");
    expect(composed.context.sessionOwners.size).toBe(0);
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  const trackingService = (name: string, log: string[], failStart = false): ApiLifecycleService => ({
    name,
    startUp: async () => {
      if (failStart) throw new Error(`${name} boom`);
      log.push(`start:${name}`);
    },
    shutDown: async () => {
      log.push(`stop:${name}`);
    },
  });

  function composeWith(services: readonly ApiLifecycleService[]) {
    return ApiApplication.create()
      .withContext()
      .withCoreMiddleware()
      .withLifecycleServices(...services)
      .withRoutes(() => undefined)
      .build();
  }

  it("starts services in registration order and stops them in reverse", async () => {
    const log: string[] = [];
    const composed = composeWith([trackingService("a", log), trackingService("b", log)]);

    await composed.start();
    await composed.stop();

    expect(log).toEqual(["start:a", "start:b", "stop:b", "stop:a"]);
  });

  it("rolls back already-started services when one fails to start", async () => {
    const log: string[] = [];
    const composed = composeWith([trackingService("a", log), trackingService("bad", log, true)]);

    await expect(composed.start()).rejects.toThrow(/service 'bad' failed to start/);
    expect(log).toEqual(["start:a", "stop:a"]);
  });

  it("is idempotent on stop and never double-stops", async () => {
    const log: string[] = [];
    const composed = composeWith([trackingService("a", log)]);

    await composed.start();
    await composed.stop();
    await composed.stop();

    expect(log).toEqual(["start:a", "stop:a"]);
  });

  it("settles every shutdown even when one throws", async () => {
    const log: string[] = [];
    const failing: ApiLifecycleService = {
      name: "failing",
      startUp: async () => {
        log.push("start:failing");
      },
      shutDown: async () => {
        throw new Error("shutdown boom");
      },
    };
    const composed = composeWith([trackingService("a", log), failing]);

    await composed.start();
    await expect(composed.stop()).rejects.toThrow(/failed to shut down/);
    // 'a' still stopped despite the earlier (reverse-order) failure.
    expect(log).toContain("stop:a");
  });
});

describe("process shutdown actually runs the lifecycle (issue #29)", () => {
  /**
   * ApiApplication already implements the good algorithm — ordered start, compensating reverse
   * rollback on partial failure, idempotent reverse stop. Nothing calls it: `withLifecycleServices`
   * and `ComposedApiApp.start/stop` have zero callers outside this file.
   *
   * The tempting cleanup is to delete it, since the startup builder is the real process root. Peer
   * review refused that: the builder is not a better lifecycle owner, it is NOT A LIFECYCLE OWNER
   * AT ALL — it composes synchronously and never runs service start/stop. Deleting would abandon the
   * better shutdown rather than consolidate ownership.
   *
   * And there is a real leak to hang it on. `api-mongo-boot.ts` opens a MongoClient and exposes
   * `close()`, while `apps/api/src` contains no SIGTERM or SIGINT handler at all — so the connection
   * is never closed when the process stops. That makes wiring it the honest option rather than a
   * hypothetical one.
   */
  it("closes registered services in reverse registration order on shutdown", async () => {
    const closed: string[] = [];
    const service = (name: string) => ({
      name,
      start: async () => {},
      stop: async () => { closed.push(name); },
    });

    const app = ApiApplication.create()
      .withContext(createDefaultScenarioRuntime(), {}, {})
      .withCoreMiddleware()
      .withLifecycleServices(service("mongo"), service("telemetry"))
      .withRoutes(() => {})
      .build();

    await app.start();
    await shutdownApiApp(app);

    expect(closed).toEqual(["telemetry", "mongo"]);
  });

  it("is idempotent — a second shutdown does not re-close services", async () => {
    let closes = 0;
    const app = ApiApplication.create()
      .withContext(createDefaultScenarioRuntime(), {}, {})
      .withCoreMiddleware()
      .withLifecycleServices({ name: "s", start: async () => {}, stop: async () => { closes += 1; } })
      .withRoutes(() => {})
      .build();

    await app.start();
    await shutdownApiApp(app);
    await shutdownApiApp(app);

    expect(closes).toBe(1);
  });
});
