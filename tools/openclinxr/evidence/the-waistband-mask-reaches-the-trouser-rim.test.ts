import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * #341 round 9 closed the waistband gap — the distance between the top of the lower body-hide mask
 * and the top of the trousers — to **1.1 mm on aisha**, using a per-polygon re-hide bounded by the
 * garment's own `CLOTH_STANDOFF_M` rather than a fitted constant. That was measured and recorded.
 *
 * MEASURED AGAIN 2026-08-12, six rounds later, on the shipped GLBs:
 *
 *   actor            pants top   lower mask top   GAP        shirt overlap
 *   ---------------- ---------   --------------   --------   -------------
 *   aisha            0.5920      0.5586           55.6 mm    19.6 mm
 *   nurse_kevin      0.6012      0.5817           34.3 mm    17.8 mm
 *   patient_child    0.5801      0.5609           23.9 mm    13.4 mm
 *
 * **Aisha regressed from 1.1 mm to 55.6 mm — fifty times worse — and nothing caught it.**
 *
 * WHY IT WENT UNNOTICED, recorded because the process failure matters more than the number: round 9's
 * result lived only in a commit message and an orchestrator report. Every later brief listed "round-9
 * seam gaps" among the known-good columns for the worker to *report*, and asking a delegate to report
 * a number is not the same as a gate that fails when it moves. Rounds 10–16 each re-baked or re-fitted
 * the body; round 15 removed a double-deformation that changed the body every mask fits to, and its
 * own commit said "the true-body fit flips the gate". The lower cover shell was restored for exactly
 * that reason. The hide mask was not re-derived to match, and no proof existed to say so.
 *
 * The visible consequence is the tan sawtooth at every actor's waistband, which sat in three of my
 * own pixel grades while I described it without connecting it to the metric I already had.
 *
 * NOT a coverage hole between garments: shirt-to-trouser overlap is 13.4–19.6 mm on all three, so no
 * skin shows *between* the garments. The exposed band is between the MASK EDGE and the trouser rim —
 * skin the trousers cover but the mask stopped hiding.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                  | (1) gap closed | (2) mask not over-reaching | (3) overlap kept | result
 *   -------------------------------------------|----------------|----------------------------|------------------|--------
 *   a) today                                   |   **FAIL**     |          pass              |      pass        | REFUSED
 *   b) extend the mask by a fixed epsilon      |     pass       |        **FAIL**            |      pass        | REFUSED
 *   c) drop the trouser rim to meet the mask   |     pass       |          pass              |    **FAIL**      | REFUSED
 *   d) re-derive the mask from the garment rim |     pass       |          pass              |      pass        | ALL PASS
 *
 * (b) is the fix round 9 was explicitly forbidden and did not take: a constant tuned to today's three
 * actors is a threshold fitted to an observation, and it re-breaks the moment a fourth body ships.
 * Clause (2) bounds the mask ABOVE the rim so a blanket extension overshoots into the shirt band.
 * (c) trades the defect for a coverage hole; clause (3) pins the 13.4 mm minimum overlap.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails on all three. (2) and (3) PASS
 * today and are regression nets — the mask does not currently over-reach, and the garments do meet.
 *
 * NOT TESTED: this asserts the WAISTBAND band only. It says nothing about the shoulder or hem seams
 * (round 9 measured those too and they are not covered here), nothing about whether the exposed band
 * is visible at a given camera distance, and nothing about the sawtooth's per-polygon shape — a gap
 * closed on this metric can still read ragged, which is the §11s trap this issue has hit three times.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** Round 9 achieved 1.1 mm on aisha with a rim-derived rule. Ambient today is 23.9–55.6 mm. */
const MAX_WAISTBAND_GAP_MM = 8;

/** The mask must not extend ABOVE the trouser rim — that is a blanket extension, not a fit. */
const MAX_MASK_OVERREACH_MM = 6;

/** Shirt-to-trouser overlap today is 13.4–19.6 mm; a fix must not buy the gap by dropping the rim. */
const MIN_GARMENT_OVERLAP_MM = 8;

type Row = { file: string; gapMm: number; overreachMm: number; overlapMm: number };

const io = new NodeIO();

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));

  let lo = Infinity;
  let hi = -Infinity;
  type Band = { name: string; hidden: boolean; lo: number; hi: number };
  const bands: Band[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const hidden = mat?.getAlphaMode() === "MASK" && (mat?.getBaseColorFactor()?.[3] ?? 1) === 0;
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      let a = Infinity;
      let b = -Infinity;
      for (let i = 0; i < pos.getCount(); i++) {
        const y = (pos.getElement(i, [0, 0, 0]) as number[])[1]!;
        if (y < a) a = y;
        if (y > b) b = y;
      }
      bands.push({ name: `${mesh.getName()}/${mat?.getName() ?? "?"}`, hidden, lo: a, hi: b });
      if (!hidden) {
        if (a < lo) lo = a;
        if (b > hi) hi = b;
      }
    }
  }

  const pants = bands.find((b) => !b.hidden && /cargo_pants/.test(b.name));
  const shirt = bands.find((b) => !b.hidden && /t_shirt/.test(b.name));
  const lowerMask = bands.find((b) => b.hidden && /hidden_lower/.test(b.name));
  if (!pants || !shirt || !lowerMask) return null;

  return {
    file: rel.split("/").pop()!,
    gapMm: (pants.hi - lowerMask.hi) * 1000,
    overreachMm: (lowerMask.hi - pants.hi) * 1000,
    overlapMm: (pants.hi - shirt.lo) * 1000,
  };
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `MPFB bodies with a measurable waistband (scanned ${files.length})`)
    .toBeGreaterThanOrEqual(3);
}

const show = (r: Row): string =>
  `${r.file}: gap=${r.gapMm.toFixed(1)}mm overlap=${r.overlapMm.toFixed(1)}mm`;

describe("the lower hide mask reaches the trouser rim", () => {
  it.fails("(1) RED: no skin band between the mask edge and the trouser rim", () => {
    requireRows();
    expect(
      rows.filter((r) => r.gapMm > MAX_WAISTBAND_GAP_MM).map(show),
      `waistband gaps wider than ${MAX_WAISTBAND_GAP_MM} mm`,
    ).toEqual([]);
  });

  it("(2) NET known-good: the mask does not over-reach above the rim", () => {
    // Refuses a blanket epsilon: extending the mask past the trousers eats into the shirt band.
    requireRows();
    const over = rows.filter((r) => r.overreachMm > MAX_MASK_OVERREACH_MM).map(show);
    expect(over, `masks reaching more than ${MAX_MASK_OVERREACH_MM} mm above the trouser rim`).toEqual([]);
  });

  it("(3) NET known-good: the garments still overlap", () => {
    // Refuses buying the gap by dropping the trouser rim to meet the mask.
    requireRows();
    const gapped = rows.filter((r) => r.overlapMm < MIN_GARMENT_OVERLAP_MM).map(show);
    expect(gapped, `shirt/trouser overlap below ${MIN_GARMENT_OVERLAP_MM} mm`).toEqual([]);
  });
});
