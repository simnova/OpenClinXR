/**
 * The two waist-meet implementations agree (diagnosis): the waist-meet fit is
 * declared twice — `fit_upper_hem_to_waistband` in
 * packages/openclinxr/factory-stations/src/body_param/garment_ops.py (Blender bake
 * stage, Z-up frame) and `applyWaistMeetGlb` in
 * tools/openclinxr/asset-pipeline/makeclothes/apply-waist-meet-glb.ts (post-export
 * GLB stage, Y-up frame) — with the three constants copied by hand. A retune of
 * one copy silently changes which actors meet and which gap, and no gate reads the
 * two copies back against each other.
 *
 * Known-good (measured 2026-09-12, instrument-only, `measureWaistFit`, 36 angular
 * buckets, rim 0.12): the nurse actor meets via the Blender stage and the street
 * actor meets via the GLB stage:
 *
 * | actor | stage | pushedVertexCount | maxDeficitMeters | live gapped | live minMm |
 * |---|---|---|---|---|---|
 * | mpfb-clinical-nurse-adult | Blender bake | 36 | 0.00765 | 0 | +5.0 |
 * | mpfb-street-adult-male | post-export GLB | 38 | 0.02183 | 0 | +5.0 |
 *
 * This clause asserts the REPORT and that the two implementations agree on the
 * same input. It does not revert the street fix, rebake any actor, change any
 * threshold, or touch the cropped-jeans and boot appearance.
 *
 * NOT TESTED: whether the two agree on any input other than the two shipped
 * actors; whether the Y-up and Z-up frames differ anywhere but the axis swap.
 *
 * ## FIXED (#0)
 *
 * The constants have ONE definition: waist-meet-contract.ts in this directory.
 * The GLB stage imports it directly; the Blender stage keeps literal mirrors
 * (no TS toolchain inside Blender) with a pointer comment, and the agreement
 * test below fails closed on any drift. Report:
 * waist-meet-one-contract-2026-09-12.md. Diagnosis table is unchanged.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyWaistMeetGlb } from "../../asset-pipeline/makeclothes/apply-waist-meet-glb.ts";
import { measureWaistFit } from "../garments-meet-at-the-waist-measure.ts";
import {
  WAIST_BUCKETS,
  WAIST_OVERLAP_MARGIN_M,
  WAIST_RIM_FRACTION,
} from "./waist-meet-contract.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const REPORT = join(HERE, "waist-meet-one-contract-2026-09-12.md");
const CONTRACT = join(HERE, "waist-meet-contract.ts");
const GLB_STAGE = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/apply-waist-meet-glb.ts",
);
const BAKE_STAGE = join(
  REPO_ROOT,
  "packages/openclinxr/factory-stations/src/body_param/garment_ops.py",
);
const NURSE_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const STREET_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb");
/** Pre-fix live bytes (nurse 20c575c8: gapped 2 / -2.6 mm; street 303dbdbb: gapped 4 / -16.8 mm). */
const PREFIX: Record<string, string> = {
  "mpfb-clinical-nurse-adult": "20c575c8082772622e54baef7849df7e55dab939",
  "mpfb-street-adult-male": "303dbdbb",
};

function writePreFixGlb(actor: "mpfb-clinical-nurse-adult" | "mpfb-street-adult-male"): string {
  const dir = join(tmpdir(), `waist-agree-prefix-${actor}-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const glbPath = join(dir, `${actor}.glb`);
  writeFileSync(
    glbPath,
    execFileSync("git", ["show", `${PREFIX[actor]}:apps/ui-xr/public/generated-humanoids/${actor}.glb`], {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  return glbPath;
}

function readPythonConstants(): { margin: number; rim: number; buckets: number } {
  const py = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, "packages/openclinxr/factory-stations/src/body_param"))})`,
    "import garment_ops as g",
    "print(json.dumps({'margin': g.WAIST_OVERLAP_MARGIN_M, 'rim': g.WAIST_RIM_FRACTION, 'buckets': g.WAIST_BUCKETS}))",
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim()) as {
    margin: number;
    rim: number;
    buckets: number;
  };
}

describe("the two waist-meet implementations agree", () => {
  it("report exists and records the known-good rows", () => {
    expect(existsSync(REPORT), `${REPORT} exists`).toBe(true);
    expect(readFileSync(REPORT, "utf8").includes("NOT TESTED"), "report has NOT TESTED").toBe(true);
  });

  it("the GLB stage imports the one contract, never its own copy", () => {
    const src = readFileSync(GLB_STAGE, "utf8");
    expect(src, "GLB stage imports waist-meet-contract").toContain("waist-meet-contract.ts");
    expect(src, "no literal margin copy").not.toMatch(/WAIST_OVERLAP_MARGIN_M\s*=\s*0\.005/);
    expect(src, "no literal rim copy").not.toMatch(/WAIST_RIM_FRACTION\s*=\s*0\.12/);
    expect(src, "no literal buckets copy").not.toMatch(/WAIST_BUCKETS\s*=\s*36/);
    expect(existsSync(CONTRACT), `${CONTRACT} exists`).toBe(true);
  });

  it("the Blender bake stage mirrors the one contract exactly", () => {
    const py = readPythonConstants();
    expect(py.margin, "WAIST_OVERLAP_MARGIN_M").toBe(WAIST_OVERLAP_MARGIN_M);
    expect(py.rim, "WAIST_RIM_FRACTION").toBe(WAIST_RIM_FRACTION);
    expect(py.buckets, "WAIST_BUCKETS").toBe(WAIST_BUCKETS);
    const src = readFileSync(BAKE_STAGE, "utf8");
    expect(src, "bake stage points at the one contract").toContain("waist-meet-contract.ts");
  });

  it.each([
    { actor: "mpfb-clinical-nurse-adult", prefixGapped: 2, prefixMinMm: -2.6 },
    { actor: "mpfb-street-adult-male", prefixGapped: 4, prefixMinMm: -16.8 },
  ] as const)(
    "$actor: the GLB stage reproduces the shipped +5.0 mm / 0 gapped result from pre-fix bytes",
    async ({ actor, prefixGapped, prefixMinMm }) => {
      const dir = join(tmpdir(), `waist-agree-${actor}-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      const out = join(dir, `${actor}.glb`);
      const pre = writePreFixGlb(actor);
      const preFit = await measureWaistFit(pre, `${actor}-prefix`);
      expect(preFit.gapped, `${actor}: pre-fix gapped buckets`).toBe(prefixGapped);
      expect(Math.min(...preFit.overlaps) * 1000, `${actor}: pre-fix min overlap`).toBeCloseTo(
        prefixMinMm,
        1,
      );
      const applied = await applyWaistMeetGlb(pre, out);
      expect(applied.pushedVertexCount, `${actor}: hem vertices pushed`).toBeGreaterThan(0);
      const fit = await measureWaistFit(out, actor);
      expect(fit.gapped, `${actor}: re-applied GLB has no gapped buckets`).toBe(0);
      expect(Math.min(...fit.overlaps) * 1000, `${actor}: re-applied min is the 5 mm margin`).toBeCloseTo(
        5.0,
        1,
      );
    },
    120_000,
  );

  it("both shipped actors meet at the 5 mm margin on their live bytes", async () => {
    for (const [actor, glb] of [
      ["mpfb-clinical-nurse-adult", NURSE_GLB],
      ["mpfb-street-adult-male", STREET_GLB],
    ] as const) {
      expect(existsSync(glb), `${actor}: shipped GLB exists`).toBe(true);
      const fit = await measureWaistFit(glb, actor);
      expect(fit.gapped, `${actor}: no gapped buckets`).toBe(0);
      expect(Math.min(...fit.overlaps) * 1000, `${actor}: min overlap is +5.0 mm`).toBeCloseTo(5.0, 1);
    }
  });
});
