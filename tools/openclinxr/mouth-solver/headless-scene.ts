/**
 * Headless THREE scene for the mouth evaluator.
 *
 * Loads the parent GLB with NodeIO and rebuilds the node graph the browser
 * GLTFLoader builds: plain Groups, real Bones for skin joints, and a
 * SkinnedMesh per skinned primitive parented under its node. Mesh names follow
 * the loader convention the focus code relies on (mesh name = node name,
 * isolated-subject-focus.ts:67-69).
 *
 * Fail-closed load gates mirror the factory state the step3 capture ran
 * against: one body mesh, one fitted-teeth mesh with 4494 vertices and the
 * seven viseme targets in order, and at least one jaw-dominant teeth vertex
 * so the lab rebind (humanoid-load-guard.ts:100-112) stays a no-op. Teeth
 * skin weights are the producer's (rim transfer), so no frozen split applies.
 */
import { type Node as GltfNode, NodeIO } from "@gltf-transform/core";
import {
  deriveHeadBoxFromPoints,
  frameCamera,
  isFittedHairMeshName,
} from "@openclinxr/xr-scene";
import {
  Bone,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";

export type HeadlessMesh = {
  gltfMeshName: string;
  nodeName: string;
  base: Float32Array;
  normals: Float32Array;
  targetDeltas: Float32Array[];
  targetNames: string[];
  joints: ArrayLike<number>;
  weights: Float32Array;
  jointNodes: readonly GltfNode[];
  skinned: SkinnedMesh;
  skeleton: Skeleton;
};

export type HeadlessScene = {
  root: Group;
  body: HeadlessMesh;
  teeth: HeadlessMesh;
  headBone: Bone;
  jawBone: Bone;
};

function floatArray(accessor: { getArray: () => ArrayLike<number> | null }): Float32Array {
  const array = accessor.getArray();
  if (!array) throw new Error("empty accessor");
  return array instanceof Float32Array ? array : Float32Array.from(array);
}

function indexArray(accessor: { getArray: () => ArrayLike<number> | null }): Uint8Array | Uint16Array | Uint32Array {
  const array = accessor.getArray();
  if (!array) throw new Error("empty accessor");
  if (array instanceof Uint8Array || array instanceof Uint16Array || array instanceof Uint32Array) return array;
  return Uint16Array.from(array);
}

function dominantJointIs(joints: ArrayLike<number>, weights: ArrayLike<number>, vertex: number, wanted: number): boolean {
  let joint = joints[vertex * 4] ?? 0;
  let best = weights[vertex * 4] ?? 0;
  for (let slot = 1; slot < 4; slot += 1) {
    const next = weights[vertex * 4 + slot] ?? 0;
    if (next > best) {
      best = next;
      joint = joints[vertex * 4 + slot] ?? joint;
    }
  }
  return joint === wanted;
}

export async function loadHeadlessScene(glbPath: string): Promise<HeadlessScene> {
  const doc = await new NodeIO().read(glbPath);
  const jointNodes = new Set(doc.getRoot().listSkins().flatMap((skin) => skin.listJoints()));
  const nodeObjects = new Map<GltfNode, Bone | Group>();
  const build = (node: GltfNode): Bone | Group => {
    const object = jointNodes.has(node) ? new Bone() : new Group();
    object.name = node.getName();
    const t = node.getTranslation();
    const r = node.getRotation();
    const s = node.getScale();
    object.position.set(t[0] ?? 0, t[1] ?? 0, t[2] ?? 0);
    object.quaternion.set(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, r[3] ?? 1);
    object.scale.set(s[0] ?? 1, s[1] ?? 1, s[2] ?? 1);
    nodeObjects.set(node, object);
    for (const child of node.listChildren()) object.add(build(child));
    return object;
  };
  const root = new Group();
  root.name = "mouth_solver_headless_root";
  for (const scene of doc.getRoot().listScenes()) {
    for (const child of scene.listChildren()) root.add(build(child));
  }

  const skinnedNames = new Set<string>();
  const attach = (pattern: RegExp, label: string): HeadlessMesh => {
    const mesh = doc.getRoot().listMeshes().find((item) => pattern.test(item.getName()));
    if (!mesh) throw new Error(`${label} mesh ${pattern} missing in ${glbPath}`);
    const prim = mesh.listPrimitives()[0];
    const node = doc.getRoot().listNodes().find((item) => item.getMesh() === mesh);
    const skin = node?.getSkin();
    if (!prim || !node || !skin) throw new Error(`${mesh.getName()} has no skinned primitive`);
    const positionAccessor = prim.getAttribute("POSITION");
    if (!positionAccessor) throw new Error(`${mesh.getName()} has no POSITION attribute`);
    const base = floatArray(positionAccessor);
    const targetNames = (mesh.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
    const targets = targetNames.map((_, index) => {
      const accessor = prim.listTargets()[index]?.getAttribute("POSITION");
      return accessor ? floatArray(accessor) : new Float32Array(base.length);
    });
    const skinJoints = skin.listJoints();
    const bones = skinJoints.map((joint) => {
      const bone = nodeObjects.get(joint);
      if (!(bone instanceof Bone)) throw new Error(`joint ${joint.getName()} is not a bone`);
      return bone;
    });
    const inverses = bones.map((_, index) => {
      const ibm = skin.getInverseBindMatrices();
      if (!ibm) throw new Error("skin has no inverse bind matrices");
      return new Matrix4().fromArray(floatArray(ibm), index * 16);
    });
    const skeleton = new Skeleton(bones, inverses);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(base.slice(), 3));
    geometry.name = mesh.getName();
    const skinned = new SkinnedMesh(geometry);
    // GLTFLoader names the mesh after its node; the lab focus and the viseme
    // gain switch (teeth vs lip) both read this layer.
    skinned.name = node.getName();
    skinned.userData.name = node.getName();
    skinned.morphTargetDictionary = Object.fromEntries(targetNames.map((name, index) => [name, index]));
    skinned.morphTargetInfluences = targetNames.map(() => 0);
    skinned.bind(skeleton, new Matrix4());
    (nodeObjects.get(node) ?? root).add(skinned);
    skinnedNames.add(mesh.getName());
    const normalAccessor = prim.getAttribute("NORMAL");
    const jointsAccessor = prim.getAttribute("JOINTS_0");
    const weightsAccessor = prim.getAttribute("WEIGHTS_0");
    if (!jointsAccessor || !weightsAccessor) throw new Error(`${mesh.getName()} has no skinning attributes`);
    return {
      gltfMeshName: mesh.getName(),
      nodeName: node.getName(),
      base,
      normals: normalAccessor ? floatArray(normalAccessor) : new Float32Array(0),
      targetDeltas: targets,
      targetNames,
      joints: indexArray(jointsAccessor),
      weights: floatArray(weightsAccessor),
      jointNodes: skinJoints,
      skinned,
      skeleton,
    };
  };

  const body = attach(/_body$/i, "body");
  const teeth = attach(/fitted_teeth/i, "fitted teeth");

  // Position-only proxies for every other mesh so rest-pose traversals
  // (bounds, head focus) see the same vertex set the browser sees.
  for (const mesh of doc.getRoot().listMeshes()) {
    if (skinnedNames.has(mesh.getName())) continue;
    const prim = mesh.listPrimitives()[0];
    const node = doc.getRoot().listNodes().find((item) => item.getMesh() === mesh);
    if (!prim || !node) continue;
    const positions = prim.getAttribute("POSITION");
    if (!positions) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(floatArray(positions).slice(), 3));
    geometry.name = mesh.getName();
    const proxy = new Mesh(geometry);
    proxy.name = node.getName();
    proxy.userData.name = node.getName();
    (nodeObjects.get(node) ?? root).add(proxy);
  }

  const teethSkinJoints = teeth.jointNodes.map((joint) => joint.getName());
  const jawIndex = teethSkinJoints.findIndex((name) => /^jaw$/i.test(name ?? ""));
  const headIndex = teethSkinJoints.findIndex((name) => /^head$/i.test(name ?? ""));
  if (jawIndex < 0) throw new Error("teeth skin has no jaw joint");
  if (headIndex < 0) throw new Error("teeth skin has no head joint");
  const teethCount = teeth.base.length / 3;
  if (teethCount !== 4494) throw new Error(`teeth vertex count moved: ${teethCount}`);
  let jawDominant = false;
  for (let vertex = 0; vertex < teethCount; vertex += 1) {
    if (dominantJointIs(teeth.joints, teeth.weights, vertex, jawIndex)) {
      jawDominant = true;
      break;
    }
  }
  if (!jawDominant) {
    throw new Error("teeth have no jaw-dominant vertex: the lab rebind would fire, evaluator scene diverges");
  }

  const headBone = teeth.skeleton.bones[headIndex];
  const jawBone = teeth.skeleton.bones[jawIndex];
  if (!(headBone instanceof Bone) || !(jawBone instanceof Bone)) throw new Error("head/jaw bones missing");
  root.updateMatrixWorld(true);
  return { root, body, teeth, headBone, jawBone };
}

export type HeadFocusCamera = {
  camera: PerspectiveCamera;
  headBoxMin: [number, number, number];
  headBoxMax: [number, number, number];
};

/**
 * The isolated-subject head-focus camera for this asset.
 *
 * Point collection mirrors deriveHeadFocusBounds (isolated-subject-focus.ts:140-157):
 * rest-pose world points, hair excluded from the silhouette profile but unioned
 * for containment. The box solve and the camera placement are the shipped
 * functions (deriveHeadBoxFromPoints, frameCamera in the legacy no-view branch,
 * camera-fit-to-bounds.ts:102-115) — framing stays exact when the asset moves.
 */
export function headFocusCamera(scene: HeadlessScene): HeadFocusCamera {
  scene.root.updateMatrixWorld(true);
  const points: Array<{ x: number; y: number; z: number }> = [];
  const silhouettePoints: Array<{ x: number; y: number; z: number }> = [];
  const containPoints: Array<{ x: number; y: number; z: number }> = [];
  const point = new Vector3();
  scene.root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    const userName = (object.userData as { name?: unknown }).name;
    const geometryName = (object.geometry as unknown as { name?: unknown }).name;
    const isHair =
      isFittedHairMeshName(object.name) ||
      (typeof userName === "string" && isFittedHairMeshName(userName)) ||
      (typeof geometryName === "string" && isFittedHairMeshName(geometryName));
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      const p = { x: point.x, y: point.y, z: point.z };
      points.push(p);
      if (isHair) containPoints.push(p);
      else silhouettePoints.push(p);
    }
  });
  const derived = deriveHeadBoxFromPoints(points, { silhouettePoints, containPoints });
  if (!derived) throw new Error("focus=head unresolvable on this asset: deriveHeadBoxFromPoints returned null");
  // resolveFocus wraps the derived box the same way (isolated-subject-focus.ts:166-169).
  const frameBounds = new Box3(
    new Vector3(derived.box.min.x, derived.box.min.y, derived.box.min.z),
    new Vector3(derived.box.max.x, derived.box.max.y, derived.box.max.z),
  );
  // isolated-subject-lab.ts:476 — fov 35, aspect 1280/960, near 0.01.
  const camera = new PerspectiveCamera(35, 1280 / 960, 0.01, 100);
  frameCamera(camera, frameBounds, undefined);
  camera.updateMatrixWorld(true);
  return {
    camera,
    headBoxMin: [frameBounds.min.x, frameBounds.min.y, frameBounds.min.z],
    headBoxMax: [frameBounds.max.x, frameBounds.max.y, frameBounds.max.z],
  };
}
