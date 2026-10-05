/**
 * Fitted teeth sit just behind the lips at an open viseme.
 *
 * The pre-fix record is tools/openclinxr/evidence/parent-fitted-teeth/jaw-lip-gap.json,
 * written while the teeth primitive still had 0 morph targets (glb sha c4ceeba4…).
 * Front shell: |x| <= 0.012, clear of the teeth median by 6 mm, within 4 mm of that
 * row's max z, membership locked on the base POSITION accessor.
 * Success is the shell's mean distance to the nearest body vertex after
 * applyVisemeWeights and applyJawOpenToRoot, in [0.5, 2] mm at viseme_aa.
 * Rest distances were measured on the base mesh, jaw 0, before those morph
 * deltas were rewritten. viseme_sil at jaw 0 stays within 1 mm of that record.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Node as GltfNode } from "@gltf-transform/core";
import { Bone, BufferAttribute, BufferGeometry, Group, Matrix4, Skeleton, SkinnedMesh, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CLEAR_BAND_M,
  archFaceIndices,
  archFaceLead,
  frontShellIndices,
  frontShellMeanGap,
  jawDescendantVertexMask,
  jawWeightSum,
  planTeethVisemeTargets,
} from "../../asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts";
import {
  JAW_OPEN_TEETH_CLEAR_RADIANS,
  JAW_TEETH_GAIN,
  MOUTH_OPEN_CAP,
  applyDialogueVisemeTimelineToRoot,
  applyJawOpenToRoot,
  applyVisemeWeights,
  jawOpenRadiansForPhoneme,
} from "@openclinxr/xr-dialogue";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const GLB = path.join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb");
const MOTION_BIND = path.join(
  REPO,
  "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb",
);
const GAP = path.join(HERE, "jaw-lip-gap.json");
const STILLS = ["aa.png", "E.png", "I.png", "O.png", "U.png", "FF.png", "PP.png"];
const HEAD_MEAN = [-0.005792621030378103, -0.006766455206543516, 0.008327360995043014] as const;
const HEAD_MEAN_F32 = Array.from(new Float32Array(HEAD_MEAN));
const JAW_BY_VISEME: Readonly<Record<string, readonly [number, number, number]>> = {
  viseme_aa: [0, -0.0170043772, 0.0118826176],
  viseme_E: [0, -0.0044803734, 0.0099832366],
  viseme_I: [0, -0.0045352288, 0.0099915559],
  viseme_O: [0, -0.007212942, 0.0103976559],
  viseme_U: [0, -0.002825486, 0.0097322576],
  viseme_FF: [0, 0, 0],
  viseme_PP: [0, 0, 0],
};
const VISEME_ORDER = ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_FF", "viseme_PP"] as const;
const DRIVE_SRC = path.join(REPO, "packages/openclinxr/xr-dialogue/src/viseme-timeline-drive.ts");
const APPLY_SRC = path.join(REPO, "packages/openclinxr/xr-dialogue/src/viseme-morph-apply.ts");
const WIRE_SRC = path.join(REPO, "packages/openclinxr/xr-dialogue/src/viseme-runtime-wire.ts");
/** Sha of the parent GLB immediately before the teeth viseme accessors were appended. */
const PRE_MORPH_SHA = "c4ceeba47179ee4f7178071828de004aaa5dc0e987e21e4c9a04bc20af3f4331";
/**
 * Front-shell mean nearest-body distance at jaw 0 on the base teeth, measured
 * before the viseme morph deltas were rewritten. Metres.
 */
const RECORDED_REST_UPPER_M = 0.0070959803651845605;
const RECORDED_REST_LOWER_M = 0.01066643650740738;
const REST_TOLERANCE_M = 0.001;
const STRICT_NEGATIVE_LEAD = ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_PP", "viseme_sil"] as const;

type Loaded = {
  root: Group;
  teeth: SkinnedMesh;
  body: SkinnedMesh;
  teethSkeleton: Skeleton;
  bodySkeleton: Skeleton;
  teethPos: Float32Array;
  teethJoints: ArrayLike<number>;
  teethWeights: ArrayLike<number>;
  teethTargets: Float32Array[];
  bodyPos: Float32Array;
  bodyJoints: ArrayLike<number>;
  bodyWeights: ArrayLike<number>;
  bodyTargets: Float32Array[];
  clearLower: number[];
  clearUpper: number[];
  upperShell: number[];
  lowerShell: number[];
  jawIndex: number;
  headIndex: number;
  bodyJointNodes: GltfNode[];
  teethIndex: Uint32Array;
};

let loaded: Loaded;

function readGlbJson(filePath: string): {
  meshes?: { name?: string; extras?: { targetNames?: string[] }; primitives?: { targets?: unknown[] }[] }[];
} {
  const file = readFileSync(filePath);
  if (file.readUInt32LE(0) !== 0x46546c67) throw new Error(`${filePath} is not a glb`);
  const jsonLength = file.readUInt32LE(12);
  return JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8"));
}

function asFloat(accessor: { getArray: () => ArrayLike<number> | null }): Float32Array {
  const array = accessor.getArray();
  if (!array) throw new Error("empty accessor");
  return array instanceof Float32Array ? array : Float32Array.from(array);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

function skinMesh(
  positions: Float32Array,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  skinMatrices: ArrayLike<number>,
): Float32Array {
  const count = positions.length / 3;
  const out = new Float32Array(positions.length);
  const matrix = new Matrix4();
  const point = new Vector3();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = positions[vertex * 3] ?? 0;
    const y = positions[vertex * 3 + 1] ?? 0;
    const z = positions[vertex * 3 + 2] ?? 0;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = weights[vertex * 4 + slot] ?? 0;
      if (weight === 0) continue;
      matrix.fromArray(skinMatrices, (joints[vertex * 4 + slot] ?? 0) * 16);
      point.set(x, y, z).applyMatrix4(matrix);
      ox += weight * point.x;
      oy += weight * point.y;
      oz += weight * point.z;
    }
    out[vertex * 3] = ox;
    out[vertex * 3 + 1] = oy;
    out[vertex * 3 + 2] = oz;
  }
  return out;
}

function morphed(base: Float32Array, targets: readonly Float32Array[], influences: ArrayLike<number>): Float32Array {
  const out = new Float32Array(base);
  for (let target = 0; target < targets.length; target += 1) {
    const weight = influences[target] ?? 0;
    if (weight === 0) continue;
    const delta = targets[target]!;
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + weight * (delta[i] ?? 0);
  }
  return out;
}

function boneMatrices(root: Group, skeleton: Skeleton): Float32Array {
  root.updateMatrixWorld(true);
  skeleton.update();
  return skeleton.boneMatrices.slice();
}

function fullyOnJoint(
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  vertex: number,
  jointIndex: number,
): boolean {
  return Math.abs(jawWeightSum(joints, weights, vertex, jointIndex) - 1) < 1e-4;
}

function attachMesh(
  doc: Awaited<ReturnType<NodeIO["read"]>>,
  meshName: RegExp,
  nodeMap: Map<unknown, Bone | Group>,
  root: Group,
): {
  skinned: SkinnedMesh;
  skeleton: Skeleton;
  positions: Float32Array;
  joints: ArrayLike<number>;
  weights: ArrayLike<number>;
  targets: Float32Array[];
  names: string[];
  jointNodes: { getName: () => string }[];
  indices: Uint32Array;
} {
  const mesh = doc.getRoot().listMeshes().find((item) => meshName.test(item.getName()));
  if (!mesh) throw new Error(`mesh ${meshName} missing`);
  const prim = mesh.listPrimitives()[0];
  if (!prim) throw new Error(`${mesh.getName()} has no primitive`);
  const node = doc.getRoot().listNodes().find((item) => item.getMesh() === mesh);
  const skin = node?.getSkin();
  if (!node || !skin) throw new Error(`${mesh.getName()} has no skin`);
  const positions = asFloat(prim.getAttribute("POSITION")!);
  const joints = prim.getAttribute("JOINTS_0")!.getArray()!;
  const weights = asFloat(prim.getAttribute("WEIGHTS_0")!);
  const names = ((mesh.getExtras() as { targetNames?: string[] } | null)?.targetNames) ?? [];
  const targets = names.map((_, index) => {
    const accessor = prim.listTargets()[index]?.getAttribute("POSITION");
    if (!accessor) return new Float32Array(positions.length);
    const array = asFloat(accessor);
    if (array.length !== positions.length) throw new Error(`${mesh.getName()} target ${index} length`);
    return array;
  });
  const jointNodes = skin.listJoints();
  const bones = jointNodes.map((joint) => {
    const bone = nodeMap.get(joint);
    if (!(bone instanceof Bone)) throw new Error(`joint ${joint.getName()} is not a bone`);
    return bone;
  });
  const ibm = asFloat(skin.getInverseBindMatrices()!);
  const inverses = bones.map((_, index) => new Matrix4().fromArray(ibm, index * 16));
  const skeleton = new Skeleton(bones, inverses);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0]), 3));
  const skinned = new SkinnedMesh(geometry);
  skinned.name = mesh.getName();
  skinned.morphTargetDictionary = Object.fromEntries(names.map((name, index) => [name, index]));
  skinned.morphTargetInfluences = names.map(() => 0);
  skinned.bind(skeleton, new Matrix4());
  (nodeMap.get(node) ?? root).add(skinned);
  const indexAccessor = prim.getIndices();
  const indexArray = indexAccessor?.getArray();
  const indices = indexArray ? Uint32Array.from(indexArray) : new Uint32Array(0);
  return { skinned, skeleton, positions, joints, weights, targets, names, jointNodes, indices };
}

function buildHierarchy(doc: Awaited<ReturnType<NodeIO["read"]>>): { root: Group; nodeMap: Map<unknown, Bone | Group> } {
  const nodeMap = new Map<unknown, Bone | Group>();
  const joints = new Set(doc.getRoot().listSkins().flatMap((skin) => skin.listJoints()));
  const build = (node: {
    getName: () => string;
    getTranslation: () => number[];
    getRotation: () => number[];
    getScale: () => number[];
    listChildren: () => unknown[];
  }): Bone | Group => {
    const object = joints.has(node as never) ? new Bone() : new Group();
    object.name = node.getName();
    const translation = node.getTranslation();
    const rotation = node.getRotation();
    const scale = node.getScale();
    object.position.set(translation[0]!, translation[1]!, translation[2]!);
    object.quaternion.set(rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!);
    object.scale.set(scale[0]!, scale[1]!, scale[2]!);
    nodeMap.set(node, object);
    for (const child of node.listChildren()) object.add(build(child as Parameters<typeof build>[0]));
    return object;
  };
  const root = new Group();
  for (const scene of doc.getRoot().listScenes()) {
    for (const child of scene.listChildren()) root.add(build(child as Parameters<typeof build>[0]));
  }
  root.updateMatrixWorld(true);
  return { root, nodeMap };
}

function teethPosed(state: Loaded): Float32Array {
  return skinMesh(
    morphed(state.teethPos, state.teethTargets, state.teeth.morphTargetInfluences),
    state.teethJoints,
    state.teethWeights,
    boneMatrices(state.root, state.teethSkeleton),
  );
}

function bodyPosed(state: Loaded): Float32Array {
  return skinMesh(
    morphed(state.bodyPos, state.bodyTargets, state.body.morphTargetInfluences),
    state.bodyJoints,
    state.bodyWeights,
    boneMatrices(state.root, state.bodySkeleton),
  );
}

function shellGaps(state: Loaded): { upperM: number; lowerM: number } {
  const teethWorld = teethPosed(state);
  const bodyWorld = bodyPosed(state);
  return {
    upperM: frontShellMeanGap(teethWorld, state.upperShell, bodyWorld).meanM,
    lowerM: frontShellMeanGap(teethWorld, state.lowerShell, bodyWorld).meanM,
  };
}

function poseNamed(state: Loaded, name: string): { teethWorld: Float32Array; bodyWorld: Float32Array } {
  state.teeth.morphTargetInfluences.fill(0);
  state.body.morphTargetInfluences.fill(0);
  applyVisemeWeights(state.teeth, { [name]: 1 });
  applyVisemeWeights(state.body, { [name]: 1 });
  applyJawOpenToRoot(state.root, jawOpenRadiansForPhoneme(name.replace(/^viseme_/i, "")));
  return { teethWorld: teethPosed(state), bodyWorld: bodyPosed(state) };
}

describe("parent fitted teeth follow the lip viseme", () => {
  beforeAll(async () => {
    const doc = await new NodeIO().read(GLB);
    const { root, nodeMap } = buildHierarchy(doc);
    const teeth = attachMesh(doc, /fitted_teeth/i, nodeMap, root);
    const body = attachMesh(doc, /_body$/i, nodeMap, root);
    const ys: number[] = [];
    for (let vertex = 0; vertex < teeth.positions.length / 3; vertex += 1) ys.push(teeth.positions[vertex * 3 + 1] ?? 0);
    const mid = median(ys);
    const jawIndex = teeth.jointNodes.findIndex((joint) => joint.getName() === "jaw");
    const headIndex = teeth.jointNodes.findIndex((joint) => joint.getName() === "head");
    const clearLower: number[] = [];
    const clearUpper: number[] = [];
    for (let vertex = 0; vertex < ys.length; vertex += 1) {
      const y = ys[vertex] ?? 0;
      if (y < mid - CLEAR_BAND_M) clearLower.push(vertex);
      if (y > mid + CLEAR_BAND_M) clearUpper.push(vertex);
    }
    const shells = frontShellIndices(teeth.positions);
    loaded = {
      root,
      teeth: teeth.skinned,
      body: body.skinned,
      teethSkeleton: teeth.skeleton,
      bodySkeleton: body.skeleton,
      teethPos: teeth.positions,
      teethJoints: teeth.joints,
      teethWeights: teeth.weights,
      teethTargets: teeth.targets,
      bodyPos: body.positions,
      bodyJoints: body.joints,
      bodyWeights: body.weights,
      bodyTargets: body.targets,
      clearLower,
      clearUpper,
      upperShell: shells.upper,
      lowerShell: shells.lower,
      jawIndex,
      headIndex,
      bodyJointNodes: body.jointNodes as GltfNode[],
      teethIndex: teeth.indices,
    };
  }, 120_000);

  it("records the pre-morph gap below 0.8 against the bytes from before the teeth targets existed", () => {
    const gap = JSON.parse(readFileSync(GAP, "utf8")) as {
      writtenBeforeTeethVisemeMorph: boolean;
      teethMorphTargetCount: number;
      magnitudeRatio: number;
      glbSha256: string;
      clearLower: { count: number; allWeightedToJawAt1: boolean };
      clearUpper: { count: number; allWeightedToHeadAt1: boolean };
    };
    const liveSha = createHash("sha256").update(readFileSync(GLB)).digest("hex");
    expect(gap.writtenBeforeTeethVisemeMorph).toBe(true);
    expect(gap.teethMorphTargetCount).toBe(0);
    expect(gap.glbSha256).toBe(PRE_MORPH_SHA);
    expect(liveSha).not.toBe(PRE_MORPH_SHA);
    expect(gap.magnitudeRatio).toBeLessThan(0.8);
    expect(gap.clearLower.count).toBe(910);
    expect(gap.clearLower.allWeightedToJawAt1).toBe(true);
    expect(gap.clearUpper.count).toBe(716);
    expect(gap.clearUpper.allWeightedToHeadAt1).toBe(true);
  });

  it("does not change the jaw aperture constant or the mouth-open cap, and does not add a second jaw constant", () => {
    expect(readFileSync(DRIVE_SRC, "utf8")).toContain(
      "export const JAW_OPEN_TEETH_CLEAR_RADIANS = Math.asin(0.020725011825561523 / 0.137901);",
    );
    expect(readFileSync(APPLY_SRC, "utf8")).toContain("export const MOUTH_OPEN_CAP = 0.3;");
    expect(JAW_OPEN_TEETH_CLEAR_RADIANS).toBeCloseTo(Math.asin(0.020725011825561523 / 0.137901), 12);
    expect(MOUTH_OPEN_CAP).toBe(0.3);
    expect(readFileSync(WIRE_SRC, "utf8")).not.toMatch(/export const JAW_OPEN/);
  });

  it("writes one jaw vector per viseme and one head mean on viseme_aa", async () => {
    const plan = await planTeethVisemeTargets(GLB);
    const names = Object.keys(loaded.teeth.morphTargetDictionary ?? {});
    expect(names).toEqual([...VISEME_ORDER]);
    expect(plan.targets.map((target) => target.name)).toEqual([...VISEME_ORDER]);
    expect(names).not.toContain("viseme_sil");
    expect(names.some((name) => name.toLowerCase() === "mouth-open")).toBe(false);
    const jawWeighted = new Set(plan.jawWeighted);
    const headWeighted = new Set(plan.headWeighted);
    expect(jawWeighted.size).toBe(2180);
    expect(headWeighted.size).toBe(2314);
    expect([...jawWeighted].some((vertex) => headWeighted.has(vertex))).toBe(false);
    const aa = plan.targets[0]!;
    expect(aa.jawDelta).toEqual([...JAW_BY_VISEME.viseme_aa]);
    expect(aa.headDelta).toEqual([HEAD_MEAN[0], HEAD_MEAN[1], HEAD_MEAN[2]]);
    const aaJaw = Array.from(new Float32Array(JAW_BY_VISEME.viseme_aa));
    for (const vertex of jawWeighted) {
      expect(aa.delta[vertex * 3] ?? 0).toBe(aaJaw[0]);
      expect(aa.delta[vertex * 3 + 1] ?? 0).toBe(aaJaw[1]);
      expect(aa.delta[vertex * 3 + 2] ?? 0).toBe(aaJaw[2]);
    }
    const seen = new Set<string>();
    for (const vertex of headWeighted) {
      const dx = aa.delta[vertex * 3] ?? 0;
      const dy = aa.delta[vertex * 3 + 1] ?? 0;
      const dz = aa.delta[vertex * 3 + 2] ?? 0;
      expect(dx).toBe(HEAD_MEAN_F32[0]);
      expect(dy).toBe(HEAD_MEAN_F32[1]);
      expect(dz).toBe(HEAD_MEAN_F32[2]);
      seen.add(`${dx},${dy},${dz}`);
    }
    expect(seen.size).toBe(1);
    for (const target of plan.targets.slice(1)) {
      const jaw = Array.from(new Float32Array(JAW_BY_VISEME[target.name]!));
      expect(target.jawDelta).toEqual([...JAW_BY_VISEME[target.name]!]);
      expect(target.headDelta).toEqual([0, 0, 0]);
      for (const vertex of jawWeighted) {
        expect(target.delta[vertex * 3] ?? 0).toBe(jaw[0]);
        expect(target.delta[vertex * 3 + 1] ?? 0).toBe(jaw[1]);
        expect(target.delta[vertex * 3 + 2] ?? 0).toBe(jaw[2]);
      }
      for (const vertex of headWeighted) {
        expect(target.delta[vertex * 3] ?? 0).toBe(0);
        expect(target.delta[vertex * 3 + 1] ?? 0).toBe(0);
        expect(target.delta[vertex * 3 + 2] ?? 0).toBe(0);
      }
    }
    for (let vertex = 0; vertex < loaded.teethPos.length / 3; vertex += 1) {
      if (jawWeighted.has(vertex) || headWeighted.has(vertex)) continue;
      expect(aa.delta[vertex * 3] ?? 0).toBe(0);
      expect(aa.delta[vertex * 3 + 1] ?? 0).toBe(0);
      expect(aa.delta[vertex * 3 + 2] ?? 0).toBe(0);
    }
    const index = loaded.teeth.morphTargetDictionary?.["viseme_aa"];
    expect(index, "viseme_aa").toBeTypeOf("number");
    expect(loaded.teethTargets[index!]!.length).toBe(aa.delta.length);
  }, 300_000);

  it("keeps clear lower verts at jaw weight 1 and clear upper verts at head weight 1", () => {
    expect(loaded.clearLower).toHaveLength(910);
    expect(loaded.clearUpper).toHaveLength(716);
    for (const vertex of loaded.clearLower) {
      expect(fullyOnJoint(loaded.teethJoints, loaded.teethWeights, vertex, loaded.jawIndex)).toBe(true);
    }
    for (const vertex of loaded.clearUpper) {
      expect(fullyOnJoint(loaded.teethJoints, loaded.teethWeights, vertex, loaded.headIndex)).toBe(true);
    }
  });

  it("stays within 1 mm of the recorded rest distances at viseme_sil and jaw 0", () => {
    expect(loaded.body.morphTargetDictionary).toHaveProperty("viseme_sil");
    expect(loaded.teeth.morphTargetDictionary).not.toHaveProperty("viseme_sil");
    loaded.teeth.morphTargetInfluences.fill(0);
    loaded.body.morphTargetInfluences.fill(0);
    applyJawOpenToRoot(loaded.root, 0);
    const rest = shellGaps(loaded);
    expect(Math.abs(rest.upperM - RECORDED_REST_UPPER_M)).toBeLessThanOrEqual(REST_TOLERANCE_M);
    expect(Math.abs(rest.lowerM - RECORDED_REST_LOWER_M)).toBeLessThanOrEqual(REST_TOLERANCE_M);
    applyVisemeWeights(loaded.teeth, { viseme_sil: 1 });
    applyVisemeWeights(loaded.body, { viseme_sil: 1 });
    applyJawOpenToRoot(loaded.root, 0);
    expect(loaded.teeth.morphTargetInfluences.every((weight: number) => weight === 0)).toBe(true);
    const gaps = shellGaps(loaded);
    expect(Math.abs(gaps.upperM - RECORDED_REST_UPPER_M)).toBeLessThanOrEqual(REST_TOLERANCE_M);
    expect(Math.abs(gaps.lowerM - RECORDED_REST_LOWER_M)).toBeLessThanOrEqual(REST_TOLERANCE_M);
  });

  it("writes the teeth viseme_aa weight from the dialogue applier and does not force mouth-open to 1", () => {
    loaded.teeth.morphTargetInfluences.fill(0);
    loaded.body.morphTargetInfluences.fill(0);
    const result = applyDialogueVisemeTimelineToRoot(loaded.root, { phonemeSequence: ["AA"], progress: 0 });
    expect(result.activeTargetName).toBe("viseme_aa");
    expect(result.weights.viseme_aa).toBe(1);
    expect(result.weights["mouth-open"] ?? 0).not.toBe(1);
    expect(loaded.teeth.morphTargetInfluences[loaded.teeth.morphTargetDictionary!.viseme_aa!] ?? 0).toBe(JAW_TEETH_GAIN);
    const mouth = loaded.body.morphTargetDictionary?.["mouth-open"];
    if (mouth !== undefined) expect(loaded.body.morphTargetInfluences[mouth]).not.toBe(1);
    expect(result.appliedMeshCount).toBeGreaterThanOrEqual(2);
  });

  it("keeps the head-focus stills at 1280 by 960", () => {
    for (const name of STILLS) {
      const file = readFileSync(path.join(HERE, "visemes", name));
      expect(file.subarray(0, 8).toString("hex"), name).toBe("89504e470d0a1a0a");
      expect(file.readUInt32BE(16), name).toBe(1280);
      expect(file.readUInt32BE(20), name).toBe(960);
    }
  });

  it("keeps every arch-face crown behind the skin", () => {
    const jawSkin = jawDescendantVertexMask(loaded.bodyJoints, loaded.bodyWeights, loaded.bodyJointNodes);
    expect(jawSkin.some((bit) => bit === 1)).toBe(true);
    const names = ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_FF", "viseme_PP", "viseme_sil"];
    const rows = names.map((name) => {
      const posed = poseNamed(loaded, name);
      const face = archFaceIndices(loaded.teethPos, posed.teethWorld);
      return {
        name,
        upperCount: face.upper.length,
        lowerCount: face.lower.length,
        lowerVsAny: archFaceLead(posed.teethWorld, face.lower, posed.bodyWorld, null),
        lowerVsJaw: archFaceLead(posed.teethWorld, face.lower, posed.bodyWorld, jawSkin),
        upperVsAny: archFaceLead(posed.teethWorld, face.upper, posed.bodyWorld, null),
      };
    });
    expect(rows.every((row) => row.lowerCount > 0 && row.upperCount > 0)).toBe(true);
    const failures: string[] = [];
    for (const row of rows) {
      if ((STRICT_NEGATIVE_LEAD as readonly string[]).includes(row.name)) {
        if (!(row.lowerVsJaw.max < 0)) failures.push(`${row.name} lower max ${row.lowerVsJaw.max} (limit < 0)`);
        if (!(row.upperVsAny.max < 0)) failures.push(`${row.name} upper max ${row.upperVsAny.max} (limit < 0)`);
      } else if (row.name === "viseme_FF") {
        if (!(row.lowerVsJaw.max <= 0)) failures.push(`${row.name} lower max ${row.lowerVsJaw.max} (limit <= 0)`);
        if (!(row.upperVsAny.max <= 0)) failures.push(`${row.name} upper max ${row.upperVsAny.max} (limit <= 0)`);
      }
    }
    console.log(JSON.stringify(rows.map((row) => ({ name: row.name, lowerVsAnyMax: row.lowerVsAny.max, lowerVsJawMax: row.lowerVsJaw.max, upperVsAnyMax: row.upperVsAny.max }))));
    expect(failures, JSON.stringify(rows)).toEqual([]);
  }, 120_000);

  it("does not require the motion-bind copy, which has no fitted teeth mesh", () => {
    const meshes = readGlbJson(MOTION_BIND).meshes ?? [];
    const fitted = meshes.filter((mesh) => /fitted_teeth/i.test(mesh.name ?? ""));
    expect(meshes.some((mesh) => /teeth/i.test(mesh.name ?? ""))).toBe(true);
    for (const mesh of fitted) {
      const names = mesh.extras?.targetNames ?? [];
      expect(names, `${mesh.name} is a fitted teeth copy and must carry viseme_aa`).toContain("viseme_aa");
      expect(names).not.toContain("mouth-open");
    }
  });
});
