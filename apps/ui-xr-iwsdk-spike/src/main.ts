import * as IwsdkCore from "@iwsdk/core";
import * as IwsdkXrInput from "@iwsdk/xr-input";
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from "three";
import {
  buildIwsdkSidecarRuntimeEvidence,
  completeIwsdkSidecarTraceAction,
  createIwsdkSidecarRuntimeState,
  formatIwsdkSidecarClock,
  iwsdkSidecarSceneObjectNames,
  summarizeIwsdkSidecarReadiness,
  type IwsdkSidecarRuntimeEvidence,
  type IwsdkSidecarRuntimeState,
} from "./sidecar-state.js";
import "./styles.css";

type NavigatorWithXr = Navigator & {
  xr?: {
    isSessionSupported(mode: "immersive-vr"): Promise<boolean>;
  };
};

declare global {
  interface Window {
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
    return;
  }
  try {
    const supported = await navigatorWithXr.xr.isSessionSupported("immersive-vr");
    xrStatus.textContent = supported ? "WebXR ready" : "WebXR unavailable";
  } catch {
    xrStatus.textContent = "WebXR check blocked";
  }
}

function createStationScene(): void {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0d1715);

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

  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  function animate(): void {
    const now = performance.now();
    resize();
    patient.rotation.y = Math.sin(now / 1200) * 0.08;
    nurse.rotation.y = Math.sin(now / 900) * 0.12;
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();
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

const start = performance.now();
function tick(): void {
  state = { ...state, elapsedSecond: Math.floor((performance.now() - start) / 1000) };
  clock.textContent = formatIwsdkSidecarClock(state.elapsedSecond);
  requestAnimationFrame(tick);
}

renderControls();
updateReadiness();
void updateXrStatus();
createStationScene();
tick();
