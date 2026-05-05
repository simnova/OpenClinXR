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
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import {
  buildIwsdkSidecarFrameStats,
  buildIwsdkSidecarXrEntryEvidence,
  buildIwsdkSidecarRuntimeEvidence,
  completeIwsdkSidecarTraceAction,
  createIwsdkSidecarRuntimeState,
  formatIwsdkSidecarClock,
  iwsdkSidecarPrimitiveHandModelProfile,
  iwsdkSidecarSceneObjectNames,
  recordIwsdkSidecarXrEntryEvidence,
  summarizeIwsdkSidecarReadiness,
  type IwsdkSidecarFrameQualitySource,
  type IwsdkSidecarFrameStats,
  type IwsdkSidecarRuntimeEvidence,
  type IwsdkSidecarRuntimeState,
  type IwsdkSidecarXrEntryEvidence,
  type IwsdkSidecarXrEntryStatus,
} from "./sidecar-state.js";
import {
  buildMixedRealitySupportState,
  hasApprovedMixedRealityOperatorGate,
  mixedRealityOptionalFeatures,
  type MixedRealitySupportState,
} from "./mixed-reality-state.js";
import "./styles.css";

type NavigatorWithXr = Navigator & {
  xr?: {
    isSessionSupported(mode: XrSessionMode): Promise<boolean>;
    requestSession(
      mode: XrSessionMode,
      options?: { optionalFeatures?: string[] },
    ): Promise<XrSession>;
  };
};

type XrSessionMode = "immersive-vr" | "immersive-ar";
type PresentationMode = "full-vr" | "mixed-reality";

type XrSession = {
  inputSources?: Iterable<XrInputSourceWithGamepad>;
  addEventListener(type: "end", listener: () => void, options?: { once?: boolean }): void;
  end(): Promise<void>;
};

type XrInputSourceWithGamepad = {
  handedness?: "left" | "right" | "none" | string | undefined;
  hand?: unknown | undefined;
  gamepad?: {
    axes?: readonly number[];
  } | undefined;
};

type LocomotionVectorEvidence = {
  forward: number;
  strafe: number;
  turn: number;
};

type RuntimeInputSourceKind = "keyboard" | "xr_gamepad" | "xr_hand";

type XrInputSourceEvidence = {
  handedness: string;
  hasHand: boolean;
  hasGamepad: boolean;
  axisCount: number;
};

type OpenClinXrInputEvidence = {
  handModelCount: number;
  handModelStatus: "pending_immersive_session" | "installed" | "failed";
  handInputsObserved: number;
  locomotionMode: "experimental_keyboard_and_thumbstick_dolly";
  lastLocomotionAtMs: number | null;
  activeLocomotionSource: "none" | "keyboard" | "xr_gamepad" | "mixed";
  inputSourceCount: number;
  inputSourceKinds: RuntimeInputSourceKind[];
  keyboardVector: LocomotionVectorEvidence;
  xrVector: LocomotionVectorEvidence;
  xrInputSources: XrInputSourceEvidence[];
  rigPosition: { x: number; z: number };
};

type OpenClinXrBootEvidence = {
  app: "ui-xr-iwsdk-spike";
  events: Array<{
    phase: string;
    atMs: number;
    error?: string;
  }>;
};

type OpenClinXrTraceLatencyEvidence = {
  lastTraceTag: string | null;
  lastSelectLatencyMs: number | null;
  source: "dom_click_trace_button";
  measuredAtMs: number | null;
  productionControllerLatencySubstitute: false;
};

type FullVrSessionStartInput = {
  entrySource?: "operator_button" | "iwer_auto_entry_probe";
};

type StationSceneRuntime = {
  startFullVrSession(input?: FullVrSessionStartInput): Promise<void>;
  startMixedRealitySession(): Promise<void>;
};

type ReadableVrTextPanel = {
  mesh: Mesh;
  update(lines: readonly string[]): void;
};

type ReadableVrTextPanelEvidence = {
  name: string;
  title: string;
  source: "canvas_texture_metadata";
  canvasPixels: { width: number; height: number };
  worldMeters: { width: number; height: number };
  lineCount: number;
  previewLines: string[];
  contentHash: string;
  lastUpdatedAtMs: number;
  readabilityClaim: "metadata_only_requires_foreground_headset_confirmation";
};

type ReadableVrTextPanelEvidenceSet = {
  source: "window.__openClinXrTextPanelEvidence";
  panelCount: number;
  panels: ReadableVrTextPanelEvidence[];
  limitations: ["metadata_only_requires_foreground_headset_confirmation"];
};

type IwerEvidenceViewMode = "default" | "wide_iwer_capture";

type IwerEvidenceViewEvidence = {
  source: "window.__openClinXrIwerEvidenceViewEvidence";
  mode: IwerEvidenceViewMode;
  queryFlag: "iwerEvidenceView=wide";
  purpose: "query_gated_visual_evidence_capture_layout";
  controllerAffordancesRendered: boolean;
  rigPosition: { x: number; z: number };
  notEvidenceFor: [
    "physical_quest_view_framing",
    "in_headset_text_readability",
    "production_runtime_readiness",
  ];
};

declare global {
  interface Window {
    __openClinXrFrameStats?: IwsdkSidecarFrameStats;
    __openClinXrIwsdkSidecarEvidence?: IwsdkSidecarRuntimeEvidence;
    __openClinXrIwsdkSidecarTraceTags?: string[];
    __openClinXrInputEvidence?: OpenClinXrInputEvidence;
    __openClinXrTextPanelEvidence?: ReadableVrTextPanelEvidenceSet;
    __openClinXrBootEvidence?: OpenClinXrBootEvidence;
    __openClinXrTraceLatencyEvidence?: OpenClinXrTraceLatencyEvidence;
    __openClinXrMixedRealitySupport?: MixedRealitySupportState;
    __openClinXrIwerSessionEntryEvidence?: IwsdkSidecarXrEntryEvidence;
    __openClinXrIwerEvidenceViewEvidence?: IwerEvidenceViewEvidence;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root");
}

function requireElement<TElement extends Element>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Missing IWSDK sidecar element: ${selector}`);
  }
  return element;
}

const bootStartedAtMs = performance.now();
const iwerAutoEnterVrQueryFlag = "iwerAutoEnterVr=true";
const iwerEvidenceViewWideQueryFlag = "iwerEvidenceView=wide";

function recordBootPhase(phase: string, error?: unknown): void {
  const current: OpenClinXrBootEvidence = window.__openClinXrBootEvidence ?? { app: "ui-xr-iwsdk-spike", events: [] };
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

function hasIwerAutoEnterVrProbe(search: string): boolean {
  return search.includes(iwerAutoEnterVrQueryFlag) || new URLSearchParams(search).get("iwerAutoEnterVr") === "true";
}

function hasIwerWideEvidenceView(search: string): boolean {
  return search.includes(iwerEvidenceViewWideQueryFlag) || new URLSearchParams(search).get("iwerEvidenceView") === "wide";
}

let state: IwsdkSidecarRuntimeState = createIwsdkSidecarRuntimeState();
let iwsdkCoreExportCount = 0;
let iwsdkXrInputExportCount = 0;
let lastTraceSelectLatencyMs: number | null = null;
let immersiveSessionActive = false;
let activePresentationMode: PresentationMode | null = null;
const mixedRealityOperatorApproved = hasApprovedMixedRealityOperatorGate(window.location.search);
const iwerAutoEnterVrProbeEnabled = hasIwerAutoEnterVrProbe(window.location.search);
const iwerEvidenceViewMode: IwerEvidenceViewMode = hasIwerWideEvidenceView(window.location.search)
  ? "wide_iwer_capture"
  : "default";
let mixedRealitySupport = buildMixedRealitySupportState({
  operatorApproved: mixedRealityOperatorApproved,
  webXrAvailable: false,
});
const initialDialogueText = "Robert Hayes: The pressure is heavy and I feel sweaty.";

app.innerHTML = `
  <main class="spike-shell">
    <section class="spike-stage" aria-label="IWSDK emergency department station scene">
      <canvas id="iwsdk-sidecar-canvas" aria-label="IWSDK ED chest pain bay preview"></canvas>
      <div class="status-strip">
        <div class="status-lane full-vr-lane" aria-label="Full VR status">
          <span id="xr-status">Full VR checking</span>
          <button id="enter-xr-button" class="xr-entry-button" type="button" disabled>Enter Full VR</button>
        </div>
        <div class="status-lane mixed-reality-lane" aria-label="Mixed Reality status">
          <span id="mr-status">Mixed Reality checking</span>
          <button id="enter-mr-button" class="xr-entry-button mr-entry-button" type="button" disabled>Enter Mixed Reality</button>
        </div>
        <span id="iwsdk-status">IWSDK evidence pending</span>
        <span id="trace-summary">Trace 0/${state.requiredTraceTags.length}</span>
      </div>
    </section>
    <aside class="spike-panel" aria-label="IWSDK sidecar controls and evidence">
      <header>
        <p class="label">IWSDK Phase 1</p>
        <h1>ED Chest Pain</h1>
        <p class="subtle">Approved sidecar shell for measuring package weight, scene parity, and Quest behavior before production adoption.</p>
      </header>
      <div class="timer-row">
        <span>Encounter</span>
        <strong id="station-clock">00:00</strong>
      </div>
      <section class="evidence-panel" aria-label="IWSDK runtime evidence">
        <h2>Runtime Evidence</h2>
        <dl>
          <div><dt>Core exports</dt><dd id="core-export-count">loading</dd></div>
          <div><dt>XR input exports</dt><dd id="input-export-count">loading</dd></div>
          <div><dt>Scene objects</dt><dd>${iwsdkSidecarSceneObjectNames.length} parity targets</dd></div>
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
    </aside>
  </main>
`;

const canvas = requireElement<HTMLCanvasElement>("#iwsdk-sidecar-canvas");
const clock = requireElement<HTMLElement>("#station-clock");
const traceSummary = requireElement<HTMLElement>("#trace-summary");
const traceActions = requireElement<HTMLElement>("#trace-actions");
const xrStatus = requireElement<HTMLElement>("#xr-status");
const mrStatus = requireElement<HTMLElement>("#mr-status");
const iwsdkStatus = requireElement<HTMLElement>("#iwsdk-status");
const coreExportCount = requireElement<HTMLElement>("#core-export-count");
const inputExportCount = requireElement<HTMLElement>("#input-export-count");
const dialogueLine = requireElement<HTMLElement>("#dialogue-line");
const enterXrButton = requireElement<HTMLButtonElement>("#enter-xr-button");
const enterMrButton = requireElement<HTMLButtonElement>("#enter-mr-button");

window.__openClinXrIwsdkSidecarEvidence = buildIwsdkSidecarRuntimeEvidence({
  iwsdkCoreExportCount,
  iwsdkXrInputExportCount,
});
window.__openClinXrIwerSessionEntryEvidence = buildIwsdkSidecarXrEntryEvidence({
  sessionMode: "immersive-vr",
  autoAttemptEnabled: iwerAutoEnterVrProbeEnabled,
  nowMs: Number(performance.now().toFixed(2)),
});
window.__openClinXrIwsdkSidecarTraceTags = [];
window.__openClinXrMixedRealitySupport = mixedRealitySupport;
window.__openClinXrIwerEvidenceViewEvidence = buildIwerEvidenceViewEvidence({
  mode: iwerEvidenceViewMode,
  controllerAffordancesRendered: iwerEvidenceViewMode !== "wide_iwer_capture",
  rigPosition: { x: 0, z: 0 },
});
scheduleIwsdkEvidenceHydration();

function buildIwerEvidenceViewEvidence(input: {
  mode: IwerEvidenceViewMode;
  controllerAffordancesRendered: boolean;
  rigPosition: { x: number; z: number };
}): IwerEvidenceViewEvidence {
  return {
    source: "window.__openClinXrIwerEvidenceViewEvidence",
    mode: input.mode,
    queryFlag: "iwerEvidenceView=wide",
    purpose: "query_gated_visual_evidence_capture_layout",
    controllerAffordancesRendered: input.controllerAffordancesRendered,
    rigPosition: {
      x: Number(input.rigPosition.x.toFixed(3)),
      z: Number(input.rigPosition.z.toFixed(3)),
    },
    notEvidenceFor: [
      "physical_quest_view_framing",
      "in_headset_text_readability",
      "production_runtime_readiness",
    ],
  };
}

function recordIwerSessionEntryEvidence(status: IwsdkSidecarXrEntryStatus, error?: unknown): void {
  const current = window.__openClinXrIwerSessionEntryEvidence ?? buildIwsdkSidecarXrEntryEvidence({
    sessionMode: "immersive-vr",
    autoAttemptEnabled: iwerAutoEnterVrProbeEnabled,
    nowMs: Number(performance.now().toFixed(2)),
  });
  window.__openClinXrIwerSessionEntryEvidence = recordIwsdkSidecarXrEntryEvidence(current, status, {
    nowMs: Number(performance.now().toFixed(2)),
    error,
  });
}

function scheduleIwsdkEvidenceHydration(): void {
  window.setTimeout(() => {
    void hydrateIwsdkPackageEvidence();
  }, 1000);
}

async function hydrateIwsdkPackageEvidence(): Promise<void> {
  recordBootPhase("iwsdk_evidence_load_start");
  try {
    const [iwsdkCore, iwsdkXrInput] = await Promise.all([
      import("@iwsdk/core"),
      import("@iwsdk/xr-input"),
    ]);
    iwsdkCoreExportCount = Object.keys(iwsdkCore).length;
    iwsdkXrInputExportCount = Object.keys(iwsdkXrInput).length;
    coreExportCount.textContent = String(iwsdkCoreExportCount);
    inputExportCount.textContent = String(iwsdkXrInputExportCount);
    window.__openClinXrIwsdkSidecarEvidence = buildIwsdkSidecarRuntimeEvidence({
      iwsdkCoreExportCount,
      iwsdkXrInputExportCount,
    });
    iwsdkStatus.textContent = `IWSDK exports ${iwsdkCoreExportCount}/${iwsdkXrInputExportCount}`;
    recordBootPhase("iwsdk_evidence_loaded");
  } catch (error) {
    iwsdkStatus.textContent = "IWSDK evidence blocked";
    recordBootPhase("iwsdk_evidence_failed", error);
  }
}

function renderControls(): void {
  traceActions.innerHTML = "";
  for (const tag of state.requiredTraceTags) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.traceTag = tag;
    button.textContent = tag.replaceAll("_", " ");
    button.className = state.completedTraceTags.includes(tag) ? "trace-button complete" : "trace-button";
    button.addEventListener("click", () => {
      const traceSelectStartedAtMs = performance.now();
      state = completeIwsdkSidecarTraceAction(state, tag);
      window.__openClinXrIwsdkSidecarTraceTags = [...state.completedTraceTags];
      dialogueLine.textContent = dialogueFor(tag);
      renderControls();
      updateReadiness();
      recordTraceSelectLatency(traceSelectStartedAtMs, tag);
    });
    traceActions.append(button);
  }
}

function recordTraceSelectLatency(startedAtMs: number, tag: string): void {
  lastTraceSelectLatencyMs = Number((performance.now() - startedAtMs).toFixed(2));
  window.__openClinXrTraceLatencyEvidence = {
    lastTraceTag: tag,
    lastSelectLatencyMs: lastTraceSelectLatencyMs,
    source: "dom_click_trace_button",
    measuredAtMs: Number(performance.now().toFixed(2)),
    productionControllerLatencySubstitute: false,
  };
}

function updateReadiness(): void {
  const summary = summarizeIwsdkSidecarReadiness(state);
  traceSummary.textContent = `Trace ${summary.observedCount}/${state.requiredTraceTags.length}`;
}

function dialogueFor(tag: string): string {
  const lines: Record<string, string> = {
    history_opqrst: "Robert Hayes: It began while I was climbing the stairs, and it has not let up.",
    vitals_review: "Nurse Alvarez: He is more diaphoretic and his repeat pressure is lower.",
    ecg_request: "Nurse Alvarez: ECG is printing now. I will call it out as soon as it is ready.",
    urgent_escalation: "Spouse: Please tell me what you are worried about.",
    team_communication: "Nurse Alvarez: I hear ECG, IV access, aspirin check, and senior physician notification.",
    patient_note_submitted: "System: Sidecar note trace saved for review evidence.",
  };
  return lines[tag] ?? "System: Sidecar trace event recorded.";
}

async function updateXrStatus(): Promise<void> {
  const navigatorWithXr = navigator as NavigatorWithXr;
  if (!navigatorWithXr.xr) {
    xrStatus.textContent = "WebXR unavailable";
    enterXrButton.disabled = true;
    recordIwerSessionEntryEvidence("unsupported", "navigator.xr unavailable");
    setMixedRealitySupport(buildMixedRealitySupportState({
      operatorApproved: mixedRealityOperatorApproved,
      webXrAvailable: false,
    }));
    return;
  }
  try {
    const supported = await navigatorWithXr.xr.isSessionSupported("immersive-vr");
    xrStatus.textContent = supported ? "Full VR ready" : "WebXR unavailable";
    enterXrButton.disabled = !supported;
    if (!supported) {
      recordIwerSessionEntryEvidence("unsupported", "immersive-vr unsupported");
    }
  } catch {
    xrStatus.textContent = "WebXR check blocked";
    enterXrButton.disabled = true;
    recordIwerSessionEntryEvidence("unsupported", "immersive-vr support check blocked");
  }

  if (!mixedRealityOperatorApproved) {
    setMixedRealitySupport(buildMixedRealitySupportState({
      operatorApproved: false,
      webXrAvailable: true,
    }));
    return;
  }

  try {
    setMixedRealitySupport(buildMixedRealitySupportState({
      operatorApproved: true,
      webXrAvailable: true,
      immersiveArSupported: await navigatorWithXr.xr.isSessionSupported("immersive-ar"),
    }));
  } catch {
    setMixedRealitySupport(buildMixedRealitySupportState({
      operatorApproved: true,
      webXrAvailable: true,
      checkBlocked: true,
    }));
  }
}

function setMixedRealitySupport(next: MixedRealitySupportState): void {
  mixedRealitySupport = next;
  window.__openClinXrMixedRealitySupport = next;
  mrStatus.textContent = next.label;
  enterMrButton.disabled = !next.offerable || immersiveSessionActive;
}

function createStationScene(): StationSceneRuntime {
  recordBootPhase("station_scene_start");
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0d1715);
  renderer.setClearAlpha(1);
  let activeXrSession: XrSession | undefined;
  let lastLocomotionAtMs: number | null = null;
  let lastAnimateAtMs = performance.now();
  let lastRenderLoopAtMs = 0;
  const flatPreviewFallbackFrameMs = 1000 / 30;

  const scene = new Scene();
  scene.name = iwsdkSidecarSceneObjectNames[0] ?? "openclinxr.iwsdk.station-root";
  scene.background = new Color(0x0d1715);

  const locomotionRig = new Group();
  locomotionRig.name = "openclinxr.ed-chest-pain.locomotion-rig";
  if (iwerEvidenceViewMode === "wide_iwer_capture") {
    locomotionRig.position.set(0, 0, 1.35);
  }
  scene.add(locomotionRig);

  const camera = new PerspectiveCamera(52, 1, 0.1, 100);
  camera.position.set(0, 1.7, 5.2);
  camera.lookAt(0, 1.1, 0);
  locomotionRig.add(camera);

  const ambient = new HemisphereLight(0xf0fff5, 0x17322c, 2.1);
  ambient.name = "openclinxr.ed-chest-pain.ambient-light";
  scene.add(ambient);

  const key = new DirectionalLight(0xffffff, 2.4);
  key.name = "openclinxr.ed-chest-pain.key-light";
  key.position.set(3, 5, 4);
  scene.add(key);

  const floor = new Mesh(new BoxGeometry(7, 0.08, 5), new MeshStandardMaterial({ color: 0x3b554e, roughness: 0.85 }));
  floor.name = "openclinxr.ed-chest-pain.floor";
  floor.position.y = -0.04;
  scene.add(floor);

  const bed = new Mesh(new BoxGeometry(2.4, 0.35, 1.05), new MeshStandardMaterial({ color: 0xdbe7e1, roughness: 0.65 }));
  bed.name = "openclinxr.ed-chest-pain.bed";
  bed.position.set(-0.4, 0.55, 0);
  scene.add(bed);

  const monitor = new Mesh(new BoxGeometry(0.8, 0.55, 0.08), new MeshStandardMaterial({ color: 0x203c37, emissive: 0x0b3d2e }));
  monitor.name = "openclinxr.ed-chest-pain.monitor";
  monitor.position.set(1.7, 1.45, -0.65);
  scene.add(monitor);

  const patient = actorMesh(0x86b7a6);
  patient.name = "openclinxr.ed-chest-pain.patient-robert-hayes";
  patient.position.set(-0.6, 1.0, 0.05);
  patient.scale.set(1.1, 1.1, 1.1);
  scene.add(patient);

  const nurse = actorMesh(0x4f93c7);
  nurse.name = "openclinxr.ed-chest-pain.nurse-maria-alvarez";
  nurse.position.set(1.45, 0.95, 0.55);
  scene.add(nurse);

  const spouse = actorMesh(0xd39b56);
  spouse.name = "openclinxr.ed-chest-pain.spouse-anna-hayes";
  spouse.position.set(-2.0, 0.95, 0.7);
  scene.add(spouse);

  const clockMesh = new Mesh(new CylinderGeometry(0.25, 0.25, 0.05, 48), new MeshStandardMaterial({ color: 0xf3e8c9 }));
  clockMesh.name = "openclinxr.ed-chest-pain.wall-clock";
  clockMesh.rotation.x = Math.PI / 2;
  clockMesh.position.set(0.9, 2.2, -1.2);
  scene.add(clockMesh);
  const clinicalPanel = createClinicalPanel();
  scene.add(clinicalPanel.mesh);
  const dialoguePanel = createReadableVrTextPanel({
    name: "openclinxr.ed-chest-pain.in-vr-dialogue-panel",
    title: "Live Dialogue",
    lines: [initialDialogueText, `Trace 0/${state.requiredTraceTags.length}`],
    widthMeters: 1.85,
    heightMeters: 0.95,
    background: "#f3fbf7",
    accent: "#286b54",
  });
  dialoguePanel.mesh.position.set(1.28, 1.28, -1.08);
  dialoguePanel.mesh.rotation.y = -0.28;
  scene.add(dialoguePanel.mesh);
  const inputPanel = createReadableVrTextPanel({
    name: "openclinxr.ed-chest-pain.in-vr-input-panel",
    title: "Input Evidence",
    lines: [
      "Session: Full VR not entered",
      "Hands: pending optional hand-tracking",
      "Movement: thumbstick and keyboard dolly",
    ],
    widthMeters: 1.65,
    heightMeters: 0.72,
    background: "#eaf8f4",
    accent: "#5a6f9f",
  });
  inputPanel.mesh.position.set(0.15, 0.78, -1.2);
  scene.add(inputPanel.mesh);
  let lastPanelSignature = "";
  applyEvidenceCaptureLayout({
    enabled: iwerEvidenceViewMode === "wide_iwer_capture",
    clinicalPanel,
    dialoguePanel,
    inputPanel,
  });
  const controllerAffordancesRendered = iwerEvidenceViewMode !== "wide_iwer_capture";
  if (controllerAffordancesRendered) {
    addControllerAffordances(renderer, scene);
  }
  window.__openClinXrIwerEvidenceViewEvidence = buildIwerEvidenceViewEvidence({
    mode: iwerEvidenceViewMode,
    controllerAffordancesRendered,
    rigPosition: {
      x: locomotionRig.position.x,
      z: locomotionRig.position.z,
    },
  });
  const keyboardLocomotion = createKeyboardLocomotion();
  let handModelStatus: OpenClinXrInputEvidence["handModelStatus"] = "pending_immersive_session";
  let handModelsInstalled = false;
  applyPresentationPolicy("full-vr");

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
    const now = typeof timestamp === "number" ? timestamp : performance.now();
    renderStationFrame(now, "webxr_animation_loop");
  }

  function renderStationFrame(now: number, qualitySource: IwsdkSidecarFrameQualitySource): void {
    lastRenderLoopAtMs = now;
    const deltaSeconds = Math.min((now - lastAnimateAtMs) / 1000, 0.05);
    lastAnimateAtMs = now;
    recordFrame(now, {
      qualitySource,
      isPresenting: renderer.xr.isPresenting && activeXrSession !== undefined && immersiveSessionActive,
      visibilityState: document.visibilityState,
    });
    const inputEvidence = applyLocomotion({
      deltaSeconds,
      keyboardLocomotion,
      locomotionRig,
      now,
      session: activeXrSession,
      lastLocomotionAtMs,
      handModelCount: handModelsInstalled ? 2 : 0,
      handModelStatus,
    });
    lastLocomotionAtMs = inputEvidence.lastLocomotionAtMs;
    window.__openClinXrInputEvidence = inputEvidence;
    window.__openClinXrIwerEvidenceViewEvidence = buildIwerEvidenceViewEvidence({
      mode: iwerEvidenceViewMode,
      controllerAffordancesRendered,
      rigPosition: inputEvidence.rigPosition,
    });
    updateVrPanels(inputEvidence);
    resize();
    patient.rotation.y = Math.sin(now / 1200) * 0.08;
    nurse.rotation.y = Math.sin(now / 900) * 0.12;
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(animate);
  window.setInterval(fallbackAnimationLoop, flatPreviewFallbackFrameMs);
  recordBootPhase("station_render_loop_started");

  return {
    async startFullVrSession(input: FullVrSessionStartInput = { entrySource: "operator_button" }): Promise<void> {
      if (activeXrSession) {
        await activeXrSession.end();
        return;
      }
      recordBootPhase(`full_vr_entry_${input.entrySource ?? "operator_button"}`);

      const navigatorWithXr = navigator as NavigatorWithXr;
      if (!navigatorWithXr.xr) {
        xrStatus.textContent = "WebXR unavailable";
        recordIwerSessionEntryEvidence("unsupported", "navigator.xr unavailable");
        return;
      }

      enterXrButton.disabled = true;
      enterMrButton.disabled = true;
      xrStatus.textContent = "Entering Full VR";
      applyPresentationPolicy("full-vr");
      recordIwerSessionEntryEvidence("requesting");
      try {
        const session = await navigatorWithXr.xr.requestSession("immersive-vr", {
          optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
        });
        activeXrSession = session;
        session.addEventListener("end", () => {
          activeXrSession = undefined;
          immersiveSessionActive = false;
          activePresentationMode = null;
          enterXrButton.disabled = false;
          enterXrButton.textContent = "Enter Full VR";
          xrStatus.textContent = "Full VR ready";
          applyPresentationPolicy("full-vr");
          setMixedRealitySupport(mixedRealitySupport);
          recordIwerSessionEntryEvidence("ended");
        }, { once: true });
        await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
        installHandModelsOnce();
        immersiveSessionActive = true;
        activePresentationMode = "full-vr";
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Exit Full VR";
        xrStatus.textContent = "In Full VR";
        recordIwerSessionEntryEvidence("started");
      } catch (error) {
        activeXrSession = undefined;
        immersiveSessionActive = false;
        activePresentationMode = null;
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Enter Full VR";
        xrStatus.textContent = "WebXR entry blocked";
        applyPresentationPolicy("full-vr");
        setMixedRealitySupport(mixedRealitySupport);
        recordIwerSessionEntryEvidence("failed", error);
      }
    },
    async startMixedRealitySession(): Promise<void> {
      if (activeXrSession) {
        await activeXrSession.end();
        return;
      }

      const navigatorWithXr = navigator as NavigatorWithXr;
      if (!navigatorWithXr.xr) {
        setMixedRealitySupport(buildMixedRealitySupportState({
          operatorApproved: mixedRealityOperatorApproved,
          webXrAvailable: false,
        }));
        return;
      }
      if (!mixedRealitySupport.offerable) {
        setMixedRealitySupport(mixedRealitySupport);
        return;
      }

      enterXrButton.disabled = true;
      enterMrButton.disabled = true;
      mrStatus.textContent = "Entering Mixed Reality";
      applyPresentationPolicy("mixed-reality");
      try {
        const session = await navigatorWithXr.xr.requestSession("immersive-ar", {
          optionalFeatures: [...mixedRealityOptionalFeatures],
        });
        activeXrSession = session;
        session.addEventListener("end", () => {
          activeXrSession = undefined;
          immersiveSessionActive = false;
          activePresentationMode = null;
          enterXrButton.disabled = false;
          enterMrButton.textContent = "Enter Mixed Reality";
          applyPresentationPolicy("full-vr");
          setMixedRealitySupport(mixedRealitySupport);
        }, { once: true });
        await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
        installHandModelsOnce();
        immersiveSessionActive = true;
        activePresentationMode = "mixed-reality";
        enterMrButton.disabled = false;
        enterMrButton.textContent = "Exit Mixed Reality";
        mrStatus.textContent = "In Mixed Reality";
      } catch {
        activeXrSession = undefined;
        immersiveSessionActive = false;
        activePresentationMode = null;
        enterXrButton.disabled = false;
        enterMrButton.textContent = "Enter Mixed Reality";
        mrStatus.textContent = "Mixed Reality entry blocked";
        applyPresentationPolicy("full-vr");
        setMixedRealitySupport(mixedRealitySupport);
      }
    },
  };

  function applyPresentationPolicy(mode: PresentationMode): void {
    if (mode === "mixed-reality") {
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
      renderer.setClearAlpha(0);
    } else {
      scene.background = new Color(0x0d1715);
      renderer.setClearColor(0x0d1715, 1);
      renderer.setClearAlpha(1);
    }
    floor.visible = mode !== "mixed-reality";
  }

  function fallbackAnimationLoop(): void {
    const now = performance.now();
    if (now - lastRenderLoopAtMs > flatPreviewFallbackFrameMs) {
      renderStationFrame(now, "flat_preview_fallback");
    }
  }

  function installHandModelsOnce(): void {
    if (handModelsInstalled || handModelStatus === "failed") {
      return;
    }
    try {
      addHandModels(renderer, scene);
      handModelsInstalled = true;
      handModelStatus = "installed";
    } catch {
      handModelStatus = "failed";
    }
  }

  function updateVrPanels(inputEvidence: OpenClinXrInputEvidence): void {
    const summary = summarizeIwsdkSidecarReadiness(state);
    const dialogueText = dialogueLine.textContent ?? initialDialogueText;
    const panelSignature = [
      dialogueText,
      summary.observedCount,
      summary.missingCount,
      activePresentationMode ?? "preview",
      inputEvidence.handModelStatus,
      inputEvidence.handInputsObserved,
      inputEvidence.lastLocomotionAtMs,
      inputEvidence.activeLocomotionSource,
      inputEvidence.rigPosition.x,
      inputEvidence.rigPosition.z,
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
      activePresentationMode === "mixed-reality"
        ? "Session: In Mixed Reality"
        : immersiveSessionActive ? "Session: In Full VR" : "Session: Desktop preview",
      `Hands: ${inputEvidence.handModelStatus}; observed ${inputEvidence.handInputsObserved}`,
      `Movement: ${inputEvidence.activeLocomotionSource}; x ${inputEvidence.rigPosition.x}, z ${inputEvidence.rigPosition.z}`,
    ]);
  }
}

function createClinicalPanel(): ReadableVrTextPanel {
  const panel = createReadableVrTextPanel({
    name: "openclinxr.ed-chest-pain.in-vr-clinical-panel",
    title: "Simulated EHR",
    lines: [
      "Chief concern: crushing substernal pressure",
      "Vitals: BP 152/92  HR 104  RR 20  SpO2 96%",
      "Actors: patient, nurse, spouse",
      "Priority: obtain ECG and escalate urgently",
    ],
    widthMeters: 2.3,
    heightMeters: 1.15,
    background: "#f3fbf7",
    accent: "#7d4f28",
  });
  panel.mesh.position.set(-1.32, 1.55, -1.08);
  panel.mesh.rotation.y = 0.34;
  return panel;
}

function applyEvidenceCaptureLayout(input: {
  enabled: boolean;
  clinicalPanel: ReadableVrTextPanel;
  dialoguePanel: ReadableVrTextPanel;
  inputPanel: ReadableVrTextPanel;
}): void {
  if (!input.enabled) {
    return;
  }

  input.clinicalPanel.mesh.position.set(-1.48, 1.7, -1.65);
  input.clinicalPanel.mesh.rotation.y = 0.12;
  input.dialoguePanel.mesh.position.set(1.48, 1.7, -1.65);
  input.dialoguePanel.mesh.rotation.y = -0.12;
  input.inputPanel.mesh.position.set(0, 1.05, -1.55);
  input.inputPanel.mesh.rotation.y = 0;
  prioritizeEvidencePanelVisibility(input.clinicalPanel.mesh);
  prioritizeEvidencePanelVisibility(input.dialoguePanel.mesh);
  prioritizeEvidencePanelVisibility(input.inputPanel.mesh);
}

function prioritizeEvidencePanelVisibility(mesh: Mesh): void {
  mesh.renderOrder = 50;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    material.depthTest = false;
    material.depthWrite = false;
  }
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
    panelContext.fillStyle = "#143129";
    panelContext.font = "700 62px Arial";
    panelContext.fillText(options.title, 58, 92);
    panelContext.font = "38px Arial";
    let y = 162;
    for (const line of lines) {
      y = drawWrappedText(panelContext, line, 58, y, panelCanvas.width - 116, 50) + 14;
    }
    texture.needsUpdate = true;
    publishReadableVrTextPanelEvidence({
      name: options.name,
      title: options.title,
      lines,
      canvasPixels: { width: panelCanvas.width, height: panelCanvas.height },
      worldMeters: { width: options.widthMeters, height: options.heightMeters },
      updatedAtMs: performance.now(),
    });
  }

  update(options.lines);
  return { mesh: panel, update };
}

const readableVrTextPanelEvidence = new Map<string, ReadableVrTextPanelEvidence>();

function publishReadableVrTextPanelEvidence(input: {
  name: string;
  title: string;
  lines: readonly string[];
  canvasPixels: { width: number; height: number };
  worldMeters: { width: number; height: number };
  updatedAtMs: number;
}): void {
  const normalizedLines = input.lines.map((line) => line.trim());
  const content = [input.title, ...normalizedLines].join("\n");
  readableVrTextPanelEvidence.set(input.name, {
    name: input.name,
    title: input.title,
    source: "canvas_texture_metadata",
    canvasPixels: { ...input.canvasPixels },
    worldMeters: {
      width: Number(input.worldMeters.width.toFixed(3)),
      height: Number(input.worldMeters.height.toFixed(3)),
    },
    lineCount: normalizedLines.length,
    previewLines: normalizedLines.map(truncateEvidenceLine),
    contentHash: hashEvidenceContent(content),
    lastUpdatedAtMs: Number(input.updatedAtMs.toFixed(2)),
    readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
  });
  window.__openClinXrTextPanelEvidence = {
    source: "window.__openClinXrTextPanelEvidence",
    panelCount: readableVrTextPanelEvidence.size,
    panels: [...readableVrTextPanelEvidence.values()],
    limitations: ["metadata_only_requires_foreground_headset_confirmation"],
  };
}

function truncateEvidenceLine(line: string): string {
  return line.length <= 140 ? line : `${line.slice(0, 137)}...`;
}

function hashEvidenceContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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

function addControllerAffordances(renderer: WebGLRenderer, scene: Scene): void {
  const controllerModelFactory = new XRControllerModelFactory();
  const gripNames = [
    "openclinxr.ed-chest-pain.controller-grip-left",
    "openclinxr.ed-chest-pain.controller-grip-right",
  ];
  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    controller.name = `openclinxr.ed-chest-pain.controller-${index + 1}`;
    const ray = new Line(
      new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, -3)]),
      new LineBasicMaterial({ color: 0x8bd8bf }),
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

function addHandModels(renderer: WebGLRenderer, scene: Scene): void {
  const handModelFactory = new XRHandModelFactory();
  for (let index = 0; index < 2; index += 1) {
    const hand = renderer.xr.getHand(index);
    hand.name = `openclinxr.ed-chest-pain.hand-${index + 1}`;
    const handModel = handModelFactory.createHandModel(hand, iwsdkSidecarPrimitiveHandModelProfile);
    handModel.name = `openclinxr.ed-chest-pain.hand-model-${index + 1}`;
    hand.add(handModel);
    scene.add(hand);
  }
}

type KeyboardLocomotionState = {
  forward: number;
  strafe: number;
  turn: number;
};

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

function applyLocomotion(input: {
  deltaSeconds: number;
  keyboardLocomotion: KeyboardLocomotionState;
  locomotionRig: Group;
  now: number;
  session: XrSession | undefined;
  lastLocomotionAtMs: number | null;
  handModelCount: number;
  handModelStatus: OpenClinXrInputEvidence["handModelStatus"];
}): OpenClinXrInputEvidence {
  const xrLocomotion = readXrGamepadLocomotion(input.session);
  const keyboardVector = roundedVector({
    forward: input.keyboardLocomotion.forward,
    strafe: input.keyboardLocomotion.strafe,
    turn: input.keyboardLocomotion.turn,
  });
  const xrVector = roundedVector({
    forward: xrLocomotion.forward,
    strafe: xrLocomotion.strafe,
    turn: xrLocomotion.turn,
  });
  const keyboardActive = isLocomotionVectorActive(keyboardVector);
  const xrActive = isLocomotionVectorActive(xrVector);
  const forward = clampUnit(keyboardVector.forward + xrVector.forward);
  const strafe = clampUnit(keyboardVector.strafe + xrVector.strafe);
  const turn = clampUnit(keyboardVector.turn + xrVector.turn);
  const moved = Math.abs(forward) > 0 || Math.abs(strafe) > 0 || Math.abs(turn) > 0;
  const speedMetersPerSecond = 1.35;

  input.locomotionRig.rotation.y += turn * input.deltaSeconds * 1.8;
  const yaw = input.locomotionRig.rotation.y;
  const forwardVector = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const rightVector = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  input.locomotionRig.position
    .addScaledVector(forwardVector, forward * speedMetersPerSecond * input.deltaSeconds)
    .addScaledVector(rightVector, strafe * speedMetersPerSecond * input.deltaSeconds);
  input.locomotionRig.position.x = clamp(input.locomotionRig.position.x, -2.75, 2.75);
  input.locomotionRig.position.z = clamp(input.locomotionRig.position.z, -2.25, 2.25);

  return {
    handModelCount: input.handModelCount,
    handModelStatus: input.handModelStatus,
    handInputsObserved: xrLocomotion.handInputsObserved,
    locomotionMode: "experimental_keyboard_and_thumbstick_dolly",
    lastLocomotionAtMs: moved ? Number(input.now.toFixed(2)) : input.lastLocomotionAtMs,
    activeLocomotionSource: activeLocomotionSourceFor({ keyboardActive, xrActive }),
    inputSourceCount: xrLocomotion.inputSources.length,
    inputSourceKinds: runtimeInputSourceKinds({
      keyboardActive,
      xrGamepadPresent: xrActive || xrLocomotion.inputSources.some((source) => source.hasGamepad),
      xrHandPresent: input.handModelCount > 0 || xrLocomotion.inputSources.some((source) => source.hasHand),
    }),
    keyboardVector,
    xrVector,
    xrInputSources: xrLocomotion.inputSources,
    rigPosition: {
      x: Number(input.locomotionRig.position.x.toFixed(3)),
      z: Number(input.locomotionRig.position.z.toFixed(3)),
    },
  };
}

function readXrGamepadLocomotion(session: XrSession | undefined): {
  forward: number;
  strafe: number;
  turn: number;
  handInputsObserved: number;
  inputSources: XrInputSourceEvidence[];
} {
  let forward = 0;
  let strafe = 0;
  let turn = 0;
  let handInputsObserved = 0;
  const inputSources: XrInputSourceEvidence[] = [];

  for (const source of session?.inputSources ?? []) {
    if (source.hand) {
      handInputsObserved += 1;
    }
    const axes = source.gamepad?.axes ?? [];
    inputSources.push({
      handedness: source.handedness ?? "none",
      hasHand: Boolean(source.hand),
      hasGamepad: Boolean(source.gamepad),
      axisCount: axes.length,
    });
    const xAxis = deadzone(axes[2] ?? axes[0] ?? 0);
    const yAxis = deadzone(axes[3] ?? axes[1] ?? 0);
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
  };
}

function roundedVector(vector: LocomotionVectorEvidence): LocomotionVectorEvidence {
  return {
    forward: Number(clampUnit(vector.forward).toFixed(3)),
    strafe: Number(clampUnit(vector.strafe).toFixed(3)),
    turn: Number(clampUnit(vector.turn).toFixed(3)),
  };
}

function isLocomotionVectorActive(vector: LocomotionVectorEvidence): boolean {
  return Math.abs(vector.forward) > 0 || Math.abs(vector.strafe) > 0 || Math.abs(vector.turn) > 0;
}

function activeLocomotionSourceFor(input: {
  keyboardActive: boolean;
  xrActive: boolean;
}): OpenClinXrInputEvidence["activeLocomotionSource"] {
  if (input.keyboardActive && input.xrActive) {
    return "mixed";
  }
  if (input.keyboardActive) {
    return "keyboard";
  }
  if (input.xrActive) {
    return "xr_gamepad";
  }
  return "none";
}

function runtimeInputSourceKinds(input: {
  keyboardActive: boolean;
  xrGamepadPresent: boolean;
  xrHandPresent: boolean;
}): RuntimeInputSourceKind[] {
  return [
    input.keyboardActive ? "keyboard" : undefined,
    input.xrGamepadPresent ? "xr_gamepad" : undefined,
    input.xrHandPresent ? "xr_hand" : undefined,
  ].filter((kind): kind is RuntimeInputSourceKind => kind !== undefined);
}

function deadzone(value: number): number {
  return Math.abs(value) < 0.18 ? 0 : clampUnit(value);
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
let lastFrameAtMs: number | undefined;

function recordFrame(now: number, input: {
  qualitySource: IwsdkSidecarFrameQualitySource;
  isPresenting: boolean;
  visibilityState: string;
}): void {
  if (lastFrameAtMs !== undefined) {
    frameDeltasMs.push(now - lastFrameAtMs);
    if (frameDeltasMs.length > 180) {
      frameDeltasMs.shift();
    }
  }
  lastFrameAtMs = now;
  framesObserved += 1;
  if (input.isPresenting) {
    immersiveFramesObserved += 1;
  } else {
    previewFramesObserved += 1;
  }
  window.__openClinXrFrameStats = buildIwsdkSidecarFrameStats({
    frameDeltasMs,
    framesObserved,
    latestFrameAtMs: Number(now.toFixed(2)),
    previewFramesObserved,
    immersiveFramesObserved,
    qualitySource: input.qualitySource,
    isPresenting: input.isPresenting,
    visibilityState: input.visibilityState,
  });
}

const start = performance.now();
function tick(): void {
  state = { ...state, elapsedSecond: Math.floor((performance.now() - start) / 1000) };
  clock.textContent = formatIwsdkSidecarClock(state.elapsedSecond);
  requestAnimationFrame(tick);
}

recordBootPhase("controls_start");
renderControls();
updateReadiness();
recordBootPhase("controls_ready");
void updateXrStatus();
let stationScene: StationSceneRuntime | undefined;
try {
  stationScene = createStationScene();
  recordBootPhase("station_scene_ready");
  if (hasIwerAutoEnterVrProbe(window.location.search)) {
    window.setTimeout(() => {
      if (stationScene) {
        void stationScene.startFullVrSession({ entrySource: "iwer_auto_entry_probe" });
      }
    }, 250);
  }
} catch (error) {
  recordBootPhase("station_scene_failed", error);
  xrStatus.textContent = "Station boot blocked";
}
enterXrButton.addEventListener("click", () => {
  if (!stationScene) {
    xrStatus.textContent = "Station boot blocked";
    return;
  }
  void stationScene.startFullVrSession();
});
enterMrButton.addEventListener("click", () => {
  if (!stationScene) {
    mrStatus.textContent = "Station boot blocked";
    return;
  }
  void stationScene.startMixedRealitySession();
});
tick();
recordBootPhase("clock_started");
