import { describe, expect, it } from "vitest";
import { buildSessionRoutePath, matchOpenClinXrRestRoute, openClinXrRestRouteIds, openClinXrRestRoutes, routeById } from "./index.js";

describe("OpenClinXR REST route contract", () => {
  it("captures the API route catalog with stable route ids and methods", () => {
    expect(openClinXrRestRouteIds).toEqual([
      "health",
      "providers-health",
      "admin-graphql-schema",
      "admin-graphql-codegen-plan",
      "admin-graphql-documents",
      "learner-scenario",
      "scenario-bank-asset-readiness",
      "scenario-asset-readiness",
      "scenario-publication-readiness",
      "default-exam-blueprint",
      "step2cs-seed-exam-blueprint",
      "step2cs-seed-exam-blueprint-readiness",
      "step2cs-seed-exam-timing-plan",
      "step2cs-seed-station-run-queue",
      "create-exam-form",
      "exam-form-version-drift",
      "start-session",
      "start-encounter",
      "append-trace-event",
      "actor-response",
      "voice-synthesis",
      "submit-note",
      "review-packet",
      "trace-events",
    ]);
    expect(routeById("actor-response")).toMatchObject({
      method: "POST",
      path: "/sessions/:stationRunId/actor-response",
      surface: "xr-runtime",
    });
    expect(routeById("scenario-bank-asset-readiness")).toMatchObject({
      method: "GET",
      path: "/scenario-bank/assets/readiness",
      surface: "control-plane",
    });
    expect(routeById("step2cs-seed-exam-blueprint-readiness")).toMatchObject({
      method: "GET",
      path: "/exam-blueprints/step2cs-seed/readiness",
      surface: "control-plane",
    });
    expect(routeById("step2cs-seed-exam-timing-plan")).toMatchObject({
      method: "GET",
      path: "/exam-blueprints/step2cs-seed/timing-plan",
      surface: "control-plane",
    });
    expect(routeById("step2cs-seed-station-run-queue")).toMatchObject({
      method: "GET",
      path: "/exam-blueprints/step2cs-seed/station-run-queue",
      surface: "control-plane",
    });
    expect(openClinXrRestRoutes.every((route) => route.path.startsWith("/"))).toBe(true);
  });

  it("builds encoded session URLs from Hono-compatible route templates", () => {
    expect(buildSessionRoutePath("actor-response", "run 1/2")).toBe("/sessions/run%201%2F2/actor-response");
    expect(buildSessionRoutePath("trace-events", "run_001")).toBe("/sessions/run_001/trace-events");
  });

  it("rejects route ids that are not station-run scoped", () => {
    expect(() => buildSessionRoutePath("health", "run_001")).toThrow("Route health is not station-run scoped");
    expect(() => buildSessionRoutePath("actor-response", "")).toThrow("stationRunId is required");
  });

  it("matches concrete request paths to stable route ids and decoded params", () => {
    expect(matchOpenClinXrRestRoute("GET", "/health")?.route.id).toBe("health");
    expect(matchOpenClinXrRestRoute("POST", "/sessions/run%201%2F2/actor-response")).toMatchObject({
      route: { id: "actor-response" },
      params: { stationRunId: "run 1/2" },
    });
    expect(matchOpenClinXrRestRoute("GET", "/sessions/run_001/actor-response")).toBeUndefined();
    expect(matchOpenClinXrRestRoute("GET", "/unknown")).toBeUndefined();
  });
});
