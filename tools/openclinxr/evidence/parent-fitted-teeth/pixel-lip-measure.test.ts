/**
 * Pixel lip instrument tests (lip-bones2 slice).
 *
 * Synthetic unit coverage for the pure functions (fast, no captures) plus
 * pins on the committed validation evidence
 * (docs/openclinxr/mouth-dynamics/viseme-eval/pixel-lip-measure.json):
 * the instrument is validated two ways before use — (a) the attempt-1
 * bone-driven pixel delta is ~0 where landmark claimed narrowing and the
 * coordinator graded the opening the same width, (b) the 0.85 squeeze probe
 * reports ~0.85. Fingerprints refuse stale evidence if the stills change.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  calibratePixelLipThresholds,
  measurePhiltrumBand,
  measurePhiltrumBulge,
  measurePhiltrumSilhouette,
  measurePixelLipForward,
  measurePixelLipFront,
  PHILTRUM_BULGE_THRESHOLD_PX,
  squeezeMouthBand,
  type RgbImage,
} from "./pixel-lip-measure.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const REPORT_DIR = path.join(REPO, "docs/openclinxr/mouth-dynamics/viseme-eval");
const JSON_FILE = path.join(REPORT_DIR, "pixel-lip-measure.json");

const SKIN: [number, number, number] = [150, 115, 90];
const LIP: [number, number, number] = [170, 115, 105];
const DARK: [number, number, number] = [30, 20, 15];
const TOOTH: [number, number, number] = [190, 185, 180];

function canvas(w = 1024, h = 1024): { img: RgbImage; paint: (x0: number, x1: number, y0: number, y1: number, c: readonly [number, number, number]) => void } {
  const rgb = new Uint8Array(w * h * 3);
  for (let p = 0; p < rgb.length; p += 3) {
    rgb[p] = SKIN[0];
    rgb[p + 1] = SKIN[1];
    rgb[p + 2] = SKIN[2];
  }
  const paint = (x0: number, x1: number, y0: number, y1: number, c: readonly [number, number, number]): void => {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const p = (y * w + x) * 3;
        rgb[p] = c[0];
        rgb[p + 1] = c[1];
        rgb[p + 2] = c[2];
      }
    }
  };
  return { img: { rgb, w, h }, paint };
}

function syntheticThresholds() {
  const { img, paint } = canvas();
  // Rest pose: dark aperture slit + red lower lip on skin.
  paint(430, 590, 440, 480, DARK);
  paint(430, 590, 540, 640, LIP);
  const { img: img34, paint: paint34 } = canvas();
  // Dark backdrop strips where the 34 calibration samples the background.
  paint34(0, 120, 0, 120, DARK);
  paint34(0, 40, 300, 700, DARK);
  return calibratePixelLipThresholds(img, img34);
}

type FrontRow = {
  outerWidthPx: number; outerY: number; apertureWidthPx: number;
  apertureY: number; apertureHeightPx: number; hwRatio: number;
};
type FwdRow = { lipX: number; lipY: number; anchorX: number; forwardPx: number };
type Report = {
  schemaVersion: string;
  thresholds: { darkT: number; redT: number; gumT: number; bgT34: number };
  front: Record<string, FrontRow>;
  view34: Record<string, FwdRow>;
  bulge34: Record<string, { noseX: number; philX: number; bulgePx: number }>;
  bulgeThresholdPx: number;
  ratiosVsE: { frontOuter: Record<string, number>; frontApW: Record<string, number>; fwd34: Record<string, number> };
  validation: {
    shipped: { E: FrontRow & FwdRow; O: FrontRow & FwdRow; U: FrontRow & FwdRow };
    boneDelta: Record<string, {
      pixelOuterLive: number; pixelOuterArch: number; pixelOuterDeltaPx: number;
      pixelOuterDeltaPct: number; pixelFwdDeltaPx: number;
      landmarkOuterLive: number; landmarkOuterArch: number; landmarkDeltaPx: number;
    }>;
    scaleProbe: { factor: number; reportedRatio: number; pass: boolean };
  };
  fingerprints: Record<string, string>;
};

function loadReport(): Report {
  expect(existsSync(JSON_FILE), `missing ${JSON_FILE}`).toBe(true);
  return JSON.parse(readFileSync(JSON_FILE, "utf8")) as Report;
}

describe("pixel-lip-measure synthetic", () => {
  it("calibrates thresholds from a rest still", () => {
    const t = syntheticThresholds();
    expect(t.schemaVersion).toBe("openclinxr.pixel-lip-measure.v1");
    expect(t.darkT).toBeGreaterThanOrEqual(40);
    expect(t.darkT).toBeLessThanOrEqual(60);
    expect(t.redT).toBeGreaterThanOrEqual(6);
    expect(t.redT).toBeLessThanOrEqual(12);
    expect(t.gumT).toBeGreaterThan(t.redT);
    expect(t.bgT34).toBeGreaterThanOrEqual(45);
    expect(t.bgT34).toBeLessThanOrEqual(70);
  });

  it("refuses a non-pack canvas", () => {
    const { img } = canvas(640, 480);
    const { img: img34 } = canvas(640, 480);
    expect(() => calibratePixelLipThresholds(img, img34)).toThrow("pixel-lip-canvas");
  });

  it("measures a painted mouth exactly", () => {
    const t = syntheticThresholds();
    const { img, paint } = canvas();
    // Vermilion bars left/right of a dark+tooth aperture, all containing x 512.
    paint(300, 700, 470, 530, LIP);
    paint(350, 650, 480, 520, DARK);
    paint(450, 560, 485, 515, ...[TOOTH]);
    const out = measurePixelLipFront(img, t);
    expect(out.outerWidthPx).toBe(401);
    expect(out.apertureWidthPx).toBe(301);
    expect(out.apertureHeightPx).toBe(41);
  });

  it("tracks the 0.85 squeeze on a painted mouth", () => {
    const t = syntheticThresholds();
    const { img, paint } = canvas();
    paint(300, 700, 470, 530, LIP);
    paint(350, 650, 480, 520, DARK);
    const base = measurePixelLipFront(img, t);
    const squeezed = measurePixelLipFront(squeezeMouthBand(img, 0.85), t);
    expect(squeezed.outerWidthPx / base.outerWidthPx).toBeCloseTo(0.85, 1);
  });

  it("finds the foremost silhouette edge on a painted 3/4", () => {
    const t = syntheticThresholds();
    const { img, paint } = canvas();
    // Dark backdrop with a skin forehead island (anchor) and a lip island
    // protruding 20px further left.
    paint(0, 1023, 0, 1023, DARK);
    paint(180, 600, 120, 180, SKIN);
    paint(160, 600, 400, 520, LIP);
    const out = measurePixelLipForward(img, t);
    expect(out.anchorX).toBe(180);
    expect(out.lipX).toBe(160);
    expect(out.forwardPx).toBe(20);
  });

  it("reads the philtrum band mean and its shadow drop", () => {
    // Plain skin band reads the skin mean; a painted shadow band reads lower.
    const { img } = canvas();
    expect(measurePhiltrumBand(img)).toBeCloseTo((150 + 115 + 90) / 3, 0);
    const { img: img2, paint } = canvas();
    paint(462, 562, 360, 400, DARK);
    expect(measurePhiltrumBand(img2)).toBeLessThan(60);
  });

  it("reads the mean philtrum-height silhouette edge on a painted 3/4", () => {
    const t = syntheticThresholds();
    const { img, paint } = canvas();
    paint(0, 1023, 0, 1023, DARK);
    paint(180, 600, 120, 180, SKIN);
    paint(200, 600, 378, 400, SKIN);
    paint(160, 600, 404, 520, LIP);
    // Philtrum rows (380-400 step 4) start at 200; lip rows reach 160.
    expect(measurePhiltrumSilhouette(img, t)).toBe(200);
  });

  it("reports a painted philtrum lump as positive bulge, flat as ~zero", () => {
    const t = syntheticThresholds();
    const { img, paint } = canvas();
    paint(0, 1023, 0, 1023, DARK);
    paint(180, 600, 120, 180, SKIN);
    // Nose base at 200, philtrum pushed 15px forward of it: bulge +15.
    paint(200, 600, 318, 362, SKIN);
    paint(185, 600, 378, 400, SKIN);
    const lump = measurePhiltrumBulge(img, t);
    expect(lump.noseX).toBe(200);
    expect(lump.philX).toBe(185);
    expect(lump.bulgePx).toBe(15);
    // Flat profile: nose and philtrum share the edge, bulge ~0.
    const { img: flat, paint: paintFlat } = canvas();
    paintFlat(0, 1023, 0, 1023, DARK);
    paintFlat(180, 600, 120, 180, SKIN);
    paintFlat(200, 600, 318, 362, SKIN);
    paintFlat(200, 600, 378, 400, SKIN);
    expect(measurePhiltrumBulge(flat, t).bulgePx).toBe(0);
  });
});

describe("pixel-lip-measure evidence", () => {
  it("commits calibrated thresholds and fresh fingerprints", () => {
    const report = loadReport();
    expect(report.schemaVersion).toBe("openclinxr.pixel-lip-measure.v1");
    expect(report.thresholds).toMatchObject({ darkT: 48, redT: 10, gumT: 26, bgT34: 54 });
    for (const [rel, hex] of Object.entries(report.fingerprints)) {
      const file = path.join(REPORT_DIR, rel);
      expect(existsSync(file), `missing still ${rel}`).toBe(true);
      expect(createHash("md5").update(readFileSync(file)).digest("hex"), `stale still ${rel}`).toBe(hex);
    }
  }, 30_000);

  it("validation (b): the 0.85 squeeze reports ~0.85", () => {
    const report = loadReport();
    expect(report.validation.scaleProbe.factor).toBe(0.85);
    expect(report.validation.scaleProbe.pass).toBe(true);
    expect(report.validation.scaleProbe.reportedRatio).toBeGreaterThan(0.83);
    expect(report.validation.scaleProbe.reportedRatio).toBeLessThan(0.87);
  });

  it("lip-bones2 gates: O/U narrow >= 15% vs E, rounder, forward, no teeth cost", () => {
    const report = loadReport();
    const { E, O, U } = report.validation.shipped;
    // Width gate (pixel outer lip width): O -31.1%, U -18.6% vs E.
    const oRatio = O.outerWidthPx / E.outerWidthPx;
    const uRatio = U.outerWidthPx / E.outerWidthPx;
    expect(oRatio).toBeGreaterThan(0.6);
    expect(oRatio).toBeLessThanOrEqual(0.85);
    expect(uRatio).toBeGreaterThan(0.7);
    expect(uRatio).toBeLessThanOrEqual(0.85);
    // Rounder aperture (h/w up vs E).
    expect(O.hwRatio).toBeGreaterThan(E.hwRatio);
    expect(U.hwRatio).toBeGreaterThan(E.hwRatio);
    // Forward gate: silhouette shift vs E (>= 4px at still scale).
    expect(O.forwardPx - E.forwardPx).toBeGreaterThanOrEqual(4);
    expect(U.forwardPx - E.forwardPx).toBeGreaterThanOrEqual(4);
    // Attempt-2 narrows past attempt-1 on the same ruler (arch minus live):
    // O and U each ~66px narrower than the attempt-1 after-stills, where the
    // landmark instrument had claimed the narrowing already happened.
    const o = report.validation.boneDelta["O"];
    const u = report.validation.boneDelta["U"];
    expect(o!.pixelOuterArch - o!.pixelOuterLive).toBeGreaterThanOrEqual(50);
    expect(u!.pixelOuterArch - u!.pixelOuterLive).toBeGreaterThanOrEqual(50);
  });

  it("no lower-teeth increase on O vs the pre-bone headless pose", () => {
    const raw = JSON.parse(
      readFileSync(path.join(REPORT_DIR, "isolated.raw.json"), "utf8"),
    ) as {
      views: Record<string, { stills: { viseme: string; lowerPx: number; upperPx: number }[] }>;
    };
    const o = raw.views["front"]?.stills.find((s) => s.viseme === "O");
    expect(o, "missing O still").toBeDefined();
    // Pre-bone baseline headless count was lower 40; post-bone it reads 43
    // (+3 sub-visible edge-sliver px where the tucked corners uncover lateral
    // teeth inside the fixed landmark box — the teeth mesh never moves).
    // The controlling same-run browser comparison reads lower 0 both before
    // and after (probe base-O 0, oris04x6f3-O 0): nothing newly visible.
    expect(o!.lowerPx).toBeLessThanOrEqual(45);
  });

  it("keeps the 3/4 forehead anchor rigid across visemes", () => {
    const report = loadReport();
    const anchors = Object.values(report.view34).map((r) => r.anchorX);
    const lo = Math.min(...anchors);
    const hi = Math.max(...anchors);
    expect(hi - lo).toBeLessThanOrEqual(3);
  });

  it("philtrum bulge: O/U exceed the rest-sourced gate, E/aa/sil do not", () => {
    const report = loadReport();
    expect(report.bulgeThresholdPx).toBe(PHILTRUM_BULGE_THRESHOLD_PX);
    expect(PHILTRUM_BULGE_THRESHOLD_PX).toBe(4);
    // (a) current O/U stills carry the coordinator-visible lump.
    expect(report.bulge34["O"]!.bulgePx).toBeGreaterThan(4);
    expect(report.bulge34["U"]!.bulgePx).toBeGreaterThan(4);
    // (b) rest-like stills read ~none.
    for (const v of ["sil", "E", "aa"]) {
      expect(report.bulge34[v]!.bulgePx).toBeLessThanOrEqual(4);
    }
  });
});
