/**
 * Pinned-turn sign gate: net pelvis-forward yaw change + root travel of a bound
 * take clip, decoded from the bound GLB (glTF Y-up world: ground = XZ,
 * yaw = atan2(fx, fz)).
 *
 * Decides the --negate-turn flag for the pass-2 regen: the approach-take
 * calibration says the bind rotation path is EXACTLY yaw-negating
 * (bound pelvis yaw = -source pelvis yaw), i.e. boundTurn ≈ -sourceTurn.
 * This probe VERIFIES rather than assumes.
 *
 * FK/sampling machinery is a local copy (D3/D4 isolated harness pattern).
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/pinned-turn/measure-bound-turn.ts \
 *   --glb <bound.glb> --clip <clip-name>
 */

import { NodeIO } from "@gltf-transform/core";
import type { Node as GltfNode } from "@gltf-transform/core";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

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
  const th = Math.acos(dot); const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s; const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

function wrapPi(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string => {
    const i = args.indexOf(name);
    if (i === -1 || args[i + 1] === undefined) throw new Error(`missing ${name}`);
    return args[i + 1] as string;
  };
  const glbPath = flag("--glb");
  const clipName = flag("--clip");
  const document = await new NodeIO().read(glbPath);
  const root = document.getRoot();
  const nodes = root.listNodes();
  const idx = new Map<GltfNode, number>(nodes.map((nd, i) => [nd, i]));
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
  const anim = root.listAnimations().find((a) => a.getName() === clipName);
  if (!anim) throw new Error(`no clip ${clipName}`);
  type Ch = { node: number; path: string; times: Float32Array; values: Float32Array; stride: number; interp: string };
  const channels: Ch[] = [];
  let duration = 0;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const sampler = ch.getSampler();
    const p = ch.getTargetPath();
    if (!node || !sampler || (p !== "translation" && p !== "rotation")) continue;
    const times = sampler.getInput()?.getArray();
    const values = sampler.getOutput()?.getArray();
    if (!times || !values) continue;
    duration = Math.max(duration, times[times.length - 1] ?? 0);
    channels.push({
      node: must(idx.get(node), "chnode"),
      path: p,
      times: Float32Array.from(times),
      values: Float32Array.from(values),
      stride: p === "rotation" ? 4 : 3,
      interp: sampler.getInterpolation(),
    });
  }
  const bindT = nodes.map((nd) => [...(nd.getTranslation() as unknown as Vec3)] as Vec3);
  const bindR = nodes.map((nd) => qn([...(nd.getRotation() as unknown as Quat)] as Quat));
  const sample = (t: number): Vec3[] => {
    const lt = bindT.map((v) => [...v] as Vec3);
    const lr = bindR.map((v) => [...v] as Quat);
    for (const ch of channels) {
      const { times, values, stride } = ch;
      const n = times.length;
      const at = (k: number): number[] => Array.from(values.subarray(k * stride, k * stride + stride));
      let v: number[];
      const t0 = must(times[0], "first key time");
      const tN = must(times[n - 1], "last key time");
      if (t <= t0) v = at(0);
      else if (t >= tN) v = at(n - 1);
      else {
        let hi = 1;
        while (hi < n && must(times[hi], "key time") < t) hi += 1;
        const lo = hi - 1;
        if (ch.interp === "STEP") v = at(lo);
        else {
          const tHi = must(times[hi], "hi key time");
          const tLo = must(times[lo], "lo key time");
          const span = tHi - tLo;
          const f = span === 0 ? 0 : (t - tLo) / span;
          const a = at(lo);
          const bb = at(hi);
          v = ch.path === "rotation"
            ? slerp(a as Quat, bb as Quat, f)
            : a.map((x, k) => x + (must(bb[k], "key value") - x) * f);
        }
      }
      if (ch.path === "translation") lt[ch.node] = v as Vec3;
      else lr[ch.node] = qn(v as Quat);
    }
    const mats = new Map<number, Float64Array>();
    for (const i of order) {
      const [x, y, z, w] = lr[i];
      const [tx, ty, tz] = lt[i];
      const loc = new Float64Array([
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), tx,
        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), ty,
        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), tz,
        0, 0, 0, 1]);
      const p = parents[i];
      let world = loc;
      if (p !== -1) {
        const a = must(mats.get(p), "pmat");
        world = new Float64Array(16);
        for (let r = 0; r < 4; r += 1) {
          for (let c = 0; c < 4; c += 1) {
            world[r * 4 + c] = must(a[r * 4], "mat") * must(loc[c], "loc")
              + must(a[r * 4 + 1], "mat") * must(loc[4 + c], "loc")
              + must(a[r * 4 + 2], "mat") * must(loc[8 + c], "loc")
              + must(a[r * 4 + 3], "mat") * must(loc[12 + c], "loc");
          }
        }
      }
      mats.set(i, world);
    }
    return nodes.map((_, i) => {
      const mm = must(mats.get(i), "mat");
      return [must(mm[3], "m"), must(mm[7], "m"), must(mm[11], "m")] as Vec3;
    });
  };
  const nameIdx = (nm: string): number => {
    const i = nodes.findIndex((nd) => nd.getName() === nm);
    if (i === -1) throw new Error(`missing node ${nm}`);
    return i;
  };
  const iLL = nameIdx("upperleg01.L");
  const iRL = nameIdx("upperleg01.R");
  const iRoot = nodes.findIndex((nd) => nd.getName() === "root");
  const yawAt = (t: number): number => {
    const p = sample(t);
    const lL = must(p[iLL], "left thigh");
    const lR = must(p[iRL], "right thigh");
    const latX = must(lR[0], "x") - must(lL[0], "x");
    const latZ = must(lR[2], "z") - must(lL[2], "z");
    return Math.atan2(latZ, -latX);
  };
  const y0 = yawAt(0);
  let total = 0;
  let prev = y0;
  const steps = 60;
  for (let k = 1; k <= steps; k += 1) {
    const y = yawAt((duration * k) / steps);
    total += wrapPi(y - prev);
    prev = y;
  }
  const p0 = must(sample(0)[iRoot === -1 ? 0 : iRoot], "root at 0");
  const p1 = must(sample(duration)[iRoot === -1 ? 0 : iRoot], "root at end");
  const rootTravel = iRoot === -1
    ? null
    : Math.hypot(must(p1[0], "x") - must(p0[0], "x"), must(p1[2], "z") - must(p0[2], "z"));
  process.stdout.write(
    JSON.stringify(
      { clip: clipName, durationS: duration, boundTurnDeg: (total * 180) / Math.PI, boundRootTravelM: rootTravel },
      null,
      2,
    ),
  );
  process.stdout.write("\n");
}

await main();
