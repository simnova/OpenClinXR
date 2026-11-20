/**
 * Tongue channel for the mouth verifier (aisha-tongue-at-rest S0a, fix1).
 *
 * Per pose, head-local z of the tongue tip (max over tongue verts, after
 * skinning/morphs) minus the lower-incisor crown front (max z over the
 * lower-arch teeth verts, after skinning/morphs). Posing goes through the
 * runtime's own public drive (`applyNamedSpeechVisemes` from
 * `@openclinxr/xr-dialogue/package-viseme`, the same entry the evaluator's
 * prepared-audio path funnels through) — no jaw angles or morph weights are
 * reimplemented here.
 *
 * Lower-arch rule (STATED): a teeth vertex is lower-arch when its dominant
 * skin joint is the jaw bone or a descendant of it in the scene graph. On the
 * shipped MPFB rig the skin joint is named `jaw` and its descendants are the
 * lip/tongue chain (special04, oris02, oris01, oris06/07.L/R, tongue00-07);
 * upper teeth are head-driven. The max over that row lands on the central
 * incisor crowns (they are the most forward lower verts on all three MPFB
 * actors). The rule names the bone off the loaded GLB skin joints and walks
 * the live bone hierarchy, so it stays correct if the rig is re-exported.
 *
 * Freshness (F1 fix): every measurement refreshes world matrices and
 * skeletons after the drive poses the head and before reading skinned
 * positions, so the first read per actor is never bind-pose.
 */
import { Matrix4, Vector3, type Bone, type Object3D } from "three";
import { applyNamedSpeechVisemes } from "@openclinxr/xr-dialogue/package-viseme";
import { loadHeadlessScene, type HeadlessMesh, type HeadlessScene } from "./headless-scene.js";
import { boneMatrices, morphedPositions, round3, skinPositions } from "./scene-math.js";

/** Stated lower-arch rule, recorded in premise.json beside the numbers. */
export const LOWER_ARCH_RULE =
  "lower arch = teeth verts whose dominant skin joint is the jaw bone or a descendant of it " +
  "(skin-weight rule off the GLB joints, jaw subtree walked live); " +
  "crown front = max head-local z over that set; tongue tip = max head-local z over all tongue verts";

/** Poses the tongue channel reports, in order. */
export const TONGUE_POSES = ["bind", "sil", "aa"] as const;

/** One pose label. */
export type TonguePose = (typeof TONGUE_POSES)[number];

/** One posed tongue-against-incisors reading. */
export type TonguePoseRow = {
  /** Pose label. */
  pose: TonguePose;
  /** Head-local z of the tongue tip (max over tongue verts), mm. */
  tongueTipZMm: number;
  /** Head-local z of the lower-incisor crown front (max over lower arch), mm. */
  crownFrontZMm: number;
  /** Tongue tip minus crown front, mm. Positive = tongue anterior. */
  tongueTipMinusIncisorZMm: number;
  /** Tongue vertex count measured. */
  tongueVerts: number;
  /** Lower-arch vertex count measured. */
  archVerts: number;
  /** Active viseme target reported by the runtime drive (null at bind). */
  activeTargetName: string | null;
  /** Jaw bone aperture applied by the runtime drive, radians. */
  jawOpenRadians: number;
};

/** Names of the jaw bone and every bone below it: the lower-arch driver set. */
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

/** Dominant skin-joint name for one teeth vertex. */
function teethDominantJointName(teeth: HeadlessMesh, vertex: number): string {
  let joint = teeth.joints[vertex * 4] ?? 0;
  let best = teeth.weights[vertex * 4] ?? 0;
  for (let slot = 1; slot < 4; slot += 1) {
    const next = teeth.weights[vertex * 4 + slot] ?? 0;
    if (next > best) {
      best = next;
      joint = teeth.joints[vertex * 4 + slot] ?? joint;
    }
  }
  return teeth.jointNodes[joint]?.getName?.() ?? "";
}

/**
 * Lower-arch vertex indices: teeth verts whose dominant skin joint is the jaw
 * bone or a descendant of it (F2 fix: replaces the bind-y-cutoff rule, which
 * admitted the head-weighted upper-incisor vertex 3878 over the jaw-weighted
 * lower-incisor vertex 2386 on Aisha). The jaw subtree is walked live off the
 * passed jaw bone, so the rule follows the loaded GLB rig.
 */
export function lowerArchIndices(teeth: HeadlessMesh, jawBone: Bone): number[] {
  const jawNames = jawSubtreeNames(jawBone);
  const count = teeth.base.length / 3;
  const out: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    if (jawNames.has(teethDominantJointName(teeth, vertex))) out.push(vertex);
  }
  return out;
}

/** Max head-local z over an index set, given posed world positions. */
export function headLocalMaxZ(scene: HeadlessScene, world: Float32Array, indices: readonly number[]): number {
  scene.root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(scene.headBone.matrixWorld).invert();
  const point = new Vector3();
  let max = -Infinity;
  for (const vertex of indices) {
    point.set(world[vertex * 3] ?? 0, world[vertex * 3 + 1] ?? 0, world[vertex * 3 + 2] ?? 0).applyMatrix4(inverse);
    if (point.z > max) max = point.z;
  }
  return max;
}

/** Posed world positions of a mesh under the current scene drive state. */
function posedWorld(mesh: HeadlessScene["body"]): Float32Array {
  const influences = mesh.skinned.morphTargetInfluences ?? [];
  return skinPositions(mesh, morphedPositions(mesh, influences), boneMatrices(mesh));
}

/**
 * F1 fix: refresh world matrices plus every skeleton after the drive poses
 * the head and before reading skinned positions. The runtime drive sets bone
 * rotations without updating the scene graph, so without this the first read
 * per actor uses bind-pose matrices (Aisha aa tip 89.663 vs 85.738 mm).
 */
function refreshAfterDrive(scene: HeadlessScene): void {
  scene.root.updateMatrixWorld(true);
  scene.body.skeleton.update();
  scene.teeth.skeleton.update();
  scene.tongue?.skeleton.update();
  scene.root.updateMatrixWorld(true);
}

/**
 * Measure tongue-tip-minus-incisor on the current scene drive state.
 * Throws when the asset has no fitted tongue.
 */
export function tongueTipMinusIncisor(
  scene: HeadlessScene,
  arch: readonly number[],
): { tongueTipZMm: number; crownFrontZMm: number; diffMm: number } {
  if (!scene.tongue) throw new Error("asset has no fitted tongue mesh");
  if (arch.length === 0) throw new Error("lower-arch vertex set is empty");
  refreshAfterDrive(scene);
  const tongueWorld = posedWorld(scene.tongue);
  const teethWorld = posedWorld(scene.teeth);
  const allTongue = Array.from({ length: scene.tongue.base.length / 3 }, (_, i) => i);
  const tongueTipZMm = headLocalMaxZ(scene, tongueWorld, allTongue) * 1000;
  const crownFrontZMm = headLocalMaxZ(scene, teethWorld, arch) * 1000;
  return { tongueTipZMm, crownFrontZMm, diffMm: tongueTipZMm - crownFrontZMm };
}

/**
 * Planted-control helper: recompute the channel after translating the posed
 * tongue world by shiftMm along head-local +Z. The shift is applied as the
 * head z-axis in world space, so the head-local re-measurement must move by
 * exactly shiftMm; any deviation is channel math error, not posing.
 */
export function shiftedTongueDiffMm(scene: HeadlessScene, arch: readonly number[], shiftMm: number): number {
  if (!scene.tongue) throw new Error("asset has no fitted tongue mesh");
  scene.root.updateMatrixWorld(true);
  const axis = new Vector3(0, 0, 1).transformDirection(scene.headBone.matrixWorld);
  const shiftM = shiftMm / 1000;
  const tongueWorld = posedWorld(scene.tongue);
  for (let i = 0; i < tongueWorld.length; i += 3) {
    tongueWorld[i] = (tongueWorld[i] ?? 0) + axis.x * shiftM;
    tongueWorld[i + 1] = (tongueWorld[i + 1] ?? 0) + axis.y * shiftM;
    tongueWorld[i + 2] = (tongueWorld[i + 2] ?? 0) + axis.z * shiftM;
  }
  const teethWorld = posedWorld(scene.teeth);
  const allTongue = Array.from({ length: scene.tongue.base.length / 3 }, (_, i) => i);
  return headLocalMaxZ(scene, tongueWorld, allTongue) * 1000 - headLocalMaxZ(scene, teethWorld, arch) * 1000;
}
/**
 * Drive the scene to one pose through the runtime public drive and read the
 * tongue channel. Bind = as-loaded (no drive call); sil/aa = the runtime's
 * own `applyNamedSpeechVisemes` speech path (silence vs a held AA phoneme at
 * mid-utterance progress), the same entry the evaluator's prepared-audio path
 * funnels through.
 */
export function poseAndMeasureTongue(scene: HeadlessScene, pose: TonguePose): TonguePoseRow {
  let activeTargetName: string | null = null;
  let jawOpenRadians = 0;
  if (pose !== "bind") {
    const result =
      pose === "sil"
        ? applyNamedSpeechVisemes({ root: scene.root }, 0)
        : applyNamedSpeechVisemes(
            {
              root: scene.root,
              activeSpeech: { phonemeSequence: ["AA"], startedAtMs: 0, durationMs: 1000 },
            },
            500,
          );
    if (result.appliedMeshCount === 0) throw new Error(`pose ${pose} drove no viseme mesh`);
    activeTargetName = result.activeTargetName;
    jawOpenRadians = result.jawOpenRadians;
  }
  if (!scene.tongue) throw new Error("asset has no fitted tongue mesh");
  const arch = lowerArchIndices(scene.teeth, scene.jawBone);
  const { tongueTipZMm, crownFrontZMm, diffMm } = tongueTipMinusIncisor(scene, arch);
  return {
    pose,
    tongueTipZMm: round3(tongueTipZMm),
    crownFrontZMm: round3(crownFrontZMm),
    tongueTipMinusIncisorZMm: round3(diffMm),
    tongueVerts: scene.tongue.base.length / 3,
    archVerts: arch.length,
    activeTargetName,
    jawOpenRadians: round3(jawOpenRadians),
  };
}

/** Probe all three poses on one GLB with a fresh scene per pose. */
export async function probeTongueRest(glbPath: string): Promise<{ rows: TonguePoseRow[]; wallMs: number }> {
  const wallStart = Date.now();
  const rows: TonguePoseRow[] = [];
  for (const pose of TONGUE_POSES) {
    const scene = await loadHeadlessScene(glbPath);
    rows.push(poseAndMeasureTongue(scene, pose));
  }
  return { rows, wallMs: Date.now() - wallStart };
}

/**
 * Skin-joint names driving the tongue primitive (tongue chain + jaw), read
 * off the loaded tongue mesh. S0c names the same bones in the browser.
 */
export function tongueSkinJointNames(scene: HeadlessScene): string[] {
  if (!scene.tongue) throw new Error("asset has no fitted tongue mesh");
  return scene.tongue.jointNodes.map((joint) => joint.getName() ?? "");
}
