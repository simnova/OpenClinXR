import type {
  ExamineeLocomotionEvidence,
  LocomotionAttemptDiagnosticsEvidence,
  LocomotionVectorEvidence,
  ManualPerformanceInputEvidence,
  RigPoseEvidence,
  XrHandGestureStateEvidence,
  XrHandSelectStateEvidence,
  XrInputSourceEvidence,
} from "@openclinxr/xr-runtime-state";
import type { Group } from "three";

export type KeyboardLocomotionState = {
  forward: number;
  strafe: number;
  turn: number;
};

export type XrHandGestureHandState = {
  pinchingSinceMs: number | null;
  neutralOffsetX: number;
  neutralOffsetZ: number;
  armed: boolean;
};

export type XrHandGestureLocomotionState = {
  hands: Record<"left" | "right", XrHandGestureHandState>;
  lastTurnAtMs: number | null;
};

export type XrHandGestureLocomotionResult = LocomotionVectorEvidence & {
  handInputsObserved: number;
  state: XrHandGestureStateEvidence;
  diagnostics: LocomotionAttemptDiagnosticsEvidence["handGestureHands"];
};

export type XrHandGestureVectorResult = LocomotionVectorEvidence & {
  armed: boolean;
  dwellMs: number;
  blockedReason?: XrHandGestureStateEvidence["blockedReason"] | "below_deadzone" | "turn_cooldown";
  diagnostic: LocomotionAttemptDiagnosticsEvidence["handGestureHands"][number];
};

export type XrHandSelectState = {
  pinchingSinceMs: number | null;
  neutralOffsetX: number;
  neutralOffsetZ: number;
  firedDuringPinch: boolean;
  firedCount: number;
  lastFiredAtMs: number | null;
};

export type XrHandJointGroup = Group & {
  jointRadius?: number;
};

export type XrHandGroup = Group & {
  joints?: Record<string, XrHandJointGroup | undefined>;
  userData: {
    openClinXrHandedness?: string;
  };
};

export type XrInputSourceWithGamepad = {
  handedness?: "left" | "right" | "none" | string;
  hand?: unknown;
  gamepad?: {
    axes?: readonly number[];
  };
};

export type XrSessionLike = {
  inputSources?: Iterable<XrInputSourceWithGamepad>;
};

export type PortalTransitionSide = "exterior_note_room" | "portal_threshold" | "dynamic_encounter_world";

export type PortalTransitionEvidence = {
  source: "window.__openClinXrPortalTransitionEvidence";
  scenarioId: string;
  portalThresholdZ: number;
  headWorldZ: number;
  locomotionRigZ: number;
  desktopPreviewCameraOffsetZ: number;
  transitionProbeZ: number;
  side: PortalTransitionSide;
  encounterEntered: boolean;
  encounterStartedByPortal: boolean;
  deterministicPreviewStart: PortalTransitionSide | null;
  reusableExteriorHiddenForEncounterView: boolean;
  portalInteriorHiddenObjectNames: string[];
  noteCaptureLocation: "reusable_exterior_anteroom";
  lastTransitionReason: string | null;
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness" | "motion_comfort_validation">;
};

export type LocomotionUpdateInput = {
  deltaSeconds: number;
  keyboardLocomotion: KeyboardLocomotionState;
  locomotionRig: Group;
  now: number;
  renderer: { xr: { getHand(index: number): unknown } };
  session: XrSessionLike | undefined;
  lastInputObservedAtMs: number | null;
  lastLocomotionAtMs: number | null;
  handModelCount: number;
  handModelStatus: ManualPerformanceInputEvidence["handModelStatus"];
  activeHandRepresentationKind?: ManualPerformanceInputEvidence["handRepresentationKind"];
  handAssetLoadErrors?: string[];
  handGestureLocomotionState: XrHandGestureLocomotionState;
  previousRoomScalePose: RigPoseEvidence | null;
  roomScalePose: RigPoseEvidence | null;
};

export type PortalTransitionContext = {
  portalThresholdZ: number;
  portalEncounterEntered: boolean;
  portalEncounterStartedByPortal: boolean;
  portalLastTransitionReason: string | null;
  reusableExteriorAnteroom: Group | null;
  scenarioId: string;
  examPhase: string;
  deterministicPreviewStart: PortalTransitionSide | null;
  setPortalEncounterEntered(value: boolean): void;
  setPortalEncounterStartedByPortal(value: boolean): void;
  setPortalLastTransitionReason(value: string | null): void;
};

export type RolePostureContext = {
  actorRole: (actorId: string) => string | undefined;
  isPatient: (actorId: string) => boolean;
  isClinicalTeam: (actorId: string) => boolean;
  isFamily: (actorId: string) => boolean;
  isPediatricAsthmaScenario: () => boolean;
  scenarioId: string;
};

export type HandSelectTraceInput = {
  handSelectState: XrHandSelectState;
  now: number;
  controllerInputActive: boolean;
  isFullVrPresenting: boolean;
  rightPinch: boolean;
  jointsVisible: boolean;
  offsetX: number;
  offsetZ: number;
  onSelect: () => boolean;
};

export type { ExamineeLocomotionEvidence };
