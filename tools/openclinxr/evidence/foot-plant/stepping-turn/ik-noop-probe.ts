import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import type { Node as GltfNode } from "@gltf-transform/core";
import { Group, Object3D, Quaternion, Vector3 } from "three";
import {
  findStanceChain,
  solveTwoBoneIK,
  worldXyz,
} from "../../../../../packages/openclinxr/xr-humanoid-animation/src/stance-lock-ik.js";
import {
  findSteppingLegChain,
  heelTargetForToeTarget,
  solveSteppingLegHinge,
} from "../../../../../packages/openclinxr/xr-humanoid-animation/src/stepping-turn-leg-ik-mod.js";

/**
 * STEP 1 of the stepping-turn slice (2026-10-11): test the four-segment-chain lead.
 *
 * Prior footstep rounds: the two-bone leg IK missed its own toe target by 0.14-0.2 m
 * ONLY on the shipped rig, even on a near no-op solve. The real leg chain is
 * upperleg01 -> upperleg02 -> lowerleg01 -> lowerleg02 -> foot -> toe1-1, but the
 * solver only drives upperleg01 + lowerleg01 and leaves the two intermediate joints
 * at their clip values. Lead: the intermediate clip bends invalidate the two-bone
 * triangle, hence the miss.
 *
 * Method: mirror the SHIPPED GLB bytes (bind TRS + walk-clip sampler values at time t)
 * into a live three Object3D tree under a 0.86-scaled slot (the runtime framing), then
 * run the PRODUCTION solver + application:
 *   existing  = solveTwoBoneIK + stance-lock-mod.ts application (hip post-multiply, knee copy)
 *   composite = straighten upperleg02/lowerleg02 to bind, then the same two-bone solve
 *   ccd       = cyclic-coordinate-descent over all four leg joints (probe-local, not shipped)
 * Each on a no-op target (current heel world), a +0.2 m lateral displaced target, and a
 * reachable 0.198 m step target (toward under-hip + lift, the direction a real swing
 * foot moves). Pass: miss < 0.005 m no-op, < 0.01 m displaced, on all three rigs.
 *
 * claimScope: solver self-consistency on shipped bytes under the shipped walk clip.
 * notEvidenceFor: runtime slide, visual quality, or any turn behaviour.
 */

const RIGS = [
  { rig: "physician", glb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb" },
  { rig: "nurse", glb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb" },
  { rig: "child", glb: "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb" },
] as const;
const WALK_CLIP = "openclinxr_retarget_walk_source";
const SLOT_SCALE = 0.86;
const SOFTENING = 0.005;

type ChannelData = { times: Float32Array; values: Float32Array; stride: number };

/** Throwing index readers: the repo's biome config forbids non-null assertions. */
function numAt(arr: ArrayLike<number>, i: number, what: string): number {
  const v = arr[i];
  if (typeof v !== "number") throw new Error(`missing ${what}[${i}]`);
  return v;
}

function objAt(map: Map<string, Object3D>, name: string): Object3D {
  const o = map.get(name);
  if (!o) throw new Error(`missing object ${name}`);
  return o;
}

function jointAt(joints: Object3D[], i: number): Object3D {
  const j = joints[i];
  if (!j) throw new Error(`missing joint ${i}`);
  return j;
}

function quatAt(quats: Quaternion[], i: number): Quaternion {
  const q = quats[i];
  if (!q) throw new Error(`missing saved quat ${i}`);
  return q;
}

function sampleVec(ch: ChannelData, t: number): [number, number, number] {
  const { times, values, stride } = ch;
  const n = times.length;
  if (n === 0) throw new Error("empty sampler input");
  if (t <= numAt(times, 0, "time")) return [numAt(values, 0, "value"), numAt(values, 1, "value"), numAt(values, 2, "value")];
  const last = n - 1;
  if (t >= numAt(times, last, "time")) {
    const o = last * stride;
    return [numAt(values, o, "value"), numAt(values, o + 1, "value"), numAt(values, o + 2, "value")];
  }
  for (let i = 1; i < n; i += 1) {
    if (t <= numAt(times, i, "time")) {
      const a = numAt(times, i - 1, "time");
      const b = numAt(times, i, "time");
      const u = b > a ? (t - a) / (b - a) : 0;
      const oa = (i - 1) * stride;
      const ob = i * stride;
      return [
        numAt(values, oa, "value") + (numAt(values, ob, "value") - numAt(values, oa, "value")) * u,
        numAt(values, oa + 1, "value") + (numAt(values, ob + 1, "value") - numAt(values, oa + 1, "value")) * u,
        numAt(values, oa + 2, "value") + (numAt(values, ob + 2, "value") - numAt(values, oa + 2, "value")) * u,
      ];
    }
  }
  throw new Error("unreachable sample");
}

function sampleQuat(ch: ChannelData, t: number): Quaternion {
  const { times, values, stride } = ch;
  const n = times.length;
  if (n === 0) throw new Error("empty sampler input");
  const read = (i: number): Quaternion => {
    const o = i * stride;
    return new Quaternion(numAt(values, o, "value"), numAt(values, o + 1, "value"), numAt(values, o + 2, "value"), numAt(values, o + 3, "value"));
  };
  if (t <= numAt(times, 0, "time")) return read(0);
  const last = n - 1;
  if (t >= numAt(times, last, "time")) return read(last);
  for (let i = 1; i < n; i += 1) {
    if (t <= numAt(times, i, "time")) {
      const a = numAt(times, i - 1, "time");
      const b = numAt(times, i, "time");
      const u = b > a ? (t - a) / (b - a) : 0;
      const qa = read(i - 1);
      const qb = read(i);
      if (qa.dot(qb) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
      return qa.slerp(qb, u);
    }
  }
  throw new Error("unreachable quat sample");
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** One CCD sweep over the joints, innermost first. Returns the end-to-target distance. */
function ccdSweep(joints: Object3D[], end: Object3D, target: Vector3): number {
  const endPos = new Vector3();
  const jointPos = new Vector3();
  const toEnd = new Vector3();
  const toTarget = new Vector3();
  const axis = new Vector3();
  const q = new Quaternion();
  const parentQ = new Quaternion();
  for (let j = joints.length - 1; j >= 0; j -= 1) {
    const joint = jointAt(joints, j);
    joint.updateMatrixWorld(true);
    end.updateMatrixWorld(true);
    endPos.setFromMatrixPosition(end.matrixWorld);
    if (endPos.distanceTo(target) < 1e-4) return endPos.distanceTo(target);
    jointPos.setFromMatrixPosition(joint.matrixWorld);
    toEnd.subVectors(endPos, jointPos).normalize();
    toTarget.subVectors(target, jointPos).normalize();
    const cos = Math.min(1, Math.max(-1, toEnd.dot(toTarget)));
    if (cos > 1 - 1e-9) continue;
    axis.crossVectors(toEnd, toTarget);
    if (axis.lengthSq() < 1e-12) continue;
    axis.normalize();
    joint.parent?.updateMatrixWorld(true);
    if (joint.parent) parentQ.setFromRotationMatrix(joint.parent.matrixWorld);
    else parentQ.identity();
    // World-axis rotation -> joint-local delta: local = parentWorld^-1 * axisAngle * parentWorld * local.
    q.setFromAxisAngle(axis.clone().applyQuaternion(parentQ.clone().invert()), Math.acos(cos));
    joint.quaternion.premultiply(q);
    joint.updateMatrixWorld(true);
  }
  end.updateMatrixWorld(true);
  return endPos.setFromMatrixPosition(end.matrixWorld).distanceTo(target);
}

/** Probe-local CCD over the full hip->heel joint list. */
function solveCcd(joints: Object3D[], end: Object3D, target: Vector3, iterations: number): void {
  for (let iter = 0; iter < iterations; iter += 1) {
    if (ccdSweep(joints, end, target) < 1e-4) return;
  }
  // CCD stalls in elbow-flip local minima from a straight-leg start: perturb the two
  // intermediate bends and continue rather than accepting the stall.
  const perturb = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.35);
  jointAt(joints, 1).quaternion.premultiply(perturb);
  jointAt(joints, 3).quaternion.premultiply(perturb);
  for (let iter = 0; iter < iterations; iter += 1) {
    if (ccdSweep(joints, end, target) < 1e-4) return;
  }
}

function bindQuat(node: GltfNode): Quaternion {
  const ro = node.getRotation();
  if (!ro) throw new Error(`no bind rotation on ${node.getName()}`);
  return new Quaternion(numAt(ro, 0, "bind"), numAt(ro, 1, "bind"), numAt(ro, 2, "bind"), numAt(ro, 3, "bind"));
}

export type MirrorSource = {
  nodes: GltfNode[];
  byName: Map<string, GltfNode>;
  parentOf: Map<GltfNode, GltfNode>;
  channels: Map<string, Partial<Record<"translation" | "rotation" | "scale", ChannelData>>>;
  tMin: number;
  tMax: number;
};

export type MirrorRig = { slot: Group; objs: Map<string, Object3D> };

/** Read the GLB hierarchy + walk-clip samplers once; shared by the probe and the strip bake. */
export async function readMirrorSource(
  glb: string,
  clipName: string,
): Promise<{ doc: Awaited<ReturnType<NodeIO["read"]>>; source: MirrorSource }> {
  const doc = await new NodeIO().read(glb);
  const root = doc.getRoot();
  const rawNodes = root.listNodes();
  const nodes = rawNodes as unknown as GltfNode[];
  const byName = new Map(nodes.map((n) => [n.getName(), n]));
  const parentOf = new Map<GltfNode, GltfNode>();
  for (const p of nodes) {
    for (const c of p.listChildren()) parentOf.set(c as unknown as GltfNode, p);
  }
  const anim = root.listAnimations().find((a) => a.getName() === clipName);
  if (!anim) throw new Error(`no clip ${clipName} in ${glb}`);
  const channels = new Map<string, Partial<Record<"translation" | "rotation" | "scale", ChannelData>>>();
  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;
  for (const ch of anim.listChannels()) {
    const target = ch.getTargetNode();
    const sampler = ch.getSampler();
    if (!target || !sampler) continue;
    const input = sampler.getInput()?.getArray() as Float32Array | undefined;
    const output = sampler.getOutput()?.getArray() as Float32Array | undefined;
    const interp = sampler.getInterpolation();
    if (!input || !output) continue;
    if (interp === "CUBICSPLINE") throw new Error(`CUBICSPLINE refused on ${target.getName()}`);
    if (input.length === 0) continue;
    tMin = Math.min(tMin, numAt(input, 0, "input"));
    tMax = Math.max(tMax, numAt(input, input.length - 1, "input"));
    const entry = channels.get(target.getName()) ?? {};
    const targetPath = ch.getTargetPath() as "translation" | "rotation" | "scale";
    entry[targetPath] = { times: input, values: output, stride: targetPath === "rotation" ? 4 : 3 };
    channels.set(target.getName(), entry);
  }
  return { doc, source: { nodes, byName, parentOf, channels, tMin, tMax } };
}

/** Mirror the GLB hierarchy into live Object3Ds, bind TRS overridden by the clip at time t. */
export function buildMirrorAtClipTime(source: MirrorSource, clipName: string, t: number, slotScale: number): MirrorRig {
  void clipName;
  const objs = new Map<string, Object3D>();
  for (const n of source.nodes) {
    const o = new Object3D();
    o.name = n.getName();
    const tr = n.getTranslation() ?? [0, 0, 0];
    const sc = n.getScale() ?? [1, 1, 1];
    const ch = source.channels.get(n.getName());
    const pos = ch?.translation
      ? sampleVec(ch.translation, t)
      : [numAt(tr, 0, "bindT"), numAt(tr, 1, "bindT"), numAt(tr, 2, "bindT")] as [number, number, number];
    const quat = ch?.rotation ? sampleQuat(ch.rotation, t) : bindQuat(n);
    const scl = ch?.scale
      ? sampleVec(ch.scale, t)
      : [numAt(sc, 0, "bindS"), numAt(sc, 1, "bindS"), numAt(sc, 2, "bindS")] as [number, number, number];
    o.position.set(pos[0], pos[1], pos[2]);
    o.quaternion.copy(quat);
    o.scale.set(scl[0], scl[1], scl[2]);
    objs.set(n.getName(), o);
  }
  const slot = new Group();
  slot.name = "probe_slot";
  slot.scale.setScalar(slotScale);
  for (const n of source.nodes) {
    const o = objAt(objs, n.getName());
    const p = source.parentOf.get(n);
    if (p) objAt(objs, p.getName()).add(o);
    else slot.add(o);
  }
  slot.updateMatrixWorld(true);
  return { slot, objs };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    const v = args[i + 1];
    return i >= 0 ? (v ?? fallback) : fallback;
  };
  const rigFilter = flagValue("--rig", "");
  const outPath = flagValue("--out", ".openclinxr/evidence/stepping-turn/ik-noop.json");

  const rows: Array<Record<string, unknown>> = [];
  for (const { rig, glb } of RIGS) {
    if (rigFilter && rig !== rigFilter) continue;
    const doc = await new NodeIO().read(glb);
    const root = doc.getRoot();
    const nodes = root.listNodes();
    const byName = new Map(nodes.map((n) => [n.getName(), n]));
    const nodeByName = (name: string): GltfNode => {
      const n = byName.get(name);
      if (!n) throw new Error(`missing node ${name}`);
      return n;
    };
    const parentOf = new Map<GltfNode, GltfNode>();
    for (const p of nodes) {
      const parent = p as GltfNode;
      for (const c of p.listChildren()) parentOf.set(c as GltfNode, parent);
    }

    const anim = root.listAnimations().find((a) => a.getName() === WALK_CLIP);
    if (!anim) throw new Error(`no clip ${WALK_CLIP} in ${glb}`);
    const channels = new Map<string, Partial<Record<"translation" | "rotation" | "scale", ChannelData>>>();
    let tMin = Number.POSITIVE_INFINITY;
    let tMax = Number.NEGATIVE_INFINITY;
    for (const ch of anim.listChannels()) {
      const target = ch.getTargetNode();
      const sampler = ch.getSampler();
      if (!target || !sampler) continue;
      const input = sampler.getInput()?.getArray() as Float32Array | undefined;
      const output = sampler.getOutput()?.getArray() as Float32Array | undefined;
      const interp = sampler.getInterpolation();
      if (!input || !output) continue;
      if (interp === "CUBICSPLINE") throw new Error(`CUBICSPLINE refused on ${target.getName()}`);
      if (input.length === 0) continue;
      tMin = Math.min(tMin, numAt(input, 0, "input"));
      tMax = Math.max(tMax, numAt(input, input.length - 1, "input"));
      const entry = channels.get(target.getName()) ?? {};
      const targetPath = ch.getTargetPath() as "translation" | "rotation" | "scale";
      entry[targetPath] = { times: input, values: output, stride: targetPath === "rotation" ? 4 : 3 };
      channels.set(target.getName(), entry);
    }

    const fractions = [0, 0.2, 0.4, 0.6, 0.8];
    for (const f of fractions) {
      const t = tMin + f * (tMax - tMin);
      // Mirror the GLB hierarchy into live Object3Ds, bind TRS overridden by the clip at t.
      const objs = new Map<string, Object3D>();
      for (const n of nodes) {
        const o = new Object3D();
        o.name = n.getName();
        const tr = n.getTranslation() ?? [0, 0, 0];
        const sc = n.getScale() ?? [1, 1, 1];
        const ch = channels.get(n.getName());
        const pos = ch?.translation
          ? sampleVec(ch.translation, t)
          : [numAt(tr, 0, "bindT"), numAt(tr, 1, "bindT"), numAt(tr, 2, "bindT")] as [number, number, number];
        const quat = ch?.rotation ? sampleQuat(ch.rotation, t) : bindQuat(n as GltfNode);
        const scl = ch?.scale
          ? sampleVec(ch.scale, t)
          : [numAt(sc, 0, "bindS"), numAt(sc, 1, "bindS"), numAt(sc, 2, "bindS")] as [number, number, number];
        o.position.set(pos[0], pos[1], pos[2]);
        o.quaternion.copy(quat);
        o.scale.set(scl[0], scl[1], scl[2]);
        objs.set(n.getName(), o);
      }
      const slot = new Group();
      slot.name = "probe_slot";
      slot.scale.setScalar(SLOT_SCALE);
      for (const n of nodes) {
        const o = objAt(objs, n.getName());
        const p = parentOf.get(n as GltfNode);
        if (p) objAt(objs, p.getName()).add(o);
        else slot.add(o);
      }
      slot.updateMatrixWorld(true);

      for (const side of ["left", "right"] as const) {
        const chain = findStanceChain(slot, side);
        if (!chain) throw new Error(`no chain for ${side} in ${glb}`);
        const suffix = side === "left" ? "L" : "R";
        const get = (base: string): Object3D => objAt(objs, `${base}.${suffix}`);
        const hip = get("upperleg01");
        const mid1 = get("upperleg02");
        const knee = get("lowerleg01");
        const mid2 = get("lowerleg02");
        const heel = get("foot");
        const toe = get("toe1-1");
        slot.updateMatrixWorld(true);
        const heel0 = worldXyz(heel);
        const savedQuats = [hip, mid1, knee, mid2, heel, toe].map((o) => o.quaternion.clone());
        const restore = (): void => {
          const posed = [hip, mid1, knee, mid2, heel, toe];
          for (let i = 0; i < posed.length; i += 1) jointAt(posed, i).quaternion.copy(quatAt(savedQuats, i));
          slot.updateMatrixWorld(true);
        };
        // True summed segment lengths vs the chords the two-bone triangle uses.
        const seg = (a: Object3D, b: Object3D): number =>
          new Vector3()
            .setFromMatrixPosition(a.matrixWorld)
            .distanceTo(new Vector3().setFromMatrixPosition(b.matrixWorld));
        const thighTrue = seg(hip, mid1) + seg(mid1, knee);
        const shinTrue = seg(knee, mid2) + seg(mid2, heel);
        const thighChord = seg(hip, knee);
        const shinChord = seg(knee, heel);

        const runExisting = (target: { x: number; y: number; z: number }): number => {
          restore();
          const r = solveTwoBoneIK(hip, knee, heel, target, 0, SOFTENING, slot);
          if (!r) return Number.NaN;
          hip.quaternion.multiplyQuaternions(hip.quaternion, r.hipDelta);
          knee.quaternion.copy(r.kneeQuat);
          slot.updateMatrixWorld(true);
          return dist(worldXyz(heel), target);
        };
        const runComposite = (target: { x: number; y: number; z: number }): number => {
          restore();
          // Straighten intermediates to bind: the composite thigh/shin the triangle assumes.
          mid1.quaternion.copy(bindQuat(nodeByName(`upperleg02.${suffix}`)));
          mid2.quaternion.copy(bindQuat(nodeByName(`lowerleg02.${suffix}`)));
          slot.updateMatrixWorld(true);
          const r = solveTwoBoneIK(hip, knee, heel, target, 0, SOFTENING, slot);
          if (!r) return Number.NaN;
          hip.quaternion.multiplyQuaternions(hip.quaternion, r.hipDelta);
          knee.quaternion.copy(r.kneeQuat);
          slot.updateMatrixWorld(true);
          return dist(worldXyz(heel), target);
        };
        const runCcd = (target: { x: number; y: number; z: number }): number => {
          restore();
          solveCcd([hip, mid1, knee, mid2], heel, new Vector3(target.x, target.y, target.z), 256);
          slot.updateMatrixWorld(true);
          return dist(worldXyz(heel), target);
        };
        // Production hinge path (frozen mids at bind, twist-free aim, pole-forward knee):
        // same misses the shipped path must meet, plus the solved knee flexion in deg.
        const runHinge = (target: { x: number; y: number; z: number }): { missM: number; flexDeg: number } => {
          restore();
          const stepChain = findSteppingLegChain(slot, side);
          if (stepChain === null) throw new Error(`no stepping chain for ${side}`);
          const heelTarget = heelTargetForToeTarget({
            chain: stepChain,
            toeTargetWorld: {
              x: target.x + (worldXyz(toe).x - worldXyz(heel).x),
              y: target.y + (worldXyz(toe).y - worldXyz(heel).y),
              z: target.z + (worldXyz(toe).z - worldXyz(heel).z),
            },
          });
          const result = solveSteppingLegHinge({
            chain: stepChain,
            heelTargetWorld: heelTarget,
            poleWorld: { x: 0, y: 0, z: 1 },
            midRestQuats: {
              upper: bindQuat(nodeByName(`upperleg02.${suffix}`)),
              lower: bindQuat(nodeByName(`lowerleg02.${suffix}`)),
            },
          });
          slot.updateMatrixWorld(true);
          return { missM: result.missM, flexDeg: kneeFlexDeg() };
        };
        const kneeFlexDeg = (): number => {
          const hipW = new Vector3().setFromMatrixPosition(hip.matrixWorld);
          const kneeW = new Vector3().setFromMatrixPosition(knee.matrixWorld);
          const heelW = new Vector3().setFromMatrixPosition(heel.matrixWorld);
          const thigh = kneeW.clone().sub(hipW);
          const shin = heelW.clone().sub(kneeW);
          const tl = thigh.length();
          const sl = shin.length();
          if (tl < 1e-9 || sl < 1e-9) return Number.NaN;
          return (Math.acos(Math.min(1, Math.max(-1, thigh.dot(shin) / (tl * sl)))) * 180) / Math.PI;
        };

        const displaced = { x: heel0.x + 0.2, y: heel0.y, z: heel0.z };
        const hip0 = worldXyz(hip);
        const maxReachM = thighTrue + shinTrue;
        const reachGapM = Math.max(
          0,
          Math.hypot(displaced.x - hip0.x, displaced.y - hip0.y, displaced.z - hip0.z) - maxReachM,
        );
        // Reachable 0.2 m step: toward under-hip in XZ plus lift — the direction a real
        // swing-foot placement moves. |d| = sqrt(0.14^2 + 0.14^2) = 0.198 m.
        const toHipX = hip0.x - heel0.x;
        const toHipZ = hip0.z - heel0.z;
        const toHipLen = Math.hypot(toHipX, toHipZ);
        const ux = toHipLen > 1e-6 ? toHipX / toHipLen : 1;
        const uz = toHipLen > 1e-6 ? toHipZ / toHipLen : 0;
        const stepped = { x: heel0.x + ux * 0.14, y: heel0.y + 0.14, z: heel0.z + uz * 0.14 };
        const reachGapSteppedM = Math.max(
          0,
          Math.hypot(stepped.x - hip0.x, stepped.y - hip0.y, stepped.z - hip0.z) - maxReachM,
        );
        const row = {
          rig,
          side,
          clipFraction: f,
          clipTimeS: t,
          thighTrueM: thighTrue,
          thighChordM: thighChord,
          shinTrueM: shinTrue,
          shinChordM: shinChord,
          reachGapDisplacedM: reachGapM,
          reachGapSteppedM,
          existingNoopMissM: runExisting(heel0),
          compositeNoopMissM: runComposite(heel0),
          ccdNoopMissM: runCcd(heel0),
          existingDisplacedMissM: runExisting(displaced),
          compositeDisplacedMissM: runComposite(displaced),
          ccdDisplacedMissM: runCcd(displaced),
          existingSteppedMissM: runExisting(stepped),
          compositeSteppedMissM: runComposite(stepped),
          ccdSteppedMissM: runCcd(stepped),
          hingeNoopMissM: runHinge(heel0).missM,
          hingeSteppedMissM: runHinge(stepped).missM,
          hingeSteppedFlexDeg: runHinge(stepped).flexDeg,
        };
        rows.push(row);
        const numbers = row as unknown as Record<string, number>;
        const fmt = (k: string): string => {
          const v = numbers[k];
          return typeof v === "number" ? v.toFixed(4) : "?";
        };
        process.stdout.write(
          `${rig}/${side}/f${f}: noop existing=${fmt("existingNoopMissM")} composite=${fmt("compositeNoopMissM")} ccd=${fmt("ccdNoopMissM")} hinge=${fmt("hingeNoopMissM")} | step hinge=${fmt("hingeSteppedMissM")} flex=${fmt("hingeSteppedFlexDeg")} | chord-vs-true ${((thighTrue - thighChord) * 1000).toFixed(1)}/${((shinTrue - shinChord) * 1000).toFixed(1)}mm\n`,
        );
      }
    }
  }
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2)}\n`, "utf8");
  process.stdout.write(`${outPath}\n`);
}

const invoked = typeof process.argv[1] === "string" && process.argv[1].endsWith("ik-noop-probe.ts");
if (invoked) await main();
