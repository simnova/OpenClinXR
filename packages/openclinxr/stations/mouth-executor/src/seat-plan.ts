/**
 * Rim-seat plan (MADR 0061 mouth executor).
 *
 * Moved verbatim from tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts
 * `planRimSeat` (plus `RimSeatPlan`, the seat constants and the read helpers). Imports are
 * repointed at the executor's own modules. The tools CLI re-exports it; behavior unchanged.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { Matrix3, Matrix4, Vector3 } from "three";
import { loadHeadlessScene } from "./scene.js";
import { frontShellIndices, lowerLipInnerRim, rimGap } from "./lip-rim.js";
import { lowerArchByJoint } from "./lower-arch.js";
import { measureFaceMarginsFromDoc, runtimeCap } from "./face-median.js";
import { transferArch } from "./rim-transfer.js";
import { skinAtRest } from "./skin-at-rest.js";
import { type FfLipContact, solveFfLipContact } from "./ff-press.js";
import {
  readTongueInputs,
  solveTongueTh,
  type TongueThReport,
} from "./tongue-th.js";

const REST_TOL_M = 1e-4;
const REST_SHOTS = 8;
/** #739 uniform cap-margin target: the clearance plane sits this far behind the cap median. */
const FACE_SAFETY_M = 0.0005;
/** Quadratic pullback passes: residual max quarters each pass, so 16 always suffices. */
const PULLBACK_PASSES = 16;
/** Float32-safe epsilon: pullback stop tolerance and self-check bound, physically nothing. */
const SNAP_M = 1e-6;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

function floatArray(accessor: { getArray: () => ArrayLike<number> | null }): Float32Array {
  const array = accessor.getArray();
  if (!array) throw new Error("empty accessor");
  return array instanceof Float32Array ? array : Float32Array.from(array);
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
  /** Tongue interdental TH solve (always on; the tongue otherwise never shows). */
  tongueTh: TongueThReport;
  rigid: boolean;
  distortionMm: Record<string, number>;
  jawMaxVerts: number;
  teethCount: number;
};

export type SeatResult = {
  plan: RimSeatPlan;
  newBase: Float32Array;
  newJoints: number[];
  newWeights: number[];
  newDeltas: Record<string, Float32Array>;
  jointsType: number;
  /** Edited body viseme_FF bind delta; defined only with ffLipContact. */
  newBodyFf?: Float32Array;
  /** Solved tongue viseme_TH bind delta (the tongue's only morph target). */
  newTongueTh: Float32Array;
};

/**
 * Plan the rim seat for one GLB path: rest offset, face pullback, rest drop,
 * FF press, rim transfer, upper silence, down gain and the tongue TH solve.
 * Pure plan plus replacement fields; the caller writes the bytes.
 */
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

  // Tongue interdental TH: the tongue mesh ships target-less, so TH never
  // shows the tongue. Solved here (always on) from the seated teeth base so
  // the tip lands on the committed incisal edges; body and teeth fields
  // above are untouched by the solve.
  const tongueInputs = readTongueInputs(doc);
  const thBodyIndex = bodyTargets.indexOf("viseme_TH");
  if (thBodyIndex < 0) throw new Error("body has no viseme_TH target");
  const { delta: newTongueTh, report: tongueTh } = await solveTongueTh({
    glbPath,
    ...tongueInputs,
    teethBase: droppedBase,
    bodyBase,
    bodyDeltaAa: bodyDeltas[aaIndex] ?? new Float32Array(bodyBase.length),
    bodyDeltaTh: bodyDeltas[thBodyIndex] ?? new Float32Array(bodyBase.length),
    bodyJoints,
    bodyWeights,
    jointNodes,
  });

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
    tongueTh,
    rigid,
    distortionMm,
    jawMaxVerts,
    teethCount,
  };
  return { plan, newBase: droppedBase, newJoints, newWeights, newDeltas, jointsType: teethJointsType, newTongueTh, ...(ffContact ? { newBodyFf: ffContact.editedBodyFf } : {}) };
}
