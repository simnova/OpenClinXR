/**
 * Learner exam-form boot path extracted from main.ts (#57).
 *
 * Owns: resolve → assemble → on-page presentation of fixture fallback → boot snapshot markers.
 * Extracted so main.ts can stay under the shrink-only size ratchet (file-size-budgets) and so
 * presentation is unit-testable without importing the DOM-touching main module.
 */

import type { ExamAssemblyPersistenceSink, ExamFormRunState } from "@openclinxr/exam-assembly";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import {
  resolveLearnerExamScenarios,
  type ResolveLearnerExamScenariosResult,
} from "./learner-exam-scenario-source.js";
import {
  createMultiStationExamRuntime,
  persistExamFormRunQueueSnapshot,
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
  if (state && input.persistenceSink) {
    const snapshotOptions: {
      snapshotId: string;
      reviewerId: string;
      scenarioSource?: "fixture_offline" | "fixture_fallback" | "api_queue";
      fallbackActive?: boolean;
      fallbackReason?: string;
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
    } else {
      snapshotOptions.scenarioSource = "fixture_offline";
      snapshotOptions.fallbackActive = false;
    }
    void persistExamFormRunQueueSnapshot(state, input.persistenceSink, snapshotOptions).catch(() => {
      // Best-effort; local form still runs. Marker loss is a residual, not a silent exam.
    });
  }
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
