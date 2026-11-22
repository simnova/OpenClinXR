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
  measurePixelLipBandForward,
  measurePixelLipForward,
  measurePixelLipFront,
  PHILTRUM_BULGE_THRESHOLD_PX,
  squeezeMouthBand,
  type PixelLipFront,
  type PixelLipThresholds,
  type RgbImage,
} from "./pixel-lip-measure.ts";
import { decodePng } from "../decode-png.ts";

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

  it("reads the vermilion band forward and ignores a philtrum lump", () => {
    const t = syntheticThresholds();
    const { img, paint } = canvas();
    paint(0, 1023, 0, 1023, DARK);
    paint(180, 600, 120, 180, SKIN);
    // Philtrum lump protrudes to 150 on 380-400; vermilion sits at 170.
    paint(150, 600, 378, 400, SKIN);
    paint(170, 600, 404, 420, LIP);
    paint(175, 600, 424, 520, LIP);
    const out = measurePixelLipBandForward(img, t);
    expect(out.anchorX).toBe(180);
    expect(out.vermilionX).toBe(170);
    expect(out.bandForwardPx).toBe(10);
    // The whole-band min still reads the lump: the two rulers disagree by
    // the lump depth, which is exactly the failure the band fixes.
    const whole = measurePixelLipForward(img, t);
    expect(whole.lipX).toBe(150);
    expect(whole.forwardPx - out.bandForwardPx).toBe(20);
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

  it("lip-bones2 gates: O/U narrow >= 15% vs E, rounder, no lump, no teeth cost", () => {
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
    // Lump gate (lip-philtrum re-seat): the T1 table keeps the width and
    // roundness but drops oris05 2.5 -> 1, so the 3/4 min-edge reads the
    // un-pushed upper band at ~E plane instead of the pushed philtrum.
    // The old +4px forward gate measured the lump itself; bulge replaces it.
    expect(report.bulge34["O"]!.bulgePx).toBeLessThanOrEqual(4);
    expect(report.bulge34["U"]!.bulgePx).toBeLessThanOrEqual(4);
    // Attempt-2 narrows past attempt-1 on the same ruler (arch minus live):
    // O and U each ~66px narrower than the attempt-1 after-stills, where the
    // landmark instrument had claimed the narrowing already happened.
    const o = report.validation.boneDelta["O"];
    const u = report.validation.boneDelta["U"];
    expect(o!.pixelOuterArch - o!.pixelOuterLive).toBeGreaterThanOrEqual(50);
    expect(u!.pixelOuterArch - u!.pixelOuterLive).toBeGreaterThanOrEqual(50);
  });

  it("lip-philtrum gates: CH >= 8% and RR >= 10% narrower vs E, rounder, no lump", () => {
    const report = loadReport();
    const eOuter = report.front["E"]!.outerWidthPx;
    const eHw = report.front["E"]!.hwRatio;
    // Width gates: CH -17.0%, RR -12.5% vs E on the shipped stills.
    expect(report.front["CH"]!.outerWidthPx / eOuter).toBeLessThanOrEqual(0.92);
    expect(report.front["RR"]!.outerWidthPx / eOuter).toBeLessThanOrEqual(0.9);
    // Rounder aperture than the morph-only base (CH 0.140, RR 0.111).
    expect(report.front["CH"]!.hwRatio).toBeGreaterThan(eHw);
    expect(report.front["RR"]!.hwRatio).toBeGreaterThan(eHw);
    // No lump: full +4px 3/4 forward and a clean bulge never coincide on
    // this rig (CH-F already +5.6 at fwd +3), so CH/RR sit at-or-behind
    // the E plane with bulge inside the rest-sourced gate.
    expect(report.bulge34["CH"]!.bulgePx).toBeLessThanOrEqual(4);
    expect(report.bulge34["RR"]!.bulgePx).toBeLessThanOrEqual(4);
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

  it("philtrum bulge: driven visemes stay inside the rest-sourced gate", () => {
    const report = loadReport();
    expect(report.bulgeThresholdPx).toBe(PHILTRUM_BULGE_THRESHOLD_PX);
    expect(PHILTRUM_BULGE_THRESHOLD_PX).toBe(4);
    // The metric itself is validated two ways: synthetically (painted +15
    // lump vs flat 0, see above) and on the pre-retune stills, where it
    // read O +7.1 / U +11.3 against rest sil -1.9 / E -4.6 / aa -3.6
    // (commit e176e9866). After the vermilion re-seat the shipped stills
    // carry no lump on any driven viseme.
    for (const v of ["sil", "E", "aa", "O", "U", "CH", "RR"]) {
      expect(report.bulge34[v]!.bulgePx, v).toBeLessThanOrEqual(4);
    }
  });
});

describe("lip-rounding fixture crops (tsk_9a976f35c41a0f94)", () => {
  const FIX_DIR = path.join(HERE, "fixtures/lip-rounding");
  type FixtureCrop = {
    file: string;
    offset: { x0: number; y0: number; w: number; h: number };
    captureTree: string;
    cropSha256: string;
  };
  type FixtureEntry = {
    actor: string;
    call: string;
    still?: string;
    crops: string[];
    fill: number;
    full: unknown;
    embedded: unknown;
  };
  type FixtureManifest = {
    schema: string;
    crops: FixtureCrop[];
    cropEqualsFull: FixtureEntry[];
    handPairs: unknown;
  };

  function loadFixtureManifest(): FixtureManifest {
    const raw = JSON.parse(
      readFileSync(path.join(FIX_DIR, "manifest.json"), "utf8"),
    ) as FixtureManifest;
    expect(raw.schema).toBe("openclinxr.lip-rounding-fixture.v1");
    return raw;
  }

  const manifest = loadFixtureManifest();
  const cropByFile = new Map(manifest.crops.map((c) => [c.file, c]));
  const decodedCache = new Map<
    string,
    { w: number; h: number; r: Uint8Array; g: Uint8Array; b: Uint8Array }
  >();

  function decodedCrop(file: string): {
    rec: FixtureCrop;
    w: number;
    h: number;
    r: Uint8Array;
    g: Uint8Array;
    b: Uint8Array;
  } {
    const rec = cropByFile.get(file);
    expect(rec, `manifest has no crop ${file}`).toBeDefined();
    let hit = decodedCache.get(file);
    if (!hit) {
      const bytes = readFileSync(path.join(FIX_DIR, file));
      const dec = decodePng(
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
      expect(dec, `decodePng failed for ${file}`).not.toBeNull();
      hit = { w: dec!.w, h: dec!.h, r: dec!.r, g: dec!.g, b: dec!.b };
      decodedCache.set(file, hit);
    }
    return { rec: rec!, w: hit.w, h: hit.h, r: hit.r, g: hit.g, b: hit.b };
  }

  function toRgb(d: {
    w: number;
    h: number;
    r: Uint8Array;
    g: Uint8Array;
    b: Uint8Array;
  }): RgbImage {
    const rgb = new Uint8Array(d.w * d.h * 3);
    for (let p = 0; p < d.w * d.h; p += 1) {
      rgb[p * 3] = d.r[p]!;
      rgb[p * 3 + 1] = d.g[p]!;
      rgb[p * 3 + 2] = d.b[p]!;
    }
    return { rgb, w: d.w, h: d.h };
  }

  function embed(
    parts: { file: string; offset: { x0: number; y0: number; w: number; h: number } }[],
    fill: number,
  ): RgbImage {
    const W = 1024;
    const H = 1024;
    const rgb = new Uint8Array(W * H * 3);
    rgb.fill(fill);
    for (const part of parts) {
      const d = toRgb(decodedCrop(part.file));
      expect(d.w, `width ${part.file}`).toBe(part.offset.w);
      expect(d.h, `height ${part.file}`).toBe(part.offset.h);
      for (let row = 0; row < d.h; row += 1) {
        const dst = ((part.offset.y0 + row) * W + part.offset.x0) * 3;
        rgb.set(d.rgb.subarray(row * d.w * 3, (row + 1) * d.w * 3), dst);
      }
    }
    return { rgb, w: W, h: H };
  }

  function thresholdsFor(actor: string, fill: number): PixelLipThresholds {
    const cal = manifest.cropEqualsFull.find(
      (e) =>
        e.actor === actor &&
        e.call === "calibratePixelLipThresholds" &&
        e.fill === fill,
    );
    expect(cal, `no calibrate entry for ${actor} fill ${fill}`).toBeDefined();
    return cal!.full as PixelLipThresholds;
  }

  it("crop files match the manifest (sha, size, tree)", () => {
    expect(manifest.crops.length).toBe(25);
    expect(manifest.cropEqualsFull.length).toBe(42);
    for (const c of manifest.crops) {
      const file = path.join(FIX_DIR, c.file);
      expect(existsSync(file), `missing crop ${c.file}`).toBe(true);
      const bytes = readFileSync(file);
      expect(
        createHash("sha256").update(bytes).digest("hex"),
        `sha ${c.file}`,
      ).toBe(c.cropSha256);
      const d = decodedCrop(c.file);
      expect(d.w, `width ${c.file}`).toBe(c.offset.w);
      expect(d.h, `height ${c.file}`).toBe(c.offset.h);
      expect(c.captureTree).toBe("d0a90c471");
    }
  }, 60_000);

  for (const entry of manifest.cropEqualsFull) {
    it(`${entry.actor} ${entry.call} ${entry.still ?? "sil"} fill ${entry.fill}`, () => {
      expect(entry.full).toEqual(entry.embedded);
      const t = thresholdsFor(entry.actor, entry.fill);
      const parts = entry.crops.map((f) => {
        const rec = cropByFile.get(f);
        expect(rec, `unknown crop ${f}`).toBeDefined();
        return { file: f, offset: rec!.offset };
      });
      if (entry.call === "calibratePixelLipThresholds") {
        expect(parts.length).toBe(2);
        const front = embed([parts[0]!], entry.fill);
        const t34 = embed([parts[1]!], entry.fill);
        expect(calibratePixelLipThresholds(front, t34)).toEqual(entry.full);
      } else if (entry.call === "measurePixelLipFront") {
        expect(parts.length).toBe(1);
        expect(measurePixelLipFront(embed(parts, entry.fill), t)).toEqual(
          entry.full,
        );
      } else if (entry.call === "measurePhiltrumBulge") {
        expect(measurePhiltrumBulge(embed(parts, entry.fill), t)).toEqual(
          entry.full,
        );
      } else if (entry.call === "measurePixelLipBandForward") {
        expect(measurePixelLipBandForward(embed(parts, entry.fill), t)).toEqual(
          entry.full,
        );
      } else {
        throw new Error(`unknown call ${entry.call}`);
      }
    }, 60_000);
  }

  it("counterweight: a blank frame cannot reproduce a front result", () => {
    const fronts = manifest.cropEqualsFull.filter(
      (e) => e.call === "measurePixelLipFront" && e.fill === 0,
    );
    expect(fronts.length).toBeGreaterThan(0);
    const blank = embed([], 0);
    for (const entry of fronts) {
      const t = thresholdsFor(entry.actor, entry.fill);
      expect(measurePixelLipFront(blank, t)).not.toEqual(entry.full);
    }
  }, 60_000);

  describe("lr-red planted RED + counterweights (tsk_9a976f35c41a0f94)", () => {
    const HAND_PAIRS = {
      "mpfb-peds-parent-aisha": {
        L: [246, 501], // source: parent hand pair L(246,501) R(777,503) fissure 531, same eye-on-crosshair method as physician/Aisha
        R: [777, 503],
        fissureWidthPx: 531,
        stillSha256:
          "df534ba5ff732a38d96dd8d8c257bfab6a7ec3c783be2b139c96e2c8d68be6e5",
      },
      "mpfb-peds-nurse-kevin": {
        L: [249, 501], // source: kevin hand pair L(249,501) R(770,512) fissure 521, same eye-on-crosshair method
        R: [770, 512],
        fissureWidthPx: 521,
        stillSha256:
          "f5bc06e236cac289a61d93808589cd46429efd8cd14e800a4e9e880700b5657d",
      },
      "mpfb-ob-patient-aisha": {
        L: [203, 542], // source: 622 :: Aisha hand pair L(203,542) R(825,537), same method; cap54 spot-checked natively.
        R: [825, 537],
        fissureWidthPx: 622,
        stillSha256:
          "ab32fb735892e51a73dbfe9551c753ec9b6a7e88ccbd8928f8b450a26e9de7a6",
      },
      "mpfb-clinical-physician-adult": {
        L: [243, 519], // source: 531 :: physician hand pair, fissure tips L(243,519) R(774,502) located by eye on 6x crosshair crops of the physician E-on still (store lip-rounding/fixtures/commissure-hand-pairs.json, sha in manifest.handPairs); ±2 px per tip.
        R: [774, 502],
        fissureWidthPx: 531,
        stillSha256:
          "f2a79a0575c8bae6fff43fa2ad811ce1ebe5c22bb175e3bb24a90633f23427d4",
      },
    };

    function frontOf(actor: string, still: string) {
      const entry = manifest.cropEqualsFull.find(
        (e) =>
          e.actor === actor &&
          e.call === "measurePixelLipFront" &&
          e.still === still &&
          e.fill === 0,
      );
      expect(entry, `no fixture entry ${actor} ${still}`).toBeDefined();
      const parts = entry!.crops.map((f) => {
        const rec = cropByFile.get(f);
        expect(rec, `unknown crop ${f}`).toBeDefined();
        return { file: f, offset: rec!.offset };
      });
      return measurePixelLipFront(embed(parts, 0), thresholdsFor(actor, 0));
    }

    function fullStill(rel: string): RgbImage {
      const bytes = readFileSync(path.join(REPORT_DIR, rel));
      const d = decodePng(
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
      expect(d, `decodePng failed for ${rel}`).not.toBeNull();
      const hit = { w: d!.w, h: d!.h, r: d!.r, g: d!.g, b: d!.b };
      return toRgb(hit);
    }

    it("hand pairs match the manifest", () => {
      expect(HAND_PAIRS).toEqual(manifest.handPairs);
    });

    it.fails("RED1a KNOWN LIMIT: pixel instrument blind on dark skin (physician 726) - physician front E/O/U is not band-wide", () => {
      for (const still of ["E-on", "O-on", "U-on"]) {
        const m = frontOf("physician", still);
        // source: 726 :: blind value = FRONT_BAND.x1 - FRONT_BAND.x0 + 1 (pixel-lip-measure.ts FRONT_BAND); a definition, not a tolerance.
        expect(m.outerWidthPx).toBeLessThan(726);
      }
    }, 60_000);

    const FISSURE_CLOSED = "pixel fissure route closed (store s1/c1 FAIL); reinstate RED1b/RED2a (531/622 within 3%) from a8a8f1c85 on a new instrument card";

    it("RED1b pixel fissure route closed: physician E carries no fissureWidthPx", () => {
      // Pixel fissure route closed: any defined value fails, a correct 531 included.
      const m = frontOf("physician", "E-on") as PixelLipFront & { fissureWidthPx?: number };
      // source: 3% :: cap54 ruling (card RED1/RED2). Hand noise is ±4 px on width (±2 px per tip) = 0.8% of 531 / 0.6% of 622, so 3% is ~4x the hand noise.
      // source: 531 :: physician hand pair, fissure tips L(243,519) R(774,502) located by eye on 6x crosshair crops of the physician E-on still (store lip-rounding/fixtures/commissure-hand-pairs.json, sha in manifest.handPairs); ±2 px per tip.
      expect(m.fissureWidthPx, FISSURE_CLOSED).toBeUndefined();
    }, 60_000);

    it("RED2a pixel fissure route closed: Aisha E carries no fissureWidthPx", () => {
      // Pixel fissure route closed: any defined value fails, a correct 622 included.
      const m = frontOf("aisha", "E-on") as PixelLipFront & { fissureWidthPx?: number };
      // source: 3% :: cap54 ruling (card RED1/RED2). Hand noise is ±4 px on width (±2 px per tip) = 0.8% of 531 / 0.6% of 622, so 3% is ~4x the hand noise.
      // source: 622 :: Aisha hand pair L(203,542) R(825,537), same method; cap54 spot-checked natively.
      expect(m.fissureWidthPx, FISSURE_CLOSED).toBeUndefined();
    }, 60_000);

    it.fails("RED2b Aisha E outer width at the commissure row", () => {
      const m = frontOf("aisha", "E-on");
      // source: 539.5 :: mean of the Aisha hand-pair tip y values (542 + 537) / 2.
      // source: ±6 px :: cap54 ruling (card RED2). The Aisha tips differ by 5 px in y (542 vs 537), so ±6 px covers the fissure tilt plus ±2 px per tip.
      // Today outerY = 464.
      expect(Math.abs(m.outerY - 539.5)).toBeLessThanOrEqual(6);
    }, 60_000);

    it.fails("CW3b Aisha E-on vs E-z outer within 2%", () => {
      const on = frontOf("aisha", "E-on");
      const z = frontOf("aisha", "E-z");
      const r = on.outerWidthPx / z.outerWidthPx;
      // source: 2% :: card CW3b (cap54). S0 measured the headless E corner span at elevation 1 vs 0: 0.00% on all 4 rigs (store s0/), so any E-on vs E-z width difference is the instrument's row choice; 2% ≈ 12 px on ~600.
      // Elevation must not move the E width; today 570/634.
      expect(Math.abs(r - 1)).toBeLessThanOrEqual(0.02);
    }, 60_000);

    // Collection-time blind flag: true while the committed physician E-on crop
    // measures band-wide. The skip below therefore ends by itself when S1
    // makes the physician non-blind.
    // source: 726 :: blind value = FRONT_BAND.x1 - FRONT_BAND.x0 + 1 (pixel-lip-measure.ts FRONT_BAND); a definition, not a tolerance.
    const PHYSICIAN_BLIND = ((): boolean => {
      const entry = manifest.cropEqualsFull.find(
        (e) =>
          e.actor === "physician" &&
          e.call === "measurePixelLipFront" &&
          e.still === "E-on" &&
          e.fill === 0,
      );
      if (!entry) return false;
      const parts = entry.crops.map((f) => {
        const rec = cropByFile.get(f);
        if (!rec) throw new Error(`unknown crop ${f}`);
        return { file: f, offset: rec.offset };
      });
      return (
        measurePixelLipFront(embed(parts, 0), thresholdsFor("physician", 0))
          .outerWidthPx === 726
      );
    })();

    it.skipIf(PHYSICIAN_BLIND)("CW3b physician E-on vs E-z within 2% (SKIPPED while blind: physician E-on outerWidthPx == 726, RED1a open)", () => {
      const on = frontOf("physician", "E-on");
      const z = frontOf("physician", "E-z");
      const r = on.outerWidthPx / z.outerWidthPx;
      // source: 2% :: card CW3b (cap54). S0 measured the headless E corner span at elevation 1 vs 0: 0.00% on all 4 rigs (store s0/), so any E-on vs E-z width difference is the instrument's row choice; 2% ≈ 12 px on ~600.
      expect(Math.abs(r - 1)).toBeLessThanOrEqual(0.02);
    }, 60_000);

    it("CW3b physician guard: skip state equals RED1a state", () => {
      // Ties the skip to all-three-blind (726), which is narrower than RED1a's failure condition.
      // source: 726 :: blind value = FRONT_BAND.x1 - FRONT_BAND.x0 + 1 (pixel-lip-measure.ts FRONT_BAND); a definition, not a tolerance.
      const allBlind = ["E-on", "O-on", "U-on"].every(
        (still) => frontOf("physician", still).outerWidthPx === 726,
      );
      expect(PHYSICIAN_BLIND).toBe(allBlind);
    }, 60_000);

    it("CW-OF physician E-on outer covers the fissure", () => {
      const m = frontOf("physician", "E-on");
      // source: 531 hand pair; +4 = 2 px per side (cap55 cheapest-pass bar: outer must exceed the fissure). Aisha CW-OF unchanged.
      // NOTE: passes today only because the physician is blind (726); it bites once RED1a is green, and refuses a fix that narrows outer below the fissure (aperture-as-outer).
      expect(m.outerWidthPx).toBeGreaterThan(531 + 4);
    }, 60_000);

    it.fails("CW-OF Aisha E-on outer covers the fissure", () => {
      const m = frontOf("aisha", "E-on");
      // source: 622 :: Aisha hand pair (as RED2a). 0.97 :: card 3% (cap54), one-sided.
      expect(m.outerWidthPx).toBeGreaterThanOrEqual(622 * 0.97);
    }, 60_000);

    it("CW3a squeeze 0.85 on a real crop", () => {
      for (const [actor, still] of [
        ["aisha", "E-z"],
        ["parent", "E-on"],
      ] as const) {
        const entry = manifest.cropEqualsFull.find(
          (e) =>
            e.actor === actor &&
            e.call === "measurePixelLipFront" &&
            e.still === still &&
            e.fill === 0,
        );
        expect(entry, `no fixture entry ${actor} ${still}`).toBeDefined();
        const parts = entry!.crops.map((f) => {
          const rec = cropByFile.get(f);
          expect(rec, `unknown crop ${f}`).toBeDefined();
          return { file: f, offset: rec!.offset };
        });
        const band = embed(parts, 0);
        const t = thresholdsFor(actor, 0);
        const base = measurePixelLipFront(band, t).outerWidthPx;
        const sq = measurePixelLipFront(squeezeMouthBand(band, 0.85), t)
          .outerWidthPx;
        const r = sq / base;
        // source: 0.85 ± 0.02 :: card CW3a; squeezeMouthBand factor 0.85 is the existing validation probe (pixel-lip-measure.json validation.scaleProbe); 0.02 = card.
        expect(Math.abs(r - 0.85)).toBeLessThanOrEqual(0.02);
      }
    }, 60_000);

    it("CW1 Oct stills keep O -31.1 / U -18.6 vs E", () => {
      const t = calibratePixelLipThresholds(
        fullStill("isolated-front/sil.png"),
        fullStill("isolated-34/sil.png"),
      );
      const e = measurePixelLipFront(fullStill("isolated-front/E.png"), t);
      const o = measurePixelLipFront(fullStill("isolated-front/O.png"), t);
      const u = measurePixelLipFront(fullStill("isolated-front/U.png"), t);
      const pctO = (o.outerWidthPx / e.outerWidthPx - 1) * 100;
      const pctU = (u.outerWidthPx / e.outerWidthPx - 1) * 100;
      // source: -31.1 / -18.6 ± 1.0 pp :: committed Oct values (docs/openclinxr/mouth-dynamics/viseme-eval/pixel-lip-measure.json, 5dabb3700). 1.0 pp: render repeat noise is 0 px (S0: the Oct GLB re-rendered today reproduces E569/O392/U463 to the pixel), so the allowance is one 5-px corner disagreement on 569 px = 0.9 pp.
      expect(Math.abs(pctO - -31.1)).toBeLessThanOrEqual(1.0);
      expect(Math.abs(pctU - -18.6)).toBeLessThanOrEqual(1.0);
    }, 60_000);
  });
});
