/**
 * Transition-table finger carry-through: stamp the walk clip's (static) finger local
 * rotations as constant tracks over a bound transition clip, post-bind, in place.
 *
 * Cause (measured 2026-10-11): the bind drives only root + swing_pairs; finger bones keep
 * whatever the exporter baked (MPFB rest), while the walk loop holds a static grasp
 * (0.000 deg/frame over the loop). The switch then snaps every fingertip 77-87 deg —
 * identical at all 8 phases. SOMA has no finger joints, so fingers cannot come through
 * the Kimodo inverse; the walk grasp carries through on the MPFB side instead.
 * neck01/head stay on the bind's deliberate REST_ONLY fallback (runtime-driven).
 *
 * Fail-closed: a missing finger node or rotation channel refuses rather than inventing
 * tracks (the Blender exporter writes TRS for every bone, so absence is a real defect).
 *
 * Usage: mise exec -- tsx tools/.../stamp-walk-fingers.ts --shipped <glb> --walk-clip <name>
 *   --bound <glb> --clip <name> --time <walk seconds>
 */

import { NodeIO } from "@gltf-transform/core";
import { quatNormalize, quatSlerp, type Quat } from "../inertialize/inertialize.js";

function flag(args: string[], name: string): string {
  const i = args.indexOf(name);
  if (i === -1 || args[i + 1] === undefined) throw new Error(`missing ${name}`);
  return args[i + 1];
}
function sampleRotation(times: Float32Array, values: Float32Array, t: number): Quat {
  const n = times.length;
  const at = (k: number): Quat => quatNormalize([values[k * 4], values[k * 4 + 1], values[k * 4 + 2], values[k * 4 + 3]]);
  if (t <= times[0]) return at(0);
  if (t >= times[n - 1]) return at(n - 1);
  let hi = 1;
  while (hi < n && times[hi] < t) hi += 1;
  const lo = hi - 1;
  const span = times[hi] - times[lo];
  return quatSlerp(at(lo), at(hi), span === 0 ? 0 : (t - times[lo]) / span);
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shippedPath = flag(args, "--shipped");
  const walkName = flag(args, "--walk-clip");
  const boundPath = flag(args, "--bound");
  const clipName = flag(args, "--clip");
  const timeS = Number(flag(args, "--time"));
  const io = new NodeIO();
  const shipped = await io.read(shippedPath);
  const sroot = shipped.getRoot();
  const walk = sroot.listAnimations().find((a) => a.getName() === walkName);
  if (!walk) throw new Error(`no ${walkName} in shipped`);
  const bound = await io.read(boundPath);
  const broot = bound.getRoot();
  const clip = broot.listAnimations().find((a) => a.getName() === clipName);
  if (!clip) throw new Error(`no ${clipName} in bound`);
  const boundNodes = new Map(broot.listNodes().map((nd) => [nd.getName(), nd]));
  // Clip duration = max sampler end time.
  let duration = 0;
  for (const ch of clip.listChannels()) {
    const arr = ch.getSampler()?.getInput()?.getArray();
    if (arr && arr.length > 0 && arr[arr.length - 1] > duration) duration = arr[arr.length - 1];
  }
  if (duration <= 0) throw new Error(`no duration for ${clipName}`);
  let stamped = 0;
  for (const snode of sroot.listNodes()) {
    const nm = snode.getName();
    if (!nm.startsWith("finger")) continue;
    const bnode = boundNodes.get(nm);
    if (!bnode) throw new Error(`REFUSE finger node ${nm} missing in bound GLB`);
    const wch = walk.listChannels().find((c) => c.getTargetNode() === snode && c.getTargetPath() === "rotation");
    if (!wch) throw new Error(`REFUSE no walk rotation channel on ${nm}`);
    const wtimes = wch.getSampler()?.getInput()?.getArray();
    const wvals = wch.getSampler()?.getOutput()?.getArray();
    if (!wtimes || !wvals) throw new Error(`REFUSE no walk sampler arrays on ${nm}`);
    const q = sampleRotation(Float32Array.from(wtimes), Float32Array.from(wvals), timeS);
    const bch = clip.listChannels().find((c) => c.getTargetNode() === bnode && c.getTargetPath() === "rotation");
    if (!bch) throw new Error(`REFUSE no bound rotation channel on ${nm}`);
    const sampler = bch.getSampler();
    if (!sampler) throw new Error(`REFUSE no sampler on ${nm}`);
    const inp = sampler.getInput();
    const out = sampler.getOutput();
    if (!inp || !out) throw new Error(`REFUSE no sampler accessors on ${nm}`);
    inp.setArray(new Float32Array([0, duration]));
    out.setArray(new Float32Array([...q, ...q]));
    sampler.setInterpolation("LINEAR");
    stamped += 1;
  }
  await io.write(boundPath, bound);
  process.stdout.write(`stamped ${stamped} finger bones on ${clipName} @walk t=${timeS}s\n`);
}
await main();
