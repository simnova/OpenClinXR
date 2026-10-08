/**
 * Premise probe for the mouth verifier (MADR 0061 verifier).
 *
 * Static morph response per viseme at its runtime jaw angle. Poses the jaw
 * with the runtime's own applier (no audio drive), then diffs posed-with-morph
 * against posed-without at the same angle, in head-local z. No blends, no
 * springs, no pixels: pure geometry in ms.
 */
import { readFileSync } from "node:fs";
import { applyJawOpenToRoot } from "@openclinxr/xr-dialogue/package-viseme";
import { jawOpenRadiansForPhoneme } from "@openclinxr/xr-dialogue/package-viseme";
import { Matrix4, Vector3 } from "three";
import { loadHeadlessScene } from "./headless-scene.js";
import {
  frontShellIndices,
  lowerLipInnerRim,
  lowerLipLandmark,
} from "./lip-shell.js";
import { boneMatrices, morphedPositions, round3, skinPositions } from "./scene-math.js";
import type { HeadlessMesh } from "./headless-scene.js";
import type { PremiseProbeRow } from "./verifier-types.js";

/**
 * JAW_TEETH_GAIN is deliberately not published by xr-dialogue (see its viseme-runtime subpath), so the
 * probe reads the shipped literal from the one module that defines it rather than restating the number.
 * The runtime path (evaluate) never needs it: the prepared playback applies it internally.
 */
const JAW_TEETH_GAIN = (() => {
  const source = readFileSync(new URL("../../../xr-dialogue/src/viseme-morph-apply.ts", import.meta.url), "utf8");
  const match = /export const JAW_TEETH_GAIN = ([0-9.]+);/u.exec(source);
  if (!match?.[1]) throw new Error("mouth-verifier: JAW_TEETH_GAIN literal not found in viseme-morph-apply.ts");
  return Number(match[1]);
})();

/** OVR viseme tokens in canonical order; the probe reports the ones present. */
const PROBE_OVR_TOKENS = [
  "aa", "E", "I", "O", "U", "PP", "FF", "nn", "DD", "SS", "TH", "RR", "kk", "CH", "sil",
] as const;

/**
 * One-minute premise probe: static morph response per viseme at its runtime
 * jaw angle. Poses the jaw with the runtime's own applier (no audio drive),
 * then diffs posed-with-morph against posed-without at the same angle, in
 * head-local z. No blends, no springs, no pixels: pure geometry in ms.
 */
export async function probePremise(glbPath: string): Promise<{
  rows: PremiseProbeRow[];
  visemes: string[];
  wallMs: number;
}> {
  const wallStart = Date.now();
  const scene = await loadHeadlessScene(glbPath);
  const teethShells = frontShellIndices(scene.teeth.base);
  const aaIndex = scene.body.targetNames.indexOf("viseme_aa");
  if (aaIndex < 0) throw new Error("body has no viseme_aa target");
  const lipLandmark = lowerLipLandmark(
    scene.body.targetDeltas[aaIndex] ?? new Float32Array(scene.body.base.length),
    scene.body.joints,
    scene.body.weights,
    scene.body.jointNodes,
  );
  if (scene.body.normals.length !== scene.body.base.length) {
    throw new Error("body mesh has no NORMAL accessor for the inner-rim rule");
  }
  const innerRim = lowerLipInnerRim(
    scene.body.base,
    scene.body.normals,
    scene.body.targetDeltas[aaIndex] ?? new Float32Array(scene.body.base.length),
    scene.body.joints,
    scene.body.weights,
    scene.body.jointNodes,
    scene.teeth.base,
  );
  const bodyDict = new Map(scene.body.targetNames.map((name, index) => [name, index]));
  const teethDict = new Map(scene.teeth.targetNames.map((name, index) => [name, index]));
  const teethJaw = scene.teeth.jointNodes.findIndex((joint) => /^jaw$/i.test(joint.getName() ?? ""));
  const bodyJaw = scene.body.jointNodes.findIndex((joint) => /^jaw$/i.test(joint.getName() ?? ""));
  const jawShare = (mesh: HeadlessMesh, jawIndex: number, indices: readonly number[]): number => {
    if (jawIndex < 0 || indices.length === 0) return 0;
    let sum = 0;
    for (const vertex of indices) {
      for (let slot = 0; slot < 4; slot += 1) {
        if ((mesh.joints[vertex * 4 + slot] ?? -1) === jawIndex) sum += mesh.weights[vertex * 4 + slot] ?? 0;
      }
    }
    return sum / indices.length;
  };
  const headZMean = (worldA: Float32Array, worldB: Float32Array, indices: readonly number[]): number => {
    scene.root.updateMatrixWorld(true);
    const inverse = new Matrix4().copy(scene.headBone.matrixWorld).invert();
    // Directions only: drop translation so free vectors are not offset.
    inverse.setPosition(0, 0, 0);
    const point = new Vector3();
    let sum = 0;
    for (const vertex of indices) {
      point
        .set(
          (worldB[vertex * 3] ?? 0) - (worldA[vertex * 3] ?? 0),
          (worldB[vertex * 3 + 1] ?? 0) - (worldA[vertex * 3 + 1] ?? 0),
          (worldB[vertex * 3 + 2] ?? 0) - (worldA[vertex * 3 + 2] ?? 0),
        )
        .applyMatrix4(inverse);
      sum += point.z;
    }
    return (sum / (indices.length || 1)) * 1000;
  };
  const posePair = (
    bodyName: string | null,
    teethName: string | null,
    jawRadians: number,
  ): { bodyA: Float32Array; bodyB: Float32Array; teethA: Float32Array; teethB: Float32Array } => {
    const zeroBody = scene.body.targetNames.map(() => 0);
    const zeroTeeth = scene.teeth.targetNames.map(() => 0);
    applyJawOpenToRoot(scene.root, jawRadians);
    const bodyA = skinPositions(scene.body, morphedPositions(scene.body, zeroBody), boneMatrices(scene.body));
    const teethA = skinPositions(scene.teeth, morphedPositions(scene.teeth, zeroTeeth), boneMatrices(scene.teeth));
    if (bodyName !== null) {
      const weights = scene.body.targetNames.map(() => 0);
      weights[bodyDict.get(bodyName) ?? -1] = 1;
      const withBody = skinPositions(scene.body, morphedPositions(scene.body, weights), boneMatrices(scene.body));
      if (teethName !== null) {
        const tweights = scene.teeth.targetNames.map(() => 0);
        tweights[teethDict.get(teethName) ?? -1] = 1;
        return {
          bodyA,
          bodyB: withBody,
          teethA,
          teethB: skinPositions(scene.teeth, morphedPositions(scene.teeth, tweights), boneMatrices(scene.teeth)),
        };
      }
      return { bodyA, bodyB: withBody, teethA, teethB: teethA };
    }
    return { bodyA, bodyB: bodyA, teethA, teethB: teethA };
  };
  const rows: PremiseProbeRow[] = [];
  for (const token of PROBE_OVR_TOKENS) {
    const bodyName = `viseme_${token}`;
    if (!bodyDict.has(bodyName)) continue;
    const teethName = teethDict.has(bodyName) ? bodyName : null;
    const jawRadians = jawOpenRadiansForPhoneme(token) * JAW_TEETH_GAIN;
    const posed = posePair(bodyName, teethName, jawRadians);
    rows.push({
      viseme: bodyName,
      jawDegrees: round3((jawRadians * 180) / Math.PI),
      lipOuterZMm: round3(headZMean(posed.bodyA, posed.bodyB, lipLandmark)),
      rimZMm: round3(headZMean(posed.bodyA, posed.bodyB, innerRim)),
      teethLowerZMm: round3(headZMean(posed.teethA, posed.teethB, teethShells.lower)),
      teethUpperZMm: round3(headZMean(posed.teethA, posed.teethB, teethShells.upper)),
      rimJawShare: round3(jawShare(scene.body, bodyJaw, innerRim)),
      teethJawShare: round3(jawShare(scene.teeth, teethJaw, teethShells.lower)),
    });
  }
  applyJawOpenToRoot(scene.root, 0);
  return { rows, visemes: rows.map((row) => row.viseme), wallMs: Date.now() - wallStart };
}
