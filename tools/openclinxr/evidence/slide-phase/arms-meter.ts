/**
 * Arms slice meter (DENSE_v1, 2026-10-19): arm/torso clearance after walk end
 * + walking-swing writer attribution, per rig (physician, nurse, child),
 * dressed and body.
 *
 * STEP 1 instrument: reads existing SC-05 captures (slide-phase-capture
 * `upperBody` probe) plus the shipped GLBs. Writes no product code.
 *
 * (a) arm/torso clearance: per frame after walk end (phase != walking),
 * minimum signed distance from wrist, mid-forearm and elbow to the torso
 * capsule (live spineBase->spineTop axis per frame; radius measured off the
 * GLB bind-pose mesh, body vs garment meshes), minus nominal arm-tissue
 * radius (UNSOURCED, stated). Negative = penetration. Plus shoulder
 * abduction and elbow flexion at rest.
 *
 * (b) writer attribution for the walking-swing shortfall: shoulder ROM over
 * early-walk (first 0.4 s, inside the upper-body blend-in) vs mid-walk vs
 * full-walk, settling-ROM (legWeight 0.4 / stepping-turn leg ownership),
 * and arm-leg phase lag with/without the blend-in transient. Code-path
 * writers that cannot move arms (settled-posture delta, settled posture
 * correction, idle-life, head-lead) are named with file:line refs.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/arms-meter.ts \
 *     --physician=.openclinxr/evidence/upper-body/sc05-physician \
 *     --nurse=.openclinxr/evidence/upper-body/sc05-nurse \
 *     --child=.openclinxr/evidence/upper-body/sc05-child \
 *     --bound-glb=apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb \
 *     --nurse-glb=apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb \
 *     --child-glb=apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb \
 *     --out=.openclinxr/evidence/arms/measure.json
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import {
  elbowFlexionDeg,
  forwardOfHeading,
  meanOf,
  rangeOf,
  rightOfHeading,
  shoulderAngleDeg,
} from "./upper-body-meter.js";

export type Vec3 = { x: number; y: number; z: number };

type UpperBodyProbe = {
  pelvisL: Vec3 | null;
  pelvisR: Vec3 | null;
  spineBase: Vec3 | null;
  spineTop: Vec3 | null;
  shoulderL: Vec3 | null;
  shoulderR: Vec3 | null;
  elbowL: Vec3 | null;
  elbowR: Vec3 | null;
  wristL: Vec3 | null;
  wristR: Vec3 | null;
};

type CapFrame = {
  phase: string | null;
  travelHeading?: number | null;
  slot?: { x: number; y: number; z: number; yaw: number } | null;
  upperBody?: UpperBodyProbe | null;
};

const FRAME_SECONDS = 1 / 30;
/** Upper-body ownership 0->1 window at walk start (locomotion-clip-playback-mod). */
const BLEND_IN_S = 0.4;
const BLEND_IN_FRAMES = Math.round(BLEND_IN_S / FRAME_SECONDS);
/**
 * Nominal upper-arm/forearm tissue radius subtracted after the capsule
 * surface distance. UNSOURCED nominal (adult upper-arm diameter ~9-11 cm):
 * the gate margin (+0.01 m) is evaluated on the capsule-surface distance,
 * this only shifts the reported number, stated here, not hidden.
 */
const ARM_TISSUE_RADIUS_M = 0.05;

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function norm(v: Vec3): Vec3 | null {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : null;
}

function distPointSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (!(len2 > 1e-12)) return Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2));
  const c = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
  return Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
}

/**
 * Shoulder abduction (deg): frontal-plane angle of the upper-arm direction
 * from the downward trunk line. Positive = away from the body side plane,
 * negative = across/into the torso. `leftRef` is the body's anatomical LEFT
 * unit vector in world XZ (NOT rightOfHeading: that helper returns body-left
 * for the meter's lateral-coordinate convention — verified: facing +z,
 * rightOfHeading(0) = +x = the side the left arm hangs on).
 */
export function abductionDeg(sh: Vec3, el: Vec3, up: Vec3, leftRef: Vec3, isLeft: boolean): number {
  const a = sub(el, sh);
  const lateralOut = dot(a, leftRef) * (isLeft ? 1 : -1);
  const down = -dot(a, up);
  return (Math.atan2(lateralOut, down) * 180) / Math.PI;
}

function mid(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/** Torso cross-section (bind-pose GLB meters) measured off skinned meshes. */
export type TorsoBand = { rx: number; rz: number; r: number; n: number };

/** Torso capsule radii (bind-pose GLB meters) measured off skinned meshes. */
export type TorsoRadii = {
  glb: string;
  /**
   * Per-5cm-band HALF-EXTENTS: rx = side (x) half-width, rz = front-back (z)
   * half-depth, r = max radial (legacy circular). The torso is genuinely
   * elliptical (physician waist: rx 0.137 vs rz 0.163 bind); the circular
   * max lets diagonal belly fat veto the side wall where the arm hangs, so
   * the primary clearance uses the ellipse and the circle rides as
   * sensitivity. Body = *_body mesh, dressed = body + shirt/coat/gown.
   */
  bodyBandsM: Record<string, TorsoBand>;
  bodyVerts: number;
  dressedBandsM: Record<string, TorsoBand>;
  dressedVerts: number;
  dressedMeshes: string[];
  bindShoulderSpanM: number;
};

const TORSO_JOINT_SUBSTR = ["pelvis", "spine"];

function isTorsoJoint(name: string): boolean {
  const n = name.toLowerCase().replaceAll(".", "");
  if (n.includes("upperleg") || n.includes("lowerleg") || n.includes("clavicle")
    || n.includes("shoulder") || n.includes("upperarm") || n.includes("neck") || n.includes("head")) return false;
  return TORSO_JOINT_SUBSTR.some((s) => n.includes(s));
}

/**
 * Perp-distance profile of torso-dominated mesh vertices to the bind spine
 * axis (spine05->spine01), bucketed per 5 cm bind-height band: side (x)
 * half-width, front-back (z) half-depth, and max radial. `meshFilter`
 * selects body vs garment meshes.
 */
export async function torsoRadiusFromGlb(
  glbPath: string,
  meshFilter: (meshName: string) => boolean,
): Promise<{ bandsM: Record<string, TorsoBand>; verts: number; meshes: string[]; bindShoulderSpanM: number }> {
  const doc = await new NodeIO().read(glbPath);
  const root = doc.getRoot();
  const skins = root.listSkins();
  if (skins.length === 0) throw new Error(`no skins in ${glbPath}`);
  const joints = skins[0]!.listJoints();
  const jointName = (i: number): string => joints[i]?.getName() ?? "";
  // Bind world positions: compose node TRS along parents.
  const nodes = root.listNodes();
  const parentOf = new Map<string, string>();
  for (const n of nodes) for (const c of n.listChildren()) parentOf.set(c.getName(), n.getName());
  const byName = new Map(nodes.map((n) => [n.getName(), n]));
  const bindWorld = (name: string): Vec3 => {
    const chain: string[] = [];
    let cur: string | undefined = name;
    while (cur) {
      chain.unshift(cur);
      cur = parentOf.get(cur);
    }
    let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const mul = (a: number[], b: number[]): number[] => {
      const o = new Array<number>(16).fill(0);
      for (let r = 0; r < 4; r += 1)
        for (let c = 0; c < 4; c += 1)
          o[c * 4 + r] = a[0 * 4 + r]! * b[c * 4 + 0]! + a[1 * 4 + r]! * b[c * 4 + 1]! + a[2 * 4 + r]! * b[c * 4 + 2]! + a[3 * 4 + r]! * b[c * 4 + 3]!;
      return o;
    };
    for (const n of chain) {
      const node = byName.get(n);
      if (!node) continue;
      const tr = (node.getTranslation() ?? [0, 0, 0]) as number[];
      const ro = (node.getRotation() ?? [0, 0, 0, 1]) as number[];
      const sc = (node.getScale() ?? [1, 1, 1]) as number[];
      const [x, y, z, w] = ro;
      const R = [
        1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y),
        2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x),
        2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y),
      ];
      const L = [
        R[0]! * sc[0]!, R[1]! * sc[0]!, R[2]! * sc[0]!, 0,
        R[3]! * sc[1]!, R[4]! * sc[1]!, R[5]! * sc[1]!, 0,
        R[6]! * sc[2]!, R[7]! * sc[2]!, R[8]! * sc[2]!, 0,
        tr[0]!, tr[1]!, tr[2]!, 1,
      ];
      m = mul(m, L);
    }
    return { x: m[12]!, y: m[13]!, z: m[14]! };
  };
  const base = bindWorld("spine05");
  const top = bindWorld("spine01");
  const shL = bindWorld("shoulder01.L");
  const shR = bindWorld("shoulder01.R");
  const bindShoulderSpanM = Math.hypot(shL.x - shR.x, shL.y - shR.y, shL.z - shR.z);
  const bandsM: Record<string, TorsoBand> = {};
  let verts = 0;
  const meshes: string[] = [];
  for (const mesh of root.listMeshes()) {
    if (!meshFilter(mesh.getName())) continue;
    meshes.push(mesh.getName());
    for (const prim of mesh.listPrimitives()) {
      const sem = prim.listSemantics();
      const posA = prim.getAttribute(sem.indexOf("POSITION") >= 0 ? "POSITION" : "");
      void posA;
      const getAttr = (s: string) => {
        const idx = sem.indexOf(s);
        if (idx < 0) return null;
        return prim.listAttributes()[idx] ?? null;
      };
      const pos = getAttr("POSITION");
      const jointsA = getAttr("JOINTS_0");
      const weightsA = getAttr("WEIGHTS_0");
      if (!pos || !jointsA || !weightsA) continue;
      const pArr = pos.getArray() as ArrayLike<number>;
      const jArr = jointsA.getArray() as ArrayLike<number>;
      const wArr = weightsA.getArray() as ArrayLike<number>;
      const n = pos.getCount();
      for (let i = 0; i < n; i += 1) {
        let bi = 0;
        let bw = -1;
        for (let k = 0; k < 4; k += 1) {
          const w = wArr[i * 4 + k]!;
          if (w > bw) {
            bw = w;
            bi = jArr[i * 4 + k]!;
          }
        }
        if (!isTorsoJoint(jointName(bi))) continue;
        const p = { x: pArr[i * 3]!, y: pArr[i * 3 + 1]!, z: pArr[i * 3 + 2]! };
        // Offsets in a spine-aligned frame: lateral (x) vs depth (z). Bind
        // spines are near-upright, so bind x/z stand in for side/depth.
        const dx = p.x - (base.x + (top.x - base.x) * Math.min(1, Math.max(0, (p.y - base.y) / ((top.y - base.y) || 1))));
        const dz = p.z - (base.z + (top.z - base.z) * Math.min(1, Math.max(0, (p.y - base.y) / ((top.y - base.y) || 1))));
        const d = distPointSegment(p, base, top);
        if (!(d > 0)) continue;
        const band = (Math.floor(p.y / 0.05) * 0.05).toFixed(2);
        const entry = bandsM[band] ?? { rx: 0, rz: 0, r: 0, n: 0 };
        entry.rx = Math.max(entry.rx, Math.abs(dx));
        entry.rz = Math.max(entry.rz, Math.abs(dz));
        entry.r = Math.max(entry.r, d);
        entry.n += 1;
        bandsM[band] = entry;
        verts += 1;
      }
    }
  }
  return { bandsM, verts, meshes, bindShoulderSpanM };
}

function arg(name: string): string | null {
  const key = name.startsWith("--") ? name.slice(2) : name;
  return process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? null;
}

async function readRunFiles(dir: string): Promise<Array<{ tag: string; frames: CapFrame[]; urlQuery?: string }>> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json") && f.startsWith("sc05-run")).sort();
  const out: Array<{ tag: string; frames: CapFrame[]; urlQuery?: string }> = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(dir, file), "utf8")) as {
      frames: CapFrame[];
      urlQuery?: string;
    };
    if (!Array.isArray(raw.frames)) continue;
    out.push({ tag: file.replace(/\.json$/, ""), frames: raw.frames, urlQuery: raw.urlQuery });
  }
  return out;
}

type ClearanceStats = {
  minWrist: number | null;
  minMidFore: number | null;
  minElbow: number | null;
  minAny: number | null;
  minL: number | null;
  minR: number | null;
  minAnyCircularTissue: number | null;
  nFrames: number;
};

function analyzeClearance(
  frames: CapFrame[],
  bandsM: Record<string, TorsoBand>,
  liveScale: number,
): ClearanceStats & { abdRestMean: number | null; abdRestMax: number | null; abdRestMin: number | null; abdRestL: number | null; abdRestR: number | null; elbowRestMean: number | null; abdRestStd: number | null } {
  const bandAt = (liveY: number): TorsoBand | null => {
    if (!(liveScale > 0)) return null;
    const bindY = liveY / liveScale;
    const keys = Object.keys(bandsM).map(Number).sort((a, b) => a - b);
    if (keys.length === 0) return null;
    let pick = keys[0]!;
    for (const k of keys) {
      if (k <= bindY) pick = k;
      else break;
    }
    return bandsM[pick.toFixed(2)]!;
  };
  /**
   * Primary clearance: literal point-to-elliptical-surface distance.
   * Offsets are decomposed in the per-frame body frame (slot yaw): lateral
   * against rx, depth against rz; k = normalized radius (1 = on surface);
   * meters ≈ (k-1) x geometric-mean radius. No tissue allowance: the brief's
   * "negative = penetration" reads the joint CENTRE against the surface.
   */
  const ellipticalClearance = (p: Vec3, base: Vec3, top: Vec3, band: TorsoBand, yaw: number): number => {
    const ab = sub(top, base);
    const len2 = dot(ab, ab);
    const t = !(len2 > 1e-12) ? 0 : Math.min(1, Math.max(0, dot(sub(p, base), ab) / len2));
    const c = { x: base.x + ab.x * t, y: base.y + ab.y * t, z: base.z + ab.z * t };
    const ox = p.x - c.x;
    const oz = p.z - c.z;
    const left = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const lat = ox * left.x + oz * left.z;
    const dep = ox * fwd.x + oz * fwd.z;
    const rx = band.rx * liveScale;
    const rz = band.rz * liveScale;
    if (!(rx > 1e-6 && rz > 1e-6)) return Number.NaN;
    const k = Math.sqrt((lat / rx) ** 2 + (dep / rz) ** 2);
    return (k - 1) * Math.sqrt(rx * rz);
  };
  // Secondary (sensitivity): circular max-radial capsule minus arm tissue.
  const circularClearance = (p: Vec3, base: Vec3, top: Vec3, band: TorsoBand): number =>
    distPointSegment(p, base, top) - band.r * liveScale - ARM_TISSUE_RADIUS_M;
  // Post-walk = every frame after walk end (settling + arrived).
  const post = frames.filter((f) => f.phase !== null && f.phase !== "walking" && f.upperBody);
  const clears: number[] = [];
  const clearsL: number[] = [];
  const clearsR: number[] = [];
  const circ: number[] = [];
  let minW: number | null = null;
  let minM: number | null = null;
  let minE: number | null = null;
  for (const f of post) {
    const u = f.upperBody!;
    if (!u.spineBase || !u.spineTop) continue;
    const yaw = f.slot !== null && f.slot !== undefined && Number.isFinite(f.slot.yaw) ? f.slot.yaw : 0;
    const pts: Array<{ p: Vec3 | null; kind: "w" | "m" | "e"; side: "L" | "R" }> = [];
    if (u.wristL && u.elbowL) {
      pts.push({ p: u.wristL, kind: "w", side: "L" });
      pts.push({ p: mid(u.elbowL, u.wristL), kind: "m", side: "L" });
      pts.push({ p: u.elbowL, kind: "e", side: "L" });
    }
    if (u.wristR && u.elbowR) {
      pts.push({ p: u.wristR, kind: "w", side: "R" });
      pts.push({ p: mid(u.elbowR, u.wristR), kind: "m", side: "R" });
      pts.push({ p: u.elbowR, kind: "e", side: "R" });
    }
    for (const { p, kind, side } of pts) {
      if (!p) continue;
      const band = bandAt(p.y);
      if (band === null) continue;
      const c = ellipticalClearance(p, u.spineBase, u.spineTop, band, yaw);
      if (!Number.isFinite(c)) continue;
      clears.push(c);
      circ.push(circularClearance(p, u.spineBase, u.spineTop, band));
      (side === "L" ? clearsL : clearsR).push(c);
      if (kind === "w") minW = minW === null ? c : Math.min(minW, c);
      if (kind === "m") minM = minM === null ? c : Math.min(minM, c);
      if (kind === "e") minE = minE === null ? c : Math.min(minE, c);
    }
  }
  // Rest pose: last 30 arrived frames.
  const arrived = frames.filter((f) => f.phase === "arrived" && f.upperBody);
  const rest = arrived.slice(-30);
  // Rest pose: last 30 arrived frames. Heading per frame from the slot yaw
  // (the trunk yaws away from travel heading after the turn; travel heading
  // leaks symmetric forward pitch into asymmetric lateral bias, ~15 deg).
  const abdsL: number[] = [];
  const abdsR: number[] = [];
  const els: number[] = [];
  for (const f of rest) {
    const u = f.upperBody!;
    const up = u.spineBase && u.spineTop ? norm(sub(u.spineTop, u.spineBase)) : null;
    if (!up) continue;
    const h = f.slot !== null && f.slot !== undefined && Number.isFinite(f.slot.yaw) ? f.slot.yaw : 0;
    const r2 = rightOfHeading(h);
    const ref: Vec3 = { x: r2.x, y: 0, z: r2.z };
    if (u.shoulderL && u.elbowL) abdsL.push(abductionDeg(u.shoulderL, u.elbowL, up, ref, true));
    if (u.shoulderR && u.elbowR) abdsR.push(abductionDeg(u.shoulderR, u.elbowR, up, ref, false));
    if (u.shoulderL && u.elbowL && u.wristL) {
      const e = elbowFlexionDeg(u.shoulderL, u.elbowL, u.wristL);
      if (e !== null) els.push(e);
    }
    if (u.shoulderR && u.elbowR && u.wristR) {
      const e = elbowFlexionDeg(u.shoulderR, u.elbowR, u.wristR);
      if (e !== null) els.push(e);
    }
  }
  const abdMean = meanOf([...abdsL, ...abdsR]);
  const abdStd = abdsL.length + abdsR.length > 1 && abdMean !== null
    ? Math.sqrt(meanOf([...abdsL, ...abdsR].map((v) => (v - abdMean!) ** 2)) ?? 0)
    : null;
  const abds = [...abdsL, ...abdsR];
  return {
    minWrist: minW,
    minMidFore: minM,
    minElbow: minE,
    minAny: clears.length > 0 ? Math.min(...clears) : null,
    minL: clearsL.length > 0 ? Math.min(...clearsL) : null,
    minR: clearsR.length > 0 ? Math.min(...clearsR) : null,
    minAnyCircularTissue: circ.length > 0 ? Math.min(...circ) : null,
    nFrames: post.length,
    abdRestMean: abdMean,
    abdRestMax: abds.length > 0 ? Math.max(...abds) : null,
    abdRestMin: abds.length > 0 ? Math.min(...abds) : null,
    abdRestL: meanOf(abdsL),
    abdRestR: meanOf(abdsR),
    abdRestStd: abdStd,
    elbowRestMean: meanOf(els),
  };
}

/** Max shoulder abduction per phase window (turn-flare hunt). */
function maxAbductionByPhase(frames: CapFrame[]): Record<string, { max: number | null; frameIndex: number | null }> {
  const out: Record<string, { max: number | null; frameIndex: number | null }> = {};
  frames.forEach((f, i) => {
    const u = f.upperBody;
    if (!u?.spineBase || !u?.spineTop) return;
    const up = norm(sub(u.spineTop, u.spineBase));
    if (!up) return;
    // Per-frame slot yaw (the trunk yaws during settling; a stale travel
    // heading fabricates flare out of symmetric forward pitch).
    const h = f.slot !== null && f.slot !== undefined && Number.isFinite(f.slot.yaw) ? f.slot.yaw : 0;
    const r2 = rightOfHeading(h);
    const ref: Vec3 = { x: r2.x, y: 0, z: r2.z };
    const vals: number[] = [];
    if (u.shoulderL && u.elbowL) vals.push(abductionDeg(u.shoulderL, u.elbowL, up, ref, true));
    if (u.shoulderR && u.elbowR) vals.push(abductionDeg(u.shoulderR, u.elbowR, up, ref, false));
    if (vals.length === 0) return;
    const m = Math.max(...vals);
    const ph = f.phase ?? "null";
    const cur = out[ph] ?? { max: null, frameIndex: null };
    if (cur.max === null || m > cur.max) out[ph] = { max: m, frameIndex: i };
  });
  return out;
}

function walkingShoulderSeries(frames: CapFrame[]): { shL: number[]; shR: number[]; nWalking: number } | null {
  const walking = frames.filter((f) => f.phase === "walking" && f.upperBody);
  if (walking.length === 0) return null;
  const lastWalk = walking[walking.length - 1]!;
  let heading = lastWalk.travelHeading ?? null;
  if (typeof heading !== "number" || !Number.isFinite(heading)) heading = 0;
  const fwd = forwardOfHeading(heading);
  const shL: number[] = [];
  const shR: number[] = [];
  for (const f of walking) {
    const u = f.upperBody!;
    const up = u.spineBase && u.spineTop ? norm(sub(u.spineTop, u.spineBase)) : null;
    if (!up) {
      shL.push(NaN);
      shR.push(NaN);
      continue;
    }
    shL.push(u.shoulderL && u.elbowL ? shoulderAngleDeg(u.shoulderL, u.elbowL, up, fwd) : NaN);
    shR.push(u.shoulderR && u.elbowR ? shoulderAngleDeg(u.shoulderR, u.elbowR, up, fwd) : NaN);
  }
  return { shL, shR, nWalking: walking.length };
}

async function main(): Promise<void> {
  const physicianDir = arg("--physician");
  const nurseDir = arg("--nurse");
  const childDir = arg("--child");
  const boundGlb = arg("--bound-glb");
  const nurseGlb = arg("--nurse-glb");
  const childGlb = arg("--child-glb");
  const outPath = arg("--out");
  if (!physicianDir || !nurseDir || !childDir || !boundGlb || !nurseGlb || !childGlb || !outPath) {
    throw new Error("usage: arms-meter.ts --physician=dir --nurse=dir --child=dir --bound-glb=p --nurse-glb=p --child-glb=p --out=measure.json");
  }
  const isBodyMesh = (n: string): boolean => n.endsWith("_body");
  const isUpperGarment = (n: string): boolean => /shirt|coat|gown|t_shirt/i.test(n);
  const radii: Record<string, TorsoRadii> = {};
  for (const [key, glb] of [["physician", boundGlb], ["nurse", nurseGlb], ["child", childGlb]] as const) {
    const body = await torsoRadiusFromGlb(glb, isBodyMesh);
    const dressed = await torsoRadiusFromGlb(glb, (n) => isBodyMesh(n) || isUpperGarment(n));
    process.stdout.write(
      `[${key}] bodyBands=${JSON.stringify(body.bandsM)} dressedMeshes=${dressed.meshes.length}\n`,
    );
    radii[key] = {
      glb,
      bodyBandsM: body.bandsM,
      bodyVerts: body.verts,
      dressedBandsM: dressed.bandsM,
      dressedVerts: dressed.verts,
      dressedMeshes: dressed.meshes,
      bindShoulderSpanM: body.bindShoulderSpanM,
    };
  }

  const rigs: Record<string, unknown> = {};
  for (const [key, dir] of [["physician", physicianDir], ["nurse", nurseDir], ["child", childDir]] as const) {
    const runs = await readRunFiles(dir);
    if (runs.length === 0) throw new Error(`no sc05 run files in ${dir}`);
    // Live scale: median arrived shoulder span vs bind span.
    const spans: number[] = [];
    for (const { frames } of runs) {
      for (const f of frames) {
        const u = f.upperBody;
        if (f.phase === "arrived" && u?.shoulderL && u?.shoulderR) {
          spans.push(Math.hypot(u.shoulderL.x - u.shoulderR.x, u.shoulderL.y - u.shoulderR.y, u.shoulderL.z - u.shoulderR.z));
        }
      }
    }
    spans.sort((a, b) => a - b);
    const liveSpan = spans.length > 0 ? spans[Math.floor(spans.length / 2)]! : NaN;
    const scale = Number.isFinite(liveSpan) ? liveSpan / radii[key]!.bindShoulderSpanM : NaN;
    process.stdout.write(`[${key}] liveSpan=${Number.isFinite(liveSpan) ? liveSpan.toFixed(4) : "n/a"} scale=${Number.isFinite(scale) ? scale.toFixed(4) : "n/a"}\n`);

    const perRun = runs.map(({ tag, frames }) => {
      const cBody = analyzeClearance(frames, radii[key]!.bodyBandsM, scale);
      const cDressed = analyzeClearance(frames, radii[key]!.dressedBandsM, scale);
      const ws = walkingShoulderSeries(frames);
      const midWalk = ws === null ? null : {
        fullL: rangeOf(ws.shL.filter(Number.isFinite)),
        fullR: rangeOf(ws.shR.filter(Number.isFinite)),
        earlyL: rangeOf(ws.shL.slice(0, BLEND_IN_FRAMES).filter(Number.isFinite)),
        earlyR: rangeOf(ws.shR.slice(0, BLEND_IN_FRAMES).filter(Number.isFinite)),
        midL: rangeOf(ws.shL.slice(BLEND_IN_FRAMES, -6).filter(Number.isFinite)),
        midR: rangeOf(ws.shR.slice(BLEND_IN_FRAMES, -6).filter(Number.isFinite)),
      };
      // Phase lag full-walk vs transient-excluded (needs thigh series: not in
      // this tool's frame type; recompute from legWorlds-free proxy is out of
      // scope — lag reuse from upper-body measure.json instead).
      const flare = maxAbductionByPhase(frames);
      return { tag, urlQuery: "", nFrames: frames.length, clearanceBody: cBody, clearanceDressed: cDressed, walkingRom: midWalk, flare, nWalking: ws?.nWalking ?? 0 };
    });
    rigs[key] = { nRuns: runs.length, liveScale: scale, runs: perRun };
  }

  const result = {
    schemaVersion: "openclinxr.arms-measure.v1",
    measuredAt: new Date().toISOString(),
    constants: {
      frameSeconds: FRAME_SECONDS,
      blendInFrames: BLEND_IN_FRAMES,
      armTissueRadiusM: { value: ARM_TISSUE_RADIUS_M, provenance: "UNSOURCED nominal (adult upper-arm diameter ~9-11 cm)" },
      torsoRadiusMethod: "max perpendicular distance of torso-dominated (pelvis/spine, excl. limbs/clavicle/shoulder/neck/head) skinned vertices to the bind spine05->spine01 axis; body = *_body mesh, dressed = body + shirt/coat/gown meshes; scaled to live by arrived shoulder-span ratio",
    },
    radii,
    rigs,
  };
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`wrote ${outPath}\n`);
}

const invokedAsMain = (process.argv[1] ?? "").endsWith("arms-meter.ts");
if (invokedAsMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
