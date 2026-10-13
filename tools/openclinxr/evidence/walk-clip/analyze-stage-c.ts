/**
 * Stage C analysis: control-vs-fix bars from loco-ground capture JSONs.
 *
 * Reads four captures (fix/control x lockOff/twoBone, each with the full
 * tap ring incl. quats, toe/ankle worlds, mixer actions) plus the shipped
 * GLB clip for the clip-amplitude baseline. No package imports (pure node +
 * gltf-transform); run from the fix worktree with paths to both trees.
 *
 * Windows: steady = walking[31:-31] (~one loop dropped each end);
 * start = walking[:10]; end = walking[-10:]; arrived = last 30 tap frames.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/evidence/walk-clip/analyze-stage-c.ts \
 *     --fix-lockoff .openclinxr/evidence/loco-ground/lockOff/loco-ground-lockOff.json \
 *     --fix-twobone .openclinxr/evidence/loco-ground/twoBone/loco-ground-twoBone.json \
 *     --control-lockoff /Volumes/files/src/openclinxr-wt/walk-control/.openclinxr/evidence/loco-ground/lockOff/loco-ground-lockOff.json \
 *     --control-twobone /Volumes/files/src/openclinxr-wt/walk-control/.openclinxr/evidence/loco-ground/twoBone/loco-ground-twoBone.json \
 *     --out .openclinxr/evidence/walk-clip/stagec.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";

const LEG_BONES = [
  "upperleg01L", "upperleg01R", "upperleg02L", "upperleg02R",
  "lowerleg01L", "lowerleg01R", "lowerleg02L", "lowerleg02R",
  "footL", "footR", "toe1-1L", "toe1-1R", "pelvisL", "pelvisR", "root",
];
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
const ARM_BONES = ["upperarm01L", "upperarm01R"];
const TIME_SCALE = 1.6255;

type Quat = [number, number, number, number];
type Xyz = { x: number; y: number; z: number };

function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} out of range`);
  return v;
}
type TapFrame = {
  frame: number;
  mixer: { quat: Record<string, Quat>; toeWorld: { left: Xyz | null; right: Xyz | null }; ankleWorld?: { left: Xyz | null; right: Xyz | null } | null; slot: { x: number; z: number } | null };
  posture: { quat: Record<string, Quat> };
  rendered: { quat: Record<string, Quat>; toeWorld: { left: Xyz | null; right: Xyz | null }; slot: { x: number; z: number } | null };
  meta: { phase: string | null; stanceLabel: string | null; heelMissM: number | null; actionTimeScale: number | null };
};

function qangle(a: Quat, b: Quat): number {
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(Math.abs(d)) * 180) / Math.PI;
}
function qmean(qs: Quat[]): Quat {
  const ref = at(qs, 0);
  let x = 0; let y = 0; let z = 0; let w = 0;
  for (const q of qs) {
    const s = q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3] < 0 ? -1 : 1;
    x += q[0] * s; y += q[1] * s; z += q[2] * s; w += q[3] * s;
  }
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}
function pairwiseMax(qs: Quat[]): number {
  let mx = 0;
  for (let i = 0; i < qs.length; i += 1) {
    for (let j = i + 1; j < qs.length; j += 1) mx = Math.max(mx, qangle(at(qs, i), at(qs, j)));
  }
  return mx;
}
function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? at(s, (s.length - 1) / 2) : (at(s, s.length / 2 - 1) + at(s, s.length / 2)) / 2;
}

function loadCapture(path: string): { tap: TapFrame[]; evidence: { clipAdvance: number | null } } {
  const d = JSON.parse(readFileSync(path, "utf8")) as { tap: TapFrame[]; evidence: { clipAdvance: number | null } };
  return { tap: d.tap, evidence: d.evidence };
}
const walkingOf = (tap: TapFrame[]): TapFrame[] => tap.filter((t) => t.meta.phase === "walking");
const quatOf = (t: TapFrame, bone: string): Quat | null => t.mixer.quat[bone] ?? null;

async function clipAmplitudes(glbPath: string): Promise<Record<string, number>> {
  const doc = await new NodeIO().read(glbPath);
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === "openclinxr_retarget_walk_source");
  if (!anim) throw new Error("walk clip missing from GLB");
  const amp: Record<string, number> = {};
  for (const [tap, glb] of Object.entries(TAP_TO_GLB)) {
    const ch = anim.listChannels().find((c) => c.getTargetNode()?.getName() === glb && c.getTargetPath() === "rotation");
    if (!ch) { amp[tap] = NaN; continue; }
    const vals = Array.from(ch.getSampler()?.getOutput()?.getArray() as Float32Array);
    const qs: Quat[] = [];
    for (let i = 0; i < vals.length / 4; i += 1) qs.push([at(vals, i * 4), at(vals, i * 4 + 1), at(vals, i * 4 + 2), at(vals, i * 4 + 3)]);
    amp[tap] = pairwiseMax(qs);
  }
  return amp;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (n: string): string => {
    const i = args.indexOf(n);
    if (i < 0 || !args[i + 1]) throw new Error(`missing ${n}`);
    return at(args, i + 1);
  };
  const out = args.includes("--out") ? flag("--out") : ".openclinxr/evidence/walk-clip/stagec.json";
  const fixOff = loadCapture(flag("--fix-lockoff"));
  const fixLock = loadCapture(flag("--fix-twobone"));
  const ctlOff = loadCapture(flag("--control-lockoff"));
  const ctlLock = loadCapture(flag("--control-twobone"));
  const clipAmp = await clipAmplitudes("apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb");

  const rep: Record<string, unknown> = { bars: {}, report: {}, controlFail: {} };

  // ---- Bar 1: live/clip amplitude >= 0.95, steady walking, lockOff ----
  const steady = (tap: TapFrame[]): TapFrame[] => {
    const w = walkingOf(tap);
    return w.slice(31, w.length - 31);
  };
  const bar1: Record<string, { live: number; clip: number; ratio: number | null; staticHeld: boolean }> = {};
  void bar1;
  for (const b of LEG_BONES) {
    const qs = steady(fixOff.tap).map((t) => quatOf(t, b)).filter((q): q is Quat => !!q);
    const live = pairwiseMax(qs);
    const clip = clipAmp[b] ?? NaN;
    if (clip < 1) {
      bar1[b] = { live, clip, ratio: null, staticHeld: live < 1 };
    } else {
      bar1[b] = { live, clip, ratio: live / clip, staticHeld: false };
    }
  }
  (rep["bars"] as Record<string, unknown>)["amplitudeRatio"] = bar1;

  // ---- Bar 2: swing toe/ankle, lockOff steady (mixer pose), ungated ----
  const swingMax = (tap: TapFrame[], get: (t: TapFrame) => (Xyz | null)[]): number => {
    const w = steady(tap);
    const floor = Math.min(...w.flatMap((t) => get(t).map((p) => (p ? p.y : Infinity))));
    return Math.max(...w.flatMap((t) => get(t).map((p) => (p ? p.y - floor : -Infinity))));
  };
  const bar2 = {
    fixToeL: swingMax(fixOff.tap, (t) => [t.mixer.toeWorld.left]),
    fixToeR: swingMax(fixOff.tap, (t) => [t.mixer.toeWorld.right]),
    fixAnkleL: swingMax(fixOff.tap, (t) => [t.mixer.ankleWorld?.left ?? null]),
    fixAnkleR: swingMax(fixOff.tap, (t) => [t.mixer.ankleWorld?.right ?? null]),
    ctlToeL: swingMax(ctlOff.tap, (t) => [t.mixer.toeWorld.left]),
    ctlToeR: swingMax(ctlOff.tap, (t) => [t.mixer.toeWorld.right]),
    ctlAnkleL: swingMax(ctlOff.tap, (t) => [t.mixer.ankleWorld?.left ?? null]),
    ctlAnkleR: swingMax(ctlOff.tap, (t) => [t.mixer.ankleWorld?.right ?? null]),
  };
  (rep["bars"] as Record<string, unknown>)["swing"] = bar2;

  // ---- Bar 3: standing pose fix vs control within 1 deg ----
  const standDiff = (fix: TapFrame[], ctl: TapFrame[]): Record<string, number> => {
    const diff: Record<string, number> = {};
    for (const b of LEG_BONES) {
      const fq = fix.map((t) => quatOf(t, b)).filter((q): q is Quat => !!q);
      const cq = ctl.map((t) => quatOf(t, b)).filter((q): q is Quat => !!q);
      diff[b] = fq.length > 0 && cq.length > 0 ? qangle(qmean(fq), qmean(cq)) : NaN;
    }
    return diff;
  };
  const fixStart = walkingOf(fixOff.tap).slice(0, 1);
  const ctlStart = walkingOf(ctlOff.tap).slice(0, 1);
  const fixArr = fixOff.tap.slice(-30);
  const ctlArr = ctlOff.tap.slice(-30);
  (rep["bars"] as Record<string, unknown>)["standing"] = {
    preWalk: standDiff(fixStart, ctlStart),
    arrived: standDiff(fixArr, ctlArr),
  };

  // ---- Bar 4: transition steps, fix vs control+10% ----
  const steps = (frames: TapFrame[]): { rotMax: Record<string, number>; footMax: number } => {
    const rotMax: Record<string, number> = {};
    for (const b of [...LEG_BONES, ...ARM_BONES]) {
      let mx = 0;
      for (let i = 1; i < frames.length; i += 1) {
        const a = at(frames, i - 1).mixer.quat[b];
        const c = at(frames, i).mixer.quat[b];
        if (a && c) mx = Math.max(mx, qangle(a, c));
      }
      rotMax[b] = mx;
    }
    let footMax = 0;
    for (let i = 1; i < frames.length; i += 1) {
      for (const f of ["left", "right"] as const) {
        const a = at(frames, i - 1).mixer.toeWorld[f];
        const c = at(frames, i).mixer.toeWorld[f];
        if (a && c) footMax = Math.max(footMax, Math.hypot(c.x - a.x, c.z - a.z));
      }
    }
    return { rotMax, footMax };
  };
  const trans = (tap: TapFrame[]): { start: TapFrame[]; end: TapFrame[] } => {
    const w = walkingOf(tap);
    return { start: w.slice(0, 10), end: w.slice(-10) };
  };
  const tFix = trans(fixOff.tap);
  const tCtl = trans(ctlOff.tap);
  (rep["bars"] as Record<string, unknown>)["transitions"] = {
    fixStart: steps(tFix.start),
    fixEnd: steps(tFix.end),
    ctlStart: steps(tCtl.start),
    ctlEnd: steps(tCtl.end),
  };

  // ---- Bar 5: arms (rendered end-of-frame quats) ----
  const armSteps = (frames: TapFrame[]): Record<string, number> => {
    const armMax: Record<string, number> = {};
    for (const b of ARM_BONES) {
      let mx = 0;
      for (let i = 1; i < frames.length; i += 1) {
        const a = at(frames, i - 1).rendered.quat[b];
        const c = at(frames, i).rendered.quat[b];
        if (a && c) mx = Math.max(mx, qangle(a, c));
      }
      armMax[b] = mx;
    }
    return armMax;
  };
  // Hold: angle of the arrived upper-arm quat from its bind quat (GLB rest).
  const doc = await new NodeIO().read("apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb");
  const bindOf = (glb: string): Quat => {
    const n = doc.getRoot().listNodes().find((x) => x.getName() === glb);
    if (!n) throw new Error(`bone ${glb} missing from GLB`);
    return [...(n.getRotation() as unknown as number[])] as Quat;
  };
  const holdAngle = (tap: TapFrame[]): Record<string, number> => {
    const angles: Record<string, number> = {};
    for (const b of ARM_BONES) {
      const glb = b === "upperarm01L" ? "upperarm01.L" : "upperarm01.R";
      const qs = tap.slice(-30).map((t) => t.rendered.quat[b]).filter((q): q is Quat => !!q);
      angles[b] = qs.length > 0 ? qangle(qmean(qs), bindOf(glb)) : NaN;
    }
    return angles;
  };
  (rep["bars"] as Record<string, unknown>)["arms"] = {
    fixStart: armSteps(tFix.start),
    fixEnd: armSteps(tFix.end),
    ctlStart: armSteps(tCtl.start),
    ctlEnd: armSteps(tCtl.end),
    fixHold: holdAngle(fixOff.tap),
    ctlHold: holdAngle(ctlOff.tap),
  };

  // ---- Bar 6 (report): stationary fraction, stance speed, root, ratio, heel ----
  const stationary = (tap: TapFrame[]): Record<string, number | null> => {
    const w = steady(tap);
    const frac: Record<string, number | null> = {};
    for (const f of ["left", "right"] as const) {
      let s = 0; let d = 0;
      for (let i = 1; i < w.length; i += 1) {
        const cur = at(w, i); const prev = at(w, i - 1);
        const cs = cur.rendered.slot; const ps = prev.rendered.slot;
        const ct = cur.rendered.toeWorld[f]; const pt = prev.rendered.toeWorld[f];
        if (!cs || !ps || !ct || !pt) continue;
        const rs = Math.hypot(cs.x - ps.x, cs.z - ps.z);
        if (rs < 0.0005) continue;
        d += 1;
        if (Math.hypot(ct.x - pt.x, ct.z - pt.z) < 0.25 * rs) s += 1;
      }
      frac[f] = d > 0 ? s / d : null;
    }
    return frac;
  };
  const bodySpeed = (tap: TapFrame[]): number | null => {
    const w = steady(tap);
    const v: number[] = [];
    for (let i = 1; i < w.length; i += 1) {
      const cur = at(w, i); const prev = at(w, i - 1);
      // body-frame speed of the lower foot (matches analyze lowerFootSpeed)
      const lt = cur.mixer.toeWorld.left; const rt = cur.mixer.toeWorld.right;
      if (!lt || !rt) continue;
      const f = lt.y <= rt.y ? "left" as const : "right" as const;
      const ct = cur.mixer.toeWorld[f]; const pt = prev.mixer.toeWorld[f];
      const cs = cur.mixer.slot; const ps = prev.mixer.slot;
      if (!ct || !pt || !cs || !ps) continue;
      // wall dt from frame spacing at 30 fps fake clock
      v.push(Math.hypot(ct.x - pt.x - (cs.x - ps.x), ct.z - pt.z - (cs.z - ps.z)) * 30);
    }
    return v.length > 0 ? median(v) : null;
  };
  const rootSpeed = (tap: TapFrame[]): number | null => {
    const w = steady(tap);
    if (w.length < 2) return null;
    let travel = 0;
    for (let i = 1; i < w.length; i += 1) {
      const a = at(w, i - 1).rendered.slot; const b = at(w, i).rendered.slot;
      if (a && b) travel += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return travel / ((w.length - 1) / 30);
  };
  const heelMax = (tap: TapFrame[]): number | null => {
    const hs = tap.map((t) => t.meta.heelMissM).filter((v): v is number => typeof v === "number");
    return hs.length > 0 ? Math.max(...hs) : null;
  };
  const r6 = (tap: TapFrame[]): Record<string, unknown> => {
    const bs = bodySpeed(tap);
    const rs = rootSpeed(tap);
    return {
      stationary: stationary(tap),
      stancePlayed: bs,
      stanceRate1: bs !== null ? bs / TIME_SCALE : null,
      root: rs,
      ratio: bs !== null && rs !== null && bs > 0 ? rs / bs : null,
      heelMissMax: heelMax(tap),
    };
  };
  (rep["report"] as Record<string, unknown>)["fixLockOff"] = r6(fixOff.tap);
  (rep["report"] as Record<string, unknown>)["fixTwoBone"] = r6(fixLock.tap);
  (rep["report"] as Record<string, unknown>)["ctlLockOff"] = r6(ctlOff.tap);
  (rep["report"] as Record<string, unknown>)["ctlTwoBone"] = r6(ctlLock.tap);

  writeFileSync(out, `${JSON.stringify(rep, null, 2)}\n`);
  console.log(`wrote ${out}`);
  // Console bar summary
  const b1 = bar1 as Record<string, { ratio: number | null; staticHeld: boolean; live: number; clip: number }>;
  const fails1 = Object.entries(b1).filter(([, v]) => v.ratio !== null && v.ratio < 0.95);
  const statFails = Object.entries(b1).filter(([, v]) => v.ratio === null && !v.staticHeld);
  const ratioParts = Object.entries(b1).map(([k, v]) => `${k}=${v.ratio === null ? (v.staticHeld ? "static" : "MOVED") : v.ratio.toFixed(2)}`);
  console.log(`bar1: ${fails1.length === 0 && statFails.length === 0 ? "PASS" : "FAIL"} ratios: ${ratioParts.join(" ")}`);
  console.log(`bar2: fix toe ${bar2.fixToeL.toFixed(3)}/${bar2.fixToeR.toFixed(3)} (>=0.127) ankle ${bar2.fixAnkleL.toFixed(3)}/${bar2.fixAnkleR.toFixed(3)} (>=0.21); control toe ${bar2.ctlToeL.toFixed(3)}/${bar2.ctlToeR.toFixed(3)} ankle ${bar2.ctlAnkleL.toFixed(3)}/${bar2.ctlAnkleR.toFixed(3)}`);
  const st = rep["bars"] as Record<string, Record<string, Record<string, number>>>;
  const mxArr = (m: Record<string, number>): number => Math.max(...Object.values(m).filter((v) => !Number.isNaN(v)));
  const standing = st["standing"] as Record<string, Record<string, number>> | undefined;
  if (!standing) throw new Error("standing bars missing");
  const preWalk = standing["preWalk"];
  const arrived = standing["arrived"];
  if (!preWalk || !arrived) throw new Error("standing bars missing");
  console.log(`bar3: preWalk max ${mxArr(preWalk).toFixed(3)} arrived max ${mxArr(arrived).toFixed(3)} (<=1)`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
