/**
 * Seat the lower teeth on the lower-lip inner rim (operator direction, 2026-10-06).
 *
 * Principle: the lower teeth deform with the SAME function as the rim, so
 * their relative distance is constant by construction for any jaw angle and
 * any viseme blend. Both halves are standard procedural operations:
 *
 * 1. Skin weight transfer: each lower-arch tooth vertex copies the skin
 *    joints/weights of its nearest inner-rim triangle (barycentric blend,
 *    top-4 renormalized). Jaw rotation then moves teeth and rim identically.
 * 2. Morph transfer: each lower-arch tooth vertex takes the rim delta at
 *    that same nearest point per viseme target (rigid mean over the arch
 *    when the per-vertex field distorts crowns past 0.3 mm).
 *
 * Upper-arch base and skinning are preserved verbatim from the producer
 * input, and upper-arch morph deltas are zeroed, so the upper teeth stay
 * fixed and move independently of the lower arch. The
 * lower-arch BASE is translated once (bind +z, fixed point) toward
 * --target-gap-mm, then per-vertex face clearance pulls back the teeth
 * vertices ahead of the #739 clearance plane (cap skin median minus the
 * 0.5 mm test safety) along bind -z by iterated quadratic falloff: each
 * pass moves every crossing vertex by the square of its own excess over
 * the plane divided by the pass maximum excess. Each pass is C1-smooth at
 * the contour, parameter-free, and never moves a vertex more than its own
 * excess; the residual max quarters (or better) every pass, so the field
 * converges to full clearance (16-pass bound, 1 um stop) while staying
 * smooth as a sum of smooth fields. Body meshes,
 * upper-arch base, and skin weights of every non-teeth mesh are untouched.
 *
 * --down-gain scales the vertical head-local component of each lower-arch
 * teeth viseme delta after transfer (default 1, no-op). Head-local comes
 * from the head bone rest world rotation, so the rule carries to other
 * rigs. viseme_PP writes zeros. viseme_sil stays off the teeth. No target
 * names are added, removed, or reordered.
 *
 * --rest-drop-mm translates the lower-arch base along head-down by that
 * many millimetres after the face pullback (default 0, no-op; signed:
 * negative rises toward head-up). Skin weights and morph transfer are
 * untouched, so the edge-to-rim vertical gap shifts by the same amount on
 * every frame. Closed form: d = rest(edge_y - rim_top_y) - target.
 *
 * Inner rim rule (stated, procedural, no thresholds): lowerLipInnerRim —
 * rig+response landmark vertices whose bind normals face the front-shell
 * centroid (dot sign only).
 *
 * Run: pnpm exec tsx tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts <glb> --target-gap-mm <mm> [--dry] [--rigid] [--down-gain <x>] [--rest-drop-mm <mm>] [--ff-lip-contact]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { Matrix3, Matrix4, Vector3 } from "three";
import { applyJawOpenToRoot } from "@openclinxr/xr-dialogue/viseme-runtime";
import { jawOpenRadiansForPhoneme } from "@openclinxr/xr-dialogue/viseme-timeline";
import { loadHeadlessScene } from "../../mouth-solver/headless-scene.js";
import {
  frontShellIndices,
  type GlbJson,
  lowerLipInnerRim,
  lowerLipLandmark,
  writeGlb,
} from "./couple-fitted-teeth-to-lip-viseme.js";
import { measureFaceMarginsFromDoc, runtimeCap } from "./face-median.js";
import { transferArch } from "./rim-seat-transfer.js";

const REST_TOL_M = 1e-4;
const REST_SHOTS = 8;
/** #739 uniform cap-margin target: the clearance plane sits this far behind the cap median. */
const FACE_SAFETY_M = 0.0005;
/** Quadratic pullback passes: residual max quarters each pass, so 16 always suffices. */
const PULLBACK_PASSES = 16;
/** Float32-safe epsilon: pullback stop tolerance and self-check bound, physically nothing. */
const SNAP_M = 1e-6;
/**
 * FF lip-contact target: the upper incisal edge rests on the lower lip with
 * this clearance (render z-fight margin; the only hand-set length in the FF
 * solve, sourced as a render margin). Accept band is [0.15, 0.35] mm.
 */
const FF_CONTACT_M = 0.0002;
const FF_CONTACT_LO_M = 0.00015;
const FF_CONTACT_HI_M = 0.00035;
/** FF solve fixed-point bound: residual-corrected iterations, deterministic order. */
const FF_PASSES = 10;
/** FF press falloff (rung-3 named set): BFS hop-ring count carrying the
 * press step from the central lower-lip zone to zero. The committed value
 * is the smallest of the set whose predicted peak adjacent jump
 * (|step| * pi / (2N)) clears the 3.0 mm internal budget with margin under
 * the 5.102 mm SS gate; the choice is recorded in the plan and receipt. */
const FF_PRESS_RINGS_SET = [8, 10, 12];
/** FF press internal jump budget (mm): predicted peak adjacent jump must
 * clear this; the SS gate (5.102) judges the committed total. */
const FF_PRESS_JUMP_BUDGET_MM = 3.0;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function floatArray(accessor: { getArray: () => ArrayLike<number> | null }): Float32Array {
  const array = accessor.getArray();
  if (!array) throw new Error("empty accessor");
  return array instanceof Float32Array ? array : Float32Array.from(array);
}

/**
 * Lower arch by connected component + jaw rule (R7).
 *
 * The teeth mesh splits into connected components over its index buffer.
 * Each component votes its dominant input joint (per-vertex argmax weight,
 * ties to the lowest joint index; component majority, ties likewise). A
 * component is lower exactly when its dominant joint is the jaw or a jaw
 * descendant. The lower arch is the jaw-bound verts of lower components in
 * ascending order; everything else is upper and stays bitwise identical to
 * the producer input. Deterministic: union-find, ascending vertex order,
 * no iteration, no thresholds on coordinates.
 */
export function lowerArchByJoint(input: {
  indexArray: ArrayLike<number>;
  jointArray: ArrayLike<number>;
  weightArray: ArrayLike<number>;
  teethSkinJointNames: (string | undefined)[];
  jawDescendantNames: Set<string>;
}): { lowerArch: number[]; upperArch: number[]; componentCount: number } {
  const { indexArray, jointArray, weightArray, teethSkinJointNames, jawDescendantNames } = input;
  const count = weightArray.length / 4;
  const parent = new Array<number>(count);
  for (let vertex = 0; vertex < count; vertex += 1) parent[vertex] = vertex;
  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root] ?? root;
    let node = start;
    while (parent[node] !== root) {
      const next = parent[node] ?? root;
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const union = (x: number, y: number): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };
  for (let tri = 0; tri < indexArray.length / 3; tri += 1) {
    const a = indexArray[tri * 3] ?? -1;
    const b = indexArray[tri * 3 + 1] ?? -1;
    const c = indexArray[tri * 3 + 2] ?? -1;
    if (a < 0 || b < 0 || c < 0 || a >= count || b >= count || c >= count) {
      throw new Error("teeth index out of range");
    }
    union(a, b);
    union(b, c);
  }
  const dominantOf = (vertex: number): number => {
    let joint = jointArray[vertex * 4] ?? 0;
    let best = weightArray[vertex * 4] ?? 0;
    for (let slot = 1; slot < 4; slot += 1) {
      const next = weightArray[vertex * 4 + slot] ?? 0;
      if (next > best) {
        best = next;
        joint = jointArray[vertex * 4 + slot] ?? joint;
      }
    }
    return joint;
  };
  const members = new Map<number, number[]>();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const root = find(vertex);
    const list = members.get(root);
    if (list) list.push(vertex);
    else members.set(root, [vertex]);
  }
  const isJawJoint = (joint: number): boolean =>
    jawDescendantNames.has((teethSkinJointNames[joint] ?? "").toLowerCase());
  const lowerComponents = new Set<number>();
  for (const [root, verts] of members) {
    const votes = new Map<number, number>();
    for (const vertex of verts) {
      const joint = dominantOf(vertex);
      votes.set(joint, (votes.get(joint) ?? 0) + 1);
    }
    let top = -1;
    let topVotes = -1;
    for (const [joint, total] of votes) {
      if (total > topVotes || (total === topVotes && joint < top)) {
        top = joint;
        topVotes = total;
      }
    }
    if (top >= 0 && isJawJoint(top)) lowerComponents.add(root);
  }
  const lowerArch: number[] = [];
  const upperArch: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    if (lowerComponents.has(find(vertex)) && isJawJoint(dominantOf(vertex))) lowerArch.push(vertex);
    else upperArch.push(vertex);
  }
  if (lowerArch.length === 0) throw new Error("lower arch is empty");
  if (upperArch.length === 0) throw new Error("upper arch is empty");
  return { lowerArch, upperArch, componentCount: members.size };
}

export type RimSeatPlan = {
  rimCount: number;
  rimTriangles: number;
  lowerArchCount: number;
  targetGapMm: number;
  restGap0Mm: number;
  restShiftMm: number;
  faceMarginRest0Mm: number;
  faceMarginCap0Mm: number;
  faceSafetyMm: number;
  /** Clearance plane: cap skin median minus safety (bind z, metres in mm field). */
  clearancePlaneMm: number;
  pullbackVertCount: number;
  pullbackMaxMm: number;
  pullbackMeanMm: number;
  pullbackPasses: number;
  downGain: number;
  restDropMm: number;
  ffLipContact: boolean;
  ffGapBeforeMm: number;
  ffGapAfterMm: number;
  ffPasses: number;
  ffCorrectedVerts: number;
  ffMaxCorrectionMm: number;
  /** Press falloff: committed BFS ring count from the rung-3 set. */
  ffPressRings: number;
  /** Press falloff: predicted peak adjacent jump for the committed rings. */
  ffPressPredictedJumpMm: number;
  /** Press smoothness: max vector-difference jump between adjacent body
   * verts over the edited FF delta (lane metric; SS gate 5.102). */
  ffContactNeighborJumpMm: number;
  ffCoverExcessBeforeMm: number;
  ffCoverCorrectedVerts: number;
  ffCoverMaxMm: number;
  ffCoverPasses: number;
  ffGapFinalMm: number;
  ffCoverMinClearanceMm: number;
  ffCoverNeighborJumpMm: number;
  /** Rest rim gap after seat + pullback (equals the target only when nothing crosses). */
  honestRestGapMm: number;
  rigid: boolean;
  distortionMm: Record<string, number>;
  jawMaxVerts: number;
  teethCount: number;
};

function readArgs(): { glbPath: string; targetGapMm: number; dry: boolean; rigid: boolean; downGain: number; restDropMm: number; ffLipContact: boolean } {
  const flag = (name: string): string | undefined => {
    const index = process.argv.indexOf(name);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    return value && !value.startsWith("--") ? value : undefined;
  };
  const glbPath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const target = flag("--target-gap-mm");
  if (!glbPath || target === undefined) {
    throw new Error("usage: seat-teeth-on-lip-rim.ts <glb> --target-gap-mm <mm> [--dry] [--rigid] [--down-gain <x>] [--rest-drop-mm <mm>] [--ff-lip-contact]");
  }
  const targetGapMm = Number(target);
  if (!Number.isFinite(targetGapMm) || targetGapMm <= 0) throw new Error(`bad --target-gap-mm ${target}`);
  const downGainRaw = flag("--down-gain");
  const downGain = downGainRaw === undefined ? 1 : Number(downGainRaw);
  if (!Number.isFinite(downGain) || downGain <= 0) throw new Error(`bad --down-gain ${downGainRaw}`);
  const restDropRaw = flag("--rest-drop-mm");
  const restDropMm = restDropRaw === undefined ? 0 : Number(restDropRaw);
  if (!Number.isFinite(restDropMm)) throw new Error(`bad --rest-drop-mm ${restDropRaw}`);
  return { glbPath, targetGapMm, dry: process.argv.includes("--dry"), rigid: process.argv.includes("--rigid"), downGain, restDropMm, ffLipContact: process.argv.includes("--ff-lip-contact") };
}

type SeatResult = {
  plan: RimSeatPlan;
  newBase: Float32Array;
  newJoints: number[];
  newWeights: number[];
  newDeltas: Record<string, Float32Array>;
  jointsType: number;
  /** Edited body viseme_FF bind delta; defined only with ffLipContact. */
  newBodyFf?: Float32Array;
};

function skinAtRest(
  base: Float32Array,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  boneMats: Float32Array,
): Float32Array {
  const out = new Float32Array(base.length);
  const matrix = new Matrix4();
  const point = new Vector3();
  for (let vertex = 0; vertex < base.length / 3; vertex += 1) {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = weights[vertex * 4 + slot] ?? 0;
      if (weight === 0) continue;
      matrix.fromArray(boneMats, (joints[vertex * 4 + slot] ?? 0) * 16);
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

export type FfLipContact = {
  ffGapBeforeMm: number;
  ffGapAfterMm: number;
  ffPasses: number;
  ffCorrectedVerts: number;
  ffMaxCorrectionMm: number;
  /** Press falloff: committed BFS ring count from the rung-3 set. */
  ffPressRings: number;
  /** Press falloff: predicted peak adjacent jump for the committed rings. */
  ffPressPredictedJumpMm: number;
  /** Press smoothness: max vector-difference jump between adjacent body
   * verts over the edited FF delta (lane metric; SS gate 5.102). */
  ffContactNeighborJumpMm: number;
  /** Cover-behind tuck: RETIRED (pressed lips need no tuck). All cover
   * fields report 0; the press seals the slit without a span-edge cliff. */
  ffCoverExcessBeforeMm: number;
  /** Cover-behind tuck: in-span verts corrected on the first pass. */
  ffCoverCorrectedVerts: number;
  /** Cover-behind tuck: max applied head-local correction. */
  ffCoverMaxMm: number;
  /** Cover-behind tuck: passes used (retired, always 0). */
  ffCoverPasses: number;
  /** Upper-to-lower lip press gap after the solve (accept <= 0.5mm). */
  ffGapFinalMm: number;
  /** Min head-local clearance of the in-span patch behind the cover plane
   * (>= 0: every in-span vert behind the face; penetration-free by construction). */
  ffCoverMinClearanceMm: number;
  /** Max correction jump between adjacent patch verts (smoothness check). */
  ffCoverNeighborJumpMm: number;
  /** Edited body viseme_FF bind delta (full-length, only landmark verts differ). */
  editedBodyFf: Float32Array;
};

/**
 * FF pressed lips (operator 2026-10-06: FF stays pressed lips on this rig;
 * upper teeth are head-fixed, so the lower lip meets the upper lip).
 *
 * Closed form + fixed point: at FF weight 1 and the FF jaw angle, find the
 * upper-lip edge point (dominant joint exactly head, bind x inside the
 * incisal-edge x-span, bind z forward of the incisor front face, lowest
 * bind y; ties to the lowest vertex index) and the lower outer edge point
 * (highest posed-y non-head vert inside the span, forward of the incisor
 * face, below the upper edge; ties likewise), then
 * translate the lip column toward coincidence (FF_CONTACT_M residual)
 * with a cosine BFS-ring falloff: weight 1 on the in-span zone, C1 to 0
 * over N hop-rings, 0 beyond; head-joint verts are pinned at 0 so the
 * upper lip, nose and scalp never ride the press. N is the smallest of the
 * rung-3 set whose predicted peak adjacent jump clears the internal
 * budget. The mouth aperture is a mesh hole, so the pressed upper and
 * lower boundary rings meet across it with no shared edge and no jump;
 * the only gradient lies mid-lip, bounded by construction. Re-pose and
 * repeat to the accept band (FF_PASSES bound). Bind deltas move through
 * the head rest rotation only; the jaw-angle residual is absorbed by the
 * next pass. Deterministic: ascending vertex order, Float64Array layer
 * distances, fixed sweep-free closed form.
 */
export async function solveFfLipContact(input: {
  glbPath: string;
  bodyBase: Float32Array;
  bodyDeltaFf: Float32Array;
  bodyDeltaAa: Float32Array;
  bodyJoints: ArrayLike<number>;
  bodyWeights: ArrayLike<number>;
  jointNodes: { getName(): string }[];
  bodyIndex: ArrayLike<number>;
  teethBase: Float32Array;
  /** Seated teeth base for shell membership (upper verbatim; membership matches the output). */
  teethShellBase: Float32Array;
  teethDeltaFf: Float32Array;
  teethJoints: ArrayLike<number>;
  teethWeights: ArrayLike<number>;
}): Promise<FfLipContact> {
  const { glbPath, bodyBase, bodyDeltaAa, bodyJoints, bodyWeights, jointNodes, bodyIndex, teethBase, teethDeltaFf, teethJoints, teethWeights } = input;
  const scene = await loadHeadlessScene(glbPath);
  const landmark = lowerLipLandmark(bodyDeltaAa, bodyJoints, bodyWeights, jointNodes as never);
  if (landmark.length < 20) throw new Error(`FF contact: landmark has ${landmark.length} verts`);

  const morphed = (base: Float32Array, delta: Float32Array): Float32Array => {
    const out = new Float32Array(base);
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + (delta[i] ?? 0);
    return out;
  };
  const pose = (bodyFf: Float32Array): { teethHead: Float32Array; bodyHead: Float32Array } => {
    // Candidate bind deltas posed by hand (FF weight 1): jaw rotation from
    // the shipped applier, skinning from the headless scene bones.
    applyJawOpenToRoot(scene.root, jawOpenRadiansForPhoneme("FF"));
    scene.root.updateMatrixWorld(true);
    scene.teeth.skeleton.update();
    scene.body.skeleton.update();
    const teethMats = scene.teeth.skeleton.boneMatrices?.slice();
    const bodyMats = scene.body.skeleton.boneMatrices?.slice();
    if (!teethMats || !bodyMats) throw new Error("FF contact: no bone matrices");
    const teethWorld = skinAtRest(morphed(teethBase, teethDeltaFf), teethJoints, teethWeights, teethMats);
    const bodyWorld = skinAtRest(morphed(bodyBase, bodyFf), bodyJoints, bodyWeights, bodyMats);
    const inv = new Matrix4().copy(scene.headBone.matrixWorld).invert();
    const toHead = (world: Float32Array): Float32Array => {
      const out = new Float32Array(world.length);
      const point = new Vector3();
      for (let v = 0; v < world.length / 3; v += 1) {
        point.set(world[v * 3] ?? 0, world[v * 3 + 1] ?? 0, world[v * 3 + 2] ?? 0).applyMatrix4(inv);
        out[v * 3] = point.x;
        out[v * 3 + 1] = point.y;
        out[v * 3 + 2] = point.z;
      }
      return out;
    };
    return { teethHead: toHead(teethWorld), bodyHead: toHead(bodyWorld) };
  };

  // Incisal-edge x-span (upper is head-fixed, static set). Membership
  // reads the seated base so the edge set matches the output file.
  const shells = frontShellIndices(input.teethShellBase);
  if (shells.upper.length === 0) throw new Error("FF contact: upper shell is empty");
  const rest = pose(input.bodyDeltaFf);
  let edgeMinY = Infinity;
  for (const v of shells.upper) edgeMinY = Math.min(edgeMinY, rest.teethHead[v * 3 + 1] ?? 0);
  const edge = shells.upper.filter((v) => (rest.teethHead[v * 3 + 1] ?? 0) <= edgeMinY + 0.001);
  let edgeX0 = Infinity;
  let edgeX1 = -Infinity;
  let frontFace = -Infinity;
  for (const v of edge) {
    edgeX0 = Math.min(edgeX0, rest.teethHead[v * 3] ?? 0);
    edgeX1 = Math.max(edgeX1, rest.teethHead[v * 3] ?? 0);
    frontFace = Math.max(frontFace, rest.teethHead[v * 3 + 2] ?? 0);
  }

  // Jaw-descendant joint names (same walk as the lower-arch rule): the
  // upper-lip edge is dominant-head-weighted, never jaw-bound.
  const jawDescendantNames = new Set<string>();
  {
    type JawWalkNode = { getName(): string; listChildren(): JawWalkNode[] };
    const jawNode = (jointNodes as unknown as JawWalkNode[]).find((node) => /^jaw$/i.test(node.getName() ?? ""));
    if (!jawNode) throw new Error("FF press: rig has no jaw joint");
    const collect = (node: JawWalkNode): void => {
      jawDescendantNames.add((node.getName() ?? "").toLowerCase());
      for (const child of node.listChildren()) collect(child);
    };
    collect(jawNode);
  }
  const dominantJointName = (vertex: number): string => {
    let joint = bodyJoints[vertex * 4] ?? 0;
    let best = bodyWeights[vertex * 4] ?? 0;
    for (let slot = 1; slot < 4; slot += 1) {
      const next = bodyWeights[vertex * 4 + slot] ?? 0;
      if (next > best) {
        best = next;
        joint = bodyJoints[vertex * 4 + slot] ?? joint;
      }
    }
    return (jointNodes[joint]?.getName() ?? "").toLowerCase();
  };
  const isHeadVertex = (vertex: number): boolean => /^head$/i.test(dominantJointName(vertex) ?? "");

  // Upper-lip edge point (stated rule, no thresholds): dominant-head
  // body verts inside the incisal x-span and forward of the incisor front
  // face, lowest posed y (head verts are FF-static, so the posed frame
  // reads the same); ties to the lowest vertex index.
  let upperVert = -1;
  {
    let bestY = Infinity;
    const bodyCount = bodyBase.length / 3;
    for (let v = 0; v < bodyCount; v += 1) {
      if (!isHeadVertex(v)) continue;
      const x = rest.bodyHead[v * 3] ?? 0;
      if (x < edgeX0 || x > edgeX1) continue;
      if ((rest.bodyHead[v * 3 + 2] ?? 0) <= frontFace) continue;
      const y = rest.bodyHead[v * 3 + 1] ?? 0;
      if (y < bestY || (y === bestY && (upperVert < 0 || v < upperVert))) {
        bestY = y;
        upperVert = v;
      }
    }
  }
  if (upperVert < 0) throw new Error("FF press: upper-lip edge is empty (premise false)");

  // Press falloff over BFS hop-rings from the in-span landmark zone.
  // Head-joint verts pin at 0 (upper lip, nose, scalp never ride); the
  // mouth aperture is a mesh hole, so the pressed boundary rings meet
  // across it with no shared edge. Ascending index order throughout.
  const bodyAdj = new Map<number, number[]>();
  {
    const link = (a: number, b: number): void => {
      if (a === b) return;
      const list = bodyAdj.get(a);
      if (list) {
        if (!list.includes(b)) list.push(b);
      } else bodyAdj.set(a, [b]);
    };
    for (let tri = 0; tri < bodyIndex.length / 3; tri += 1) {
      const a = bodyIndex[tri * 3] ?? -1;
      const b = bodyIndex[tri * 3 + 1] ?? -1;
      const c = bodyIndex[tri * 3 + 2] ?? -1;
      if (a < 0 || b < 0 || c < 0) throw new Error("FF press: body index out of range");
      link(a, b); link(b, a); link(b, c); link(c, b); link(c, a); link(a, c);
    }
  }
  // Press seeds (stated rule, no thresholds): in-span landmark verts plus
  // in-span lower-curtain verts (forward of the incisor face, below the
  // upper edge, dominant joint not head). The whole central lip column
  // rides at unit weight, so the inner rim and the visible outer curtain
  // translate rigidly together with zero internal shear.
  const bodyCount = bodyBase.length / 3;
  const upperY = rest.bodyHead[upperVert * 3 + 1] ?? 0;
  const seedSet = new Set<number>();
  for (const v of landmark) {
    const x = rest.bodyHead[v * 3] ?? 0;
    if (x >= edgeX0 && x <= edgeX1) seedSet.add(v);
  }
  for (let v = 0; v < bodyCount; v += 1) {
    const x = rest.bodyHead[v * 3] ?? 0;
    if (x < edgeX0 || x > edgeX1) continue;
    if ((rest.bodyHead[v * 3 + 2] ?? 0) <= frontFace) continue;
    if ((rest.bodyHead[v * 3 + 1] ?? 0) >= upperY) continue;
    if (isHeadVertex(v)) continue;
    seedSet.add(v);
  }
  const seeds = [...seedSet].sort((a, b) => a - b);
  if (seeds.length === 0) throw new Error("FF press: press seeds are empty (premise false)");
  const layer = new Int32Array(bodyCount).fill(-1);
  {
    const queue: number[] = [...seeds].sort((a, b) => a - b);
    for (const s of queue) layer[s] = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const v = queue[head] ?? -1;
      const next = (layer[v] ?? -1) + 1;
      const neighbors = (bodyAdj.get(v) ?? []).slice().sort((a, b) => a - b);
      for (const n of neighbors) {
        if (layer[n] === -1) {
          layer[n] = next;
          queue.push(n);
        }
      }
    }
  }

  // Press gap per pose: upper edge to lower OUTER edge (the visible slit).
  // Outer edge rule: the lower-curtain vert nearest the upper edge among
  // the central band (incisal-centroid x plus/minus a quarter span),
  // forward of the incisor face, below the upper edge, dominant joint not
  // head; ties to the lowest vertex index. The inner rim rides the same
  // unit-weight column, so sealing the visible slit seals the mouth.
  let edgeCX = 0;
  for (const v of edge) edgeCX += rest.teethHead[v * 3] ?? 0;
  edgeCX /= edge.length;
  const halfSpan = (edgeX1 - edgeX0) / 2;
  const lipGapOf = (bodyHead: Float32Array): { gap: number; vec: [number, number, number] } => {
    const ux = bodyHead[upperVert * 3] ?? 0;
    const uy = bodyHead[upperVert * 3 + 1] ?? 0;
    const uz = bodyHead[upperVert * 3 + 2] ?? 0;
    let outerVert = -1;
    let bestD = Infinity;
    for (let pass = 0; pass < 2; pass += 1) {
      const band = pass === 0 ? halfSpan / 2 : halfSpan;
      for (let v = 0; v < bodyCount; v += 1) {
        const x = bodyHead[v * 3] ?? 0;
        if (x < edgeX0 || x > edgeX1 || Math.abs(x - edgeCX) > band) continue;
        if ((bodyHead[v * 3 + 2] ?? 0) <= frontFace) continue;
        const y = bodyHead[v * 3 + 1] ?? 0;
        if (y >= uy) continue;
        if (isHeadVertex(v)) continue;
        const dx = x - ux;
        const dy = y - uy;
        const dz = (bodyHead[v * 3 + 2] ?? 0) - uz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD || (d === bestD && (outerVert < 0 || v < outerVert))) {
          bestD = d;
          outerVert = v;
        }
      }
      if (outerVert >= 0) break;
    }
    if (outerVert < 0) throw new Error("FF press: lower outer edge is empty (premise false)");
    const vec: [number, number, number] = [
      (bodyHead[upperVert * 3] ?? 0) - (bodyHead[outerVert * 3] ?? 0),
      (bodyHead[upperVert * 3 + 1] ?? 0) - (bodyHead[outerVert * 3 + 1] ?? 0),
      (bodyHead[upperVert * 3 + 2] ?? 0) - (bodyHead[outerVert * 3 + 2] ?? 0),
    ];
    return { gap: Math.hypot(vec[0], vec[1], vec[2]), vec };
  };

  // Rung-3 ring selection: smallest set member whose predicted peak
  // adjacent jump (|step| * pi / (2N)) clears the internal budget.
  const first = lipGapOf(rest.bodyHead);
  const ffGapBeforeMm = Math.round(first.gap * 1e6) / 1e3;
  let pressRings = FF_PRESS_RINGS_SET[FF_PRESS_RINGS_SET.length - 1] ?? 12;
  for (const candidate of FF_PRESS_RINGS_SET) {
    if ((first.gap * Math.PI) / (2 * candidate) <= FF_PRESS_JUMP_BUDGET_MM / 1000) {
      pressRings = candidate;
      break;
    }
  }
  const pressPredictedJumpMm = Math.round(((first.gap * Math.PI) / (2 * pressRings)) * 1e6) / 1e3;
  const weights = new Float64Array(bodyCount);
  let correctedVerts = 0;
  for (let v = 0; v < bodyCount; v += 1) {
    if (isHeadVertex(v)) continue;
    const hop = layer[v] ?? -1;
    if (hop < 0 || hop > pressRings) continue;
    weights[v] = 0.5 * (1 + Math.cos((Math.PI * hop) / pressRings));
    correctedVerts += 1;
  }

  scene.root.updateMatrixWorld(true);
  const toBind = new Matrix3()
    .setFromMatrix4(new Matrix4().extractRotation(scene.headBone.matrixWorld))
    .transpose();
  const edited = new Float32Array(input.bodyDeltaFf);
  let gap = first.gap;
  let vec = first.vec;
  let passes = 0;
  const step = new Vector3();
  for (let pass = 0; pass < FF_PASSES; pass += 1) {
    // Stop in the lower half of the accept band so the committed value
    // centers near the target instead of resting on the upper limit.
    if (gap >= FF_CONTACT_LO_M && gap <= (FF_CONTACT_M + FF_CONTACT_HI_M) / 2) break;
    passes = pass + 1;
    const scale = (gap - FF_CONTACT_M) / gap;
    step.set(vec[0] * scale, vec[1] * scale, vec[2] * scale).applyMatrix3(toBind);
    for (let v = 0; v < bodyCount; v += 1) {
      const w = weights[v] ?? 0;
      if (w <= 0) continue;
      edited[v * 3] = (edited[v * 3] ?? 0) + step.x * w;
      edited[v * 3 + 1] = (edited[v * 3 + 1] ?? 0) + step.y * w;
      edited[v * 3 + 2] = (edited[v * 3 + 2] ?? 0) + step.z * w;
    }
    const posed = pose(edited);
    const next = lipGapOf(posed.bodyHead);
    gap = next.gap;
    vec = next.vec;
  }
  if (!(gap >= FF_CONTACT_LO_M && gap <= FF_CONTACT_HI_M)) {
    throw new Error(`FF press missed: gap ${gap * 1000} mm after ${passes} passes (premise false)`);
  }

  // Press smoothness (lane metric): max vector-difference jump between
  // mesh-adjacent body verts over the edited FF delta (whole mesh, unique
  // edges, ascending order). The tuck's span-edge cliff read 11.95 here
  // against the 5.102 SS max; the press falloff must clear that gate.
  let neighborJump = 0;
  {
    const seen = new Set<number>();
    const jumpOf = (a: number, b: number): number => {
      const dx = (edited[a * 3] ?? 0) - (edited[b * 3] ?? 0);
      const dy = (edited[a * 3 + 1] ?? 0) - (edited[b * 3 + 1] ?? 0);
      const dz = (edited[a * 3 + 2] ?? 0) - (edited[b * 3 + 2] ?? 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };
    for (let tri = 0; tri < bodyIndex.length / 3; tri += 1) {
      const a = bodyIndex[tri * 3] ?? -1;
      const b = bodyIndex[tri * 3 + 1] ?? -1;
      const c = bodyIndex[tri * 3 + 2] ?? -1;
      if (a < 0 || b < 0 || c < 0) throw new Error("FF press: body index out of range");
      const pairs: ReadonlyArray<readonly [number, number]> = [[a, b], [b, c], [c, a]];
      for (const [p, q] of pairs) {
        const key = p < q ? p * bodyCount + q : q * bodyCount + p;
        if (seen.has(key)) continue;
        seen.add(key);
        neighborJump = Math.max(neighborJump, jumpOf(p, q));
      }
    }
  }
  const ffGapFinalMm = Math.round(gap * 1e6) / 1e3;
  let maxCorrection = 0;
  for (let i = 0; i < edited.length / 3; i += 1) {
    const dx = (edited[i * 3] ?? 0) - (input.bodyDeltaFf[i * 3] ?? 0);
    const dy = (edited[i * 3 + 1] ?? 0) - (input.bodyDeltaFf[i * 3 + 1] ?? 0);
    const dz = (edited[i * 3 + 2] ?? 0) - (input.bodyDeltaFf[i * 3 + 2] ?? 0);
    maxCorrection = Math.max(maxCorrection, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  return {
    ffGapBeforeMm,
    ffGapAfterMm: Math.round(gap * 1e6) / 1e3,
    ffPasses: passes,
    ffCorrectedVerts: correctedVerts,
    ffMaxCorrectionMm: Math.round(maxCorrection * 1e6) / 1e3,
    ffPressRings: pressRings,
    ffPressPredictedJumpMm: pressPredictedJumpMm,
    ffContactNeighborJumpMm: Math.round(neighborJump * 1e6) / 1e3,
    ffCoverExcessBeforeMm: 0,
    ffCoverCorrectedVerts: 0,
    ffCoverMaxMm: 0,
    ffCoverPasses: 0,
    ffGapFinalMm,
    ffCoverMinClearanceMm: 0,
    ffCoverNeighborJumpMm: 0,
    editedBodyFf: edited,
  };
}

export async function planRimSeat(glbPath: string, targetGapMm: number, forceRigid: boolean, downGain = 1, restDropMm = 0, ffLipContact = false): Promise<SeatResult> {
  const doc = await new NodeIO().read(glbPath);
  const teeth = doc.getRoot().listMeshes().find((mesh) => /fitted_teeth/i.test(mesh.getName()));
  if (!teeth) throw new Error(`no fitted teeth mesh in ${glbPath}`);
  const body = doc.getRoot().listMeshes().find((mesh) => /_body$/i.test(mesh.getName()));
  if (!body) throw new Error(`no body mesh in ${glbPath}`);
  const teethPrim = teeth.listPrimitives()[0];
  const bodyPrim = body.listPrimitives()[0];
  if (!teethPrim || !bodyPrim) throw new Error("missing primitive 0");
  const teethNames = (teeth.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
  const expected = ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_FF", "viseme_PP"];
  if (teethNames.length !== expected.length || !expected.every((name) => teethNames.includes(name))) {
    throw new Error(`teeth targets are not the solved seven: ${teethNames.join(",")}`);
  }
  const teethBaseAttr = teethPrim.getAttribute("POSITION");
  if (!teethBaseAttr) throw new Error("teeth mesh has no POSITION attribute");
  const teethBase = floatArray(teethBaseAttr);
  const teethCount = teethBase.length / 3;
  if (teethCount !== 4494) throw new Error(`teeth vertex count moved: ${teethCount}`);
  const bodyBaseAttr = bodyPrim.getAttribute("POSITION");
  if (!bodyBaseAttr) throw new Error("body mesh has no POSITION attribute");
  const bodyBase = floatArray(bodyBaseAttr);
  const bodyNormalsAttr = bodyPrim.getAttribute("NORMAL");
  if (!bodyNormalsAttr) throw new Error("body mesh has no NORMAL accessor for the inner-rim rule");
  const bodyNormals = floatArray(bodyNormalsAttr);
  const bodyTargets = (body.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
  const bodyDeltas = bodyTargets.map((_, index) => {
    const accessor = bodyPrim.listTargets()[index]?.getAttribute("POSITION");
    return accessor ? floatArray(accessor) : new Float32Array(bodyBase.length);
  });
  const teethJoints = teethPrim.getAttribute("JOINTS_0");
  const teethWeights = teethPrim.getAttribute("WEIGHTS_0");
  if (!teethJoints || !teethWeights) throw new Error("teeth mesh has no skinning attributes");
  const teethJointsType = teethJoints.getComponentType();
  if (teethJointsType !== 5121) throw new Error(`teeth JOINTS_0 component ${teethJointsType}, expected UNSIGNED_BYTE`);
  const jointArray = teethJoints.getArray();
  const weightArray = floatArray(teethWeights);
  if (!jointArray) throw new Error("empty JOINTS_0");
  const bodyJointsAttr = bodyPrim.getAttribute("JOINTS_0");
  const bodyWeightsAttr = bodyPrim.getAttribute("WEIGHTS_0");
  if (!bodyJointsAttr || !bodyWeightsAttr) throw new Error("body mesh has no skinning attributes");
  const bodyJoints = bodyJointsAttr.getArray();
  const bodyWeights = floatArray(bodyWeightsAttr);
  if (!bodyJoints) throw new Error("empty body JOINTS_0");
  const bodyNode = doc.getRoot().listNodes().find((node) => node.getMesh() === body);
  const jointNodes = bodyNode?.getSkin()?.listJoints() ?? [];
  const teethNode = doc.getRoot().listNodes().find((node) => node.getMesh() === teeth);
  const teethSkinJoints = teethNode?.getSkin()?.listJoints().map((joint) => joint.getName()) ?? [];
  if (!teethSkinJoints.some((name) => /^jaw$/i.test(name ?? ""))) throw new Error("teeth skin has no jaw joint");
  const aaIndex = bodyTargets.indexOf("viseme_aa");
  if (aaIndex < 0) throw new Error("body has no viseme_aa target");

  // Inner rim (stated rule) and its triangles.
  const rim = lowerLipInnerRim(
    bodyBase, bodyNormals, bodyDeltas[aaIndex] ?? new Float32Array(bodyBase.length),
    bodyJoints, bodyWeights, jointNodes, teethBase,
  );
  if (rim.length === 0) throw new Error("inner rim is empty: facing rule matched no landmark vertex");
  const rimSet = new Set(rim);
  const bodyIndexAttr = bodyPrim.getIndices();
  if (!bodyIndexAttr) throw new Error("body primitive has no indices for rim triangles");
  const bodyIndex = bodyIndexAttr.getArray();
  if (!bodyIndex) throw new Error("empty body index");
  const rimTris: Array<readonly [number, number, number]> = [];
  for (let tri = 0; tri < bodyIndex.length / 3; tri += 1) {
    const a = bodyIndex[tri * 3] ?? -1;
    const b = bodyIndex[tri * 3 + 1] ?? -1;
    const c = bodyIndex[tri * 3 + 2] ?? -1;
    if (rimSet.has(a) && rimSet.has(b) && rimSet.has(c)) rimTris.push([a, b, c]);
  }
  if (rimTris.length === 0) throw new Error("inner rim has no interior triangles");

  // Lower arch: connected components whose dominant input joint is the jaw
  // or a jaw descendant (R7: median-Y caught 338 upper-arch verts and the
  // rest/drop/transfer steps stretched them with the lower arch).
  const teethIndexAttr = teethPrim.getIndices();
  if (!teethIndexAttr) throw new Error("teeth primitive has no indices for arch components");
  const teethIndex = teethIndexAttr.getArray();
  if (!teethIndex) throw new Error("empty teeth index");
  const jawNode = doc.getRoot().listNodes().find((node) => /^jaw$/i.test(node.getName() ?? ""));
  if (!jawNode) throw new Error("rig has no jaw joint");
  const jawDescendantNames = new Set<string>();
  type JawWalkNode = { getName(): string; listChildren(): JawWalkNode[] };
  const collectJaw = (node: JawWalkNode): void => {
    jawDescendantNames.add((node.getName() ?? "").toLowerCase());
    for (const child of node.listChildren()) collectJaw(child);
  };
  collectJaw(jawNode as unknown as JawWalkNode);
  const { lowerArch, upperArch } = lowerArchByJoint({
    indexArray: teethIndex,
    jointArray,
    weightArray,
    teethSkinJointNames: teethSkinJoints,
    jawDescendantNames,
  });

  // Rest pose via the headless scene (rest bone transforms).
  const scene = await loadHeadlessScene(glbPath);
  scene.root.updateMatrixWorld(true);
  const restTeethMats = (() => {
    scene.teeth.skeleton.update();
    const mats = scene.teeth.skeleton.boneMatrices;
    if (!mats) throw new Error("teeth skeleton has no bone matrices");
    return mats.slice();
  })();
  const restBodyMats = (() => {
    scene.body.skeleton.update();
    const mats = scene.body.skeleton.boneMatrices;
    if (!mats) throw new Error("body skeleton has no bone matrices");
    return mats.slice();
  })();
  const restRimGap = (teethPositions: Float32Array): number => {
    const teethWorld = skinAtRest(teethPositions, jointArray, weightArray, restTeethMats);
    const bodyWorld = skinAtRest(bodyBase, bodyJoints, bodyWeights, restBodyMats);
    return rimGap(teethWorld, frontShellIndices(teethPositions).lower, bodyWorld, rim);
  };

  // Clearance plane P (#739 instrument, imported): cap skin median minus the
  // test's own 0.5 mm safety. Teeth z never moves the skin medians (the band
  // is teeth y/x, the shift is z), so P measured on the input doc binds the
  // output too.
  const face = measureFaceMarginsFromDoc(doc, runtimeCap(REPO_ROOT));
  if (!face) throw new Error("face instrument found no teeth or body mesh");
  const planeZ = face.medianAtCap - FACE_SAFETY_M;

  // Rest offset on the lower arch (bind +z; fixed point for assignment switching).
  const targetM = targetGapMm / 1000;
  const restGap0 = restRimGap(teethBase);
  let rimBase = teethBase;
  let rimCheck = restGap0;
  let rimShift = 0;
  for (let shot = 0; shot < REST_SHOTS; shot += 1) {
    if (Math.abs(rimCheck - targetM) <= REST_TOL_M) break;
    const step = rimCheck - targetM;
    const shifted = new Float32Array(rimBase);
    for (const vertex of lowerArch) shifted[vertex * 3 + 2] = (shifted[vertex * 3 + 2] ?? 0) + step;
    rimBase = shifted;
    rimShift += step;
    rimCheck = restRimGap(rimBase);
  }
  if (Math.abs(rimCheck - targetM) > REST_TOL_M) {
    throw new Error(`rest offset missed: gap ${rimCheck} vs target ${targetM}`);
  }

  // Per-vertex face clearance on the seated base: teeth ahead of P retreat
  // along bind -z by iterated quadratic falloff. One pass moves each
  // crossing vertex by the square of its own excess over P divided by the
  // maximum excess: C1-smooth at the contour (value and slope vanish there),
  // parameter-free, and no vertex ever moves more than its own excess
  // (excess squared over the max never exceeds the excess). A single pass
  // undershoots (it pins only the worst vertex), so passes repeat on the
  // residual with a recomputed max: the residual max quarters (or better)
  // every pass, totals stay below per-vertex excess, and the field stays
  // smooth as a sum of smooth fields. Stops when the residual max is at or
  // below SNAP_M (float32-safe, physically nothing) with a 16-pass bound.
  // Float32Array keeps every assignment at accessor precision, so a re-plan
  // from cleared bytes measures no excess and applies nothing.
  let newBase = rimBase;
  let pullbackVertCount = 0;
  let pullbackMax = 0;
  let pullbackSum = 0;
  let pullbackPasses = 0;
  for (let pass = 0; pass < PULLBACK_PASSES; pass += 1) {
    let excessMax = 0;
    for (let vertex = 0; vertex < teethCount; vertex += 1) {
      excessMax = Math.max(excessMax, (newBase[vertex * 3 + 2] ?? 0) - planeZ);
    }
    if (excessMax <= SNAP_M) break;
    pullbackPasses = pass + 1;
    const moved = new Float32Array(newBase);
    for (let vertex = 0; vertex < teethCount; vertex += 1) {
      const excess = (newBase[vertex * 3 + 2] ?? 0) - planeZ;
      if (excess <= SNAP_M) continue;
      const drop = (excess * excess) / excessMax;
      moved[vertex * 3 + 2] = (moved[vertex * 3 + 2] ?? 0) - drop;
      if (pass === 0) {
        pullbackVertCount += 1;
        pullbackMax = Math.max(pullbackMax, drop);
        pullbackSum += drop;
      }
    }
    newBase = moved;
  }
  let seatedMaxZ = -Infinity;
  for (let vertex = 0; vertex < teethCount; vertex += 1) {
    seatedMaxZ = Math.max(seatedMaxZ, newBase[vertex * 3 + 2] ?? 0);
  }
  if (!(seatedMaxZ <= planeZ + SNAP_M)) {
    throw new Error(`pullback missed the clearance plane: maxZ ${seatedMaxZ} vs plane ${planeZ}`);
  }
  const honestCheck = restRimGap(newBase);

  // Rest drop: signed head-down translation of the lower-arch base after
  // the face pullback. Skin weights and morph transfer above are untouched,
  // so the edge-to-rim vertical gap shifts by the same amount on every
  // frame. Default 0 is a no-op (newBase reference kept, bytes unchanged).
  let droppedBase = newBase;
  if (restDropMm !== 0) {
    scene.root.updateMatrixWorld(true);
    const headRotation = new Matrix4().extractRotation(scene.headBone.matrixWorld);
    const toBind = new Matrix3().setFromMatrix4(headRotation).transpose();
    const headDown = new Vector3(0, -restDropMm / 1000, 0).applyMatrix3(toBind);
    droppedBase = new Float32Array(newBase);
    for (const vertex of lowerArch) {
      droppedBase[vertex * 3] = (droppedBase[vertex * 3] ?? 0) + headDown.x;
      droppedBase[vertex * 3 + 1] = (droppedBase[vertex * 3 + 1] ?? 0) + headDown.y;
      droppedBase[vertex * 3 + 2] = (droppedBase[vertex * 3 + 2] ?? 0) + headDown.z;
    }
  }
  const honestDropCheck = restDropMm === 0 ? honestCheck : restRimGap(droppedBase);

  const teethInputDeltas: Record<string, Float32Array> = Object.fromEntries(
    teethNames.map((name, targetIndex) => {
      const accessor = teethPrim.listTargets()[targetIndex]?.getAttribute("POSITION");
      const values = accessor ? floatArray(accessor) : new Float32Array(teethBase.length);
      if (values.length !== teethBase.length) throw new Error(`teeth target ${name} length moved`);
      return [name, values];
    }),
  );

  // FF pressed lips: edit the body viseme_FF bind delta on the press
  // falloff domain BEFORE morph transfer, so the rim-copied lower-teeth FF
  // delta is recomputed from the pressed rim. Upper-arch FF stays
  // pre-image verbatim.
  let ffContact: FfLipContact | null = null;
  let transferBodyDeltas = bodyDeltas;
  if (ffLipContact) {
    const ffBodyIndex = bodyTargets.indexOf("viseme_FF");
    if (ffBodyIndex < 0) throw new Error("FF contact: body has no viseme_FF target");
    const teethFf = teethInputDeltas["viseme_FF"];
    if (!teethFf) throw new Error("FF contact: teeth have no viseme_FF target");
    const bodyIndexArr = bodyIndexAttr.getArray();
    if (!bodyIndexArr) throw new Error("empty body index");
    ffContact = await solveFfLipContact({
      glbPath,
      bodyBase,
      bodyDeltaFf: bodyDeltas[ffBodyIndex] ?? new Float32Array(bodyBase.length),
      bodyDeltaAa: bodyDeltas[aaIndex] ?? new Float32Array(bodyBase.length),
      bodyJoints,
      bodyWeights,
      jointNodes,
      bodyIndex: bodyIndexArr,
      teethBase,
      teethShellBase: droppedBase,
      teethDeltaFf: teethFf,
      teethJoints: jointArray,
      teethWeights: weightArray,
    });
    if (!ffContact) throw new Error("FF contact: missing contacted field");
    const contactedFf = ffContact.editedBodyFf;
    transferBodyDeltas = bodyDeltas.map((delta, index) => (index === ffBodyIndex ? contactedFf : delta));
  }

  const transfer = transferArch({
    teethBase, bodyBase, bodyDeltas: transferBodyDeltas, bodyTargets, teethNames, bodyJoints, bodyWeights,
    lowerArch, rimTris, newBase, forceRigid, teethSkinJoints, teethCount, jointArray, weightArray,
    teethInputDeltas,
  });
  const { newJoints, newWeights, newDeltas, distortionMm, rigid, jawMaxVerts } = transfer;

  // Upper-arch morph silence (operator 2026-10-06): upper teeth carry no
  // viseme deltas. The pre-image carries Oct-1 rigid translations on
  // head-weighted verts (probe aa upper +8.3 mm); zeroing restores the
  // 206009a30-c57cc153a posture. Base, skinning, and lower-arch transfer
  // above are untouched, so the edge-to-rim construction is unchanged.
  for (const targetName of Object.keys(newDeltas)) {
    const field = newDeltas[targetName];
    if (!field) throw new Error(`no delta for ${targetName}`);
    for (const vertex of upperArch) {
      field[vertex * 3] = 0;
      field[vertex * 3 + 1] = 0;
      field[vertex * 3 + 2] = 0;
    }
  }

  // Variant-A down gain: scale the vertical head-local component of each
  // lower-arch teeth viseme delta. Head-local comes from the head bone rest
  // world rotation (rotation only, no translation, no scale), so the rule
  // carries to other rigs. Forward component, jaw rotation, lip and body
  // morphs are untouched. Default 1 is a no-op.
  if (downGain !== 1) {
    scene.root.updateMatrixWorld(true);
    const headRotation = new Matrix4().extractRotation(scene.headBone.matrixWorld);
    const toHead = new Matrix3().setFromMatrix4(headRotation);
    const toBind = toHead.clone().transpose();
    const point = new Vector3();
    for (const targetName of Object.keys(newDeltas)) {
      const field = newDeltas[targetName];
      if (!field) throw new Error(`no delta for ${targetName}`);
      for (const vertex of lowerArch) {
        point
          .set(field[vertex * 3] ?? 0, field[vertex * 3 + 1] ?? 0, field[vertex * 3 + 2] ?? 0)
          .applyMatrix3(toHead);
        point.y *= downGain;
        point.applyMatrix3(toBind);
        field[vertex * 3] = point.x;
        field[vertex * 3 + 1] = point.y;
        field[vertex * 3 + 2] = point.z;
      }
    }
  }

  const plan: RimSeatPlan = {
    rimCount: rim.length,
    rimTriangles: rimTris.length,
    lowerArchCount: lowerArch.length,
    targetGapMm,
    restGap0Mm: Math.round(restGap0 * 1e6) / 1e3,
    restShiftMm: Math.round(rimShift * 1e6) / 1e3,
    faceMarginRest0Mm: Math.round(face.marginAtRest * 1e6) / 1e3,
    faceMarginCap0Mm: Math.round(face.marginAtCap * 1e6) / 1e3,
    faceSafetyMm: FACE_SAFETY_M * 1000,
    clearancePlaneMm: Math.round(planeZ * 1e6) / 1e3,
    pullbackVertCount,
    pullbackMaxMm: Math.round(pullbackMax * 1e6) / 1e3,
    pullbackMeanMm: Math.round((pullbackVertCount === 0 ? 0 : pullbackSum / pullbackVertCount) * 1e6) / 1e3,
    pullbackPasses,
    downGain,
    restDropMm,
    ffLipContact,
    ffGapBeforeMm: ffContact?.ffGapBeforeMm ?? 0,
    ffGapAfterMm: ffContact?.ffGapAfterMm ?? 0,
    ffPasses: ffContact?.ffPasses ?? 0,
    ffCorrectedVerts: ffContact?.ffCorrectedVerts ?? 0,
    ffMaxCorrectionMm: ffContact?.ffMaxCorrectionMm ?? 0,
    ffPressRings: ffContact?.ffPressRings ?? 0,
    ffPressPredictedJumpMm: ffContact?.ffPressPredictedJumpMm ?? 0,
    ffContactNeighborJumpMm: ffContact?.ffContactNeighborJumpMm ?? 0,
    ffCoverExcessBeforeMm: ffContact?.ffCoverExcessBeforeMm ?? 0,
    ffCoverCorrectedVerts: ffContact?.ffCoverCorrectedVerts ?? 0,
    ffCoverMaxMm: ffContact?.ffCoverMaxMm ?? 0,
    ffCoverPasses: ffContact?.ffCoverPasses ?? 0,
    ffGapFinalMm: ffContact?.ffGapFinalMm ?? 0,
    ffCoverMinClearanceMm: ffContact?.ffCoverMinClearanceMm ?? 0,
    ffCoverNeighborJumpMm: ffContact?.ffCoverNeighborJumpMm ?? 0,
    honestRestGapMm: Math.round(honestDropCheck * 1e6) / 1e3,
    rigid,
    distortionMm,
    jawMaxVerts,
    teethCount,
  };
  return { plan, newBase: droppedBase, newJoints, newWeights, newDeltas, jointsType: teethJointsType, ...(ffContact ? { newBodyFf: ffContact.editedBodyFf } : {}) };
}

/** Rim gap: mean 3D distance from lower-shell verts to the nearest rim vert. */
function rimGap(
  teethWorld: Float32Array,
  shellLower: readonly number[],
  bodyWorld: Float32Array,
  rim: readonly number[],
): number {
  let sum = 0;
  for (const tooth of shellLower) {
    const tx = teethWorld[tooth * 3] ?? 0;
    const ty = teethWorld[tooth * 3 + 1] ?? 0;
    const tz = teethWorld[tooth * 3 + 2] ?? 0;
    let best = Infinity;
    for (const lip of rim) {
      const dx = (bodyWorld[lip * 3] ?? 0) - tx;
      const dy = (bodyWorld[lip * 3 + 1] ?? 0) - ty;
      const dz = (bodyWorld[lip * 3 + 2] ?? 0) - tz;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < best) best = dist;
    }
    sum += Math.sqrt(best);
  }
  return sum / (shellLower.length || 1);
}

/** In-place accessor overwrite honoring interleaved byteStride. Counts and types must match. */
function writeAccessorBytes(
  json: GlbJson,
  bin: Buffer,
  accessorIndex: number,
  values: ArrayLike<number>,
  count: number,
  components: number,
): void {
  const accessor = json.accessors[accessorIndex] as {
    bufferView: number;
    byteOffset?: number;
    count: number;
    componentType: number;
    type: string;
    min?: number[];
    max?: number[];
  };
  const view = json.bufferViews[accessor.bufferView] as
    | { byteOffset?: number; byteLength?: number; byteStride?: number }
    | undefined;
  if (!accessor || !view) throw new Error(`accessor ${accessorIndex} missing`);
  const size =
    accessor.componentType === 5121 ? 1 : accessor.componentType === 5123 ? 2 : accessor.componentType === 5126 ? 4 : 0;
  const expectType = components === 3 ? "VEC3" : "VEC4";
  if (accessor.count !== count || accessor.type !== expectType || size === 0) {
    throw new Error(`accessor ${accessorIndex} is not ${expectType} x${count}`);
  }
  const stride = view.byteStride ?? components * size;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (start + (count - 1) * stride + components * size > bin.length) {
    throw new Error(`accessor ${accessorIndex} overruns the buffer`);
  }
  const min: number[] = [];
  const max: number[] = [];
  for (let axis = 0; axis < components; axis += 1) {
    min.push(Infinity);
    max.push(-Infinity);
  }
  for (let vertex = 0; vertex < count; vertex += 1) {
    for (let axis = 0; axis < components; axis += 1) {
      const value = values[vertex * components + axis] ?? 0;
      const at = start + vertex * stride + axis * size;
      if (size === 1) {
        if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`joint index out of range: ${value}`);
        bin.writeUInt8(value, at);
      } else if (size === 2) {
        bin.writeUInt16LE(value, at);
      } else {
        bin.writeFloatLE(value, at);
      }
      min[axis] = Math.min(min[axis] ?? 0, value);
      max[axis] = Math.max(max[axis] ?? 0, value);
    }
  }
  accessor.min = min;
  accessor.max = max;
}

async function main(): Promise<void> {
  const wallStart = Date.now();
  const { glbPath, targetGapMm, dry, rigid, downGain, restDropMm, ffLipContact } = readArgs();
  const { plan, newBase, newJoints, newWeights, newDeltas, newBodyFf } = await planRimSeat(glbPath, targetGapMm, rigid, downGain, restDropMm, ffLipContact);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (dry) {
    process.stdout.write(`wall clock ${((Date.now() - wallStart) / 1000).toFixed(1)}s (dry run, no write)\n`);
    return;
  }
  const file = readFileSync(glbPath);
  if (file.readUInt32LE(0) !== 0x46546c67) throw new Error("not a glb");
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson;
  const binHeader = 20 + jsonLength;
  const binLength = json.buffers[0]?.byteLength;
  if (typeof binLength !== "number") throw new Error("missing buffer length");
  let bin = Buffer.from(file.subarray(binHeader + 8, binHeader + 8 + binLength));
  const teeth = json.meshes.find((mesh) => mesh.name !== undefined && /fitted_teeth/i.test(mesh.name));
  const primitive = teeth?.primitives[0];
  if (!teeth || !primitive) throw new Error("teeth primitive missing from JSON");
  const existing = teeth.extras?.targetNames ?? [];
  const plannedNames = Object.keys(newDeltas);
  if (existing.length !== plannedNames.length || !plannedNames.every((name) => existing.includes(name))) {
    throw new Error(`teeth target names moved: ${existing.join(",")}`);
  }
  const existingIndex = new Map(existing.map((name, index) => [name, index]));
  const targets: { POSITION: number }[] = [];
  for (const name of existing) {
    const values = newDeltas[name];
    if (!values) throw new Error(`no delta for ${name}`);
    const prior = existingIndex.get(name);
    const accessorIndex = prior === undefined ? undefined : primitive.targets?.[prior]?.POSITION;
    if (typeof accessorIndex !== "number") throw new Error(`missing POSITION on ${name}`);
    writeAccessorBytes(json, bin, accessorIndex, values, plan.teethCount, 3);
    targets.push({ POSITION: accessorIndex });
  }
  primitive.targets = targets;
  const baseAccessor = (primitive as { attributes?: { POSITION?: number } }).attributes?.POSITION;
  if (typeof baseAccessor !== "number") throw new Error("teeth primitive has no POSITION attribute");
  writeAccessorBytes(json, bin, baseAccessor, newBase, plan.teethCount, 3);
  const jointsAccessor = (primitive as { attributes?: { JOINTS_0?: number } }).attributes?.JOINTS_0;
  const weightsAccessor = (primitive as { attributes?: { WEIGHTS_0?: number } }).attributes?.WEIGHTS_0;
  if (typeof jointsAccessor !== "number" || typeof weightsAccessor !== "number") {
    throw new Error("teeth primitive has no skinning attributes");
  }
  writeAccessorBytes(json, bin, jointsAccessor, newJoints, plan.teethCount, 4);
  writeAccessorBytes(json, bin, weightsAccessor, newWeights, plan.teethCount, 4);
  if (newBodyFf) {
    const body = json.meshes.find((mesh) => mesh.name !== undefined && /_body$/i.test(mesh.name));
    const bodyPrim = body?.primitives[0];
    if (!body || !bodyPrim) throw new Error("body primitive missing from JSON");
    const bodyNames = body.extras?.targetNames ?? [];
    const ffIndex = bodyNames.indexOf("viseme_FF");
    if (ffIndex < 0) throw new Error("body has no viseme_FF target");
    const ffAccessor = bodyPrim.targets?.[ffIndex]?.POSITION;
    if (typeof ffAccessor !== "number") throw new Error("missing POSITION on body viseme_FF");
    const bodyPosAccessor = (bodyPrim as { attributes?: { POSITION?: number } }).attributes?.POSITION;
    if (typeof bodyPosAccessor !== "number") throw new Error("body primitive has no POSITION attribute");
    const bodyCount = (json.accessors[bodyPosAccessor] as { count: number }).count;
    const ffAccess = json.accessors[ffAccessor] as
      | { count: number; type: string; sparse?: unknown; bufferView?: number }
      | undefined;
    if (!ffAccess || ffAccess.count !== bodyCount || ffAccess.type !== "VEC3") {
      throw new Error(`body viseme_FF accessor ${ffAccessor} is not VEC3 x${bodyCount}`);
    }
    if (ffAccess.sparse) {
      // Densify once: body morphs ship sparse; the edited FF field is full.
      // Idempotent: a rerun finds a dense accessor and overwrites in place.
      while (bin.length % 4 !== 0) bin = Buffer.concat([bin, Buffer.alloc(1)]);
      const byteOffset = bin.length;
      const dense = Buffer.alloc(newBodyFf.length * 4);
      for (let i = 0; i < newBodyFf.length; i += 1) dense.writeFloatLE(newBodyFf[i] ?? 0, i * 4);
      bin = Buffer.concat([bin, dense]);
      const viewIndex = json.bufferViews.length;
      json.bufferViews.push({ buffer: 0, byteOffset, byteLength: dense.length, target: 34962 });
      ffAccess.bufferView = viewIndex;
      delete ffAccess.sparse;
    }
    writeAccessorBytes(json, bin, ffAccessor, newBodyFf, bodyCount, 3);
  }
  const outBuffer = json.buffers[0];
  if (!outBuffer) throw new Error("missing buffer length");
  outBuffer.byteLength = bin.length;
  writeGlb(json, bin, glbPath);
  const bytes = readFileSync(glbPath);
  process.stdout.write(
    `wrote ${glbPath} sha256=${createHash("sha256").update(bytes).digest("hex")} bytes=${bytes.length}\n`,
  );
  process.stdout.write(`wall clock ${((Date.now() - wallStart) / 1000).toFixed(1)}s\n`);
}

if (import.meta.url === new URL(`file://${process.argv[1] ?? ""}`).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
