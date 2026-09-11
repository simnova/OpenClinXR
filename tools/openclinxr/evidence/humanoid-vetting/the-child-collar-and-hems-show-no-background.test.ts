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
 *
 * ## PROBE (attempt 2)
 *
 * Instrument: reconstructed the isolated-grade camera from
 * candidate-capture.ts (PerspectiveCamera 35°, 4096² viewport) +
 * candidate-capture-geometry.ts frameCameraForBounds (radius*2.35,
 * eyeHeight=max(0.12H,0.25), front at +Z, lookAt center.y+0.08H) on the
 * restored origin/main child (sha 2742c258… / 11,348,244 B). Guard ray is
 * render_hole_columns depth_axis=1 → Blender view (0,-1,0) → glTF +Z, as
 * materialize_mpfb_humanoid_candidate.py:4754. Site pixels are exact-background
 * subject pixels in the HB-06 bounds of the pre-fix front_lit PNG at 63dc2fb2.
 *
 * Framing (capture space): eye (0, 1.364, 5.17), lookAt (0, 1.276, 0),
 * principal (0, -0.0170, -0.9999). Angle(principal, guard +Z)=179.025°;
 * angle(principal, incoming −Z)=0.975°. Throat y=1.05 m projects to px y=1360
 * (neckline boxes are y 1300–1400); hidden_upper prim4 face0 centroid
 * projects to (1955.2, 1387.6) inside neckline-square-L. Camera reconstruction
 * is on the boxes.
 *
 * Per-site camera ray vs guard, through a bg pixel that hits a hidden face:
 *
 * | site | px | angle(cam, −Z) | camera first hidden | cam garment | cam skin | GUARD +Z garment | GUARD −Z garment | axis hole | cam-aligned hole |
 * |---|---|---:|---|---|---|---|---|---|---|
 * | neckline-square-L | (1949,1390) | 4.875° | hidden_upper.001 prim4 face1 t=5.280 c=(-0.079,1.806,-0.091); then hidden_upper prim1 face165 | none | none | none | t-shirt prim0 face2310 t=0.107 c z=-0.202 | false | true |
 * | neckline-square-R | (2132,1387) | 4.838° | hidden_upper.001 prim4 face134 t=5.267 c=(0.069,1.803,-0.078) | none | skin prim0 face11787 t=5.373 | none | t-shirt prim0 face2155 t=0.124 c z=-0.202 | false | true |
 * | sleeve-hem-rectangle-L | 70 sampled bg px | 2.0–4.3° | none (structure-wire subject mask; pixel centres miss triangle interiors) | none | none | — | — | — | — |
 * | sleeve-hem-rectangle-R | (2519,1700) | 4.614° | hidden_upper.001 prim4 face190 t=5.296 c=(0.377,1.561,-0.106) | none | none | 1 | 1 | false | false |
 *
 * Finding: the 4.8° neckline offset is enough that the axis-aligned −Z behind
 * test hits the shirt back panel at ~11 cm while the capture camera ray through
 * the same centroid hits no garment and no visible skin — only MASK-discarded
 * hidden_upper faces. Attempt 1's keep-hidden polarity therefore never classified
 * those camera-hole faces as holes (axis hole=false), and keeping them hidden
 * is also the polarity that leaves the pixel at clear color (24,33,29): along
 * the camera ray there is no skin behind prim4 face1. Shrink-the-mask (un-hide
 * faces whose *camera* ray is a hole) is the change that can fill the pixel
 * with skin. Sleeve-L bg pixels did not hit a hidden interior in this probe
 * (wireframe-bleed on the structure mask); not treated as a second mechanism.
 *
 * NOT TESTED: Blender-space camera origin vs three.js origin to millimetres;
 * the other nine bodies; waistband/crotch.
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
