/**
 * Adult-nurse RED (it.fails): the baked MPFB adult clinical nurse shows no
 * skin notched through its sleeve ends or collar in a fresh isolated render,
 * measured the way HB-07 measured the child.
 *
 * Diagnosis (measured 2026-09-12, instrument-only, live GLB bytes + tracked
 * front_lit/front_structure PNGs — no Blender opened). Subject
 * `apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb`
 * (HEAD 74b62af6, 8,833,188 B). Same isolated-grade camera as HB-07
 * (see-through-pixels.ts: candidate-capture PerspectiveCamera 35° +
 * frameCameraForBounds). Same HB-06/HB-07 site boxes, verbatim.
 *
 * HB-07 see-through (exact-background AND camera ray hits a GLB face,
 * including alpha-MASK hidden faces) on the live adult:
 *
 * | site | subject | bg | miss | see-through | hiddenSubject | visibleSkinSubject |
 * |---|---:|---:|---:|---:|---:|---:|
 * | neckline-square-L | 10320 | 51 | 88 | 0 | 722 | 0 |
 * | neckline-square-R | 9881 | 54 | 94 | 0 | 154 | 0 |
 * | sleeve-hem-rectangle-L | 29309 | 262 | 456 | 0 | 636 | 3859 |
 * | sleeve-hem-rectangle-R | 28350 | 160 | 350 | 0 | 955 | 4109 |
 * | control C (chin) | 13400 | 0 | 0 | 0 | — | — |
 * | torso | 19812 | 0 | 0 | 0 | 0 | 0 |
 *
 * Every exact-bg pixel in the four boxes MISSES all geometry (silhouette
 * gaps: hair/neck, arm/torso). See-through is 0 — the child-class hole
 * (MASK first-hit rendering as clear color 24,33,29) is not how this body
 * fails. Native 1:1 crops of the tracked front_lit PNG show square bites
 * at both collar corners and both sleeve hems. Those pixels' camera rays
 * first-hit `openclinxr_hidden_upper_…` MASK faces (722/154/636/955), then
 * the real renderer discards them and the viewer sees skin or the shirt
 * back-panel, not the capture clear color.
 *
 * Known-good column (HB-07 closed child, same boxes, same instrument,
 * classifySubject): hiddenSubject = 0 at all four sites, see-through = 0,
 * torso visibleSkinSubject = 0. The adult's hiddenSubject is the quantity
 * the child already has at 0.
 *
 * Fix direction (factory_step: clothing_consume): rebake the nurse through
 * the HB-07 hide-mask hole guard already in
 * materialize_mpfb_humanoid_candidate.py (HOLE_GUARD_SCREENSPACE_UNHIDE_FINAL)
 * so those MASK first-hit faces restore to skin, matching the child.
 * Waistband/crotch garment-fit and the other eight bodies are out of scope.
 *
 * NOT TESTED: whether the nurse shares the child's cause (axis vs camera
 * hole); the other eight bodies; Blender-space millimetre match.
 *
 * ## REBAKE (attempt 1, 2026-09-12)
 *
 * Full chain materialize -> bake-humanoid-albedo.ts (0 baked, skin already
 * in the materialize export) -> separate_chest_anchor_joints.mjs.
 * Bake log: HOLE_GUARD_UNHIDE camera-hole faces 2;
 * HOLE_GUARD_SCREENSPACE_UNHIDE faces 212;
 * HOLE_GUARD_SCREENSPACE_UNHIDE_FINAL faces 313 polygons 175.
 * Fresh isolated-grade capture of that tree, same instrument,
 * classifySubject:
 *
 * | site | see-through | hiddenSubject before | hiddenSubject after |
 * |---|---:|---:|---:|
 * | neckline-square-L | 0 | 722 | 0 |
 * | neckline-square-R | 0 | 154 | 0 |
 * | sleeve-hem-rectangle-L | 0 | 636 | 0 |
 * | sleeve-hem-rectangle-R | 0 | 955 | 0 |
 * | control C | 0 | — | 0 |
 * | torso visibleSkinSubject | 0 | 0 | 0 |
 *
 * Native 1:1 crops: sleeve hems clean; collar V filled with skin (the
 * square teal bites gone). A T-shaped hide-mask remnant remains at the
 * throat centre, outside the four HB-06 boxes.
 * Live GLB NOT promoted: landing it moves bytes/captures off the HB-04
 * pins in docs/openclinxr/humanoid-vetting-2026-09-10.json and
 * docs/openclinxr/humanoid-postopt-ladder-2026-09-10.json, which this
 * card's write-roots omit. it.fails stays on the 74b62af6 bytes.
 *
 * ## FIXED (#0)
 *
 * Promoted the attempt-1 full-chain bake (job adult-nurse-76622) and moved
 * this body's identity pins with it. Live GLB 8,833,188 B / 39,017 tris ->
 * 12,444,092 B / 92,118 tris. Shirt texture restored from 74b62af6 after
 * the materialize PNG read error; licence notice written last.
 * Isolated-grade captures copied from adult-nurse-capture/2026-09-12T05-59-51Z.
 *
 * | site | hiddenSubject before | hiddenSubject after |
 * |---|---:|---:|
 * | neckline-square-L | 722 | 0 |
 * | neckline-square-R | 154 | 0 |
 * | sleeve-hem-rectangle-L | 636 | 0 |
 * | sleeve-hem-rectangle-R | 955 | 0 |
 * | control C | — | 0 |
 * | torso visibleSkinSubject | 0 | 0 |
 *
 * All four sites 0, control 0, torso 0. it.fails flipped to it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SITES, countSeeThrough } from "./see-through-pixels.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const LIT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-nurse-adult-front_lit.png");
const STRUCT = join(
  REPO_ROOT,
  "docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-nurse-adult-front_structure.png",
);
/** Pre-fix live bytes at plant (this worktree HEAD). */
const PRE_FIX_REV = "74b62af6";
const GLB_REV = `${PRE_FIX_REV}:apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb`;
const LIT_REV = `${PRE_FIX_REV}:docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-nurse-adult-front_lit.png`;
const STRUCT_REV = `${PRE_FIX_REV}:docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-nurse-adult-front_structure.png`;

function gitShow(revPath: string): Buffer {
  return execFileSync("git", ["show", revPath], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
}

function writeShippedBytes(): { glbPath: string; litPath: string; structPath: string } {
  const dir = join(tmpdir(), `adult-nurse-shipped-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const glbPath = join(dir, "mpfb-clinical-nurse-adult.glb");
  const litPath = join(dir, "front_lit.png");
  const structPath = join(dir, "front_structure.png");
  writeFileSync(glbPath, gitShow(GLB_REV));
  writeFileSync(litPath, gitShow(LIT_REV));
  writeFileSync(structPath, gitShow(STRUCT_REV));
  return { glbPath, litPath, structPath };
}

describe("the adult nurse sleeves and collar show no skin notch", () => {
  it("74b62af6 collar/sleeve hidden first-hits are the named defect", async () => {
    const shipped = await countSeeThrough({ ...writeShippedBytes(), classifySubject: true });
    expect(
      shipped.sites["neckline-square-L"]!.hiddenSubject,
      "74b62af6 neckline-square-L hiddenSubject (MASK first-hit on subject pixels) is the named defect",
    ).toBeGreaterThan(0);
    expect(
      shipped.sites["neckline-square-R"]!.hiddenSubject,
      "74b62af6 neckline-square-R hiddenSubject is the named defect",
    ).toBeGreaterThan(0);
    expect(
      shipped.sites["sleeve-hem-rectangle-L"]!.hiddenSubject,
      "74b62af6 sleeve-hem-rectangle-L hiddenSubject is the named defect",
    ).toBeGreaterThan(0);
    expect(
      shipped.sites["sleeve-hem-rectangle-R"]!.hiddenSubject,
      "74b62af6 sleeve-hem-rectangle-R hiddenSubject is the named defect",
    ).toBeGreaterThan(0);
  }, 180_000);

  it("required-behavior", async () => {
    expect(existsSync(GLB), `${GLB} exists on disk`).toBe(true);
    expect(existsSync(LIT) && existsSync(STRUCT), "tracked front captures exist").toBe(true);

    const live = await countSeeThrough({ glbPath: GLB, litPath: LIT, structPath: STRUCT, classifySubject: true });
    for (const id of Object.keys(SITES)) {
      expect(live.sites[id]!.subject, `${id}: subject pixels recomputed from the tracked PNGs`).toBeGreaterThan(0);
      expect(
        live.sites[id]!.seeThrough,
        `${id}: zero see-through pixels (exact-background AND camera ray hits a GLB face)`,
      ).toBe(0);
      expect(
        live.sites[id]!.hiddenSubject,
        `${id}: zero hidden MASK first-hits (known-good: HB-07 child hiddenSubject=0 in these boxes)`,
      ).toBe(0);
    }
    expect(live.controlC.seeThrough, "control site C (chin) holds zero see-through pixels").toBe(0);
    expect(
      live.torso.visibleSkinSubject,
      "torso box skin pixels (visible_skin first hits; poke-through counterweight)",
    ).toBe(0);
  }, 360_000);
});
