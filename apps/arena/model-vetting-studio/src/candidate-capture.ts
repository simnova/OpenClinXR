import {
  AmbientLight,
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ModelVettingStudioEvidence } from "./studio-state.js";

export type FixedCameraView = "front" | "side" | "three_quarter";
export type TemporalCaptureView = "turntable" | "viseme_timeline" | "emotion_transition";
export type CandidateCaptureView = FixedCameraView | TemporalCaptureView;

export type ModelVettingCandidateCaptureEvidence = {
  source: "window.__openClinXrModelVettingCandidateCaptureEvidence";
  candidateId: string;
  actorId: string;
  captureView: CandidateCaptureView;
  fixedCameraView: FixedCameraView | null;
  sourceGlbPath: string;
  meshCount: number;
  animationEvidence: {
    animationCount: number;
    animationNames: string[];
    totalChannelCount: number;
    mpfb2EyeLookProbePresent: boolean;
    runtimeImportEvidenceOnly: true;
  };
  normalizedBoundsMeters: {
    width: number;
    height: number;
    depth: number;
  };
  captureClaim:
    | "isolated_model_fixed_camera_screenshot_only"
    | "isolated_model_turntable_video_only"
    | "isolated_model_viseme_timeline_video_only"
    | "isolated_model_emotion_transition_video_only";
  materialEvidenceMode: "source_candidate_materials" | "neutral_inspection_material";
  deterministicTemporalCue: {
    enabled: boolean;
    cue: TemporalCaptureView | null;
    durationMs: number;
    degrees: number;
  };
  scenePlacementEvidenceAllowed: false;
  questReadinessClaimAllowed: false;
  productionReadinessClaimAllowed: false;
  learnerReadinessClaimAllowed: false;
  clinicalValidityClaimAllowed: false;
  scoringValidityClaimAllowed: false;
  notEvidenceFor: ModelVettingStudioEvidence["notEvidenceFor"];
};

export type ModelVettingDualCandidateCaptureEvidence = {
  source: "window.__openClinXrModelVettingDualCaptureEvidence";
  leftCandidateId: string;
  rightCandidateId: string;
  leftSourceGlbPath: string;
  rightSourceGlbPath: string;
  captureView: FixedCameraView;
  leftMeshCount: number;
  rightMeshCount: number;
  captureClaim: "isolated_dual_humanoid_source_side_by_side_screenshot_only";
  materialEvidenceMode: "source_candidate_materials";
  scenePlacementEvidenceAllowed: false;
  questReadinessClaimAllowed: false;
  productionReadinessClaimAllowed: false;
  learnerReadinessClaimAllowed: false;
  clinicalValidityClaimAllowed: false;
  scoringValidityClaimAllowed: false;
  notEvidenceFor: ModelVettingStudioEvidence["notEvidenceFor"];
};

export async function renderCandidateCapture(input: {
  mount: HTMLElement;
  evidence: ModelVettingStudioEvidence;
  candidateId: string;
  view: CandidateCaptureView;
}): Promise<ModelVettingCandidateCaptureEvidence> {
  const candidate = input.evidence.candidates.find((item) => item.candidateId === input.candidateId);
  if (!candidate) throw new Error(`Unknown candidateId ${input.candidateId}`);
  const stage = document.createElement("section");
  stage.className = "candidate-capture-stage";
  stage.setAttribute("aria-label", `${candidate.actorDisplayRole} ${input.view} capture`);
  const canvas = document.createElement("canvas");
  canvas.id = "model-vetting-candidate-capture-canvas";
  const badge = document.createElement("div");
  badge.className = "candidate-capture-badge";
  badge.textContent = `${candidate.actorDisplayRole} · ${input.view.replaceAll("_", " ")} · isolated model capture`;
  stage.append(canvas, badge);
  input.mount.replaceChildren(stage);

  const renderer = new WebGLRenderer({ antialias: true, canvas, preserveDrawingBuffer: true });
  const width = 1280;
  const height = 1280;
  renderer.setSize(width, height, false);
  renderer.setClearColor(new Color("#18211d"));

  const scene = new Scene();
  scene.background = new Color("#18211d");
  scene.add(new AmbientLight("#dceee6", 1.5));
  const keyLight = new DirectionalLight("#ffffff", 2.4);
  keyLight.position.set(3, 5, 4);
  scene.add(keyLight);
  const fillLight = new DirectionalLight("#b6d8ca", 1.2);
  fillLight.position.set(-4, 3, -2);
  scene.add(fillLight);
  const grid = new GridHelper(4, 16, "#80c7ad", "#31483f");
  scene.add(grid);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const glbUrl = glbUrlForPath(candidate.sourceGlbPath);
  const gltf = await loader.loadAsync(glbUrl);
  const model = gltf.scene;
  const animationEvidence = buildAnimationEvidence(gltf.animations);
  let meshCount = 0;
  const inspectionMaterial = new MeshBasicMaterial({ color: "#cde7dc" });
  const useSourceMaterials = input.view !== "emotion_transition";
  const visemeCue = new Mesh(
    new BoxGeometry(0.42, 0.035, 0.035),
    new MeshBasicMaterial({ color: "#17221e" }),
  );
  visemeCue.position.set(0, 1.48, 0.74);
  visemeCue.visible = input.view === "viseme_timeline";
  scene.add(visemeCue);
  model.updateMatrixWorld(true);
  const captureModel = new Group();
  model.traverse((object) => {
    if (object instanceof Mesh) {
      meshCount += 1;
      const mesh = new Mesh(object.geometry, useSourceMaterials ? object.material : inspectionMaterial);
      mesh.name = `${object.name || "mesh"}_inspection_clone`;
      mesh.frustumCulled = false;
      mesh.applyMatrix4(object.matrixWorld);
      captureModel.add(mesh);
    }
  });
  scene.add(captureModel);
  captureModel.updateMatrixWorld(true);
  const initialBounds = computeBaseMeshBounds(captureModel);
  const initialSize = initialBounds.getSize(new Vector3());
  const targetHeightMeters = 2.2;
  const scale = targetHeightMeters / Math.max(initialSize.y, 0.001);
  captureModel.scale.setScalar(scale);
  captureModel.updateMatrixWorld(true);
  const bounds = computeBaseMeshBounds(captureModel);
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  captureModel.position.set(-center.x, -bounds.min.y, -center.z);
  captureModel.updateMatrixWorld(true);

  const camera = new PerspectiveCamera(35, width / height, 0.01, 100);
  camera.position.copy(cameraPosition(input.view));
  camera.lookAt(0, 0.9, 0);
  if (isTemporalCaptureView(input.view)) {
    const start = performance.now();
    const durationMs = 3000;
    const animate = (now: number) => {
      const progress = ((now - start) % durationMs) / durationMs;
      if (input.view === "turntable") {
        captureModel.rotation.y = progress * Math.PI * 2;
      }
      if (input.view === "viseme_timeline") {
        visemeCue.scale.x = 0.45 + Math.abs(Math.sin(progress * Math.PI * 8)) * 1.35;
      }
      if (input.view === "emotion_transition") {
        inspectionMaterial.color.lerpColors(new Color("#cde7dc"), new Color("#f0c5b2"), progress);
      }
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  } else {
    renderer.render(scene, camera);
  }

  return {
    source: "window.__openClinXrModelVettingCandidateCaptureEvidence",
    candidateId: candidate.candidateId,
    actorId: candidate.actorId,
    captureView: input.view,
    fixedCameraView: isFixedCameraView(input.view) ? input.view : null,
    sourceGlbPath: candidate.sourceGlbPath,
    meshCount,
    animationEvidence,
    normalizedBoundsMeters: {
      width: roundMeters(size.x),
      height: roundMeters(size.y),
      depth: roundMeters(size.z),
    },
    captureClaim: captureClaimForView(input.view),
    materialEvidenceMode: useSourceMaterials ? "source_candidate_materials" : "neutral_inspection_material",
    deterministicTemporalCue: {
      enabled: isTemporalCaptureView(input.view),
      cue: isTemporalCaptureView(input.view) ? input.view : null,
      durationMs: isTemporalCaptureView(input.view) ? 3000 : 0,
      degrees: input.view === "turntable" ? 360 : 0,
    },
    scenePlacementEvidenceAllowed: false,
    questReadinessClaimAllowed: false,
    productionReadinessClaimAllowed: false,
    learnerReadinessClaimAllowed: false,
    clinicalValidityClaimAllowed: false,
    scoringValidityClaimAllowed: false,
    notEvidenceFor: input.evidence.notEvidenceFor,
  };
}

export async function renderDualCandidateCapture(input: {
  mount: HTMLElement;
  evidence: ModelVettingStudioEvidence;
  leftCandidateId: string;
  rightCandidateId: string;
  view: FixedCameraView;
}): Promise<ModelVettingDualCandidateCaptureEvidence> {
  const leftCandidate = input.evidence.candidates.find((item) => item.candidateId === input.leftCandidateId);
  const rightCandidate = input.evidence.candidates.find((item) => item.candidateId === input.rightCandidateId);
  if (!leftCandidate) throw new Error(`Unknown leftCandidateId ${input.leftCandidateId}`);
  if (!rightCandidate) throw new Error(`Unknown rightCandidateId ${input.rightCandidateId}`);
  if (!isFixedCameraView(input.view)) throw new Error(`Dual compare capture requires a fixed camera view, got ${input.view}`);

  const stage = document.createElement("section");
  stage.className = "candidate-capture-stage dual-compare";
  stage.setAttribute("aria-label", `${leftCandidate.actorDisplayRole} vs ${rightCandidate.actorDisplayRole} ${input.view} capture`);
  const canvas = document.createElement("canvas");
  canvas.id = "model-vetting-dual-capture-canvas";
  const badge = document.createElement("div");
  badge.className = "candidate-capture-badge";
  badge.textContent = `${leftCandidate.actorDisplayRole} vs ${rightCandidate.actorDisplayRole} · ${input.view.replaceAll("_", " ")} · side-by-side`;
  stage.append(canvas, badge);
  input.mount.replaceChildren(stage);

  const renderer = new WebGLRenderer({ antialias: true, canvas, preserveDrawingBuffer: true });
  const width = 1280;
  const height = 1280;
  renderer.setSize(width, height, false);
  renderer.setClearColor(new Color("#18211d"));

  const scene = new Scene();
  scene.background = new Color("#18211d");
  scene.add(new AmbientLight("#dceee6", 1.5));
  const keyLight = new DirectionalLight("#ffffff", 2.4);
  keyLight.position.set(3, 5, 4);
  scene.add(keyLight);
  const fillLight = new DirectionalLight("#b6d8ca", 1.2);
  fillLight.position.set(-4, 3, -2);
  scene.add(fillLight);
  const grid = new GridHelper(6, 20, "#80c7ad", "#31483f");
  scene.add(grid);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [leftGltf, rightGltf] = await Promise.all([
    loader.loadAsync(glbUrlForPath(leftCandidate.sourceGlbPath)),
    loader.loadAsync(glbUrlForPath(rightCandidate.sourceGlbPath)),
  ]);

  const leftCounts = await addScaledCaptureModel(scene, leftGltf.scene, -1.05);
  const rightCounts = await addScaledCaptureModel(scene, rightGltf.scene, 1.05);

  const camera = new PerspectiveCamera(35, width / height, 0.01, 100);
  camera.position.copy(cameraPosition(input.view));
  camera.lookAt(0, 0.9, 0);
  renderer.render(scene, camera);

  return {
    source: "window.__openClinXrModelVettingDualCaptureEvidence",
    leftCandidateId: leftCandidate.candidateId,
    rightCandidateId: rightCandidate.candidateId,
    leftSourceGlbPath: leftCandidate.sourceGlbPath,
    rightSourceGlbPath: rightCandidate.sourceGlbPath,
    captureView: input.view,
    leftMeshCount: leftCounts.meshCount,
    rightMeshCount: rightCounts.meshCount,
    captureClaim: "isolated_dual_humanoid_source_side_by_side_screenshot_only",
    materialEvidenceMode: "source_candidate_materials",
    scenePlacementEvidenceAllowed: false,
    questReadinessClaimAllowed: false,
    productionReadinessClaimAllowed: false,
    learnerReadinessClaimAllowed: false,
    clinicalValidityClaimAllowed: false,
    scoringValidityClaimAllowed: false,
    notEvidenceFor: input.evidence.notEvidenceFor,
  };
}

async function addScaledCaptureModel(scene: Scene, model: Object3D, offsetX: number): Promise<{ meshCount: number }> {
  let meshCount = 0;
  const captureModel = new Group();
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (object instanceof Mesh) {
      meshCount += 1;
      const mesh = new Mesh(object.geometry, object.material);
      mesh.name = `${object.name || "mesh"}_dual_capture_clone`;
      mesh.frustumCulled = false;
      mesh.applyMatrix4(object.matrixWorld);
      captureModel.add(mesh);
    }
  });
  scene.add(captureModel);
  captureModel.updateMatrixWorld(true);
  const initialBounds = computeBaseMeshBounds(captureModel);
  const initialSize = initialBounds.getSize(new Vector3());
  const targetHeightMeters = 2.2;
  const scale = targetHeightMeters / Math.max(initialSize.y, 0.001);
  captureModel.scale.setScalar(scale);
  captureModel.updateMatrixWorld(true);
  const bounds = computeBaseMeshBounds(captureModel);
  const center = bounds.getCenter(new Vector3());
  captureModel.position.set(offsetX - center.x, -bounds.min.y, -center.z);
  captureModel.updateMatrixWorld(true);
  return { meshCount };
}

export function buildAnimationEvidence(animations: Array<{ name?: string; tracks?: unknown[] }>): ModelVettingCandidateCaptureEvidence["animationEvidence"] {
  const animationNames = animations.map((animation, index) => animation.name || `unnamed_animation_${index}`);
  return {
    animationCount: animations.length,
    animationNames,
    totalChannelCount: animations.reduce((total, animation) => total + (Array.isArray(animation.tracks) ? animation.tracks.length : 0), 0),
    mpfb2EyeLookProbePresent: animationNames.some((name) => name.startsWith("openclinxr_mpfb2_eye_look_probe")),
    runtimeImportEvidenceOnly: true,
  };
}

function roundMeters(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function computeBaseMeshBounds(model: Object3D): Box3 {
  const bounds = new Box3();
  const point = new Vector3();
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      bounds.expandByPoint(point);
    }
  });
  return bounds;
}

export function isFixedCameraView(value: string | null): value is FixedCameraView {
  return value === "front" || value === "side" || value === "three_quarter";
}

export function isCandidateCaptureView(value: string | null): value is CandidateCaptureView {
  return isFixedCameraView(value) || isTemporalCaptureView(value);
}

export function isTemporalCaptureView(value: string | null): value is TemporalCaptureView {
  return value === "turntable" || value === "viseme_timeline" || value === "emotion_transition";
}

function cameraPosition(view: CandidateCaptureView): Vector3 {
  if (view === "side") return new Vector3(4.8, 1.35, 0);
  if (view === "three_quarter") return new Vector3(3.6, 1.35, 3.6);
  return new Vector3(0, 1.35, 4.8);
}

export function glbUrlForPath(sourceGlbPath: string): string {
  const publicPathMarker = "apps/arena/model-vetting-studio/public/";
  if (sourceGlbPath.includes(publicPathMarker)) {
    return `/${sourceGlbPath.slice(sourceGlbPath.indexOf(publicPathMarker) + publicPathMarker.length)}`;
  }
  if (sourceGlbPath.startsWith("/cagematch/")) {
    return sourceGlbPath;
  }
  if (sourceGlbPath.endsWith("peds_anxious_parent.glb")) {
    return new URL("../../../ui-xr/public/generated-humanoids/peds_anxious_parent.glb", import.meta.url).href;
  }
  if (sourceGlbPath.endsWith("peds_nurse_kevin.glb")) {
    return new URL("../../../ui-xr/public/generated-humanoids/peds_nurse_kevin.glb", import.meta.url).href;
  }
  return new URL("../../../ui-xr/public/generated-humanoids/peds_patient_child.glb", import.meta.url).href;
}

function captureClaimForView(view: CandidateCaptureView): ModelVettingCandidateCaptureEvidence["captureClaim"] {
  if (view === "turntable") return "isolated_model_turntable_video_only";
  if (view === "viseme_timeline") return "isolated_model_viseme_timeline_video_only";
  if (view === "emotion_transition") return "isolated_model_emotion_transition_video_only";
  return "isolated_model_fixed_camera_screenshot_only";
}
