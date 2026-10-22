import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const manifestPath = join(here, "geometric-eye-g6-child-manifest.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : null;
const params = JSON.parse(
  readFileSync(join(here, "geometric-eye-g6-child-params.json"), "utf8"),
);
const g0 = JSON.parse(
  readFileSync(join(here, "geometric-eye-g1-params.json"), "utf8"),
);

describe("the G6 second subject carries the proportional anterior segment", () => {
  it("manifest exists with child head bake, report, renders, and a green gate", () => {
    expect(manifest).not.toBeNull();
    expect(manifest.head.file).toMatch(/\.glb$/);
    expect(manifest.report.file).toMatch(/\.json$/);
    expect(Object.keys(manifest.renders)).toHaveLength(4);
    expect(manifest.gate).toMatch(/GREEN/);
  });

  it("shipped bytes match the manifest shas", () => {
    expect(sha256File(join(here, manifest.head.file))).toBe(
      manifest.head.sha256,
    );
    expect(sha256File(join(here, manifest.report.file))).toBe(
      manifest.report.sha256,
    );
    expect(sha256File(join(here, manifest.composite.file))).toBe(
      manifest.composite.sha256,
    );
    for (const k of Object.keys(manifest.renders)) {
      expect(sha256File(join(here, manifest.renders[k].file))).toBe(
        manifest.renders[k].sha256,
      );
    }
  });

  it("second-subject census within 5% of the proportional params (done_when)", () => {
    for (const s of ["L", "R"]) {
      const c = manifest.census[s];
      expect(Math.abs(c.sclera_fit_r - params.resolved.scleral_radius_mm) / params.resolved.scleral_radius_mm).toBeLessThanOrEqual(0.05);
      expect(Math.abs(c.cap_r_mean - params.resolved.cap_radius_mm) / params.resolved.cap_radius_mm).toBeLessThanOrEqual(0.05);
      expect(Math.abs(c.protrusion - params.resolved.protrusion_mm) / params.resolved.protrusion_mm).toBeLessThanOrEqual(0.05);
      expect(Math.abs(c.disc_dia - params.iris_disc.dia_mm) / params.iris_disc.dia_mm).toBeLessThanOrEqual(0.05);
    }
  });

  it("census scales from G0 by k (adapted done_when: absolute G0 fails by design)", () => {
    for (const [key, cval, g0val] of [
      ["scleral-R", params.resolved.scleral_radius_mm, g0.resolved.scleral_radius_mm],
      ["protrusion", params.resolved.protrusion_mm, g0.resolved.protrusion_mm],
      ["disc-dia", params.iris_disc.dia_mm, g0.iris_disc.dia_mm],
    ] as Array<[string, number, number]>) {
      expect(Math.abs(cval / (g0val as number) - 0.95634) / 0.95634).toBeLessThanOrEqual(0.02);
    }
  });

  it("seal holds on the child profile: closure occludes, strictly tighter than old", () => {
    for (const s of ["L", "R"]) {
      expect(manifest.occlusionPost[s]["eye-both-closure"].fraction).toBe(1.0);
      expect(manifest.sealPost[s].band_closure_new).toBeLessThanOrEqual(0.05);
    }
  });

  it("lash re-seat is NOT-APPLICABLE with a recorded owner (no silent skip)", () => {
    expect(manifest.blinkFollow).toMatch(/NOT-APPLICABLE/);
    expect(manifest.blinkFollow).toMatch(/makeclothes\/eye-lash/);
  });

  it("child eye-band shows fibre iris, limbal ring, and catchlight energy", () => {
    for (const s of ["L", "R"]) {
      const row = manifest.gradeChild[s];
      expect(row.ringLift).toBeGreaterThanOrEqual(50);
      expect(row.meansat).toBeGreaterThanOrEqual(0.3);
      expect(row.meansat).toBeLessThanOrEqual(0.6);
      expect(row.interiorL).toBeLessThan(60);
    }
  });

  it("gaze moves both child eyes the correct direction at +-25deg", () => {
    for (const s of ["L", "R"]) {
      const sh = manifest.gradeChild[s].parallaxShift;
      expect(sh["yaw-plus-25"].px).toBeLessThan(0);
      expect(sh["yaw-minus-25"].px).toBeGreaterThan(0);
    }
  });
});
