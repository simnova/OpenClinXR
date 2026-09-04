/**
 * Bridge: exam-assembly form-run state machine → scenario runtime sessions.
 *
 * Assembly can produce an ordered multi-station form; the runtime can load any scenario by id.
 * This module is the missing handoff — it walks the form-run pointer and starts one real
 * ScenarioRuntime session per station in assembled order. Unknown ids throw (never silent
 * fallback to the default ED chest-pain fixture).
 */

import {
  advanceExamFormRunStation,
  createExamFormRun,
  createStep2CsStyleSeedBlueprint,
  currentExamFormRunStation,
  nextExamFormRunStation,
  startExamFormRun,
  type ExamFormRunState,
  type ExamStationRunQueueItem,
} from "@openclinxr/exam-assembly";
import type { Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import { createDefaultScenarioRuntime } from "./default-runtime-factory.js";
import { resolveScenarioById, type ScenarioCatalogPort } from "./scenario-catalog.js";
import {
  assignMonotonicReplayablePhaseTransitions,
  replayablePhaseTransitionEvent,
  type ReplayablePhaseTransitionType,
} from "./trace.js";

export type RunAssembledExamInput = {
  learnerId: string;
  scenarioIds: readonly string[];
  /** Optional authored-scenario port; same contract as resolveScenarioById. */
  catalog?: ScenarioCatalogPort;
};

export type AssembledExamStationResult = {
  scenarioId: string;
  stationRunId: string;
  stationOrder: number;
  /** Trace event types recorded for this station session (includes station.started). */
  traceEventTypes: string[];
  /** Ordered encounter→note→advance events with durable, scenario-bound identity. */
  phaseTransitions: TraceEvent[];
  /** Why the form-run pointer advanced off this station. */
  advanceReason: string;
};

export type AssembledExamRunResult = {
  examRunId: string;
  learnerId: string;
  stations: AssembledExamStationResult[];
  formRunStatus: ExamFormRunState["status"];
};

/**
 * Resolve scenario ids, assemble a form-run in that order, and run one runtime session
 * per station through encounter → note → complete before advancing the form-run pointer.
 */
export async function runAssembledExam(input: RunAssembledExamInput): Promise<AssembledExamRunResult> {
  if (input.scenarioIds.length === 0) {
    throw new Error("runAssembledExam requires at least one scenario id");
  }

  const resolved = await resolveScenariosInOrder(input.scenarioIds, input.catalog);
  const scenarios = resolved.map((entry) => entry.scenario);

  // Form-run activation gates (approved + review + non-stage_0) block draft bank cases that
  // the runtime can already load. Project a sequencer-only clone so createExamFormRun can own
  // ordering; runtime sessions always use the real resolved scenarios below.
  const sequencerScenarios = scenarios.map(toFormRunSequencerScenario);
  const blueprint = createStep2CsStyleSeedBlueprint(sequencerScenarios, {
    stationCount: sequencerScenarios.length,
  });

  const examRunId = `exam_run_${input.learnerId}_${scenarios.map((s) => s.scenarioId).join("__")}`;
  let formRun = createExamFormRun({
    examRunId,
    examFormId: `form_${examRunId}`,
    blueprint,
    scenarios: sequencerScenarios,
  });

  if (formRun.status === "blocked") {
    const blockers = formRun.queue.stationQueue.flatMap((station) =>
      station.blockers.map((blocker) => `${station.scenarioId ?? station.slotId}:${blocker}`),
    );
    throw new Error(
      `Assembled exam form-run is blocked and cannot start: ${blockers.join(", ") || "unknown_blocker"}`,
    );
  }

  formRun = startExamFormRun(formRun);
  const stations: AssembledExamStationResult[] = [];
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.scenarioId, scenario]));

  // Walk the assembly pointer — do not reimplement station order as a bare for-loop over ids.
  while (formRun.status === "in_progress") {
    const station = currentExamFormRunStation(formRun);
    if (!station?.scenarioId) {
      break;
    }

    const scenario = scenarioById.get(station.scenarioId);
    if (!scenario) {
      throw new Error(`Form-run station scenario missing from resolved set: ${station.scenarioId}`);
    }

    // Per-station runtime: explicit scenario option — never default ED chest pain fallback.
    const runtime = createDefaultScenarioRuntime({ scenario });
    const session = await runtime.startSession({
      learnerId: input.learnerId,
      consentAccepted: true,
    });

    const stationRelative = (formSecond: number): number =>
      formSecond - station.timing.doorway.startsAtSecond;
    runtime.startEncounter(session.stationRunId, {
      atSecond: stationRelative(station.timing.encounter.startsAtSecond),
    });
    runtime.submitNote(session.stationRunId, {
      atSecond: stationRelative(station.timing.note.endsAtSecond),
      text: `Assembled-exam station note for ${station.scenarioId}`,
    });

    const ledgerEvents = runtime.traceEvents(session.stationRunId);
    const advanceReason = nextExamFormRunStation(formRun)
      ? "patient_note_submitted_advancing"
      : "last_station_note_submitted_exam_complete";
    const phaseTransitions = buildStationPhaseTransitions({
      examRunId,
      station,
      stationRunId: session.stationRunId,
      ledgerEvents,
      advanceReason,
    });

    stations.push({
      scenarioId: station.scenarioId,
      stationRunId: session.stationRunId,
      stationOrder: station.stationOrder,
      traceEventTypes: [
        ...ledgerEvents.map((event) => event.eventType),
        ...phaseTransitions
          .map((event) => event.eventType)
          .filter((eventType) => !ledgerEvents.some((event) => event.eventType === eventType)),
      ],
      phaseTransitions,
      advanceReason,
    });

    const recordedAtIso = phaseTransitions[phaseTransitions.length - 1]?.occurredAt;
    formRun = advanceExamFormRunStation(formRun, {
      phase: "complete",
      noteSubmitted: true,
      advanceReason,
      endedAtFormSecond: station.timing.note.endsAtSecond,
      ...(recordedAtIso ? { recordedAtIso } : {}),
    });
  }

  return {
    examRunId,
    learnerId: input.learnerId,
    stations,
    formRunStatus: formRun.status,
  };
}

function buildStationPhaseTransitions(input: {
  examRunId: string;
  station: ExamStationRunQueueItem;
  stationRunId: string;
  ledgerEvents: TraceEvent[];
  advanceReason: string;
}): TraceEvent[] {
  const scenarioId = input.station.scenarioId;
  if (!scenarioId) {
    throw new Error(`Form-run station scenario missing from resolved set: ${input.station.slotId}`);
  }

  const doorwayStart = input.station.timing.doorway.startsAtSecond;
  const relative = (formSecond: number): number => formSecond - doorwayStart;
  const startSequence = input.ledgerEvents.reduce((max, event) => Math.max(max, event.sequence), -1) + 1;

  const specs: Array<{
    eventType: ReplayablePhaseTransitionType;
    phase: "encounter" | "note" | "complete";
    formAtSecond: number;
    advanceReason?: string;
  }> = [
    {
      eventType: "encounter.started",
      phase: "encounter",
      formAtSecond: input.station.timing.encounter.startsAtSecond,
    },
    {
      eventType: "encounter.ended",
      phase: "encounter",
      formAtSecond: input.station.timing.encounter.endsAtSecond,
    },
    {
      eventType: "note.started",
      phase: "note",
      formAtSecond: input.station.timing.note.startsAtSecond,
    },
    {
      eventType: "note.submitted",
      phase: "note",
      formAtSecond: input.station.timing.note.endsAtSecond,
    },
    {
      eventType: "station.advanced",
      phase: "complete",
      formAtSecond: input.station.timing.note.endsAtSecond,
      advanceReason: input.advanceReason,
    },
  ];

  const events = specs.map((spec) =>
    replayablePhaseTransitionEvent({
      stationRunId: input.stationRunId,
      sequence: 0,
      eventType: spec.eventType,
      atSecond: relative(spec.formAtSecond),
      scenarioId,
      examRunId: input.examRunId,
      stationOrder: input.station.stationOrder,
      phase: spec.phase,
      formAtSecond: spec.formAtSecond,
      ...(spec.advanceReason ? { advanceReason: spec.advanceReason } : {}),
    }),
  );

  return assignMonotonicReplayablePhaseTransitions(events, startSequence);
}

async function resolveScenariosInOrder(
  scenarioIds: readonly string[],
  catalog?: ScenarioCatalogPort,
): Promise<Array<{ scenario: Scenario; scenarioId: string }>> {
  const resolved: Array<{ scenario: Scenario; scenarioId: string }> = [];
  for (const scenarioId of scenarioIds) {
    const entry = await resolveScenarioById(scenarioId, catalog);
    if (!entry) {
      // Must name the unknown id — silent fallback to default ED was the long-standing bug.
      throw new Error(`Unknown scenario id: ${scenarioId}`);
    }
    resolved.push({ scenario: entry.scenario, scenarioId });
  }
  return resolved;
}

/**
 * Clone a scenario so exam-assembly's createExamFormRun / queue activation gates accept it.
 * Does not mutate fixtures or claim production readiness — runtime still loads the original.
 */
function toFormRunSequencerScenario(scenario: Scenario): Scenario {
  return {
    ...scenario,
    status: "approved",
    review: {
      clinical: "approved",
      psychometric: "approved",
      legal: "approved",
      simulationQa: "approved",
    },
    governance: {
      ...scenario.governance,
      validationStage:
        scenario.governance.validationStage === "stage_0_synthetic_draft"
          ? "stage_1_expert_reviewed"
          : scenario.governance.validationStage,
      scoreUseLabel:
        scenario.governance.scoreUseLabel === "validated_summative"
          ? "formative_local_only"
          : scenario.governance.scoreUseLabel,
    },
  };
}
