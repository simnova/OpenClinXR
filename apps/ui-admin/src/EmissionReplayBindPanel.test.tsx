import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLI_LATEST_FIXTURE_URL,
  EmissionReplayBindPanel,
  parseAdminReplayFromEmissionV1,
  SAMPLE_ADMIN_REPLAY_FROM_EMISSION_V1,
  type AdminReplayFromEmissionV1,
} from "./EmissionReplayBindPanel.js";

describe("EmissionReplayBindPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders embedded sample with turnSource badge, actorTurnRefs, timeline, and claim boundary", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch not available")));
    render(<EmissionReplayBindPanel />);

    const panel = screen.getByLabelText("Runtime emission admin replay bind");
    expect(panel).toHaveTextContent("Emission Replay Bind");
    expect(within(panel).getByLabelText("Turn source badge")).toHaveTextContent(
      "turnSource=runtime_emission_real_turns",
    );
    expect(within(panel).getByLabelText("Projection source badge")).toHaveTextContent(
      "source=embedded_sample",
    );
    expect(panel).toHaveTextContent("openclinxr.admin-replay-from-emission.v1");
    expect(panel).toHaveTextContent("ed_chest_pain_priority_v1");
    expect(panel).toHaveTextContent("run_ed_chest_pain_priority_v1_test");
    expect(panel).toHaveTextContent("1 real actor turn");
    expect(panel).toHaveTextContent("2 timeline entries");
    expect(panel).toHaveTextContent("Private payload redacted");

    const claimBoundary = within(panel).getByLabelText("Emission replay claim boundary");
    expect(claimBoundary).toHaveTextContent(
      "admin_replay_from_runtime_emission_not_clinical_validity",
    );

    const notEvidence = within(panel).getByLabelText("Emission replay not evidence for");
    expect(notEvidence).toHaveTextContent("clinical_validity");
    expect(notEvidence).toHaveTextContent("scoring_validity");
    expect(notEvidence).toHaveTextContent("quest_readiness");
    expect(notEvidence).toHaveTextContent("production_readiness");

    const refs = within(panel).getByLabelText("Emission actor turn refs");
    expect(refs).toHaveTextContent(
      "actor_turn:run_ed_chest_pain_priority_v1_test:turn_1_patient_robert_hayes_v1_120",
    );

    const timeline = within(panel).getByLabelText("Emission replay timeline");
    expect(timeline).toHaveTextContent("learner.utterance");
    expect(timeline).toHaveTextContent("actor.response.generated");
    expect(timeline).toHaveTextContent("When did the chest pressure start?");
    expect(timeline).toHaveTextContent("spoken_actor_response");

    expect(within(panel).getByLabelText("Emission private payload posture")).toHaveTextContent(
      "privatePayloadRedacted=true",
    );
    expect(panel).toHaveTextContent("does not establish clinical validity");
  });

  it("loads a fixture projection prop and surfaces claimBoundary + notEvidenceFor", () => {
    const fixture: AdminReplayFromEmissionV1 = {
      ...SAMPLE_ADMIN_REPLAY_FROM_EMISSION_V1,
      stationRunId: "run_fixture_bind_001",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      actorTurnRefs: [
        "actor_turn:run_fixture_bind_001:turn_1_patient_maya_johnson_v1_90",
        "actor_turn:run_fixture_bind_001:turn_2_parent_v1_150",
      ],
      actorTurnCount: 2,
      timeline: [
        {
          sequence: 0,
          atSecond: 90,
          eventType: "learner.utterance",
          source: "learner",
          actorId: "patient_maya_johnson_v1",
          summary: "Learner utterance: How is breathing today?",
        },
        {
          sequence: 1,
          atSecond: 90,
          eventType: "actor.response.generated",
          source: "runtime_emission",
          actorId: "patient_maya_johnson_v1",
          summary: "Actor response (spoken_actor_response): A little tight.",
        },
      ],
      timelineEntryCount: 2,
    };

    render(<EmissionReplayBindPanel projection={fixture} />);

    const panel = screen.getByLabelText("Runtime emission admin replay bind");
    expect(within(panel).getByLabelText("Turn source badge")).toHaveTextContent(
      "runtime_emission_real_turns",
    );
    expect(within(panel).getByLabelText("Projection source badge")).toHaveTextContent(
      "source=embedded_sample",
    );
    expect(panel).toHaveTextContent("peds_asthma_parent_anxiety_v1");
    expect(panel).toHaveTextContent("run_fixture_bind_001");
    expect(panel).toHaveTextContent("2 real actor turns");
    const refs = within(panel).getByLabelText("Emission actor turn refs");
    expect(refs).toHaveTextContent("turn_1_patient_maya_johnson_v1_90");
    expect(refs).toHaveTextContent("turn_2_parent_v1_150");
    expect(within(panel).getByLabelText("Emission replay claim boundary")).toHaveTextContent(
      "admin_replay_from_runtime_emission_not_clinical_validity",
    );
    const notEvidence = within(panel).getByLabelText("Emission replay not evidence for");
    for (const item of fixture.notEvidenceFor) {
      expect(notEvidence).toHaveTextContent(item);
    }
  });

  it("auto-loads CLI latest on mount when no projection prop, source=cli_latest_fixture", async () => {
    const cliFixture: AdminReplayFromEmissionV1 = {
      ...SAMPLE_ADMIN_REPLAY_FROM_EMISSION_V1,
      stationRunId: "run_ed_chest_pain_priority_v1_runtime_emission_learner_001",
      actorTurnRefs: [
        "actor_turn:run_ed_chest_pain_priority_v1_runtime_emission_learner_001:turn_1_patient_robert_hayes_v1_120",
      ],
      reviewPacket: {
        ...SAMPLE_ADMIN_REPLAY_FROM_EMISSION_V1.reviewPacket,
        stationRunId: "run_ed_chest_pain_priority_v1_runtime_emission_learner_001",
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => cliFixture,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<EmissionReplayBindPanel />);

    const panel = screen.getByLabelText("Runtime emission admin replay bind");

    // Auto-load fires on mount — fetch called with fixture URL
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(CLI_LATEST_FIXTURE_URL);
    });

    await waitFor(() => {
      expect(within(panel).getByLabelText("Projection source badge")).toHaveTextContent(
        "source=cli_latest_fixture",
      );
    });

    expect(panel).toHaveTextContent(
      "run_ed_chest_pain_priority_v1_runtime_emission_learner_001",
    );
    expect(within(panel).getByLabelText("Turn source badge")).toHaveTextContent(
      "turnSource=runtime_emission_real_turns",
    );
    expect(within(panel).getByLabelText("Emission replay claim boundary")).toHaveTextContent(
      "admin_replay_from_runtime_emission_not_clinical_validity",
    );
    expect(within(panel).getByLabelText("Emission private payload posture")).toHaveTextContent(
      "privatePayloadRedacted=true",
    );
    const notEvidence = within(panel).getByLabelText("Emission replay not evidence for");
    expect(notEvidence).toHaveTextContent("clinical_validity");
    expect(notEvidence).toHaveTextContent("scoring_validity");
  });

  it("falls back to embedded_sample when auto-load fetch fails on mount", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    render(<EmissionReplayBindPanel />);

    const panel = screen.getByLabelText("Runtime emission admin replay bind");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(CLI_LATEST_FIXTURE_URL);
    });

    // Source badge stays embedded_sample after failed auto-load
    expect(within(panel).getByLabelText("Projection source badge")).toHaveTextContent(
      "source=embedded_sample",
    );

    // Error alert is shown
    expect(within(panel).getByLabelText("Emission projection load error")).toHaveTextContent(
      "Network unavailable",
    );
  });

  it("parseAdminReplayFromEmissionV1 accepts valid v1 and rejects seeds-only or wrong schema", () => {
    expect(parseAdminReplayFromEmissionV1(SAMPLE_ADMIN_REPLAY_FROM_EMISSION_V1).actorTurnCount).toBe(1);

    expect(() =>
      parseAdminReplayFromEmissionV1({
        ...SAMPLE_ADMIN_REPLAY_FROM_EMISSION_V1,
        schemaVersion: "openclinxr.other.v1",
      }),
    ).toThrow(/schemaVersion/);

    expect(() =>
      parseAdminReplayFromEmissionV1({
        ...SAMPLE_ADMIN_REPLAY_FROM_EMISSION_V1,
        turnSource: "authoring_seeds",
      }),
    ).toThrow(/turnSource/);

    expect(() =>
      parseAdminReplayFromEmissionV1({
        ...SAMPLE_ADMIN_REPLAY_FROM_EMISSION_V1,
        actorTurnRefs: [],
      }),
    ).toThrow(/actorTurnRefs/);
  });
});
