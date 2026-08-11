import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Two causes, one functional area — the MPFB2 patient's wardrobe — each with its own non-vacuous proof
 * (§8i). Bundled because the second is unavoidable while doing the first: adding a lower garment means
 * extending the hide mask, and the mask's footprint is already wrong.
 *
 * CAUSE A — she is bare below the waist. Measured on the shipped GLBs:
 *
 *   rail          | upper                   | lower                   | masks
 *   --------------|-------------------------|-------------------------|---------------------------
 *   aisha (MPFB2) | toigo t-shirt   5,400   | **NONE**                | hidden_upper 1,605
 *   lean_female   | toigo t-shirt   4,968   | cargo_pants     8,565   | hidden_upper 4,716 + lower 724
 *
 * The library rail has both channels and both masks. The MPFB2 rail has upper only. `cortu_cargo_pants`
 * is **CC0**, `basemesh hm08`, **zero helper-vertex references** (max ref 13,351 < 13,380) and is already
 * fitted on both library bodies through `ClothesService`. This is not an acquisition — it is the same
 * garment, the same service, a third body (D1).
 *
 * CAUSE B — the hide mask over-reaches the garment it hides under. I graded #323's landing and found
 * black slivers at the shoulders, sleeve cuffs, collar and hem: discarded body faces the garment does
 * not actually cover, so the render shows through the body to the background. Measured:
 *
 *                | X                  | Y
 *   -------------|--------------------|-------------------
 *   garment      | [-0.310,  0.309]   | [0.969, 1.420]
 *   **mask**     | [-0.317,  0.317]   | [0.945, 1.430]
 *
 * **7 mm wider each side, 24 mm below the hem, 10 mm above the collar.** Hidden-but-uncovered body is a
 * hole. #323's contract could not see it and its NOT TESTED said so in advance: *"a mask can hide the
 * wrong faces, and no clause relates the hidden faces to the garment's footprint."* That is rule 11s —
 * bounding a QUANTITY while the defect lives in WHICH faces — and this contract is the shape 11s
 * prescribes: relate the mask to the garment rather than counting it.
 *
 * THERE IS NO KNOWN-GOOD COLUMN, AND FINDING THAT OUT IS WHY THIS CONTRACT LOOKS THE WAY IT DOES.
 * I planted clause (3) expecting the library rail to be the good column — it runs the same
 * `apply_body_hide_material_region` over two garment channels and its grade does not show obvious black
 * slivers. It FAILED on the first run. Measured worst over-reach per rail:
 *
 *   rail          | masks | worst over-reach
 *   --------------|-------|------------------
 *   aisha (MPFB2) |   1   | **23.7 mm**  (hidden_upper, Y min — below the hem)
 *   lean_female   |   2   | **11.7 mm**  (hidden_upper, Y max — above the collar)
 *   heavy_male    |   2   | **14.7 mm**  (hidden_upper, Y max)
 *
 * **The over-reach is in the shared code, not the MPFB2 wiring.** Every rail hides body beyond the
 * garment that is supposed to be covering it. The library rails get away with it visually because their
 * lower garment covers the region an over-reaching upper mask exposes; MPFB2 has no lower garment yet,
 * so the same defect renders as holes. Adding trousers to Aisha would HIDE this defect rather than fix
 * it — which is precisely why the two causes are bundled here (§8i) instead of shipping (1) alone.
 *
 * So clause (3) is a THIRD RED, not a net, and this contract has no good column. §9h: say so rather than
 * construct one. The absence is the finding — nothing in the tree currently keeps a hide mask inside the
 * cloth it hides under.
 *
 * WHERE THE THRESHOLD COMES FROM. **2 mm of slack per axis.** Not tuned to clear an observation: the
 * mask is built from a signed-clearance test at `HIDE_EPSILON_M = 5 mm` (`garment_coverage.body_hide_mask`),
 * so a hidden face may legitimately sit up to that epsilon outside the garment surface — but the mask
 * BOUNDS should still fall inside the garment bounds, because a face beyond the silhouette is not under
 * cloth at all. Two millimetres allows for float and fan-triangulation edge effects and refuses the
 * measured 7-24 mm over-reach by 3.5x to 12x.
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                          | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today                                           |FAIL |FAIL |FAIL |pass | REFUSED
 *   b) shrink the mask to nothing to satisfy (2)       |FAIL |pass |pass |**FAIL**| REFUSED
 *   c) grow the garment to swallow the mask            |FAIL |pass |pass |pass*| see below
 *   d) add trousers, leave the mask unbounded          |pass |**FAIL**|FAIL|pass | REFUSED
                                                       (this is the one that HIDES the defect)
 *   e) fit cargo_pants + clip the mask to the garment  |pass |pass |pass |pass | ALL PASS
 *
 * (b) is the degenerate escape — a mask of zero faces trivially sits inside any footprint — and (4)
 * refuses it by requiring the hidden fraction to stay in the band the library rail occupies. (c) would
 * satisfy the bounds check by inflating the garment, which is why (4) also pins the garment vertex
 * counts to what #321 and this slice fit rather than to "more".
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1), (2) and (3) are REDs and all fail today — no lower
 * garment on MPFB2, and every rail's mask over-reaches. Only (4) is a net: it passes on real values and
 * refuses hollowing the mask out or inflating the garments to satisfy the bounds check.
 *
 * NOT TESTED: nothing is rendered. Bounding-box containment is a necessary condition, not a sufficient
 * one — a mask can sit inside the garment's bounds and still hide a face the garment does not cover, and
 * this contract cannot see that. Per-face containment against the garment surface would, and is the
 * honest next instrument if the slivers survive. Fit quality, drape, hem and waistband raggedness are all
 * unasserted; the library rail's trouser waistband is separately measured at 92.4 mm span and unbounded
 * by anything. Whether a t-shirt and cargo trousers suit an OB triage patient is a P3 staging judgement.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PUBLIC = `${REPO_ROOT}/apps/ui-xr/public`;

const AISHA = "generated-humanoids/mpfb-ob-patient-aisha.glb";
const LIBRARY = "xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb";

const UPPER = /shirt|top|tshirt|toigo/i;
const LOWER = /pants|trouser|cargo/i;
const HIDDEN = /hidden/i;
/** Signed-clearance epsilon is 5 mm; 2 mm of bounds slack allows float + fan-triangulation edges. */
const MAX_OVERREACH_M = 0.002;

type Box = { min: [number, number, number]; max: [number, number, number]; verts: number };
type Rail = { id: string; upper: Box | null; lower: Box | null; masks: Box[]; body: number };

const io = new NodeIO();
const EMPTY = (): Box => ({ min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], verts: 0 });

function grow(b: Box, e: readonly number[]): void {
  for (let a = 0; a < 3; a += 1) {
    if (e[a]! < b.min[a]!) b.min[a] = e[a]!;
    if (e[a]! > b.max[a]!) b.max[a] = e[a]!;
  }
}

async function railOf(id: string, rel: string): Promise<Rail> {
  const doc = await io.read(`${PUBLIC}/${rel}`);
  let upper: Box | null = null;
  let lower: Box | null = null;
  const masks: Box[] = [];
  let body = 0;
  const el: [number, number, number] = [0, 0, 0];

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const name = prim.getMaterial()?.getName() ?? "";
      const box = EMPTY();
      for (let i = 0; i < pos.getCount(); i += 1) grow(box, pos.getElement(i, el));
      box.verts = pos.getCount();

      if (HIDDEN.test(name)) masks.push(box);
      else if (LOWER.test(name)) lower = box;
      else if (UPPER.test(name)) upper = box;
      else body += pos.getCount();
    }
  }
  return { id, upper, lower, masks, body };
}

const aisha = await railOf("mpfb2_aisha", AISHA);
const library = await railOf("library_lean_female", LIBRARY);

/** Largest over-reach of a mask beyond the union of the garment boxes, in metres. */
function overreach(rail: Rail): { worst: number; detail: string[] } {
  const garments = [rail.upper, rail.lower].filter((g): g is Box => g !== null);
  if (!garments.length || !rail.masks.length) return { worst: Infinity, detail: ["no garment or no mask"] };
  const gmin = [0, 1, 2].map((a) => Math.min(...garments.map((g) => g.min[a]!)));
  const gmax = [0, 1, 2].map((a) => Math.max(...garments.map((g) => g.max[a]!)));
  let worst = 0;
  const detail: string[] = [];
  for (const m of rail.masks) {
    for (let a = 0; a < 3; a += 1) {
      const under = gmin[a]! - m.min[a]!;
      const over = m.max[a]! - gmax[a]!;
      for (const [label, v] of [["min", under], ["max", over]] as const) {
        if (v > worst) worst = v;
        if (v > MAX_OVERREACH_M) {
          detail.push(`axis${a} ${label}: mask exceeds garment by ${(v * 1000).toFixed(1)}mm`);
        }
      }
    }
  }
  return { worst, detail };
}

/** An unmeasured rail must FAIL every clause, never pass vacuously (§7t). */
function requireMeasured(): void {
  expect(aisha.body, "aisha body verts").toBeGreaterThan(1000);
  expect(library.upper, "library upper garment").not.toBeNull();
  expect(library.lower, "library lower garment").not.toBeNull();
  expect(library.masks.length, "library masks").toBeGreaterThanOrEqual(2);
}

describe("the MPFB2 patient is clothed below the waist, and the mask matches the cloth", () => {
  it.fails("(1) RED CAUSE A: aisha carries a fitted lower garment", () => {
    requireMeasured();
    expect(aisha.lower, "aisha lower garment primitive").not.toBeNull();
    expect(aisha.lower?.verts ?? 0, "aisha lower garment verts").toBeGreaterThanOrEqual(2000);
  });

  it.fails(
    `(2) RED CAUSE B: no mask extends more than ${MAX_OVERREACH_M * 1000}mm beyond the garments it hides under`,
    () => {
      requireMeasured();
      const { detail } = overreach(aisha);
      expect(detail, "aisha mask over-reach beyond garment bounds").toEqual([]);
    },
  );

  it.fails(
    "(3) RED: the library rail's masks stay inside its garments too — the over-reach is shared code",
    () => {
      requireMeasured();
      const { detail } = overreach(library);
      expect(detail, "library mask over-reach (11.7mm lean_female, 14.7mm heavy_male)").toEqual([]);
    },
  );

  it("(4) COUNTERWEIGHT: the mask is not hollowed out and the garments are not inflated", () => {
    requireMeasured();
    const hidden = aisha.masks.reduce((s, m) => s + m.verts, 0);
    const total = aisha.body + hidden;
    // library rail sits at 10.1%; #323 landed MPFB2 at 10.5%. A mask shrunk to nothing is refused.
    expect(hidden / total, "aisha hidden fraction of body").toBeGreaterThan(0.04);
    expect(aisha.upper?.verts ?? 0, "aisha upper garment verts — #321 must hold").toBeGreaterThanOrEqual(4000);
  });
});
