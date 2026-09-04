import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import {
  advanceExamFormRunBreak,
  advanceExamFormRunStation,
  createDefaultClinicalSkillsBlueprint,
  createExamFormRun,
  createExamTimingPlan,
  createStep2CsStyleSeedBlueprint,
  currentExamFormRunPhase,
  currentExamFormRunStation,
  nextExamFormRunStation,
  parseExamFormRunState,
  resumeExamFormRun,
  serializeExamFormRunState,
  startExamFormRun,
  tickExamFormRunClock,
} from "./index.js";

/** Step 2 CS-style occupied break: 10 minutes. */
const STEP2CS_BREAK_SECONDS = 600;
const STATION_SECONDS = 60 + 900 + 600;

function repeatedPilotStations(stationCount: number) {
  return Array.from({ length: stationCount }, () => edChestPainScenario);
}

function blueprintWithBreaks(stationCount: number, breakAfterStationOrders: number[]) {
  const scenarios = repeatedPilotStations(stationCount);
  const blueprint = createDefaultClinicalSkillsBlueprint(scenarios, { stationCount });
  return {
    scenarios,
    blueprint: {
      ...blueprint,
      timing: {
        ...blueprint.timing,
        breakAfterStationOrders,
      },
    },
  };
}

function completeStation(
  run: ReturnType<typeof createExamFormRun>,
  endedAtFormSecond: number,
  recordedAtIso = "2026-09-04T12:00:00.000Z",
) {
  return advanceExamFormRunStation(run, {
    phase: "complete",
    noteSubmitted: true,
    advanceReason: "patient_note_submitted_advancing",
    endedAtFormSecond,
    recordedAtIso,
  });
}

describe("exam-form break phases", () => {
  it("places occupied breaks after 3, 6, and 9 on the 12-station seed without shifting station-only time", () => {
    const plan = createExamTimingPlan(createStep2CsStyleSeedBlueprint(), {
      breakDurationSeconds: STEP2CS_BREAK_SECONDS,
    });

    expect(plan.stationWindows).toHaveLength(12);
    expect(plan.breakWindows.map((window) => window.afterStationOrder)).toEqual([3, 6, 9]);
    expect(plan.breakWindows.every((window) => window.phase === "break")).toBe(true);
    expect(plan.breakWindows.every((window) => window.durationSeconds === STEP2CS_BREAK_SECONDS)).toBe(true);
    expect(plan.totalStationTimeSeconds).toBe(12 * STATION_SECONDS);
    expect(plan.totalBreakTimeSeconds).toBe(3 * STEP2CS_BREAK_SECONDS);
    expect(plan.totalFormTimeSeconds).toBe(12 * STATION_SECONDS + 3 * STEP2CS_BREAK_SECONDS);

    expect(plan.stationWindows[2]?.note.endsAtSecond).toBe(3 * STATION_SECONDS);
    expect(plan.breakWindows[0]).toMatchObject({
      afterStationOrder: 3,
      startsAtSecond: 3 * STATION_SECONDS,
      endsAtSecond: 3 * STATION_SECONDS + STEP2CS_BREAK_SECONDS,
      phase: "break",
    });
    expect(plan.stationWindows[3]?.doorway.startsAtSecond).toBe(3 * STATION_SECONDS + STEP2CS_BREAK_SECONDS);
    expect(plan.stationWindows[3]?.encounter.startsAtSecond).toBeGreaterThan(plan.breakWindows[0]!.endsAtSecond - 1);
    expect(plan.stationWindows[3]?.doorway.startsAtSecond).toBe(plan.breakWindows[0]!.endsAtSecond);

    for (const station of plan.stationWindows) {
      for (const breakWindow of plan.breakWindows) {
        const overlaps =
          station.doorway.startsAtSecond < breakWindow.endsAtSecond
          && station.note.endsAtSecond > breakWindow.startsAtSecond;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("keeps checkpoint-only timing when break duration is omitted (no-break occupied time)", () => {
    const plan = createExamTimingPlan(createStep2CsStyleSeedBlueprint());
    expect(plan.breakCheckpoints).toEqual([
      { afterStationOrder: 3, atSecond: 4680 },
      { afterStationOrder: 6, atSecond: 9360 },
      { afterStationOrder: 9, atSecond: 14040 },
    ]);
    expect(plan.totalStationTimeSeconds).toBe(18720);
    expect(plan.totalBreakTimeSeconds).toBe(0);
    expect(plan.totalFormTimeSeconds).toBe(18720);
    expect(plan.stationWindows[3]?.doorway.startsAtSecond).toBe(4680);
  });

  it("reads break positions from the blueprint instead of hardcoding 3/6/9", () => {
    const { blueprint } = blueprintWithBreaks(5, [2, 4]);
    const plan = createExamTimingPlan(blueprint, {
      breakDurationsByAfterStationOrder: { 2: 30, 4: 90 },
    });

    expect(plan.breakWindows.map((window) => [window.afterStationOrder, window.durationSeconds])).toEqual([
      [2, 30],
      [4, 90],
    ]);
    expect(plan.stationWindows[2]?.doorway.startsAtSecond).toBe(2 * STATION_SECONDS + 30);
    expect(plan.totalBreakTimeSeconds).toBe(120);
  });

  it("skips occupied break phases on no-break forms and on zero-duration checkpoints", () => {
    const noBreak = blueprintWithBreaks(2, []);
    let run = createExamFormRun({
      examRunId: "exam_run_no_break",
      examFormId: "form_no_break",
      blueprint: noBreak.blueprint,
      scenarios: noBreak.scenarios,
    });
    run = startExamFormRun(run);
    run = completeStation(run, STATION_SECONDS);
    expect(currentExamFormRunPhase(run)).toEqual({ kind: "station" });
    expect(run.breakPhaseTransitions).toEqual([]);
    expect(currentExamFormRunStation(run)?.stationOrder).toBe(2);

    const checkpointOnly = blueprintWithBreaks(4, [3]);
    let checkpointRun = createExamFormRun({
      examRunId: "exam_run_checkpoint_only",
      examFormId: "form_checkpoint_only",
      blueprint: checkpointOnly.blueprint,
      scenarios: checkpointOnly.scenarios,
    });
    checkpointRun = startExamFormRun(checkpointRun);
    checkpointRun = completeStation(checkpointRun, STATION_SECONDS);
    checkpointRun = completeStation(checkpointRun, 2 * STATION_SECONDS);
    checkpointRun = completeStation(checkpointRun, 3 * STATION_SECONDS);
    expect(currentExamFormRunPhase(checkpointRun)).toEqual({ kind: "station" });
    expect(checkpointRun.breakPhaseTransitions).toEqual([]);
    expect(currentExamFormRunStation(checkpointRun)?.stationOrder).toBe(4);
  });

  it("enters an occupied break after station 3 then 6 then 9 exactly once on the 12-station form", () => {
    const scenarios = repeatedPilotStations(12);
    const blueprint = createStep2CsStyleSeedBlueprint(scenarios, { stationCount: 12 });
    let run = createExamFormRun({
      examRunId: "exam_run_step2cs_breaks",
      examFormId: "form_step2cs_breaks",
      blueprint,
      scenarios,
      breakDurationSeconds: STEP2CS_BREAK_SECONDS,
    });
    run = startExamFormRun(run);

    const breakAfter = [3, 6, 9];
    for (let stationOrder = 1; stationOrder <= 12; stationOrder += 1) {
      const station = currentExamFormRunStation(run);
      expect(station?.stationOrder).toBe(stationOrder);
      run = completeStation(run, station!.timing.note.endsAtSecond, `2026-09-04T12:${String(stationOrder).padStart(2, "0")}:00.000Z`);

      if (breakAfter.includes(stationOrder)) {
        expect(currentExamFormRunPhase(run)).toEqual({ kind: "break", afterStationOrder: stationOrder });
        expect(currentExamFormRunStation(run)).toBeNull();
        expect(nextExamFormRunStation(run)?.stationOrder).toBe(stationOrder + 1);

        const startedTwice = completeStation(run, station!.timing.note.endsAtSecond);
        expect(startedTwice.breakPhaseTransitions.filter((event) => event.eventType === "break.started" && event.afterStationOrder === stationOrder)).toHaveLength(1);
        expect(startedTwice.currentPhase).toEqual({ kind: "break", afterStationOrder: stationOrder });

        const breakWindow = run.queue.breakWindows.find((window) => window.afterStationOrder === stationOrder);
        run = tickExamFormRunClock(run, breakWindow!.endsAtSecond - STEP2CS_BREAK_SECONDS / 2);
        expect(run.clock.breakElapsedSecond).toBeGreaterThan(0);
        expect(run.clock.stationElapsedSecond).toBe(stationOrder * STATION_SECONDS);
        expect(run.clock.stationElapsedSecond + run.clock.breakElapsedSecond).toBe(run.clock.formElapsedSecond);

        run = advanceExamFormRunBreak(run, {
          endedAtFormSecond: breakWindow!.endsAtSecond,
          recordedAtIso: `2026-09-04T13:${String(stationOrder).padStart(2, "0")}:00.000Z`,
        });
        const endedTwice = advanceExamFormRunBreak(run, {
          endedAtFormSecond: breakWindow!.endsAtSecond,
          recordedAtIso: `2026-09-04T13:${String(stationOrder).padStart(2, "0")}:01.000Z`,
        });
        expect(endedTwice.breakPhaseTransitions.filter((event) => event.eventType === "break.ended" && event.afterStationOrder === stationOrder)).toHaveLength(1);
        run = endedTwice;
      }
    }

    expect(run.status).toBe("complete");
    expect(run.breakPhaseTransitions.map((event) => [event.eventType, event.afterStationOrder, event.phase])).toEqual([
      ["break.started", 3, "break"],
      ["break.ended", 3, "break"],
      ["break.started", 6, "break"],
      ["break.ended", 6, "break"],
      ["break.started", 9, "break"],
      ["break.ended", 9, "break"],
    ]);
    expect(run.clock.breakElapsedSecond).toBe(3 * STEP2CS_BREAK_SECONDS);
    expect(run.clock.stationElapsedSecond).toBe(12 * STATION_SECONDS);
    expect(run.stationOutcomes).toHaveLength(12);
  });

  it("survives serialize/resume mid-break without duplicating transitions or mixing break time into encounter windows", () => {
    const { blueprint, scenarios } = blueprintWithBreaks(4, [2]);
    let run = createExamFormRun({
      examRunId: "exam_run_resume_break",
      examFormId: "form_resume_break",
      blueprint,
      scenarios,
      breakDurationSeconds: 40,
    });
    run = startExamFormRun(run);
    run = completeStation(run, STATION_SECONDS);
    const station2 = currentExamFormRunStation(run);
    run = completeStation(run, station2!.timing.note.endsAtSecond);
    expect(currentExamFormRunPhase(run).kind).toBe("break");

    const serialized = serializeExamFormRunState(run);
    const resumed = resumeExamFormRun(serialized, station2!.timing.note.endsAtSecond + 10);
    expect(resumed.examRunId).toBe("exam_run_resume_break");
    expect(resumed.examEquivalenceGate).toBe(false);
    expect(currentExamFormRunPhase(resumed)).toEqual({ kind: "break", afterStationOrder: 2 });
    expect(resumed.breakPhaseTransitions).toHaveLength(1);
    expect(resumed.breakPhaseTransitions[0]?.phase).toBe("break");
    expect(resumed.clock.breakElapsedSecond).toBe(10);
    expect(resumed.clock.stationElapsedSecond).toBe(2 * STATION_SECONDS);

    const completed = advanceExamFormRunBreak(resumed, {
      endedAtFormSecond: station2!.timing.note.endsAtSecond + 40,
      recordedAtIso: "2026-09-04T14:00:00.000Z",
    });
    expect(completed.breakPhaseTransitions).toHaveLength(2);
    expect(currentExamFormRunStation(completed)?.stationOrder).toBe(3);
    expect(completed.queue.stationQueue[2]?.timing.encounter.startsAtSecond).toBeGreaterThan(
      completed.queue.breakWindows[0]!.endsAtSecond - completed.queue.stationQueue[2]!.timing.doorway.durationSeconds,
    );
    expect(completed.queue.stationQueue[2]?.timing.encounter.startsAtSecond).toBe(
      completed.queue.breakWindows[0]!.endsAtSecond + completed.queue.stationQueue[2]!.timing.doorway.durationSeconds,
    );

    expect(() => parseExamFormRunState("{")).toThrow(/not JSON/);
    expect(() => parseExamFormRunState(JSON.stringify({ examRunId: "x" }))).toThrow(/examEquivalenceGate/);
  });

  it("keeps the occupied break until form time reaches the window end, then advances station 4 exactly once", () => {
    const { blueprint, scenarios } = blueprintWithBreaks(4, [3]);
    let run = createExamFormRun({
      examRunId: "exam_run_break_timer",
      examFormId: "form_break_timer",
      blueprint,
      scenarios,
      breakDurationSeconds: 40,
    });
    run = startExamFormRun(run);
    run = completeStation(run, STATION_SECONDS);
    run = completeStation(run, 2 * STATION_SECONDS);
    const station3 = currentExamFormRunStation(run);
    run = completeStation(run, station3!.timing.note.endsAtSecond);
    const breakWindow = run.queue.breakWindows.find((window) => window.afterStationOrder === 3);
    expect(breakWindow?.endsAtSecond).toBe(station3!.timing.note.endsAtSecond + 40);
    expect(currentExamFormRunPhase(run)).toEqual({ kind: "break", afterStationOrder: 3 });
    expect(run.clock.formElapsedSecond).toBe(station3!.timing.note.endsAtSecond);

    const earlyDefault = advanceExamFormRunBreak(run);
    const earlyStamp = advanceExamFormRunBreak(run, { endedAtFormSecond: breakWindow!.endsAtSecond - 1 });
    const nonFinite = advanceExamFormRunBreak(run, { endedAtFormSecond: Number.NaN });
    const infinite = advanceExamFormRunBreak(run, { endedAtFormSecond: Number.POSITIVE_INFINITY });
    expect(earlyDefault).toBe(run);
    expect(earlyStamp.currentPhase).toEqual({ kind: "break", afterStationOrder: 3 });
    expect(nonFinite.currentPhase).toEqual({ kind: "break", afterStationOrder: 3 });
    expect(infinite.currentPhase).toEqual({ kind: "break", afterStationOrder: 3 });
    expect(currentExamFormRunStation(earlyStamp)).toBeNull();
    expect(nextExamFormRunStation(earlyStamp)?.stationOrder).toBe(4);
    expect(earlyStamp.breakPhaseTransitions.filter((event) => event.eventType === "break.ended")).toHaveLength(0);

    run = tickExamFormRunClock(run, breakWindow!.endsAtSecond);
    run = advanceExamFormRunBreak(run);
    expect(currentExamFormRunPhase(run)).toEqual({ kind: "station" });
    expect(currentExamFormRunStation(run)?.stationOrder).toBe(4);
    expect(run.breakPhaseTransitions.filter((event) => event.eventType === "break.ended")).toHaveLength(1);

    const lateAgain = advanceExamFormRunBreak(run, { endedAtFormSecond: breakWindow!.endsAtSecond + 10 });
    expect(lateAgain.breakPhaseTransitions.filter((event) => event.eventType === "break.ended")).toHaveLength(1);
    expect(currentExamFormRunStation(lateAgain)?.stationOrder).toBe(4);
  });

  it("does not enter a trailing occupied break after the final station", () => {
    const { blueprint, scenarios } = blueprintWithBreaks(3, [3]);
    let run = createExamFormRun({
      examRunId: "exam_run_trailing_break",
      examFormId: "form_trailing_break",
      blueprint,
      scenarios,
      breakDurationSeconds: 40,
    });
    run = startExamFormRun(run);
    run = completeStation(run, STATION_SECONDS);
    run = completeStation(run, 2 * STATION_SECONDS);
    const last = currentExamFormRunStation(run);
    expect(last?.stationOrder).toBe(3);
    run = completeStation(run, last!.timing.note.endsAtSecond);

    expect(run.status).toBe("complete");
    expect(currentExamFormRunPhase(run)).toEqual({ kind: "station" });
    expect(run.breakPhaseTransitions).toEqual([]);
    expect(run.stationOutcomes).toHaveLength(3);
    expect(nextExamFormRunStation(run)).toBeNull();
  });
});
