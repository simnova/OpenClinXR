import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { findUnsafeClaimLanguage } from "@openclinxr/domain/claim-language";
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
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
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
  }, 10_000);

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
  }, 10_000);

  it("renders the generated ScenarioBank operation on the scenarios route", async () => {
    render(<AdminApp initialPath="/scenarios" controlPlaneClient={fakeControlPlaneClient()} />);

    expect((await screen.findAllByText("1 approved")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Scenario Bank" })).toBeInTheDocument();
    expect(screen.getAllByText("1 draft").length).toBeGreaterThan(0);
    expect(screen.getByText("ED Chest Pain With Nurse Interruption And Family Pressure")).toBeInTheDocument();
    expect(screen.getByText("Pediatric Asthma With Parent Anxiety")).toBeInTheDocument();
    expect(screen.getByText("Robert Hayes")).toBeInTheDocument();
    expect(screen.getByText("Anna Hayes")).toBeInTheDocument();
    expect(screen.getByText("Maria Alvarez")).toBeInTheDocument();
    expect(screen.getByText("clinician")).toBeInTheDocument();
    expect(screen.getAllByText("psychometrician").length).toBeGreaterThan(0);

    const scenarioBank = screen.getByLabelText("Scenario bank governance");
    expect(findUnsafeClaimLanguage(scenarioBank.textContent ?? "")).toEqual([]);
    expect(scenarioBank.textContent).not.toContain("Father died of myocardial infarction");
    expect(scenarioBank.textContent).not.toContain("hiddenFacts");
    expect(scenarioBank.textContent).not.toContain("__typename");
  });

  it("renders scenario detail with asset readiness and no hidden facts", async () => {
    render(<AdminApp initialPath="/scenarios/ed_chest_pain_priority_v1?version=1" controlPlaneClient={fakeControlPlaneClient()} />);

    expect(await screen.findByRole("heading", { name: "ED Chest Pain With Nurse Interruption And Family Pressure" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Scenario environment")).getByText("Emergency department exam bay")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Scenario equipment")).getByText("12-lead ECG machine")).toBeInTheDocument();
    expect(screen.getByText("Robert Hayes")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Scenario production blockers")).getByText("patient_robert_hayes_character")).toBeInTheDocument();
    expect(screen.getByText("Dev-ready assets")).toBeInTheDocument();
    expect(screen.getByText("Production blocked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Scenario Bank" })).toHaveAttribute("href", "/scenarios");

    const scenarioDetail = screen.getByLabelText("Scenario detail governance");
    expect(findUnsafeClaimLanguage(scenarioDetail.textContent ?? "")).toEqual([]);
    expect(scenarioDetail.textContent).not.toContain("Father died of myocardial infarction");
    expect(scenarioDetail.textContent).not.toContain("hiddenFacts");
    expect(scenarioDetail.textContent).not.toContain("__typename");
  });

  it("records a local scenario review decision from the detail route", async () => {
    const client = fakeControlPlaneClient();
    const submitScenarioReview = vi.fn(client.submitScenarioReview);
    client.submitScenarioReview = submitScenarioReview;

    render(<AdminApp initialPath="/scenarios/peds_asthma_parent_anxiety_v1?version=1" controlPlaneClient={client} />);

    expect(await screen.findByRole("heading", { name: "Pediatric Asthma With Parent Anxiety" })).toBeInTheDocument();
    expect(screen.getByText("clinical: draft")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Record clinical approval" }));

    expect(await screen.findByText("Review decision recorded")).toBeInTheDocument();
    expect(screen.getByText("clinical: approved")).toBeInTheDocument();
    expect(submitScenarioReview).toHaveBeenCalledWith({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      version: 1,
      reviewerRole: "clinical",
      reviewerId: "admin_clinical_reviewer",
      decision: "APPROVED",
      comments: "Clinical reviewer approval recorded from the local admin workbench.",
      evidenceRefs: ["evidence:peds_asthma_parent_anxiety_v1:clinical:local-admin"],
    });
  });

  it("renders review replay and saves a faculty score draft", async () => {
    const client = fakeControlPlaneClient();
    const getReviewPacketReplay = vi.fn(client.getReviewPacketReplay);
    const saveFacultyScoreDraft = vi.fn(client.saveFacultyScoreDraft);
    client.getReviewPacketReplay = getReviewPacketReplay;
    client.saveFacultyScoreDraft = saveFacultyScoreDraft;

    render(<AdminApp initialPath="/reviews?stationRunId=run_ed_chest_pain_priority_v1_learner_001" controlPlaneClient={client} />);

    expect(await screen.findByRole("heading", { name: "Review Replay" })).toBeInTheDocument();
    expect(getReviewPacketReplay).toHaveBeenCalledWith({ stationRunId: "run_ed_chest_pain_priority_v1_learner_001" });
    expect(screen.getByText("ed_chest_pain_priority_v1")).toBeInTheDocument();
    expect(screen.getByText("team_communication")).toBeInTheDocument();
    expect(screen.getByText("Learner requested an ECG.")).toBeInTheDocument();
    expect(screen.getByText("Chest pain requires urgent ECG escalation.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Faculty reviewer ID"), { target: { value: "faculty_009" } });
    fireEvent.change(screen.getByLabelText("Faculty draft comments"), { target: { value: "Escalation captured; teamwork evidence is still weak." } });
    fireEvent.change(screen.getByLabelText("Urgent recognition score"), { target: { value: "22" } });
    fireEvent.change(screen.getByLabelText("Team communication score"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save faculty draft" }));

    expect(await screen.findByText("Faculty draft saved")).toBeInTheDocument();
    expect(saveFacultyScoreDraft).toHaveBeenCalledWith({
      stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
      reviewerId: "faculty_009",
      comments: "Escalation captured; teamwork evidence is still weak.",
      rubricScores: {
        urgent_recognition: 2,
        communication_team_family: 0,
      },
    });

    const replayWorkbench = screen.getByLabelText("Review packet replay workbench");
    expect(findUnsafeClaimLanguage(replayWorkbench.textContent ?? "")).toEqual([]);
    expect(replayWorkbench.textContent).not.toContain("Father died of myocardial infarction");
    expect(replayWorkbench.textContent).not.toContain("hiddenFacts");
  });

  it("creates a local seed replay from the review route", async () => {
    const client = fakeControlPlaneClient();
    const createLocalReviewReplaySeed = vi.fn(client.createLocalReviewReplaySeed);
    const getReviewPacketReplay = vi.fn(client.getReviewPacketReplay);
    client.createLocalReviewReplaySeed = createLocalReviewReplaySeed;
    client.getReviewPacketReplay = getReviewPacketReplay;

    render(<AdminApp initialPath="/reviews" controlPlaneClient={client} />);

    expect(await screen.findByText("Station run required")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create seed replay" }));

    expect(await screen.findByText("ed_chest_pain_priority_v1")).toBeInTheDocument();
    expect(createLocalReviewReplaySeed).toHaveBeenCalledWith();
    expect(getReviewPacketReplay).toHaveBeenCalledWith({
      stationRunId: "run_ed_chest_pain_priority_v1_admin_review_seed",
    });
    expect(screen.getByLabelText("Station run ID")).toHaveValue("run_ed_chest_pain_priority_v1_admin_review_seed");
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
    createLocalReviewReplaySeed: async () => ({
      stationRunId: "run_ed_chest_pain_priority_v1_admin_review_seed",
    }),
    listScenarios: async () => [
      {
        scenarioId: "ed_chest_pain_priority_v1",
        version: 1,
        title: "ED Chest Pain With Nurse Interruption And Family Pressure",
        status: "APPROVED",
        clinicalObjectives: ["Elicit focused chest pain history and risk factors"],
        requiredTraceTags: ["ecg_request", "urgent_escalation", "team_communication"],
        review: { __typename: "ScenarioReviewState", clinical: "approved", psychometric: "approved", legal: "approved", simulationQa: "approved" },
        governance: {
          scoreUseLabel: "formative_local_only",
          syntheticCaseDisclosure: "Synthetic local training scenario; not a validated summative assessment.",
          validationStage: "stage_1_expert_reviewed",
          requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
          sourceIds: ["src-step2cs-public-archive"],
        },
        actors: [
          { actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes", demeanor: "anxious" },
          { actorId: "spouse_anna_hayes_v1", role: "family", displayName: "Anna Hayes", demeanor: "worried" },
          { actorId: "nurse_maria_alvarez_v1", role: "nurse", displayName: "Maria Alvarez", demeanor: "direct" },
        ],
        assetNeeds: [
          { assetId: "ed_exam_bay_environment", assetType: "environment", licenseStatus: "placeholder-approved" },
        ],
      },
      {
        scenarioId: "peds_asthma_parent_anxiety_v1",
        version: 1,
        title: "Pediatric Asthma With Parent Anxiety",
        status: "DRAFT",
        clinicalObjectives: ["Assess pediatric respiratory distress"],
        requiredTraceTags: ["oxygen_request", "urgent_escalation"],
        review: { clinical: "draft", psychometric: "draft", legal: "draft", simulationQa: "draft" },
        governance: {
          scoreUseLabel: "formative_local_only",
          syntheticCaseDisclosure: "Synthetic pediatric communication and urgent-care training draft; not validated for summative assessment.",
          validationStage: "stage_0_synthetic_draft",
          requiredReviewerRoles: ["pediatrician", "psychometrician", "legal", "simulation_qa"],
          sourceIds: ["src-openclinxr-sample-case-bank-v1"],
        },
        actors: [
          { actorId: "patient_maya_johnson_v1", role: "patient", displayName: "Maya Johnson", demeanor: "short sentences" },
        ],
        assetNeeds: [],
      },
    ],
    getScenarioDetail: async (input) => input.scenarioId === "peds_asthma_parent_anxiety_v1"
      ? {
        scenario: {
          scenarioId: "peds_asthma_parent_anxiety_v1",
          version: 1,
          title: "Pediatric Asthma With Parent Anxiety",
          status: "DRAFT",
          clinicalObjectives: ["Assess pediatric respiratory distress"],
          requiredTraceTags: ["oxygen_request", "urgent_escalation"],
          review: { clinical: "draft", psychometric: "draft", legal: "draft", simulationQa: "draft" },
          governance: {
            scoreUseLabel: "formative_local_only",
            syntheticCaseDisclosure: "Synthetic pediatric communication and urgent-care training draft; not validated for summative assessment.",
            validationStage: "stage_0_synthetic_draft",
            requiredReviewerRoles: ["pediatrician", "psychometrician", "legal", "simulation_qa"],
            sourceIds: ["src-openclinxr-sample-case-bank-v1"],
          },
          environment: {
            environmentId: "pediatric_urgent_care_bay_v1",
            name: "Pediatric urgent care bay",
            description: "Pediatric urgent care bay with parent seating and oxygen equipment.",
          },
          equipment: ["pulse oximeter", "nebulizer mask"],
          actors: [
            { actorId: "patient_maya_johnson_v1", role: "patient", displayName: "Maya Johnson", demeanor: "short sentences" },
          ],
          assetNeeds: [],
        },
        assetReadiness: {
          scenarioId: "peds_asthma_parent_anxiety_v1",
          devReady: true,
          productionReady: false,
          missingRequiredAssetIds: [],
          blockedAssets: [],
          productionBlockedAssets: [],
        },
      }
      : {
        scenario: {
          scenarioId: "ed_chest_pain_priority_v1",
          version: 1,
          title: "ED Chest Pain With Nurse Interruption And Family Pressure",
          status: "APPROVED",
          clinicalObjectives: ["Elicit focused chest pain history and risk factors"],
          requiredTraceTags: ["ecg_request", "urgent_escalation", "team_communication"],
          review: { __typename: "ScenarioReviewState", clinical: "approved", psychometric: "approved", legal: "approved", simulationQa: "approved" },
          governance: {
            scoreUseLabel: "formative_local_only",
            syntheticCaseDisclosure: "Synthetic local training scenario; not a validated summative assessment.",
            validationStage: "stage_1_expert_reviewed",
            requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
            sourceIds: ["src-step2cs-public-archive"],
          },
          environment: {
            environmentId: "ed_exam_bay_v1",
            name: "Emergency department exam bay",
            description: "Busy ED exam bay with monitor alarms, family pressure, and nurse interruptions.",
          },
          equipment: ["12-lead ECG machine", "bedside monitor"],
          actors: [
            { actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes", demeanor: "anxious" },
            { actorId: "spouse_anna_hayes_v1", role: "family", displayName: "Anna Hayes", demeanor: "worried" },
            { actorId: "nurse_maria_alvarez_v1", role: "nurse", displayName: "Maria Alvarez", demeanor: "direct" },
          ],
          assetNeeds: [
            { assetId: "ed_exam_bay_environment", assetType: "environment", description: "ED bay", licenseStatus: "placeholder-approved" },
            { assetId: "patient_robert_hayes_character", assetType: "character", description: "Chest pain patient", licenseStatus: "placeholder-approved" },
          ],
        },
        assetReadiness: {
          scenarioId: "ed_chest_pain_priority_v1",
          devReady: true,
          productionReady: false,
          missingRequiredAssetIds: [],
          blockedAssets: [],
          productionBlockedAssets: [
            { assetId: "patient_robert_hayes_character", blockers: ["placeholder_asset_not_clinical_release_ready"] },
          ],
        },
      },
    submitScenarioReview: async (input) => ({
      scenarioId: String(input.scenarioId),
      version: input.version,
      title: "Pediatric Asthma With Parent Anxiety",
      status: "READY_FOR_REVIEW",
      clinicalObjectives: ["Assess pediatric respiratory distress"],
      requiredTraceTags: ["oxygen_request", "urgent_escalation"],
      review: { clinical: "approved", psychometric: "draft", legal: "draft", simulationQa: "draft" },
      governance: {
        scoreUseLabel: "formative_local_only",
        syntheticCaseDisclosure: "Synthetic pediatric communication and urgent-care training draft; not validated for summative assessment.",
        validationStage: "stage_0_synthetic_draft",
        requiredReviewerRoles: ["pediatrician", "psychometrician", "legal", "simulation_qa"],
        sourceIds: ["src-openclinxr-sample-case-bank-v1"],
      },
      environment: {
        environmentId: "pediatric_urgent_care_bay_v1",
        name: "Pediatric urgent care bay",
        description: "Pediatric urgent care bay with parent seating and oxygen equipment.",
      },
      equipment: ["pulse oximeter", "nebulizer mask"],
      actors: [
        { actorId: "patient_maya_johnson_v1", role: "patient", displayName: "Maya Johnson", demeanor: "short sentences" },
      ],
      assetNeeds: [],
    }),
    listScenarioReviewDecisions: async (input) => [
      {
        scenarioId: String(input.scenarioId),
        version: input.version,
        reviewerRole: "clinical",
        reviewerId: "pediatrician_001",
        decision: "approved",
        comments: "Clinical review complete.",
        evidenceRefs: ["evidence:peds:clinical:2026-05-04"],
        reviewedAt: "2026-05-04T09:00:00.000Z",
      },
    ],
    getReviewPacketReplay: async (input) => ({
      reviewPacket: {
        stationRunId: input.stationRunId,
        scenarioId: "ed_chest_pain_priority_v1",
        observedTraceTags: ["ecg_request", "urgent_escalation"],
        missingRequiredTraceTags: ["team_communication"],
        lateTraceTags: [],
        unsafeEvents: [],
        timeline: [
          {
            sequence: 2,
            atSecond: 83,
            eventType: "learner.utterance",
            source: "learner",
            actorId: "patient_robert_hayes_v1",
            tag: "ecg_request",
            summary: "Learner requested an ECG.",
          },
        ],
        traceQuality: {
          eventCount: 4,
          modelGeneratedEventCount: 1,
          modelFailedEventCount: 0,
          voiceAudioEventCount: 0,
          blockedGuardrailCount: 0,
          unsafeEventCount: 0,
          missingRequiredTraceTagCount: 1,
          hasPatientNote: true,
          hasModelProvenance: true,
        },
        patientNote: {
          submittedAtSecond: 960,
          text: "Chest pain requires urgent ECG escalation.",
        },
        facultyScoreDraft: {
          reviewerId: "faculty_001",
          status: "draft",
          comments: "Needs team communication evidence.",
        },
      },
      traceEvents: [
        {
          sequence: 2,
          eventType: "learner.utterance",
          atSecond: 83,
          source: "learner",
          actorId: "patient_robert_hayes_v1",
          tag: "ecg_request",
        },
      ],
    }),
    saveFacultyScoreDraft: async (input) => ({
      stationRunId: String(input.stationRunId),
      scenarioId: "ed_chest_pain_priority_v1",
      observedTraceTags: ["ecg_request"],
      missingRequiredTraceTags: [],
      lateTraceTags: [],
      unsafeEvents: [],
      traceQuality: {
        eventCount: 3,
        modelGeneratedEventCount: 0,
        modelFailedEventCount: 0,
        voiceAudioEventCount: 0,
        blockedGuardrailCount: 0,
        unsafeEventCount: 0,
        missingRequiredTraceTagCount: 0,
        hasPatientNote: false,
        hasModelProvenance: false,
      },
      facultyScoreDraft: {
        reviewerId: String(input.reviewerId),
        status: "draft",
        comments: input.comments,
      },
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
