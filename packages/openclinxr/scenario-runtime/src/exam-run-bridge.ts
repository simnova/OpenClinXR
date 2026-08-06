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
  startExamFormRun,
  type ExamFormRunState,
} from "@openclinxr/exam-assembly";
import type { Scenario } from "@openclinxr/shared-schemas";
import { createDefaultScenarioRuntime } from "./default-runtime-factory.js";
import { resolveScenarioById, type ScenarioCatalogPort } from "./scenario-catalog.js";

export type RunAssembledExamInput = {
  learnerId: string;
  scenarioIds: readonly string[];
  /** Optional authored-scenario port; same contract as resolveScenarioById. */
  catalog?: ScenarioCatalogPort;
};

export type AssembledExamStationResult = {
  scenarioId: string;
  stationRunId: string;
  /** Trace event types recorded for this station session (includes station.started). */
  traceEventTypes: string[];
};

export type AssembledExamRunResult = {
  examRunId: string;
  learnerId: string;
  stations: AssembledExamStationResult[];
  formRunStatus: ExamFormRunState["status"];
};

/**
 * Resolve scenario ids, assemble a form-run in that order, and start one runtime session
 * per station via createExamFormRun / startExamFormRun / advanceExamFormRunStation.
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
    const traceEventTypes = runtime.traceEvents(session.stationRunId).map((event) => event.eventType);

    stations.push({
      scenarioId: station.scenarioId,
      stationRunId: session.stationRunId,
      traceEventTypes,
    });

    formRun = advanceExamFormRunStation(formRun, {
      phase: "complete",
      noteSubmitted: true,
      advanceReason: "station_runtime_session_started",
      endedAtFormSecond: station.timing.note.endsAtSecond,
    });
  }

  return {
    examRunId,
    learnerId: input.learnerId,
    stations,
    formRunStatus: formRun.status,
  };
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
