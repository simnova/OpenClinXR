import { createStationRun, transitionStation } from "@openclinxr/domain";
import { createDefaultModelGateway, LocalModelProviderAdapter, MockModelProviderAdapter } from "@openclinxr/model-gateway";
import { buildReviewPacket } from "@openclinxr/review-workflow";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import type { ProviderHealth, ReviewPacket, TraceEvent } from "@openclinxr/shared-schemas";
import { InMemoryTraceLedger } from "@openclinxr/trace-ledger";
import { createDefaultVoiceGateway, LocalVoiceProviderAdapter, MockVoiceProviderAdapter } from "@openclinxr/voice-gateway";

export type SimulationResult = {
  stationRunId: string;
  eventCount: number;
  reviewPacket: ReviewPacket;
  providerHealth: {
    model: ProviderHealth;
    voice: ProviderHealth;
    localModel: ProviderHealth;
    localVoice: ProviderHealth;
  };
};

const baseTime = Date.parse("2026-05-03T15:38:58.000Z");

function occurredAt(atSecond: number): string {
  return new Date(baseTime + atSecond * 1000).toISOString();
}

function event(
  stationRunId: string,
  sequence: number,
  eventType: string,
  atSecond: number,
  source: string,
  tag?: string,
  actorId?: string,
): TraceEvent {
  const trace: TraceEvent = {
    stationRunId,
    sequence,
    eventType,
    occurredAt: occurredAt(atSecond),
    atSecond,
    source,
    payload: {},
  };

  if (tag) {
    trace.tag = tag;
  }
  if (actorId) {
    trace.actorId = actorId;
  }

  return trace;
}

export async function runEdChestPainSimulation(): Promise<SimulationResult> {
  const ledger = new InMemoryTraceLedger();
  const modelGateway = createDefaultModelGateway({
    routeId: "actor-dialogue-offline-v1",
    adapters: [new MockModelProviderAdapter(), new LocalModelProviderAdapter({ providerId: "local-model" })],
  });
  const voiceGateway = createDefaultVoiceGateway({
    routeId: "voice-offline-v1",
    adapters: [new MockVoiceProviderAdapter(), new LocalVoiceProviderAdapter({ providerId: "local-voice" })],
  });
  let run = createStationRun(edChestPainScenario.scenarioId, "learner_001");
  let sequence = 0;

  ledger.append(event(run.stationRunId, sequence++, "station.started", 0, "system"));
  run = transitionStation(run, { type: "START_ENCOUNTER", atSecond: 60 });
  ledger.append(event(run.stationRunId, sequence++, "encounter.started", 60, "system"));

  const traceTags: Array<[number, string, string, string | undefined]> = [
    [110, "learner.history", "history_opqrst", "patient_robert_hayes_v1"],
    [180, "learner.history", "risk_factor_question", "patient_robert_hayes_v1"],
    [240, "learner.history", "associated_symptom_question", "patient_robert_hayes_v1"],
    [420, "nurse.interruption", "vitals_review", "nurse_maria_alvarez_v1"],
    [480, "learner.order", "ecg_request", "nurse_maria_alvarez_v1"],
    [520, "learner.escalation", "urgent_escalation", "nurse_maria_alvarez_v1"],
    [560, "learner.team", "team_communication", "nurse_maria_alvarez_v1"],
    [620, "learner.family", "family_communication", "spouse_anna_hayes_v1"],
    [660, "learner.empathy", "empathy_statement", "patient_robert_hayes_v1"],
  ];

  for (const [atSecond, eventType, tag, actorId] of traceTags) {
    ledger.append(event(run.stationRunId, sequence++, eventType, atSecond, "learner", tag, actorId));
  }

  run = transitionStation(run, { type: "END_ENCOUNTER", atSecond: 960 });
  ledger.append(event(run.stationRunId, sequence++, "encounter.ended", 960, "system"));
  run = transitionStation(run, { type: "SUBMIT_NOTE", atSecond: 1260, noteText: "Concern for ACS. ECG requested. Escalated to senior physician." });
  ledger.append(event(run.stationRunId, sequence++, "note.submitted", 1260, "learner", "patient_note_submitted"));

  const events = ledger.replay(run.stationRunId);
  const reviewPacket = buildReviewPacket({
    stationRunId: run.stationRunId,
    scenarioId: edChestPainScenario.scenarioId,
    requiredTraceTags: edChestPainScenario.requiredTraceTags,
    traceEvents: events,
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: "Deterministic simulation completed all required first-slice behaviors.",
    },
  });
  const [modelHealth, voiceHealth] = await Promise.all([modelGateway.health(), voiceGateway.health()]);

  return {
    stationRunId: run.stationRunId,
    eventCount: events.length,
    reviewPacket,
    providerHealth: {
      model: requireProviderHealth(modelHealth, "mock-model"),
      voice: requireProviderHealth(voiceHealth, "mock-voice"),
      localModel: requireProviderHealth(modelHealth, "local-model"),
      localVoice: requireProviderHealth(voiceHealth, "local-voice"),
    },
  };
}

function requireProviderHealth(health: ProviderHealth[], providerId: string): ProviderHealth {
  const provider = health.find((entry) => entry.providerId === providerId);
  if (!provider) {
    throw new Error(`Missing provider health for ${providerId}`);
  }
  return provider;
}
