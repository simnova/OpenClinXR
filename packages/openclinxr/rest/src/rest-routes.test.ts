import { describe, expect, it } from "vitest";
import { buildSessionRoutePath, matchOpenClinXrRestRoute, openClinXrRestRouteIds, openClinXrRestRoutes, routeById } from "./index.js";

describe("OpenClinXR REST route contract", () => {
  it("captures the API route catalog with stable route ids and methods", () => {
    expect(openClinXrRestRouteIds).toEqual([
      "health",
      "providers-health",
      "runtime-protocols",
      "realtime-voice-posture",
      "admin-graphql-schema",
      "admin-graphql-codegen-plan",
      "admin-graphql-documents",
      "admin-graphql-execute",
      "learner-scenario",
      "scenario-bank-asset-readiness",
      "scenario-asset-readiness",
      "scenario-publication-readiness",
      "default-exam-blueprint",
      "step2cs-seed-exam-blueprint",
      "step2cs-seed-exam-blueprint-readiness",
      "step2cs-seed-exam-timing-plan",
      "step2cs-seed-station-run-queue",
      "list-step2cs-seed-station-run-queue-snapshots",
      "create-step2cs-seed-station-run-queue-snapshot",
      "create-exam-form",
      "exam-form-version-drift",
      "submit-internal-capability-job",
      "read-internal-capability-job",
      "start-session",
      "start-encounter",
      "append-trace-event",
      "record-clinical-action",
      "actor-interaction-route",
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
    expect(routeById("actor-interaction-route")).toMatchObject({
      method: "POST",
      path: "/sessions/:stationRunId/actor-interaction-route",
      surface: "xr-runtime",
      stationRunScoped: true,
    });
    expect(routeById("record-clinical-action")).toMatchObject({
      method: "POST",
      path: "/sessions/:stationRunId/clinical-actions",
      surface: "xr-runtime",
      stationRunScoped: true,
    });
    expect(routeById("scenario-bank-asset-readiness")).toMatchObject({
      method: "GET",
      path: "/scenario-bank/assets/readiness",
      surface: "control-plane",
    });
    expect(routeById("runtime-protocols")).toMatchObject({
      method: "GET",
      path: "/runtime/protocols",
      surface: "control-plane",
    });
    expect(routeById("realtime-voice-posture")).toMatchObject({
      method: "GET",
      path: "/voice/realtime/posture",
      surface: "xr-runtime",
    });
    expect(routeById("admin-graphql-execute")).toMatchObject({
      method: "POST",
      path: "/admin/graphql",
      surface: "admin-graphql",
    });
    expect(routeById("submit-internal-capability-job")).toMatchObject({
      method: "POST",
      path: "/internal/capabilities/:capabilityId/jobs",
      surface: "control-plane",
    });
    expect(routeById("read-internal-capability-job")).toMatchObject({
      method: "GET",
      path: "/internal/capabilities/:capabilityId/jobs/:jobId",
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
    expect(routeById("create-step2cs-seed-station-run-queue-snapshot")).toMatchObject({
      method: "POST",
      path: "/exam-blueprints/step2cs-seed/station-run-queue/snapshots",
      surface: "control-plane",
    });
    expect(routeById("list-step2cs-seed-station-run-queue-snapshots")).toMatchObject({
      method: "GET",
      path: "/exam-blueprints/step2cs-seed/station-run-queue/snapshots",
      surface: "control-plane",
    });
    expect(openClinXrRestRoutes.every((route) => route.path.startsWith("/"))).toBe(true);
  });

  it("builds encoded session URLs from Hono-compatible route templates", () => {
    expect(buildSessionRoutePath("actor-response", "run 1/2")).toBe("/sessions/run%201%2F2/actor-response");
    expect(buildSessionRoutePath("actor-interaction-route", "run 1/2")).toBe(
      "/sessions/run%201%2F2/actor-interaction-route",
    );
    expect(buildSessionRoutePath("record-clinical-action", "run 1/2")).toBe(
      "/sessions/run%201%2F2/clinical-actions",
    );
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
    expect(matchOpenClinXrRestRoute("POST", "/sessions/run%201%2F2/actor-interaction-route")).toMatchObject({
      route: { id: "actor-interaction-route" },
      params: { stationRunId: "run 1/2" },
    });
    expect(matchOpenClinXrRestRoute("POST", "/sessions/run%201%2F2/clinical-actions")).toMatchObject({
      route: { id: "record-clinical-action" },
      params: { stationRunId: "run 1/2" },
    });
    expect(matchOpenClinXrRestRoute("POST", "/internal/capabilities/character-generation/jobs")).toMatchObject({
      route: { id: "submit-internal-capability-job" },
      params: { capabilityId: "character-generation" },
    });
    expect(matchOpenClinXrRestRoute("GET", "/internal/capabilities/asset-bake/jobs/job%2F1")).toMatchObject({
      route: { id: "read-internal-capability-job" },
      params: { capabilityId: "asset-bake", jobId: "job/1" },
    });
    expect(matchOpenClinXrRestRoute("GET", "/sessions/run_001/actor-response")).toBeUndefined();
    expect(matchOpenClinXrRestRoute("GET", "/unknown")).toBeUndefined();
  });
});
