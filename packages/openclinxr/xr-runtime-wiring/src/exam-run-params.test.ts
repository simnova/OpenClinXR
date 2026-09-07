import { describe, expect, it } from "vitest";
import {
  booleanQueryParam,
  buildExamNavigationUrl,
  configuredExamRunId,
  configuredExamSequence,
  configuredExamTiming,
  type ExamRunQueryDeps,
  positiveIntegerQueryParam,
} from "./exam-run-params.js";
import {
  buildExamRunStationOutcome,
  findFormStationOutcome,
  formElapsedSecondForCurrentStation,
  mergeExamRunStationOutcome,
  nextExamScenarioId,
  normalizeExamSequence,
} from "./exam-run-sequence.js";

function depsFromQuery(search: string, stored: Record<string, string> = {}): {
  deps: ExamRunQueryDeps;
  written: Record<string, string>;
} {
  const params = new URLSearchParams(search);
  const written: Record<string, string> = {};
  return {
    deps: {
      readQueryParam: (name) => params.get(name),
      readStoredValue: (key) => stored[key] ?? null,
      writeStoredValue: (key, value) => {
        written[key] = value;
      },
    },
    written,
  };
}

describe("exam-run query wiring", () => {
  it("reads the exam sequence with the built-in fallback", () => {
    expect(configuredExamSequence(depsFromQuery("?examSequence=a,b").deps)).toEqual(["a", "b"]);
    expect(configuredExamSequence(depsFromQuery("").deps)[0]).toBe("ed_chest_pain_priority_v1");
  });

  it("prefers the query run id, then storage, then a generated id", () => {
    expect(configuredExamRunId(depsFromQuery("?examRunId=q1").deps, 42)).toBe("q1");
    expect(configuredExamRunId(depsFromQuery("", { "openclinxr.examRunId": "stored" }).deps, 42)).toBe(
      "stored",
    );
    expect(configuredExamRunId(depsFromQuery("").deps, 42)).toBe(`local_${(42).toString(36)}`);
  });

  it("reads timing query params with fallbacks", () => {
    const timing = configuredExamTiming(depsFromQuery("?examEncounterSeconds=30").deps);
    expect(timing.encounterSeconds).toBe(30);
    expect(timing.noteSeconds).toBe(600);
    expect(positiveIntegerQueryParam(depsFromQuery("").deps, "examEncounterSeconds", 900)).toBe(900);
    expect(booleanQueryParam(depsFromQuery("?examAutoAdvanceOnNoteTimeout=0").deps, "examAutoAdvanceOnNoteTimeout", true)).toBe(
      false,
    );
  });

  it("builds the station navigation url", () => {
    const url = buildExamNavigationUrl("https://exam.test/?scenarioId=a", {
      nextScenarioId: "b",
      sequence: ["a", "b"],
      examRunId: "run1",
      timing: { encounterSeconds: 900, noteSeconds: 600, autoAdvanceOnNoteTimeout: true },
    });
    expect(url).toContain("scenarioId=b");
    expect(url).toContain("examRunId=run1");
    expect(url).toContain("examEncounterSeconds=900");
  });

  it("normalises the sequence and steps to the next station", () => {
    const { normalized, index } = normalizeExamSequence(["a", "b"], "b");
    expect(normalized).toEqual(["a", "b"]);
    expect(index).toBe(1);
    expect(nextExamScenarioId(null, { sequence: normalized, scenarioIndex: index })).toBeNull();
    expect(nextExamScenarioId(null, { sequence: normalized, scenarioIndex: 0 })).toBe("b");
  });

  it("falls back to elapsed seconds without a form run", () => {
    expect(formElapsedSecondForCurrentStation(null, 12)).toBe(12);
    expect(findFormStationOutcome(null, 0, "a")).toBeUndefined();
  });

  it("builds and merges station outcomes", () => {
    const next = buildExamRunStationOutcome(
      {
        scenarioId: "a",
        scenarioIndex: 0,
        phase: "note",
        noteTextLength: 3,
        noteSubmitted: true,
        lastAdvanceReason: null,
        recordedAtIso: "2026-01-01T00:00:00.000Z",
        formSecond: 10,
      },
      undefined,
    );
    expect(next.stationOrder).toBe(1);
    const merged = mergeExamRunStationOutcome([{ scenarioId: "a", scenarioIndex: 0 }], {
      scenarioId: "a",
      scenarioIndex: 0,
    });
    expect(merged).toHaveLength(1);
  });
});
