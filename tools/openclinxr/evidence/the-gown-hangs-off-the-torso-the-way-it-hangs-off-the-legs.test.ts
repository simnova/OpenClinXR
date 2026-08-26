import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";

/**
 * OBSERVABLE: the hospital gown stands off the torso, not only off the legs.
 *
 * ## MEASURED 2026-08-26 ON `ca2d5d79` — do not re-derive
 *
 * I graded `mpfb-gown-adult-patient.glb` front-lit at native resolution after #684 delivered the
 * gown. Below the hip it drapes: folds, a slit, fabric standing away from the legs. Above the waist
 * it does not — breasts and navel model through the fabric, so the bodice reads as paint on the
 * body rather than a sheet hanging from the shoulders.
 *
 * The geometry agrees. Median clearance from each gown vertex to the NEAREST body vertex within a
 * +/-1 cm Y slab (so a hem is never compared against a shoulder), on the shipped asset:
 *
 *     band                        n     median clearance
 *     bodice  0.62-0.82 of height 587       27.7 mm
 *     waist   0.52-0.62           120       27.1 mm
 *     skirt   0.34-0.50           269       77.6 mm     <- KNOWN-GOOD, same mesh, same bake
 *
 * The skirt stands off 2.8x further than the bodice, and both come from one 6654-triangle mesh.
 *
 * ## THIS PREDATES #684 AND IS NOT A REGRESSION FROM IT
 *
 * `openclinxr_real_garment_hospital_gown_phenotype_L0` came from `mpfb-gown-inspect.glb`, which has
 * carried this geometry throughout. #684 delivered an existing garment; it did not author this.
 *
 * ## A FAILED INSTRUMENT, recorded so nobody rebuilds it
 *
 * My first probe compared p90 RADIUS from a torso centreline per band. It reported a body radius of
 * 466-563 mm across the torso, which is not a human. The bands include the ARMS, and a lateral
 * radius from a centreline cannot tell an arm from a chest. Same contamination class as #103, where
 * a band averaged leg vertices with an arm. Nearest-neighbour-within-a-Y-slab has no centreline and
 * is not vulnerable to it. Do not reach for a radius here.
 *
 * ## THE THRESHOLD IS A JUDGEMENT ANCHORED TO THE SKIRT, AND IT IS NOT A MEASUREMENT
 *
 * Clause (1) asks the bodice to reach HALF the skirt's median clearance. The skirt is the right
 * anchor: same mesh, same bake, already draping, and independent of whatever fixes the bodice.
 * Half rather than parity because fabric IS supported at the shoulders and genuinely lies closer
 * there, so parity would be anatomically wrong.
 *
 * Half is my judgement. Measured today the ratio is 0.36 against a 0.50 line, so the margin is
 * 0.14 and the number was chosen before the fix rather than after it. IF AN IMPLEMENTER CAN SHOW
 * 0.50 IS ANATOMICALLY WRONG FOR A GOWN, SAY SO AND REPORT THE RIGHT FIGURE WITH ITS SOURCE
 * rather than tuning geometry to clear a line I invented.
 *
 * claimScope: whether the gown's bodice stands off the torso at a fraction of how far its own skirt
 *   stands off the legs.
 * notEvidenceFor: whether the bodice LOOKS like cloth (that is the orchestrator's grade); whether
 *   any other garment has the same defect; whether the collar notch artifact shares a cause.
 */

const DIR = "apps/ui-xr/public/generated-humanoids";
const ASSET = "mpfb-gown-adult-patient.glb";

/** Only vertices whose material is the delivered gown shell. */
const GOWN = /hospital_gown/;
/** Body surface: the skin plus the hidden torso/leg regions the gown covers. */
const BODY = /mpfb_skin|hidden_(upper|lower)/;

/** Half-height of the Y slab a garment vertex is compared within. */
const SLAB_METRES = 0.01;
/** Every third vertex, so the O(n*m) scan stays under a second. Deterministic, not random. */
const STRIDE = 3;

/**
 * Bands as a fraction of body height, from the shipped asset's own body bounds.
 * bodice = chest and abdomen; skirt = the known-good draping region below the hip.
 */
const BODICE: readonly [number, number] = [0.62, 0.82];
const SKIRT: readonly [number, number] = [0.34, 0.5];

/** bodiceMedianClearance / skirtMedianClearance must reach this. See the header on provenance. */
const MIN_BODICE_FRACTION_OF_SKIRT = 0.5;

type Vertex = readonly [number, number, number];

async function loadVertices(): Promise<{ gown: Vertex[]; body: Vertex[] }> {
  const doc = await new NodeIO().read(`${DIR}/${ASSET}`);
  const gown: Vertex[] = [];
  const body: Vertex[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const isGown = GOWN.test(name);
      const isBody = !isGown && BODY.test(name);
      if (!isGown && !isBody) continue;
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        (isGown ? gown : body).push([v[0]!, v[1]!, v[2]!]);
      }
    }
  }
  return { gown, body };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : Number.NaN;
}

/**
 * Median horizontal distance from each gown vertex in the band to its nearest body vertex within
 * SLAB_METRES in Y. Aggregation is per-band median over gown vertices.
 */
function medianClearanceMm(
  gown: Vertex[], body: Vertex[], floorY: number, height: number, band: readonly [number, number],
): { n: number; medianMm: number } {
  const inBand = (p: Vertex) => {
    const f = (p[1] - floorY) / height;
    return f >= band[0] && f < band[1];
  };
  const g = gown.filter((_, i) => i % STRIDE === 0).filter(inBand);
  const b = body.filter((_, i) => i % STRIDE === 0);
  const distances: number[] = [];
  for (const p of g) {
    let best = Number.POSITIVE_INFINITY;
    for (const q of b) {
      if (Math.abs(q[1] - p[1]) > SLAB_METRES) continue;
      const d = Math.hypot(q[0] - p[0], q[2] - p[2]);
      if (d < best) best = d;
    }
    if (Number.isFinite(best)) distances.push(best);
  }
  return { n: distances.length, medianMm: median(distances) * 1000 };
}

async function measure() {
  const { gown, body } = await loadVertices();
  const ys = body.map((p) => p[1]);
  const floorY = Math.min(...ys);
  const height = Math.max(...ys) - floorY;
  return {
    height,
    bodice: medianClearanceMm(gown, body, floorY, height, BODICE),
    skirt: medianClearanceMm(gown, body, floorY, height, SKIRT),
  };
}

describe("the gown hangs off the torso the way it hangs off the legs (#686)", () => {
  it.fails("(1) the bodice stands off the torso at least half as far as the skirt stands off the legs", async () => {
    const m = await measure();
    const fraction = m.bodice.medianMm / m.skirt.medianMm;
    expect(
      Number(fraction.toFixed(3)),
      `bodice median clearance ${m.bodice.medianMm.toFixed(1)} mm (n=${m.bodice.n}) against skirt `
        + `${m.skirt.medianMm.toFixed(1)} mm (n=${m.skirt.n}) on the same 6654-triangle mesh — `
        + `ratio ${fraction.toFixed(3)}. The skirt is the known-good drape and the bodice is `
        + "shrink-wrapped, so anatomy reads through the fabric above the waist. Lift the bodice off "
        + "the torso; do not hide body regions under it (#73 refused a deletion with no replacement).",
    ).toBeGreaterThanOrEqual(MIN_BODICE_FRACTION_OF_SKIRT);
  }, 120_000);

  it("(2) COUNTERWEIGHT: the skirt still drapes, so the ratio is not cleared by flattening it", async () => {
    // The cheapest way to clear clause (1) is to make the DENOMINATOR smaller — pull the skirt in
    // against the legs and the ratio rises without the bodice moving at all. The floor is the
    // skirt's own measured clearance today (77.6 mm) less a 20% tolerance for a re-bake that
    // legitimately reshapes the hem, so a collapse of the drape fails here.
    const m = await measure();
    expect(
      Number(m.skirt.medianMm.toFixed(1)),
      `skirt median clearance fell to ${m.skirt.medianMm.toFixed(1)} mm from the 77.6 mm measured on `
        + "ca2d5d79. Clause (1) compares the bodice AGAINST the skirt, so tightening the skirt "
        + "raises the ratio while making the garment worse. Widening or deleting this clause is wrong.",
    ).toBeGreaterThanOrEqual(62);
  }, 120_000);

  it("(3) COUNTERWEIGHT: the gown still spans hip to shoulder", async () => {
    // Refuses the second cheapest fix: shorten or narrow the gown until the bodice band holds few
    // enough vertices to move the median. #684's landed contract asserts one garment mesh from
    // <= 0.40 to >= 0.80 of body height; this pins the population clause (1) measures over, so the
    // bodice band cannot be emptied. The floor is the count measured on ca2d5d79 less 20%.
    const m = await measure();
    expect(
      m.bodice.n,
      `only ${m.bodice.n} gown vertices remain in the bodice band; 587 were measured on ca2d5d79. `
        + "Clause (1) is a median over this population and emptying it is not a fix.",
    ).toBeGreaterThanOrEqual(470);
  }, 120_000);
});
