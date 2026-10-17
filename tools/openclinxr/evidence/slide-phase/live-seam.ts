/**
 * Live-seam + stop/turn timing meter (DENSE_v1 seam-and-timing slice).
 *
 * MEASUREMENT ONLY. Reads slide-phase-capture JSON dirs; never imports
 * planner, runtime, or executor modules. The ONLY record columns read are
 * frames[].leftToe / rightToe / phase / slot / headYaw / startWorld /
 * targetWorld / targetHeading (plus step for ordering diagnostics).
 *
 * Plant detection (from the live toe itself, per foot):
 * - floorM[foot] = min toe.y over all frames with that toe present (global
 *   per capture run; the brief's "floor = min toe Y in the run" read as the
 *   capture run, not the plant candidate, so the Y gate is stable).
 * - Y gate: toe.y <= floorM + 0.02.
 * - Speed gate: consecutive-frame toe XZ step <= SPEED_THRESH_MPS / FPS with
 *   SPEED_THRESH_MPS = 0.02 and FPS = CAPTURE_FPS (30 Hz capture frame rate;
 *   see fps note below). A plant is a maximal run of >= 3 consecutive frames
 *   with every frame Y-gated and every internal pair speed-gated.
 * - Plant xz = mean toe XZ over its frames (stable standing estimate);
 *   along/lateral via the start->target walk frame below.
 *
 * Walk frame: origin = startWorld XZ; fwd = normalize(targetWorld -
 * startWorld) XZ; yawWalk = atan2(fwd.x, fwd.z); right = (cos yawWalk,
 * -sin yawWalk) (three.js rotation.y convention, same as
 * slide-phase-analyze.ts endStance). along(p) = dot(p - start, fwd);
 * lateral(p) = dot(p - start, right) (positive lateral = walk-right).
 *
 * Per foot:
 * - lastWalkPlant = plant with greatest startFrame whose phase at its start
 *   frame is "walking" (null when no walking plant).
 * - firstTurnPlant = first plant by startFrame with startFrame > walkEndFrame
 *   whose XZ differs from lastWalkPlant by > 0.01 m; when lastWalkPlant is
 *   null, the first plant with startFrame > walkEndFrame (null when none).
 * - seamLateralM = lateral(firstTurn) - lateral(lastWalk); seamAlongM
 *   likewise; seamDistM = hypot (null unless both plants exist).
 * - finalPlant = plant with greatest startFrame (any phase); its target
 *   distance = XZ hypot(plant.xz - targetWorld).
 * - Heading error is per RUN from the SLOT yaw (stated method): yaw at the
 *   last frame carrying slot + targetHeading, wrapped to [-180, 180] deg as
 *   (targetHeading - slotYaw). The toe-midpoint line normal is NOT used
 *   (stance-width dependent); slot yaw matches slide-phase-analyze endStance.
 * - straightStopIdeal: stanceWidthM = lateral separation (right minus left)
 *   of lastWalkPlant pair when both exist, else of the finalPlant pair, else
 *   null. Ideal lateral = -w/2 (left) / +w/2 (right) at the foot's own final
 *   along position; deviationM = finalPlant.lateral - ideal.
 *
 * Timing (same FPS; all frame deltas / FPS):
 * - walkEndFrame = last index with phase == "walking".
 * - Frame-planted test for the stop gate: toe present, Y-gated, and every
 *   available adjacent XZ step (prev and next where present) speed-gated.
 *   bothPlanted(i) = left and right frame-planted. stopFrame = first i >
 *   walkEndFrame (or first i >= 0 when no walking frame) with bothPlanted
 *   true on all of [i, i+5] (6 frames); null when no such window.
 * - stopYaw = slot.yaw at stopFrame (first subsequent slot when the stop
 *   frame lacks one). turnStartFrame = first i > stopFrame with slot present
 *   and |wrap(yaw[i] - stopYaw)| > 1 deg. turnEndFrame = first i >=
 *   turnStart with slot present and |wrap(yaw[i] - finalYaw)| <= 1 deg,
 *   where finalYaw = slot.yaw at the last frame carrying a slot.
 * - headTurnStartFrame = first i >= stopFrame with headYaw present and
 *   |wrap(headYaw[i] - headAtStop)| > 1 deg, where headAtStop = headYaw at
 *   stopFrame (first subsequent headYaw when missing). The brief names no
 *   head threshold, so the slot's 1 deg gate is mirrored for comparability.
 * - turnPlants = plants (either foot) with turnStart <= startFrame <=
 *   turnEnd + 6 (open-ended >= turnStart when turnEnd is null; null when
 *   turnStart is null).
 * - pauseS = (turnStart - stop) / FPS; turnS = (turnEnd - turnStart) / FPS;
 *   headLeadS = (turnStart - headTurnStart) / FPS (positive = head led feet).
 *
 * FPS note: the capture advances the fake clock by STEP_SECONDS = 1/30 s per
 * recorded frame, so the CAPTURE frame rate is 30 Hz and every speed (m/s)
 * and duration (s) here uses FPS = 30. The fixed-clock 60 Hz substep (when
 * ?fixedClock=1) is the simulator's internal stepping between these samples;
 * it is NOT the sampling rate and is not used.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/live-seam.ts \
 *     --dir=.openclinxr/evidence/seam-timing/a --out=/tmp/seam-a.json
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CAPTURE_FPS = 30;
export const PLANT_Y_BAND_M = 0.02;
export const PLANT_SPEED_THRESH_MPS = 0.02;
export const PLANT_MIN_FRAMES = 3;
export const SEAM_NEW_PLANT_DIST_M = 0.01;
export const STOP_HOLD_FRAMES = 6;
export const TURN_YAW_THRESH_DEG = 1;

export type Vec3 = { x: number; y: number; z: number };
export type Slot = { x: number; y: number; z: number; yaw: number };

export type LiveSeamFrame = {
  step?: number;
  phase: string | null;
  slot: Slot | null;
  leftToe: Vec3 | null;
  rightToe: Vec3 | null;
  headYaw?: number | null;
  startWorld?: Vec3 | null;
  targetWorld?: Vec3 | null;
  targetHeading?: number | null;
};

export type LiveSeamRunFile = {
  vehicle?: string;
  runIndex?: number;
  urlQuery?: string;
  frames: LiveSeamFrame[];
};

export type WalkFrame = {
  startX: number;
  startZ: number;
  fwdX: number;
  fwdZ: number;
  rightX: number;
  rightZ: number;
  routeLenM: number;
};

export type Plant = {
  foot: "left" | "right";
  startFrame: number;
  endFrame: number;
  nFrames: number;
  x: number;
  z: number;
  alongM: number | null;
  lateralM: number | null;
  phaseAtStart: string | null;
};

export type SeamFoot = {
  lastWalkPlant: Plant | null;
  firstTurnPlant: Plant | null;
  seamLateralM: number | null;
  seamAlongM: number | null;
  seamDistM: number | null;
  finalPlant: Plant | null;
  finalTargetDistM: number | null;
  straightStopIdealLateralM: number | null;
  straightStopDeviationM: number | null;
};

export type RunTiming = {
  walkEndFrame: number | null;
  stopFrame: number | null;
  turnStartFrame: number | null;
  headTurnStartFrame: number | null;
  turnEndFrame: number | null;
  turnPlants: number | null;
  pauseS: number | null;
  turnS: number | null;
  headLeadS: number | null;
  fps: number;
  headYawFrames: number;
  missingHeadYaw: boolean;
};

/**
 * Supplement (beyond the brief's core timing): where the slot yaw actually
 * moves, so a null post-stop turnStart stays interpretable. All from the
 * slot + phase columns only. yawAtWalkEnd = slot yaw at walkEndFrame (first
 * subsequent slot when absent); preStopYawRangeDeg = max |wrap(yaw -
 * yawAtWalkEnd)| over settling frames in (walkEnd, stop) (open-ended to the
 * last settling frame when stop is null); firstYawLeaveFrame = first frame
 * after walkEnd with slot > 1 deg from yawAtWalkEnd (null when the slot
 * never leaves); finalYawDeg/yawAtWalkEndDeg for reference.
 */
export type TurnSupplement = {
  yawAtWalkEndDeg: number | null;
  finalYawDeg: number | null;
  preStopYawRangeDeg: number | null;
  firstYawLeaveFrame: number | null;
  nSettlingFrames: number;
};

export type RunSeam = {
  tag: string;
  nFrames: number;
  floorM: { left: number | null; right: number | null };
  walkFrame: WalkFrame | null;
  stanceWidthM: number | null;
  stanceWidthSource: string | null;
  plants: Plant[];
  left: SeamFoot;
  right: SeamFoot;
  headingMethod: "slot-yaw";
  headingErrDeg: number | null;
  headingFrame: number | null;
  timing: RunTiming;
  supplement: TurnSupplement;
  missing: string[];
};

function toeOf(f: LiveSeamFrame, foot: "left" | "right"): Vec3 | null {
  return foot === "left" ? f.leftToe : f.rightToe;
}

function wrapPi(rad: number): number {
  const twoPi = Math.PI * 2;
  let a = rad % twoPi;
  if (a > Math.PI) a -= twoPi;
  if (a < -Math.PI) a += twoPi;
  return a;
}

function xzDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function floorOf(frames: LiveSeamFrame[], foot: "left" | "right"): number | null {
  let min: number | null = null;
  for (const f of frames) {
    const t = toeOf(f, foot);
    if (t === null) continue;
    if (min === null || t.y < min) min = t.y;
  }
  return min;
}

function buildWalkFrame(frames: LiveSeamFrame[]): WalkFrame | null {
  let start: Vec3 | null = null;
  let target: Vec3 | null = null;
  for (const f of frames) {
    if (start === null && f.startWorld !== null && f.startWorld !== undefined) {
      start = f.startWorld;
    }
    if (target === null && f.targetWorld !== null && f.targetWorld !== undefined) {
      target = f.targetWorld;
    }
    if (start !== null && target !== null) break;
  }
  if (start === null || target === null) return null;
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  const len = Math.hypot(dx, dz);
  if (!(len > 0)) return null;
  const fwdX = dx / len;
  const fwdZ = dz / len;
  const yaw = Math.atan2(fwdX, fwdZ);
  return {
    startX: start.x,
    startZ: start.z,
    fwdX,
    fwdZ,
    rightX: Math.cos(yaw),
    rightZ: -Math.sin(yaw),
    routeLenM: len,
  };
}

function alongLateral(wf: WalkFrame | null, x: number, z: number): { along: number | null; lateral: number | null } {
  if (wf === null) return { along: null, lateral: null };
  const dx = x - wf.startX;
  const dz = z - wf.startZ;
  return {
    along: dx * wf.fwdX + dz * wf.fwdZ,
    lateral: dx * wf.rightX + dz * wf.rightZ,
  };
}

/** Maximal >=3-frame plants per foot from Y + pair-speed gates. */
export function detectPlants(
  frames: LiveSeamFrame[],
  foot: "left" | "right",
  floorM: number | null,
  wf: WalkFrame | null,
): Plant[] {
  const out: Plant[] = [];
  if (floorM === null) return out;
  const maxStep = PLANT_SPEED_THRESH_MPS / CAPTURE_FPS;
  const yOk: boolean[] = frames.map((f) => {
    const t = toeOf(f, foot);
    return t !== null && t.y <= floorM + PLANT_Y_BAND_M;
  });
  // Maximal consecutive Y-gated index runs.
  const runs: number[][] = [];
  let open: number[] = [];
  for (let i = 0; i < frames.length; i += 1) {
    if (!yOk[i]) {
      if (open.length > 0) runs.push(open);
      open = [];
      continue;
    }
    if (open.length > 0 && i !== open[open.length - 1]! + 1) {
      runs.push(open);
      open = [];
    }
    open.push(i);
  }
  if (open.length > 0) runs.push(open);
  // Within each Y run, split on pair-speed violations; keep >= 3-frame pieces.
  for (const run of runs) {
    let piece: number[] = [run[0]!];
    const flush = (): void => {
      if (piece.length >= PLANT_MIN_FRAMES) {
        let sx = 0;
        let sz = 0;
        let n = 0;
        for (const i of piece) {
          const t = toeOf(frames[i]!, foot);
          if (t === null) continue;
          sx += t.x;
          sz += t.z;
          n += 1;
        }
        if (n > 0) {
          const mx = sx / n;
          const mz = sz / n;
          const { along, lateral } = alongLateral(wf, mx, mz);
          out.push({
            foot,
            startFrame: piece[0]!,
            endFrame: piece[piece.length - 1]!,
            nFrames: piece.length,
            x: mx,
            z: mz,
            alongM: along,
            lateralM: lateral,
            phaseAtStart: frames[piece[0]!]!.phase,
          });
        }
      }
      piece = [];
    };
    for (let k = 1; k < run.length; k += 1) {
      const a = toeOf(frames[run[k - 1]!]!, foot);
      const b = toeOf(frames[run[k]!]!, foot);
      const step = a !== null && b !== null ? xzDist(a, b) : Number.POSITIVE_INFINITY;
      if (step <= maxStep) {
        piece.push(run[k]!);
      } else {
        flush();
        piece = [run[k]!];
      }
    }
    flush();
  }
  return out;
}

function lastPlantWithPhase(plants: Plant[], phase: string): Plant | null {
  let best: Plant | null = null;
  for (const p of plants) {
    if (p.phaseAtStart !== phase) continue;
    if (best === null || p.startFrame > best.startFrame) best = p;
  }
  return best;
}

function lastPlant(plants: Plant[]): Plant | null {
  let best: Plant | null = null;
  for (const p of plants) {
    if (best === null || p.startFrame > best.startFrame) best = p;
  }
  return best;
}

export function computeRunSeam(tag: string, run: LiveSeamRunFile): RunSeam {
  const frames = run.frames;
  const missing: string[] = [];
  const floorL = floorOf(frames, "left");
  const floorR = floorOf(frames, "right");
  if (floorL === null) missing.push("floor: no leftToe present in any frame (leftToe column)");
  if (floorR === null) missing.push("floor: no rightToe present in any frame (rightToe column)");
  const wf = buildWalkFrame(frames);
  if (wf === null) missing.push("walkFrame: startWorld/targetWorld missing or zero-length route");
  const plantsL = detectPlants(frames, "left", floorL, wf);
  const plantsR = detectPlants(frames, "right", floorR, wf);
  const plants = [...plantsL, ...plantsR].sort((a, b) => a.startFrame - b.startFrame);

  let walkEnd: number | null = null;
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i]!.phase === "walking") walkEnd = i;
  }
  if (walkEnd === null) missing.push("walkEnd: no frame with phase=walking (phase column)");

  const seamFor = (footPlants: Plant[]): SeamFoot => {
    const lastWalk = lastPlantWithPhase(footPlants, "walking");
    let firstTurn: Plant | null = null;
    const after = footPlants
      .filter((p) => walkEnd === null || p.startFrame > walkEnd)
      .sort((a, b) => a.startFrame - b.startFrame);
    for (const p of after) {
      if (lastWalk === null) {
        firstTurn = p;
        break;
      }
      if (xzDist(p, lastWalk) > SEAM_NEW_PLANT_DIST_M) {
        firstTurn = p;
        break;
      }
    }
    const final = lastPlant(footPlants);
    return {
      lastWalkPlant: lastWalk,
      firstTurnPlant: firstTurn,
      seamLateralM:
        lastWalk?.lateralM !== null &&
        lastWalk?.lateralM !== undefined &&
        firstTurn?.lateralM !== null &&
        firstTurn?.lateralM !== undefined &&
        lastWalk !== null &&
        firstTurn !== null
          ? firstTurn.lateralM! - lastWalk.lateralM!
          : null,
      seamAlongM:
        lastWalk?.alongM !== null &&
        lastWalk?.alongM !== undefined &&
        firstTurn?.alongM !== null &&
        firstTurn?.alongM !== undefined &&
        lastWalk !== null &&
        firstTurn !== null
          ? firstTurn.alongM! - lastWalk.alongM!
          : null,
      seamDistM:
        lastWalk !== null && firstTurn !== null ? xzDist(firstTurn, lastWalk) : null,
      finalPlant: final,
      finalTargetDistM: null,
      straightStopIdealLateralM: null,
      straightStopDeviationM: null,
    };
  };

  const left = seamFor(plantsL);
  const right = seamFor(plantsR);

  // Target distances + stance width + straight-stop ideals.
  let target: Vec3 | null = null;
  for (const f of frames) {
    if (f.targetWorld !== null && f.targetWorld !== undefined) {
      target = f.targetWorld;
      break;
    }
  }
  if (target === null) {
    missing.push("target: no targetWorld in any frame (targetWorld column)");
  } else {
    for (const s of [left, right]) {
      if (s.finalPlant !== null) {
        s.finalTargetDistM = Math.hypot(s.finalPlant.x - target.x, s.finalPlant.z - target.z);
      }
    }
  }
  let stanceWidthM: number | null = null;
  let stanceWidthSource: string | null = null;
  if (
    left.lastWalkPlant?.lateralM !== null &&
    left.lastWalkPlant?.lateralM !== undefined &&
    right.lastWalkPlant?.lateralM !== null &&
    right.lastWalkPlant?.lateralM !== undefined &&
    left.lastWalkPlant !== null &&
    right.lastWalkPlant !== null
  ) {
    stanceWidthM = right.lastWalkPlant.lateralM! - left.lastWalkPlant.lateralM!;
    stanceWidthSource = "lastWalkPlant-pair-lateral-separation";
  } else if (
    left.finalPlant?.lateralM !== null &&
    left.finalPlant?.lateralM !== undefined &&
    right.finalPlant?.lateralM !== null &&
    right.finalPlant?.lateralM !== undefined &&
    left.finalPlant !== null &&
    right.finalPlant !== null
  ) {
    stanceWidthM = right.finalPlant.lateralM! - left.finalPlant.lateralM!;
    stanceWidthSource = "finalPlant-pair-lateral-separation-fallback";
  } else {
    missing.push("stanceWidth: need both feet lateral (lastWalkPlant pair, else finalPlant pair)");
  }
  if (stanceWidthM !== null) {
    left.straightStopIdealLateralM = -stanceWidthM / 2;
    right.straightStopIdealLateralM = stanceWidthM / 2;
    if (left.finalPlant?.lateralM !== null && left.finalPlant?.lateralM !== undefined) {
      left.straightStopDeviationM = left.finalPlant.lateralM! - left.straightStopIdealLateralM;
    }
    if (right.finalPlant?.lateralM !== null && right.finalPlant?.lateralM !== undefined) {
      right.straightStopDeviationM = right.finalPlant.lateralM! - right.straightStopIdealLateralM;
    }
  }

  // Heading error from SLOT yaw at the last slotted frame (stated method).
  let headingErrDeg: number | null = null;
  let headingFrame: number | null = null;
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i]!;
    if (f.slot !== null && f.targetHeading !== null && f.targetHeading !== undefined) {
      headingErrDeg = (wrapPi(f.targetHeading - f.slot.yaw) * 180) / Math.PI;
      headingFrame = i;
      break;
    }
  }
  if (headingErrDeg === null) {
    missing.push("heading: no frame carries slot + targetHeading (slot/targetHeading columns)");
  }

  const timing = computeRunTiming(frames, plants, floorL, floorR, walkEnd, missing);
  const supplement = computeTurnSupplement(frames, walkEnd, timing.stopFrame);

  if (plants.length === 0) missing.push("plants: none detected under the Y + speed gates");
  if (left.lastWalkPlant === null) missing.push("seam.left: no plant beginning in phase walking");
  if (right.lastWalkPlant === null) missing.push("seam.right: no plant beginning in phase walking");
  if (left.firstTurnPlant === null) missing.push("seam.left: no post-walk plant > 0.01 m away");
  if (right.firstTurnPlant === null) missing.push("seam.right: no post-walk plant > 0.01 m away");

  return {
    tag,
    nFrames: frames.length,
    floorM: { left: floorL, right: floorR },
    walkFrame: wf,
    stanceWidthM,
    stanceWidthSource,
    plants,
    left,
    right,
    headingMethod: "slot-yaw",
    headingErrDeg,
    headingFrame,
    timing,
    supplement,
    missing,
  };
}

function framePlantedAt(
  frames: LiveSeamFrame[],
  foot: "left" | "right",
  i: number,
  floorM: number | null,
): boolean {
  if (floorM === null) return false;
  const t = toeOf(frames[i]!, foot);
  if (t === null || t.y > floorM + PLANT_Y_BAND_M) return false;
  const maxStep = PLANT_SPEED_THRESH_MPS / CAPTURE_FPS;
  const prev = i > 0 ? toeOf(frames[i - 1]!, foot) : null;
  const next = i + 1 < frames.length ? toeOf(frames[i + 1]!, foot) : null;
  if (prev !== null && xzDist(t, prev) > maxStep) return false;
  if (next !== null && xzDist(t, next) > maxStep) return false;
  return true;
}

function computeTurnSupplement(
  frames: LiveSeamFrame[],
  walkEnd: number | null,
  stop: number | null,
): TurnSupplement {
  const threshRad = (TURN_YAW_THRESH_DEG * Math.PI) / 180;
  let walkSlot: number | null = null;
  if (walkEnd !== null) {
    for (let j = walkEnd; j < frames.length; j += 1) {
      if (frames[j]!.slot !== null) {
        walkSlot = frames[j]!.slot!.yaw;
        break;
      }
    }
  }
  let finalYaw: number | null = null;
  for (let j = frames.length - 1; j >= 0; j -= 1) {
    if (frames[j]!.slot !== null) {
      finalYaw = frames[j]!.slot!.yaw;
      break;
    }
  }
  let nSettling = 0;
  for (const f of frames) {
    if (f.phase === "settling") nSettling += 1;
  }
  let range = 0;
  let firstLeave: number | null = null;
  let seen = false;
  if (walkEnd !== null && walkSlot !== null) {
    const hi = stop === null ? frames.length : stop;
    for (let i = walkEnd + 1; i < hi; i += 1) {
      const s = frames[i]!.slot;
      if (s === null) continue;
      if (frames[i]!.phase !== "settling") continue;
      const ex = Math.abs(wrapPi(s.yaw - walkSlot));
      range = Math.max(range, ex);
      seen = true;
      if (firstLeave === null && ex > threshRad) firstLeave = i;
    }
  }
  const deg = (r: number | null): number | null => (r === null ? null : (r * 180) / Math.PI);
  return {
    yawAtWalkEndDeg: deg(walkSlot),
    finalYawDeg: deg(finalYaw),
    preStopYawRangeDeg: seen ? (range * 180) / Math.PI : null,
    firstYawLeaveFrame: firstLeave,
    nSettlingFrames: nSettling,
  };
}

function computeRunTiming(
  frames: LiveSeamFrame[],
  plants: Plant[],
  floorL: number | null,
  floorR: number | null,
  walkEnd: number | null,
  missing: string[],
): RunTiming {
  const bothPlanted: boolean[] = frames.map(
    (_, i) => framePlantedAt(frames, "left", i, floorL) && framePlantedAt(frames, "right", i, floorR),
  );
  const searchFrom = walkEnd === null ? 0 : walkEnd + 1;
  let stop: number | null = null;
  for (let i = searchFrom; i + STOP_HOLD_FRAMES - 1 < frames.length; i += 1) {
    let ok = true;
    for (let j = i; j < i + STOP_HOLD_FRAMES; j += 1) {
      if (!bothPlanted[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      stop = i;
      break;
    }
  }
  if (stop === null) missing.push("timing.stop: no 6-frame both-planted window after walking");

  const slotYawAtOrAfter = (i: number | null): { yaw: number; frame: number } | null => {
    if (i === null) return null;
    for (let j = i; j < frames.length; j += 1) {
      if (frames[j]!.slot !== null) return { yaw: frames[j]!.slot!.yaw, frame: j };
    }
    return null;
  };
  const headYawAtOrAfter = (i: number | null): { yaw: number; frame: number } | null => {
    if (i === null) return null;
    for (let j = i; j < frames.length; j += 1) {
      const h = frames[j]!.headYaw;
      if (h !== null && h !== undefined) return { yaw: h, frame: j };
    }
    return null;
  };
  let lastSlot: { yaw: number; frame: number } | null = null;
  for (let j = frames.length - 1; j >= 0; j -= 1) {
    if (frames[j]!.slot !== null) {
      lastSlot = { yaw: frames[j]!.slot!.yaw, frame: j };
      break;
    }
  }

  const threshRad = (TURN_YAW_THRESH_DEG * Math.PI) / 180;
  const stopSlot = slotYawAtOrAfter(stop);
  let turnStart: number | null = null;
  if (stop === null) {
    missing.push("timing.turnStart: needs stopFrame (slot column after stop)");
  } else if (stopSlot === null) {
    missing.push("timing.turnStart: no slot at/after stopFrame (slot column)");
  } else {
    for (let i = stop + 1; i < frames.length; i += 1) {
      const s = frames[i]!.slot;
      if (s === null) continue;
      if (Math.abs(wrapPi(s.yaw - stopSlot.yaw)) > threshRad) {
        turnStart = i;
        break;
      }
    }
    if (turnStart === null) missing.push("timing.turnStart: slot never exceeds 1 deg from stop yaw");
  }

  let headFrames = 0;
  for (const f of frames) {
    if (f.headYaw !== null && f.headYaw !== undefined) headFrames += 1;
  }
  const stopHead = headYawAtOrAfter(stop);
  let headStart: number | null = null;
  if (stop === null) {
    missing.push("timing.headStart: needs stopFrame (headYaw column after stop)");
  } else if (stopHead === null) {
    missing.push("timing.headStart: no headYaw at/after stopFrame (headYaw column)");
  } else {
    for (let i = stopHead.frame; i < frames.length; i += 1) {
      const h = frames[i]!.headYaw;
      if (h === null || h === undefined) continue;
      if (Math.abs(wrapPi(h - stopHead.yaw)) > threshRad) {
        headStart = i;
        break;
      }
    }
    if (headStart === null) missing.push("timing.headStart: head yaw never exceeds 1 deg from stop value");
  }

  let turnEnd: number | null = null;
  if (turnStart === null) {
    missing.push("timing.turnEnd: needs turnStartFrame (slot column)");
  } else if (lastSlot === null) {
    missing.push("timing.turnEnd: no slot in record (slot column)");
  } else {
    for (let i = turnStart; i < frames.length; i += 1) {
      const s = frames[i]!.slot;
      if (s === null) continue;
      if (Math.abs(wrapPi(s.yaw - lastSlot.yaw)) <= threshRad) {
        turnEnd = i;
        break;
      }
    }
    if (turnEnd === null) missing.push("timing.turnEnd: slot never within 1 deg of final yaw");
  }

  let turnPlantCount: number | null = null;
  if (turnStart !== null) {
    const hi = turnEnd === null ? Number.POSITIVE_INFINITY : turnEnd + STOP_HOLD_FRAMES;
    turnPlantCount = plants.filter((p) => p.startFrame >= turnStart! && p.startFrame <= hi).length;
  }

  const div = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : (a - b) / CAPTURE_FPS;

  return {
    walkEndFrame: walkEnd,
    stopFrame: stop,
    turnStartFrame: turnStart,
    headTurnStartFrame: headStart,
    turnEndFrame: turnEnd,
    turnPlants: turnPlantCount,
    pauseS: div(turnStart, stop),
    turnS: div(turnEnd, turnStart),
    headLeadS: turnStart !== null && headStart !== null ? (turnStart - headStart) / CAPTURE_FPS : null,
    fps: CAPTURE_FPS,
    headYawFrames: headFrames,
    missingHeadYaw: headFrames === 0,
  };
}

function dirFromArgv(): string {
  const flag = process.argv.find((a) => a.startsWith("--dir="))?.slice("--dir=".length);
  if (!flag) throw new Error("usage: live-seam.ts --dir=captureDir [--out=summary.json]");
  return flag;
}

function outFromArgv(): string | null {
  return process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? null;
}

async function main(): Promise<void> {
  const dir = dirFromArgv();
  const out = outFromArgv();
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".json") && !f.startsWith("tap-") && f !== "RESULT.json")
    .sort();
  if (files.length === 0) throw new Error(`no run files in ${dir}`);
  const runs: RunSeam[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    } catch {
      continue;
    }
    const run = parsed as LiveSeamRunFile;
    if (!Array.isArray(run.frames)) continue;
    // Skip non-capture JSONs (summaries without frames[].leftToe).
    runs.push(computeRunSeam(file.replace(/\.json$/, ""), run));
  }
  if (runs.length === 0) throw new Error(`no capture runs with frames[] in ${dir}`);
  for (const r of runs) {
    const t = r.timing;
    const s = r.supplement;
    const fmt = (v: number | null, d = 4): string => (v === null ? "n/a" : v.toFixed(d));
    process.stdout.write(
      `[${r.tag}] plants=${r.plants.length} ` +
        `seamLatL=${fmt(r.left.seamLateralM)} seamLatR=${fmt(r.right.seamLateralM)} ` +
        `seamDistL=${fmt(r.left.seamDistM)} seamDistR=${fmt(r.right.seamDistM)} ` +
        `finalDistL=${fmt(r.left.finalTargetDistM)} finalDistR=${fmt(r.right.finalTargetDistM)} ` +
        `headErr=${fmt(r.headingErrDeg, 2)} walkEnd=${t.walkEndFrame ?? "n/a"} stop=${t.stopFrame ?? "n/a"} ` +
        `turnStart=${t.turnStartFrame ?? "n/a"} headStart=${t.headTurnStartFrame ?? "n/a"} turnEnd=${t.turnEndFrame ?? "n/a"} ` +
        `pauseS=${fmt(t.pauseS, 3)} turnS=${fmt(t.turnS, 3)} headLeadS=${fmt(t.headLeadS, 3)} ` +
        `turnPlants=${t.turnPlants ?? "n/a"} preStopYawRange=${fmt(s.preStopYawRangeDeg, 2)} ` +
        `firstYawLeave=${s.firstYawLeaveFrame ?? "n/a"} missing=[${r.missing.join("; ") || "none"}]\n`,
    );
  }
  if (out !== null) {
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(out, JSON.stringify({ dir, fps: CAPTURE_FPS, runs }, null, 2));
    process.stdout.write(`[summary] wrote ${out}\n`);
  }
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("live-seam.ts");

if (invokedAsScript) {
  await main();
}
