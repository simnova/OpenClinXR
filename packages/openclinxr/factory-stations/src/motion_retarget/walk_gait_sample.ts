/**
 * Walk-clip sampler: world positions + world rotations for the symmetry-gate joints.
 *
 * Local FK only (no renderer, no runtime import), following the walk-clip attribution tool.
 * Private to the retarget station; consumers import walk_symmetry_gate.ts, which re-exports
 * the joint presets and sampling entry point as its single surface.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Node as GltfNode } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type WalkGateJoints = {
  hips: readonly [string, string] | readonly [string];
  thighL: string;
  kneeL: string;
  ankleL: string;
  toeL: string;
  thighR: string;
  kneeR: string;
  ankleR: string;
  toeR: string;
  shoulderL: string;
  elbowL: string;
  shoulderR: string;
  elbowR: string;
  root: string;
  /** Metres per clip unit at playback (actor scale for bound clips). */
  scale: number;
};

/** Mesh2Motion human-base/addon rig (66 joints), native units. */
export const MESHMOTION_WALK_JOINTS: WalkGateJoints = {
  hips: ["pelvis"],
  thighL: "thigh_l",
  kneeL: "calf_l",
  ankleL: "foot_l",
  toeL: "ball_l",
  thighR: "thigh_r",
  kneeR: "calf_r",
  ankleR: "foot_r",
  toeR: "ball_r",
  shoulderL: "upperarm_l",
  elbowL: "lowerarm_l",
  shoulderR: "upperarm_r",
  elbowR: "lowerarm_r",
  root: "pelvis",
  scale: 1,
};

/** MPFB2 default_no_toes rig bound clips, played at physician actor scale. */
export const MPFB_WALK_JOINTS: WalkGateJoints = {
  hips: ["pelvis.L", "pelvis.R"],
  thighL: "upperleg01.L",
  kneeL: "lowerleg01.L",
  ankleL: "foot.L",
  toeL: "toe1-1.L",
  thighR: "upperleg01.R",
  kneeR: "lowerleg01.R",
  ankleR: "foot.R",
  toeR: "toe1-1.R",
  shoulderL: "upperarm01.L",
  elbowL: "lowerarm01.L",
  shoulderR: "upperarm01.R",
  elbowR: "lowerarm01.R",
  root: "root",
  scale: 0.86,
};

export type WalkSample = {
  times: number[];
  pos: Record<string, Vec3[]>;
  quat: Record<string, Quat[]>;
};

function normQuat(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Slerp with inputs normalised first (mirrors the settle-entry quat helper contract). */
export function slerpUnit(a: Quat, b: Quat, t: number): Quat {
  const ua = normQuat(a);
  const ub = normQuat(b);
  let dot = ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2] + ua[3] * ub[3];
  const sign = dot < 0 ? -1 : 1;
  dot = Math.min(1, Math.abs(dot));
  if (dot > 0.9995) {
    return normQuat([
      ua[0] + (sign * ub[0] - ua[0]) * t,
      ua[1] + (sign * ub[1] - ua[1]) * t,
      ua[2] + (sign * ub[2] - ua[2]) * t,
      ua[3] + (sign * ub[3] - ua[3]) * t,
    ]);
  }
  const th = Math.acos(dot);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return normQuat([
    ua[0] * wa + sign * ub[0] * wb,
    ua[1] * wa + sign * ub[1] * wb,
    ua[2] * wa + sign * ub[2] * wb,
    ua[3] * wa + sign * ub[3] * wb,
  ]);
}

function quatToMat(r: Quat): number[] {
  const [x, y, z, w] = r;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
}

function matToQuat(m: number[]): Quat {
  const trace = m[0]! + m[4]! + m[8]!;
  if (trace > 0) {
    const q = Math.sqrt(trace + 1) / 2;
    return normQuat([(m[7]! - m[5]!) / (4 * q), (m[2]! - m[6]!) / (4 * q), (m[3]! - m[1]!) / (4 * q), q]);
  }
  if (m[0]! > m[4]! && m[0]! > m[8]!) {
    const q = Math.sqrt(1 + m[0]! - m[4]! - m[8]!) / 2;
    return normQuat([q, (m[1]! + m[3]!) / (4 * q), (m[2]! + m[6]!) / (4 * q), (m[5]! - m[7]!) / (4 * q)]);
  }
  if (m[4]! > m[8]!) {
    const q = Math.sqrt(1 + m[4]! - m[0]! - m[8]!) / 2;
    return normQuat([(m[1]! + m[3]!) / (4 * q), q, (m[5]! + m[7]!) / (4 * q), (m[6]! - m[2]!) / (4 * q)]);
  }
  const q = Math.sqrt(1 + m[8]! - m[0]! - m[4]!) / 2;
  return normQuat([(m[2]! + m[6]!) / (4 * q), (m[5]! + m[7]!) / (4 * q), q, (m[3]! - m[1]!) / (4 * q)]);
}

type Channel = {
  path: "translation" | "rotation";
  times: Float32Array;
  values: Float32Array;
  stride: number;
  interpolation: string;
};

function sampleChannelValues(ch: Channel, t: number): number[] {
  const count = ch.times.length;
  const at = (idx: number): number[] => Array.from(ch.values.subarray(idx * ch.stride, idx * ch.stride + ch.stride));
  if (t <= ch.times[0]!) return at(0);
  if (t >= ch.times[count - 1]!) return at(count - 1);
  let hi = 1;
  while (hi < count && ch.times[hi]! < t) hi += 1;
  const lo = hi - 1;
  if (ch.interpolation === "STEP") return at(lo);
  const span = ch.times[hi]! - ch.times[lo]!;
  const f = span === 0 ? 0 : (t - ch.times[lo]!) / span;
  const a = at(lo);
  const b = at(hi);
  if (ch.path === "rotation") return slerpUnit(a as Quat, b as Quat, f);
  return a.map((v, idx) => v + (b[idx]! - v) * f);
}

const GATE_JOINT_NAMES = (joints: WalkGateJoints): string[] => [...new Set([
  ...joints.hips,
  joints.thighL, joints.kneeL, joints.ankleL, joints.toeL,
  joints.thighR, joints.kneeR, joints.ankleR, joints.toeR,
  joints.shoulderL, joints.elbowL, joints.shoulderR, joints.elbowR,
  joints.root,
])];

/** Sample one clip's world positions and world rotations for the gate joints. */
export async function sampleWalkClip(input: {
  glbPath: string;
  clipName: string;
  joints: WalkGateJoints;
}): Promise<{ sample: WalkSample; frames: number; durationS: number; sha256: string }> {
  const doc = await new NodeIO().read(input.glbPath);
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === input.clipName);
  if (!anim) {
    throw new Error(`no clip ${input.clipName} in ${input.glbPath}: ${doc.getRoot().listAnimations().map((a) => a.getName()).join(",")}`);
  }
  const names = GATE_JOINT_NAMES(input.joints);
  const channels: Array<{ node: GltfNode; ch: Channel }> = [];
  let clipTimes: Float32Array | null = null;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const sampler = ch.getSampler();
    const targetPath = ch.getTargetPath();
    if (!node || !sampler || (targetPath !== "translation" && targetPath !== "rotation")) continue;
    if (sampler.getInterpolation() === "CUBICSPLINE") throw new Error(`CUBICSPLINE on ${node.getName()}, refused`);
    const times = sampler.getInput()?.getArray();
    const values = sampler.getOutput()?.getArray();
    if (!times || !values) continue;
    const entry: Channel = {
      path: targetPath,
      times: Float32Array.from(times),
      values: Float32Array.from(values),
      stride: targetPath === "rotation" ? 4 : 3,
      interpolation: sampler.getInterpolation(),
    };
    channels.push({ node, ch: entry });
    if (!clipTimes || entry.times.length > clipTimes.length) clipTimes = entry.times;
  }
  if (!clipTimes) throw new Error("no sampled channels");
  const nodes = doc.getRoot().listNodes();
  const byName = new Map(nodes.map((node) => [node.getName(), node]));
  for (const name of names) {
    if (!byName.has(name)) throw new Error(`no node ${name} in ${input.glbPath}`);
  }
  const parentOf = new Map<string, string>();
  for (const node of nodes) {
    for (const child of node.listChildren()) parentOf.set(child.getName(), node.getName());
  }
  const chains = new Map<string, GltfNode[]>();
  for (const name of names) {
    const chain: GltfNode[] = [];
    let current: GltfNode | undefined = byName.get(name);
    while (current) {
      chain.unshift(current);
      const parent = parentOf.get(current.getName());
      current = parent ? byName.get(parent) : undefined;
    }
    chains.set(name, chain);
  }
  const times = Array.from(clipTimes);
  const pos: Record<string, Vec3[]> = {};
  const quat: Record<string, Quat[]> = {};
  for (const name of names) {
    pos[name] = [];
    quat[name] = [];
  }
  for (const t of times) {
    for (const name of names) {
      let R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      let P: Vec3 = [0, 0, 0];
      for (const node of chains.get(name)!) {
        let tr = node.getTranslation() as unknown as Vec3;
        let ro = node.getRotation() as unknown as Quat;
        for (const { node: target, ch } of channels) {
          if (target !== node) continue;
          const v = sampleChannelValues(ch, t);
          if (ch.path === "translation") tr = v as Vec3;
          else ro = v as Quat;
        }
        const m = quatToMat(normQuat(ro));
        P = [
          R[0]! * tr[0] + R[1]! * tr[1] + R[2]! * tr[2] + P[0],
          R[3]! * tr[0] + R[4]! * tr[1] + R[5]! * tr[2] + P[1],
          R[6]! * tr[0] + R[7]! * tr[1] + R[8]! * tr[2] + P[2],
        ];
        const next = new Array<number>(9);
        for (let row = 0; row < 3; row += 1) {
          for (let col = 0; col < 3; col += 1) {
            next[row * 3 + col] = R[row * 3]! * m[col]! + R[row * 3 + 1]! * m[3 + col]! + R[row * 3 + 2]! * m[6 + col]!;
          }
        }
        R = next;
      }
      pos[name]!.push(P);
      quat[name]!.push(matToQuat(R));
    }
  }
  for (const name of names) {
    if (pos[name]!.length !== times.length || quat[name]!.length !== times.length) {
      throw new Error(`track/frame length mismatch on ${name}: tracks must align with timestamps`);
    }
  }
  return {
    sample: { times, pos, quat },
    frames: times.length,
    durationS: times[times.length - 1]! - times[0]!,
    sha256: createHash("sha256").update(readFileSync(input.glbPath)).digest("hex"),
  };
}
