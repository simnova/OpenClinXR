import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { extractLandmarks } from "./anny-mpfb-landmark-compare.ts";

/**
 * The landmark instrument's girths are NOT translation-invariant. Moving a mesh vertically — which
 * changes no distance between any two points on it — silently changes or destroys every girth.
 *
 * MEASURED 2026-08-11 on the tracked reference `adult_male_street_casual.anny_base.obj`, translating
 * only in Y. Nothing else differs; the geometry is byte-identical up to a rigid shift.
 *
 *   dy      | shoulder | waist    | hip
 *   --------|----------|----------|--------
 *    0      |  0.55082 |  0.73472 |  0.92623   <- truth
 *   -0.01   |  0.55082 |  0.73472 |  0.92623
 *   +0.01   |  0.55082 |  0.73472 |  0.92623
 *   -0.85   |  0.00000 |  0.00000 |  0.00000   <- silent zeros
 *   +0.85   |  0.00000 |  0.30755 |  0.49301   <- WORSE: plausible, wrong numbers
 *   +5.00   |  0.00000 |  0.00000 |  0.00000
 *
 * A rigid translation cannot change a circumference. This is a mathematical invariant, not a
 * convention, so no reading above is defensible as "a different definition".
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. The failure is SILENT and SELECTIVE: stature stays exactly
 * correct (1.7600) through every one of these shifts, so the artifact reads as a successful
 * measurement. It cost three separate dead ends in one session — the instrument returned 0.0000 on
 * MPFB probe meshes and the zeros were variously blamed on helper geometry and on unwelded vertices
 * before the actual cause (a pelvis-centred mesh at minY = -0.8557) was found. A refusal would have
 * cost minutes; a zero cost hours.
 *
 * **The `+0.85` row is the dangerous one.** It does not fail closed. A waist of 0.30755 against a true
 * 0.73472 is a number a reader would accept, and it would flow into a comparison table as fact.
 *
 * CAUSE, located: band lookups are computed against ABSOLUTE Y rather than against the mesh's own
 * bounding box. `buildBandProfile` / `BAND_WINDOWS` select vertices by height fraction, and the
 * fraction is taken from raw coordinates, so a body whose feet are not at y=0 has its bands land off
 * the body entirely (all zeros) or on the wrong slices (plausible-wrong).
 *
 * THE CHEAP FIX THIS CONTRACT REFUSES: grounding only when the mesh sits below zero
 * (`if (minY < 0) y -= minY`). That fixes the `-0.85` row and leaves `+0.85` exactly as broken.
 * Contract (2) exists solely to kill it. The correct fix derives bands from `(y - minY) / height`,
 * which is invariant by construction.
 *
 * WHAT I CHECKED AND DID NOT FIND: I looked for a lateral counterweight and there is none — `dx=+0.50`
 * and `dz=+0.50` both leave every girth unchanged, so the instrument is ALREADY invariant on X and Z.
 * Reporting that rather than dressing up a weaker assertion as a second axis.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today. (3) and (4) pass today
 * and are regression nets — the identity values must not move, and small offsets must keep working.
 *
 * NOT TESTED: helper geometry, which is a SEPARATE silent-wrongness defect measured the same day — a
 * raw MPFB base (19,158 verts, helpers included) reports shoulder 0.5578 against the stripped body's
 * 0.6159, because the MakeHuman clothes-helper shell swallows the deltoid band. Helpers strip cleanly
 * at vertex 13,380 (19,158 -> 13,380 verts, 36,972 -> 26,756 faces, byte-matching the shipped library
 * GLBs). That needs the MPFB extension installed to fixture honestly and is deliberately left out
 * rather than faked with a synthetic shell (§6x). Also untested: rotation invariance.
 *
 * ## FIXED (#300)
 *
 * `buildBandProfile` now derives every band fraction from the mesh's own bounding box —
 * `frac = (y - ymin) / stature` — instead of absolute Y. A rigid translation changes neither
 * `(y - ymin)` nor `stature`, so every band window (waist [0.61, 0.65], hipFrom 0.44, neck,
 * ankle, elbow, the shoulder band, and the `frac >= 0.5` arm-cluster gate) is invariant by
 * construction. The planted header's rows were re-measured against the same tracked reference:
 *
 *   dy      | shoulder | waist    | hip
 *   --------|----------|----------|--------
 *    0      |  0.55082 |  0.73472 |  0.92623   <- unchanged (net 3)
 *   -0.85   |  0.55082 |  0.73472 |  0.92623   <- was all zeros
 *   +0.85   |  0.55082 |  0.73472 |  0.92623   <- was waist 0.30755 / hip 0.49301
 *   +5.00   |  0.55082 |  0.73472 |  0.92623   <- was all zeros
 *
 * The reference OBJ sits at minY = 0, so the normalized fraction is byte-identical to the old
 * `y / stature` at dy = 0 — nets (3) and (4) hold by construction, and the destructive-probe
 * "ground only when minY < 0" is refused because contract (2) now passes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const REFERENCE = `${REPO_ROOT}/apps/ui-xr/public/generated-humanoids/adult_male_street_casual.anny_base.obj`;

/** Measured at dy=0 on the tracked reference. A fix must not move these. */
const TRUTH = { shoulder: 0.550818, waist: 0.7347184027241769, hip: 0.9262306371034248 };
const TOL = 1e-6;

const source = readFileSync(REFERENCE, "utf8");

function shiftY(dy: number): string {
  if (dy === 0) return source;
  return source
    .split("\n")
    .map((line: string) => {
      if (!line.startsWith("v ")) return line;
      const a = line.split(/\s+/);
      return `v ${a[1]} ${(parseFloat(a[2]!) + dy).toFixed(6)} ${a[3]}`;
    })
    .join("\n");
}

function girths(dy: number): { shoulder: number; waist: number; hip: number } {
  const L = extractLandmarks("adult_male_street_casual", shiftY(dy)) as unknown as Record<string, number>;
  return { shoulder: L["shoulderSpanMeters"]!, waist: L["waistGirthMeters"]!, hip: L["hipGirthMeters"]! };
}

function expectMatchesTruth(dy: number): void {
  const g = girths(dy);
  expect(g.shoulder, `shoulder at dy=${dy}`).toBeCloseTo(TRUTH.shoulder, 5);
  expect(g.waist, `waist at dy=${dy}`).toBeCloseTo(TRUTH.waist, 5);
  expect(g.hip, `hip at dy=${dy}`).toBeCloseTo(TRUTH.hip, 5);
}

describe("landmark girths are invariant under rigid vertical translation", () => {
  it("(1) RED: shifting the mesh DOWN by 0.85 m must not change any girth (today: all zeros)", () => {
    expectMatchesTruth(-0.85);
  });

  it(
    "(2) RED COUNTERWEIGHT: shifting UP by 0.85 m must not change any girth — grounding only when minY<0 does not satisfy this (today: waist 0.30755 vs 0.73472, plausible and wrong)",
    () => {
      expectMatchesTruth(0.85);
    },
  );

  it("(3) NET: the untranslated reference still measures exactly what it measures today", () => {
    const g = girths(0);
    expect(g.shoulder).toBeCloseTo(TRUTH.shoulder, 6);
    expect(g.waist).toBeCloseTo(TRUTH.waist, 6);
    expect(g.hip).toBeCloseTo(TRUTH.hip, 6);
    expect(Math.abs(g.waist - TRUTH.waist)).toBeLessThan(TOL);
  });

  it("(4) NET: small offsets keep working — a fix must not regress the tolerated range", () => {
    for (const dy of [-0.01, 0.01]) expectMatchesTruth(dy);
  });
});
