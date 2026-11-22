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
  lipPurseWeights,
} from "@openclinxr/xr-dialogue/package-viseme";
import type { HeadlessScene } from "./headless-scene.js";

export type LipRoundingDriver = "on" | "off";
export type LipRoundingTable = Parameters<typeof applyLipBoneRoundingToRoot>[2];
export type LipPurseTable = Parameters<typeof lipPurseWeights>[1];
export type Lateral10 = { lo: number[]; hi: number[] };
export type Midline = { upper: number[]; lower: number[] };

/** All-zero purse table: the w=0 baseline and the frozen-at-E midline pose. */
const ZERO_PURSE_TABLE: LipPurseTable = [
  { viseme: "O", key: "mouth-pursing", weight: 0, source: "b1 w=0 baseline" },
  { viseme: "O", key: "mouth-protusion", weight: 0, source: "b1 w=0 baseline" },
  { viseme: "U", key: "mouth-pursing", weight: 0, source: "b1 w=0 baseline" },
  { viseme: "U", key: "mouth-protusion", weight: 0, source: "b1 w=0 baseline" },
];

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

function skinnedHeadXY(scene: HeadlessScene, indices: readonly number[]): Array<{ x: number; y: number }> {
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
    const head = acc.applyMatrix4(H);
    return { x: head.x * 1000, y: head.y * 1000 };
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

/** Pose plus optional bone-table override and purse morphs (0 for absent keys). */
function poseForMeasure(
  scene: HeadlessScene,
  ph: string,
  driver: LipRoundingDriver,
  table?: LipRoundingTable,
  purse?: LipPurseTable,
): void {
  const drive = pose(scene, ph);
  if (table) applyLipBoneRoundingToRoot(scene.root, drive.weights, table);
  else if (driver === "off") applyLipBoneRoundingToRoot(scene.root, {});
  if (purse) {
    const dict = scene.body.skinned.morphTargetDictionary ?? {};
    const influences = scene.body.skinned.morphTargetInfluences ?? [];
    const amounts = lipPurseWeights(drive.weights, purse);
    for (const key of ["mouth-pursing", "mouth-protusion"] as const) {
      const index = dict[key];
      if (typeof index === "number" && index >= 0 && index < influences.length) {
        influences[index] = amounts[key] ?? 0;
      }
    }
  }
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
  try {
    const lip = orisDominantVerts(scene);
    const xs = skinnedHeadXY(scene, lip).map((p) => p.x);
    const order = lip.map((v, k) => [v, xs[k]!] as const).sort((a, b) => a[1] - b[1]);
    const lo = order.slice(0, 10).map(([v]) => v);
    const hi = order.slice(-10).map(([v]) => v);
    if (new Set(lo).size !== 10 || new Set(hi).size !== 10 || lo.some((v) => hi.includes(v)))
      throw new Error(`lateral-10 needs 10 distinct ids per side with empty overlap (oris-dominant ${lip.length})`);
    return { lo, hi };
  } finally {
    clearPose(scene);
  }
}

/** Mean head-local x span (hi - lo), mm, at the held phoneme. */
export function widthMm(
  scene: HeadlessScene,
  ids: Lateral10,
  ph: string,
  driver: LipRoundingDriver = "on",
  table?: LipRoundingTable,
  purse?: LipPurseTable,
): number {
  poseForMeasure(scene, ph, driver, table, purse);
  try {
    const xs = skinnedHeadXY(scene, [...ids.lo, ...ids.hi]).map((p) => p.x);
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
    return assertPositiveSpan(mean(xs.slice(10)) - mean(xs.slice(0, 10)));
  } finally {
    clearPose(scene);
  }
}

/** 100 * (1 - width(ph) / width(E)) under the same driver state. */
export function narrowPct(
  scene: HeadlessScene,
  ids: Lateral10,
  ph: string,
  driver: LipRoundingDriver = "on",
  table?: LipRoundingTable,
  purse?: LipPurseTable,
): number {
  return 100 * (1 - widthMm(scene, ids, ph, driver, table, purse) / widthMm(scene, ids, "E", driver, table, purse));
}

/**
 * Frozen midline ids chosen ONCE per actor at E, driver on, NO purse (same
 * discipline as pickLateral10): candidates = oris-dominant verts with
 * |head-local x| <= 2 mm at that pose; split at their mean y; upper = the 5
 * upper verts with the LOWEST y (inner edge of the upper lip), lower = the 5
 * lower verts with the HIGHEST y (inner edge of the lower lip). Throws unless
 * each side has 5 distinct ids and the sides are disjoint.
 */
export function pickMidline(scene: HeadlessScene): Midline {
  poseForMeasure(scene, "E", "on", undefined, ZERO_PURSE_TABLE);
  try {
    const lip = orisDominantVerts(scene);
    const at = skinnedHeadXY(scene, lip);
    const cand = lip.filter((_, k) => Math.abs(at[k]!.x) <= 2);
    if (cand.length === 0) throw new Error("midline candidate set empty at E");
    const ys = cand.map((v) => at[lip.indexOf(v)]!.y);
    const mean = ys.reduce((s, y) => s + y, 0) / ys.length;
    if (!Number.isFinite(mean)) throw new Error("midline E mean y not finite");
    const upperPool = cand
      .map((v, k) => [v, ys[k]!] as const)
      .filter(([, y]) => y > mean)
      .sort((a, b) => a[1] - b[1]);
    const lowerPool = cand
      .map((v, k) => [v, ys[k]!] as const)
      .filter(([, y]) => y <= mean)
      .sort((a, b) => b[1] - a[1]);
    const upper = upperPool.slice(0, 5).map(([v]) => v);
    const lower = lowerPool.slice(0, 5).map(([v]) => v);
    if (
      new Set(upper).size !== 5 ||
      new Set(lower).size !== 5 ||
      upper.some((v) => lower.includes(v))
    )
      throw new Error(
        `midline needs 5 distinct ids per side with empty overlap (upper pool ${upperPool.length}, lower pool ${lowerPool.length})`,
      );
    return { upper, lower };
  } finally {
    clearPose(scene);
  }
}

/**
 * Head-local y means (mm) of frozen midline upper/lower ids at the held
 * phoneme, same posing path as apertureHeightMm. Throws when non-finite.
 */
export function lipMidlineYMm(
  scene: HeadlessScene,
  ids: Midline,
  ph: string,
  driver: LipRoundingDriver = "on",
  table?: LipRoundingTable,
  purse?: LipPurseTable,
): { upperMm: number; lowerMm: number } {
  poseForMeasure(scene, ph, driver, table, purse);
  try {
    const at = skinnedHeadXY(scene, [...ids.upper, ...ids.lower]);
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
    const out = {
      upperMm: mean(at.slice(0, ids.upper.length).map((p) => p.y)),
      lowerMm: mean(at.slice(ids.upper.length).map((p) => p.y)),
    };
    if (!Number.isFinite(out.upperMm) || !Number.isFinite(out.lowerMm))
      throw new Error(`midline head-local y not finite at ${ph}`);
    return out;
  } finally {
    clearPose(scene);
  }
}

/** Lower-lip drop (mm) under a purse table vs the w=0 baseline at the same phoneme. */
export function lowerDropMm(
  scene: HeadlessScene,
  ids: Midline,
  ph: string,
  purse?: LipPurseTable,
  driver: LipRoundingDriver = "on",
  table?: LipRoundingTable,
): number {
  const base = lipMidlineYMm(scene, ids, ph, driver, table, ZERO_PURSE_TABLE);
  const at = lipMidlineYMm(scene, ids, ph, driver, table, purse);
  return base.lowerMm - at.lowerMm;
}

/** Upper-lip rise (mm) under a purse table vs the w=0 baseline at the same phoneme. */
export function upperRiseMm(
  scene: HeadlessScene,
  ids: Midline,
  ph: string,
  purse?: LipPurseTable,
  driver: LipRoundingDriver = "on",
  table?: LipRoundingTable,
): number {
  const base = lipMidlineYMm(scene, ids, ph, driver, table, ZERO_PURSE_TABLE);
  const at = lipMidlineYMm(scene, ids, ph, driver, table, purse);
  return at.upperMm - base.upperMm;
}

/**
 * Head-local vertical aperture (mm) at the held phoneme from frozen midline
 * ids: mean(y of upper ids) minus mean(y of lower ids). No re-selection per
 * call. Throws when the height is not finite.
 */
export function apertureHeightMm(
  scene: HeadlessScene,
  ids: Midline,
  ph: string,
  driver: LipRoundingDriver = "on",
  table?: LipRoundingTable,
  purse?: LipPurseTable,
): number {
  const { upperMm, lowerMm } = lipMidlineYMm(scene, ids, ph, driver, table, purse);
  const height = upperMm - lowerMm;
  if (!Number.isFinite(height)) throw new Error(`aperture height not finite at ${ph}`);
  return height;
}
