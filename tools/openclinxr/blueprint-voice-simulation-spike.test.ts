import { createDefaultClinicalSkillsBlueprint } from "../../packages/openclinxr/exam-assembly/src/index.js";
import { edChestPainScenario } from "../../packages/openclinxr/scenario-fixtures/src/index.js";
import { describe, expect, it } from "vitest";
import {
  buildBlueprintVoiceSimulationPlan,
  buildBlueprintVoiceSimulationSpikeReport,
} from "./blueprint-voice-simulation-spike.js";

describe("blueprint-driven voice simulation spike", () => {
  it("compiles an existing station blueprint into privacy-safe actor voice plans", () => {
    const blueprint = createDefaultClinicalSkillsBlueprint();
    const plan = buildBlueprintVoiceSimulationPlan({
      blueprint,
      scenarios: [edChestPainScenario],
      scenarioId: "ed_chest_pain_priority_v1",
    });

    expect(plan).toMatchObject({
      blueprintId: "blueprint_openclinxr_clinical_skills_pilot_v1",
      station: {
        stationOrder: 1,
        slotId: "station_001_ed_urgent_recognition",
        scenarioId: "ed_chest_pain_priority_v1",
        title: "ED Chest Pain With Nurse Interruption And Family Pressure",
      },
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        modelDownloadsPerformed: false,
        productionUseAllowed: false,
        rawAudioStored: false,
        hiddenFactsExposedToLearner: false,
      },
    });
    expect(plan.actorRoster).toHaveLength(3);
    expect(plan.actorRoster[0]).toEqual({
      actorId: "patient_robert_hayes_v1",
      role: "patient",
      displayName: "Robert Hayes",
      demeanor: "anxious, diaphoretic, protective of chest",
      voiceId: "mock-patient-robert-hayes-v1",
      personalityTags: ["protective"],
      emotionTags: ["anxious", "diaphoretic"],
      hiddenFactCount: 2,
      hiddenFactsRedacted: true,
    });
    expect(plan.actorRoster[0]).not.toHaveProperty("hiddenFacts");
    expect(plan.triggerPlan).toEqual([
      {
        triggerId: "nurse_vitals_change",
        triggerType: "timed_event",
        atSecond: 420,
        actorId: "nurse_maria_alvarez_v1",
        traceTag: "vitals_review",
        learnerInterruptible: true,
      },
    ]);
    expect(plan.traceExpectations).toMatchObject({
      requiredTraceTags: expect.arrayContaining(["ecg_request", "urgent_escalation", "patient_note_submitted"]),
      safetyCriticalTraceTags: ["vitals_review", "ecg_request", "urgent_escalation", "team_communication"],
    });
    expect(plan.prewarmPlan.steps).toEqual([
      "compile_actor_context_cards",
      "prepare_mock_voice_slots",
      "prepare_trigger_scheduler",
      "prepare_safe_telemetry_labels",
    ]);
    expect(plan.telemetryAttributes).toEqual({
      "openclinxr.scenario_id": "ed_chest_pain_priority_v1",
      "openclinxr.scenario_version": 1,
      "openclinxr.route_id": "blueprint-voice-simulation-spike-v1",
      "openclinxr.route_surface": "local_tool_spike",
      "openclinxr.station_run_scoped": false,
    });
  });

  it("runs a deterministic mock voice loop without claiming local model or Quest readiness", async () => {
    const report = await buildBlueprintVoiceSimulationSpikeReport({
      generatedAt: "2026-05-05T21:05:00.000Z",
      blueprint: createDefaultClinicalSkillsBlueprint(),
      scenarios: [edChestPainScenario],
      scenarioId: "ed_chest_pain_priority_v1",
      learnerUtterance: "Maria, please get an ECG and repeat the vitals.",
      atSecond: 135,
    });

    expect(report.status).toBe("mock_loop_passed");
    expect(report.plan.actorRoster.map((actor) => actor.actorId)).toEqual([
      "patient_robert_hayes_v1",
      "spouse_anna_hayes_v1",
      "nurse_maria_alvarez_v1",
    ]);
    expect(report.mockLoop).toMatchObject({
      learnerUtteranceStored: false,
      rawAudioStored: false,
      selectedActorId: "nurse_maria_alvarez_v1",
      routingReason: "display_name_or_role_match",
      transcript: {
        finalText: "When did the chest pressure start?",
        eventCount: 2,
      },
      synthesis: {
        audioChunkCount: 1,
        firstAudiblePlaybackLatencyMs: 0,
        providerId: "mock-voice",
      },
      traceEvents: [
        {
          eventType: "voice.transcript.final",
          source: "mock-voice-gateway",
          actorId: "nurse_maria_alvarez_v1",
          tag: "ecg_request",
        },
        {
          eventType: "voice.audio.generated",
          source: "mock-voice-gateway",
          actorId: "nurse_maria_alvarez_v1",
          tag: "ecg_request",
        },
      ],
    });
    expect(report.mockLoop.traceEvents.map((event) => event.payload)).toEqual([
      {
        transcriptEventCount: 2,
        confidence: 0.99,
        rawTranscriptRedacted: true,
      },
      {
        audioFormat: "audio/mock",
        audioChunkCount: 1,
        rawAudioStored: false,
        visemeCuesPresent: true,
      },
    ]);
    expect(report.verdict).toEqual({
      tier0BlueprintCompilerPassed: true,
      tier1MockVoiceLoopPassed: true,
      tier2LocalInferenceObserved: false,
      tier3WebXrObserved: false,
      readyForProduction: false,
      blockers: [
        "real_local_full_duplex_model_not_executed",
        "python_backend_runtime_not_executed_for_this_report",
        "webxr_iwsdk_client_not_executed_for_this_report",
        "quest_microphone_and_playback_not_measured",
        "clinical_voice_safety_controls_not_validated_with_real_model",
      ],
    });
  });
});
