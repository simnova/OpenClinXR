/**
 * Stage-1 attribution: the SAME gait metrics at three points of the walk pipeline.
 *
 * (a) source joint positions: Mesh2Motion `Walk` on its native 66-joint rig
 *     (extracted byte-for-byte by extract-library-clip.ts, world metres, source fps).
 * (b) bound clip decoded on the MPFB rig offline: `openclinxr_retarget_walk_source`
 *     in the shipped physician GLB, timeScale 1, times actor scale.
 * (c) browser mixer pose: reused from .openclinxr/evidence/loco-ground/report.json.
 *
 * FK/sampling is a local copy (D3/D4 isolated: no renderer, no runtime or package-src
 * import), following tools/openclinxr/evidence/foot-plant/bound-clip-foot-track.ts and
 * tools/openclinxr/evidence/foot-plant/transition-table/transition-cagematch.ts.
 *
 * Contact definition matches the proving ground: toe height within CONTACT_BAND_M (0.06,
 * the production constant) of the clip's own floor (min toe height over the clip).
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/evidence/walk-clip/measure-gait-three-point.ts \
 *     --source-glb /tmp/walkclip/walk-source.glb \
 *     --bound-glb apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb \
 *     --out .openclinxr/evidence/walk-clip/stage1-attribution.json
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Node as GltfNode } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";
import { MESHMOTION_WALK_JOINTS, MPFB_WALK_JOINTS } from "@openclinxr/factory-stations";
import { gateOneClip } from "./gate-one-clip.js";

const CONTACT_BAND_M = 0.06;
const ACTOR_SCALE = 0.86;

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

type Channel = {
  path: "translation" | "rotation" | "scale";
  times: Float32Array;
  values: Float32Array;
  stride: number;
  interpolation: string;
};

type Track = { times: number[]; positions: Vec3[] };

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
  const at = (i: number): number[] => Array.from(ch.values.subarray(i * ch.stride, i * ch.stride + ch.stride));
  if (t <= ch.times[0]!) return at(0);
  if (t >= ch.times[n - 1]!) return at(n - 1);
  let hi = 1;
  while (hi < n && ch.times[hi]! < t) hi += 1;
  const lo = hi - 1;
  if (ch.interpolation === "STEP") return at(lo);
  const span = ch.times[hi]! - ch.times[lo]!;
  const f = span === 0 ? 0 : (t - ch.times[lo]!) / span;
  const a = at(lo); const b = at(hi);
  if (ch.path === "rotation") return slerp(a as Quat, b as Quat, f);
  return a.map((v, i) => v + (b[i]! - v) * f);
}

type Rig = {
  doc: Awaited<ReturnType<NodeIO["read"]>>;
  channels: Array<{ node: GltfNode; ch: Channel }>;
  nodes: GltfNode[];
  parentOf: Map<string, string>;
  byName: Map<string, GltfNode>;
};

async function loadRig(glbPath: string, clipName: string): Promise<{ rig: Rig; clipTimes: number[]; channelCount: number }> {
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
  return { rig: { doc, channels, nodes, parentOf, byName: new Map(nodes.map((n) => [n.getName(), n])) }, clipTimes: Array.from(clipTimes), channelCount: channels.length };
}

function poseAt(rig: Rig, nodeName: string, t: number | null): { p: Vec3; r: Quat } {
  const target = rig.byName.get(nodeName);
  if (!target) throw new Error(`no node ${nodeName}`);
  const chain: GltfNode[] = [];
  for (let n: GltfNode | undefined = target; n; n = rig.nodes.find((c) => rig.parentOf.get(n!.getName()) === c.getName())) {
    chain.unshift(n);
    if (!rig.parentOf.get(n.getName())) break;
  }
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // row-major 3x3 identity
  let P: Vec3 = [0, 0, 0];
  for (const n of chain) {
    let tr = n.getTranslation() as unknown as Vec3;
    let ro = n.getRotation() as unknown as Quat;
    if (t !== null) {
      for (const { node, ch } of rig.channels) {
        if (node !== n) continue;
        const v = sampleChannel(ch, t);
        if (ch.path === "translation") tr = v as Vec3;
        else if (ch.path === "rotation") ro = v as Quat;
      }
    }
    const m = quatToMat(ro);
    P = [
      R[0] * tr[0] + R[1] * tr[1] + R[2] * tr[2] + P[0],
      R[3] * tr[0] + R[4] * tr[1] + R[5] * tr[2] + P[1],
      R[6] * tr[0] + R[7] * tr[1] + R[8] * tr[2] + P[2],
    ];
    const nR = new Array<number>(9);
    for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) {
      nR[row * 3 + col] = R[row * 3]! * m[col]! + R[row * 3 + 1]! * m[3 + col]! + R[row * 3 + 2]! * m[6 + col]!;
    }
    R = nR;
  }
  return { p: P, r: [0, 0, 0, 1] };
}

function trackJoint(rig: Rig, nodeName: string, times: number[]): Track {
  return { times: [...times], positions: times.map((t) => poseAt(rig, nodeName, t).p) };
}

function mid(a: Vec3, b: Vec3): Vec3 { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function angleDeg(a: Vec3, b: Vec3): number {
  const la = Math.hypot(...a); const lb = Math.hypot(...b);
  if (la === 0 || lb === 0) return 0;
  const c = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)));
  return (Math.acos(c) * 180) / Math.PI;
}
function median(v: number[]): number {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}
function mean(v: number[]): number { return v.reduce((a, b) => a + b, 0) / (v.length || 1); }

export type GaitMetrics = {
  frames: number; durationS: number; fps: number;
  floorToeY: number;
  foot: Record<string, {
    swingToeMaxM: number; swingAnkleMaxM: number;
    duty: number; cycleS: number;
    stanceSpeedMedMps: number; stanceSpeedCVMps: number;
    strideM: number; naturalSpeedMps: number;
    contactWindows: number;
  }>;
  hipHeightMeanM: number; hipHeightStandingM: number;
  kneeFlexMinDeg: number; kneeFlexMaxDeg: number;
};

function measureFoot(
  toe: Track, ankle: Track, root: Track, floorY: number,
): GaitMetrics["foot"][string] {
  const n = toe.times.length;
  const inContact = toe.positions.map((p) => p[1] - floorY <= CONTACT_BAND_M);
  type Win = { s: number; e: number };
  const wins: Win[] = [];
  let i = 0;
  while (i < n) {
    if (!inContact[i]) { i += 1; continue; }
    let e = i;
    while (e + 1 < n && inContact[e + 1]) e += 1;
    wins.push({ s: i, e }); i = e + 1;
  }
  // The clip loops (last frame flows into the first), so detect windows on the
  // circular track: if frame 0 is in contact, its window is the wrap continuation
  // of the window touching the last frame, and index 0 counts as a heel strike.
  const wraps = inContact[0] === true && inContact[n - 1] === true;
  const strikes = wins.map((w) => w.s).filter((s) => s > 0 || !wraps);
  // Mean full-cycle duration: total clip time divided by number of heel strikes
  // (each strike starts one cycle on a looped clip).
  const clipSpan = toe.times[n - 1]! - toe.times[0]!;
  const cycleS = strikes.length > 0 ? clipSpan / strikes.length : clipSpan;
  const contactTotal = wins.reduce((a, w) => a + (toe.times[w.e]! - toe.times[w.s]!), 0);
  const duty = clipSpan > 0 ? contactTotal / clipSpan : NaN;
  // Stance speed: per-frame horizontal toe velocity relative to root, signed along the
  // window's own travel direction; median + CV over interior window frames.
  const speeds: number[] = [];
  const strides: number[] = [];
  for (const w of wins) {
    if (w.e - w.s < 2) continue;
    const rel = (j: number): Vec3 => sub(
      [toe.positions[j]![0], 0, toe.positions[j]![2]],
      [root.positions[j]![0], 0, root.positions[j]![2]],
    );
    const a = rel(w.s); const b = rel(w.e);
    const dx = b[0] - a[0]; const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    strides.push(len);
    if (len < 1e-6) continue;
    const ux = dx / len; const uz = dz / len;
    for (let j = w.s + 1; j <= w.e; j += 1) {
      const dt = toe.times[j]! - toe.times[j - 1]!;
      if (dt <= 0) continue;
      const p0 = rel(j - 1); const p1 = rel(j);
      speeds.push((((p1[0] - p0[0]) * ux + (p1[2] - p0[2]) * uz) / dt));
    }
  }
  const med = median(speeds);
  const cv = speeds.length > 1 && med !== 0 ? (Math.sqrt(mean(speeds.map((s) => (s - mean(speeds)) ** 2))) / Math.abs(med)) : NaN;
  const strideM = strides.length > 0 ? mean(strides) : NaN;
  // Swing maxima over frames strictly outside contact.
  let swingToeMax = -Infinity; let swingAnkleMax = -Infinity;
  for (let j = 0; j < n; j += 1) {
    if (inContact[j]) continue;
    swingToeMax = Math.max(swingToeMax, toe.positions[j]![1] - floorY);
    swingAnkleMax = Math.max(swingAnkleMax, ankle.positions[j]![1] - floorY);
  }
  return {
    swingToeMaxM: swingToeMax === -Infinity ? NaN : swingToeMax,
    swingAnkleMaxM: swingAnkleMax === -Infinity ? NaN : swingAnkleMax,
    duty, cycleS,
    stanceSpeedMedMps: med, stanceSpeedCVMps: cv,
    strideM, naturalSpeedMps: cycleS > 0 ? strideM / cycleS : NaN,
    contactWindows: wins.length,
  };
}

async function measureColumn(input: {
  glb: string; clip: string; scale: number;
  hips: [string, string] | [string];
  thighL: string; kneeL: string; ankleL: string; toeL: string;
  thighR: string; kneeR: string; ankleR: string; toeR: string;
  root: [string, string] | [string];
}): Promise<{ metrics: GaitMetrics; channelCount: number; sha256: string }> {
  const { rig, clipTimes, channelCount } = await loadRig(input.glb, input.clip);
  const T = (name: string) => trackJoint(rig, name, clipTimes);
  const hipsT = input.hips.length === 2
    ? { times: clipTimes, positions: T(input.hips[0]!).positions.map((p, j) => mid(p, T(input.hips[1]!).positions[j]!)) }
    : T(input.hips[0]!);
  const rootT = input.root.length === 2
    ? { times: clipTimes, positions: T(input.root[0]!).positions.map((p, j) => mid(p, T(input.root[1]!).positions[j]!)) }
    : T(input.root[0]!);
  const toeL = T(input.toeL); const toeR = T(input.toeR);
  const floorY = Math.min(...toeL.positions.map((p) => p[1]), ...toeR.positions.map((p) => p[1]));
  const s = input.scale;
  const scaled = (t: Track): Track => ({ times: t.times, positions: t.positions.map((p) => [p[0] * s, p[1] * s, p[2] * s] as Vec3) });
  const left = measureFoot(scaled(toeL), scaled(T(input.ankleL)), scaled(rootT), floorY * s);
  const right = measureFoot(scaled(toeR), scaled(T(input.ankleR)), scaled(rootT), floorY * s);
  // Knee flexion = 180 - included angle at the knee between hip->knee and ankle->knee.
  const flex: number[] = [];
  const thighLt = T(input.thighL); const kneeLt = T(input.kneeL); const ankleLt = T(input.ankleL);
  const thighRt = T(input.thighR); const kneeRt = T(input.kneeR); const ankleRt = T(input.ankleR);
  for (let j = 0; j < clipTimes.length; j += 1) {
    for (const [th, kn, an] of [[thighLt, kneeLt, ankleLt], [thighRt, kneeRt, ankleRt]] as const) {
      flex.push(180 - angleDeg(sub(th.positions[j]!, kn.positions[j]!), sub(an.positions[j]!, kn.positions[j]!)));
    }
  }
  const hipsRest = input.hips.length === 2
    ? mid(poseAt(rig, input.hips[0], null).p, poseAt(rig, input.hips[1], null).p)
    : poseAt(rig, input.hips[0]!, null).p;
  const toeRestY = Math.min(poseAt(rig, input.toeL, null).p[1], poseAt(rig, input.toeR, null).p[1]);
  const sha256 = createHash("sha256").update(readFileSync(input.glb)).digest("hex");
  return {
    metrics: {
      frames: clipTimes.length,
      durationS: clipTimes[clipTimes.length - 1]! - clipTimes[0]!,
      fps: (clipTimes.length - 1) / ((clipTimes[clipTimes.length - 1]! - clipTimes[0]!) || 1),
      floorToeY: floorY * s,
      foot: { left, right },
      hipHeightMeanM: mean(hipsT.positions.map((p) => p[1] * s - floorY * s)),
      hipHeightStandingM: hipsRest[1] * s - toeRestY * s,
      kneeFlexMinDeg: Math.min(...flex),
      kneeFlexMaxDeg: Math.max(...flex),
    },
    channelCount,
    sha256,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const sourceGlb = flag("--source-glb")!;
  const boundGlb = flag("--bound-glb")!;
  const out = flag("--out") ?? ".openclinxr/evidence/walk-clip/stage1-attribution.json";
  if (!sourceGlb || !boundGlb) throw new Error("--source-glb and --bound-glb required");

  const source = await measureColumn({
    glb: sourceGlb, clip: "Walk", scale: 1,
    hips: ["pelvis"], thighL: "thigh_l", kneeL: "calf_l", ankleL: "foot_l", toeL: "ball_l",
    thighR: "thigh_r", kneeR: "calf_r", ankleR: "foot_r", toeR: "ball_r",
    root: ["pelvis"],
  });
  const bound = await measureColumn({
    glb: boundGlb, clip: "openclinxr_retarget_walk_source", scale: ACTOR_SCALE,
    hips: ["pelvis.L", "pelvis.R"],
    thighL: "upperleg01.L", kneeL: "lowerleg01.L", ankleL: "foot.L", toeL: "toe1-1.L",
    thighR: "upperleg01.R", kneeR: "lowerleg01.R", ankleR: "foot.R", toeR: "toe1-1.R",
    root: ["root"],
  });

  const report = {
    schemaVersion: "openclinxr.walk-clip-attribution.v1",
    measuredAt: new Date().toISOString(),
    contactBandM: CONTACT_BAND_M,
    actorScale: ACTOR_SCALE,
    source: { glb: sourceGlb, clip: "Walk", channels: source.channelCount, sha256: source.sha256, metrics: source.metrics },
    bound: { glb: boundGlb, clip: "openclinxr_retarget_walk_source", channels: bound.channelCount, sha256: bound.sha256, metrics: bound.metrics },
    browser: { source: ".openclinxr/evidence/loco-ground/report.json", note: "lockOff mixer-pose clip table, reused; see attribution doc" },
  };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  const f = (v: number, d = 3): string => (Number.isNaN(v) ? "n/a" : v.toFixed(d));
  const row = (label: string, a: number, b: number, d = 3): string =>
    `| ${label} | ${f(a, d)} | ${f(b, d)} |`;
  const S = source.metrics; const B = bound.metrics;
  console.log("frames/duration/fps:", S.frames, f(S.durationS), f(S.fps, 1), "vs", B.frames, f(B.durationS), f(B.fps, 1));
  console.log(row("swing toe max L (m)", S.foot.left.swingToeMaxM, B.foot.left.swingToeMaxM));
  console.log(row("swing toe max R (m)", S.foot.right.swingToeMaxM, B.foot.right.swingToeMaxM));
  console.log(row("swing ankle max L (m)", S.foot.left.swingAnkleMaxM, B.foot.left.swingAnkleMaxM));
  console.log(row("swing ankle max R (m)", S.foot.right.swingAnkleMaxM, B.foot.right.swingAnkleMaxM));
  console.log(row("duty L", S.foot.left.duty, B.foot.left.duty, 2));
  console.log(row("duty R", S.foot.right.duty, B.foot.right.duty, 2));
  console.log(row("stance speed med L (m/s)", S.foot.left.stanceSpeedMedMps, B.foot.left.stanceSpeedMedMps));
  console.log(row("stance speed med R (m/s)", S.foot.right.stanceSpeedMedMps, B.foot.right.stanceSpeedMedMps));
  console.log(row("stance speed CV L", S.foot.left.stanceSpeedCVMps, B.foot.left.stanceSpeedCVMps, 2));
  console.log(row("stance speed CV R", S.foot.right.stanceSpeedCVMps, B.foot.right.stanceSpeedCVMps, 2));
  console.log(row("stride L (m)", S.foot.left.strideM, B.foot.left.strideM));
  console.log(row("stride R (m)", S.foot.right.strideM, B.foot.right.strideM));
  console.log(row("cycle L (s)", S.foot.left.cycleS, B.foot.left.cycleS));
  console.log(row("cycle R (s)", S.foot.right.cycleS, B.foot.right.cycleS));
  console.log(row("natural speed L (m/s)", S.foot.left.naturalSpeedMps, B.foot.left.naturalSpeedMps));
  console.log(row("natural speed R (m/s)", S.foot.right.naturalSpeedMps, B.foot.right.naturalSpeedMps));
  console.log(row("hip height mean (m)", S.hipHeightMeanM, B.hipHeightMeanM));
  console.log(row("hip height standing (m)", S.hipHeightStandingM, B.hipHeightStandingM));
  console.log(`| knee flexion range (deg) | ${f(S.kneeFlexMinDeg, 1)}-${f(S.kneeFlexMaxDeg, 1)} | ${f(B.kneeFlexMinDeg, 1)}-${f(B.kneeFlexMaxDeg, 1)} |`);
  const sourceGate = await gateOneClip({ glbPath: sourceGlb, clipName: "Walk", joints: MESHMOTION_WALK_JOINTS });
  const boundGate = await gateOneClip({ glbPath: boundGlb, clipName: "openclinxr_retarget_walk_source", joints: MPFB_WALK_JOINTS });
  for (const gate of [sourceGate, boundGate]) {
    console.log(`gate ${gate.provenance.clip}: ${gate.pass ? "PASS" : "FAIL"}`);
    for (const bar of gate.bars) console.log(`  ${bar.pass ? "pass" : "FAIL"} ${bar.id}: ${bar.detail}`);
  }
  console.log(`wrote ${out}`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
