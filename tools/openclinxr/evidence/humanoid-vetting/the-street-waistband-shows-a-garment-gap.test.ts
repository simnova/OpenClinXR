/**
 * Street-adult waistband (diagnosis): the shirt hem misses the mhclo
 * straight-leg jeans waistband by 16.8 mm (six times the nurse pre-fix gap).
 *
 * Diagnosis (measured 2026-09-12, instrument-only, live GLB). Subject
 * `apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb`.
 *
 * measureWaistFit (36 buckets, rim 0.12):
 *
 * | gapped | minMm | buckets | lower |
 * |---:|---:|---:|---|
 * | 4 | -16.8 | 31 | straight_leg_jeans_pants |
 *
 * The cargo-era street skip pinned the shirt hem at ymin 1.0283 and refused
 * `fit_upper_hem_to_waistband` because raising cover-shell band_hi pulled the
 * hem (measured 43.3 mm). That raise stays forbidden. The shipped lower is now
 * jeans, not cargo; the pin leaves a 16.8 mm gap.
 *
 * Report: street-waistband-2026-09-12.md. This clause asserts the REPORT and
 * that the live bytes meet at the jeans waistband.
 *
 * NOT TESTED: whether the jeans waistband or the shirt hem is the larger
 * contributor; other actors.
 *
 * ## FIXED (#0)
 *
 * Withdrew the street skip on `fit_upper_hem_to_waistband` in
 * materialize_mpfb_humanoid_candidate.py. Applied the same algorithm (Y-up GLB)
 * via apply-waist-meet-glb.ts: pushedVertexCount 38, maxDeficit 21.83 mm
 * (16.8 mm gap + 5 mm #320 margin). Live measureWaistFit: gapped 0, minMm +5.0,
 * lower still straight_leg_jeans_pants. Report: street-waistband-2026-09-12.md.
 * Diagnosis table is unchanged.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { measureWaistFit } from "../garments-meet-at-the-waist-measure.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb");
const REPORT = join(HERE, "street-waistband-2026-09-12.md");
const PRE_FIX_REV = "303dbdbb";
const GLB_REV = `${PRE_FIX_REV}:apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb`;

function writePreFixGlb(): string {
  const dir = join(tmpdir(), `street-waist-prefix-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const glbPath = join(dir, "mpfb-street-adult-male.glb");
  writeFileSync(glbPath, execFileSync("git", ["show", GLB_REV], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 }));
  return glbPath;
}

describe("the street waistband shows a garment gap", () => {
  it("report exists and records the live diagnosis", () => {
    expect(existsSync(REPORT), `${REPORT} exists`).toBe(true);
    const bytes = statSync(REPORT).size;
    expect(bytes, "min-bytes 900").toBeGreaterThanOrEqual(900);
    const text = readFileSync(REPORT, "utf8");
    expect(text.includes("gapped | 4"), "report records pre-fix gapped: 4").toBe(true);
    expect(text.includes("minMm | -16.8"), "report records pre-fix minMm: -16.8").toBe(true);
    expect(text.includes("straight_leg_jeans_pants"), "report names the jeans lower").toBe(true);
    expect(text.includes("NOT TESTED"), "report has NOT TESTED").toBe(true);
  });

  it("HEAD jeans front buckets are the named defect", async () => {
    const fit = await measureWaistFit(writePreFixGlb(), "mpfb-street-adult-male-prefix");
    expect(fit.lowerName, "pre-fix lower is straight-leg jeans").toMatch(/straight_leg_jeans/i);
    expect(fit.gapped, "pre-fix four buckets gapped").toBe(4);
    expect(Math.min(...fit.overlaps) * 1000, "pre-fix min overlap ≈ -16.8 mm").toBeCloseTo(-16.8, 1);
  });

  it("live measureWaistFit has no gapped buckets on the jeans", async () => {
    expect(existsSync(GLB), `${GLB} exists`).toBe(true);
    const fit = await measureWaistFit(GLB, "mpfb-street-adult-male");
    expect(fit.upperName, "upper is toigo t-shirt").toMatch(/t_shirt/i);
    expect(fit.lowerName, "lower is still straight-leg jeans").toMatch(/straight_leg_jeans/i);
    expect(fit.overlaps.length, "31 comparable buckets").toBe(31);
    expect(fit.gapped, "no angular bucket gapped").toBe(0);
    const minMm = Math.min(...fit.overlaps) * 1000;
    expect(minMm, "min overlap is the #320 5 mm margin").toBeCloseTo(5.0, 1);
  });
});
