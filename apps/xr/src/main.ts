import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import * as THREE from "three";
import {
  completeTraceAction,
  createInitialRuntimeState,
  formatStationClock,
  summarizeTraceReadiness,
  type XrRuntimeState,
} from "./runtime-state.js";
import "./styles.css";

type NavigatorWithXr = Navigator & {
  xr?: {
    isSessionSupported(mode: "immersive-vr"): Promise<boolean>;
  };
};

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

let state: XrRuntimeState = createInitialRuntimeState();
const visibleTraceTags = ["history_opqrst", "vitals_review", "ecg_request", "urgent_escalation", "team_communication", "patient_note_submitted"];

app.innerHTML = `
  <main class="station-shell">
    <section class="stage" aria-label="Emergency department station scene">
      <canvas id="station-canvas" aria-label="3D emergency department bay preview"></canvas>
      <div class="status-strip">
        <span id="xr-status">WebXR checking</span>
        <span id="trace-summary">Trace 0/${edChestPainScenario.requiredTraceTags.length}</span>
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

function renderControls(): void {
  traceActions.innerHTML = "";
  for (const tag of visibleTraceTags) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag.replaceAll("_", " ");
    button.className = state.completedTraceTags.includes(tag) ? "trace-button complete" : "trace-button";
    button.addEventListener("click", () => {
      state = completeTraceAction(state, tag);
      dialogueLine.textContent = dialogueFor(tag);
      renderControls();
      updateReadiness();
    });
    traceActions.append(button);
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x101820);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
  camera.position.set(0, 1.7, 5.2);
  camera.lookAt(0, 1.1, 0);

  const ambient = new THREE.HemisphereLight(0xf4f0dc, 0x223042, 2.2);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(3, 5, 4);
  scene.add(key);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(7, 0.08, 5), new THREE.MeshStandardMaterial({ color: 0x55606b, roughness: 0.8 }));
  floor.position.y = -0.04;
  scene.add(floor);

  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 1.05), new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.65 }));
  bed.position.set(-0.4, 0.55, 0);
  scene.add(bed);

  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.08), new THREE.MeshStandardMaterial({ color: 0x203040, emissive: 0x0b3d2e }));
  monitor.position.set(1.7, 1.45, -0.65);
  scene.add(monitor);

  const patient = actorMesh(0x8fb9aa);
  patient.position.set(-0.6, 1.0, 0.05);
  patient.scale.set(1.1, 1.1, 1.1);
  scene.add(patient);

  const nurse = actorMesh(0x5a9bd5);
  nurse.position.set(1.45, 0.95, 0.55);
  scene.add(nurse);

  const spouse = actorMesh(0xd5a75a);
  spouse.position.set(-2.0, 0.95, 0.7);
  scene.add(spouse);

  const clockMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 48), new THREE.MeshStandardMaterial({ color: 0xf3e8c9 }));
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
    resize();
    patient.rotation.y = Math.sin(performance.now() / 1200) * 0.08;
    nurse.rotation.y = Math.sin(performance.now() / 900) * 0.12;
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();
}

function actorMesh(color: number): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 8, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  body.position.y = 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), new THREE.MeshStandardMaterial({ color: 0xcaa889, roughness: 0.75 }));
  head.position.y = 1.15;
  group.add(body, head);
  return group;
}

let start = performance.now();
function tick(): void {
  state = { ...state, elapsedSecond: Math.floor((performance.now() - start) / 1000) };
  clock.textContent = formatStationClock(state.elapsedSecond);
  requestAnimationFrame(tick);
}

start = performance.now();
renderControls();
updateReadiness();
void updateXrStatus();
createStationScene();
tick();
