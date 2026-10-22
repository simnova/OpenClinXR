import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const manifestPath = join(here, "geometric-eye-g2-manifest.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : null;

describe("the geometric iris disc holds centre and limbus", () => {
  it("manifest exists with glb, both disc textures, and a green gate", () => {
    expect(manifest).not.toBeNull();
    expect(manifest.glb.file).toMatch(/\.glb$/);
    expect(manifest.textures.L.file).toMatch(/\.png$/);
    expect(manifest.textures.R.file).toMatch(/\.png$/);
    expect(manifest.gate).toMatch(/GREEN/);
  });

  it("shipped bytes match the manifest shas", () => {
    expect(sha256File(join(here, manifest.glb.file))).toBe(
      manifest.glb.sha256,
    );
    for (const s of ["L", "R"]) {
      expect(sha256File(join(here, manifest.textures[s].file))).toBe(
        manifest.textures[s].sha256,
      );
    }
  });

  it("census matches G1 params within 5%", () => {
    const params = JSON.parse(
      readFileSync(join(here, "geometric-eye-g1-params.json"), "utf8"),
    );
    for (const s of ["L", "R"]) {
      const c = manifest.census[s];
      expect(Math.abs(c.r - params.resolved.scleral_radius_mm) / 12).toBeLessThan(
        0.05,
      );
      expect(Math.abs(c.cap_r - params.resolved.cap_radius_mm) / 8).toBeLessThan(
        0.05,
      );
      expect(Math.abs(c.disc_dia - params.iris_disc.dia_mm) / 11).toBeLessThan(
        0.05,
      );
      expect(Math.abs(c.disc_z - params.iris_disc.plane_z_mm)).toBeLessThan(
        0.05,
      );
    }
  });

  it("limbus stretch stays within 1 source pixel", () => {
    expect(manifest.limbus_stretch_srcpx).toBeLessThanOrEqual(1.0);
  });

  it("annulus port is byte-identical to the independent candidate-A", () => {
    expect(manifest.annulus_mismatch_vs_candidateA).toBe(0);
  });
});
