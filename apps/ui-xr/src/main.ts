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
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import {
  actorIdForTraceTag,
  actorResponseTextFromApiResult,
  buildManualPerformanceDraft,
  completeTraceAction,
  createInitialRuntimeState,
  eventTypeForTraceTag,
  formatStationClock,
  iwsdkStationSceneObjects,
  remoteActorTurnForTraceTag,
  stationTraceActionTags,
  summarizeFrameDeltas,
  summarizeTraceReadiness,
  type ManualPerformanceDraft,
  type ManualPerformanceInputEvidence,
  type ManualPerformanceTraceLatencyEvidence,
  type XrExperienceModeEvidence,
  type XrRuntimeState,
  xrExperienceModeEvidence,
} from "./runtime-state.js";
import { createStationApiClient, type StationApiClient } from "./api-client.js";
import "./styles.css";

type NavigatorWithXr = Navigator & {
  xr?: {
    isSessionSupported(mode: "immersive-vr"): Promise<boolean>;
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

type XrInputSourceWithGamepad = {
  handedness?: "left" | "right" | "none" | string;
  hand?: unknown;
  gamepad?: {
    axes?: readonly number[];
  };
};

type OpenClinXrFrameStats = ReturnType<typeof summarizeFrameDeltas> & {
  framesObserved: number;
  latestFrameAtMs: number | null;
  sampleWindowSize: number;
};

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

type StationSceneRuntime = {
  startImmersiveSession(): Promise<void>;
};

declare global {
  interface Window {
    __openClinXrFrameStats?: OpenClinXrFrameStats;
    __openClinXrManualPerformanceDraft?: ManualPerformanceDraft;
    __openClinXrExperienceModeEvidence?: XrExperienceModeEvidence;
    __openClinXrInputEvidence?: OpenClinXrInputEvidence;
    __openClinXrBootEvidence?: OpenClinXrBootEvidence;
    __openClinXrTraceLatencyEvidence?: OpenClinXrTraceLatencyEvidence;
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

let state: XrRuntimeState = createInitialRuntimeState();
const configuredApiBaseUrl = typeof import.meta.env.VITE_OPENCLINXR_API_BASE_URL === "string" ? import.meta.env.VITE_OPENCLINXR_API_BASE_URL : "";
const stationApi = configuredApiBaseUrl ? createStationApiClient({ baseUrl: configuredApiBaseUrl }) : undefined;
let remoteStationRunId: string | undefined;
let immersiveSessionActive = false;
let lastTraceSelectLatencyMs: number | null = null;

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
        <p id="dialogue-line">Robert Hayes: It feels heavy, like someone is sitting on my chest.</p>
      </section>
      <section class="trace-panel" aria-label="Trace controls">
        <h2>Trace Actions</h2>
        <div id="trace-actions" class="trace-actions"></div>
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
window.__openClinXrExperienceModeEvidence = xrExperienceModeEvidence;

function renderControls(): void {
  traceActions.innerHTML = "";
  for (const tag of stationTraceActionTags) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag.replaceAll("_", " ");
    button.className = state.completedTraceTags.includes(tag) ? "trace-button complete" : "trace-button";
    button.addEventListener("click", () => {
      const traceSelectStartedAtMs = performance.now();
      state = completeTraceAction(state, tag);
      dialogueLine.textContent = dialogueFor(tag);
      renderControls();
      updateReadiness();
      recordTraceSelectLatency(traceSelectStartedAtMs, tag);
      void recordRemoteTraceAction(tag);
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
    xrStatus.textContent = "WebXR unavailable";
    enterXrButton.disabled = true;
    return;
  }
  try {
    const supported = await navigatorWithXr.xr.isSessionSupported("immersive-vr");
    xrStatus.textContent = supported ? "Full VR ready" : "WebXR unavailable";
    enterXrButton.disabled = !supported;
  } catch {
    xrStatus.textContent = "WebXR check blocked";
    enterXrButton.disabled = true;
  }
}

function createStationScene(): StationSceneRuntime {
  recordBootPhase("station_scene_start");
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x101820);
  let activeXrSession: XrSession | undefined;
  let lastLocomotionAtMs: number | null = null;
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
  clockMesh.position.set(0.9, 2.2, -1.2);
  scene.add(clockMesh);
  scene.add(createClinicalPanel());
  addControllerRays(renderer, scene);
  const keyboardLocomotion = createKeyboardLocomotion();
  let handModelStatus: OpenClinXrInputEvidence["handModelStatus"] = "pending_immersive_session";
  let handModelsInstalled = false;

  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  function animate(timestamp?: number): void {
    const now = typeof timestamp === "number" ? timestamp : performance.now();
    lastRenderLoopAtMs = now;
    const deltaSeconds = Math.min((now - lastAnimateAtMs) / 1000, 0.05);
    lastAnimateAtMs = now;
    resize();
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
    recordFrame(now);
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
        return;
      }

      enterXrButton.disabled = true;
      xrStatus.textContent = "Entering Full VR";
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
        }, { once: true });
        await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
        installHandModelsOnce();
        immersiveSessionActive = true;
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Exit Full VR";
        xrStatus.textContent = "In Full VR";
      } catch {
        activeXrSession = undefined;
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Enter Full VR";
        xrStatus.textContent = "WebXR entry blocked";
      }
    },
  };

  function fallbackAnimationLoop(): void {
    const now = performance.now();
    if (now - lastRenderLoopAtMs > flatPreviewFallbackFrameMs) {
      animate(now);
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
}

function createClinicalPanel(): Mesh {
  const panelCanvas = document.createElement("canvas");
  panelCanvas.width = 1024;
  panelCanvas.height = 512;
  const context = panelCanvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create clinical panel canvas context");
  }
  context.fillStyle = "#fff8e5";
  context.fillRect(0, 0, panelCanvas.width, panelCanvas.height);
  context.fillStyle = "#172332";
  context.font = "700 54px Arial";
  context.fillText("Simulated EHR", 48, 78);
  context.font = "36px Arial";
  const lines = [
    "Chief concern: crushing substernal pressure",
    "Vitals: BP 152/92  HR 104  RR 20  SpO2 96%",
    "Interruption: nurse repeats vitals at minute seven",
    "Priority: obtain ECG and escalate urgently",
  ];
  lines.forEach((line, index) => context.fillText(line, 48, 150 + index * 70));
  const texture = new CanvasTexture(panelCanvas);
  const panel = new Mesh(
    new PlaneGeometry(2.15, 1.08),
    new MeshBasicMaterial({ map: texture, side: DoubleSide }),
  );
  panel.name = "openclinxr.ed-chest-pain.in-vr-clinical-panel";
  panel.position.set(-1.55, 1.55, -1.05);
  panel.rotation.y = 0.42;
  return panel;
}

function addControllerRays(renderer: WebGLRenderer, scene: Scene): void {
  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    controller.name = `openclinxr.ed-chest-pain.controller-${index + 1}`;
    const ray = new Line(
      new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, -3)]),
      new LineBasicMaterial({ color: 0xd9c493 }),
    );
    ray.name = `openclinxr.ed-chest-pain.controller-ray-${index + 1}`;
    controller.add(ray);
    scene.add(controller);
  }
}

function addHandModels(renderer: WebGLRenderer, scene: Scene): void {
  const handModelFactory = new XRHandModelFactory();
  for (let index = 0; index < 2; index += 1) {
    const hand = renderer.xr.getHand(index);
    hand.name = `openclinxr.ed-chest-pain.hand-${index + 1}`;
    const handModel = handModelFactory.createHandModel(hand, "boxes");
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
  const forward = clampUnit(input.keyboardLocomotion.forward + xrLocomotion.forward);
  const strafe = clampUnit(input.keyboardLocomotion.strafe + xrLocomotion.strafe);
  const turn = clampUnit(input.keyboardLocomotion.turn + xrLocomotion.turn);
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
} {
  let forward = 0;
  let strafe = 0;
  let turn = 0;
  let handInputsObserved = 0;

  for (const source of session?.inputSources ?? []) {
    if (source.hand) {
      handInputsObserved += 1;
    }
    const axes = source.gamepad?.axes ?? [];
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
  };
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
let lastFrameAtMs: number | undefined;

function recordFrame(now: number): void {
  if (lastFrameAtMs !== undefined) {
    frameDeltasMs.push(now - lastFrameAtMs);
    if (frameDeltasMs.length > 180) {
      frameDeltasMs.shift();
    }
  }
  lastFrameAtMs = now;
  framesObserved += 1;
  window.__openClinXrFrameStats = {
    ...summarizeFrameDeltas(frameDeltasMs),
    framesObserved,
    latestFrameAtMs: Number(now.toFixed(2)),
    sampleWindowSize: frameDeltasMs.length,
  };
  if (framesObserved !== 1 && framesObserved % 30 !== 0) {
    return;
  }
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
    immersiveSessionStarted: immersiveSessionActive,
  });
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
recordBootPhase("controls_ready");
void initializeRemoteTraceSession(stationApi);
void updateXrStatus();
let stationScene: StationSceneRuntime | undefined;
try {
  stationScene = createStationScene();
  recordBootPhase("station_scene_ready");
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
