/**
 * Lane C cagematch: linear 0.25 s crossfade (A) vs inertialized switch (B) vs inertialized
 * switch + inertialized foot lock + two-bone IK (C) on the SAME walk-to-stop switch frame.
 *
 * Drives the shipped walk loop (`openclinxr_retarget_walk_source` from the shipped rig GLB)
 * into the S1 stop take (scratch GLB copied to `.openclinxr/evidence/inertialize/`) using FK
 * over the GLB tracks (`bound-clip-foot-track.ts` pattern: gltf-transform sampling plus
 * quaternion composition, no renderer), at 60 Hz, switching at the runtime assay's
 * `stopEntryTimeS` phase. Contact labels come from the takes' own motion via a local port of
 * `computeLocomotionStanceLabels` (median backward-speed band + clip-envelope height cut;
 * cyclic for the walk loop, one-shot `cyclic:false` + 0..inf band + net-travel forward for the
 * stop take, mirroring `resolveOneShotStanceLabels`).
 *
 * D3/D4: isolated headless harness (no browser, no runtime import, no package-src import),
 * one transition (walk -> stop entry), one rig decided first (physician bars gate the verdict;
 * nurse/child run once regardless per the kill-test instruction).
 *
 * Usage: pnpm --silent tsx tools/openclinxr/evidence/foot-plant/inertialize/cagematch.ts [--out <report.json>]
 *
 * claimScope: world-space toe tracks and per-bone local-rotation rates over the 16-frame
 * transition window in GLB scene space, for three treatments on identical switch frames.
 * notEvidenceFor: runtime display, visual quality, Quest performance, clinical plausibility.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Node as GltfNode } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";
import {
  type ContactLockState,
  contactReset,
  contactUpdate,
  inertializeTransitionQuat,
  inertializeTransitionVec,
  inertializeUpdateQuat,
  inertializeUpdateVec,
  type Quat,
  quatAngleBetween,
  quatInv,
  quatMul,
  quatNormalize,
  quatSlerp,
  quatToScaledAngleAxis,
  solveTwoBoneIKWorld,
  type Vec3,
  vecDistXZ,
} from "./inertialize.js";

const DT = 1 / 60;
const WINDOW_FRAMES = 16; // first 0.25 s of stopping, the slide-decomposition crossfade bucket
const WALK_CLIP = "openclinxr_retarget_walk_source";
const HALFLIFE_S = 0.1; // controller.cpp inertialize_blending_halflife + ik_blending_halflife defaults
const UNLOCK_RADIUS_M = 0.2; // controller.cpp ik_unlock_radius default
const MAX_EXTENSION_BUFFER_M = 0.015; // controller.cpp ik_max_length_buffer default
const MAX_TOE_STEP_FLAG_M = 0.08; // turn-quality-metrics.ts MAX_TOE_STEP_PER_FRAME_FLAG_METERS
const DRAG_BAR_M = 0.05;

type Rig = {
  rig: string;
  shippedGlb: string;
  stopGlb: string;
  stopClipPrefix: string;
  entryTimeS: number;
};

const RIGS: Rig[] = [
  {
    rig: "physician",
    shippedGlb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
    stopGlb: ".openclinxr/evidence/inertialize/physician-stop.glb",
    stopClipPrefix: "openclinxr_retarget_kimodo_stop_physician_seed8",
    entryTimeS: 1.6632475163873461,
  },
  {
    rig: "nurse",
    shippedGlb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
    stopGlb: ".openclinxr/evidence/inertialize/nurse-stop.glb",
    stopClipPrefix: "openclinxr_retarget_kimodo_stop_nurse_seed3",
    entryTimeS: 1.938707833356825,
  },
  {
    rig: "child",
    shippedGlb: "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb",
    stopGlb: ".openclinxr/evidence/inertialize/child-stop.glb",
    stopClipPrefix: "openclinxr_retarget_kimodo_stop_child_seed6",
    entryTimeS: 1.424000793741748,
  },
];

/* ------------------------------------------------------------ glTF sampling */

type Channel = {
  path: "translation" | "rotation" | "scale";
  times: Float32Array;
  values: Float32Array;
  stride: number;
  interpolation: string;
};

type Clip = {
  name: string;
  durationS: number;
  /** Per node index: channels (empty when the node is not animated by this clip). */
  perNode: Channel[][];
};

export type RigModel = {
  nodeNames: string[];
  parents: number[];
  order: number[];
  bindT: Vec3[];
  bindR: Quat[];
  clips: Map<string, Clip>;
};

function sampleChannelValue(channel: Channel, t: number): number[] {
  const { times, values, stride } = channel;
  const count = times.length;
  const at = (i: number): number[] => Array.from(values.subarray(i * stride, i * stride + stride));
  if (count === 0) throw new Error("cagematch: sampler has no keyframes.");
  if (t <= times[0]!) return at(0);
  if (t >= times[count - 1]!) return at(count - 1);
  let hi = 1;
  while (hi < count && times[hi]! < t) hi += 1;
  const lo = hi - 1;
  if (channel.interpolation === "STEP") return at(lo);
  const span = times[hi]! - times[lo]!;
  const f = span === 0 ? 0 : (t - times[lo]!) / span;
  const a = at(lo);
  const b = at(hi);
  if (channel.path === "rotation") return quatSlerp(a as Quat, b as Quat, f);
  return a.map((v, i) => v + (b[i]! - v) * f);
}

export async function loadModel(glbPath: string): Promise<RigModel> {
  const document = await new NodeIO().read(glbPath);
  const root = document.getRoot();
  const nodes = root.listNodes();
  const nodeNames = nodes.map((n) => n.getName());
  const indexOf = new Map<GltfNode, number>(nodes.map((n, i) => [n, i]));
  const parents = nodes.map(() => -1);
  for (const [i, n] of nodes.entries()) {
    for (const child of n.listChildren()) parents[indexOf.get(child)!] = i;
  }
  // Topological order (parents before children) via DFS from roots.
  const order: number[] = [];
  const seen = new Set<number>();
  const visit = (i: number): void => {
    if (seen.has(i)) return;
    seen.add(i);
    order.push(i);
    for (const [j, p] of parents.entries()) if (p === i) visit(j);
  };
  nodes.forEach((_, i) => { if (parents[i] === -1) visit(i); });
  nodes.forEach((_, i) => { if (!seen.has(i)) visit(i); });

  const bindT = nodes.map((n) => [...(n.getTranslation() as unknown as Vec3)] as Vec3);
  const bindR = nodes.map((n) => quatNormalize([...(n.getRotation() as unknown as Quat)] as Quat));

  const clips = new Map<string, Clip>();
  for (const anim of root.listAnimations()) {
    const perNode: Channel[][] = nodes.map(() => []);
    let durationS = 0;
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const sampler = ch.getSampler();
      const chPath = ch.getTargetPath();
      if (!node || !sampler || !chPath) continue;
      if (chPath !== "translation" && chPath !== "rotation" && chPath !== "scale") continue;
      if (sampler.getInterpolation() === "CUBICSPLINE") {
        throw new Error(`cagematch: CUBICSPLINE sampler refused on ${node.getName()}.`);
      }
      const times = sampler.getInput()?.getArray();
      const values = sampler.getOutput()?.getArray();
      if (!times || !values) continue;
      durationS = Math.max(durationS, times[times.length - 1] ?? 0);
      perNode[indexOf.get(node)!]!.push({
        path: chPath,
        times: Float32Array.from(times),
        values: Float32Array.from(values),
        stride: chPath === "rotation" ? 4 : 3,
        interpolation: sampler.getInterpolation(),
      });
    }
    clips.set(anim.getName(), { name: anim.getName(), durationS, perNode });
  }
  return { nodeNames, parents, order, bindT, bindR, clips };
}

/** Local pose of every node at time t (looping when `cyclic`). */
export function samplePose(
  model: RigModel, clip: Clip, t: number, cyclic: boolean,
  outT: Vec3[], outR: Quat[],
): void {
  const wrapped = cyclic && clip.durationS > 0
    ? ((t % clip.durationS) + clip.durationS) % clip.durationS
    : Math.min(Math.max(t, 0), clip.durationS);
  for (const i of model.order) {
    let tr = model.bindT[i]!;
    let ro = model.bindR[i]!;
    for (const ch of clip.perNode[i]!) {
      const v = sampleChannelValue(ch, wrapped);
      if (ch.path === "translation") tr = v as Vec3;
      else if (ch.path === "rotation") ro = quatNormalize(v as Quat);
    }
    outT[i] = tr;
    outR[i] = ro;
  }
}

/** World matrices (row-major, translation in last column) + world quats + world positions. */
export function forwardKinematics(
  model: RigModel, localT: Vec3[], localR: Quat[],
  outPos: Vec3[], outQuat: Quat[],
): void {
  // Per-node world matrix as rotation rows + position; store compactly.
  const mats: Float64Array[] = model.order.map(() => new Float64Array(16));
  const byIndex = new Map<number, Float64Array>();
  for (const i of model.order) {
    const [x, y, z, w] = localR[i]!;
    const [tx, ty, tz] = localT[i]!;
    const m = new Float64Array([
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), tx,
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), ty,
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), tz,
      0, 0, 0, 1,
    ]);
    const p = model.parents[i]!;
    const world = p === -1 ? m : multiply(byIndex.get(p)!, m);
    mats[i] = world;
    byIndex.set(i, world);
  }
  for (let i = 0; i < model.nodeNames.length; i += 1) {
    const m = mats[i]!;
    outPos[i] = [m[3]!, m[7]!, m[11]!];
    outQuat[i] = quatFromMatrix(m);
  }
}

function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      out[r * 4 + c] =
        a[r * 4]! * b[c]! + a[r * 4 + 1]! * b[4 + c]! + a[r * 4 + 2]! * b[8 + c]! + a[r * 4 + 3]! * b[12 + c]!;
    }
  }
  return out;
}

function quatFromMatrix(m: Float64Array): Quat {
  const trace = m[0]! + m[5]! + m[10]!;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return quatNormalize([
      (m[9]! - m[6]!) * s,
      (m[2]! - m[8]!) * s,
      (m[4]! - m[1]!) * s,
      0.25 / s,
    ]);
  }
  if (m[0]! > m[5]! && m[0]! > m[10]!) {
    const s = 2 * Math.sqrt(1 + m[0]! - m[5]! - m[10]!);
    return quatNormalize([0.25 * s, (m[1]! + m[4]!) / s, (m[2]! + m[8]!) / s, (m[9]! - m[6]!) / s]);
  }
  if (m[5]! > m[10]!) {
    const s = 2 * Math.sqrt(1 + m[5]! - m[0]! - m[10]!);
    return quatNormalize([(m[1]! + m[4]!) / s, 0.25 * s, (m[6]! + m[9]!) / s, (m[2]! - m[8]!) / s]);
  }
  const s = 2 * Math.sqrt(1 + m[10]! - m[0]! - m[5]!);
  return quatNormalize([(m[2]! + m[8]!) / s, (m[6]! + m[9]!) / s, 0.25 * s, (m[4]! - m[1]!) / s]);
}

/* ------------------------------------------------------------ stance labels */

/**
 * Local port of `computeLocomotionStanceLabels` (locomotion-stance-labels.ts): median
 * backward along-axis speed band plus clip-envelope height cut. The exact construction is
 * restated here because tools files cannot import package src.
 */
function computeLabels(input: {
  forward: Vec3;
  left: Vec3[];
  right: Vec3[];
  cyclic: boolean;
  lowerMps?: number;
  upperMps?: number;
}): { left: boolean[]; right: boolean[] } {
  const fwd: Vec3 = [input.forward[0], 0, input.forward[2]];
  const l = Math.hypot(fwd[0], fwd[2]) || 1;
  fwd[0] /= l; fwd[2] /= l;
  const alongOf = (track: Vec3[], i: number): number => {
    if (!input.cyclic) {
      if (i === 0 || i === track.length - 1) {
        const a = track[i === 0 ? 0 : i - 1]!;
        const b = track[i === 0 ? 1 : i]!;
        const dt = DT;
        return ((b[0] - a[0]) * fwd[0] + (b[2] - a[2]) * fwd[2]) / dt;
      }
    }
    const n = track.length;
    const p = track[(i - 1 + n) % n]!;
    const q = track[(i + 1) % n]!;
    return ((q[0] - p[0]) * fwd[0] + (q[2] - p[2]) * fwd[2]) / (2 * DT);
  };
  const backward: number[] = [];
  for (let i = 0; i < input.left.length; i += 1) {
    const al = alongOf(input.left, i);
    const ar = alongOf(input.right, i);
    if (al < 0) backward.push(-al);
    if (ar < 0) backward.push(-ar);
  }
  const sorted = [...backward].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] ?? 0 : 0;
  const devs = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = devs.length > 0 ? devs[Math.floor(devs.length / 2)] ?? 0 : 0;
  const lower = input.lowerMps ?? (sorted.length > 0 ? sorted[0] ?? 0 : 0);
  const upper = input.upperMps ?? (median + Math.max(2 * mad, 0.1 * median));
  const heights: number[] = [];
  for (const p of input.left) heights.push(p[1]);
  for (const p of input.right) heights.push(p[1]);
  const cut = Math.min(...heights) + 0.5 * (Math.max(...heights) - Math.min(...heights)) + 0.005;
  const label = (track: Vec3[]): boolean[] =>
    track.map((p, i) => {
      const b = -alongOf(track, i);
      return b >= lower && b <= upper && p[1] <= cut;
    });
  return { left: label(input.left), right: label(input.right) };
}

/** Local port of `forwardFromTracks`: direction of the longest contiguous near-floor run. */
function forwardFromTracks(left: Vec3[], right: Vec3[]): Vec3 {
  let best: Vec3 = [0, 0, 1];
  let bestTravel = 0;
  for (const track of [left, right]) {
    const hs = track.map((p) => p[1]);
    const cut = Math.min(...hs) + 0.5 * (Math.max(...hs) - Math.min(...hs));
    let start = -1;
    let run = { s: -1, e: -1, len: 0 };
    for (let i = 0; i <= track.length; i += 1) {
      const low = i < track.length && (hs[i] ?? Infinity) <= cut;
      if (low) {
        if (start === -1) start = i;
      } else if (start !== -1) {
        if (i - start > run.len) run = { s: start, e: i - 1, len: i - start };
        start = -1;
      }
    }
    if (run.len < 2) continue;
    const f = track[run.s]!;
    const q = track[run.e]!;
    const dx = f[0] - q[0];
    const dz = f[2] - q[2];
    const travel = Math.hypot(dx, dz);
    if (travel > bestTravel) {
      bestTravel = travel;
      best = [dx / (travel || 1), 0, dz / (travel || 1)];
    }
  }
  return best;
}

/* ------------------------------------------------------------ cagematch */

type TreatmentMetrics = {
  dragM: number | null;
  dragFoot: string | null;
  contactFrames: number;
  maxStepM: number | null;
  maxRotDegPerFrame: number;
};

async function runRig(rig: Rig): Promise<{
  A: TreatmentMetrics;
  B: TreatmentMetrics;
  C: TreatmentMetrics;
  meta: Record<string, unknown>;
}> {
  const shipped = await loadModel(rig.shippedGlb);
  const scratch = await loadModel(rig.stopGlb);
  const walk = shipped.clips.get(WALK_CLIP);
  if (!walk) throw new Error(`cagematch/${rig.rig}: no ${WALK_CLIP} in shipped GLB.`);
  const stopName = [...scratch.clips.keys()].find((clip) => clip.startsWith(rig.stopClipPrefix));
  if (!stopName) throw new Error(`cagematch/${rig.rig}: no ${rig.stopClipPrefix}* clip.`);
  const stop = scratch.clips.get(stopName)!;

  // Node index map shipped -> scratch by name (identical rigs, 149 nodes each).
  const scratchIndex = new Map(scratch.nodeNames.map((nm, i) => [nm, i]));
  const nameOf = (i: number): string => shipped.nodeNames[i]!;
  const toeL = shipped.nodeNames.indexOf("toe1-1.L");
  const toeR = shipped.nodeNames.indexOf("toe1-1.R");
  const rootIdx = shipped.nodeNames.indexOf("root");
  const chainFor = (side: "L" | "R"): { hip: number; knee: number; heel: number; toe: number } => ({
    hip: shipped.nodeNames.indexOf(`upperleg01.${side}`),
    knee: shipped.nodeNames.indexOf(`lowerleg01.${side}`),
    heel: shipped.nodeNames.indexOf(`foot.${side}`),
    toe: shipped.nodeNames.indexOf(`toe1-1.${side}`),
  });
  for (const [k, v] of Object.entries({ toeL, toeR, rootIdx })) {
    if (v === -1) throw new Error(`cagematch/${rig.rig}: missing node for ${k}.`);
  }

  const n = shipped.nodeNames.length;
  const allocT = (): Vec3[] => Array.from({ length: n }, () => [0, 0, 0] as Vec3);
  const allocR = (): Quat[] => Array.from({ length: n }, () => [0, 0, 0, 1] as Quat);

  // Resample both clips at 60 Hz in their own spaces.
  const walkFrames = Math.max(2, Math.floor(walk.durationS / DT));
  const stopFrames = Math.max(2, Math.floor(stop.durationS / DT));
  const walkT: Vec3[][] = [];
  const walkR: Quat[][] = [];
  {
    const t = allocT();
    const r = allocR();
    for (let f = 0; f <= walkFrames; f += 1) {
      samplePose(shipped, walk, f * DT, true, t, r);
      walkT.push(t.map((v) => [...v] as Vec3));
      walkR.push(r.map((v) => [...v] as Quat));
    }
  }
  // Stop take decoded in scratch space, then re-indexed to shipped order by name.
  const stopT: Vec3[][] = [];
  const stopR: Quat[][] = [];
  {
    const t = allocT();
    const r = allocR();
    const st = allocT();
    const sr = allocR();
    for (let f = 0; f <= stopFrames; f += 1) {
      samplePose(scratch, stop, f * DT, false, st, sr);
      for (let i = 0; i < n; i += 1) {
        const j = scratchIndex.get(nameOf(i)) ?? -1;
        t[i] = j === -1 ? [...shipped.bindT[i]!] as Vec3 : [...st[j]!] as Vec3;
        r[i] = j === -1 ? [...shipped.bindR[i]!] as Quat : [...sr[j]!] as Quat;
      }
      stopT.push(t.map((v) => [...v] as Vec3));
      stopR.push(r.map((v) => [...v] as Quat));
    }
  }

  // FK helper over shipped topology.
  const fk = (t: Vec3[], r: Quat[]): { pos: Vec3[]; quat: Quat[] } => {
    const pos: Vec3[] = allocT();
    const quat: Quat[] = allocR();
    forwardKinematics(shipped, t, r, pos, quat);
    return { pos, quat };
  };

  // Switch frame: the runtime assay's entry phase; source walk phase wraps the loop.
  const S = Math.round(rig.entryTimeS / DT);
  const walkAt = (frameFloat: number): number =>
    ((Math.round(frameFloat) % walkT.length) + walkT.length) % walkT.length;
  const srcIdx = walkAt(S);
  const stopAt = (k: number): number => Math.min(k, stopT.length - 1);

  // Root alignment: translate the whole stop take so stop(0) root XZ == walk(S) root XZ
  // (the production stop clone's own alignment; keeps the morph about pose, not travel).
  const walkRootS = fk(walkT[srcIdx]!, walkR[srcIdx]!).pos[rootIdx]!;
  const stopRoot0 = fk(stopT[0]!, stopR[0]!).pos[rootIdx]!;
  const alignDX = walkRootS[0] - stopRoot0[0];
  const alignDZ = walkRootS[2] - stopRoot0[2];
  const rootScratch = scratchIndex.get("root") ?? -1;
  void rootScratch;
  for (const frame of stopT) {
    // root is index rootIdx in shipped order (same rig, same name).
    frame[rootIdx] = [frame[rootIdx]![0] + alignDX, frame[rootIdx]![1], frame[rootIdx]![2] + alignDZ];
  }

  // Toe tracks for labels (travel-removed: minus each clip's own root XZ walk-off).
  const travelRemoved = (
    tFrames: Vec3[][],
    rFrames: Quat[][],
    toe: number,
  ): Vec3[] => {
    const toes: Vec3[] = [];
    const roots: Vec3[] = [];
    for (let f = 0; f < tFrames.length; f += 1) {
      const { pos } = fk(tFrames[f]!, rFrames[f]!);
      toes.push(pos[toe]!);
      roots.push(pos[rootIdx]!);
    }
    const bx = roots[0]![0];
    const bz = roots[0]![2];
    return toes.map((p, f) => [p[0] - (roots[f]![0] - bx), p[1], p[2] - (roots[f]![2] - bz)] as Vec3);
  };
  const walkToeL = travelRemoved(walkT, walkR, toeL);
  const walkToeR = travelRemoved(walkT, walkR, toeR);
  const stopToeL = travelRemoved(stopT, stopR, toeL);
  const stopToeR = travelRemoved(stopT, stopR, toeR);

  const walkFwd = forwardFromTracks(walkToeL, walkToeR);
  const walkLabels = computeLabels({ forward: walkFwd, left: walkToeL, right: walkToeR, cyclic: true });
  // One-shot stop labels: net root-travel forward, 0..inf band (resolveOneShotStanceLabels rule).
  const stopRootA = fk(stopT[0]!, stopR[0]!).pos[rootIdx]!;
  const stopRootB = fk(stopT[stopT.length - 1]!, stopR[stopT.length - 1]!).pos[rootIdx]!;
  const netLen = Math.hypot(stopRootB[0] - stopRootA[0], stopRootB[2] - stopRootA[2]) || 1;
  const stopFwd: Vec3 = [
    (stopRootB[0] - stopRootA[0]) / netLen,
    0,
    (stopRootB[2] - stopRootA[2]) / netLen,
  ];
  const stopLabels = computeLabels({
    forward: stopFwd,
    left: stopToeL,
    right: stopToeR,
    cyclic: false,
    lowerMps: 0,
    upperMps: Number.POSITIVE_INFINITY,
  });

  // Contact foot at the switch: the stop take's own frame-0 label first, walk label fallback.
  let dragSide: "L" | "R";
  {
    const l0 = stopLabels.left[0] === true;
    const r0 = stopLabels.right[0] === true;
    if (l0 !== r0) {
      dragSide = l0 ? "L" : "R";
    } else {
      const wl = walkLabels.left[srcIdx % walkLabels.left.length] === true;
      const wr = walkLabels.right[srcIdx % walkLabels.right.length] === true;
      if (wl !== wr) dragSide = wl ? "L" : "R";
      else {
        const pl = fk(walkT[srcIdx]!, walkR[srcIdx]!).pos[toeL]!;
        const pr = fk(walkT[srcIdx]!, walkR[srcIdx]!).pos[toeR]!;
        dragSide = pl[1] <= pr[1] ? "L" : "R";
      }
    }
  }

  // Finite-difference local velocities on a resampled track.
  const posVel = (frames: Vec3[][], f: number, i: number): Vec3 => {
    const a = frames[Math.max(0, f - 1)]![i]!;
    const b = frames[Math.min(frames.length - 1, f)]![i]!;
    const span = Math.min(f, frames.length - 1) - Math.max(0, f - 1) || 1;
    return [(b[0] - a[0]) / (span * DT), (b[1] - a[1]) / (span * DT), (b[2] - a[2]) / (span * DT)];
  };
  const angVel = (frames: Quat[][], f: number, i: number): Vec3 => {
    const a = frames[Math.max(0, f - 1)]![i]!;
    const b = frames[Math.min(frames.length - 1, f)]![i]!;
    const span = Math.min(f, frames.length - 1) - Math.max(0, f - 1) || 1;
    const d = quatToScaledAngleAxis(quatMul(b, quatInv(a)));
    return [d[0] / (span * DT), d[1] / (span * DT), d[2] / (span * DT)];
  };

  // Animated node set (union over both clips) for offsets + discontinuity scan.
  const animated = new Set<number>();
  for (const clip of [walk, stop]) {
    clip.perNode.forEach((chs, i) => { if (chs.length > 0) animated.add(i); });
  }
  const bones = [...animated];

  type Pose = { t: Vec3[]; r: Quat[] };
  const clonePose = (t: Vec3[], r: Quat[]): Pose => ({
    t: t.map((v) => [...v] as Vec3),
    r: r.map((v) => [...v] as Quat),
  });

  // Treatment pose sequences over k = 0..15 (stop-time k*DT), plus pre-switch frame.
  const preR = walkR[walkAt(S - 1)]!.map((v) => [...v] as Quat);

  const runA = (): Pose[] => {
    const out: Pose[] = [];
    for (let k = 0; k < WINDOW_FRAMES; k += 1) {
      const alpha = k / (WINDOW_FRAMES - 1);
      const si = walkAt(S + k);
      const di = stopAt(k);
      const t = allocT();
      const r = allocR();
      for (let i = 0; i < n; i += 1) {
        const a = walkT[si]![i]!;
        const b = stopT[di]![i]!;
        t[i] = [a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha];
        r[i] = quatSlerp(walkR[si]![i]!, stopR[di]![i]!, alpha);
      }
      out.push({ t, r });
    }
    return out;
  };

  const runB = (): Pose[] => {
    // Offsets per animated bone, captured at the switch (transition), decayed per frame.
    const offX = new Map<number, Vec3>();
    const offV = new Map<number, Vec3>();
    const offQ = new Map<number, Quat>();
    const offW = new Map<number, Vec3>();
    for (const i of bones) {
      const ox: Vec3 = [0, 0, 0];
      const ov: Vec3 = [0, 0, 0];
      const oq: Quat = [0, 0, 0, 1];
      const ow: Vec3 = [0, 0, 0];
      inertializeTransitionVec(ox, ov, walkT[srcIdx]![i]!, posVel(walkT, srcIdx, i), stopT[0]![i]!, posVel(stopT, 0, i));
      inertializeTransitionQuat(oq, ow, walkR[srcIdx]![i]!, angVel(walkR, srcIdx, i), stopR[0]![i]!, angVel(stopR, 0, i));
      offX.set(i, ox);
      offV.set(i, ov);
      offQ.set(i, oq);
      offW.set(i, ow);
    }
    const out: Pose[] = [];
    for (let k = 0; k < WINDOW_FRAMES; k += 1) {
      const di = stopAt(k);
      const t = allocT();
      const r = allocR();
      for (let i = 0; i < n; i += 1) {
        if (!animated.has(i)) {
          t[i] = [...stopT[di]![i]!] as Vec3;
          r[i] = [...stopR[di]![i]!] as Quat;
          continue;
        }
        const pu = inertializeUpdateVec(offX.get(i)!, offV.get(i)!, stopT[di]![i]!, posVel(stopT, di, i), HALFLIFE_S, DT);
        const qu = inertializeUpdateQuat(offQ.get(i)!, offW.get(i)!, stopR[di]![i]!, angVel(stopR, di, i), HALFLIFE_S, DT);
        t[i] = pu.outX;
        r[i] = qu.outX;
      }
      out.push({ t, r });
    }
    return out;
  };

  const runC = (): Pose[] => {
    const base = runB();
    // Per-foot lock states, seeded from the blended switch-frame toes.
    const toesAt = (pose: Pose): { L: Vec3; R: Vec3 } => {
      const { pos } = fk(pose.t, pose.r);
      return { L: pos[toeL]!, R: pos[toeR]! };
    };
    const seed = toesAt(base[0]!);
    const lockL = contactReset(seed.L, [0, 0, 0]);
    const lockR = contactReset(seed.R, [0, 0, 0]);
    // Rig foot height: min toe Y over the stop take (reference foot_height datum).
    let footHeight = Number.POSITIVE_INFINITY;
    for (const p of [...stopToeL, ...stopToeR]) footHeight = Math.min(footHeight, p[1]);
    const out: Pose[] = [];
    for (let k = 0; k < WINDOW_FRAMES; k += 1) {
      const pose = clonePose(base[k]!.t, base[k]!.r);
      const live = toesAt(pose);
      const labelL = stopLabels.left[Math.min(k, stopLabels.left.length - 1)] === true;
      const labelR = stopLabels.right[Math.min(k, stopLabels.right.length - 1)] === true;
      const updL = contactUpdate(lockL, live.L, labelL, UNLOCK_RADIUS_M, footHeight, HALFLIFE_S, DT);
      const updR = contactUpdate(lockR, live.R, labelR, UNLOCK_RADIUS_M, footHeight, HALFLIFE_S, DT);
      // Enforce locked pins with analytic two-bone IK (position only).
      const { pos, quat } = fk(pose.t, pose.r);
      const enforce = (
        side: "L" | "R", lock: ContactLockState, upd: { outX: Vec3 },
      ): void => {
        if (!lock.contactLock) return;
        const chain = chainFor(side);
        const toeIdx = chain.toe;
        void toeIdx;
        const liveToe = side === "L" ? live.L : live.R;
        const heelTarget: Vec3 = [
          upd.outX[0] + (pos[chain.heel]![0] - liveToe[0]),
          upd.outX[1] + (pos[chain.heel]![1] - liveToe[1]),
          upd.outX[2] + (pos[chain.heel]![2] - liveToe[2]),
        ];
        // Hip parent world quat: FK of the parent chain.
        const hipParentIdx = shipped.parents[chain.hip]!;
        const hipParentQ: Quat = hipParentIdx === -1 ? [0, 0, 0, 1] : quat[hipParentIdx]!;
        const kneeParentIdx = shipped.parents[chain.knee]!;
        const kneeParentQ: Quat = kneeParentIdx === -1 ? [0, 0, 0, 1] : quat[kneeParentIdx]!;
        const solved = solveTwoBoneIKWorld({
          hipPos: pos[chain.hip]!,
          kneePos: pos[chain.knee]!,
          heelPos: pos[chain.heel]!,
          hipWorldQuat: quat[chain.hip]!,
          kneeWorldQuat: quat[chain.knee]!,
          hipParentWorldQuat: hipParentQ,
          kneeParentWorldQuat: kneeParentQ,
          heelTarget,
          forward: stopFwd,
          maxExtensionBuffer: MAX_EXTENSION_BUFFER_M,
        });
        pose.r[chain.hip] = solved.hipLocal;
        pose.r[chain.knee] = solved.kneeLocal;

      };
      enforce("L", lockL, updL);
      enforce("R", lockR, updR);
      out.push(pose);
    }
    return out;
  };

  const grade = (seq: Pose[]): TreatmentMetrics => {
    const toeSeq = seq.map((pose) => {
      const { pos } = fk(pose.t, pose.r);
      return { L: pos[toeL]!, R: pos[toeR]! };
    });
    const labels = dragSide === "L" ? stopLabels.left : stopLabels.right;
    const anchor = toeSeq[0]![dragSide]!;
    let dragM: number | null = null;
    let contactFrames = 0;
    for (let k = 1; k < toeSeq.length; k += 1) {
      if (labels[Math.min(k, labels.length - 1)] !== true) continue;
      contactFrames += 1;
      const d = vecDistXZ(toeSeq[k]![dragSide]!, anchor);
      dragM = dragM === null ? d : Math.max(dragM, d);
    }
    let maxStepM: number | null = null;
    for (let k = 1; k < toeSeq.length; k += 1) {
      for (const side of ["L", "R"] as const) {
        const d = vecDistXZ(toeSeq[k]![side]!, toeSeq[k - 1]![side]!);
        maxStepM = maxStepM === null ? d : Math.max(maxStepM, d);
      }
    }
    let maxRot = 0;
    let prev = preR;
    for (const pose of seq) {
      for (const i of bones) {
        const deg = (quatAngleBetween(prev[i]!, pose.r[i]!) * 180) / Math.PI;
        if (deg > maxRot) maxRot = deg;
      }
      prev = pose.r;
    }

    return {
      dragM,
      dragFoot: dragSide === "L" ? "toe1-1.L" : "toe1-1.R",
      contactFrames,
      maxStepM,
      maxRotDegPerFrame: maxRot,
    };
  };

  const A = grade(runA());
  const B = grade(runB());
  const C = grade(runC());

  const meta = {
    rig: rig.rig,
    walkClip: WALK_CLIP,
    stopClip: stopName,
    switchFrame60Hz: S,
    entryTimeS: rig.entryTimeS,
    walkPeriodS: walk.durationS,
    windowFrames: WINDOW_FRAMES,
    halflifeS: HALFLIFE_S,
    unlockRadiusM: UNLOCK_RADIUS_M,
    walkForward: walkFwd,
    stopForward: stopFwd,
    stopLabelContactFrames16: {
      left: stopLabels.left.slice(0, WINDOW_FRAMES).filter(Boolean).length,
      right: stopLabels.right.slice(0, WINDOW_FRAMES).filter(Boolean).length,
    },
  };
  process.stdout.write(
    `${rig.rig}: A drag=${fmt(A.dragM)} step=${fmt(A.maxStepM)} rot=${A.maxRotDegPerFrame.toFixed(2)}`
    + ` | B drag=${fmt(B.dragM)} step=${fmt(B.maxStepM)} rot=${B.maxRotDegPerFrame.toFixed(2)}`
    + ` | C drag=${fmt(C.dragM)} step=${fmt(C.maxStepM)} rot=${C.maxRotDegPerFrame.toFixed(2)} foot=${C.dragFoot} cf=${C.contactFrames}\n`,
  );
  return { A, B, C, meta };
}

function fmt(v: number | null): string {
  return v === null ? "null" : v.toFixed(4);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
  };
  const outPath = flagValue(
    "--out",
    ".openclinxr/evidence/inertialize/report.json",
  );
  const perRig: Record<string, Record<string, TreatmentMetrics>> = {};
  const metas: Record<string, Record<string, unknown>> = {};
  for (const rig of RIGS) {
    const { A, B, C, meta } = await runRig(rig);
    perRig[rig.rig] = { A, B, C };
    metas[rig.rig] = meta;
  }
  // Kill-test bars on the physician (one rig first): C drag < 0.05 AND maxStep <= 0.08.
  const physC = perRig["physician"]!["C"]!;
  const dragOk = physC.dragM !== null && physC.dragM < DRAG_BAR_M;
  const stepOk = physC.maxStepM !== null && physC.maxStepM <= MAX_TOE_STEP_FLAG_M;
  const failRatio = Math.max(
    physC.dragM === null ? Number.POSITIVE_INFINITY : physC.dragM / DRAG_BAR_M,
    physC.maxStepM === null ? Number.POSITIVE_INFINITY : physC.maxStepM / MAX_TOE_STEP_FLAG_M,
  );
  let verdict: "adopt" | "adopt_with_limits" | "reject" | "inconclusive";
  let verdictReason: string;
  if (dragOk && stepOk) {
    const othersOk = ["nurse", "child"].every((r) => {
      const c = perRig[r]!["C"]!;
      return c.dragM !== null && c.dragM < DRAG_BAR_M
        && c.maxStepM !== null && c.maxStepM <= MAX_TOE_STEP_FLAG_M;
    });
    verdict = othersOk ? "adopt" : "adopt_with_limits";
    verdictReason = othersOk
      ? "Treatment C clears both bars on all three rigs."
      : "Treatment C clears both bars on the physician; nurse/child do not both clear — adopt bounded to the passing rig(s).";
  } else if (!Number.isFinite(failRatio)) {
    verdict = "inconclusive";
    verdictReason = "Treatment C produced no measurable contact window on the physician; no verdict possible.";
  } else {
    verdict = "reject";
    verdictReason = `Treatment C fails the physician bars (drag ${fmt(physC.dragM)} vs <${DRAG_BAR_M}, step ${fmt(physC.maxStepM)} vs <=${MAX_TOE_STEP_FLAG_M}, worst ratio ${failRatio.toFixed(2)}x) — kill test negative, approach closed.`;
  }
  const report = {
    schemaVersion: "openclinxr.inertialize-cagematch.v1",
    measuredAt: new Date().toISOString(),
    commit: "wt/inertialize",
    bars: {
      dragM: `<${DRAG_BAR_M}`,
      maxStepM: `<=${MAX_TOE_STEP_FLAG_M}`,
      note: "bars apply to treatment C on the physician; nurse/child run once regardless",
    },
    definitions: {
      dragM: "max XZ travel of the switch-contact toe from its switch-frame anchor, over window frames where the stop take labels it in contact",
      maxStepM: "max single-frame XZ toe displacement, either foot, over the 16-frame window",
      maxRotDegPerFrame: "max over animated bones and window frames of local-rotation angle vs the previous frame (frame -1 is the walk source continuation)",
      window: "16 frames at 60 Hz from the assay stopEntryTimeS switch frame",
    },
    rigs: Object.fromEntries(
      RIGS.map((r) => [r.rig, { treatments: perRig[r.rig], meta: metas[r.rig] }]),
    ),
    verdict,
    verdictReason,
    physicianFailRatioVsBars: Number.isFinite(failRatio) ? failRatio : null,
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`verdict=${verdict} ratio=${Number.isFinite(failRatio) ? failRatio.toFixed(2) : "n/a"}\n${outPath}\n`);
}

await main();
