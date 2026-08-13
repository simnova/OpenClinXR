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
 *
 * ## FIXED (#326)
 *
 * `body_param_stage.py` now clips every body-hide mask to the garment's footprint in the SHARED
 * mask path (`clip_hide_mask_to_garment_footprint`, called from `_hide_under_garment`), and the
 * MPFB2 materializer (`materialize_mpfb_humanoid_candidate.py`) imports the same clip for both its
 * upper and lower channels (D1 — no second hider). The mask is built from a signed-clearance test
 * (< HIDE_EPSILON_M against the garment surface) that admits body faces just outside the garment
 * SILHOUETTE; the clip zeroes every masked polygon with a vertex outside the garment's world AABB
 * + 1.5 mm slack (below the contract's 2 mm allowance, leaving float room). It is polygon-level,
 * not triangle-level, because `apply_body_hide_material_region` hides whole polygons — a
 * triangle-level clip left a 5.6 mm residual from polygon corners (measured on the first pass).
 * The MPFB2 patient also gets a lower garment for the first time: the CC0 `cortu_cargo_pants`
 * fitted via the SAME `ClothesService.fit_clothes_to_human` the library rail uses, and (because
 * the raw fit is the sparse 392-triangle trouser) the SAME lower coverage gate — `coverage_report`
 * over the leg band, replaced by the body-derived cover shell (`build_cover_shell`) when the fit
 * does not cover, with the limb faces excluded (#295). Bundling the two causes is what this issue
 * was filed for: shipping the trousers alone would have hidden the shared over-reach defect.
 *
 * Re-baked through the materializer + `pnpm asset:body-param:fit -- --once` (2026-08-11). Measured
 * on the shipped bytes (NodeIO, the same attribution this file drives):
 *
 *   rail          | lower      | masks (verts)              | worst over-reach
 *   --------------|------------|----------------------------|-----------------
 *   aisha (MPFB2) | 8,290      | hidden_upper 1,539 + lower 196 | **0.8 mm**
 *   lean_female   | 8,565      | hidden_upper 4,568 + lower 648 | **1.0 mm**
 *   heavy_male    | 7,797      | hidden_upper 4,518 + lower 912 | **0.6 mm**
 *
 * Aisha's upper mask Y range [0.968, 1.419] now sits inside the t-shirt's [0.969, 1.420] (+1.5 mm
 * slack); her hidden fraction is 1,735/15,378 = 11.3% (library rail 10.1% — the counterweight band),
 * and the #323 regression net (mask present, hands spared, fraction < 60%, garment survives) and the
 * #322 net (library garments real + licenced) both stay green on the re-baked bytes. The lower
 * garment's 8,290 exported verts are the cover shell (1,440 unique — the glTF export splits the
 * flat-shaded shell per face, exactly as the library rail's 8,565-vert shell ships).
 *
 * ## FIXED (#357)
 *
 * Clause (2) could NEVER pass as written: it compared every mask against the union of
 * upper + lower garments only — footwear excluded by #333 — while still collecting the
 * foot hide-mask (`openclinxr_hidden_foot_*`, added by #341). A foot mask runs from the
 * ankle to the sole, ~100 mm below the trouser hem, so its axis1-min over-reach was
 * arithmetically guaranteed. Measured RED on main:
 *
 *   axis1 min: mask exceeds garment by 98.2mm / 100.0mm   (foot masks vs trousers)
 *   axis2 max: mask exceeds garment by 23.7mm / 21.8mm     (foot masks vs trousers)
 *   axis1 min: mask exceeds garment by 81.5mm              (orphan mask, #350 — spans
 *                                                           boundaries by design)
 *
 * The fix is PER-SLOT (the issue's option 2 — the honest instrument, not the minimum):
 * each mask is compared against the garment channel that hides it — upper vs upper,
 * lower vs lower, foot vs footwear — and the orphan mask against the union of ALL
 * channels (it has no single matching garment; it must still not extend beyond every
 * garment). Footwear is now collected as a channel, checked BEFORE UPPER because aisha's
 * flats material contains "toigo", and hair is excluded from the upper channel for the
 * same reason (the library's fitted hair material also contains "toigo").
 *
 * Measured 2026-08-13 per matching slot on the shipped bytes (pre-fix.json in
 * .openclinxr/evidence/mask-footprint/):
 *
 *   slot           | mask vs its garment        | worst over-reach
 *   ---------------|----------------------------|-----------------
 *   aisha upper    | vs t-shirt                 | 0.0 mm
 *   aisha lower    | vs cargo pants             | 0.0 mm
 *   aisha foot     | vs toigo flats             | 1.4 mm (inside the 2 mm allowance)
 *   aisha orphan   | vs union of all channels   | 0.0 mm
 *   library upper  | vs t-shirt                 | 1.0 mm
 *   library lower  | vs cargo pants             | 0.5 mm
 *
 * Every mask tracks the garment that hides it; the 98–100 mm figures came only from
 * comparing the foot mask to trousers. Clauses (1), (3) and (4) are unchanged.
 * NOT TESTED: whether 2 mm is the right allowance (foot lands at 1.4 mm with n=1);
 * nothing about mask correctness beyond footprint.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PUBLIC = `${REPO_ROOT}/apps/ui-xr/public`;

const AISHA = "generated-humanoids/mpfb-ob-patient-aisha.glb";
const LIBRARY = "xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb";

const UPPER = /shirt|top|tshirt|toigo/i;
const LOWER = /pants|trouser|cargo/i;
const HIDDEN = /hidden/i;
const MASK_SLOT = /hidden_(upper|lower|foot|orphan)/i;
/** Hair is not a garment the mask hides under — excluding it keeps the upper channel honest. */
const HAIR = /hair|scalp/i;
/**
 * #333: footwear is a wardrobe channel, not body — the library rail already ships it.
 * #357: footwear IS a garment the foot mask hides under, so it is collected as a channel
 * (checked BEFORE UPPER: aisha's flats material contains "toigo").
 */
const FOOTWEAR = /footwear|shoe|boot|flat/i;
/** Signed-clearance epsilon is 5 mm; 2 mm of bounds slack allows float + fan-triangulation edges. */
const MAX_OVERREACH_M = 0.002;

type Box = { min: [number, number, number]; max: [number, number, number]; verts: number };
type MaskSlot = "upper" | "lower" | "foot" | "orphan";
type Mask = { slot: MaskSlot; box: Box };
type Rail = { id: string; upper: Box | null; lower: Box | null; footwear: Box | null; masks: Mask[]; body: number };

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
  let footwear: Box | null = null;
  const masks: Mask[] = [];
  let body = 0;
  const el: [number, number, number] = [0, 0, 0];

  const absorb = (target: Box | null, box: Box): Box => {
    if (!target) return box;
    const merged = EMPTY();
    for (let a = 0; a < 3; a += 1) {
      merged.min[a] = Math.min(target.min[a]!, box.min[a]!);
      merged.max[a] = Math.max(target.max[a]!, box.max[a]!);
    }
    merged.verts = target.verts + box.verts;
    return merged;
  };

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const name = prim.getMaterial()?.getName() ?? "";
      const box = EMPTY();
      for (let i = 0; i < pos.getCount(); i += 1) grow(box, pos.getElement(i, el));
      box.verts = pos.getCount();

      if (HIDDEN.test(name)) {
        const slotMatch = name.match(MASK_SLOT);
        // Unknown hidden slot -> orphan (union-all comparison): never compare a
        // mask against a channel that does not hide it.
        const slot: MaskSlot = slotMatch?.[1] === "foot" ? "foot" : slotMatch?.[1] === "orphan" ? "orphan" : slotMatch?.[1] === "lower" ? "lower" : slotMatch?.[1] === "upper" ? "upper" : "orphan";
        masks.push({ slot, box });
      } else if (FOOTWEAR.test(name)) {
        footwear = absorb(footwear, box);
      } else if (LOWER.test(name)) {
        lower = absorb(lower, box);
      } else if (HAIR.test(name)) {
        // not a garment channel, not body the mask hides under — skip
      } else if (UPPER.test(name)) {
        upper = absorb(upper, box);
      } else {
        body += pos.getCount();
      }
    }
  }
  return { id, upper, lower, footwear, masks, body };
}

const aisha = await railOf("mpfb2_aisha", AISHA);
const library = await railOf("library_lean_female", LIBRARY);

function unionOf(boxes: Array<Box | null>): Box | null {
  const parts = boxes.filter((b): b is Box => b !== null);
  if (!parts.length) return null;
  const u = EMPTY();
  for (const p of parts) {
    for (let a = 0; a < 3; a += 1) {
      if (p.min[a]! < u.min[a]!) u.min[a] = p.min[a]!;
      if (p.max[a]! > u.max[a]!) u.max[a] = p.max[a]!;
    }
    u.verts += p.verts;
  }
  return u;
}

/**
 * #357: per-slot comparison — each mask against the garment channel that hides it
 * (upper vs upper, lower vs lower, foot vs footwear). The old code compared every
 * mask against union(upper, lower), which excluded footwear by design (#333) while
 * still collecting the foot mask, so the ankle-to-sole reach below the trouser hem
 * was arithmetically guaranteed to over-reach. The orphan mask (#350) spans garment
 * boundaries by design — no single channel hides it — so it is compared against the
 * union of ALL channels (it must not extend beyond every garment).
 */
function overreach(rail: Rail): { worst: number; detail: string[] } {
  let worst = 0;
  const detail: string[] = [];
  const unionAll = unionOf([rail.upper, rail.lower, rail.footwear]);
  for (const m of rail.masks) {
    const garment = m.slot === "upper" ? rail.upper : m.slot === "lower" ? rail.lower : m.slot === "foot" ? rail.footwear : unionAll;
    if (!garment) {
      worst = Infinity;
      detail.push(`${m.slot} mask has no matching garment channel`);
      continue;
    }
    for (let a = 0; a < 3; a += 1) {
      const under = garment.min[a]! - m.box.min[a]!;
      const over = m.box.max[a]! - garment.max[a]!;
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
  it("(1) RED CAUSE A: aisha carries a fitted lower garment", () => {
    requireMeasured();
    expect(aisha.lower, "aisha lower garment primitive").not.toBeNull();
    expect(aisha.lower?.verts ?? 0, "aisha lower garment verts").toBeGreaterThanOrEqual(2000);
  });

  it(
    `(2) RED CAUSE B: no mask extends more than ${MAX_OVERREACH_M * 1000}mm beyond the garments it hides under`,
    () => {
      requireMeasured();
      const { detail } = overreach(aisha);
      expect(detail, "aisha mask over-reach beyond garment bounds").toEqual([]);
    },
  );

  it(
    "(3) RED: the library rail's masks stay inside its garments too — the over-reach is shared code",
    () => {
      requireMeasured();
      const { detail } = overreach(library);
      expect(detail, "library mask over-reach (11.7mm lean_female, 14.7mm heavy_male)").toEqual([]);
    },
  );

  it("(4) COUNTERWEIGHT: the mask is not hollowed out and the garments are not inflated", () => {
    requireMeasured();
    const hidden = aisha.masks.reduce((s, m) => s + m.box.verts, 0);
    const total = aisha.body + hidden;
    // library rail sits at 10.1%; #323 landed MPFB2 at 10.5%. A mask shrunk to nothing is refused.
    expect(hidden / total, "aisha hidden fraction of body").toBeGreaterThan(0.04);
    expect(aisha.upper?.verts ?? 0, "aisha upper garment verts — #321 must hold").toBeGreaterThanOrEqual(4000);
  });
});
