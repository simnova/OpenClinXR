import type {
  ManualPerformanceCaptureSummary,
  ManualPerformanceDraft,
  ManualPerformanceFrameStats,
  ManualPerformanceInputEvidence,
  ManualPerformanceReproducibilityEvidence,
  ManualPerformanceTraceLatencyEvidence,
  RuntimeEvidencePosture,
  RuntimeInteractionEvidence,
  XrRuntimeReadinessDecision,
  XrTraceActionHandoffEvidence,
  XrTraceInteractionEvidenceSummary,
} from "@openclinxr/xr-runtime-state";
import type {
  FrameRecordingContext,
  HumanoidSpeechEvidenceContext,
  ManualEvidencePanelContext,
  RuntimeReproducibilityContext,
  TraceHandoffContext,
  TraceInteractionSummaryContext,
  TraceReadinessContext,
  XrSupportStatusContext,
} from "./types.js";

declare global {
  interface Window {
    __openClinXrTraceLatencyEvidence?: ManualPerformanceTraceLatencyEvidence;
    __openClinXrTraceActionHandoffEvidence?: XrTraceActionHandoffEvidence;
    __openClinXrTraceInteractionEvidenceSummary?: XrTraceInteractionEvidenceSummary;
    __openClinXrRuntimeEvidencePosture?: RuntimeEvidencePosture;
    __openClinXrRuntimeReadinessDecision?: XrRuntimeReadinessDecision;
    __openClinXrFrameStats?: ManualPerformanceFrameStats;
    __openClinXrManualPerformanceDraft?: ManualPerformanceDraft;
    __openClinXrManualPerformanceCaptureSummary?: ManualPerformanceCaptureSummary;
  }
}

export function createTraceSelectLatencyRecorder(options?: {
  nowMs?: () => number;
  latencyWritten?: (record: {
    tag: string;
    latencyMs: number;
    source: ManualPerformanceTraceLatencyEvidence["source"];
    measuredAtMs: number;
  }) => void;
}): {
  recordLatency: (
    startedAtMs: number,
    tag: string,
    source: ManualPerformanceTraceLatencyEvidence["source"],
  ) => number;
  currentLatencyMs: () => number | null;
} {
  let lastTraceSelectLatencyMs: number | null = null;
  const nowMs = options?.nowMs ?? (() => performance.now());
  return {
    recordLatency: (startedAtMs, tag, source) => {
      lastTraceSelectLatencyMs = Number((nowMs() - startedAtMs).toFixed(2));
      const measuredAtMs = Number(nowMs().toFixed(2));
      if (typeof window !== "undefined") {
        window.__openClinXrTraceLatencyEvidence = {
          lastTraceTag: tag,
          lastSelectLatencyMs: lastTraceSelectLatencyMs,
          source,
          measuredAtMs,
          productionControllerLatencySubstitute: false,
        };
      }
      options?.latencyWritten?.({ tag, latencyMs: lastTraceSelectLatencyMs, source, measuredAtMs });
      return lastTraceSelectLatencyMs;
    },
    currentLatencyMs: () => lastTraceSelectLatencyMs,
  };
}

export function recordTraceSelectLatency(
  recorder: { recordLatency: (startedAtMs: number, tag: string, source: ManualPerformanceTraceLatencyEvidence["source"]) => number },
  startedAtMs: number,
  tag: string,
  source: ManualPerformanceTraceLatencyEvidence["source"],
): number {
  return recorder.recordLatency(startedAtMs, tag, source);
}

export type TraceHandoffPanelWiring = {
  handoffWritten: TraceHandoffContext["handoffWritten"];
  interactionSummaryWritten: TraceHandoffContext["interactionSummaryWritten"];
  buildInteractionSummary: TraceHandoffContext["buildInteractionSummary"];
};

export function updateTraceActionHandoffEvidence(
  ctx: TraceHandoffContext,
  wiring?: TraceHandoffPanelWiring,
): XrTraceActionHandoffEvidence {
  const evidence = ctx.buildHandoffEvidence({
    state: ctx.runtimeState(),
    actions: ctx.handoffActions(),
    generatedAtMs: ctx.roundPerformanceNow(),
    lastTraceLatencyEvidence: ctx.lastTraceLatencyEvidence(),
  });
  if (typeof window !== "undefined") {
    window.__openClinXrTraceActionHandoffEvidence = evidence;
  }
  ctx.handoffWritten(evidence);
  const summaryWiring = wiring ?? ctx;
  updateTraceInteractionEvidenceSummary(
    { buildSummary: summaryWiring.buildInteractionSummary, interactionSummaryWritten: summaryWiring.interactionSummaryWritten },
    evidence,
  );
  return evidence;
}

export function updateTraceInteractionEvidenceSummary(
  ctx: TraceInteractionSummaryContext,
  handoff: XrTraceActionHandoffEvidence | null | undefined,
): XrTraceInteractionEvidenceSummary {
  const summary = ctx.buildSummary(handoff);
  if (typeof window !== "undefined") {
    window.__openClinXrTraceInteractionEvidenceSummary = summary;
  }
  ctx.interactionSummaryWritten(summary);
  return summary;
}

export function formatTraceInteractionEvidenceSummary(summary: Pick<
  XrTraceInteractionEvidenceSummary,
  | "latestTraceTag"
  | "latestTraceSource"
  | "sourceClass"
  | "observedRequiredCount"
  | "requiredCount"
  | "nextMissingTraceTag"
  | "reviewSafe"
  | "claimBoundary"
>): string {
  return [
    summary.latestTraceTag ?? "no learner action",
    summary.latestTraceSource ?? "no source",
    summary.sourceClass,
    `${summary.observedRequiredCount}/${summary.requiredCount} required`,
    summary.nextMissingTraceTag ? `next ${summary.nextMissingTraceTag}` : "all required observed",
    summary.reviewSafe ? "review-safe" : "review pending",
    summary.claimBoundary,
  ].join(" | ");
}

export function updateTraceReadiness(ctx: TraceReadinessContext): void {
  const summary = ctx.summarizeTraceReadiness(ctx.runtimeState());
  const requiredCount = ctx.runtimeState().requiredTraceTags.length;
  ctx.panels.traceSummary.textContent = `Trace ${summary.observedCount}/${requiredCount}`;
  updateRuntimePosturePanel(ctx, ctx.captureSummary());
}

export function refreshXrSupportStatus(
  ctx: XrSupportStatusContext,
  support: {
    navigatorXrPresent: boolean;
    immersiveVrSupported: boolean | null;
    immersiveVrSupportCheckedAtMs: number | null;
    immersiveArSupported: boolean | null;
    immersiveArSupportCheckedAtMs: number | null;
    supportError: string | null;
  },
): void {
  ctx.statusWritten(support);
  ctx.traceReadinessForPanel(ctx.captureSummary());
}

async function checkXrSupportCapability(
  request: { isSessionSupported: (mode: "immersive-vr" | "immersive-ar") => Promise<boolean> } | undefined,
  ctx: XrSupportStatusContext,
): Promise<{ immersiveVrSupported: boolean; immersiveArSupported: boolean | null; supportError: string | null }> {
  if (!request) {
    const missing = {
      navigatorXrPresent: false,
      immersiveVrSupported: null,
      immersiveVrSupportCheckedAtMs: ctx.roundPerformanceNow(),
      immersiveArSupported: null,
      immersiveArSupportCheckedAtMs: null,
      supportError: "navigator.xr_missing",
    };
    refreshXrSupportStatus(ctx, missing);
    return { immersiveVrSupported: false, immersiveArSupported: null, supportError: missing.supportError };
  }
  try {
    const immersiveVrSupported = await request.isSessionSupported("immersive-vr");
    const immersiveVrSupportCheckedAtMs = ctx.roundPerformanceNow();
    let immersiveArSupported: boolean | null = null;
    let immersiveArSupportCheckedAtMs: number | null = null;
    let supportError: string | null = null;
    try {
      immersiveArSupported = await request.isSessionSupported("immersive-ar");
      immersiveArSupportCheckedAtMs = ctx.roundPerformanceNow();
    } catch (error) {
      supportError = `immersive_ar:${ctx.formatUnknownError(error)}`;
    }
    refreshXrSupportStatus(ctx, {
      navigatorXrPresent: true,
      immersiveVrSupported,
      immersiveVrSupportCheckedAtMs,
      immersiveArSupported,
      immersiveArSupportCheckedAtMs,
      supportError,
    });
    return { immersiveVrSupported, immersiveArSupported, supportError };
  } catch (error) {
    const blocked = {
      navigatorXrPresent: true,
      immersiveVrSupported: null,
      immersiveVrSupportCheckedAtMs: ctx.roundPerformanceNow(),
      immersiveArSupported: null,
      immersiveArSupportCheckedAtMs: null,
      supportError: `immersive_vr:${ctx.formatUnknownError(error)}`,
    };
    refreshXrSupportStatus(ctx, blocked);
    return { immersiveVrSupported: false, immersiveArSupported: null, supportError: blocked.supportError };
  }
}

export function updateXrStatus(
  ctx: XrSupportStatusContext,
  request: { isSessionSupported: (mode: "immersive-vr" | "immersive-ar") => Promise<boolean> } | undefined,
  present: (outcome: { immersiveVrSupported: boolean; available: boolean; blocked: boolean }) => void,
): Promise<void> {
  return checkXrSupportCapability(request, ctx).then(({ immersiveVrSupported, supportError }) => {
    present({
      immersiveVrSupported,
      available: supportError === null && immersiveVrSupported,
      blocked: supportError !== null || !immersiveVrSupported,
    });
  });
}

export function buildRuntimeReproducibilityEvidence(ctx: RuntimeReproducibilityContext): ManualPerformanceReproducibilityEvidence {
  const viewport = ctx.viewportSize();
  const screen = ctx.screenSize();
  return ctx.buildReproducibility({
    url: ctx.pageUrl(),
    userAgent: ctx.userAgent(),
    app: ctx.appMetadata(),
    webXr: ctx.webXrSupportEvidence(),
    display: {
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      screenWidth: screen.width,
      screenHeight: screen.height,
      devicePixelRatio: ctx.devicePixelRatio(),
      visibilityState: ctx.visibilityState(),
    },
  });
}

export function updateRuntimePosturePanel(
  ctx: TraceReadinessContext,
  captureSummary: ManualPerformanceCaptureSummary | null,
): RuntimeEvidencePosture {
  const now = performance.now();
  const posture = ctx.buildRuntimeEvidencePosture({
    traceSummary: ctx.summarizeTraceReadiness(ctx.runtimeState()),
    captureSummary,
    webXrSupport: ctx.webXrSupportEvidence(),
    traceActionHandoffEvidence: ctx.handoffEvidence(),
    runtimeInteractionEvidence: ctx.latestRuntimeInteractionEvidence(),
    runtimeNowMs: now,
  });
  const lanes = new Map(posture.lanes.map((lane) => [lane.id, lane]));
  const readinessDecision = ctx.buildReadinessDecision({ posture, iwsdkStationMcpSmokeReady: false });
  if (typeof window !== "undefined") {
    window.__openClinXrRuntimeEvidencePosture = posture;
    window.__openClinXrRuntimeReadinessDecision = readinessDecision;
  }
  ctx.postureWritten(posture, readinessDecision);
  ctx.panels.postureSummary.textContent = posture.summary;
  ctx.panels.postureModel.textContent = ctx.formatPostureLane(lanes.get("model_dialogue"));
  ctx.panels.postureVoice.textContent = ctx.formatPostureLane(lanes.get("voice_synthesis"));
  ctx.panels.postureQuest.textContent = ctx.formatPostureLane(lanes.get("quest_foreground"));
  ctx.panels.postureMr.textContent = ctx.formatPostureLane(lanes.get("mixed_reality"));
  ctx.panels.postureBundleGate.textContent = ctx.formatLearnerRuntimeUseGate(ctx.learnerRuntimeUseGateEvidence());
  ctx.panels.postureLaunch.textContent = ctx.formatReadinessDecision(readinessDecision);
  return posture;
}

export function formatRuntimePostureLane(lane: RuntimeEvidencePosture["lanes"][number] | undefined): string {
  if (!lane) {
    return "missing";
  }
  const blockerText =
    lane.blockers.length === 0
      ? "no blockers"
      : `${lane.blockers.length} ${lane.blockers.length === 1 ? "blocker" : "blockers"}`;
  return `${lane.display}; ${blockerText}`;
}

export function formatRuntimeReadinessDecision(decision: XrRuntimeReadinessDecision): string {
  return [
    decision.learnerLaunchReady ? "learner launch ready" : "learner launch blocked",
    `${decision.blockerCount} blockers`,
    `next ${decision.recommendedNextAction}`,
  ].join(" | ");
}

export function formatLearnerRuntimeUseGate(
  evidence: import("@openclinxr/xr-runtime-state").LearnerRuntimeUseGateEvidence | null,
  formatMaterializationAttachmentSummaryFn: (
    summary: import("@openclinxr/xr-runtime-state").RuntimeMaterializationEvidenceAttachmentSummary | null | undefined,
  ) => string,
  formatRemainingRuntimeBlockerReasonsFn: (
    reasons: import("@openclinxr/xr-runtime-state").RuntimeRemainingRuntimeBlockerReasons | null | undefined,
  ) => string,
): string {
  if (!evidence) {
    return "bundle gate pending";
  }
  const gateText =
    evidence.blockingGateIds.length > 0
      ? `blocking ${evidence.blockingGateIds.join(", ")}`
      : "required gates attached";
  const sourceText = evidence.fallbackActive
    ? `using ${evidence.activeBundleSource}`
    : `using ${evidence.activeBundleSource}`;
  const generatedText = evidence.generatedBundleLearnerUseBlocked
    ? "generated learner use blocked"
    : evidence.approvedLocalFixtureOnly
      ? "approved local fixture assets only"
      : "generated learner use gate clear";
  const gate = evidence.actorEquipmentMaterializationGate;
  const materializationText = gate?.runtimeSelectionBlockedUntilEvidenceAttached
    ? `actor/equipment materialization blocked ${[...(gate.actorBlockers ?? []), ...(gate.equipmentBlockers ?? [])].join(",")}${formatMaterializationAttachmentSummaryFn(gate.materializationEvidenceAttachmentSummary)}${formatRemainingRuntimeBlockerReasonsFn(gate.remainingRuntimeBlockerReasons)}`
    : "actor/equipment materialization gate not attached";
  return [
    sourceText,
    generatedText,
    gateText,
    materializationText,
    evidence.fallbackReason ? `fallback ${evidence.fallbackReason}` : "no production/clinical/scoring claim",
  ].join(" | ");
}

export function formatRemainingRuntimeBlockerReasons(
  reasons: import("@openclinxr/xr-runtime-state").RuntimeRemainingRuntimeBlockerReasons | null | undefined,
): string {
  if (!reasons) {
    return "";
  }
  const categories = reasons.categories
    .map((category) => `${category.category}:${category.blockerIds.join("+")}`)
    .join(", ");
  return `; remaining runtime blockers after materialization complete ${String(reasons.materializationEvidenceComplete)}: ${categories}; runtime ${reasons.runtimeSelectionAllowed ? "allowed" : "blocked"}`;
}

export function formatMaterializationAttachmentSummary(
  summary: import("@openclinxr/xr-runtime-state").RuntimeMaterializationEvidenceAttachmentSummary | null | undefined,
): string {
  if (!summary) {
    return "";
  }
  return `; materialization evidence slots ${summary.attachedSlotCount}/${summary.totalRequiredSlotCount} attached, ${summary.missingSlotCount} missing, runtime ${summary.runtimeSelectionAllowed ? "allowed" : "blocked"}`;
}

export function createFrameAccumulator(): {
  frameDeltasMs: number[];
  framesObserved: number;
  previewFramesObserved: number;
  immersiveFramesObserved: number;
  firstFrameAtMs: number | null;
  lastFrameAtMs: number | undefined;
} {
  return {
    frameDeltasMs: [],
    framesObserved: 0,
    previewFramesObserved: 0,
    immersiveFramesObserved: 0,
    firstFrameAtMs: null,
    lastFrameAtMs: undefined,
  };
}

export function recordFrame(
  accumulator: {
    frameDeltasMs: number[];
    framesObserved: number;
    previewFramesObserved: number;
    immersiveFramesObserved: number;
    firstFrameAtMs: number | null;
    lastFrameAtMs: number | undefined;
  },
  ctx: FrameRecordingContext,
  now: number,
  evidence: {
    qualitySource: "webxr_animation_loop" | "flat_preview_fallback";
    isPresenting: boolean;
    visibilityState: string;
  },
): ManualPerformanceCaptureSummary {
  if (accumulator.lastFrameAtMs !== undefined) {
    accumulator.frameDeltasMs.push(now - accumulator.lastFrameAtMs);
    if (accumulator.frameDeltasMs.length > 180) {
      accumulator.frameDeltasMs.shift();
    }
  }
  accumulator.firstFrameAtMs ??= now;
  accumulator.lastFrameAtMs = now;
  accumulator.framesObserved += 1;
  if (evidence.isPresenting) {
    accumulator.immersiveFramesObserved += 1;
  } else {
    accumulator.previewFramesObserved += 1;
  }
  const frameStats = ctx.buildFrameStats({
    frameDeltasMs: accumulator.frameDeltasMs,
    framesObserved: accumulator.framesObserved,
    firstFrameAtMs: accumulator.firstFrameAtMs,
    latestFrameAtMs: now,
    previewFramesObserved: accumulator.previewFramesObserved,
    immersiveFramesObserved: accumulator.immersiveFramesObserved,
    qualitySource: evidence.qualitySource,
    isPresenting: evidence.isPresenting,
    visibilityState: evidence.visibilityState,
  });
  ctx.frameStatsWritten(frameStats);
  const draft = ctx.buildDraft({
    generatedAt: ctx.generatedAt(),
    elapsedSecond: ctx.elapsedSecond(),
    foregroundPageConfirmed: ctx.foregroundPageConfirmed(),
    traceInteractionPassed: ctx.completedTraceTags().length > 0,
    frameStats,
    controllerSelectLatencyMs: ctx.lastTraceSelectLatencyMs(),
    experienceModeEvidence: ctx.experienceModeEvidence() ?? ctx.experienceModeFallback,
    inputEvidence: ctx.inputEvidence(),
    traceLatencyEvidence: ctx.traceLatencyEvidence(),
    reproducibilityEvidence: ctx.reproducibilityEvidence(),
    immersiveSessionStarted: ctx.immersiveSessionStarted(),
  });
  ctx.draftWritten(draft);
  const captureSummary = ctx.buildCaptureSummary({ draft, frameStats, now });
  ctx.captureSummaryWritten(captureSummary);
  if (accumulator.framesObserved === 1 || accumulator.framesObserved % 30 === 0) {
    ctx.afterFirstOrThirtiethFrame();
  }
  return captureSummary;
}

export function updateManualEvidencePanel(ctx: ManualEvidencePanelContext): string {
  const now = performance.now();
  const summary = ctx.buildCaptureSummary({ draft: ctx.draft(), frameStats: ctx.frameStats(), now });
  ctx.captureSummaryWritten(summary);
  updateRuntimePosturePanel(ctx, summary);
  ctx.panels.evidenceFrames.textContent = [
    `${summary.framesObserved ?? 0} / ${summary.sampleWindowSize ?? 0}`,
    `vr ${summary.immersiveFramesObserved ?? 0}`,
    `preview ${summary.previewFramesObserved ?? 0}`,
    summary.immersiveFrameEvidenceReady ? "frame evidence ready" : "frame gap",
  ].join(" | ");
  ctx.panels.evidenceLoop.textContent = [
    summary.qualitySource ?? "pending",
    summary.isPresenting ? "presenting" : "not presenting",
    summary.visibilityState ?? "unknown",
    summary.frameStatsFresh === null
      ? "freshness pending"
      : summary.frameStatsFresh
        ? `${summary.frameStatsAgeMs}ms fresh`
        : `${summary.frameStatsAgeMs}ms stale`,
  ].join(" | ");
  ctx.panels.evidenceInput.textContent = [
    `${summary.handInputsObserved ?? 0} hand inputs`,
    `hand rep ${summary.handRepresentationKind ?? "unknown"}`,
    summary.inputSourceKinds.length > 0 ? summary.inputSourceKinds.join(", ") : "no source",
  ].join(" | ");
  ctx.panels.evidenceSceneAssets.textContent = ctx.formatSceneAssetEvidenceStatus(ctx.sceneAssetEvidence());
  ctx.panels.evidenceSpeechAffect.textContent = [
    ctx.formatHumanoidSpeechAffectEvidence(ctx.humanoidSpeechEvidence()),
    ctx.formatPerformanceContractEvidence(ctx.performanceContractEvidence()),
  ].join(" | ");
  ctx.panels.evidenceActorPlayer.textContent = ctx.formatActorPlayerRuntimeMetadataSummary(
    ctx.actorPlayerRuntimeMetadataSummary(),
    ctx.pedsActorPlayerRuntimePlaybackEvidence(),
  );
  ctx.panels.evidenceLocomotion.textContent = [
    ctx.formatPortalTransitionEvidence(ctx.portalTransitionEvidence()),
    summary.activeLocomotionSource ?? "none",
    summary.locomotionEvidenceReady ? "locomotion ready" : "locomotion gap",
    `attempt ${summary.locomotionAttempt ?? "unknown"}`,
    summary.lastLocomotionAtMs === null ? "no movement timestamp" : `moved ${summary.lastLocomotionAtMs}ms`,
    summary.locomotionDistanceMeters === null ? "no distance delta" : `d ${summary.locomotionDistanceMeters}m`,
    summary.locomotionTurnRadians === null ? "no turn delta" : `turn ${summary.locomotionTurnRadians}rad`,
    ctx.formatLocomotionPathQuality(summary.locomotionPathQuality),
    ctx.formatLocomotionDiagnosticSummary(summary.locomotionDiagnosticSummary),
    ctx.formatLocomotionProbeSummary(summary.locomotionProbeSummary),
  ].join(" | ");
  ctx.panels.evidenceTrace.textContent = [
    summary.traceLatencySource ?? "no trace source",
    summary.headsetSelectLatencyReady ? "headset latency ready" : "headset latency gap",
    `attempt ${summary.traceInteractionAttempt ?? "unknown"}`,
    summary.handSelectStatus === null
      ? "hand select unavailable"
      : `hand select ${summary.handSelectStatus}; dwell ${summary.handSelectDwellMs ?? 0}ms; fired ${summary.handSelectFiredCount ?? 0}${summary.handSelectBlockedReason ? `; ${summary.handSelectBlockedReason}` : ""}`,
    summary.lastTraceTag ?? "no tag",
    summary.lastTraceLatencyMs === null ? "no latency" : `${summary.lastTraceLatencyMs}ms`,
  ].join(" | ");
  ctx.panels.evidenceValidation.textContent = [
    summary.manualValidationReady ? "manual validation ready" : "draft only",
    summary.blockers.length === 0 ? "no blockers" : `${summary.blockers.length} blockers`,
    `gap ${ctx.formatTechnicalGapStatus(summary)}`,
  ].join(" | ");
  ctx.panels.copyEvidenceStatus.textContent = ctx.formatManualEvidenceCopyStatus(summary, ctx.copyDisposition());
  const payload = JSON.stringify(
    {
      ...ctx.buildEvidencePayload({
        manualPerformanceDraft: ctx.draft(),
        captureSummary: summary,
        runtimeAssetBundleId: ctx.selectedRuntimeAssetBundleId(),
        learnerRuntimeUseGateEvidence: ctx.learnerRuntimeUseGateEvidence(),
        runtimeSceneManifestEvidence: ctx.runtimeSceneManifestEvidence(),
        textPanelEvidence: ctx.textPanelEvidence(),
        traceActionHandoffEvidence: ctx.handoffEvidence(),
        sceneAssetEvidence: ctx.sceneAssetEvidence(),
        environmentStateEvidence: ctx.environmentStateEvidence(),
        humanoidSpeechEvidence: ctx.humanoidSpeechEvidence(),
        caseDefinedHumanoidPerformanceContractEvidence: ctx.performanceContractEvidence(),
        actorPlayerRuntimeMetadataSummary: ctx.actorPlayerRuntimeMetadataSummary(),
        examineeLocomotionEvidence: ctx.examineeLocomotionEvidence(),
        runtimeInteractionEvidence: ctx.latestRuntimeInteractionEvidence(),
        traceInteractionEvidenceSummary: ctx.interactionSummary(),
      }),
      portalTransitionEvidence: ctx.portalTransitionEvidence(),
      pedsActorPlayerRuntimePlaybackEvidence: ctx.pedsActorPlayerRuntimePlaybackEvidence(),
      examFlowEvidence: ctx.examFlowEvidence(),
      examRunSummaryEvidence: ctx.examRunSummaryEvidence(),
    },
    null,
    2,
  );
  ctx.panels.manualEvidenceJson.value = payload;
  return payload;
}

export function buildHumanoidSpeechEvidence(
  ctx: HumanoidSpeechEvidenceContext,
  actorId: string | null,
  assetId: string | null,
  text: string | null,
  phonemeSequence: string[],
  visemeSequence: string[],
  gazeTarget: unknown,
  emotionContext?: unknown,
  requirement?: import("@openclinxr/xr-runtime-state").HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
): import("@openclinxr/xr-runtime-state").HumanoidSpeechEvidence {
  return ctx.buildEvidence(
    actorId,
    assetId,
    text,
    phonemeSequence,
    visemeSequence,
    gazeTarget as { kind: "learner_camera" | "actor"; actorId: string | null } | null,
    emotionContext as unknown as Record<string, unknown> | undefined,
    requirement,
  );
}

export function formatTechnicalGapStatus(summary: ManualPerformanceCaptureSummary | null): string {
  return summary?.technicalGaps[0] ?? "none";
}

export function readRuntimeInteractionSnapshot(
  latest: RuntimeInteractionEvidence | null,
): RuntimeInteractionEvidence | null {
  return latest;
}
