import { describe, expect, it } from "vitest";
import { ApiApplication } from "./api-application.js";

/**
 * Phase-order guard for the composition root. The chain is order-sensitive — middleware must wrap
 * every route, so registering routes before middleware would silently produce an app with
 * unauthenticated, un-instrumented handlers. These assertions make that misuse loud.
 */
describe("ApiApplication fluent phases", () => {
  it("rejects withCoreMiddleware before withContext", () => {
    expect(() => ApiApplication.create().withCoreMiddleware()).toThrow(/expected phase 'context'/);
  });

  it("rejects withRoutes before withCoreMiddleware", () => {
    expect(() => ApiApplication.create().withContext().withRoutes(() => undefined)).toThrow(
      /expected phase 'middleware'/,
    );
  });

  it("rejects build before routes are registered", () => {
    expect(() => ApiApplication.create().withContext().withCoreMiddleware().build()).toThrow(
      /expected phase 'routes'/,
    );
  });

  it("rejects re-running a completed phase", () => {
    const application = ApiApplication.create().withContext();
    expect(() => application.withContext()).toThrow(/expected phase 'new'/);
  });

  it("composes an app through the full ordered chain", () => {
    let registered = false;
    const app = ApiApplication.create()
      .withContext()
      .withCoreMiddleware()
      .withRoutes(() => {
        registered = true;
      })
      .build();

    expect(registered).toBe(true);
    expect(typeof app.fetch).toBe("function");
  });
});
