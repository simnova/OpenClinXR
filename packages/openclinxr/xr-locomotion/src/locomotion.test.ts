import { Group } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyDeterministicPortalPreviewStart, applyGeneratedHumanoidRoleSpecificPosture, applyLocomotion, buildExamineeLocomotionEvidence, createExamineeLocomotionTrail, createKeyboardLocomotion, createXrHandGestureLocomotionState, createXrHandSelectState, formatHandSelectStatus, formatPortalTransitionEvidence, isLocomotionVectorActive, isXrHandPinching, maybeCompleteTraceActionFromHandSelect, type PortalTransitionContext, parsePortalPreviewStart, type RolePostureContext, recordHandSelectTraceLatency, sampleRoomScalePose, updateExamineeLocomotionTrail, updatePortalTransitionEvidence, updateReusableExteriorAnteroomVisibility } from "./index.js";
import { clampLocomotionUnit, createXrHandGestureHandState, handednessForHand, handSelectEvidence, isTrackedHandVisible, locomotionDeadzone, resetHandGestureHandState, resetHandSelectState } from "./locomotion.js";
import { applyScenarioDerivedFamilyPosture } from "./role-posture.js";

function portalCtx(overrides: Partial<PortalTransitionContext> = {}): PortalTransitionContext {
  return {
    portalThresholdZ: 0.72,
    portalEncounterEntered: false,
    portalEncounterStartedByPortal: false,
    portalLastTransitionReason: null,
    reusableExteriorAnteroom: null,
    scenarioId: "ed_chest_pain_priority_v1",
    examPhase: "encounter",
    deterministicPreviewStart: null,
    setPortalEncounterEntered: () => {},
    setPortalEncounterStartedByPortal: () => {},
    setPortalLastTransitionReason: () => {},
    ...overrides,
  };
}

function roleCtx(overrides: Partial<RolePostureContext> = {}): RolePostureContext {
  return {
    actorRole: () => "patient",
    isPatient: (id: string) => id === "patient",
    isClinicalTeam: (id: string) => id === "team",
    isFamily: (id: string) => id === "family",
    isPediatricAsthmaScenario: () => false,
    scenarioId: "ed_chest_pain_priority_v1",
    ...overrides,
  };
}

describe("locomotion maths", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { addEventListener: () => {}, location: { search: "" } } as never);
  });
  it("clamps unit vectors and applies the gamepad deadzone", () => {
    expect(clampLocomotionUnit(2)).toBe(1);
    expect(clampLocomotionUnit(-2)).toBe(-1);
    expect(locomotionDeadzone(0.05)).toBe(0);
    expect(locomotionDeadzone(0.5)).toBe(0.5);
    expect(isLocomotionVectorActive({ forward: 0, strafe: 0, turn: 0 })).toBe(false);
    expect(isLocomotionVectorActive({ forward: 0, strafe: 0, turn: 0.5 })).toBe(true);
  });

  it("creates independent gesture and select state", () => {
    const gesture = createXrHandGestureLocomotionState();
    expect(gesture.hands.left.armed).toBe(false);
    gesture.hands.left.armed = true;
    expect(createXrHandGestureLocomotionState().hands.left.armed).toBe(false);
    const hand = createXrHandGestureHandState();
    hand.armed = true;
    resetHandGestureHandState(hand);
    expect(hand.armed).toBe(false);
    const select = createXrHandSelectState();
    select.firedCount = 3;
    resetHandSelectState(select);
    expect(select.pinchingSinceMs).toBeNull();
  });

  it("creates keyboard state without global listeners leaking across calls", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const before = addSpy.mock.calls.length;
    createKeyboardLocomotion();
    expect(addSpy.mock.calls.length).toBe(before + 2);
    addSpy.mockRestore();
  });

  it("formats hand-select status and returns null latency for idle", () => {
    expect(formatHandSelectStatus(undefined)).toBe("idle");
    const state = createXrHandSelectState();
    const evidence = handSelectEvidence(state, 100, { status: "idle", armed: false, rightPinch: false });
    expect(formatHandSelectStatus(evidence)).toContain("idle");
    expect(recordHandSelectTraceLatency(evidence, 100, null)).toBeNull();
  });

  it("resolves handedness and visibility without a renderer", () => {
    const hand = new Group();
    hand.visible = false;
    hand.userData["openClinXrHandedness"] = "right";
    expect(handednessForHand(hand as never, 0)).toBe("right");
    expect(isTrackedHandVisible(hand as never)).toBe(false);
    expect(isXrHandPinching(hand as never)).toBe(false);
  });
});

describe("applyLocomotion", () => {
  it("moves the rig from keyboard input and clamps to the room bounds", () => {
    const rig = new Group();
    const renderer = { xr: { getHand: () => new Group() } };
    const evidence = applyLocomotion({
      deltaSeconds: 1,
      keyboardLocomotion: { forward: 1, strafe: 0, turn: 0 },
      locomotionRig: rig,
      now: 1000,
      renderer,
      session: undefined,
      lastInputObservedAtMs: null,
      lastLocomotionAtMs: null,
      handModelCount: 0,
      handModelStatus: "pending_immersive_session",
      handGestureLocomotionState: createXrHandGestureLocomotionState(),
      previousRoomScalePose: null,
      roomScalePose: null,
    });
    expect(evidence.keyboardVector?.forward).toBe(1);
    expect(rig.position.z).toBeLessThan(0);
    expect(evidence.activeLocomotionSource).not.toBe("none");
  });

  it("samples room-scale pose only while presenting", () => {
    expect(sampleRoomScalePose({ camera: { position: { x: 1, z: 2 } }, renderer: { xr: { updateCamera: () => {} } }, presenting: false })).toBeNull();
    const updateCamera = vi.fn();
    const pose = sampleRoomScalePose({ camera: { position: { x: 1.2344, z: 2.3456 } }, renderer: { xr: { updateCamera } }, presenting: true });
    expect(updateCamera).toHaveBeenCalledTimes(1);
    expect(pose).toEqual({ x: 1.234, z: 2.346, yawRadians: 0 });
  });

  it("blocks hand select outside presenting", () => {
    const renderer = { xr: { getHand: () => new Group() } };
    const state = createXrHandSelectState();
    const evidence = maybeCompleteTraceActionFromHandSelect({
      renderer,
      handSelectState: state,
      now: 100,
      controllerInputActive: false,
      isFullVrPresenting: () => false,
      onSelect: () => true,
    });
    expect(evidence.status).toBe("blocked");
  });
});

describe("portal transition and examinee trail", () => {
  it("parses deterministic preview starts", () => {
    expect(parsePortalPreviewStart("?openclinxrPortalStart=exterior")).toBe("exterior_note_room");
    expect(parsePortalPreviewStart("?openclinxrPortalStart=threshold")).toBe("portal_threshold");
    expect(parsePortalPreviewStart("?openclinxrPortalStart=encounter")).toBe("dynamic_encounter_world");
    expect(parsePortalPreviewStart("")).toBeNull();
  });

  it("applies deterministic preview starts to the rig", () => {
    const rig = new Group();
    applyDeterministicPortalPreviewStart(
      { portalThresholdZ: 0.72, deterministicPreviewStart: "portal_threshold", setPortalLastTransitionReason: () => {} },
      rig,
    );
    expect(rig.position.z).toBe(0.72);
    const untouched = new Group();
    applyDeterministicPortalPreviewStart(
      { portalThresholdZ: 0.72, deterministicPreviewStart: null, setPortalLastTransitionReason: () => {} },
      untouched,
    );
    expect(untouched.position.z).toBe(0);
  });

  it("hides the exterior anteroom after portal entry", () => {
    const anteroom = new Group();
    const wall = new Group();
    wall.name = "portal-left-wall";
    anteroom.add(wall);
    const hidden = updateReusableExteriorAnteroomVisibility({ reusableExteriorAnteroom: anteroom }, "dynamic_encounter_world");
    expect(hidden).toEqual(["portal-left-wall"]);
    expect(wall.visible).toBe(false);
    expect(updateReusableExteriorAnteroomVisibility({ reusableExteriorAnteroom: null }, "dynamic_encounter_world")).toEqual([]);
  });

  it("reports portal evidence state and formats it", () => {
    expect(formatPortalTransitionEvidence(null)).toBe("portal pending");
    const entered = { value: false };
    const started = { value: false };
    const reason: { value: string | null } = { value: null };
    const ctx = portalCtx({
      setPortalEncounterEntered: (value: boolean) => { entered.value = value; },
      setPortalEncounterStartedByPortal: (value: boolean) => { started.value = value; },
      setPortalLastTransitionReason: (value: string | null) => { reason.value = value; },
    });
    const rig = new Group();
    rig.position.z = -2;
    const camera = { getWorldPosition: (target: { z: number }) => { target.z = -2; return target; }, position: { z: 0 } } as never;
    const evidence = updatePortalTransitionEvidence(ctx, rig, camera);
    expect(evidence.side).toBe("dynamic_encounter_world");
    expect(entered.value).toBe(true);
    expect(reason.value).toBe("portal_crossed_into_dynamic_encounter_world");
    expect(evidence.encounterEntered).toBe(true);
    expect(formatPortalTransitionEvidence(evidence)).toContain("portal dynamic_encounter_world");
  });

  it("builds examinee evidence only for active locomotion and toggles the trail", () => {
    expect(buildExamineeLocomotionEvidence({
      inputEvidence: { activeLocomotionSource: "none" } as never,
      startPose: null,
      distanceMeters: 0,
      turnRadians: 0,
      sampleCount: 0,
    })).toBeNull();
    const evidence = buildExamineeLocomotionEvidence({
      inputEvidence: {
        activeLocomotionSource: "keyboard",
        locomotionDelta: { distanceMeters: 0.5, turnRadians: 0.1 },
        rigPosition: { x: 1, z: 2 },
      } as never,
      startPose: null,
      distanceMeters: 1,
      turnRadians: 0.2,
      sampleCount: 4,
    });
    expect(evidence?.sampleCount).toBe(5);
    expect(evidence?.pathCueIds).toContain("examinee_runtime_position_ring_cue");
    const trail = createExamineeLocomotionTrail(false);
    expect(trail.visible).toBe(false);
    updateExamineeLocomotionTrail(trail, evidence!, false);
    expect(trail.visible).toBe(true);
    expect(trail.position.x).toBe(1);
    updateExamineeLocomotionTrail(trail, evidence!, true);
    expect(trail.visible).toBe(false);
  });
});

describe("role posture", () => {
  it("applies scenario-derived family posture without touching actor-role plumbing", () => {
    const humanoid = new Group();
    applyScenarioDerivedFamilyPosture({ scenarioId: "oncology_bad_news_family_v1" }, humanoid);
    expect(humanoid.userData["openClinXrScenarioDerivedPosture"]).toBe("oncology_family_emotional_support");
    const untouched = new Group();
    applyScenarioDerivedFamilyPosture({ scenarioId: "ed_chest_pain_priority_v1" }, untouched);
    expect(untouched.userData["openClinXrScenarioDerivedPosture"]).toBeUndefined();
  });

  it("applies a head-only patient pose and a pediatric distress pose", () => {
    const adult = new Group();
    applyGeneratedHumanoidRoleSpecificPosture(roleCtx(), adult, "patient");
    expect(adult.rotation.x).toBe(-0.08);
    const peds = new Group();
    applyGeneratedHumanoidRoleSpecificPosture(
      roleCtx({ isPediatricAsthmaScenario: () => true }),
      peds,
      "patient",
    );
    expect(peds.scale.x).toBeCloseTo(0.78);
    const unknown = new Group();
    applyGeneratedHumanoidRoleSpecificPosture(roleCtx(), unknown, "stranger");
    expect(unknown.userData["openClinXrScenarioDerivedPosture"]).toBeUndefined();
  });
});
