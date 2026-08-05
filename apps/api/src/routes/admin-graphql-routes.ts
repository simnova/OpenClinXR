import type { Hono } from "hono";
import { hasFacultyAccess } from "@openclinxr/auth";
import { adminGraphqlDocuments, createGraphqlCodegenPlan, executeAdminGraphql, openClinXrAdminSchemaSdl } from "@openclinxr/graphql";
import { routeById } from "@openclinxr/rest";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables } from "../api-types.js";
import { createAdminGraphqlRoot, isFacultyOnlyGraphqlOperation, recordGraphqlOperationSpan } from "../api-route-support.js";
import { isRecord } from "../api-support.js";

/** AdminGraphql domain routes (composition-root migration). */
export function registerAdminGraphqlRoutes(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  const { runtime, persistence, telemetry, adminScenarioOverrides } = ctx;

  app.get(routeById("admin-graphql-schema").path, () =>
    new Response(openClinXrAdminSchemaSdl, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  );

  app.get(routeById("admin-graphql-codegen-plan").path, (context) => context.json(createGraphqlCodegenPlan()));

  app.get(routeById("admin-graphql-documents").path, (context) => context.json(adminGraphqlDocuments));

  app.post(routeById("admin-graphql-execute").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      query?: unknown;
      variables?: unknown;
      operationName?: unknown;
    };
    const graphqlOperationName = typeof body.operationName === "string" && body.operationName.length > 0 ? body.operationName : "anonymous";
    const graphqlStarted = performance.now();

    if (typeof body.query !== "string" || body.query.length === 0) {
      await recordGraphqlOperationSpan(telemetry, {
        operationName: graphqlOperationName,
        statusCode: 400,
        durationMs: Number((performance.now() - graphqlStarted).toFixed(2)),
        hasErrors: true,
      });
      return context.json({ errors: [{ message: "query_required" }] }, 400);
    }

    if (isFacultyOnlyGraphqlOperation(graphqlOperationName, body.query) && !hasFacultyAccess(context.get("identity"))) {
      await recordGraphqlOperationSpan(telemetry, {
        operationName: graphqlOperationName,
        statusCode: 403,
        durationMs: Number((performance.now() - graphqlStarted).toFixed(2)),
        hasErrors: true,
      });
      return context.json({ error: "forbidden", reason: "faculty_role_required" }, 403);
    }

    const result = await executeAdminGraphql(
      {
        query: body.query,
        ...(isRecord(body.variables) ? { variables: body.variables } : {}),
        ...(graphqlOperationName !== "anonymous" ? { operationName: graphqlOperationName } : {}),
      },
      createAdminGraphqlRoot(runtime, persistence, adminScenarioOverrides, {
        ...(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord ? { runtimeRealismEvidenceInputReviewDecisionRecord: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord } : {}),
        ...(ctx.state.runtimeVisualEvidenceAttachmentRecord ? { runtimeVisualEvidenceAttachmentRecord: ctx.state.runtimeVisualEvidenceAttachmentRecord } : {}),
      }),
    );
    await recordGraphqlOperationSpan(telemetry, {
      operationName: graphqlOperationName,
      statusCode: 200,
      durationMs: Number((performance.now() - graphqlStarted).toFixed(2)),
      hasErrors: Boolean(result.errors?.length),
    });

    return context.json(result);
  });

}
