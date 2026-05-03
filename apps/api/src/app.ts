import { createStationRun, transitionStation, type StationRun } from "@openclinxr/domain";
import { buildReviewPacket } from "@openclinxr/review-workflow";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import type { ProviderHealth, TraceEvent } from "@openclinxr/shared-schemas";
import { InMemoryTraceLedger } from "@openclinxr/trace-ledger";
import { Hono } from "hono";

type SessionRecord = {
  run: StationRun;
  nextSequence: number;
};

const providerHealth = {
  model: { providerId: "mock-model", status: "ready" },
  voice: { providerId: "mock-voice", status: "ready" },
  localModel: { providerId: "local-model", status: "not_configured" },
  localVoice: { providerId: "local-voice", status: "not_configured" },
} satisfies Record<string, ProviderHealth>;

function occurredAt(atSecond: number): string {
  return new Date(Date.parse("2026-05-03T15:38:58.000Z") + atSecond * 1000).toISOString();
}

function traceEvent(input: {
  stationRunId: string;
  sequence: number;
  eventType: string;
  atSecond: number;
  source: string;
  tag?: string;
  actorId?: string;
}): TraceEvent {
  const event: TraceEvent = {
    stationRunId: input.stationRunId,
    sequence: input.sequence,
    eventType: input.eventType,
    occurredAt: occurredAt(input.atSecond),
    atSecond: input.atSecond,
    source: input.source,
    payload: {},
  };

  if (input.tag) {
    event.tag = input.tag;
  }
  if (input.actorId) {
    event.actorId = input.actorId;
  }

  return event;
}

export function createApiApp(): Hono {
  const app = new Hono();
  const sessions = new Map<string, SessionRecord>();
  const ledger = new InMemoryTraceLedger();

  app.get("/health", (context) =>
    context.json({
      ok: true,
      service: "openclinxr-api",
      providerHealth,
    }),
  );

  app.get("/providers/health", (context) => context.json(providerHealth));

  app.get("/scenarios/ed-chest-pain", (context) => context.json(edChestPainScenario));

  app.post("/sessions", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { learnerId?: string };
    let run = createStationRun(edChestPainScenario.scenarioId, body.learnerId ?? "learner_001");
    ledger.append(traceEvent({ stationRunId: run.stationRunId, sequence: 0, eventType: "station.started", atSecond: 0, source: "system" }));
    run = transitionStation(run, { type: "START_ENCOUNTER", atSecond: 60 });
    ledger.append(traceEvent({ stationRunId: run.stationRunId, sequence: 1, eventType: "encounter.started", atSecond: 60, source: "system" }));
    sessions.set(run.stationRunId, { run, nextSequence: 2 });

    return context.json({ stationRunId: run.stationRunId, phase: run.phase }, 201);
  });

  app.post("/sessions/:stationRunId/events", async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const session = sessions.get(stationRunId);
    if (!session) {
      return context.json({ error: "session_not_found" }, 404);
    }

    const body = (await context.req.json().catch(() => ({}))) as {
      eventType?: string;
      atSecond?: number;
      tag?: string;
      actorId?: string;
    };

    const eventInput: {
      stationRunId: string;
      sequence: number;
      eventType: string;
      atSecond: number;
      source: string;
      tag?: string;
      actorId?: string;
    } = {
      stationRunId,
      sequence: session.nextSequence,
      eventType: body.eventType ?? "learner.action",
      atSecond: body.atSecond ?? 0,
      source: "learner",
    };
    if (body.tag) {
      eventInput.tag = body.tag;
    }
    if (body.actorId) {
      eventInput.actorId = body.actorId;
    }

    const event = traceEvent(eventInput);

    ledger.append(event);
    session.nextSequence += 1;
    return context.json(event, 201);
  });

  app.post("/sessions/:stationRunId/note", async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const session = sessions.get(stationRunId);
    if (!session) {
      return context.json({ error: "session_not_found" }, 404);
    }

    const body = (await context.req.json().catch(() => ({}))) as { atSecond?: number; text?: string };
    if (session.run.phase === "encounter") {
      session.run = transitionStation(session.run, { type: "END_ENCOUNTER", atSecond: 960 });
    }
    session.run = transitionStation(session.run, {
      type: "SUBMIT_NOTE",
      atSecond: body.atSecond ?? 1260,
      noteText: body.text ?? "",
    });

    const event = traceEvent({
      stationRunId,
      sequence: session.nextSequence,
      eventType: "note.submitted",
      atSecond: body.atSecond ?? 1260,
      source: "learner",
      tag: "patient_note_submitted",
    });
    ledger.append(event);
    session.nextSequence += 1;

    return context.json({ phase: session.run.phase, note: session.run.note });
  });

  app.get("/sessions/:stationRunId/review-packet", (context) => {
    const stationRunId = context.req.param("stationRunId");
    const session = sessions.get(stationRunId);
    if (!session) {
      return context.json({ error: "session_not_found" }, 404);
    }

    const packet = buildReviewPacket({
      stationRunId,
      scenarioId: edChestPainScenario.scenarioId,
      requiredTraceTags: edChestPainScenario.requiredTraceTags,
      traceEvents: ledger.replay(stationRunId),
      facultyScoreDraft: {
        reviewerId: "faculty_001",
        status: "draft",
        comments: "Generated from local in-memory API trace.",
      },
    });

    return context.json(packet);
  });

  return app;
}
