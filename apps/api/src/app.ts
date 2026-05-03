import { assembleExamForm, createDefaultClinicalSkillsBlueprint } from "@openclinxr/exam-assembly";
import { createDefaultScenarioRuntime, type ScenarioRuntime } from "@openclinxr/scenario-runtime";
import { createLearnerScenarioView, edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { Hono } from "hono";

export function createApiApp(runtime: ScenarioRuntime = createDefaultScenarioRuntime()): Hono {
  const app = new Hono();

  app.get("/health", async (context) =>
    context.json({
      ok: true,
      service: "openclinxr-api",
      providerHealth: await runtime.providerHealth(),
    }),
  );

  app.get("/providers/health", async (context) => context.json(await runtime.providerHealth()));

  app.get("/scenarios/ed-chest-pain", (context) => context.json(createLearnerScenarioView(edChestPainScenario)));

  app.get("/scenarios/ed-chest-pain/assets/readiness", (context) => context.json(runtime.assetReadiness()));

  app.get("/exam-blueprints/default", (context) => context.json(createDefaultClinicalSkillsBlueprint()));

  app.post("/exam-forms", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { examFormId?: string };
    const form = assembleExamForm({
      examFormId: body.examFormId ?? "form_openclinxr_pilot_001",
      blueprint: createDefaultClinicalSkillsBlueprint(),
      scenarios: [edChestPainScenario],
    });
    return context.json(form, 201);
  });

  app.post("/sessions", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { learnerId?: string };
    const run = await runtime.startSession({ learnerId: body.learnerId ?? "learner_001" });

    return context.json(run, 201);
  });

  app.post("/sessions/:stationRunId/events", async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      eventType?: string;
      atSecond?: number;
      tag?: string;
      actorId?: string;
    };

    try {
      const event = runtime.appendLearnerEvent(stationRunId, {
        eventType: body.eventType ?? "learner.action",
        atSecond: body.atSecond ?? 0,
        ...(body.tag ? { tag: body.tag } : {}),
        ...(body.actorId ? { actorId: body.actorId } : {}),
      });
      return context.json(event, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post("/sessions/:stationRunId/note", async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as { atSecond?: number; text?: string };

    try {
      return context.json(
        runtime.submitNote(stationRunId, {
          atSecond: body.atSecond ?? 1260,
          text: body.text ?? "",
        }),
      );
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.get("/sessions/:stationRunId/review-packet", (context) => {
    const stationRunId = context.req.param("stationRunId");

    try {
      return context.json(runtime.reviewPacket(stationRunId));
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  return app;
}

function sessionErrorResponse(context: { json: (body: { error: string }, status: 404 | 500) => Response }, error: unknown): Response {
  if (error instanceof Error && error.message.startsWith("Session not found")) {
    return context.json({ error: "session_not_found" }, 404);
  }
  return context.json({ error: "runtime_error" }, 500);
}
