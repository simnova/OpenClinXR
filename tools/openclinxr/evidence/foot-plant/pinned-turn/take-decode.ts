/**
 * Pinned-turn take decoder: body-frame toe/root tracks + root-rotation yaw of a
 * bound take clip, resampled to 60 Hz by clip time.
 *
 * Convention: the bind writes MPFB body-frame local tracks (the same keys the
 * runtime reads off a bound clip). Facing = root rotation yaw; the harness
 * cross-checks the net yaw against measure-bound-turn.ts's hip-vector number.
 */

import type { Node as GltfNode } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type TakeSample = {
  t: number;
  toeL: Vec3;
  toeR: Vec3;
  root: Vec3;
  yaw: number;
  /** Pelvis yaw from the hip vector (upperleg01.R - upperleg01.L), full-FK. */
  hipYaw: number;
};

function qn(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`missing ${what}`);
  return v;
}
function slerp(a: Quat, b: Quat, t: number): Quat {
  let bx = b[0]; let by = b[1]; let bz = b[2]; let bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (dot > 0.9995) {
    const o: Quat = [a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t];
    return qn(o);
  }
  const th = Math.acos(Math.min(1, Math.max(-1, dot)));
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}
/** Yaw (three.js rotation.y convention) of a unit quaternion. */
function yawOf(q: Quat): number {
  const [x, y, z, w] = qn(q);
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x));
}

type Track = { times: Float32Array; values: Float32Array; stride: number; interp: string };

export async function decodeTakeClip(
  glbPath: string,
  clipName: string,
): Promise<{ durationS: number; keyCount: number; samples: TakeSample[] }> {
  const document = await new NodeIO().read(glbPath);
  const root = document.getRoot();
  const nodes = root.listNodes();
  const idx = new Map<GltfNode, number>(nodes.map((nd, i) => [nd, i]));
  const anim = root.listAnimations().find((a) => a.getName() === clipName);
  if (!anim) throw new Error(`no clip ${clipName} in ${glbPath}`);
  const tracks = new Map<string, Track>();
  let durationS = 0;
  let keyCount = 0;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const sampler = ch.getSampler();
    const p = ch.getTargetPath();
    if (!node || !sampler || (p !== "translation" && p !== "rotation")) continue;
    const times = sampler.getInput()?.getArray();
    const values = sampler.getOutput()?.getArray();
    if (!times || !values) continue;
    durationS = Math.max(durationS, times[times.length - 1] ?? 0);
    keyCount = Math.max(keyCount, times.length);
    tracks.set(`${node.getName()}.${p}`, {
      times: Float32Array.from(times),
      values: Float32Array.from(values),
      stride: p === "rotation" ? 4 : 3,
      interp: sampler.getInterpolation(),
    });
  }
  const get = (key: string): Track => must(tracks.get(key), `track ${key}`);
  const tToeL = get("toe1-1.L.translation");
  const tToeR = get("toe1-1.R.translation");
  const tRoot = get("root.translation");
  const tRootR = get("root.rotation");
  // Full-pose FK scaffold for the hip-vector yaw (sibling pattern: local copy).
  const nodeNames = nodes.map((nd) => nd.getName());
  const parents = nodes.map(() => -1);
  for (const [i, nd] of nodes.entries()) {
    for (const c of nd.listChildren()) parents[must(idx.get(c), "child")] = i;
  }
  const order: number[] = [];
  const seen = new Set<number>();
  const visit = (i: number): void => {
    if (seen.has(i)) return;
    seen.add(i);
    order.push(i);
    for (const [j, p] of parents.entries()) if (p === i) visit(j);
  };
  nodes.forEach((_, i) => { if (parents[i] === -1) visit(i); });
  const bindT = nodes.map((nd) => [...(nd.getTranslation() as unknown as Vec3)] as Vec3);
  const bindR = nodes.map((nd) => qn([...(nd.getRotation() as unknown as Quat)] as Quat));
  const iLL = nodeNames.indexOf("upperleg01.L");
  const iRL = nodeNames.indexOf("upperleg01.R");
  if (iLL === -1 || iRL === -1) throw new Error("thigh nodes missing");
  const poseAt = (t: number): { lt: Vec3[]; lr: Quat[] } => {
    const lt = bindT.map((v) => [...v] as Vec3);
    const lr = bindR.map((v) => [...v] as Quat);
    for (const [key, tr] of tracks) {
      const dot = key.lastIndexOf(".");
      const nm = key.slice(0, dot);
      const kind = key.slice(dot + 1);
      const ni = nodeNames.indexOf(nm);
      if (ni === -1) continue;
      if (kind !== "translation" && kind !== "rotation") continue;
      const { times, values } = tr;
      const n = times.length;
      const stride = kind === "rotation" ? 4 : 3;
      const at = (k: number): number[] => Array.from(values.subarray(k * stride, k * stride + stride));
      let v: number[];
      if (t <= must(times[0], "t0")) v = at(0);
      else if (t >= must(times[n - 1], "tN")) v = at(n - 1);
      else {
        let hi = 1;
        while (hi < n && must(times[hi], "th") < t) hi += 1;
        const lo = hi - 1;
        if (tr.interp === "STEP") v = at(lo);
        else {
          const span = must(times[hi], "a") - must(times[lo], "b");
          const f = span === 0 ? 0 : (t - must(times[lo], "c")) / span;
          const a = at(lo);
          const b = at(hi);
          v = kind === "rotation" ? slerp(a as Quat, b as Quat, f) : a.map((x, k) => x + (must(b[k], "bv") - x) * f);
        }
      }
      if (kind === "translation") lt[ni] = v as Vec3;
      else lr[ni] = qn(v as Quat);
    }
    return { lt, lr };
  };
  const fk = (lt: Vec3[], lr: Quat[]): Vec3[] => {
    const mats = new Map<number, Float64Array>();
    for (const i of order) {
      const [x, y, z, w] = must(lr[i], "lr");
      const [tx, ty, tz] = must(lt[i], "lt");
      const loc = new Float64Array([
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), tx,
        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), ty,
        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), tz,
        0, 0, 0, 1]);
      const p = must(parents[i], "par");
      let world = loc;
      if (p !== -1) {
        const a = must(mats.get(p), "pmat");
        world = new Float64Array(16);
        for (let r = 0; r < 4; r += 1) {
          for (let c = 0; c < 4; c += 1) {
            world[r * 4 + c] = must(a[r * 4], "m") * must(loc[c], "l")
              + must(a[r * 4 + 1], "m") * must(loc[4 + c], "l")
              + must(a[r * 4 + 2], "m") * must(loc[8 + c], "l")
              + must(a[r * 4 + 3], "m") * must(loc[12 + c], "l");
          }
        }
      }
      mats.set(i, world);
    }
    return order.map(() => [0, 0, 0] as Vec3).map((_, k) => {
      const mm = must(mats.get(k), "mmk");
      return [must(mm[3], "x"), must(mm[7], "y"), must(mm[11], "z")] as Vec3;
    });
  };
  const hipYawAt = (t: number): number => {
    const { lt, lr } = poseAt(t);
    const p = fk(lt, lr);
    const lL = must(p[iLL], "thighL");
    const lR = must(p[iRL], "thighR");
    return Math.atan2(must(lR[2], "z") - must(lL[2], "z"), -(must(lR[0], "x") - must(lL[0], "x")));
  };
  const sampleVec = (tr: Track, t: number): Vec3 => {
    const { times, values } = tr;
    const n = times.length;
    const at = (k: number): Vec3 => [
      must(values[k * 3], "v"), must(values[k * 3 + 1], "v"), must(values[k * 3 + 2], "v"),
    ];
    if (t <= must(times[0], "t0")) return at(0);
    if (t >= must(times[n - 1], "tN")) return at(n - 1);
    let hi = 1;
    while (hi < n && must(times[hi], "th") < t) hi += 1;
    const lo = hi - 1;
    const span = must(times[hi], "thi") - must(times[lo], "tlo");
    const f = span === 0 ? 0 : (t - must(times[lo], "tl")) / span;
    const a = at(lo);
    const b = at(hi);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
  const sampleQuat = (tr: Track, t: number): Quat => {
    const { times, values } = tr;
    const n = times.length;
    const at = (k: number): Quat => qn([
      must(values[k * 4], "q"), must(values[k * 4 + 1], "q"),
      must(values[k * 4 + 2], "q"), must(values[k * 4 + 3], "q"),
    ]);
    if (t <= must(times[0], "t0")) return at(0);
    if (t >= must(times[n - 1], "tN")) return at(n - 1);
    let hi = 1;
    while (hi < n && must(times[hi], "th") < t) hi += 1;
    const lo = hi - 1;
    const span = must(times[hi], "thi") - must(times[lo], "tlo");
    const f = span === 0 ? 0 : (t - must(times[lo], "tl")) / span;
    return slerp(at(lo), at(hi), f);
  };
  const dt = 1 / 60;
  const count = Math.max(2, Math.round(durationS / dt) + 1);
  const samples: TakeSample[] = [];
  for (let k = 0; k < count; k += 1) {
    const t = Math.min(durationS, k * dt);
    samples.push({
      t,
      toeL: sampleVec(tToeL, t),
      toeR: sampleVec(tToeR, t),
      root: sampleVec(tRoot, t),
      yaw: yawOf(sampleQuat(tRootR, t)),
      hipYaw: hipYawAt(t),
    });
  }
  return { durationS, keyCount, samples };
}
