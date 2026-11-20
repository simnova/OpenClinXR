/**
 * Upper-incisor display for the mouth verifier (upper-incisor-show P1).
 *
 * Measures, on an already-driven HeadlessScene, how far the upper incisal
 * edge shows below the upper lip, in head-local millimetres. Positive =
 * edge below the lip (crown shows); negative = edge hidden behind the lip.
 *
 * DISPLAY RULES (STATED — S0, reused exactly):
 * - Head-local mm via the scene.headBone.matrixWorld inverse after
 *   refreshing world matrices + skeletons (same freshness order as
 *   tongue-channel.ts: root.updateMatrixWorld, skeleton.update x3,
 *   root.updateMatrixWorld).
 * - Upper teeth = teeth verts whose dominant skin joint is NOT in the jaw
 *   subtree (lowerArchIndices gives the jaw-subtree set; the complement is
 *   upper). Dominant = the slot with the largest skin weight.
 * - Edge band: |x| <= 4 mm (central), 4 < |x| <= 10 mm (lateral),
 *   12 <= |x| <= 20 mm (canine). Within a band: front z = max z over the
 *   set; face = verts within 3 mm of front z; edge y = min y over the face
 *   (the incisal edge); crown top y = max y over the face; crown height =
 *   top minus edge.
 * - Upper-lip set per band (B1): body verts in the band's x window (|x| <= 2
 *   central, 4-10 lateral, 12-20 canine; signed +6..+12 L, -12..-6 R,
 *   -2..+2 central for the raise means) whose dominant skin joint is NOT in
 *   the jaw subtree (the same live jaw-subtree walk lowerArchIndices uses
 *   for the teeth), AND z >= upperFrontZ - 6 mm AND |y - upperEdgeY| <= 20
 *   mm, where upperFrontZ = max z over the upper central incisor set and
 *   upperEdgeY = the central incisal edge y at the same pose (S0
 *   measure-upper-incisor.mts facial-mask window). This replaces the
 *   oris05/head joint filter everywhere: the lip corners at |x| 12-20 are
 *   driven by oris03, never oris05, and oris01 drives the LOWER lip
 *   (lip-bone-rounding.ts), so oris01 must stay out — the jaw-subtree
 *   exclusion keeps it out. No largest-y-gap lip split (S0 v1 defect: the
 *   gap split inside the upper lip).
 * - Upper-lip low per band = min y over the admitted set; display per band
 *   = upper-lip low y minus edge y.
 * - Lip raise: mean upper-lip y (same admitted-set rule) over x in +6..+12
 *   (L; +x is L by definition here) minus mean over -12..-6 (R);
 *   L-minus-central and R-minus-central subtract the central -2..+2 mean.
 * - Fail-soft per band (B3): a band with fewer than 3 admitted verts reports
 *   null for that band (and null for any raise diff touching it) instead of
 *   throwing or returning a single-vert value; the count rides in bandVerts.
 *   The RED asserts central only.
 * - upperEdgeYMm = central edge y; upperEdgeZMm = central front z.
 *
 * Fail-closed on teeth sets (throw when empty); fail-soft on lip bands (B3:
 * null + count when fewer than 3 admitted verts).
 */
import { Matrix4, Vector3 } from "three";
import type { Bone, Object3D } from "three";
import { lowerArchIndices } from "./tongue-channel.js";
import {
  boneMatrices,
  morphedPositions,
  round3,
  skinPositions,
} from "./scene-math.js";
import type { HeadlessMesh, HeadlessScene } from "./headless-scene.js";

/** One posed upper-incisor display reading. All mm are head-local. */
/** Display bands report null when fewer than 3 lip verts are admitted (B3). */
export type UpperIncisorDisplay = {
  /** Upper-lip low y minus central edge y. Positive = crown shows. */
  centralDisplayMm: number | null;
  /** Same rule over the 4-10 mm |x| bands. */
  lateralDisplayMm: number | null;
  /** Same rule over the 12-20 mm |x| bands. */
  canineDisplayMm: number | null;
  /** Mean lip y over +6..+12 minus mean over -12..-6. */
  lipRaiseLMinusRMm: number | null;
  /** Mean lip y over +6..+12 minus central -2..+2 mean. */
  lipRaiseLMinusCentralMm: number | null;
  /** Mean lip y over -12..-6 minus central -2..+2 mean. */
  lipRaiseRMinusCentralMm: number | null;
  /** Central incisal edge y. */
  upperEdgeYMm: number;
  /** Central front z (max z over the central upper set). */
  upperEdgeZMm: number;
  /** Central crown top minus central edge. */
  crownHeightMm: number;
  /** Admitted upper-lip vert counts per band (B3: <3 verts -> null band). */
  bandVerts: {
    central: number;
    lateral: number;
    canine: number;
    raiseL: number;
    raiseR: number;
    raiseCentral: number;
  };
};

/** Dominant skin-joint name for one vertex of a headless mesh. */
function dominantJointName(mesh: HeadlessMesh, vertex: number): string {
  let joint = mesh.joints[vertex * 4] ?? 0;
  let best = mesh.weights[vertex * 4] ?? 0;
  for (let slot = 1; slot < 4; slot += 1) {
    const next = mesh.weights[vertex * 4 + slot] ?? 0;
    if (next > best) {
      best = next;
      joint = mesh.joints[vertex * 4 + slot] ?? joint;
    }
  }
  return mesh.jointNodes[joint]?.getName?.() ?? "";
}

/** Names of the jaw bone and every bone below it (live walk, same rule as lowerArchIndices in tongue-channel.ts). */
function jawSubtreeNames(jawBone: Bone): Set<string> {
  const names = new Set<string>();
  const stack: Object3D[] = [jawBone];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    names.add(node.name);
    stack.push(...node.children);
  }
  return names;
}

/** Head-local positions (mm) of a mesh under the current drive state. */
function headLocalMm(scene: HeadlessScene, mesh: HeadlessMesh): Float32Array {
  scene.root.updateMatrixWorld(true);
  mesh.skeleton.update();
  scene.root.updateMatrixWorld(true);
  const world = skinPositions(
    mesh,
    morphedPositions(mesh, mesh.skinned.morphTargetInfluences ?? []),
    boneMatrices(mesh),
  );
  const inverse = new Matrix4().copy(scene.headBone.matrixWorld).invert();
  const point = new Vector3();
  const out = new Float32Array(world.length);
  for (let i = 0; i < world.length; i += 3) {
    point
      .set(world[i] ?? 0, world[i + 1] ?? 0, world[i + 2] ?? 0)
      .applyMatrix4(inverse);
    out[i] = (point.x ?? 0) * 1000;
    out[i + 1] = (point.y ?? 0) * 1000;
    out[i + 2] = (point.z ?? 0) * 1000;
  }
  return out;
}

/** Edge y, front z and crown height over one |x| band of upper teeth. */
function teethBand(
  positions: Float32Array,
  indices: readonly number[],
  minAbsX: number,
  maxAbsX: number,
  label: string,
): { edgeY: number; frontZ: number; crownHeight: number } {
  const band = indices.filter((vertex) => {
    const ax = Math.abs(positions[vertex * 3] ?? 0);
    return ax > minAbsX && ax <= maxAbsX;
  });
  if (band.length === 0) throw new Error(`upper-incisor ${label} teeth set is empty`);
  let frontZ = -Infinity;
  for (const vertex of band) frontZ = Math.max(frontZ, positions[vertex * 3 + 2] ?? -Infinity);
  const face = band.filter(
    (vertex) => (positions[vertex * 3 + 2] ?? -Infinity) >= frontZ - 3,
  );
  if (face.length === 0) throw new Error(`upper-incisor ${label} face set is empty`);
  let edgeY = Infinity;
  let topY = -Infinity;
  for (const vertex of face) {
    edgeY = Math.min(edgeY, positions[vertex * 3 + 1] ?? Infinity);
    topY = Math.max(topY, positions[vertex * 3 + 1] ?? -Infinity);
  }
  return { edgeY, frontZ, crownHeight: topY - edgeY };
}

/** Admitted upper-lip verts for one x window: non-jaw-subtree dominant joint + facial-mask window. */
function admittedLipVerts(
  positions: Float32Array,
  mesh: HeadlessMesh,
  jawNames: ReadonlySet<string>,
  minX: number,
  maxX: number,
  absolute: boolean,
  anchor: { frontZ: number; edgeY: number },
): { verts: number[]; byJoint: Record<string, number> } {
  const count = positions.length / 3;
  const verts: number[] = [];
  const byJoint: Record<string, number> = {};
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = positions[vertex * 3] ?? 0;
    if (absolute ? Math.abs(x) <= minX || Math.abs(x) > maxX : x < minX || x > maxX) continue;
    const joint = dominantJointName(mesh, vertex);
    if (jawNames.has(joint)) continue;
    if ((positions[vertex * 3 + 2] ?? -Infinity) < anchor.frontZ - 6) continue;
    if (Math.abs((positions[vertex * 3 + 1] ?? 0) - anchor.edgeY) > 20) continue;
    verts.push(vertex);
    byJoint[joint] = (byJoint[joint] ?? 0) + 1;
  }
  return { verts, byJoint };
}

/** Min lip y over one admitted set; null when fewer than 3 verts (B3). */
function lipLowY(set: { verts: number[] }, positions: Float32Array): number | null {
  if (set.verts.length < 3) return null;
  let lowY = Infinity;
  for (const vertex of set.verts) lowY = Math.min(lowY, positions[vertex * 3 + 1] ?? Infinity);
  return lowY;
}

/** Mean lip y over one admitted set; null when fewer than 3 verts (B3). */
function lipMeanY(set: { verts: number[] }, positions: Float32Array): number | null {
  if (set.verts.length < 3) return null;
  let sum = 0;
  for (const vertex of set.verts) sum += positions[vertex * 3 + 1] ?? 0;
  return sum / set.verts.length;
}

/**
 * Refresh after the caller's drive, then admit the upper-lip sets for every
 * band off the same central anchor. Shared by the measure and the histogram
 * helper so both read identical sets.
 */
function currentBands(scene: HeadlessScene) {
  // Freshness: the drive sets bone rotations without updating the graph, so
  // refresh before reading (same order as tongue-channel.ts).
  scene.root.updateMatrixWorld(true);
  scene.body.skeleton.update();
  scene.teeth.skeleton.update();
  scene.tongue?.skeleton.update();
  scene.root.updateMatrixWorld(true);

  const lowerArch = new Set(lowerArchIndices(scene.teeth, scene.jawBone));
  const teethCount = scene.teeth.base.length / 3;
  const upper: number[] = [];
  for (let vertex = 0; vertex < teethCount; vertex += 1) {
    if (!lowerArch.has(vertex)) upper.push(vertex);
  }
  if (upper.length === 0) throw new Error("upper-incisor upper-teeth set is empty");

  const teeth = headLocalMm(scene, scene.teeth);
  const lips = headLocalMm(scene, scene.body);

  const central = teethBand(teeth, upper, 0, 4, "central");
  const lateral = teethBand(teeth, upper, 4, 10, "lateral");
  const canine = teethBand(teeth, upper, 12, 20, "canine");

  const jawNames = jawSubtreeNames(scene.jawBone);
  return {
    teeth,
    lips,
    central,
    lateral,
    canine,
    jawNames,
    centralSet: admittedLipVerts(lips, scene.body, jawNames, 0, 2, true, central),
    lateralSet: admittedLipVerts(lips, scene.body, jawNames, 4, 10, true, central),
    canineSet: admittedLipVerts(lips, scene.body, jawNames, 12, 20, true, central),
    raiseLSet: admittedLipVerts(lips, scene.body, jawNames, 6, 12, false, central),
    raiseRSet: admittedLipVerts(lips, scene.body, jawNames, -12, -6, false, central),
    raiseCentralSet: admittedLipVerts(lips, scene.body, jawNames, -2, 2, false, central),
  };
}

/** Dominant-joint histogram of one admitted lip band. */
export type UpperLipBandHistogram = {
  count: number;
  byJoint: Record<string, number>;
};

/**
 * Dominant-joint histograms of the admitted upper-lip verts per band on the
 * current scene drive state (B1 evidence; same sets the measure reads).
 */
export function upperLipBandHistograms(scene: HeadlessScene): {
  jawSubtree: string[];
  central: UpperLipBandHistogram;
  lateral: UpperLipBandHistogram;
  canine: UpperLipBandHistogram;
  raiseL: UpperLipBandHistogram;
  raiseR: UpperLipBandHistogram;
  raiseCentral: UpperLipBandHistogram;
} {
  const bands = currentBands(scene);
  const hist = (set: { verts: number[]; byJoint: Record<string, number> }): UpperLipBandHistogram => ({
    count: set.verts.length,
    byJoint: set.byJoint,
  });
  return {
    jawSubtree: [...bands.jawNames].sort(),
    central: hist(bands.centralSet),
    lateral: hist(bands.lateralSet),
    canine: hist(bands.canineSet),
    raiseL: hist(bands.raiseLSet),
    raiseR: hist(bands.raiseRSet),
    raiseCentral: hist(bands.raiseCentralSet),
  };
}

/**
 * Measure upper-incisor display on the current scene drive state. The caller
 * drives the scene first (e.g. applyNamedSpeechVisemes for aa); this function
 * only refreshes matrices/skeletons and reads geometry.
 */
export function measureUpperIncisorDisplay(scene: HeadlessScene): UpperIncisorDisplay {
  const bands = currentBands(scene);
  const { central, lateral, canine } = bands;

  const centralLip = lipLowY(bands.centralSet, bands.lips);
  const lateralLip = lipLowY(bands.lateralSet, bands.lips);
  const canineLip = lipLowY(bands.canineSet, bands.lips);

  const meanL = lipMeanY(bands.raiseLSet, bands.lips);
  const meanR = lipMeanY(bands.raiseRSet, bands.lips);
  const meanCentral = lipMeanY(bands.raiseCentralSet, bands.lips);
  const diff = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : round3(a - b);

  return {
    centralDisplayMm: centralLip === null ? null : round3(centralLip - central.edgeY),
    lateralDisplayMm: lateralLip === null ? null : round3(lateralLip - lateral.edgeY),
    canineDisplayMm: canineLip === null ? null : round3(canineLip - canine.edgeY),
    lipRaiseLMinusRMm: diff(meanL, meanR),
    lipRaiseLMinusCentralMm: diff(meanL, meanCentral),
    lipRaiseRMinusCentralMm: diff(meanR, meanCentral),
    upperEdgeYMm: round3(central.edgeY),
    upperEdgeZMm: round3(central.frontZ),
    crownHeightMm: round3(central.crownHeight),
    bandVerts: {
      central: bands.centralSet.verts.length,
      lateral: bands.lateralSet.verts.length,
      canine: bands.canineSet.verts.length,
      raiseL: bands.raiseLSet.verts.length,
      raiseR: bands.raiseRSet.verts.length,
      raiseCentral: bands.raiseCentralSet.verts.length,
    },
  };
}
