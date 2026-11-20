import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Matrix3, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  loadHeadlessScene,
  lowerArchIndices,
  poseAndMeasureTongue,
  type HeadlessScene,
  type TonguePose,
  type TonguePoseRow,
} from "./index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const GLBS: Record<string, string> = {
  "mpfb-ob-patient-aisha": join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb"),
  "mpfb-peds-nurse-kevin": join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb"),
  "mpfb-clinical-physician-adult": join(
    REPO_ROOT,
    "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
  ),
};
const POSES: TonguePose[] = ["bind", "sil", "aa"];

/** Explicit full matrix refresh: scene graph first, then every skeleton. */
function refreshScene(scene: HeadlessScene): void {
  scene.root.updateMatrixWorld(true);
  for (const mesh of [scene.body, scene.teeth, scene.tongue] as const) mesh?.skeleton.update();
  scene.root.updateMatrixWorld(true);
}

/** Dominant skin-joint name for one teeth vertex (independent reimplementation for R2). */
function teethDominantJointName(scene: HeadlessScene, vertex: number): string {
  const joints = scene.teeth.joints;
  const weights = scene.teeth.weights;
  let joint = joints[vertex * 4] ?? 0;
  let best = weights[vertex * 4] ?? 0;
  for (let slot = 1; slot < 4; slot += 1) {
    const next = weights[vertex * 4 + slot] ?? 0;
    if (next > best) {
      best = next;
      joint = joints[vertex * 4 + slot] ?? joint;
    }
  }
  return scene.teeth.jointNodes[joint]?.getName?.() ?? "";
}

/** Jaw bone plus every bone below it in the scene graph (independent reimplementation for R2). */
function jawBoneAndDescendants(scene: HeadlessScene): Set<string> {
  const names = new Set<string>();
  const stack = [scene.jawBone];
  while (stack.length > 0) {
    const bone = stack.pop();
    if (!bone) continue;
    names.add(bone.name);
    for (const child of bone.children) {
      if ((child as { isBone?: boolean }).isBone === true) stack.push(child as typeof scene.jawBone);
    }
  }
  return names;
}

/** Posed teeth world via CPU skinning (independent reimplementation for R2). */
function posedTeethWorld(scene: HeadlessScene): Float32Array {
  const teeth = scene.teeth;
  const influences = teeth.skinned.morphTargetInfluences ?? [];
  const morphed = new Float32Array(teeth.base);
  for (let target = 0; target < teeth.targetDeltas.length; target += 1) {
    const weight = influences[target] ?? 0;
    if (weight === 0) continue;
    const delta = teeth.targetDeltas[target];
    if (!delta) continue;
    for (let i = 0; i < morphed.length; i += 1) morphed[i] = (morphed[i] ?? 0) + weight * (delta[i] ?? 0);
  }
  teeth.skeleton.update();
  const skinMatrices = teeth.skeleton.boneMatrices;
  if (!skinMatrices) throw new Error("teeth skeleton has no bone matrices");
  const count = morphed.length / 3;
  const out = new Float32Array(morphed.length);
  const matrix = new Matrix4();
  const point = new Vector3();
  for (let vertex = 0; vertex < count; vertex += 1) {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = teeth.weights[vertex * 4 + slot] ?? 0;
      if (weight === 0) continue;
      matrix.fromArray(skinMatrices, (teeth.joints[vertex * 4 + slot] ?? 0) * 16);
      point
        .set(morphed[vertex * 3] ?? 0, morphed[vertex * 3 + 1] ?? 0, morphed[vertex * 3 + 2] ?? 0)
        .applyMatrix4(matrix);
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

/** Max head-local z vertex over an index set (independent reimplementation for R2). */
function argmaxHeadLocalZ(
  scene: HeadlessScene,
  world: Float32Array,
  indices: readonly number[],
): { vertex: number; zMm: number } {
  scene.root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(scene.headBone.matrixWorld).invert();
  const point = new Vector3();
  let best = -Infinity;
  let bestVertex = -1;
  for (const vertex of indices) {
    point
      .set(world[vertex * 3] ?? 0, world[vertex * 3 + 1] ?? 0, world[vertex * 3 + 2] ?? 0)
      .applyMatrix4(inverse);
    if (point.z > best) {
      best = point.z;
      bestVertex = vertex;
    }
  }
  return { vertex: bestVertex, zMm: best * 1000 };
}

/**
 * Translate the tongue BIND geometry along head-local +Z by shiftMm, per-vertex
 * through each vertex's dominant bone rotation so the world shift is exact for
 * single-bone verts. Returns the head-local tip z before the shift (for probe.log).
 */
function shiftTongueBindHeadLocalZ(scene: HeadlessScene, shiftMm: number): number {
  const tongue = scene.tongue;
  if (!tongue) throw new Error("asset has no fitted tongue mesh");
  refreshScene(scene);
  const before = poseAndMeasureTongue(scene, "sil").tongueTipZMm;
  const headLinear = new Matrix3().setFromMatrix4(scene.headBone.matrixWorld);
  const worldShift = new Vector3(0, 0, shiftMm / 1000).applyMatrix3(headLinear);
  const boneMatrices = tongue.skeleton.boneMatrices;
  if (!boneMatrices) throw new Error("tongue skeleton has no bone matrices");
  const boneMatrix = new Matrix4();
  const boneLinearInv = new Matrix3();
  const shift = new Vector3();
  const count = tongue.base.length / 3;
  for (let vertex = 0; vertex < count; vertex += 1) {
    let joint = tongue.joints[vertex * 4] ?? 0;
    let best = tongue.weights[vertex * 4] ?? 0;
    for (let slot = 1; slot < 4; slot += 1) {
      const next = tongue.weights[vertex * 4 + slot] ?? 0;
      if (next > best) {
        best = next;
        joint = tongue.joints[vertex * 4 + slot] ?? joint;
      }
    }
    boneMatrix.fromArray(boneMatrices, joint * 16);
    boneLinearInv.setFromMatrix4(boneMatrix).invert();
    shift.copy(worldShift).applyMatrix3(boneLinearInv);
    tongue.base[vertex * 3] = (tongue.base[vertex * 3] ?? 0) + shift.x;
    tongue.base[vertex * 3 + 1] = (tongue.base[vertex * 3 + 1] ?? 0) + shift.y;
    tongue.base[vertex * 3 + 2] = (tongue.base[vertex * 3 + 2] ?? 0) + shift.z;
  }
  return before;
}

describe("tongue channel reads rest tongue tip against the incisors", () => {
  it("lower-incisor crown vertex set is non-empty on each actor", async () => {
    for (const glbPath of Object.values(GLBS)) {
      const scene = await loadHeadlessScene(glbPath);
      expect(scene.tongue, `${glbPath} has a fitted tongue mesh`).not.toBeNull();
      const arch = lowerArchIndices(scene.teeth, scene.jawBone);
      expect(arch.length, `${glbPath} lower-arch set`).toBeGreaterThan(0);
    }
  }, 120000);

  it("tongue-tip-minus-incisor z is finite for every actor and pose (no threshold on Aisha)", async () => {
    for (const [asset, glbPath] of Object.entries(GLBS)) {
      for (const pose of POSES) {
        const scene = await loadHeadlessScene(glbPath);
        const row = poseAndMeasureTongue(scene, pose);
        expect(Number.isFinite(row.tongueTipMinusIncisorZMm), `${asset}/${pose} diff`).toBe(true);
        expect(Number.isFinite(row.tongueTipZMm), `${asset}/${pose} tip`).toBe(true);
        expect(Number.isFinite(row.crownFrontZMm), `${asset}/${pose} crown`).toBe(true);
        expect(row.tongueVerts, `${asset}/${pose} tongue verts`).toBeGreaterThan(0);
        expect(row.archVerts, `${asset}/${pose} arch verts`).toBeGreaterThan(0);
      }
    }
  }, 180000);

  it("R1 fresh-read: first aa tongue-tip read in a fresh scene equals the post-update reread within TOL", async () => {
    // TOL = max(0.05 mm, 3 x max repeat-read spread from fix1/pre-fix.json (a)):
    // spreads are 0.000 mm on all three actors, so 3 x 0 = 0 and TOL = 0.05 mm.
    const TOL_MM = 0.05;
    for (const [asset, glbPath] of Object.entries(GLBS)) {
      const scene = await loadHeadlessScene(glbPath);
      const first: TonguePoseRow = poseAndMeasureTongue(scene, "aa");
      refreshScene(scene);
      const second: TonguePoseRow = poseAndMeasureTongue(scene, "aa");
      expect(
        Math.abs(first.tongueTipZMm - second.tongueTipZMm),
        `${asset}/aa stale-vs-updated ${first.tongueTipZMm} vs ${second.tongueTipZMm}`,
      ).toBeLessThanOrEqual(TOL_MM);
    }
  }, 180000);

  it("R2 crown identity + position: the chosen crown is jaw-driven and is the jaw-set max", async () => {
    for (const [asset, glbPath] of Object.entries(GLBS)) {
      const scene = await loadHeadlessScene(glbPath);
      poseAndMeasureTongue(scene, "sil");
      refreshScene(scene);
      const jawNames = jawBoneAndDescendants(scene);
      const teethWorld = posedTeethWorld(scene);
      const count = scene.teeth.base.length / 3;
      const jawVerts: number[] = [];
      for (let vertex = 0; vertex < count; vertex += 1) {
        if (jawNames.has(teethDominantJointName(scene, vertex))) jawVerts.push(vertex);
      }
      expect(jawVerts.length, `${asset} jaw-driven teeth verts`).toBeGreaterThan(0);
      const ruleCrown = argmaxHeadLocalZ(scene, teethWorld, lowerArchIndices(scene.teeth, scene.jawBone));
      const jawMax = argmaxHeadLocalZ(scene, teethWorld, jawVerts);
      expect(
        jawNames.has(teethDominantJointName(scene, ruleCrown.vertex)),
        `${asset} rule crown v${ruleCrown.vertex} driven by ${teethDominantJointName(scene, ruleCrown.vertex)}`,
      ).toBe(true);
      expect(
        ruleCrown.vertex,
        `${asset} rule crown v${ruleCrown.vertex} vs jaw-set max v${jawMax.vertex}`,
      ).toBe(jawMax.vertex);
    }
  }, 180000);

  it("R3 planted control through the full path: +5 mm bind shift reads +5 mm, unrotated and root-rotated 30 deg", async () => {
    // Replaces "planted control: tongue translated +5 mm head-local z reads +5 mm within 0.1 mm",
    // which shifted an already-skinned buffer through a separate path (F3). The shift now moves
    // the tongue BIND geometry and the diff goes through the same poseAndMeasureTongue path.
    const SHIFT_MM = 5;
    const unrotated: Record<string, number> = {};
    for (const [asset, glbPath] of Object.entries(GLBS)) {
      const scene = await loadHeadlessScene(glbPath);
      refreshScene(scene);
      const base = poseAndMeasureTongue(scene, "sil").tongueTipMinusIncisorZMm;
      shiftTongueBindHeadLocalZ(scene, SHIFT_MM);
      const shifted = poseAndMeasureTongue(scene, "sil").tongueTipMinusIncisorZMm;
      unrotated[asset] = shifted - base;
      expect(Math.abs(shifted - base - SHIFT_MM), `${asset} unrotated +5mm`).toBeLessThanOrEqual(0.1);
    }
    for (const [asset, glbPath] of Object.entries(GLBS)) {
      const scene = await loadHeadlessScene(glbPath);
      scene.root.rotation.y = Math.PI / 6;
      refreshScene(scene);
      const base = poseAndMeasureTongue(scene, "sil").tongueTipMinusIncisorZMm;
      shiftTongueBindHeadLocalZ(scene, SHIFT_MM);
      const shifted = poseAndMeasureTongue(scene, "sil").tongueTipMinusIncisorZMm;
      expect(Math.abs(shifted - base - SHIFT_MM), `${asset} rotated +5mm`).toBeLessThanOrEqual(0.1);
      expect(
        Math.abs(shifted - base - (unrotated[asset] ?? Number.NaN)),
        `${asset} rotated matches unrotated`,
      ).toBeLessThanOrEqual(0.1);
    }
  }, 240000);
});
