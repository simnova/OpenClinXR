import type { Hono } from "hono";
import { routeById } from "@openclinxr/rest";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables } from "../api-types.js";
import { parseActorInteractionSource, persistTraceSnapshot, sessionErrorResponse } from "../api-route-support.js";
import { asRealTelemetryRecorder, parseStringArray } from "../api-support.js";
import { resolveSessionRuntime } from "./session-routes.js";

/** EncounterSession domain routes (composition-root migration). */
export function registerEncounterSessionRoutes(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  const { persistence, telemetry } = ctx;

  app.post(routeById("start-encounter").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as { atSecond?: number };
    const sessionRuntime = resolveSessionRuntime(ctx, stationRunId);

    try {
      const summary = sessionRuntime.startEncounter(stationRunId, { atSecond: body.atSecond ?? 60 });
      await persistTraceSnapshot(sessionRuntime, persistence, stationRunId);
      asRealTelemetryRecorder(telemetry)?.incrementEncounter("started");
      return context.json(summary);
    } catch (error) {
      asRealTelemetryRecorder(telemetry)?.incrementEncounter("failed");
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("append-trace-event").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      eventType?: string;
      atSecond?: number;
      tag?: string;
      actorId?: string;
    };
    const sessionRuntime = resolveSessionRuntime(ctx, stationRunId);

    try {
      const event = sessionRuntime.appendLearnerEvent(stationRunId, {
        eventType: body.eventType ?? "learner.action",
        atSecond: body.atSecond ?? 0,
        ...(body.tag ? { tag: body.tag } : {}),
        ...(body.actorId ? { actorId: body.actorId } : {}),
      });
      await persistTraceSnapshot(sessionRuntime, persistence, stationRunId);
      return context.json(event, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("record-clinical-action").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      atSecond?: unknown;
      actorId?: unknown;
      traceTag?: unknown;
      actionType?: unknown;
      label?: unknown;
    };
    const sessionRuntime = resolveSessionRuntime(ctx, stationRunId);

    try {
      const event = sessionRuntime.recordClinicalAction(stationRunId, {
        atSecond: typeof body.atSecond === "number" ? body.atSecond : 0,
        actorId: typeof body.actorId === "string" ? body.actorId : "",
        traceTag: typeof body.traceTag === "string" ? body.traceTag : "clinical_action",
        actionType: body.actionType === "finding_observed" ? "finding_observed" : "order_requested",
        label: typeof body.label === "string" ? body.label : "Clinical action",
      });
      await persistTraceSnapshot(sessionRuntime, persistence, stationRunId);
      return context.json(event, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("actor-interaction-route").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      learnerUtterance?: unknown;
      atSecond?: unknown;
      traceContextTags?: unknown;
      source?: unknown;
    };
    const source = parseActorInteractionSource(body.source);
    const sessionRuntime = resolveSessionRuntime(ctx, stationRunId);

    try {
      const result = sessionRuntime.routeActorInteractionTurn(stationRunId, {
        learnerUtterance: typeof body.learnerUtterance === "string" ? body.learnerUtterance : "",
        atSecond: typeof body.atSecond === "number" ? body.atSecond : 0,
        traceContextTags: parseStringArray(body.traceContextTags),
        ...(source ? { source } : {}),
      });
      await persistTraceSnapshot(sessionRuntime, persistence, stationRunId);
      return context.json({
        routedActorId: result.routedActorId,
        routingReason: result.routingReason,
        conversationTurn: result.conversationTurn,
        interactionEvent: result.interactionEvent,
      }, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("actor-response").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      actorId?: unknown;
      learnerUtterance?: unknown;
      atSecond?: unknown;
      traceContextTags?: unknown;
      source?: unknown;
    };
    const learnerUtterance = typeof body.learnerUtterance === "string" ? body.learnerUtterance : "";
    const atSecond = typeof body.atSecond === "number" ? body.atSecond : 0;
    const traceContextTags = parseStringArray(body.traceContextTags);
    const actorId = typeof body.actorId === "string" ? body.actorId.trim() : "";
    const source = parseActorInteractionSource(body.source);
    const sessionRuntime = resolveSessionRuntime(ctx, stationRunId);

    try {
      const result = actorId.length > 0
        ? await sessionRuntime.generateActorResponse(stationRunId, {
            actorId,
            learnerUtterance,
            atSecond,
            traceContextTags,
          })
        : await sessionRuntime.generateRoutedActorResponse(stationRunId, {
            learnerUtterance,
            atSecond,
            traceContextTags,
            ...(source ? { source } : {}),
          });
      await persistTraceSnapshot(sessionRuntime, persistence, stationRunId);
      return context.json(result, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("voice-synthesis").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      actorId?: string;
      voiceId?: string;
      text?: string;
      atSecond?: number;
    };
    const sessionRuntime = resolveSessionRuntime(ctx, stationRunId);

    try {
      const result = await sessionRuntime.synthesizeActorSpeech(stationRunId, {
        actorId: body.actorId ?? "",
        voiceId: body.voiceId ?? "",
        text: body.text ?? "",
        atSecond: body.atSecond ?? 0,
      });
      await persistTraceSnapshot(sessionRuntime, persistence, stationRunId);
      return context.json(result, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("submit-note").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as { atSecond?: number; text?: string };
    const sessionRuntime = resolveSessionRuntime(ctx, stationRunId);

    try {
      const result = sessionRuntime.submitNote(stationRunId, {
        atSecond: body.atSecond ?? 1260,
        text: body.text ?? "",
      });
      await persistTraceSnapshot(sessionRuntime, persistence, stationRunId);
      return context.json(result);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

}
