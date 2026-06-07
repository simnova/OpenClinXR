import {
  loadCagematchReportPage,
  loadCagematchReportRegistry,
  renderCagematchReportIndex,
  renderCagematchReportPage,
} from "./cagematch-report-view.js";
import {
  loadModelVettingStudioEvidence,
  type ActorPlayerPreviewActor,
  type ActorPlayerTurnPreview,
  type ModelVettingCaptureSlot,
  type ModelVettingStudioCandidateView,
  type ModelVettingStudioEvidence,
} from "./studio-state.js";
import {
  isCandidateCaptureView,
  isFixedCameraView,
  renderCandidateCapture,
  renderDualCandidateCapture,
  type ModelVettingCandidateCaptureEvidence,
  type ModelVettingDualCandidateCaptureEvidence,
} from "./candidate-capture.js";
import "./styles.css";

declare global {
  interface Window {
    __openClinXrModelVettingStudioEvidence?: ModelVettingStudioEvidence;
    __openClinXrModelVettingCandidateCaptureEvidence?: ModelVettingCandidateCaptureEvidence;
    __openClinXrModelVettingDualCaptureEvidence?: ModelVettingDualCandidateCaptureEvidence;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) throw new Error("Missing #app mount point");

app.innerHTML = renderLoading();

const params = new URLSearchParams(window.location.search);
const reportUrlOverride = params.get("reportUrl") || undefined;
const captureManifestUrlOverride = params.get("captureManifestUrl") || undefined;
const cagematchReportId = params.get("cagematchReport");
const cagematchReportsIndex = params.get("cagematchReports") === "1";

if (cagematchReportsIndex) {
  void loadCagematchReportRegistry()
    .then((registry) => {
      app.innerHTML = renderCagematchReportIndex(registry);
    })
    .catch((error: unknown) => {
      app.innerHTML = renderError(error instanceof Error ? error.message : String(error));
    });
} else if (cagematchReportId) {
  void loadCagematchReportPage(cagematchReportId)
    .then((report) => {
      app.innerHTML = renderCagematchReportPage(report);
      document.title = `${report.title} · OpenClinXR Cagematch`;
    })
    .catch((error: unknown) => {
      app.innerHTML = renderError(error instanceof Error ? error.message : String(error));
    });
} else {
void loadModelVettingStudioEvidence(reportUrlOverride, undefined, captureManifestUrlOverride)
  .then((evidence) => {
    window.__openClinXrModelVettingStudioEvidence = evidence;
    const captureCandidateId = params.get("captureCandidateId");
    const captureView = params.get("captureView");
    const dualCompare = params.get("dualCompare") === "true";
    const leftCandidateId = params.get("leftCandidateId");
    const rightCandidateId = params.get("rightCandidateId");
    if (dualCompare && leftCandidateId && rightCandidateId && isFixedCameraView(captureView)) {
      return renderDualCandidateCapture({
        mount: app,
        evidence,
        leftCandidateId,
        rightCandidateId,
        view: captureView,
      }).then((captureEvidence) => {
        window.__openClinXrModelVettingDualCaptureEvidence = captureEvidence;
      });
    }
    if (captureCandidateId && isCandidateCaptureView(captureView)) {
      const captureDialogueText = params.get("captureDialogueText");
      return renderCandidateCapture({
        mount: app,
        evidence,
        candidateId: captureCandidateId,
        view: captureView,
        ...(captureDialogueText ? { dialogueText: captureDialogueText } : {}),
      }).then((captureEvidence) => {
        window.__openClinXrModelVettingCandidateCaptureEvidence = captureEvidence;
      });
    }
    app.innerHTML = renderStudio(evidence);
    return undefined;
  })
  .catch((error: unknown) => {
    app.innerHTML = renderError(error instanceof Error ? error.message : String(error));
  });
}

function renderLoading(): string {
  return `
    <main class="studio-shell">
      <section class="studio-stage" aria-label="Model vetting loading surface">
        <div class="stage-grid">
          <div class="pose-silhouette"></div>
          <div class="camera-label front">Front</div>
          <div class="camera-label side">Side</div>
          <div class="camera-label three-quarter">Three-quarter</div>
        </div>
      </section>
      <aside class="studio-panel">
        <p class="eyebrow">Capability Arena</p>
        <h1>Model Vetting Studio</h1>
        <p class="subtle">Loading isolated lab report.</p>
      </aside>
    </main>
  `;
}

function renderError(message: string): string {
  return `
    <main class="studio-shell">
      <section class="studio-stage" aria-label="Model vetting error surface">
        <div class="stage-grid error-state">Report unavailable</div>
      </section>
      <aside class="studio-panel">
        <p class="eyebrow">Capability Arena</p>
        <h1>Model Vetting Studio</h1>
        <p class="error-text">${escapeHtml(message)}</p>
      </aside>
    </main>
  `;
}

function renderStudio(evidence: ModelVettingStudioEvidence): string {
  return `
    <main class="studio-shell">
      <section class="studio-stage" aria-label="Isolated humanoid model vetting lab">
        <div class="stage-grid">
          <div class="camera-rail horizontal"></div>
          <div class="camera-rail vertical"></div>
          <div class="turntable-ring"></div>
          <div class="pose-silhouette"></div>
          <div class="floor-plane"></div>
          <div class="camera-label front">Front</div>
          <div class="camera-label side">Side</div>
          <div class="camera-label three-quarter">Three-quarter</div>
          <div class="camera-label turntable">Turntable</div>
        </div>
        <div class="capture-strip" aria-label="Capture presets">
          ${evidence.fixedCameraPresets.map((preset) => `<span>${formatToken(preset)} camera</span>`).join("")}
          ${evidence.videoCapturePresets.map((preset) => `<span>${formatToken(preset)} video</span>`).join("")}
        </div>
      </section>
      <aside class="studio-panel">
        <p class="eyebrow">Capability Arena</p>
        <h1>Model Vetting Studio</h1>
        <p class="subtle">Local metadata-only lab surface for the current peds Anny-compatible candidates.</p>
        ${renderDecision(evidence)}
        ${renderActorPlayerPreview(evidence)}
        ${evidence.candidates.map(renderCandidate).join("")}
        ${renderBoundary(evidence)}
        <section class="cagematch-report-link-panel" aria-label="Cagematch reports">
          <h2>Cagematch reports</h2>
          <p class="subtle">Technology comparison write-ups with objectives, media, feasibility criteria, and decision trees.</p>
          <a class="report-link" href="/?cagematchReport=humanoid-source-side-by-side-2026-06-07-anny-vs-mpfb">Anny vs MPFB (latest)</a>
          <a class="report-link" href="/?cagematchReports=1">View all cagematch reports</a>
        </section>
      </aside>
    </main>
  `;
}

function renderDecision(evidence: ModelVettingStudioEvidence): string {
  return `
    <section class="decision-panel" aria-label="Studio decision boundary">
      <dl>
        <div>
          <dt>Report</dt>
          <dd>${escapeHtml(evidence.reportSchemaVersion)}</dd>
        </div>
        <div>
          <dt>Scene placement evidence</dt>
          <dd>${evidence.scenePlacementEvidenceAllowed ? "Allowed" : "Blocked before scene"}</dd>
        </div>
        <div>
          <dt>Provider execution</dt>
          <dd>${evidence.providerExecutionEnabled ? "Enabled" : "Disabled"}</dd>
        </div>
      </dl>
    </section>
  `;
}

function renderActorPlayerPreview(evidence: ModelVettingStudioEvidence): string {
  const preview = evidence.actorPlayerPreview;
  if (!preview) return "";
  return `
    <section class="actor-player-panel" aria-label="Non-scene actor-player turn preview">
      <div class="candidate-heading">
        <div>
          <p class="eyebrow">${escapeHtml(preview.executionMode)}</p>
          <h2>Actor-player turn preview</h2>
        </div>
        <strong>${preview.actorCount} actors</strong>
      </div>
      <p class="asset-path">${preview.turnCount} case-derived turns · ${preview.sampleCount} deterministic samples · ${preview.claimBoundary}</p>
      <div class="gate-list compact" aria-label="Actor-player preview false gates">
        ${preview.notEvidenceFor.map((gate) => `<span>${formatToken(gate)}</span>`).join("")}
      </div>
      <div class="actor-preview-list">
        ${preview.actors.map(renderActorPreview).join("")}
      </div>
    </section>
  `;
}

function renderActorPreview(actor: ActorPlayerPreviewActor): string {
  return `
    <article class="actor-preview" aria-label="${escapeHtml(actor.actorId)} actor-player preview">
      <div class="actor-preview-heading">
        <strong>${escapeHtml(actor.actorId)}</strong>
        <span>${actor.turnCount} turns · ${actor.sampleCount} samples</span>
      </div>
      ${renderActorRuntimeRoleClip(actor)}
      <div class="media-handoff" aria-label="${escapeHtml(actor.actorId)} actor-player media handoff">
        <span>Speech · ${escapeHtml(shortArtifact(actor.mediaHandoff.speechVisemeTimelineVideoPath))}</span>
        <span>Expression · ${escapeHtml(shortArtifact(actor.mediaHandoff.emotionTransitionVideoPath))}</span>
        <span>Gaze · ${escapeHtml(shortArtifact(actor.mediaHandoff.gazeBlinkTurntableVideoPath))}</span>
        <span>Posture/material · ${actor.mediaHandoff.postureAndMaterialArtifactCount} artifacts</span>
      </div>
      ${actor.turns.slice(0, 4).map(renderTurnPreview).join("")}
    </article>
  `;
}

function renderActorRuntimeRoleClip(actor: ActorPlayerPreviewActor): string {
  const handoff = actor.roleAnimationHandoff;
  if (!handoff) return "";
  return `
    <div class="runtime-role-clip" aria-label="${escapeHtml(actor.actorId)} actor-player role animation handoff">
      <span>Runtime hook role clip · ${handoff.roleSpecificClipNames.map((name) => escapeHtml(name)).join(" · ")}</span>
      <em>${escapeHtml(handoff.claimScope)}</em>
    </div>
  `;
}

function renderTurnPreview(turn: ActorPlayerTurnPreview): string {
  return `
    <div class="turn-preview ${turn.sceneExecutionStatus === "not_scene_executed" ? "blocked" : ""}">
      <span>${escapeHtml(turn.turnId)} · ${escapeHtml(turn.cue)}</span>
      <strong>${escapeHtml(turn.expectedEmotion)}</strong>
      <small>${turn.sampleCount} samples · ${escapeHtml(turn.sceneExecutionStatus)} · ${escapeHtml(turn.gazeTargetKind ?? "gaze pending")} · ${escapeHtml(turn.postureCue ?? "posture pending")} · ${escapeHtml(turn.roleAnimationClipName ?? "role clip pending")}</small>
      ${turn.firstTurnText ? `<p>${escapeHtml(turn.firstTurnText)}</p>` : ""}
      <em>${turn.remainingBlockers.slice(0, 3).map(formatToken).map(escapeHtml).join(" · ")}</em>
    </div>
  `;
}

function renderCandidate(candidate: ModelVettingStudioCandidateView): string {
  const missingCount = candidate.captureSlots.filter((slot) => slot.status === "missing").length;
  return `
    <section class="candidate-panel" aria-label="${escapeHtml(candidate.actorDisplayRole)}">
      <div class="candidate-heading">
        <div>
          <p class="eyebrow">${escapeHtml(candidate.actorId)}</p>
          <h2>${escapeHtml(candidate.actorDisplayRole)}</h2>
        </div>
        <strong>${missingCount} missing</strong>
      </div>
      <p class="asset-path">${escapeHtml(candidate.sourceGlbPath)}</p>
      ${renderRoleMaterialHandoff(candidate)}
      ${renderRoleAnimationHandoff(candidate)}
      ${renderProceduralFaceDetailHandoff(candidate)}
      <div class="slot-grid">
        ${candidate.captureSlots.map(renderCaptureSlot).join("")}
      </div>
      <div class="mode-list">
        ${candidate.labModeSummary.map((mode) => `
          <span class="${mode.status === "pass" ? "mode-pass" : "mode-block"}">${formatToken(mode.modeId)}</span>
        `).join("")}
      </div>
    </section>
  `;
}

function renderRoleMaterialHandoff(candidate: ModelVettingStudioCandidateView): string {
  const handoff = candidate.roleMaterialHandoff;
  if (!handoff) return "";
  return `
    <div class="role-material-handoff" aria-label="${escapeHtml(candidate.actorDisplayRole)} generated role material handoff">
      <span>Wardrobe · ${escapeHtml(formatToken(handoff.wardrobeRole))}</span>
      <span>Cue · ${escapeHtml(formatToken(handoff.roleVisualCue))}</span>
      <span>Material · ${escapeHtml(formatToken(handoff.materialFinish))}</span>
      <span>Objects · ${handoff.objectNames.length}</span>
      <small>${handoff.objectNames.map((name) => escapeHtml(name)).join(" · ")}</small>
      <em>${escapeHtml(handoff.claimScope)}</em>
    </div>
  `;
}

function renderRoleAnimationHandoff(candidate: ModelVettingStudioCandidateView): string {
  const handoff = candidate.roleAnimationHandoff;
  if (!handoff) return "";
  return `
    <div class="role-animation-handoff" aria-label="${escapeHtml(candidate.actorDisplayRole)} generated role animation handoff">
      <span>Role clip · ${handoff.roleSpecificClipNames.map((name) => escapeHtml(name)).join(" · ")}</span>
      <em>${escapeHtml(handoff.claimScope)}</em>
    </div>
  `;
}

function renderProceduralFaceDetailHandoff(candidate: ModelVettingStudioCandidateView): string {
  const handoff = candidate.proceduralFaceDetailHandoff;
  if (!handoff) return "";
  return `
    <div class="procedural-face-detail-handoff" aria-label="${escapeHtml(candidate.actorDisplayRole)} procedural face detail handoff">
      <span>Hair · ${escapeHtml(formatToken(handoff.hairPlacementMode))}</span>
      <span>Eyes · ${escapeHtml(formatToken(handoff.eyePlacementMode))}</span>
      <span>Features · ${escapeHtml(formatToken(handoff.featurePlacementMode))}</span>
      <span>Basis · ${escapeHtml(formatToken(handoff.coordinateBasis))}</span>
      <span>Objects · ${escapeHtml(handoff.hairObjectName)} · ${handoff.eyeObjectNames.map((name) => escapeHtml(name)).join(" · ")}</span>
      <span>Landmarks · ${handoff.facialFeatureObjectNames.map((name) => escapeHtml(name)).join(" · ")}</span>
      <small>Y ${formatNumber(handoff.headTopY)} · eye ${formatNumber(handoff.eyeY)} · face ${formatNumber(handoff.faceZ)}</small>
      <em>${escapeHtml(handoff.claimScope)}</em>
    </div>
  `;
}

function renderCaptureSlot(slot: ModelVettingCaptureSlot): string {
  return `
    <div class="capture-slot ${slot.status}" aria-label="${escapeHtml(slot.label)} ${slot.status}">
      <span>${escapeHtml(slot.label)}</span>
      <strong>${slot.status === "captured" ? "Captured" : "Missing"}</strong>
      <small>${formatToken(slot.mediaKind)} · ${formatToken(slot.deterministicView)}</small>
    </div>
  `;
}

function renderBoundary(evidence: ModelVettingStudioEvidence): string {
  return `
    <section class="boundary-panel" aria-label="False readiness gates">
      <h2>Not Evidence For</h2>
      <div class="gate-list">
        ${evidence.notEvidenceFor.map((gate) => `<span>${formatToken(gate)}</span>`).join("")}
      </div>
    </section>
  `;
}

function formatToken(value: string): string {
  return value.replaceAll("_", " ");
}

function formatNumber(value: number | null): string {
  return typeof value === "number" ? value.toFixed(3) : "n/a";
}

function shortArtifact(value: string | null): string {
  if (!value) return "missing";
  return value.split("/").at(-1) ?? value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
