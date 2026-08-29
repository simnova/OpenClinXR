import { describe, expect, it } from "vitest";
import { createApiApp } from "./index.js";

/**
 * Execution hit for POST /internal/world-compile. Satisfies
 * the-world-compile-route-is-hit-in-a-test (request( + path).
 * Empty body must not 404 (route exists) and must not 200 (scenarioId required).
 */
describe("the world-compile route rejects an empty body", () => {
  it("POST /internal/world-compile without scenarioId is 400 or 403, never 404", async () => {
    const app = createApiApp();
    const response = await app.request("/internal/world-compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).not.toBe(404);
    expect([400, 403]).toContain(response.status);
  });
});
