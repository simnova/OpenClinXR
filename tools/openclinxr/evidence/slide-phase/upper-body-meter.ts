/**
 * Upper-body motion meter (2026-10-18 slice, DENSE_v1: measure, then one fix
 * only if out of band).
 *
 * WHY: foot/contact quality on SC-05 is near target, but pelvis, trunk and
 * arm motion have never been measured. A Fable review (2026-10-18) flagged
 * that at the plan's stride scale 0.707 the clip's arm swing may be
 * over-amplitude for the shortened step.
 *
 * Per walking stride, from slide-phase captures carrying the upper-body
 * probe (slide-phase-capture.ts `upperBody`, additive September-2026-style
 * separate evaluate):
 *   - pelvis vertical excursion (m, pelvis bone world Y)
 *   - pelvis lateral excursion (m, pelvis world pos along the route-right
 *     axis, perpendicular to travel)
 *   - pelvis yaw range (deg, inter-HIP axis heading: upperleg01 origins are
 *     rigid with the pelvis 19 cm apart; pelvis.L/R are co-located halves)
 *   - pelvis obliquity range (deg, hip height difference)
 *   - trunk forward lean mean (deg, spine05->spine01 vs vertical, sagittal)
 *   - shoulder flexion-extension range per side (deg, upper-arm direction in
 *     the trunk-relative sagittal plane) and its phase vs the ipsilateral
 *     thigh (cross-correlation min-lag in cycle fractions; 0 = simultaneous
 *     opposition, the Murray anti-phase)
 *   - elbow flexion range per side (deg)
 *   - walking speed per run (m/s, slot path / walking time)
 * Strides are half-cycle tiles anchored on the global smoothed-thigh maximum
 * (peak-to-peak windows defeat the thigh's stance bump); the cycle comes
 * from labels.cycleSeconds over the measured clipTime slope (autocorrelation
 * fallback). Plus the same quantities measured on the bound clip itself
 * (offline GLB FK, same recipe family as phase-attribution.ts).
 *
 * Bands live in REFERENCE_BANDS below, each with a citable source; edges
 * without a source are marked UNSOURCED and never invented. Speed matters:
 * arm-swing amplitude drops with walking speed (Romkes & Bracht-Schweizer
 * 2017; Collins et al. 2009 after Craik et al. 1976), so the shoulder/elbow
 * verdicts carry the measured speed beside the free-speed band.
 *
 * INSTRUMENT ONLY. Reads captures/GLBs; writes no product code.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/upper-body-meter.ts \
 *     --physician=.openclinxr/evidence/upper-body/sc05-physician \
 *     --nurse=.openclinxr/evidence/upper-body/sc05-nurse \
 *     --child=.openclinxr/evidence/upper-body/sc05-child \
 *     --cruise=.openclinxr/evidence/upper-body/cruise-physician \
 *     --bound-glb=apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb \
 *     --out=.openclinxr/evidence/upper-body/measure.json
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Node as GltfNode } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";

const DEG = 180 / Math.PI;
const FRAME_SECONDS = 1 / 30;
/** Offline actor scale, same constant as phase-attribution.ts (runtime slot scale). */
const BOUND_ACTOR_SCALE = 0.86;
const BOUND_CLIP = "openclinxr_retarget_walk_source";

export type Vec3 = { x: number; y: number; z: number };

export type UpperBodyProbe = {
  pelvisL: Vec3 | null;
  pelvisR: Vec3 | null;
  pelvisMatrix: number[] | null;
  spineBase: Vec3 | null;
  spineTop: Vec3 | null;
  shoulderL: Vec3 | null;
  shoulderR: Vec3 | null;
  elbowL: Vec3 | null;
  elbowR: Vec3 | null;
  wristL: Vec3 | null;
  wristR: Vec3 | null;
  head: Vec3 | null;
};

export type MeterFrame = {
  phase: string | null;
  slot: { x: number; y: number; z: number; yaw: number } | null;
  leftToe: Vec3 | null;
  rightToe: Vec3 | null;
  clipTime?: number | null;
  travelHeading?: number | null;
  legWorlds?: Record<string, Vec3 | null> | null;
  upperBody?: UpperBodyProbe | null;
};

export type MeterRunFile = {
  vehicle?: string;
  runIndex?: number;
  urlQuery?: string;
  actor?: string;
  labels?: { cycleSeconds?: number } | null;
  frames: MeterFrame[];
};

// ---- pure angle/series math (unit-tested) ----

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function norm(v: Vec3): Vec3 | null {
  const l = Math.hypot(v.x, v.y, v.z);
  if (!(l > 1e-9)) return null;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function finiteRange(xs: number[]): { min: number; max: number; n: number } | null {
  let min = Infinity;
  let mx = -Infinity;
  let n = 0;
  for (const v of xs) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > mx) mx = v;
    n += 1;
  }
  return n === 0 ? null : { min, max: mx, n };
}

export function rangeOf(xs: number[]): number | null {
  const r = finiteRange(xs);
  return r === null ? null : r.max - r.min;
}

export function meanOf(xs: number[]): number | null {
  let s = 0;
  let n = 0;
  for (const v of xs) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    s += v;
    n += 1;
  }
  return n === 0 ? null : s / n;
}

/** Pelvis yaw (deg) from a column-major world matrix; uniform scale cancels. */
export function yawFromMatrix(e: ArrayLike<number>): number {
  return Math.atan2(e[8]!, e[10]!) * DEG;
}

/**
 * Pelvis obliquity (deg) from a column-major world matrix: frontal tilt of
 * the lateral (local X) axis out of the horizontal. Uniform scale cancels.
 */
export function obliquityFromMatrix(e: ArrayLike<number>): number {
  return Math.atan2(e[1]!, Math.hypot(e[0]!, e[2]!)) * DEG;
}

export function forwardOfHeading(h: number): { x: number; z: number } {
  return { x: Math.sin(h), z: Math.cos(h) };
}

export function rightOfHeading(h: number): { x: number; z: number } {
  return { x: Math.cos(h), z: -Math.sin(h) };
}

/**
 * Trunk forward lean (deg): angle of base->top from vertical, sagittal
 * component along fwd. Positive = leaning toward travel.
 */
export function trunkLeanDeg(base: Vec3, top: Vec3, fwd: { x: number; z: number }): number | null {
  const v = sub(top, base);
  const up = v.y;
  const along = v.x * fwd.x + v.z * fwd.z;
  if (!(Math.hypot(v.x, v.y, v.z) > 1e-9)) return null;
  return Math.atan2(along, up) * DEG;
}

/**
 * Shoulder flexion-extension angle (deg): upper-arm direction
 * (shoulder->elbow) in the trunk-relative sagittal plane, measured from the
 * downward trunk line; positive = arm forward of the trunk.
 */
export function shoulderAngleDeg(sh: Vec3, el: Vec3, up: Vec3, fwd: { x: number; z: number }): number {
  const a = sub(el, sh);
  return Math.atan2(a.x * fwd.x + a.z * fwd.z, -(a.x * up.x + a.y * up.y + a.z * up.z)) * DEG;
}

/** Elbow flexion (deg): 0 = straight arm (full extension), 180 = fully folded. */
export function elbowFlexionDeg(sh: Vec3, el: Vec3, wr: Vec3): number | null {
  const u1 = norm(sub(sh, el));
  const u2 = norm(sub(wr, el));
  if (u1 === null || u2 === null) return null;
  const c = Math.min(1, Math.max(-1, dot(u1, u2)));
  return 180 - Math.acos(c) * DEG;
}

/**
 * Thigh sagittal angle (deg): hip->knee direction from the downward trunk
 * line; positive = thigh forward. Phase reference for the arm swing.
 */
export function thighAngleDeg(hip: Vec3, knee: Vec3, up: Vec3, fwd: { x: number; z: number }): number {
  const v = sub(knee, hip);
  return Math.atan2(v.x * fwd.x + v.z * fwd.z, -(v.x * up.x + v.y * up.y + v.z * up.z)) * DEG;
}

/**
 * Pelvis obliquity (deg) from the HIP height difference (upperleg01 origins).
 * Hip joint centres are rigid with the pelvis, so their height difference is
 * pure pelvic list.
 *
 * (The pelvis.L/R bones themselves are unusable: co-located split halves,
 * separation exactly 0.000000 m live, so any L/R axis off them is float
 * dust. Their shared position still carries valid pelvis vertical/lateral
 * translation.)
 */
export function hipObliquityDeg(hipL: Vec3, hipR: Vec3): number | null {
  const dxz = Math.hypot(hipL.x - hipR.x, hipL.z - hipR.z);
  if (!(dxz > 1e-9)) return null;
  return Math.atan2(hipL.y - hipR.y, dxz) * DEG;
}

/**
 * Pelvis yaw (deg) from the inter-HIP axis (upperleg01.R origin minus
 * upperleg01.L origin) in world XZ. The hip pair is 19 cm apart and rigid
 * with the pelvis (leg swing rotates about the centres without translating
 * them), so the axis heading rotates with transverse pelvic rotation while
 * translation leaves it unchanged — the marker-based convention (ASIS pair)
 * with no assumption about any bone's local frame (the MPFB pelvis bind
 * orientation is far from anatomical, so matrix-column angles are recorded
 * only as unbanded diagnostics, never verdicts).
 */
export function hipAxisYawDeg(hipL: Vec3, hipR: Vec3): number {
  return Math.atan2(hipR.x - hipL.x, hipR.z - hipL.z) * DEG;
}

export function pearson(a: number[], b: number[]): number | null {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
  }
  if (pairs.length < 3) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (!(sxx > 0 && syy > 0)) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Wrap degrees to [-180, 180). */
export function wrapDeg(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/** Boxcar smooth (radius r, NaN-tolerant: mean of finite neighbours). */
export function smooth(xs: number[], r: number): number[] {
  return xs.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let d = -r; d <= r; d += 1) {
      const v = xs[i + d];
      if (typeof v === "number" && Number.isFinite(v)) {
        s += v;
        n += 1;
      }
    }
    return n > 0 ? s / n : NaN;
  });
}

/**
 * Gait-cycle length (frames) from the autocorrelation of the (smoothed,
 * mean-removed) thigh angle: lag of the strongest interior local maximum
 * over lags 8..n-4. Null when no interior maximum clears 0.3 (flat line).
 */
export function cycleFramesAuto(thigh: number[]): number | null {
  const xs = thigh.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n < 20) return null;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const dev = xs.map((v) => v - mean);
  const var0 = dev.reduce((s, v) => s + v * v, 0);
  if (!(var0 > 0)) return null;
  const ac = (lag: number): number => {
    let s = 0;
    for (let i = 0; i + lag < n; i += 1) s += dev[i]! * dev[i + lag]!;
    return s / var0;
  };
  let best = -Infinity;
  let bestLag = -1;
  for (let lag = 8; lag <= n - 4; lag += 1) {
    const v = ac(lag);
    if (v > best && v > ac(lag - 1) && v >= ac(lag + 1) && v > 0.3) {
      best = v;
      bestLag = lag;
    }
  }
  return bestLag < 0 ? null : bestLag;
}

/**
 * Arm-leg phase lag (fraction of a cycle): lag of the MINIMUM of the
 * normalised cross-correlation between shoulder and ipsilateral thigh angle
 * (mean-removed), wrapped to [-0.5, 0.5). Simultaneous opposition (the
 * Murray anti-phase: arm forward exactly when the ipsilateral leg is
 * backmost) reads 0; a lagging arm reads positive. Robust to double-peaked
 * waveforms that defeat peak-picking (measured on the bound clip
 * 2026-10-18: thigh carries a stance bump beside the swing peak).
 */
export function armLegLag(shoulder: number[], thigh: number[], cycleFrames: number): number | null {
  const n = Math.min(shoulder.length, thigh.length);
  if (!(cycleFrames >= 8) || n < 12) return null;
  const use = (xs: number[]): number[] | null => {
    const seg = xs.slice(0, n).filter((v) => Number.isFinite(v));
    if (seg.length < n) return null;
    const m = seg.reduce((acc, v) => acc + v, 0) / n;
    return seg.map((v) => v - m);
  };
  const s = use(shoulder);
  const t = use(thigh);
  if (s === null || t === null) return null;
  const denom = Math.sqrt(s.reduce((acc, v) => acc + v * v, 0) * t.reduce((acc2, v) => acc2 + v * v, 0));
  if (!(denom > 0)) return null;
  const half = Math.min(Math.round(cycleFrames), n - 1);
  let best = Infinity;
  let bestLag = 0;
  for (let lag = -half; lag <= half; lag += 1) {
    let c = 0;
    for (let i = 0; i < n; i += 1) {
      const j = i - lag;
      if (j < 0 || j >= n) continue;
      c += s[i]! * t[j]!;
    }
    const r = c / denom;
    if (r < best) {
      best = r;
      bestLag = lag;
    }
  }
  const frac = bestLag / cycleFrames;
  return ((frac + 1.5) % 1 + 1) % 1 - 0.5;
}

// ---- reference bands (sources beside every number) ----

export type Band = {
  lo: number | null;
  hi: number | null;
  unit: string;
  sources: string[];
  note: string;
};

export const REFERENCE_BANDS: Record<string, Band> = {
  pelvisVerticalM: {
    lo: 0.03,
    hi: 0.05,
    unit: "m",
    sources: [
      "Saunders/Inman/Eberhart via Atlas of Limb Prosthetics (oandplibrary.org/alp/chap13-01): potential 7-cm compass-gait displacement reduced to 5 cm by pelvic motions",
      "Chambers & Sutherland 2002 J Am Acad Orthop Surg (Practical Guide to Gait Analysis): COM vertical rise/fall about 4 cm",
      "Della Croce et al. review via J Biomech 2014 S0021929014000888: whole-body COM peak-to-peak ~5 cm vertical at natural speed",
    ],
    note: "Pelvis vertical tracks COM vertical within millimetres. Excursion shrinks with shorter steps (Gard & Childress 2001), so the 0.707-scaled plan should read at the low end.",
  },
  pelvisLateralM: {
    lo: 0.03,
    hi: 0.05,
    unit: "m",
    sources: [
      "Chambers & Sutherland 2002 JAAOS: COM total side-to-side displacement about 5 cm",
      "Della Croce et al. review via J Biomech 2014 S0021929014000888: whole-body COM peak-to-peak ~5 cm mediolateral at natural speed",
    ],
    note: "Pelvis lateral tracks COM lateral. Same short-step caveat as vertical.",
  },
  pelvicObliquityDeg: {
    lo: 5,
    hi: 10,
    unit: "deg",
    sources: [
      "Bonnefoy & Armand 2015 (unige:81179 Normal Gait): pelvis frontal-plane ROM around 8 deg",
      "Perry & Burnfield via Northwestern VACMARL Module 4 slides: contralateral drop ~4 deg + ipsilateral drop ~4 deg over stance",
    ],
    note: "Range over the stride (max-min), not single-side drop.",
  },
  pelvicRotationDeg: {
    lo: 8,
    hi: 12,
    unit: "deg",
    sources: [
      "Bonnefoy & Armand 2015 (unige:81179): transverse-plane pelvis ROM 8-10 deg depending on walking speed",
      "Perry & Burnfield via VACMARL Module 4: pelvis rotates ~10 deg transverse (5 deg forward each side)",
    ],
    note: "Speed-dependent; slower reads lower (Bonnefoy).",
  },
  shoulderFlexExtDeg: {
    lo: 20,
    hi: 40,
    unit: "deg",
    sources: [
      "Murray et al. 1967 Phys Ther (Patterns of Sagittal Rotation of the Upper Limbs in Walking): free-speed (1.54 m/s) total shoulder excursion 32 +- 10 deg, fast 39 +- 12 deg",
      "Vorontcova et al. 2022: shoulder flexion-extension ROM 24.6 +- 3.4 deg in healthy young males",
      "Romkes & Bracht-Schweizer 2017 Gait & Posture: shoulder flexion amplitude drops with walking speed (speed-matched reading required)",
      "Collins et al. 2009 Proc R Soc B (Dynamic arm swinging): slow speeds yield very-low-amplitude arm swing (after Craik et al. 1976)",
    ],
    note: "Free-speed band; at slow SC-05 speeds expect the low end or below. Over-amplitude (above band) is the Fable flag under test, not small swing.",
  },
  elbowFlexExtDeg: {
    lo: 10,
    hi: 30,
    unit: "deg",
    sources: [
      "Murray et al. 1967 Phys Ther: free-speed total elbow excursion 30 +- 11 deg, fast 40 +- 13 deg (lower edge of the free-speed spread)",
      "Romkes & Bracht-Schweizer 2017 Gait & Posture: elbow flexion amplitude drops with walking speed",
    ],
    note: "Free-speed excursion 30+-11 deg; band low edge covers slow-speed shrinkage. Only excursion (range) is banded, not the mean angle.",
  },
  trunkLeanMeanDeg: {
    lo: -5,
    hi: 5,
    unit: "deg",
    sources: [
      "Bonnefoy & Armand 2015 (unige:81179 Trunk Segment): trunk sagittal inclination around 0 deg with ROM around 3 deg",
    ],
    note: "Source gives the mean (~0 deg); the +-5 deg envelope edges are UNSOURCED generosity, not literature. Trunk ROM itself (~3 deg) is reported alongside, unbanded.",
  },
  armLegPhaseLag: {
    lo: -0.15,
    hi: 0.15,
    unit: "cycle",
    sources: [
      "Murray et al. 1967 Phys Ther: upper-limb motion coincides with the contralateral lower limb, opposite the ipsilateral (simultaneous opposition)",
      "Yegian 2012 thesis (Roles of muscles in arm swing): arm extended at ipsilateral heel-strike, flexed halfway through the stride",
    ],
    note: "Lag of max shoulder-vs-ipsilateral-thigh anti-correlation, in cycle fractions; 0 = simultaneous opposition (the Murray anti-phase). +-0.15 tolerance edges UNSOURCED.",
  },
};

// ---- per-run analysis over live capture frames ----

export type StrideMetrics = {
  strideIndex: number;
  foot: "left" | "right";
  /** Walking-relative start/end frames of the half-cycle tile. */
  startFrame: number;
  endFrame: number;
  pelvisVerticalM: number | null;
  pelvisLateralM: number | null;
  pelvisYawDeg: number | null;
  pelvisObliquityDeg: number | null;
  shoulderLdeg: number | null;
  shoulderRdeg: number | null;
  elbowLdeg: number | null;
  elbowRdeg: number | null;
  /**
   * Diagnostic only (unbanded): ipsilateral shoulder-peak position inside
   * the tile (fraction). Anti-phase reads ~0/1 on even tiles (peak at the
   * tile edge, which starts at the thigh maximum) — the banded phase metric
   * is the cross-correlation lag (phaseLagL/R), not this.
   */
  shoulderPeakPos: number | null;
};

export type RunMetrics = {
  tag: string;
  actor: string | null;
  urlQuery: string | null;
  nFrames: number;
  nWalking: number;
  walkingSpeedMps: number | null;
  routeLengthM: number | null;
  nStridesL: number;
  nStridesR: number;
  strides: StrideMetrics[];
  trunkLeanMeanDeg: number | null;
  trunkLeanRangeDeg: number | null;
  /** Pearson r of shoulder vs ipsilateral thigh angle over walking (anti-phase reads negative). */
  shoulderThighRL: number | null;
  shoulderThighRR: number | null;
  /** Banded arm-leg phase lag per side (cycle fractions; 0 = simultaneous opposition). */
  phaseLagL: number | null;
  phaseLagR: number | null;
  /** Gait-cycle length used for tiling/lag (frames), with its source. */
  cycleFrames: number | null;
  cycleSource: string | null;
  /** Tiles dropped for spanning < 70% of a half cycle. */
  nPartialTiles: number;
  headVerticalM: number | null;
  missingUpperBody: number;
  aggregate: Record<string, number | null>;
  /** Per-walking-frame series (walking-relative order); present only when requested for dumps. */
  series: Array<Record<string, number>> | null;
};

function agg(values: Array<number | null>): number | null {
  return meanOf(values.filter((v): v is number => v !== null));
}

export function analyzeRun(
  tag: string,
  run: MeterRunFile,
  includeSeries = false,
  cycleSecondsOverride: number | null = null,
): RunMetrics {
  const frames = run.frames;
  const walkingIdx: number[] = [];
  frames.forEach((f, i) => {
    if (f.phase === "walking") walkingIdx.push(i);
  });
  const walking = walkingIdx.map((i) => frames[i]!);
  const empty: RunMetrics = {
    tag,
    actor: run.actor ?? null,
    urlQuery: run.urlQuery ?? null,
    nFrames: frames.length,
    nWalking: walking.length,
    walkingSpeedMps: null,
    routeLengthM: null,
    nStridesL: 0,
    nStridesR: 0,
    strides: [],
    trunkLeanMeanDeg: null,
    trunkLeanRangeDeg: null,
    shoulderThighRL: null,
    shoulderThighRR: null,
    phaseLagL: null,
    phaseLagR: null,
    cycleFrames: null,
    cycleSource: null,
    nPartialTiles: 0,
    headVerticalM: null,
    missingUpperBody: 0,
    aggregate: {},
    series: null,
  };
  if (walking.length === 0) return empty;

  // Travel frame: record heading first, slot-displacement fallback.
  let heading = walking.map((f) => f.travelHeading).find((h) => typeof h === "number" && Number.isFinite(h));
  if (heading === undefined) {
    const a = walking[0]!.slot;
    const b = walking[walking.length - 1]!.slot;
    if (a !== null && b !== null && Math.hypot(b.x - a.x, b.z - a.z) > 1e-6) {
      heading = Math.atan2(b.x - a.x, b.z - a.z);
    }
  }
  const fwd = typeof heading === "number" ? forwardOfHeading(heading) : { x: 0, z: 1 };
  const right = typeof heading === "number" ? rightOfHeading(heading) : { x: 1, z: 0 };

  // Per-frame series, indexed by walking-relative frame (missing probes stay
  // NaN so tiling below keeps its lattice). Pelvis yaw/obliquity come from
  // the HIP JOINT CENTRES (upperleg01 origins, rigid with the pelvis), never
  // from pelvis.L/R (co-located split halves, separation 0) nor from matrix
  // columns (non-anatomical local frame); the recorded pelvis matrix rides
  // along as an unbanded diagnostic only.
  const frameSeries = walking.map((f) => {
    const u = f.upperBody ?? null;
    const trunkUp =
      u?.spineBase != null && u?.spineTop != null ? norm(sub(u.spineTop, u.spineBase)) : null;
    const pelAvg =
      u?.pelvisL != null && u?.pelvisR != null
        ? { x: (u.pelvisL.x + u.pelvisR.x) / 2, y: (u.pelvisL.y + u.pelvisR.y) / 2, z: (u.pelvisL.z + u.pelvisR.z) / 2 }
        : null;
    const hips = f.legWorlds ?? null;
    const hipL = hips?.["hipL"] ?? null;
    const hipR = hips?.["hipR"] ?? null;
    return {
      pelvisY: pelAvg !== null ? pelAvg.y : NaN,
      pelvisLat: pelAvg !== null ? pelAvg.x * right.x + pelAvg.z * right.z : NaN,
      hipYaw: hipL !== null && hipR !== null && typeof heading === "number" ? wrapDeg(hipAxisYawDeg(hipL, hipR) - heading * DEG) : NaN,
      obl: hipL !== null && hipR !== null ? (hipObliquityDeg(hipL, hipR) ?? NaN) : NaN,
      yawMatrix: u?.pelvisMatrix != null && u.pelvisMatrix.length >= 16 ? yawFromMatrix(u.pelvisMatrix) : NaN,
      oblMatrix: u?.pelvisMatrix != null && u.pelvisMatrix.length >= 16 ? obliquityFromMatrix(u.pelvisMatrix) : NaN,
      lean:
        u?.spineBase != null && u?.spineTop != null ? (trunkLeanDeg(u.spineBase, u.spineTop, fwd) ?? NaN) : NaN,
      shL: u?.shoulderL != null && u?.elbowL != null && trunkUp !== null ? shoulderAngleDeg(u.shoulderL, u.elbowL, trunkUp, fwd) : NaN,
      shR: u?.shoulderR != null && u?.elbowR != null && trunkUp !== null ? shoulderAngleDeg(u.shoulderR, u.elbowR, trunkUp, fwd) : NaN,
      elL: u?.shoulderL != null && u?.elbowL != null && u?.wristL != null ? (elbowFlexionDeg(u.shoulderL, u.elbowL, u.wristL) ?? NaN) : NaN,
      elR: u?.shoulderR != null && u?.elbowR != null && u?.wristR != null ? (elbowFlexionDeg(u.shoulderR, u.elbowR, u.wristR) ?? NaN) : NaN,
      thL: hipL !== null && hips?.["kneeL"] != null && trunkUp !== null ? thighAngleDeg(hipL, hips["kneeL"]!, trunkUp, fwd) : NaN,
      thR: hipR !== null && hips?.["kneeR"] != null && trunkUp !== null ? thighAngleDeg(hipR, hips["kneeR"]!, trunkUp, fwd) : NaN,
      headY: u?.head != null ? u.head.y : NaN,
      hasProbe: u !== null,
    };
  });
  const missing = frameSeries.filter((r) => !r.hasProbe).length;

  // Speed: slot XZ path over walking / walking time.
  let pathM = 0;
  for (let k = 1; k < walking.length; k += 1) {
    const a = walking[k - 1]!.slot;
    const b = walking[k]!.slot;
    if (a !== null && b !== null) pathM += Math.hypot(b.x - a.x, b.z - a.z);
  }
  const speed = walking.length > 1 ? pathM / (walking.length * FRAME_SECONDS) : null;

  // Gait-cycle length (frames). First: clip truth (labels.cycleSeconds) over
  // the measured clipTime slope (unwrap mod cycle, endpoints slope); else the
  // thigh-autocorrelation fallback. Bound frames carry sample times as
  // clipTime, so the same path yields cycleS x offline sample rate there.
  const cycleS = cycleSecondsOverride ?? run.labels?.cycleSeconds ?? null;
  let cycleFrames: number | null = null;
  let cycleSource: string | null = null;
  if (cycleS !== null && cycleS > 0) {
    const ct = walking
      .map((f) => f.clipTime)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (ct.length >= 3) {
      // Unwrap mod cycle, then endpoints slope.
      const uw: number[] = [ct[0]!];
      for (let i = 1; i < ct.length; i += 1) {
        let v = ct[i]!;
        while (v < uw[uw.length - 1]!) v += cycleS;
        uw.push(v);
      }
      const slope = (uw[uw.length - 1]! - uw[0]!) / (uw.length - 1);
      if (slope > 1e-6) {
        cycleFrames = cycleS / slope;
        cycleSource = `labels(${cycleS.toFixed(3)}s)/clipSlope(${slope.toFixed(4)}s/f)`;
      }
    }
  }
  const col = (key: "pelvisY" | "pelvisLat" | "hipYaw" | "obl" | "shL" | "shR" | "elL" | "elR" | "thL" | "thR"): number[] =>
    frameSeries.map((r) => r[key]);
  const sm = (key: "shL" | "shR" | "thL" | "thR"): number[] => smooth(col(key), 2);
  if (cycleFrames === null) {
    const autoL = cycleFramesAuto(sm("thL"));
    const autoR = cycleFramesAuto(sm("thR"));
    const autos = [autoL, autoR].filter((v): v is number => v !== null);
    if (autos.length > 0) {
      cycleFrames = autos.reduce((s, v) => s + v, 0) / autos.length;
      cycleSource = `auto(L=${autoL ?? "n/a"},R=${autoR ?? "n/a"})`;
    }
  }

  // Full-cycle tiles per foot, anchored on the global smoothed-thigh maximum
  // and repeated every cycle in both directions. Full-cycle (not half-cycle)
  // windows: the bound clip's arm swing dwells at extension (broad minimum
  // plateau), so a half-cycle tile misses the global minimum while a full
  // cycle contains every phase by construction — and textbook ROM bands are
  // full-cycle excursions. Peak-to-peak anchoring would defeat the thigh's
  // stance bump; a single global anchor does not care how many bumps sit
  // inside. Ranges ride on RAW slices (no smoothing attenuation); edge tiles
  // under 80% of a cycle are dropped and counted. The walk-start transient
  // is included (documented); transients read small, never fabricated
  // over-amplitude.
  const slice = (xs: number[], lo: number, hi: number): number[] => xs.slice(lo, hi + 1);
  const argPeak = (xs: number[], lo: number, hi: number): number | null => {
    let best = -Infinity;
    let bi = -1;
    for (let i = lo; i <= hi; i += 1) {
      const v = xs[i];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (v > best) {
        best = v;
        bi = i;
      }
    }
    if (bi < 0 || hi <= lo) return null;
    return (bi - lo) / (hi - lo);
  };
  const argMaxAll = (xs: number[]): number => {
    let best = -Infinity;
    let bi = 0;
    xs.forEach((v, i) => {
      if (Number.isFinite(v) && v > best) {
        best = v;
        bi = i;
      }
    });
    return bi;
  };

  const strides: StrideMetrics[] = [];
  let nPartialTiles = 0;
  if (cycleFrames !== null && cycleFrames >= 10) {
    (["left", "right"] as const).forEach((foot, footIdx) => {
      const anchor = argMaxAll(sm(foot === "left" ? "thL" : "thR"));
      for (let k = -Math.ceil((anchor + 1) / cycleFrames) - 1; k * cycleFrames < walking.length + cycleFrames; k += 1) {
        const lo = Math.round(anchor + k * cycleFrames);
        const hi = Math.round(anchor + (k + 1) * cycleFrames);
        const clo = Math.max(0, lo);
        const chi = Math.min(walking.length - 1, hi);
        if (clo > chi) continue;
        if (chi - clo + 1 < 0.8 * cycleFrames) {
          nPartialTiles += 1;
          continue;
        }
        const seg = (key: "pelvisY" | "pelvisLat" | "hipYaw" | "obl" | "shL" | "shR" | "elL" | "elR"): number[] =>
          slice(col(key), clo, chi);
        strides.push({
          strideIndex: footIdx * 100 + strides.filter((s) => s.foot === foot).length,
          foot,
          startFrame: walkingIdx[clo]!,
          endFrame: walkingIdx[chi]!,
          pelvisVerticalM: rangeOf(seg("pelvisY")),
          pelvisLateralM: rangeOf(seg("pelvisLat")),
          pelvisYawDeg: rangeOf(seg("hipYaw")),
          pelvisObliquityDeg: rangeOf(seg("obl")),
          shoulderLdeg: rangeOf(seg("shL")),
          shoulderRdeg: rangeOf(seg("shR")),
          elbowLdeg: rangeOf(seg("elL")),
          elbowRdeg: rangeOf(seg("elR")),
          shoulderPeakPos: argPeak(sm(foot === "left" ? "shL" : "shR"), clo, chi),
        });
      }
    });
  } else {
    // Cycle unknown: one tile over the whole walk per foot (documented).
    cycleSource = cycleSource ?? "unknown: whole-walk tile";
    (["left", "right"] as const).forEach((foot, footIdx) => {
      const lo = 0;
      const hi = walking.length - 1;
      const seg = (key: "pelvisY" | "pelvisLat" | "hipYaw" | "obl" | "shL" | "shR" | "elL" | "elR"): number[] =>
        slice(col(key), lo, hi);
      strides.push({
        strideIndex: footIdx * 100,
        foot,
        startFrame: walkingIdx[lo]!,
        endFrame: walkingIdx[hi]!,
        pelvisVerticalM: rangeOf(seg("pelvisY")),
        pelvisLateralM: rangeOf(seg("pelvisLat")),
        pelvisYawDeg: rangeOf(seg("hipYaw")),
        pelvisObliquityDeg: rangeOf(seg("obl")),
        shoulderLdeg: rangeOf(seg("shL")),
        shoulderRdeg: rangeOf(seg("shR")),
        elbowLdeg: rangeOf(seg("elL")),
        elbowRdeg: rangeOf(seg("elR")),
        shoulderPeakPos: null,
      });
    });
  }

  const cyc = cycleFrames ?? NaN;
  const aggregate: Record<string, number | null> = {
    pelvisVerticalM: agg(strides.map((s) => s.pelvisVerticalM)),
    pelvisLateralM: agg(strides.map((s) => s.pelvisLateralM)),
    pelvisYawDeg: agg(strides.map((s) => s.pelvisYawDeg)),
    pelvisObliquityDeg: agg(strides.map((s) => s.pelvisObliquityDeg)),
    shoulderLdeg: agg(strides.map((s) => s.shoulderLdeg)),
    shoulderRdeg: agg(strides.map((s) => s.shoulderRdeg)),
    elbowLdeg: agg(strides.map((s) => s.elbowLdeg)),
    elbowRdeg: agg(strides.map((s) => s.elbowRdeg)),
    phaseLagL: Number.isFinite(cyc) ? armLegLag(sm("shL"), sm("thL"), cyc) : null,
    phaseLagR: Number.isFinite(cyc) ? armLegLag(sm("shR"), sm("thR"), cyc) : null,
  };

  return {
    ...empty,
    walkingSpeedMps: speed,
    routeLengthM: pathM,
    nStridesL: strides.filter((s) => s.foot === "left").length,
    nStridesR: strides.filter((s) => s.foot === "right").length,
    strides,
    trunkLeanMeanDeg: meanOf(frameSeries.map((r) => r.lean)),
    trunkLeanRangeDeg: rangeOf(frameSeries.map((r) => r.lean)),
    shoulderThighRL: pearson(col("shL"), col("thL")),
    shoulderThighRR: pearson(col("shR"), col("thR")),
    phaseLagL: aggregate["phaseLagL"] ?? null,
    phaseLagR: aggregate["phaseLagR"] ?? null,
    cycleFrames,
    cycleSource,
    nPartialTiles,
    headVerticalM: rangeOf(frameSeries.map((r) => r.headY)),
    missingUpperBody: missing,
    aggregate,
    series: includeSeries
      ? frameSeries.map((r) => ({
        pelvisY: r.pelvisY, pelvisLat: r.pelvisLat, hipYaw: r.hipYaw, obl: r.obl,
        lean: r.lean, shL: r.shL, shR: r.shR, elL: r.elL, elR: r.elR,
        thL: r.thL, thR: r.thR, headY: r.headY,
      }))
      : null,
  };
}

// ---- offline bound-clip FK (full world matrices) ----

type Channel = {
  path: "translation" | "rotation" | "scale";
  times: Float32Array;
  values: Float32Array;
  stride: number;
  interpolation: string;
};

type Rig = {
  channels: Array<{ node: GltfNode; ch: Channel }>;
  nodes: GltfNode[];
  parentOf: Map<string, string>;
  byName: Map<string, GltfNode>;
};

/**
 * Quaternion to COLUMN-major 3x3 (three.js layout: col0 = R00,R10,R20).
 * A row-major return here transposes every local rotation (found 2026-10-18:
 * the offline pelvis axis drifted 77 deg over the clip from this).
 */
function quatToMat(r: [number, number, number, number]): number[] {
  const [x, y, z, w] = r;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy),
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx),
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy),
  ];
}

function slerp(a: [number, number, number, number], b: [number, number, number, number], t: number): [number, number, number, number] {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (d < 0) {
    d = -d;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (d > 0.9995) {
    const o: [number, number, number, number] = [
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ];
    const l = Math.hypot(o[0], o[1], o[2], o[3]) || 1;
    return [o[0] / l, o[1] / l, o[2] / l, o[3] / l];
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

function sampleChannel(ch: Channel, t: number): number[] {
  const n = ch.times.length;
  const at = (i: number): number[] => Array.from(ch.values.subarray(i * ch.stride, i * ch.stride + ch.stride));
  if (t <= ch.times[0]!) return at(0);
  if (t >= ch.times[n - 1]!) return at(n - 1);
  let hi = 1;
  while (hi < n && ch.times[hi]! < t) hi += 1;
  const lo = hi - 1;
  const span = ch.times[hi]! - ch.times[lo]!;
  const f = span === 0 ? 0 : (t - ch.times[lo]!) / span;
  const a = at(lo);
  const b = at(hi);
  if (ch.path === "rotation")
    return slerp(a as [number, number, number, number], b as [number, number, number, number], f);
  return a.map((v, i) => v + (b[i]! - v) * f);
}

function matMul4(a: number[], b: number[]): number[] {
  const o = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r += 1)
    for (let c = 0; c < 4; c += 1)
      o[c * 4 + r] = a[0 * 4 + r]! * b[c * 4 + 0]! + a[1 * 4 + r]! * b[c * 4 + 1]! + a[2 * 4 + r]! * b[c * 4 + 2]! + a[3 * 4 + r]! * b[c * 4 + 3]!;
  return o;
}

/** World matrix (column-major, three.js layout) of a node at time t (null = bind pose). */
function worldMatrixAt(rig: Rig, nodeName: string, t: number | null): number[] {
  const target = rig.byName.get(nodeName);
  if (!target) throw new Error(`no node ${nodeName}`);
  const chain: GltfNode[] = [];
  let n: GltfNode | undefined = target;
  for (;;) {
    chain.unshift(n);
    const parentName = rig.parentOf.get(n.getName());
    if (!parentName) break;
    n = rig.nodes.find((c) => c.getName() === parentName);
    if (!n) break;
  }
  let M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const node of chain) {
    let tr = node.getTranslation() as unknown as [number, number, number];
    let ro = node.getRotation() as unknown as [number, number, number, number];
    let sc = node.getScale() as unknown as [number, number, number];
    if (t !== null) {
      for (const { node: cn, ch } of rig.channels) {
        if (cn !== node) continue;
        const v = sampleChannel(ch, t);
        if (ch.path === "translation") tr = v as [number, number, number];
        else if (ch.path === "rotation") ro = v as [number, number, number, number];
        else sc = v as [number, number, number];
      }
    }
    const R = quatToMat(ro);
    const L = [
      R[0]! * sc[0], R[1]! * sc[0], R[2]! * sc[0], 0,
      R[3]! * sc[1], R[4]! * sc[1], R[5]! * sc[1], 0,
      R[6]! * sc[2], R[7]! * sc[2], R[8]! * sc[2], 0,
      tr[0], tr[1], tr[2], 1,
    ];
    M = matMul4(M, L);
  }
  return M;
}

const posOf = (M: number[]): Vec3 => ({ x: M[12]!, y: M[13]!, z: M[14]! });

async function loadRig(glbPath: string, clipName: string): Promise<{ rig: Rig; times: number[] }> {
  const doc = await new NodeIO().read(glbPath);
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === clipName);
  if (!anim)
    throw new Error(`no clip ${clipName} in ${glbPath}: ${doc.getRoot().listAnimations().map((a) => a.getName()).join(",")}`);
  const channels: Array<{ node: GltfNode; ch: Channel }> = [];
  let times: Float32Array | null = null;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const sampler = ch.getSampler();
    const p = ch.getTargetPath();
    if (!node || !sampler || !p) continue;
    if (p !== "translation" && p !== "rotation" && p !== "scale") continue;
    if (sampler.getInterpolation() === "CUBICSPLINE") throw new Error(`CUBICSPLINE on ${node.getName()}, refused`);
    const tIn = sampler.getInput()?.getArray();
    const vOut = sampler.getOutput()?.getArray();
    if (!tIn || !vOut) continue;
    channels.push({
      node,
      ch: {
        path: p,
        times: Float32Array.from(tIn),
        values: Float32Array.from(vOut),
        stride: p === "rotation" ? 4 : 3,
        interpolation: sampler.getInterpolation(),
      },
    });
    if (!times || tIn.length > times.length) times = Float32Array.from(tIn);
  }
  if (!times) throw new Error("no sampled channels");
  const nodes = doc.getRoot().listNodes();
  const parentOf = new Map<string, string>();
  for (const n of nodes) for (const c of n.listChildren()) parentOf.set(c.getName(), n.getName());
  return { rig: { channels, nodes, parentOf, byName: new Map(nodes.map((n) => [n.getName(), n])) }, times: Array.from(times) };
}

export type BoundMetrics = {
  glb: string;
  clip: string;
  nFrames: number;
  durationS: number;
  fwdBind: { x: number; z: number };
  aggregate: Record<string, number | null>;
  strides: StrideMetrics[];
  trunkLeanMeanDeg: number | null;
  trunkLeanRangeDeg: number | null;
  shoulderThighRL: number | null;
  shoulderThighRR: number | null;
  cycleFrames: number | null;
  cycleSource: string | null;
  series: Array<Record<string, number>> | null;
};

/**
 * Measure the bound clip offline: FK every joint at every clip sample,
 * synthesise meter frames, run the identical stride analysis. Forward comes
 * from the bind pose (toe minus foot, XZ); positions carry BOUND_ACTOR_SCALE.
 */
export async function analyzeBoundClip(
  glbPath: string,
  clipName: string,
  includeSeries = false,
  cycleSecondsOverride: number | null = null,
): Promise<BoundMetrics> {
  const { rig, times } = await loadRig(glbPath, clipName);
  const W = (name: string, t: number): number[] => worldMatrixAt(rig, name, t);
  const P = (name: string, t: number): Vec3 => {
    const p = posOf(W(name, t));
    return { x: p.x * BOUND_ACTOR_SCALE, y: p.y * BOUND_ACTOR_SCALE, z: p.z * BOUND_ACTOR_SCALE };
  };
  // Bind-pose forward: toe ahead of foot in XZ.
  const toeBind = posOf(worldMatrixAt(rig, "toe1-1.L", null));
  const footBind = posOf(worldMatrixAt(rig, "foot.L", null));
  const fRaw = { x: toeBind.x - footBind.x, z: toeBind.z - footBind.z };
  const fLen = Math.hypot(fRaw.x, fRaw.z) || 1;
  const fwd = { x: fRaw.x / fLen, z: fRaw.z / fLen };
  const heading = Math.atan2(fwd.x, fwd.z);

  const frames: MeterFrame[] = times.map((t) => {
    const pelvisMatrix = W("pelvis.L", t);
    return {
      phase: "walking",
      slot: null,
      leftToe: P("toe1-1.L", t),
      rightToe: P("toe1-1.R", t),
      clipTime: t,
      travelHeading: heading,
      legWorlds: {
        hipL: P("upperleg01.L", t),
        kneeL: P("lowerleg01.L", t),
        hipR: P("upperleg01.R", t),
        kneeR: P("lowerleg01.R", t),
      },
      upperBody: {
        pelvisL: P("pelvis.L", t),
        pelvisR: P("pelvis.R", t),
        pelvisMatrix,
        spineBase: P("spine05", t),
        spineTop: P("spine01", t),
        shoulderL: P("shoulder01.L", t),
        shoulderR: P("shoulder01.R", t),
        elbowL: P("lowerarm01.L", t),
        elbowR: P("lowerarm01.R", t),
        wristL: P("wrist.L", t),
        wristR: P("wrist.R", t),
        head: P("head", t),
      },
    };
  });
  const run = analyzeRun("bound-clip", { frames }, includeSeries, cycleSecondsOverride);
  return {
    glb: glbPath,
    clip: clipName,
    nFrames: times.length,
    durationS: times.length > 0 ? times[times.length - 1]! - times[0]! : 0,
    fwdBind: fwd,
    aggregate: run.aggregate,
    strides: run.strides,
    trunkLeanMeanDeg: run.trunkLeanMeanDeg,
    trunkLeanRangeDeg: run.trunkLeanRangeDeg,
    shoulderThighRL: run.shoulderThighRL,
    shoulderThighRR: run.shoulderThighRR,
    cycleFrames: run.cycleFrames,
    cycleSource: run.cycleSource,
    series: run.series,
  };
}

// ---- CLI ----

function arg(name: string): string | null {
  const key = name.startsWith("--") ? name.slice(2) : name;
  return process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? null;
}

export type Verdict = {
  ours: number | null;
  bound: number | null;
  band: Band;
  status: "inside" | "above" | "below" | "no-data";
  note: string;
};

function judge(ours: number | null, bound: number | null, band: Band): Verdict {
  if (ours === null || !Number.isFinite(ours)) return { ours, bound, band, status: "no-data", note: "" };
  if (band.lo !== null && ours < band.lo) return { ours, bound, band, status: "below", note: "" };
  if (band.hi !== null && ours > band.hi) return { ours, bound, band, status: "above", note: "" };
  return { ours, bound, band, status: "inside", note: "" };
}

async function readRuns(dir: string, vehicle: string): Promise<Array<{ tag: string; run: MeterRunFile }>> {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".json") && f.startsWith(`${vehicle}-run`) && !f.startsWith("tap-"))
    .sort();
  const out: Array<{ tag: string; run: MeterRunFile }> = [];
  for (const file of files) {
    const run = JSON.parse(await readFile(path.join(dir, file), "utf8")) as MeterRunFile;
    if (!Array.isArray(run.frames)) continue;
    out.push({ tag: file.replace(/\.json$/, ""), run });
  }
  return out;
}

function meanRuns(runs: RunMetrics[], pick: (r: RunMetrics) => number | null): number | null {
  return meanOf(runs.map(pick).filter((v): v is number => v !== null));
}

/** Clip-truth cycle seconds off the first run file carrying labels. */
async function readCycleSeconds(dir: string, vehicle: string): Promise<number | null> {
  for (const { run } of await readRuns(dir, vehicle)) {
    const c = run.labels?.cycleSeconds;
    if (typeof c === "number" && c > 0) return c;
  }
  return null;
}

async function main(): Promise<void> {
  const physicianDir = arg("--physician");
  const nurseDir = arg("--nurse");
  const childDir = arg("--child");
  const cruiseDir = arg("--cruise");
  const boundGlb = arg("--bound-glb");
  const outPath = arg("--out");
  const dumpDir = arg("--dump-series");
  if (!physicianDir || !nurseDir || !childDir || !cruiseDir || !boundGlb || !outPath) {
    throw new Error("usage: upper-body-meter.ts --physician=dir --nurse=dir --child=dir --cruise=dir --bound-glb=path --out=measure.json [--vehicle=sc05]");
  }
  const vehicle = arg("--vehicle") ?? "sc05";

  const groups: Record<string, RunMetrics[]> = {};
  for (const [key, dir] of [
    ["sc05-physician", physicianDir],
    ["sc05-nurse", nurseDir],
    ["sc05-child", childDir],
    ["cruise-physician", cruiseDir],
  ] as const) {
    const runs = await readRuns(dir, vehicle);
    if (runs.length === 0) throw new Error(`no ${vehicle} run files in ${dir}`);
    groups[key] = runs.map(({ tag, run }) => analyzeRun(`${key}/${tag}`, run, dumpDir !== null));
    for (const m of groups[key]!) {
      process.stdout.write(
        `[${m.tag}] walk=${m.nWalking} tilesL/R=${m.nStridesL}/${m.nStridesR} ` +
          `cycle=${m.cycleFrames?.toFixed(1) ?? "n/a"}(${m.cycleSource ?? "?"}) ` +
          `lagL/R=${m.phaseLagL?.toFixed(2) ?? "n/a"}/${m.phaseLagR?.toFixed(2) ?? "n/a"} ` +
          `speed=${m.walkingSpeedMps?.toFixed(3) ?? "n/a"} missingUB=${m.missingUpperBody}\n`,
      );
    }
  }

  // The bound clip is the same clip the runtime plays: seed its cycle from
  // the first physician run's labels (clip truth), not from autocorrelation.
  const boundCycleS = await readCycleSeconds(physicianDir, vehicle);
  process.stdout.write("sampling bound clip offline...\n");
  const bound = await analyzeBoundClip(boundGlb, BOUND_CLIP, dumpDir !== null, boundCycleS);
  process.stdout.write(
    `bound: ${bound.nFrames} frames, ${bound.durationS.toFixed(2)} s, ` +
      `cycle=${bound.cycleFrames?.toFixed(1) ?? "n/a"}(${bound.cycleSource ?? "?"}) ` +
      `lagL/R=${bound.aggregate["phaseLagL"]?.toFixed(2) ?? "n/a"}/${bound.aggregate["phaseLagR"]?.toFixed(2) ?? "n/a"}\n`,
  );

  const aggKeys = [
    "pelvisVerticalM",
    "pelvisLateralM",
    "pelvisYawDeg",
    "pelvisObliquityDeg",
    "shoulderLdeg",
    "shoulderRdeg",
    "elbowLdeg",
    "elbowRdeg",
    "phaseLagL",
    "phaseLagR",
  ] as const;
  const bandFor: Record<string, string> = {
    pelvisVerticalM: "pelvisVerticalM",
    pelvisLateralM: "pelvisLateralM",
    pelvisYawDeg: "pelvicRotationDeg",
    pelvisObliquityDeg: "pelvicObliquityDeg",
    shoulderLdeg: "shoulderFlexExtDeg",
    shoulderRdeg: "shoulderFlexExtDeg",
    elbowLdeg: "elbowFlexExtDeg",
    elbowRdeg: "elbowFlexExtDeg",
    phaseLagL: "armLegPhaseLag",
    phaseLagR: "armLegPhaseLag",
  };

  const rigs: Record<string, { runs: RunMetrics[]; verdicts: Record<string, Verdict> }> = {};
  for (const [key, runs] of Object.entries(groups)) {
    const verdicts: Record<string, Verdict> = {};
    for (const k of aggKeys) {
      const ours = meanRuns(runs, (r) => r.aggregate[k] ?? null);
      const boundV = bound.aggregate[k] ?? null;
      verdicts[k] = judge(ours, boundV, REFERENCE_BANDS[bandFor[k]!]!);
    }
    const leanOurs = meanRuns(runs, (r) => r.trunkLeanMeanDeg);
    verdicts["trunkLeanMeanDeg"] = judge(leanOurs, bound.trunkLeanMeanDeg, REFERENCE_BANDS["trunkLeanMeanDeg"]!);
    rigs[key] = { runs, verdicts };
  }

  // Pre-registered decision: STOP when every verdict is inside; else name the
  // single worst out-of-band quantity (largest relative exceedance past the
  // nearer edge) for the one-fix step.
  let worst: { rig: string; quantity: string; exceedance: number } | null = null;
  for (const [rig, { verdicts }] of Object.entries(rigs)) {
    for (const [q, v] of Object.entries(verdicts)) {
      if (v.status !== "above" && v.status !== "below") continue;
      const edge = v.status === "above" ? v.band.hi! : v.band.lo!;
      const exc = edge !== 0 ? Math.abs(v.ours! - edge) / Math.abs(edge) : Math.abs(v.ours! - edge);
      if (worst === null || exc > worst.exceedance) worst = { rig, quantity: q, exceedance: exc };
    }
  }
  const outsiders = Object.entries(rigs).flatMap(([rig, { verdicts }]) =>
    Object.entries(verdicts)
      .filter(([, v]) => v.status !== "inside")
      .map(([q, v]) => `${rig}.${q}=${v.status}(${v.ours?.toFixed(3) ?? "n/a"})`),
  );
  const decision =
    worst === null
      ? "STOP (every quantity inside its band on every rig)"
      : `STEP2 (out: ${outsiders.join(", ")}; worst: ${worst.rig}.${worst.quantity})`;

  const result = {
    schemaVersion: "openclinxr.upper-body-measure.v1",
    measuredAt: new Date().toISOString(),
    inputs: { physicianDir, nurseDir, childDir, cruiseDir, vehicle, boundGlb, boundClip: BOUND_CLIP, actorScale: BOUND_ACTOR_SCALE },
    bands: REFERENCE_BANDS,
    bound,
    rigs: Object.fromEntries(
      Object.entries(rigs).map(([rig, { runs, verdicts }]) => [
        rig,
        {
          nRuns: runs.length,
          speedMps: runs.map((r) => r.walkingSpeedMps),
          stridesPerRun: runs.map((r) => [r.nStridesL, r.nStridesR]),
          means: Object.fromEntries(aggKeys.map((k) => [k, meanRuns(runs, (r) => r.aggregate[k] ?? null)])),
          trunkLeanMeanDeg: meanRuns(runs, (r) => r.trunkLeanMeanDeg),
          trunkLeanRangeDeg: meanRuns(runs, (r) => r.trunkLeanRangeDeg),
          shoulderThighR: { left: meanRuns(runs, (r) => r.shoulderThighRL), right: meanRuns(runs, (r) => r.shoulderThighRR) },
          cycleFrames: runs.map((r) => r.cycleFrames),
          cycleSource: runs.map((r) => r.cycleSource),
          nPartialTiles: runs.map((r) => r.nPartialTiles),
          headVerticalM: meanRuns(runs, (r) => r.headVerticalM),
          verdicts: Object.fromEntries(
            Object.entries(verdicts).map(([k, v]) => [k, { ours: v.ours, bound: v.bound, status: v.status, band: [v.band.lo, v.band.hi] }]),
          ),
          runs,
        },
      ]),
    ),
    decision,
  };
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`decision: ${decision}\nwrote ${outPath}\n`);
  if (dumpDir !== null) {
    await mkdir(path.resolve(dumpDir), { recursive: true });
    for (const { runs } of Object.values(rigs)) {
      for (const r of runs) {
        if (r.series !== null)
          await writeFile(
            path.join(path.resolve(dumpDir), `${r.tag.replace("/", "-")}.series.json`),
            JSON.stringify({ tag: r.tag, series: r.series }),
          );
      }
    }
    if (bound.series !== null)
      await writeFile(
        path.join(path.resolve(dumpDir), "bound-clip.series.json"),
        JSON.stringify({ tag: "bound-clip", series: bound.series }),
      );
    process.stdout.write(`wrote series dumps to ${dumpDir}\n`);
  }
}

const invokedAsMain = (process.argv[1] ?? "").endsWith("upper-body-meter.ts");
if (invokedAsMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
