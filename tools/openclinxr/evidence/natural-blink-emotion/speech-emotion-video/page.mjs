// Browser page for the speech/emotion/blink video harness (bundled with esbuild).
// Drives the REAL animation package: updateGeneratedHumanoidAnimations,
// startHumanoidEmotionTransition, createHumanoidEmotionExpressionState,
// attachBakedCuesToSpeech, applyGeneratedHumanoidClinicalIdlePosture.
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Line,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createHumanoidEmotionExpressionState,
  startHumanoidEmotionTransition,
  updateGeneratedHumanoidAnimations,
} from "../../../../../packages/openclinxr/xr-humanoid-animation/src/index.ts";
import { attachBakedCuesToSpeech } from "../../../../../packages/openclinxr/xr-dialogue/src/index.ts";
import { applyGeneratedHumanoidClinicalIdlePosture } from "../../../../../packages/openclinxr/xr-pose/src/clinical-idle-posture.ts";

const ACTOR_ID = "nurse_maria_alvarez_v1";
const SCENARIO_ID = "ed_chest_pain_priority_v1";

let renderer = null;
let scene = null;
let camera = null;
let slot = null;
let ctx = null;
let currentShot = "closeup";
let framing = null;
let eyeBones = null;
let closureEntries = [];
let firedKeys = new Set();
let canvasWidth = 1280;
let canvasHeight = 720;

function makeContext(slots) {
  return {
    slots,
    slotsByActorId: new Map(slots.map((s) => [s.actorId, s])),
    actorSlotsByActorId: new Map(slots.map((s) => [s.actorId, s.actorSlot])),
    virtualDeviceSlotsByActorId: new Map(),
    activeVirtualDeviceSpeechByActorId: new Map(),
    runtimePatientActorId: () => "patient",
    runtimeFamilyActorId: () => "family",
    runtimeClinicalTeamActorId: () => "nurse",
    runtimeActorRole: () => undefined,
    isPediatricAsthmaRuntimeScenario: () => false,
    shouldUseCleanHumanoidSourceComparatorCapture: () => false,
    humanoidDialogueDurationMs: () => 2000,
    applyIdlePosture: (root) => {
      applyGeneratedHumanoidClinicalIdlePosture(root);
    },
    applyRolePosture: () => {},
    seatedClipPerforming: () => false,
    resolveGazeTargetWorld: (_speech, cam) => cam.position.clone(),
    normalizeLiveEmotion: (emotion) => emotion,
    liveTurnForCue: () => undefined,
    bundleTurnsForScenario: () => [],
    runtimeTurnForTraceTag: () => undefined,
    isDeterministicCaptureClock: () => false,
    isMouthGazePoseReviewCaptureMode: () => false,
    selectedCaptureMode: () => "",
    selectedHumanoidSourceComparator: () => null,
    scenarioIdForEvidence: () => SCENARIO_ID,
    comparatorScenarioId: () => SCENARIO_ID,
    assetPathForSlot: () => "subject.glb",
    animationPlaybackForSlot: () => undefined,
    morphTargetAppliedTargetCount: () => 0,
    visemeTimelineComparatorEvidencePresent: () => false,
    emotionTransitionCuePresent: () => false,
    currentSpeechEvidence: () => undefined,
    recordActingCueEvidence: () => {},
  };
}

function findBone(root, names) {
  // NOTE: pass every spelling variant explicitly (e.g. ["eye.L", "eyeL"]). The
  // loaded scene never contains "eye.L": GLTFLoader renames every node with
  // PropertyBinding.sanitizeNodeName, which strips "." ("eye.L" -> "eyeL",
  // verified in the loaded scene: bones "eyeL", "eyeR", "head"). A want with a
  // dot can never exact-match a loaded name, so this function does NOT try to
  // be clever with separators; it matches the listed strings exactly.
  const lower = names.map((n) => n.toLowerCase());
  let found = null;
  root.traverse((o) => {
    if (found || !o.isBone) return;
    const n = String(o.name ?? "").toLowerCase();
    if (lower.some((want) => n === want || n.endsWith(":" + want) || n.endsWith("_" + want) || n.endsWith("." + want))) {
      found = o;
    }
  });
  if (!found) {
    root.traverse((o) => {
      if (found || !o.isBone) return;
      const n = String(o.name ?? "").toLowerCase();
      if (lower.some((want) => n.includes(want))) found = o;
    });
  }
  return found;
}

// GLTFLoader renames nodes via PropertyBinding.sanitizeNodeName ("." stripped),
// so the MPFB rig's "eye.L"/"eye.R" load as "eyeL"/"eyeR". Both spellings are
// listed so the lookup works against file names and loaded names alike.
const EYE_LEFT_NAMES = ["eye.L", "eyeL"];
const EYE_RIGHT_NAMES = ["eye.R", "eyeR"];

function resolveEyeBones(root) {
  const left = findBone(root, EYE_LEFT_NAMES);
  const right = findBone(root, EYE_RIGHT_NAMES);
  if (!left || !right) {
    const bones = [];
    root.traverse((o) => { if (o.isBone) bones.push(o.name); });
    throw new Error(
      `eye bones missing: left=${left?.name ?? null} right=${right?.name ?? null}; ` +
      `eye-like bones in scene: ${JSON.stringify(bones.filter((n) => /eye/i.test(n)))}`,
    );
  }
  return { left, right };
}

function computeFraming(root) {
  const fit = Box3Fit(root);
  const size = fit.size;
  const headBone = findBone(root, ["head"]);
  const headPos = new Vector3();
  if (headBone) headBone.getWorldPosition(headPos);
  else headPos.set(fit.center.x, fit.max.y - size.y * 0.12, fit.center.z);
  const topOfHead = fit.max.y;
  const height = size.y;

  // Closeup: target = midpoint of the two eye bones, moved 0.06 m down;
  // vertical span 0.46 m at the target distance; straight in front on +Z, fov 18.
  const closeupFov = 18;
  const closeupSpan = 0.46;
  const closeupDist = closeupSpan / (2 * Math.tan(((closeupFov / 2) * Math.PI) / 180));
  const { left: eyeLeft, right: eyeRight } = resolveEyeBones(root);
  const eyeMid = new Vector3();
  eyeLeft.getWorldPosition(eyeMid);
  const eyeRightPos = new Vector3();
  eyeRight.getWorldPosition(eyeRightPos);
  eyeMid.add(eyeRightPos).multiplyScalar(0.5);
  const closeupTarget = new Vector3(eyeMid.x, eyeMid.y - 0.06, eyeMid.z);

  // Wide: target = hip-to-head midpoint; span from above hair to mid-thigh at fov 30.
  const wideFov = 30;
  const hipY = fit.min.y + height * 0.52;
  const wideTarget = new Vector3(fit.center.x, (hipY + headPos.y) / 2, fit.center.z);
  const wideSpan = topOfHead + 0.15 - (fit.min.y + height * 0.25);
  const wideDist = wideSpan / (2 * Math.tan(((wideFov / 2) * Math.PI) / 180));
  const yaw = (25 * Math.PI) / 180;

  return {
    closeup: { fov: closeupFov, target: closeupTarget, dist: closeupDist },
    wide: { fov: wideFov, target: wideTarget, dist: wideDist, yaw },
  };
}

// Box3 fit of the loaded model. All framing derives from this; no hardcoded world numbers.
function Box3Fit(root) {
  const box = new Box3().setFromObject(root);
  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { min: box.min, max: box.max, size, center };
}

function applyShot(shot) {
  currentShot = shot;
  const f = framing[shot];
  camera.fov = f.fov;
  if (shot === "closeup") {
    camera.position.set(f.target.x, f.target.y, f.target.z + f.dist);
  } else {
    camera.position.set(
      f.target.x + f.dist * Math.sin(f.yaw),
      f.target.y,
      f.target.z + f.dist * Math.cos(f.yaw),
    );
  }
  camera.near = 0.02;
  camera.far = Math.max(20, f.dist * 8);
  camera.lookAt(f.target);
  camera.updateProjectionMatrix();
}

function collectClosureEntries(root) {
  const found = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.morphTargetDictionary || !object.morphTargetInfluences) return;
    const dict = object.morphTargetDictionary;
    const leftIndex = dict["eye-left-closure"];
    const rightIndex = dict["eye-right-closure"];
    if (typeof leftIndex !== "number" || typeof rightIndex !== "number") return;
    found.push({ mesh: object, leftIndex, rightIndex });
  });
  return found;
}

function sampleClosures() {
  let left = 0;
  let right = 0;
  for (const e of closureEntries) {
    left = Math.max(left, e.mesh.morphTargetInfluences?.[e.leftIndex] ?? 0);
    right = Math.max(right, e.mesh.morphTargetInfluences?.[e.rightIndex] ?? 0);
  }
  return { left, right };
}

function sampleNonzeroMorphs() {
  const out = {};
  slot.root.traverse((o) => {
    const d = o.morphTargetDictionary;
    const inf = o.morphTargetInfluences;
    if (!d || !inf) return;
    for (const [name, idx] of Object.entries(d)) {
      const v = inf[idx] ?? 0;
      if (v > 0.01) out[name] = Math.max(out[name] ?? 0, Number(v.toFixed(3)));
    }
  });
  return out;
}

window.__setup = async function __setup({ glbUrl, width, height }) {
  canvasWidth = width;
  canvasHeight = height;
  renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  document.body.appendChild(renderer.domElement);
  scene = new Scene();
  scene.background = new Color("#18211d");
  scene.add(new AmbientLight("#dceee6", 1.5));
  const key = new DirectionalLight("#ffffff", 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new DirectionalLight("#b6d8ca", 1.2);
  fill.position.set(-4, 3, -2);
  scene.add(fill);
  camera = new PerspectiveCamera(18, width / height, 0.02, 40);

  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  const root = gltf.scene;
  let meshCount = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    meshCount += 1;
    object.frustumCulled = false;
  });
  scene.add(root);
  root.updateMatrixWorld(true);

  const actorSlot = new Group();
  slot = {
    actorId: ACTOR_ID,
    assetId: ACTOR_ID,
    root,
    actorSlot,
    baseX: root.position.x,
    baseY: root.position.y,
    baseZ: root.position.z,
    baseScaleX: root.scale.x,
    baseScaleY: root.scale.y,
    baseScaleZ: root.scale.z,
    baseRotationY: root.rotation.y,
    phaseOffsetMs: 0,
    mouthCue: new Mesh(),
    gazeCue: new Line(),
    eyeFocusCue: new Group(),
    expressionCue: new Group(),
    emotionExpression: createHumanoidEmotionExpressionState({ deterministicClock: true }),
    sourceComparatorFreezeEnabled: false,
  };
  ctx = makeContext([slot]);
  closureEntries = collectClosureEntries(root);
  eyeBones = resolveEyeBones(root);
  framing = computeFraming(root);
  applyShot("closeup");
  firedKeys = new Set();

  const morphTargetNames = new Set();
  root.traverse((o) => {
    if (!o.morphTargetDictionary) return;
    for (const name of Object.keys(o.morphTargetDictionary)) morphTargetNames.add(name);
  });
  return {
    morphTargetNames: [...morphTargetNames].sort(),
    meshCount,
    closureMeshCount: closureEntries.length,
  };
};

window.__step = async function __step({ frameIndex, fps, events }) {
  const frameDtMs = 1000 / fps;
  const tEnd = (frameIndex + 1) * frameDtMs;
  // Two 1/60 s sub-steps; the page clock is virtual (performance.now is stubbed).
  for (let sub = 0; sub < 2; sub += 1) {
    const t = frameIndex * frameDtMs + ((sub + 1) * frameDtMs) / 2;
    window.__virtualNowMs = t;
    for (const ev of events ?? []) {
      const key = `${ev.type}:${ev.startMs}:${ev.lineId ?? ev.shot ?? ""}`;
      if (ev.startMs <= t && !firedKeys.has(key)) {
        firedKeys.add(key);
        if (ev.type === "camera") {
          applyShot(ev.shot);
        } else if (ev.type === "speech") {
          slot.activeSpeech = {
            actorId: ACTOR_ID,
            assetId: ACTOR_ID,
            gazeTargetKind: "learner_camera",
            gazeTargetActorId: null,
            text: ev.text,
            emotion: ev.emotion,
            emotionContext: {
              emotion: ev.emotion,
              source: "speech_emotion_blink_video",
              baselineMood: [],
              cueIds: [],
            },
            phonemeSequence: ["sil"],
            visemeSequence: ["sil"],
            startedAtMs: t,
            durationMs: ev.durationMs,
          };
          startHumanoidEmotionTransition(slot, ev.emotion, t);
          attachBakedCuesToSpeech(slot, ev.text, SCENARIO_ID);
        }
      }
    }
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, t, camera);
  }
  // The attach above resolves async (fetch + .then) while the virtual clock is frozen;
  // poll in real time until this line's bake marker lands.
  for (const ev of events ?? []) {
    if (ev.type !== "speech" || !(ev.startMs <= tEnd && ev.startMs > tEnd - frameDtMs - 1)) continue;
    const deadline = Date.now() + 8000;
    for (;;) {
      const marker = slot.root.userData?.openClinXrBakedVisemeTimeline;
      if (marker && marker.utteranceId === ev.utteranceId) break;
      if (Date.now() > deadline) {
        throw new Error(`baked cues never attached for ${SCENARIO_ID} :: ${ev.text.slice(0, 48)}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  renderer.render(scene, camera);

  const { left, right } = sampleClosures();
  const named = slot.root.userData?.openClinXrNamedVisemeDrive?.activeTargetName ?? null;
  const speaking = slot.activeSpeech
    ? (events ?? []).find((ev) => ev.type === "speech" && ev.text === slot.activeSpeech.text)?.lineId ?? null
    : null;
  return {
    frameIndex,
    tMs: Math.round(tEnd),
    shot: currentShot,
    speakingLineId: speaking,
    emotionTarget: slot.emotionExpression.targetEmotion,
    emotionCurrent: slot.emotionExpression.currentEmotion,
    weights: { ...slot.emotionExpression.weights },
    leftClosure: Number(left.toFixed(4)),
    rightClosure: Number(right.toFixed(4)),
    namedViseme: named,
    nonzeroMorphs: sampleNonzeroMorphs(),
    mouthProbe: sampleMouthProbe(slot.root),
  };
};

function worldXYZ(object) {
  if (!object) return null;
  const p = new Vector3();
  object.getWorldPosition(p);
  return { name: object.name, x: Number(p.x.toFixed(4)), y: Number(p.y.toFixed(4)), z: Number(p.z.toFixed(4)) };
}

function sampleMouthProbe(root) {
  let head = null;
  let jaw = null;
  const teethBox = new Box3();
  let teethN = 0;
  root.traverse((o) => {
    if (o.name === "head" && head === null) head = o;
    if (o.name === "jaw" && jaw === null) jaw = o;
    if (o.isMesh && /teeth/i.test(o.name)) {
      teethBox.expandByObject(o);
      teethN += 1;
    }
  });
  const card = root.getObjectByName("openclinxr_inner_mouth_cavity");
  const named = root.userData?.openClinXrNamedVisemeDrive;
  const teeth = teethN === 0 || teethBox.isEmpty()
    ? null
    : {
      n: teethN,
      min: { x: Number(teethBox.min.x.toFixed(4)), y: Number(teethBox.min.y.toFixed(4)), z: Number(teethBox.min.z.toFixed(4)) },
      max: { x: Number(teethBox.max.x.toFixed(4)), y: Number(teethBox.max.y.toFixed(4)), z: Number(teethBox.max.z.toFixed(4)) },
    };
  const headWorld = worldXYZ(head);
  let cardLocal = null;
  if (card) {
    cardLocal = {
      x: Number(card.position.x.toFixed(4)),
      y: Number(card.position.y.toFixed(4)),
      z: Number(card.position.z.toFixed(4)),
      visible: card.visible,
    };
  }
  let teethInHead = null;
  if (head && teeth) {
    const mid = new Vector3(
      (teethBox.min.x + teethBox.max.x) / 2,
      (teethBox.min.y + teethBox.max.y) / 2,
      teethBox.min.z + 0.008,
    );
    head.updateWorldMatrix(true, false);
    const local = head.worldToLocal(mid.clone());
    teethInHead = { x: Number(local.x.toFixed(4)), y: Number(local.y.toFixed(4)), z: Number(local.z.toFixed(4)) };
  }
  return {
    head: headWorld,
    jaw: worldXYZ(jaw),
    card: card ? { ...worldXYZ(card), ...cardLocal } : null,
    teeth,
    teethInHead,
    namedJaw: typeof named?.jawOpenRadians === "number" ? Number(named.jawOpenRadians.toFixed(4)) : null,
  };
}

window.__eyeBoxes = function __eyeBoxes() {
  const proj = (bone) => {
    const p = new Vector3();
    bone.getWorldPosition(p);
    p.project(camera);
    return { x: ((p.x + 1) / 2) * canvasWidth, y: ((1 - p.y) / 2) * canvasHeight };
  };
  const l = proj(eyeBones.left);
  const r = proj(eyeBones.right);
  const interEye = Math.hypot(l.x - r.x, l.y - r.y);
  if (interEye < 4) {
    throw new Error(`eye centres ${interEye.toFixed(2)} px apart; expected >= 4 px`);
  }
  const side = Math.round(0.7 * interEye);
  const box = (c) => {
    const half = side / 2;
    const b = {
      x0: Math.round(c.x - half),
      y0: Math.round(c.y - half),
      x1: Math.round(c.x + half),
      y1: Math.round(c.y + half),
    };
    if (b.x0 < 0 || b.y0 < 0 || b.x1 > canvasWidth || b.y1 > canvasHeight) {
      throw new Error(`eye box outside canvas: ${JSON.stringify(b)} canvas=${canvasWidth}x${canvasHeight}`);
    }
    return b;
  };
  const left = box(l);
  const right = box(r);
  const union = {
    x0: Math.min(left.x0, right.x0),
    y0: Math.min(left.y0, right.y0),
    x1: Math.max(left.x1, right.x1),
    y1: Math.max(left.y1, right.y1),
  };
  return { left, right, union };
};

window.__frameDataUrl = function __frameDataUrl() {
  return renderer.domElement.toDataURL("image/png");
};
