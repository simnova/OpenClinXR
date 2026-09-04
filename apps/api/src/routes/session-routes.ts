import type { Hono } from "hono";
import { resolveSessionLearnerId } from "@openclinxr/auth";
import { routeById } from "@openclinxr/rest";
import {
  createDefaultScenarioRuntime,
  type AssembledStationContext,
  type ScenarioCatalogPort,
  type ScenarioRuntime,
  resolveScenarioById,
} from "@openclinxr/scenario-runtime";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables, ApiAssembledStationContext, ApiStartSessionRequest } from "../api-types.js";
import { persistTraceSnapshot } from "../api-route-support.js";
import { asRealTelemetryRecorder } from "../api-support.js";
import { createScenarioRuntimeDurableStoreFromApiPersistence } from "../runtime-durable-store.js";

export function resolveSessionRuntime(ctx: ApiAppContext, stationRunId: string): ScenarioRuntime {
  return ctx.perSessionRuntime.get(stationRunId) ?? ctx.runtime;
}

export function registerSessionRoutes(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  app.post(routeById("start-session").path, (context) => handleStartStationSession(context, ctx));
}

export async function handleStartStationSession(
  context: { req: { json: () => Promise<unknown> }; get: (key: "identity") => unknown; json: (body: unknown, status?: 201 | 400 | 404) => Response },
  ctx: ApiAppContext,
): Promise<Response> {
  const { runtime, persistence, telemetry, sessionOwners } = ctx;
  const body = (await context.req.json().catch(() => ({}))) as ApiStartSessionRequest;
  if (body.consentAccepted !== true) {
    asRealTelemetryRecorder(telemetry)?.incrementRun("failed");
    return context.json({ error: "consent_required" }, 400);
  }
  const identity = context.get("identity") as Parameters<typeof resolveSessionLearnerId>[0];
  const learnerId = resolveSessionLearnerId(identity, body.learnerId);
  if (learnerId.trim().length === 0) {
    asRealTelemetryRecorder(telemetry)?.incrementRun("failed");
    return context.json({ error: "learner_id_required" }, 400);
  }

  const assembledParse = parseAssembledStationContext(body.assembledStation);
  if (assembledParse.status === "invalid") {
    asRealTelemetryRecorder(telemetry)?.incrementRun("failed");
    return context.json({ error: assembledParse.error }, 400);
  }
  const assembledStation = assembledParse.status === "ok" ? assembledParse.context : undefined;
  if (body.scenarioId && assembledStation && body.scenarioId !== assembledStation.scenarioId) {
    asRealTelemetryRecorder(telemetry)?.incrementRun("failed");
    return context.json({ error: "assembled_station_scenario_mismatch" }, 400);
  }

  const scenarioId = body.scenarioId ?? assembledStation?.scenarioId;
  let sessionRuntime: ScenarioRuntime = runtime;
  if (scenarioId) {
    const port: ScenarioCatalogPort = {};
    if (persistence.getAuthoredScenario) {
      port.getAuthoredScenario = persistence.getAuthoredScenario.bind(persistence);
    }
    const entry = await resolveScenarioById(scenarioId, port);
    if (!entry) {
      return context.json({ error: "scenario_not_found", scenarioId }, 404);
    }
    sessionRuntime = createDefaultScenarioRuntime({
      scenario: entry.scenario,
      durableStore: createScenarioRuntimeDurableStoreFromApiPersistence(persistence),
    });
  }

  try {
    const run = await sessionRuntime.startSession({
      learnerId,
      consentAccepted: true,
      ...(assembledStation ? { assembledStation } : {}),
    });
    sessionOwners.set(run.stationRunId, learnerId);
    if (sessionRuntime !== runtime) {
      ctx.perSessionRuntime.set(run.stationRunId, sessionRuntime);
    }
    await persistTraceSnapshot(sessionRuntime, persistence, run.stationRunId);
    asRealTelemetryRecorder(telemetry)?.incrementRun("started");
    return context.json({ ...run, scenarioId: run.scenarioId }, 201);
  } catch (error) {
    asRealTelemetryRecorder(telemetry)?.incrementRun("failed");
    const mapped = mapAssembledSessionError(error);
    if (mapped) {
      return context.json({ error: mapped }, 400);
    }
    throw error;
  }
}

function parseAssembledStationContext(
  value: ApiAssembledStationContext | undefined,
): { status: "absent" } | { status: "ok"; context: AssembledStationContext } | { status: "invalid"; error: string } {
  if (value === undefined) {
    return { status: "absent" };
  }
  if (typeof value !== "object" || value === null) {
    return { status: "invalid", error: "incomplete_assembled_station_context" };
  }
  const examRunId = typeof value.examRunId === "string" ? value.examRunId.trim() : "";
  const scenarioId = typeof value.scenarioId === "string" ? value.scenarioId.trim() : "";
  const stationOrder = value.stationOrder;
  const timing = value.formTiming;
  if (!examRunId || !scenarioId || !timing || !isWindow(timing.encounter) || !isWindow(timing.note)) {
    return { status: "invalid", error: "incomplete_assembled_station_context" };
  }
  if (timing.doorway !== undefined && !isWindow(timing.doorway)) {
    return { status: "invalid", error: "incomplete_assembled_station_context" };
  }
  if (!Number.isInteger(stationOrder) || stationOrder < 1) {
    return { status: "invalid", error: "assembled_station_order_invalid" };
  }
  const context: AssembledStationContext = {
    examRunId,
    scenarioId,
    stationOrder,
    formTiming: {
      encounter: timing.encounter,
      note: timing.note,
    },
  };
  if (timing.doorway) {
    context.formTiming.doorway = timing.doorway;
  }
  return { status: "ok", context };
}

function isWindow(value: unknown): value is { startsAtSecond: number; endsAtSecond: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { startsAtSecond?: unknown; endsAtSecond?: unknown };
  return Number.isInteger(record.startsAtSecond)
    && Number.isInteger(record.endsAtSecond)
    && (record.startsAtSecond as number) >= 0
    && (record.endsAtSecond as number) >= (record.startsAtSecond as number);
}

function mapAssembledSessionError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  if (error.message.startsWith("incomplete assembled-station context")) {
    return "incomplete_assembled_station_context";
  }
  if (error.message.startsWith("assembled-station order must be a positive integer")) {
    return "assembled_station_order_invalid";
  }
  if (error.message.startsWith("assembled-station scenario mismatch")) {
    return "assembled_station_scenario_mismatch";
  }
  return null;
}
