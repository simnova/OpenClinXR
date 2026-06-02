import { describe, expect, it } from "vitest";
import { buildSessionRoutePath, matchOpenClinXrRestRoute, openClinXrRestRouteIds, openClinXrRestRoutes, routeById } from "./index.js";

describe("OpenClinXR REST route contract", () => {
  it("captures the API route catalog with stable route ids and methods", () => {
    expect(openClinXrRestRouteIds).toEqual([
      "health",
      "providers-health",
      "runtime-protocols",
      "runtime-provider-readiness",
      "runtime-selection-review-packet",
      "submit-runtime-realism-evidence-input-review",
      "submit-runtime-visual-evidence-attachment",
      "learner-runtime-asset-bundle-list",
      "learner-runtime-asset-bundle",
      "realtime-voice-posture",
      "admin-graphql-schema",
      "admin-graphql-codegen-plan",
      "admin-graphql-documents",
      "admin-graphql-execute",
      "learner-scenario",
      "scenario-bank-maturity",
      "scenario-bank-exam-sequence",
      "scenario-bank-dynamic-encounter-factory-planning",
      "scenario-bank-asset-readiness",
      "scenario-bank-environment-generation-queue",
      "scenario-bank-environment-work-order-queue",
      "scenario-bank-scene-generation-pipeline",
      "list-scenario-scene-generation-requests",
      "create-scenario-scene-generation-request",
      "submit-scenario-scene-generation-request-review",
      "submit-scenario-scene-generation-materialization-input-review",
      "scenario-scene-generation-request-publication-readiness",
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
      "review-replay-readiness-summary",
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
    expect(routeById("scenario-bank-maturity")).toMatchObject({
      method: "GET",
      path: "/scenario-bank/maturity",
      surface: "control-plane",
    });
    expect(routeById("scenario-bank-exam-sequence")).toMatchObject({
      method: "GET",
      path: "/scenario-bank/exam-sequence",
      surface: "control-plane",
    });
    expect(routeById("scenario-bank-dynamic-encounter-factory-planning")).toMatchObject({
      method: "GET",
      path: "/scenario-bank/dynamic-encounter-factory/planning",
      surface: "control-plane",
      stationRunScoped: false,
      contractBoundary: {
        posture: "read_only_review_packet",
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
      },
    });
    expect(routeById("scenario-bank-environment-generation-queue")).toMatchObject({
      method: "GET",
      path: "/scenario-bank/environments/generation-queue",
      surface: "control-plane",
    });
    expect(routeById("scenario-bank-environment-work-order-queue")).toMatchObject({
      method: "GET",
      path: "/scenario-bank/environments/work-orders",
      surface: "control-plane",
    });
    expect(routeById("scenario-bank-scene-generation-pipeline")).toMatchObject({
      method: "GET",
      path: "/scenario-bank/scene-generation/pipeline",
      surface: "control-plane",
    });
    expect(routeById("list-scenario-scene-generation-requests")).toMatchObject({
      method: "GET",
      path: "/scenario-bank/scene-generation/requests",
      surface: "control-plane",
    });
    expect(routeById("create-scenario-scene-generation-request")).toMatchObject({
      method: "POST",
      path: "/scenario-bank/scene-generation/requests",
      surface: "control-plane",
    });
    expect(routeById("submit-scenario-scene-generation-request-review")).toMatchObject({
      method: "POST",
      path: "/scenario-bank/scene-generation/requests/:requestId/runtime-asset-review-decisions",
      surface: "control-plane",
    });
    expect(routeById("submit-scenario-scene-generation-materialization-input-review")).toMatchObject({
      method: "POST",
      path: "/scenario-bank/scene-generation/requests/:requestId/materialization-input-review-decisions",
      surface: "control-plane",
    });
    expect(routeById("scenario-scene-generation-request-publication-readiness")).toMatchObject({
      method: "GET",
      path: "/scenario-bank/scene-generation/requests/:requestId/publication-readiness",
      surface: "control-plane",
    });
    expect(routeById("runtime-protocols")).toMatchObject({
      method: "GET",
      path: "/runtime/protocols",
      surface: "control-plane",
    });
    expect(routeById("runtime-provider-readiness")).toMatchObject({
      method: "GET",
      path: "/runtime/provider-readiness",
      surface: "control-plane",
    });
    expect(routeById("runtime-selection-review-packet")).toMatchObject({
      method: "GET",
      path: "/runtime/selection-review-packet",
      surface: "control-plane",
      stationRunScoped: false,
      contractBoundary: {
        posture: "read_only_review_packet",
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
      },
    });
    expect(routeById("submit-runtime-realism-evidence-input-review")).toMatchObject({
      method: "POST",
      path: "/runtime/realism-evidence-input-review-decisions",
      surface: "control-plane",
    });
    expect(routeById("submit-runtime-visual-evidence-attachment")).toMatchObject({
      method: "POST",
      path: "/runtime/visual-evidence-attachments",
      surface: "control-plane",
    });
    expect(routeById("learner-runtime-asset-bundle")).toMatchObject({
      method: "GET",
      path: "/runtime/asset-bundles/:bundleId",
      surface: "xr-runtime",
    });
    expect(routeById("learner-runtime-asset-bundle-list")).toMatchObject({
      method: "GET",
      path: "/runtime/asset-bundles",
      surface: "xr-runtime",
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
    expect(buildSessionRoutePath("review-replay-readiness-summary", "run_001")).toBe(
      "/sessions/run_001/review-replay-readiness",
    );
  });

  it("rejects route ids that are not station-run scoped", () => {
    expect(() => buildSessionRoutePath("health", "run_001")).toThrow("Route health is not station-run scoped");
    expect(() => buildSessionRoutePath("actor-response", "")).toThrow("stationRunId is required");
    expect(() => buildSessionRoutePath("actor-response", "   ")).toThrow("stationRunId is required");
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
    expect(matchOpenClinXrRestRoute("GET", "/sessions/run_001/trace-events?limit=10#latest")).toMatchObject({
      route: { id: "trace-events" },
      params: { stationRunId: "run_001" },
    });
    expect(matchOpenClinXrRestRoute("GET", "/sessions/run_001/review-replay-readiness")).toMatchObject({
      route: { id: "review-replay-readiness-summary" },
      params: { stationRunId: "run_001" },
    });
    expect(matchOpenClinXrRestRoute("GET", "/scenario-bank/maturity")?.route.id).toBe("scenario-bank-maturity");
    expect(matchOpenClinXrRestRoute("GET", "/scenario-bank/exam-sequence")?.route.id).toBe(
      "scenario-bank-exam-sequence",
    );
    expect(matchOpenClinXrRestRoute("GET", "/scenario-bank/dynamic-encounter-factory/planning")?.route.id).toBe(
      "scenario-bank-dynamic-encounter-factory-planning",
    );
    expect(matchOpenClinXrRestRoute("GET", "/scenario-bank/environments/generation-queue")?.route.id).toBe(
      "scenario-bank-environment-generation-queue",
    );
    expect(matchOpenClinXrRestRoute("GET", "/scenario-bank/environments/work-orders")?.route.id).toBe(
      "scenario-bank-environment-work-order-queue",
    );
    expect(matchOpenClinXrRestRoute("GET", "/runtime/asset-bundles/local%2Fbundle%231")).toMatchObject({
      route: { id: "learner-runtime-asset-bundle" },
      params: { bundleId: "local/bundle#1" },
    });
    expect(matchOpenClinXrRestRoute("GET", "/runtime/asset-bundles")?.route.id).toBe(
      "learner-runtime-asset-bundle-list",
    );
    expect(matchOpenClinXrRestRoute("GET", "/runtime/selection-review-packet")?.route.id).toBe(
      "runtime-selection-review-packet",
    );
    expect(matchOpenClinXrRestRoute("GET", "/sessions/run_001/actor-response")).toBeUndefined();
    expect(matchOpenClinXrRestRoute("GET", "/unknown")).toBeUndefined();
  });
});
