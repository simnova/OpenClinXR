import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Round 9 closed the waistband gap — the distance between the top of the lower body-hide mask and the
 * top of the trousers — to 1.1 mm on aisha. **It has held ever since.** This file gates that result.
 *
 * MEASURED 2026-08-12 on the shipped GLBs:
 *
 *   actor            pants top   mask top (MAX)   gap        shirt overlap
 *   ---------------- ---------   --------------   --------   -------------
 *   aisha            0.9871      0.9860           +1.1 mm    19.6 mm
 *   nurse_kevin      1.0581      1.0597           -1.6 mm    17.8 mm
 *   patient_child    0.7199      0.7215           -1.6 mm    13.4 mm
 *
 * Negative is over-reach: the mask ends slightly above the rim, which is correct and is bounded by
 * clause (2). Front-of-belly overlap (|x|<0.12, z>0.06) measures 16.0 / 17.8 / 11.3 mm, so the
 * garments meet at the belly and not merely at their bounding boxes.
 *
 * ## THIS FILE FIRST SHIPPED ASSERTING A DEFECT THAT DID NOT EXIST. That is the reason it exists.
 *
 * The original planted RED reported gaps of 55.6 / 34.3 / 23.9 mm and a "fifty-fold regression since
 * round 9". **All of it was wrong**, and the cause was one line:
 *
 *     const lowerMask = bands.find((b) => b.hidden && /hidden_lower/.test(b.name));
 *
 * Every actor ships **two** `hidden_lower` primitives — a base poke-mask, and a `.001` carrying round
 * 9's `RENDER_TRUTH_REHIDE` band. Only the second reaches the rim. `find` returns the first. The base
 * mask genuinely does stop 24–56 mm short, so the number was real and measured; it was measured on the
 * wrong object.
 *
 * A full slice was dispatched against that phantom. The worker's own pre-fix measurement found the
 * second primitive, it reported the premise dead, it changed no product code, and it emitted grade
 * captures of the unchanged bytes so the pixels could still be judged (#341 round 17, `44d0649c`).
 * The dead-premise clause in its brief is what made that a reportable success rather than a slice
 * spent satisfying a contract nobody should have written.
 *
 * **Two lessons, both about the ORCHESTRATOR's instruments, not the product:**
 *
 * 1. **Never `find` where the schema permits N.** A first-match read of a repeated primitive is
 *    indistinguishable from a correct read until something else contradicts it. Use max/min over all
 *    matches, as this file now does, or assert the count.
 * 2. **A pixel grade names what you SEE, never what it IS.** The hypothesis began with my describing a
 *    *tan* sawtooth at the waistband. Sampling the pixels shows blue(shirt) → grey(pants) with no skin
 *    row at the belly on either adult. What is actually there is a jagged DARK hem edge. The word
 *    "tan" smuggled in "exposed skin", and the whole chain followed from that one adjective.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **none of these is a RED — all three pass today** and are
 * regression nets. Round 9's result was previously ungated, recorded only in a commit message; that
 * part of the original reasoning was sound and is what survives here.
 *
 * THE CHEAP FIXES THESE REFUSE, probed 2026-08-12 against the (then-believed) defect and still valid
 * as counterweights:
 *
 *   b) extend the mask by one blanket epsilon  -> clause (2) fails: a constant sized for the worst
 *      actor over-reaches 23.7 mm on the child
 *   c) drop the trouser rim to meet the mask   -> clause (3) fails on 3/3: overlap destroyed
 *
 * NOT TESTED: the waistband only — not the shoulder or hem seams, not whether any exposed band would
 * be visible at learner distance, and not the per-polygon shape of the hem. A gap correct on this
 * metric can still read ragged, and on these three actors it does: see #350 (22–24 orphan 4-vertex
 * skin islands per actor at the sleeve rim, boot top and waistband), which is the current best
 * explanation for the jagged edges and is measured, not graded.
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

  // MAX over ALL matching primitives, never `find`. Each actor ships TWO `hidden_lower`
  // primitives — a base poke-mask and a `.001` carrying round 9's RENDER_TRUTH_REHIDE band —
  // and only the second reaches the rim. `find` returns the first and reports a 24-56 mm
  // phantom gap. See the header.
  const topOf = (re: RegExp): number =>
    bands.filter((b) => !b.hidden && re.test(b.name)).reduce((m, b) => Math.max(m, b.hi), -Infinity);
  const botOf = (re: RegExp): number =>
    bands.filter((b) => !b.hidden && re.test(b.name)).reduce((m, b) => Math.min(m, b.lo), Infinity);
  const pantsTop = topOf(/cargo_pants/);
  // #180: the nurse's upper is now the scrub shirt — include it so the overlap clause
  // keeps measuring the nurse. #199 (2026-08-14) replaced the scrub with the CC0
  // fisherman sweater — include it too, or the nurse's row returns null and the
  // vacuity guard fails while the product is fine.
  const shirtBot = botOf(/t_shirt|scrub|sweater/);
  const lowerMaskTop = bands
    .filter((b) => b.hidden && /hidden_lower/.test(b.name))
    .reduce((m, b) => Math.max(m, b.hi), -Infinity);
  if (!Number.isFinite(pantsTop) || !Number.isFinite(shirtBot) || !Number.isFinite(lowerMaskTop))
    return null;

  return {
    file: rel.split("/").pop()!,
    gapMm: (pantsTop - lowerMaskTop) * 1000,
    overreachMm: (lowerMaskTop - pantsTop) * 1000,
    overlapMm: (pantsTop - shirtBot) * 1000,
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
  it("(1) NET: no skin band between the mask edge and the trouser rim", () => {
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
