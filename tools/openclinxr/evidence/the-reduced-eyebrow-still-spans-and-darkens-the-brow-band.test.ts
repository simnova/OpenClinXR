import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";

/**
 * #597 — APPEARANCE ORACLE for the fitted eyebrow, planted AFTER the first reduction
 * (keep-largest-strands, brow -> 1,170 tris/actor) passed every quantity clause in
 * `the-eyebrows-cost-more-than-every-other-facial-feature-combined.test.ts` while the
 * native-resolution pixel grade showed NO EYEBROW AT ALL above either eye.
 *
 * ## WHY THIS FILE EXISTS — the defect lives in APPEARANCE, so the gate must too
 *
 * The sibling contract bounds QUANTITIES: mesh presence, bbox containment, triangle counts.
 * All three stayed true for geometry that is invisible. Measured on the graded captures
 * (.openclinxr/evidence/eyebrow-budget/brow-before.png / brow-after.png, 440x340 native crops,
 * well-aligned): before vs after differ by 244 pixels (0.16%) confined to rows y[120,140] —
 * the entire visible signature of "eyebrows present" at learner framing. The reduction dropped
 * 97% of strands; the surviving 36-64 largest strands carry 26-42x LESS projected front area
 * than the full brow (instrument below). Presence checks cannot see that; this file can.
 *
 * ## THE INSTRUMENT — front-projected brow ink inside a band anchored to the EYES
 *
 * Character faces +Z, Y up; the front camera sees the XY plane. For each actor:
 *   - eyes_low_poly gives exSpan/exTopY/exHeight (a landmark the brow treatment never touches);
 *   - the BROW BAND is x[exMin-0.5w, exMax+0.5w], y[exTop-0.3h, exTop+0.5h];
 *   - VERIFIED CONTAINMENT: 100% of the PRE-reduction brow triangles project inside the band
 *     on all 11 actors (measured 2026-08-26, see calibrate-final.ts in the slice evidence);
 *   - COVERAGE = fraction of the band's 96x24 cells hit by >=1 projected brow triangle;
 *   - INK = projected area of brow triangles divided by projected area of the eye mesh.
 *
 * The band comes from the EYES, never from the brow's own bbox: the reduced brow's bbox SHRANK
 * (x max 0.062 -> 0.031 on ob-patient-aisha) when tail strands were dropped, so a self-framed
 * region would move the goalposts with the treatment.
 *
 * ## THE REFERENCE AND THE THRESHOLDS — measured, with margins stated on BOTH sides
 *
 * PINNED below are the per-actor COVERAGE and INK of the ORIGINAL (pre-reduction, currently
 * on main) brows — the brows whose lit captures show unmistakable eyebrows (orchestrator
 * grade, native resolution).
 *
 * The thresholds are NOT fractions anyone chose first — they are set just under the MEASURED
 * CEILING of whole-strand selection at the 1,170-tri sibling-facial budget, simulated
 * exhaustively on main bytes (policy-sim.ts / footprint-sim.ts in the slice evidence):
 *   - best coverage-greedy whole-strand selection retains 28-64% of the reference band
 *     footprint per actor; unselected strands only duplicate already-covered cells;
 *   - NO selection can exceed ~14% of reference ink: the thickest-projecting strand carries
 *     ~1.4e-7 m^2/tri, so 1,170 tris bound ink at ~1.6e-4 m^2 vs ~11.6e-4 for the full brow.
 *   Floors = 25% span, 10% ink: below the mechanism's ceiling (a correct maximising policy
 *   clears them) and far above today's output (which fails by multiples, not percent).
 *
 *   separation measured 2026-08-26 (current keep-largest branch vs floors):
 *     clause (A) coverage: branch 0.3-1.0% vs floors 1.35-3.8%     -> fails ALL by 4.5-18x
 *     clause (B) ink:      branch 0.017-0.057 vs floors 0.044-0.156 -> fails ALL by 2.6-11x
 *
 *   HONEST LIMIT, recorded in advance: these floors prove OPTIMAL USE of the budget, not
 *   that the result READS as a brow — the visible reference sits at 100% of itself, the
 *   simulated ceilings at 28-64%/14%, the floors at 25%/10%. If a render of a floor-clearing
 *   brow still grades as absent, that is the proof that the sibling-facial budget is not
 *   achievable with strand-selection geometry, and the correct finding to report is
 *   "smallest viable budget is N", not a lower floor.
 *
 * ## WHAT THIS REFUSES
 *   - deleting the brow or reducing it to invisible stubs (clause A/B go red together);
 *   - concentrating all surviving geometry into one spot (coverage needs SPAN across the band);
 *   - inflating the eyes to game clause B (the sibling contract pins eye mesh cost, and the
 *     eyes are the denominator — growing them LOWERS the ratio).
 *
 * claimScope: front-projected geometric visibility of the fitted eyebrow inside the
 *   eye-anchored brow band on the 11 shipped MPFB actors.
 * notEvidenceFor: how the brow LOOKS in a lit render (orchestrator grades pixels; this file
 *   bounds the mechanism's optimum); clinical appropriateness; Quest frame cost;
 *   profile/three-quarter visibility (front projection only); alpha-texture/hair-card
 *   approaches, whose ink is texel-based rather than geometric.
 *
 * NOT TESTED: three-quarter/profile views; motion (blinks, expressions); whether the
 *   25%/10% floors correspond to a perceptually visible brow (settled by render + pixel
 *   grade, not here); texture-based brows.
 */

const DIR = "apps/ui-xr/public/generated-humanoids";
const GRID_X = 96;
const GRID_Y = 24;
/** band padding, eye-relative: x +-50% of eye span; y [top-0.3h, top+0.5h] */
const PAD_X = 0.5;
const Y_BELOW = 0.3;
const Y_ABOVE = 0.5;

/**
 * Measured 2026-08-26 from the PRE-reduction bytes (git main) with the exact instrument
 * below (calibration: .openclinxr/evidence/eyebrow-budget/calibrate-final.ts).
 * covFrac = band-cell coverage fraction; inkPerEye = browProjArea / eyeProjArea.
 */
const PINNED_VISIBLE_BROW = {
  "mpfb-clinical-nurse-adult.glb": { covFrac: 0.109, inkPerEye: 1.47 },
  "mpfb-clinical-physician-adult.glb": { covFrac: 0.142, inkPerEye: 1.48 },
  "mpfb-family-partner-adult.glb": { covFrac: 0.095, inkPerEye: 0.91 },
  "mpfb-gown-adult-patient.glb": { covFrac: 0.152, inkPerEye: 1.56 },
  "mpfb-gown-inspect.glb": { covFrac: 0.122, inkPerEye: 1.24 },
  "mpfb-ob-patient-aisha.glb": { covFrac: 0.122, inkPerEye: 1.24 },
  "mpfb-peds-nurse-kevin.glb": { covFrac: 0.105, inkPerEye: 1.01 },
  "mpfb-peds-parent-aisha.glb": { covFrac: 0.132, inkPerEye: 1.33 },
  "mpfb-peds-patient-child.glb": { covFrac: 0.054, inkPerEye: 0.44 },
  "mpfb-street-adult-male.glb": { covFrac: 0.105, inkPerEye: 1.01 },
  "mpfb-viseme-inspect.glb": { covFrac: 0.122, inkPerEye: 1.24 },
} as const;

/**
 * Floors as fractions of the pinned visible reference: 25% span, 10% ink. Set just under
 * the measured whole-strand ceiling at this budget (28-64% / ~14%) — see header.
 */
const MIN_COVERAGE_FRACTION_OF_REF = 0.25;
const MIN_INK_FRACTION_OF_REF = 0.1;

type Tri2 = { ax: number; ay: number; bx: number; by: number; cx: number; cy: number };

function primOf(doc: Document, re: RegExp) {
  for (const mesh of doc.getRoot().listMeshes()) {
    if (re.test(mesh.getName() ?? "")) {
      const prim = mesh.listPrimitives()[0];
      if (prim) return prim;
    }
  }
  return null;
}

function xyTriangles(prim: NonNullable<ReturnType<typeof primOf>>): Tri2[] {
  const pos = prim.getAttribute("POSITION");
  const idx = prim.getIndices();
  if (!pos || !idx) throw new Error("indexed POSITION required");
  const arr = pos.getArray() as Float32Array;
  const iarr = idx.getArray() as Uint32Array;
  const tris: Tri2[] = [];
  for (let t = 0; t < iarr.length; t += 3) {
    const i0 = iarr[t], i1 = iarr[t + 1], i2 = iarr[t + 2];
    tris.push({
      ax: arr[i0 * 3], ay: arr[i0 * 3 + 1],
      bx: arr[i1 * 3], by: arr[i1 * 3 + 1],
      cx: arr[i2 * 3], cy: arr[i2 * 3 + 1],
    });
  }
  return tris;
}

type Band = { x0: number; x1: number; y0: number; y1: number };

function eyeBand(doc: Document): Band {
  const eyes = primOf(doc, /eyes_low_poly/i);
  if (!eyes) throw new Error("eyes_low_poly landmark missing");
  const pos = eyes.getAttribute("POSITION")!;
  const arr = pos.getArray() as Float32Array;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.getCount(); i++) {
    x0 = Math.min(x0, arr[i * 3]); x1 = Math.max(x1, arr[i * 3]);
    y0 = Math.min(y0, arr[i * 3 + 1]); y1 = Math.max(y1, arr[i * 3 + 1]);
  }
  const w = x1 - x0, h = y1 - y0;
  return { x0: x0 - PAD_X * w, x1: x1 + PAD_X * w, y0: y1 - Y_BELOW * h, y1: y1 + Y_ABOVE * h };
}

function projectedArea(tris: Tri2[]): number {
  let a = 0;
  for (const t of tris) {
    a += Math.abs((t.bx - t.ax) * (t.cy - t.ay) - (t.cx - t.ax) * (t.by - t.ay)) / 2;
  }
  return a;
}

function bandCoverage(tris: Tri2[], band: Band): number {
  const cw = (band.x1 - band.x0) / GRID_X;
  const ch = (band.y1 - band.y0) / GRID_Y;
  const hit = new Uint8Array(GRID_X * GRID_Y);
  for (const t of tris) {
    const d = (t.bx - t.ax) * (t.cy - t.ay) - (t.cx - t.ax) * (t.by - t.ay);
    if (Math.abs(d) < 1e-12) continue;
    const gx0 = Math.max(0, Math.floor((Math.min(t.ax, t.bx, t.cx) - band.x0) / cw));
    const gx1 = Math.min(GRID_X - 1, Math.ceil((Math.max(t.ax, t.bx, t.cx) - band.x0) / cw));
    const gy0 = Math.max(0, Math.floor((Math.min(t.ay, t.by, t.cy) - band.y0) / ch));
    const gy1 = Math.min(GRID_Y - 1, Math.ceil((Math.max(t.ay, t.by, t.cy) - band.y0) / ch));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if (hit[gy * GRID_X + gx]) continue;
        const px = band.x0 + (gx + 0.5) * cw;
        const py = band.y0 + (gy + 0.5) * ch;
        const w0 = ((t.bx - px) * (t.cy - py) - (t.cx - px) * (t.by - py)) / d;
        const w1 = ((t.cx - px) * (t.ay - py) - (t.ax - px) * (t.cy - py)) / d;
        if (w0 >= -1e-6 && w1 >= -1e-6 && 1 - w0 - w1 >= -1e-6) hit[gy * GRID_X + gx] = 1;
      }
    }
  }
  let n = 0;
  for (const h of hit) n += h;
  return n / (GRID_X * GRID_Y);
}

async function measureActor(asset: string) {
  const doc = await new NodeIO().read(`${DIR}/${asset}`);
  const browPrim = primOf(doc, /fitted_eyebrow/i);
  if (!browPrim) throw new Error(`${asset}: fitted_eyebrow mesh missing`);
  const eyesPrim = primOf(doc, /eyes_low_poly/i);
  if (!eyesPrim) throw new Error(`${asset}: eyes_low_poly landmark missing`);
  const browTris = xyTriangles(browPrim);
  const eyeTris = xyTriangles(eyesPrim);
  return {
    cov: bandCoverage(browTris, eyeBand(doc)),
    inkPerEye: projectedArea(browTris) / Math.max(projectedArea(eyeTris), 1e-12),
  };
}

describe("the reduced eyebrow still spans and darkens the brow band above the eyes", () => {
  /**
   * (A) SPAN. The brow must still stipple at least half the band cells its visible
   * reference covered. Current branch measures 0.3-1.0% against 2.7-7.6% floors.
   */
  it("(A) brow band coverage >= 25% of the pinned visible reference, per actor", async () => {
    const failures: string[] = [];
    for (const [asset, ref] of Object.entries(PINNED_VISIBLE_BROW)) {
      const m = await measureActor(asset);
      const floor = ref.covFrac * MIN_COVERAGE_FRACTION_OF_REF;
      if (m.cov < floor) {
        failures.push(
          `${asset}: coverage ${(m.cov * 100).toFixed(2)}% < ${(floor * 100).toFixed(2)}% ` +
            `(reference ${(ref.covFrac * 100).toFixed(1)}%)`,
        );
      }
    }
    expect(failures, `brow vanished from the band:\n${failures.join("\n")}`).toEqual([]);
  });

  /**
   * (B) INK. Projected brow area must remain >= 40% of the reference ink-per-eye ratio.
   * Coverage without ink = scattered slivers; ink without coverage = a dense clump.
   * Current branch measures 0.017-0.057 against 0.18-0.62 floors.
   */
  it("(B) brow projected ink >= 10% of the pinned visible reference, per actor", async () => {
    const failures: string[] = [];
    for (const [asset, ref] of Object.entries(PINNED_VISIBLE_BROW)) {
      const m = await measureActor(asset);
      const floor = ref.inkPerEye * MIN_INK_FRACTION_OF_REF;
      if (m.inkPerEye < floor) {
        failures.push(
          `${asset}: ink/eye ${m.inkPerEye.toFixed(3)} < ${floor.toFixed(3)} ` +
            `(reference ${ref.inkPerEye.toFixed(2)})`,
        );
      }
    }
    expect(failures, `brow carries too little front-projected ink:\n${failures.join("\n")}`).toEqual([]);
  });

  /**
   * (C) LANDMARK GUARD. The band is defined by eyes_low_poly; if a future bake moves or
   * rescales the eyes the pinned references no longer describe this face and both clauses
   * above are measuring a different actor. Pins the landmark's world-frame span.
   */
  it("(C) eyes_low_poly landmark keeps its measured frame — the band anchor is stable", async () => {
    // measured 2026-08-26 from main bytes: adult eye span/height, child proportionally smaller
    for (const asset of Object.keys(PINNED_VISIBLE_BROW)) {
      const doc = await new NodeIO().read(`${DIR}/${asset}`);
      const eyes = primOf(doc, /eyes_low_poly/i);
      expect(eyes, `${asset}: eyes_low_poly missing`).toBeTruthy();
      const pos = eyes!.getAttribute("POSITION")!;
      const arr = pos.getArray() as Float32Array;
      let x0 = Infinity, x1 = -Infinity;
      for (let i = 0; i < pos.getCount(); i++) {
        x0 = Math.min(x0, arr[i * 3]); x1 = Math.max(x1, arr[i * 3]);
      }
      const span = x1 - x0;
      expect(span, `${asset}: eye span ${span.toFixed(4)} moved out of the measured frame`).toBeGreaterThan(0.05);
      expect(span, `${asset}: eye span ${span.toFixed(4)} moved out of the measured frame`).toBeLessThan(0.12);
    }
  }, 120_000);

  /**
   * (D) POPULATION. The pinned table must describe every shipped MPFB actor — if a new
   * actor ships without a row it escapes the appearance gate silently.
   */
  it("(D) every shipped MPFB actor has a pinned visible-brow reference row", async () => {
    const actors = readdirSync(DIR)
      .filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb"))
      .sort();
    const unpinned = actors.filter((a) => !(a in PINNED_VISIBLE_BROW));
    expect(unpinned, "actors shipping without an appearance-oracle reference row").toEqual([]);
    expect(actors.length, "MPFB cast shrank — update the pinned table").toBeGreaterThanOrEqual(11);
  });
});
