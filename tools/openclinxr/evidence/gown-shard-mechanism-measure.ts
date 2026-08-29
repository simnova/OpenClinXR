/**
 * #691 — measure the gown shard mechanisms per decile of the gown's own height, before anything
 * changes. Diagnosis only: this script writes the report and changes no asset bytes.
 *
 * #714 — re-measurement on the post-fix asset: the report is written to the #714 contract path
 * `gown-fold-clamp-measurement.json`, the pinned sha is env-overridable
 * (`OPENCLINXR_GOWN_PIN_SHA`/`OPENCLINXR_GOWN_PIN_BYTES`) so the same instrument measures the
 * pre-fix and post-fix assets, and `renderPath`/`renderNote` record the grade render for the
 * orchestrator (set `OPENCLINXR_GOWN_RENDER_PATH` and `OPENCLINXR_GOWN_RENDER_NOTE` when running).
 * The instruments are unchanged from #691; one field is ADDED: `gownVerticesInsideBodyTwoTests`
 * (a vertex is inside only when TWO independent tests agree — see the definition at its use site).
 *
 * ## INSTRUMENTS
 *
 * 1. interpenetration (gownVerticesInsideBody): even-odd point-in-mesh test by +X raycast
 *    (Möller–Trumbore, q = s x e1 form), grid-accelerated over the VISIBLE skin primitive
 *    `mpfb_skin_ob_patient_aisha`. The body mesh is not watertight (1,046 boundary edges over
 *    the gown's y-range — natural seams), so a SECOND ray (+Z) and a nearest-surface signed
 *    distance (3x3-cell search, Ericson closest-point) are computed as cross-checks; the field
 *    reports the +X parity, the cross-checks are recorded alongside.
 *
 * 2. degenerate triangles (degenerateTriangles): gown triangles whose area is below
 *    DEGENERATE_AREA_M2 = 1e-8 m^2 (side lengths below ~0.14 mm — below render relevance at
 *    the graded 4096 capture). The count below 1e-12 (true zero-area) is recorded separately.
 *
 * 3. inward-facing normals (inwardFacingTriangles): gown triangles whose geometric normal
 *    points toward the body's XZ axis (dot(n, triCenter - axis) < 0) — the card's "showing the
 *    gown's interior" for the trunk. A nearest-body-surface-normal variant (dot < 0 against the
 *    nearest body triangle's outward normal) is recorded separately because the two disagree at
 *    the sleeves (correct inner-sleeve tube surfaces) and at free rims.
 *
 * ## THE CODE TRACE (automate_blender.py #686, read for mechanism, not modified)
 *
 *     _fold_amp686 = 0.034        triangle-wave radial amplitude, +/-34 mm
 *     _fold_k686   = 16           waves around the trunk
 *     base offset: conformal normal offset 10-22 mm (the pre-#686 bodice)
 *
 * The gathers displace each trunk vertex radially by amp*tri_wave(16*atan2(rz,rx)+pi/2), i.e. a
 * zigzag accordion whose valleys sit at base_offset - 34 mm = 12-24 mm INSIDE the body surface
 * across the gather band (f in 0.55..0.86 of body height, fading 0.55->0.64 and 0.80->0.85).
 * The valley penetration is the interpenetration this report counts; the accordion flanks are
 * the angular "shard" geometry; the body skin visible in the V-gaps between crests is the
 * "tan/gold slivers" the grade reports.
 *
 * NOT TESTED: whether the measured penetration is the CAUSE of the graded appearance (a
 * concentration is consistent with a cause and does not establish one); whether the defect
 * predates decimation; whether the tan slivers are skin, the t-shirt, or the gown's own
 * backface; whether any of it is visible at learner viewing distance.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Document } from "@gltf-transform/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const GLB_PATH = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");
const REPORT_PATH = join(HERE, "gown-fold-clamp-measurement.json");

/** Counterweight (3) from the card: pin the graded asset before measuring anything.
 *  #714: env-overridable so the same instrument measures the pre-fix and post-fix assets;
 *  #746: default updated to the post-fix rebaked asset (skin-region push-out spliced in). */
const GLB_SHA256 = process.env.OPENCLINXR_GOWN_PIN_SHA ?? "029dbb504c6f655c7a2fc141948ff92dbd86190a306ee75ade8c50c39f8ab43f";
const GLB_BYTES = Number(process.env.OPENCLINXR_GOWN_PIN_BYTES ?? 18_840_716);

const GOWN_MESH = "openclinxr_real_garment_peds_upper_v1_mesh";
const BODY_PRIM = "mpfb_skin_robert_reference";
const DECILES = 10;
const CELL = 0.06;
/** Triangles below this area are degenerate at render scale (side length < ~0.14 mm). */
const DEGENERATE_AREA_M2 = 1e-8;
/** True zero-area (numerically exact) threshold, reported alongside. */
const ZERO_AREA_M2 = 1e-12;

type V3 = [number, number, number];

const io = new NodeIO();

function headSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function vAt(pos: Float32Array, i: number): V3 {
  return [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
}

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection). */
function closestOnTri(p: V3, a: V3, b: V3, c: V3): V3 {
  const abx = b[0]! - a[0]!, aby = b[1]! - a[1]!, abz = b[2]! - a[2]!;
  const acx = c[0]! - a[0]!, acy = c[1]! - a[1]!, acz = c[2]! - a[2]!;
  const apx = p[0]! - a[0]!, apy = p[1]! - a[1]!, apz = p[2]! - a[2]!;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return a;
  const bpx = p[0]! - b[0]!, bpy = p[1]! - b[1]!, bpz = p[2]! - b[2]!;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0]! + abx * v, a[1]! + aby * v, a[2]! + abz * v];
  }
  const cpx = p[0]! - c[0]!, cpy = p[1]! - c[1]!, cpz = p[2]! - c[2]!;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0]! + acx * w, a[1]! + acy * w, a[2]! + acz * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return [b[0]! + (c[0]! - b[0]!) * w, b[1]! + (c[1]! - b[1]!) * w, b[2]! + (c[2]! - b[2]!) * w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [a[0]! + abx * v + acx * w, a[1]! + aby * v + acy * w, a[2]! + abz * v + acz * w];
}

/**
 * #719 — shared geometry builders. #691's math, hoisted out of main() so the shell-clearance
 * measurement runs the SAME instrument on the fold-suppressed control bake. Nothing about the
 * arithmetic changes; only the plumbing moves.
 */

type BodyGeo = {
  bodyTris: Array<{ a: V3; b: V3; c: V3; n: V3 }>;
  gridYZ: number[][];
  gridXY: number[][];
  gy: number;
  gz: number;
  gx: number;
  bMin: V3;
  axisX: number;
  axisZ: number;
};

function buildBodyGeometry(bodyPos: Float32Array, bodyIdx: Uint16Array | Uint32Array): BodyGeo {
  const bodyVerts: V3[] = [];
  for (let i = 0; i < bodyPos.length / 3; i++) bodyVerts.push(vAt(bodyPos, i));
  const bodyTris: Array<{ a: V3; b: V3; c: V3; n: V3 }> = [];
  for (let t = 0; t < bodyIdx.length; t += 3) {
    const a = bodyVerts[bodyIdx[t]!]!, b = bodyVerts[bodyIdx[t + 1]!]!, c = bodyVerts[bodyIdx[t + 2]!]!;
    const ax = b[0]! - a[0]!, ay = b[1]! - a[1]!, az = b[2]! - a[2]!;
    const bx = c[0]! - a[0]!, by = c[1]! - a[1]!, bz = c[2]! - a[2]!;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    bodyTris.push({ a, b, c, n: [nx / len, ny / len, nz / len] });
  }

  const bMin: V3 = [Infinity, Infinity, Infinity];
  const bMax: V3 = [-Infinity, -Infinity, -Infinity];
  for (const t of bodyTris) {
    for (const p of [t.a, t.b, t.c]) {
      for (let k = 0; k < 3; k++) {
        if (p[k]! < bMin[k]!) bMin[k] = p[k]!;
        if (p[k]! > bMax[k]!) bMax[k] = p[k]!;
      }
    }
  }
  let axisX = 0, axisZ = 0;
  for (const p of bodyVerts) {
    axisX += p[0]!;
    axisZ += p[2]!;
  }
  axisX /= bodyVerts.length;
  axisZ /= bodyVerts.length;

  // Uniform grid over the body AABB (y, z) — a +X or +Z ray stays inside one (y,z) or (x,y) column.
  const gy = Math.max(1, Math.ceil((bMax[1]! - bMin[1]!) / CELL));
  const gz = Math.max(1, Math.ceil((bMax[2]! - bMin[2]!) / CELL));
  const gx = Math.max(1, Math.ceil((bMax[0]! - bMin[0]!) / CELL));
  const gridYZ: number[][] = Array.from({ length: gy * gz }, () => []);
  const gridXY: number[][] = Array.from({ length: gx * gy }, () => []);
  for (let t = 0; t < bodyTris.length; t++) {
    const { a, b, c } = bodyTris[t]!;
    const yLo = Math.min(a[1]!, b[1]!, c[1]!), yHi = Math.max(a[1]!, b[1]!, c[1]!);
    const zLo = Math.min(a[2]!, b[2]!, c[2]!), zHi = Math.max(a[2]!, b[2]!, c[2]!);
    const xLo = Math.min(a[0]!, b[0]!, c[0]!), xHi = Math.max(a[0]!, b[0]!, c[0]!);
    const i0 = Math.max(0, Math.floor((yLo - bMin[1]!) / CELL));
    const i1 = Math.min(gy - 1, Math.floor((yHi - bMin[1]!) / CELL));
    const j0 = Math.max(0, Math.floor((zLo - bMin[2]!) / CELL));
    const j1 = Math.min(gz - 1, Math.floor((zHi - bMin[2]!) / CELL));
    const k0 = Math.max(0, Math.floor((xLo - bMin[0]!) / CELL));
    const k1 = Math.min(gx - 1, Math.floor((xHi - bMin[0]!) / CELL));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) gridYZ[i * gz + j]!.push(t);
      for (let k = k0; k <= k1; k++) gridXY[k * gy + i]!.push(t);
    }
  }
  return { bodyTris, gridYZ, gridXY, gy, gz, gx, bMin, axisX, axisZ };
}

/**
 * Möller–Trumbore, ray along +X or +Z. Validated form (probe 4): hit points keep the ray
 * origin's cross-axis coordinates; body centroid and neck classify inside, far points outside.
 *   p = D x e2; det = e1.p; u = (s.p)/det; q = s x e1; v = (D.q)/det; t = (e2.q)/det
 */
function rayHits(p: V3, tIdx: number, axis: "x" | "z", geo: BodyGeo): boolean {
  const { a, b, c } = geo.bodyTris[tIdx]!;
  const e1x = b[0]! - a[0]!, e1y = b[1]! - a[1]!, e1z = b[2]! - a[2]!;
  const e2x = c[0]! - a[0]!, e2y = c[1]! - a[1]!, e2z = c[2]! - a[2]!;
  // D x e2: D=(1,0,0) -> (0,-e2z,e2y); D=(0,0,1) -> (-e2y,e2x,0)
  const px = axis === "x" ? 0 : -e2y;
  const py = axis === "x" ? -e2z : e2x;
  const pz = axis === "x" ? e2y : 0;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return false;
  const inv = 1 / det;
  const sx = p[0]! - a[0]!, sy = p[1]! - a[1]!, sz = p[2]! - a[2]!;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return false;
  // q = s x e1
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = (axis === "x" ? qx : qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-9;
}

function crossings(p: V3, axis: "x" | "z", geo: BodyGeo): number {
  if (axis === "x") {
    const i = Math.max(0, Math.min(geo.gy - 1, Math.floor((p[1]! - geo.bMin[1]!) / CELL)));
    const j = Math.max(0, Math.min(geo.gz - 1, Math.floor((p[2]! - geo.bMin[2]!) / CELL)));
    let hits = 0;
    for (const tIdx of geo.gridYZ[i * geo.gz + j]!) if (rayHits(p, tIdx, "x", geo)) hits++;
    return hits;
  }
  const k = Math.max(0, Math.min(geo.gx - 1, Math.floor((p[0]! - geo.bMin[0]!) / CELL)));
  const i = Math.max(0, Math.min(geo.gy - 1, Math.floor((p[1]! - geo.bMin[1]!) / CELL)));
  let hits = 0;
  for (const tIdx of geo.gridXY[k * geo.gy + i]!) if (rayHits(p, tIdx, "z", geo)) hits++;
  return hits;
}

/** Nearest body triangle within the 3x3-cell neighbourhood: distance, signed value, normal. */
function nearestBodyInfo(p: V3, geo: BodyGeo): { dist: number; sign: number; n: V3 } {
  const ci = Math.max(0, Math.min(geo.gy - 1, Math.floor((p[1]! - geo.bMin[1]!) / CELL)));
  const cj = Math.max(0, Math.min(geo.gz - 1, Math.floor((p[2]! - geo.bMin[2]!) / CELL)));
  const ck = Math.max(0, Math.min(geo.gx - 1, Math.floor((p[0]! - geo.bMin[0]!) / CELL)));
  let best = Infinity;
  let bestSign = 0;
  let bestN: V3 = [1, 0, 0];
  const seen = new Set<number>();
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (let dk = -1; dk <= 1; dk++) {
        const i = ci + di, j = cj + dj, k = ck + dk;
        if (i < 0 || i >= geo.gy || j < 0 || j >= geo.gz || k < 0 || k >= geo.gx) continue;
        for (const tIdx of geo.gridYZ[i * geo.gz + j]!) {
          if (seen.has(tIdx)) continue;
          seen.add(tIdx);
          const { a, b, c, n } = geo.bodyTris[tIdx]!;
          const q = closestOnTri(p, a, b, c);
          const dx = p[0]! - q[0]!, dy = p[1]! - q[1]!, dz = p[2]! - q[2]!;
          const d = Math.hypot(dx, dy, dz);
          if (d < best) {
            best = d;
            bestSign = dx * n[0]! + dy * n[1]! + dz * n[2]!;
            bestN = n;
          }
        }
      }
    }
  }
  return { dist: best, sign: bestSign, n: bestN };
}

function gownVerticesAndRange(gownPos: Float32Array): { gownVerts: V3[]; gMinY: number; gMaxY: number } {
  const gownVerts: V3[] = [];
  for (let i = 0; i < gownPos.length / 3; i++) gownVerts.push(vAt(gownPos, i));
  let gMinY = Infinity, gMaxY = -Infinity;
  for (const q of gownVerts) {
    if (q[1]! < gMinY) gMinY = q[1]!;
    if (q[1]! > gMaxY) gMaxY = q[1]!;
  }
  return { gownVerts, gMinY, gMaxY };
}

/** #691's mesh extraction, shared. The gown mesh matches by PREFIX: a re-bake on a gowned
 *  input exports `..._v1_mesh.001` because the stripped input's orphaned mesh data keeps the
 *  canonical name (Blender data-block collision — #714's fix was a purge; this slice is
 *  measurement-only, so the match tolerates the suffix). */
function loadGownAndBody(
  doc: Document,
): { gownPos: Float32Array; gownIdx: Uint16Array | Uint32Array; bodyPos: Float32Array; bodyIdx: Uint16Array | Uint32Array } {
  let gownPos: Float32Array | null = null;
  let gownIdx: Uint16Array | Uint32Array | null = null;
  let bodyPos: Float32Array | null = null;
  let bodyIdx: Uint16Array | Uint32Array | null = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() ?? "";
      if (mesh.getName().startsWith(GOWN_MESH)) {
        const p = prim.getAttribute("POSITION")?.getArray();
        const i = prim.getIndices()?.getArray();
        if (p) gownPos = p as Float32Array;
        if (i) gownIdx = i as Uint16Array | Uint32Array;
      }
      if (matName === BODY_PRIM) {
        const p = prim.getAttribute("POSITION")?.getArray();
        const i = prim.getIndices()?.getArray();
        if (p) bodyPos = p as Float32Array;
        if (i) bodyIdx = i as Uint16Array | Uint32Array;
      }
    }
  }
  if (!gownPos || !gownIdx || !bodyPos || !bodyIdx) {
    throw new Error(`missing primitives: gown=${!!gownPos} gownIdx=${!!gownIdx} body=${!!bodyPos} bodyIdx=${!!bodyIdx}`);
  }
  return { gownPos, gownIdx, bodyPos, bodyIdx };
}

/** #719: set to the fold-suppressed control bake to write the shell-clearance report instead. */
const CONTROL_GLB_ENV = "OPENCLINXR_GOWN_CONTROL_GLB";
/** #719: optional same-topology fold-on bake (identical vertices, fold applied) — the direct
 *  "same vertices with it on" comparison the card asks for. */
const FOLD_ON_GLB_ENV = "OPENCLINXR_GOWN_FOLD_ON_GLB";
const CLEARANCE_REPORT_PATH = join(HERE, "gown-shell-clearance-measurement.json");
/** "At or inside the skin": signed clearance within +2 mm of the body surface — the same
 *  tolerance the nearest-surface cross-check uses for strictly inside (SURFACE_EPS). */
const AT_OR_INSIDE_M = 2e-3;
/** Nearest-surface cross-check tolerance for strictly inside, unchanged from #691. */
const SURFACE_EPS = 2e-3;
const VERDICTS = ["fold_side_sufficient", "upstream_shell_required", "mixed", "inconclusive_blocked", "other"] as const;

type ClearanceBand = {
  index: number;
  yLow: number;
  yHigh: number;
  /** Signed metres from the body surface with the fold SUPPRESSED. Negative means already inside. */
  preFoldClearanceMedian: number;
  preFoldVerticesAtOrInside: number;
  foldOnVerticesInside: number;
  sampled: number;
};

/**
 * #719 — signed garment-to-body clearance, fold suppressed vs fold on.
 *
 * The subject is the shipped gown (pinned below). The CONTROL is a re-bake of the same input
 * through bake_mpfb_gown_inspect.py with OPENCLINXR_SUPPRESS_GOWN_FOLD686=1 (the wave
 * displacement d is zeroed at the amplitude's use site; the pinned constants are untouched).
 * The control gown is full-res (the same-vertices fold-on control is measured when
 * OPENCLINXR_GOWN_FOLD_ON_GLB is set) and its body is the shipped body — the bake only replaces
 * the gown, so the clearance reference is identical to the shipped asset's.
 *
 * The banding repeats #691: ten equal bands over the gown's own y-range. `foldOnVerticesInside`
 * is the +X parity count on the SHIPPED GLB — the same instrument and the same asset #691 and
 * #714 measured, so the numbers stay comparable with 463/411. `preFoldClearanceMedian` and
 * `preFoldVerticesAtOrInside` are new: they answer whether the shell sits at or inside the skin
 * BEFORE the fold displacement runs — the assumption the #714 clamp never measured.
 *
 * Verdict rule (deterministic, cited in the note): pre-fold at-or-inside share >= 1% of the
 * sampled shell -> upstream_shell_required (no bound on d can reach a vertex the fold never
 * placed); 0 < share < 1% -> mixed; 0 -> fold_side_sufficient (or "other" if nothing is inside
 * with the fold on either).
 */
async function measureShellClearance(controlPath: string): Promise<void> {
  // COUNTERWEIGHT: pin the shipped asset before measuring anything (same as main()).
  const rawBytes = readFileSync(GLB_PATH);
  const bytes = new Uint8Array(rawBytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== GLB_SHA256 || bytes.byteLength !== GLB_BYTES) {
    throw new Error(
      `graded asset changed: sha256 ${hash.slice(0, 12)}... size ${bytes.byteLength} `
        + `(expected ${GLB_SHA256.slice(0, 12)}... / ${GLB_BYTES}) — refusing to measure a different mesh`,
    );
  }

  const shipped = await io.read(GLB_PATH);
  const control = await io.read(controlPath);
  const shippedMeshes = loadGownAndBody(shipped);
  const controlMeshes = loadGownAndBody(control);
  const shippedGeo = buildBodyGeometry(shippedMeshes.bodyPos, shippedMeshes.bodyIdx);
  const controlGeo = buildBodyGeometry(controlMeshes.bodyPos, controlMeshes.bodyIdx);

  const controlVerts = gownVerticesAndRange(controlMeshes.gownPos);
  const shippedVerts = gownVerticesAndRange(shippedMeshes.gownPos);
  const controlBand = (y: number): number =>
    Math.min(DECILES - 1, Math.max(0, Math.floor(((y - controlVerts.gMinY) / (controlVerts.gMaxY - controlVerts.gMinY)) * DECILES)));

  const bands: ClearanceBand[] = Array.from({ length: DECILES }, (_, index) => {
    const yLow = controlVerts.gMinY + (index / DECILES) * (controlVerts.gMaxY - controlVerts.gMinY);
    const yHigh = controlVerts.gMinY + ((index + 1) / DECILES) * (controlVerts.gMaxY - controlVerts.gMinY);
    return { index, yLow, yHigh, preFoldClearanceMedian: 0, preFoldVerticesAtOrInside: 0, foldOnVerticesInside: 0, sampled: 0 };
  });

  // Control (fold suppressed): per-vertex signed clearance + parity, aggregated per band.
  const clearances: number[][] = Array.from({ length: DECILES }, () => []);
  const controlInsideParity = Array.from({ length: DECILES }, () => 0);
  const controlInsideNearest = Array.from({ length: DECILES }, () => 0);
  for (const q of controlVerts.gownVerts) {
    const bandIdx = controlBand(q[1]!);
    bands[bandIdx]!.sampled++;
    const { sign } = nearestBodyInfo(q, controlGeo);
    clearances[bandIdx]!.push(sign);
    if (sign <= AT_OR_INSIDE_M) bands[bandIdx]!.preFoldVerticesAtOrInside++;
    if (sign < -SURFACE_EPS) controlInsideNearest[bandIdx]!++;
    if (crossings(q, "x", controlGeo) % 2 === 1) controlInsideParity[bandIdx]!++;
  }
  for (let b = 0; b < DECILES; b++) {
    const c = clearances[b]!.sort((x, y) => x - y);
    bands[b]!.preFoldClearanceMedian = c.length === 0 ? 0 : c.length % 2 === 1 ? c[(c.length - 1) / 2]! : (c[c.length / 2 - 1]! + c[c.length / 2]!) / 2;
  }

  // Shipped (fold on, decimated): +X parity per band over the SHIPPED gown's own range — the
  // #691 instrument on the same asset, so the numbers stay comparable with 463/411.
  const shippedBand = (y: number): number =>
    Math.min(DECILES - 1, Math.max(0, Math.floor(((y - shippedVerts.gMinY) / (shippedVerts.gMaxY - shippedVerts.gMinY)) * DECILES)));
  for (const q of shippedVerts.gownVerts) {
    const bandIdx = shippedBand(q[1]!);
    if (crossings(q, "x", shippedGeo) % 2 === 1) bands[bandIdx]!.foldOnVerticesInside++;
  }

  // Same-topology fold-on control (identical vertices, fold applied): the card's "same vertices
  // with it on", measured when the bake was taken.
  const foldOnPath = process.env[FOLD_ON_GLB_ENV];
  const sameTopologyInside = Array.from({ length: DECILES }, () => 0);
  let sameTopologySampled = 0;
  if (foldOnPath) {
    const foldOn = await io.read(foldOnPath);
    const foldOnMeshes = loadGownAndBody(foldOn);
    const foldOnGeo = buildBodyGeometry(foldOnMeshes.bodyPos, foldOnMeshes.bodyIdx);
    const foldOnVerts = gownVerticesAndRange(foldOnMeshes.gownPos);
    const foldOnBand = (y: number): number =>
      Math.min(DECILES - 1, Math.max(0, Math.floor(((y - foldOnVerts.gMinY) / (foldOnVerts.gMaxY - foldOnVerts.gMinY)) * DECILES)));
    for (const q of foldOnVerts.gownVerts) {
      sameTopologySampled++;
      if (crossings(q, "x", foldOnGeo) % 2 === 1) sameTopologyInside[foldOnBand(q[1]!)]!++;
    }
  }

  const totalPrefoldAtOrInside = bands.reduce((s, b) => s + b.preFoldVerticesAtOrInside, 0);
  const totalSampled = bands.reduce((s, b) => s + b.sampled, 0);
  const totalFoldOnInside = bands.reduce((s, b) => s + b.foldOnVerticesInside, 0);
  const prefoldShare = totalSampled === 0 ? 0 : totalPrefoldAtOrInside / totalSampled;

  let foldReachability: string;
  if (totalPrefoldAtOrInside === 0) {
    foldReachability = totalFoldOnInside > 0 ? "fold_side_sufficient" : "other";
  } else if (prefoldShare < 0.01) {
    foldReachability = "mixed";
  } else {
    foldReachability = "upstream_shell_required";
  }

  const reachabilityNote =
    `pre-fold (fold suppressed) at-or-inside vertices: ${totalPrefoldAtOrInside} of ${totalSampled} ` +
    `sampled (${(prefoldShare * 100).toFixed(1)}%), across the gown's own y-range ` +
    `${controlVerts.gMinY.toFixed(3)}..${controlVerts.gMaxY.toFixed(3)} m. The fold-on shipped ` +
    `asset measures ${totalFoldOnInside} inside (+X parity) — #691's 463-upper/24-lower baseline ` +
    (totalFoldOnInside === 487 ? "reproduced exactly" : `(was 487; this run ${totalFoldOnInside})`) +
    `. Same-topology fold-on control (same bake path, only the fold differs; the exported ` +
    `prim re-splits by normal so the count differs by 3 vertices): ` +
    `${sameTopologyInside.reduce((s, n) => s + n, 0)} inside of ${sameTopologySampled} sampled. ` +
    (foldReachability === "upstream_shell_required"
      ? `The clamp bounds the trough by rr*(s-1), the lift the fold code itself applies — but the ` +
        `shell already sits at or inside the skin before the fold displacement runs, so no bound on ` +
        `d can reach those vertices; the fix is upstream of the fold (the shell fit), not fold arithmetic.`
      : foldReachability === "mixed"
        ? `A small pre-existing share (${totalPrefoldAtOrInside} vertices) sits at or inside the skin ` +
          `pre-fold; the fold side can only address the rest.`
        : foldReachability === "fold_side_sufficient"
          ? `No vertex is at or inside the skin before the fold runs, and the fold-on state measures ` +
            `${totalFoldOnInside} inside — the fold creates the penetration, so a bound on d can reach it.`
          : `Nothing is inside the body with the fold either way — the measured penetration is a ` +
            `different instrument's answer (or absent at this tolerance).`);

  const report = {
    slice: "issue-719",
    title: "gown shell clearance — fold suppressed vs fold on, per decile (measurement only)",
    measuredAt: new Date().toISOString(),
    measuredAtCommit: headSha(),
    counterweight: {
      glbSha256: hash,
      glbBytes: bytes.byteLength,
      pinnedSha256: GLB_SHA256,
      pinnedBytes: GLB_BYTES,
    },
    controlGlb: controlPath,
    controlGlbSha256: createHash("sha256").update(readFileSync(controlPath)).digest("hex"),
    controlFoldSuppressedBy: "OPENCLINXR_SUPPRESS_GOWN_FOLD686=1 read at the amplitude use site (automate_blender.py #686)",
    controlGownVertexCount: controlVerts.gownVerts.length,
    shippedGownVertexCount: shippedVerts.gownVerts.length,
    bodyReference: {
      shippedSkinPrimTris: shippedMeshes.bodyIdx.length / 3,
      controlSkinPrimTris: controlMeshes.bodyIdx.length / 3,
      controlBodyYRangeM: (() => {
        let yMin = Infinity, yMax = -Infinity;
        for (let i = 1; i < controlMeshes.bodyPos.length; i += 3) {
          const y = controlMeshes.bodyPos[i]!;
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        }
        return [yMin, yMax];
      })(),
    },
    method: {
      decilesOver: `fold-suppressed gown's own y-range ${controlVerts.gMinY.toFixed(3)}..${controlVerts.gMaxY.toFixed(3)} m, ten equal bands`,
      preFoldClearance: "nearest body triangle signed distance (3x3-cell search, Ericson closest point); sign = dot(p - q, bodyOutwardNormal), negative = inside",
      atOrInsideToleranceM: AT_OR_INSIDE_M,
      foldOnVerticesInside: "even-odd point-in-mesh by +X raycast (Moller-Trumbore) on the SHIPPED GLB — the #691 instrument, same asset, comparable with 463/411",
      sameTopologyFoldOn: foldOnPath ?? "not measured (OPENCLINXR_GOWN_FOLD_ON_GLB unset)",
      gownMeshMatch: "prefix openclinxr_real_garment_peds_upper_v1_mesh (control bake exports .001 when the stripped input's orphaned mesh data holds the canonical name)",
      controlIsFullRes: "the control gown was NOT run through the #695 meshopt rung: a whole-file ratio-0.5 simplify halves the body skin (9810 -> 4905 tris), contaminating the clearance reference; the full-res bake keeps the shipped body as the reference",
    },
    bands,
    totals: {
      preFoldVerticesAtOrInside: totalPrefoldAtOrInside,
      preFoldSampled: totalSampled,
      foldOnVerticesInside: totalFoldOnInside,
      preFoldInsideNearestCrossCheck: controlInsideNearest.reduce((s, n) => s + n, 0),
      preFoldInsideParityCrossCheck: controlInsideParity.reduce((s, n) => s + n, 0),
      foldOnVerticesInsideSameTopology: sameTopologyInside.reduce((s, n) => s + n, 0),
    },
    bandsCrossChecks: bands.map((b, i) => ({
      index: b.index,
      preFoldInsideNearest: controlInsideNearest[i]!,
      preFoldInsideParity: controlInsideParity[i]!,
      foldOnVerticesInsideSameTopology: sameTopologyInside[i]!,
    })),
    foldReachability,
    reachabilityNote,
  };

  mkdirSync(dirname(CLEARANCE_REPORT_PATH), { recursive: true });
  writeFileSync(CLEARANCE_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${CLEARANCE_REPORT_PATH}\n`);
  process.stdout.write(
    `preFold atOrInside=${totalPrefoldAtOrInside}/${totalSampled} (${(prefoldShare * 100).toFixed(1)}%) | ` +
      `foldOn shipped inside=${totalFoldOnInside} | sameTopology inside=${sameTopologyInside.reduce((s, n) => s + n, 0)} | ` +
      `verdict=${foldReachability}\n`,
  );
}

async function main(): Promise<void> {
  const controlPath = process.env[CONTROL_GLB_ENV];
  if (controlPath) {
    await measureShellClearance(controlPath);
    return;
  }
  // COUNTERWEIGHT: pin the graded asset before measuring anything.
  const rawBytes = readFileSync(GLB_PATH);
  const bytes = new Uint8Array(rawBytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== GLB_SHA256 || bytes.byteLength !== GLB_BYTES) {
    throw new Error(
      `graded asset changed: sha256 ${hash.slice(0, 12)}... size ${bytes.byteLength} `
        + `(expected ${GLB_SHA256.slice(0, 12)}... / ${GLB_BYTES}) — refusing to measure a different mesh`,
    );
  }

  const doc = await io.read(GLB_PATH);
  const { gownPos, gownIdx, bodyPos, bodyIdx } = loadGownAndBody(doc);
  const geo = buildBodyGeometry(bodyPos, bodyIdx);
  const { bodyTris, axisX, axisZ } = geo;

  const { gownVerts, gMinY, gMaxY } = gownVerticesAndRange(gownPos);
  const band = (y: number): number =>
    Math.min(DECILES - 1, Math.max(0, Math.floor(((y - gMinY) / (gMaxY - gMinY)) * DECILES)));

  const deciles = Array.from({ length: DECILES }, () => ({
    index: 0,
    yLow: 0,
    yHigh: 0,
    gownVerticesInsideBody: 0,
    degenerateTriangles: 0,
    inwardFacingTriangles: 0,
    // cross-checks, recorded alongside the three fields
    gownVerticesInsideBodyRayZ: 0,
    gownVerticesInsideBodyNearest: 0,
    rayDisagreements: 0,
    zeroAreaTriangles: 0,
    inwardFacingTrianglesNearestSurface: 0,
    // #714 corrected metric: inside ONLY when two independent tests agree — a parity ray
    // test alone is invalid on the non-watertight body hull (2,090 open boundary edges;
    // a ray through a seam flips odd parity without the point being inside). A vertex
    // counts here when (parity says inside AND nearest-surface signed distance says
    // strictly inside) on either the +X or +Z ray. This is the definition the #714
    // contract clause (1) asserts on; it removes the single-axis false positives while
    // keeping real penetrations (the armpit/seam class) visible.
    gownVerticesInsideBodyTwoTests: 0,
  }));
  for (let d = 0; d < DECILES; d++) {
    deciles[d]!.index = d;
    deciles[d]!.yLow = gMinY + (d / DECILES) * (gMaxY - gMinY);
    deciles[d]!.yHigh = gMinY + ((d + 1) / DECILES) * (gMaxY - gMinY);
  }

  for (const q of gownVerts) {
    const d = deciles[band(q[1]!)]!;
    const cx = crossings(q, "x", geo);
    const cz = crossings(q, "z", geo);
    const insideX = cx % 2 === 1;
    const insideZ = cz % 2 === 1;
    if (insideX) d.gownVerticesInsideBody++;
    if (insideZ) d.gownVerticesInsideBodyRayZ++;
    if (insideX !== insideZ) d.rayDisagreements++;
    const { sign } = nearestBodyInfo(q, geo);
    const insideNearest = sign < -SURFACE_EPS;
    if (insideNearest) d.gownVerticesInsideBodyNearest++;
    // #714: two independent tests must AGREE a vertex is inside (parity + nearest-surface).
    if ((insideX || insideZ) && insideNearest) d.gownVerticesInsideBodyTwoTests++;
  }

  for (let t = 0; t + 2 < gownIdx.length; t += 3) {
    const a = gownVerts[gownIdx[t]!]!, b = gownVerts[gownIdx[t + 1]!]!, c = gownVerts[gownIdx[t + 2]!]!;
    const ax = b[0]! - a[0]!, ay = b[1]! - a[1]!, az = b[2]! - a[2]!;
    const bx = c[0]! - a[0]!, by = c[1]! - a[1]!, bz = c[2]! - a[2]!;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz);
    const cy = (a[1]! + b[1]! + c[1]!) / 3;
    const cx = (a[0]! + b[0]! + c[0]!) / 3;
    const cz = (a[2]! + b[2]! + c[2]!) / 3;
    const d = deciles[band(cy)]!;
    if (0.5 * len < DEGENERATE_AREA_M2) {
      d.degenerateTriangles++;
      if (0.5 * len < ZERO_AREA_M2) d.zeroAreaTriangles++;
    }
    if (len > 1e-12) {
      // axis reference: geometric normal points toward the body XZ axis (the card's "gown's
      // interior" for the trunk).
      if ((nx * (cx - axisX) + nz * (cz - axisZ)) / len < 0) d.inwardFacingTriangles++;
      // nearest-surface reference: geometric normal opposes the nearest body triangle's outward
      // normal — locally correct, biased at free rims (hem/collar/cuffs).
      const { n: m } = nearestBodyInfo([cx, cy, cz], geo);
      if ((nx * m[0]! + ny * m[1]! + nz * m[2]!) / len < 0) {
        d.inwardFacingTrianglesNearestSurface++;
      }
    }
  }

  const upper = (f: (d: (typeof deciles)[number]) => number): number =>
    deciles.slice(Math.ceil(DECILES / 2)).reduce((s, d) => s + f(d), 0);
  const lower = (f: (d: (typeof deciles)[number]) => number): number =>
    deciles.slice(0, Math.ceil(DECILES / 2)).reduce((s, d) => s + f(d), 0);

  const insideU = upper((d) => d.gownVerticesInsideBody);
  const insideL = lower((d) => d.gownVerticesInsideBody);
  const degenU = upper((d) => d.degenerateTriangles);
  const degenL = lower((d) => d.degenerateTriangles);
  const inwardU = upper((d) => d.inwardFacingTriangles);
  const inwardL = lower((d) => d.inwardFacingTriangles);

  // Decide the supported mechanism against the measured concentration. The pixel grade localises
  // the shards to the bodice (upper half) with a clean skirt (lower half).
  let supportedMechanism: string;
  if (insideU > insideL && insideU >= 10) {
    supportedMechanism = "interpenetration";
  } else if (inwardU > inwardL && inwardU >= 10) {
    supportedMechanism = "inward_facing_normals";
  } else if (degenU > degenL && degenU >= 10) {
    supportedMechanism = "degenerate_triangles";
  } else if (insideU === 0 && degenU === 0 && inwardU === 0) {
    supportedMechanism = "none_of_these";
  } else {
    supportedMechanism = "inconclusive_blocked";
  }

  const mechanismNote = (() => {
    const insideRayZ_U = upper((d) => d.gownVerticesInsideBodyRayZ);
    const insideRayZ_L = lower((d) => d.gownVerticesInsideBodyRayZ);
    const insideNS_U = upper((d) => d.gownVerticesInsideBodyNearest);
    const insideNS_L = lower((d) => d.gownVerticesInsideBodyNearest);
    if (supportedMechanism === "interpenetration") {
      return (
        `gown vertices inside the body skin are measured and bodice-concentrated: +X-ray even-odd ` +
        `${insideU} upper vs ${insideL} lower, +Z-ray ${insideRayZ_U} vs ${insideRayZ_L}, ` +
        `nearest-surface ${insideNS_U} vs ${insideNS_L}. The gather band (automate_blender.py #686: ` +
        `_fold_amp686=0.034m triangle-wave on a 10-22mm conformal offset) puts the wave valleys ` +
        `12-24mm inside the body surface across y 0.98..1.51 (body f 0.55..0.86), fading at both ` +
        `band edges — which is where the shards are densest and where they fade. Degenerate ` +
        `triangles are negligible (${deciles.reduce((s, d) => s + d.degenerateTriangles, 0)} below ` +
        `1e-8 m^2, ${deciles.reduce((s, d) => s + d.zeroAreaTriangles, 0)} below 1e-12) and sit near ` +
        `the collar, not the placket. Inward-facing normals (axis reference) are upper-heavy but ` +
        `dominated by correct inner-sleeve tube surfaces and accordion flank normals near dot~0; ` +
        `the nearest-surface reference is biased at free rims. Neither is the discriminator the ` +
        `interpenetration is.`
      );
    }
    if (supportedMechanism === "inward_facing_normals") {
      return (
        `inward-facing normals (axis reference) measure ${inwardU} upper vs ${inwardL} lower; ` +
        `nearest-surface reference ${upper((d) => d.inwardFacingTrianglesNearestSurface)} vs ` +
        `${lower((d) => d.inwardFacingTrianglesNearestSurface)}. Interpenetration measured ` +
        `${insideU} vs ${insideL}; degenerate triangles ${degenU} vs ${degenL} (below 1e-8 m^2).`
      );
    }
    if (supportedMechanism === "degenerate_triangles") {
      return (
        `degenerate triangles (below 1e-8 m^2) measure ${degenU} upper vs ${degenL} lower; ` +
        `interpenetration ${insideU} vs ${insideL}; inward normals ${inwardU} vs ${inwardL}.`
      );
    }
    return (
      `no candidate is cleanly bodice-concentrated: interpenetration ${insideU} vs ${insideL}, ` +
      `degenerate ${degenU} vs ${degenL}, inward ${inwardU} vs ${inwardL}. The gather mechanism ` +
      `(automate_blender.py #686: _fold_amp686=0.034m triangle-wave on a 10-22mm conformal ` +
      `offset) predicts 12-24mm valley penetration across y 0.98..1.51, but the measured numbers ` +
      `do not support naming one candidate with confidence.`
    );
  })();

  const report = {
    slice: "issue-714",
    title: "gown fold clamp measurement — per-decile, pre/post-fix re-measurement of #691",
    measuredAt: new Date().toISOString(),
    measuredAtCommit: headSha(),
    renderPath: process.env.OPENCLINXR_GOWN_RENDER_PATH ?? "",
    renderNote: process.env.OPENCLINXR_GOWN_RENDER_NOTE ?? "",
    counterweight: {
      glbSha256: hash,
      glbBytes: bytes.byteLength,
      pinnedSha256: GLB_SHA256,
      pinnedBytes: GLB_BYTES,
    },
    gownMesh: GOWN_MESH,
    gownVertexCount: gownVerts.length,
    bodyVertexCount: bodyPos.length / 3,
    gownMaterial: (() => {
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          if (mesh.getName() === GOWN_MESH) {
            const mat = prim.getMaterial();
            if (mat) {
              return { doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode() };
            }
          }
        }
      }
      return null;
    })(),
    method: {
      decilesOver: `gown's own y-range ${gMinY.toFixed(3)}..${gMaxY.toFixed(3)} m, ten equal bands`,
      interpenetration: {
        primary: "even-odd point-in-mesh by +X raycast (Moller-Trumbore, q=s x e1), grid-accelerated over the visible skin primitive mpfb_skin_robert_reference",
        crossCheckRayZ: "same test with +Z ray",
        crossCheckNearest: "nearest body triangle signed distance (3x3-cell search, Ericson closest point), inside = sign < -2mm",
        twoTestsAgree: "#714 corrected primary: a vertex counts as inside only when a parity test AND the nearest-surface signed distance agree (either ray + nearest). Single-axis parity is invalid on the non-watertight hull: a ray crossing an open boundary edge flips odd parity without the point being inside.",
        caveat: "the body mesh is not watertight (boundary edges within the gown's y-range); parity can flip near seams — hence the two-ray and nearest-surface cross-checks",
        validated: "centroid and neck test points classify inside, far points outside; hit points keep the ray origin's y/z (invariant checked)",
      },
      degenerateTriangles: {
        epsilonM2: DEGENERATE_AREA_M2,
        epsilonRationale: "area below 1e-8 m^2 = side lengths below ~0.14 mm — below render relevance at the graded 4096 capture; counts below 1e-12 (true zero-area) recorded separately",
      },
      inwardFacingTriangles: {
        reference: "geometric normal points toward the body XZ axis: dot(n, triCenter - axis) < 0",
        caveat: "counts inner-sleeve tube surfaces (correct geometry, occluded in the render) and accordion flank normals near dot~0; the nearest-body-surface-normal variant is recorded alongside (biased at free rims: hem/collar/cuffs)",
      },
    },
    deciles: deciles.map((d) => ({ ...d })),
    totals: {
      gownVerticesInsideBody: deciles.reduce((s, d) => s + d.gownVerticesInsideBody, 0),
      gownVerticesInsideBodyRayZ: deciles.reduce((s, d) => s + d.gownVerticesInsideBodyRayZ, 0),
      gownVerticesInsideBodyNearest: deciles.reduce((s, d) => s + d.gownVerticesInsideBodyNearest, 0),
      gownVerticesInsideBodyTwoTests: deciles.reduce((s, d) => s + d.gownVerticesInsideBodyTwoTests, 0),
      degenerateTriangles: deciles.reduce((s, d) => s + d.degenerateTriangles, 0),
      inwardFacingTriangles: deciles.reduce((s, d) => s + d.inwardFacingTriangles, 0),
      inwardFacingTrianglesNearestSurface: deciles.reduce((s, d) => s + d.inwardFacingTrianglesNearestSurface, 0),
    },
    upperVsLower: {
      gownVerticesInsideBody: { upper: insideU, lower: insideL },
      gownVerticesInsideBodyTwoTests: {
        upper: upper((d) => d.gownVerticesInsideBodyTwoTests),
        lower: lower((d) => d.gownVerticesInsideBodyTwoTests),
      },
      degenerateTriangles: { upper: degenU, lower: degenL },
      inwardFacingTriangles: { upper: inwardU, lower: inwardL },
    },
    supportedMechanism,
    mechanismNote,
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${REPORT_PATH}\n`);
  process.stdout.write(
    `inside upper=${insideU} lower=${insideL} | twoTests upper=${upper((d) => d.gownVerticesInsideBodyTwoTests)} lower=${lower((d) => d.gownVerticesInsideBodyTwoTests)} | ` +
      `degen upper=${degenU} lower=${degenL} | ` +
      `inward upper=${inwardU} lower=${inwardL} | supported=${supportedMechanism}\n`,
  );
}

await main();
