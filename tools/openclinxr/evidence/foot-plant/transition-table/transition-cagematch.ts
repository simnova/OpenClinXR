/**
 * Transition-table cagematch: per walk-loop phase, switch to the phase's baked transition
 * clip with (A) a hard cut or (B) a 0.1 s inertialized entry.
 *
 * FK/sampling machinery follows tools/openclinxr/evidence/foot-plant/inertialize/cagematch.ts
 * (local copy, D3/D4 isolated: no renderer, no runtime or package-src import). Inertialization
 * math imports from ../inertialize/inertialize.js (side-effect-free port module).
 *
 * Deliberately NO root alignment between walk and transition clip: the hypothesis under test
 * IS that the transition clip's frame 0 matches the walk pose, so aligning would hide the
 * mismatch being measured.
 *
 * Per phase p (S = walk frame at phase p, clip = transition-phase<p>.glb frame 0):
 * - dragM: max XZ travel of the switch-contact toe (phases.json contactFoot) from its
 *   switch-frame anchor over the first 30 frames (0.5 s), world space, no label gating.
 * - maxStepM: max single-frame XZ toe displacement, either foot, over the 30 frames.
 * - maxRotDeg: max per-bone local-rotation angle from walk(S-1) to treatment output frame 0.
 * - frame0err: per-joint world-position error between clip frame 0 and walk(S): max + mean
 *   over the 22 mapped canonical bones (the step-1 round-trip metric).
 *
 * Bars (physician): worst-phase dragM < 0.05 AND maxStepM <= 0.08 for A or B.
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/transition-table/transition-cagematch.ts [--out <report.json>]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Node as GltfNode } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";
import {
  inertializeTransitionQuat,
  inertializeTransitionVec,
  inertializeUpdateQuat,
  inertializeUpdateVec,
  quatAngleBetween,
  quatInv,
  quatMul,
  quatNormalize,
  quatSlerp,
  quatToScaledAngleAxis,
  vecDistXZ,
  type Quat,
  type Vec3,
} from "../inertialize/inertialize.js";

const DT = 1 / 60;
const WINDOW = 30; // first 0.5 s after the switch
const HALFLIFE_S = 0.1;
const WALK_CLIP = "openclinxr_retarget_walk_source";
const DRAG_BAR_M = 0.05;
const STEP_BAR_M = 0.08;
const EVID = ".openclinxr/evidence/transition-table";

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
  if (ch.path === "rotation") return quatSlerp(a as Quat, b as Quat, f);
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
  const bindR = nodes.map((nd) => quatNormalize([...(nd.getRotation() as unknown as Quat)] as Quat));
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
      if (ch.path === "translation") tr = v as Vec3; else if (ch.path === "rotation") ro = quatNormalize(v as Quat);
    }
    outT[i] = tr; outR[i] = ro;
  }
}
function qFromM(m: Float64Array): Quat {
  const tr = m[0] + m[5] + m[10];
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return qn([(m[9] - m[6]) * s, (m[2] - m[8]) * s, (m[4] - m[1]) * s, 0.25 / s]);
  }
  if (m[0] > m[5] && m[0] > m[10]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[5] - m[10]);
    return qn([0.25 * s, (m[1] + m[4]) / s, (m[2] + m[8]) / s, (m[9] - m[6]) / s]);
  }
  if (m[5] > m[10]) {
    const s = 2 * Math.sqrt(1 + m[5] - m[0] - m[10]);
    return qn([(m[1] + m[4]) / s, 0.25 * s, (m[6] + m[9]) / s, (m[2] - m[8]) / s]);
  }
  const s = 2 * Math.sqrt(1 + m[10] - m[0] - m[5]);
  return qn([(m[2] + m[8]) / s, (m[6] + m[9]) / s, 0.25 * s, (m[4] - m[1]) / s]);
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
  void qFromM;
  return { pos: m.nodeNames.map((_, i) => { const mm = must(mats.get(i), `matrix ${i}`); return [mm[3], mm[7], mm[11]] as Vec3; }) };
}

const CANON_BONES = [
  "root", "spine05", "spine04", "spine03", "neck01", "head",
  "clavicle.L", "upperarm01.L", "lowerarm01.L", "wrist.L",
  "upperleg01.L", "lowerleg01.L", "foot.L", "toe1-1.L",
  "clavicle.R", "upperarm01.R", "lowerarm01.R", "wrist.R",
  "upperleg01.R", "lowerleg01.R", "foot.R", "toe1-1.R",
];

type TreatmentResult = { dragM: number; maxStepM: number; maxRotDeg: number };
type PhaseResult = {
  phase: number; clipTimeS: number; footInContact: string;
  frame0errMaxM: number; frame0errMeanM: number;
  naturalRotDeg: number; clipDurationS: number;
  A: TreatmentResult; B: TreatmentResult;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const oi = args.indexOf("--out");
  const outPath = oi >= 0 ? (args[oi + 1] ?? `${EVID}/report.json`) : `${EVID}/report.json`;
  const phasesDoc = JSON.parse(await readFile(`${EVID}/phases.json`, "utf8")) as {
    walkClip: string; walkDurationS: number;
    phases: Array<{ phase: number; clipTimeS: number; contactFoot: string }>;
  };
  const shipped = await loadModel("apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb");
  const walk = shipped.clips.get(WALK_CLIP);
  if (!walk) throw new Error(`no ${WALK_CLIP}`);
  const n = shipped.nodeNames.length;
  const idxOf = (nm: string): number => {
    const i = shipped.nodeNames.indexOf(nm);
    if (i === -1) throw new Error(`missing node ${nm}`);
    return i;
  };
  const canonIdx = CANON_BONES.map(idxOf);
  const toeL = idxOf("toe1-1.L"); const toeR = idxOf("toe1-1.R");
  const allocT = (): Vec3[] => Array.from({ length: n }, () => [0, 0, 0] as Vec3);
  const allocR = (): Quat[] => Array.from({ length: n }, () => [0, 0, 0, 1] as Quat);

  // Walk resample at 60 Hz (cyclic).
  const wFrames = Math.max(2, Math.floor(walk.durationS / DT));
  const walkT: Vec3[][] = []; const walkR: Quat[][] = [];
  { const t = allocT(); const r = allocR();
    for (let f = 0; f <= wFrames; f += 1) {
      samplePose(shipped, walk, f * DT, true, t, r);
      walkT.push(t.map((v) => [...v] as Vec3)); walkR.push(r.map((v) => [...v] as Quat));
    } }
  const fkAt = (t: Vec3[], r: Quat[]): Vec3[] => fk(shipped, t, r).pos;
  // Animated bone set (union of walk channels + any transition channels, by name).
  const animatedNames = new Set<string>();
  walk.perNode.forEach((chs, i) => { if (chs.length > 0) animatedNames.add(shipped.nodeNames[i]); });

  const posVel = (frames: Vec3[][], f: number, i: number): Vec3 => {
    const pa = frames[Math.max(0, f - 1)][i];
    const b = frames[Math.min(frames.length - 1, f)][i];
    const span = Math.min(f, frames.length - 1) - Math.max(0, f - 1) || 1;
    return [(b[0] - pa[0]) / (span * DT), (b[1] - pa[1]) / (span * DT), (b[2] - pa[2]) / (span * DT)];
  };
  const angVel = (frames: Quat[][], f: number, i: number): Vec3 => {
    const pa = frames[Math.max(0, f - 1)][i];
    const b = frames[Math.min(frames.length - 1, f)][i];
    const span = Math.min(f, frames.length - 1) - Math.max(0, f - 1) || 1;
    const d = quatToScaledAngleAxis(quatMul(b, quatInv(pa)));
    return [d[0] / (span * DT), d[1] / (span * DT), d[2] / (span * DT)];
  };

  const perPhase: PhaseResult[] = [];
  for (const ph of phasesDoc.phases) {
    const clipName = `openclinxr_transition_phase${ph.phase}`;
    const clipGlb = `${EVID}/constraints/phase${ph.phase}/transition-phase${ph.phase}.glb`;
    const tmodel = await loadModel(clipGlb);
    const tclip = [...tmodel.clips.values()].find((c) => c.name === clipName);
    if (!tclip) throw new Error(`phase ${ph.phase}: no ${clipName} in ${clipGlb}`);
    const sIdx = new Map(tmodel.nodeNames.map((nm, i) => [nm, i]));
    // Re-index transition pose into shipped order by node name.
    const cFrames = Math.max(2, Math.floor(tclip.durationS / DT));
    const clipT: Vec3[][] = []; const clipR: Quat[][] = [];
    { const t = allocT(); const r = allocR();
      const st = allocT(); const sr = allocR();
      for (let f = 0; f <= cFrames; f += 1) {
        samplePose(tmodel, tclip, f * DT, false, st, sr);
        for (let i = 0; i < n; i += 1) {
          const j = sIdx.get(shipped.nodeNames[i]) ?? -1;
          t[i] = j === -1 ? [...shipped.bindT[i]] as Vec3 : [...st[j]] as Vec3;
          r[i] = j === -1 ? [...shipped.bindR[i]] as Quat : [...sr[j]] as Quat;
        }
        clipT.push(t.map((v) => [...v] as Vec3)); clipR.push(r.map((v) => [...v] as Quat));
      } }
    tclip.perNode.forEach((chs, i) => { if (chs.length > 0) animatedNames.add(tmodel.nodeNames[i]); });
    const bones = [...animatedNames].map(idxOf).filter((v) => v !== -1);

    const S = Math.round(ph.clipTimeS / DT) % walkT.length;
    const toe = ph.contactFoot === "L" ? toeL : toeR;

    // Treatment A: hard cut, clip frames 0..29.
    const seqA_T = clipT.slice(0, WINDOW);
    const seqA_R = clipR.slice(0, WINDOW);

    // Treatment B: 0.1 s inertialized entry from the walk pose.
    const offX = new Map<number, Vec3>(); const offV = new Map<number, Vec3>();
    const offQ = new Map<number, Quat>(); const offW = new Map<number, Vec3>();
    for (const i of bones) {
      const ox: Vec3 = [0, 0, 0]; const ov: Vec3 = [0, 0, 0];
      const oq: Quat = [0, 0, 0, 1]; const ow: Vec3 = [0, 0, 0];
      inertializeTransitionVec(ox, ov, walkT[S][i], posVel(walkT, S, i), clipT[0][i], posVel(clipT, 0, i));
      inertializeTransitionQuat(oq, ow, walkR[S][i], angVel(walkR, S, i), clipR[0][i], angVel(clipR, 0, i));
      offX.set(i, ox); offV.set(i, ov); offQ.set(i, oq); offW.set(i, ow);
    }
    const seqB_T: Vec3[][] = []; const seqB_R: Quat[][] = [];
    for (let k = 0; k < WINDOW; k += 1) {
      const di = Math.min(k, clipT.length - 1);
      const t = allocT(); const r = allocR();
      for (let i = 0; i < n; i += 1) {
        if (!bones.includes(i)) { t[i] = [...clipT[di][i]] as Vec3; r[i] = [...clipR[di][i]] as Quat; continue; }
        const pu = inertializeUpdateVec(must(offX.get(i), "offX"), must(offV.get(i), "offV"), clipT[di][i], posVel(clipT, di, i), HALFLIFE_S, DT);
        const qu = inertializeUpdateQuat(must(offQ.get(i), "offQ"), must(offW.get(i), "offW"), clipR[di][i], angVel(clipR, di, i), HALFLIFE_S, DT);
        t[i] = pu.outX; r[i] = qu.outX;
      }
      seqB_T.push(t); seqB_R.push(r);
    }

    const grade = (sT: Vec3[][], sR: Quat[][]): { dragM: number; maxStepM: number; maxRotDeg: number } => {
      const toes = sT.map((t, k) => {
        const p = fkAt(t, sR[k]);
        return { L: p[toeL], R: p[toeR] };
      });
      const anchor = fkAt(walkT[S], walkR[S])[toe];
      let drag = 0;
      for (let k = 0; k < toes.length; k += 1) {
        const q = ph.contactFoot === "L" ? toes[k].L : toes[k].R;
        drag = Math.max(drag, vecDistXZ(q, anchor));
      }
      let step: number | null = null;
      const prevW = fkAt(walkT[(S - 1 + walkT.length) % walkT.length], walkR[(S - 1 + walkT.length) % walkT.length]);
      const first = toes[0];
      for (const side of ["L", "R"] as const) {
        const d = vecDistXZ(first[side], side === "L" ? prevW[toeL] : prevW[toeR]);
        step = step === null ? d : Math.max(step, d);
      }
      for (let k = 1; k < toes.length; k += 1) {
        for (const side of ["L", "R"] as const) {
          const d = vecDistXZ(toes[k][side], toes[k - 1][side]);
          step = step === null ? d : Math.max(step, d);
        }
      }
      let rot = 0;
      const preR = walkR[(S - 1 + walkT.length) % walkT.length];
      for (const i of bones) {
        const deg = (quatAngleBetween(preR[i], sR[0][i]) * 180) / Math.PI;
        if (deg > rot) rot = deg;
      }
      return { dragM: drag, maxStepM: step ?? 0, maxRotDeg: rot };
    };

    // Frame-0 round-trip error: clip(0) vs walk(S), world positions, mapped bones.
    const pw = fkAt(walkT[S], walkR[S]);
    const pc = fkAt(clipT[0], clipR[0]);
    let fmax = 0; let fsum = 0;
    for (const i of canonIdx) {
      const a = pw[i]; const b = pc[i];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d > fmax) fmax = d; fsum += d;
    }
    const gA = grade(seqA_T, seqA_R);
    const gB = grade(seqB_T, seqB_R);
    // Natural walk continuity reference: walk(S-1) -> walk(S).
    let natRot = 0;
    const wPrev = walkR[(S - 1 + walkT.length) % walkT.length];
    for (const i of bones) {
      const deg = (quatAngleBetween(wPrev[i], walkR[S][i]) * 180) / Math.PI;
      if (deg > natRot) natRot = deg;
    }
    perPhase.push({
      phase: ph.phase, clipTimeS: ph.clipTimeS, footInContact: ph.contactFoot,
      frame0errMaxM: fmax, frame0errMeanM: fsum / canonIdx.length,
      naturalRotDeg: natRot, clipDurationS: tclip.durationS,
      A: { dragM: gA.dragM, maxStepM: gA.maxStepM, maxRotDeg: gA.maxRotDeg },
      B: { dragM: gB.dragM, maxStepM: gB.maxStepM, maxRotDeg: gB.maxRotDeg },
    });
    const f2 = (v: number): string => v.toFixed(4);
    process.stdout.write(
      `phase ${ph.phase} foot=${ph.contactFoot} f0err=${f2(fmax)}/${f2(fsum / canonIdx.length)}`
      + ` | A drag=${f2(gA.dragM)} step=${f2(gA.maxStepM)} rot=${gA.maxRotDeg.toFixed(1)}`
      + ` | B drag=${f2(gB.dragM)} step=${f2(gB.maxStepM)} rot=${gB.maxRotDeg.toFixed(1)}\n`,
    );
  }

  let verdict: "adopt" | "adopt_with_limits" | "reject" | "inconclusive";
  let verdictReason: string;
  const worst = (get: (e: (typeof perPhase)[number]) => number): number => Math.max(...perPhase.map(get));
  const wDragA = worst((e) => e.A.dragM); const wStepA = worst((e) => e.A.maxStepM);
  const wDragB = worst((e) => e.B.dragM); const wStepB = worst((e) => e.B.maxStepM);
  const passA = wDragA < DRAG_BAR_M && wStepA <= STEP_BAR_M;
  const passB = wDragB < DRAG_BAR_M && wStepB <= STEP_BAR_M;
  const ratio = Math.max(wDragA / DRAG_BAR_M, wStepA / STEP_BAR_M, wDragB / DRAG_BAR_M, wStepB / STEP_BAR_M);
  const fmt = (v: number): string => v.toFixed(4);
  if (passA || passB) {
    verdict = "adopt_with_limits";
    verdictReason = `Worst-phase bars clear on treatment ${passA && passB ? "A+B" : passA ? "A" : "B"} for the physician (A drag ${fmt(wDragA)}/step ${fmt(wStepA)}, B drag ${fmt(wDragB)}/step ${fmt(wStepB)}); nurse repetition per the brief is still pending, so adoption is bounded to the physician.`;
  } else if (!Number.isFinite(ratio)) {
    verdict = "inconclusive";
    verdictReason = "No finite worst-phase ratio; no verdict possible.";
  } else {
    verdict = "reject";
    verdictReason = `Worst-phase bars fail on both treatments (A drag ${fmt(wDragA)} vs <${DRAG_BAR_M}, step ${fmt(wStepA)} vs <=${STEP_BAR_M}; B drag ${fmt(wDragB)}, step ${fmt(wStepB)}; worst ratio ${ratio.toFixed(2)}x) — kill test negative, approach closed on the decision rig.`;
  }
  const frame0: Record<string, number> = {};
  for (const e of perPhase) frame0[String(e.phase)] = e.frame0errMaxM;
  const report = {
    schemaVersion: "openclinxr.transition-table-cagematch.v1",
    measuredAt: new Date().toISOString(),
    rig: "physician",
    walkClip: WALK_CLIP,
    poseSource: "directed MPFB->SOMA inverse (correction 2026-10-11): MPFB FK at phase -> canonical via mpfb2-default-no-toes.json -> SOMA via kimodo-soma-skeleton30.json; limb dirs from MPFB pose with SOMA rest lengths, girdle links rest-directed; hip-height scale undone about the root (ratio 0.9447729); Hips orientation from MPFB pelvis basis; Chest Kabsch; EE frame-0 pin (Hips/feet/hands) + root2d path; no rotation solve beyond swing-derived locals required by the EE JSON shape",
    constraintForm: "end-effector frame-0 (Hips,LeftFoot,RightFoot,LeftHand,RightHand + chains) + full root2d path; planted foot pinned at frame 0 only (remaining-window pin unstatable without per-frame IK, stated in build script)",
    headPinned: false,
    bars: { dragM: `<${DRAG_BAR_M}`, maxStepM: `<=${STEP_BAR_M}`, note: "worst phase over K=8, treatment A or B, physician first" },
    definitions: {
      dragM: "max XZ travel of the switch-contact toe from its switch-frame anchor over the first 30 frames (0.5 s), world space, no label gating, no root alignment",
      maxStepM: "max single-frame XZ toe displacement, either foot, over switch frame + 30 frames",
      maxRotDeg: "max per-bone local-rotation angle from walk(S-1) to treatment output frame 0",
      frame0err: "per-joint world-position error between transition clip frame 0 and walk(S) over 22 mapped bones",
    },
    perPhase,
    worstPhase: { A: { dragM: wDragA, maxStepM: wStepA }, B: { dragM: wDragB, maxStepM: wStepB } },
    frame0PoseErrorM: frame0,
    verdict,
    verdictReason,
    physicianFailRatioVsBars: Number.isFinite(ratio) ? ratio : null,
    nurse: null,
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`verdict=${verdict} ratio=${Number.isFinite(ratio) ? ratio.toFixed(2) : "n/a"}\n${outPath}\n`);
}
await main();
