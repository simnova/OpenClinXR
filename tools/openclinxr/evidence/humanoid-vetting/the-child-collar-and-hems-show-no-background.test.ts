import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "../decode-png.ts";

/**
 * HB-07 RED (it.fails): the baked child humanoid shows no background through
 * its body at the collar or sleeve hems in a fresh front render.
 *
 * Diagnosis (measured 2026-09-11, instrument-only, live GLB bytes + three.js
 * captures — no Blender opened). The round-7 render-truth refinement un-hides a
 * hidden body polygon when ANY of its 7 area samples has no shirt in front AND
 * no OUTER-facing shirt surface behind it along the viewer ray
 * (materialize_mpfb_humanoid_candidate.py:4923). At the child's collar and
 * sleeve hems the hidden body ring sits OUTSIDE the open garment edges: a
 * hidden-first viewer column has bare skin 8-92 mm behind the discarded face
 * (p50 75-85 mm, measured) with no shirt surface anywhere behind that skin.
 * The behind test fails, the any-of-7 rule un-hides the polygon, and the
 * viewer sees the capture clear color (24, 33, 29) instead of skin while skin
 * under the shirt stays hidden. Column scan of the shipped bytes: 323 clean
 * hidden-first skin-behind columns (186 collar, 137 sleeve) with no shirt
 * behind the skin. Fresh front render (model-vetting-glb-grade-capture.ts
 * --glb, same studio route as HB-04): neckline-square-L 154, neckline-square-R
 * 191, sleeve-hem-rectangle-L 382, sleeve-hem-rectangle-R 292 exact-background
 * pixels; control site C (chin) 0. Boxes are the HB-06 boxes, verbatim.
 *
 * Fix direction (factory_step: clothing_consume): the hide-mask boundary must
 * not leave a discarded ring outside the garment silhouette whose viewer column
 * has no garment surface behind it — shrink the mask to the garment silhouette
 * (or equivalently, keep hidden any face whose column shows background instead
 * of skin). Waistband and crotch garment-fit and the other nine bodies' seams
 * are out of scope.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb");
const LIT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-peds-patient-child-front_lit.png");
const STRUCT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-peds-patient-child-front_structure.png");
const BG_LUMA = 0.299 * 24 + 0.587 * 33 + 0.114 * 29;

const SITES: Record<string, number[]> = {
  "neckline-square-L": [1840, 1300, 1980, 1400],
  "neckline-square-R": [2120, 1300, 2260, 1400],
  "sleeve-hem-rectangle-L": [1560, 1630, 1920, 1920],
  "sleeve-hem-rectangle-R": [2180, 1630, 2540, 1920],
};
const CONTROL_C = [1980, 1180, 2120, 1300];

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("the child collar and hems show no background", () => {
  it.fails("HB-07-required-behavior", () => {
    expect(existsSync(GLB), `${GLB} exists on disk`).toBe(true);
    expect(existsSync(LIT) && existsSync(STRUCT), "tracked front captures exist").toBe(true);
    const lit = decodePng(new Uint8Array(readFileSync(LIT)))!;
    const struct = decodePng(new Uint8Array(readFileSync(STRUCT)))!;
    expect(lit !== null && struct !== null, "both PNGs decode").toBe(true);
    const W = lit!.w;
    const count = (box: number[]): { subj: number; bg: number } => {
      let subj = 0;
      let bg = 0;
      for (let y = box[1]!; y < box[3]!; y++) {
        for (let x = box[0]!; x < box[2]!; x++) {
          const i = y * W + x;
          if (struct!.lum[i]! > 40) {
            subj++;
            if (Math.abs(lit!.lum[i]! - BG_LUMA) < 0.01) bg++;
          }
        }
      }
      return { subj, bg };
    };
    for (const [id, box] of Object.entries(SITES)) {
      const got = count(box);
      expect(got.subj, `${id}: subject pixels recomputed from the tracked PNGs`).toBeGreaterThan(0);
      expect(got.bg, `${id}: zero exact-background pixels (hide-mask boundary closed)`).toBe(0);
    }
    const ctrl = count(CONTROL_C);
    expect(ctrl.bg, "control site C (chin) holds zero exact-background pixels").toBe(0);
    void sha256Hex;
  });
});
