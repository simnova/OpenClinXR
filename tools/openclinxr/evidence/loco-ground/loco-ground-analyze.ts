/**
 * Locomotion proving-ground analysis (stage 3): per-writer tap table plus
 * label-independent steady-state metrics for one capture row, merged across
 * the three rows into `.openclinxr/evidence/loco-ground/report.json`.
 *
 * Usage: pnpm tsx tools/openclinxr/evidence/loco-ground/loco-ground-analyze.ts
 *
 * Labels are IMPORTED (the runtime's own stanceFoot per frame), never
 * re-derived. The contact band is the production constant
 * (FOOT_CONTACT_HEIGHT_METERS). Steady state drops the first and last gait
 * cycle (two contacts each end; one each end when fewer than six contacts),
 * reported with exclusion counts; start/stop transients reported separately.
 *
 * claimScope: arithmetic over the three loco-ground capture JSONs.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FOOT_CONTACT_HEIGHT_METERS } from "@openclinxr/asset-registry/approach-executor";
import { DEFAULT_LOCO_GROUND_MOVEMENT_ID, locoGroundMovementFromId } from "./loco-ground-movements.js";

const EVIDENCE_ROOT = ".openclinxr/evidence/loco-ground";
const ROWS = ["lockOff", "twoBone", "ccd"] as const;

type Xyz = { x: number; y: number; z: number };
type Quat = [number, number, number, number];
type TapPose = {
  quat: Record<string, Quat | undefined>;
  toeWorld: { left: Xyz | null; right: Xyz | null };
  slot: { x: number; y: number; z: number; yaw: number } | null;
};
type TapMeta = {
  tMs: number;
  actorId: string;
  phase: string | null;
  evidenceSampleIndex: number;
  legWeightCurrent: number | null;
  actionTimeSeconds: number | null;
  actionTimeScale: number | null;
  actionPlaying: boolean | null;
  stanceLabel: string | null;
  lockArmed: boolean | null;
  lockStance: string | null;
  lockCorrection: { x: number; z: number } | null;
  heelMissM: number | null;
  actorScale: { x: number; y: number; z: number } | null;
  postureTags: Record<string, string | null | undefined>;
};
export type TapFrame = { frame: number; mixer: TapPose; posture: TapPose; rendered: TapPose; meta: TapMeta };
type EvSample = {
  atMs: number;
  phase: string;
  slot: { x: number; y: number; z: number; yaw: number } | null;
  leftToe: Xyz | null;
  rightToe: Xyz | null;
  stanceFoot: string | null;
};

function quatAngleDeg(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function max(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function xzStep(a: { x: number; z: number } | null, b: { x: number; z: number } | null): number | null {
  if (a === null || b === null) return null;
  return Math.hypot(a.x - b.x, a.z - b.z);
}

type WriterRow = {
  bone: string;
  abMaxDeg: number;
  abMedianDeg: number;
  bcMaxDeg: number;
  bcMedianDeg: number;
};

export type RowReport = {
  row: string;
  urlQuery: string;
  distMarker: unknown;
  routeLengthMeters: number;
  video: string;
  walkingTapFrames: number;
  evidenceJoinMatched: number;
  evidenceJoinUnmatched: number;
  contacts: number;
  strides: number;
  steadyDefinition: string;
  steadyFrames: number;
  excludedFrames: Record<string, number>;
  writerTable: WriterRow[];
  writersTouched: { afterPosture: string[]; afterLock: string[] };
  postureTagsDistinct: Array<string | null>;
  actionWeightRange: [number | null, number | null];
  actionTimeScale: number | null;
  legWeightRange: [number | null, number | null];
  lockCorrectionMedianM: number | null;
  heelMissMaxM: number | null;
  actorScale: { x: number; y: number; z: number } | null;
  plannedSpeedMps: number | null;
  steadyRootSpeedMps: number | null;
  perFoot: Record<string, {
    worldStationaryFraction: number | null;
    kinematicContactFraction: number | null;
    lowerFootSpeedMedianMps: number | null;
    lowerFootSpeedMaxMps: number | null;
    swingToeHeightMaxM: number | null;
    mixerSwingToeHeightMaxM: number | null;
    bodyFrameSpeedMedianMps: number | null;
    mixerBodyFrameSpeedMedianMps: number | null;
  }>;
  releaseStepMaxM: number | null;
  releaseTransitions: number;
  transientStart: { frames: number; stationaryLeft: number | null; stationaryRight: number | null; maxStepM: number | null };
  transientStop: { frames: number; stationaryLeft: number | null; stationaryRight: number | null; maxStepM: number | null };
};

function toeOf(pose: TapPose, foot: "left" | "right"): Xyz | null {
  return foot === "left" ? pose.toeWorld.left : pose.toeWorld.right;
}

export function analyzeRow(row: string, capture: {
  urlQuery: string;
  distMarker: unknown;
  routeLengthMeters: number;
  video: string;
  evidence: {
    clipAdvance: number | null;
    startWorld: Xyz | null;
    targetWorld: Xyz | null;
    samples: EvSample[];
  };
  tap: TapFrame[];
}): RowReport {
  const ev = capture.evidence;
  const route = ev.startWorld !== null && ev.targetWorld !== null
    ? { x: ev.targetWorld.x - ev.startWorld.x, z: ev.targetWorld.z - ev.startWorld.z }
    : { x: 1, z: 0 };
  const routeLen = Math.hypot(route.x, route.z) || 1;
  const unit = { x: route.x / routeLen, z: route.z / routeLen };

  // Walking tap frames with an armed lock (the first walking frame still
  // holds the idle pose), joined to evidence samples by fake-clock tMs.
  const walking = capture.tap.filter((t) => t.meta.phase === "walking");
  const armed = walking.filter((t) => t.meta.lockArmed === true);
  const evByMs = new Map<number, number>();
  ev.samples.forEach((s, i) => evByMs.set(s.atMs, i));
  let matched = 0;
  for (const t of armed) {
    if (evByMs.has(t.meta.tMs)) matched += 1;
  }

  // Contacts: maximal runs of equal non-null stanceLabel, length >= 2.
  const labels = armed.map((t) => t.meta.stanceLabel);
  const contacts: Array<{ foot: string; idx: number[] }> = [];
  let open: { foot: string; idx: number[] } | null = null;
  let droppedZeroLength = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    if (label !== "left" && label !== "right") {
      if (open !== null) {
        if (open.idx.length < 2) droppedZeroLength += 1;
        else contacts.push(open);
        open = null;
      }
      continue;
    }
    if (open !== null && open.foot !== label) {
      if (open.idx.length < 2) droppedZeroLength += 1;
      else contacts.push(open);
      open = null;
    }
    if (open === null) open = { foot: label, idx: [] };
    open.idx.push(i);
  }
  if (open !== null) {
    if (open.idx.length < 2) droppedZeroLength += 1;
    else contacts.push(open);
  }

  const dropEachEnd = contacts.length >= 6 ? 2 : 1;
  const steadyContacts = contacts.slice(dropEachEnd, contacts.length - dropEachEnd);
  const steady = new Set<number>();
  for (const c of steadyContacts) for (const i of c.idx) steady.add(i);
  const transientStartIdx = new Set<number>();
  for (const c of contacts.slice(0, dropEachEnd)) for (const i of c.idx) transientStartIdx.add(i);
  const transientStopIdx = new Set<number>();
  for (const c of contacts.slice(contacts.length - dropEachEnd)) for (const i of c.idx) transientStopIdx.add(i);

  const nullLabelFrames = labels.filter((l) => l !== "left" && l !== "right").length;

  // Writer table over ALL armed walking frames (writers run every frame).
  const bones = Object.keys(armed[0]?.mixer.quat ?? {});
  const writerTable: WriterRow[] = bones.map((bone) => {
    const ab: number[] = [];
    const bc: number[] = [];
    for (const t of armed) {
      const qa = t.mixer.quat[bone];
      const qb = t.posture.quat[bone];
      const qc = t.rendered.quat[bone];
      if (qa && qb) ab.push(quatAngleDeg(qa, qb));
      if (qb && qc) bc.push(quatAngleDeg(qb, qc));
    }
    return { bone, abMaxDeg: max(ab), abMedianDeg: median(ab), bcMaxDeg: max(bc), bcMedianDeg: median(bc) };
  });
  const writersTouched = {
    afterPosture: writerTable.filter((r) => r.abMaxDeg > 1).map((r) => `${r.bone}:${r.abMaxDeg.toFixed(2)}deg`),
    afterLock: writerTable.filter((r) => r.bcMaxDeg > 1).map((r) => `${r.bone}:${r.bcMaxDeg.toFixed(2)}deg`),
  };

  // Proxy floors (walk-minimum toe Y) per source, over armed walking frames.
  const floorRendered = minToeY(armed.map((t) => t.rendered));
  const floorMixer = minToeY(armed.map((t) => t.mixer));

  // Body-frame along-route deltas per foot per source, per frame (i > 0).
  const steadyList = [...steady].sort((a, b) => a - b);
  const perFoot: RowReport["perFoot"] = {};
  for (const foot of ["left", "right"] as const) {
    // Rendered world-stationary fraction over steady frames.
    let stat = 0;
    let statDenom = 0;
    let noMotion = 0;
    for (const i of steadyList) {
      if (i === 0) continue;
      const cur = armed[i];
      const prev = armed[i - 1];
      if (!cur || !prev) continue;
      const rootStep = xzStep(cur.rendered.slot, prev.rendered.slot);
      const footStep = xzStep(toeOf(cur.rendered, foot), toeOf(prev.rendered, foot));
      if (rootStep === null || footStep === null) continue;
      if (rootStep < 0.0005) {
        noMotion += 1;
        continue;
      }
      statDenom += 1;
      if (footStep < 0.25 * rootStep) stat += 1;
    }
    // Kinematic contact fraction from the (a) pose: height under the band
    // with body-frame backward speed >= half the foot's own steady peak.
    const speeds: Array<{ i: number; v: number }> = [];
    for (const i of steadyList) {
      if (i === 0) continue;
      const cur = armed[i];
      const prev = armed[i - 1];
      if (!cur || !prev) continue;
      const ct = toeOf(cur.mixer, foot);
      const pt = toeOf(prev.mixer, foot);
      const cs = cur.mixer.slot;
      const ps = prev.mixer.slot;
      if (!ct || !pt || !cs || !ps) continue;
      const dtS = (cur.meta.tMs - prev.meta.tMs) / 1000;
      if (!(dtS > 0)) continue;
      const along = ((ct.x - pt.x - (cs.x - ps.x)) * unit.x + (ct.z - pt.z - (cs.z - ps.z)) * unit.z);
      speeds.push({ i, v: -along / dtS });
    }
    const peak = max(speeds.map((s) => s.v));
    let kin = 0;
    let kinDenom = 0;
    for (const s of speeds) {
      const t = armed[s.i];
      if (!t) continue;
      const toe = toeOf(t.mixer, foot);
      if (!toe || floorMixer === null) continue;
      kinDenom += 1;
      if (toe.y - floorMixer < FOOT_CONTACT_HEIGHT_METERS && peak > 0 && s.v >= 0.5 * peak) kin += 1;
    }
    // Lower-foot world speed (rendered, steady) and swing toe heights.
    const lowerSpeeds: number[] = [];
    for (const i of steadyList) {
      if (i === 0) continue;
      const cur = armed[i];
      const prev = armed[i - 1];
      if (!cur || !prev) continue;
      const lt = toeOf(cur.rendered, "left");
      const rt = toeOf(cur.rendered, "right");
      if (!lt || !rt) continue;
      const lower = lt.y <= rt.y ? "left" as const : "right" as const;
      if (lower !== foot) continue;
      const ct = toeOf(cur.rendered, foot);
      const pt = toeOf(prev.rendered, foot);
      if (!ct || !pt) continue;
      const dtS = (cur.meta.tMs - prev.meta.tMs) / 1000;
      if (!(dtS > 0)) continue;
      const step = xzStep(ct, pt);
      if (step !== null) lowerSpeeds.push(step / dtS);
    }
    let swingMax: number | null = null;
    let mixerSwingMax: number | null = null;
    const bodySpeeds: number[] = [];
    const mixerBodySpeeds: number[] = [];
    for (const i of steadyList) {
      const t = armed[i];
      if (!t) continue;
      if (t.meta.stanceLabel !== foot && floorRendered !== null) {
        const toe = toeOf(t.rendered, foot);
        if (toe) {
          const h = toe.y - floorRendered;
          if (swingMax === null || h > swingMax) swingMax = h;
        }
      }
      if (t.meta.stanceLabel !== foot && floorMixer !== null) {
        const toe = toeOf(t.mixer, foot);
        if (toe) {
          const h = toe.y - floorMixer;
          if (mixerSwingMax === null || h > mixerSwingMax) mixerSwingMax = h;
        }
      }
      if (i === 0) continue;
      const prev = armed[i - 1];
      if (!prev) continue;
      const dtS = (t.meta.tMs - prev.meta.tMs) / 1000;
      if (!(dtS > 0)) continue;
      const ct = toeOf(t.rendered, foot);
      const pt = toeOf(prev.rendered, foot);
      const cs = t.rendered.slot;
      const ps = prev.rendered.slot;
      if (ct && pt && cs && ps) {
        bodySpeeds.push(Math.hypot(ct.x - pt.x - (cs.x - ps.x), ct.z - pt.z - (cs.z - ps.z)) / dtS);
      }
      const mc = toeOf(t.mixer, foot);
      const mp = toeOf(prev.mixer, foot);
      const ms = t.mixer.slot;
      const mps = prev.mixer.slot;
      if (mc && mp && ms && mps) {
        mixerBodySpeeds.push(Math.hypot(mc.x - mp.x - (ms.x - mps.x), mc.z - mp.z - (ms.z - mps.z)) / dtS);
      }
    }
    perFoot[foot] = {
      worldStationaryFraction: statDenom > 0 ? stat / statDenom : null,
      kinematicContactFraction: kinDenom > 0 ? kin / kinDenom : null,
      lowerFootSpeedMedianMps: lowerSpeeds.length > 0 ? median(lowerSpeeds) : null,
      lowerFootSpeedMaxMps: lowerSpeeds.length > 0 ? max(lowerSpeeds) : null,
      swingToeHeightMaxM: swingMax,
      mixerSwingToeHeightMaxM: mixerSwingMax,
      bodyFrameSpeedMedianMps: bodySpeeds.length > 0 ? median(bodySpeeds) : null,
      mixerBodyFrameSpeedMedianMps: mixerBodySpeeds.length > 0 ? median(mixerBodySpeeds) : null,
    };
    void noMotion;
  }

  // Release events: max one-frame rendered step of the previously-stance foot.
  let releaseMax: number | null = null;
  let releaseCount = 0;
  for (let i = 1; i < armed.length; i += 1) {
    const prev = armed[i - 1];
    const cur = armed[i];
    if (!prev || !cur) continue;
    if (cur.meta.stanceLabel === prev.meta.stanceLabel) continue;
    const foot = prev.meta.stanceLabel === "left" || prev.meta.stanceLabel === "right" ? prev.meta.stanceLabel : null;
    if (foot === null) continue;
    const step = xzStep(toeOf(cur.rendered, foot), toeOf(prev.rendered, foot));
    if (step === null) continue;
    releaseCount += 1;
    if (releaseMax === null || step > releaseMax) releaseMax = step;
  }

  // Steady root speed (world) vs planned.
  let travel = 0;
  let spanS = 0;
  if (steadyList.length >= 2) {
    const first = armed[steadyList[0] ?? 0];
    const last = armed[steadyList[steadyList.length - 1] ?? 0];
    if (first && last) {
      spanS = (last.meta.tMs - first.meta.tMs) / 1000;
      for (let k = 1; k < steadyList.length; k += 1) {
        const a = armed[steadyList[k - 1] ?? 0];
        const b = armed[steadyList[k] ?? 0];
        if (!a || !b) continue;
        const step = xzStep(b.rendered.slot, a.rendered.slot);
        if (step !== null) travel += step;
      }
    }
  }

  const transient = (set: Set<number>): RowReport["transientStart"] => {
    const list = [...set].sort((a, b) => a - b);
    const frac = (foot: "left" | "right"): number | null => {
      let s = 0;
      let d = 0;
      for (const i of list) {
        if (i === 0) continue;
        const cur = armed[i];
        const prev = armed[i - 1];
        if (!cur || !prev) continue;
        const rootStep = xzStep(cur.rendered.slot, prev.rendered.slot);
        const footStep = xzStep(toeOf(cur.rendered, foot), toeOf(prev.rendered, foot));
        if (rootStep === null || footStep === null || rootStep < 0.0005) continue;
        d += 1;
        if (footStep < 0.25 * rootStep) s += 1;
      }
      return d > 0 ? s / d : null;
    };
    let maxStep: number | null = null;
    for (const i of list) {
      if (i === 0) continue;
      const cur = armed[i];
      const prev = armed[i - 1];
      if (!cur || !prev) continue;
      for (const foot of ["left", "right"] as const) {
        const step = xzStep(toeOf(cur.rendered, foot), toeOf(prev.rendered, foot));
        if (step !== null && (maxStep === null || step > maxStep)) maxStep = step;
      }
    }
    return { frames: list.length, stationaryLeft: frac("left"), stationaryRight: frac("right"), maxStepM: maxStep };
  };

  const legWeights = armed.map((t) => t.meta.legWeightCurrent).filter((v): v is number => typeof v === "number");
  const actionWeights: number[] = [];
  void actionWeights;
  const corrections = armed
    .map((t) => (t.meta.lockCorrection ? Math.hypot(t.meta.lockCorrection.x, t.meta.lockCorrection.z) : null))
    .filter((v): v is number => typeof v === "number");
  const heelMisses = armed
    .map((t) => t.meta.heelMissM)
    .filter((v): v is number => typeof v === "number");
  const tags = new Set<string | null>();
  for (const t of armed) for (const v of Object.values(t.meta.postureTags)) tags.add(v ?? null);

  return {
    row,
    urlQuery: capture.urlQuery,
    distMarker: capture.distMarker,
    routeLengthMeters: capture.routeLengthMeters,
    video: capture.video,
    walkingTapFrames: walking.length,
    evidenceJoinMatched: matched,
    evidenceJoinUnmatched: armed.length - matched,
    contacts: contacts.length,
    strides: Math.floor(contacts.length / 2),
    steadyDefinition: contacts.length >= 6
      ? "drop first/last 2 contacts (first/last gait cycle)"
      : "drop first/last 1 contact (fewer than 6 contacts)",
    steadyFrames: steady.size,
    excludedFrames: {
      nonWalkingTap: capture.tap.length - walking.length,
      unarmedFirstWalking: walking.length - armed.length,
      nullLabelWalking: nullLabelFrames,
      droppedZeroLengthContacts: droppedZeroLength,
      transientStart: transientStartIdx.size,
      transientStop: transientStopIdx.size,
    },
    writerTable,
    writersTouched,
    postureTagsDistinct: [...tags],
    actionWeightRange: [null, null],
    actionTimeScale: armed[0]?.meta.actionTimeScale ?? null,
    legWeightRange: legWeights.length > 0 ? [Math.min(...legWeights), Math.max(...legWeights)] : [null, null],
    lockCorrectionMedianM: corrections.length > 0 ? median(corrections) : null,
    heelMissMaxM: heelMisses.length > 0 ? max(heelMisses) : null,
    actorScale: armed[0]?.meta.actorScale ?? null,
    plannedSpeedMps: ev.clipAdvance,
    steadyRootSpeedMps: spanS > 0 ? travel / spanS : null,
    perFoot,
    releaseStepMaxM: releaseMax,
    releaseTransitions: releaseCount,
    transientStart: transient(transientStartIdx),
    transientStop: transient(transientStopIdx),
  };
}

function minToeY(poses: TapPose[]): number | null {
  let floor: number | null = null;
  for (const p of poses) {
    for (const toe of [p.toeWorld.left, p.toeWorld.right]) {
      if (toe !== null && (floor === null || toe.y < floor)) floor = toe.y;
    }
  }
  return floor;
}

export type ClipInfo = { name: string; durationSeconds: number; trackCount: number };

/**
 * Read the movement clip's own name/duration/track count off an actor GLB
 * (JSON chunk + BIN times), not from a comment. The browser plays this take
 * through the retarget; these are the take's own numbers. clipMatch defaults
 * to "walk" (today's vehicle); pass the movement's match for other movements.
 */
export async function readWalkClipInfo(glbPath: string, clipMatch = "walk"): Promise<ClipInfo> {
  const buf = await readFile(glbPath);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
    animations?: Array<{ name?: string; channels?: unknown[]; samplers?: Array<{ input?: number }> }>;
    accessors?: Array<{ count?: number; bufferView?: number; byteOffset?: number }>;
    bufferViews?: Array<{ byteOffset?: number; byteLength?: number }>;
  };
  const anim = (json.animations ?? []).find((a) => (a.name ?? "").includes(clipMatch)) ?? null;
  if (anim === null) throw new Error(`no ${clipMatch} animation in ${glbPath}`);
  const binStart = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binStart);
  const bin = buf.subarray(binStart + 8, binStart + 8 + binLen);
  const samplerInput = anim.samplers?.[0]?.input ?? 0;
  const accessor = json.accessors?.[samplerInput];
  const view = accessor?.bufferView !== undefined ? json.bufferViews?.[accessor.bufferView] : undefined;
  if (!accessor || !view) throw new Error("walk clip time accessor unreadable");
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const count = accessor.count ?? 0;
  const times = new DataView(bin.buffer, bin.byteOffset + start, count * 4);
  let duration = 0;
  for (let i = 0; i < count; i += 1) {
    const t = times.getFloat32(i * 4, true);
    if (t > duration) duration = t;
  }
  return { name: anim.name ?? "(unnamed)", durationSeconds: duration, trackCount: anim.channels?.length ?? 0 };
}

export type ClipReport = {
  name: string;
  durationSeconds: number;
  trackCount: number;
  playedTimeScale: number | null;
  provenance: string;
  perFoot: Record<string, {
    kinematicContactFrames: number;
    stanceBackwardBodySpeedMedianMps: number | null;
    stanceBackwardBodySpeedCv: number | null;
    stationaryRootSpeedMps: number | null;
    strideLengthWorldM: number | null;
    cycleDurationPlayedS: number | null;
    cycleDurationAtTimeScale1S: number | null;
    swingToeHeightMaxM: number | null;
    swingToeMaxCyclePhase: number | null;
    kinematicDutyFactor: number | null;
  }>;
};

/**
 * Clip-level gait numbers from the mixer pose (tap a) of the lockOff row,
 * steady frames only, per foot. Kinematic contact = toe under the production
 * band moving backward in the body frame at >= half the foot's own steady
 * peak — the same rule as the row metrics, restricted to the (a) pose.
 */
export function analyzeClip(armed: TapFrame[], unit: { x: number; z: number }, info: ClipInfo, timeScale: number | null): ClipReport {
  const steadySet = analyzeRowSteady(armed);
  const steadyList = [...steadySet].sort((a, b) => a - b);
  const floorMixer = minToeY(armed.map((t) => t.mixer));
  const perFoot: ClipReport["perFoot"] = {};
  for (const foot of ["left", "right"] as const) {
    // Per-frame body-frame backward speed (mixer pose).
    const speedAt: Array<number | null> = armed.map(() => null);
    for (let i = 1; i < armed.length; i += 1) {
      const cur = armed[i];
      const prev = armed[i - 1];
      if (!cur || !prev) continue;
      const ct = toeOf(cur.mixer, foot);
      const pt = toeOf(prev.mixer, foot);
      const cs = cur.mixer.slot;
      const ps = prev.mixer.slot;
      if (!ct || !pt || !cs || !ps) continue;
      const dtS = (cur.meta.tMs - prev.meta.tMs) / 1000;
      if (!(dtS > 0)) continue;
      const along = ((ct.x - pt.x - (cs.x - ps.x)) * unit.x + (ct.z - pt.z - (cs.z - ps.z)) * unit.z);
      speedAt[i] = -along / dtS;
    }
    const steadySpeeds = steadyList.map((i) => speedAt[i]).filter((v): v is number => typeof v === "number");
    const peak = max(steadySpeeds);
    const kinIdx: number[] = [];
    for (const i of steadyList) {
      const t = armed[i];
      const v = speedAt[i];
      const toe = t ? toeOf(t.mixer, foot) : null;
      if (t === undefined || v === null || !toe || floorMixer === null) continue;
      if (toe.y - floorMixer < FOOT_CONTACT_HEIGHT_METERS && peak > 0 && v >= 0.5 * peak) kinIdx.push(i);
    }
    const stanceSpeeds = kinIdx.map((i) => speedAt[i]).filter((v): v is number => typeof v === "number");
    const med = stanceSpeeds.length > 0 ? median(stanceSpeeds) : null;
    const mean = stanceSpeeds.length > 0 ? stanceSpeeds.reduce((a, b) => a + b, 0) / stanceSpeeds.length : null;
    const std = mean !== null && stanceSpeeds.length > 1
      ? Math.sqrt(stanceSpeeds.reduce((a, b) => a + (b - mean) ** 2, 0) / (stanceSpeeds.length - 1))
      : null;
    // Kinematic episodes: maximal runs of contact frames; stride = root
    // travel between consecutive same-foot episode starts (world metres).
    const episodes: number[][] = [];
    let run: number[] = [];
    for (const i of kinIdx) {
      if (run.length > 0 && i !== run[run.length - 1]! + 1) {
        episodes.push(run);
        run = [];
      }
      run.push(i);
    }
    if (run.length > 0) episodes.push(run);
    const strides: number[] = [];
    const cycles: number[] = [];
    for (let k = 1; k < episodes.length; k += 1) {
      const a = armed[episodes[k - 1]![0]!];
      const b = armed[episodes[k]![0]!];
      if (!a || !b || !a.mixer.slot || !b.mixer.slot) continue;
      strides.push(Math.hypot(b.mixer.slot.x - a.mixer.slot.x, b.mixer.slot.z - a.mixer.slot.z));
      cycles.push((b.meta.tMs - a.meta.tMs) / 1000);
    }
    // Swing max and its phase in the cycle (0 = episode start, 1 = next).
    let swingMax: number | null = null;
    let swingMaxI = -1;
    const kinSet = new Set(kinIdx);
    for (const i of steadyList) {
      const t = armed[i];
      if (!t || kinSet.has(i) || floorMixer === null) continue;
      const toe = toeOf(t.mixer, foot);
      if (!toe) continue;
      const h = toe.y - floorMixer;
      if (swingMax === null || h > swingMax) {
        swingMax = h;
        swingMaxI = i;
      }
    }
    let swingPhase: number | null = null;
    if (swingMaxI >= 0 && episodes.length >= 2) {
      let prevStart: number | null = null;
      let nextStart: number | null = null;
      for (const ep of episodes) {
        if (ep[0]! <= swingMaxI) prevStart = ep[0]!;
        if (ep[0]! > swingMaxI && nextStart === null) nextStart = ep[0]!;
      }
      if (prevStart !== null && nextStart !== null && nextStart > prevStart) {
        swingPhase = (swingMaxI - prevStart) / (nextStart - prevStart);
      }
    }
    const cyclePlayed = cycles.length > 0 ? median(cycles) : null;
    perFoot[foot] = {
      kinematicContactFrames: kinIdx.length,
      stanceBackwardBodySpeedMedianMps: med,
      stanceBackwardBodySpeedCv: med !== null && std !== null && med !== 0 ? std / Math.abs(med) : null,
      stationaryRootSpeedMps: med,
      strideLengthWorldM: strides.length > 0 ? median(strides) : null,
      cycleDurationPlayedS: cyclePlayed,
      cycleDurationAtTimeScale1S: cyclePlayed !== null && timeScale ? cyclePlayed * timeScale : null,
      swingToeHeightMaxM: swingMax,
      swingToeMaxCyclePhase: swingPhase,
      kinematicDutyFactor: steadyList.length > 0 ? kinIdx.length / steadyList.length : null,
    };
  }
  return {
    name: info.name,
    durationSeconds: info.durationSeconds,
    trackCount: info.trackCount,
    playedTimeScale: timeScale,
    provenance:
      "Blender retarget via packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_from_positions_stage.py; "
      + "shipped in apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb (glTF-Transform v4.3.0); "
      + "source-take origin before the retarget not traced in this slice",
    perFoot,
  };
}

/** Steady index set shared with analyzeRow (same contact/drop rule). */
function analyzeRowSteady(armed: TapFrame[]): Set<number> {
  const labels = armed.map((t) => t.meta.stanceLabel);
  const contacts: Array<{ foot: string; idx: number[] }> = [];
  let open: { foot: string; idx: number[] } | null = null;
  const flush = (): void => {
    if (open !== null && open.idx.length >= 2) contacts.push(open);
    open = null;
  };
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    if (label !== "left" && label !== "right") {
      flush();
      continue;
    }
    if (open !== null && open.foot !== label) flush();
    if (open === null) open = { foot: label, idx: [] };
    open.idx.push(i);
  }
  flush();
  const drop = contacts.length >= 6 ? 2 : 1;
  const steady = new Set<number>();
  for (const c of contacts.slice(drop, contacts.length - drop)) for (const i of c.idx) steady.add(i);
  return steady;
}

async function main(): Promise<void> {
  const rows: Record<string, RowReport> = {};
  const raws: Record<string, Parameters<typeof analyzeRow>[1] & { tap: TapFrame[] }> = {};
  for (const row of ROWS) {
    const raw = JSON.parse(await readFile(path.join(EVIDENCE_ROOT, row, `loco-ground-${row}.json`), "utf8")) as Parameters<typeof analyzeRow>[1] & { tap: TapFrame[] };
    raws[row] = raw;
    rows[row] = analyzeRow(row, raw);
  }
  // Clip-level numbers from the lockOff mixer pose (tap a), steady only.
  const lockRaw = raws["lockOff"];
  let clip: ClipReport | null = null;
  if (lockRaw) {
    const movement = locoGroundMovementFromId(
      process.argv.find((a) => a.startsWith("--movement="))?.slice("--movement=".length)
        ?? DEFAULT_LOCO_GROUND_MOVEMENT_ID,
    );
    const info = await readWalkClipInfo(movement.actorGlb, movement.clipMatch);
    const ev = lockRaw.evidence;
    const route = ev.startWorld !== null && ev.targetWorld !== null
      ? { x: ev.targetWorld.x - ev.startWorld.x, z: ev.targetWorld.z - ev.startWorld.z }
      : { x: 1, z: 0 };
    const routeLen = Math.hypot(route.x, route.z) || 1;
    const armed = lockRaw.tap.filter((t) => t.meta.phase === "walking" && t.meta.lockArmed === true);
    clip = analyzeClip(armed, { x: route.x / routeLen, z: route.z / routeLen }, info, rows["lockOff"]?.actionTimeScale ?? null);
  }
  const report = {
    schemaVersion: "openclinxr.loco-ground-report.v1",
    measuredAt: new Date().toISOString(),
    contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
    rows,
    clip,
    claimScope: "per-writer tap angles and steady-state foot metrics for three browser loco-ground rows",
    notEvidenceFor: ["gait_realism", "clinical_plausibility", "quest_performance"],
  };
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const row of ROWS) {
    const r = rows[row];
    if (!r) continue;
    process.stdout.write(`\n=== ${row} === contacts=${r.contacts} strides=${r.strides} steadyFrames=${r.steadyFrames} (${r.steadyDefinition})\n`);
    process.stdout.write(`writers after-posture>1deg: ${r.writersTouched.afterPosture.join(" ") || "(none)"}\n`);
    process.stdout.write(`writers after-lock>1deg: ${r.writersTouched.afterLock.join(" ") || "(none)"}\n`);
    for (const foot of ["left", "right"]) {
      const f = r.perFoot[foot];
      if (!f) continue;
      process.stdout.write(
        `${foot}: stationary=${f.worldStationaryFraction?.toFixed(3) ?? "?"} kinematic=${f.kinematicContactFraction?.toFixed(3) ?? "?"} `
        + `swingToe=${(f.swingToeHeightMaxM ?? NaN).toFixed(3)} mixerSwingToe=${(f.mixerSwingToeHeightMaxM ?? NaN).toFixed(3)} `
        + `bodyV=${(f.bodyFrameSpeedMedianMps ?? NaN).toFixed(3)} mixerBodyV=${(f.mixerBodyFrameSpeedMedianMps ?? NaN).toFixed(3)}\n`,
      );
    }
    process.stdout.write(
      `releaseMax=${(r.releaseStepMaxM ?? NaN).toFixed(3)}m/${r.releaseTransitions} root=${(r.steadyRootSpeedMps ?? NaN).toFixed(3)}m/s planned=${(r.plannedSpeedMps ?? NaN).toFixed(3)}m/s scale=${JSON.stringify(r.actorScale)}\n`,
    );
  }
  if (clip) {
    process.stdout.write(`\n=== clip ${clip.name} dur=${clip.durationSeconds.toFixed(4)}s tracks=${clip.trackCount} ts=${clip.playedTimeScale}\n`);
    for (const foot of ["left", "right"]) {
      const f = clip.perFoot[foot];
      if (!f) continue;
      process.stdout.write(
        `${foot}: n=${f.kinematicContactFrames} backV=${(f.stanceBackwardBodySpeedMedianMps ?? NaN).toFixed(3)} cv=${(f.stanceBackwardBodySpeedCv ?? NaN).toFixed(3)} `
        + `statRoot=${(f.stationaryRootSpeedMps ?? NaN).toFixed(3)} stride=${(f.strideLengthWorldM ?? NaN).toFixed(3)} `
        + `cycPlayed=${(f.cycleDurationPlayedS ?? NaN).toFixed(3)} cycTs1=${(f.cycleDurationAtTimeScale1S ?? NaN).toFixed(3)} `
        + `swingMax=${(f.swingToeHeightMaxM ?? NaN).toFixed(3)}@phase=${(f.swingToeMaxCyclePhase ?? NaN).toFixed(2)} duty=${(f.kinematicDutyFactor ?? NaN).toFixed(3)}\n`,
      );
    }
  }
  process.stdout.write(`\nwrote ${EVIDENCE_ROOT}/report.json\n`);
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("loco-ground-analyze.ts");

if (invokedAsScript) {
  void main().then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
