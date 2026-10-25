import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const manifestPath = join(here, "geometric-eye-g3-manifest.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : null;

describe("the G3 lid re-fit seals the new anterior profile", () => {
  it("manifest exists with report, refit map, renders, and a green gate", () => {
    expect(manifest).not.toBeNull();
    expect(manifest.report.file).toMatch(/\.json$/);
    expect(manifest.refit.file).toMatch(/\.json$/);
    expect(Object.keys(manifest.renders)).toHaveLength(6);
    expect(manifest.gate).toMatch(/GREEN/);
  });

  it("shipped bytes match the manifest shas", () => {
    expect(sha256File(join(here, manifest.report.file))).toBe(
      manifest.report.sha256,
    );
    expect(sha256File(join(here, manifest.refit.file))).toBe(
      manifest.refit.sha256,
    );
    for (const k of Object.keys(manifest.renders)) {
      expect(sha256File(join(here, manifest.renders[k].file))).toBe(
        manifest.renders[k].sha256,
      );
    }
  });

  it("seal holds: no poke-through at closure/slit, full occlusion at closure", () => {
    for (const s of ["L", "R"]) {
      const seal = manifest.seal[s];
      expect(seal.closureMinMm).toBeGreaterThanOrEqual(-0.05);
      expect(seal.slitMinMm).toBeGreaterThanOrEqual(-0.05);
      expect(seal.occlusionClosure).toBe(1.0);
    }
  });

  it("aperture holds position and size: width at baseline, height in band", () => {
    for (const s of ["L", "R"]) {
      const ap = manifest.aperture[s];
      expect(Math.abs(ap.widthMm - 27.009)).toBeLessThanOrEqual(0.3);
      expect(ap.heightMm).toBeLessThanOrEqual(11.0);
      expect(ap.heightMm).toBeGreaterThanOrEqual(10.0);
    }
  });

  it("overlap is tracked with both stations and an explicit carry-forward", () => {
    const report = JSON.parse(
      readFileSync(join(here, manifest.report.file), "utf8"),
    );
    for (const s of ["L", "R"]) {
      expect(typeof report.overlapPreMm[s]).toBe("number");
      expect(typeof report.aperturePost[s].overlapMm).toBe("number");
    }
    expect(report.notTested.join(" ")).toMatch(/lash/);
  });
});
