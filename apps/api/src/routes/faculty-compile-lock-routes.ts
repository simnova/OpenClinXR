import type { Hono } from "hono";
import { hasFacultyAccess } from "@openclinxr/auth";
import { routeById } from "@openclinxr/rest";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables, ApiFacultyCompileLockRecord } from "../api-types.js";
import {
  FACULTY_COMPILE_LOCK_OVERRIDE_PATHS,
  writeFacultyCompileLock,
} from "../faculty-compile-lock-store.js";

/**
 * Faculty compile-lock persistence route (WCG persist hole).
 *
 * The admin UI POSTs each lock/override toggle; this route writes the per-scenario
 * `.openclinxr/compile-locks/<scenarioId>.json` the World Compile Graph compile
 * runner reads. Review metadata only — no packet promote, no compileVersion bump.
 */
export function registerFacultyCompileLockRoutes(app: Hono<{ Variables: ApiAppVariables }>, _ctx: ApiAppContext): void {
  app.post(routeById("save-faculty-compile-lock").path, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json({ error: "forbidden", reason: "faculty_role_required" }, 403);
    }

    const body = (await context.req.json().catch(() => ({}))) as {
      scenarioId?: unknown;
      nodeId?: unknown;
      locked?: unknown;
      overridePath?: unknown;
      overrideValue?: unknown;
    };

    const scenarioId = typeof body.scenarioId === "string" && body.scenarioId.trim().length > 0 ? body.scenarioId : undefined;
    const nodeId = typeof body.nodeId === "string" && body.nodeId.trim().length > 0 ? body.nodeId : undefined;
    if (!scenarioId) {
      return context.json({ error: "invalid_body", reason: "scenarioId_required" }, 400);
    }
    if (!nodeId) {
      return context.json({ error: "invalid_body", reason: "nodeId_required" }, 400);
    }
    if (typeof body.locked !== "boolean") {
      return context.json({ error: "invalid_body", reason: "locked_boolean_required" }, 400);
    }
    const overridePath = typeof body.overridePath === "string" ? body.overridePath : undefined;
    if (overridePath !== undefined && !(FACULTY_COMPILE_LOCK_OVERRIDE_PATHS as readonly string[]).includes(overridePath)) {
      return context.json(
        { error: "invalid_override_path", reason: `overridePath must be one of ${FACULTY_COMPILE_LOCK_OVERRIDE_PATHS.join(", ")}` },
        400,
      );
    }

    try {
      const record = await writeFacultyCompileLock(scenarioId, {
        nodeId,
        locked: body.locked,
        ...(overridePath === undefined ? {} : { overridePath }),
        ...(body.overrideValue === undefined ? {} : { overrideValue: body.overrideValue }),
      });
      return context.json(record satisfies ApiFacultyCompileLockRecord);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown_compile_lock_store_error";
      return context.json({ error: "compile_lock_persistence_failed", reason }, 400);
    }
  });
}
