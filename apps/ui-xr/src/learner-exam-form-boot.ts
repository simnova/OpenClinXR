/**
 * Learner exam-form boot path extracted from main.ts (#57).
 *
 * Owns: resolve → assemble → on-page presentation of fixture fallback → boot snapshot markers.
 * Extracted so main.ts can stay under the shrink-only size ratchet (file-size-budgets) and so
 * presentation is unit-testable without importing the DOM-touching main module.
 */

import type {
  ExamAssemblyPersistenceSink,
  ExamFormRunState,
  ExamStationRunQueueScenarioSource,
  ExamStationRunQueueStationBodySource,
} from "@openclinxr/exam-assembly";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import {
  resolveLearnerExamScenarios,
  type ResolveLearnerExamScenariosResult,
} from "./learner-exam-scenario-source.js";
import {
  applyLearnerPhaseTracePresentation,
  applyLearnerPhaseTraceRefusePresentation,
  hydrateLearnerCanonicalPhaseTraceFromApi,
} from "./learner-phase-trace-source.js";
import {
  createMultiStationExamRuntime,
  persistExamFormRunQueueSnapshot,
  type LearnerCanonicalPhaseTraceStore,
} from "./runtime-state.js";

export type ExamFormBootPresentationSink = {
  textContent: string | null;
};

/**
 * Write a human-readable fixture-fallback label into an on-page sink (e.g. #exam-flow-case-source).
 * Healthy / offline paths leave the sink alone so "always banner" cannot satisfy the contract.
 * Prose only — never a bare enum token.
 */
export function applyExamFormBootPresentation(input: {
  result: unknown;
  sink: ExamFormBootPresentationSink;
}): void {
  if (!isRecord(input.result)) {
    return;
  }
  const result = input.result;
  if (result["fallbackActive"] !== true || result["scenarioSource"] !== "fixture_fallback") {
    return;
  }
  const rawReason = result["fallbackReason"];
  const reason =
    typeof rawReason === "string" && rawReason.length > 0
      ? humanizeFallbackReason(rawReason)
      : "API unreachable";
  input.sink.textContent = `Running on fixture cases (fallback — ${reason})`;
}

/**
 * Shape-drift / contract refuse surface. Does not keep silent fixtures when baseUrl was configured.
 */
export function applyExamFormBootRefusePresentation(input: {
  error: unknown;
  sink: ExamFormBootPresentationSink;
}): void {
  const message =
    input.error instanceof Error && input.error.message.length > 0
      ? input.error.message
      : "queue contract refused";
  input.sink.textContent = `Exam form bootstrap refused: ${message}`;
}

export function createLearnerExamFormRunState(
  runId: string,
  scenarios: ReadonlyArray<{ scenarioId: string; status?: string }>,
  examScenarioId?: string,
): ExamFormRunState | null {
  if (scenarios.length === 0) return null;
  const approved = scenarios.filter((s) => s.status === "approved");
  const scenariosForForm = (approved.length > 0 ? approved : [edChestPainScenario]) as Parameters<
    typeof createMultiStationExamRuntime
  >[0]["scenarios"];
  try {
    const run = createMultiStationExamRuntime({
      examRunId: runId,
      examFormId: `form_${runId}`,
      scenarios: scenariosForForm,
      start: true,
    });
    if (examScenarioId === undefined) {
      return run;
    }
    const index = run.queue.stationQueue.findIndex(
      (station: { scenarioId?: string | null }) => station.scenarioId === examScenarioId,
    );
    return index >= 0 ? { ...run, currentStationIndex: index, examEquivalenceGate: false } : run;
  } catch {
    return null;
  }
}

export type BootLearnerPhaseTraceHydration = {
  getStore: () => LearnerCanonicalPhaseTraceStore;
  setStore: (store: LearnerCanonicalPhaseTraceStore) => void;
  presentationSink: ExamFormBootPresentationSink;
  stationRunId?: string;
};

export type BootLearnerExamFormFromApiInput = {
  baseUrl: string | undefined;
  examRunId: string;
  examScenarioId: string;
  getState: () => ExamFormRunState | null;
  setState: (state: ExamFormRunState | null) => void;
  persistenceSink?: ExamAssemblyPersistenceSink | undefined;
  updateEvidence: () => void;
  /** On-page element (or test sink) for case-source label — required, not optional. */
  presentationSink: ExamFormBootPresentationSink;
  fetch?: typeof fetch;
  blueprintId?: string;
  /** Hydrate canonical phase traces from GET /sessions/:id/trace-events. */
  phaseTrace?: BootLearnerPhaseTraceHydration;
};

/**
 * Boot the learner exam form from the configured API (or leave offline fixture form).
 *
 * - transport failure → labelled fixture_fallback; exam continues
 * - shape drift on 200 → refuse presentation + clear form state (does not swallow #53)
 * - offline (no baseUrl) → no fetch; fixture form already at module scope
 */
export async function bootLearnerExamFormFromApi(input: BootLearnerExamFormFromApiInput): Promise<void> {
  const blueprintId = input.blueprintId ?? "step2cs-seed";
  let resolution: ResolveLearnerExamScenariosResult | null = null;

  if (input.baseUrl) {
    try {
      const resolveInput: Parameters<typeof resolveLearnerExamScenarios>[0] = {
        baseUrl: input.baseUrl,
        blueprintId,
      };
      if (input.fetch !== undefined) {
        resolveInput.fetch = input.fetch;
      }
      resolution = await resolveLearnerExamScenarios(resolveInput);
      applyExamFormBootPresentation({ result: resolution, sink: input.presentationSink });
      const next =
        createLearnerExamFormRunState(input.examRunId, resolution.scenarios, input.examScenarioId)
        ?? input.getState();
      input.setState(next);
      input.updateEvidence();
    } catch (error) {
      // Shape drift / other contract refuse — do not keep pretending the fixture form is authored.
      applyExamFormBootRefusePresentation({ error, sink: input.presentationSink });
      input.setState(null);
      input.updateEvidence();
      return;
    }
  }

  const state = input.getState();
  if (state && input.phaseTrace) {
    try {
      const hydrateInput: Parameters<typeof hydrateLearnerCanonicalPhaseTraceFromApi>[0] = {
        baseUrl: input.baseUrl,
        examRun: state,
        store: input.phaseTrace.getStore(),
      };
      if (input.fetch !== undefined) {
        hydrateInput.fetch = input.fetch;
      }
      if (input.phaseTrace.stationRunId !== undefined) {
        hydrateInput.stationRunId = input.phaseTrace.stationRunId;
      }
      const hydrated = await hydrateLearnerCanonicalPhaseTraceFromApi(hydrateInput);
      input.phaseTrace.setStore(hydrated.store);
      applyLearnerPhaseTracePresentation({
        view: hydrated.view,
        sink: input.phaseTrace.presentationSink,
      });
      input.updateEvidence();
    } catch (error) {
      applyLearnerPhaseTraceRefusePresentation({ error, sink: input.phaseTrace.presentationSink });
      input.updateEvidence();
    }
  }

  if (state && input.persistenceSink) {
    const snapshotOptions: {
      snapshotId: string;
      reviewerId: string;
      scenarioSource?: ExamStationRunQueueScenarioSource;
      fallbackActive?: boolean;
      fallbackReason?: string;
      stationBodySources?: ExamStationRunQueueStationBodySource[];
    } = {
      snapshotId: `queue_snapshot_${input.examRunId}_boot`,
      reviewerId: "ui_xr_learner_runtime",
    };
    if (resolution) {
      snapshotOptions.scenarioSource = resolution.scenarioSource;
      snapshotOptions.fallbackActive = resolution.fallbackActive;
      if (resolution.fallbackReason !== undefined) {
        snapshotOptions.fallbackReason = resolution.fallbackReason;
      }
      // #88 — required wiring: per-record body provenance reaches the boot snapshot (not optional).
      const stationBodySources = stationBodySourcesFromResolution(resolution);
      if (stationBodySources.length > 0) {
        snapshotOptions.stationBodySources = stationBodySources;
      }
    } else {
      snapshotOptions.scenarioSource = "fixture_offline";
      snapshotOptions.fallbackActive = false;
    }
    void persistExamFormRunQueueSnapshot(state, input.persistenceSink, snapshotOptions).catch(() => {
      // Best-effort; local form still runs. Marker loss is a residual, not a silent exam.
    });
  }
}

/** Extract per-station bodySource markers from a resolution result for snapshot persistence (#88). */
export function stationBodySourcesFromResolution(
  resolution: ResolveLearnerExamScenariosResult,
): ExamStationRunQueueStationBodySource[] {
  const out: ExamStationRunQueueStationBodySource[] = [];
  for (const record of resolution.scenarios) {
    if (record.bodySource === "api_authored" || record.bodySource === "bank_residual") {
      out.push({ scenarioId: record.scenarioId, bodySource: record.bodySource });
    }
  }
  return out;
}

function humanizeFallbackReason(reason: string): string {
  // Keep short machine reasons readable; long error messages (GET failed: …) stay as-is.
  if (reason.includes(" ") || reason.includes(":") || reason.includes("/")) {
    return reason;
  }
  return reason.replaceAll("_", " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
