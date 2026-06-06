import {
  validateModelVettingReport,
  type ModelVettingCandidate,
  type ModelVettingReport,
} from "@openclinxr/model-vetting";

export const modelVettingStudioReportUrl = new URL(
  "../../../../docs/openclinxr/model-vetting-report-peds-asthma-parent-anxiety-2026-06-06.json",
  import.meta.url,
).href;

export const actorPlayerRuntimeEvidenceUrl = new URL(
  "../../../../docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json",
  import.meta.url,
).href;

export const modelVettingCaptureManifestUrl = new URL(
  "../../../../docs/openclinxr/model-vetting-capture-manifest-peds-asthma-parent-anxiety-2026-06-05.json",
  import.meta.url,
).href;

export type ModelVettingCaptureSlotId =
  | "front_screenshot"
  | "side_screenshot"
  | "three_quarter_screenshot"
  | "turntable_video"
  | "viseme_timeline_video"
  | "emotion_transition_video";

export type ModelVettingCaptureSlot = {
  slotId: ModelVettingCaptureSlotId;
  label: string;
  mediaKind: "screenshot" | "video";
  deterministicView: string;
  requiredFor: "isolated_lab_capture";
  status: "missing" | "captured";
  artifactPath: string | null;
  notEvidenceFor: ModelVettingReport["notEvidenceFor"];
};

export type ModelVettingStudioCandidateView = {
  candidateId: string;
  actorId: string;
  actorDisplayRole: string;
  sourceGlbPath: string;
  sourceKind: ModelVettingCandidate["sourceKind"];
  usesRealAnnyForwardPass: boolean;
  roleMaterialHandoff: ModelVettingCandidate["roleMaterialHandoff"] | null;
  roleAnimationHandoff: ModelVettingCandidate["roleAnimationHandoff"] | null;
  proceduralFaceDetailHandoff: ModelVettingCandidate["proceduralFaceDetailHandoff"] | null;
  gateResult: ModelVettingCandidate["gateResult"];
  labModeSummary: Array<{
    modeId: string;
    status: string;
    blockers: string[];
  }>;
  captureSlots: ModelVettingCaptureSlot[];
  blockers: string[];
};

export type ActorPlayerTurnPreview = {
  turnId: string;
  cue: string;
  expectedEmotion: string;
  roleAnimationClipName: string | null;
  sampleCount: number;
  firstTurnText: string | null;
  gazeTargetKind: string | null;
  postureCue: string | null;
  sceneExecutionStatus: "not_scene_executed" | string;
  remainingBlockers: string[];
};

export type ActorPlayerMediaHandoff = {
  speechVisemeTimelineVideoPath: string | null;
  emotionTransitionVideoPath: string | null;
  gazeBlinkTurntableVideoPath: string | null;
  postureAndMaterialArtifactCount: number;
  postureAndMaterialArtifactPaths: string[];
};

export type ActorPlayerPreviewActor = {
  actorId: string;
  candidateId: string | null;
  roleAnimationHandoff: ModelVettingCandidate["roleAnimationHandoff"] | null;
  turnCount: number;
  sampleCount: number;
  mediaHandoff: ActorPlayerMediaHandoff;
  turns: ActorPlayerTurnPreview[];
};

export type ActorPlayerRuntimePreview = {
  source: "model_vetting_actor_player_runtime_evidence";
  evidenceUrl: string;
  schemaVersion: string;
  executionMode: "local_deterministic_non_scene" | string;
  actorCount: number;
  turnCount: number;
  sampleCount: number;
  providerExecutionPerformed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  scenePlacementEvidenceAllowed: false;
  claimBoundary: "non_scene_actor_player_preview_not_runtime_or_readiness";
  actors: ActorPlayerPreviewActor[];
  notEvidenceFor: string[];
};

export type ModelVettingStudioEvidence = {
  source: "window.__openClinXrModelVettingStudioEvidence";
  reportUrl: string;
  reportSchemaVersion: ModelVettingReport["schemaVersion"];
  claimScope: ModelVettingReport["claimScope"];
  providerExecutionEnabled: false;
  scenePlacementEvidenceAllowed: boolean;
  runtimePromotionAllowed: false;
  productionManifestPromotionAllowed: false;
  candidateCount: number;
  candidates: ModelVettingStudioCandidateView[];
  fixedCameraPresets: ["front", "side", "three_quarter"];
  videoCapturePresets: ["turntable", "viseme_timeline", "emotion_transition"];
  actorPlayerPreview: ActorPlayerRuntimePreview | null;
  notEvidenceFor: ModelVettingReport["notEvidenceFor"];
};

export async function loadModelVettingStudioEvidence(
  reportUrl = modelVettingStudioReportUrl,
  actorPlayerUrl = actorPlayerRuntimeEvidenceUrl,
  captureManifestUrl = modelVettingCaptureManifestUrl,
): Promise<ModelVettingStudioEvidence> {
  const [response, actorPlayerResponse, captureManifestResponse] = await Promise.all([
    fetch(reportUrl),
    fetch(actorPlayerUrl),
    fetch(captureManifestUrl),
  ]);
  if (!response.ok) throw new Error(`Unable to load model-vetting report: ${response.status}`);
  const actorPlayerEvidence = actorPlayerResponse.ok ? await actorPlayerResponse.json() as unknown : null;
  const captureManifest = captureManifestResponse.ok ? await captureManifestResponse.json() as unknown : null;
  return buildModelVettingStudioEvidence(await response.json() as unknown, reportUrl, actorPlayerEvidence, actorPlayerUrl, captureManifest);
}

export function buildModelVettingStudioEvidence(
  value: unknown,
  reportUrl: string,
  actorPlayerEvidence: unknown = null,
  actorPlayerUrl = actorPlayerRuntimeEvidenceUrl,
  captureManifest: unknown = null,
): ModelVettingStudioEvidence {
  const validation = validateModelVettingReport(value);
  if (!validation.ok) throw new Error(`Invalid model-vetting report: ${validation.errors.join("; ")}`);
  const report = value as ModelVettingReport;
  const captureSlotLookup = buildCaptureManifestSlotLookup(captureManifest, report.notEvidenceFor);

  return {
    source: "window.__openClinXrModelVettingStudioEvidence",
    reportUrl,
    reportSchemaVersion: report.schemaVersion,
    claimScope: report.claimScope,
    providerExecutionEnabled: report.providerBoundary.providerExecutionEnabled,
    scenePlacementEvidenceAllowed: report.decision.scenePlacementEvidenceAllowed,
    runtimePromotionAllowed: report.decision.runtimePromotionAllowed,
    productionManifestPromotionAllowed: report.decision.productionManifestPromotionAllowed,
    candidateCount: report.candidates.length,
    candidates: report.candidates.map((candidate) => buildCandidateView(candidate, report.notEvidenceFor, captureSlotLookup.get(candidate.candidateId))),
    fixedCameraPresets: ["front", "side", "three_quarter"],
    videoCapturePresets: ["turntable", "viseme_timeline", "emotion_transition"],
    actorPlayerPreview: buildActorPlayerRuntimePreview(actorPlayerEvidence, actorPlayerUrl),
    notEvidenceFor: report.notEvidenceFor,
  };
}

function buildActorPlayerRuntimePreview(value: unknown, evidenceUrl: string): ActorPlayerRuntimePreview | null {
  if (!isRecord(value)) return null;
  const actors = Array.isArray(value["actors"]) ? value["actors"].filter(isRecord).map(buildActorPlayerPreviewActor) : [];
  const turnCount = actors.reduce((total, actor) => total + actor.turnCount, 0);
  const sampleCount = actors.reduce((total, actor) => total + actor.sampleCount, 0);
  return {
    source: "model_vetting_actor_player_runtime_evidence",
    evidenceUrl,
    schemaVersion: typeof value["schemaVersion"] === "string" ? value["schemaVersion"] : "unknown",
    executionMode: typeof value["executionMode"] === "string" ? value["executionMode"] : "local_deterministic_non_scene",
    actorCount: actors.length,
    turnCount,
    sampleCount,
    providerExecutionPerformed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    scenePlacementEvidenceAllowed: false,
    claimBoundary: "non_scene_actor_player_preview_not_runtime_or_readiness",
    actors,
    notEvidenceFor: Array.isArray(value["notEvidenceFor"]) ? value["notEvidenceFor"].filter((claim): claim is string => typeof claim === "string") : [],
  };
}

function buildActorPlayerPreviewActor(value: Record<string, unknown>): ActorPlayerPreviewActor {
  const turns = Array.isArray(value["caseDerivedTurnSequence"])
    ? value["caseDerivedTurnSequence"].filter(isRecord).map(buildActorPlayerTurnPreview)
    : [];
  return {
    actorId: typeof value["actorId"] === "string" ? value["actorId"] : "unknown_actor",
    candidateId: typeof value["candidateId"] === "string" ? value["candidateId"] : null,
    roleAnimationHandoff: buildRoleAnimationHandoff(value["roleAnimationHandoff"]),
    turnCount: turns.length,
    sampleCount: turns.reduce((total, turn) => total + turn.sampleCount, 0),
    mediaHandoff: buildActorPlayerMediaHandoff(value["sourceCaptureArtifacts"]),
    turns,
  };
}

function buildActorPlayerMediaHandoff(value: unknown): ActorPlayerMediaHandoff {
  const sourceCaptureArtifacts = isRecord(value) ? value : {};
  const postureAndMaterialArtifactPaths = Array.isArray(sourceCaptureArtifacts["postureAndMaterialArtifactPaths"])
    ? sourceCaptureArtifacts["postureAndMaterialArtifactPaths"].filter((item): item is string => typeof item === "string")
    : [];
  return {
    speechVisemeTimelineVideoPath: typeof sourceCaptureArtifacts["speechVisemeTimelineVideoPath"] === "string" ? sourceCaptureArtifacts["speechVisemeTimelineVideoPath"] : null,
    emotionTransitionVideoPath: typeof sourceCaptureArtifacts["emotionTransitionVideoPath"] === "string" ? sourceCaptureArtifacts["emotionTransitionVideoPath"] : null,
    gazeBlinkTurntableVideoPath: typeof sourceCaptureArtifacts["gazeBlinkTurntableVideoPath"] === "string" ? sourceCaptureArtifacts["gazeBlinkTurntableVideoPath"] : null,
    postureAndMaterialArtifactCount: postureAndMaterialArtifactPaths.length,
    postureAndMaterialArtifactPaths,
  };
}

function buildActorPlayerTurnPreview(value: Record<string, unknown>): ActorPlayerTurnPreview {
  const samples = Array.isArray(value["samples"]) ? value["samples"].filter(isRecord) : [];
  const firstSample = samples[0];
  return {
    turnId: typeof value["turnId"] === "string" ? value["turnId"] : "unknown_turn",
    cue: typeof value["cue"] === "string" ? value["cue"] : "unknown_cue",
    expectedEmotion: typeof value["expectedEmotion"] === "string" ? value["expectedEmotion"] : "unknown_emotion",
    roleAnimationClipName: typeof value["roleAnimationClipName"] === "string"
      ? value["roleAnimationClipName"]
      : firstSample && typeof firstSample["roleAnimationClipName"] === "string"
        ? firstSample["roleAnimationClipName"]
        : null,
    sampleCount: samples.length,
    firstTurnText: firstSample && typeof firstSample["turnText"] === "string" ? firstSample["turnText"] : null,
    gazeTargetKind: firstSample && typeof firstSample["gazeTargetKind"] === "string" ? firstSample["gazeTargetKind"] : null,
    postureCue: firstSample && typeof firstSample["postureCue"] === "string" ? firstSample["postureCue"] : null,
    sceneExecutionStatus: typeof value["sceneExecutionStatus"] === "string" ? value["sceneExecutionStatus"] : "not_scene_executed",
    remainingBlockers: Array.isArray(value["remainingBlockers"]) ? value["remainingBlockers"].filter((blocker): blocker is string => typeof blocker === "string") : [],
  };
}

function buildRoleAnimationHandoff(value: unknown): ModelVettingCandidate["roleAnimationHandoff"] | null {
  if (!isRecord(value)) return null;
  const roleSpecificClipNames = Array.isArray(value["roleSpecificClipNames"])
    ? value["roleSpecificClipNames"].filter((name): name is string => typeof name === "string")
    : [];
  const notEvidenceFor = Array.isArray(value["notEvidenceFor"])
    ? value["notEvidenceFor"].filter((claim): claim is string => typeof claim === "string")
    : [];
  if (roleSpecificClipNames.length === 0 || typeof value["claimScope"] !== "string") return null;
  return {
    actorRole: typeof value["actorRole"] === "string" ? value["actorRole"] : "unknown",
    roleSpecificClipNames,
    claimScope: value["claimScope"],
    notEvidenceFor,
  };
}

function buildCandidateView(
  candidate: ModelVettingCandidate,
  notEvidenceFor: ModelVettingReport["notEvidenceFor"],
  manifestSlots?: ModelVettingCaptureSlot[],
): ModelVettingStudioCandidateView {
  return {
    candidateId: candidate.candidateId,
    actorId: candidate.actorId,
    actorDisplayRole: candidate.actorDisplayRole,
    sourceGlbPath: candidate.sourceGlbPath,
    sourceKind: candidate.sourceKind,
    usesRealAnnyForwardPass: candidate.usesRealAnnyForwardPass,
    roleMaterialHandoff: candidate.roleMaterialHandoff ?? null,
    roleAnimationHandoff: candidate.roleAnimationHandoff ?? null,
    proceduralFaceDetailHandoff: candidate.proceduralFaceDetailHandoff ?? null,
    gateResult: candidate.gateResult,
    labModeSummary: candidate.labModes.map((mode) => ({
      modeId: mode.modeId,
      status: mode.status,
      blockers: [...mode.blockers],
    })),
    captureSlots: manifestSlots ?? buildCaptureSlots(candidate, notEvidenceFor),
    blockers: [...candidate.blockers],
  };
}

function buildCaptureManifestSlotLookup(
  value: unknown,
  notEvidenceFor: ModelVettingReport["notEvidenceFor"],
): Map<string, ModelVettingCaptureSlot[]> {
  const lookup = new Map<string, ModelVettingCaptureSlot[]>();
  if (!isRecord(value) || value["schemaVersion"] !== "openclinxr.model-vetting-capture-manifest.v1") return lookup;
  const candidates = Array.isArray(value["candidates"]) ? value["candidates"].filter(isRecord) : [];
  for (const candidate of candidates) {
    const candidateId = typeof candidate["candidateId"] === "string" ? candidate["candidateId"] : "";
    const slots = Array.isArray(candidate["slots"]) ? candidate["slots"].filter(isRecord).map((slot) => manifestSlotToCaptureSlot(slot, notEvidenceFor)) : [];
    if (candidateId && slots.length > 0) lookup.set(candidateId, slots);
  }
  return lookup;
}

function manifestSlotToCaptureSlot(value: Record<string, unknown>, notEvidenceFor: ModelVettingReport["notEvidenceFor"]): ModelVettingCaptureSlot {
  const slotId = isCaptureSlotId(value["slotId"]) ? value["slotId"] : "front_screenshot";
  const mediaKind = value["mediaKind"] === "video" ? "video" : "screenshot";
  const deterministicView = typeof value["requiredView"] === "string" ? value["requiredView"] : slotId.replace(/_(screenshot|video)$/u, "");
  const artifactPath = typeof value["artifactPath"] === "string" ? value["artifactPath"] : null;
  return {
    slotId,
    label: captureSlotLabel(slotId),
    mediaKind,
    deterministicView,
    requiredFor: "isolated_lab_capture",
    status: value["status"] === "captured" && artifactPath ? "captured" : "missing",
    artifactPath,
    notEvidenceFor,
  };
}

function isCaptureSlotId(value: unknown): value is ModelVettingCaptureSlotId {
  return value === "front_screenshot"
    || value === "side_screenshot"
    || value === "three_quarter_screenshot"
    || value === "turntable_video"
    || value === "viseme_timeline_video"
    || value === "emotion_transition_video";
}

function captureSlotLabel(slotId: ModelVettingCaptureSlotId): string {
  if (slotId === "front_screenshot") return "Front fixed camera";
  if (slotId === "side_screenshot") return "Side fixed camera";
  if (slotId === "three_quarter_screenshot") return "Three-quarter fixed camera";
  if (slotId === "turntable_video") return "Turntable clip";
  if (slotId === "viseme_timeline_video") return "Viseme timeline clip";
  return "Emotion transition clip";
}

function buildCaptureSlots(candidate: ModelVettingCandidate, notEvidenceFor: ModelVettingReport["notEvidenceFor"]): ModelVettingCaptureSlot[] {
  const screenshots = candidate.captureArtifacts.fixedCameraScreenshots;
  return [
    {
      slotId: "front_screenshot",
      label: "Front fixed camera",
      mediaKind: "screenshot",
      deterministicView: "front",
      requiredFor: "isolated_lab_capture",
      status: screenshots[0] ? "captured" : "missing",
      artifactPath: screenshots[0] ?? null,
      notEvidenceFor,
    },
    {
      slotId: "side_screenshot",
      label: "Side fixed camera",
      mediaKind: "screenshot",
      deterministicView: "side",
      requiredFor: "isolated_lab_capture",
      status: screenshots[1] ? "captured" : "missing",
      artifactPath: screenshots[1] ?? null,
      notEvidenceFor,
    },
    {
      slotId: "three_quarter_screenshot",
      label: "Three-quarter fixed camera",
      mediaKind: "screenshot",
      deterministicView: "three_quarter",
      requiredFor: "isolated_lab_capture",
      status: screenshots[2] ? "captured" : "missing",
      artifactPath: screenshots[2] ?? null,
      notEvidenceFor,
    },
    {
      slotId: "turntable_video",
      label: "Turntable clip",
      mediaKind: "video",
      deterministicView: "turntable",
      requiredFor: "isolated_lab_capture",
      status: candidate.captureArtifacts.turntableVideo ? "captured" : "missing",
      artifactPath: candidate.captureArtifacts.turntableVideo ?? null,
      notEvidenceFor,
    },
    {
      slotId: "viseme_timeline_video",
      label: "Viseme timeline clip",
      mediaKind: "video",
      deterministicView: "viseme_timeline",
      requiredFor: "isolated_lab_capture",
      status: candidate.captureArtifacts.morphVisemeTimelineCapture ? "captured" : "missing",
      artifactPath: candidate.captureArtifacts.morphVisemeTimelineCapture ?? null,
      notEvidenceFor,
    },
    {
      slotId: "emotion_transition_video",
      label: "Emotion transition clip",
      mediaKind: "video",
      deterministicView: "emotion_transition",
      requiredFor: "isolated_lab_capture",
      status: candidate.captureArtifacts.emotionTransitionCapture ? "captured" : "missing",
      artifactPath: candidate.captureArtifacts.emotionTransitionCapture ?? null,
      notEvidenceFor,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
