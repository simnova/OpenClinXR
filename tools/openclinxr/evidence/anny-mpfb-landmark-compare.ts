/**
 * #297 inspect — MADR 0051 §4 landmark instrument.
 *
 * Extracts the MADR 0051 §4 landmark set (stature, shoulder span, chest / waist /
 * hip girth, limb segment lengths, head height) from a mesh in metres, with girths
 * measured TORSO-ONLY. Arms are excluded by MESH-SURFACE connectivity (the OBJ
 * faces: at trunk height the arms are separate surface tubes, so they never fuse
 * with the torso even when an obese abdomen pushes them against it in XZ — the
 * #298 defect), falling back to lateral XZ clustering when no faces are present.
 * The waist is measured at the natural-waist height where
 * anny.Anthropometry.waist_circumference's own ring sits (~0.62-0.64 H on adult
 * bodies), NOT at "narrowest between chest and hip" — the MADR's original wording
 * stops being the waist when the abdomen is the widest part of the body (a BMI-45
 * anny body measured 0.42 m short under it). Emits:
 *   - one landmark artifact per reference mesh
 *   - a comparison artifact with per-landmark deltas + the MADR 0051 §5 bands
 *     (with stated source) and the measured margin per row.
 *
 * claimScope: MADR 0051 step-4 measurement half — Anny-as-reference → MPFB body match
 *   landmark instrument; the first Anny↔Anny comparison rows against the tracked
 *   genuine `.anny_base.obj` references.
 * notEvidenceFor: the MPFB solve loop (MADR 0051 §6) and tuning table (§7); anthropometric
 *   or clinical validity; learner readiness; Quest readiness. This is a comparison
 *   instrument, not a measurement standard.
 *
 * Every artifact records `annyPath: real_anny_forward_pass` only when the adjacent
 * provenance record carries `real_anny_mpfb2_forward_pass_v1` (verified by reading the
 * file, not assumed) — per MADR 0051's BLOCKER note that a stub reference is not
 * evidence for this protocol.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = nodePath.resolve(HERE, "../../..");

/** Tracked genuine Anny reference bases under apps/ui-xr/public/generated-humanoids. */
export const ANNY_REFERENCE_ASSETS = [
  "adult_male_street_casual",
  "ed_chest_pain_spouse_adult",
  "peds_patient_child",
] as const;

export const GENERATED_HUMANOIDS_DIR = nodePath.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids",
);

export const EVIDENCE_DIR = nodePath.join(REPO_ROOT, ".openclinxr/evidence/issue-297");
export const LANDMARKS_DIR = nodePath.join(EVIDENCE_DIR, "landmarks");
export const COMPARISON_ARTIFACT_PATH = nodePath.join(
  EVIDENCE_DIR,
  "landmark-comparison.json",
);

/**
 * Anatomical band windows (fractions of measured stature). The MADR names chest
 * girth "at chest height" but children's arms attach lower relatively (the child's
 * armpit is at ~0.67 H against ~0.74–0.75 H for the adults — measured 2026-08-10),
 * so a fixed chest fraction would silently include the deltoid mass on the child.
 * The chest is therefore detected as the fullest torso-only slice between the waist
 * and the armpit junction; every other window below follows the MADR's own
 * data-driven definitions (waist = narrowest between chest and hip, hip = widest
 * below waist).
 */
export const BAND_WINDOWS = {
  /**
   * waist search: the natural-waist band, ANCHORED to anny's own waist ring.
   * anny.Anthropometry.waist_circumference runs through a fixed base-mesh vertex
   * ring that sits at ~0.617-0.639 H on adult bodies (measured 2026-08-10: mean
   * 0.622 lean / 0.626 BMI-45), so the mesh instrument must measure there too.
   * "Narrowest between chest and hip" stops being the waist when the abdomen is
   * the widest part of the body — on a BMI-45 anny body it picks a degenerate
   * slice (the belly/back split apart at the waist) and reads 0.42 m short. The
   * window is therefore the anny waist-ring height; the narrowest torso-only slice
   * within it is chosen (0.64 H on the step grid for every body measured).
   */
  waist: [0.61, 0.65] as const,
  /** hip search: widest torso slice below the waist, down to the crotch */
  hipFrom: 0.44,
  /** neck search: narrowest torso slice below the head */
  neck: [0.78, 0.92] as const,
  /** ankle search: narrowest leg slice above the foot */
  ankle: [0.04, 0.14] as const,
  /** elbow search (arm-width local minimum between biceps and wrist) */
  elbow: [0.56, 0.72] as const,
};

/** Anthropometric fallbacks used ONLY when the mesh shows no real joint minimum. */
export const JOINT_FALLBACK_FRACTIONS = {
  /** knee height as a fraction of stature (standard anthropometry) */
  knee: 0.285,
  /** elbow at 55% of the measured arm length from the shoulder junction */
  elbowOfArm: 0.55,
};

/** Lateral-clustering radius (metres): arms become separate clusters beyond this. */
export const CLUSTER_RADIUS_METERS = 0.05;
/** Band thickness / step as fractions of stature. */
export const BAND_THICKNESS_FRACTION = 0.04;
export const BAND_STEP_FRACTION = 0.02;

type V3 = [number, number, number];

export function parseObj(text: string): { positions: V3[]; faces: number[][] } {
  const positions: V3[] = [];
  const faces: number[][] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("v ")) {
      const p = t.split(/\s+/).slice(1).map(Number);
      positions.push([p[0]!, p[1]!, p[2]!]);
    } else if (t.startsWith("f ")) {
      const idx = t
        .split(/\s+/)
        .slice(1)
        .map((tok) => {
          const n = Number(tok.split("/")[0]);
          return n > 0 ? n - 1 : positions.length + n;
        });
      faces.push(idx);
    }
  }
  return { positions, faces };
}

/**
 * Read the source-topology record from the adjacent provenance / manifest files.
 * The fields live at different paths across the two schemas:
 *   .provenance.json   → sourceOriginChain.sourceTopologyMode, licenseChain.baseTopologyMode
 *   .anny_manifest.json → output.source_topology_mode, material_hints.sourceTopologyMode,
 *                         anny_forward_pass.kind
 * A deep key search covers all of them; the first value matching the genuine-Anny
 * marker wins, so a stub cannot masquerade as a forward pass.
 */
const REAL_ANNY_MARKERS = ["real_anny_mpfb2_forward_pass_v1", "real_anny_forward_pass"];

function deepFindTopologyMode(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    return REAL_ANNY_MARKERS.some((m) => value.includes(m)) ? value : null;
  }
  if (typeof value !== "object") return null;
  for (const [k, v] of Object.entries(value)) {
    if (/topology.?mode|forward_pass|generator_mode|generatorMode/i.test(k)) {
      if (typeof v === "string" && REAL_ANNY_MARKERS.some((m) => v.includes(m))) return v;
    }
    const hit = deepFindTopologyMode(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function readProvenanceSource(meshId: string): {
  sourceTopologyMode: string | null;
  provenancePath: string | null;
} {
  for (const suffix of [".provenance.json", ".anny_manifest.json"]) {
    const p = nodePath.join(GENERATED_HUMANOIDS_DIR, `${meshId}${suffix}`);
    if (!existsSync(p)) continue;
    try {
      const rec = JSON.parse(readFileSync(p, "utf8"));
      const mode = deepFindTopologyMode(rec);
      if (mode) return { sourceTopologyMode: mode, provenancePath: p };
    } catch {
      /* unreadable provenance — fall through to the next candidate */
    }
  }
  return { sourceTopologyMode: null, provenancePath: null };
}

type ArmCluster = { cx: number; width: number };

type BandProfile = {
  y: number;
  frac: number;
  torsoWidth: number;
  torsoDepth: number;
  torsoPerimeter: number;
  naiveWidth: number;
  nComponents: number;
  /** true when the arms are fused into the torso cluster (no separate arm mass) */
  armsFused: boolean;
  /** non-torso clusters with |cx| clearly outside the torso (hanging/abducted arms) */
  armClusters: ArmCluster[];
};

function convexHullPerimeter(pts: Array<[number, number]>): number {
  if (pts.length < 3) return 0;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const pt of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, pt) <= 0
    )
      lower.pop();
    lower.push(pt);
  }
  const upper: Array<[number, number]> = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, pt) <= 0
    )
      upper.pop();
    upper.push(pt);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let per = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    per += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return per;
}

/**
 * Build the band profile for a mesh. For each horizontal band, the band's vertices
 * are separated into components by MESH-SURFACE connectivity (union-find over the
 * OBJ faces restricted to the band) — the arms and legs are separate surface tubes
 * below the armpit/crotch, so they never fuse with the torso even when they touch
 * it in XZ. This is the #298 fix: on an obese body the abdomen pushes the arms out
 * until the horizontal gap to the torso closes, and the old lateral XZ clustering
 * (radius CLUSTER_RADIUS_METERS) merged arm and belly into one cluster at the waist
 * height — the "torso" perimeter then silently dropped the belly and read 0.42 m
 * short. When no faces are supplied, the XZ clustering is the fallback.
 * The torso component is the one containing the band vertex nearest the body centre
 * axis (median x over all vertices).
 */
export function buildBandProfile(
  positions: V3[],
  faces?: number[][],
): {
  stature: number;
  centerX: number;
  bands: BandProfile[];
} {
  const ys = positions.map((p) => p[1]);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  const stature = ymax - ymin;
  const xs = positions.map((p) => p[0]).sort((a, b) => a - b);
  const centerX = xs[Math.floor(xs.length / 2)]!;

  // Surface adjacency from the OBJ faces, built once. O(faces) per band afterwards.
  const adjacency: number[][] = [];
  if (faces && faces.length > 0) {
    for (let i = 0; i < positions.length; i++) adjacency.push([]);
    for (const f of faces) {
      for (let e = 0; e < 3; e++) {
        const a = f[e]!;
        const b = f[(e + 1) % 3]!;
        adjacency[a]!.push(b);
        adjacency[b]!.push(a);
      }
    }
  }

  const bandH = stature * BAND_THICKNESS_FRACTION;
  const step = stature * BAND_STEP_FRACTION;
  const bands: BandProfile[] = [];

  for (let y = ymin + bandH; y < ymax - bandH / 2; y += step) {
    // #300: band fraction is mesh-relative, never absolute Y. A rigid vertical
    // translation cannot change a circumference, so band windows must not either.
    // (y - ymin) / stature is invariant under translation by construction; y /
    // stature made a pelvis-centred mesh (minY = -0.8557) read all-zero girths and
    // a +0.85 m shift read a plausible-but-wrong waist (0.30755 vs 0.73472).
    const frac = (y - ymin) / stature;
    const lo = y - bandH / 2;
    const hi = y + bandH / 2;
    const band: Array<{ x: number; z: number; i: number }> = [];
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]!;
      if (p[1] >= lo && p[1] <= hi) band.push({ x: p[0], z: p[2], i });
    }
    if (band.length < 4) continue;

    const parent = band.map((_, i) => i);
    const find = (a: number): number =>
      (parent[a] = parent[a] === a ? a : find(parent[a]));
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    if (adjacency.length > 0) {
      // Mesh-surface connectivity: union every band vertex with its face-neighbours
      // that are also in the band. The arms/legs stay separate below the
      // armpit/crotch, so the torso cluster is exactly the trunk even where the
      // limbs touch it in XZ.
      const slotOf = new Map<number, number>();
      for (let i = 0; i < band.length; i++) slotOf.set(band[i]!.i, i);
      for (let i = 0; i < band.length; i++) {
        for (const nb of adjacency[band[i]!.i]!) {
          const j = slotOf.get(nb);
          if (j !== undefined && j > i) union(i, j);
        }
      }
    } else {
      // Fallback (no faces): lateral clustering by horizontal distance
      // (radius CLUSTER_RADIUS_METERS).
      for (let a = 0; a < band.length; a++) {
        for (let b = a + 1; b < band.length; b++) {
          const dx = band[a]!.x - band[b]!.x;
          const dz = band[a]!.z - band[b]!.z;
          if (dx * dx + dz * dz < CLUSTER_RADIUS_METERS * CLUSTER_RADIUS_METERS)
            union(a, b);
        }
      }
    }
    const compMap = new Map<number, number[]>();
    for (let i = 0; i < band.length; i++) {
      const r = find(i);
      if (!compMap.has(r)) compMap.set(r, []);
      compMap.get(r)!.push(i);
    }
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < band.length; i++) {
      const d = Math.abs(band[i]!.x - centerX);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const torsoRoot = find(bestIdx);
    const torso = compMap.get(torsoRoot)!;
    const txs = torso.map((i) => band[i]!.x);
    const tzs = torso.map((i) => band[i]!.z);
    const allXs = band.map((b) => b.x);
    const naiveWidth = Math.max(...allXs) - Math.min(...allXs);
    const torsoWidth = Math.max(...txs) - Math.min(...txs);
    const torsoDepth = Math.max(...tzs) - Math.min(...tzs);
    const torsoPerimeter = convexHullPerimeter(
      torso.map((i) => [band[i]!.x, band[i]!.z] as [number, number]),
    );

    // Non-torso components: arms. Only those in the upper body (frac >= 0.5 — the arms
    // hang between the wrist ~0.52 H and the shoulder junction ~0.74 H) with |cx|
    // clearly outside the torso count. The legs (frac < 0.45) must not pollute this:
    // at leg heights the "torso cluster" is one leg, so the OTHER leg would otherwise
    // pass the lateral test. Frac is mesh-relative (#300) — absolute y/stature would
    // admit leg clusters on any mesh whose feet are not at y=0.
    const armClusters: ArmCluster[] = [];
    if (frac >= 0.5) {
      for (const [root, idxs] of compMap) {
        if (root === torsoRoot) continue;
        const cxs = idxs.map((i) => band[i]!.x);
        const cx = Math.abs(cxs.reduce((s, v) => s + v, 0) / cxs.length);
        if (cx < torsoWidth / 2 + 0.06) continue;
        const width = Math.max(...cxs) - Math.min(...cxs);
        armClusters.push({ cx, width });
      }
    }

    bands.push({
      y,
      frac,
      torsoWidth,
      torsoDepth,
      torsoPerimeter,
      naiveWidth,
      nComponents: compMap.size,
      armsFused: naiveWidth - torsoWidth < 0.02,
      armClusters,
    });
  }
  return { stature, centerX, bands };
}

function maxOf(
  bands: BandProfile[],
  pred: (b: BandProfile) => boolean,
  pick: (b: BandProfile) => number,
): number {
  let m = -Infinity;
  for (const b of bands) if (pred(b)) m = Math.max(m, pick(b));
  return m;
}

function minOf(
  bands: BandProfile[],
  pred: (b: BandProfile) => boolean,
  pick: (b: BandProfile) => number,
): number {
  let m = Infinity;
  for (const b of bands) if (pred(b)) m = Math.min(m, pick(b));
  return m;
}

function bandWithMin(bands: BandProfile[], pred: (b: BandProfile) => boolean, pick: (b: BandProfile) => number): BandProfile | undefined {
  let best: BandProfile | undefined;
  let bestV = Infinity;
  for (const b of bands) {
    if (!pred(b)) continue;
    const v = pick(b);
    if (v < bestV) {
      bestV = v;
      best = b;
    }
  }
  return best;
}

function bandWithMax(bands: BandProfile[], pred: (b: BandProfile) => boolean, pick: (b: BandProfile) => number): BandProfile | undefined {
  let best: BandProfile | undefined;
  let bestV = -Infinity;
  for (const b of bands) {
    if (!pred(b)) continue;
    const v = pick(b);
    if (v > bestV) {
      bestV = v;
      best = b;
    }
  }
  return best;
}

export type LandmarkSet = {
  meshId: string;
  annyPath: "real_anny_forward_pass" | "parametric_stub";
  provenanceSource: string | null;
  vertexCount: number;
  statureMeters: number;
  shoulderSpanMeters: number;
  chestGirthMeters: number;
  waistGirthMeters: number;
  hipGirthMeters: number;
  /** torso-only x-extent at the waist band — the counterweight the naive slab fails */
  waistGirthWidthMeters: number;
  /** naive all-vertices x-extent at the SAME waist band (the slab this instrument refuses) */
  naiveWaistSlabWidthMeters: number;
  headHeightMeters: number;
  thighLengthMeters: number;
  shinLengthMeters: number;
  upperArmLengthMeters: number;
  forearmLengthMeters: number;
  totalLegLengthMeters: number;
  totalArmLengthMeters: number;
  bandHeights: {
    chestMeters: number;
    waistMeters: number;
    hipMeters: number;
    shoulderMeters: number;
    neckMeters: number;
    crotchMeters: number;
    kneeMeters: number;
    ankleMeters: number;
    elbowMeters: number;
    wristMeters: number;
  };
  /** per-landmark measurement method, so no number is silently assumed */
  methods: Record<string, string>;
};

/**
 * Extract the MADR 0051 §4 landmark set from one mesh.
 *
 * Unlocked decisions (named, as the brief requires):
 *  - girth: convex-hull perimeter of the torso-only horizontal slice (the MADR's own
 *    wording for chest), with arms excluded by MESH-SURFACE connectivity (the OBJ
 *    faces); lateral XZ clustering is the no-faces fallback.
 *  - T-pose normalization: measured POSE-INVARIANTLY — the reference OBJ has no rig to
 *    pose, so girths exclude the arms regardless of abduction and limb lengths are
 *    measured along their own axis (legs are vertical in the standing reference; arm
 *    lengths use the centroid-path arc length, not the vertical drop).
 *  - waist height: anchored to anny.Anthropometry.waist_circumference's own ring
 *    (~0.617-0.639 H on adult bodies, measured 2026-08-10), not "narrowest between
 *    chest and hip" — see BAND_WINDOWS.waist for the measured reason.
 *  - limbs: from the MESH, not a rig (the reference OBJ carries none). Segment splits
 *    use a limb width minimum where one is a real local minimum; otherwise the
 *    documented anthropometric fallback fraction is used and labelled in `methods`.
 */
export function extractLandmarks(meshId: string, objText: string): LandmarkSet {
  const { positions, faces } = parseObj(objText);
  const { stature, bands } = buildBandProfile(positions, faces);
  const inWindow = (b: BandProfile, w: readonly [number, number]) =>
    b.frac >= w[0] && b.frac <= w[1];

  const provenance = readProvenanceSource(meshId);
  const annyPath: LandmarkSet["annyPath"] =
    provenance.sourceTopologyMode === "real_anny_mpfb2_forward_pass_v1"
      ? "real_anny_forward_pass"
      : "parametric_stub";

  // ---- waist (narrowest torso slice between chest and hip) ----
  const waist = bandWithMin(
    bands,
    (b) => inWindow(b, BAND_WINDOWS.waist),
    (b) => b.torsoPerimeter,
  );

  // ---- armpit: lowest fused band above the waist (arms merge into the torso) ----
  let armpitFrac = 1;
  for (const b of bands) {
    if (b.frac > (waist?.frac ?? 0) && b.armsFused) {
      armpitFrac = b.frac;
      break;
    }
  }

  // ---- chest: fullest torso-only slice between waist and armpit ----
  const chest = bandWithMax(
    bands,
    (b) => b.frac >= (waist?.frac ?? 0) && b.frac < armpitFrac - 0.01,
    (b) => b.torsoPerimeter,
  );

  // ---- hip: widest torso slice below the waist down to the crotch ----
  const hip = bandWithMax(
    bands,
    (b) => b.frac >= BAND_WINDOWS.hipFrom && b.frac <= (waist?.frac ?? 0),
    (b) => b.torsoPerimeter,
  );

  // ---- shoulder span: max lateral extent in the deltoid band ----
  // The deltoid band is the set of fused bands between the armpit and the neck; the
  // widest of them is the bi-deltoid breadth. Restricted to y >= 0.55 H so the
  // merged-crotch band (also "fused") cannot win.
  const shoulderBand = bandWithMax(
    bands,
    (b) => b.frac >= 0.55 && b.frac <= 0.9 && b.armsFused,
    (b) => b.torsoWidth,
  );
  const shoulderSpan = shoulderBand?.torsoWidth ?? 0;

  // ---- neck + head height ----
  const neck = bandWithMin(
    bands,
    (b) => inWindow(b, BAND_WINDOWS.neck),
    (b) => b.torsoWidth,
  );
  const neckMin = neck?.torsoWidth ?? 0;
  // chin = first band above the neck where the width widens past the neck (jaw opens)
  let chinFrac = 1;
  for (const b of bands) {
    if (b.frac > (neck?.frac ?? 0) && b.torsoWidth > 1.25 * neckMin) {
      chinFrac = b.frac;
      break;
    }
  }
  const headHeight = stature * (1 - chinFrac);

  // ---- legs (standing pose: vertical distances are pose-invariant) ----
  // crotch = lowest band where the legs have merged into one cluster.
  let crotchFrac = 0.44;
  for (const b of bands) {
    if (b.frac < 0.2) continue;
    if (b.nComponents === 1) {
      crotchFrac = b.frac;
      break;
    }
  }
  // ankle = narrowest leg slice above the foot.
  const ankle = bandWithMin(
    bands,
    (b) => inWindow(b, BAND_WINDOWS.ankle),
    (b) => b.torsoWidth,
  );
  const ankleFrac = ankle?.frac ?? 0.07;
  const legLength = stature * (crotchFrac - ankleFrac);

  // Knee split: the reference OBJ has no rig and the legs taper without a reliable
  // width minimum (measured 2026-08-10: the child's "knee" minimum lands on the calf,
  // the adults' on the top of the calf — not the joint). Use the documented knee-height
  // fraction of the MEASURED stature, identically for every body, so the comparison is
  // apples-to-apples. thigh runs from the mesh-measured hip band down to the knee.
  const kneeFrac = JOINT_FALLBACK_FRACTIONS.knee;
  const kneeMethod = `anatomical_fraction_knee_${JOINT_FALLBACK_FRACTIONS.knee}_of_measured_stature`;
  const thighLength = stature * (Math.max(hip?.frac ?? 0.48, 0.44) - kneeFrac);
  const shinLength = stature * (kneeFrac - ankleFrac);

  // ---- arms (abducted reference pose: arc length along the centroid path) ----
  // armProfile per band from the non-torso clusters.
  const armProfile: Array<{ frac: number; cx: number; width: number }> = [];
  for (const b of bands) {
    for (const arm of b.armClusters) {
      armProfile.push({ frac: b.frac, cx: arm.cx, width: arm.width });
    }
  }
  armProfile.sort((a, b) => a.frac - b.frac);
  // average the left/right arms per band (the mesh is symmetric; halves are near-identical)
  const armByFrac = new Map<number, { cx: number; width: number }[]>();
  for (const a of armProfile) {
    if (!armByFrac.has(a.frac)) armByFrac.set(a.frac, []);
    armByFrac.get(a.frac)!.push(a);
  }
  const armPath: Array<{ frac: number; cx: number; width: number }> = [];
  for (const [frac, entries] of [...armByFrac.entries()].sort((a, b) => a[0] - b[0])) {
    const cx = entries.reduce((s, e) => s + e.cx, 0) / entries.length;
    const width = Math.max(...entries.map((e) => e.width));
    armPath.push({ frac, cx, width });
  }

  // Wrist = lowest arm slice above the hand tip (the fingertip slivers are the
  // width < 0.02 m bands). Shoulder junction = the highest arm slice.
  const armPathReal = armPath.filter((a) => a.width >= 0.02);
  const wristFrac = armPathReal.length > 0 ? armPathReal[0]!.frac : 0.55;
  const shoulderFrac =
    armPath.length > 0 ? armPath[armPath.length - 1]!.frac : 0.75;
  const wristMethod =
    armPathReal.length > 0 && armPathReal[0]!.width < 0.04
      ? "lowest_arm_slice_above_hand_tip"
      : "lowest_arm_slice_fallback";

  // Elbow: a REAL interior local minimum of arm width strictly between the wrist and
  // the shoulder. The adults show one (measured dip ~0.03 m at 0.60 H with higher
  // neighbours on both sides); the child's arm is a monotone taper, so the minimum
  // sits at the window edge and the documented fraction fallback is used instead.
  const elbowIn = armPathReal.filter(
    (a) =>
      a.frac >= BAND_WINDOWS.elbow[0] &&
      a.frac <= BAND_WINDOWS.elbow[1] &&
      a.frac < shoulderFrac,
  );
  let elbowFrac: number;
  let elbowMethod: string;
  {
    let localMin: { frac: number; width: number } | null = null;
    for (let i = 1; i < elbowIn.length - 1; i++) {
      const w = elbowIn[i]!.width;
      const prev = elbowIn[i - 1]!.width;
      const next = elbowIn[i + 1]!.width;
      if (w < prev && w < next) {
        if (localMin === null || w < localMin.width) {
          localMin = { frac: elbowIn[i]!.frac, width: w };
        }
      }
    }
    // A real dip: the local min sits below BOTH neighbours by a combined >= 0.02 m
    // (the measured adult dip is ~0.041 m combined; noise stays far below).
    if (localMin !== null) {
      const idx = elbowIn.findIndex((a) => a.frac === localMin!.frac);
      const dip =
        (elbowIn[idx - 1]!.width - localMin.width) +
        (elbowIn[idx + 1]!.width - localMin.width);
      if (dip >= 0.02) {
        elbowFrac = localMin.frac;
        elbowMethod = "mesh_arm_width_interior_local_minimum";
      } else {
        elbowFrac =
          wristFrac +
          (shoulderFrac - wristFrac) * JOINT_FALLBACK_FRACTIONS.elbowOfArm;
        elbowMethod = `anatomical_fraction_fallback_elbow_${JOINT_FALLBACK_FRACTIONS.elbowOfArm}`;
      }
    } else {
      elbowFrac =
        wristFrac +
        (shoulderFrac - wristFrac) * JOINT_FALLBACK_FRACTIONS.elbowOfArm;
      elbowMethod = `anatomical_fraction_fallback_elbow_${JOINT_FALLBACK_FRACTIONS.elbowOfArm}`;
    }
  }

  // arm centroid path arc length (pose-invariant: follows the arm's own axis)
  const segs: Array<{ frac0: number; frac1: number; cx0: number; cx1: number }> = [];
  for (let i = 1; i < armPath.length; i++) {
    if (armPath[i]!.frac >= wristFrac - 1e-9 && armPath[i]!.frac <= shoulderFrac + 1e-9) {
      segs.push({
        frac0: armPath[i - 1]!.frac,
        frac1: armPath[i]!.frac,
        cx0: armPath[i - 1]!.cx,
        cx1: armPath[i]!.cx,
      });
    }
  }
  let totalArm = 0;
  for (const s of segs) {
    totalArm += Math.hypot(stature * (s.frac1 - s.frac0), s.cx1 - s.cx0);
  }
  let upperArm = 0;
  let forearm = 0;
  for (const s of segs) {
    const mid = (s.frac0 + s.frac1) / 2;
    const seg = Math.hypot(stature * (s.frac1 - s.frac0), s.cx1 - s.cx0);
    if (mid >= elbowFrac) upperArm += seg;
    else forearm += seg;
  }

  const methods: Record<string, string> = {
    girth:
      "convex_hull_perimeter_of_torso_only_horizontal_slice_arms_excluded_by_mesh_surface_connectivity_fallback_lateral_xz_clustering",
    waistHeight:
      "band_anchored_to_anny_waist_ring_height_window_0.61-0.65_of_stature_measured_2026-08-10_ring_mean_0.622_lean_0.626_bmi45",
    tpose:
      "pose_invariant_measurement_no_rig_on_reference_obj_arms_excluded_by_clustering_girths_limbs_along_own_axis",
    limbs: "from_mesh_not_rig_reference_obj_has_no_rig",
    knee: kneeMethod,
    elbow: elbowMethod,
    wrist: wristMethod,
  };

  return {
    meshId,
    annyPath,
    provenanceSource: provenance.provenancePath
      ? nodePath.relative(REPO_ROOT, provenance.provenancePath)
      : null,
    vertexCount: positions.length,
    statureMeters: stature,
    shoulderSpanMeters: shoulderSpan,
    chestGirthMeters: chest?.torsoPerimeter ?? 0,
    waistGirthMeters: waist?.torsoPerimeter ?? 0,
    hipGirthMeters: hip?.torsoPerimeter ?? 0,
    waistGirthWidthMeters: waist?.torsoWidth ?? 0,
    naiveWaistSlabWidthMeters: waist?.naiveWidth ?? 0,
    headHeightMeters: headHeight,
    thighLengthMeters: thighLength,
    shinLengthMeters: shinLength,
    upperArmLengthMeters: upperArm,
    forearmLengthMeters: forearm,
    totalLegLengthMeters: legLength,
    totalArmLengthMeters: totalArm,
    bandHeights: {
      chestMeters: (chest?.frac ?? 0) * stature,
      waistMeters: (waist?.frac ?? 0) * stature,
      hipMeters: (hip?.frac ?? 0) * stature,
      shoulderMeters: (shoulderBand?.frac ?? 0.75) * stature,
      neckMeters: (neck?.frac ?? 0) * stature,
      crotchMeters: crotchFrac * stature,
      kneeMeters: kneeFrac * stature,
      ankleMeters: ankleFrac * stature,
      elbowMeters: elbowFrac * stature,
      wristMeters: (wristFrac ?? 0) * stature,
    },
    methods,
  };
}

export const MADR_0051_BANDS = [
  {
    landmark: "stature",
    bandMeters: 0.01,
    source: "MADR 0051 §5: ±1 cm of the phenotype's height_cm — fixed by the input",
  },
  {
    landmark: "chestGirthMeters|waistGirthMeters|hipGirthMeters|waistGirthWidthMeters",
    bandMeters: 0.02,
    source:
      "MADR 0051 §5: ±2 cm — the ordinary between-observer tolerance for a tape measurement on a live subject; an external floor, not a fitted one",
  },
  {
    landmark: "bmi",
    bandMeters: 1.0,
    source:
      "MADR 0051 §5: ±1.0 BMI unit of the requested value, computed from measured stature and an estimated volume — not a girth the match is tuning",
  },
] as const;

const BAND_BY_LANDMARK: Record<string, number> = {
  statureMeters: 0.01,
  chestGirthMeters: 0.02,
  waistGirthMeters: 0.02,
  hipGirthMeters: 0.02,
  waistGirthWidthMeters: 0.02,
};

const GIRTH_SOURCE =
  "MADR 0051 §5: ±2 cm — the ordinary between-observer tolerance for a tape measurement on a live subject; an external floor, not a fitted one";
const STATURE_SOURCE =
  "MADR 0051 §5: ±1 cm of the phenotype's height_cm — fixed by the input";
const NO_BAND_SOURCE =
  "MADR 0051 §5 defines bands only for stature, BMI and girths — this landmark carries the measured delta, no invented band";

export type ComparisonRow = {
  landmark: string;
  aValueMeters: number;
  bValueMeters: number;
  deltaMeters: number;
  bandMeters: number | null;
  bandSource: string | null;
  /** band − |delta|; positive = inside band, negative = outside (null when no §5 band) */
  marginMeters: number | null;
};

export type ComparisonPair = {
  pair: [string, string];
  rows: ComparisonRow[];
};

export type ComparisonReport = {
  generatedAt: string;
  claimScope: string[];
  notEvidenceFor: string[];
  madr0051Bands: typeof MADR_0051_BANDS;
  bodies: LandmarkSet[];
  comparisons: ComparisonPair[];
};

export function loadReferenceObj(meshId: string): string {
  const p = nodePath.join(GENERATED_HUMANOIDS_DIR, `${meshId}.anny_base.obj`);
  if (!existsSync(p)) {
    throw new Error(
      `#297: missing tracked Anny reference ${p}. These .anny_base.obj ARE tracked, so a missing file is an environment defect, not a gitignore one.`,
    );
  }
  return readFileSync(p, "utf8");
}

/**
 * Inspect: extract landmarks for all references, write the per-mesh and comparison
 * artifacts, and return the report the contracts assert on.
 */
export async function inspectLandmarkComparison(): Promise<ComparisonReport> {
  const bodies: LandmarkSet[] = [];
  for (const meshId of ANNY_REFERENCE_ASSETS) {
    const objText = loadReferenceObj(meshId);
    const lm = extractLandmarks(meshId, objText);
    bodies.push(lm);
  }
  bodies.sort((a, b) => b.statureMeters - a.statureMeters);

  const comparisons: ComparisonPair[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      const rows: ComparisonRow[] = [];
      const landmarks: Array<keyof LandmarkSet> = [
        "statureMeters",
        "shoulderSpanMeters",
        "chestGirthMeters",
        "waistGirthMeters",
        "hipGirthMeters",
        "waistGirthWidthMeters",
        "headHeightMeters",
        "thighLengthMeters",
        "shinLengthMeters",
        "upperArmLengthMeters",
        "forearmLengthMeters",
        "totalLegLengthMeters",
        "totalArmLengthMeters",
      ];
      for (const l of landmarks) {
        const av = a[l] as number;
        const bv = b[l] as number;
        const band = BAND_BY_LANDMARK[l] ?? null;
        const bandSource =
          band === 0.01
            ? STATURE_SOURCE
            : band === 0.02
              ? GIRTH_SOURCE
              : NO_BAND_SOURCE;
        rows.push({
          landmark: l,
          aValueMeters: av,
          bValueMeters: bv,
          deltaMeters: av - bv,
          bandMeters: band,
          bandSource,
          marginMeters: band !== null ? band - Math.abs(av - bv) : null,
        });
      }
      comparisons.push({ pair: [a.meshId, b.meshId], rows });
    }
  }

  const report: ComparisonReport = {
    generatedAt: new Date().toISOString(),
    claimScope: [
      "madr_0051_step4_landmark_instrument_over_genuine_anny_base_obj_references",
      "first_anny_to_anny_comparison_rows_for_the_mpfb_match_protocol",
      "girths_are_torso_only_arms_excluded_by_lateral_clustering",
    ],
    notEvidenceFor: [
      "madr_0051_step6_solve_loop_or_step7_tuning_table_next_slice",
      "anthropometric_or_clinical_validity_of_any_generated_body",
      "learner_readiness_or_quest_readiness",
      "mpfb_body_generation",
    ],
    madr0051Bands: [...MADR_0051_BANDS],
    bodies,
    comparisons,
  };

  mkdirSync(LANDMARKS_DIR, { recursive: true });
  for (const b of bodies) {
    writeFileSync(
      nodePath.join(LANDMARKS_DIR, `${b.meshId}.landmarks.json`),
      JSON.stringify(b, null, 2),
    );
  }
  writeFileSync(COMPARISON_ARTIFACT_PATH, JSON.stringify(report, null, 2));
  return report;
}
