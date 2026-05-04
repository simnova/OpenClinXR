import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { findUnsafeClaimLanguage } from "@openclinxr/domain";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminApp } from "./App.js";
import type { AdminControlPlaneClient } from "./api-client.js";

describe("AdminApp", () => {
  beforeAll(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the scenario governance workbench routes and GraphQL contract status", () => {
    render(<AdminApp />);

    expect(screen.getByRole("heading", { name: "OpenClinXR Admin" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scenario Bank" })).toHaveAttribute("href", "/scenarios");
    expect(screen.getByRole("link", { name: "Review Replay" })).toHaveAttribute("href", "/reviews");
    expect(screen.getByRole("link", { name: "Exam Forms" })).toHaveAttribute("href", "/exam-forms");
    expect(screen.getByText("GraphQL Codegen")).toBeInTheDocument();
    expect(screen.getByText("Apollo Client")).toBeInTheDocument();
    expect(screen.getByText("ProComponents v3")).toBeInTheDocument();
    expect(screen.getByText("Clinical, psychometric, legal, and simulation QA gates")).toBeInTheDocument();
  });

  it("renders seed exam readiness on the exam forms route", async () => {
    render(<AdminApp initialPath="/exam-forms" controlPlaneClient={fakeControlPlaneClient()} />);

    expect(await screen.findByText("12 stations")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Seed Exam Readiness" })).toBeInTheDocument();
    expect(screen.getByText("1 activation ready")).toBeInTheDocument();
    expect(screen.getByText("11 blocked drafts")).toBeInTheDocument();
    expect(screen.getByText("5h 12m total")).toBeInTheDocument();
    expect(screen.getByText("Breaks after stations 3, 6, 9")).toBeInTheDocument();
    expect(screen.getByText("12 dev-ready scenes")).toBeInTheDocument();
    expect(screen.getByText("0 production-ready scenes")).toBeInTheDocument();
    expect(screen.getByText("Learner launch blocked")).toBeInTheDocument();
    expect(screen.getByText("11 draft-blocked stations")).toBeInTheDocument();
    expect(screen.getByText("Clinical-skills seed form")).toBeInTheDocument();
    expect(screen.getByText("Formative local practice.")).toBeInTheDocument();
    expect(screen.getByText("Station 9")).toBeInTheDocument();
    expect(screen.getAllByText("draft_blocked").length).toBe(11);
    expect(screen.getAllByText("clinic_abdominal_pain_interpreter_v1").length).toBeGreaterThan(0);

    const governanceNotice = screen.getByLabelText("Seed exam governance notice");
    expect(findUnsafeClaimLanguage(governanceNotice.textContent ?? "")).toEqual([]);
  });

  it("renders existing station run queue review snapshots", async () => {
    const client = fakeControlPlaneClient();
    client.listStep2CsSeedStationRunQueueSnapshots = async () => [
      await client.createStep2CsSeedStationRunQueueSnapshot({
        snapshotId: "queue_snapshot_existing_001",
        createdAt: "2026-05-03T17:00:00.000Z",
        reviewerId: "psychometrician_001",
      }),
    ];

    render(<AdminApp initialPath="/exam-forms" controlPlaneClient={client} />);

    const snapshotHistory = await screen.findByLabelText("Queue review snapshot history");
    expect(within(snapshotHistory).getByRole("heading", { name: "Review Snapshots" })).toBeInTheDocument();
    expect(within(snapshotHistory).getByText("queue_snapshot_existing_001")).toBeInTheDocument();
    expect(within(snapshotHistory).getByText("psychometrician_001")).toBeInTheDocument();
    expect(within(snapshotHistory).getByText("1 activation-ready / 11 blocked")).toBeInTheDocument();
  });

  it("creates a review snapshot from the station run queue", async () => {
    const client = fakeControlPlaneClient();
    const savedSnapshots = new Array<Awaited<ReturnType<typeof client.createStep2CsSeedStationRunQueueSnapshot>>>();
    const listSnapshots = vi.fn(async () => savedSnapshots);
    const createSnapshot = vi.fn(async (input: Parameters<typeof client.createStep2CsSeedStationRunQueueSnapshot>[0]) => {
      const snapshot = await fakeControlPlaneClient().createStep2CsSeedStationRunQueueSnapshot(input);
      savedSnapshots.push(snapshot);
      return snapshot;
    });
    client.listStep2CsSeedStationRunQueueSnapshots = listSnapshots;
    client.createStep2CsSeedStationRunQueueSnapshot = createSnapshot;

    render(<AdminApp initialPath="/exam-forms" controlPlaneClient={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Create review snapshot" }));

    expect(createSnapshot).toHaveBeenCalledWith(expect.objectContaining({ reviewerId: "admin_seed_reviewer" }));
    expect(await screen.findByText("Review snapshot saved")).toBeInTheDocument();
    expect(await within(screen.getByLabelText("Queue review snapshot history")).findByText("queue_snapshot_test_001")).toBeInTheDocument();
    expect(listSnapshots).toHaveBeenCalledTimes(2);
  });
});

function fakeControlPlaneClient(): AdminControlPlaneClient {
  return {
    getStep2CsSeedBlueprint: async () => ({
      blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
      title: "OpenClinXR Step 2 CS-Style 12-Station Seed Form",
      stationSlots: Array.from({ length: 12 }, (_, index) => ({
        slotId: `station_${index + 1}`,
        order: index + 1,
        label: `Station ${index + 1}`,
        requiredEnvironmentIds: [`environment_${index + 1}`],
        requiredTraceTags: [`trace_${index + 1}`],
      })),
      timing: { doorwaySeconds: 60, encounterSeconds: 900, noteSeconds: 600, breakAfterStationOrders: [3, 6, 9] },
      requiredTraceTags: ["history", "exam", "counseling"],
      requiredSafetyCriticalTraceTags: ["stroke_team_activation"],
    }),
    getStep2CsSeedBlueprintReadiness: async () => ({
      blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
      canAssembleReadyForm: false,
      stationCount: { required: 12, candidate: 12, activationEligible: 1 },
      activationEligibleScenarioIds: ["ed_chest_pain_priority_v1"],
      blockedScenarioIds: [
        { scenarioId: "clinic_abdominal_pain_interpreter_v1", reason: "not_approved" },
        ...Array.from({ length: 10 }, (_, index) => ({ scenarioId: `draft_scenario_${index + 1}`, reason: "not_approved" as const })),
      ],
      missingScenarioSlotIds: [],
    }),
    getStep2CsSeedTimingPlan: async () => ({
      blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
      stationWindows: Array.from({ length: 12 }, (_, index) => ({
        stationOrder: index + 1,
        slotId: `station_${index + 1}`,
        label: `Station ${index + 1}`,
        doorway: { startsAtSecond: index * 1560, endsAtSecond: index * 1560 + 60, durationSeconds: 60 },
        encounter: { startsAtSecond: index * 1560 + 60, endsAtSecond: index * 1560 + 960, durationSeconds: 900 },
        note: { startsAtSecond: index * 1560 + 960, endsAtSecond: (index + 1) * 1560, durationSeconds: 600 },
      })),
      breakCheckpoints: [
        { afterStationOrder: 3, atSecond: 4680 },
        { afterStationOrder: 6, atSecond: 9360 },
        { afterStationOrder: 9, atSecond: 14040 },
      ],
      totalStationTimeSeconds: 18720,
    }),
    getStep2CsSeedStationRunQueue: async () => ({
      blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
      canStartLearnerExam: false,
      stationQueue: Array.from({ length: 12 }, (_, index) => ({
        stationOrder: index + 1,
        slotId: `station_${index + 1}`,
        label: `Station ${index + 1}`,
        scenarioId: index === 8 ? "clinic_abdominal_pain_interpreter_v1" : index === 0 ? "ed_chest_pain_priority_v1" : `draft_scenario_${index + 1}`,
        scenarioVersion: 1,
        status: index === 0 ? "activation_ready" : "draft_blocked",
        blockers: index === 0 ? [] : ["scenario_not_approved"],
        timing: {
          stationOrder: index + 1,
          slotId: `station_${index + 1}`,
          label: `Station ${index + 1}`,
          doorway: { startsAtSecond: index * 1560, endsAtSecond: index * 1560 + 60, durationSeconds: 60 },
          encounter: { startsAtSecond: index * 1560 + 60, endsAtSecond: index * 1560 + 960, durationSeconds: 900 },
          note: { startsAtSecond: index * 1560 + 960, endsAtSecond: (index + 1) * 1560, durationSeconds: 600 },
        },
      })),
      breakCheckpoints: [
        { afterStationOrder: 3, atSecond: 4680 },
        { afterStationOrder: 6, atSecond: 9360 },
        { afterStationOrder: 9, atSecond: 14040 },
      ],
      totalStationTimeSeconds: 18720,
      summary: { activationReady: 1, draftBlocked: 11, governanceBlocked: 0, missingScenario: 0 },
    }),
    createStep2CsSeedStationRunQueueSnapshot: async (input) => ({
      snapshotId: input.snapshotId ?? "queue_snapshot_test_001",
      createdAt: input.createdAt ?? "2026-05-03T17:00:00.000Z",
      reviewerId: input.reviewerId ?? null,
      queue: await fakeControlPlaneClient().getStep2CsSeedStationRunQueue(),
    }),
    listStep2CsSeedStationRunQueueSnapshots: async () => [],
    getScenarioBankAssetReadiness: async () =>
      Array.from({ length: 12 }, (_, index) => ({
        scenarioId: index === 4 ? "clinic_abdominal_pain_interpreter_v1" : `scenario_${index + 1}`,
        devReady: true,
        productionReady: false,
        stationBudget: {
          maxVisibleTriangles: 180000,
          maxTextureMegabytes: 512,
          maxDrawCalls: 120,
          totalTriangles: 48000,
          totalTextureMegabytes: 72,
          totalDrawCalls: 24,
          blockers: [],
        },
        missingRequiredAssetIds: [],
        blockedAssets: [],
        productionBlockedAssets: [{ assetId: `scenario_${index + 1}_placeholder`, blockers: ["placeholder_asset_not_clinical_release_ready"] }],
      })),
  };
}
