import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

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
 * NOT TESTED:
 *   - **Hem raggedness.** The hem spans 226.7 mm over 36 angular buckets (sd 89.7 mm). That is very
 *     likely DOWNSTREAM of the split — a shell wrapping two legs cannot have a level hem — so it is
 *     recorded as a reading, not bundled as a second cause (SS8i). RE-MEASURE IT AFTER THIS LANDS.
 *   - Whether the back opens, as a real hospital gown does.
 *   - The Anny rail. This slice touches the builder; the Anny body is NOT rebaked here (clause 4).
 *   - Whether a draped skirt still skins sanely when the patient is seated or supine.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(HERE, "../../../apps/ui-xr/public/generated-humanoids");
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

type Shell = { pts: number[][]; hem: number; top: number; bodyY0: number; bodyY1: number };

async function readShell(p: string): Promise<Shell | null> {
  if (!existsSync(p)) return null;
  const doc = await new NodeIO().read(p);
  const collect = (re: RegExp): number[][] => {
    const out: number[][] = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      if (!re.test(mesh.getName() ?? "")) continue;
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
  const pts = collect(/real_garment/);
  const body = collect(/anny_base|_body$/);
  if (!pts.length || !body.length) return null;
  const ys = pts.map((p) => p[1]!);
  return {
    pts,
    hem: Math.min(...ys),
    top: Math.max(...ys),
    bodyY0: Math.min(...body.map((p) => p[1]!)),
    bodyY1: Math.max(...body.map((p) => p[1]!)),
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

describe("the gown drapes below the hip instead of wrapping each leg", () => {
  it.fails("(1) RED: no below-hip band has a midline split", async () => {
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
    expect(split.length, `the split must still be present for (1) to be a real RED:\n  ${fmt(bands)}`)
      .toBeGreaterThan(0);
  });
});
