import type { Hono } from "hono";
import type { AssetGenerationJobPolicyInput } from "@openclinxr/capability-gateway";
import { routeById } from "@openclinxr/rest";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables } from "../api-types.js";
import { isAssetGenerationCapabilityId, parseRuntimeProfile } from "../api-route-support.js";
import { isRecord } from "../api-support.js";

/** CapabilityJob domain routes (composition-root migration). */
export function registerCapabilityJobRoutes(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  const { assetGenerationFacade } = ctx;

  app.post(routeById("submit-internal-capability-job").path, async (context) => {
    const capabilityId = context.req.param("capabilityId");
    if (!isAssetGenerationCapabilityId(capabilityId)) {
      return context.json({ error: "invalid_capability_id" }, 400);
    }

    const body = (await context.req.json().catch(() => ({}))) as {
      profile?: unknown;
      payload?: unknown;
      policy?: unknown;
    };
    const job = await assetGenerationFacade.submit({
      profile: parseRuntimeProfile(body.profile),
      capabilityId,
      payload: body.payload,
      ...(isRecord(body.policy) ? { policy: body.policy as AssetGenerationJobPolicyInput } : {}),
    });

    return context.json(job, 201);
  });

  app.get(routeById("read-internal-capability-job").path, async (context) => {
    const capabilityId = context.req.param("capabilityId");
    if (!isAssetGenerationCapabilityId(capabilityId)) {
      return context.json({ error: "invalid_capability_id" }, 400);
    }

    const jobId = context.req.param("jobId");
    const job = await assetGenerationFacade.get(jobId);
    if (!job || job.request.capabilityId !== capabilityId) {
      return context.json({ error: "job_not_found" }, 404);
    }

    return context.json(job);
  });

}
