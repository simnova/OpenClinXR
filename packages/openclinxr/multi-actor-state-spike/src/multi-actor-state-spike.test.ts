import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import {
  buildActorModelContext,
  createMultiActorClinicalSession,
  evaluateMultiActorStateOptions,
  recordClinicalAction,
  routeActorInteraction,
  updateActorSpatialState,
} from "./index.js";

describe("multi-actor clinical state spike", () => {
  it("creates distinct actor memories and role contexts from an approved scenario", () => {
    const session = createMultiActorClinicalSession({
      scenario: edChestPainScenario,
      stationRunId: "station_run_multi_actor_001",
    });

    expect(session.actors.map((actor) => [actor.actorId, actor.role, actor.memory.privateFacts.length])).toEqual([
      ["patient_robert_hayes_v1", "patient", 2],
      ["spouse_anna_hayes_v1", "family", 1],
      ["nurse_maria_alvarez_v1", "nurse", 1],
    ]);
    expect(session.clinicalState.requiredTraceTags).toContain("urgent_escalation");
    expect(session.spatialState.actorTransforms["patient_robert_hayes_v1"]).toMatchObject({
      position: { x: 0, y: 0, z: -1.15 },
      interactionState: "idle",
    });
  });

  it("routes addressed learner utterances to the intended actor and preserves private memory boundaries", () => {
    const session = createMultiActorClinicalSession({
      scenario: edChestPainScenario,
      stationRunId: "station_run_multi_actor_002",
    });

    const routed = routeActorInteraction(session, {
      atSecond: 120,
      learnerUtterance: "Nurse, can you repeat the blood pressure and get an ECG?",
      traceContextTags: ["vitals_review", "ecg_request"],
    });
    const nurseContext = buildActorModelContext(routed.updatedSession, routed.routedActorId);
    const patientContext = buildActorModelContext(routed.updatedSession, "patient_robert_hayes_v1");

    expect(routed.routedActorId).toBe("nurse_maria_alvarez_v1");
    expect(routed.routingReason).toBe("addressed_role_keyword");
    expect(nurseContext.privateMemory.factRefs).toEqual(["fact:nurse_maria_alvarez_v1:0"]);
    expect(nurseContext.privateMemory.factsForServerModelOnly).toContain(
      "Repeat blood pressure is falling and patient looks worse at minute seven",
    );
    expect(patientContext.privateMemory.factRefs).toEqual([
      "fact:patient_robert_hayes_v1:0",
      "fact:patient_robert_hayes_v1:1",
    ]);
    expect(patientContext.privateMemory.factsForServerModelOnly.join(" ")).not.toContain("Repeat blood pressure");
  });

  it("tracks clinical actions and spatial transforms without claiming production sync", () => {
    let session = createMultiActorClinicalSession({
      scenario: edChestPainScenario,
      stationRunId: "station_run_multi_actor_003",
    });

    session = recordClinicalAction(session, {
      atSecond: 185,
      actorId: "nurse_maria_alvarez_v1",
      traceTag: "ecg_request",
      actionType: "order_requested",
      label: "12-lead ECG requested",
    });
    session = updateActorSpatialState(session, {
      atSecond: 190,
      actorId: "nurse_maria_alvarez_v1",
      position: { x: 1.2, y: 0, z: -0.6 },
      rotationYRadians: -0.4,
      interactionState: "holding_equipment",
    });

    expect(session.clinicalState.completedTraceTags).toContain("ecg_request");
    expect(session.clinicalState.orders).toEqual([
      {
        actorId: "nurse_maria_alvarez_v1",
        atSecond: 185,
        label: "12-lead ECG requested",
        orderId: "order_1_ecg_request",
        status: "requested",
        traceTag: "ecg_request",
      },
    ]);
    expect(session.spatialState.actorTransforms["nurse_maria_alvarez_v1"]).toMatchObject({
      position: { x: 1.2, y: 0, z: -0.6 },
      rotationYRadians: -0.4,
      interactionState: "holding_equipment",
      lastUpdatedAtSecond: 190,
    });
    expect(session.evidence.notEvidenceFor).toContain("production_realtime_state_sync");
  });

  it("recommends custom baseline first while keeping Colyseus install-backed and bitECS license-gated", () => {
    const options = evaluateMultiActorStateOptions();

    expect(options.recommendedFirstImplementation).toBe("custom-domain-state-baseline");
    expect(options.options.find((option) => option.id === "colyseus")).toMatchObject({
      packageName: "colyseus",
      observedVersion: "0.17.10",
      licensePosture: "MIT_package_metadata",
      recommendation: "install_backed_followup_candidate",
    });
    expect(options.options.find((option) => option.id === "bitecs")).toMatchObject({
      packageName: "bitecs",
      observedVersion: "0.4.0",
      licensePosture: "MPL-2.0_package_metadata_license_gated",
      recommendation: "defer_until_license_accepted_or_replaced",
    });
  });
});
