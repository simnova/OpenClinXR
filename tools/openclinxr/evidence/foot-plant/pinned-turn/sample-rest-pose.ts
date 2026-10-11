/**
 * Pinned-turn step 1a: sample the physician's arrived standing pose (walk-clip
 * rest frame, clip time 0 — the pose the runtime snaps markers to on settling
 * entry, verified to ~1 mm in world space by arrival-probe.ts) as MPFB world
 * positions for the transition-table inverse.
 *
 * FK/sampling machinery is a local copy of sample-walk-phases.ts (D3/D4
 * isolated harness: no renderer, no runtime or package-src import).
 * Output: .openclinxr/evidence/pinned-turn/rest-pose-<rig>.json
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/pinned-turn/sample-rest-pose.ts [--rig physician]
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Node as GltfNode } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

const WALK_CLIP = "openclinxr_retarget_walk_source";
const RIG_GLBS: Record<string, string> = {
  physician: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
  nurse: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
  child: "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb",
};

/** Canonical MHX name -> MPFB bone (inverse of mpfb2-default-no-toes.json, primaries only). */
const CANON_TO_MPFB: Record<string, string> = {
  "hips": "root",
  "spine": "spine05",
  "spine-1": "spine04",
  "chest": "spine03",
  "neck": "neck01",
  "head": "head",
  "shoulder.L": "clavicle.L",
  "upper_arm.L": "upperarm01.L",
  "forearm.L": "lowerarm01.L",
  "hand.L": "wrist.L",
  "thigh.L": "upperleg01.L",
  "shin.L": "lowerleg01.L",
  "foot.L": "foot.L",
  "toe.L": "toe1-1.L",
  "shoulder.R": "clavicle.R",
  "upper_arm.R": "upperarm01.R",
  "forearm.R": "lowerarm01.R",
  "hand.R": "wrist.R",
  "thigh.R": "upperleg01.R",
  "shin.R": "lowerleg01.R",
  "foot.R": "foot.R",
  "toe.R": "toe1-1.R",
};

type Channel = {
  path: "translation" | "rotation" | "scale";
  times: Float32Array;
  values: Float32Array;
  stride: number;
  interpolation: string;
};
type Clip = { name: string; durationS: number; perNode: Channel[][] };
type RigModel = {
  nodeNames: string[];
  parents: number[];
  order: number[];
  bindT: Vec3[];
  bindR: Quat[];
  clips: Map<string, Clip>;
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
  const th = Math.acos(dot); const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s; const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}
function sampleCh(ch: Channel, t: number): number[] {
  const { times, values, stride } = ch; const n = times.length;
  const at = (i: number): number[] => Array.from(values.subarray(i * stride, i * stride + stride));
  if (n === 0) throw new Error("no keyframes");
  if (t <= times[0]) return at(0);
  if (t >= times[n - 1]) return at(n - 1);
  let hi = 1; while (hi < n && times[hi] < t) hi += 1;
  const lo = hi - 1;
  if (ch.interpolation === "STEP") return at(lo);
  const span = times[hi] - times[lo]; const f = span === 0 ? 0 : (t - times[lo]) / span;
  const a = at(lo); const b = at(hi);
  if (ch.path === "rotation") return slerp(a as Quat, b as Quat, f);
  return a.map((v, i) => v + (b[i] - v) * f);
}
async function loadModel(glbPath: string): Promise<RigModel> {
  const document = await new NodeIO().read(glbPath);
  const root = document.getRoot(); const nodes = root.listNodes();
  const idx = new Map<GltfNode, number>(nodes.map((nd, i) => [nd, i]));
  const parents = nodes.map(() => -1);
  for (const [i, nd] of nodes.entries()) for (const c of nd.listChildren()) parents[must(idx.get(c), `parent of ${c.getName()}`)] = i;
  const order: number[] = []; const seen = new Set<number>();
  const visit = (i: number): void => {
    if (seen.has(i)) return; seen.add(i); order.push(i);
    for (const [j, p] of parents.entries()) if (p === i) visit(j);
  };
  nodes.forEach((_, i) => { if (parents[i] === -1) visit(i); });
  nodes.forEach((_, i) => { if (!seen.has(i)) visit(i); });
  const bindT = nodes.map((nd) => [...(nd.getTranslation() as unknown as Vec3)] as Vec3);
  const bindR = nodes.map((nd) => qn([...(nd.getRotation() as unknown as Quat)] as Quat));
  const clips = new Map<string, Clip>();
  for (const anim of root.listAnimations()) {
    const perNode: Channel[][] = nodes.map(() => []);
    let durationS = 0;
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode(); const sampler = ch.getSampler(); const chPath = ch.getTargetPath();
      if (!node || !sampler || !chPath) continue;
      if (chPath !== "translation" && chPath !== "rotation" && chPath !== "scale") continue;
      if (sampler.getInterpolation() === "CUBICSPLINE") throw new Error("CUBICSPLINE refused");
      const times = sampler.getInput()?.getArray(); const values = sampler.getOutput()?.getArray();
      if (!times || !values) continue;
      durationS = Math.max(durationS, times[times.length - 1] ?? 0);
      must(perNode[must(idx.get(node), `channel node ${node.getName()}`)], "perNode entry").push({
        path: chPath, times: Float32Array.from(times), values: Float32Array.from(values),
        stride: chPath === "rotation" ? 4 : 3, interpolation: sampler.getInterpolation(),
      });
    }
    clips.set(anim.getName(), { name: anim.getName(), durationS, perNode });
  }
  return { nodeNames: nodes.map((nd) => nd.getName()), parents, order, bindT, bindR, clips };
}
function samplePose(m: RigModel, c: Clip, t: number, outT: Vec3[], outR: Quat[]): void {
  const w = Math.min(Math.max(t, 0), c.durationS);
  for (const i of m.order) {
    let tr = m.bindT[i]; let ro = m.bindR[i];
    for (const ch of c.perNode[i]) {
      const v = sampleCh(ch, w);
      if (ch.path === "translation") tr = v as Vec3; else if (ch.path === "rotation") ro = qn(v as Quat);
    }
    outT[i] = tr; outR[i] = ro;
  }
}
function fk(m: RigModel, lt: Vec3[], lr: Quat[]): { pos: Vec3[] } {
  const mats = new Map<number, Float64Array>();
  for (const i of m.order) {
    const [x, y, z, w] = lr[i]; const [tx, ty, tz] = lt[i];
    const loc = new Float64Array([
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), tx,
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), ty,
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), tz,
      0, 0, 0, 1]);
    const p = m.parents[i];
    let world = loc;
    if (p !== -1) {
      const a = must(mats.get(p), `parent matrix ${p}`); world = new Float64Array(16);
      for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1)
        world[r * 4 + c] = a[r * 4] * loc[c] + a[r * 4 + 1] * loc[4 + c] + a[r * 4 + 2] * loc[8 + c] + a[r * 4 + 3] * loc[12 + c];
    }
    mats.set(i, world);
  }
  return { pos: m.nodeNames.map((_, i) => { const mm = must(mats.get(i), `matrix ${i}`); return [mm[3], mm[7], mm[11]] as Vec3; }) };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
  };
  const rig = flagValue("--rig", "physician");
  const glb = RIG_GLBS[rig];
  if (!glb) throw new Error(`unknown rig ${rig}`);
  const outPath = flagValue("--out", `.openclinxr/evidence/pinned-turn/rest-pose-${rig}.json`);
  const model = await loadModel(glb);
  const walk = model.clips.get(WALK_CLIP);
  if (!walk) throw new Error(`no ${WALK_CLIP}`);
  const n = model.nodeNames.length;
  const idxOf = (nm: string): number => {
    const i = model.nodeNames.indexOf(nm);
    if (i === -1) throw new Error(`missing node ${nm}`);
    return i;
  };
  const canonIdx: Record<string, number> = {};
  for (const [c, b] of Object.entries(CANON_TO_MPFB)) canonIdx[c] = idxOf(b);
  const allocT = (): Vec3[] => Array.from({ length: n }, () => [0, 0, 0] as Vec3);
  const allocR = (): Quat[] => Array.from({ length: n }, () => [0, 0, 0, 1] as Quat);
  // Rest frame: walk clip at t=0 clamped (what action.reset() settles on).
  const t = allocT(); const r = allocR();
  samplePose(model, walk, 0, t, r);
  const posePos = fk(model, t, r).pos;
  const bindPos = fk(model, model.bindT, model.bindR).pos;
  const bones: Record<string, Vec3> = {};
  const rest: Record<string, Vec3> = {};
  for (const [c, i] of Object.entries(canonIdx)) {
    bones[c] = [...posePos[i]] as Vec3;
    rest[c] = [...bindPos[i]] as Vec3;
  }
  const report = {
    schemaVersion: "openclinxr.pinned-turn-rest-pose.v1",
    rig,
    glb,
    walkClip: WALK_CLIP,
    clipTimeS: 0,
    note: "walk-clip rest frame (action.reset pose); the runtime snaps settling-entry markers to this frame's toes",
    bones,
    rest,
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const toeL = bones["toe.L"];
  const toeR = bones["toe.R"];
  process.stdout.write(`rest toes L=(${toeL?.map((v) => v.toFixed(5)).join(",")}) R=(${toeR?.map((v) => v.toFixed(5)).join(",")})\n${outPath}\n`);
}
await main();
