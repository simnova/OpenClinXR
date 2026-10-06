/**
 * FF pressed lips (operator 2026-10-06: FF stays pressed lips on this rig).
 *
 * The ae7396f2f cover-behind tuck drove the lower lip behind the incisors
 * (11.95 mm adjacent-edge jump at 2.34x the 5.102 SS max, LM-interior
 * inversions, a 14 mm Z trough behind a 5 mm Y slit) and the 69a2fb016
 * incisal-edge contact cliffed on its own (10.55 mm, 2.07x SS). The
 * producer press retires both: the lower outer curtain edge meets the
 * upper-lip edge to the 0.2 mm render target with a cosine BFS-ring
 * falloff, head-joint verts pinned. Every gate below poses the committed
 * bytes through the runtime's own appliers (applyVisemeWeights shape via
 * the shipped deltas, applyJawOpenToRoot) or the headless probe; no
 * browser capture is iterated on (mouth-tuning skill).
 *
 * Lip-edge rules (same stated rules as the producer): the upper edge is
 * the lowest posed-y dominant-head body vert inside the incisal x-span and
 * forward of the incisor front face; the lower outer edge is the
 * lower-curtain vert nearest the upper edge inside the central half-span
 * band (full span fallback), forward of the face, below the upper edge,
 * dominant joint not head. Gap is signed vertical (upper minus lower):
 * positive parts the slit, negative overlaps it.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { Matrix4, Vector3 } from "three";
import { describe, expect, it, beforeAll } from "vitest";
import { applyJawOpenToRoot } from "@openclinxr/xr-dialogue/viseme-runtime";
import { jawOpenRadiansForPhoneme } from "@openclinxr/xr-dialogue/viseme-timeline";
import {
  frontShellIndices,
  lowerLipLandmark,
} from "../asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.js";
import {
  loadProducerPreimage,
  readProducerReceipt,
} from "../asset-pipeline/makeclothes/producer-preimage.js";
import { loadHeadlessScene } from "./headless-scene.js";
import { evaluate, probePremise, readEvaluatorTrack } from "./mouth-evaluator.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const GLB = path.join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb");
const GLB_REL = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb";
const RECEIPT_REL = `${GLB_REL.slice(0, -".glb".length)}.provenance.json`;
const STEP3_TRACK = path.join(REPO, "docs/openclinxr/mouth-dynamics/step3/metrics.json");

/** Central slit seal band (mm, signed vertical). */
const GAP_BAND_MM = 0.5;
/** Reach-band allowance at weight 0.9 (linearity: ~10% of the 1.5 mm press travel). */
const REACH_BAND_MM = 0.75;
/** Lane adjacent-jump gate: the SS max (replicated metric, calibrated below). */
const JUMP_GATE_MM = 5.102;

function asFloat(accessor: { getArray: () => ArrayLike<number> | null }): Float32Array {
  const array = accessor.getArray();
  if (!array) throw new Error("empty accessor");
  return array instanceof Float32Array ? array : Float32Array.from(array);
}

type BodyDoc = {
  base: Float32Array;
  joints: ArrayLike<number>;
  weights: Float32Array;
  jointNames: (string | undefined)[];
  index: number[];
  names: string[];
  deltas: Map<string, Float32Array>;
  teethBase: Float32Array;
  teethJoints: ArrayLike<number>;
  teethWeights: Float32Array;
  teethNames: string[];
  teethDeltas: Map<string, Float32Array>;
};

async function readDoc(glbPath: string): Promise<BodyDoc> {
  const doc = await new NodeIO().read(glbPath);
  const body = doc.getRoot().listMeshes().find((mesh) => /_body$/i.test(mesh.getName()));
  const teeth = doc.getRoot().listMeshes().find((mesh) => /fitted_teeth/i.test(mesh.getName()));
  const bodyPrim = body?.listPrimitives()[0];
  const teethPrim = teeth?.listPrimitives()[0];
  if (!body || !bodyPrim || !teeth || !teethPrim) throw new Error(`no body/teeth mesh in ${glbPath}`);
  const base = asFloat(bodyPrim.getAttribute("POSITION")!);
  const joints = bodyPrim.getAttribute("JOINTS_0")!.getArray()!;
  const weights = asFloat(bodyPrim.getAttribute("WEIGHTS_0")!);
  const bodyNode = doc.getRoot().listNodes().find((node) => node.getMesh() === body);
  const jointNames = bodyNode?.getSkin()?.listJoints().map((joint) => joint.getName()) ?? [];
  const index = Array.from(bodyPrim.getIndices()!.getArray()!);
  const names = ((body.getExtras() as { targetNames?: string[] } | null)?.targetNames) ?? [];
  const deltas = new Map<string, Float32Array>();
  names.forEach((name, targetIndex) => {
    const accessor = bodyPrim.listTargets()[targetIndex]?.getAttribute("POSITION");
    deltas.set(name, accessor ? asFloat(accessor) : new Float32Array(base.length));
  });
  const teethBase = asFloat(teethPrim.getAttribute("POSITION")!);
  const teethJoints = teethPrim.getAttribute("JOINTS_0")!.getArray()!;
  const teethWeights = asFloat(teethPrim.getAttribute("WEIGHTS_0")!);
  const teethNames = ((teeth.getExtras() as { targetNames?: string[] } | null)?.targetNames) ?? [];
  const teethDeltas = new Map<string, Float32Array>();
  teethNames.forEach((name, targetIndex) => {
    const accessor = teethPrim.listTargets()[targetIndex]?.getAttribute("POSITION");
    teethDeltas.set(name, accessor ? asFloat(accessor) : new Float32Array(teethBase.length));
  });
  return { base, joints, weights, jointNames, index, names, deltas, teethBase, teethJoints, teethWeights, teethNames, teethDeltas };
}

function dominantJointName(body: BodyDoc, vertex: number): string {
  let joint = body.joints[vertex * 4] ?? 0;
  let best = body.weights[vertex * 4] ?? 0;
  for (let slot = 1; slot < 4; slot += 1) {
    const next = body.weights[vertex * 4 + slot] ?? 0;
    if (next > best) {
      best = next;
      joint = body.joints[vertex * 4 + slot] ?? joint;
    }
  }
  return (body.jointNames[joint] ?? "").toLowerCase();
}

const isHeadVertex = (body: BodyDoc, vertex: number): boolean =>
  /^head$/i.test(dominantJointName(body, vertex) ?? "");

let doc: BodyDoc;
let pre: BodyDoc;
let scene: Awaited<ReturnType<typeof loadHeadlessScene>>;
let edgeX0 = Infinity;
let edgeX1 = -Infinity;
let frontFace = -Infinity;
let edgeCX = 0;
let halfSpan = 0;

function skinPositions(base: Float32Array, mats: Float32Array): Float32Array {
  const out = new Float32Array(base.length);
  const matrix = new Matrix4();
  const point = new Vector3();
  for (let vertex = 0; vertex < base.length / 3; vertex += 1) {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = scene.body.weights[vertex * 4 + slot] ?? 0;
      if (weight === 0) continue;
      matrix.fromArray(mats, (scene.body.joints[vertex * 4 + slot] ?? 0) * 16);
      point.set(base[vertex * 3] ?? 0, base[vertex * 3 + 1] ?? 0, base[vertex * 3 + 2] ?? 0).applyMatrix4(matrix);
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

/** Head-local teeth positions at FF weight w and the FF jaw angle. */
function teethHeadLocal(weight: number): Float32Array {
  const ff = doc.teethDeltas.get("viseme_FF") ?? new Float32Array(doc.teethBase.length);
  const morphed = new Float32Array(doc.teethBase);
  for (let i = 0; i < morphed.length; i += 1) morphed[i] = (morphed[i] ?? 0) + weight * (ff[i] ?? 0);
  applyJawOpenToRoot(scene.root, jawOpenRadiansForPhoneme("FF"));
  scene.root.updateMatrixWorld(true);
  scene.teeth.skeleton.update();
  const mats = scene.teeth.skeleton.boneMatrices?.slice();
  if (!mats) throw new Error("no teeth bone matrices");
  const out = new Float32Array(morphed.length);
  const matrix = new Matrix4();
  const point = new Vector3();
  for (let vertex = 0; vertex < morphed.length / 3; vertex += 1) {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const w = scene.teeth.weights[vertex * 4 + slot] ?? 0;
      if (w === 0) continue;
      matrix.fromArray(mats, (scene.teeth.joints[vertex * 4 + slot] ?? 0) * 16);
      point.set(morphed[vertex * 3] ?? 0, morphed[vertex * 3 + 1] ?? 0, morphed[vertex * 3 + 2] ?? 0).applyMatrix4(matrix);
      ox += w * point.x;
      oy += w * point.y;
      oz += w * point.z;
    }
    out[vertex * 3] = ox;
    out[vertex * 3 + 1] = oy;
    out[vertex * 3 + 2] = oz;
  }
  const inv = new Matrix4().copy(scene.headBone.matrixWorld).invert();
  const head = new Float32Array(out.length);
  for (let v = 0; v < out.length / 3; v += 1) {
    point.set(out[v * 3] ?? 0, out[v * 3 + 1] ?? 0, out[v * 3 + 2] ?? 0).applyMatrix4(inv);
    head[v * 3] = point.x;
    head[v * 3 + 1] = point.y;
    head[v * 3 + 2] = point.z;
  }
  return head;
}

/** Head-local body positions at FF weight w and an explicit jaw angle
 * (defaults to the FF lookup: the static press pose). */
function posedHeadLocal(weight: number, jawRadians: number = jawOpenRadiansForPhoneme("FF")): Float32Array {
  const ff = doc.deltas.get("viseme_FF") ?? new Float32Array(doc.base.length);
  const morphed = new Float32Array(doc.base);
  for (let i = 0; i < morphed.length; i += 1) morphed[i] = (morphed[i] ?? 0) + weight * (ff[i] ?? 0);
  applyJawOpenToRoot(scene.root, jawRadians);
  scene.root.updateMatrixWorld(true);
  scene.body.skeleton.update();
  const mats = scene.body.skeleton.boneMatrices?.slice();
  if (!mats) throw new Error("no body bone matrices");
  const world = skinPositions(morphed, mats);
  const inv = new Matrix4().copy(scene.headBone.matrixWorld).invert();
  const point = new Vector3();
  const head = new Float32Array(world.length);
  for (let v = 0; v < world.length / 3; v += 1) {
    point.set(world[v * 3] ?? 0, world[v * 3 + 1] ?? 0, world[v * 3 + 2] ?? 0).applyMatrix4(inv);
    head[v * 3] = point.x;
    head[v * 3 + 1] = point.y;
    head[v * 3 + 2] = point.z;
  }
  return head;
}

function upperVert(head: Float32Array): number {
  let best = -1;
  let bestY = Infinity;
  for (let v = 0; v < head.length / 3; v += 1) {
    if (!isHeadVertex(doc, v)) continue;
    const x = head[v * 3] ?? 0;
    if (x < edgeX0 || x > edgeX1) continue;
    if ((head[v * 3 + 2] ?? 0) <= frontFace) continue;
    const y = head[v * 3 + 1] ?? 0;
    if (y < bestY || (y === bestY && (best < 0 || v < best))) {
      bestY = y;
      best = v;
    }
  }
  if (best < 0) throw new Error("upper-lip edge is empty");
  return best;
}

function outerVert(head: Float32Array, upper: number): number {
  const ux = head[upper * 3] ?? 0;
  const uy = head[upper * 3 + 1] ?? 0;
  const uz = head[upper * 3 + 2] ?? 0;
  let best = -1;
  let bestD = Infinity;
  for (let ring = 0; ring < 2; ring += 1) {
    const band = ring === 0 ? halfSpan / 2 : halfSpan;
    for (let v = 0; v < head.length / 3; v += 1) {
      const x = head[v * 3] ?? 0;
      if (x < edgeX0 || x > edgeX1 || Math.abs(x - edgeCX) > band) continue;
      if ((head[v * 3 + 2] ?? 0) <= frontFace) continue;
      const y = head[v * 3 + 1] ?? 0;
      if (y >= uy) continue;
      if (isHeadVertex(doc, v)) continue;
      const dx = x - ux;
      const dy = y - uy;
      const dz = (head[v * 3 + 2] ?? 0) - uz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD || (d === bestD && (best < 0 || v < best))) {
        bestD = d;
        best = v;
      }
    }
    if (best >= 0) break;
  }
  if (best < 0) throw new Error("lower outer edge is empty");
  return best;
}

/** Signed vertical press gap (upper minus lower) at FF weight w. */
function pressGapMm(weight: number): number {
  const head = posedHeadLocal(weight);
  const upper = upperVert(head);
  const outer = outerVert(head, upper);
  return ((head[upper * 3 + 1] ?? 0) - (head[outer * 3 + 1] ?? 0)) * 1000;
}

/** Signed vertical press gap at FF weight w posed at an explicit jaw angle. */
function pressGapMmAt(weight: number, jawRadians: number): number {
  const head = posedHeadLocal(weight, jawRadians);
  const upper = upperVert(head);
  const outer = outerVert(head, upper);
  return ((head[upper * 3 + 1] ?? 0) - (head[outer * 3 + 1] ?? 0)) * 1000;
}

/** Lane adjacent-jump metric: max vector difference over unique mesh edges. */
function adjacentJumpMm(delta: Float32Array): number {
  let jump = 0;
  const seen = new Set<number>();
  const count = doc.base.length / 3;
  for (let tri = 0; tri < doc.index.length / 3; tri += 1) {
    const a = doc.index[tri * 3] ?? -1;
    const b = doc.index[tri * 3 + 1] ?? -1;
    const c = doc.index[tri * 3 + 2] ?? -1;
    const pairs: ReadonlyArray<readonly [number, number]> = [[a, b], [b, c], [c, a]];
    for (const [p, q] of pairs) {
      const key = p < q ? p * count + q : q * count + p;
      if (seen.has(key)) continue;
      seen.add(key);
      const dx = (delta[p * 3] ?? 0) - (delta[q * 3] ?? 0);
      const dy = (delta[p * 3 + 1] ?? 0) - (delta[q * 3 + 1] ?? 0);
      const dz = (delta[p * 3 + 2] ?? 0) - (delta[q * 3 + 2] ?? 0);
      jump = Math.max(jump, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }
  return jump * 1000;
}

describe("FF pressed lips", () => {
  beforeAll(async () => {
    doc = await readDoc(GLB);
    const receipt = readProducerReceipt(REPO, RECEIPT_REL);
    const preTmp = loadProducerPreimage(REPO, GLB_REL, receipt.preImageSha256, receipt.preImageBytes);
    pre = await readDoc(preTmp);
    scene = await loadHeadlessScene(GLB);
    // Edge span in the posed head-local frame (upper teeth are
    // head-fixed, so the set matches the producer's exactly).
    const shells = frontShellIndices(doc.teethBase);
    if (shells.upper.length === 0) throw new Error("upper shell is empty");
    const teethHead = teethHeadLocal(1);
    let edgeMinY = Infinity;
    for (const v of shells.upper) edgeMinY = Math.min(edgeMinY, teethHead[v * 3 + 1] ?? 0);
    const edge = shells.upper.filter((v) => (teethHead[v * 3 + 1] ?? 0) <= edgeMinY + 0.001);
    for (const v of edge) {
      edgeX0 = Math.min(edgeX0, teethHead[v * 3] ?? 0);
      edgeX1 = Math.max(edgeX1, teethHead[v * 3] ?? 0);
      frontFace = Math.max(frontFace, teethHead[v * 3 + 2] ?? 0);
      edgeCX += teethHead[v * 3] ?? 0;
    }
    edgeCX /= edge.length;
    halfSpan = (edgeX1 - edgeX0) / 2;
  }, 180_000);

  it("presses the central slit shut at full FF weight", () => {
    const gap = pressGapMm(1);
    expect(Math.abs(gap)).toBeLessThanOrEqual(GAP_BAND_MM);
  });

  it("holds the press across the cue-center reach band", () => {
    // The step3 FF cue spans 2.48-2.55 s (evaluator frames 74.4-76.5); the
    // contact envelope plateaus the FF weight at 1 across the whole cue
    // (plateau suppression, 9df705a4e), so the cue-frame geometry equals
    // the weight-1 pose. The 0.9 bound covers the reach ramp either side.
    expect(Math.abs(pressGapMm(1))).toBeLessThanOrEqual(GAP_BAND_MM);
    expect(Math.abs(pressGapMm(0.9))).toBeLessThanOrEqual(REACH_BAND_MM);
  });

  it("leaves no inverted triangles in the lip patch", async () => {
    const head = posedHeadLocal(1);
    const aaIndex = doc.names.indexOf("viseme_aa");
    const landmark = lowerLipLandmark(
      doc.deltas.get(doc.names[aaIndex]!) ?? new Float32Array(doc.base.length),
      doc.joints,
      doc.weights,
      scene.body.jointNodes,
    );
    const rim = new Set(landmark);
    const triNormal = (
      packed: Float32Array,
      a: number,
      b: number,
      c: number,
    ): [number, number, number] => {
      const ux = (packed[b * 3] ?? 0) - (packed[a * 3] ?? 0);
      const uy = (packed[b * 3 + 1] ?? 0) - (packed[a * 3 + 1] ?? 0);
      const uz = (packed[b * 3 + 2] ?? 0) - (packed[a * 3 + 2] ?? 0);
      const vx = (packed[c * 3] ?? 0) - (packed[a * 3] ?? 0);
      const vy = (packed[c * 3 + 1] ?? 0) - (packed[a * 3 + 1] ?? 0);
      const vz = (packed[c * 3 + 2] ?? 0) - (packed[a * 3 + 2] ?? 0);
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    };
    let inverted = 0;
    for (let tri = 0; tri < doc.index.length / 3; tri += 1) {
      const a = doc.index[tri * 3] ?? -1;
      const b = doc.index[tri * 3 + 1] ?? -1;
      const c = doc.index[tri * 3 + 2] ?? -1;
      if (!(rim.has(a) && rim.has(b) && rim.has(c))) continue;
      const n0 = triNormal(doc.base, a, b, c);
      const n1 = triNormal(head, a, b, c);
      if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < 0) inverted += 1;
    }
    expect(inverted).toBe(0);
  });

  it("keeps the FF adjacent jump under the SS max", () => {
    // Metric calibration: the lane reports the SS max at 5.102 (2.34x
    // below the tuck's 11.95); the same computation must reproduce it.
    const ss = adjacentJumpMm(doc.deltas.get("viseme_SS") ?? new Float32Array(0));
    expect(ss).toBeCloseTo(5.1, 1);
    expect(adjacentJumpMm(doc.deltas.get("viseme_FF") ?? new Float32Array(0))).toBeLessThanOrEqual(
      JUMP_GATE_MM,
    );
  });

  it("leaves PP byte-identical to the pre-image", () => {
    // Body base and the body PP morph are untouched, so the sealed PP lip
    // geometry is exactly the 9df705a4e seal. The teeth PP delta is
    // recomputed from the rim by the unchanged transfer (rigid lower-arch
    // mean, sub-micron-to-sub-mm rest posture, identical code path), so it
    // is gated at rest posture, not byte equality with the baked pre-image.
    const liveBodyPP = doc.deltas.get("viseme_PP");
    const preBodyPP = pre.deltas.get("viseme_PP");
    expect(liveBodyPP).toBeDefined();
    expect(preBodyPP).toBeDefined();
    expect(Array.from(liveBodyPP!)).toEqual(Array.from(preBodyPP!));
    const liveTeethPP = doc.teethDeltas.get("viseme_PP");
    expect(liveTeethPP).toBeDefined();
    let ppMax = 0;
    for (const value of liveTeethPP!) ppMax = Math.max(ppMax, Math.abs(value ?? 0));
    expect(ppMax * 1000).toBeLessThanOrEqual(1);
  });

  it("keeps the upper arch silent on every viseme", async () => {
    const { rows } = await probePremise(GLB);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.teethUpperZMm).toBe(0);
  });

  it("touches no non-FF body morph", () => {
    for (const name of doc.names) {
      if (name === "viseme_FF") continue;
      const live = doc.deltas.get(name);
      const before = pre.deltas.get(name);
      expect(before, name).toBeDefined();
      expect(Array.from(live!)).toEqual(Array.from(before!));
    }
  });

  it("predicts the speaking capture at the runtime drive: bilabial-closure frames seal with the jaw shut", async () => {
    // Runtime-drive predictor (defect.ff_gate_jaw): the static press gates
    // above pose FF weight 1 at the lookup jaw, but the speaking capture
    // drives through the prepared-audio path, whose jaw channel used to lag
    // at the DD-region 0.283 and leave the lower crowns exposed. The FF jaw
    // steer carries the aperture shut for the cue (PP-closure precedent: the
    // pressed curtain shapes the labiodental, not the jaw). The evaluator
    // drives the committed GLB through the runtime's own prepared-audio
    // playback (no reimplementation), so its per-frame jaw angle IS the
    // capture pose.
    // Bilabial closures are the track's PP cues: the acoustic correction in
    // viseme-cue-track.ts relabels Rhubarb's mislabelled /b/ G cue at 2.48 s
    // to PP (operator 2026-10-06), so the pre-fix FF cue frames are now PP
    // frames. Filtering on the record viseme keeps this gate green on both
    // sides of that relabelling. The seal half holds at every jaw by
    // construction (the pressed point is jaw-invariant) and pins the seal
    // at the driven angle.
    const track = readEvaluatorTrack(STEP3_TRACK);
    const { output } = await evaluate(GLB, track);
    const closure = output.records.filter((record) => record.viseme === "viseme_PP");
    expect(closure.length).toBeGreaterThan(0);
    for (const record of closure) {
      expect(record.jawOpenRadians).toBe(0);
      expect(Math.abs(pressGapMmAt(1, record.jawOpenRadians))).toBeLessThanOrEqual(GAP_BAND_MM);
    }
  }, 180_000);
});
