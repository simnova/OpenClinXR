/**
 * Phase attribution for the SC-05 high step (DENSE_v1 slice 1).
 *
 * Question: does the foot-base high step (knee max 75.0 deg, toe peak
 * 0.118 m vs plan-only 55.5 / 0.077; swing-7.json) come from the clip or
 * from foot-base's composition?
 *
 * Per foot, phase-normalised (0..1 from lift-off to next lift-off, 50 bins)
 * curves of knee flexion and toe Y, for FOUR series on SC-05:
 *   (1) source clip Mesh2Motion Walk, native rig (offline GLB FK);
 *   (2) bound clip on MPFB, offline (same recipe as walk-playback-blend);
 *   (3) plan-only live (existing capture, footstepPlan=1&fixedClock=1);
 *   (4) foot-base live (existing capture, +&footBase=1).
 * Plus for series 4: row-target toe Y vs achieved toe Y, raised-cosine XZ
 * progress vs stored row along01 at the same phase, reach ratio
 * |hip-ankle|/limb, and per-bone quaternion norm min/max.
 *
 * Contact rule everywhere: toe Y within FOOT_CONTACT_HEIGHT_METERS (0.06,
 * the production constant, imported not retyped) of the series' own floor
 * (min toe Y of that foot over the sampled frames). Lift-off = first
 * above-band sample after contact; segments run lift-off to next lift-off
 * and are linearly resampled to 50 bins, then averaged.
 *
 * Decision rule (pre-registered): RMSE of the knee curve between
 * consecutive series (1->2, 2->3, 2->4); the first stage whose knee RMSE
 * exceeds 5 deg owns the march. Quaternion |norm-1| <= 1e-4 on every
 * series or the curve is invalid.
 *
 * INSTRUMENT ONLY. Reads committed captures/GLBs; writes no product code.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/phase-attribution.ts \
 *     [--source-glb=...] [--bound-glb=...] \
 *     [--plan=.openclinxr/evidence/foot-base-routes/measure-1/plan-sc05/sc05-run0.json] \
 *     [--footbase=.openclinxr/evidence/foot-base-routes/measure-1/fb-sc05/sc05-run0.json] \
 *     [--out=.openclinxr/evidence/attrib/phase-attribution.json] \
 *     [--svg=.openclinxr/evidence/attrib/phase-attribution.svg]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Node as GltfNode } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";
import { FOOT_CONTACT_HEIGHT_METERS } from "@openclinxr/asset-registry/approach-executor";
import {
  FOOT_BASE_LIFT_PHASE,
  FOOT_BASE_ROWS,
  FOOT_BASE_STANCE_FRACTION,
  footBaseRowAt,
} from "@openclinxr/xr-humanoid-animation/foot-base";

/**
 * Plant-relative height datum per foot, mirroring FOOT_BASE_HEIGHT_DATUM
 * (foot-base-schedule-mod, deliberately not a public export): the minimum
 * row height over the foot's stance rows. Recomputed here from the public
 * FOOT_BASE_ROWS so this instrument binds no internal module.
 */
function heightDatum(side: "left" | "right"): number {
  let min = Infinity;
  for (const row of FOOT_BASE_ROWS[side] ?? []) {
    if (row.phase < FOOT_BASE_STANCE_FRACTION[side] && row.heightM < min) min = row.heightM;
  }
  return min;
}

export const PHASE_BINS = 50;
const QUAT_NORM_TOL = 1e-4;
const KNEE_RMSE_OWNERSHIP_DEG = 5;
const BOUND_ACTOR_SCALE = 0.86;

/**
 * Strict index read: every array indexed here is dense by construction, so
 * an out-of-range index is a logic error, surfaced loudly instead of
 * flowing on as undefined. (Keeps the staged biome lint green without
 * non-null assertions.)
 */
export function at<T>(xs: ArrayLike<T>, i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`index ${i} out of range (len ${xs.length})`);
  return v;
}

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

function arg(name: string, fallback: string): string {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return flag ?? fallback;
}

/** Lift-off indices: first above-band sample after a contact run. */
export function detectLiftOffs(contact: boolean[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < contact.length; i += 1) {
    if (contact[i] === true && contact[i - 1] === false) {
      // i is first contact (touchdown); lift-off is the reverse edge.
    }
    if (contact[i] === false && contact[i - 1] === true) out.push(i);
  }
  return out;
}

/** Linearly resample samples[lo..hi] (inclusive) onto `bins` bins. */
export function resampleSegment(samples: number[], lo: number, hi: number, bins: number): number[] {
  const out: number[] = [];
  const span = hi - lo;
  for (let b = 0; b < bins; b += 1) {
    const pos = span <= 0 ? lo : lo + (b / (bins - 1)) * span;
    const i0 = Math.floor(pos);
    const i1 = Math.min(hi, i0 + 1);
    const f = pos - i0;
    out.push(at(samples, i0) + (at(samples, i1) - at(samples, i0)) * f);
  }
  return out;
}

/** Mean curve over lift-off-to-lift-off segments; null when <1 segment. */
export function meanPhaseCurve(
  samples: number[],
  contact: boolean[],
  bins: number,
): { mean: number[]; nSegments: number } | null {
  const los = detectLiftOffs(contact);
  const curves: number[][] = [];
  for (let k = 0; k + 1 < los.length; k += 1) {
    const lo = at(los, k);
    const hi = at(los, k + 1);
    if (hi - lo < 5) continue;
    const seg = samples.slice(lo, hi + 1);
    if (seg.some((v) => typeof v !== "number" || !Number.isFinite(v))) continue;
    curves.push(resampleSegment(seg, 0, seg.length - 1, bins));
  }
  if (curves.length === 0) return null;
  const avg = new Array<number>(bins).fill(0);
  for (const c of curves) for (let b = 0; b < bins; b += 1) avg[b] = at(avg, b) + at(c, b) / curves.length;
  return { mean: avg, nSegments: curves.length };
}

export function rmse(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += (at(a, i) - at(b, i)) ** 2;
  return Math.sqrt(s / a.length);
}

/**
 * RMSE over bins finite in BOTH curves (live walks cover only part of the
 * cycle, so the intersection is what compares). Returns NaN with n=0.
 */
export function rmseIntersection(
  a: Array<number | null>,
  b: Array<number | null>,
): { rmse: number; nBins: number } {
  let s = 0;
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const x = at(a, i);
    const y = at(b, i);
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
      s += (x - y) ** 2;
      n += 1;
    }
  }
  return n === 0 ? { rmse: NaN, nBins: 0 } : { rmse: Math.sqrt(s / n), nBins: n };
}

/**
 * Shift-tolerant RMSE: min over circular bin-shifts (with the arg-shift),
 * isolating curve SHAPE from phase misalignment. Same intersection rule.
 */
export function rmseShiftTolerant(
  a: Array<number | null>,
  b: Array<number | null>,
): { best: number; shiftBins: number; nBins: number } {
  const n = Math.min(a.length, b.length);
  let best = Infinity;
  let bestShift = 0;
  let bestN = 0;
  for (let shift = 0; shift < n; shift += 1) {
    let s = 0;
    let c = 0;
    for (let i = 0; i < n; i += 1) {
      const x = at(a, i);
      const y = at(b, (i + shift) % n);
      if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
        s += (x - y) ** 2;
        c += 1;
      }
    }
    if (c > 0 && s / c < best) {
      best = s / c;
      bestShift = shift;
      bestN = c;
    }
  }
  return best === Infinity ? { best: NaN, shiftBins: 0, nBins: 0 } : { best: Math.sqrt(best), shiftBins: bestShift, nBins: bestN };
}

/**
 * Anchor binning: every sample carries its lift-off-normalised phase
 * (0 at lift-off, 1 at next lift-off); bin means over the samples landing
 * in each bin. Empty bins stay null (no fabrication across gaps: live
 * SC-05 walks span ~0.40 of the cycle).
 */
export function binByNormPhase(
  values: number[],
  normPhases: number[],
  bins: number,
): { mean: Array<number | null>; counts: number[] } {
  const sums = new Array<number>(bins).fill(0);
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < values.length; i += 1) {
    const v = at(values, i);
    const p = at(normPhases, i);
    if (!Number.isFinite(v) || !Number.isFinite(p)) continue;
    const b = Math.min(bins - 1, Math.floor((((p % 1) + 1) % 1) * bins));
    sums[b] = at(sums, b) + v;
    counts[b] = at(counts, b) + 1;
  }
  return { mean: sums.map((s, b) => (at(counts, b) > 0 ? s / at(counts, b) : null)), counts };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? at(s, (s.length - 1) / 2) : (at(s, s.length / 2 - 1) + at(s, s.length / 2)) / 2;
}

// ---- offline GLB FK (same recipe as walk-clip/measure-gait-three-point.ts) ----

type Channel = {
  path: "translation" | "rotation" | "scale";
  times: Float32Array;
  values: Float32Array;
  stride: number;
  interpolation: string;
};

type Rig = {
  channels: Array<{ node: GltfNode; ch: Channel }>;
  nodes: GltfNode[];
  parentOf: Map<string, string>;
  byName: Map<string, GltfNode>;
};

function quatToMat(r: Quat): number[] {
  const [x, y, z, w] = r;
  const xx = x * x; const yy = y * y; const zz = z * z;
  const xy = x * y; const xz = x * z; const yz = y * z;
  const wx = w * x; const wy = w * y; const wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
}

function slerp(a: Quat, b: Quat, t: number): Quat {
  let bx = b[0]; let by = b[1]; let bz = b[2]; let bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (dot > 0.9995) {
    const out: Quat = [a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t];
    const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
    return [out[0] / l, out[1] / l, out[2] / l, out[3] / l];
  }
  const th = Math.acos(dot); const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s; const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

function sampleChannel(ch: Channel, t: number): number[] {
  const n = ch.times.length;
  const frameAt = (i: number): number[] => Array.from(ch.values.subarray(i * ch.stride, i * ch.stride + ch.stride));
  if (t <= at(ch.times, 0)) return frameAt(0);
  if (t >= at(ch.times, n - 1)) return frameAt(n - 1);
  let hi = 1;
  while (hi < n && at(ch.times, hi) < t) hi += 1;
  const lo = hi - 1;
  if (ch.interpolation === "STEP") return frameAt(lo);
  const span = at(ch.times, hi) - at(ch.times, lo);
  const f = span === 0 ? 0 : (t - at(ch.times, lo)) / span;
  const a = frameAt(lo); const b = frameAt(hi);
  if (ch.path === "rotation") return slerp(a as Quat, b as Quat, f);
  return a.map((v, i) => v + (at(b, i) - v) * f);
}

async function loadRig(glbPath: string, clipName: string): Promise<{ rig: Rig; clipTimes: number[] }> {
  const doc = await new NodeIO().read(glbPath);
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === clipName);
  if (!anim) {
    throw new Error(`no clip ${clipName} in ${glbPath}: ${doc.getRoot().listAnimations().map((a) => a.getName()).join(",")}`);
  }
  const channels: Array<{ node: GltfNode; ch: Channel }> = [];
  let clipTimes: Float32Array | null = null;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(); const sampler = ch.getSampler(); const p = ch.getTargetPath();
    if (!node || !sampler || !p) continue;
    if (p !== "translation" && p !== "rotation" && p !== "scale") continue;
    if (sampler.getInterpolation() === "CUBICSPLINE") throw new Error(`CUBICSPLINE on ${node.getName()}, refused`);
    const times = sampler.getInput()?.getArray(); const values = sampler.getOutput()?.getArray();
    if (!times || !values) continue;
    const entry: Channel = { path: p, times: Float32Array.from(times), values: Float32Array.from(values), stride: p === "rotation" ? 4 : 3, interpolation: sampler.getInterpolation() };
    channels.push({ node, ch: entry });
    if (!clipTimes || entry.times.length > clipTimes.length) clipTimes = entry.times;
  }
  if (!clipTimes) throw new Error("no sampled channels");
  const nodes = doc.getRoot().listNodes();
  const parentOf = new Map<string, string>();
  for (const n of nodes) for (const c of n.listChildren()) parentOf.set(c.getName(), n.getName());
  return { rig: { channels, nodes, parentOf, byName: new Map(nodes.map((n) => [n.getName(), n])) }, clipTimes: Array.from(clipTimes) };
}

function jointWorld(rig: Rig, nodeName: string, t: number): Vec3 {
  const target = rig.byName.get(nodeName);
  if (!target) throw new Error(`no node ${nodeName}`);
  const chain: GltfNode[] = [];
  for (let n: GltfNode | undefined = target; n;) {
    chain.unshift(n);
    const parentName = rig.parentOf.get(n.getName());
    if (!parentName) break;
    n = rig.nodes.find((c) => c.getName() === parentName);
  }
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let P: Vec3 = [0, 0, 0];
  for (const n of chain) {
    let tr = n.getTranslation() as unknown as Vec3;
    let ro = n.getRotation() as unknown as Quat;
    for (const { node, ch } of rig.channels) {
      if (node !== n) continue;
      const v = sampleChannel(ch, t);
      if (ch.path === "translation") tr = v as Vec3;
      else if (ch.path === "rotation") ro = v as Quat;
    }
    const m = quatToMat(ro);
    P = [
      R[0] * tr[0] + R[1] * tr[1] + R[2] * tr[2] + P[0],
      R[3] * tr[0] + R[4] * tr[1] + R[5] * tr[2] + P[1],
      R[6] * tr[0] + R[7] * tr[1] + R[8] * tr[2] + P[2],
    ];
    const nR = new Array<number>(9);
    for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) {
      nR[row * 3 + col] = at(R, row * 3) * at(m, col) + at(R, row * 3 + 1) * at(m, 3 + col) + at(R, row * 3 + 2) * at(m, 6 + col);
    }
    R = nR;
  }
  return P;
}

function boneQuatAt(rig: Rig, nodeName: string, t: number): Quat {
  const node = rig.byName.get(nodeName);
  if (!node) throw new Error(`no node ${nodeName}`);
  let ro = node.getRotation() as unknown as Quat;
  for (const { node: n, ch } of rig.channels) {
    if (n !== node || ch.path !== "rotation") continue;
    ro = sampleChannel(ch, t) as Quat;
  }
  return [ro[0], ro[1], ro[2], ro[3]];
}

function angleDeg(a: Vec3, b: Vec3): number {
  const la = Math.hypot(...a); const lb = Math.hypot(...b);
  if (la === 0 || lb === 0) return 0;
  const c = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)));
  return (Math.acos(c) * 180) / Math.PI;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

type OfflineJoints = {
  thighL: string; kneeL: string; ankleL: string; toeL: string;
  thighR: string; kneeR: string; ankleR: string; toeR: string;
};

type FootSamples = {
  knee: number[];
  toeY: number[];
  contact: boolean[];
  /** Lift-off-normalised phase per sample (0 at lift-off, 1 at next). */
  normPhase: Array<number | null>;
  floorY: number;
  quatMaxDev: number;
  quatPerBone: Record<string, { min: number; max: number }>;
};

async function sampleOffline(
  glbPath: string,
  clipName: string,
  scale: number,
  joints: OfflineJoints,
  legBones: string[],
): Promise<{ left: FootSamples; right: FootSamples; nFrames: number; durationS: number; anchorPhase: { left: number; right: number } }> {
  const { rig, clipTimes } = await loadRig(glbPath, clipName);
  const T = (name: string): Vec3[] => clipTimes.map((t) => jointWorld(rig, name, t));
  const sides = {
    left: { thigh: T(joints.thighL), knee: T(joints.kneeL), ankle: T(joints.ankleL), toe: T(joints.toeL) },
    right: { thigh: T(joints.thighR), knee: T(joints.kneeR), ankle: T(joints.ankleR), toe: T(joints.toeR) },
  };
  const sc = (t: Vec3[]): number[] => t.map((p) => p[1] * scale);
  const duration = at(clipTimes, clipTimes.length - 1) - at(clipTimes, 0);
  const clipPhase = clipTimes.map((t) => (t - at(clipTimes, 0)) / (duration || 1));
  // Anchor: clip-phase of the first signal lift-off (the loop holds one
  // stride per foot, so one lift-off per loop; the phase wraps).
  const anchorFor = (toeY: number[], floorY: number): number => {
    const contact = toeY.map((y) => y - floorY <= FOOT_CONTACT_HEIGHT_METERS);
    const los = detectLiftOffs(contact);
    return los.length > 0 ? at(clipPhase, at(los, 0)) : 0;
  };
  const floorL = Math.min(...sc(sides.left.toe));
  const floorR = Math.min(...sc(sides.right.toe));
  const anchorL = anchorFor(sc(sides.left.toe), floorL);
  const anchorR = anchorFor(sc(sides.right.toe), floorR);
  const mk = (side: (typeof sides)["left"], floorY: number, anchor: number): FootSamples => {
    const toeY = sc(side.toe);
    const knee = clipTimes.map((_, j) =>
      180 - angleDeg(sub3(at(side.thigh, j), at(side.knee, j)), sub3(at(side.ankle, j), at(side.knee, j))));
    const contact = toeY.map((y) => y - floorY <= FOOT_CONTACT_HEIGHT_METERS);
    const normPhase = clipPhase.map((p) => (((p - anchor) % 1) + 1) % 1);
    return { knee, toeY, contact, normPhase, floorY, quatMaxDev: 0, quatPerBone: {} };
  };
  const left = mk(sides.left, floorL, anchorL);
  const right = mk(sides.right, floorR, anchorR);
  let maxDev = 0;
  const perBone: Record<string, { min: number; max: number }> = {};
  for (const bone of legBones) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const t of clipTimes) {
      const q = boneQuatAt(rig, bone, t);
      const dev = Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1);
      maxDev = Math.max(maxDev, dev);
      mn = Math.min(mn, dev);
      mx = Math.max(mx, dev);
    }
    perBone[bone] = { min: mn, max: mx };
  }
  left.quatMaxDev = maxDev;
  right.quatMaxDev = maxDev;
  left.quatPerBone = perBone;
  right.quatPerBone = perBone;
  return { left, right, nFrames: clipTimes.length, durationS: at(clipTimes, clipTimes.length - 1) - at(clipTimes, 0), anchorPhase: { left: anchorL, right: anchorR } };
}

// ---- live captures ----

type LiveFrame = {
  phase: string | null;
  clipTime?: number | null;
  leftToe?: { x: number; y: number; z: number } | null;
  rightToe?: { x: number; y: number; z: number } | null;
  kneeFlexionDeg?: { left: number | null; right: number | null } | null;
  legBones?: Record<string, { x: number; y: number; z: number; w: number } | null> | null;
  legWorlds?: Record<string, { x: number; y: number; z: number } | null> | null;
  walkSimSubsteps?: number | null;
};
type LiveRun = { urlQuery?: string; labels?: { cycleSeconds?: number } | null; frames: LiveFrame[] };

function sampleLive(run: LiveRun): {
  left: FootSamples; right: FootSamples; nWalking: number; cycleS: number | null;
  reach: { left: number[]; right: number[]; contactL: boolean[]; contactR: boolean[] };
  liftSignalPhase: { left: number[]; right: number[] };
} {
  const walking = run.frames.filter((f) => f.phase === "walking");
  const cycleS = run.labels?.cycleSeconds && run.labels.cycleSeconds > 0 ? run.labels.cycleSeconds : null;
  const phase01Of = (clipTime: number | null | undefined): number | null => {
    if (cycleS === null || typeof clipTime !== "number" || !Number.isFinite(clipTime)) return null;
    return (((((clipTime % cycleS) + cycleS) % cycleS) + cycleS) % cycleS) / cycleS;
  };
  const getToe = (f: LiveFrame, side: "left" | "right"): number | null => {
    const t = side === "left" ? f.leftToe : f.rightToe;
    return t && Number.isFinite(t.y) ? t.y : null;
  };
  const getKnee = (f: LiveFrame, side: "left" | "right"): number | null => {
    const k = f.kneeFlexionDeg?.[side];
    return typeof k === "number" && Number.isFinite(k) ? k : null;
  };
  const mk = (side: "left" | "right"): FootSamples => {
    const toeY = walking.map((f) => getToe(f, side));
    const knee = walking.map((f) => getKnee(f, side));
    const validToe = toeY.filter((v): v is number => v !== null);
    const floorY = validToe.length ? Math.min(...validToe) : NaN;
    const contact = toeY.map((y) => y !== null && y - floorY <= FOOT_CONTACT_HEIGHT_METERS);
    // Anchor: the contact-JSON lift phase (clip truth, same values the
    // runtime schedule uses); signal lift-offs are reported separately for
    // verification.
    const anchor = FOOT_BASE_LIFT_PHASE[side];
    const normPhase = walking.map((f) => {
      const p = phase01Of(f.clipTime);
      return p === null ? null : (((p - anchor) % 1) + 1) % 1;
    });
    return {
      knee: knee.map((v) => (v === null ? NaN : v)),
      toeY: toeY.map((v) => (v === null ? NaN : v)),
      contact,
      normPhase,
      floorY,
      quatMaxDev: 0,
      quatPerBone: {},
    };
  };
  const left = mk("left");
  const right = mk("right");
  let maxDev = 0;
  const perBone: Record<string, { min: number; max: number }> = {};
  for (const f of walking) {
    const bones = f.legBones ?? {};
    for (const [name, q] of Object.entries(bones)) {
      if (!q) continue;
      const dev = Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1);
      maxDev = Math.max(maxDev, dev);
      const e = perBone[name] ?? { min: Infinity, max: -Infinity };
      e.min = Math.min(e.min, dev);
      e.max = Math.max(e.max, dev);
      perBone[name] = e;
    }
  }
  left.quatMaxDev = maxDev;
  right.quatMaxDev = maxDev;
  left.quatPerBone = perBone;
  right.quatPerBone = perBone;
  // Reach ratio per leg frame: |hip-heel| / (|hip-knee| + |knee-heel|).
  const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const reachSide = (key: "L" | "R"): number[] => walking.map((f) => {
    const hip = f.legWorlds?.[`hip${key}`];
    const knee = f.legWorlds?.[`knee${key}`];
    const heel = f.legWorlds?.[`heel${key}`];
    if (!hip || !knee || !heel) return NaN;
    const limb = dist(hip, knee) + dist(knee, heel);
    return limb > 0 ? dist(hip, heel) / limb : NaN;
  });
  return {
    left,
    right,
    nWalking: walking.length,
    cycleS: run.labels?.cycleSeconds ?? null,
    reach: {
      left: reachSide("L"),
      right: reachSide("R"),
      contactL: left.contact,
      contactR: right.contact,
    },
    liftSignalPhase: {
      left: detectLiftOffs(left.contact)
        .map((i) => phase01Of(at(walking, i).clipTime))
        .filter((p): p is number => p !== null),
      right: detectLiftOffs(right.contact)
        .map((i) => phase01Of(at(walking, i).clipTime))
        .filter((p): p is number => p !== null),
    },
  };
}

type Peak = { value: number | null; phase: number | null };
type SeriesCurve = {
  knee: Array<number | null>;
  toeY: Array<number | null>;
  kneePeak: Peak;
  toePeak: Peak;
  nSamples: number;
  filledBins: number;
  floorY: number;
};

function peakOf(curve: Array<number | null>): Peak {
  let best: number | null = null;
  let peakPhase: number | null = null;
  for (let b = 0; b < curve.length; b += 1) {
    const v = at(curve, b);
    if (typeof v === "number" && Number.isFinite(v) && (best === null || v > best)) {
      best = v;
      peakPhase = (b + 0.5) / curve.length;
    }
  }
  return { value: best, phase: peakPhase };
}

function curveOf(s: FootSamples): SeriesCurve {
  const finite = (v: number): boolean => Number.isFinite(v);
  const kneeBinned = binByNormPhase(
    s.knee.map((v) => (finite(v) ? v : NaN)),
    s.normPhase.map((p) => (p === null ? NaN : p)),
    PHASE_BINS,
  );
  const toeBinned = binByNormPhase(
    s.toeY.map((v) => (finite(v) ? v : NaN)),
    s.normPhase.map((p) => (p === null ? NaN : p)),
    PHASE_BINS,
  );
  const nSamples = s.knee.filter(finite).length;
  const filledBins = kneeBinned.counts.filter((c) => c > 0).length;
  return {
    knee: kneeBinned.mean,
    toeY: toeBinned.mean,
    kneePeak: peakOf(kneeBinned.mean),
    toePeak: peakOf(toeBinned.mean),
    nSamples,
    filledBins,
    floorY: s.floorY,
  };
}

function meanCurves(a: Array<number | null>, b: Array<number | null>): Array<number | null> {
  return a.map((v, i) => {
    const w = at(b, i);
    return typeof v === "number" && typeof w === "number" ? (v + w) / 2 : null;
  });
}

// ---- SVG ----

function svgPanel(
  series: Array<{ label: string; color: string; curve: Array<number | null> }>,
  yLabel: string,
  yMin: number,
  yMax: number,
  x0: number,
  width: number,
  y0: number,
  height: number,
): string {
  const x = (b: number): number => x0 + ((b + 0.5) / PHASE_BINS) * width;
  const y = (v: number): number => y0 + height - ((v - yMin) / (yMax - yMin)) * height;
  let s = `<text x="${x0}" y="${y0 - 8}" font-size="13" font-family="monospace" fill="#111">${yLabel} vs phase (0=lift-off, 1=next lift-off)</text>`;
  s += `<rect x="${x0}" y="${y0}" width="${width}" height="${height}" fill="none" stroke="#888"/>`;
  for (let g = 0; g <= 4; g += 1) {
    const gx = x0 + (g / 4) * width;
    s += `<line x1="${gx}" y1="${y0}" x2="${gx}" y2="${y0 + height}" stroke="#ddd"/>`;
    s += `<text x="${gx - 8}" y="${y0 + height + 16}" font-size="11" font-family="monospace" fill="#555">${(g / 4).toFixed(2)}</text>`;
  }
  for (const { label, color, curve } of series) {
    // Contiguous runs only: gaps (unobserved phase) break the path.
    let d = "";
    let open = false;
    curve.forEach((v, b) => {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        open = false;
        return;
      }
      d += `${open ? "L" : "M"}${x(b).toFixed(1)},${y(v).toFixed(1)} `;
      open = true;
    });
    if (!d) {
      s += `<text x="${x0 + 8}" y="${y0 + 20}" font-size="11" font-family="monospace" fill="${color}">${label}: no samples</text>`;
      continue;
    }
    s += `<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2"><title>${label}</title></path>`;
  }
  return s;
}

function buildSvg(
  knee: Array<{ label: string; color: string; curve: Array<number | null> }>,
  toe: Array<{ label: string; color: string; curve: Array<number | null> }>,
): string {
  const W = 920;
  const H = 640;
  const x0 = 70;
  const w = W - x0 - 220;
  const finite = (v: number | null): v is number => typeof v === "number" && Number.isFinite(v);
  const kneeVals = knee.flatMap((entry) => entry.curve).filter(finite);
  const toeVals = toe.flatMap((entry) => entry.curve).filter(finite);
  const kMin = Math.floor(Math.min(...kneeVals) / 10) * 10;
  const kMax = Math.ceil(Math.max(...kneeVals) / 10) * 10;
  const tMin = Math.floor(Math.min(...toeVals) * 100) / 100;
  const tMax = Math.ceil(Math.max(...toeVals) * 100) / 100;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="monospace">`;
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;
  s += svgPanel(knee, `knee flexion deg [${kMin},${kMax}]`, kMin, kMax, x0, w, 40, 220);
  s += svgPanel(toe, `toe excursion above floor m [${tMin.toFixed(3)},${tMax.toFixed(3)}]`, tMin, tMax, x0, w, 330, 220);
  knee.forEach(({ label, color }, i) => {
    const ly = 60 + i * 20;
    s += `<rect x="${x0 + w + 12}" y="${ly - 10}" width="14" height="10" fill="${color}"/>`;
    s += `<text x="${x0 + w + 30}" y="${ly}" font-size="12" fill="#111">${label}</text>`;
  });
  s += `<text x="${x0}" y="${H - 12}" font-size="11" fill="#555">phase 0 = lift-off, 1 = next lift-off; curves are the mean over feet of the 50-bin lift-off-normalised means</text>`;
  return `${s}</svg>`;
}

// ---- main ----

async function main(): Promise<void> {
  const home = process.env["HOME"] ?? "/Users/patrick";
  const sourceGlb = arg("--source-glb", `${home}/.openclinxr-tools/mesh2motion-app/static/animations/human-base-animations.glb`);
  const boundGlb = arg("--bound-glb", "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb");
  const planPath = arg("--plan", ".openclinxr/evidence/foot-base-routes/measure-1/plan-sc05/sc05-run0.json");
  const footbasePath = arg("--footbase", ".openclinxr/evidence/foot-base-routes/measure-1/fb-sc05/sc05-run0.json");
  const outPath = arg("--out", ".openclinxr/evidence/attrib/phase-attribution.json");
  const svgPath = arg("--svg", ".openclinxr/evidence/attrib/phase-attribution.svg");
  const planScaleArg = process.argv.find((a) => a.startsWith("--plan-scale="))?.slice("--plan-scale=".length);
  const planScale = planScaleArg !== undefined ? Number(planScaleArg) : 0.7070355731225296;

  process.stdout.write("sampling series 1 (source, native rig)...\n");
  const s1 = await sampleOffline(sourceGlb, "Walk", 1, {
    thighL: "thigh_l", kneeL: "calf_l", ankleL: "foot_l", toeL: "ball_l",
    thighR: "thigh_r", kneeR: "calf_r", ankleR: "foot_r", toeR: "ball_r",
  }, ["thigh_l", "calf_l", "foot_l", "ball_l", "thigh_r", "calf_r", "foot_r", "ball_r"]);
  process.stdout.write("sampling series 2 (bound, MPFB offline)...\n");
  const s2 = await sampleOffline(boundGlb, "openclinxr_retarget_walk_source", BOUND_ACTOR_SCALE, {
    thighL: "upperleg01.L", kneeL: "lowerleg01.L", ankleL: "foot.L", toeL: "toe1-1.L",
    thighR: "upperleg01.R", kneeR: "lowerleg01.R", ankleR: "foot.R", toeR: "toe1-1.R",
  }, ["upperleg01.L", "upperleg02.L", "lowerleg01.L", "lowerleg02.L", "upperleg01.R", "upperleg02.R", "lowerleg01.R", "lowerleg02.R"]);

  process.stdout.write("sampling series 3 (plan-only live) + 4 (foot-base live)...\n");
  const planRun = JSON.parse(await readFile(planPath, "utf8")) as LiveRun;
  const footbaseRun = JSON.parse(await readFile(footbasePath, "utf8")) as LiveRun;
  const s3 = sampleLive(planRun);
  const s4 = sampleLive(footbaseRun);

  const c1L = curveOf(s1.left); const c1R = curveOf(s1.right);
  const c2L = curveOf(s2.left); const c2R = curveOf(s2.right);
  const c3L = curveOf(s3.left); const c3R = curveOf(s3.right);
  const c4L = curveOf(s4.left); const c4R = curveOf(s4.right);

  const kneeRmse = (
    aL: SeriesCurve, aR: SeriesCurve, bL: SeriesCurve, bR: SeriesCurve,
  ): {
    left: number; right: number; mean: number; nBinsLeft: number; nBinsRight: number;
    shapeLeft: number; shapeRight: number; shapeMean: number; shapeShiftLeft: number; shapeShiftRight: number;
  } => {
    const l = rmseIntersection(aL.knee, bL.knee);
    const r = rmseIntersection(aR.knee, bR.knee);
    const sl = rmseShiftTolerant(aL.knee, bL.knee);
    const sr = rmseShiftTolerant(aR.knee, bR.knee);
    return {
      left: l.rmse, right: r.rmse, mean: (l.rmse + r.rmse) / 2, nBinsLeft: l.nBins, nBinsRight: r.nBins,
      shapeLeft: sl.best, shapeRight: sr.best, shapeMean: (sl.best + sr.best) / 2,
      shapeShiftLeft: sl.shiftBins, shapeShiftRight: sr.shiftBins,
    };
  };
  const r12 = kneeRmse(c1L, c1R, c2L, c2R);
  const r23 = kneeRmse(c2L, c2R, c3L, c3R);
  const r24 = kneeRmse(c2L, c2R, c4L, c4R);
  const stages: Array<{ id: string; rmse: typeof r12 }> = [
    { id: "bind (1->2)", rmse: r12 },
    { id: "plan-live (2->3)", rmse: r23 },
    { id: "footbase (2->4)", rmse: r24 },
  ];
  const owner = stages.find((st) => st.rmse.mean > KNEE_RMSE_OWNERSHIP_DEG)?.id ?? "none (all <= 5 deg)";

  // Series-4 extras.
  // Target vs achieved toe excursion: anchor = median contact toe Y of the
  // foot (the pinned stance level ≈ floorY + datum); target excursion at
  // lift-off-normalised bin b is planScale * row.heightM at clip rel-phase
  // (STANCE_FRAC + binCenter) % 1; achieved excursion is the curve minus
  // the anchor. Desync over bins finite in both.
  const anchorOf = (s: FootSamples): number => {
    const contactY = s.toeY.filter((y, i) => s.contact[i] === true && Number.isFinite(y));
    return contactY.length ? median(contactY) : NaN;
  };
  const binRel = (foot: "left" | "right", b: number): number =>
    (FOOT_BASE_STANCE_FRACTION[foot] + (b + 0.5) / PHASE_BINS) % 1;
  const targetVsAchieved: Record<string, { target: Array<number | null>; achieved: Array<number | null>; meanAbsDesyncM: number; nBins: number } | null> = {};
  for (const [foot, curve] of [["left", c4L], ["right", c4R]] as const) {
    const anchor = anchorOf(foot === "left" ? s4.left : s4.right);
    const target = curve.toeY.map((_, b) => planScale * footBaseRowAt(foot, binRel(foot, b)).heightM);
    const achieved = curve.toeY.map((y) => (typeof y === "number" ? y - anchor : null));
    let s = 0;
    let n = 0;
    target.forEach((t, b) => {
      const a = at(achieved, b);
      if (typeof a === "number" && Number.isFinite(a)) {
        s += Math.abs(t - a);
        n += 1;
      }
    });
    targetVsAchieved[foot] = { target, achieved, meanAbsDesyncM: n > 0 ? s / n : NaN, nBins: n };
  }
  // Raised-cosine XZ progress vs stored row along01 over swing bins.
  const progressVsRow: Record<string, { progress: number[]; along01: number[]; meanAbsDiff: number } | null> = {};
  for (const foot of ["left", "right"] as const) {
    const frac = FOOT_BASE_STANCE_FRACTION[foot];
    const swingBins: number[] = [];
    for (let b = 0; b < PHASE_BINS; b += 1) {
      if (binRel(foot, b) >= frac) swingBins.push(b);
    }
    const progress = swingBins.map((b) => {
      const rel = binRel(foot, b);
      const linear = Math.min(Math.max((rel - frac) / (1 - frac), 0), 1);
      return 0.5 - 0.5 * Math.cos(Math.PI * linear);
    });
    const along01 = swingBins.map((b) => footBaseRowAt(foot, binRel(foot, b)).along01);
    progressVsRow[foot] = {
      progress,
      along01,
      meanAbsDiff: mean(progress.map((p, i) => Math.abs(p - at(along01, i)))),
    };
  }
  // Reach-ratio mean curve per foot (binned by that foot's own norm-phase).
  const reachCurve = (values: number[], normPhase: Array<number | null>): Array<number | null> =>
    binByNormPhase(
      values.map((v) => (Number.isFinite(v) ? v : NaN)),
      normPhase.map((p) => (p === null ? NaN : p)),
      PHASE_BINS,
    ).mean;
  const reachL = reachCurve(s4.reach.left, s4.left.normPhase);
  const reachR = reachCurve(s4.reach.right, s4.right.normPhase);

  const quatMax = [s1.left.quatMaxDev, s2.left.quatMaxDev, s3.left.quatMaxDev, s4.left.quatMaxDev];
  const quatValid = quatMax.every((d) => d <= QUAT_NORM_TOL);

  const exc = (c: SeriesCurve): Array<number | null> =>
    c.toeY.map((y) => (typeof y === "number" ? y - c.floorY : null));
  const colors = ["#1b6e1b", "#1565c0", "#e65100", "#b71c1c"];
  const labels = ["1 source native", "2 bound MPFB", "3 plan-only live", "4 foot-base live"];
  const kneeMeans = [meanCurves(c1L.knee, c1R.knee), meanCurves(c2L.knee, c2R.knee), meanCurves(c3L.knee, c3R.knee), meanCurves(c4L.knee, c4R.knee)];
  const toeMeans = [meanCurves(exc(c1L), exc(c1R)), meanCurves(exc(c2L), exc(c2R)), meanCurves(exc(c3L), exc(c3R)), meanCurves(exc(c4L), exc(c4R))];
  const svg = buildSvg(
    labels.map((label, i) => ({ label, color: at(colors, i), curve: at(kneeMeans, i) })),
    labels.map((label, i) => ({ label, color: at(colors, i), curve: at(toeMeans, i) })),
  );

  const datumNote =
    `height datum L=${heightDatum("left").toFixed(4)} R=${heightDatum("right").toFixed(4)} (recomputed from public FOOT_BASE_ROWS, stance-row minima); `
    + "rows are plant-relative, so the target comparison anchors on each foot's median contact toe Y";
  const result = {
    schemaVersion: "openclinxr.phase-attribution.v1",
    measuredAt: new Date().toISOString(),
    inputs: { sourceGlb, boundGlb, planPath, footbasePath, planScale, planScaleNote: planScaleArg !== undefined ? "--plan-scale override" : "SC-05 plan scale from swing-7.json (planScale)" },
    contactBandM: FOOT_CONTACT_HEIGHT_METERS,
    bins: PHASE_BINS,
    quatNormTol: QUAT_NORM_TOL,
    series: {
      s1: { label: "source clip Mesh2Motion Walk, native rig", nFrames: s1.nFrames, durationS: s1.durationS, anchorPhase: s1.anchorPhase, left: c1L, right: c1R, quatMaxDev: s1.left.quatMaxDev },
      s2: { label: "bound clip on MPFB, offline", nFrames: s2.nFrames, durationS: s2.durationS, actorScale: BOUND_ACTOR_SCALE, anchorPhase: s2.anchorPhase, left: c2L, right: c2R, quatMaxDev: s2.left.quatMaxDev },
      s3: { label: "plan-only live", urlQuery: planRun.urlQuery ?? null, nWalking: s3.nWalking, cycleS: s3.cycleS, liftSignalPhase: s3.liftSignalPhase, liftAnchorPhase: FOOT_BASE_LIFT_PHASE, left: c3L, right: c3R, quatMaxDev: s3.left.quatMaxDev },
      s4: { label: "foot-base live", urlQuery: footbaseRun.urlQuery ?? null, nWalking: s4.nWalking, cycleS: s4.cycleS, liftSignalPhase: s4.liftSignalPhase, liftAnchorPhase: FOOT_BASE_LIFT_PHASE, left: c4L, right: c4R, quatMaxDev: s4.left.quatMaxDev },
    },
    anchorNote:
      "Offline anchors: clip-phase of the first signal lift-off (one stride per foot per loop). "
      + "Live anchors: FOOT_BASE_LIFT_PHASE (contact-JSON clip truth, same values the runtime schedule uses); "
      + "liftSignalPhase reports the signal-observed lift clip-phases for verification.",
    kneeRmseDeg: { s1to2: r12, s2to3: r23, s2to4: r24, ownershipThresholdDeg: KNEE_RMSE_OWNERSHIP_DEG, owner },
    quatNorms: {
      perSeriesMaxDev: { s1: s1.left.quatMaxDev, s2: s2.left.quatMaxDev, s3: s3.left.quatMaxDev, s4: s4.left.quatMaxDev },
      perBoneS4: s4.left.quatPerBone,
      valid: quatValid,
    },
    series4: {
      datumNote,
      targetVsAchieved,
      progressVsRow,
      reachRatio: { left: reachL, right: reachR, note: "|hip-heel|/(|hip-knee|+|knee-heel|) from legWorlds (heel = foot-bone ankle proxy)" },
    },
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(svgPath, `${svg}\n`);
  process.stdout.write(`rmse s1->s2 L=${r12.left.toFixed(2)} R=${r12.right.toFixed(2)} mean=${r12.mean.toFixed(2)}\n`);
  process.stdout.write(`rmse s2->s3 L=${r23.left.toFixed(2)} R=${r23.right.toFixed(2)} mean=${r23.mean.toFixed(2)}\n`);
  process.stdout.write(`rmse s2->s4 L=${r24.left.toFixed(2)} R=${r24.right.toFixed(2)} mean=${r24.mean.toFixed(2)}\n`);
  process.stdout.write(`owner: ${owner}; quat valid: ${quatValid}\n`);
  process.stdout.write(`wrote ${outPath} + ${svgPath}\n`);
}

const invokedAsMain = (process.argv[1] ?? "").endsWith("phase-attribution.ts");
if (invokedAsMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
