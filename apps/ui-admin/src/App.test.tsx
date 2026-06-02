import "@testing-library/jest-dom/vitest";
import { findUnsafeClaimLanguage } from "@openclinxr/domain/claim-language";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    const client = fakeControlPlaneClient();
    const getScenarioBankEnvironmentWorkOrderQueue = vi.fn(client.getScenarioBankEnvironmentWorkOrderQueue);
    client.getScenarioBankEnvironmentWorkOrderQueue = getScenarioBankEnvironmentWorkOrderQueue;
    const getScenarioBankSceneGenerationPipelineQueue = vi.fn(client.getScenarioBankSceneGenerationPipelineQueue);
    client.getScenarioBankSceneGenerationPipelineQueue = getScenarioBankSceneGenerationPipelineQueue;
    const listScenarioSceneGenerationRequests = vi.fn(client.listScenarioSceneGenerationRequests);
    client.listScenarioSceneGenerationRequests = listScenarioSceneGenerationRequests;
    const getRuntimeSelectionReviewPacket = vi.fn(client.getRuntimeSelectionReviewPacket);
    client.getRuntimeSelectionReviewPacket = getRuntimeSelectionReviewPacket;
    const submitRuntimeVisualEvidenceAttachment = vi.fn(client.submitRuntimeVisualEvidenceAttachment);
    client.submitRuntimeVisualEvidenceAttachment = submitRuntimeVisualEvidenceAttachment;
    const getDynamicEncounterFactoryPlanning = vi.fn(client.getDynamicEncounterFactoryPlanning);
    client.getDynamicEncounterFactoryPlanning = getDynamicEncounterFactoryPlanning;
    const createScenarioSceneGenerationRequest = vi.fn(client.createScenarioSceneGenerationRequest);
    client.createScenarioSceneGenerationRequest = createScenarioSceneGenerationRequest;
    const submitScenarioSceneGenerationRequestReview = vi.fn(client.submitScenarioSceneGenerationRequestReview);
    client.submitScenarioSceneGenerationRequestReview = submitScenarioSceneGenerationRequestReview;
    const getScenarioSceneGenerationRequestPublicationReadiness = vi.fn(client.getScenarioSceneGenerationRequestPublicationReadiness);
    client.getScenarioSceneGenerationRequestPublicationReadiness = getScenarioSceneGenerationRequestPublicationReadiness;

    render(<AdminApp initialPath="/exam-forms" controlPlaneClient={client} />);

    expect(await screen.findByText("12 stations")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Seed Exam Readiness" })).toBeInTheDocument();
    expect(screen.getByText("1 activation ready")).toBeInTheDocument();
    expect(screen.getByText("11 blocked drafts")).toBeInTheDocument();
    expect(screen.getByText("5h 12m total")).toBeInTheDocument();
    expect(screen.getByText("Breaks after stations 3, 6, 9")).toBeInTheDocument();
    expect(screen.getByText("12 dev-ready scenes")).toBeInTheDocument();
    expect(screen.getByText("0 production-ready scenes")).toBeInTheDocument();
    expect(screen.getAllByText("Learner launch blocked").length).toBeGreaterThan(0);
    expect(screen.getByText("10 draft, 1 governance blocked")).toBeInTheDocument();
    expect(getRuntimeSelectionReviewPacket).toHaveBeenCalledOnce();
    expect(getDynamicEncounterFactoryPlanning).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Dynamic Encounter Factory Planning" })).toBeInTheDocument();
    expect(screen.getByLabelText("Dynamic encounter factory planning")).toHaveTextContent("review_gated_factory_metadata_only");
    expect(screen.getByLabelText("Dynamic encounter factory planning metrics")).toHaveTextContent("provider false; runtime false; Quest false");
    expect(screen.getByLabelText("Dynamic encounter factory candidate summaries")).toHaveTextContent("ed_chest_pain_priority_v1");
    expect(screen.getByLabelText("Dynamic encounter factory candidate summaries")).toHaveTextContent("humanoid behavior contract actors 3; locomotion 3; expression 3; gaze 3; lip-sync 3; interactivity 3; emotion states 9; viseme mapping true; case_definition_humanoid_performance_metadata_only");
    expect(screen.getByLabelText("Operator review readiness metrics")).toHaveTextContent("not_ready_for_operator_review");
    expect(screen.getByLabelText("Operator review required actions")).toHaveTextContent("materialize_or_attach_generated_assets_before_guarded_runtime_wiring");
    expect(screen.getByRole("heading", { name: "Seed Exam Readiness Boundary" })).toBeInTheDocument();
    expect(screen.getByLabelText("Seed exam readiness boundary")).toHaveTextContent("Development placeholder scenes support local review only");
    expect(screen.getByLabelText("Seed exam readiness boundary")).toHaveTextContent("Runtime and provider readiness are not attached to this seed exam launch gate");
    expect(screen.getByText("Provider gate source: capability-routing-matrix; local-development deterministic replay is ready and live provider readiness is not ready.")).toBeInTheDocument();
    expect(screen.getByText("Runtime protocol posture: bun-hono primary with node-hono fallback; WebSocket is contract_ready until api_bun_websocket_runtime_not_verified clears.")).toBeInTheDocument();
    expect(screen.getByText("Realtime voice posture: websocket-media selected, Python proxy not_configured, cloud APIs used: no.")).toBeInTheDocument();
    expect(screen.getByText("12 development placeholder scenes")).toBeInTheDocument();
    expect(screen.getByText("12 production-blocked scenes")).toBeInTheDocument();
    expect(screen.getByText("11 station queue blockers")).toBeInTheDocument();
    expect(screen.getByText("1 deterministic replay profiles")).toBeInTheDocument();
    expect(screen.getByText("0 live-provider profiles ready")).toBeInTheDocument();
    expect(screen.getByText("2 runtime-ready protocols")).toBeInTheDocument();
    expect(screen.getByText("1 evidence-gated media lanes")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Runtime Selection Review Packet" })).toBeInTheDocument();
    expect(screen.getByLabelText("Runtime selection review packet")).toHaveTextContent("Provider-disabled review bundle");
    expect(screen.getByLabelText("Runtime selection review packet")).toHaveTextContent("read-only guarded runtime handoff");
    expect(screen.getByLabelText("Runtime selection review packet")).toHaveTextContent("runtime_selection_review_packet_not_runtime_execution");
    expect(screen.getByLabelText("Runtime selection reviewer checklist")).toHaveTextContent("confirm_selector_guard_remains_disabled");
    expect(screen.getByLabelText("Publication materialization metrics")).toHaveTextContent("materialized 0/8");
    expect(screen.getByLabelText("Publication materialization metrics")).toHaveTextContent("humanoids patient, family, nurse");
    expect(screen.getByLabelText("Publication materialization metrics")).toHaveTextContent("humanoid-realism-gate, runtime-realism-evidence-check, visual-qa-evidence-check");
    expect(screen.getByLabelText("Publication realism evidence trace")).toHaveTextContent("encounter-publication-realism://scenario/request/humanoid-realism-gate/3-actors");
    expect(screen.getByLabelText("Publication materialization blockers")).toHaveTextContent("humanoid_realism_requirement_actor_missing:family");
    expect(screen.getByLabelText("Prepare local XR handoff metrics")).toHaveTextContent("actor/equipment materialization evidence required");
    expect(screen.getByLabelText("Actor equipment materialization metrics")).toHaveTextContent("runtime selection blocked: true");
    expect(screen.getByLabelText("Actor equipment materialization metrics")).toHaveTextContent("shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness");
    expect(screen.getByLabelText("Actor equipment materialization metrics")).toHaveTextContent("generic_equipment_reuse_blocks_equipment_specific_asset_readiness");
    expect(screen.getByLabelText("Actor equipment materialization caveats")).toHaveTextContent("attach_actor_specific_humanoid_materialization_evidence");
    expect(screen.getByLabelText("Actor equipment materialization caveats")).toHaveTextContent("attach_equipment_specific_materialization_evidence");
    expect(screen.getByLabelText("Worker materialization input review decision metrics")).toHaveTextContent("2 materialization input decisions");
    expect(screen.getByLabelText("Worker materialization input review decision metrics")).toHaveTextContent("reviewed 1; held 1");
    expect(screen.getByLabelText("Worker materialization input review decision metrics")).toHaveTextContent("metadata_only_materialization_input_review_decisions");
    expect(screen.getByLabelText("Worker materialization input review decision metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false");
    expect(screen.getByLabelText("Worker materialization input review decision details")).toHaveTextContent("review_actor_materialization_inputs: reviewed_metadata_only");
    expect(screen.getByLabelText("Worker materialization input review decision details")).toHaveTextContent("hold_equipment_materialization_inputs: held_metadata_only");
    expect(screen.getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("36 missing attachment slots");
    expect(screen.getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("12 actor slots; 24 equipment slots");
    expect(screen.getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("metadata_only_materialization_attachment_plan");
    expect(screen.getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false");
    expect(screen.getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("actor_specific_body_profile_required");
    expect(screen.getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("clinical_affordance_evidence");
    expect(screen.getByLabelText("Worker materialization attachment blockers")).toHaveTextContent("actor_materialization_attachment_missing:patient_ed_chest_pain_v1:actor_specific_body_profile_required");
    expect(screen.getByLabelText("Worker materialization attachment blockers")).toHaveTextContent("equipment_materialization_attachment_missing:exam_room_ecg_cart:clinical_affordance_evidence");
    expect(screen.getByLabelText("Worker materialization evidence attachment metrics")).toHaveTextContent("36/36 attachment slots satisfied");
    expect(screen.getByLabelText("Worker materialization evidence attachment metrics")).toHaveTextContent("0 missing; 0 held or invalid");
    expect(screen.getByLabelText("Worker materialization evidence attachment metrics")).toHaveTextContent("metadata_only_materialization_evidence_attachment_summary");
    expect(screen.getByLabelText("Worker materialization evidence attachment metrics")).toHaveTextContent("all slots satisfied true; runtime false; learner false; Quest false");
    expect(screen.getByLabelText("Worker materialization evidence attachment blockers")).toHaveTextContent("materialization_evidence_attachment_missing:actor-materialization-attachment:patient_ed_chest_pain_v1:actor_specific_clothing_required");
    expect(screen.getByRole("button", { name: "Submit metadata-only runtime evidence ref" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Submit metadata-only runtime evidence ref" }));
    expect(submitRuntimeVisualEvidenceAttachment).toHaveBeenCalledWith(expect.objectContaining({
      scenarioId: "ed_chest_pain_priority_v1",
      attachments: [
        expect.objectContaining({
          actionId: "attach_runtime_realism_evidence_refs",
          inputId: "runtime-realism-evidence-input:patient_ed_chest_pain_v1",
          inputKind: "runtime_realism_signal_input",
          evidenceRef: "runtime-realism-evidence-input://patient",
          attachmentStatus: "attached_metadata_only",
        }),
      ],
    }));
    expect(await screen.findByText("1 metadata-only runtime visual evidence attachment ref accepted; launch gates remain blocked.")).toBeInTheDocument();
    expect(getRuntimeSelectionReviewPacket).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Runtime selection blockers")).toHaveTextContent("runtime_selector_disabled_guard_not_wired");
    expect(screen.getByLabelText("Runtime selection blockers")).toHaveTextContent("publication_payload_not_materialized");
    expect(screen.getAllByText("12 environment packets").length).toBeGreaterThan(0);
    expect(screen.getByText("12 generation-review blocked")).toBeInTheDocument();
    expect(screen.getAllByText("attach_environment_generation_evidence: 12").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "3D Environment Generation Queue" })).toBeInTheDocument();
    expect(screen.getByText("60 pending authoring tasks")).toBeInTheDocument();
    expect(screen.getByText("work_order_queue_not_asset_production")).toBeInTheDocument();
    expect(screen.getByText("108 pending pipeline stages")).toBeInTheDocument();
    expect(screen.getByText("scene_generation_pipeline_queue_not_asset_production")).toBeInTheDocument();
    expect(screen.getByText("0 scene generation requests")).toBeInTheDocument();
    expect(screen.getByText("scene_generation_request_queue_not_asset_production")).toBeInTheDocument();
    expect(screen.getByText("Scene pipeline: ed_chest_pain_priority_v1")).toBeInTheDocument();
    expect(getScenarioBankEnvironmentWorkOrderQueue).toHaveBeenCalledWith();
    expect(getScenarioBankSceneGenerationPipelineQueue).toHaveBeenCalledWith();
    expect(listScenarioSceneGenerationRequests).toHaveBeenCalledWith();
    fireEvent.click(screen.getByRole("button", { name: "Initiate scene generation request" }));
    expect(createScenarioSceneGenerationRequest).toHaveBeenCalledWith({ scenarioId: "ed_chest_pain_priority_v1" });
    expect(await screen.findByText("Scene generation request created")).toBeInTheDocument();
    expect(screen.getByText("scene_generation_request:ed_chest_pain_priority_v1:local-admin")).toBeInTheDocument();
    expect(screen.getByText("1 scene generation requests")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Attach local runtime review decisions" }));
    expect(submitScenarioSceneGenerationRequestReview).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
    }));
    expect(await screen.findByText("runtime_asset_review_attached")).toBeInTheDocument();
    expect(getScenarioSceneGenerationRequestPublicationReadiness).toHaveBeenCalledWith({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
    });
    expect(await screen.findByText("Publication gate: ready to run generated bundle publisher")).toBeInTheDocument();
    expect(screen.getByText("Materialization evidence attachments: 36/36 slots attached; missing 0; held or invalid 0; all slots satisfied true; blockers 2; runtime false; learner false; Quest false; metadata_only_materialization_evidence_attachment_summary")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check publication readiness" }));
    expect(getScenarioSceneGenerationRequestPublicationReadiness).toHaveBeenCalledTimes(2);
    expect(screen.getByText("websocket-media")).toBeInTheDocument();
    expect(screen.getByText("1 voice lanes rejected")).toBeInTheDocument();
    expect(screen.getByText("Clinical-skills seed form")).toBeInTheDocument();
    expect(screen.getByText("Formative local practice.")).toBeInTheDocument();
    expect(screen.getByText("Dialogue replay seeds not ready")).toBeInTheDocument();
    expect(screen.getByText("Station 9")).toBeInTheDocument();
    expect(screen.getAllByText("draft_blocked").length).toBe(10);
    expect(screen.getByText("governance_blocked")).toBeInTheDocument();
    expect(screen.getByText("Blocker IDs: dialogue_seed_replay_not_ready")).toBeInTheDocument();
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
    expect(screen.getByText("4 behavior profiles")).toBeInTheDocument();
    expect(screen.getByText("3 of 3 actors include behavior profiles for faculty review.")).toBeInTheDocument();
    const scenarioBankMaturity = screen.getByLabelText("Scenario bank maturity");
    expect(within(scenarioBankMaturity).getByRole("heading", { name: "Scenario Bank Maturity" })).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("admin/report surface only")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("This admin/report surface summarizes authoring, visual-loop, and asset maturity signals. It does not claim Quest, learner, or production readiness.")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("2 scenarios in bank")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("1 approved for local formative review")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("1 drafts awaiting gates")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("4 visual-loop review profiles")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("4 actors tracked in the scenario bank")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("4 actors with communication profiles")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("1 scenario with asset needs")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("1 asset need logged for separate asset review")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("6 scenario review blocker IDs")).toBeInTheDocument();
    const dynamicFactoryPlanning = screen.getByLabelText("Scenario bank dynamic encounter factory planning");
    expect(within(dynamicFactoryPlanning).getByRole("heading", { name: "Dynamic Encounter Factory Planning" })).toBeInTheDocument();
    expect(dynamicFactoryPlanning).toHaveTextContent("ed_chest_pain_priority_v2");
    expect(dynamicFactoryPlanning).toHaveTextContent("review_gated_factory_metadata_only");
    expect(screen.getByLabelText("Scenario bank dynamic encounter factory planning metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false");
    expect(screen.getByLabelText("Scenario bank dynamic encounter factory candidate summaries")).toHaveTextContent("ed_chest_pain_priority_v1");
    expect(screen.getByLabelText("Scenario bank dynamic encounter factory candidate summaries")).toHaveTextContent("humanoid behavior contract actors 3; locomotion 3; expression 3; gaze 3; lip-sync 3; interactivity 3; emotion states 9; viseme mapping true; case_definition_humanoid_performance_metadata_only");
    expect(screen.getByLabelText("Scenario bank dynamic encounter factory candidate summaries")).toHaveTextContent("not evidence for generated_humanoid_asset_readiness, animation_quality, quest_readiness, runtime_readiness, clinical_validity");
    expect(within(scenarioBankMaturity).getByText("scenario_status:DRAFT, clinical_review:draft, psychometric_review:draft")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("12 target stations")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("0 missing stations")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("1 activation eligible")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("11 blocked by gates")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("1 approved, 11 drafts, 0 retired")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("11 synthetic drafts, 1 expert-reviewed, 0 pilot-ready, 0 validated")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("12 clinical settings")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("0 missing actor roles")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("9 actor roles covered")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("consultant, family, interpreter, medical_assistant")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("4 actors with communication profiles")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("4 actors tracked in the admin report")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("12 traceability-complete scenarios")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("0 traceability gaps remain")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("hidden facts redacted")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("disclosure still requires trigger gates")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("12 multi-actor pressure scenarios")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("0 missing pressure actors")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("12 seeded dialogue scenarios")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("12 guardrail-probed scenarios")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("9 reusable shared-asset lookup keys")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("14 duplicate lookups; 10 LRU candidate scenarios")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("72 shared-asset lookup keys")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("scenario_bank_shared_asset_reuse_metadata_only; not evidence for generated_asset_readiness, shared_asset_library_materialization, quest_readiness, runtime_readiness, production_asset_readiness")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("top shared-asset reuse candidate")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("semantic::equipment::bedside_monitor across 2 scenarios")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("12 ordered stations")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("1 activation-ready station")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("11 draft-review stations")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("0 dialogue-replay gates")).toBeInTheDocument();
    expect(within(scenarioBankMaturity).getByText("This admin/report surface summarizes authoring, visual-loop, and asset maturity signals. It does not claim Quest, learner, or production readiness.")).toBeInTheDocument();

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
    expect(within(screen.getByLabelText("Scenario actors")).getByText("Robert Hayes")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Scenario production blockers")).getByText("patient_robert_hayes_character")).toBeInTheDocument();
    expect(screen.getByText("Dev-ready assets")).toBeInTheDocument();
    expect(screen.getByText("Production blocked")).toBeInTheDocument();
    expect(screen.getByText("2 release-ladder assets")).toBeInTheDocument();
    expect(screen.getByText("2 blocked for release")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Production Readiness Ladder" })).toBeInTheDocument();
    expect(screen.getByText("2 station assets in ladder; 2 evidence blockers remain.")).toBeInTheDocument();
    expect(screen.getByText("Release-ladder evidence supports faculty/operator review only; it does not establish Quest runtime readiness or learner launch.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Behavior Profile Review" })).toBeInTheDocument();
    expect(screen.getByText("3 of 3 actors include behavior profiles for faculty review.")).toBeInTheDocument();
    expect(screen.getByText("Supports faculty review of synthetic actor behavior; scenario status and score-use gates still control learner use.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Publication Blocker Visibility" })).toBeInTheDocument();
    expect(screen.getByText("target use: local_formative")).toBeInTheDocument();
    expect(screen.getByText("publication_blocker_visibility_not_readiness_claim")).toBeInTheDocument();
    expect(screen.getByText("human review required")).toBeInTheDocument();
    expect(screen.getByText("collect_required_reviewer_evidence")).toBeInTheDocument();
    expect(screen.getByText("Gate statuses:")).toBeInTheDocument();
    expect(screen.getByText("Missing reviewer roles: legal")).toBeInTheDocument();
    expect(screen.getByText("Blocker IDs: publication_gate_blocked:reviewer_evidence")).toBeInTheDocument();
    expect(screen.getByText("Warning IDs: publication_gate_warning:asset_readiness")).toBeInTheDocument();
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

  it("does not submit clinical approval when the required clinical reviewer role is missing", async () => {
    const client = fakeControlPlaneClient();
    const pediatricDraft = await client.getScenarioDetail({ scenarioId: "peds_asthma_parent_anxiety_v1", version: 1 });
    if (!pediatricDraft.scenario) {
      throw new Error("Expected pediatric draft scenario fixture");
    }
    const pediatricScenario = pediatricDraft.scenario;
    client.getScenarioDetail = async () => ({
      scenario: {
        ...pediatricScenario,
        scenarioId: "policy_only_draft_v1",
        title: "Policy Only Draft",
        governance: {
          ...pediatricScenario.governance,
          requiredReviewerRoles: ["psychometrician", "legal", "simulation_qa"],
        },
      },
      assetReadiness: pediatricDraft.assetReadiness,
    });
    const submitScenarioReview = vi.fn(client.submitScenarioReview);
    client.submitScenarioReview = submitScenarioReview;

    render(<AdminApp initialPath="/scenarios/policy_only_draft_v1?version=1" controlPlaneClient={client} />);

    expect(await screen.findByRole("heading", { name: "Policy Only Draft" })).toBeInTheDocument();
    const approvalButton = screen.getByRole("button", { name: "Record clinical approval" });
    expect(approvalButton).toBeDisabled();
    expect(screen.getByText("Clinical approval requires a clinical reviewer role in governance.")).toBeInTheDocument();

    fireEvent.click(approvalButton);

    expect(submitScenarioReview).not.toHaveBeenCalled();
  });

  it("renders review replay and saves a faculty score draft", async () => {
    const client = fakeControlPlaneClient();
    const getReviewPacketReplay = vi.fn(client.getReviewPacketReplay);
    const getReviewReplayReadinessSummary = vi.fn(client.getReviewReplayReadinessSummary);
    const saveFacultyScoreDraft = vi.fn(client.saveFacultyScoreDraft);
    client.getReviewPacketReplay = getReviewPacketReplay;
    client.getReviewReplayReadinessSummary = getReviewReplayReadinessSummary;
    client.saveFacultyScoreDraft = saveFacultyScoreDraft;

    render(<AdminApp initialPath="/reviews?stationRunId=run_ed_chest_pain_priority_v1_learner_001" controlPlaneClient={client} />);

    expect(await screen.findByRole("heading", { name: "Review Replay" })).toBeInTheDocument();
    expect(getReviewPacketReplay).toHaveBeenCalledWith({ stationRunId: "run_ed_chest_pain_priority_v1_learner_001" });
    expect(getReviewReplayReadinessSummary).toHaveBeenCalledWith({ stationRunId: "run_ed_chest_pain_priority_v1_learner_001" });
    expect(screen.getByText("ed_chest_pain_priority_v1")).toBeInTheDocument();
    expect(screen.getAllByText("team_communication").length).toBeGreaterThan(0);
    expect(screen.getByText("Learner requested an ECG.")).toBeInTheDocument();
    expect(screen.getByText("Chest pain requires urgent ECG escalation.")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Review flags")).getByText("delayed_team_escalation")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Review flags")).getByText("unsafe_discharge_reassurance")).toBeInTheDocument();
    const reviewSafeEvidenceBoundary = screen.getByLabelText("Review-safe evidence boundary");
    expect(within(reviewSafeEvidenceBoundary).getByRole("heading", { name: "Review-Safe Evidence Boundary" })).toBeInTheDocument();
    expect(within(reviewSafeEvidenceBoundary).getByText("Faculty changes recommended")).toBeInTheDocument();
    expect(within(reviewSafeEvidenceBoundary).getByText("Private clinical-event payloads stay out of the replay UI; durable events appear as redacted summary counts and trace links.")).toBeInTheDocument();
    expect(within(reviewSafeEvidenceBoundary).getByText("1 timeline entry")).toBeInTheDocument();
    expect(within(reviewSafeEvidenceBoundary).getByText("1 durable clinical event")).toBeInTheDocument();
    expect(within(reviewSafeEvidenceBoundary).getByText("1 private payload redactions")).toBeInTheDocument();
    expect(within(reviewSafeEvidenceBoundary).getByText("1 durable status count")).toBeInTheDocument();
    expect(within(reviewSafeEvidenceBoundary).getByText("completed: 1")).toBeInTheDocument();
    expect(within(reviewSafeEvidenceBoundary).getByText("Patient note attached")).toBeInTheDocument();
    expect(within(reviewSafeEvidenceBoundary).getByText("submitted at 960s")).toBeInTheDocument();
    expect(within(reviewSafeEvidenceBoundary).getByText("83s latest timeline")).toBeInTheDocument();
    expect(within(reviewSafeEvidenceBoundary).getByText("latest summary-only replay event")).toBeInTheDocument();
    const replayReadinessSummary = screen.getByLabelText("Review replay readiness summary");
    expect(within(replayReadinessSummary).getByRole("heading", { name: "Review Replay Readiness Summary" })).toBeInTheDocument();
    expect(within(replayReadinessSummary).getByText("summary_only_faculty_review_not_score_use")).toBeInTheDocument();
    expect(within(replayReadinessSummary).getByText("review_missing_required_behavior")).toBeInTheDocument();
    expect(within(replayReadinessSummary).getByText("missing_required_behavior")).toBeInTheDocument();
    expect(within(replayReadinessSummary).getByText("late_behavior_present")).toBeInTheDocument();
    expect(within(replayReadinessSummary).getAllByLabelText("XR trace evidence handoff").at(-1)).toHaveTextContent("ecg_request");
    expect(within(replayReadinessSummary).getByLabelText("Generated bundle blocked posture")).toHaveTextContent("Learner runtime blocked");
    expect(within(replayReadinessSummary).getByText("generated_bundle_posture_blocks_learner_use_until_evidence_gates_attach")).toBeInTheDocument();
    expect(within(replayReadinessSummary).getByLabelText("Review-safe learner launch link")).toHaveTextContent("Open learner runtime with this opaque bundle id");
    expect(within(replayReadinessSummary).getByRole("link", { name: "Open learner runtime with this opaque bundle id" })).toHaveAttribute(
      "href",
      "/xr?runtimeAssetBundleId=local_exam_run%3Aed_chest_pain_local_encounter%3Aruntime-assets&scenarioId=ed_chest_pain_priority_v1&stationId=ed_chest_pain_station_v1",
    );
    expect(within(replayReadinessSummary).getByLabelText("Replay evidence handoff")).toHaveTextContent("1 actor turns");
    expect(within(replayReadinessSummary).getByText("patient_note:run_ed_chest_pain_priority_v1_learner_001:960")).toBeInTheDocument();
    expect(within(replayReadinessSummary).getByLabelText("Runtime evidence gate refs")).toHaveTextContent("runtime_realism_evidence: pending");
    expect(within(replayReadinessSummary).getByLabelText("Runtime evidence gate refs")).toHaveTextContent("quest_runtime_evidence_not_attached_to_encounter_bundle");
    expect(within(replayReadinessSummary).getByLabelText("Case-defined humanoid performance metadata")).toHaveTextContent("3 humanoid actors");
    expect(within(replayReadinessSummary).getByLabelText("Case-defined humanoid performance metadata")).toHaveTextContent("case_definition_humanoid_performance_metadata_only");
    const facultyDecisionHandoff = screen.getByLabelText("Faculty review decision handoff");
    expect(within(facultyDecisionHandoff).getByRole("heading", { name: "Faculty Review Decision Handoff" })).toBeInTheDocument();
    expect(within(facultyDecisionHandoff).getByText("Needs scenario iteration")).toBeInTheDocument();
    expect(within(facultyDecisionHandoff).getByText("Canonical replay action: review_missing_required_behavior")).toBeInTheDocument();
    expect(within(facultyDecisionHandoff).getByLabelText("Case-defined humanoid performance metadata")).toHaveTextContent("lip-sync roles patient, nurse, family");
    expect(within(facultyDecisionHandoff).getByLabelText("Faculty runtime visual evidence context")).toHaveTextContent("3 accepted metadata refs");
    expect(within(facultyDecisionHandoff).getByLabelText("Faculty runtime visual evidence context")).toHaveTextContent("raw payload hidden");
    expect(within(facultyDecisionHandoff).getByLabelText("Faculty runtime visual evidence context")).toHaveTextContent("runtime false; learner false; Quest false; production false");
    expect(within(facultyDecisionHandoff).getByLabelText("Faculty runtime visual evidence follow-up actions")).toHaveTextContent("review 3 accepted metadata-only runtime/visual refs");
    expect(within(facultyDecisionHandoff).getByLabelText("Faculty runtime visual evidence follow-up actions")).toHaveTextContent("keep runtime, learner, Quest, production, clinical, and scoring gates blocked");
    expect(within(facultyDecisionHandoff).getByLabelText("Faculty asset release ladder context")).toHaveTextContent("7 blocked");
    expect(within(facultyDecisionHandoff).getByLabelText("Faculty asset release ladder context")).toHaveTextContent("runtime false; learner false; Quest false; production false");
    expect(within(facultyDecisionHandoff).getByText("Summary-only durable clinical-event evidence is attached and safe for faculty review.")).toBeInTheDocument();
    const reviewerDecisionPostureMetrics = within(facultyDecisionHandoff).getByLabelText("Reviewer decision posture metrics");
    expect(within(reviewerDecisionPostureMetrics).getByText("Faculty draft draft")).toBeInTheDocument();
    expect(within(reviewerDecisionPostureMetrics).getByText("reviewer faculty_001")).toBeInTheDocument();
    expect(within(reviewerDecisionPostureMetrics).getByText("Draft comments present")).toBeInTheDocument();
    expect(within(reviewerDecisionPostureMetrics).getByText("Needs team communication evidence.")).toBeInTheDocument();
    expect(within(reviewerDecisionPostureMetrics).getByText("Patient note attached")).toBeInTheDocument();
    expect(within(reviewerDecisionPostureMetrics).getByText("submitted at 960s")).toBeInTheDocument();
    expect(within(facultyDecisionHandoff).getByText("Review missing required behavior evidence before using this replay for debrief.")).toBeInTheDocument();
    const facultyReviewPosture = screen.getByLabelText("Faculty review posture");
    expect(within(facultyReviewPosture).getByRole("heading", { name: "Faculty Review Posture" })).toBeInTheDocument();
    expect(within(facultyReviewPosture).getByText("Changes requested draft recommended")).toBeInTheDocument();
    expect(within(facultyReviewPosture).getByText("1 missing required trace tag")).toBeInTheDocument();
    expect(within(facultyReviewPosture).getByText("1 safety flag")).toBeInTheDocument();
    expect(within(facultyReviewPosture).getByText("Patient note available for faculty review.")).toBeInTheDocument();
    const assessmentBoundary = screen.getByLabelText("Assessment use boundary");
    expect(within(assessmentBoundary).getByRole("heading", { name: "Assessment Use Boundary" })).toBeInTheDocument();
    expect(within(assessmentBoundary).getByText("Formative local practice only")).toBeInTheDocument();
    expect(within(assessmentBoundary).getByText("Use only for local formative practice and debrief preparation until approved score-use evidence is complete.")).toBeInTheDocument();
    expect(findUnsafeClaimLanguage(assessmentBoundary.textContent ?? "")).toEqual([]);
    const facultyActionChecklist = screen.getByLabelText("Faculty action checklist");
    expect(within(facultyActionChecklist).getByRole("heading", { name: "Faculty Action Checklist" })).toBeInTheDocument();
    expect(within(facultyActionChecklist).getByText("Address missing required behavior evidence")).toBeInTheDocument();
    expect(within(facultyActionChecklist).getByText("team_communication")).toBeInTheDocument();
    expect(within(facultyActionChecklist).getByText("Review safety flags before debrief")).toBeInTheDocument();
    expect(within(facultyActionChecklist).getByText("unsafe_discharge_reassurance")).toBeInTheDocument();
    expect(within(facultyActionChecklist).getByText("Review late time-critical behaviors")).toBeInTheDocument();
    expect(within(facultyActionChecklist).getByText("delayed_team_escalation")).toBeInTheDocument();
    expect(within(facultyActionChecklist).getByText("Use patient note during debrief review")).toBeInTheDocument();
    const durableClinicalEventSummary = screen.getByLabelText("Durable clinical-event review summary");
    expect(within(durableClinicalEventSummary).getByRole("heading", { name: "Clinical Event Review Summary" })).toBeInTheDocument();
    expect(within(durableClinicalEventSummary).getByText("Review safe")).toBeInTheDocument();
    expect(within(durableClinicalEventSummary).getByText("1 clinical event")).toBeInTheDocument();
    expect(within(durableClinicalEventSummary).getByText("1 redacted")).toBeInTheDocument();
    expect(within(durableClinicalEventSummary).getByText("summary only, no private payloads")).toBeInTheDocument();

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

    const replayWorkbench = screen.getByRole("heading", { name: "Review Replay" }).closest("section");
    expect(replayWorkbench).not.toBeNull();
    expect(findUnsafeClaimLanguage(replayWorkbench?.textContent ?? "")).toEqual([]);
    expect(replayWorkbench?.textContent).not.toContain("Father died of myocardial infarction");
    expect(replayWorkbench?.textContent).not.toContain("hiddenFacts");
  });

  it("shows review-packet unsafe events when raw trace events are not available", async () => {
    const client = fakeControlPlaneClient();
    const getReviewPacketReplay = client.getReviewPacketReplay;
    client.getReviewPacketReplay = async (input) => ({
      ...(await getReviewPacketReplay(input)),
      traceEvents: [],
    });

    render(<AdminApp initialPath="/reviews?stationRunId=run_ed_chest_pain_priority_v1_learner_001" controlPlaneClient={client} />);

    expect(await screen.findByRole("heading", { name: "Review Replay" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Review flags")).getByText("unsafe_discharge_reassurance")).toBeInTheDocument();
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
    const savedSnapshots: Awaited<ReturnType<typeof client.createStep2CsSeedStationRunQueueSnapshot>>[] = [];
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

function fakeCommunicationProfile(style: string = "rationalizer") {
  return {
    styleFamily: "satir",
    style,
    intensity: 0.5,
    baselineMood: ["focused"],
    communicativeness: "Provides concise behavior evidence for faculty review.",
    topicsToAvoid: ["overclaiming_readiness"],
    adverseResponse: "Requests clearer boundaries when learner-use claims are overstated.",
    deescalationTriggers: ["formative_boundary_named"],
    escalationTriggers: ["score_use_overclaim"],
    culturalLanguageNotes: ["plain language", "review-only framing"],
  };
}

function fakeProductionReadinessLadder(scenarioId: string, assetIds: string[]) {
  return {
    scenarioId,
    productionReady: false,
    assetCount: assetIds.length,
    productionReadyAssetIds: [],
    blockedAssetIds: assetIds,
    missingRequiredAssetIds: [],
    blockers: assetIds.map((assetId) => `${assetId}:visual_clinical_critique_missing`),
    stationBudget: {
      maxVisibleTriangles: 180000,
      maxTextureMegabytes: 512,
      maxDrawCalls: 120,
      totalTriangles: 48000,
      totalTextureMegabytes: 72,
      totalDrawCalls: 24,
      blockers: [],
    },
    assetLadders: assetIds.map((assetId) => ({
      assetId,
      scenarioId,
      productionReady: false,
      blockers: ["visual_clinical_critique_missing"],
      steps: [
        { step: "provenance_license", status: "complete", evidenceRefs: [`${assetId}:license`], blockers: [] },
        { step: "visual_clinical_critique", status: "blocked", evidenceRefs: [], blockers: ["visual_clinical_critique_missing"] },
      ],
    })),
  };
}

function fakeRuntimeProviderReadiness() {
  return {
    source: "capability-routing-matrix",
    claimBoundary: "deterministic_replay_ready_is_not_live_provider_readiness",
    surfaces: [
      {
        profile: "local-development",
        deterministicReplayReady: true,
        liveInteractiveProviderReady: false,
        interactiveRuntime: {
          readyCapabilityIds: ["model-dialogue", "voice-synthesis"],
          notConfiguredCapabilityIds: [],
          plannedCapabilityIds: [],
          blockedCapabilityIds: [],
        },
        assetPipeline: {
          readyCapabilityIds: [],
          notConfiguredCapabilityIds: [],
          plannedCapabilityIds: ["character-generation"],
          blockedCapabilityIds: [],
        },
        persistence: {
          readyCapabilityIds: ["persistence"],
          notConfiguredCapabilityIds: [],
          plannedCapabilityIds: [],
          blockedCapabilityIds: [],
        },
        warnings: ["deterministic_mock_only_not_live_provider_readiness"],
      },
    ],
  };
}

function fakeRuntimeProtocolPosture() {
  return {
    primaryRuntimeTarget: "bun-hono",
    localFallbackRuntimeTarget: "node-hono",
    azureRuntimeTarget: "azure-functions-node",
    protocols: [
      {
        protocolId: "http-rest",
        status: "ready",
        claimScope: "runtime_ready",
        runtimeTarget: "bun-hono",
        role: "control-plane",
        clinicalMediaAllowed: false,
        path: "/",
        blockers: [],
        notes: "Main API surface.",
      },
      {
        protocolId: "admin-graphql",
        status: "ready",
        claimScope: "runtime_ready",
        runtimeTarget: "bun-hono",
        role: "admin-graphql",
        clinicalMediaAllowed: false,
        path: "/admin/graphql",
        blockers: [],
        notes: "Admin contract.",
      },
      {
        protocolId: "websocket",
        status: "contract_ready",
        claimScope: "contract_only",
        runtimeTarget: "bun-hono",
        role: "media-transport",
        clinicalMediaAllowed: true,
        path: "/voice/realtime/ws",
        blockers: ["api_bun_websocket_runtime_not_verified"],
        notes: "Evidence required before runtime-ready claim.",
      },
    ],
  };
}

function fakeRealtimeVoicePosture() {
  return {
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsPerformed: false,
      productionUseAllowed: false,
    },
    transports: {
      websocket: { status: "working_spike_transport", path: "/voice/realtime/ws", codec: "opus" },
      webTransport: { status: "blocked_pending_runtime_support", blockers: ["quest_webtransport_path_not_verified"] },
    },
    gatewayRuntime: {
      target: "bun-hono-http3",
      localVerifiedFallback: "node-hono-ws",
      blockers: [],
    },
    backends: {
      pythonFastApi: {
        status: "source_present_not_executed",
        websocketPath: "/voice/realtime/ws",
        transportProxy: {
          status: "not_configured",
          backendUrlConfigured: false,
          readyForLiveDialog: false,
          blockers: ["python_backend_websocket_url_not_configured"],
        },
        blockers: ["python_backend_not_executed"],
      },
    },
    protocolLanes: [
      {
        id: "websocket-media",
        protocol: "websocket",
        role: "media-transport",
        status: "working_spike_transport",
        mediaAllowed: true,
        blockers: [],
        notes: "WebSocket media lane.",
      },
      {
        id: "webtransport-http3-media",
        protocol: "webtransport",
        role: "media-transport",
        status: "proposal_required",
        mediaAllowed: false,
        blockers: ["quest_webtransport_path_not_verified"],
        notes: "Evidence gated future lane.",
      },
    ],
    recommendedProtocolSelection: {
      selectedLane: {
        id: "websocket-media",
        protocol: "websocket",
        role: "media-transport",
        status: "working_spike_transport",
        mediaAllowed: true,
        blockers: [],
        notes: "WebSocket media lane.",
      },
      rejectedLaneReasons: [
        { id: "webtransport-http3-media", reason: "proposal_required", blockers: ["quest_webtransport_path_not_verified"] },
      ],
    },
  };
}

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
        status: index === 0 ? "activation_ready" : index === 1 ? "governance_blocked" : "draft_blocked",
        blockers: index === 0 ? [] : index === 1 ? ["dialogue_seed_replay_not_ready"] : ["scenario_not_approved"],
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
      summary: { activationReady: 1, draftBlocked: 10, governanceBlocked: 1, missingScenario: 0 },
    }),
    getRuntimeProviderReadiness: async () => fakeRuntimeProviderReadiness(),
    getDynamicEncounterFactoryPlanning: async () => ({
      source: "scenario_bank_dynamic_encounter_factory_planning",
      claimBoundary: "review_gated_factory_metadata_only",
      anchorScenarioId: "ed_chest_pain_priority_v1",
      nextFactoryPlanningScenarioId: "ed_chest_pain_priority_v2",
      nextFactoryPlanningScenarioSelectionMode: "next_scenario_fallback",
      learnerUseBoundary: "activation_ready_only",
      scenarios: [
        {
          factoryPlanningOrder: 1,
          scenarioId: "ed_chest_pain_priority_v1",
          title: "Emergency chest pain priority assessment",
          encounterFactoryInputSummary: {
            factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
            actorAssetWorkOrderCount: 3,
            environmentAssetWorkOrderCount: 1,
            equipmentAssetWorkOrderCount: 6,
            sharedAssetLookupKeys: ["actor:patient", "actor:family"],
            dynamicBehaviorTraceTags: ["ecg_request", "family_communication"],
          },
          humanoidPerformanceContract: {
            claimBoundary: "case_definition_humanoid_performance_metadata_only",
            actorCount: 3,
            locomotionActorRoles: ["family", "nurse", "patient"],
            expressionActorRoles: ["family", "nurse", "patient"],
            gazeActorRoles: ["family", "nurse", "patient"],
            lipSyncActorRoles: ["family", "nurse", "patient"],
            interactiveActorRoles: ["family", "nurse", "patient"],
            emotionStateCount: 9,
            dialogueDrivenVisemeMappingRequired: true,
            gazeTargetingRequired: true,
            locomotionPlanningRequired: true,
            notEvidenceFor: [
              "generated_humanoid_asset_readiness",
              "animation_quality",
              "quest_readiness",
              "runtime_readiness",
              "clinical_validity",
            ],
          },
        },
      ],
      routeContractBoundary: {
        posture: "read_only_review_packet",
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
      },
    }),
    getRuntimeSelectionReviewPacket: async () => ({
      schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1",
      source: "api_local_runtime_bundle_fixture",
      reviewPacketMode: "read_only_guarded_runtime_handoff",
      selectedScenarioId: "ed_chest_pain_priority_v1",
      selectedEncounterId: "ed_chest_pain_local_encounter",
      selectedStationId: "ed_chest_pain_station_v1",
      selectedRuntimeAssetBundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
      handoffArtifactsInternallyPaired: true,
      runtimeCandidates: { model: "mock", voice: "mock" },
      guardedRuntimeSelectorDecision: {
        selectionStatus: "disabled_guard_not_runtime_execution",
        claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution",
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        providerExecutionPerformed: false,
        uiLaunchPerformed: false,
        questEvidenceRefreshed: false,
        blockers: ["runtime_selector_disabled_guard_not_wired"],
      },
      publicationPayloadLinkage: {
        source: "encounter_publication_payloads",
        status: "blocked",
        blockers: ["humanoid_realism_requirement_actor_missing:family"],
        localMaterializationHandoff: {
          requestId: "encounter_assets_ed_chest_pain_priority_executable_v1",
          scenarioId: "ed_chest_pain_priority_v2",
          rootPath: ".openclinxr/encounter-factory/ed_chest_pain_priority_v2/encounter_assets_ed_chest_pain_priority_executable_v1",
          plannedOutputCount: 8,
          materializedOutputCount: 0,
          allOutputsPlannedMetadataOnly: true,
        },
        assetNeedsReadiness: {
          readyForDeterministicGeneration: true,
          missingRequiredAssetNeedIds: [],
          blockers: [],
          requiredHumanoidRoles: ["patient", "family", "nurse"],
          animationRequirementCount: 3,
          emotionRequirementCount: 3,
          gazeRequirementCount: 3,
          lipSyncRequirementCount: 3,
          sharedAssetLibrarySemanticKeyCount: 8,
        },
        realismEvidenceRefs: {
          claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence",
          refIds: ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"],
          refs: [
            { refId: "humanoid-realism-gate", evidenceRef: "encounter-publication-realism://scenario/request/humanoid-realism-gate/3-actors", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached", notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] },
          ],
          requiredBefore: "guarded_runtime_wiring",
          runtimeExecutionAllowed: false,
          providerExecutionPerformed: false,
          questReadinessClaimed: false,
        },
        actorEquipmentMaterializationGate: {
          claimBoundary: "actor_equipment_materialization_contract_not_runtime_readiness",
          runtimeSelectionBlockedUntilEvidenceAttached: true,
          actorBlockers: ["shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness"],
          equipmentBlockers: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"],
          caveats: [
            "shared_neutral_humanoid_reuse_is_local_runtime_scaffolding_until_actor_specific_mesh_rig_hair_face_clothing_animation_evidence_attaches",
            "generic_equipment_reuse_is_local_runtime_scaffolding_until_equipment_specific_mesh_prefab_scale_placement_affordance_variant_evidence_attaches",
          ],
          recommendedNextActions: [
            "attach_actor_specific_humanoid_materialization_evidence",
            "attach_equipment_specific_materialization_evidence",
          ],
          notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
        },
      },
      operatorReviewReadiness: {
        status: "not_ready_for_operator_review",
        reviewedArtifactCount: 4,
        blockingArtifactCount: 2,
        blockerIds: ["runtime_selector_disabled_guard_not_wired", "publication_payload_not_materialized"],
        requiredOperatorActions: [
          "materialize_or_attach_generated_assets_before_guarded_runtime_wiring",
          "attach_actor_specific_humanoid_materialization_evidence",
          "attach_equipment_specific_materialization_evidence",
          "attach_humanoid_runtime_visual_qa_evidence_refs",
          "confirm_provider_execution_remains_disabled_until_explicit_approval",
          "confirm_runtime_selector_remains_disabled_until_evidence_gates_clear",
        ],
        materializationRequiredBeforeRuntime: true,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "operator_review_readiness_metadata_only",
      },
      materializationInputReviewDecisionRecord: {
        schemaVersion: "openclinxr.encounter-materialization-input-review-decision-record.v1",
        source: "admin_materialization_input_review_decisions",
        requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
        scenarioId: "ed_chest_pain_priority_v1",
        decisionCount: 2,
        reviewedDecisionCount: 1,
        heldDecisionCount: 1,
        decisions: [
          {
            actionId: "review_actor_materialization_inputs",
            reviewerId: "asset_pipeline_reviewer",
            decision: "reviewed_metadata_only",
            comments: "Actor materialization input metadata reviewed; evidence remains required.",
            evidenceRefs: ["encounter-materialization-input-manifest-ed-chest-pain-2026-05-28"],
            reviewedAt: "2026-05-28T06:40:00.000Z",
          },
          {
            actionId: "hold_equipment_materialization_inputs",
            reviewerId: "asset_pipeline_reviewer",
            decision: "held_metadata_only",
            comments: "Equipment input metadata held until equipment-specific evidence attaches.",
            evidenceRefs: ["encounter-materialization-input-manifest-ed-chest-pain-2026-05-28"],
            reviewedAt: "2026-05-28T06:41:00.000Z",
          },
        ],
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_materialization_input_review_decisions",
        notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
      },
      materializationAttachmentPlanSummary: {
        schemaVersion: "openclinxr.encounter-materialization-attachment-plan-summary.v1",
        source: "encounter_materialization_attachment_plan",
        scenarioId: "ed_chest_pain_priority_v1",
        actorAttachmentSlotCount: 12,
        equipmentAttachmentSlotCount: 24,
        missingAttachmentCount: 36,
        actorRequiredCueIds: [
          "actor_specific_body_profile_required",
          "actor_specific_clothing_required",
          "actor_specific_hair_face_required",
          "actor_specific_rig_preservation_required",
        ],
        equipmentRequiredCueIds: [
          "scenario_specific_equipment_variant_evidence",
          "equipment_scale_validation_evidence",
          "equipment_placement_anchor_evidence",
          "clinical_affordance_evidence",
        ],
        blockerIds: [
          "actor_materialization_attachment_missing:patient_ed_chest_pain_v1:actor_specific_body_profile_required",
          "equipment_materialization_attachment_missing:exam_room_ecg_cart:clinical_affordance_evidence",
        ],
        providerExecutionPerformed: false,
        runtimeSelectionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_materialization_attachment_plan",
      },
      materializationEvidenceAttachmentSummary: {
        schemaVersion: "openclinxr.encounter-materialization-evidence-attachment-summary.v1",
        source: "encounter_materialization_evidence_attachments",
        scenarioId: "ed_chest_pain_priority_v1",
        totalRequiredSlotCount: 36,
        attachedSlotCount: 36,
        missingSlotCount: 0,
        heldOrInvalidAttachmentCount: 0,
        allRequiredSlotsSatisfied: true,
        blockerIds: [
          "materialization_evidence_attachment_missing:actor-materialization-attachment:patient_ed_chest_pain_v1:actor_specific_clothing_required",
          "materialization_evidence_attachment_missing:equipment-materialization-attachment:exam_room_ecg_cart:clinical_affordance_evidence",
        ],
        providerExecutionPerformed: false,
        runtimeSelectionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_materialization_evidence_attachment_summary",
      },
      runtimeRealismEvidenceInputReviewDecisionRecord: {
        schemaVersion: "openclinxr.runtime-realism-evidence-input-review-decision-record.v1",
        source: "admin_runtime_realism_evidence_input_review_decisions",
        scenarioId: "ed_chest_pain_priority_v1",
        decisionCount: 2,
        reviewedDecisionCount: 1,
        heldDecisionCount: 1,
        decisions: [
          {
            inputId: "runtime-realism-evidence-input:patient_ed_chest_pain_v1",
            inputKind: "runtime_realism_signal_input",
            reviewerId: "runtime_reviewer",
            decision: "reviewed_metadata_only",
            comments: "Runtime actor evidence input reviewed as metadata only.",
            evidenceRefs: ["runtime-realism-evidence-input://patient"],
            reviewedAt: "2026-05-28T10:20:00.000Z",
          },
          {
            inputId: "visual-qa-evidence-input:exam_room_ecg_cart",
            inputKind: "visual_qa_review_input",
            reviewerId: "runtime_reviewer",
            decision: "held_metadata_only",
            comments: "Visual QA equipment input held until evidence attaches.",
            evidenceRefs: ["visual-qa-evidence-input://ecg-cart"],
            reviewedAt: "2026-05-28T10:21:00.000Z",
          },
        ],
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "metadata_only_runtime_realism_evidence_input_review_decisions",
        notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
      },
      runtimeVisualEvidenceAttachmentSummary: {
        schemaVersion: "openclinxr.runtime-realism-evidence-attachment-summary.v1",
        source: "runtime_realism_evidence_input_review_decisions",
        scenarioId: "ed_chest_pain_priority_v1",
        runtimeActorEvidenceInputCount: 1,
        visualQaEvidenceInputCount: 1,
        reviewedMetadataOnlyCount: 1,
        heldMetadataOnlyCount: 1,
        attachedRuntimeEvidenceCount: 0,
        attachedVisualQaEvidenceCount: 0,
        reviewedMetadataOnlyInputIds: ["runtime-realism-evidence-input:patient_ed_chest_pain_v1"],
        heldMetadataOnlyInputIds: ["visual-qa-evidence-input:exam_room_ecg_cart"],
        blockerIds: [
          "runtime_realism_evidence_not_attached_to_encounter_bundle",
          "visual_qa_evidence_not_attached_to_encounter_bundle",
        ],
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "runtime_visual_evidence_attachment_summary_metadata_only_until_artifacts_attach",
        notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
      },
      runtimeVisualEvidenceAttachmentActionPacket: {
        schemaVersion: "openclinxr.runtime-visual-evidence-attachment-action-packet.v1",
        source: "runtime_visual_evidence_attachment_summary",
        scenarioId: "ed_chest_pain_priority_v1",
        actionMode: "metadata_only_attachment_actions_not_runtime_execution",
        availableActions: [
          {
            actionId: "attach_runtime_realism_evidence_refs",
            status: "available",
            requiredInputCount: 1,
            reviewedMetadataOnlyCount: 1,
            heldMetadataOnlyCount: 0,
            attachedEvidenceCount: 0,
            blockerIds: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
            providerExecutionAllowed: false,
            runtimeExecutionAllowed: false,
            learnerLaunchAllowed: false,
            claimBoundary: "runtime_visual_evidence_attachment_action_not_runtime_execution",
          },
          {
            actionId: "attach_visual_qa_evidence_refs",
            status: "available",
            requiredInputCount: 1,
            reviewedMetadataOnlyCount: 0,
            heldMetadataOnlyCount: 1,
            attachedEvidenceCount: 0,
            blockerIds: ["visual_qa_evidence_not_attached_to_encounter_bundle"],
            providerExecutionAllowed: false,
            runtimeExecutionAllowed: false,
            learnerLaunchAllowed: false,
            claimBoundary: "runtime_visual_evidence_attachment_action_not_runtime_execution",
          },
        ],
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "metadata_only_runtime_visual_evidence_attachment_actions",
        notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
      },
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      providerExecutionPerformed: false,
      uiLaunchPerformed: false,
      questEvidenceRefreshed: false,
      broadVerificationPerformed: false,
      reviewerChecklist: [
        { checkId: "confirm_selector_guard_remains_disabled", status: "required_before_runtime_wiring", blockerIds: ["runtime_selector_disabled_guard_not_wired"] },
      ],
      blockers: ["runtime_selector_disabled_guard_not_wired", "publication_payload_not_materialized"],
      nextAllowedStep: "review_publication_materialization_blockers_before_guarded_wiring",
      claimBoundary: "runtime_selection_review_packet_not_runtime_execution",
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    }),
    getRuntimeProtocolPosture: async () => fakeRuntimeProtocolPosture(),
    getRealtimeVoicePosture: async () => fakeRealtimeVoicePosture(),
    createLocalReviewReplaySeed: async () => ({
      stationRunId: "run_ed_chest_pain_priority_v1_admin_review_seed",
    }),
    getReviewReplayReadinessSummary: async (input) => ({
      stationRunId: input.stationRunId,
      replayEvidenceReady: false,
      facultyReviewSafe: true,
      timelineEntryCount: 1,
      traceEventCount: 2,
      durableEventCount: 1,
      redactedDurableEventCount: 1,
      missingRequiredBehaviorCount: 1,
      lateBehaviorCount: 1,
      safetySignalCount: 1,
      blockers: ["missing_required_behavior", "late_behavior_present"],
      recommendedNextAction: "review_missing_required_behavior",
      replayBoundary: "summary_only_faculty_review_not_score_use",
      xrTraceEvidenceSummary: {
        stationRunId: input.stationRunId,
        source: "ui_xr_runtime_trace",
        evidenceRef: "window.__openClinXrTraceActionHandoffEvidence",
        activeLocomotionSource: "keyboard",
        locomotionDistanceMeters: 0.4,
        locomotionTurnRadians: 0.12,
        interactionSignalRefs: ["trace_action:ecg_request", "dom_click_trace_button"],
        latestTraceTag: "ecg_request",
        latestTraceLatencyMs: 12.5,
        blockers: ["headset_input_not_claimed"],
        claimBoundary: "xr_trace_evidence_summary_not_score_use_quest_readiness_clinical_validity_or_raw_payload_readiness",
      },
      runtimeEvidenceGateRefs: [
        {
          gateId: "runtime_realism_evidence",
          status: "pending",
          evidenceRefs: [],
          requiredSignalIds: ["dialogue_viseme_and_gaze_mapping"],
          blockers: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
          notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
          claimBoundary: "runtime_evidence_gate_ref_not_learner_or_quest_readiness",
        },
        {
          gateId: "quest_runtime_evidence",
          status: "pending",
          evidenceRefs: [],
          requiredSignalIds: ["worn_headset_or_documented_quest_webxr_evidence"],
          blockers: ["quest_runtime_evidence_not_attached_to_encounter_bundle"],
          notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
          claimBoundary: "runtime_evidence_gate_ref_not_learner_or_quest_readiness",
        },
      ],
      generatedBundlePosture: {
        bundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
        scenarioId: "ed_chest_pain_priority_v1",
        stationId: "ed_chest_pain_station_v1",
        status: "blocked",
        learnerRuntimeUseBlocked: true,
        learnerRuntimeUseBlockers: [
          "runtime_realism_evidence_not_attached_to_encounter_bundle",
          "quest_runtime_evidence_not_attached_to_encounter_bundle",
        ],
        pendingEvidenceGateIds: ["runtime_realism_evidence", "quest_runtime_evidence"],
        attachedEvidenceGateIds: [],
        publicationArtifactRefs: {
          sceneManifest: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets:scene-manifest.v1.json",
          learnerRuntimeBundle: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets:learner-runtime-bundle.v1.json",
        },
        claimBoundary: "generated_bundle_posture_blocks_learner_use_until_evidence_gates_attach",
        notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
      },
      reviewPacketEvidenceHandoff: {
        reviewPacketRef: `review_packet:${input.stationRunId}`,
        traceEventRefs: [`trace_event:${input.stationRunId}:2`, `trace_event:${input.stationRunId}:3`],
        patientNoteRef: `patient_note:${input.stationRunId}:960`,
        actorTurnRefs: [`actor_turn:${input.stationRunId}:4`],
        timelineEntryCount: 1,
        patientNoteAttached: true,
        actorTurnCount: 1,
        privatePayloadRedacted: true,
        claimBoundary: "review_packet_handoff_summary_only_no_private_payloads",
      },
      caseDefinedHumanoidPerformanceContract: {
        claimBoundary: "case_definition_humanoid_performance_metadata_only",
        actorCount: 3,
        locomotionActorRoles: ["patient", "nurse", "family"],
        expressionActorRoles: ["patient", "nurse", "family"],
        gazeActorRoles: ["patient", "nurse", "family"],
        lipSyncActorRoles: ["patient", "nurse", "family"],
        interactiveActorRoles: ["patient", "nurse", "family"],
        emotionStateCount: 2,
        dialogueDrivenVisemeMappingRequired: true,
        gazeTargetingRequired: true,
        locomotionPlanningRequired: true,
        notEvidenceFor: [
          "generated_humanoid_asset_readiness",
          "animation_quality",
          "quest_readiness",
          "runtime_readiness",
          "clinical_validity",
        ],
      },
      runtimeVisualEvidenceReplayProjection: {
        schemaVersion: "openclinxr.runtime-visual-evidence-replay-projection.v1",
        source: "runtime_visual_evidence_attachment_record_summary",
        stationRunId: input.stationRunId,
        scenarioId: "ed_chest_pain_priority_v1",
        reviewedMetadataOnlyCount: 2,
        heldMetadataOnlyCount: 1,
        acceptedAttachmentRefCount: 3,
        runtimeEvidenceRefCount: 1,
        visualQaEvidenceRefCount: 2,
        acceptedActionIds: ["attach_runtime_realism_evidence_refs", "attach_visual_qa_evidence_refs"],
        rawPayloadDisplayed: false,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        replayEvidenceReady: false,
        blockerIds: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
        claimBoundary: "summary_only_runtime_visual_evidence_replay_projection_not_raw_payload_or_readiness",
        notEvidenceFor: ["runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
      assetReleaseLadderReplayProjection: {
        schemaVersion: "openclinxr.asset-release-ladder-replay-projection.v1",
        source: "scenario_asset_production_readiness_ladder",
        scenarioId: "ed_chest_pain_priority_v1",
        productionReady: false,
        assetCount: 9,
        productionReadyAssetCount: 2,
        blockedAssetCount: 7,
        missingRequiredAssetCount: 0,
        stationBudgetStatus: "ready",
        blockerCount: 8,
        blockerIds: ["asset_release_ladder_blocked:patient_robert_hayes_character"],
        blockedAssets: [
          {
            assetId: "patient_robert_hayes_character",
            blockerCount: 2,
            firstBlockedStep: "provenance_license",
            blockerIds: ["license_review_required", "optimization_report_missing"],
          },
        ],
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "summary_only_asset_release_ladder_replay_projection_not_release_readiness",
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
    }),
    getScenarioBankMaturity: async () => ({
      scenarioCount: 12,
      targetScenarioCount: 12,
      missingScenarioCount: 0,
      activationEligibleScenarioIds: ["ed_chest_pain_priority_v1"],
      blockedScenarioIds: Array.from({ length: 11 }, (_, index) => ({
        scenarioId: `blocked_scenario_${index + 1}`,
        reason: "not_approved",
      })),
      statusCounts: {
        approved: 1,
        draft: 11,
        retired: 0,
      },
      validationStageCounts: {
        stage_0_synthetic_draft: 11,
        stage_1_expert_reviewed: 1,
        stage_2_pilot_ready: 0,
        stage_3_validated: 0,
      },
      clinicalSettings: Array.from({ length: 12 }, (_, index) => `clinical_setting_${index + 1}`),
      actorRoleCoverage: ["consultant", "family", "interpreter", "medical_assistant", "nurse", "patient", "physician", "respiratory_therapist", "system"],
      hiddenFactPolicy: {
        redactsAll: true,
        requiresTriggerForAll: true,
      },
      fixtureCompleteness: { missingRequiredActorRoles: [] },
      communicationProfileCoverage: {
        completeScenarioIds: ["ed_chest_pain_priority_v1", "peds_asthma_parent_anxiety_v1"],
        incompleteScenarioIds: [],
        actorCount: {
          total: 4,
          withCommunicationProfile: 4,
        },
      },
      pressureActorCoverage: {
        completeScenarioIds: Array.from({ length: 12 }, (_, index) => `scenario_${index + 1}`),
        incompleteScenarioIds: [],
        scenarioCountWithNonPatientActors: 12,
        minimumNonPatientActorCount: 1,
      },
      traceabilityCoverage: {
        completeScenarioIds: Array.from({ length: 12 }, (_, index) => `scenario_${index + 1}`),
        incompleteScenarioIds: [],
        requiredTraceTagsCoveredByRubric: true,
        eventTagsWithinRequiredTraceTags: true,
        safetyCriticalTagsWithinRequiredTraceTags: true,
      },
      dialogueSeedCoverage: {
        seededScenarioIds: Array.from({ length: 12 }, (_, index) => `scenario_${index + 1}`),
        guardrailProbeScenarioIds: Array.from({ length: 12 }, (_, index) => `scenario_${index + 1}`),
      },
      sharedAssetReuseMaturity: {
        claimBoundary: "scenario_bank_shared_asset_reuse_metadata_only",
        lookupKeyCount: 72,
        reusableLookupKeyCount: 9,
        duplicateLookupKeyCount: 14,
        scenarioCountWithLookupKeys: 12,
        scenarioCountWithReusableKeys: 10,
        topReusableLookupKeys: [
          { lookupKey: "semantic::equipment::bedside_monitor", scenarioCount: 2 },
        ],
        lruReuseCandidateScenarioIds: Array.from({ length: 12 }, (_, index) => `scenario_${index + 1}`),
        notEvidenceFor: [
          "generated_asset_readiness",
          "shared_asset_library_materialization",
          "quest_readiness",
          "runtime_readiness",
          "production_asset_readiness",
        ],
      },
    }),
    getScenarioBankExamSequence: async () => ({
      source: "scenario_bank_ordered_sequence",
      targetStationCount: 12,
      stationCount: 12,
      missingStationCount: 0,
      activationEligibleCount: 1,
      learnerUseBoundary: "activation_ready_only",
      stations: [
        {
          stationOrder: 1,
          scenarioId: "ed_chest_pain_priority_v1",
          learnerUseBoundary: "activation_ready",
          reviewBlockers: [],
        },
        ...Array.from({ length: 11 }, (_, index) => ({
          stationOrder: index + 2,
          scenarioId: `draft_scenario_${index + 1}`,
          learnerUseBoundary: "draft_review_required",
          reviewBlockers: ["scenario_status:draft", "faculty_review_required"],
        })),
      ],
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
          { actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes", demeanor: "anxious", communicationProfile: fakeCommunicationProfile("appeaser") },
          { actorId: "spouse_anna_hayes_v1", role: "family", displayName: "Anna Hayes", demeanor: "worried", communicationProfile: fakeCommunicationProfile("angry_family_member") },
          { actorId: "nurse_maria_alvarez_v1", role: "nurse", displayName: "Maria Alvarez", demeanor: "direct", communicationProfile: fakeCommunicationProfile("rationalizer") },
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
          { actorId: "patient_maya_johnson_v1", role: "patient", displayName: "Maya Johnson", demeanor: "short sentences", communicationProfile: fakeCommunicationProfile("appeaser") },
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
            { actorId: "patient_maya_johnson_v1", role: "patient", displayName: "Maya Johnson", demeanor: "short sentences", communicationProfile: fakeCommunicationProfile("appeaser") },
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
          productionReadinessLadder: fakeProductionReadinessLadder("peds_asthma_parent_anxiety_v1", []),
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
            { actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes", demeanor: "anxious", communicationProfile: fakeCommunicationProfile("appeaser") },
            { actorId: "spouse_anna_hayes_v1", role: "family", displayName: "Anna Hayes", demeanor: "worried", communicationProfile: fakeCommunicationProfile("angry_family_member") },
            { actorId: "nurse_maria_alvarez_v1", role: "nurse", displayName: "Maria Alvarez", demeanor: "direct", communicationProfile: fakeCommunicationProfile("rationalizer") },
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
          productionReadinessLadder: fakeProductionReadinessLadder("ed_chest_pain_priority_v1", [
            "ed_exam_bay_environment",
            "patient_robert_hayes_character",
          ]),
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
        { actorId: "patient_maya_johnson_v1", role: "patient", displayName: "Maya Johnson", demeanor: "short sentences", communicationProfile: fakeCommunicationProfile("appeaser") },
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
        lateTraceTags: ["delayed_team_escalation"],
        unsafeEvents: ["unsafe_discharge_reassurance"],
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
      clinicalEventReviewSummary: {
        stationRunId: input.stationRunId,
        eventCount: 1,
        redactedEventCount: 1,
        clinicalEventKinds: { clinical_action_recorded: 1 },
        traceTags: ["ecg_request"],
        statusCounts: { completed: 1 },
        latestAtSecond: 83,
        durableStore: "database_source_of_truth",
        safeForFacultyReview: true,
      },
      reviewReplayReadinessSummary: {
        stationRunId: input.stationRunId,
        replayEvidenceReady: false,
        facultyReviewSafe: true,
        timelineEntryCount: 1,
        traceEventCount: 2,
        durableEventCount: 1,
        redactedDurableEventCount: 1,
        missingRequiredBehaviorCount: 1,
        lateBehaviorCount: 1,
        safetySignalCount: 1,
        blockers: ["missing_required_behavior", "late_behavior_present"],
        recommendedNextAction: "review_missing_required_behavior",
        replayBoundary: "summary_only_faculty_review_not_score_use",
        xrTraceEvidenceSummary: {
          stationRunId: input.stationRunId,
          source: "ui_xr_runtime_trace",
          evidenceRef: "window.__openClinXrTraceActionHandoffEvidence",
          activeLocomotionSource: "keyboard",
          locomotionDistanceMeters: 0.4,
          locomotionTurnRadians: 0.12,
          interactionSignalRefs: ["trace_action:ecg_request", "dom_click_trace_button"],
          latestTraceTag: "ecg_request",
          latestTraceLatencyMs: 12.5,
          blockers: ["headset_input_not_claimed"],
          claimBoundary: "xr_trace_evidence_summary_not_score_use_quest_readiness_clinical_validity_or_raw_payload_readiness",
        },
        caseDefinedHumanoidPerformanceContract: {
          claimBoundary: "case_definition_humanoid_performance_metadata_only",
          actorCount: 3,
          locomotionActorRoles: ["patient", "nurse", "family"],
          expressionActorRoles: ["patient", "nurse", "family"],
          gazeActorRoles: ["patient", "nurse", "family"],
          lipSyncActorRoles: ["patient", "nurse", "family"],
          interactiveActorRoles: ["patient", "nurse", "family"],
          emotionStateCount: 2,
          dialogueDrivenVisemeMappingRequired: true,
          gazeTargetingRequired: true,
          locomotionPlanningRequired: true,
          notEvidenceFor: [
            "generated_humanoid_asset_readiness",
            "animation_quality",
            "quest_readiness",
            "runtime_readiness",
            "clinical_validity",
          ],
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
        {
          sequence: 3,
          eventType: "safety.warning",
          atSecond: 840,
          source: "review",
          actorId: null,
          tag: "unsafe_discharge_reassurance",
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
    getEdChestPainPublicationReadiness: async () => ({
      scenarioId: "ed_chest_pain_priority_v1",
      targetUse: "local_formative",
      releaseLabel: "formative_local_only",
      canPublishForLearnerUse: false,
      requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
      missingReviewerRoles: ["legal"],
      gateResults: [],
      blockerVisibility: {
        claimBoundary: "publication_blocker_visibility_not_readiness_claim",
        humanReviewRequired: true,
        blockerIds: ["publication_gate_blocked:reviewer_evidence"],
        warningIds: ["publication_gate_warning:asset_readiness"],
        recommendedNextAction: "collect_required_reviewer_evidence",
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
    getScenarioBankEnvironmentGenerationQueue: async () => ({
      scenarioCount: 12,
      packetCount: 12,
      readyForGenerationReviewScenarioIds: [],
      blockedScenarioIds: Array.from({ length: 12 }, (_, index) => `scenario_${index + 1}`),
      nextReviewGateCounts: { attach_environment_generation_evidence: 12 },
      packets: [],
    }),
    getScenarioBankEnvironmentWorkOrderQueue: async () => ({
      scenarioCount: 12,
      workOrderCount: 12,
      blockedWorkOrderCount: 12,
      pendingTaskCount: 60,
      readyForGenerationReviewWorkOrderIds: [],
      claimBoundary: "work_order_queue_not_asset_production",
      nextEvidenceGateCounts: { attach_environment_generation_evidence: 12 },
      prohibitedActionCounts: { do_not_use_stablegen_without_legal_exception: 12 },
      missingEvidenceCounts: { blender_bake_report: 12 },
      workOrders: [],
    }),
    getScenarioBankSceneGenerationPipelineQueue: async () => ({
      scenarioCount: 12,
      workOrderCount: 12,
      pendingStageCount: 108,
      claimBoundary: "scene_generation_pipeline_queue_not_asset_production",
      featuredFactoryPlanningScenarioId: "ed_chest_pain_priority_v1",
      featuredFactoryPlanningWorkOrderId: "scene_generation_pipeline:ed_chest_pain_priority_v1",
      factoryPlanningClaimBoundary: "review_gated_factory_metadata_only",
      generationApprovalInferred: false,
      storageTargets: [
        {
          storeKind: "azurite_blob",
          containerName: "openclinxr-assets",
          blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/",
          emulatorAllowed: true,
        },
      ],
      workOrders: [
        {
          workOrderId: "scene_generation_pipeline:ed_chest_pain_priority_v1",
          scenarioId: "ed_chest_pain_priority_v1",
          scenarioStatus: "approved",
          approvalBoundary: "scenario_status_preserved_no_generation_approval_inferred",
          initiatedFrom: "admin_scenario_configuration",
          claimBoundary: "admin_initiated_pipeline_contract_not_generated_asset",
          targetRuntime: "quest3_webxr",
          storageTarget: {
            storeKind: "azurite_blob",
            containerName: "openclinxr-assets",
            blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/",
            emulatorAllowed: true,
          },
          scenarioAssetIds: ["patient_robert_hayes_character"],
          characterAssetIds: ["patient_robert_hayes_character"],
          environmentAssetIds: ["ed_exam_bay_environment"],
          equipmentAssetIds: ["12-lead ECG machine"],
          actorWorkOrders: [],
          environmentWorkOrder: {} as never,
          pipelineStageCount: 9,
          stages: [
            "admin_scenario_configuration",
            "asset_need_expansion",
            "humanoid_generation",
            "hair_clothing_skin_generation",
            "rigging_animation_generation",
            "equipment_environment_generation",
            "blob_storage_publication",
            "runtime_bundle_binding",
            "review_and_quest_evidence",
          ].map((stageId) => ({
            stageId: stageId as never,
            title: stageId,
            status: "pending",
            initiatedBy: "admin_user_after_scenario_configuration",
            requiredInputs: [],
            expectedOutputs: [],
          })),
          requiredOutputEvidence: ["learner_runtime_asset_bundle"],
          prohibitedActions: ["do_not_generate_assets_before_admin_scenario_configuration"],
        },
      ],
    }),
    createScenarioSceneGenerationRequest: async (input) => {
      const workOrder = (await fakeControlPlaneClient().getScenarioBankSceneGenerationPipelineQueue()).workOrders.at(0);
      if (!workOrder) {
        throw new Error("Expected scenario bank scene generation pipeline queue fixture to include a work order.");
      }

      return {
        requestId: `scene_generation_request:${input.scenarioId}:local-admin`,
        scenarioId: input.scenarioId,
        createdAt: "2026-05-22T23:09:00.000Z",
        status: "accepted",
        reviewStatus: "pending_runtime_asset_review",
        nextAction: "attach_runtime_asset_review_decisions",
        runtimeAssetReviewDecisionCount: 0,
        accepted: true,
        productionAssetReadinessClaimed: false,
        claimBoundary: "scene_generation_request_not_asset_production",
        workOrder,
      };
    },
    listScenarioSceneGenerationRequests: async () => ({
      requestCount: 0,
      claimBoundary: "scene_generation_request_queue_not_asset_production",
      requests: [],
    }),
    submitScenarioSceneGenerationRequestReview: async () => {
      const workOrder = (await fakeControlPlaneClient().getScenarioBankSceneGenerationPipelineQueue()).workOrders.at(0);
      if (!workOrder) {
        throw new Error("Expected scenario bank scene generation pipeline queue fixture to include a work order.");
      }

      return {
        requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
        scenarioId: "ed_chest_pain_priority_v1",
        createdAt: "2026-05-22T23:09:00.000Z",
        status: "accepted",
        reviewStatus: "runtime_asset_review_attached",
        nextAction: "run_generated_bundle_publisher",
        runtimeAssetReviewDecisionCount: 1,
        accepted: true,
        productionAssetReadinessClaimed: false,
        claimBoundary: "scene_generation_request_not_asset_production",
        workOrder,
      };
    },
    submitRuntimeVisualEvidenceAttachment: async () => ({
      schemaVersion: "openclinxr.runtime-visual-evidence-attachment-record.v1",
      source: "admin_runtime_visual_evidence_attachment_refs",
      scenarioId: "ed_chest_pain_priority_v1",
      attachmentCount: 1,
      runtimeEvidenceAttachmentCount: 1,
      visualQaEvidenceAttachmentCount: 0,
      attachments: [
        {
          actionId: "attach_runtime_realism_evidence_refs",
          inputId: "runtime-realism-evidence-input:patient_ed_chest_pain_v1",
          inputKind: "runtime_realism_signal_input",
          evidenceRef: "runtime-realism-evidence-input://patient",
          localArtifactPath: "metadata-only-admin-review/runtime-realism-evidence-input_patient_ed_chest_pain_v1.json",
          reviewerId: "admin_runtime_visual_evidence_reviewer",
          attachmentStatus: "attached_metadata_only",
          comments: "Admin reviewer attached a metadata-only evidence ref; this does not clear runtime, learner, Quest, production, clinical, or scoring gates.",
          attachedAt: "2026-05-28T10:30:00.000Z",
        },
      ],
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "metadata_only_runtime_visual_evidence_attachment_refs_not_launch_evidence",
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    }),
    getScenarioSceneGenerationRequestPublicationReadiness: async () => ({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
      scenarioId: "ed_chest_pain_priority_v1",
      canRunGeneratedBundlePublisher: true,
      blockers: [],
      nextAction: "run_generated_bundle_publisher",
      materializationEvidenceAttachmentSummary: {
        schemaVersion: "openclinxr.encounter-materialization-evidence-attachment-summary.v1",
        source: "encounter_materialization_evidence_attachments",
        scenarioId: "ed_chest_pain_priority_v1",
        totalRequiredSlotCount: 36,
        attachedSlotCount: 36,
        missingSlotCount: 0,
        heldOrInvalidAttachmentCount: 0,
        allRequiredSlotsSatisfied: true,
        blockerIds: [
          "materialization_evidence_attachment_missing:actor-materialization-attachment:patient_ed_chest_pain_v1:actor_specific_clothing_required",
          "materialization_evidence_attachment_missing:equipment-materialization-attachment:exam_room_ecg_cart:clinical_affordance_evidence",
        ],
        providerExecutionPerformed: false,
        runtimeSelectionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_materialization_evidence_attachment_summary",
      },
      claimBoundary: "publication_readiness_not_learner_bundle_persistence",
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    }),
  };
}
