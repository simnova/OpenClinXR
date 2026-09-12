/**
 * Adult-nurse waistband (diagnosis): skin between the scrub-shirt hem and the
 * trousers is a garment-fit gap, not the hide mask.
 *
 * Diagnosis (measured 2026-09-12, instrument-only, live GLB + tracked
 * front_lit/front_structure). Subject
 * `apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb`
 * (8,396,376 B / 38,958 tris — collar/sleeve hole-guard known-good).
 *
 * measureWaistFit (36 buckets, rim 0.12):
 *
 * | gapped | minMm | medianMm | maxMm |
 * |---:|---:|---:|---:|
 * | 2 | -2.6 | 41.7 | 52.1 |
 *
 * Front buckets 26–27 (≈ +Z) are the only negatives. Bound-Y of shirt
 * (0.974–1.525 m) and pants (0.080–1.034 m) still overlap 60 mm.
 *
 * First-hit in [1880, 1980, 2220, 2180] (isolated-grade camera):
 *
 * | shirt | pants | skin | hidden | subject | skinRowCount |
 * |---:|---:|---:|---:|---:|---:|
 * | 29904 | 12843 | 308 | 27 | 43082 | 9 |
 *
 * Skin first-hits are `mpfb_skin_ed_chest_pain_nurse_adult`, not MASK.
 * Hidden 27 << skin 308 — hide-mask is not this band.
 *
 * Factory hem-to-waistband push is `body_param_stage.py` (#320, library rail).
 * Live path is `materialize_mpfb_humanoid_candidate.py` (hole guard only).
 * Both sit under `tools/openclinxr/asset-pipeline/**`, omitted from this
 * card's write-roots. `.mhclo` cannot bind an exported GLB (re-index).
 *
 * Report: nurse-waistband-gap-2026-09-12.md. This clause asserts the REPORT
 * and that the live bytes still match it. Closing the gap is a later factory
 * slice, not a GLB vertex push.
 *
 * NOT TESTED: the other eight bodies; mhclo fit-parameter clipping.
 *
 * ## FIXED (#0)
 *
 * Withdrew the scrub skip on `fit_upper_hem_to_waistband` in
 * materialize_mpfb_humanoid_candidate.py (the function is a no-op when the hem
 * already meets — kevin stays). Bake log: pushedVertexCount 36, maxDeficit 7.65 mm
 * (2.65 mm gap + 5 mm #320 margin). Same postopt ladder as the collar known-good
 * (#695 r0.4 e0.001, #737 lash 0.12/0.005) → 38,958 tris / 8,396,376 B.
 *
 * Live measureWaistFit: gapped 0, minMm +5.0. Waist-box first-hits: shirt 30522 /
 * pants 12700 / skin 0 / hidden 0 / skinRowCount 0. Report:
 * nurse-waistband-hem-fit-2026-09-12.md. Diagnosis report is unchanged.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { measureWaistFit } from "../garments-meet-at-the-waist-measure.ts";
import {
  NURSE_WAISTBAND,
  classifyNurseWaistHit,
  countFirstHitsInBox,
} from "./see-through-pixels.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const LIT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-nurse-adult-front_lit.png");
const STRUCT = join(
  REPO_ROOT,
  "docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-nurse-adult-front_structure.png",
);
const REPORT = join(HERE, "nurse-waistband-gap-2026-09-12.md");
const FIT_REPORT = join(HERE, "nurse-waistband-hem-fit-2026-09-12.md");
/** Pre-fix live bytes at plant (worktree HEAD before this hem-fit). */
const PRE_FIX_REV = "20c575c8082772622e54baef7849df7e55dab939";
const GLB_REV = `${PRE_FIX_REV}:apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb`;

function writePreFixGlb(): string {
  const dir = join(tmpdir(), `adult-nurse-waist-prefix-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const glbPath = join(dir, "mpfb-clinical-nurse-adult.glb");
  writeFileSync(glbPath, execFileSync("git", ["show", GLB_REV], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 }));
  return glbPath;
}

describe("the adult nurse waistband shows a garment gap", () => {
  it("report exists and records the live diagnosis", () => {
    expect(existsSync(REPORT), `${REPORT} exists`).toBe(true);
    const bytes = statSync(REPORT).size;
    expect(bytes, "min-bytes 700").toBeGreaterThanOrEqual(700);
    const text = readFileSync(REPORT, "utf8");
    expect(text.includes("gapped | 2"), "report records gapped: 2").toBe(true);
    expect(text.includes("minMm | -2.6"), "report records minMm: -2.6").toBe(true);
    expect(text.includes("skin | 308"), "report records skin: 308").toBe(true);
    expect(text.includes("hidden | 27"), "report records hidden: 27").toBe(true);
    expect(text.includes("NOT TESTED"), "report has NOT TESTED").toBe(true);
  });

  it("20c575c8 front buckets are the named defect", async () => {
    const fit = await measureWaistFit(writePreFixGlb(), "mpfb-clinical-nurse-adult-prefix");
    expect(fit.gapped, "pre-fix two front buckets gapped").toBe(2);
    expect(Math.min(...fit.overlaps) * 1000, "pre-fix min overlap ≈ -2.6 mm").toBeCloseTo(-2.6, 1);
  });

  it("live measureWaistFit has no gapped buckets", async () => {
    expect(existsSync(GLB), `${GLB} exists`).toBe(true);
    const fit = await measureWaistFit(GLB, "mpfb-clinical-nurse-adult");
    expect(fit.upperName, "upper is scrub shirt").toMatch(/scrub_shirt/i);
    expect(fit.lowerName, "lower is scrub pants").toMatch(/scrub_pants/i);
    expect(fit.overlaps.length, "36 comparable buckets").toBe(36);
    expect(fit.gapped, "no angular bucket gapped").toBe(0);
    const minMm = Math.min(...fit.overlaps) * 1000;
    expect(minMm, "min overlap is the #320 5 mm margin").toBeCloseTo(5.0, 1);
  });

  it("waist-box first-hits are garment, not visible skin", async () => {
    expect(existsSync(LIT) && existsSync(STRUCT), "tracked front captures exist").toBe(true);
    expect(existsSync(FIT_REPORT), `${FIT_REPORT} exists`).toBe(true);
    expect(statSync(FIT_REPORT).size, "hem-fit report min-bytes 700").toBeGreaterThanOrEqual(700);
    const hits = await countFirstHitsInBox({
      glbPath: GLB,
      litPath: LIT,
      structPath: STRUCT,
      box: NURSE_WAISTBAND,
      classifyHit: classifyNurseWaistHit,
    });
    expect(hits.counts.skin ?? 0, "visible-skin first-hits in the waist box").toBe(0);
    expect(hits.counts.hidden ?? 0, "hidden first-hits stay at 0").toBe(0);
    expect(hits.counts.shirt, "shirt still occupies the box").toBeGreaterThan(0);
    expect(hits.counts.pants, "pants still occupy the box").toBeGreaterThan(0);
    expect(hits.skinRowCount, "skin band is gone").toBe(0);
  }, 180_000);
});
