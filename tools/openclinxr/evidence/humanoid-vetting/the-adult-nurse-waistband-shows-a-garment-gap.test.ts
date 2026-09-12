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
 */

import { existsSync, readFileSync, statSync } from "node:fs";
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

  it("live measureWaistFit still has two front gapped buckets", async () => {
    expect(existsSync(GLB), `${GLB} exists`).toBe(true);
    const fit = await measureWaistFit(GLB, "mpfb-clinical-nurse-adult");
    expect(fit.upperName, "upper is scrub shirt").toMatch(/scrub_shirt/i);
    expect(fit.lowerName, "lower is scrub pants").toMatch(/scrub_pants/i);
    expect(fit.overlaps.length, "36 comparable buckets").toBe(36);
    expect(fit.gapped, "two front buckets gapped").toBe(2);
    const minMm = Math.min(...fit.overlaps) * 1000;
    expect(minMm, "min overlap ≈ -2.6 mm").toBeCloseTo(-2.6, 1);
  });

  it("waist-box first-hits are visible skin, not hide-mask", async () => {
    expect(existsSync(LIT) && existsSync(STRUCT), "tracked front captures exist").toBe(true);
    const hits = await countFirstHitsInBox({
      glbPath: GLB,
      litPath: LIT,
      structPath: STRUCT,
      box: NURSE_WAISTBAND,
      classifyHit: classifyNurseWaistHit,
    });
    expect(hits.counts.skin, "visible-skin first-hits in the waist box").toBe(308);
    expect(hits.counts.hidden ?? 0, "hidden first-hits stay below skin").toBe(27);
    expect(hits.counts.shirt, "shirt still occupies the box").toBe(29904);
    expect(hits.counts.pants, "pants still occupy the box").toBe(12843);
    expect(hits.skinRowCount, "skin band is 9 pixel rows").toBe(9);
  }, 180_000);
});
