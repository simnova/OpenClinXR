/**
 * Transition-table step 1a: sample K=8 walk phases from the shipped walk loop.
 *
 * FK/sampling/label machinery follows tools/openclinxr/evidence/foot-plant/inertialize/cagematch.ts
 * (local copy, D3/D4 isolated harness: no runtime or package-src import).
 * Output: .openclinxr/evidence/transition-table/phases.json — per phase the clip time,
 * the contact foot at the switch (from the walk loop's own cyclic stance labels), and the
 * MPFB world positions (glTF scene space) of every mapped bone + bind-pose rest.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Node as GltfNode } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

const DT = 1 / 60;
const K = 8;
const WALK_CLIP = "openclinxr_retarget_walk_source";
const PHYSICIAN_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";

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
/** Map.get that throws instead of asserting non-null (biome forbids `!`). */
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
function samplePose(m: RigModel, c: Clip, t: number, cyclic: boolean, outT: Vec3[], outR: Quat[]): void {
  const w = cyclic && c.durationS > 0 ? ((t % c.durationS) + c.durationS) % c.durationS : Math.min(Math.max(t, 0), c.durationS);
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
function computeLabels(input: { forward: Vec3; left: Vec3[]; right: Vec3[]; cyclic: boolean }): { left: boolean[]; right: boolean[] } {
  const fwd: Vec3 = [input.forward[0], 0, input.forward[2]];
  const l = Math.hypot(fwd[0], fwd[2]) || 1; fwd[0] /= l; fwd[2] /= l;
  const along = (track: Vec3[], i: number): number => {
    const n = track.length;
    const p = track[(i - 1 + n) % n]; const q = track[(i + 1) % n];
    return ((q[0] - p[0]) * fwd[0] + (q[2] - p[2]) * fwd[2]) / (2 * DT);
  };
  const back: number[] = [];
  for (let i = 0; i < input.left.length; i += 1) {
    const al = along(input.left, i); const ar = along(input.right, i);
    if (al < 0) back.push(-al); if (ar < 0) back.push(-ar);
  }
  const s = [...back].sort((a, b) => a - b);
  const med = s.length > 0 ? s[Math.floor(s.length / 2)] ?? 0 : 0;
  const devs = s.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = devs.length > 0 ? devs[Math.floor(devs.length / 2)] ?? 0 : 0;
  const upper = med + Math.max(2 * mad, 0.1 * med);
  const hs: number[] = [];
  for (const p of input.left) hs.push(p[1]);
  for (const p of input.right) hs.push(p[1]);
  const cut = Math.min(...hs) + 0.5 * (Math.max(...hs) - Math.min(...hs)) + 0.005;
  const lab = (track: Vec3[]): boolean[] => track.map((p, i) => { const b = -along(track, i); return b >= 0 && b <= upper && p[1] <= cut; });
  return { left: lab(input.left), right: lab(input.right) };
}
function forwardFromTracks(left: Vec3[], right: Vec3[]): Vec3 {
  let best: Vec3 = [0, 0, 1]; let bt = 0;
  for (const track of [left, right]) {
    const hs = track.map((p) => p[1]);
    const cut = Math.min(...hs) + 0.5 * (Math.max(...hs) - Math.min(...hs));
    let start = -1; let run = { s: -1, e: -1, len: 0 };
    for (let i = 0; i <= track.length; i += 1) {
      const low = i < track.length && (hs[i] ?? Infinity) <= cut;
      if (low) { if (start === -1) start = i; }
      else if (start !== -1) { if (i - start > run.len) run = { s: start, e: i - 1, len: i - start }; start = -1; }
    }
    if (run.len < 2) continue;
    const f = track[run.s]; const q = track[run.e];
    const dx = f[0] - q[0]; const dz = f[2] - q[2]; const tv = Math.hypot(dx, dz);
    if (tv > bt) { bt = tv; best = [dx / (tv || 1), 0, dz / (tv || 1)]; }
  }
  return best;
}

async function main(): Promise<void> {
  const outPath = process.argv[2] ?? ".openclinxr/evidence/transition-table/phases.json";
  const model = await loadModel(PHYSICIAN_GLB);
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
  const toeL = idxOf("toe1-1.L"); const toeR = idxOf("toe1-1.R"); const rootIdx = idxOf("root");

  const allocT = (): Vec3[] => Array.from({ length: n }, () => [0, 0, 0] as Vec3);
  const allocR = (): Quat[] => Array.from({ length: n }, () => [0, 0, 0, 1] as Quat);
  // 60 Hz resample of the whole loop (travel-removed toes for labels).
  const frames = Math.max(2, Math.floor(walk.durationS / DT));
  const allT: Vec3[][] = []; const allR: Quat[][] = [];
  { const t = allocT(); const r = allocR();
    for (let f = 0; f <= frames; f += 1) {
      samplePose(model, walk, f * DT, true, t, r);
      allT.push(t.map((v) => [...v] as Vec3)); allR.push(r.map((v) => [...v] as Quat));
    } }
  const fkAt = (f: number): Vec3[] => fk(model, allT[f], allR[f]).pos;
  const toesL: Vec3[] = []; const toesR: Vec3[] = []; const roots: Vec3[] = [];
  for (let f = 0; f < allT.length; f += 1) {
    const p = fkAt(f); toesL.push(p[toeL]); toesR.push(p[toeR]); roots.push(p[rootIdx]);
  }
  const bx = roots[0][0]; const bz = roots[0][2];
  const rm = (t: Vec3[], f: number): Vec3 => { const p = t[f]; const r = roots[f]; return [p[0] - (r[0] - bx), p[1], p[2] - (r[2] - bz)]; };
  const fwd = forwardFromTracks(toesL.map((_, f) => rm(toesL, f)), toesR.map((_, f) => rm(toesR, f)));
  const labels = computeLabels({ forward: fwd, left: toesL.map((_, f) => rm(toesL, f)), right: toesR.map((_, f) => rm(toesR, f)), cyclic: true });

  // Bind-pose rest world positions.
  const restPos = fk(model, model.bindT, model.bindR).pos;
  const rest: Record<string, Vec3> = {};
  for (const [c, i] of Object.entries(canonIdx)) rest[c] = [...restPos[i]] as Vec3;

  const phases = [];
  for (let p = 0; p < K; p += 1) {
    const t = (p * walk.durationS) / K;
    const f = Math.round(t / DT) % allT.length;
    const pos = fkAt(f);
    const bones: Record<string, Vec3> = {};
    for (const [c, i] of Object.entries(canonIdx)) bones[c] = [...pos[i]] as Vec3;
    const l = labels.left[f] === true; const r = labels.right[f] === true;
    let contact: string;
    if (l !== r) contact = l ? "L" : "R";
    else { const pl = pos[toeL]; const pr = pos[toeR]; contact = pl[1] <= pr[1] ? "L" : "R"; }
    phases.push({ phase: p, clipTimeS: t, frame60Hz: f, contactFoot: contact, labelL: l, labelR: r, bones });
  }
  const report = {
    schemaVersion: "openclinxr.transition-table-phases.v1",
    rig: "physician",
    glb: PHYSICIAN_GLB,
    walkClip: WALK_CLIP,
    walkDurationS: walk.durationS,
    walkForward: fwd,
    frames60Hz: allT.length,
    rest,
    phases,
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  for (const p of phases) process.stdout.write(`phase ${p.phase}: t=${p.clipTimeS.toFixed(4)}s f=${p.frame60Hz} contact=${p.contactFoot} labels L=${p.labelL} R=${p.labelR}\n`);
  process.stdout.write(`${outPath}\n`);
}
await main();
