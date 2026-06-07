import {
  PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE,
  applyMorphTargetEmotionCue,
  applyMorphTargetVisemeCue,
  buildPedsAsthmaPatientEmotionTransitionTimeline,
  buildVisemeTimelineFromDialogue,
  emotionWeightsAtTimelineProgress,
  visemeAtTimelineProgress,
  type VisemeTimeline,
} from "@openclinxr/model-vetting";
import {
  AmbientLight,
  AnimationClip,
  AnimationMixer,
  Box3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ModelVettingStudioEvidence } from "./studio-state.js";

export type FixedCameraView = "front" | "side" | "three_quarter";
export type TemporalCaptureView = "turntable" | "viseme_timeline" | "emotion_transition" | "body_motion_probe";
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
    bodyMotionProbeClipName: string | null;
    bodyMotionProbePresent: boolean;
    runtimeImportEvidenceOnly: true;
  };
  bodyRigEvidence: {
    liveSkinnedSceneUsed: boolean;
    skinnedMeshCount: number;
    bodyMotionProbeClipName: string | null;
    bodyMotionPlaybackMode:
      | "not_requested"
      | "live_source_skinning_clip"
      | "model_associated_skin_envelope_diagnostic"
      | "source_geometry_deterministic_body_motion_fallback";
    modelAssociationEvidence: {
      associatedWithLoadedModel: boolean;
      associationMode: "none" | "skinned_mesh_bones_and_skin_attribute_radii" | "whole_model_transform_only";
      associatedBoneEnvelopeCount: number;
      sourceSurfaceVisible: boolean;
    };
    liveSkinnedBoundsProbe: {
      sane: boolean;
      maxAllowedMeters: number;
      samples: Array<{
        sampleIndex: number;
        cumulativeSeconds: number;
        width: number | null;
        height: number | null;
        depth: number | null;
        maxDimension: number | null;
        sane: boolean;
      }>;
    } | null;
    bodyMotionProbeEvidenceOnly: true;
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
    | "isolated_model_emotion_transition_video_only"
    | "isolated_model_body_motion_probe_video_only";
  materialEvidenceMode: "source_candidate_materials" | "neutral_inspection_material";
  deterministicTemporalCue: {
    enabled: boolean;
    cue: TemporalCaptureView | null;
    durationMs: number;
    degrees: number;
  };
  visemeTimelineEvidence?: {
    dialogueText: string;
    traceTag: VisemeTimeline["traceTag"];
    actorId: VisemeTimeline["actorId"];
    mappingMode: VisemeTimeline["mappingMode"];
    phonemeCount: number;
    visemeCount: number;
    appliedTargetCount: number;
    activeViseme: string;
    mouthOpenness: number;
    morphTargetPlaybackMode: "glb_morph_target_timeline_from_bundle_dialogue";
    notEvidenceFor: string;
  };
  emotionTransitionEvidence?: {
    fromEmotion: string;
    toEmotion: string;
    transitionProgress: number;
    appliedTargetCount: number;
    expressionWeights: {
      mouthOpen: number;
      browConcern: number;
      cheekTension: number;
    };
    morphTargetPlaybackMode: "glb_morph_target_emotion_transition_from_case_definition";
    mappingMode: "case_definition_driven_expression_transition";
    traceTag: "work_of_breathing_assessment";
    actorId: "patient_maya_johnson_v1";
    notEvidenceFor: string;
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
  dialogueText?: string;
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
  let skinnedMeshCount = 0;
  const inspectionMaterial = new MeshBasicMaterial({ color: "#cde7dc" });
  const emotionTransitionCapture = input.view === "emotion_transition";
  const useSourceMaterials = true;
  const visemeTimelineCapture = input.view === "viseme_timeline";
  const visemeTimeline = visemeTimelineCapture
    ? buildVisemeTimelineFromDialogue(input.dialogueText ?? PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE)
    : null;
  const emotionTransitionTimeline = emotionTransitionCapture
    ? buildPedsAsthmaPatientEmotionTransitionTimeline({ extendedCapture: true })
    : null;
  let latestVisemeCueEvidence = visemeTimelineCapture
    ? applyMorphTargetVisemeCue(model, 0, "rest")
    : null;
  let latestEmotionCueEvidence = emotionTransitionCapture && emotionTransitionTimeline
    ? applyMorphTargetEmotionCue(
      model,
      emotionWeightsAtTimelineProgress(emotionTransitionTimeline, 0).weights,
      emotionTransitionTimeline,
      0,
    )
    : null;

  const bodyMotionCapture = input.view === "body_motion_probe";
  const captureModel = new Group();
  const skinnedMeshes: SkinnedMesh[] = [];
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (object instanceof Mesh) {
      meshCount += 1;
      if (object instanceof SkinnedMesh || (object as { isSkinnedMesh?: boolean }).isSkinnedMesh) {
        skinnedMeshCount += 1;
        skinnedMeshes.push(object as SkinnedMesh);
      }
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
  const baseScale = targetHeightMeters / Math.max(initialSize.y, 0.001);
  captureModel.scale.setScalar(baseScale);
  captureModel.updateMatrixWorld(true);
  const bounds = computeBaseMeshBounds(captureModel);
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const basePosition = new Vector3(-center.x, -bounds.min.y, -center.z);
  captureModel.position.copy(basePosition);
  captureModel.updateMatrixWorld(true);
  model.position.copy(basePosition);
  model.scale.setScalar(baseScale);
  model.visible = false;
  scene.add(model);
  model.updateMatrixWorld(true);

  const bodyMotionProbeClip = selectBodyMotionProbeClip(gltf.animations);
  const mixer = bodyMotionCapture && bodyMotionProbeClip ? new AnimationMixer(model) : null;
  if (mixer && bodyMotionProbeClip) {
    const action = mixer.clipAction(bodyMotionProbeClip);
    action.reset();
    action.play();
  }
  const liveSkinnedBoundsProbe = bodyMotionCapture && mixer !== null && bodyMotionProbeClip !== undefined
    ? probeLiveSkinnedBounds(model, mixer)
    : null;
  const liveRiggedCapture = Boolean(liveSkinnedBoundsProbe?.sane);
  model.visible = liveRiggedCapture || visemeTimelineCapture;
  captureModel.visible = !liveRiggedCapture && !visemeTimelineCapture;
  const associatedSkinEnvelope = bodyMotionCapture && !liveRiggedCapture
    ? createAssociatedSkinEnvelopeDiagnostic(model, skinnedMeshes, useSourceMaterials)
    : null;
  if (associatedSkinEnvelope) scene.add(associatedSkinEnvelope.root);
  const camera = new PerspectiveCamera(35, width / height, 0.01, 100);
  if ((bodyMotionCapture && liveRiggedCapture) || visemeTimelineCapture) {
    frameCameraForBounds(camera, bounds, visemeTimelineCapture ? "three_quarter" : input.view);
  } else {
    camera.position.copy(cameraPosition(input.view));
    camera.lookAt(0, 0.9, 0);
  }
  if (isTemporalCaptureView(input.view)) {
    const start = performance.now();
    let previous = start;
    const durationMs = visemeTimeline?.durationMs ?? 3000;
    const animate = (now: number) => {
      const deltaSeconds = Math.max(0, now - previous) / 1000;
      previous = now;
      const progress = ((now - start) % durationMs) / durationMs;
      if (input.view === "turntable") {
        captureModel.rotation.y = progress * Math.PI * 2;
      }
      if (input.view === "body_motion_probe" && liveRiggedCapture) {
        mixer?.update(deltaSeconds);
        model.updateMatrixWorld(true);
      } else if (input.view === "body_motion_probe" && associatedSkinEnvelope) {
        mixer?.update(deltaSeconds);
        model.updateMatrixWorld(true);
        associatedSkinEnvelope.sync();
      } else if (input.view === "body_motion_probe") {
        const breath = Math.sin(progress * Math.PI * 2);
        const sway = Math.sin(progress * Math.PI * 4);
        captureModel.scale.set(baseScale * (1 + breath * 0.012), baseScale * (1 + breath * 0.018), baseScale * (1 - breath * 0.006));
        captureModel.position.set(basePosition.x + sway * 0.018, basePosition.y + Math.max(0, breath) * 0.012, basePosition.z);
        captureModel.rotation.z = sway * 0.025;
      }
      if (visemeTimelineCapture && visemeTimeline) {
        const visemeFrame = visemeAtTimelineProgress(visemeTimeline, progress);
        const openness = visemeFrame.openness * (0.65 + Math.abs(Math.sin(now / 58)) * 0.18);
        latestVisemeCueEvidence = applyMorphTargetVisemeCue(model, openness, visemeFrame.viseme);
        model.updateMatrixWorld(true);
      }
      if (emotionTransitionCapture && emotionTransitionTimeline) {
        const emotionFrame = emotionWeightsAtTimelineProgress(emotionTransitionTimeline, progress);
        latestEmotionCueEvidence = applyMorphTargetEmotionCue(
          model,
          emotionFrame.weights,
          emotionTransitionTimeline,
          emotionFrame.transitionProgress,
        );
        model.updateMatrixWorld(true);
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
    bodyRigEvidence: {
      liveSkinnedSceneUsed: liveRiggedCapture,
      skinnedMeshCount,
      bodyMotionProbeClipName: bodyMotionCapture ? bodyMotionProbeClip?.name ?? null : null,
      bodyMotionPlaybackMode: bodyMotionCapture
        ? (
          liveRiggedCapture
            ? "live_source_skinning_clip"
            : associatedSkinEnvelope
              ? "model_associated_skin_envelope_diagnostic"
              : "source_geometry_deterministic_body_motion_fallback"
        )
        : "not_requested",
      modelAssociationEvidence: {
        associatedWithLoadedModel: Boolean(associatedSkinEnvelope),
        associationMode: associatedSkinEnvelope ? "skinned_mesh_bones_and_skin_attribute_radii" : bodyMotionCapture ? "whole_model_transform_only" : "none",
        associatedBoneEnvelopeCount: associatedSkinEnvelope?.count ?? 0,
        sourceSurfaceVisible: true,
      },
      liveSkinnedBoundsProbe,
      bodyMotionProbeEvidenceOnly: true,
    },
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
      durationMs: isTemporalCaptureView(input.view)
        ? (visemeTimeline?.durationMs ?? emotionTransitionTimeline?.durationMs ?? 3000)
        : 0,
      degrees: input.view === "turntable" ? 360 : 0,
    },
    ...(visemeTimelineCapture && visemeTimeline && latestVisemeCueEvidence
      ? {
        visemeTimelineEvidence: {
          dialogueText: visemeTimeline.dialogueText,
          traceTag: visemeTimeline.traceTag,
          actorId: visemeTimeline.actorId,
          mappingMode: visemeTimeline.mappingMode,
          phonemeCount: visemeTimeline.phonemeSequence.length,
          visemeCount: visemeTimeline.visemeSequence.length,
          appliedTargetCount: latestVisemeCueEvidence.appliedTargetCount,
          activeViseme: latestVisemeCueEvidence.currentViseme,
          mouthOpenness: latestVisemeCueEvidence.mouthOpenness,
          morphTargetPlaybackMode: "glb_morph_target_timeline_from_bundle_dialogue" as const,
          notEvidenceFor: latestVisemeCueEvidence.notEvidenceFor,
        },
      }
      : {}),
    ...(emotionTransitionCapture && emotionTransitionTimeline && latestEmotionCueEvidence
      ? {
        emotionTransitionEvidence: {
          fromEmotion: latestEmotionCueEvidence.fromEmotion,
          toEmotion: latestEmotionCueEvidence.toEmotion,
          transitionProgress: latestEmotionCueEvidence.transitionProgress,
          appliedTargetCount: latestEmotionCueEvidence.appliedTargetCount,
          expressionWeights: latestEmotionCueEvidence.expressionWeights,
          morphTargetPlaybackMode: "glb_morph_target_emotion_transition_from_case_definition" as const,
          mappingMode: emotionTransitionTimeline.mappingMode,
          traceTag: emotionTransitionTimeline.traceTag,
          actorId: emotionTransitionTimeline.actorId,
          notEvidenceFor: latestEmotionCueEvidence.notEvidenceFor,
        },
      }
      : {}),
    scenePlacementEvidenceAllowed: false,
    questReadinessClaimAllowed: false,
    productionReadinessClaimAllowed: false,
    learnerReadinessClaimAllowed: false,
    clinicalValidityClaimAllowed: false,
    scoringValidityClaimAllowed: false,
    notEvidenceFor: input.evidence.notEvidenceFor,
  };
}

function probeLiveSkinnedBounds(model: Object3D, mixer: AnimationMixer): {
  sane: boolean;
  maxAllowedMeters: number;
  samples: Array<{
    sampleIndex: number;
    cumulativeSeconds: number;
    width: number | null;
    height: number | null;
    depth: number | null;
    maxDimension: number | null;
    sane: boolean;
  }>;
} {
  const samples: readonly number[] = [0, 0.45, 0.9, 1.35];
  const maxAllowedMeters = 5;
  const observed = [];
  let sane = true;
  let cumulativeSeconds = 0;
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const delta = samples[sampleIndex] ?? 0;
    cumulativeSeconds += delta;
    mixer.update(delta);
    model.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(model);
    const size = bounds.getSize(new Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    const sampleSane = Number.isFinite(maxDimension) && maxDimension > 0.05 && maxDimension <= maxAllowedMeters;
    sane = sane && sampleSane;
    observed.push({
      sampleIndex,
      cumulativeSeconds: Number(cumulativeSeconds.toFixed(3)),
      width: Number.isFinite(size.x) ? roundMeters(size.x) : null,
      height: Number.isFinite(size.y) ? roundMeters(size.y) : null,
      depth: Number.isFinite(size.z) ? roundMeters(size.z) : null,
      maxDimension: Number.isFinite(maxDimension) ? roundMeters(maxDimension) : null,
      sane: sampleSane,
    });
  }
  return { sane, maxAllowedMeters, samples: observed };
}

function createAssociatedSkinEnvelopeDiagnostic(
  model: Object3D,
  skinnedMeshes: SkinnedMesh[],
  useSourceMaterials: boolean,
): { root: Group; count: number; sync: () => void } | null {
  const entries: Array<{ bone: Object3D; segment: Mesh; joint: Mesh; radius: number }> = [];
  const root = new Group();
  root.name = "openclinxr_model_associated_skin_envelope_diagnostic";
  const segmentMaterial = new MeshBasicMaterial({
    color: useSourceMaterials ? "#86efac" : "#86efac",
    opacity: 0.34,
    transparent: true,
  });
  const jointMaterial = new MeshBasicMaterial({ color: "#ffffff" });
  const cylinder = new CylinderGeometry(1, 1, 1, 18);
  const sphere = new SphereGeometry(1, 12, 6);
  const radii = estimateSkinEnvelopeRadii(skinnedMeshes);
  const seen = new Set<Object3D>();
  for (const mesh of skinnedMeshes) {
    for (const bone of mesh.skeleton.bones) {
      if (seen.has(bone) || !bone.parent) continue;
      seen.add(bone);
      const radius = radii.get(bone.name) ?? 0.035;
      const segment = new Mesh(cylinder, segmentMaterial);
      const joint = new Mesh(sphere, jointMaterial);
      segment.name = `openclinxr_model_associated_skin_segment_${bone.name}`;
      joint.name = `openclinxr_model_associated_skin_joint_${bone.name}`;
      segment.frustumCulled = false;
      joint.frustumCulled = false;
      root.add(segment, joint);
      entries.push({ bone, segment, joint, radius });
    }
  }
  if (entries.length === 0) return null;
  const scratchHead = new Vector3();
  const scratchTail = new Vector3();
  const scratchMid = new Vector3();
  const scratchDirection = new Vector3();
  const sync = () => {
    root.updateMatrixWorld(true);
    for (const entry of entries) {
      entry.bone.getWorldPosition(scratchHead);
      entry.bone.parent?.getWorldPosition(scratchTail);
      const length = scratchHead.distanceTo(scratchTail);
      if (length <= 0.001) {
        entry.segment.visible = false;
      } else {
        entry.segment.visible = true;
        scratchMid.copy(scratchHead).add(scratchTail).multiplyScalar(0.5);
        scratchDirection.copy(scratchHead).sub(scratchTail).normalize();
        entry.segment.position.copy(scratchMid);
        entry.segment.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), scratchDirection));
        entry.segment.scale.set(entry.radius, length, entry.radius);
      }
      entry.joint.position.copy(scratchHead);
      entry.joint.scale.setScalar(Math.max(entry.radius * 0.72, 0.018));
    }
  };
  sync();
  return { root, count: entries.length, sync };
}

function estimateSkinEnvelopeRadii(skinnedMeshes: SkinnedMesh[]): Map<string, number> {
  const samples = new Map<string, number[]>();
  const vertex = new Vector3();
  const bonePosition = new Vector3();
  for (const mesh of skinnedMeshes) {
    const position = mesh.geometry.getAttribute("position");
    const skinIndex = mesh.geometry.getAttribute("skinIndex");
    const skinWeight = mesh.geometry.getAttribute("skinWeight");
    if (!position || !skinIndex || !skinWeight) continue;
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      let bestBoneIndex = -1;
      let bestWeight = 0;
      for (let slot = 0; slot < 4; slot += 1) {
        const weight = skinWeight.getComponent(index, slot);
        if (weight > bestWeight) {
          bestWeight = weight;
          bestBoneIndex = skinIndex.getComponent(index, slot);
        }
      }
      const bone = mesh.skeleton.bones[bestBoneIndex];
      if (!bone || bestWeight < 0.05) continue;
      bone.getWorldPosition(bonePosition);
      const list = samples.get(bone.name) ?? [];
      list.push(vertex.distanceTo(bonePosition));
      samples.set(bone.name, list);
    }
  }
  const radii = new Map<string, number>();
  for (const [boneName, values] of samples) {
    values.sort((a, b) => a - b);
    const radius = values[Math.min(values.length - 1, Math.floor(values.length * 0.38))] ?? 0.028;
    radii.set(boneName, Math.max(0.018, Math.min(radius, 0.075)));
  }
  return radii;
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
  const bodyMotionProbeClipName = selectBodyMotionProbeClipName(animationNames);
  return {
    animationCount: animations.length,
    animationNames,
    totalChannelCount: animations.reduce((total, animation) => total + (Array.isArray(animation.tracks) ? animation.tracks.length : 0), 0),
    mpfb2EyeLookProbePresent: animationNames.some((name) => name.startsWith("openclinxr_mpfb2_eye_look_probe")),
    bodyMotionProbeClipName,
    bodyMotionProbePresent: bodyMotionProbeClipName !== null,
    runtimeImportEvidenceOnly: true,
  };
}

function selectBodyMotionProbeClip(animations: AnimationClip[]): AnimationClip | undefined {
  const selectedName = selectBodyMotionProbeClipName(animations.map((animation, index) => animation.name || `unnamed_animation_${index}`));
  return animations.find((animation, index) => (animation.name || `unnamed_animation_${index}`) === selectedName);
}

export function selectBodyMotionProbeClipName(animationNames: string[]): string | null {
  return animationNames.find((name) => /mpfb_body_motion_probe|role_patient_asthma_breathing_effort|role_parent_anxious_fidget_guard|role_nurse_clinical_check_reassure/u.test(name))
    ?? animationNames.find((name) => /posture|standing|clinical|conversation|idle/u.test(name))
    ?? null;
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
  return value === "turntable" || value === "viseme_timeline" || value === "emotion_transition" || value === "body_motion_probe";
}

function cameraPosition(view: CandidateCaptureView): Vector3 {
  if (view === "side") return new Vector3(4.8, 1.35, 0);
  if (view === "three_quarter") return new Vector3(3.6, 1.35, 3.6);
  return new Vector3(0, 1.35, 4.8);
}

function frameCameraForBounds(camera: PerspectiveCamera, bounds: Box3, view: CandidateCaptureView): void {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.5);
  const distance = radius * 2.35;
  const eyeHeight = Math.max(size.y * 0.12, 0.25);
  if (view === "side") camera.position.set(center.x + distance, center.y + eyeHeight, center.z);
  else if (view === "three_quarter") camera.position.set(center.x + distance * 0.72, center.y + eyeHeight, center.z + distance * 0.72);
  else camera.position.set(center.x, center.y + eyeHeight, center.z + distance);
  camera.lookAt(center.x, center.y + size.y * 0.08, center.z);
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
  if (sourceGlbPath.includes("peds_asthma_parent_anxiety_v1_garment_hint_v1") || sourceGlbPath.includes("garment_hint_peds_tshirt")) {
    return new URL("../../../../.openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1_garment_hint_v1/peds_patient_child.glb", import.meta.url).href;
  }
  return new URL("../../../ui-xr/public/generated-humanoids/peds_patient_child.glb", import.meta.url).href;
}

function captureClaimForView(view: CandidateCaptureView): ModelVettingCandidateCaptureEvidence["captureClaim"] {
  if (view === "turntable") return "isolated_model_turntable_video_only";
  if (view === "viseme_timeline") return "isolated_model_viseme_timeline_video_only";
  if (view === "emotion_transition") return "isolated_model_emotion_transition_video_only";
  if (view === "body_motion_probe") return "isolated_model_body_motion_probe_video_only";
  return "isolated_model_fixed_camera_screenshot_only";
}
