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
 *
 * Rebake after the camera-ray shrink (materialize + HB-02 albedo + chest-anchor;
 * face-preserving decimation skipped, ladder chosenRungId=raw): bake log
 * HOLE_GUARD_UNHIDE camera-hole faces 2. Fresh capture
 * `.openclinxr/evidence/glb-grade-capture/2026-09-11T21-05-19Z` (not landed;
 * live GLB restored to origin/main because the materialize exports 80,404 tris /
 * 13,034,988 B vs ladder raw 77,324 / 11,348,244 B). Site exact-background on
 * that capture: neckline-square-L 67, neckline-square-R 99,
 * sleeve-hem-rectangle-L 380, sleeve-hem-rectangle-R 289; control C 0; torso 0.
 * Not all four sites 0 — it.fails stays. GLB not promoted.
 *
 * ## PROBE (attempt 3)
 *
 * Instrument: three.js Raycaster + NodeIO world meshes, DoubleSide. Camera is
 * candidate-capture.ts PerspectiveCamera(35, 1, 0.01, 100) +
 * candidate-capture-geometry.ts frameCameraForBounds on the capture clone
 * (scale height to 2.2 m, ground minY, xz-center) of the restored origin/main
 * child (sha 2742c258… / 11,348,244 B). Eye (0, 1.364, 5.17), lookDir
 * (0, -0.0170, -0.9999) — same framing as attempt 2 / HB-04. Every exact-
 * background subject pixel (structure lum > 40 AND |lit lum − BG_LUMA| < 0.01)
 * inside each HB-06 site box is unprojected; first GLB hit classified.
 * Header diagnosis untouched. No factory change.
 *
 * | site | bg | miss | t-shirt | hidden_upper (MASK) | visible skin | other |
 * |---|---:|---:|---:|---:|---:|---:|
 * | neckline-square-L | 154 | 67 | 0 | 87 | 0 | 0 |
 * | neckline-square-R | 191 | 99 | 0 | 92 | 0 | 0 |
 * | sleeve-hem-rectangle-L | 382 | 379 | 0 | 3 | 0 | 0 |
 * | sleeve-hem-rectangle-R | 292 | 288 | 0 | 4 | 0 | 0 |
 * | control C (chin) | 0 | 0 | 0 | 0 | 0 | 0 |
 *
 * hidden_upper first hits are all `mpfb_peds_patient_child_body` prim4
 * (`openclinxr_hidden_upper_…body_mesh.001`, alphaMode MASK, 238 tris).
 * Zero t-shirt / visible-skin first hits. Sleeves are almost all miss
 * (empty gap at the opening). Neckline is mixed miss + hidden_upper.
 * Totals: miss 833, hidden_upper 186, t-shirt 0, visible_skin 0.
 * Step-3 polarity: mixed — un-hide the prim4 faces those pixel rays hit
 * (screen-space, not centroids), then close remaining opening misses on
 * the garment side.
 *
 * NOT TESTED: other nine bodies; waistband/crotch; Blender-space millimetre
 * match of this Node camera to the in-page WebGL camera.
 *
 * Treatment (attempt 3, not promoted): cargo pin reproduced the LOWER GATE
 * cover shell (PANTS_FIT 392 → shell 2,726 tris vs shipped 2,628). Sleeve
 * edgeloop_fill capped 2 rims (facesAdded 2, t-shirt 2,700 → 2,720).
 * Screen-space unhide + camera-hole unhide 2 faces each. Full chain
 * materialize → bake-humanoid-albedo.ts → separate_chest_anchor_joints.mjs
 * (decimation skipped, chosenRungId=raw). Triangle count 77,442
 * (delta +118 = +20 shirt caps + 98 shell vs shipped 77,324). Fresh capture
 * `.openclinxr/evidence/glb-grade-capture/2026-09-11T21-37-55Z`:
 *
 * | site | bg after treatment |
 * |---|---:|
 * | neckline-square-L | 67 |
 * | neckline-square-R | 99 |
 * | sleeve-hem-rectangle-L | 382 |
 * | sleeve-hem-rectangle-R | 292 |
 * | control C | 0 |
 *
 * Sleeves unchanged from HB-06. Neckline matches attempt 2. Not all four
 * sites 0 — it.fails stays. Live GLB restored to origin/main
 * (sha 2742c258… / 11,348,244 B).
 *
 * ## CORRECTION (orchestrator, 2026-09-11)
 *
 * The shipped capture shows two dark see-through squares at the neck base,
 * one each side. Attempt-3 treatment (screen-space unhide) REMOVED them: 87
 * of 154 and 92 of 191 neckline background pixels were hidden_upper first
 * hits, and exactly those are gone (154 -> 67, 191 -> 99).
 *
 * Every remaining background pixel in the four boxes MISSES all geometry:
 * neckline 67/99 are the gap between hair and neck; sleeve 379/382 and
 * 288/292 are the gap between the arm and the torso, which the HB-06 boxes
 * include. Those pixels are outside the silhouette and correctly show
 * background. The sleeve hems were never see-through.
 *
 * So the RED's criterion (all exact-background pixels in each box = 0)
 * measures the wrong population and can never pass on a correct body. The
 * corrected criterion keeps the zero threshold on the see-through
 * population: an exact-background pixel counts ONLY if the capture camera's
 * ray through it first-hits a GLB face (any primitive, including alpha-MASK
 * hidden faces). Camera reconstruction is the attempt-3 probe (helper
 * see-through-pixels.ts beside this file).
 *
 * Attempt-3 probe table (evidence; origin/main child sha 2742c258…):
 *
 * | site | bg | miss | t-shirt | hidden_upper (MASK) | visible skin | other |
 * |---|---:|---:|---:|---:|---:|---:|
 * | neckline-square-L | 154 | 67 | 0 | 87 | 0 | 0 |
 * | neckline-square-R | 191 | 99 | 0 | 92 | 0 | 0 |
 * | sleeve-hem-rectangle-L | 382 | 379 | 0 | 3 | 0 | 0 |
 * | sleeve-hem-rectangle-R | 292 | 288 | 0 | 4 | 0 | 0 |
 * | control C (chin) | 0 | 0 | 0 | 0 | 0 | 0 |
 *
 * Assertion: per site, see-through (exact-background AND camera ray hits a
 * GLB face) = 0; control C = 0; torso box skin pixels (visible_skin first
 * hits on subject pixels, poke-through counterweight) = 0. The see-through
 * count on the SHIPPED bytes at 63dc2fb2 is > 0 for both neckline sites —
 * the test must fail on the defect it names.
 *
 * ## REBAKE (attempt 4, 2026-09-11)
 *
 * Full chain without sleeve caps. Capture
 * `.openclinxr/evidence/glb-grade-capture/2026-09-11T22-23-04Z` copied to
 * tracked humanoid-vetting-captures. See-through (exact-bg AND ray hits a
 * GLB face):
 *
 * | site | bg | miss | see-through |
 * |---|---:|---:|---:|
 * | neckline-square-L | 67 | 67 | 0 |
 * | neckline-square-R | 99 | 99 | 0 |
 * | sleeve-hem-rectangle-L | 382 | 379 | 3 |
 * | sleeve-hem-rectangle-R | 292 | 288 | 4 |
 * | control C | 0 | 0 | 0 |
 * | torso visibleSkinSubject | 0 | — | 0 |
 *
 * Neckline closed. Sleeves still 3/4 hidden_upper first hits — not all four
 * sites 0, so it.fails stays. No ## FIXED (HB-07).
 *
 * ## PROBE (attempt 5)
 *
 * Instrument: same see-through-pixels.ts camera (candidate-capture 35° +
 * frameCameraForBounds) on the attempt-4 live GLB (sha 794d9438… / 11,362,908 B).
 * Every exact-bg subject pixel in the sleeve HB-06 boxes is unprojected;
 * first GLB hit recorded with prim/faceIndex. Factory 1024 grid reconstructed
 * over the hidden-vert NDC bbox (garment_coverage.screen_space_hidden_first_hits
 * resolution=1024). Bake log from attempt 4
 * (openclinxr-hb07-84007/materialize.log): HOLE_GUARD_SCREENSPACE_UNHIDE
 * faces 1, then RENDER_TRUTH_REHIDE applied upper faces 222.
 *
 * | site | px | prim | faceIndex | t | nearest-1024 first | distPx |
 * |---|---|---:|---:|---:|---|---:|
 * | sleeve-L | (1576,1699) | 4 | 79 | 5.298 | hidden prim4 f79 | 1.54 |
 * | sleeve-L | (1575,1701) | 4 | 79 | 5.296 | miss | 2.31 |
 * | sleeve-L | (1574,1702) | 4 | 79 | 5.297 | visible skin prim0 f2190 (t 5.295) | 1.30 |
 * | sleeve-R | (2519,1699) | 4 | 190 | 5.298 | hidden prim4 f190 | 1.54 |
 * | sleeve-R | (2519,1700) | 4 | 190 | 5.296 | hidden prim4 f190 | 1.72 |
 * | sleeve-R | (2520,1701) | 4 | 190 | 5.296 | miss | 2.31 |
 * | sleeve-R | (2521,1702) | 4 | 190 | 5.297 | visible skin prim0 f11905 (t 5.295) | 1.30 |
 *
 * Both faces: `mpfb_peds_patient_child_body` prim4
 * (`openclinxr_hidden_upper_…body_mesh.001`, MASK). Screen size 22.5×29.8 px;
 * 6 factory-grid samples sit inside each face's NDC triangle. Sample spacing
 * 4.00×3.99 px. Not a region restriction (both faces are still in the
 * remaining hide_mask / exported MASK prim). Coverage/first-hit: the 1024
 * sample that lands 1.3 px from (1574,1702) first-hits visible body 1.5 mm
 * closer than the hidden face, so the factory rejects that sample. Bake then
 * re-paints 222 upper faces AFTER the numpy mask is applied
 * (materialize_mpfb_humanoid_candidate.py RENDER_TRUTH_REHIDE).
 *
 * Treatment: same predicate, capture-aligned 4096 pixel centres, re-run last
 * after REHIDE/orphan and restore those polygons to the skin material.
 *
 * NOT TESTED until rebake: whether un-hiding prim4 f79/f190 moves torso
 * visible_skin off 0 (counterweight; do not flip if it does).
 *
 * ## FIXED (HB-07)
 *
 * Full chain materialize -> bake-humanoid-albedo.ts ->
 * separate_chest_anchor_joints.mjs (decimation skipped, chosenRungId=raw).
 * Bake log: HOLE_GUARD_SCREENSPACE_UNHIDE faces 5;
 * HOLE_GUARD_SCREENSPACE_UNHIDE_FINAL faces 185 polygons 100.
 * Capture `.openclinxr/evidence/hb07-attempt5/capture/2026-09-11T23-26-23Z`
 * copied to tracked humanoid-vetting-captures.
 *
 * | site | bg before | see-through before | bg after | see-through after |
 * |---|---:|---:|---:|---:|
 * | neckline-square-L | 67 | 0 | 67 | 0 |
 * | neckline-square-R | 99 | 0 | 99 | 0 |
 * | sleeve-hem-rectangle-L | 382 | 3 | 376 | 0 |
 * | sleeve-hem-rectangle-R | 292 | 4 | 286 | 0 |
 * | control C | 0 | 0 | 0 | 0 |
 * | torso visibleSkinSubject | — | 0 | — | 0 |
 *
 * All four sites 0, control 0, torso 0. Triangle count 77422 (delta 0 vs
 * attempt 4). it.fails flipped to it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRE_FIX_REV, SITES, countSeeThrough } from "./see-through-pixels.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb");
const LIT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-peds-patient-child-front_lit.png");
const STRUCT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-peds-patient-child-front_structure.png");
const GLB_REV = `${PRE_FIX_REV}:apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb`;
const LIT_REV = `${PRE_FIX_REV}:docs/openclinxr/humanoid-vetting-captures/mpfb-peds-patient-child-front_lit.png`;
const STRUCT_REV = `${PRE_FIX_REV}:docs/openclinxr/humanoid-vetting-captures/mpfb-peds-patient-child-front_structure.png`;

function gitShow(revPath: string): Buffer {
  return execFileSync("git", ["show", revPath], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
}

function writeShippedBytes(): { glbPath: string; litPath: string; structPath: string } {
  const dir = join(tmpdir(), `hb07-shipped-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const glbPath = join(dir, "mpfb-peds-patient-child.glb");
  const litPath = join(dir, "front_lit.png");
  const structPath = join(dir, "front_structure.png");
  writeFileSync(glbPath, gitShow(GLB_REV));
  writeFileSync(litPath, gitShow(LIT_REV));
  writeFileSync(structPath, gitShow(STRUCT_REV));
  return { glbPath, litPath, structPath };
}

describe("the child collar and hems show no background", () => {
  it("63dc2fb2 neckline see-through is the named defect", async () => {
    const shipped = await countSeeThrough(writeShippedBytes());
    expect(
      shipped.sites["neckline-square-L"]!.seeThrough,
      "63dc2fb2 neckline-square-L see-through (exact-bg AND ray hits a GLB face) is the named defect",
    ).toBeGreaterThan(0);
    expect(
      shipped.sites["neckline-square-R"]!.seeThrough,
      "63dc2fb2 neckline-square-R see-through (exact-bg AND ray hits a GLB face) is the named defect",
    ).toBeGreaterThan(0);
  }, 120_000);

  it("HB-07-required-behavior", async () => {
    expect(existsSync(GLB), `${GLB} exists on disk`).toBe(true);
    expect(existsSync(LIT) && existsSync(STRUCT), "tracked front captures exist").toBe(true);

    const live = await countSeeThrough({ glbPath: GLB, litPath: LIT, structPath: STRUCT });
    for (const id of Object.keys(SITES)) {
      expect(live.sites[id]!.subject, `${id}: subject pixels recomputed from the tracked PNGs`).toBeGreaterThan(0);
      expect(
        live.sites[id]!.seeThrough,
        `${id}: zero see-through pixels (exact-background AND camera ray hits a GLB face)`,
      ).toBe(0);
    }
    expect(live.controlC.seeThrough, "control site C (chin) holds zero see-through pixels").toBe(0);
    expect(
      live.torso.visibleSkinSubject,
      "torso box skin pixels (visible_skin first hits; poke-through counterweight)",
    ).toBe(0);
  }, 120_000);
});

