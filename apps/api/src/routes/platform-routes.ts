import type { Hono } from "hono";
import { buildOpenClinXrCapabilityRoutingMatrix, evaluateRuntimeProviderReadinessSurface, type RuntimeProfile } from "@openclinxr/capability-gateway";
import { routeById } from "@openclinxr/rest";
import type { ApiAppContext } from "../api-app-context.js";
import { telemetrySnapshotFromRecorder } from "../api-support.js";
import type { ApiAppVariables } from "../api-types.js";

/**
 * Platform/observability routes: health, telemetry snapshot, provider health, protocol posture,
 * and runtime provider readiness.
 *
 * First per-domain route module of the composition-root migration — routes receive their
 * dependencies via the typed {@link ApiAppContext} instead of closing over factory locals.
 */
export function registerPlatformRoutes(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  const { runtime, telemetry, apiProtocolPosture } = ctx;

  app.get(routeById("health").path, async (context) =>
    context.json({
      ok: true,
      service: "openclinxr-api",
      providerHealth: await runtime.providerHealth(),
    }),
  );

  /** Read-only local metrics snapshot. Does not mutate counters or span buffer. */
  app.get(routeById("telemetry-metrics").path, (context) =>
    context.json(telemetrySnapshotFromRecorder(telemetry)),
  );

  app.get(routeById("providers-health").path, async (context) => context.json(await runtime.providerHealth()));

  app.get(routeById("runtime-protocols").path, (context) => context.json(apiProtocolPosture));

  app.get(routeById("runtime-provider-readiness").path, (context) => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const profiles: RuntimeProfile[] = ["local-development", "local-production", "production"];
    return context.json({
      source: "capability-routing-matrix",
      claimBoundary: "deterministic_replay_ready_is_not_live_provider_readiness",
      surfaces: profiles.map((profile) => evaluateRuntimeProviderReadinessSurface(matrix, profile)),
    });
  });
}
