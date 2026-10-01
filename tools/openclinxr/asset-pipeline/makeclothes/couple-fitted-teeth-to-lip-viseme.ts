/**
 * Couple a fitted-teeth primitive to the body viseme targets.
 *
 * The fitted lower teeth are weighted to the jaw and ship with no morph, so a
 * lip viseme leaves them behind the lip. For each body `viseme_*` target whose
 * lower-lip landmark has at least 20 vertices, write one POSITION morph on the
 * teeth primitive: vertices with jaw weight >= 0.5 translate by that landmark's
 * centroid delta, and every other tooth vertex gets delta 0. No `mouth-open`
 * target is added. Skin weights are not changed.
 *
 * Landmark, measured on the parent body primitive 0 before this morph existed:
 * |x| <= 0.03, y in [1.448, 1.488], morph delta y < -2 mm, and the dominant
 * joint is `jaw` or a descendant of `jaw`.
 *
 * Run: pnpm exec tsx tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts <glb>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeIO, type Node as GltfNode } from "@gltf-transform/core";

export const LOWER_LIP_ABS_X_MAX = 0.03;
export const LOWER_LIP_Y_MIN = 1.448;
export const LOWER_LIP_Y_MAX = 1.488;
export const LOWER_LIP_DELTA_Y_BELOW = -0.002;
export const LOWER_LIP_MIN_VERTS = 20;
export const CLEAR_BAND_M = 0.006;
export const JAW_WEIGHT_MIN = 0.5;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;
const FLOAT = 5126;
const ARRAY_BUFFER = 34962;

type Vec3 = [number, number, number];

export function isJawDescendant(node: GltfNode): boolean {
  const seen = new Set<GltfNode>();
  let current: GltfNode | null = node;
  while (current && !seen.has(current)) {
    if (current.getName() === "jaw") return true;
    seen.add(current);
    current = current.getParentNode();
  }
  return false;
}

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

function dominantJoint(joints: ArrayLike<number>, weights: ArrayLike<number>, vertex: number): number {
  let joint = joints[vertex * 4] ?? 0;
  let weight = weights[vertex * 4] ?? 0;
  for (let slot = 1; slot < 4; slot += 1) {
    const next = weights[vertex * 4 + slot] ?? 0;
    if (next > weight) {
      weight = next;
      joint = joints[vertex * 4 + slot] ?? joint;
    }
  }
  return joint;
}

export function jawWeightSum(joints: ArrayLike<number>, weights: ArrayLike<number>, vertex: number, jawIndex: number): number {
  let sum = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    if (joints[vertex * 4 + slot] === jawIndex) sum += weights[vertex * 4 + slot] ?? 0;
  }
  return sum;
}

function centroid(deltas: Float32Array, indices: readonly number[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const index of indices) {
    x += deltas[index * 3] ?? 0;
    y += deltas[index * 3 + 1] ?? 0;
    z += deltas[index * 3 + 2] ?? 0;
  }
  const count = indices.length || 1;
  return [x / count, y / count, z / count];
}

export function lowerLipLandmark(
  positions: Float32Array,
  deltas: Float32Array,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  jointNodes: readonly GltfNode[],
): number[] {
  const indices: number[] = [];
  const count = positions.length / 3;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = positions[vertex * 3] ?? 0;
    const y = positions[vertex * 3 + 1] ?? 0;
    if (Math.abs(x) > LOWER_LIP_ABS_X_MAX) continue;
    if (y < LOWER_LIP_Y_MIN || y > LOWER_LIP_Y_MAX) continue;
    if ((deltas[vertex * 3 + 1] ?? 0) >= LOWER_LIP_DELTA_Y_BELOW) continue;
    const joint = jointNodes[dominantJoint(joints, weights, vertex)];
    if (!joint || !isJawDescendant(joint)) continue;
    indices.push(vertex);
  }
  return indices;
}

export type TeethVisemeTarget = {
  name: string;
  landmarkCount: number;
  delta: Vec3;
};

/** Rigid jaw-weighted teeth deltas for every body viseme whose landmark is large enough. */
export async function planTeethVisemeTargets(glbPath: string): Promise<{
  teethName: string;
  targets: TeethVisemeTarget[];
  jawWeighted: number[];
  teethCount: number;
}> {
  const doc = await new NodeIO().read(glbPath);
  const meshes = doc.getRoot().listMeshes();
  const teeth = meshes.find((mesh) => /fitted_teeth/i.test(mesh.getName()));
  if (!teeth) throw new Error(`no fitted teeth mesh in ${glbPath}`);
  const body = meshes.find((mesh) => /_body$/i.test(mesh.getName()));
  if (!body) throw new Error(`no body mesh in ${glbPath}`);
  const bodyPrim = body.listPrimitives()[0];
  const teethPrim = teeth.listPrimitives()[0];
  if (!bodyPrim || !teethPrim) throw new Error("missing primitive 0");
  const names = (body.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
  const bodyPos = floatArray(bodyPrim.getAttribute("POSITION")!);
  const bodyJoints = indexArray(bodyPrim.getAttribute("JOINTS_0")!);
  const bodyWeights = floatArray(bodyPrim.getAttribute("WEIGHTS_0")!);
  const bodyNode = doc.getRoot().listNodes().find((node) => node.getMesh() === body);
  const jointNodes = bodyNode?.getSkin()?.listJoints() ?? [];
  if (jointNodes.length === 0) throw new Error("body skin has no joints");

  const teethPos = floatArray(teethPrim.getAttribute("POSITION")!);
  const teethJoints = indexArray(teethPrim.getAttribute("JOINTS_0")!);
  const teethWeights = floatArray(teethPrim.getAttribute("WEIGHTS_0")!);
  const teethNode = doc.getRoot().listNodes().find((node) => node.getMesh() === teeth);
  const teethJointsNodes = teethNode?.getSkin()?.listJoints() ?? [];
  const jawIndex = teethJointsNodes.findIndex((joint) => joint.getName() === "jaw");
  if (jawIndex < 0) throw new Error("teeth skin has no jaw joint");
  const jawWeighted: number[] = [];
  for (let vertex = 0; vertex < teethPos.length / 3; vertex += 1) {
    if (jawWeightSum(teethJoints, teethWeights, vertex, jawIndex) >= JAW_WEIGHT_MIN) jawWeighted.push(vertex);
  }

  const targets: TeethVisemeTarget[] = [];
  for (const name of names) {
    if (!name.toLowerCase().startsWith("viseme_")) continue;
    const target = bodyPrim.listTargets()[names.indexOf(name)];
    const accessor = target?.getAttribute("POSITION");
    if (!accessor) continue;
    const deltas = floatArray(accessor);
    const landmark = lowerLipLandmark(bodyPos, deltas, bodyJoints, bodyWeights, jointNodes);
    if (landmark.length < LOWER_LIP_MIN_VERTS) continue;
    targets.push({ name, landmarkCount: landmark.length, delta: centroid(deltas, landmark) });
  }
  return { teethName: teeth.getName(), targets, jawWeighted, teethCount: teethPos.length / 3 };
}

function teethDelta(count: number, jawWeighted: readonly number[], delta: Vec3): Float32Array {
  const out = new Float32Array(count * 3);
  for (const vertex of jawWeighted) {
    out[vertex * 3] = delta[0];
    out[vertex * 3 + 1] = delta[1];
    out[vertex * 3 + 2] = delta[2];
  }
  return out;
}

function bounds(values: Float32Array): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = values[i + axis] ?? 0;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

/** Append teeth viseme morphs. Existing BIN bytes are kept; only the new targets are added. */
export async function coupleFittedTeethToLipViseme(glbPath: string): Promise<TeethVisemeTarget[]> {
  const plan = await planTeethVisemeTargets(glbPath);
  if (plan.targets.length === 0) throw new Error(`no viseme landmark cleared ${LOWER_LIP_MIN_VERTS} verts in ${glbPath}`);
  if (plan.targets.some((target) => target.name === "mouth-open")) {
    throw new Error("refusing to add a mouth-open teeth target");
  }

  const file = readFileSync(glbPath);
  if (file.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a glb");
  const jsonLength = file.readUInt32LE(12);
  if (file.readUInt32LE(16) !== GLB_JSON) throw new Error("missing JSON chunk");
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8")) as {
    buffers: { byteLength: number }[];
    bufferViews: { buffer: number; byteOffset: number; byteLength: number; target?: number }[];
    accessors: Record<string, unknown>[];
    meshes: {
      name?: string;
      extras?: { targetNames?: string[] };
      primitives: { targets?: { POSITION: number }[] }[];
    }[];
  };
  const binHeader = 20 + jsonLength;
  if (file.readUInt32LE(binHeader + 4) !== GLB_BIN) throw new Error("missing BIN chunk");
  const binLength = json.buffers[0]?.byteLength;
  if (typeof binLength !== "number") throw new Error("missing buffer length");
  let bin = Buffer.from(file.subarray(binHeader + 8, binHeader + 8 + binLength));

  const teeth = json.meshes.find((mesh) => mesh.name === plan.teethName);
  const primitive = teeth?.primitives[0];
  if (!teeth || !primitive) throw new Error(`teeth mesh ${plan.teethName} missing from JSON`);
  const existing = teeth.extras?.targetNames ?? [];
  if (existing.some((name) => name.toLowerCase().startsWith("viseme_"))) {
    throw new Error(`${plan.teethName} already has viseme targets`);
  }

  if (bin.length % 4 !== 0) {
    bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
  }
  const targets: { POSITION: number }[] = [];
  const targetNames: string[] = [];
  for (const planned of plan.targets) {
    const values = teethDelta(plan.teethCount, plan.jawWeighted, planned.delta);
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
    const { min, max } = bounds(values);
    const view = json.bufferViews.length;
    json.bufferViews.push({
      buffer: 0,
      byteOffset: bin.length,
      byteLength: bytes.length,
      target: ARRAY_BUFFER,
    });
    const accessor = json.accessors.length;
    json.accessors.push({
      bufferView: view,
      byteOffset: 0,
      componentType: FLOAT,
      count: plan.teethCount,
      type: "VEC3",
      min,
      max,
    });
    targets.push({ POSITION: accessor });
    targetNames.push(planned.name);
    bin = Buffer.concat([bin, bytes]);
  }
  primitive.targets = targets;
  teeth.extras = { ...(teeth.extras ?? {}), targetNames };
  json.buffers[0]!.byteLength = bin.length;

  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = binPad === 0 ? bin : Buffer.concat([bin, Buffer.alloc(binPad)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(GLB_JSON, 16);
  jsonChunk.copy(out, 20);
  const binAt = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, binAt);
  out.writeUInt32LE(GLB_BIN, binAt + 4);
  binChunk.copy(out, binAt + 8);
  writeFileSync(glbPath, out);
  return plan.targets;
}

async function main(): Promise<void> {
  const glbPath = process.argv[2];
  if (!glbPath) throw new Error("usage: couple-fitted-teeth-to-lip-viseme.ts <glb>");
  const targets = await coupleFittedTeethToLipViseme(glbPath);
  process.stdout.write(`${JSON.stringify({ glbPath, targets }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
