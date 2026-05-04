import { edChestPainScenario, scenarioBank } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import {
  assembleExamForm,
  createDefaultClinicalSkillsBlueprint,
  createExamStationRunQueue,
  createExamTimingPlan,
  createStep2CsStyleSeedBlueprint,
  evaluateBlueprintScenarioReadiness,
  evaluateScenarioVersionDrift,
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
    expect(readiness.blockedScenarioIds).toHaveLength(11);
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
});
