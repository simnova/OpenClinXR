import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = join(repoRoot(), "tools/openclinxr/evidence/realism-head/eyes");
const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const manifestPath = join(here, "geometric-eye-g5-manifest.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : null;
const report = manifest
  ? JSON.parse(readFileSync(join(here, manifest.report.file), "utf8"))
  : null;

describe("the G5 catchlight re-prove holds on the true cap", () => {
  it("manifest exists with report, renders, and a green gate", () => {
    expect(manifest).not.toBeNull();
    expect(manifest.report.file).toMatch(/\.json$/);
    expect(Object.keys(manifest.renders)).toHaveLength(9);
    expect(manifest.gate).toMatch(/GREEN/);
    expect(report.verdict).toBe("GREEN");
    expect(report.checks).toHaveLength(10);
    for (const c of report.checks) expect(c.pass).toBe(true);
  });

  it("shipped bytes match the manifest shas", () => {
    expect(sha256File(join(here, manifest.report.file))).toBe(
      manifest.report.sha256,
    );
    for (const k of Object.keys(manifest.renders)) {
      expect(sha256File(join(here, manifest.renders[k].file))).toBe(
        manifest.renders[k].sha256,
      );
    }
  });

  it("old recipe re-proven: dot core round and in-disc on the true cap", () => {
    const dot = report.cells["cap-room05"].dot;
    expect(dot.px).toBeGreaterThanOrEqual(20);
    expect(dot.round_ratio).toBeLessThanOrEqual(1.5);
    expect(dot.dist_from_disc_centre_radii).toBeLessThanOrEqual(1.0);
  });

  it("curvature response: smooth-shell control smears where the true cap dots", () => {
    const shell = report.cells["shell-room05"].dot;
    expect(shell.px).toBeGreaterThan(0);
    expect(shell.round_ratio).toBeGreaterThan(2.0);
  });

  it("limbal arc re-measured on the true cap (broad dim arc, not the smooth-sphere ring)", () => {
    const arc = report.cells["cap-room05"].ring.arc;
    expect(arc.peak_L).toBeGreaterThan(arc.median_L + 5);
    expect(arc.peak_deg).toBeGreaterThan(45);
    expect(arc.peak_deg).toBeLessThan(135);
    expect(report.wants.ring_arc_true_cap.fwhm_deg).toBeGreaterThan(
      report.wants.ring_arc_smooth_shell.fwhm_deg,
    );
  });

  it("parallax payoff: +/-25deg shift matches analytic within 15%", () => {
    for (const tag of ["p25", "m25"]) {
      expect(report.parallax[tag].rel_err_vs_analytic).toBeLessThanOrEqual(
        0.15,
      );
    }
  });

  it("suites re-pinned with reasons; rank-1 carried; socket stays open", () => {
    expect(manifest.suites.parallax).toMatch(/8\/8 GREEN/);
    expect(manifest.suites.compat).toMatch(/re-pinned/);
    expect(manifest.suites.corneaEnv).toMatch(/re-pinned/);
    expect(manifest.overlapMm).toMatch(/carried/);
    expect(report.not_tested.socket_showthrough_at_yaw).toMatch(
      /eye-globe-fit/,
    );
  });
});
