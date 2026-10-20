import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Reuse the colocated PNG helpers (identical math to the cornea-env h2
// gate). Colocated — not a cross-package relative import (architecture
// shrink-only freeze) and not counted toward xr-scene testInternalImports.
import {
  centroid,
  darkCoreCircle,
  largestCluster,
  luminance,
  luminanceLStar,
  rectFromArray,
  saturation,
  decodePngFile,
  type CropRect,
} from "./iris-png.js";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, "iris-upgrade-report.json");
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  texture: { file: string; sha256: string };
  renders: {
    store: string;
    crops: { Leye: [number, number, number, number]; Reye: [number, number, number, number]; cheek: [number, number, number, number]; forehead: [number, number, number, number] };
    irisCoreThresholdLStar: number;
    thresholdLuminance: number;
    storeShas: Record<string, string>;
  };
  rows: {
    new: {
      G2: Record<string, { hot230: number; hotCluster: number; spotMaxLum: number; meansat: number; hueDeg: number; irisCircle: { cx: number; cy: number; r: number }; ringMeanL: number }>;
      limbus: { ringDeltaVsBase: Record<string, number> };
      CW1: { cheekChangedVsBase: number; foreheadChangedVsBase: number };
    };
  };
};

const EYES_DIR = join(here, "..", "..", "..", "asset-pipeline", "eyes");
const sha256File = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");
const STORE = report.renders.store;
const storeExists = existsSync(STORE);
const png = (n: string): string => join(STORE, n);

function hotInDisc(on: ReturnType<typeof decodePngFile>, circle: { cx: number; cy: number; r: number }, threshold: number): { x: number; y: number }[] {
  const hot: { x: number; y: number }[] = [];
  for (let y = 0; y < on.h; y += 1) {
    for (let x = 0; x < on.w; x += 1) {
      if (Math.hypot(x - circle.cx, y - circle.cy) > circle.r) continue;
      if (luminance(on, x, y) > threshold) hot.push({ x, y });
    }
  }
  return hot;
}

function ringMean(on: ReturnType<typeof decodePngFile>, circle: { cx: number; cy: number; r: number }): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < on.h; y += 1) {
    for (let x = 0; x < on.w; x += 1) {
      const d = Math.hypot(x - circle.cx, y - circle.cy);
      if (d > circle.r + 1 && d <= circle.r + 7) {
        sum += luminanceLStar(on, x, y);
        n += 1;
      }
    }
  }
  return sum / Math.max(n, 1);
}

function countChanged(a: ReturnType<typeof decodePngFile>, b: ReturnType<typeof decodePngFile>, rect: CropRect): number {
  let changed = 0;
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        if (Math.abs(a.data[(y * a.w + x) * a.chans + ch]! - b.data[(y * b.w + x) * b.chans + ch]!) > 0) {
          changed += 1;
          break;
        }
      }
    }
  }
  return changed;
}

describe("the iris upgrade renders fibre and a dot", () => {
  it("report texture is the manifest chosen with matching sha", () => {
    const manifest = JSON.parse(readFileSync(join(EYES_DIR, "texture-manifest.json"), "utf8")) as {
      chosen: string;
    };
    expect(report.texture.file).toBe(manifest.chosen);
    expect(sha256File(join(EYES_DIR, report.texture.file))).toBe(report.texture.sha256);
  });

  it("manifest chosen row holds the centre and radius gates", () => {
    const manifest = JSON.parse(readFileSync(join(EYES_DIR, "texture-manifest.json"), "utf8")) as {
      chosen: string;
      textures: { file: string | null; pupil_shift_texels: [number, number]; limbus_radius_rel: [number, number]; pass: boolean }[];
    };
    const row = manifest.textures.find((r) => r.file === manifest.chosen)!;
    expect(row.pass).toBe(true);
    expect(row.pupil_shift_texels.every((v) => v <= 2.0)).toBe(true);
    expect(row.limbus_radius_rel.every((v) => v <= 0.02)).toBe(true);
  });

  it(storeExists ? "store shas verify" : "store absent — sha verification skipped", () => {
    if (!storeExists) return;
    for (const [name, want] of Object.entries(report.renders.storeShas)) {
      expect(existsSync(png(name)), `store file present: ${name}`).toBe(true);
      expect(sha256File(png(name)), `sha of ${name}`).toBe(want);
    }
  });

  it(storeExists ? "G2: a crisp 230+ cluster sits in each iris disc (re-measured)" : "store absent — G2 skipped", () => {
    if (!storeExists) return;
    const off = decodePngFile(png("iris-new-off-front.png"));
    const on = decodePngFile(png("iris-new-on-front.png"));
    expect(on.w).toBe(1280);
    const seeds: Record<string, [number, number]> = { L: [499, 707], R: [780, 708] };
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = report.rows.new.G2[eye]!;
      const rect: CropRect = rectFromArray(report.renders.crops[key as "Leye" | "Reye"]);
      const circle = darkCoreCircle(off, rect, seeds[eye]![0], seeds[eye]![1], report.renders.irisCoreThresholdLStar);
      expect(circle.cx).toBeCloseTo(g.irisCircle.cx, 1);
      expect(circle.cy).toBeCloseTo(g.irisCircle.cy, 1);
      expect(circle.r).toBeCloseTo(g.irisCircle.r, 1);
      const hot = hotInDisc(on, circle, report.renders.thresholdLuminance);
      expect(hot.length, `${eye} 230+ px in disc`).toBe(g.hot230);
      expect(largestCluster(hot), `${eye} dot cluster px`).toBe(g.hotCluster);
      expect(largestCluster(hot), `${eye} crisp bar (>= 20 px contiguous)`).toBeGreaterThanOrEqual(20);
      let satSum = 0;
      let n = 0;
      let mx = -Infinity;
      for (let y = 0; y < on.h; y += 1) {
        for (let x = 0; x < on.w; x += 1) {
          if (Math.hypot(x - circle.cx, y - circle.cy) > circle.r) continue;
          mx = Math.max(mx, luminance(on, x, y));
          satSum += saturation(on, x, y);
          n += 1;
        }
      }
      expect(Math.round(mx * 10) / 10, `${eye} brightest disc pixel`).toBe(g.spotMaxLum);
      expect(Math.round((satSum / Math.max(n, 1)) * 10000) / 10000, `${eye} iris meansat`).toBe(g.meansat);
      expect(g.meansat, `${eye} meansat beats the grey veil with margin`).toBeGreaterThanOrEqual(0.3);
      expect(g.meansat, `${eye} meansat stays below neon-red`).toBeLessThan(0.6);
      expect(g.hueDeg, `${eye} hue stays in the brown band`).toBeGreaterThanOrEqual(14);
      expect(g.hueDeg, `${eye} hue stays out of the red`).toBeLessThanOrEqual(26);
      const members = hot.filter((p) => hot.some((q) => q.x === p.x && q.y === p.y));
      const c = centroid(members);
      expect(Math.hypot(c.x - circle.cx, c.y - circle.cy), `${eye} dot centroid inside disc`).toBeLessThan(circle.r);
      const discArea = Math.PI * circle.r * circle.r;
      expect(largestCluster(hot) / discArea, `${eye} dot <= 15% of disc`).toBeLessThanOrEqual(0.15);
    }
  });

  it(storeExists ? "CW1: skin identical between textures (scoped globe change)" : "store absent — CW1 skipped", () => {
    if (!storeExists) return;
    const baseOn = decodePngFile(png("iris-base-on-front.png"));
    const newOn = decodePngFile(png("iris-new-on-front.png"));
    for (const key of ["cheek", "forehead"] as const) {
      const rect = rectFromArray(report.renders.crops[key]);
      const changed = countChanged(baseOn, newOn, rect);
      expect(changed, `${key} changed px`).toBe(report.rows.new.CW1[key === "cheek" ? "cheekChangedVsBase" : "foreheadChangedVsBase"]);
      expect(changed, `${key} skin must be pixel-identical`).toBe(0);
    }
  });

  it(storeExists ? "limbus: no new ring (annulus lift over the old texture is bounded)" : "store absent — limbus skipped", () => {
    if (!storeExists) return;
    const baseOn = decodePngFile(png("iris-base-on-front.png"));
    const newOn = decodePngFile(png("iris-new-on-front.png"));
    const off = decodePngFile(png("iris-new-off-front.png"));
    const seeds: Record<string, [number, number]> = { L: [499, 707], R: [780, 708] };
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = report.rows.new.G2[eye]!;
      const rect: CropRect = rectFromArray(report.renders.crops[key as "Leye" | "Reye"]);
      const circle = darkCoreCircle(off, rect, seeds[eye]![0], seeds[eye]![1], report.renders.irisCoreThresholdLStar);
      const ring = ringMean(newOn, circle);
      expect(Math.round(ring * 10) / 10, `${eye} annulus mean L*`).toBe(g.ringMeanL);
      const delta = ring - ringMean(baseOn, circle);
      expect(Math.round(delta * 10) / 10, `${eye} annulus lift over old texture`).toBe(report.rows.new.limbus.ringDeltaVsBase[eye]!);
      expect(delta, `${eye} no limbus ring (lift <= 12 L*)`).toBeLessThanOrEqual(12);
    }
  });

  it("known-bad: a grey-veil meansat fails the band", () => {
    const inBand = (v: number): boolean => v >= 0.3 && v < 0.6;
    expect(inBand(0.12), "grey veil 0.12 must fail the band").toBe(false);
    expect(inBand(0.5369), "new-iris 0.5369 must pass the band").toBe(true);
  });

  it("known-bad: a neon-red meansat fails the band", () => {
    const inBand = (v: number): boolean => v >= 0.3 && v < 0.6;
    expect(inBand(0.64), "control neon-red 0.64 must fail the band").toBe(false);
    expect(inBand(0.5213), "new-iris 0.5213 must pass the band").toBe(true);
  });
});
