import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const manifestPath = join(here, "geometric-eye-g4-manifest.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : null;

describe("the G4 lash re-seat follows blink on the new profile", () => {
  it("manifest exists with report, renders, and a green gate", () => {
    expect(manifest).not.toBeNull();
    expect(manifest.report.file).toMatch(/\.json$/);
    expect(Object.keys(manifest.renders)).toHaveLength(2);
    expect(manifest.gate).toMatch(/GREEN/);
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

  it("blink-follow holds on both sides with lashes shown", () => {
    for (const s of ["L", "R"]) {
      const row = manifest.blinkFollow[s];
      expect(row.lidMarginVerts).toBeGreaterThan(0);
      expect(row.sameDirection).toBe(true);
      expect(row.travelPct).toBeGreaterThanOrEqual(80);
    }
    const report = JSON.parse(
      readFileSync(join(here, manifest.report.file), "utf8"),
    );
    expect(report.blinkFollowPass).toBe(true);
    expect(report.lashPrimTargets).toBe(6);
  });

  it("T2b thins without hiding: keep ratios and dash-zone catch", () => {
    const report = JSON.parse(
      readFileSync(join(here, manifest.report.file), "utf8"),
    );
    for (const s of ["L", "R"]) {
      const row = report.t2b.sides[s];
      expect(row.cardsKeep / row.cardsBase).toBeGreaterThanOrEqual(0.95);
      expect(row.maxKeptTipDropMm).toBeLessThanOrEqual(row.tipDropThrMm);
      expect(row.maxKeptLenMm).toBeLessThanOrEqual(row.lenThrMm);
    }
    const dash = report.t2b.sides["R"].droppedCx.filter(
      (x: number) => x >= 0.028 && x <= 0.035,
    );
    expect(dash.length).toBeGreaterThanOrEqual(3);
  });

  it("seal inputs byte-identical and G3 seal re-pinned; rank-1 carried", () => {
    const report = JSON.parse(
      readFileSync(join(here, manifest.report.file), "utf8"),
    );
    expect(report.sealInvariance.bodyTargetsJsonIdentical).toBe(true);
    expect(report.sealInvariance.bodyPrims17PositionIdentical).toBe(true);
    expect(manifest.seal).toMatch(/re-pinned from G3/);
    expect(manifest.overlapMm).toMatch(/carried/);
  });
});
