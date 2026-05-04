import * as IwsdkCore from "@iwsdk/core";
import * as IwsdkXrInput from "@iwsdk/xr-input";
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
import {
  buildIwsdkSidecarRuntimeEvidence,
  completeIwsdkSidecarTraceAction,
  createIwsdkSidecarRuntimeState,
  formatIwsdkSidecarClock,
  iwsdkSidecarSceneObjectNames,
  summarizeIwsdkSidecarReadiness,
  summarizeIwsdkSidecarFrameDeltas,
  type IwsdkSidecarRuntimeEvidence,
  type IwsdkSidecarRuntimeState,
} from "./sidecar-state.js";
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
  addEventListener(type: "end", listener: () => void, options?: { once?: boolean }): void;
  end(): Promise<void>;
};

type StationSceneRuntime = {
  startImmersiveSession(): Promise<void>;
};

declare global {
  interface Window {
    __openClinXrFrameStats?: ReturnType<typeof summarizeIwsdkSidecarFrameDeltas> & {
      framesObserved: number;
      latestFrameAtMs: number | null;
      sampleWindowSize: number;
    };
    __openClinXrIwsdkSidecarEvidence?: IwsdkSidecarRuntimeEvidence;
    __openClinXrIwsdkSidecarTraceTags?: string[];
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

let state: IwsdkSidecarRuntimeState = createIwsdkSidecarRuntimeState();
const iwsdkCoreExportCount = Object.keys(IwsdkCore).length;
const iwsdkXrInputExportCount = Object.keys(IwsdkXrInput).length;

app.innerHTML = `
  <main class="spike-shell">
    <section class="spike-stage" aria-label="IWSDK emergency department station scene">
      <canvas id="iwsdk-sidecar-canvas" aria-label="IWSDK ED chest pain bay preview"></canvas>
      <div class="status-strip">
        <span id="xr-status">WebXR checking</span>
        <span id="iwsdk-status">IWSDK runtime linked</span>
        <span id="trace-summary">Trace 0/${state.requiredTraceTags.length}</span>
        <button id="enter-xr-button" class="xr-entry-button" type="button" disabled>Enter VR</button>
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
          <div><dt>Core exports</dt><dd id="core-export-count">${iwsdkCoreExportCount}</dd></div>
          <div><dt>XR input exports</dt><dd id="input-export-count">${iwsdkXrInputExportCount}</dd></div>
          <div><dt>Scene objects</dt><dd>${iwsdkSidecarSceneObjectNames.length} parity targets</dd></div>
        </dl>
      </section>
      <section class="dialogue-panel" aria-label="Mock dialogue">
        <h2>Mock Dialogue</h2>
        <p id="dialogue-line">Robert Hayes: The pressure is heavy and I feel sweaty.</p>
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
const iwsdkStatus = requireElement<HTMLElement>("#iwsdk-status");
const dialogueLine = requireElement<HTMLElement>("#dialogue-line");
const enterXrButton = requireElement<HTMLButtonElement>("#enter-xr-button");

window.__openClinXrIwsdkSidecarEvidence = buildIwsdkSidecarRuntimeEvidence({
  iwsdkCoreExportCount,
  iwsdkXrInputExportCount,
});
window.__openClinXrIwsdkSidecarTraceTags = [];
iwsdkStatus.textContent = `IWSDK exports ${iwsdkCoreExportCount}/${iwsdkXrInputExportCount}`;

function renderControls(): void {
  traceActions.innerHTML = "";
  for (const tag of state.requiredTraceTags) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.traceTag = tag;
    button.textContent = tag.replaceAll("_", " ");
    button.className = state.completedTraceTags.includes(tag) ? "trace-button complete" : "trace-button";
    button.addEventListener("click", () => {
      state = completeIwsdkSidecarTraceAction(state, tag);
      window.__openClinXrIwsdkSidecarTraceTags = [...state.completedTraceTags];
      dialogueLine.textContent = dialogueFor(tag);
      renderControls();
      updateReadiness();
    });
    traceActions.append(button);
  }
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
    return;
  }
  try {
    const supported = await navigatorWithXr.xr.isSessionSupported("immersive-vr");
    xrStatus.textContent = supported ? "WebXR ready" : "WebXR unavailable";
    enterXrButton.disabled = !supported;
  } catch {
    xrStatus.textContent = "WebXR check blocked";
    enterXrButton.disabled = true;
  }
}

function createStationScene(): StationSceneRuntime {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0d1715);
  let activeXrSession: XrSession | undefined;

  const scene = new Scene();
  scene.name = iwsdkSidecarSceneObjectNames[0] ?? "openclinxr.iwsdk.station-root";
  scene.background = new Color(0x0d1715);

  const camera = new PerspectiveCamera(52, 1, 0.1, 100);
  camera.position.set(0, 1.7, 5.2);
  camera.lookAt(0, 1.1, 0);

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
  scene.add(createClinicalPanel());
  addControllerRays(renderer, scene);

  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  function animate(): void {
    const now = performance.now();
    recordFrame(now);
    resize();
    patient.rotation.y = Math.sin(now / 1200) * 0.08;
    nurse.rotation.y = Math.sin(now / 900) * 0.12;
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(animate);

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
      xrStatus.textContent = "Entering VR";
      try {
        const session = await navigatorWithXr.xr.requestSession("immersive-vr", {
          optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
        });
        activeXrSession = session;
        session.addEventListener("end", () => {
          activeXrSession = undefined;
          enterXrButton.disabled = false;
          enterXrButton.textContent = "Enter VR";
          xrStatus.textContent = "WebXR ready";
        }, { once: true });
        await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Exit VR";
        xrStatus.textContent = "In VR";
      } catch {
        activeXrSession = undefined;
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Enter VR";
        xrStatus.textContent = "WebXR entry blocked";
      }
    },
  };
}

function createClinicalPanel(): Mesh {
  const panelCanvas = document.createElement("canvas");
  panelCanvas.width = 1024;
  panelCanvas.height = 512;
  const context = panelCanvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create clinical panel canvas context");
  }
  context.fillStyle = "#f3fbf7";
  context.fillRect(0, 0, panelCanvas.width, panelCanvas.height);
  context.fillStyle = "#143129";
  context.font = "700 54px Arial";
  context.fillText("Simulated EHR", 48, 78);
  context.font = "36px Arial";
  const lines = [
    "Chief concern: crushing substernal pressure",
    "Vitals: BP 152/92  HR 104  RR 20  SpO2 96%",
    "Actors: patient, nurse, spouse",
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
      new LineBasicMaterial({ color: 0x8bd8bf }),
    );
    ray.name = `openclinxr.ed-chest-pain.controller-ray-${index + 1}`;
    controller.add(ray);
    scene.add(controller);
  }
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
    ...summarizeIwsdkSidecarFrameDeltas(frameDeltasMs),
    framesObserved,
    latestFrameAtMs: Number(now.toFixed(2)),
    sampleWindowSize: frameDeltasMs.length,
  };
}

const start = performance.now();
function tick(): void {
  state = { ...state, elapsedSecond: Math.floor((performance.now() - start) / 1000) };
  clock.textContent = formatIwsdkSidecarClock(state.elapsedSecond);
  requestAnimationFrame(tick);
}

renderControls();
updateReadiness();
void updateXrStatus();
const stationScene = createStationScene();
enterXrButton.addEventListener("click", () => {
  void stationScene.startImmersiveSession();
});
tick();
