import { readFileSync } from "node:fs";
import {
  createAffordanceMarker,
  createHumanoidExpressionCue,
  createHumanoidEyeFocusCue,
  createHumanoidEyeGazeCue,
  createHumanoidInteractionCollisionCues,
  createHumanoidSpeechMouthCue,
  createRuntimeHumanoidDetailCues,
} from "@openclinxr/xr-scene-cues";
import {
  Box3,
  Group,
  Mesh,
  type Object3D,
  SkinnedMesh,
  Vector3,
} from "three";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import {
  type AssetLoadingContext,
  addRoleSpecificHumanoidVisuals,
  loadGeneratedHumanoidIntoActorSlot,
} from "./index.js";

const AISHA_GLB = new URL("../../../../apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb", import.meta.url);
const ACTOR_ID = "patient_aisha_khan_v1";
const FACE_CUE_IDS = [
  "visible_eye_gaze_anchor_cue",
  "emotion_mouth_viseme_anchor_cue",
  "emotion_brow_tension_cue",
] as const;
const FALLBACK_FACE_SUFFIXES = [
  "actor-specific-hair-cap-variant-cue",
  "actor-specific-face-tone-and-cheek-volume-cue",
  "left-eye-gaze-anchor-cue",
  "right-eye-gaze-anchor-cue",
  "emotion-mouth-line-viseme-anchor-cue",
  "emotion-brow-tension-cue",
  "actor-specific-clothing-layer-silhouette-cue",
  "actor-specific-role-accent-cue",
] as const;

type CueRecord = { actorId: string; cueId: string; sceneObjectName: string };

async function loadShippedAisha(): Promise<Group> {
  const bytes = readFileSync(AISHA_GLB);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const binLength = bytes.readUInt32LE(20 + jsonLength);
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + jsonLength, 28 + jsonLength + binLength).toString("base64")}`;
  for (const material of json.materials ?? []) {
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  }
  json.images = [];
  json.textures = [];
  const platform = globalThis as unknown as { ProgressEvent?: typeof Event };
  if (!platform.ProgressEvent) platform.ProgressEvent = class extends Event {};
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), "")).scene;
}

function context(showAffordances: boolean, records: CueRecord[]): AssetLoadingContext {
  const cueContext = {
    scenarioObjectPrefix: "openclinxr.ob_headache_preeclampsia_triage_v1",
    shouldShowAffordanceMarkers: () => showAffordances,
  };
  return {
    scenarioId: () => "ob_headache_preeclampsia_triage_v1",
    scenarioTheme: () => ({
      backgroundColor: 0,
      floorColor: 0,
      panelBackground: "#fff",
      panelAccent: "#000",
      reusedAssetAccentColor: 0xc58f67,
    }),
    sceneObjectPrefix: () => cueContext.scenarioObjectPrefix,
    runtimeActorRole: () => "patient",
    runtimePatientActorId: () => ACTOR_ID,
    runtimeClinicalTeamActorId: () => "nurse_maria_santos_v1",
    runtimeFamilyActorId: () => "family_not_present",
    isPediatricAsthmaScenario: () => false,
    selectedCaptureMode: () => "",
    selectedHumanoidSourceComparator: () => null,
    shouldShowAffordanceMarkers: () => showAffordances,
    shouldUseCleanSourceComparatorCapture: () => false,
    isEdBayVisibleComparatorCapture: () => false,
    shouldShowComparatorDebugFaceCues: () => false,
    isMouthGazePoseReviewCaptureMode: () => false,
    isCaptureShadowPath: () => false,
    isRealGarmentSleeveDeformCapture: () => false,
    recordBootPhase: () => {},
    recordRoleDistinctCue: (actorId: string, cueId: string, sceneObjectName: string) => records.push({ actorId, cueId, sceneObjectName }),
    sourceProvenanceForPath: () => undefined,
    resolveCastPath: (input: { fallbackPath: string }) => input.fallbackPath,
    animationSlots: () => [],
    pushAnimationSlot: () => {},
    setAnimationSlotByActor: () => {},
    setActorSlotByActor: () => {},
    registerTouchRegions: () => {},
    triggerDialogue: () => {},
    dialogueText: () => ({ line: "", initial: "" }),
    visemeUtterance: () => "",
    schedulePedsPlaybackIfReady: () => {},
    touchResponseClipNames: () => [],
    roleClipNames: () => [],
    gazeProbeClipNames: () => [],
    morphTargetsNeutralized: () => {},
    suppressOverlaysForComparator: () => {},
    faceReviewCues: () => {},
    frameCaptureOnNamedActor: () => {},
    recordEdBayCameraPose: () => {},
    resolveEffectiveVerticalOffset: () => 0,
    activeEnvironmentId: () => "ob_triage_room_v1",
    applyPosture: () => {},
    applySupine: () => {},
    applyClinicalIdle: () => {},
    applyRoleWardrobeCue: () => {},
    tintSceneMaterials: () => {},
    clinicalIdleClipPresent: () => false,
    seatedClipPlayable: () => false,
    translationBoneNames: () => [],
    plantSeatedPelvis: () => ({ deltaY: 0, pelvisBefore: 0 }),
    seatedChairHeight: () => 0.45,
    findStretcherInScene: () => null,
    applyAndPlantSupineDeck: () => {},
    stretcherDeckTopWorldY: () => 0.8,
    createEmotionState: () => ({
      currentEmotion: "neutral",
      targetEmotion: "neutral",
      weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      targetWeights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      transitionStartedAtMs: 0,
      transitionDurationMs: 0,
    }),
    rolePostureContext: () => ({
      actorRole: () => undefined,
      isPatient: () => false,
      isClinicalTeam: () => false,
      isFamily: () => false,
      isPediatricAsthmaScenario: () => false,
      scenarioId: "ob_headache_preeclampsia_triage_v1",
    }),
    markActorCastShadow: () => {},
    clinicalTouchScenario: () => undefined,
    selectedScenarioId: () => "ob_headache_preeclampsia_triage_v1",
    affordanceMarker: (cueId: string, color: number) => createAffordanceMarker(cueContext, cueId, color),
    detailCues: (assetId: string) => createRuntimeHumanoidDetailCues(cueContext, assetId),
    collisionCues: (assetId: string) => createHumanoidInteractionCollisionCues(cueContext, assetId),
    mouthCue: (assetId: string, color: number) => createHumanoidSpeechMouthCue(cueContext, assetId, color),
    gazeCue: (assetId: string, color: number) => createHumanoidEyeGazeCue(cueContext, assetId, color),
    eyeFocusCue: (assetId: string) => createHumanoidEyeFocusCue(cueContext, assetId),
    expressionCue: (assetId: string) => createHumanoidExpressionCue(cueContext, assetId),
  } as unknown as AssetLoadingContext;
}

async function loadAishaThroughPublicEntrypoint(records: CueRecord[]): Promise<{
  humanoid: Group;
  shippedMeshes: ReadonlySet<Mesh>;
}> {
  const aisha = await loadShippedAisha();
  const shippedMeshes = new Set<Mesh>();
  aisha.traverse((object) => {
    if (object instanceof Mesh) shippedMeshes.add(object);
  });
  const gltfFixture: GLTF = {
    scene: aisha,
    animations: [],
    scenes: [aisha],
    cameras: [],
    asset: {},
    parser: {} as GLTF["parser"],
    userData: {},
  };
  const load = vi.spyOn(GLTFLoader.prototype, "load").mockImplementation((_url, onLoad) => {
    onLoad(gltfFixture);
  });
  const runtimeWindow = window as Omit<typeof window, "requestAnimationFrame"> & {
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  };
  const originalRequestAnimationFrame = runtimeWindow.requestAnimationFrame;
  runtimeWindow.requestAnimationFrame = (callback) => {
    callback(0);
    return 0;
  };
  const actorSlot = new Group();
  try {
    loadGeneratedHumanoidIntoActorSlot(context(false, records), actorSlot, {
      assetPath: AISHA_GLB.pathname,
      assetId: "mpfb_ob_patient_aisha",
      objectName: "ob_patient_aisha",
      actorId: ACTOR_ID,
      roleTintColor: 0xc58f67,
      verticalOffsetMeters: 0,
    });
  } finally {
    load.mockRestore();
    if (originalRequestAnimationFrame) runtimeWindow.requestAnimationFrame = originalRequestAnimationFrame;
    else delete runtimeWindow.requestAnimationFrame;
  }
  const loaded = actorSlot.getObjectByName("ob_patient_aisha");
  expect(loaded, "the public loader must attach the shipped Aisha GLB to the actor slot").toBeInstanceOf(Group);
  return { humanoid: loaded as Group, shippedMeshes };
}

function headBounds(root: Group): Box3 {
  root.updateMatrixWorld(true);
  const neck = root.getObjectByName("neck03");
  expect(neck, "the shipped GLB must retain its upper neck joint").toBeDefined();
  const neckWorldY = neck?.getWorldPosition(new Vector3()).y ?? Number.POSITIVE_INFINITY;
  const bounds = new Box3();
  const vertex = new Vector3();
  root.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return;
    const position = object.geometry.getAttribute("position");
    const skinIndex = object.geometry.getAttribute("skinIndex");
    const skinWeight = object.geometry.getAttribute("skinWeight");
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index);
      object.applyBoneTransform(index, vertex);
      object.localToWorld(vertex);
      const isSkinnedToHead = skinIndex !== undefined && skinWeight !== undefined
        && [0, 1, 2, 3].some((lane) => {
          const boneIndex = skinIndex.getComponent(index, lane);
          const weight = skinWeight.getComponent(index, lane);
          return weight > 0 && object.skeleton.bones[boneIndex]?.name === "head";
        });
      // Head bbox = union(vertices with a head-joint weight, vertices above the neck joint).
      if (isSkinnedToHead || vertex.y >= neckWorldY) bounds.expandByPoint(vertex);
    }
  });
  expect(bounds.isEmpty(), "the shipped GLB must yield a non-empty skinned head bbox").toBe(false);
  return bounds;
}

function isEffectivelyVisible(mesh: Mesh): boolean {
  let object: Object3D | null = mesh;
  while (object) {
    if (!object.visible) return false;
    object = object.parent;
  }
  return mesh.visible;
}

function visibleNonGlbHeadMeshes(root: Group, glbMeshes: ReadonlySet<Mesh>, bounds: Box3): string[] {
  root.updateMatrixWorld(true);
  // The photographed overlays are screen-facing and sit immediately anterior to the
  // skin, so their thin Z boxes do not penetrate the skin's own vertex AABB. Extend
  // the exact skinned head bbox forward by one measured head depth; X/Y and the
  // extension are still wholly derived from that shipped-vertex bbox.
  const faceEnvelope = bounds.clone();
  faceEnvelope.max.z += bounds.getSize(new Vector3()).z;
  const offenders: string[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh) || glbMeshes.has(object) || !isEffectivelyVisible(object)) return;
    const objectBounds = new Box3().setFromObject(object);
    if (objectBounds.intersectsBox(faceEnvelope)) offenders.push(object.name || "<unnamed mesh>");
  });
  return offenders.sort();
}

function fallbackFaceNames(root: Group): string[] {
  return root.children
    .map((child) => child.name)
    .filter((name) => FALLBACK_FACE_SUFFIXES.some((suffix) => name.endsWith(suffix)))
    .sort();
}

describe("a generated GLB face owns its runtime cues", () => {
  it("T1 leaves no visible non-GLB mesh intersecting Aisha's real head bbox", async () => {
    const records: CueRecord[] = [];
    const { humanoid: aisha, shippedMeshes } = await loadAishaThroughPublicEntrypoint(records);
    const bounds = headBounds(aisha);

    const offenders = visibleNonGlbHeadMeshes(aisha, shippedMeshes, bounds);
    expect(
      offenders,
      `reinstate GLB-part ownership, do not restore the primitives; offending meshes: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("CW1 keeps the primitive fallback face cue count and names", () => {
    const fallback = new Group();
    addRoleSpecificHumanoidVisuals(context(false, []), fallback, ACTOR_ID, "primitive_fallback");
    expect(fallbackFaceNames(fallback)).toEqual(
      FALLBACK_FACE_SUFFIXES.map((suffix) => `openclinxr.ob_headache_preeclampsia_triage_v1.${ACTOR_ID}.${suffix}`).sort(),
    );
  });

  it("CW2 keeps the explicit affordance-marker face cues visible on a generated GLB", () => {
    const generated = new Group();
    addRoleSpecificHumanoidVisuals(context(true, []), generated, ACTOR_ID, "generated_glb");
    const faceNames = fallbackFaceNames(generated);
    expect(faceNames).toHaveLength(FALLBACK_FACE_SUFFIXES.length);
    expect(generated.children.filter((child) => faceNames.includes(child.name)).every((child) => child.visible)).toBe(true);
  });

  it("CW3 records Aisha's shipped eye, morph-target mouth, and brow meshes as cue owners", async () => {
    const records: CueRecord[] = [];
    const { humanoid: aisha } = await loadAishaThroughPublicEntrypoint(records);

    for (const cueId of FACE_CUE_IDS) {
      const record = records.find((candidate) => candidate.cueId === cueId);
      expect(record, `${cueId}: reinstate GLB-part ownership, do not restore the primitives`).toBeDefined();
      const owner = aisha.getObjectByName(record?.sceneObjectName ?? "");
      expect(owner, `${cueId} owner must exist in the shipped GLB`).toBeInstanceOf(Mesh);
      expect((owner?.userData as Record<string, unknown>)["openClinXrGeneratedHumanoidFaceCueOwner"]).toBe(cueId);
    }
    const eyeOwner = aisha.getObjectByName(
      records.find((record) => record.cueId === "visible_eye_gaze_anchor_cue")?.sceneObjectName ?? "",
    ) as Mesh;
    const eyeOwnerLabels = [
      eyeOwner.name,
      ...(Array.isArray(eyeOwner.material) ? eyeOwner.material : [eyeOwner.material]).map((material) => material.name),
    ].join(" ");
    expect(eyeOwnerLabels).toMatch(/eyes?/iu);
    const mouthOwner = aisha.getObjectByName(
      records.find((record) => record.cueId === "emotion_mouth_viseme_anchor_cue")?.sceneObjectName ?? "",
    ) as Mesh;
    expect(Object.keys(mouthOwner.morphTargetDictionary ?? {})).toEqual(expect.arrayContaining([expect.stringMatching(/^(mouth|viseme[_-])/iu)]));
    expect(records.find((record) => record.cueId === "emotion_brow_tension_cue")?.sceneObjectName).toMatch(/eyebrow/iu);
  });
});
