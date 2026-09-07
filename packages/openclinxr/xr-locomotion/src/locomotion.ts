import {
  buildManualPerformanceInputEvidence,
  handGestureLocomotionOriginMeters,
  handGestureRelativeOffsetMeters,
  type LocomotionVectorEvidence,
  type ManualPerformanceInputEvidence,
  mapHandGestureLocomotionVector,
  type XrHandGestureStateEvidence,
  type XrHandSelectStateEvidence,
  type XrInputSourceEvidence,
} from "@openclinxr/xr-runtime-state";
import { Vector3 } from "three";
import type {
  LocomotionUpdateInput,
  XrHandGestureHandState,
  XrHandGestureLocomotionResult,
  XrHandGestureLocomotionState,
  XrHandGestureVectorResult,
  XrHandGroup,
  XrHandSelectState,
  XrInputSourceWithGamepad,
  XrSessionLike,
} from "./types.js";

export const XR_LOCOMOTION_GAMEPAD_DEADZONE = 0.18;
export const HAND_GESTURE_DWELL_MS = 450;
export const HAND_GESTURE_DEADZONE_METERS = 0.045;
export const HAND_GESTURE_TURN_DEADZONE_METERS = 0.055;
export const HAND_GESTURE_TURN_COOLDOWN_MS = 450;
export const HAND_SELECT_DWELL_MS = 650;
export const HAND_SELECT_MOVEMENT_TOLERANCE_METERS = 0.025;
export const HAND_SELECT_COOLDOWN_MS = 850;
export const HAND_PINCH_DISTANCE_THRESHOLD_METERS = 0.035;

export function clampLocomotion(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampLocomotionUnit(value: number): number {
  return clampLocomotion(value, -1, 1);
}

export function locomotionDeadzone(value: number): number {
  return Math.abs(value) < XR_LOCOMOTION_GAMEPAD_DEADZONE ? 0 : clampLocomotionUnit(value);
}

export function isLocomotionVectorActive(vector: LocomotionVectorEvidence): boolean {
  return Math.abs(vector.forward) > 0 || Math.abs(vector.strafe) > 0 || Math.abs(vector.turn) > 0;
}

export function createKeyboardLocomotion(): { forward: number; strafe: number; turn: number } {
  const state = { forward: 0, strafe: 0, turn: 0 };
  const pressedKeys = new Set<string>();

  const update = (event: KeyboardEvent, pressed: boolean): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (pressed) {
      pressedKeys.add(event.code);
    } else {
      pressedKeys.delete(event.code);
    }
    state.forward = (pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp") ? 1 : 0)
      + (pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown") ? -1 : 0);
    state.strafe = (pressedKeys.has("KeyD") || pressedKeys.has("ArrowRight") ? 1 : 0)
      + (pressedKeys.has("KeyA") || pressedKeys.has("ArrowLeft") ? -1 : 0);
    state.turn = (pressedKeys.has("KeyE") ? -1 : 0) + (pressedKeys.has("KeyQ") ? 1 : 0);
  };

  window.addEventListener("keydown", (event) => update(event, true));
  window.addEventListener("keyup", (event) => update(event, false));
  return state;
}

export function createXrHandGestureLocomotionState(): XrHandGestureLocomotionState {
  return {
    hands: {
      left: createXrHandGestureHandState(),
      right: createXrHandGestureHandState(),
    },
    lastTurnAtMs: null,
  };
}

export function createXrHandGestureHandState(): XrHandGestureHandState {
  return {
    pinchingSinceMs: null,
    neutralOffsetX: 0,
    neutralOffsetZ: 0,
    armed: false,
  };
}

export function createXrHandSelectState(): XrHandSelectState {
  return {
    pinchingSinceMs: null,
    neutralOffsetX: 0,
    neutralOffsetZ: 0,
    firedDuringPinch: false,
    firedCount: 0,
    lastFiredAtMs: null,
  };
}

export function resetHandSelectState(state: XrHandSelectState): void {
  state.pinchingSinceMs = null;
  state.neutralOffsetX = 0;
  state.neutralOffsetZ = 0;
  state.firedDuringPinch = false;
}

export function resetHandGestureHandState(state: XrHandGestureHandState): void {
  state.pinchingSinceMs = null;
  state.neutralOffsetX = 0;
  state.neutralOffsetZ = 0;
  state.armed = false;
}

export function handednessForHand(hand: XrHandGroup, index: number): "left" | "right" {
  return hand.userData["openClinXrHandedness"] === "right" || index === 1 ? "right" : "left";
}

export function isTrackedHandVisible(hand: XrHandGroup): boolean {
  return Boolean(hand.visible || hand.joints?.["wrist"]?.visible || hand.joints?.["index-finger-tip"]?.visible);
}

export function isXrHandPinching(hand: XrHandGroup): boolean {
  const indexTip = hand.joints?.["index-finger-tip"];
  const thumbTip = hand.joints?.["thumb-tip"];
  if (!indexTip?.visible || !thumbTip?.visible) {
    return false;
  }
  return indexTip.position.distanceTo(thumbTip.position) <= HAND_PINCH_DISTANCE_THRESHOLD_METERS;
}

export function readXrGamepadLocomotion(session: XrSessionLike | undefined): {
  forward: number;
  strafe: number;
  turn: number;
  handInputsObserved: number;
  inputSources: XrInputSourceEvidence[];
  diagnostics: import("@openclinxr/xr-runtime-state").LocomotionAttemptDiagnosticsEvidence["gamepadSources"];
} {
  let forward = 0;
  let strafe = 0;
  let turn = 0;
  let handInputsObserved = 0;
  const inputSources: XrInputSourceEvidence[] = [];
  const diagnostics: import("@openclinxr/xr-runtime-state").LocomotionAttemptDiagnosticsEvidence["gamepadSources"] = [];

  for (const source of session?.inputSources ?? []) {
    const typed = source as XrInputSourceWithGamepad;
    if (typed.hand) {
      handInputsObserved += 1;
    }
    const axes = typed.gamepad?.axes ?? [];
    inputSources.push({
      handedness: typed.handedness ?? "unknown",
      hasHand: Boolean(typed.hand),
      hasGamepad: Boolean(typed.gamepad),
      axisCount: axes.length,
    });
    const selectedXAxisIndex = axes[2] === undefined ? (axes[0] === undefined ? null : 0) : 2;
    const selectedYAxisIndex = axes[3] === undefined ? (axes[1] === undefined ? null : 1) : 3;
    const xAxis = locomotionDeadzone(selectedXAxisIndex === null ? 0 : axes[selectedXAxisIndex] ?? 0);
    const yAxis = locomotionDeadzone(selectedYAxisIndex === null ? 0 : axes[selectedYAxisIndex] ?? 0);
    if (typed.gamepad) {
      diagnostics.push({
        handedness: typed.handedness ?? "unknown",
        rawAxes: Array.from(axes),
        selectedXAxisIndex,
        selectedYAxisIndex,
        xAxisAfterDeadzone: xAxis,
        yAxisAfterDeadzone: yAxis,
        activeAfterDeadzone: xAxis !== 0 || yAxis !== 0,
        contribution: typed.handedness === "right" ? "turn" : "move",
      });
    }
    if (typed.handedness === "right") {
      turn += xAxis;
      continue;
    }
    strafe += xAxis;
    forward += -yAxis;
  }

  return {
    forward: clampLocomotionUnit(forward),
    strafe: clampLocomotionUnit(strafe),
    turn: clampLocomotionUnit(turn),
    handInputsObserved,
    inputSources,
    diagnostics,
  };
}

type XrHandRenderer = { xr: { getHand(index: number): unknown } };

export function readXrHandGestureLocomotion(input: {
  renderer: XrHandRenderer;
  gestureState: XrHandGestureLocomotionState;
  now: number;
  otherLocomotionSourceActive: boolean;
}): XrHandGestureLocomotionResult {
  let forward = 0;
  let strafe = 0;
  let turn = 0;
  let handInputsObserved = 0;
  let leftPinch = false;
  let rightPinch = false;
  let dwellMs = 0;
  let armed = false;
  let blockedReason: NonNullable<XrHandGestureStateEvidence["blockedReason"]> = "not_pinching";
  const diagnostics: import("@openclinxr/xr-runtime-state").LocomotionAttemptDiagnosticsEvidence["handGestureHands"] = [];

  for (let index = 0; index < 2; index += 1) {
    const hand = input.renderer.xr.getHand(index) as XrHandGroup;
    if (isTrackedHandVisible(hand)) {
      handInputsObserved += 1;
    }
    const handedness = handednessForHand(hand, index);
    if (isXrHandPinching(hand)) {
      if (handedness === "right") {
        rightPinch = true;
      } else {
        leftPinch = true;
      }
    }
    const gesture = readHandGestureVector({
      hand,
      index,
      now: input.now,
      gestureState: input.gestureState,
      otherLocomotionSourceActive: input.otherLocomotionSourceActive,
    });
    forward += gesture.forward;
    strafe += gesture.strafe;
    turn += gesture.turn;
    dwellMs = Math.max(dwellMs, gesture.dwellMs);
    armed = armed || gesture.armed;
    if (isXrHandGestureStateBlockedReason(gesture.blockedReason)) {
      blockedReason = gesture.blockedReason;
    }
    diagnostics.push(gesture.diagnostic);
  }

  const state: XrHandGestureStateEvidence = {
    armed,
    dwellMs,
    leftPinch,
    rightPinch,
    gestureDeadzoneMeters: HAND_GESTURE_DEADZONE_METERS,
    turnCooldownMs: HAND_GESTURE_TURN_COOLDOWN_MS,
  };
  if (!armed) {
    state.blockedReason = blockedReason;
  }

  return {
    forward: clampLocomotionUnit(forward),
    strafe: clampLocomotionUnit(strafe),
    turn: clampLocomotionUnit(turn),
    handInputsObserved,
    state,
    diagnostics,
  };
}

export function isXrHandGestureStateBlockedReason(
  reason: XrHandGestureVectorResult["blockedReason"],
): reason is NonNullable<XrHandGestureStateEvidence["blockedReason"]> {
  return reason === "not_pinching"
    || reason === "arming_dwell"
    || reason === "missing_joints"
    || reason === "other_locomotion_source_active";
}

export function readHandGestureVector(input: {
  hand: XrHandGroup;
  index: number;
  now: number;
  gestureState: XrHandGestureLocomotionState;
  otherLocomotionSourceActive: boolean;
}): XrHandGestureVectorResult {
  const handedness = handednessForHand(input.hand, input.index);
  const state = input.gestureState.hands[handedness];

  const wrist = input.hand.joints?.["wrist"];
  const indexTip = input.hand.joints?.["index-finger-tip"];
  const thumbTip = input.hand.joints?.["thumb-tip"];
  const jointsVisible = {
    wrist: Boolean(wrist?.visible),
    indexTip: Boolean(indexTip?.visible),
    thumbTip: Boolean(thumbTip?.visible),
  };
  const pinchDistanceMeters = indexTip?.visible && thumbTip?.visible
    ? indexTip.position.distanceTo(thumbTip.position)
    : null;
  const pinching = pinchDistanceMeters !== null && pinchDistanceMeters <= HAND_PINCH_DISTANCE_THRESHOLD_METERS;
  if (!wrist?.visible || !indexTip?.visible || !thumbTip?.visible) {
    resetHandGestureHandState(state);
    return handGestureResult({
      handedness,
      jointsVisible,
      pinchDistanceMeters,
      pinching,
      armed: false,
      dwellMs: 0,
      relativeOffsetMeters: null,
      movementCrossedDeadzone: false,
      blockedReason: "missing_joints",
    });
  }

  if (!pinching) {
    resetHandGestureHandState(state);
    return handGestureResult({
      handedness,
      jointsVisible,
      pinchDistanceMeters,
      pinching,
      armed: false,
      dwellMs: 0,
      relativeOffsetMeters: null,
      movementCrossedDeadzone: false,
      blockedReason: "not_pinching",
    });
  }

  if (input.otherLocomotionSourceActive) {
    resetHandGestureHandState(state);
    return handGestureResult({
      handedness,
      jointsVisible,
      pinchDistanceMeters,
      pinching,
      armed: false,
      dwellMs: 0,
      relativeOffsetMeters: null,
      movementCrossedDeadzone: false,
      blockedReason: "other_locomotion_source_active",
    });
  }

  const gestureOriginMeters = handGestureLocomotionOriginMeters({
    wrist: { x: wrist.position.x, z: wrist.position.z },
    indexTip: { x: indexTip.position.x, z: indexTip.position.z },
    thumbTip: { x: thumbTip.position.x, z: thumbTip.position.z },
  });
  if (state.pinchingSinceMs === null) {
    state.pinchingSinceMs = input.now;
    state.neutralOffsetX = gestureOriginMeters.x;
    state.neutralOffsetZ = gestureOriginMeters.z;
    state.armed = false;
  }

  const dwellMs = Math.max(0, input.now - state.pinchingSinceMs);
  if (dwellMs < HAND_GESTURE_DWELL_MS) {
    return handGestureResult({
      handedness,
      jointsVisible,
      pinchDistanceMeters,
      pinching,
      armed: false,
      dwellMs,
      relativeOffsetMeters: null,
      movementCrossedDeadzone: false,
      blockedReason: "arming_dwell",
    });
  }
  state.armed = true;
  const relativeOffsetMeters = handGestureRelativeOffsetMeters({
    neutralOriginMeters: {
      x: state.neutralOffsetX,
      z: state.neutralOffsetZ,
    },
    current: {
      wrist: { x: wrist.position.x, z: wrist.position.z },
      indexTip: { x: indexTip.position.x, z: indexTip.position.z },
      thumbTip: { x: thumbTip.position.x, z: thumbTip.position.z },
    },
  });

  const turnCoolingDown = handedness === "right"
    && input.gestureState.lastTurnAtMs !== null
    && input.now - input.gestureState.lastTurnAtMs < HAND_GESTURE_TURN_COOLDOWN_MS;
  const mappedGesture = mapHandGestureLocomotionVector({
    handedness,
    relativeOffsetMeters,
    movementDeadzoneMeters: HAND_GESTURE_DEADZONE_METERS,
    turnDeadzoneMeters: HAND_GESTURE_TURN_DEADZONE_METERS,
    movementSensitivity: 5,
    turnSensitivity: 4,
    turnCoolingDown,
  });

  if (handedness === "right") {
    if (turnCoolingDown && mappedGesture.turnCrossedDeadzone && mappedGesture.forward === 0 && mappedGesture.strafe === 0) {
      return handGestureResult({
        handedness,
        jointsVisible,
        pinchDistanceMeters,
        pinching,
        armed: true,
        dwellMs,
        relativeOffsetMeters,
        movementCrossedDeadzone: true,
        blockedReason: "turn_cooldown",
      });
    }
    if (mappedGesture.turn !== 0) {
      input.gestureState.lastTurnAtMs = input.now;
    }
  }

  return handGestureResult({
    forward: mappedGesture.forward,
    strafe: mappedGesture.strafe,
    turn: mappedGesture.turn,
    handedness,
    jointsVisible,
    pinchDistanceMeters,
    pinching,
    armed: true,
    dwellMs,
    relativeOffsetMeters,
    movementCrossedDeadzone: mappedGesture.movementCrossedDeadzone,
    ...(mappedGesture.movementCrossedDeadzone ? {} : { blockedReason: "below_deadzone" }),
  });
}

export function handGestureResult(input: Partial<LocomotionVectorEvidence> & {
  handedness: "left" | "right";
  jointsVisible: import("@openclinxr/xr-runtime-state").LocomotionAttemptDiagnosticsEvidence["handGestureHands"][number]["jointsVisible"];
  pinchDistanceMeters: number | null;
  pinching: boolean;
  armed: boolean;
  dwellMs: number;
  relativeOffsetMeters: { x: number; z: number } | null;
  movementCrossedDeadzone: boolean;
  blockedReason?: XrHandGestureVectorResult["blockedReason"];
}): XrHandGestureVectorResult {
  const blockedReason = input.blockedReason;
  return {
    forward: input.forward ?? 0,
    strafe: input.strafe ?? 0,
    turn: input.turn ?? 0,
    armed: input.armed,
    dwellMs: input.dwellMs,
    ...(blockedReason ? { blockedReason } : {}),
    diagnostic: {
      handedness: input.handedness,
      jointsVisible: input.jointsVisible,
      pinchDistanceMeters: input.pinchDistanceMeters,
      pinching: input.pinching,
      armed: input.armed,
      dwellMs: input.dwellMs,
      relativeOffsetMeters: input.relativeOffsetMeters,
      movementCrossedDeadzone: input.movementCrossedDeadzone,
      ...(blockedReason ? { blockedReason } : {}),
    },
  };
}

export function applyLocomotion(input: LocomotionUpdateInput): ManualPerformanceInputEvidence {
  const xrLocomotion = readXrGamepadLocomotion(input.session);
  const keyboardVector: LocomotionVectorEvidence = {
    forward: clampLocomotionUnit(input.keyboardLocomotion.forward),
    strafe: clampLocomotionUnit(input.keyboardLocomotion.strafe),
    turn: clampLocomotionUnit(input.keyboardLocomotion.turn),
  };
  const xrVector: LocomotionVectorEvidence = {
    forward: xrLocomotion.forward,
    strafe: xrLocomotion.strafe,
    turn: xrLocomotion.turn,
  };
  const xrHandGestureLocomotion = readXrHandGestureLocomotion({
    renderer: input.renderer,
    gestureState: input.handGestureLocomotionState,
    now: input.now,
    otherLocomotionSourceActive: isLocomotionVectorActive(keyboardVector) || isLocomotionVectorActive(xrVector),
  });
  const xrHandGestureVector: LocomotionVectorEvidence = {
    forward: xrHandGestureLocomotion.forward,
    strafe: xrHandGestureLocomotion.strafe,
    turn: xrHandGestureLocomotion.turn,
  };
  const forward = clampLocomotionUnit(keyboardVector.forward + xrVector.forward + xrHandGestureVector.forward);
  const strafe = clampLocomotionUnit(keyboardVector.strafe + xrVector.strafe + xrHandGestureVector.strafe);
  const turn = clampLocomotionUnit(keyboardVector.turn + xrVector.turn + xrHandGestureVector.turn);
  const speedMetersPerSecond = 1.35;
  const previousRigPose: import("@openclinxr/xr-runtime-state").RigPoseEvidence = {
    x: Number(input.locomotionRig.position.x.toFixed(3)),
    z: Number(input.locomotionRig.position.z.toFixed(3)),
    yawRadians: Number(input.locomotionRig.rotation.y.toFixed(3)),
  };

  input.locomotionRig.rotation.y += turn * input.deltaSeconds * 1.8;
  const yaw = input.locomotionRig.rotation.y;
  const forwardVector = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const rightVector = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  input.locomotionRig.position
    .addScaledVector(forwardVector, forward * speedMetersPerSecond * input.deltaSeconds)
    .addScaledVector(rightVector, strafe * speedMetersPerSecond * input.deltaSeconds);
  input.locomotionRig.position.x = clampLocomotion(input.locomotionRig.position.x, -2.75, 2.75);
  input.locomotionRig.position.z = clampLocomotion(input.locomotionRig.position.z, -2.25, 2.25);

  return buildManualPerformanceInputEvidence({
    handModelCount: input.handModelCount,
    handModelStatus: input.handModelStatus,
    ...(input.activeHandRepresentationKind ? { activeHandRepresentationKind: input.activeHandRepresentationKind } : {}),
    ...(input.handAssetLoadErrors && input.handAssetLoadErrors.length > 0 ? { handAssetLoadErrors: input.handAssetLoadErrors } : {}),
    handInputsObserved: Math.max(xrLocomotion.handInputsObserved, xrHandGestureLocomotion.handInputsObserved),
    keyboardVector,
    xrVector,
    xrHandGestureVector,
    xrHandGestureState: xrHandGestureLocomotion.state,
    locomotionDiagnostics: {
      claimScope: "attempt_diagnostics_only",
      gamepadDeadzone: XR_LOCOMOTION_GAMEPAD_DEADZONE,
      handPinchThresholdMeters: HAND_PINCH_DISTANCE_THRESHOLD_METERS,
      handGestureDeadzoneMeters: HAND_GESTURE_DEADZONE_METERS,
      handGestureTurnDeadzoneMeters: HAND_GESTURE_TURN_DEADZONE_METERS,
      gamepadSources: xrLocomotion.diagnostics,
      handGestureHands: xrHandGestureLocomotion.diagnostics,
    },
    xrInputSources: xrLocomotion.inputSources,
    now: input.now,
    previousLastInputObservedAtMs: input.lastInputObservedAtMs,
    previousLastLocomotionAtMs: input.lastLocomotionAtMs,
    previousRigPose,
    rigPosition: {
      x: Number(input.locomotionRig.position.x.toFixed(3)),
      z: Number(input.locomotionRig.position.z.toFixed(3)),
    },
    rigYawRadians: Number(input.locomotionRig.rotation.y.toFixed(3)),
    previousRoomScalePose: input.previousRoomScalePose,
    roomScalePose: input.roomScalePose,
  });
}

export function sampleRoomScalePose(input: {
  camera: { position: { x: number; z: number } };
  renderer: { xr: { updateCamera(camera: unknown): void } };
  presenting: boolean;
}): import("@openclinxr/xr-runtime-state").RigPoseEvidence | null {
  if (!input.presenting) {
    return null;
  }
  input.renderer.xr.updateCamera(input.camera);
  return {
    x: Number(input.camera.position.x.toFixed(3)),
    z: Number(input.camera.position.z.toFixed(3)),
    yawRadians: 0,
  };
}

export function maybeCompleteTraceActionFromHandSelect(input: {
  renderer: XrHandRenderer;
  handSelectState: XrHandSelectState;
  now: number;
  controllerInputActive: boolean;
  isFullVrPresenting: () => boolean;
  onSelect: () => boolean;
}): XrHandSelectStateEvidence {
  const hand = input.renderer.xr.getHand(1) as XrHandGroup;
  const rightPinch = isXrHandPinching(hand);
  if (!input.isFullVrPresenting()) {
    resetHandSelectState(input.handSelectState);
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: false,
      rightPinch,
      blockedReason: "trace_unavailable",
    });
  }
  if (!rightPinch) {
    resetHandSelectState(input.handSelectState);
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "idle",
      armed: false,
      rightPinch,
      blockedReason: "not_pinching",
    });
  }
  if (input.controllerInputActive) {
    resetHandSelectState(input.handSelectState);
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: false,
      rightPinch,
      blockedReason: "controller_input_active",
    });
  }

  const wrist = hand.joints?.["wrist"];
  const indexTip = hand.joints?.["index-finger-tip"];
  const thumbTip = hand.joints?.["thumb-tip"];
  if (!wrist?.visible || !indexTip?.visible || !thumbTip?.visible) {
    resetHandSelectState(input.handSelectState);
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: false,
      rightPinch,
      blockedReason: "missing_joints",
    });
  }

  const offsetX = indexTip.position.x - wrist.position.x;
  const offsetZ = indexTip.position.z - wrist.position.z;
  if (input.handSelectState.pinchingSinceMs === null) {
    input.handSelectState.pinchingSinceMs = input.now;
    input.handSelectState.neutralOffsetX = offsetX;
    input.handSelectState.neutralOffsetZ = offsetZ;
    input.handSelectState.firedDuringPinch = false;
  }

  const dwellMs = Math.max(0, input.now - input.handSelectState.pinchingSinceMs);
  const movementMeters = Math.hypot(
    offsetX - input.handSelectState.neutralOffsetX,
    offsetZ - input.handSelectState.neutralOffsetZ,
  );
  if (movementMeters > HAND_SELECT_MOVEMENT_TOLERANCE_METERS) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: false,
      rightPinch,
      blockedReason: "moving_too_much",
    });
  }
  if (dwellMs < HAND_SELECT_DWELL_MS) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "arming",
      armed: false,
      rightPinch,
      blockedReason: "arming_dwell",
    });
  }
  const coolingDown = input.handSelectState.lastFiredAtMs !== null
    && input.now - input.handSelectState.lastFiredAtMs < HAND_SELECT_COOLDOWN_MS;
  if (coolingDown && !input.handSelectState.firedDuringPinch) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: true,
      rightPinch,
      blockedReason: "cooldown",
    });
  }
  if (input.handSelectState.firedDuringPinch) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "ready",
      armed: true,
      rightPinch,
    });
  }

  const fired = input.onSelect();
  if (!fired) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: true,
      rightPinch,
      blockedReason: "trace_unavailable",
    });
  }
  input.handSelectState.firedDuringPinch = true;
  input.handSelectState.firedCount += 1;
  input.handSelectState.lastFiredAtMs = input.now;
  return handSelectEvidence(input.handSelectState, input.now, {
    status: "fired",
    armed: true,
    rightPinch,
  });
}

export function handSelectEvidence(
  state: XrHandSelectState,
  now: number,
  evidence: Pick<XrHandSelectStateEvidence, "status" | "armed" | "rightPinch"> & {
    blockedReason?: XrHandSelectStateEvidence["blockedReason"];
  },
): XrHandSelectStateEvidence {
  return {
    status: evidence.status,
    armed: evidence.armed,
    dwellMs: state.pinchingSinceMs === null ? 0 : Number(Math.max(0, now - state.pinchingSinceMs).toFixed(2)),
    rightPinch: evidence.rightPinch,
    firedCount: state.firedCount,
    lastFiredAtMs: state.lastFiredAtMs === null ? null : Number(state.lastFiredAtMs.toFixed(2)),
    ...(evidence.blockedReason ? { blockedReason: evidence.blockedReason } : {}),
  };
}

export function recordHandSelectTraceLatency(
  evidence: XrHandSelectStateEvidence | undefined,
  now: number,
  previous: import("@openclinxr/xr-runtime-state").ManualPerformanceTraceLatencyEvidence | null | undefined,
): import("@openclinxr/xr-runtime-state").ManualPerformanceTraceLatencyEvidence | null {
  if (!evidence) {
    return null;
  }
  if (evidence.status === "idle" && !evidence.rightPinch) {
    return null;
  }
  const prior = previous?.source === "xr_hand_select" ? previous : null;
  return {
    lastTraceTag: prior?.lastTraceTag ?? null,
    lastSelectLatencyMs: prior?.lastSelectLatencyMs ?? null,
    source: "xr_hand_select",
    measuredAtMs: Number(now.toFixed(2)),
    productionControllerLatencySubstitute: false,
    interactionDetail: {
      modality: "hand_pinch_select",
      handedness: "right",
      status: evidence.status,
      ...(evidence.blockedReason ? { blockedReason: evidence.blockedReason } : {}),
      dwellMs: evidence.dwellMs,
      firedCount: evidence.firedCount,
      rightPinch: evidence.rightPinch,
    },
  };
}

export function formatHandSelectStatus(state: XrHandSelectStateEvidence | undefined): string {
  if (!state) {
    return "idle";
  }
  const reason = state.blockedReason ? `; ${state.blockedReason}` : "";
  const fired = state.firedCount > 0 ? `; fired ${state.firedCount}` : "";
  return `${state.status}; dwell ${state.dwellMs}ms${fired}${reason}`;
}
