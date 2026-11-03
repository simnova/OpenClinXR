import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import {
  classifyGarmentMeshName,
  classifyLowerGarmentKind,
} from "../lib/garment-mesh-class.js";

/**
 * Campaign #478 lane L5 — the gown shell SPLITS AT THE CROTCH and reads as a bodysuit.
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE
 *
 * #480 landed real gown geometry on the MPFB rail and the orchestrator's pixel grade found it reads
 * as a teal BODYSUIT, not a gown: it follows the bust and navel and separates between the legs.
 * `_build_body_surface_derived_garment` (automate_blender.py:1862) offsets along the body's own
 * outward normals, so below the hip it wraps EACH LEG. A gown drapes as ONE skirt.
 *
 * Widest empty X interval inside each 3 cm horizontal band, hem -> hip, both rails:
 *
 *   y (MPFB)  0.554  0.584  0.614  0.644  0.674 | 0.704  0.734  0.764  0.794  0.824  0.854  0.884
 *   gap mm    143.6  103.0   87.2   67.4   62.5 |  31.7   27.0   34.7   30.6   26.3   22.9   27.2
 *                    ^^^^ SPLIT — every gap centred at x = 0.000, the body midline ^^^^
 *
 *   y (Anny)  0.583  0.613  0.643  0.673 | 0.703  0.733  0.763  0.793  0.823  0.853  0.883  0.913
 *   gap mm     79.7   92.7   66.5   52.8 |  39.9   32.3   29.7   24.7   22.9   28.8   27.8   26.8
 *
 * ## THIS IS NOT A #480 REGRESSION — IT SHIPS TO LEARNERS TODAY
 *
 * `ed_chest_pain_adult_cast.glb` carries `openclinxr_real_garment_peds_upper_v1_mesh` at 2,782 verts
 * with the SAME hemFrac 0.320 and the SAME midline split. Seven patients are cast on it. #480
 * reproduced the builder faithfully onto MPFB; the builder is the defect and always was.
 *
 * Correcting a premise where it is stated (SS7q): #480's close comment framed the bodysuit read as a
 * residual of that slice. It is not. It is pre-existing on both rails.
 *
 * ## KNOWN-GOOD COLUMN (SS9h) — INSIDE THE SAME MESH, SO IT CANNOT BE FITTED
 *
 * The upper bands of the SAME shell at the SAME vertex density are single closed loops and measure
 * **22.9 - 34.7 mm**. The `toigo_t_shirt` closed torso ring on the same body measures **15.2 mm**.
 * So `GAP_MAX_M = 0.040` sits above every observed CLOSED loop and 1.6x below the smallest observed
 * SPLIT (62.5 mm). Neither reference is a fraction of the treatment; both are geometry nobody baked
 * for this contract, and the upper bands prove the bound is reachable at this density.
 *
 * ## SAMPLE BELOW THE HIP ONLY — the metric is confounded above it
 *
 * At chest height the sleeves are separate lobes, so the widest-X-gap reads 176.4 mm on a perfectly
 * good garment. That is not a defect; it is an arm. Bands stop at 0.55h.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                       | (1) gap | (2) span | (3) verts | result
 *   ------------------------------------------------|---------|----------|-----------|--------
 *   a) today — conformal per-leg wrap                | **FAIL**|   pass   |   pass    | REFUSED
 *   b) raise the hem above the split                 |   pass  | **FAIL** |   pass    | REFUSED
 *   c) decimate the below-hip rows away              |   pass  | **FAIL** | **FAIL**  | REFUSED
 *   d) skirt the cross-section below the hip         |   pass  |   pass   |   pass    | ALL PASS
 *
 * (b) is the one to watch: deleting the lower rows removes the split by removing the skirt, and a
 * gap-only bound would go green on a mini-dress. Clause (2) pins hem and shoulder from #480.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** (2) and (3) pass today — they
 * exist to stop (1) being satisfied by removing geometry. (4) and (5) are NETs on shipped state.
 *
 * ## (6) CHIN REGRESSION (st-gowninsp R3) — SECOND RED
 *
 * The round-2 rebake put the collar at 1.485, 46 mm above the 3bdf74d4b neckline (1.4392, base of
 * the neck), and GOWN_REHIDE hid 203 jaw + 85 head faces under it (clause count on the
 * round-2 bytes; independent python diag E/chin-diag.py counts 204 + 90 — same magnitude,
 * both 0 on the fixed bytes); the #334 head-joint clip could
 * not rescue them because the chin sits BELOW the head joint (E/chin-diag.json). The runtime
 * discards hidden-slot fragments, so the shipped stills showed teeth below the lip with the collar
 * filling neck-to-mouth. KNOWN-GOOD ROW: 0 head + 0 jaw hidden faces on the 3bdf74d4b bytes
 * (1175 hidden faces total, all torso/throat). The destructive probe runs this clause with
 * GOWN_PROBE_GLB pointed at the round-2 bytes and must FAIL (E/probes.md).
 *
 * ## (7) FRONT NECKLINE SCOOP (st-gowninsp R4) — THIRD RED
 *
 * The R3 cage rings are uniform-y, so lowering the whole top ring (1.485 -> 1.435) matched
 * only the BACK/top number (1.4392 on the 3bdf74d4b bytes) while the FRONT sat 52 mm too
 * high (1.435 vs the kg front-midline 1.3834; chin bottom 1.4333 -> 0 mm of throat visible;
 * collar row 315 vs 390-395 known-good, E/neck-diag.json). The kg shell scoops 55 mm at the
 * front (front-midline 1.3834 vs back 1.4387). KNOWN-GOOD ROW: front-midline neckline height
 * 1.3834 +/- 0.015 (the band covers the 1 mm body-generation wobble and stays 35+ mm below
 * the chin bottom, so passing implies visible throat). The destructive probe runs this clause
 * with GOWN_PROBE_GLB pointed at the round-3 bytes (1.435, outside the band) and must
 * FAIL (E/probes.md).
 *
 * ## (8) SLEEVE-ROOT SLITS (st-gowninsp R4) — FOURTH RED
 *
 * Open boundary paths at the outer arm roots ((0.171,1.285)-(0.163,1.335)-(0.207,1.385)
 * front+back per side; far side 9-29 mm away) chord across the torso silhouette; the R3
 * midpoint-fan web covered only part of each gap and faced backward, so the chest stills
 * show enclosed background through triangular gaps (~1030 px per side, rows 399-448).
 * The geometric equivalent of the enclosed-background pixel count: orthographic front
 * projection on 4 mm cells over both sleeve-root boxes, counting EMPTY cells enclosed by
 * covered cells (flood fill from the box border). KNOWN-GOOD ROW: 0 enclosed cells per side
 * on the 3bdf74d4b bytes (its 175 in-box boundary edges are covered seams, E/neck-diag.json);
 * 66 enclosed cells per side on the round-2 AND round-3 bytes (TS raster; the python diag reads 64 on a 4.06 mm grid). The destructive probe runs
 * this clause with GOWN_PROBE_GLB pointed at the round-3 bytes and must FAIL (E/probes.md).
 *
 * NOT TESTED:
 *   - **Hem raggedness.** The hem spans 226.7 mm over 36 angular buckets (sd 89.7 mm). That is very
 *     likely DOWNSTREAM of the split — a shell wrapping two legs cannot have a level hem — so it is
 *     recorded as a reading, not bundled as a second cause (SS8i). RE-MEASURE IT AFTER THIS LANDS.
 *   - Whether the back opens, as a real hospital gown does.
 *   - The Anny rail. This slice touches the builder; the Anny body is NOT rebaked here (clause 4).
 *   - Whether a draped skirt still skins sanely when the patient is seated or supine.
 */

/*
 * ## FIXED (#481)
 *
 * `_build_body_surface_derived_garment` (automate_blender.py) now lofts a single closed
 * skirt tube below the hip for the `gown` kind. The below-hip body region is cut at
 * `skirt_top_y` (0.55 * body_height — the same fraction the inspect samples as HIP_FRAC)
 * and replaced by a tapered ring stack (flare 0.12) whose top ring shares the torso's
 * cut-ring vertices, so export continuity is inherited rather than re-split (SS6t). The
 * sleeve coefficient `arm_len * 0.42` (#200) and hem 0.32 (#197) are untouched.
 *
 * Clause (1) flipped `it.fails` -> `it`. Clause (5)'s second assertion flipped
 * `toBeGreaterThan(0)` -> `toBe(0)`: it was a RED-time guard ("the split is present, so (1)
 * is a real RED") whose premise this fix eliminates. Post-fix no below-hip band may remain
 * split, which clause (1) already asserts via `worst.gapM <= GAP_MAX_M`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(HERE, "../../../../apps/ui-xr/public/generated-humanoids");
const TARGET = join(GENERATED, "mpfb-gown-inspect.glb");
const ANNY_GOWNED = join(GENERATED, "ed_chest_pain_adult_cast.glb");

/** Derived above every observed CLOSED loop (22.9-34.7 mm) and below every observed SPLIT (>=62.5 mm). */
const GAP_MAX_M = 0.04;
const BAND_M = 0.03;
const MIN_BAND_POINTS = 12;
const HIP_FRAC = 0.55;
const MIN_SHELL_VERTS = 2_000;
/** From #480's landed span bound — the same two controls, restated so (2) is self-contained. */
const HEM_FRAC_MAX = 0.45;
const TOP_FRAC_MIN = 0.7;
/** st-gowninsp R4 clause (7): kg front-midline neckline height on the 3bdf74d4b bytes
 * (front scoop 1.3834 vs back 1.4387, E/neck-diag.json). The band covers the 1 mm
 * body-generation wobble and stays 35+ mm below the chin bottom (1.4333), so passing
 * implies visible throat. R3 bytes read 1.435 (outside, fails). */
const KG_FRONT_NECKLINE_Y = 1.3834;
const FRONT_NECKLINE_TOL_M = 0.015;
/** st-gowninsp R4 clause (8): sleeve-root slit boxes (front orthographic projection). */
const SLIT_X_MIN = 0.08;
const SLIT_X_MAX = 0.34;
const SLIT_Y_MIN = 1.02;
const SLIT_Y_MAX = 1.5;
const SLIT_CELL_M = 0.004;

type Shell = { pts: number[][]; hem: number; top: number; bodyY0: number; bodyY1: number };

async function readShell(p: string): Promise<Shell | null> {
  if (!existsSync(p)) throw new Error("missing artifact");
  const doc = await new NodeIO().read(p);
  // Shell + body via the one shared classifier. The shell scope (fitted upper
  // or gown) matches /real_garment/ on these two GLBs exactly; the body class
  // matches /anny_base|_body$/ — and survives the next rename, unlike both.
  const isShellMesh = (meshName: string): boolean => {
    const cls = classifyGarmentMeshName(meshName);
    if (cls === "upper") return true;
    if (cls === "lower" && classifyLowerGarmentKind(meshName) === "gown") return true;
    return false;
  };
  const isBodyMesh = (meshName: string): boolean => classifyGarmentMeshName(meshName) === "body";
  const collect = (pred: (meshName: string) => boolean): number[][] => {
    const out: number[][] = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      if (!pred(mesh.getName() ?? "")) continue;
      for (const prim of mesh.listPrimitives()) {
        const a = prim.getAttribute("POSITION");
        if (!a) continue;
        const e = [0, 0, 0];
        for (let i = 0; i < a.getCount(); i += 1) {
          a.getElement(i, e);
          out.push([e[0]!, e[1]!, e[2]!]);
        }
      }
    }
    return out;
  };
  // The builder names procedural garments by `gname`, never by `kind` — matching /gown/ finds only
  // the 3-vertex declaration marker. That trap cost #480 a defective clause; do not reintroduce it.
  const pts = collect(isShellMesh);
  const body = collect(isBodyMesh);
  if (!pts.length || !body.length) return null;
  const ys = pts.map((q) => q[1]!);
  return {
    pts,
    hem: Math.min(...ys),
    top: Math.max(...ys),
    bodyY0: Math.min(...body.map((q) => q[1]!)),
    bodyY1: Math.max(...body.map((q) => q[1]!)),
  };
}

type Band = { y: number; n: number; gapM: number };

/** Widest empty X interval in each below-hip band. A closed loop yields ~0.02 m; a split yields ~0.10 m. */
function belowHipBands(s: Shell): Band[] {
  const hipY = s.bodyY0 + (s.bodyY1 - s.bodyY0) * HIP_FRAC;
  const bands: Band[] = [];
  for (let y = s.hem + 0.02; y < hipY - BAND_M; y += BAND_M) {
    const xs = s.pts.filter((p) => p[1]! >= y && p[1]! < y + BAND_M).map((p) => p[0]!).sort((a, b) => a - b);
    if (xs.length < MIN_BAND_POINTS) continue;
    let gapM = 0;
    for (let i = 1; i < xs.length; i += 1) {
      const d = xs[i]! - xs[i - 1]!;
      if (d > gapM) gapM = d;
    }
    bands.push({ y: +y.toFixed(3), n: xs.length, gapM });
  }
  return bands;
}

const fmt = (b: Band[]): string => b.map((x) => `y=${x.y} n=${x.n} gap=${(x.gapM * 1000).toFixed(1)}mm`).join("\n  ");

/** An empty enumeration must FAIL, never pass vacuously (SS7t). Plain function, not an it.fails. */
async function shellOrThrow(p: string): Promise<Shell> {
  const s = await readShell(p);
  expect(s, `${p} must exist and carry an openclinxr_real_garment_* shell plus a body mesh`).not.toBeNull();
  return s!;
}

/** Count see-through holes: front-projected shell triangles rasterized on SLIT_CELL_M
 * cells over one sleeve-root box; empty cells unreachable from the border through empty
 * cells are enclosed by shell (kg: 0; round-2/round-3 bytes: 64 per side). */
function countEnclosedEmpty(tris: number[][][], x0: number, x1: number): number {
  const nx = Math.round((x1 - x0) / SLIT_CELL_M) + 1;
  const ny = Math.round((SLIT_Y_MAX - SLIT_Y_MIN) / SLIT_CELL_M) + 1;
  const covered: boolean[][] = Array.from({ length: ny }, () => new Array<boolean>(nx).fill(false));
  const sign = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number =>
    (py - ay) * (bx - ax) - (px - ax) * (by - ay);
  for (const t of tris) {
    const ax = t[0]![0]!;
    const ay = t[0]![1]!;
    const bx = t[1]![0]!;
    const by = t[1]![1]!;
    const cx = t[2]![0]!;
    const cy = t[2]![1]!;
    const tx0 = Math.min(ax, bx, cx);
    const tx1 = Math.max(ax, bx, cx);
    const ty0 = Math.min(ay, by, cy);
    const ty1 = Math.max(ay, by, cy);
    if (tx1 < x0 || tx0 > x1 || ty1 < SLIT_Y_MIN || ty0 > SLIT_Y_MAX) continue;
    const ix0 = Math.max(0, Math.floor((Math.max(tx0, x0) - x0) / SLIT_CELL_M));
    const ix1 = Math.min(nx - 1, Math.ceil((Math.min(tx1, x1) - x0) / SLIT_CELL_M));
    const iy0 = Math.max(0, Math.floor((Math.max(ty0, SLIT_Y_MIN) - SLIT_Y_MIN) / SLIT_CELL_M));
    const iy1 = Math.min(ny - 1, Math.ceil((Math.min(ty1, SLIT_Y_MAX) - SLIT_Y_MIN) / SLIT_CELL_M));
    for (let iy = iy0; iy <= iy1; iy += 1) {
      for (let ix = ix0; ix <= ix1; ix += 1) {
        if (covered[iy]![ix]!) continue;
        const px = x0 + ix * SLIT_CELL_M;
        const py = SLIT_Y_MIN + iy * SLIT_CELL_M;
        const d1 = sign(px, py, ax, ay, bx, by);
        const d2 = sign(px, py, bx, by, cx, cy);
        const d3 = sign(px, py, cx, cy, ax, ay);
        if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) {
          covered[iy]![ix] = true;
        }
      }
    }
  }
  // Flood fill from the border through empty cells; leftovers are enclosed.
  const reach: boolean[][] = Array.from({ length: ny }, () => new Array<boolean>(nx).fill(false));
  const stack: Array<[number, number]> = [];
  for (let ix = 0; ix < nx; ix += 1) {
    if (!covered[0]![ix]!) stack.push([0, ix]);
    if (!covered[ny - 1]![ix]!) stack.push([ny - 1, ix]);
  }
  for (let iy = 0; iy < ny; iy += 1) {
    if (!covered[iy]![0]!) stack.push([iy, 0]);
    if (!covered[iy]![nx - 1]!) stack.push([iy, nx - 1]);
  }
  while (stack.length > 0) {
    const [iy, ix] = stack.pop()!;
    if (reach[iy]![ix]! || covered[iy]![ix]!) continue;
    reach[iy]![ix] = true;
    if (iy > 0) stack.push([iy - 1, ix]);
    if (iy + 1 < ny) stack.push([iy + 1, ix]);
    if (ix > 0) stack.push([iy, ix - 1]);
    if (ix + 1 < nx) stack.push([iy, ix + 1]);
  }
  let holes = 0;
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      if (!covered[iy]![ix]! && !reach[iy]![ix]!) holes += 1;
    }
  }
  return holes;
}

describe("the gown drapes below the hip instead of wrapping each leg", () => {
  it("(1) no below-hip band has a midline split", async () => {
    const bands = belowHipBands(await shellOrThrow(TARGET));
    expect(bands.length, "the shell must produce sampleable below-hip bands").toBeGreaterThan(4);
    const worst = bands.reduce((a, b) => (b.gapM > a.gapM ? b : a));
    expect(
      worst.gapM,
      `widest below-hip X gap ${(worst.gapM * 1000).toFixed(1)}mm at y=${worst.y} — a closed loop in this\n`
        + `  mesh measures 22.9-34.7mm. All bands:\n  ${fmt(bands)}`,
    ).toBeLessThanOrEqual(GAP_MAX_M);
  });

  it("(2) COUNTERWEIGHT: the shell still spans shoulder to below mid-thigh", async () => {
    // Refuses (b) and (c). Raising the hem above the split, or decimating the lower rows, removes
    // the gap by removing the skirt — and a gap-only bound would go green on a mini-dress.
    const s = await shellOrThrow(TARGET);
    const h = s.bodyY1 - s.bodyY0;
    expect((s.hem - s.bodyY0) / h, "hem must stay below mid-thigh (#480's bound)").toBeLessThanOrEqual(HEM_FRAC_MAX);
    expect((s.top - s.bodyY0) / h, "the shell must still reach the shoulder (#480's bound)").toBeGreaterThanOrEqual(
      TOP_FRAC_MIN,
    );
  });

  it("(3) COUNTERWEIGHT: the shell is not decimated to remove the split", async () => {
    // Refuses (c) from the other side. Today 2,677 verts; dropping below 2,000 means rows were
    // deleted rather than re-routed.
    const s = await shellOrThrow(TARGET);
    expect(s.pts.length, `${s.pts.length} verts — #480 landed 2,677`).toBeGreaterThanOrEqual(MIN_SHELL_VERTS);
  });

  it("(4) NET: the Anny gowned body is not rebaked by this slice", async () => {
    // Seven patients are still cast on it (L6 is blocked and P1 stays parked). This slice changes the
    // BUILDER; re-running it over the Anny body is a separate, sequenced decision.
    const s = await shellOrThrow(ANNY_GOWNED);
    expect(s.pts.length, "the Anny shell must still ship at its landed size").toBeGreaterThanOrEqual(
      MIN_SHELL_VERTS,
    );
  });

  it("(5) VACUITY GUARD: a closed loop in this mesh really does measure under the bound", async () => {
    // Reads shipped geometry, passes today, and is the known-good column: if the UPPER below-hip
    // bands did not already clear GAP_MAX_M, clause (1) would be unachievable at this vertex
    // density rather than merely red, and this says which.
    const bands = belowHipBands(await shellOrThrow(TARGET));
    const closed = bands.filter((b) => b.gapM <= GAP_MAX_M);
    expect(closed.length, `no band clears ${GAP_MAX_M * 1000}mm — the bound may be unreachable:\n  ${fmt(bands)}`)
      .toBeGreaterThanOrEqual(5);
    const split = bands.filter((b) => b.gapM > GAP_MAX_M);
    expect(split.length, `no below-hip band may remain split after the fix:\n  ${fmt(bands)}`)
      .toBe(0);
  });

  it("(6) RED: no head/jaw skin hides under the gown", async () => {
    // st-gowninsp R3 chin regression (header ## (6)). GOWN_PROBE_GLB overrides the target so the
    // destructive probe can run this clause against the round-2 bytes (E/probes.md).
    const target = process.env.GOWN_PROBE_GLB ?? TARGET;
    const doc = await new NodeIO().read(target);
    const bodyMesh = doc.getRoot().listMeshes().find(
      (mesh) => classifyGarmentMeshName(mesh.getName() ?? "") === "body",
    );
    expect(bodyMesh, `${target} must carry a body mesh`).toBeDefined();
    const skinNode = doc.getRoot().listNodes().find((node) => node.getMesh() === bodyMesh);
    const skinJoints = skinNode?.getSkin()?.listJoints().map((joint) => (joint.getName() ?? "").toLowerCase());
    expect(skinJoints, `${target} body mesh must be skinned`).toBeDefined();
    const joints = skinJoints!;
    let head = 0;
    let jaw = 0;
    let hiddenTotal = 0;
    for (const prim of bodyMesh!.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() ?? "";
      if (!matName.startsWith("openclinxr_hidden_")) continue;
      const indices = Array.from((prim.getIndices()?.getArray() ?? []) as ArrayLike<number>);
      const jointIdx = Array.from((prim.getAttribute("JOINTS_0")?.getArray() ?? []) as ArrayLike<number>);
      const weights = Float32Array.from((prim.getAttribute("WEIGHTS_0")?.getArray() ?? []) as ArrayLike<number>);
      expect(indices.length, "hidden prim must be indexed triangles").toBeGreaterThan(0);
      for (let f = 0; f + 2 < indices.length; f += 3) {
        hiddenTotal += 1;
        const votes = [indices[f]!, indices[f + 1]!, indices[f + 2]!].map((vi) => {
          let best = 0;
          for (let k = 1; k < 4; k += 1) {
            if (weights[vi * 4 + k]! > weights[vi * 4 + best]!) best = k;
          }
          return joints[jointIdx[vi * 4 + best]!] ?? "unknown";
        });
        const dom = votes.slice().sort(
          (a, b) => votes.filter((v) => v === b).length - votes.filter((v) => v === a).length,
        )[0]!;
        if (dom === "head") head += 1;
        if (dom === "jaw") jaw += 1;
      }
    }
    expect(hiddenTotal, "the hidden slot must exist and be measured (no vacuous pass)").toBeGreaterThan(0);
    expect(
      head + jaw,
      `${head + jaw} hidden-slot faces are head/jaw-weighted (head ${head}, jaw ${jaw}) in ${target} — `
        + "known-good row: 0 head + 0 jaw on the 3bdf74d4b bytes",
    ).toBe(0);
  });

  it("(7) RED: the front neckline scoops to the base of the neck", async () => {
    // st-gowninsp R4 header ## (7). Front-midline = |x| < 25 mm on the camera side (z > 0;
    // the gown node ships with an identity transform, so file POSITION is world — the same
    // frame the producer authors in). The R3 ring reads 1.435 here (fails); kg reads 1.3834.
    const target = process.env.GOWN_PROBE_GLB ?? TARGET;
    const s = await shellOrThrow(target);
    const frontMid = s.pts.filter((p) => Math.abs(p[0]!) < 0.025 && p[2]! > 0);
    expect(frontMid.length, `${target} must carry front-midline shell verts`).toBeGreaterThan(0);
    const frontY = Math.max(...frontMid.map((p) => p[1]!));
    expect(
      Math.abs(frontY - KG_FRONT_NECKLINE_Y),
      `front-midline neckline height ${frontY.toFixed(4)} — known-good row 1.3834 +/- 0.015 on the `
        + `3bdf74d4b bytes (R3 bytes read 1.435): ${target}`,
    ).toBeLessThanOrEqual(FRONT_NECKLINE_TOL_M);
  });

  it("(8) RED: no see-through slit at the sleeve roots", async () => {
    // st-gowninsp R4 header ## (8). Orthographic front projection of the shell on 4 mm
    // cells over both sleeve-root boxes; enclosed-empty cells (not reachable from the box
    // border through empty cells) are see-through holes. kg reads 0/0; round-2 and round-3
    // bytes read 64/64 (E/neck-diag.json). Destructive probe via GOWN_PROBE_GLB must FAIL.
    const target = process.env.GOWN_PROBE_GLB ?? TARGET;
    const doc = await new NodeIO().read(target);
    const tris: number[][][] = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      const name = mesh.getName() ?? "";
      const cls = classifyGarmentMeshName(name);
      const isShell =
        cls === "upper" || (cls === "lower" && classifyLowerGarmentKind(name) === "gown");
      if (!isShell) continue;
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const idx = prim.getIndices();
        if (!idx) continue;
        const pts: number[][] = [];
        const e = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i += 1) {
          pos.getElement(i, e);
          pts.push([e[0]!, e[1]!, e[2]!]);
        }
        const n = idx.getCount();
        const arr = Array.from(idx.getArray() as ArrayLike<number>);
        for (let f = 0; f + 2 < n; f += 3) {
          tris.push([pts[arr[f]!]!, pts[arr[f + 1]!]!, pts[arr[f + 2]!]!]);
        }
      }
    }
    expect(tris.length, `${target} must carry shell triangles`).toBeGreaterThan(0);
    for (const [side, x0, x1] of [["L", -0.34, -0.08], ["R", 0.08, 0.34]] as const) {
      const holes = countEnclosedEmpty(tris, x0, x1);
      expect(
        holes,
        `${holes} enclosed-empty 4mm cells in the ${side} sleeve-root box — known-good row 0/0 `
          + `on the 3bdf74d4b bytes (round-3 bytes read 66): ${target}`,
      ).toBe(0);
    }
  });
});
