/**
 * Exam-run query wiring — extracted from apps/ui-xr/src/main.ts (shrink-only SIZE_FREEZE).
 *
 * Pure query-string reads and navigation-URL assembly for the multi-station exam
 * run. The composition root keeps the selected values in its module state; every
 * function here takes what it reads as an argument.
 */

export type ExamRunQueryDeps = {
  readQueryParam: (name: string) => string | null;
  readStoredValue: (key: string) => string | null;
  writeStoredValue: (key: string, value: string) => void;
};

export type ExamRunTiming = {
  encounterSeconds: number;
  noteSeconds: number;
  autoAdvanceOnNoteTimeout: boolean;
};

export const DEFAULT_EXAM_SCENARIO_SEQUENCE: readonly string[] = [
  "ed_chest_pain_priority_v1",
  "ob_headache_preeclampsia_triage_v1",
  "clinic_abdominal_pain_interpreter_v1",
  "oncology_bad_news_family_v1",
  "postop_fever_consult_pressure_v1",
];

export function positiveIntegerQueryParam(
  deps: ExamRunQueryDeps,
  name: string,
  fallback: number,
): number {
  const value = Number.parseInt(deps.readQueryParam(name) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function booleanQueryParam(deps: ExamRunQueryDeps, name: string, fallback: boolean): boolean {
  const value = deps.readQueryParam(name);
  if (value === null) return fallback;
  return value !== "0" && value.toLowerCase() !== "false";
}

export function configuredExamSequence(deps: ExamRunQueryDeps): string[] {
  const configured = deps
    .readQueryParam("examSequence")
    ?.split(",")
    .map((scenarioId) => scenarioId.trim())
    .filter((scenarioId) => scenarioId.length > 0);
  if (configured && configured.length > 0) {
    return configured;
  }
  return [...DEFAULT_EXAM_SCENARIO_SEQUENCE];
}

export function configuredExamRunId(
  deps: ExamRunQueryDeps,
  nowMs: number = Date.now(),
): string {
  const queryRunId = deps.readQueryParam("examRunId")?.trim();
  if (queryRunId) {
    deps.writeStoredValue("openclinxr.examRunId", queryRunId);
    return queryRunId;
  }
  const storedRunId = deps.readStoredValue("openclinxr.examRunId")?.trim();
  if (storedRunId) {
    return storedRunId;
  }
  const generatedRunId = `local_${nowMs.toString(36)}`;
  deps.writeStoredValue("openclinxr.examRunId", generatedRunId);
  return generatedRunId;
}

export function configuredExamTiming(deps: ExamRunQueryDeps): ExamRunTiming {
  return {
    encounterSeconds: positiveIntegerQueryParam(deps, "examEncounterSeconds", 900),
    noteSeconds: positiveIntegerQueryParam(deps, "examNoteSeconds", 600),
    autoAdvanceOnNoteTimeout: booleanQueryParam(deps, "examAutoAdvanceOnNoteTimeout", true),
  };
}

export type ExamNavigationInput = {
  nextScenarioId: string;
  sequence: readonly string[];
  examRunId: string;
  timing: ExamRunTiming;
};

export function buildExamNavigationUrl(href: string, input: ExamNavigationInput): string {
  const nextUrl = new URL(href);
  nextUrl.searchParams.set("scenarioId", input.nextScenarioId);
  nextUrl.searchParams.set("examSequence", input.sequence.join(","));
  nextUrl.searchParams.set("examRunId", input.examRunId);
  nextUrl.searchParams.set("examEncounterSeconds", String(input.timing.encounterSeconds));
  nextUrl.searchParams.set("examNoteSeconds", String(input.timing.noteSeconds));
  nextUrl.searchParams.set(
    "examAutoAdvanceOnNoteTimeout",
    input.timing.autoAdvanceOnNoteTimeout ? "1" : "0",
  );
  return nextUrl.toString();
}
