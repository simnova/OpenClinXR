import type { Hono } from "hono";
import { parseBearerAuthorization, verifyAuthToken } from "@openclinxr/auth";
import { recordApiRouteSpan } from "./api-support.js";
import type { ApiAppContext } from "./api-app-context.js";
import type { ApiAppVariables } from "./api-types.js";

/**
 * Core middleware phase: CORS preflight, bearer/dev-identity auth, and per-route telemetry spans.
 *
 * Ordering matters — CORS answers OPTIONS before auth can reject it, and the telemetry span wraps
 * the handler so failures are still recorded.
 */
export function registerCoreMiddleware(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  const { telemetry } = ctx;
  const { allowDevDefaultIdentity, secret: authSecret, defaultIdentity } = ctx.auth;

  app.use("*", async (context, next) => {
    context.header("access-control-allow-origin", "*");
    context.header("access-control-allow-methods", "GET,POST,OPTIONS");
    context.header("access-control-allow-headers", "content-type, authorization");
    if (context.req.method === "OPTIONS") {
      return context.body(null, 204);
    }
    return next();
  });

  app.use("*", async (context, next) => {
    if (context.req.method === "OPTIONS") {
      return next();
    }

    const bearer = parseBearerAuthorization(context.req.header("authorization"));
    if (bearer) {
      const verified = verifyAuthToken({ token: bearer, secret: authSecret });
      if (!verified.ok) {
        return context.json({ error: "unauthorized", reason: verified.error }, 401);
      }
      context.set("identity", verified.identity);
      return next();
    }

    if (!allowDevDefaultIdentity) {
      return context.json({ error: "unauthorized", reason: "missing_token" }, 401);
    }

    context.set("identity", defaultIdentity);
    return next();
  });

  app.use("*", async (context, next) => {
    const started = performance.now();
    let errorType: string | undefined;

    try {
      await next();
    } catch (error) {
      errorType = error instanceof Error ? error.name : "unknown";
      throw error;
    } finally {
      await recordApiRouteSpan(telemetry, {
        method: context.req.method,
        url: context.req.url,
        statusCode: context.res.status,
        durationMs: Number((performance.now() - started).toFixed(2)),
        ...(errorType ? { errorType } : {}),
      });
    }
  });

}
