/**
 * Geometric lip-rounding gate: headless lateral-10 mouth width from
 * oris-dominant verts, head-local x (mm). Replaces the pixel fissure
 * instrument (5 failed approaches, store s1/c1); O/U narrowing already
 * shows in geometry (known-good: store lip-rounding/s1/rig/rig-probe.json).
 */
import { Matrix4, Vector3 } from "three";
import {
  applyLipBoneRoundingToRoot,
  applyNamedSpeechVisemes,
} from "@openclinxr/xr-dialogue/package-viseme";
import type { HeadlessScene } from "./headless-scene.js";

export type LipRoundingDriver = "on" | "off";
export type LipRoundingTable = Parameters<typeof applyLipBoneRoundingToRoot>[2];
export type Lateral10 = { lo: number[]; hi: number[] };

/** Throw unless mm is a positive finite width; returns mm. Guards crossed corners. */
export function assertPositiveSpan(mm: number): number {
  if (!Number.isFinite(mm) || mm <= 0)
    throw new Error(`lateral-10 span ${mm} mm is not a positive finite width`);
  return mm;
}

/** Single GATE predicate shared by GATE and CW-Z (o >= 15 and u >= 15). */
export function roundingGatePasses(o: number, u: number): boolean {
  return o >= 15 && u >= 15;
}

function headLocal(scene: HeadlessScene): Matrix4 {
  scene.root.updateMatrixWorld(true);
  return new Matrix4().copy(scene.headBone.matrixWorld).invert();
}

function skinnedHeadX(scene: HeadlessScene, indices: readonly number[]): number[] {
  const mesh = scene.body;
  const H = headLocal(scene);
  mesh.skinned.updateMatrixWorld(true);
  mesh.skeleton.update();
  const bm = mesh.skeleton.bones.map(
    (b, j) => new Matrix4().multiplyMatrices(b.matrixWorld, mesh.skeleton.boneInverses[j]!),
  );
  const infl = mesh.skinned.morphTargetInfluences ?? [];
  return indices.map((i) => {
    const v = new Vector3(mesh.base[3 * i]!, mesh.base[3 * i + 1]!, mesh.base[3 * i + 2]!);
    infl.forEach((w, t) => {
      if (!w) return;
      const d = mesh.targetDeltas[t]!;
      v.x += w * d[3 * i]!;
      v.y += w * d[3 * i + 1]!;
      v.z += w * d[3 * i + 2]!;
    });
    const acc = new Vector3();
    for (let k = 0; k < 4; k += 1) {
      const w = mesh.weights[4 * i + k]!;
      if (w) acc.add(v.clone().applyMatrix4(bm[mesh.joints[4 * i + k]!]!).multiplyScalar(w));
    }
    return acc.applyMatrix4(H).x * 1000;
  });
}

function pose(scene: HeadlessScene, ph: string) {
  return applyNamedSpeechVisemes(
    { root: scene.root, activeSpeech: { phonemeSequence: [ph], startedAtMs: 0, durationMs: 1000 } },
    500,
  );
}

function clearPose(scene: HeadlessScene): void {
  applyNamedSpeechVisemes({ root: scene.root });
}

/** Vertex i whose max-weight joint name matches /^oris/i. */
export function orisDominantVerts(scene: HeadlessScene): number[] {
  const bones = scene.body.skeleton.bones;
  const n = scene.body.base.length / 3;
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    let joint = -1;
    let best = 0;
    for (let k = 0; k < 4; k += 1) {
      const w = scene.body.weights[4 * i + k]!;
      if (w > best) {
        best = w;
        joint = scene.body.joints[4 * i + k]!;
      }
    }
    if (joint >= 0 && /^oris/i.test(bones[joint]!.name)) out.push(i);
  }
  return out;
}

/** Per side the 10 oris-dominant verts with most extreme head-local x at E driver-on. */
export function pickLateral10(scene: HeadlessScene): Lateral10 {
  pose(scene, "E");
  const lip = orisDominantVerts(scene);
  const xs = skinnedHeadX(scene, lip);
  const order = lip.map((v, k) => [v, xs[k]!] as const).sort((a, b) => a[1] - b[1]);
  clearPose(scene);
  const lo = order.slice(0, 10).map(([v]) => v);
  const hi = order.slice(-10).map(([v]) => v);
  if (new Set(lo).size !== 10 || new Set(hi).size !== 10 || lo.some((v) => hi.includes(v)))
    throw new Error(`lateral-10 needs 10 distinct ids per side with empty overlap (oris-dominant ${lip.length})`);
  return { lo, hi };
}

/** Mean head-local x span (hi - lo), mm, at the held phoneme. */
export function widthMm(
  scene: HeadlessScene,
  ids: Lateral10,
  ph: string,
  driver: LipRoundingDriver = "on",
  table?: LipRoundingTable,
): number {
  const drive = pose(scene, ph);
  if (table) applyLipBoneRoundingToRoot(scene.root, drive.weights, table);
  else if (driver === "off") applyLipBoneRoundingToRoot(scene.root, {});
  const xs = skinnedHeadX(scene, [...ids.lo, ...ids.hi]);
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
  const width = assertPositiveSpan(mean(xs.slice(10)) - mean(xs.slice(0, 10)));
  clearPose(scene);
  return width;
}

/** 100 * (1 - width(ph) / width(E)) under the same driver state. */
export function narrowPct(
  scene: HeadlessScene,
  ids: Lateral10,
  ph: string,
  driver: LipRoundingDriver = "on",
  table?: LipRoundingTable,
): number {
  return 100 * (1 - widthMm(scene, ids, ph, driver, table) / widthMm(scene, ids, "E", driver, table));
}
