import type {
  ExamineeLocomotionEvidence,
  ManualPerformanceInputEvidence,
  RigPoseEvidence,
} from "@openclinxr/xr-runtime-state";
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, type PerspectiveCamera, Vector3 } from "three";
import type { PortalTransitionContext, PortalTransitionEvidence, PortalTransitionSide } from "./types.js";

export const PORTAL_THRESHOLD_Z = 0.72;

export function parsePortalPreviewStart(search: string): PortalTransitionSide | null {
  const params = new URLSearchParams(search);
  const selected = params.get("openclinxrPortalStart")?.trim() ?? "";
  if (selected === "exterior" || selected === "exterior_note_room") return "exterior_note_room";
  if (selected === "threshold" || selected === "portal_threshold") return "portal_threshold";
  if (selected === "encounter" || selected === "dynamic_encounter_world") return "dynamic_encounter_world";
  return null;
}

export function applyDeterministicPortalPreviewStart(
  ctx: Pick<PortalTransitionContext, "portalThresholdZ" | "deterministicPreviewStart" | "setPortalLastTransitionReason">,
  locomotionRig: Group,
): void {
  const selected = ctx.deterministicPreviewStart;
  if (!selected) return;
  if (selected === "exterior_note_room") {
    locomotionRig.position.z = 1.35;
  } else if (selected === "portal_threshold") {
    locomotionRig.position.z = ctx.portalThresholdZ;
  } else {
    locomotionRig.position.z = -0.62;
  }
  ctx.setPortalLastTransitionReason(`deterministic_portal_preview_start_${selected}`);
}

export function updatePortalTransitionEvidence(
  ctx: PortalTransitionContext,
  locomotionRig: Group,
  camera: PerspectiveCamera,
): PortalTransitionEvidence {
  const headWorldPosition = new Vector3();
  camera.getWorldPosition(headWorldPosition);
  const headWorldZ = Number(headWorldPosition.z.toFixed(3));
  const locomotionRigZ = Number(locomotionRig.position.z.toFixed(3));
  const desktopPreviewCameraOffsetZ = Number(camera.position.z.toFixed(3));
  const transitionProbeZ = Number((headWorldZ - desktopPreviewCameraOffsetZ).toFixed(3));
  const side: PortalTransitionSide = transitionProbeZ > ctx.portalThresholdZ + 0.25
    ? "exterior_note_room"
    : transitionProbeZ >= ctx.portalThresholdZ - 0.25
      ? "portal_threshold"
      : "dynamic_encounter_world";
  const justCrossed = !ctx.portalEncounterEntered && side === "dynamic_encounter_world";
  if (justCrossed) {
    ctx.setPortalEncounterEntered(true);
    ctx.setPortalEncounterStartedByPortal(ctx.examPhase === "encounter");
    ctx.setPortalLastTransitionReason("portal_crossed_into_dynamic_encounter_world");
  }
  const portalInteriorHiddenObjectNames = updateReusableExteriorAnteroomVisibility(ctx, side);
  const reusableExteriorHiddenForEncounterView = side === "dynamic_encounter_world";
  return {
    source: "window.__openClinXrPortalTransitionEvidence",
    scenarioId: ctx.scenarioId,
    portalThresholdZ: ctx.portalThresholdZ,
    headWorldZ,
    locomotionRigZ,
    desktopPreviewCameraOffsetZ,
    transitionProbeZ,
    side,
    encounterEntered: ctx.portalEncounterEntered || justCrossed,
    encounterStartedByPortal: ctx.portalEncounterStartedByPortal || (justCrossed && ctx.examPhase === "encounter"),
    deterministicPreviewStart: ctx.deterministicPreviewStart,
    reusableExteriorHiddenForEncounterView,
    portalInteriorHiddenObjectNames,
    noteCaptureLocation: "reusable_exterior_anteroom",
    lastTransitionReason: justCrossed ? "portal_crossed_into_dynamic_encounter_world" : ctx.portalLastTransitionReason,
    notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness", "motion_comfort_validation"],
  };
}

export function updateReusableExteriorAnteroomVisibility(
  ctx: Pick<PortalTransitionContext, "reusableExteriorAnteroom">,
  side: PortalTransitionSide,
): string[] {
  if (!ctx.reusableExteriorAnteroom) return [];
  const hiddenObjectNames: string[] = [];
  const insideDynamicEncounter = side === "dynamic_encounter_world";
  ctx.reusableExteriorAnteroom.traverse((object) => {
    if (
      object.name.includes("patient-note-capture-cue")
      || object.name.includes("portal-left-wall")
      || object.name.includes("portal-right-wall")
      || object.name.includes("portal-header-wall")
      || object.name.includes("portal-left-jamb")
      || object.name.includes("portal-right-jamb")
      || object.name.includes("portal-lintel")
      || object.name.includes("encounter-portal-dynamic-threshold")
      || object.name.includes("encounter-portal-dynamic-opening")
      || object.name.endsWith(".floor")
      || object.userData["openClinXrPortalInteriorReviewAffordance"] === true
    ) {
      object.visible = !insideDynamicEncounter;
      object.userData["openClinXrPortalInteriorVisibilityPolicy"] =
        "hidden_after_portal_entry_so_reusable_note_shell_and_frame_do_not_occlude_dynamic_encounter_world";
      if (insideDynamicEncounter) hiddenObjectNames.push(object.name);
    }
  });
  return hiddenObjectNames;
}

export function formatPortalTransitionEvidence(evidence: PortalTransitionEvidence | null): string {
  if (!evidence) {
    return "portal pending";
  }
  return [
    `portal ${evidence.side}`,
    evidence.encounterEntered ? "entered dynamic encounter" : "outside encounter",
    evidence.encounterStartedByPortal ? "portal started encounter" : "portal start pending",
    evidence.reusableExteriorHiddenForEncounterView ? "exterior shell hidden" : "exterior shell visible",
    `note ${evidence.noteCaptureLocation}`,
  ].join("; ");
}

export function createExamineeLocomotionTrail(isSceneOnlyVisualReviewCaptureMode: boolean): Group {
  const trail = new Group();
  trail.name = "openclinxr.examinee-locomotion-trail-cue";
  const visibleInSceneOnlyReview = !isSceneOnlyVisualReviewCaptureMode;
  const ring = new Mesh(
    new CylinderGeometry(0.2, 0.2, 0.012, 32),
    new MeshBasicMaterial({ color: 0x2f80ed, transparent: true, opacity: 0.38 }),
  );
  ring.name = "examinee_runtime_position_ring_cue";
  ring.position.y = 0.012;
  ring.visible = visibleInSceneOnlyReview;
  trail.add(ring);
  const heading = new Mesh(
    new BoxGeometry(0.055, 0.018, 0.32),
    new MeshBasicMaterial({ color: 0x113f75, transparent: true, opacity: 0.6 }),
  );
  heading.name = "examinee_runtime_heading_cue";
  heading.position.set(0, 0.04, -0.18);
  heading.visible = visibleInSceneOnlyReview;
  trail.add(heading);
  trail.visible = false;
  return trail;
}

export function buildExamineeLocomotionEvidence(input: {
  inputEvidence: ManualPerformanceInputEvidence;
  startPose: RigPoseEvidence | null;
  distanceMeters: number;
  turnRadians: number;
  sampleCount: number;
}): ExamineeLocomotionEvidence | null {
  const source = input.inputEvidence.activeLocomotionSource ?? "none";
  const delta = input.inputEvidence.locomotionDelta;
  if (source === "none" || !delta) {
    return null;
  }
  const currentPose: RigPoseEvidence = {
    x: input.inputEvidence.rigPosition.x,
    z: input.inputEvidence.rigPosition.z,
    yawRadians: Number((input.turnRadians + delta.turnRadians).toFixed(3)),
  };
  return {
    source: source === "mixed" ? "mixed" : source,
    startPose: input.startPose ?? currentPose,
    currentPose,
    distanceMeters: Number((input.distanceMeters + delta.distanceMeters).toFixed(3)),
    turnRadians: Number((input.turnRadians + delta.turnRadians).toFixed(3)),
    sampleCount: input.sampleCount + 1,
    pathCueIds: [
      "examinee_runtime_position_ring_cue",
      "examinee_runtime_heading_cue",
      "structured_examinee_locomotion_path_evidence",
    ],
    notEvidenceFor: [
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "motion_comfort_validation",
    ],
  };
}

export function updateExamineeLocomotionTrail(
  trail: Group,
  evidence: ExamineeLocomotionEvidence,
  isSceneOnlyVisualReviewCaptureMode: boolean,
): void {
  if (isSceneOnlyVisualReviewCaptureMode) {
    trail.visible = false;
    for (const child of trail.children) {
      child.visible = false;
    }
    trail.userData["openClinXrDynamicScenePolicy"] = "hidden_in_scene_only_visual_review_while_locomotion_evidence_remains_window_backed";
    return;
  }
  trail.visible = true;
  trail.position.set(evidence.currentPose.x, 0.01, evidence.currentPose.z);
  trail.rotation.y = evidence.currentPose.yawRadians;
  trail.userData["openClinXrExamineeLocomotionEvidence"] = evidence;
}
