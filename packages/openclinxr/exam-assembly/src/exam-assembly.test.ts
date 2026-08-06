import { edChestPainScenario, scenarioBank } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import {
  advanceExamFormRunStation,
  assembleExamForm,
  createDefaultClinicalSkillsBlueprint,
  createExamFormRun,
  createExamStationRunQueue,
  createExamStationRunQueueSnapshot,
  createExamTimingPlan,
  createStep2CsStyleSeedBlueprint,
  currentExamFormRunStation,
  evaluateBlueprintScenarioReadiness,
  evaluateScenarioVersionDrift,
  nextExamFormRunStation,
  persistExamStationRunQueueSnapshot,
  startExamFormRun,
  tickExamFormRunClock,
  type ExamAssemblyPersistenceSink,
  type ExamStationRunQueueSnapshot,
} from "./index.js";

describe("exam assembly", () => {
  it("assembles approved scenarios into an ordered exam form with complete coverage", () => {
    const blueprint = createDefaultClinicalSkillsBlueprint();
    const form = assembleExamForm({
      examFormId: "form_openclinxr_pilot_001",
      blueprint,
      scenarios: [edChestPainScenario],
    });

    expect(form.status).toBe("ready_for_review");
    expect(form.stationRefs).toEqual([
      {
        order: 1,
        scenarioId: "ed_chest_pain_priority_v1",
        scenarioVersion: 1,
        title: "ED Chest Pain With Nurse Interruption And Family Pressure",
      },
    ]);
    expect(form.coverage.missingTraceTags).toEqual([]);
    expect(form.coverage.coveredTraceTags).toEqual(edChestPainScenario.requiredTraceTags);
  });

  it("marks forms with missing required coverage as incomplete", () => {
    const blueprint = {
      ...createDefaultClinicalSkillsBlueprint(),
      requiredTraceTags: [...edChestPainScenario.requiredTraceTags, "shared_decision_making"],
    };
    const form = assembleExamForm({
      examFormId: "form_openclinxr_pilot_coverage_gap",
      blueprint,
      scenarios: [edChestPainScenario],
    });

    expect(form.status).toBe("coverage_incomplete");
    expect(form.coverage.missingTraceTags).toEqual(["shared_decision_making"]);
  });

  it("deduplicates repeated blueprint trace requirements before coverage reporting", () => {
    const blueprint = {
      ...createDefaultClinicalSkillsBlueprint(),
      requiredTraceTags: [...edChestPainScenario.requiredTraceTags, "shared_decision_making", "shared_decision_making"],
    };
    const form = assembleExamForm({
      examFormId: "form_openclinxr_pilot_duplicate_blueprint_trace",
      blueprint,
      scenarios: [edChestPainScenario],
    });

    expect(form.coverage.missingTraceTags).toEqual(["shared_decision_making"]);
    expect(form.assemblyIssues.filter((issue) => issue === "missing_trace_coverage:shared_decision_making")).toHaveLength(1);
  });

  it("reports station count, environment, and safety-critical coverage gaps", () => {
    const defaultBlueprint = createDefaultClinicalSkillsBlueprint();
    const blueprint = {
      ...defaultBlueprint,
      stationSlots: [
        ...defaultBlueprint.stationSlots,
        {
          slotId: "station_002_behavioral_health_safety",
          order: 2,
          label: "Behavioral health safety planning",
          requiredEnvironmentIds: ["behavioral_health_private_room_v1"],
          requiredTraceTags: ["direct_suicide_question"],
        },
      ],
      requiredTraceTags: [...defaultBlueprint.requiredTraceTags, "direct_suicide_question"],
      requiredSafetyCriticalTraceTags: [...defaultBlueprint.requiredSafetyCriticalTraceTags, "direct_suicide_question"],
    };

    const form = assembleExamForm({
      examFormId: "form_openclinxr_pilot_missing_station",
      blueprint,
      scenarios: [edChestPainScenario],
    });

    expect(form.status).toBe("blueprint_incomplete");
    expect(form.coverage.stationCount).toEqual({ required: 2, actual: 1, ok: false });
    expect(form.coverage.missingEnvironmentIds).toEqual(["behavioral_health_private_room_v1"]);
    expect(form.coverage.missingSafetyCriticalTraceTags).toEqual(["direct_suicide_question"]);
    expect(form.assemblyIssues).toEqual(
      expect.arrayContaining([
        "missing_station_slots:1",
        "missing_environment_coverage:behavioral_health_private_room_v1",
        "missing_safety_critical_trace_coverage:direct_suicide_question",
      ]),
    );
  });

  it("detects scenario version drift after an exam form is assembled", () => {
    const form = assembleExamForm({
      examFormId: "form_openclinxr_pilot_001",
      blueprint: createDefaultClinicalSkillsBlueprint(),
      scenarios: [edChestPainScenario],
    });

    expect(evaluateScenarioVersionDrift(form, [{ ...edChestPainScenario, version: 2 }])).toEqual([
      {
        scenarioId: "ed_chest_pain_priority_v1",
        lockedVersion: 1,
        currentVersion: 2,
      },
    ]);
  });

  it("rejects unapproved scenarios before exam form lock", () => {
    expect(() =>
      assembleExamForm({
        examFormId: "form_unapproved",
        blueprint: createDefaultClinicalSkillsBlueprint(),
        scenarios: [{ ...edChestPainScenario, status: "draft" }],
      }),
    ).toThrow("Cannot assemble unapproved scenario");
  });

  it("creates a 12-station seed blueprint without making draft stations runnable", () => {
    const blueprint = createStep2CsStyleSeedBlueprint();
    expect(blueprint.stationSlots).toHaveLength(12);
    expect(blueprint.stationSlots.map((slot) => slot.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(blueprint.timing).toEqual({
      doorwaySeconds: 60,
      encounterSeconds: 900,
      noteSeconds: 600,
      breakAfterStationOrders: [3, 6, 9],
    });
    expect(blueprint.requiredTraceTags).toEqual(expect.arrayContaining(["ecg_request", "teach_back", "stroke_team_activation", "interpreter_use"]));

    const readiness = evaluateBlueprintScenarioReadiness(blueprint, scenarioBank);
    expect(readiness.canAssembleReadyForm).toBe(false);
    expect(readiness.activationEligibleScenarioIds).toEqual(["ed_chest_pain_priority_v1"]);
    // Readiness is evaluated over the CANDIDATE POOL (the whole bank), not the assembled form, so
    // this is bank-derived: every bank scenario except the single activation-eligible one is blocked.
    expect(readiness.blockedScenarioIds).toHaveLength(scenarioBank.length - 1);
    expect(readiness.blockedScenarioIds).toContainEqual({ scenarioId: "ward_delirium_med_rec_v1", reason: "not_approved" });
  });

  it("derives deterministic station timing windows and break checkpoints", () => {
    const plan = createExamTimingPlan(createStep2CsStyleSeedBlueprint());
    expect(plan.stationWindows).toHaveLength(12);
    expect(plan.stationWindows[0]).toMatchObject({
      stationOrder: 1,
      doorway: { startsAtSecond: 0, endsAtSecond: 60 },
      encounter: { startsAtSecond: 60, endsAtSecond: 960 },
      note: { startsAtSecond: 960, endsAtSecond: 1560 },
    });
    expect(plan.breakCheckpoints).toEqual([
      { afterStationOrder: 3, atSecond: 4680 },
      { afterStationOrder: 6, atSecond: 9360 },
      { afterStationOrder: 9, atSecond: 14040 },
    ]);
    expect(plan.totalStationTimeSeconds).toBe(18720);
  });

  it("orders timing windows and break checkpoints deterministically when blueprint input is unsorted", () => {
    const blueprint = createStep2CsStyleSeedBlueprint();
    const unsortedBlueprint = {
      ...blueprint,
      stationSlots: [blueprint.stationSlots[2], blueprint.stationSlots[0], blueprint.stationSlots[1]].filter((slot) => slot !== undefined),
      timing: {
        ...blueprint.timing,
        breakAfterStationOrders: [3, 3, 1],
      },
    };

    const plan = createExamTimingPlan(unsortedBlueprint);

    expect(plan.stationWindows.map((window) => window.stationOrder)).toEqual([1, 2, 3]);
    expect(plan.breakCheckpoints).toEqual([
      { afterStationOrder: 1, atSecond: 1560 },
      { afterStationOrder: 3, atSecond: 4680 },
    ]);
  });

  it("assigns exam form station refs by sorted blueprint station order", () => {
    const blueprint = createStep2CsStyleSeedBlueprint();
    const unsortedBlueprint = {
      ...blueprint,
      stationSlots: [blueprint.stationSlots[2], blueprint.stationSlots[0], blueprint.stationSlots[1]].filter((slot) => slot !== undefined),
    };
    const approvedScenarios = scenarioBank.slice(0, 3).map((scenario) => ({
      ...scenario,
      status: "approved" as const,
      review: {
        clinical: "approved" as const,
        psychometric: "approved" as const,
        legal: "approved" as const,
        simulationQa: "approved" as const,
      },
    }));

    const form = assembleExamForm({
      examFormId: "form_unsorted_blueprint_station_refs",
      blueprint: unsortedBlueprint,
      scenarios: approvedScenarios,
    });

    expect(form.stationRefs.map((station) => [station.order, station.scenarioId])).toEqual([
      [1, approvedScenarios[0]?.scenarioId],
      [2, approvedScenarios[1]?.scenarioId],
      [3, approvedScenarios[2]?.scenarioId],
    ]);
  });

  it("creates a sequenced seed station run queue without unlocking draft stations", () => {
    const queue = createExamStationRunQueue(createStep2CsStyleSeedBlueprint(), scenarioBank);

    expect(queue.canStartLearnerExam).toBe(false);
    expect(queue.stationQueue).toHaveLength(12);
    expect(queue.summary).toEqual({
      activationReady: 1,
      draftBlocked: 11,
      governanceBlocked: 0,
      missingScenario: 0,
    });
    expect(queue.stationQueue[0]).toMatchObject({
      stationOrder: 1,
      scenarioId: "ed_chest_pain_priority_v1",
      scenarioVersion: 1,
      status: "activation_ready",
      blockers: [],
      timing: {
        note: { endsAtSecond: 1560 },
      },
    });
    expect(queue.stationQueue[8]).toMatchObject({
      stationOrder: 9,
      scenarioId: "clinic_abdominal_pain_interpreter_v1",
      status: "draft_blocked",
      blockers: ["scenario_not_approved"],
      timing: {
        doorway: { startsAtSecond: 12480 },
      },
    });
    expect(queue.breakCheckpoints).toEqual([
      { afterStationOrder: 3, atSecond: 4680 },
      { afterStationOrder: 6, atSecond: 9360 },
      { afterStationOrder: 9, atSecond: 14040 },
    ]);
  });

  it("keeps approved scenarios blocked from learner launch when replayable dialogue seeds are missing", () => {
    const scenarioWithoutDialogueSeeds = {
      ...edChestPainScenario,
      scenarioId: "approved_missing_dialogue_replay_v1",
    };
    const blueprint = createStep2CsStyleSeedBlueprint([scenarioWithoutDialogueSeeds]);
    const readiness = evaluateBlueprintScenarioReadiness(blueprint, [scenarioWithoutDialogueSeeds]);

    expect(readiness.canAssembleReadyForm).toBe(false);
    expect(readiness.activationEligibleScenarioIds).toEqual([]);
    expect(readiness.blockedScenarioIds).toEqual([
      { scenarioId: "approved_missing_dialogue_replay_v1", reason: "dialogue_seed_not_ready" },
    ]);

    const queue = createExamStationRunQueue(blueprint, [scenarioWithoutDialogueSeeds]);
    expect(queue.canStartLearnerExam).toBe(false);
    expect(queue.summary).toEqual({
      activationReady: 0,
      draftBlocked: 0,
      governanceBlocked: 1,
      missingScenario: 0,
    });
    expect(queue.stationQueue[0]).toMatchObject({
      scenarioId: "approved_missing_dialogue_replay_v1",
      status: "governance_blocked",
      blockers: ["dialogue_seed_replay_not_ready"],
    });
  });

  it("drives multi-station form run: blueprint → assembleExamForm → queue → form clock → outcomes", () => {
    // Two activation-ready slots (same approved fixture twice) exercise sequencing without draft blockers.
    const stationA = edChestPainScenario;
    const stationB = edChestPainScenario;
    const blueprint = createStep2CsStyleSeedBlueprint([stationA, stationB]);

    let run = createExamFormRun({
      examRunId: "exam_run_multi_station_001",
      examFormId: "form_multi_station_001",
      blueprint,
      scenarios: [stationA, stationB],
    });

    expect(run.examEquivalenceGate).toBe(false);
    expect(run.notEvidenceFor).toEqual(expect.arrayContaining(["exam_equivalence", "clinical_validity"]));
    expect(run.form.status).toBe("ready_for_review");
    expect(run.form.stationRefs).toHaveLength(2);
    expect(run.queue.canStartLearnerExam).toBe(true);
    expect(run.queue.stationQueue).toHaveLength(2);
    expect(run.status).toBe("not_started");
    expect(run.clock.totalStationTimeSeconds).toBe(3120);
    expect(run.clock.formElapsedSecond).toBe(0);
    expect(run.clock.formRemainingSecond).toBe(3120);

    run = startExamFormRun(run);
    expect(run.status).toBe("in_progress");
    expect(currentExamFormRunStation(run)?.scenarioId).toBe(stationA.scenarioId);
    expect(nextExamFormRunStation(run)?.scenarioId).toBe(stationB.scenarioId);

    run = tickExamFormRunClock(run, 1560);
    expect(run.clock.formElapsedSecond).toBe(1560);
    expect(run.clock.formRemainingSecond).toBe(1560);

    run = advanceExamFormRunStation(run, {
      phase: "complete",
      noteSubmitted: true,
      advanceReason: "patient_note_submitted_advancing",
      endedAtFormSecond: 1560,
      recordedAtIso: "2026-08-03T12:00:00.000Z",
    });

    expect(run.stationOutcomes).toHaveLength(1);
    expect(run.stationOutcomes[0]).toMatchObject({
      stationOrder: 1,
      scenarioId: stationA.scenarioId,
      phase: "complete",
      noteSubmitted: true,
      startedAtFormSecond: 0,
      endedAtFormSecond: 1560,
      advanceReason: "patient_note_submitted_advancing",
    });
    expect(run.status).toBe("in_progress");
    expect(run.currentStationIndex).toBe(1);
    expect(currentExamFormRunStation(run)?.scenarioId).toBe(stationB.scenarioId);

    run = advanceExamFormRunStation(run, {
      phase: "complete",
      noteSubmitted: true,
      advanceReason: "last_station_note_submitted_exam_complete",
      endedAtFormSecond: 3120,
      recordedAtIso: "2026-08-03T12:30:00.000Z",
    });

    expect(run.status).toBe("complete");
    expect(run.stationOutcomes).toHaveLength(2);
    expect(run.stationOutcomes.map((outcome) => outcome.stationOrder)).toEqual([1, 2]);
    expect(run.examEquivalenceGate).toBe(false);
  });

  it("keeps single-station form run additive and complete after one advance", () => {
    const blueprint = createDefaultClinicalSkillsBlueprint();
    let run = createExamFormRun({
      examRunId: "exam_run_single_001",
      examFormId: "form_single_001",
      blueprint,
      scenarios: [edChestPainScenario],
    });
    run = startExamFormRun(run);
    expect(run.queue.stationQueue).toHaveLength(1);
    expect(nextExamFormRunStation(run)).toBeNull();

    run = advanceExamFormRunStation(run, {
      phase: "complete",
      noteSubmitted: true,
      advanceReason: "last_station_note_submitted_exam_complete",
      endedAtFormSecond: 1560,
      recordedAtIso: "2026-08-03T12:00:00.000Z",
    });

    expect(run.status).toBe("complete");
    expect(run.stationOutcomes).toHaveLength(1);
    expect(run.stationOutcomes[0]?.scenarioId).toBe(edChestPainScenario.scenarioId);
  });

  it("persists station-run-queue snapshot via injected ApiPersistenceSink-shaped sink (no mongo)", async () => {
    const queue = createExamStationRunQueue(createDefaultClinicalSkillsBlueprint(), [edChestPainScenario]);
    const saved: ExamStationRunQueueSnapshot[] = [];
    const sink: ExamAssemblyPersistenceSink = {
      saveStationRunQueueSnapshot: (snapshot) => {
        saved.push(snapshot);
      },
    };

    const snapshot = createExamStationRunQueueSnapshot({
      snapshotId: "queue_snapshot_learner_001",
      queue,
      reviewerId: "learner_runtime_local",
      createdAt: "2026-08-03T12:00:00.000Z",
    });
    const persisted = await persistExamStationRunQueueSnapshot(sink, snapshot);

    expect(persisted).toEqual(snapshot);
    expect(saved).toEqual([snapshot]);
    expect(saved[0]?.queue.stationQueue).toHaveLength(1);
    expect(saved[0]?.queue.canStartLearnerExam).toBe(true);
  });
});

/**
 * PLANTED CONTRACT (#53) — producer and consumer are only coincidentally aligned.
 *
 * `createExamStationRunQueue` returns `{ stationQueue, … }` (`assembly.ts:196`). The learner runtime
 * parses `body.stationQueue` in `apps/ui-xr/src/learner-exam-scenario-source.ts:84`. They match
 * today and NOTHING binds them, because #43's tests drive the resolver with a hand-written mock —
 * so the contract under test is that mock, not this producer.
 *
 * The failure mode is what makes this worth a contract rather than a comment. If the shape drifts,
 * `extractStationQueueScenarioIds` returns `[]`, the resolver yields nothing, and the runtime falls
 * back to the fixture bank with no exception, no failing test and no log — silently restoring
 * exactly the state #43 existed to end, and indistinguishable from correct offline behaviour.
 *
 * The peer round killed the option I preferred. A shared TYPE looks free — `ExamStationRunQueueItem`
 * already exists — but a type does not fail when a route stops emitting the field at runtime, which
 * is the actual failure. It also rejected an app↔app test dependency (a new coupling class for one
 * test) and a third fixture file (a third thing that can drift).
 *
 * What it proposed instead, and what this contract assumes: the PARSER moves here, beside the
 * producer, and both apps import it from a package they already depend on
 * (`apps/ui-xr/package.json:17`, `apps/api/package.json:29`).
 *
 * NAME AND SIGNATURE ARE THE IMPLEMENTER'S CHOICE. This reads a `parseExamStationRunQueueScenarioIds`
 * export; if a different name or shape is better, change the call site here and say why in the
 * commit. What must not change: the parser is exercised against this producer's REAL return value,
 * never a hand-built object shaped like today's contract.
 */
describe("the station queue parser is bound to the producer (#53)", () => {
  it("parses createExamStationRunQueue output back to the scenario ids it was built from", async () => {
    const mod = await import("./index.js") as Record<string, unknown>;
    const parse = mod["parseExamStationRunQueueScenarioIds"] as undefined | ((body: unknown) => string[]);
    expect(parse).toBeTypeOf("function");

    const scenarios = [edChestPainScenario];
    const queue = createExamStationRunQueue(createDefaultClinicalSkillsBlueprint(), scenarios);

    // The producer's own return value — not a literal shaped like today's response.
    const parsed = parse!(queue);
    expect(parsed).toContain(edChestPainScenario.scenarioId);
  });
});
