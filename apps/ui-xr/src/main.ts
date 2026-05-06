import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LoadingManager,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import {
  actorIdForTraceTag,
  actorResponseTextFromApiResult,
  buildManualPerformanceCaptureSummary,
  buildManualPerformanceEvidencePayload,
  buildManualPerformanceInputEvidence,
  buildManualPerformanceDraft,
  buildManualPerformanceReproducibility,
  buildReadableVrTextPanelEvidence,
  buildRuntimeFrameStats,
  buildRuntimeEvidencePosture,
  completeTraceAction,
  createInitialRuntimeState,
  eventTypeForTraceTag,
  formatManualEvidenceCopyStatus,
  formatStationClock,
  iwsdkStationSceneObjects,
  isImmersiveFrameEvidenceActive,
  localHandMeshPath,
  handGestureLocomotionOriginMeters,
  handGestureRelativeOffsetMeters,
  mapHandGestureLocomotionVector,
  meshHandModelProfile,
  meshHandRepresentationKind,
  primitiveHandModelProfile,
  primitiveHandRepresentationKind,
  remoteActorTurnForTraceTag,
  stationTraceActionTags,
  summarizeTraceReadiness,
  type LocomotionAttemptDiagnosticsEvidence,
  type LocomotionVectorEvidence,
  type ManualEvidenceCopyDisposition,
  type ManualPerformanceCaptureSummary,
  type ManualPerformanceDraft,
  type ManualPerformanceFrameStats,
  type ManualPerformanceInputEvidence,
  type ManualPerformanceReproducibilityEvidence,
  type ManualPerformanceTraceLatencyEvidence,
  type RigPoseEvidence,
  type ReadableVrTextPanelEvidence,
  type ReadableVrTextPanelEvidenceSet,
  type RuntimeEvidencePosture,
  type XrInputSourceEvidence,
  type XrHandGestureStateEvidence,
  type XrHandSelectStateEvidence,
  type XrExperienceModeEvidence,
  type XrRuntimeState,
  xrExperienceModeEvidence,
} from "./runtime-state.js";
import { createStationApiClient, type StationApiClient } from "./api-client.js";
import "./styles.css";

type NavigatorWithXr = Navigator & {
  xr?: {
    isSessionSupported(mode: "immersive-vr" | "immersive-ar"): Promise<boolean>;
    requestSession(
      mode: "immersive-vr",
      options?: { optionalFeatures?: string[] },
    ): Promise<XrSession>;
  };
};

type XrSession = {
  inputSources?: Iterable<XrInputSourceWithGamepad>;
  addEventListener(type: "end", listener: () => void, options?: { once?: boolean }): void;
  end(): Promise<void>;
};

type RuntimeWebXrSupportEvidence = ManualPerformanceReproducibilityEvidence["webXr"];

type XrInputSourceWithGamepad = {
  handedness?: "left" | "right" | "none" | string;
  hand?: unknown;
  gamepad?: {
    axes?: readonly number[];
  };
};

type XrHandJointGroup = Group & {
  jointRadius?: number;
};

type XrHandGroup = Group & {
  joints?: Record<string, XrHandJointGroup | undefined>;
  userData: {
    openClinXrHandedness?: string;
  };
};

type OpenClinXrFrameStats = ManualPerformanceFrameStats;

type OpenClinXrInputEvidence = ManualPerformanceInputEvidence;

type OpenClinXrBootEvidence = {
  app: "ui-xr";
  events: Array<{
    phase: string;
    atMs: number;
    error?: string;
  }>;
};

type OpenClinXrTraceLatencyEvidence = ManualPerformanceTraceLatencyEvidence;

type XrHeadsetSelectSource = Extract<OpenClinXrTraceLatencyEvidence["source"], "xr_controller_select" | "xr_hand_select">;

type XrSelectControllerEvent = {
  data?: XrInputSourceWithGamepad;
};

type OpenClinXrXrEntryEvidence = {
  sessionMode: "immersive-vr";
  attempts: number;
  lastStatus: "not_requested" | "requesting" | "started" | "ended" | "failed";
  lastRequestedAtMs: number | null;
  lastUpdatedAtMs: number;
  lastError: string | null;
};

type StationSceneRuntime = {
  startImmersiveSession(): Promise<void>;
};

type ReadableVrTextPanel = {
  mesh: Mesh;
  update(lines: readonly string[]): void;
};

declare global {
  interface Window {
    __openClinXrFrameStats?: OpenClinXrFrameStats;
    __openClinXrManualPerformanceDraft?: ManualPerformanceDraft;
    __openClinXrManualPerformanceCaptureSummary?: ManualPerformanceCaptureSummary;
    __openClinXrExperienceModeEvidence?: XrExperienceModeEvidence;
    __openClinXrInputEvidence?: OpenClinXrInputEvidence;
    __openClinXrBootEvidence?: OpenClinXrBootEvidence;
    __openClinXrTraceLatencyEvidence?: OpenClinXrTraceLatencyEvidence;
    __openClinXrXrEntryEvidence?: OpenClinXrXrEntryEvidence;
    __openClinXrTextPanelEvidence?: ReadableVrTextPanelEvidenceSet;
    __openClinXrRuntimeEvidencePosture?: RuntimeEvidencePosture;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root");
}

function requireElement<TElement extends Element>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Missing station runtime element: ${selector}`);
  }
  return element;
}

const bootStartedAtMs = performance.now();

function recordBootPhase(phase: string, error?: unknown): void {
  const current: OpenClinXrBootEvidence = window.__openClinXrBootEvidence ?? { app: "ui-xr", events: [] };
  const nextEvent = {
    phase,
    atMs: Number((performance.now() - bootStartedAtMs).toFixed(2)),
    ...(error === undefined ? {} : { error: formatUnknownError(error) }),
  };
  window.__openClinXrBootEvidence = {
    ...current,
    events: [...current.events, nextEvent].slice(-30),
  };
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function roundPerformanceNow(): number {
  return Number(performance.now().toFixed(2));
}

function recordXrEntryEvidence(status: OpenClinXrXrEntryEvidence["lastStatus"], error?: unknown): void {
  const current = window.__openClinXrXrEntryEvidence ?? {
    sessionMode: "immersive-vr",
    attempts: 0,
    lastStatus: "not_requested",
    lastRequestedAtMs: null,
    lastUpdatedAtMs: Number(performance.now().toFixed(2)),
    lastError: null,
  };
  const now = Number(performance.now().toFixed(2));
  const requesting = status === "requesting";
  window.__openClinXrXrEntryEvidence = {
    sessionMode: "immersive-vr",
    attempts: current.attempts + (requesting ? 1 : 0),
    lastStatus: status,
    lastRequestedAtMs: requesting ? now : current.lastRequestedAtMs,
    lastUpdatedAtMs: now,
    lastError: error === undefined ? null : formatUnknownError(error),
  };
}

recordXrEntryEvidence("not_requested");

let state: XrRuntimeState = createInitialRuntimeState();
const configuredApiBaseUrl = typeof import.meta.env.VITE_OPENCLINXR_API_BASE_URL === "string" ? import.meta.env.VITE_OPENCLINXR_API_BASE_URL : "";
const stationApi = configuredApiBaseUrl ? createStationApiClient({ baseUrl: configuredApiBaseUrl }) : undefined;
let remoteStationRunId: string | undefined;
let immersiveSessionActive = false;
let lastTraceSelectLatencyMs: number | null = null;
let runtimeWebXrSupportEvidence: RuntimeWebXrSupportEvidence = {
  navigatorXrPresent: false,
  immersiveVrSupported: null,
  immersiveVrSupportCheckedAtMs: null,
  immersiveArSupported: null,
  immersiveArSupportCheckedAtMs: null,
  supportError: null,
};
const initialDialogueText = "Robert Hayes: It feels heavy, like someone is sitting on my chest.";

app.innerHTML = `
  <main class="station-shell">
    <section class="stage" aria-label="Emergency department station scene">
      <canvas id="station-canvas" aria-label="3D emergency department bay preview"></canvas>
      <div class="status-strip">
        <span id="xr-status">WebXR checking</span>
        <span id="trace-summary">Trace 0/${edChestPainScenario.requiredTraceTags.length}</span>
        <button id="enter-xr-button" class="xr-entry-button" type="button" disabled>Enter Full VR</button>
      </div>
    </section>
    <aside class="runtime-panel" aria-label="Station controls and clinical context">
      <header>
        <p class="label">Doorway</p>
        <h1>ED Chest Pain</h1>
        <p class="subtle">Patient, spouse, and nurse in a time-boxed emergency department encounter.</p>
      </header>
      <div class="timer-row">
        <span>Encounter</span>
        <strong id="station-clock">00:00</strong>
      </div>
      <section class="ehr-panel" aria-label="Simulated EHR">
        <h2>Simulated EHR</h2>
        <dl>
          <div><dt>Chief concern</dt><dd>Crushing substernal chest pressure</dd></div>
          <div><dt>Initial vitals</dt><dd>BP 152/92, HR 104, RR 20, SpO2 96%</dd></div>
          <div><dt>Interruption</dt><dd>Nurse repeats vitals at minute seven</dd></div>
        </dl>
      </section>
      <section class="dialogue-panel" aria-label="Mock dialogue">
        <h2>Mock Dialogue</h2>
        <p id="dialogue-line">${initialDialogueText}</p>
      </section>
      <section class="trace-panel" aria-label="Trace controls">
        <h2>Trace Actions</h2>
        <div id="trace-actions" class="trace-actions"></div>
      </section>
      <section class="evidence-panel runtime-posture-panel" aria-label="Runtime posture">
        <h2>Runtime Posture</h2>
        <p id="posture-summary" class="posture-summary">Mock model/voice active; evidence gates pending.</p>
        <dl class="runtime-posture-grid">
          <div><dt>Model</dt><dd id="posture-model">pending</dd></div>
          <div><dt>Voice</dt><dd id="posture-voice">pending</dd></div>
          <div><dt>Quest</dt><dd id="posture-quest">pending</dd></div>
          <div><dt>MR</dt><dd id="posture-mr">pending</dd></div>
        </dl>
      </section>
      <section class="evidence-panel" aria-label="Quest manual evidence">
        <h2>Quest Evidence</h2>
        <dl class="evidence-grid">
          <div><dt>Frames</dt><dd id="evidence-frames">0 / 0</dd></div>
          <div><dt>Loop</dt><dd id="evidence-loop">pending</dd></div>
          <div><dt>Input</dt><dd id="evidence-input">pending</dd></div>
          <div><dt>Movement</dt><dd id="evidence-locomotion">pending</dd></div>
          <div><dt>Trace</dt><dd id="evidence-trace">pending</dd></div>
          <div><dt>Validation</dt><dd id="evidence-validation">pending</dd></div>
        </dl>
        <div class="evidence-actions">
          <button id="copy-evidence-button" class="trace-button" type="button">Copy Evidence</button>
          <span id="copy-evidence-status" aria-live="polite">Not copied</span>
        </div>
        <textarea id="manual-evidence-json" class="manual-evidence-json" readonly spellcheck="false" aria-label="Manual performance JSON"></textarea>
      </section>
    </aside>
  </main>
`;

const canvas = requireElement<HTMLCanvasElement>("#station-canvas");
const clock = requireElement<HTMLElement>("#station-clock");
const traceSummary = requireElement<HTMLElement>("#trace-summary");
const traceActions = requireElement<HTMLElement>("#trace-actions");
const xrStatus = requireElement<HTMLElement>("#xr-status");
const dialogueLine = requireElement<HTMLElement>("#dialogue-line");
const enterXrButton = requireElement<HTMLButtonElement>("#enter-xr-button");
const evidenceFrames = requireElement<HTMLElement>("#evidence-frames");
const evidenceLoop = requireElement<HTMLElement>("#evidence-loop");
const evidenceInput = requireElement<HTMLElement>("#evidence-input");
const evidenceLocomotion = requireElement<HTMLElement>("#evidence-locomotion");
const evidenceTrace = requireElement<HTMLElement>("#evidence-trace");
const evidenceValidation = requireElement<HTMLElement>("#evidence-validation");
const postureSummary = requireElement<HTMLElement>("#posture-summary");
const postureModel = requireElement<HTMLElement>("#posture-model");
const postureVoice = requireElement<HTMLElement>("#posture-voice");
const postureQuest = requireElement<HTMLElement>("#posture-quest");
const postureMr = requireElement<HTMLElement>("#posture-mr");
const copyEvidenceButton = requireElement<HTMLButtonElement>("#copy-evidence-button");
const copyEvidenceStatus = requireElement<HTMLElement>("#copy-evidence-status");
const manualEvidenceJson = requireElement<HTMLTextAreaElement>("#manual-evidence-json");
window.__openClinXrExperienceModeEvidence = xrExperienceModeEvidence;
let evidenceCopyDisposition: ManualEvidenceCopyDisposition = "not_copied";

copyEvidenceButton.addEventListener("click", () => {
  const payload = updateManualEvidencePanel();
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(payload)
      .then(() => {
        evidenceCopyDisposition = "copied";
        updateManualEvidencePanel();
      })
      .catch(() => {
        evidenceCopyDisposition = "copy_blocked";
        updateManualEvidencePanel();
      });
    return;
  }
  evidenceCopyDisposition = "clipboard_unavailable";
  updateManualEvidencePanel();
});

function renderControls(): void {
  traceActions.innerHTML = "";
  for (const tag of stationTraceActionTags) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag.replaceAll("_", " ");
    button.className = state.completedTraceTags.includes(tag) ? "trace-button complete" : "trace-button";
    button.addEventListener("click", () => completeTraceActionFromInput(tag, "dom_click_trace_button"));
    traceActions.append(button);
  }
}

function recordTraceSelectLatency(
  startedAtMs: number,
  tag: string,
  source: OpenClinXrTraceLatencyEvidence["source"],
): void {
  lastTraceSelectLatencyMs = Number((performance.now() - startedAtMs).toFixed(2));
  window.__openClinXrTraceLatencyEvidence = {
    lastTraceTag: tag,
    lastSelectLatencyMs: lastTraceSelectLatencyMs,
    source,
    measuredAtMs: Number(performance.now().toFixed(2)),
    productionControllerLatencySubstitute: false,
  };
}

function completeTraceActionFromInput(tag: string, source: OpenClinXrTraceLatencyEvidence["source"]): void {
  const traceSelectStartedAtMs = performance.now();
  state = completeTraceAction(state, tag);
  dialogueLine.textContent = dialogueFor(tag);
  renderControls();
  updateReadiness();
  recordTraceSelectLatency(traceSelectStartedAtMs, tag, source);
  void recordRemoteTraceAction(tag);
}

function completeNextTraceActionFromXrSelect(
  isFullVrPresenting: () => boolean,
  source: XrHeadsetSelectSource = "xr_controller_select",
): boolean {
  const tag = isFullVrPresenting()
    ? state.requiredTraceTags.find((candidate) => !state.completedTraceTags.includes(candidate))
    : undefined;
  if (!tag) {
    return false;
  }
  completeTraceActionFromInput(tag, source);
  return true;
}

function classifyXrSelectSource(event: XrSelectControllerEvent): XrHeadsetSelectSource {
  return event.data?.hand ? "xr_hand_select" : "xr_controller_select";
}

async function initializeRemoteTraceSession(client: StationApiClient | undefined): Promise<void> {
  if (!client) {
    return;
  }

  try {
    const session = await client.startSession({
      learnerId: "quest3_local_learner",
      consentAccepted: true,
    });
    remoteStationRunId = session.stationRunId;
    await client.startEncounter(session.stationRunId, { atSecond: 0 });
  } catch {
    remoteStationRunId = undefined;
  }
}

async function recordRemoteTraceAction(tag: string): Promise<void> {
  if (!stationApi || !remoteStationRunId) {
    return;
  }

  const atSecond = state.elapsedSecond;
  try {
    const actorId = actorIdForTraceTag(tag);
    await stationApi.recordTraceAction(remoteStationRunId, {
      eventType: eventTypeForTraceTag(tag),
      atSecond,
      tag,
      ...(actorId ? { actorId } : {}),
    });
  } catch {
    remoteStationRunId = undefined;
    return;
  }

  const actorTurn = remoteActorTurnForTraceTag(tag);
  if (!actorTurn) {
    return;
  }

  try {
    const actorResponse = await stationApi.requestActorResponse(remoteStationRunId, {
      actorId: actorTurn.actorId,
      learnerUtterance: actorTurn.learnerUtterance,
      atSecond,
      traceContextTags: actorTurn.traceContextTags,
    });
    const text = actorResponseTextFromApiResult(actorResponse);
    if (text) {
      await stationApi.synthesizeActorSpeech(remoteStationRunId, {
        actorId: actorTurn.actorId,
        voiceId: actorTurn.voiceId,
        text,
        atSecond,
      });
    }
  } catch {
    // Remote dialogue is useful evidence, but local headset tracing should continue if model or voice providers fail.
  }
}

function updateReadiness(): void {
  const summary = summarizeTraceReadiness(state);
  traceSummary.textContent = `Trace ${summary.observedCount}/${state.requiredTraceTags.length}`;
  updateRuntimePosturePanel(window.__openClinXrManualPerformanceCaptureSummary ?? null);
}

function dialogueFor(tag: string): string {
  const lines: Record<string, string> = {
    history_opqrst: "Robert Hayes: It started about half an hour ago while I was walking upstairs.",
    vitals_review: "Nurse Alvarez: His pressure is dropping and he looks more diaphoretic.",
    ecg_request: "Nurse Alvarez: I will get the ECG now and call it out as soon as it prints.",
    urgent_escalation: "Spouse: Are you saying this could be his heart?",
    team_communication: "Nurse Alvarez: Clear plan. ECG, IV access, and senior physician notified.",
    patient_note_submitted: "System: Patient note saved for faculty review.",
  };
  return lines[tag] ?? "System: Trace event recorded.";
}

async function updateXrStatus(): Promise<void> {
  const navigatorWithXr = navigator as NavigatorWithXr;
  if (!navigatorWithXr.xr) {
    runtimeWebXrSupportEvidence = {
      navigatorXrPresent: false,
      immersiveVrSupported: null,
      immersiveVrSupportCheckedAtMs: roundPerformanceNow(),
      immersiveArSupported: null,
      immersiveArSupportCheckedAtMs: null,
      supportError: "navigator.xr_missing",
    };
    xrStatus.textContent = "WebXR unavailable";
    enterXrButton.disabled = true;
    updateRuntimePosturePanel(window.__openClinXrManualPerformanceCaptureSummary ?? null);
    return;
  }
  try {
    const immersiveVrSupported = await navigatorWithXr.xr.isSessionSupported("immersive-vr");
    const immersiveVrSupportCheckedAtMs = roundPerformanceNow();
    let immersiveArSupported: boolean | null = null;
    let immersiveArSupportCheckedAtMs: number | null = null;
    let supportError: string | null = null;
    try {
      immersiveArSupported = await navigatorWithXr.xr.isSessionSupported("immersive-ar");
      immersiveArSupportCheckedAtMs = roundPerformanceNow();
    } catch (error) {
      supportError = `immersive_ar:${formatUnknownError(error)}`;
    }
    runtimeWebXrSupportEvidence = {
      navigatorXrPresent: true,
      immersiveVrSupported,
      immersiveVrSupportCheckedAtMs,
      immersiveArSupported,
      immersiveArSupportCheckedAtMs,
      supportError,
    };
    xrStatus.textContent = immersiveVrSupported ? "Full VR ready" : "WebXR unavailable";
    enterXrButton.disabled = !immersiveVrSupported;
    updateRuntimePosturePanel(window.__openClinXrManualPerformanceCaptureSummary ?? null);
  } catch (error) {
    runtimeWebXrSupportEvidence = {
      navigatorXrPresent: true,
      immersiveVrSupported: null,
      immersiveVrSupportCheckedAtMs: roundPerformanceNow(),
      immersiveArSupported: null,
      immersiveArSupportCheckedAtMs: null,
      supportError: `immersive_vr:${formatUnknownError(error)}`,
    };
    xrStatus.textContent = "WebXR check blocked";
    enterXrButton.disabled = true;
    updateRuntimePosturePanel(window.__openClinXrManualPerformanceCaptureSummary ?? null);
  }
}

function buildRuntimeReproducibilityEvidence(): ManualPerformanceReproducibilityEvidence {
  return buildManualPerformanceReproducibility({
    url: window.location.href,
    userAgent: navigator.userAgent,
    app: __OPENCLINXR_UI_XR_APP_METADATA__,
    webXr: runtimeWebXrSupportEvidence,
    display: {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      screenWidth: window.screen?.width ?? null,
      screenHeight: window.screen?.height ?? null,
      devicePixelRatio: window.devicePixelRatio,
      visibilityState: document.visibilityState,
    },
  });
}

function updateRuntimePosturePanel(captureSummary: ManualPerformanceCaptureSummary | null): RuntimeEvidencePosture {
  const posture = buildRuntimeEvidencePosture({
    traceSummary: summarizeTraceReadiness(state),
    captureSummary,
    webXrSupport: runtimeWebXrSupportEvidence,
  });
  const lanes = new Map(posture.lanes.map((lane) => [lane.id, lane]));
  window.__openClinXrRuntimeEvidencePosture = posture;
  postureSummary.textContent = posture.summary;
  postureModel.textContent = formatRuntimePostureLane(lanes.get("model_dialogue"));
  postureVoice.textContent = formatRuntimePostureLane(lanes.get("voice_synthesis"));
  postureQuest.textContent = formatRuntimePostureLane(lanes.get("quest_foreground"));
  postureMr.textContent = formatRuntimePostureLane(lanes.get("mixed_reality"));
  return posture;
}

function formatRuntimePostureLane(lane: RuntimeEvidencePosture["lanes"][number] | undefined): string {
  if (!lane) {
    return "missing";
  }
  const blockerText = lane.blockers.length === 0
    ? "no blockers"
    : `${lane.blockers.length} ${lane.blockers.length === 1 ? "blocker" : "blockers"}`;
  return `${lane.display}; ${blockerText}`;
}

function createStationScene(): StationSceneRuntime {
  recordBootPhase("station_scene_start");
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x101820);
  let activeXrSession: XrSession | undefined;
  let lastLocomotionAtMs: number | null = null;
  let previousRoomScalePose: RigPoseEvidence | null = null;
  let lastAnimateAtMs = performance.now();
  let lastRenderLoopAtMs = 0;
  const flatPreviewFallbackFrameMs = 1000 / 30;

  const scene = new Scene();
  scene.name = iwsdkStationSceneObjects.stationRoot;
  scene.background = new Color(0x101820);

  const locomotionRig = new Group();
  locomotionRig.name = "openclinxr.ed-chest-pain.locomotion-rig";
  scene.add(locomotionRig);

  const camera = new PerspectiveCamera(52, 1, 0.1, 100);
  camera.position.set(0, 1.7, 5.2);
  camera.lookAt(0, 1.1, 0);
  locomotionRig.add(camera);

  const ambient = new HemisphereLight(0xf4f0dc, 0x223042, 2.2);
  ambient.name = iwsdkStationSceneObjects.ambientLight;
  scene.add(ambient);

  const key = new DirectionalLight(0xffffff, 2.5);
  key.name = iwsdkStationSceneObjects.keyLight;
  key.position.set(3, 5, 4);
  scene.add(key);

  const floor = new Mesh(new BoxGeometry(7, 0.08, 5), new MeshStandardMaterial({ color: 0x55606b, roughness: 0.8 }));
  floor.name = iwsdkStationSceneObjects.floor;
  floor.position.y = -0.04;
  scene.add(floor);

  const bed = new Mesh(new BoxGeometry(2.4, 0.35, 1.05), new MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.65 }));
  bed.name = iwsdkStationSceneObjects.bed;
  bed.position.set(-0.4, 0.55, 0);
  scene.add(bed);

  const monitor = new Mesh(new BoxGeometry(0.8, 0.55, 0.08), new MeshStandardMaterial({ color: 0x203040, emissive: 0x0b3d2e }));
  monitor.name = iwsdkStationSceneObjects.monitor;
  monitor.position.set(1.7, 1.45, -0.65);
  scene.add(monitor);

  const patient = actorMesh(0x8fb9aa);
  patient.name = iwsdkStationSceneObjects.patientRobertHayes;
  patient.position.set(-0.6, 1.0, 0.05);
  patient.scale.set(1.1, 1.1, 1.1);
  scene.add(patient);

  const nurse = actorMesh(0x5a9bd5);
  nurse.name = iwsdkStationSceneObjects.nurseMariaAlvarez;
  nurse.position.set(1.45, 0.95, 0.55);
  scene.add(nurse);

  const spouse = actorMesh(0xd5a75a);
  spouse.name = iwsdkStationSceneObjects.spouseAnnaHayes;
  spouse.position.set(-2.0, 0.95, 0.7);
  scene.add(spouse);

  const clockMesh = new Mesh(new CylinderGeometry(0.25, 0.25, 0.05, 48), new MeshStandardMaterial({ color: 0xf3e8c9 }));
  clockMesh.name = iwsdkStationSceneObjects.wallClock;
  clockMesh.rotation.x = Math.PI / 2;
  clockMesh.position.set(0.9, 3.35, -1.2);
  scene.add(clockMesh);
  const clinicalPanel = createClinicalPanel();
  scene.add(clinicalPanel.mesh);
  const dialoguePanel = createReadableVrTextPanel({
    name: iwsdkStationSceneObjects.dialoguePanel,
    title: "Live Dialogue",
    lines: [initialDialogueText, `Trace 0/${state.requiredTraceTags.length}`],
    widthMeters: 1.85,
    heightMeters: 0.95,
    background: "#fff8e5",
    accent: "#286b54",
  });
  dialoguePanel.mesh.position.set(0.85, 2.58, -1.42);
  dialoguePanel.mesh.rotation.y = -0.28;
  scene.add(dialoguePanel.mesh);
  const inputPanel = createReadableVrTextPanel({
    name: iwsdkStationSceneObjects.inputPanel,
    title: "Input Evidence",
    lines: [
      "Session: Full VR not entered",
      "Hands: pending optional hand-tracking",
      "Movement: room-scale walking, thumbstick, keyboard, or armed hand gesture",
    ],
    widthMeters: 1.65,
    heightMeters: 0.72,
    background: "#eef4ff",
    accent: "#5a6f9f",
  });
  inputPanel.mesh.position.set(0.45, 1.72, -1.08);
  inputPanel.mesh.rotation.y = 0;
  scene.add(inputPanel.mesh);
  let lastPanelSignature = "";
  addControllerAffordances(renderer, scene, (event) => {
    completeNextTraceActionFromXrSelect(
      () => Boolean(activeXrSession && renderer.xr.isPresenting),
      classifyXrSelectSource(event),
    );
  });
  const keyboardLocomotion = createKeyboardLocomotion();
  let handModelStatus: OpenClinXrInputEvidence["handModelStatus"] = "pending_immersive_session";
  let handModelsInstalled = false;
  let activeHandRepresentationKind: OpenClinXrInputEvidence["handRepresentationKind"] = primitiveHandRepresentationKind;
  let handAssetLoadErrors: string[] = [];
  let lastInputObservedAtMs: number | null = null;
  const handGestureLocomotionState = createXrHandGestureLocomotionState();
  const handSelectState = createXrHandSelectState();

  function resize(): void {
    if (renderer.xr.isPresenting) {
      return;
    }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  function animate(timestamp?: number): void {
    renderSceneFrame(timestamp, "webxr_animation_loop");
  }

  function renderSceneFrame(
    timestamp?: number,
    qualitySource: NonNullable<OpenClinXrFrameStats["qualitySource"]> = "webxr_animation_loop",
  ): void {
    const now = typeof timestamp === "number" ? timestamp : performance.now();
    lastRenderLoopAtMs = now;
    const deltaSeconds = Math.min((now - lastAnimateAtMs) / 1000, 0.05);
    lastAnimateAtMs = now;
    resize();
    const roomScalePose = sampleRoomScalePose({
      camera,
      renderer,
      presenting: Boolean(activeXrSession && renderer.xr.isPresenting),
    });
    const locomotionEvidence = applyLocomotion({
      deltaSeconds,
      keyboardLocomotion,
      locomotionRig,
      now,
      renderer,
      session: activeXrSession,
      lastInputObservedAtMs,
      lastLocomotionAtMs,
      handModelCount: handModelsInstalled ? 2 : 0,
      handModelStatus,
      activeHandRepresentationKind,
      handAssetLoadErrors,
      handGestureLocomotionState,
      previousRoomScalePose,
      roomScalePose,
    });
    previousRoomScalePose = roomScalePose ?? previousRoomScalePose;
    const inputEvidence: OpenClinXrInputEvidence = {
      ...locomotionEvidence,
      xrHandSelectState: maybeCompleteTraceActionFromHandSelect({
        renderer,
        handSelectState,
        now,
        controllerInputActive: locomotionEvidence.inputSourceKinds?.includes("xr_gamepad") === true,
        isFullVrPresenting: () => Boolean(activeXrSession && renderer.xr.isPresenting),
        onSelect: () => completeNextTraceActionFromXrSelect(
          () => Boolean(activeXrSession && renderer.xr.isPresenting),
          "xr_hand_select",
        ),
      }),
    };
    lastInputObservedAtMs = inputEvidence.lastInputObservedAtMs ?? lastInputObservedAtMs;
    lastLocomotionAtMs = inputEvidence.lastLocomotionAtMs;
    window.__openClinXrInputEvidence = inputEvidence;
    updateVrPanels(inputEvidence);
    recordFrame(now, {
      qualitySource,
      isPresenting: isImmersiveFrameEvidenceActive({
        rendererPresenting: renderer.xr.isPresenting,
        activeXrSession: Boolean(activeXrSession),
        immersiveSessionActive,
      }),
      visibilityState: document.visibilityState,
    });
    patient.rotation.y = Math.sin(now / 1200) * 0.08;
    nurse.rotation.y = Math.sin(now / 900) * 0.12;
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(animate);
  window.setInterval(fallbackAnimationLoop, flatPreviewFallbackFrameMs);
  recordBootPhase("station_render_loop_started");

  return {
    async startImmersiveSession(): Promise<void> {
      if (activeXrSession) {
        await activeXrSession.end();
        return;
      }

      const navigatorWithXr = navigator as NavigatorWithXr;
      if (!navigatorWithXr.xr) {
        xrStatus.textContent = "WebXR unavailable";
        recordXrEntryEvidence("failed", "navigator.xr unavailable");
        return;
      }

      enterXrButton.disabled = true;
      xrStatus.textContent = "Entering Full VR";
      recordXrEntryEvidence("requesting");
      try {
        const session = await navigatorWithXr.xr.requestSession("immersive-vr", {
          optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
        });
        activeXrSession = session;
        session.addEventListener("end", () => {
          activeXrSession = undefined;
          immersiveSessionActive = false;
          enterXrButton.disabled = false;
          enterXrButton.textContent = "Enter Full VR";
          xrStatus.textContent = "Full VR ready";
          recordXrEntryEvidence("ended");
        }, { once: true });
        await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
        installHandModelsOnce();
        immersiveSessionActive = true;
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Exit Full VR";
        xrStatus.textContent = "In Full VR";
        requestAnimationFrame(() => updateManualEvidencePanel());
        recordXrEntryEvidence("started");
      } catch (error) {
        activeXrSession = undefined;
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Enter Full VR";
        xrStatus.textContent = "WebXR entry blocked";
        recordXrEntryEvidence("failed", error);
      }
    },
  };

  function fallbackAnimationLoop(): void {
    const now = performance.now();
    if (now - lastRenderLoopAtMs > flatPreviewFallbackFrameMs) {
      renderSceneFrame(now, "flat_preview_fallback");
    }
  }

  function installHandModelsOnce(): void {
    if (handModelsInstalled || handModelStatus === "failed") {
      return;
    }
    try {
      addHandModels(renderer, scene, {
        onMeshReady: () => {
          activeHandRepresentationKind = meshHandRepresentationKind;
        },
        onMeshLoadError: (url) => {
          activeHandRepresentationKind = primitiveHandRepresentationKind;
          handModelStatus = "failed";
          handAssetLoadErrors = [...new Set([...handAssetLoadErrors, url])];
          recordBootPhase("hand_mesh_asset_load_failed", url);
        },
      });
      handModelsInstalled = true;
      handModelStatus = "installed";
    } catch {
      activeHandRepresentationKind = primitiveHandRepresentationKind;
      handModelStatus = "failed";
      handAssetLoadErrors = [...new Set([...handAssetLoadErrors, localHandMeshPath])];
    }
  }

  function updateVrPanels(inputEvidence: OpenClinXrInputEvidence): void {
    const summary = summarizeTraceReadiness(state);
    const dialogueText = dialogueLine.textContent ?? initialDialogueText;
    const handGestureSourceActive = inputEvidence.inputSourceKinds?.includes("xr_hand_gesture") === true;
    const captureSummary = window.__openClinXrManualPerformanceCaptureSummary ?? null;
    const captureReadinessStatus = formatCaptureReadinessStatus(captureSummary);
    const panelSignature = [
      dialogueText,
      summary.observedCount,
      summary.missingCount,
      immersiveSessionActive ? "in-full-vr" : "preview",
      inputEvidence.handModelStatus,
      inputEvidence.handRepresentationKind ?? "unknown",
      inputEvidence.handInputsObserved,
      inputEvidence.lastLocomotionAtMs,
      inputEvidence.activeLocomotionSource,
      handGestureSourceActive ? "hand-gesture-active" : "hand-gesture-inactive",
      inputEvidence.xrHandGestureState?.armed ? "gesture-armed" : "gesture-not-armed",
      inputEvidence.xrHandGestureState?.dwellMs ?? 0,
      inputEvidence.xrHandGestureState?.blockedReason ?? "none",
      inputEvidence.xrHandSelectState?.status ?? "select-idle",
      inputEvidence.xrHandSelectState?.firedCount ?? 0,
      inputEvidence.xrHandSelectState?.blockedReason ?? "select-none",
      inputEvidence.rigPosition.x,
      inputEvidence.rigPosition.z,
      inputEvidence.locomotionDelta?.distanceMeters ?? 0,
      inputEvidence.locomotionDelta?.turnRadians ?? 0,
      captureReadinessStatus,
      captureSummary?.technicalGaps[0] ?? "no-technical-gap",
      captureSummary?.locomotionProbeSummary?.primaryReason ?? "no-locomotion-probe",
    ].join("|");
    if (panelSignature === lastPanelSignature) {
      return;
    }
    lastPanelSignature = panelSignature;
    dialoguePanel.update([
      dialogueText,
      `Trace ${summary.observedCount}/${state.requiredTraceTags.length}; missing ${summary.missingCount}`,
    ]);
    inputPanel.update([
      immersiveSessionActive ? "Session: In Full VR" : "Session: Desktop preview",
      `Hands: ${inputEvidence.handModelStatus}; observed ${inputEvidence.handInputsObserved}; rep ${inputEvidence.handRepresentationKind ?? "unknown"}`,
      inputEvidence.xrHandGestureState?.armed
        ? `Gesture: armed; dwell ${inputEvidence.xrHandGestureState.dwellMs}ms`
        : `Gesture: ${inputEvidence.xrHandGestureState?.blockedReason ?? "not armed"}`,
      `Trace hand select: ${formatHandSelectStatus(inputEvidence.xrHandSelectState)}`,
      `Movement: ${inputEvidence.activeLocomotionSource ?? "none"}; d ${inputEvidence.locomotionDelta?.distanceMeters ?? 0}m; turn ${inputEvidence.locomotionDelta?.turnRadians ?? 0}rad; ${formatLocomotionProbeSummary(captureSummary?.locomotionProbeSummary ?? null)}`,
      `Capture: ${captureReadinessStatus}; gap ${formatTechnicalGapStatus(captureSummary)}`,
    ]);
  }
}

function formatHandSelectStatus(state: XrHandSelectStateEvidence | undefined): string {
  if (!state) {
    return "idle";
  }
  const reason = state.blockedReason ? `; ${state.blockedReason}` : "";
  const fired = state.firedCount > 0 ? `; fired ${state.firedCount}` : "";
  return `${state.status}; dwell ${state.dwellMs}ms${fired}${reason}`;
}

function formatCaptureReadinessStatus(summary: ManualPerformanceCaptureSummary | null): string {
  if (!summary) {
    return "pending capture";
  }
  const status = summary.manualValidationReady ? "ready" : `${summary.blockers.length} blockers`;
  return `${status}; vr ${summary.immersiveFramesObserved ?? 0}; window ${summary.sampleWindowSize ?? 0}`;
}

function formatTechnicalGapStatus(summary: ManualPerformanceCaptureSummary | null): string {
  return summary?.technicalGaps[0] ?? "none";
}

function createClinicalPanel(): ReadableVrTextPanel {
  const panel = createReadableVrTextPanel({
    name: iwsdkStationSceneObjects.clinicalPanel,
    title: "Simulated EHR",
    lines: [
      "Chief concern: crushing substernal pressure",
      "Vitals: BP 152/92  HR 104  RR 20  SpO2 96%",
      "Interruption: nurse repeats vitals at minute seven",
      "Priority: obtain ECG and escalate urgently",
    ],
    widthMeters: 2.3,
    heightMeters: 1.15,
    background: "#fff8e5",
    accent: "#7d4f28",
  });
  panel.mesh.position.set(-1.55, 2.62, -1.42);
  panel.mesh.rotation.y = 0.34;
  return panel;
}

const readableVrTextPanelEvidence = new Map<string, ReadableVrTextPanelEvidence>();

function publishReadableVrTextPanelEvidence(evidence: ReadableVrTextPanelEvidence): void {
  readableVrTextPanelEvidence.set(evidence.name, evidence);
  window.__openClinXrTextPanelEvidence = {
    source: "window.__openClinXrTextPanelEvidence",
    panelCount: readableVrTextPanelEvidence.size,
    panels: [...readableVrTextPanelEvidence.values()].sort((left, right) => left.name.localeCompare(right.name)),
    limitations: ["metadata_only_requires_foreground_headset_confirmation"],
  };
}

function createReadableVrTextPanel(options: {
  name: string;
  title: string;
  lines: readonly string[];
  widthMeters: number;
  heightMeters: number;
  background: string;
  accent: string;
}): ReadableVrTextPanel {
  const panelCanvas = document.createElement("canvas");
  panelCanvas.width = 1280;
  panelCanvas.height = 640;
  const context = panelCanvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create VR text panel canvas context");
  }
  const panelContext = context;
  const texture = new CanvasTexture(panelCanvas);
  const panel = new Mesh(
    new PlaneGeometry(options.widthMeters, options.heightMeters),
    new MeshBasicMaterial({ map: texture, side: DoubleSide }),
  );
  panel.name = options.name;

  function update(lines: readonly string[]): void {
    panelContext.fillStyle = options.background;
    panelContext.fillRect(0, 0, panelCanvas.width, panelCanvas.height);
    panelContext.fillStyle = options.accent;
    panelContext.fillRect(0, 0, 22, panelCanvas.height);
    panelContext.fillStyle = "#172332";
    panelContext.font = "700 62px Arial";
    panelContext.fillText(options.title, 58, 92);
    panelContext.font = "38px Arial";
    let y = 162;
    for (const line of lines) {
      y = drawWrappedText(panelContext, line, 58, y, panelCanvas.width - 116, 50) + 14;
    }
    texture.needsUpdate = true;
    publishReadableVrTextPanelEvidence(buildReadableVrTextPanelEvidence({
      name: options.name,
      title: options.title,
      lines,
      canvasPixels: { width: panelCanvas.width, height: panelCanvas.height },
      worldMeters: { width: options.widthMeters, height: options.heightMeters },
      updatedAtMs: performance.now(),
    }));
  }

  update(options.lines);
  return { mesh: panel, update };
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(" ");
  let line = "";
  let currentY = y;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (context.measureText(testLine).width > maxWidth && line) {
      context.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    context.fillText(line, x, currentY);
  }
  return currentY + lineHeight;
}

function addControllerAffordances(
  renderer: WebGLRenderer,
  scene: Scene,
  onSelect: (event: XrSelectControllerEvent) => void,
): void {
  const controllerModelFactory = new XRControllerModelFactory();
  const gripNames = [
    iwsdkStationSceneObjects.controllerGripLeft,
    iwsdkStationSceneObjects.controllerGripRight,
  ];
  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    controller.name = `openclinxr.ed-chest-pain.controller-${index + 1}`;
    (controller as unknown as { addEventListener(type: "select", listener: (event: XrSelectControllerEvent) => void): void })
      .addEventListener("select", onSelect);
    const ray = new Line(
      new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, -3)]),
      new LineBasicMaterial({ color: 0xd9c493 }),
    );
    ray.name = `openclinxr.ed-chest-pain.controller-ray-${index + 1}`;
    controller.add(ray);
    scene.add(controller);
    const controllerGrip = renderer.xr.getControllerGrip(index);
    controllerGrip.name = gripNames[index] ?? `openclinxr.ed-chest-pain.controller-grip-${index + 1}`;
    controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip));
    scene.add(controllerGrip);
  }
}

function addHandModels(renderer: WebGLRenderer, scene: Scene, input: {
  onMeshReady: () => void;
  onMeshLoadError: (url: string) => void;
}): void {
  let loadedMeshCount = 0;
  const primitiveFallbacks: Mesh[] = [];
  const meshLoadingManager = new LoadingManager();
  meshLoadingManager.onError = (url) => input.onMeshLoadError(url);
  const meshLoader = new GLTFLoader(meshLoadingManager).setPath(localHandMeshPath);
  const handModelFactory = new XRHandModelFactory(meshLoader, () => {
    loadedMeshCount += 1;
    if (loadedMeshCount >= 2) {
      for (const fallback of primitiveFallbacks) {
        fallback.visible = false;
      }
      input.onMeshReady();
    }
  });
  handModelFactory.setPath(localHandMeshPath);
  for (let index = 0; index < 2; index += 1) {
    const hand = renderer.xr.getHand(index);
    hand.name = `openclinxr.ed-chest-pain.hand-${index + 1}`;
    hand.addEventListener("connected", (event) => {
      const data = "data" in event ? event.data as { handedness?: string } : undefined;
      if (data?.handedness) {
        hand.userData.openClinXrHandedness = data.handedness;
      }
    });
    const meshHandModel = handModelFactory.createHandModel(hand, meshHandModelProfile);
    meshHandModel.name = `openclinxr.ed-chest-pain.hand-model-mesh-${index + 1}`;
    const primitiveFallback = handModelFactory.createHandModel(hand, primitiveHandModelProfile);
    primitiveFallback.name = `openclinxr.ed-chest-pain.hand-model-primitive-fallback-${index + 1}`;
    primitiveFallbacks.push(primitiveFallback as Mesh);
    hand.add(meshHandModel, primitiveFallback);
    scene.add(hand);
  }
}

type KeyboardLocomotionState = {
  forward: number;
  strafe: number;
  turn: number;
};

type XrHandGestureLocomotionState = {
  hands: Record<"left" | "right", XrHandGestureHandState>;
  lastTurnAtMs: number | null;
};

type XrHandGestureHandState = {
  pinchingSinceMs: number | null;
  neutralOffsetX: number;
  neutralOffsetZ: number;
  armed: boolean;
};

type XrHandGestureLocomotionResult = LocomotionVectorEvidence & {
  handInputsObserved: number;
  state: XrHandGestureStateEvidence;
  diagnostics: LocomotionAttemptDiagnosticsEvidence["handGestureHands"];
};

type XrHandGestureVectorResult = LocomotionVectorEvidence & {
  armed: boolean;
  dwellMs: number;
  blockedReason?: XrHandGestureStateEvidence["blockedReason"] | "below_deadzone" | "turn_cooldown";
  diagnostic: LocomotionAttemptDiagnosticsEvidence["handGestureHands"][number];
};

type XrHandSelectState = {
  pinchingSinceMs: number | null;
  neutralOffsetX: number;
  neutralOffsetZ: number;
  firedDuringPinch: boolean;
  firedCount: number;
  lastFiredAtMs: number | null;
};

const handGestureDwellMs = 450;
const handGestureDeadzoneMeters = 0.045;
const handGestureTurnDeadzoneMeters = 0.055;
const handGestureTurnCooldownMs = 450;
const handSelectDwellMs = 650;
const handSelectMovementToleranceMeters = 0.025;
const handSelectCooldownMs = 850;
const handPinchDistanceThresholdMeters = 0.035;
const xrGamepadDeadzone = 0.18;

function createKeyboardLocomotion(): KeyboardLocomotionState {
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

function createXrHandGestureLocomotionState(): XrHandGestureLocomotionState {
  return {
    hands: {
      left: createXrHandGestureHandState(),
      right: createXrHandGestureHandState(),
    },
    lastTurnAtMs: null,
  };
}

function createXrHandGestureHandState(): XrHandGestureHandState {
  return {
    pinchingSinceMs: null,
    neutralOffsetX: 0,
    neutralOffsetZ: 0,
    armed: false,
  };
}

function createXrHandSelectState(): XrHandSelectState {
  return {
    pinchingSinceMs: null,
    neutralOffsetX: 0,
    neutralOffsetZ: 0,
    firedDuringPinch: false,
    firedCount: 0,
    lastFiredAtMs: null,
  };
}

function applyLocomotion(input: {
  deltaSeconds: number;
  keyboardLocomotion: KeyboardLocomotionState;
  locomotionRig: Group;
  now: number;
  renderer: WebGLRenderer;
  session: XrSession | undefined;
  lastInputObservedAtMs: number | null;
  lastLocomotionAtMs: number | null;
  handModelCount: number;
  handModelStatus: OpenClinXrInputEvidence["handModelStatus"];
  activeHandRepresentationKind?: OpenClinXrInputEvidence["handRepresentationKind"];
  handAssetLoadErrors?: string[];
  handGestureLocomotionState: XrHandGestureLocomotionState;
  previousRoomScalePose: RigPoseEvidence | null;
  roomScalePose: RigPoseEvidence | null;
}): OpenClinXrInputEvidence {
  const xrLocomotion = readXrGamepadLocomotion(input.session);
  const keyboardVector: LocomotionVectorEvidence = {
    forward: clampUnit(input.keyboardLocomotion.forward),
    strafe: clampUnit(input.keyboardLocomotion.strafe),
    turn: clampUnit(input.keyboardLocomotion.turn),
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
  const forward = clampUnit(keyboardVector.forward + xrVector.forward + xrHandGestureVector.forward);
  const strafe = clampUnit(keyboardVector.strafe + xrVector.strafe + xrHandGestureVector.strafe);
  const turn = clampUnit(keyboardVector.turn + xrVector.turn + xrHandGestureVector.turn);
  const speedMetersPerSecond = 1.35;
  const previousRigPose: RigPoseEvidence = {
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
  input.locomotionRig.position.x = clamp(input.locomotionRig.position.x, -2.75, 2.75);
  input.locomotionRig.position.z = clamp(input.locomotionRig.position.z, -2.25, 2.25);

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
      gamepadDeadzone: xrGamepadDeadzone,
      handPinchThresholdMeters: handPinchDistanceThresholdMeters,
      handGestureDeadzoneMeters,
      handGestureTurnDeadzoneMeters,
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

function sampleRoomScalePose(input: {
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  presenting: boolean;
}): RigPoseEvidence | null {
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

function readXrHandGestureLocomotion(input: {
  renderer: WebGLRenderer;
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
  const diagnostics: LocomotionAttemptDiagnosticsEvidence["handGestureHands"] = [];

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
    gestureDeadzoneMeters: handGestureDeadzoneMeters,
    turnCooldownMs: handGestureTurnCooldownMs,
  };
  if (!armed) {
    state.blockedReason = blockedReason;
  }

  return {
    forward: clampUnit(forward),
    strafe: clampUnit(strafe),
    turn: clampUnit(turn),
    handInputsObserved,
    state,
    diagnostics,
  };
}

function isXrHandGestureStateBlockedReason(
  reason: XrHandGestureVectorResult["blockedReason"],
): reason is NonNullable<XrHandGestureStateEvidence["blockedReason"]> {
  return reason === "not_pinching"
    || reason === "arming_dwell"
    || reason === "missing_joints"
    || reason === "other_locomotion_source_active";
}

function readHandGestureVector(input: {
  hand: XrHandGroup;
  index: number;
  now: number;
  gestureState: XrHandGestureLocomotionState;
  otherLocomotionSourceActive: boolean;
}): XrHandGestureVectorResult {
  const handedness = handednessForHand(input.hand, input.index);
  const state = input.gestureState.hands[handedness];

  const wrist = input.hand.joints?.wrist;
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
  const pinching = pinchDistanceMeters !== null && pinchDistanceMeters <= handPinchDistanceThresholdMeters;
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
  if (dwellMs < handGestureDwellMs) {
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
    && input.now - input.gestureState.lastTurnAtMs < handGestureTurnCooldownMs;
  const mappedGesture = mapHandGestureLocomotionVector({
    handedness,
    relativeOffsetMeters,
    movementDeadzoneMeters: handGestureDeadzoneMeters,
    turnDeadzoneMeters: handGestureTurnDeadzoneMeters,
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

function handGestureResult(input: Partial<LocomotionVectorEvidence> & {
  handedness: "left" | "right";
  jointsVisible: LocomotionAttemptDiagnosticsEvidence["handGestureHands"][number]["jointsVisible"];
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

function maybeCompleteTraceActionFromHandSelect(input: {
  renderer: WebGLRenderer;
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

  const wrist = hand.joints?.wrist;
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
  if (movementMeters > handSelectMovementToleranceMeters) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: false,
      rightPinch,
      blockedReason: "moving_too_much",
    });
  }
  if (dwellMs < handSelectDwellMs) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "arming",
      armed: false,
      rightPinch,
      blockedReason: "arming_dwell",
    });
  }
  const coolingDown = input.handSelectState.lastFiredAtMs !== null
    && input.now - input.handSelectState.lastFiredAtMs < handSelectCooldownMs;
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

function handSelectEvidence(
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

function resetHandSelectState(state: XrHandSelectState): void {
  state.pinchingSinceMs = null;
  state.neutralOffsetX = 0;
  state.neutralOffsetZ = 0;
  state.firedDuringPinch = false;
}

function resetHandGestureHandState(state: XrHandGestureHandState): void {
  state.pinchingSinceMs = null;
  state.neutralOffsetX = 0;
  state.neutralOffsetZ = 0;
  state.armed = false;
}

function handednessForHand(hand: XrHandGroup, index: number): "left" | "right" {
  return hand.userData.openClinXrHandedness === "right" || index === 1 ? "right" : "left";
}

function isTrackedHandVisible(hand: XrHandGroup): boolean {
  return Boolean(hand.visible || hand.joints?.wrist?.visible || hand.joints?.["index-finger-tip"]?.visible);
}

function isXrHandPinching(hand: XrHandGroup): boolean {
  const indexTip = hand.joints?.["index-finger-tip"];
  const thumbTip = hand.joints?.["thumb-tip"];
  if (!indexTip?.visible || !thumbTip?.visible) {
    return false;
  }
  return indexTip.position.distanceTo(thumbTip.position) <= handPinchDistanceThresholdMeters;
}

function readXrGamepadLocomotion(session: XrSession | undefined): {
  forward: number;
  strafe: number;
  turn: number;
  handInputsObserved: number;
  inputSources: XrInputSourceEvidence[];
  diagnostics: LocomotionAttemptDiagnosticsEvidence["gamepadSources"];
} {
  let forward = 0;
  let strafe = 0;
  let turn = 0;
  let handInputsObserved = 0;
  const inputSources: XrInputSourceEvidence[] = [];
  const diagnostics: LocomotionAttemptDiagnosticsEvidence["gamepadSources"] = [];

  for (const source of session?.inputSources ?? []) {
    if (source.hand) {
      handInputsObserved += 1;
    }
    const axes = source.gamepad?.axes ?? [];
    inputSources.push({
      handedness: source.handedness ?? "unknown",
      hasHand: Boolean(source.hand),
      hasGamepad: Boolean(source.gamepad),
      axisCount: axes.length,
    });
    const selectedXAxisIndex = axes[2] === undefined ? (axes[0] === undefined ? null : 0) : 2;
    const selectedYAxisIndex = axes[3] === undefined ? (axes[1] === undefined ? null : 1) : 3;
    const xAxis = deadzone(selectedXAxisIndex === null ? 0 : axes[selectedXAxisIndex] ?? 0);
    const yAxis = deadzone(selectedYAxisIndex === null ? 0 : axes[selectedYAxisIndex] ?? 0);
    if (source.gamepad) {
      diagnostics.push({
        handedness: source.handedness ?? "unknown",
        rawAxes: Array.from(axes),
        selectedXAxisIndex,
        selectedYAxisIndex,
        xAxisAfterDeadzone: xAxis,
        yAxisAfterDeadzone: yAxis,
        activeAfterDeadzone: xAxis !== 0 || yAxis !== 0,
        contribution: source.handedness === "right" ? "turn" : "move",
      });
    }
    if (source.handedness === "right") {
      turn += xAxis;
      continue;
    }
    strafe += xAxis;
    forward += -yAxis;
  }

  return {
    forward: clampUnit(forward),
    strafe: clampUnit(strafe),
    turn: clampUnit(turn),
    handInputsObserved,
    inputSources,
    diagnostics,
  };
}

function deadzone(value: number): number {
  return Math.abs(value) < xrGamepadDeadzone ? 0 : clampUnit(value);
}

function isLocomotionVectorActive(vector: LocomotionVectorEvidence): boolean {
  return Math.abs(vector.forward) > 0 || Math.abs(vector.strafe) > 0 || Math.abs(vector.turn) > 0;
}

function clampUnit(value: number): number {
  return clamp(value, -1, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function actorMesh(color: number): Group {
  const group = new Group();
  const body = new Mesh(new CapsuleGeometry(0.22, 0.7, 8, 16), new MeshStandardMaterial({ color, roughness: 0.7 }));
  body.position.y = 0.55;
  const head = new Mesh(new SphereGeometry(0.2, 24, 16), new MeshStandardMaterial({ color: 0xcaa889, roughness: 0.75 }));
  head.position.y = 1.15;
  group.add(body, head);
  return group;
}

const frameDeltasMs: number[] = [];
let framesObserved = 0;
let previewFramesObserved = 0;
let immersiveFramesObserved = 0;
let firstFrameAtMs: number | null = null;
let lastFrameAtMs: number | undefined;

function recordFrame(now: number, evidence: {
  qualitySource: NonNullable<OpenClinXrFrameStats["qualitySource"]>;
  isPresenting: boolean;
  visibilityState: string;
}): void {
  if (lastFrameAtMs !== undefined) {
    frameDeltasMs.push(now - lastFrameAtMs);
    if (frameDeltasMs.length > 180) {
      frameDeltasMs.shift();
    }
  }
  firstFrameAtMs ??= now;
  lastFrameAtMs = now;
  framesObserved += 1;
  if (evidence.isPresenting) {
    immersiveFramesObserved += 1;
  } else {
    previewFramesObserved += 1;
  }
  window.__openClinXrFrameStats = buildRuntimeFrameStats({
    frameDeltasMs,
    framesObserved,
    firstFrameAtMs,
    latestFrameAtMs: now,
    previewFramesObserved,
    immersiveFramesObserved,
    qualitySource: evidence.qualitySource,
    isPresenting: evidence.isPresenting,
    visibilityState: evidence.visibilityState,
  });
  window.__openClinXrManualPerformanceDraft = buildManualPerformanceDraft({
    generatedAt: new Date().toISOString(),
    elapsedSecond: state.elapsedSecond,
    foregroundPageConfirmed: document.visibilityState === "visible",
    traceInteractionPassed: state.completedTraceTags.length > 0,
    frameStats: window.__openClinXrFrameStats,
    controllerSelectLatencyMs: lastTraceSelectLatencyMs,
    experienceModeEvidence: window.__openClinXrExperienceModeEvidence ?? xrExperienceModeEvidence,
    inputEvidence: window.__openClinXrInputEvidence ?? null,
    traceLatencyEvidence: window.__openClinXrTraceLatencyEvidence ?? null,
    reproducibilityEvidence: buildRuntimeReproducibilityEvidence(),
    immersiveSessionStarted: immersiveSessionActive,
  });
  window.__openClinXrManualPerformanceCaptureSummary = buildManualPerformanceCaptureSummary({
    draft: window.__openClinXrManualPerformanceDraft,
    frameStats: window.__openClinXrFrameStats,
    now,
  });
  if (framesObserved === 1 || framesObserved % 30 === 0) {
    updateManualEvidencePanel();
  }
}

function updateManualEvidencePanel(): string {
  const now = performance.now();
  const summary = buildManualPerformanceCaptureSummary({
    draft: window.__openClinXrManualPerformanceDraft ?? null,
    frameStats: window.__openClinXrFrameStats ?? null,
    now,
  });
  window.__openClinXrManualPerformanceCaptureSummary = summary;
  updateRuntimePosturePanel(summary);
  evidenceFrames.textContent = [
    `${summary.framesObserved ?? 0} / ${summary.sampleWindowSize ?? 0}`,
    `vr ${summary.immersiveFramesObserved ?? 0}`,
    `preview ${summary.previewFramesObserved ?? 0}`,
    summary.immersiveFrameEvidenceReady ? "frame evidence ready" : "frame gap",
  ].join(" | ");
  evidenceLoop.textContent = [
    summary.qualitySource ?? "pending",
    summary.isPresenting ? "presenting" : "not presenting",
    summary.visibilityState ?? "unknown",
    summary.frameStatsFresh === null ? "freshness pending" : summary.frameStatsFresh ? `${summary.frameStatsAgeMs}ms fresh` : `${summary.frameStatsAgeMs}ms stale`,
  ].join(" | ");
  evidenceInput.textContent = [
    `${summary.handInputsObserved ?? 0} hand inputs`,
    `hand rep ${summary.handRepresentationKind ?? "unknown"}`,
    summary.inputSourceKinds.length > 0 ? summary.inputSourceKinds.join(", ") : "no source",
  ].join(" | ");
  evidenceLocomotion.textContent = [
    summary.activeLocomotionSource ?? "none",
    summary.locomotionEvidenceReady ? "locomotion ready" : "locomotion gap",
    `attempt ${summary.locomotionAttempt ?? "unknown"}`,
    summary.lastLocomotionAtMs === null ? "no movement timestamp" : `moved ${summary.lastLocomotionAtMs}ms`,
    summary.locomotionDistanceMeters === null ? "no distance delta" : `d ${summary.locomotionDistanceMeters}m`,
    summary.locomotionTurnRadians === null ? "no turn delta" : `turn ${summary.locomotionTurnRadians}rad`,
    formatLocomotionDiagnosticSummary(summary.locomotionDiagnosticSummary),
    formatLocomotionProbeSummary(summary.locomotionProbeSummary),
  ].join(" | ");
  evidenceTrace.textContent = [
    summary.traceLatencySource ?? "no trace source",
    summary.headsetSelectLatencyReady ? "headset latency ready" : "headset latency gap",
    `attempt ${summary.traceInteractionAttempt ?? "unknown"}`,
    summary.lastTraceTag ?? "no tag",
    summary.lastTraceLatencyMs === null ? "no latency" : `${summary.lastTraceLatencyMs}ms`,
  ].join(" | ");
  evidenceValidation.textContent = [
    summary.manualValidationReady ? "manual validation ready" : "draft only",
    summary.blockers.length === 0 ? "no blockers" : `${summary.blockers.length} blockers`,
    `gap ${formatTechnicalGapStatus(summary)}`,
  ].join(" | ");
  copyEvidenceStatus.textContent = formatManualEvidenceCopyStatus(summary, evidenceCopyDisposition);
  const manualPerformanceDraft = window.__openClinXrManualPerformanceDraft ?? null;
  const payload = JSON.stringify(buildManualPerformanceEvidencePayload({
    manualPerformanceDraft,
    captureSummary: summary,
    textPanelEvidence: window.__openClinXrTextPanelEvidence ?? null,
  }), null, 2);
  manualEvidenceJson.value = payload;
  return payload;
}

function formatLocomotionDiagnosticSummary(
  summary: ManualPerformanceCaptureSummary["locomotionDiagnosticSummary"],
): string {
  if (!summary) {
    return "diag pending";
  }
  const reasons = summary.handGestureBlockedReasons.length > 0
    ? summary.handGestureBlockedReasons.join(",")
    : "none";
  return `diag gp ${summary.activeGamepadSourceCount}/${summary.gamepadSourceCount}; hand ${summary.pinchingHandCount}/${summary.handGestureHandCount}; blocked ${reasons}`;
}

function formatLocomotionProbeSummary(
  summary: ManualPerformanceCaptureSummary["locomotionProbeSummary"],
): string {
  if (!summary) {
    return "probe pending";
  }
  return `probe ${summary.primaryReason}; ctrl ${summary.controllerSources.activeAfterDeadzone}/${summary.controllerSources.total}; hand ${summary.handGesture.pinching}/${summary.handGesture.handsObserved}`;
}

let start = performance.now();
function tick(): void {
  state = { ...state, elapsedSecond: Math.floor((performance.now() - start) / 1000) };
  clock.textContent = formatStationClock(state.elapsedSecond);
  requestAnimationFrame(tick);
}

start = performance.now();
recordBootPhase("controls_start");
renderControls();
updateReadiness();
updateRuntimePosturePanel(null);
recordBootPhase("controls_ready");
void initializeRemoteTraceSession(stationApi);
void updateXrStatus();
let stationScene: StationSceneRuntime | undefined;
try {
  stationScene = createStationScene();
  recordBootPhase("station_scene_ready");
  window.setInterval(updateManualEvidencePanel, 1000);
} catch (error) {
  recordBootPhase("station_scene_failed", error);
  xrStatus.textContent = "Station boot blocked";
}
enterXrButton.addEventListener("click", () => {
  if (!stationScene) {
    xrStatus.textContent = "Station boot blocked";
    return;
  }
  void stationScene.startImmersiveSession();
});
tick();
recordBootPhase("clock_started");
