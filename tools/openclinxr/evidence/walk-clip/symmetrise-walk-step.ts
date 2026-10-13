/**
 * Deterministic symmetrise step (slice 2, stage 3): build a symmetric walk loop from one
 * step of the Walk donor clip. No hand keyframes: cut L-plant to R-plant, mirror across
 * the sagittal plane with L/R bone swap, concatenate, close both joints with cosine ramps
 * (plus exact end-frame set), remove net root travel. Then optionally bind through the
 * existing station and re-gate.
 *
 * Mirroring runs in WORLD space (FK the sampled locals, mirror world transforms with the
 * swap, IK back to locals): mirroring local quaternions with a world-axis formula is
 * wrong in rotated parent frames. Bone axes verified from the source bytes (ball_l.x =
 * +0.089 vs ball_r.x = -0.089 at rest: lateral = X, L at +X); topology mirror-symmetry
 * and unit base scales are asserted, not assumed.
 *
 *   pnpm exec tsx tools/openclinxr/evidence/walk-clip/symmetrise-walk-step.ts \
 *     --source-glb /tmp/walkclip-census/source-Walk.glb --out /tmp/walkclip-census/source-Walk-symmetric.glb \
 *     --report /tmp/walkclip-census/symmetric-report.json [--bind]
 *
 * claimScope: one deterministic symmetric candidate + its gate verdicts.
 * notEvidenceFor: gait realism, runtime playback, Quest readiness.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Accessor, NodeIO } from "@gltf-transform/core";
import type { Node as GltfNode } from "@gltf-transform/core";
import { MESHMOTION_WALK_JOINTS, MPFB_WALK_JOINTS, runMotionRetarget } from "@openclinxr/factory-stations";
import { gateOneClip } from "./gate-one-clip.js";
import type { WalkGateReport } from "@openclinxr/factory-stations";
import { dropLeadingRestFrame } from "../../factory/graft-bound-clip.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const TARGET_MAP = path.join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json");
const SOURCE_MAP = path.join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mesh2motion-human-66.json");
const PHYSICIAN_GLB = path.join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb");

const K = 32;
const M = 8;
const NEW_CLIP = "Walk_Symmetric";

type V3 = [number, number, number];
type Q = [number, number, number, number];

function normQ(q: Q): Q {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

function slerpQ(a: Q, b: Q, t: number): Q {
  const ua = normQ(a);
  const ub = normQ(b);
  let dot = ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2] + ua[3] * ub[3];
  const sign = dot < 0 ? -1 : 1;
  dot = Math.min(1, Math.abs(dot));
  if (dot > 0.9995) return normQ([ua[0] + (sign * ub[0] - ua[0]) * t, ua[1] + (sign * ub[1] - ua[1]) * t, ua[2] + (sign * ub[2] - ua[2]) * t, ua[3] + (sign * ub[3] - ua[3]) * t]);
  const th = Math.acos(dot);
  const s = Math.sin(th);
  return normQ([
    ua[0] * (Math.sin((1 - t) * th) / s) + sign * ub[0] * (Math.sin(t * th) / s),
    ua[1] * (Math.sin((1 - t) * th) / s) + sign * ub[1] * (Math.sin(t * th) / s),
    ua[2] * (Math.sin((1 - t) * th) / s) + sign * ub[2] * (Math.sin(t * th) / s),
    ua[3] * (Math.sin((1 - t) * th) / s) + sign * ub[3] * (Math.sin(t * th) / s),
  ]);
}

function qmul(a: Q, b: Q): Q {
  return normQ([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]);
}

function qinv(q: Q): Q {
  return normQ([-q[0], -q[1], -q[2], q[3]]);
}

function qangle(a: Q, b: Q): number {
  const na = normQ(a);
  const nb = normQ(b);
  const dot = Math.min(1, Math.abs(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] + na[3] * nb[3]));
  return ((2 * Math.acos(dot)) * 180) / Math.PI;
}

function matFromQ(q: Q): number[] {
  const [x, y, z, w] = normQ(q);
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/** Mirror across the YZ (sagittal) plane in WORLD space: lateral = X, verified. */
function mirrorPos(p: V3): V3 {
  return [-p[0], p[1], p[2]];
}

function mirrorRot(q: Q): Q {
  return normQ([q[0], -q[1], -q[2], q[3]]);
}

function assertMirrorMath(): void {
  const id: Q = [0, 0, 0, 1];
  if (qangle(mirrorRot(id), id) > 1e-3) throw new Error("mirror identity failed");
  const px = mirrorPos([0.089, 1.081, 0.963]);
  if (Math.abs(px[0] + 0.089) > 1e-9 || Math.abs(px[1] - 1.081) > 1e-9) throw new Error("mirror lateral flip failed");
  const q: Q = normQ([0.3, -0.5, 0.7, 0.4]);
  if (qangle(mirrorRot(mirrorRot(q)), q) > 1e-3) throw new Error("double mirror is not identity");
  const p: V3 = [0.11, 0.87, -0.31];
  const pp = mirrorPos(mirrorPos(p));
  if (Math.hypot(pp[0] - p[0], pp[1] - p[1], pp[2] - p[2]) > 1e-9) throw new Error("double mirror-pos is not identity");
}

type Chan = { node: GltfNode; path: "translation" | "rotation" | "scale"; times: number[]; vals: number[][]; interp: string };

function readClip(doc: Awaited<ReturnType<NodeIO["read"]>>, clipName: string): Chan[] {
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === clipName);
  if (!anim) throw new Error(`no clip ${clipName}`);
  const channels: Chan[] = [];
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const sampler = ch.getSampler();
    const targetPath = ch.getTargetPath();
    if (!node || !sampler || (targetPath !== "translation" && targetPath !== "rotation" && targetPath !== "scale")) continue;
    if (sampler.getInterpolation() === "CUBICSPLINE") throw new Error(`CUBICSPLINE on ${node.getName()}, refused`);
    const times = sampler.getInput()?.getArray();
    const values = sampler.getOutput()?.getArray();
    if (!times || !values) continue;
    const stride = targetPath === "rotation" ? 4 : 3;
    const vals: number[][] = [];
    for (let k = 0; k < times.length; k += 1) vals.push(Array.from(values.subarray(k * stride, k * stride + stride)));
    channels.push({ node, path: targetPath, times: Array.from(times) as number[], vals, interp: sampler.getInterpolation() });
  }
  return channels;
}

function sampleChan(ch: Chan, t: number): number[] {
  const n = ch.times.length;
  if (t <= ch.times[0]!) return [...ch.vals[0]!];
  if (t >= ch.times[n - 1]!) return [...ch.vals[n - 1]!];
  let hi = 1;
  while (hi < n && ch.times[hi]! < t) hi += 1;
  const lo = hi - 1;
  if (ch.interp === "STEP") return [...ch.vals[lo]!];
  const f = (t - ch.times[lo]!) / (ch.times[hi]! - ch.times[lo]! || 1);
  if (ch.path === "rotation") return slerpQ(ch.vals[lo]! as Q, ch.vals[hi]! as Q, f);
  return (ch.vals[lo]!).map((v, k) => v + (ch.vals[hi]![k]! - v) * f);
}

function mirrorSwapName(name: string): string {
  if (name.endsWith("_l")) return `${name.slice(0, -2)}_r`;
  if (name.endsWith("_r")) return `${name.slice(0, -2)}_l`;
  return name;
}

/**
 * Deterministic loop-seam close for any GLB clip (used post-bind: the retarget perturbs
 * the source loop's closure). Cosine ramp over the last SM frames toward frame 0 plus an
 * exact end-frame set. Translations in metres, rotations in degrees reported pre-close.
 */
export async function closeLoopSeam(input: { glbPath: string; clipName: string; outGlb: string; frames?: number }): Promise<{
  residualMm: number;
  residualDeg: number;
}> {
  const SM = input.frames ?? 8;
  const io = new NodeIO();
  const doc = await io.read(input.glbPath);
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === input.clipName);
  if (!anim) throw new Error(`no clip ${input.clipName}`);
  let residualMm = 0;
  let residualDeg = 0;
  for (const ch of anim.listChannels()) {
    const sampler = ch.getSampler();
    const targetPath = ch.getTargetPath();
    if (!sampler || (targetPath !== "translation" && targetPath !== "rotation")) continue;
    const times = sampler.getInput()?.getArray();
    const values = sampler.getOutput()?.getArray();
    if (!times || !values) continue;
    const n = times.length;
    const stride = targetPath === "rotation" ? 4 : 3;
    const at = (k: number): number[] => Array.from(values.subarray(k * stride, k * stride + stride));
    const first = at(0);
    if (n <= SM) {
      values.set(first, (n - 1) * stride);
      continue;
    }
    for (let k = 0; k < n; k += 1) {
      if (k < n - SM) continue;
      const w = k === n - 1 ? 1 : 0.5 * (1 - Math.cos((Math.PI * (k - (n - SM))) / SM));
      const cur = at(k);
      if (targetPath === "translation") {
        if (k === n - SM) {
          residualMm = Math.max(residualMm, 1000 * Math.hypot(cur[0]! - first[0]!, cur[1]! - first[1]!, cur[2]! - first[2]!));
        }
        const next = cur.map((v, kk) => v + (first[kk]! - v) * w);
        values.set(next, k * stride);
      } else {
        const curQ = cur as Q;
        const tgtQ = first as Q;
        if (k === n - SM) residualDeg = Math.max(residualDeg, qangle(curQ, tgtQ));
        const fixed = w >= 1 ? [...tgtQ] : slerpQ(curQ, qmul(qmul(tgtQ, qinv(curQ)), curQ), w);
        values.set(fixed, k * stride);
      }
    }
  }
  mkdirSync(path.dirname(input.outGlb), { recursive: true });
  await io.write(input.outGlb, doc);
  return { residualMm, residualDeg };
}

type Half = Map<string, Map<string, number[][]>>;

export async function symmetriseWalkStep(input: { sourceGlb: string; clipName: string; outGlb: string }): Promise<{
  strikes: { left: number[]; right: number[] };
  stepDurationS: number;
  loopDurationS: number;
  pairs: number;
  restResidualMm: number;
  closedGapMid: { mm: number; deg: number };
  closedGapEnd: { mm: number; deg: number };
  rootDriftBeforeM: number;
  rootDriftAfterM: number;
  sourceGate: WalkGateReport;
}> {
  assertMirrorMath();
  const io = new NodeIO();
  const doc = await io.read(input.sourceGlb);
  const channels = readClip(doc, input.clipName);
  const byNode = new Map<string, Chan[]>();
  for (const ch of channels) {
    const list = byNode.get(ch.node.getName()) ?? [];
    list.push(ch);
    byNode.set(ch.node.getName(), list);
  }
  const names = [...byNode.keys()];
  const missing = names.map(mirrorSwapName).filter((m) => !byNode.has(m));
  if (missing.length > 0) throw new Error(`unpaired mirror bones: ${missing.join(",")}`);
  const pairs = names.filter((m) => m.endsWith("_l")).length;
  const nodeByName = new Map(doc.getRoot().listNodes().map((node) => [node.getName(), node]));
  const parentOf = new Map<string, string>();
  for (const node of doc.getRoot().listNodes()) {
    for (const child of node.listChildren()) parentOf.set(child.getName(), node.getName());
  }
  const topo: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    const parent = parentOf.get(name);
    if (parent) visit(parent);
    seen.add(name);
    topo.push(name);
  };
  for (const name of nodeByName.keys()) visit(name);
  const baseOf = (name: string): { t: V3; r: Q; s: V3 } => {
    const node = nodeByName.get(name)!;
    const t = (node.getTranslation() ?? [0, 0, 0]) as unknown as V3;
    const r = (node.getRotation() ?? [0, 0, 0, 1]) as unknown as Q;
    const s = (node.getScale() ?? [1, 1, 1]) as unknown as V3;
    return { t: [...t] as V3, r: [...r] as Q, s: [...s] as V3 };
  };
  for (const name of names) {
    const twin = mirrorSwapName(name);
    const parent = parentOf.get(name);
    const twinParent = parentOf.get(twin);
    if (parent === undefined || twinParent === undefined) {
      if (parent !== twinParent) throw new Error(`root parent asymmetry on ${name}`);
    } else if (mirrorSwapName(parent) !== twinParent) {
      throw new Error(`topology not mirror-symmetric at ${name}: ${parent} vs ${twinParent}`);
    }
    const pathsOfName = (byNode.get(name) ?? []).map((c) => c.path).sort().join(",");
    const pathsOfTwin = (byNode.get(twin) ?? []).map((c) => c.path).sort().join(",");
    if (pathsOfName !== pathsOfTwin) throw new Error(`channel-set mismatch: ${name} vs ${twin}`);
    for (const nn of [name, twin]) {
      const base = baseOf(nn);
      if (Math.abs(base.s[0] - 1) > 1e-6 || Math.abs(base.s[1] - 1) > 1e-6 || Math.abs(base.s[2] - 1) > 1e-6) {
        throw new Error(`non-unit base scale on ${nn}; rigid FK refused`);
      }
    }
  }
  let restResidual = 0;
  for (const name of names) {
    if (!name.endsWith("_l")) continue;
    const ta = baseOf(name).t;
    const tb = baseOf(mirrorSwapName(name)).t;
    const mirrored = mirrorPos(ta);
    restResidual = Math.max(restResidual, Math.hypot(mirrored[0] - tb[0], mirrored[1] - tb[1], mirrored[2] - tb[2]));
  }

  const donor = await gateOneClip({ glbPath: input.sourceGlb, clipName: input.clipName, joints: MESHMOTION_WALK_JOINTS });
  const tL = donor.foot.left.strikeTimes[0]!;
  const tR = donor.foot.right.strikeTimes[0]!;
  if (tL === undefined || tR === undefined) throw new Error("donor has no strikes on one foot; refused");
  const span = donor.provenance.durationS;
  const d = (tR - tL + span) % span;
  if (!(d > 0)) throw new Error("empty step; refused");

  const localAt = (name: string, t: number): { t: V3; r: Q } => {
    const base = baseOf(name);
    const list = byNode.get(name) ?? [];
    const tc = list.find((c) => c.path === "translation");
    const rc = list.find((c) => c.path === "rotation");
    return {
      t: tc ? (sampleChan(tc, t) as V3) : base.t,
      r: rc ? (sampleChan(rc, t) as Q) : base.r,
    };
  };
  const scaleAt = (name: string, t: number): V3 => {
    const list = byNode.get(name) ?? [];
    const sc = list.find((c) => c.path === "scale");
    return sc ? (sampleChan(sc, t) as V3) : baseOf(name).s;
  };
  type Pose = { t: V3; r: Q };
  const worldAt = (t: number): Map<string, Pose> => {
    const out = new Map<string, Pose>();
    for (const name of topo) {
      const local = byNode.has(name) ? localAt(name, t) : { t: baseOf(name).t, r: baseOf(name).r };
      const parent = parentOf.get(name);
      if (!parent) {
        out.set(name, local);
      } else {
        const pw = out.get(parent)!;
        const rm = matFromQ(pw.r);
        out.set(name, {
          t: [
            pw.t[0] + rm[0]! * local.t[0] + rm[1]! * local.t[1] + rm[2]! * local.t[2],
            pw.t[1] + rm[3]! * local.t[0] + rm[4]! * local.t[1] + rm[5]! * local.t[2],
            pw.t[2] + rm[6]! * local.t[0] + rm[7]! * local.t[1] + rm[8]! * local.t[2],
          ],
          r: qmul(pw.r, local.r),
        });
      }
    }
    return out;
  };
  const pathsOf = (node: string): Array<"translation" | "rotation" | "scale"> =>
    (["translation", "rotation", "scale"] as const).filter((p) => byNode.get(node)!.some((c) => c.path === p));
  const halves: Half[] = [new Map(), new Map()];
  for (const name of names) {
    halves[0]!.set(name, new Map(pathsOf(name).map((p) => [p, [] as number[][]])));
    const twin = mirrorSwapName(name);
    if (!halves[1]!.has(twin)) halves[1]!.set(twin, new Map(pathsOf(twin).map((p) => [p, [] as number[][]])));
  }
  for (let j = 0; j < K; j += 1) {
    const t = tL + (j / K) * d;
    const world = worldAt(t);
    for (const name of names) {
      const local = localAt(name, t);
      for (const track of pathsOf(name)) {
        halves[0]!.get(name)!.get(track)!.push(track === "rotation" ? [...local.r] : track === "translation" ? [...local.t] : [...scaleAt(name, t)]);
      }
      const twin = mirrorSwapName(name);
      const wsrc = world.get(name)!;
      const wmir: Pose = { t: mirrorPos(wsrc.t), r: mirrorRot(wsrc.r) };
      // IK parent is the MIRRORED SOURCE parent, not the twin's own parent: the image
      // twin bone hangs off the mirrored source chain. (Using the twin's own parent
      // measures the mirrored ball against the unmirrored foot: 0.78 m for a 0.17 m bone.)
      const srcParent = parentOf.get(name);
      let localM: Pose;
      if (!srcParent) {
        localM = wmir;
      } else {
        const wpsrc = world.get(srcParent)!;
        const pw: Pose = { t: mirrorPos(wpsrc.t), r: mirrorRot(wpsrc.r) };
        const rm = matFromQ(pw.r);
        const dt0 = wmir.t[0] - pw.t[0];
        const dt1 = wmir.t[1] - pw.t[1];
        const dt2 = wmir.t[2] - pw.t[2];
        localM = {
          t: [rm[0]! * dt0 + rm[3]! * dt1 + rm[6]! * dt2, rm[1]! * dt0 + rm[4]! * dt1 + rm[7]! * dt2, rm[2]! * dt0 + rm[5]! * dt1 + rm[8]! * dt2],
          r: qmul(qinv(pw.r), wmir.r),
        };
      }
      for (const track of pathsOf(twin)) {
        halves[1]!.get(twin)!.get(track)!.push(track === "rotation" ? [...localM.r] : track === "translation" ? [...localM.t] : [...scaleAt(twin, t)]);
      }
    }
  }
  const get = (h: number, node: string, track: string, j: number): number[] => halves[h]!.get(node)!.get(track)![j]!;
  const set = (h: number, node: string, track: string, j: number, v: number[]): void => {
    halves[h]!.get(node)!.get(track)![j] = v;
  };
  const gapOf = (aH: number, aJ: number, bH: number, bJ: number): { mm: number; deg: number } => {
    let mm = 0;
    let deg = 0;
    for (const name of names) {
      if (pathsOf(name).includes("translation")) {
        const ta = get(aH, name, "translation", aJ);
        const tb = get(bH, name, "translation", bJ);
        mm = Math.max(mm, 1000 * Math.hypot(tb[0]! - ta[0]!, tb[1]! - ta[1]!, tb[2]! - ta[2]!));
      }
      if (pathsOf(name).includes("rotation")) {
        deg = Math.max(deg, qangle(get(aH, name, "rotation", aJ) as Q, get(bH, name, "rotation", bJ) as Q));
      }
    }
    return { mm, deg };
  };
  const closedGapMid = gapOf(0, K - 1, 1, 0);
  const closedGapEnd = gapOf(1, K - 1, 0, 0);
  // Close the mid joint on the A side (both plants stay exact) and the end joint on the B
  // side, with cosine ramps; then set the loop end frame exactly.
  const rampUp = (j: number): number => 0.5 * (1 - Math.cos((Math.PI * (j - (K - M))) / M));
  const closeToward = (h: number, j: number, w: number, tgtH: number, tgtJ: number, name: string): void => {
    if (pathsOf(name).includes("translation")) {
      const cur = get(h, name, "translation", j);
      const tgt = get(tgtH, name, "translation", tgtJ);
      set(h, name, "translation", j, cur.map((v, k) => v + (tgt[k]! - v) * w));
    }
    if (pathsOf(name).includes("rotation")) {
      const cur = get(h, name, "rotation", j) as Q;
      const tgt = get(tgtH, name, "rotation", tgtJ) as Q;
      set(h, name, "rotation", j, slerpQ(cur, qmul(qmul(tgt, qinv(cur)), cur), w));
    }
  };
  for (const name of names) {
    for (let j = K - M; j < K; j += 1) closeToward(0, j, rampUp(j), 1, 0, name);
    for (let j = K - M; j < K; j += 1) closeToward(1, j, rampUp(j), 0, 0, name);
    if (pathsOf(name).includes("translation")) set(1, name, "translation", K - 1, [...get(0, name, "translation", 0)]);
    if (pathsOf(name).includes("rotation")) set(1, name, "rotation", K - 1, [...get(0, name, "rotation", 0)]);
    if (pathsOf(name).includes("scale")) set(1, name, "scale", K - 1, [...get(0, name, "scale", 0)]);
  }
  // Root re-derive: net world travel lives in the topmost driven ancestor (pelvis's
  // parent chain), not in pelvis local alone — detrending pelvis local while root drifts
  // leaves world drift (measured: 25 mm). Detrend the topmost driven node's translation
  // (its parent is static, so local == world); pelvis world then closes exactly because
  // every driven local already matches first==last. Full-3D linear detrend; periodic
  // bob is unaffected. Measured before/after on world pelvis FK over the halves.
  const fkHalf = (h: number, j: number): Map<string, Pose> => {
    const out = new Map<string, Pose>();
    for (const name of topo) {
      const stored = halves[h]!.get(name);
      const base = baseOf(name);
      const local: Pose = stored
        ? { t: [...stored.get("translation")![j]!] as V3, r: [...stored.get("rotation")![j]!] as Q }
        : { t: base.t, r: base.r };
      const parent = parentOf.get(name);
      if (!parent) {
        out.set(name, local);
      } else {
        const pw = out.get(parent)!;
        const rm = matFromQ(pw.r);
        out.set(name, {
          t: [
            pw.t[0] + rm[0]! * local.t[0] + rm[1]! * local.t[1] + rm[2]! * local.t[2],
            pw.t[1] + rm[3]! * local.t[0] + rm[4]! * local.t[1] + rm[5]! * local.t[2],
            pw.t[2] + rm[6]! * local.t[0] + rm[7]! * local.t[1] + rm[8]! * local.t[2],
          ],
          r: qmul(pw.r, local.r),
        });
      }
    }
    return out;
  };
  const pelvisChain: string[] = [];
  {
    let c: string | undefined = "pelvis";
    while (c) {
      pelvisChain.unshift(c);
      c = parentOf.get(c);
    }
  }
  const topDriven = pelvisChain.find((c) => halves[0]!.has(c))!;
  const worldPelvis = (h: number, j: number): V3 => fkHalf(h, j).get("pelvis")!.t;
  const before0 = worldPelvis(0, 0);
  const before1 = worldPelvis(1, K - 1);
  const rootDriftBeforeM = Math.hypot(before1[0] - before0[0], before1[1] - before0[1], before1[2] - before0[2]);
  const N = 2 * K;
  const w0 = worldPelvis(0, 0);
  const w1 = worldPelvis(1, K - 1);
  for (const h of [0, 1] as const) {
    for (let j = 0; j < K; j += 1) {
      const cur = get(h, topDriven, "translation", j);
      const ramp = (h * K + j) / (N - 1);
      set(h, topDriven, "translation", j, [
        cur[0] - ramp * (w1[0] - w0[0]),
        cur[1] - ramp * (w1[1] - w0[1]),
        cur[2] - ramp * (w1[2] - w0[2]),
      ]);
    }
  }
  const after0 = worldPelvis(0, 0);
  const after1 = worldPelvis(1, K - 1);
  const rootDriftAfterM = Math.hypot(after1[0] - after0[0], after1[1] - after0[1], after1[2] - after0[2]);

  // Write: same rig, one new clip, uniform times, LINEAR.
  const root = doc.getRoot();
  for (const animation of root.listAnimations()) animation.dispose();
  const buffer = root.listBuffers()[0] ?? doc.createBuffer("symmetric");
  const times = new Float32Array(N);
  for (let j = 0; j < N; j += 1) times[j] = (j / (N - 1)) * 2 * d;
  const shared = doc.createAccessor(`${NEW_CLIP}_times`).setArray(times).setType(Accessor.Type.SCALAR).setBuffer(buffer);
  const animation = doc.createAnimation(NEW_CLIP);
  for (const name of names) {
    const node = nodeByName.get(name)!;
    for (const track of pathsOf(name)) {
      const flat: number[] = [];
      for (let j = 0; j < K; j += 1) flat.push(...get(0, name, track, j));
      for (let j = 0; j < K; j += 1) flat.push(...get(1, name, track, j));
      const output = doc.createAccessor(`${NEW_CLIP}_${name}_${track}`)
        .setArray(new Float32Array(flat))
        .setType(track === "rotation" ? Accessor.Type.VEC4 : Accessor.Type.VEC3)
        .setBuffer(buffer);
      const sampler = doc.createAnimationSampler(`${NEW_CLIP}_${name}_${track}_sampler`)
        .setInput(shared).setOutput(output).setInterpolation("LINEAR");
      const channel = doc.createAnimationChannel(`${NEW_CLIP}_${name}_${track}_channel`)
        .setSampler(sampler).setTargetNode(node).setTargetPath(track);
      animation.addSampler(sampler);
      animation.addChannel(channel);
    }
  }
  mkdirSync(path.dirname(input.outGlb), { recursive: true });
  await io.write(input.outGlb, doc);
  return {
    strikes: { left: donor.foot.left.strikeTimes, right: donor.foot.right.strikeTimes },
    stepDurationS: d,
    loopDurationS: 2 * d,
    pairs,
    restResidualMm: 1000 * restResidual,
    closedGapMid,
    closedGapEnd,
    rootDriftBeforeM,
    rootDriftAfterM,
    sourceGate: donor,
  };
}

function resolveBlender(): string {
  if (process.env["OPENCLINXR_BLENDER"] && existsSync(process.env["OPENCLINXR_BLENDER"])) return process.env["OPENCLINXR_BLENDER"]!;
  if (existsSync("/opt/homebrew/bin/blender")) return "/opt/homebrew/bin/blender";
  return "blender";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const k = args.indexOf(name);
    return k >= 0 ? args[k + 1] : undefined;
  };
  const sourceGlb = flag("--source-glb")!;
  const outGlb = flag("--out")!;
  const reportPath = flag("--report") ?? outGlb.replace(/\.glb$/u, "-report.json");
  const clipName = flag("--clip") ?? "Walk";
  const wantBind = args.includes("--bind");
  const wantClose = args.includes("--close-seam");
  if (!sourceGlb || !outGlb) throw new Error("--source-glb and --out required");
  const built = await symmetriseWalkStep({ sourceGlb, clipName, outGlb });
  const sourceGate = await gateOneClip({ glbPath: outGlb, clipName: NEW_CLIP, joints: MESHMOTION_WALK_JOINTS });
  console.log(`symmetric source gate: ${sourceGate.pass ? "PASS" : "FAIL"}`);
  for (const bar of sourceGate.bars) console.log(`  ${bar.pass ? "pass" : "FAIL"} ${bar.id}: ${bar.detail}`);
  let bound: { glb: string; sha256: string; clip: string; gate: WalkGateReport; dropped: boolean } | null = null;
  let closed: { glb: string; sha256: string; residualMm: number; residualDeg: number; gate: WalkGateReport } | null = null;
  if (wantBind) {
    const workdir = path.dirname(outGlb);
    const stripOut = path.join(workdir, "physician-stripped-sym.glb");
    if (!existsSync(stripOut)) {
      const reader = new NodeIO();
      const document = await reader.read(PHYSICIAN_GLB);
      for (const animation of document.getRoot().listAnimations()) animation.dispose();
      await reader.write(stripOut, document);
    }
    const raw = path.join(workdir, "bound-symmetric-raw.glb");
    const breport = path.join(workdir, "bound-symmetric-report.json");
    const result = await runMotionRetarget(
      { actorId: "mpfb-clinical-physician-adult", clipId: "Walk_Symmetric" },
      {
        blender: resolveBlender(),
        cwd: REPO_ROOT,
        timeoutMs: 600_000,
        extraArgs: ["--actor", stripOut, "--clip", outGlb, "--map", TARGET_MAP, "--source-map", SOURCE_MAP, "--source-orientation", "First person, Z up", "--output", raw, "--report", breport],
      },
    );
    if (result["blenderExit"] !== 0) throw new Error(`bind exit ${String(result["blenderExit"])}\n${String(result["stderr"]).slice(-1500)}`);
    const reader = new NodeIO();
    const boundDoc = await reader.read(raw);
    const clipNames = boundDoc.getRoot().listAnimations().map((a) => a.getName());
    const clip = clipNames.find((m) => m.startsWith("openclinxr_retarget_"));
    if (!clip) throw new Error(`no bound clip in ${raw}: ${clipNames.join(",")}`);
    const final = path.join(workdir, "bound-symmetric.glb");
    let dropped = false;
    try {
      await dropLeadingRestFrame({ targetPath: raw, clipName: clip, outputPath: final });
      dropped = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("does not look like a prepended rest frame")) throw err;
      console.log("no leading rest frame to drop; gating the raw bind output");
    }
    const gateGlb = dropped && existsSync(final) ? final : raw;
    const gate = await gateOneClip({ glbPath: gateGlb, clipName: clip, joints: MPFB_WALK_JOINTS });
    console.log(`symmetric bound gate: ${gate.pass ? "PASS" : "FAIL"}`);
    for (const bar of gate.bars) console.log(`  ${bar.pass ? "pass" : "FAIL"} ${bar.id}: ${bar.detail}`);
    bound = { glb: gateGlb, sha256: createHash("sha256").update(readFileSync(gateGlb)).digest("hex"), clip, gate, dropped };
    if (wantClose) {
      const closedGlb = path.join(workdir, "bound-symmetric-closed.glb");
      const { residualMm, residualDeg } = await closeLoopSeam({ glbPath: gateGlb, clipName: clip, outGlb: closedGlb });
      const closedGate = await gateOneClip({ glbPath: closedGlb, clipName: clip, joints: MPFB_WALK_JOINTS });
      console.log(`symmetric bound closed gate: ${closedGate.pass ? "PASS" : "FAIL"}`);
      for (const bar of closedGate.bars) console.log(`  ${bar.pass ? "pass" : "FAIL"} ${bar.id}: ${bar.detail}`);
      closed = { glb: closedGlb, sha256: createHash("sha256").update(readFileSync(closedGlb)).digest("hex"), residualMm, residualDeg, gate: closedGate };
    }
  }
  const report = {
    schemaVersion: "openclinxr.walk-symmetrise.v1",
    generatedAt: new Date().toISOString(),
    sourceGlb,
    outGlb,
    outSha256: createHash("sha256").update(readFileSync(outGlb)).digest("hex"),
    ...built,
    sourceGate,
    bound,
    closed,
  };
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${reportPath}`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
