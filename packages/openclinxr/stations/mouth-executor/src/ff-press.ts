/**
 * FF pressed-lips solve (MADR 0061 mouth executor).
 *
 * Moved verbatim from tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts
 * `solveFfLipContact` (plus `FfLipContact` and the FF press constants). Imports are
 * repointed at the executor's own modules. The tools CLI re-exports it; behavior unchanged.
 */
import { Matrix3, Matrix4, Vector3 } from "three";
import { applyJawOpenToRoot } from "@openclinxr/xr-dialogue/package-viseme";
import { jawOpenRadiansForPhoneme } from "@openclinxr/xr-dialogue/package-viseme";
import { loadHeadlessScene } from "./scene.js";
import { frontShellIndices, lowerLipLandmark } from "./lip-rim.js";
import { skinAtRest } from "./skin-at-rest.js";

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
