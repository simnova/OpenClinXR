/**
 * Stage A verification: the live mixer leg pose equals the weight-normalised
 * blend of the running actions (idle w=1 + walk w=1) within 1 degree.
 *
 * Reads .openclinxr/evidence/walk-clip/live-mixer-probe.json (per-frame tap
 * quats + per-action running/weight/time), samples the idle and walk clips'
 * local rotation tracks at the RECORDED action times (mod loop duration),
 * slerp-blends them at the recorded weights, and reports the angle between
 * predicted and measured local quats per leg bone.
 *
 * Also reports the walk-only null hypothesis (no idle contribution).
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/evidence/walk-clip/verify-blend.ts
 */

import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";

const GLB = "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
const PROBE = ".openclinxr/evidence/walk-clip/live-mixer-probe.json";
const IDLE = "ClinicalIdleConversation";
const WALK = "openclinxr_retarget_walk_source";

const TAP_TO_GLB: Record<string, string> = {
  upperleg01L: "upperleg01.L", upperleg01R: "upperleg01.R",
  upperleg02L: "upperleg02.L", upperleg02R: "upperleg02.R",
  lowerleg01L: "lowerleg01.L", lowerleg01R: "lowerleg01.R",
  lowerleg02L: "lowerleg02.L", lowerleg02R: "lowerleg02.R",
  footL: "foot.L", footR: "foot.R",
  "toe1-1L": "toe1-1.L", "toe1-1R": "toe1-1.R",
  pelvisL: "pelvis.L", pelvisR: "pelvis.R",
  root: "root",
};

type Quat = [number, number, number, number];

function slerp(a: Quat, b: Quat, t: number): Quat {
  let bx = b[0]; let by = b[1]; let bz = b[2]; let bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (dot > 0.9995) {
    const o: Quat = [a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t];
    const l = Math.hypot(o[0], o[1], o[2], o[3]) || 1;
    return [o[0] / l, o[1] / l, o[2] / l, o[3] / l];
  }
  const th = Math.acos(dot);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

function qangle(a: Quat, b: Quat): number {
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(Math.abs(d)) * 180) / Math.PI;
}

async function main(): Promise<void> {
  const doc = await new NodeIO().read(GLB);
  const nodes = doc.getRoot().listNodes();
  const restOf = (nm: string): Quat => [...(nodes.find((n) => n.getName() === nm)!.getRotation() as unknown as number[])] as Quat;
  type Track = { times: Float32Array; vals: Float32Array };
  const trackOf = (clipName: string): Map<string, Track> => {
    const anim = doc.getRoot().listAnimations().find((a) => a.getName() === clipName)!;
    const m = new Map<string, Track>();
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== "rotation") continue;
      m.set(ch.getTargetNode()?.getName() ?? "", {
        times: Float32Array.from(ch.getSampler()?.getInput()?.getArray() as ArrayLike<number>),
        vals: Float32Array.from(ch.getSampler()?.getOutput()?.getArray() as ArrayLike<number>),
      });
    }
    const dur = Math.max(...[...m.values()].map((t) => t.times[t.times.length - 1]!));
    return new Map([...m.entries()].map(([k, v]) => [k, { ...v, dur } as unknown as Track]));
  };
  const idleT = trackOf(IDLE);
  const walkT = trackOf(WALK);
  const durOf = (m: Map<string, Track>): number => Math.max(...[...m.values()].map((t) => t.times[t.times.length - 1]!));

  const sampleQ = (m: Map<string, Track>, dur: number, nm: string, t: number): Quat => {
    const tr = m.get(nm);
    const rest = restOf(nm);
    if (!tr) return rest;
    const tt = ((t % dur) + dur) % dur;
    const at = (i: number): Quat => [tr.vals[i * 4]!, tr.vals[i * 4 + 1]!, tr.vals[i * 4 + 2]!, tr.vals[i * 4 + 3]!];
    if (tt <= tr.times[0]!) return at(0);
    if (tt >= tr.times[tr.times.length - 1]!) return at(tr.times.length - 1);
    let hi = 1;
    while (hi < tr.times.length && tr.times[hi]! < tt) hi += 1;
    const lo = hi - 1;
    return slerp(at(lo), at(hi), (tt - tr.times[lo]!) / (tr.times[hi]! - tr.times[lo]!));
  };

  const idleDur = durOf(idleT);
  const walkDur = durOf(walkT);
  const probe = JSON.parse(readFileSync(PROBE, "utf8")) as {
    ring: Array<{
      phase: string | null;
      quat: Record<string, Quat> | null;
      mixerActions: Array<{ clip: string; running: boolean | null; effectiveWeight: number | null; timeSeconds: number | null }> | null;
    }>;
  };
  const rows = probe.ring.filter((r) => r.phase === "walking" && r.quat && r.mixerActions);
  console.log(`walking frames with quats+actions: ${rows.length}, idleDur=${idleDur.toFixed(3)} walkDur=${walkDur.toFixed(3)}`);

  const bones = Object.keys(TAP_TO_GLB);
  const blendErr: Record<string, number[]> = {};
  const walkOnlyErr: Record<string, number[]> = {};
  for (const b of bones) { blendErr[b] = []; walkOnlyErr[b] = []; }
  let framesUsed = 0;
  for (const r of rows) {
    const acts = new Map((r.mixerActions ?? []).map((a) => [a.clip, a]));
    const wi = acts.get(IDLE);
    const ww = acts.get(WALK);
    if (!wi?.running || !ww?.running) continue;
    if (typeof wi.timeSeconds !== "number" || typeof ww.timeSeconds !== "number") continue;
    if (typeof wi.effectiveWeight !== "number" || typeof ww.effectiveWeight !== "number") continue;
    const total = wi.effectiveWeight + ww.effectiveWeight;
    if (total <= 0) continue;
    const f = ww.effectiveWeight / total;
    framesUsed += 1;
    for (const b of bones) {
      const tap = r.quat![b];
      if (!tap) continue;
      const glb = TAP_TO_GLB[b]!;
      const qi = sampleQ(idleT, idleDur, glb, wi.timeSeconds);
      const qw = sampleQ(walkT, walkDur, glb, ww.timeSeconds);
      blendErr[b]!.push(qangle(slerp(qi, qw, f), tap as Quat));
      walkOnlyErr[b]!.push(qangle(qw, tap as Quat));
    }
  }
  console.log(`frames with both actions running: ${framesUsed}`);
  let worst = 0;
  let worstBone = "";
  let worstStart = 0;
  for (const b of bones) {
    const e = blendErr[b]!;
    const w = walkOnlyErr[b]!;
    if (e.length === 0) { console.log(`${b}: no samples`); continue; }
    // Frame 0 is the walk-start transient (action created+played after the
    // first snapshot: pose is idle-only while weights already read 1/1).
    // Report it separately; the steady bar excludes it.
    const steady = e.slice(1);
    const mx = Math.max(...steady);
    const mean = steady.reduce((a, v) => a + v, 0) / steady.length;
    const wmx = Math.max(...w);
    const start = e[0]!;
    if (start > worstStart) worstStart = start;
    if (mx > worst) { worst = mx; worstBone = b; }
    console.log(`${b}: blend steady max=${mx.toFixed(3)} mean=${mean.toFixed(3)} start-frame=${start.toFixed(2)} | walk-only max=${wmx.toFixed(2)} (n=${e.length})`);
  }
  console.log(`WORST steady blend error: ${worst.toFixed(3)} deg on ${worstBone} — ${worst <= 1 ? "WITHIN 1 DEG" : "EXCEEDS 1 DEG"}; start-transient max ${worstStart.toFixed(2)} deg`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
