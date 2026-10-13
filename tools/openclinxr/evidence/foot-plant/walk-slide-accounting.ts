import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { FOOT_CONTACT_HEIGHT_METERS } from "@openclinxr/asset-registry/approach-executor";

/**
 * Steady-state walking slide accounting over a foot-plant-video.json capture.
 *
 * Every stance label here is READ from the capture's own `stanceFoot` field — the production
 * runtime's clip-derived labels (`LocomotionStanceLabels` via `resolveLocomotionStanceLabels`,
 * published per frame by `publishBedsideApproachRuntimeEvidence`). Nothing here re-derives,
 * smooths, or retunes labels. The contact band is the production constant itself
 * (`FOOT_CONTACT_HEIGHT_METERS`, imported, not copied).
 *
 * Per-frame decomposition (route = unit XZ from first to last walking slot):
 * - rootAdvanceM[i] = dot(slot[i] - slot[i-1], routeDir), 0 for the first frame.
 * - footBodyAlongM[foot][i] = dot((foot[i] - foot[i-1]) - (slot[i] - slot[i-1]), routeDir):
 *   the foot's along-route motion in the body frame, in metres for that frame.
 * - measuredSlideM over a contact = dot(foot[end] - foot[start], routeDir) (signed).
 * - predictedSlideM = sum(rootAdvanceM + footBodyAlongM[stanceFoot]) over the contact's
 *   non-first frames. This telescopes to the measured value by construction: the instrument
 *   bar (|predicted - measured| <= 0.03 m) checks the plumbing carries every term, while the
 *   MEASUREMENT is the decomposition — how much of the slide is root travel the stance foot
 *   failed to cancel, and how much sits in label-error extension frames.
 *
 * Contacts are maximal runs of equal non-null stanceFoot inside the walking phase. A run of
 * length 1 is a zero-length episode: dropped from all per-contact math, counted in
 * `droppedZeroLengthEpisodes`. Steady state = contacts fully inside the walk (first and last
 * dropped). A full gait cycle (stride) = three consecutive complete contacts F1,F2,F1; a
 * contact is complete when both label boundaries were observed inside the walking phase
 * rather than at its edges.
 *
 * TOE HEIGHT is toe world Y minus the walk-minimum toe Y (a stated proxy floor: the capture
 * carries no floor datum, and the minimum stance dip sits ~4 mm, so the systematic error is a
 * few mm — immaterial against the 60 mm band). `footBoneHeightMeters` is deliberately NOT
 * used: it is the HEEL bone, which rides 6-13 cm above the floor even in stance on this
 * capture, so the production toe band never admits it. The band test below therefore leans on
 * motion, exactly like the production labeller (`locomotion-stance-labels.ts`: contact is a
 * clip-motion property, height only a secondary gate).
 *
 * claimScope: arithmetic over foot-plant-video.json frames and their production stance labels.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance.
 */

export const INSTRUMENT_BAR_METERS = 0.03;

type Vec3 = { x: number; y: number; z: number };

export type AccountingFrame = {
  tMs: number;
  phase: string;
  left: Vec3 | null;
  right: Vec3 | null;
  stanceFoot: string | null;
  slot: { x: number; z: number } | null;
  footBoneHeightMeters: { left: number | null; right: number | null } | null;
};

export type FrameAccounting = {
  frame: number;
  tMs: number;
  rootAdvanceM: number;
  leftBodyAlongM: number | null;
  rightBodyAlongM: number | null;
  leftToeHeightM: number | null;
  rightToeHeightM: number | null;
  stanceLabel: string | null;
};

export type ContactAccounting = {
  foot: "left" | "right";
  startFrame: number;
  endFrame: number;
  frames: number;
  measuredSlideM: number;
  predictedSlideM: number;
  barPass: boolean;
  maxToeHeightM: number | null;
  /** Frames in the contact whose backward body-frame speed is < 0.5x the contact's own peak. */
  labelledButNotMovingBackFrames: number;
  peakBackwardSpeedMps: number;
  startComplete: boolean;
  endComplete: boolean;
  steady: boolean;
};

export type UnlabelledStanceFrame = {
  frame: number;
  foot: "left" | "right";
  toeHeightM: number;
  backwardSpeedMps: number;
};

export type WalkSlideAccounting = {
  routeDir: { x: number; z: number };
  routeLengthM: number;
  walkingFrames: number;
  walkingSeconds: number;
  scenario: string | null;
  actorId: string | null;
  perFrame: FrameAccounting[];
  contacts: ContactAccounting[];
  droppedZeroLengthEpisodes: number;
  unlabelledStance: UnlabelledStanceFrame[];
  fullGaitCycles: number;
  steadyGaitCycles: number;
  steadyState: {
    contacts: number;
    rootSpeedMps: number;
    stanceFootSpeedMps: number;
    steadyPeakBackwardSpeedMps: number;
    ratio: number | null;
    dutyLabel: number | null;
    dutyKinematic: number | null;
    slidePerContactM: number[];
  };
  labelErrors: {
    lateLiftoffFrames: number | null;
    lateTouchdownFrames: number | null;
    /** Share of steady slide on kinematically-valid labelled frames (root outruns the foot). */
    speedMismatchShare: number | null;
    /** Share on labelled-but-not-kinematic frames (label too long / mid-stance carry). */
    labelExtensionShare: number | null;
    /** Of the extension share, the part after the last kinematic frame (liftoff tail). */
    extensionTailShare: number | null;
  };
  instrumentBarPass: boolean;
};

function dot(ax: number, az: number, bx: number, bz: number): number {
  return ax * bx + az * bz;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function computeWalkSlideAccounting(
  frames: readonly AccountingFrame[],
  opts?: { scenario?: string | null; actorId?: string | null },
): WalkSlideAccounting {
  const walkingIdx: number[] = [];
  frames.forEach((f, i) => {
    if (f.phase === "walking") walkingIdx.push(i);
  });
  const firstWalking = walkingIdx.length > 0 ? walkingIdx[0]! : 0;
  const lastWalking = walkingIdx.length > 0 ? walkingIdx[walkingIdx.length - 1]! : 0;

  let firstSlot: { x: number; z: number } | null = null;
  let lastSlot: { x: number; z: number } | null = null;
  for (const i of walkingIdx) {
    const s = frames[i]?.slot ?? null;
    if (s !== null) {
      if (firstSlot === null) firstSlot = s;
      lastSlot = s;
    }
  }
  let routeDir = { x: 1, z: 0 };
  let routeLengthM = 0;
  if (firstSlot !== null && lastSlot !== null) {
    const dx = lastSlot.x - firstSlot.x;
    const dz = lastSlot.z - firstSlot.z;
    routeLengthM = Math.hypot(dx, dz);
    if (routeLengthM > 0) routeDir = { x: dx / routeLengthM, z: dz / routeLengthM };
  }

  // Proxy floor: the capture carries no floor datum. The walk-minimum toe Y is the stance
  // dip (~4 mm here), so toe height above it carries a few-mm systematic error — immaterial
  // against the 60 mm band. See the file header for why the heel field is not used.
  let floorY: number | null = null;
  for (const i of walkingIdx) {
    const f = frames[i]!;
    for (const toe of [f.left, f.right]) {
      if (toe !== null && (floorY === null || toe.y < floorY)) floorY = toe.y;
    }
  }

  const perFrame: FrameAccounting[] = frames.map((f, i) => {
    const prev = i > 0 ? frames[i - 1] : null;
    let rootAdvanceM = 0;
    let leftBodyAlongM: number | null = null;
    let rightBodyAlongM: number | null = null;
    if (prev && f.slot && prev.slot) {
      const rdx = f.slot.x - prev.slot.x;
      const rdz = f.slot.z - prev.slot.z;
      rootAdvanceM = dot(rdx, rdz, routeDir.x, routeDir.z);
      for (const foot of ["left", "right"] as const) {
        const cur = f[foot];
        const old = prev[foot];
        if (cur !== null && old !== null) {
          const along = dot(cur.x - old.x - rdx, cur.z - old.z - rdz, routeDir.x, routeDir.z);
          if (foot === "left") leftBodyAlongM = along;
          else rightBodyAlongM = along;
        }
      }
    }
    return {
      frame: i,
      tMs: f.tMs,
      rootAdvanceM,
      leftBodyAlongM,
      rightBodyAlongM,
      leftToeHeightM: f.left !== null && floorY !== null ? f.left.y - floorY : null,
      rightToeHeightM: f.right !== null && floorY !== null ? f.right.y - floorY : null,
      stanceLabel: f.stanceFoot,
    };
  });

  /** Backward body-frame speed of a foot at a frame (positive = moving backward), m/s. */
  const backwardSpeedMps = (frameIdx: number, foot: "left" | "right"): number | null => {
    const row = perFrame[frameIdx];
    const cur = frames[frameIdx];
    const prev = frameIdx > 0 ? frames[frameIdx - 1] : null;
    if (!row || !cur || !prev) return null;
    const along = foot === "left" ? row.leftBodyAlongM : row.rightBodyAlongM;
    if (along === null) return null;
    const dtS = (cur.tMs - prev.tMs) / 1000;
    if (!(dtS > 0)) return 0;
    return -along / dtS;
  };

  // Maximal runs of equal non-null stanceFoot inside the walking phase with all positions
  // present. A run that hits an unusable frame ends there (flush), like the capture's own
  // detector.
  type Run = { foot: "left" | "right"; idx: number[] };
  const runs: Run[] = [];
  let open: Run | null = null;
  const flush = (): void => {
    if (open !== null) {
      runs.push(open);
      open = null;
    }
  };
  for (const i of walkingIdx) {
    const f = frames[i]!;
    const foot = f.stanceFoot;
    const usable =
      (foot === "left" || foot === "right") &&
      f.left !== null &&
      f.right !== null &&
      f.slot !== null;
    if (!usable || (foot !== "left" && foot !== "right")) {
      flush();
      continue;
    }
    if (open !== null && foot !== open.foot) flush();
    if (open === null) open = { foot, idx: [] };
    open.idx.push(i);
  }
  flush();

  let droppedZeroLengthEpisodes = 0;
  const contacts: ContactAccounting[] = [];
  const keptRuns: Run[] = [];
  for (const run of runs) {
    if (run.idx.length < 2) {
      droppedZeroLengthEpisodes += 1;
      continue;
    }
    keptRuns.push(run);
    const startFrame = run.idx[0]!;
    const endFrame = run.idx[run.idx.length - 1]!;
    const a = frames[startFrame]!;
    const b = frames[endFrame]!;
    const aToe = run.foot === "left" ? a.left! : a.right!;
    const bToe = run.foot === "left" ? b.left! : b.right!;
    const measuredSlideM = dot(bToe.x - aToe.x, bToe.z - aToe.z, routeDir.x, routeDir.z);
    let predictedSlideM = 0;
    for (const i of run.idx.slice(1)) {
      const row = perFrame[i]!;
      const body = run.foot === "left" ? row.leftBodyAlongM : row.rightBodyAlongM;
      predictedSlideM += row.rootAdvanceM + (body ?? 0);
    }
    let maxToeHeightM: number | null = null;
    for (const i of run.idx) {
      const row = perFrame[i]!;
      const h = run.foot === "left" ? row.leftToeHeightM : row.rightToeHeightM;
      if (h !== null && (maxToeHeightM === null || h > maxToeHeightM)) maxToeHeightM = h;
    }
    let peak = 0;
    const speeds = new Map<number, number>();
    for (const i of run.idx.slice(1)) {
      const s = backwardSpeedMps(i, run.foot) ?? 0;
      speeds.set(i, s);
      if (s > peak) peak = s;
    }
    let labelledButNotMovingBackFrames = 0;
    if (peak > 0) {
      for (const [, s] of speeds) {
        if (s < 0.5 * peak) labelledButNotMovingBackFrames += 1;
      }
    } else {
      labelledButNotMovingBackFrames = speeds.size;
    }
    const prevLabel = startFrame > firstWalking ? frames[startFrame - 1]?.stanceFoot ?? null : null;
    const nextLabel = endFrame < lastWalking ? frames[endFrame + 1]?.stanceFoot ?? null : null;
    const startComplete = startFrame !== firstWalking && prevLabel !== run.foot;
    const endComplete = endFrame !== lastWalking && nextLabel !== run.foot;
    contacts.push({
      foot: run.foot,
      startFrame,
      endFrame,
      frames: run.idx.length,
      measuredSlideM,
      predictedSlideM,
      barPass: Math.abs(predictedSlideM - measuredSlideM) <= INSTRUMENT_BAR_METERS,
      maxToeHeightM,
      labelledButNotMovingBackFrames,
      peakBackwardSpeedMps: peak,
      startComplete,
      endComplete,
      steady: false,
    });
  }

  const steady = contacts.length > 2 ? contacts.slice(1, contacts.length - 1) : [];
  for (const c of steady) c.steady = true;

  const countStrides = (list: ContactAccounting[]): number => {
    let n = 0;
    for (let k = 0; k + 2 < list.length; k += 1) {
      const a = list[k]!;
      const b = list[k + 1]!;
      const c = list[k + 2]!;
      if (
        a.foot === c.foot &&
        b.foot !== a.foot &&
        a.startComplete && a.endComplete &&
        b.startComplete && b.endComplete &&
        c.startComplete && c.endComplete
      ) {
        n += 1;
      }
    }
    return n;
  };

  // Global stance backward speed: median over kept-run stance frames (dt > 0).
  const stanceSpeeds: number[] = [];
  for (const run of keptRuns) {
    for (const i of run.idx.slice(1)) {
      const cur = frames[i]!;
      const prev = frames[i - 1]!;
      if ((cur.tMs - prev.tMs) / 1000 > 0) {
        stanceSpeeds.push(backwardSpeedMps(i, run.foot) ?? 0);
      }
    }
  }
  const stanceFootSpeedMps = median(stanceSpeeds);

  // Reverse error: walking frames where a foot is NOT labelled but sits below the contact
  // band and moves backward at >= 0.5x the global stance speed.
  const unlabelledStance: UnlabelledStanceFrame[] = [];
  if (stanceFootSpeedMps > 0) {
    for (const i of walkingIdx) {
      const f = frames[i]!;
      const row = perFrame[i]!;
      for (const foot of ["left", "right"] as const) {
        if (f.stanceFoot === foot) continue;
        const h = foot === "left" ? row.leftToeHeightM : row.rightToeHeightM;
        if (h === null || h >= FOOT_CONTACT_HEIGHT_METERS) continue;
        const s = backwardSpeedMps(i, foot);
        if (s !== null && s >= 0.5 * stanceFootSpeedMps) {
          unlabelledStance.push({ frame: i, foot, toeHeightM: h, backwardSpeedMps: s });
        }
      }
    }
  }

  // Duty factors: labelled stance fraction vs kinematic stance fraction, mean over feet.
  let dutyLabel: number | null = null;
  let dutyKinematic: number | null = null;
  if (walkingIdx.length > 0) {
    const duties: number[] = [];
    const kinDuties: number[] = [];
    for (const foot of ["left", "right"] as const) {
      let labelled = 0;
      let kinematic = 0;
      for (const i of walkingIdx) {
        const f = frames[i]!;
        const row = perFrame[i]!;
        if (f.stanceFoot === foot) labelled += 1;
        const h = foot === "left" ? row.leftToeHeightM : row.rightToeHeightM;
        const s = backwardSpeedMps(i, foot);
        if (
          h !== null && h < FOOT_CONTACT_HEIGHT_METERS &&
          s !== null && stanceFootSpeedMps > 0 && s >= 0.5 * stanceFootSpeedMps
        ) {
          kinematic += 1;
        }
      }
      duties.push(labelled / walkingIdx.length);
      kinDuties.push(kinematic / walkingIdx.length);
    }
    dutyLabel = (duties[0]! + duties[1]!) / 2;
    dutyKinematic = (kinDuties[0]! + kinDuties[1]!) / 2;
  }

  // Label timing errors per steady contact: kinematic interval of the same foot inside the
  // contact extended by up to 10 walking frames each side; liftoff/touchdown lateness in
  // frames; slide split into overlap vs label-extension share.
  const walkingPos = new Map<number, number>();
  walkingIdx.forEach((frameIdx, pos) => walkingPos.set(frameIdx, pos));
  let lateLiftoffSum = 0;
  let lateTouchdownSum = 0;
  let timedContacts = 0;
  let mismatchSum = 0;
  let extensionSum = 0;
  let extensionTailSum = 0;
  let slideTotal = 0;
  for (const c of steady) {
    const startPos = walkingPos.get(c.startFrame) ?? 0;
    const endPos = walkingPos.get(c.endFrame) ?? 0;
    const lo = Math.max(0, startPos - 10);
    const hi = Math.min(walkingIdx.length - 1, endPos + 10);
    const kin = new Set<number>();
    for (let pos = lo; pos <= hi; pos += 1) {
      const i = walkingIdx[pos]!;
      const row = perFrame[i]!;
      const h = c.foot === "left" ? row.leftToeHeightM : row.rightToeHeightM;
      const s = backwardSpeedMps(i, c.foot);
      if (
        h !== null && h < FOOT_CONTACT_HEIGHT_METERS &&
        s !== null && stanceFootSpeedMps > 0 && s >= 0.5 * stanceFootSpeedMps
      ) {
        kin.add(i);
      }
    }
    if (kin.size === 0) continue;
    timedContacts += 1;
    const kinStart = Math.min(...kin);
    const kinEnd = Math.max(...kin);
    lateTouchdownSum += c.startFrame - kinStart;
    lateLiftoffSum += c.endFrame - kinEnd;
    // Exact per-frame partition of the contact's own predicted sum (= measured): kinematic
    // labelled frames (speed mismatch) vs the rest (label extension / mid-stance carry).
    for (let i = c.startFrame + 1; i <= c.endFrame; i += 1) {
      const row = perFrame[i]!;
      const body = c.foot === "left" ? row.leftBodyAlongM : row.rightBodyAlongM;
      const part = row.rootAdvanceM + (body ?? 0);
      if (kin.has(i)) mismatchSum += part;
      else {
        extensionSum += part;
        if (i > kinEnd) extensionTailSum += part;
      }
    }
    slideTotal += Math.abs(c.measuredSlideM);
  }

  const walkingSeconds =
    walkingIdx.length >= 2
      ? (frames[walkingIdx[walkingIdx.length - 1]!]!.tMs - frames[walkingIdx[0]!]!.tMs) / 1000
      : 0;

  // Steady-scoped root speed: travel over the steady contacts' own span, so the walk-start
  // probe gap and the stop transient do not dilute it. Falls back to the whole walk when
  // there is no steady subset.
  let rootSpeedMps: number;
  if (steady.length > 0) {
    const s0 = steady[0]!;
    const s1 = steady[steady.length - 1]!;
    const spanS = (frames[s1.endFrame]!.tMs - frames[s0.startFrame]!.tMs) / 1000;
    let travelM = 0;
    for (let i = s0.startFrame + 1; i <= s1.endFrame; i += 1) travelM += perFrame[i]!.rootAdvanceM;
    rootSpeedMps = spanS > 0 ? travelM / spanS : 0;
  } else {
    let rootTravelM = 0;
    for (const i of walkingIdx.slice(1)) rootTravelM += perFrame[i]!.rootAdvanceM;
    rootSpeedMps = walkingSeconds > 0 ? rootTravelM / walkingSeconds : 0;
  }

  // Steady-scoped median stance-foot backward speed (the ratio's denominator), plus the
  // steady peak for the against-the-clip comparison.
  const steadySpeeds: number[] = [];
  let steadyPeakBackwardSpeedMps = 0;
  for (const c of steady) {
    for (const i of walkingIdx.filter((k) => k > c.startFrame && k <= c.endFrame)) {
      const cur = frames[i]!;
      const prev = frames[i - 1]!;
      if ((cur.tMs - prev.tMs) / 1000 > 0) {
        const s = backwardSpeedMps(i, c.foot) ?? 0;
        steadySpeeds.push(s);
        if (s > steadyPeakBackwardSpeedMps) steadyPeakBackwardSpeedMps = s;
      }
    }
  }
  const steadyStanceFootSpeedMps = median(steadySpeeds);

  return {
    routeDir,
    routeLengthM,
    walkingFrames: walkingIdx.length,
    walkingSeconds,
    scenario: opts?.scenario ?? null,
    actorId: opts?.actorId ?? null,
    perFrame,
    contacts,
    droppedZeroLengthEpisodes,
    unlabelledStance,
    fullGaitCycles: countStrides(contacts),
    steadyGaitCycles: countStrides(steady),
    steadyState: {
      contacts: steady.length,
      rootSpeedMps,
      stanceFootSpeedMps: steadyStanceFootSpeedMps,
      steadyPeakBackwardSpeedMps,
      ratio: steadyStanceFootSpeedMps > 0 ? rootSpeedMps / steadyStanceFootSpeedMps : null,
      dutyLabel,
      dutyKinematic,
      slidePerContactM: steady.map((c) => c.measuredSlideM),
    },
    labelErrors: {
      lateLiftoffFrames: timedContacts > 0 ? lateLiftoffSum / timedContacts : null,
      lateTouchdownFrames: timedContacts > 0 ? lateTouchdownSum / timedContacts : null,
      speedMismatchShare: slideTotal > 0 ? mismatchSum / slideTotal : null,
      labelExtensionShare: slideTotal > 0 ? extensionSum / slideTotal : null,
      extensionTailShare: slideTotal > 0 ? extensionTailSum / slideTotal : null,
    },
    instrumentBarPass: contacts.every((c) => c.barPass),
  };
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("walk-slide-accounting.ts");

if (invokedAsScript) {
  const inputPath = process.argv.find((a) => a.startsWith("--capture="))?.slice("--capture=".length)
    ?? process.argv[2] ?? "";
  if (!inputPath) {
    process.stderr.write("usage: walk-slide-accounting.ts --capture=<foot-plant-video.json> [--out=<path>]\n");
    process.exit(2);
  }
  const outPath = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? null;
  const raw = JSON.parse(await readFile(inputPath, "utf8")) as {
    scenario?: string;
    actorId?: string;
    frames: AccountingFrame[];
  };
  const accounting = computeWalkSlideAccounting(raw.frames, {
    scenario: raw.scenario ?? null,
    actorId: raw.actorId ?? null,
  });
  const json = `${JSON.stringify(accounting, null, 2)}\n`;
  if (outPath) {
    await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await writeFile(outPath, json, "utf8");
    process.stdout.write(`wrote ${outPath}\n`);
  } else {
    process.stdout.write(json);
  }
}
