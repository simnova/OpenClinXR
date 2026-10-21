import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Arch: this gate imports exactly one colocated helper (./catchlight-png.js,
// unreachable from the package entrypoint, so it does not count toward
// testInternalImports — same posture as skin-shader/png-crop.js) plus node
// builtins. It NEVER imports ../isolated-subject-rig-variants.js: that
// module is entrypoint-reachable (via isolated-subject-lab.js) and the
// ceiling (10) must not rise, so the fix is pinned by source hash + source
// text instead of by import.
import {
  centroid,
  connectedWhere,
  countChangedPx,
  decodePngFile,
  diffSpot,
  dilatePixels,
  darkCoreCircle,
  globeSilhouette,
  highlightBlob,
  largestCluster,
  luminance,
  luminanceLStar,
  luminanceQuantile,
  meanAbsLumaDiff,
  meanLStarOf,
  medianLStarOf,
  rectFromArray,
  saturation,
  type CropRect,
  type DecodedPng,
  type Pixel,
} from "./catchlight-png.js";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, "catchlight-report.json");
const moduleRel = "../isolated-subject-rig-variants.ts";
const modulePath = join(here, moduleRel);
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  module: string;
  moduleSha256: string;
  store: string;
  renders: Record<string, { png: string; sha256: string }>;
  crops: { Leye: [number, number, number, number]; Reye: [number, number, number, number]; cheek: [number, number, number, number]; forehead: [number, number, number, number] };
  faceCrop: [number, number, number, number];
  faceP99: number;
  G1: Record<string, { changedPx: number; meanDL: number }>;
  G2: Record<string, { silPx: number; silBbox: [number, number, number, number]; seed: [number, number]; threshold: number; dilation: number; blobCount: number; blobCentroid: [number, number]; blobMeanL00: number; blobMeanL06: number }>;
  CW1: Record<string, { post00Changed: number; post00MeanDL: number; post06Changed: number; post06MeanDL: number }>;
  CW2: {
    post06GlobeEnvMap: { matched: string[]; envMapSet: boolean };
    post06EyeEnvMapIntensity: number;
    post00EyeEnvMapIntensity: number;
    post06EnvironmentMap: boolean;
  };
  falsifier: { pre00vsPre06ChangedTotal: number; pre00vsPre06EyeBandChanged: number; verdict: string };
  storeShas: Record<string, string>;
  h1: {
    renders: Record<string, { png: string; sha256: string }>;
    store: string;
    G2: Record<string, {
      spotPx: number; spotCentroid: [number, number]; spotMaxL: number;
      irisCircle: { cx: number; cy: number; r: number };
      centroidInDisc: boolean; spotFracOfDisc: number;
      scleraPx: number; scleraMedianL00: number; scleraMeanL00: number; scleraMeanL06: number; scleraDelta: number;
      eyeCropChanged: number;
    }>;
    CW1: Record<string, { h100vsPreChanged: number; h100vsPreMeanDL: number }>;
    CW2: {
      h106GlobeEnvMap: { matched: string[]; envMapSet: boolean; roughnessDisc: { inner: number; outer: number; radiusUv: number; featherUv: number } | null };
      h106EyeEnvMapIntensity: number;
      h100EyeEnvMapIntensity: number;
      h1EyeRoughnessScalar: number;
    };
    storeShas: Record<string, string>;
    spotThresholdDeltaLStar: number;
    irisCoreThresholdLStar: number;
  };
  h2: {
    renders: Record<string, { png: string; sha256: string }>;
    store: string;
    cause: string;
    G2: Record<string, {
      hot230: number; hotCluster: number; hotCentroid: [number, number];
      spotMaxLum: number; meansat: number;
      irisCircle: { cx: number; cy: number; r: number };
      centroidInDisc: boolean; distFromCentre: number; spotFracOfDisc: number;
      ringMeanL: number; ringDeltaOld: number;
    }>;
    CW1: Record<string, { h206vsPreChanged: number; h206vsPreMeanDL: number }>;
    counterweight: { oldH106: Record<string, { hot230: number; hotCluster: number }>; note: string };
    visualGrade: string;
    thresholdLuminance: number;
    irisCoreThresholdLStar: number;
    storeShas: Record<string, string>;
  };
};
const sha256File = (p: string): string =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const STORE = report.store;
const storeExists = existsSync(STORE);
const storePng = (key: string): string => join(STORE, report.renders[key]!.png);
const storeJson = (key: string): string => {
  // Variant records sit beside the renders: <id>.json for post, pre-<id>.json for pre.
  const name = key === "pre00" ? "pre-catch-eye00.json" : key === "post00" ? "catch-eye00.json" : "catch-eye06.json";
  return join(STORE, name);
};

describe("the cornea env intensity changes the globe", () => {
  it("report module sha matches the shipped source", () => {
    expect(report.module).toBe("packages/openclinxr/xr-scene/src/isolated-subject-rig-variants.ts");
    expect(sha256File(modulePath)).toBe(report.moduleSha256);
  });

  it("source sets a scoped globe envMap on the product path (no scene.environment there)", () => {
    const src = readFileSync(modulePath, "utf8");
    const fnIdx = src.indexOf("export async function applyProductRig");
    expect(fnIdx, "applyProductRig present").toBeGreaterThanOrEqual(0);
    const body = src.slice(fnIdx);
    expect(body, "PMREM RoomEnvironment source reused").toMatch(/new RoomEnvironment\(\)/);
    expect(body, "globe envMap assignment present").toMatch(/\.envMap = globeEnv/);
    expect(body, "h1 iris-disc roughnessMap present").toMatch(/roughnessMap = roughDisc/);
    expect(body, "disc texel pinned").toMatch(/ROUGH_DISC_INNER/);
    expect(src, "iris UV numerals duplicated by design (no eye-parallax import)").toMatch(/Duplicated here, NOT imported from \.\/eye-shader\/eye-parallax\.js/);
    expect(src, "no eye-parallax import (ceiling 10)").not.toMatch(/from "\.\/eye-shader\/eye-parallax\.js"/);
    expect(body, "globe readback returned").toMatch(/globeEnvMap: \{/);
    expect(body, "product path must not set scene.environment").not.toMatch(/scene\.environment =/);
  });

  it(storeExists ? "G1: product rig 0.6 vs 0.0 eye buffers differ in both globe crops" : "store absent — G1 skipped", () => {
    if (!storeExists) return;
    expect(sha256File(storePng("post00"))).toBe(report.renders["post00"]!.sha256);
    expect(sha256File(storePng("post06"))).toBe(report.renders["post06"]!.sha256);
    const off = decodePngFile(storePng("post00"));
    const on = decodePngFile(storePng("post06"));
    expect(off.w).toBe(1280);
    for (const eye of ["L", "R"] as const) {
      const key = eye === "L" ? "Leye" : "Reye";
      const rect = rectFromArray(report.crops[key]);
      const changed = countChangedPx(off, on, rect);
      expect(changed, `${eye} globe crop changed px`).toBe(report.G1[eye]!.changedPx);
      expect(changed, `${eye} globe crop must differ`).toBeGreaterThan(0);
      expect(meanAbsLumaDiff(off, on, rect)).toBeCloseTo(report.G1[eye]!.meanDL, 2);
    }
  });

  it(storeExists ? "G2: a highlight blob sits on each globe at 0.6" : "store absent — G2 skipped", () => {
    if (!storeExists) return;
    const off = decodePngFile(storePng("post00"));
    const on = decodePngFile(storePng("post06"));
    const face = rectFromArray(report.faceCrop);
    expect(luminanceQuantile(on, face, 0.99)).toBeCloseTo(report.faceP99, 1);
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = report.G2[eye]!;
      const rect: CropRect = rectFromArray(report.crops[key as "Leye" | "Reye"]);
      const sil = globeSilhouette(off, rect, g.seed[0], g.seed[1], g.threshold, g.dilation);
      expect(sil.length, `${eye} silhouette px`).toBe(g.silPx);
      const blob = highlightBlob(on, off, sil, report.faceP99, 4);
      expect(blob.length, `${eye} blob count`).toBe(g.blobCount);
      expect(blob.length, `${eye} blob present`).toBeGreaterThan(0);
      const c = centroid(blob);
      expect(c.x).toBeCloseTo(g.blobCentroid[0], 0);
      expect(c.y).toBeCloseTo(g.blobCentroid[1], 0);
      expect(largestCluster(blob), `${eye} blob is one contiguous highlight`).toBeGreaterThanOrEqual(Math.floor(g.blobCount * 0.8));
    }
  });

  it(storeExists ? "CW1: cheek and forehead are untouched (scoped env)" : "store absent — CW1 skipped", () => {
    if (!storeExists) return;
    const pre = decodePngFile(storePng("pre00"));
    const off = decodePngFile(storePng("post00"));
    const on = decodePngFile(storePng("post06"));
    for (const key of ["cheek", "forehead"] as const) {
      const rect = rectFromArray(report.crops[key]);
      const c = report.CW1[key]!;
      expect(countChangedPx(pre, off, rect), `${key} env-set-vs-unset changed px`).toBe(c.post00Changed);
      expect(meanAbsLumaDiff(pre, off, rect)).toBe(c.post00MeanDL);
      expect(countChangedPx(pre, on, rect), `${key} 0.6-vs-unset changed px`).toBe(c.post06Changed);
      expect(c.post00Changed, `${key} skin must be pixel-identical`).toBe(0);
      expect(c.post06Changed, `${key} skin must be pixel-identical at 0.6`).toBe(0);
    }
  });

  it(storeExists ? "CW2: globe envMap readback is set while intensity landed" : "store absent — CW2 skipped", () => {
    if (!storeExists) return;
    // Proven by live readback in the recorded variant JSONs, not by source:
    // the product rig reports the scoped globe envMap, and the material
    // override reports the intensity that now drives it.
    for (const [key, wantIntensity] of [["post00", 0], ["post06", 0.6]] as const) {
      const record = JSON.parse(readFileSync(storeJson(key), "utf8")) as {
        environmentMap: boolean;
        productRig: { globeEnvMap: { matched: string[]; envMapSet: boolean } };
        materialOverridesApplied: Array<{ readback: Array<{ envMapIntensity: number }> }>;
      };
      expect(record.productRig.globeEnvMap.envMapSet, `${key} globe envMap set`).toBe(true);
      expect(record.productRig.globeEnvMap.matched.length, `${key} one globe slot`).toBe(1);
      expect(record.materialOverridesApplied[0]!.readback[0]!.envMapIntensity, `${key} eye intensity`).toBe(wantIntensity);
    }
    expect(report.CW2.post06GlobeEnvMap.envMapSet).toBe(true);
    expect(report.CW2.post06EyeEnvMapIntensity).toBe(0.6);
  });

  it(storeExists ? "falsifier: pre-fix 0.6 vs 0.0 did not differ on the globe" : "store absent — falsifier skipped", () => {
    if (!storeExists) return;
    const pre0 = decodePngFile(storePng("pre00"));
    const pre6 = decodePngFile(join(STORE, report.renders["pre06"]!.png));
    let total = 0;
    for (let y = 0; y < pre0.h; y += 1) {
      for (let x = 0; x < pre0.w; x += 1) {
        for (let ch = 0; ch < 3; ch += 1) {
          if (Math.abs(pre0.data[(y * pre0.w + x) * pre0.chans + ch]! - pre6.data[(y * pre6.w + x) * pre6.chans + ch]!) > 0) {
            total += 1;
            break;
          }
        }
      }
    }
    expect(total).toBe(report.falsifier.pre00vsPre06ChangedTotal);
    for (const key of ["Leye", "Reye"] as const) {
      expect(countChangedPx(pre0, pre6, rectFromArray(report.crops[key])), `pre-fix ${key} unchanged`).toBe(0);
    }
    expect(report.falsifier.verdict).toBe("premise_holds");
  });

  it(storeExists ? "store shas verify (assets:eye-catchlight/)" : "store absent — sha verification skipped", () => {
    if (!storeExists) return;
    for (const [key, want] of Object.entries(report.storeShas)) {
      const p = join(STORE, report.renders[key]!.png);
      expect(existsSync(p), `store file present: ${report.renders[key]!.png}`).toBe(true);
      expect(sha256File(p), `sha of ${report.renders[key]!.png}`).toBe(want);
    }
  });
});

const H1STORE = report.h1.store;
const h1Exists = existsSync(H1STORE);
const h1Png = (key: "h100" | "h106"): string => join(H1STORE, report.h1.renders[key]!.png);

function h1Sclera(opening: DecodedPng, rect: CropRect, seed: [number, number]): { x: number; y: number }[] {
  // Sclera = the dilated eye opening restricted to bright globe (00-L*>=70):
  // iris/pupil/lash fall out, lid skin never enters (only globe pixels move).
  const core = connectedWhere(rect, seed[0], seed[1], (x, y) => luminanceLStar(opening, x, y) < 60);
  return dilatePixels(core, rect, 12).filter((p) => luminanceLStar(opening, p.x, p.y) >= 70);
}

describe("h1: the catch-light is a specular spot over the iris disc", () => {
  it("cause: scalar roughness unchanged, disc effective roughness lowered by map", () => {
    // Iris numerals are duplicated (not imported) in the rig module to keep
    // eye-parallax entrypoint-unreachable (ceiling 10): pin the literals in
    // both files by text so a drift fails here, not silently in a render.
    const eyeSrc = readFileSync(join(here, "../eye-shader/eye-parallax.ts"), "utf8");
    const rigSrc = readFileSync(modulePath, "utf8");
    for (const lit of ["299.55 / 1024", "300.0 / 1024", "724.65 / 1024", "721.28 / 1024", "135 / 1024", "30 / 1024"]) {
      expect(rigSrc, `rig module cites ${lit}`).toContain(lit);
    }
    // eye-shader-wire h1 (a010da05f) re-stated eye-parallax's centres in pixels
    // from the image top (A 724.00, B 302.72). The rig module keeps the opposite
    // v origin, so the two must be mirrors: 1024 - 300.0 = 724.0 and
    // 1024 - 721.28 = 302.72. Pin that relation, not shared literals.
    for (const lit of ["299.55 / 1024", "724.0 / 1024", "724.65 / 1024", "302.72 / 1024", "135 / 1024", "30 / 1024"]) {
      expect(eyeSrc, `eye-parallax cites ${lit}`).toContain(lit);
    }
    expect(report.h1.CW2.h1EyeRoughnessScalar, "globe scalar still 0.5 (sclera untouched)").toBe(0.5);
    const disc = report.h1.CW2.h106GlobeEnvMap.roughnessDisc;
    expect(disc, "procedural disc read back").not.toBeNull();
    expect(disc!.inner).toBe(0.12);
    expect(disc!.outer).toBe(1);
    expect(disc!.radiusUv).toBeCloseTo(135 / 1024, 8);
    expect(disc!.featherUv).toBeCloseTo(30 / 1024, 8);
    expect(report.h1.CW2.h106GlobeEnvMap.envMapSet).toBe(true);
    expect(report.h1.CW2.h106EyeEnvMapIntensity).toBe(0.6);
    expect(report.h1.CW2.h100EyeEnvMapIntensity).toBe(0);
  });

  it(h1Exists ? "G2a: a connected D>=25 L* spot sits in each eye crop" : "h1 store absent — G2a skipped", () => {
    if (!h1Exists) return;
    expect(sha256File(h1Png("h100"))).toBe(report.h1.renders["h100"]!.sha256);
    expect(sha256File(h1Png("h106"))).toBe(report.h1.renders["h106"]!.sha256);
    const off = decodePngFile(h1Png("h100"));
    const on = decodePngFile(h1Png("h106"));
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = report.h1.G2[eye]!;
      const rect = rectFromArray(report.crops[key as "Leye" | "Reye"]);
      const { spot, maxDelta } = diffSpot(on, off, rect, report.h1.spotThresholdDeltaLStar);
      expect(maxDelta, `${eye} max lift clears 25 L*`).toBeGreaterThanOrEqual(25);
      expect(spot.length, `${eye} spot area px`).toBe(g.spotPx);
      expect(spot.length, `${eye} spot present`).toBeGreaterThan(0);
      const c = centroid(spot);
      expect(c.x).toBeCloseTo(g.spotCentroid[0], 1);
      expect(c.y).toBeCloseTo(g.spotCentroid[1], 1);
      let mx = -Infinity;
      for (const p of spot) mx = Math.max(mx, luminanceLStar(on, p.x, p.y));
      expect(mx).toBeCloseTo(g.spotMaxL, 1);
      expect(countChangedPx(off, on, rect), `${eye} crop changed`).toBe(g.eyeCropChanged);
    }
  });

  it(h1Exists ? "G2b: each spot centroid lies inside the projected iris circle" : "h1 store absent — G2b skipped", () => {
    if (!h1Exists) return;
    const off = decodePngFile(h1Png("h100"));
    const seeds: Record<string, [number, number]> = { L: [515, 658], R: [775, 650] };
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = report.h1.G2[eye]!;
      const rect = rectFromArray(report.crops[key as "Leye" | "Reye"]);
      const circle = darkCoreCircle(off, rect, seeds[eye]![0], seeds[eye]![1], report.h1.irisCoreThresholdLStar);
      expect(circle.cx).toBeCloseTo(g.irisCircle.cx, 0);
      expect(circle.cy).toBeCloseTo(g.irisCircle.cy, 0);
      expect(circle.r).toBeCloseTo(g.irisCircle.r, 0);
      const d = Math.hypot(g.spotCentroid[0] - circle.cx, g.spotCentroid[1] - circle.cy);
      expect(d, `${eye} centroid inside disc`).toBeLessThan(circle.r);
      expect(g.centroidInDisc).toBe(true);
    }
  });

  it(h1Exists ? "G2c+G2d+CW3: spot is near-white, small, and the sclera is not glazed" : "h1 store absent — skipped", () => {
    if (!h1Exists) return;
    const off = decodePngFile(h1Png("h100"));
    const on = decodePngFile(h1Png("h106"));
    const seeds: Record<string, [number, number]> = { L: [515, 658], R: [775, 650] };
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = report.h1.G2[eye]!;
      const rect = rectFromArray(report.crops[key as "Leye" | "Reye"]);
      const { spot } = diffSpot(on, off, rect, report.h1.spotThresholdDeltaLStar);
      let mx = -Infinity;
      for (const p of spot) mx = Math.max(mx, luminanceLStar(on, p.x, p.y));
      const scl = h1Sclera(off, rect, seeds[eye]!);
      expect(scl.length, `${eye} sclera px`).toBe(g.scleraPx);
      const med = medianLStarOf(off, scl);
      expect(med).toBeCloseTo(g.scleraMedianL00, 0);
      expect(mx, `${eye} G2c spot max L* >= sclera median`).toBeGreaterThanOrEqual(med);
      expect(mx).toBeCloseTo(g.spotMaxL, 1);
      const discArea = Math.PI * g.irisCircle.r * g.irisCircle.r;
      expect(spot.length / discArea, `${eye} G2d spot <= 15% of disc`).toBeLessThanOrEqual(0.15);
      expect(spot.length / discArea).toBeCloseTo(g.spotFracOfDisc, 2);
      const dMean = meanLStarOf(on, scl) - meanLStarOf(off, scl);
      expect(dMean, `${eye} CW3 sclera drift <= 2 L*`).toBeLessThanOrEqual(2);
      expect(dMean).toBeCloseTo(g.scleraDelta, 1);
    }
  });

  it(h1Exists ? "CW1: cheek and forehead still pixel-identical" : "h1 store absent — CW1 skipped", () => {
    if (!h1Exists) return;
    const pre = decodePngFile(join(STORE, "pre-catch-eye00-front.png"));
    const off = decodePngFile(h1Png("h100"));
    for (const key of ["cheek", "forehead"] as const) {
      const rect = rectFromArray(report.crops[key]);
      const c = report.h1.CW1[key]!;
      expect(countChangedPx(pre, off, rect), `${key} unchanged`).toBe(c.h100vsPreChanged);
      expect(c.h100vsPreChanged, `${key} skin must be pixel-identical`).toBe(0);
      expect(meanAbsLumaDiff(pre, off, rect)).toBe(c.h100vsPreMeanDL);
    }
  });

  it(h1Exists ? "h1 store shas verify" : "h1 store absent — sha verification skipped", () => {
    if (!h1Exists) return;
    for (const [key, want] of Object.entries(report.h1.storeShas)) {
      const p = join(H1STORE, report.h1.renders[key]!.png);
      expect(existsSync(p), `h1 store file present`).toBe(true);
      expect(sha256File(p), `sha of ${key}`).toBe(want);
    }
  });
});

const H2STORE = report.h2.store;
const h2Exists = existsSync(H2STORE);
const h2Png = (): string => join(H2STORE, report.h2.renders["h206"]!.png);

/** Pixels inside the iris circle brighter than the 230 threshold. */
function h2Hot(png: DecodedPng, circle: { cx: number; cy: number; r: number }, rect: CropRect, threshold: number): Pixel[] {
  const hot: Pixel[] = [];
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      if (Math.hypot(x - circle.cx, y - circle.cy) > circle.r) continue;
      if (luminance(png, x, y) > threshold) hot.push({ x, y });
    }
  }
  return hot;
}

/** Members of the largest 4-connected cluster inside a pixel set. */
function largestClusterMembers(pts: Pixel[]): Pixel[] {
  const set = new Set(pts.map((p) => `${p.x},${p.y}`));
  const seen = new Set<string>();
  let best: Pixel[] = [];
  for (const p of pts) {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) continue;
    const comp: Pixel[] = [];
    const q: Pixel[] = [p];
    seen.add(k);
    while (q.length > 0) {
      const a = q.pop()!;
      comp.push(a);
      for (const nb of [`${a.x + 1},${a.y}`, `${a.x - 1},${a.y}`, `${a.x},${a.y + 1}`, `${a.x},${a.y - 1}`]) {
        if (set.has(nb) && !seen.has(nb)) {
          seen.add(nb);
          const [x, y] = nb.split(",").map(Number) as [number, number];
          q.push({ x, y });
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

/** Mean L* of the limbus-side annulus (circle r+1 .. r+7). */
function h2RingMean(png: DecodedPng, circle: { cx: number; cy: number; r: number }, rect: CropRect): number {
  let sum = 0;
  let n = 0;
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      const d = Math.hypot(x - circle.cx, y - circle.cy);
      if (d > circle.r + 1 && d <= circle.r + 7) {
        sum += luminanceLStar(png, x, y);
        n += 1;
      }
    }
  }
  return sum / Math.max(n, 1);
}

describe("h2: the softbox quad resolves a crisp catchlight dot on the iris disc", () => {
  it("cause: globe env adds a small intense quad above-front, still globe-scoped", () => {
    const src = readFileSync(modulePath, "utf8");
    const fnIdx = src.indexOf("export async function applyProductRig");
    expect(fnIdx, "applyProductRig present").toBeGreaterThanOrEqual(0);
    const body = src.slice(fnIdx);
    expect(body, "h2 RoomEnvironment still the base").toMatch(/new RoomEnvironment\(\)/);
    expect(body, "quad size pinned").toMatch(/CATCHLIGHT_QUAD_SIZE/);
    expect(body, "quad intensity pinned").toMatch(/CATCHLIGHT_QUAD_INTENSITY/);
    expect(body, "quad position pinned").toMatch(/CATCHLIGHT_QUAD_POS/);
    expect(body, "HDR white quad material").toMatch(/new MeshBasicMaterial/);
    expect(body, "quad faces the origin").toMatch(/catchQuad\.lookAt\(0, 0, 0\)/);
    expect(body, "quad joins the env scene, not the lab scene").toMatch(/globeEnvScene\.add\(catchQuad\)/);
    expect(body, "globe envMap assignment present").toMatch(/\.envMap = globeEnv/);
    expect(body, "product path must not set scene.environment").not.toMatch(/scene\.environment =/);
    expect(report.h2.cause, "report names the quad").toMatch(/quad/);
  });

  it(h2Exists ? "G2: a crisp 230+ cluster sits inside each iris disc" : "h2 store absent — G2 skipped", () => {
    if (!h2Exists) return;
    expect(sha256File(h2Png())).toBe(report.h2.renders["h206"]!.sha256);
    const on = decodePngFile(h2Png());
    const off = decodePngFile(join(H1STORE, report.h1.renders["h100"]!.png));
    expect(on.w).toBe(1280);
    const seeds: Record<string, [number, number]> = { L: [515, 658], R: [775, 650] };
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = report.h2.G2[eye]!;
      const rect = rectFromArray(report.crops[key as "Leye" | "Reye"]);
      // Fixed iris circle from the OFF render (same framing for h1/h2).
      const circle = darkCoreCircle(off, rect, seeds[eye]![0], seeds[eye]![1], report.h2.irisCoreThresholdLStar);
      expect(circle.cx).toBeCloseTo(g.irisCircle.cx, 1);
      expect(circle.cy).toBeCloseTo(g.irisCircle.cy, 1);
      expect(circle.r).toBeCloseTo(g.irisCircle.r, 1);
      const hot = h2Hot(on, circle, rect, report.h2.thresholdLuminance);
      expect(hot.length, `${eye} 230+ px in disc`).toBe(g.hot230);
      const members = largestClusterMembers(hot);
      expect(members.length, `${eye} dot cluster px`).toBe(g.hotCluster);
      expect(members.length, `${eye} crisp bar (>= 20 px contiguous)`).toBeGreaterThanOrEqual(20);
      expect(largestCluster(hot), `${eye} cluster helper agrees`).toBe(g.hotCluster);
      const c = centroid(members);
      expect(c.x).toBeCloseTo(g.hotCentroid[0], 1);
      expect(c.y).toBeCloseTo(g.hotCentroid[1], 1);
      const d = Math.hypot(c.x - circle.cx, c.y - circle.cy);
      expect(d, `${eye} dot centroid inside disc`).toBeLessThan(circle.r);
      expect(d).toBeCloseTo(g.distFromCentre, 1);
      expect(g.centroidInDisc).toBe(true);
      let mx = -Infinity;
      let satSum = 0;
      let n = 0;
      for (let y = rect.y0; y < rect.y1; y += 1) {
        for (let x = rect.x0; x < rect.x1; x += 1) {
          if (Math.hypot(x - circle.cx, y - circle.cy) > circle.r) continue;
          mx = Math.max(mx, luminance(on, x, y));
          satSum += saturation(on, x, y);
          n += 1;
        }
      }
      expect(Math.round(mx * 10) / 10, `${eye} brightest disc pixel`).toBe(g.spotMaxLum);
      expect(Math.round((satSum / Math.max(n, 1)) * 10000) / 10000, `${eye} iris meansat`).toBe(g.meansat);
      const discArea = Math.PI * circle.r * circle.r;
      expect(members.length / discArea, `${eye} dot <= 15% of disc`).toBeLessThanOrEqual(0.15);
      expect(Math.round((members.length / discArea) * 10000) / 10000).toBe(g.spotFracOfDisc);
    }
  });

  it(h2Exists ? "CW1: cheek and forehead still pixel-identical (scoped env)" : "h2 store absent — CW1 skipped", () => {
    if (!h2Exists) return;
    const pre = decodePngFile(join(STORE, "pre-catch-eye00-front.png"));
    const on = decodePngFile(h2Png());
    for (const key of ["cheek", "forehead"] as const) {
      const rect = rectFromArray(report.crops[key]);
      const c = report.h2.CW1[key]!;
      expect(countChangedPx(pre, on, rect), `${key} changed px`).toBe(c.h206vsPreChanged);
      expect(c.h206vsPreChanged, `${key} skin must be pixel-identical`).toBe(0);
      expect(meanAbsLumaDiff(pre, on, rect)).toBe(c.h206vsPreMeanDL);
    }
  });

  it(h2Exists ? "limbus: no new ring — annulus lift over the old env is bounded" : "h2 store absent — limbus skipped", () => {
    if (!h2Exists) return;
    const on = decodePngFile(h2Png());
    const oldOn = decodePngFile(join(H1STORE, report.h1.renders["h106"]!.png));
    const off = decodePngFile(join(H1STORE, report.h1.renders["h100"]!.png));
    const seeds: Record<string, [number, number]> = { L: [515, 658], R: [775, 650] };
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = report.h2.G2[eye]!;
      const rect = rectFromArray(report.crops[key as "Leye" | "Reye"]);
      const circle = darkCoreCircle(off, rect, seeds[eye]![0], seeds[eye]![1], report.h2.irisCoreThresholdLStar);
      const ring = h2RingMean(on, circle, rect);
      expect(Math.round(ring * 10) / 10, `${eye} annulus mean L*`).toBe(g.ringMeanL);
      const ringOld = h2RingMean(oldOn, circle, rect);
      const delta = ring - ringOld;
      expect(Math.round(delta * 10) / 10, `${eye} annulus lift over old env`).toBe(g.ringDeltaOld);
      expect(delta, `${eye} no limbus ring (lift <= 12 L*)`).toBeLessThanOrEqual(12);
    }
  });

  it(h2Exists ? "counterweight: the same metric fails on the old soft env" : "h2 store absent — counterweight skipped", () => {
    if (!h2Exists) return;
    // A gate that also passes on RoomEnvironment-alone is a fail: the old
    // h106 render must NOT reach the crisp bar.
    const oldOn = decodePngFile(join(H1STORE, report.h1.renders["h106"]!.png));
    const off = decodePngFile(join(H1STORE, report.h1.renders["h100"]!.png));
    const seeds: Record<string, [number, number]> = { L: [515, 658], R: [775, 650] };
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const rect = rectFromArray(report.crops[key as "Leye" | "Reye"]);
      const circle = darkCoreCircle(off, rect, seeds[eye]![0], seeds[eye]![1], report.h2.irisCoreThresholdLStar);
      const hot = h2Hot(oldOn, circle, rect, report.h2.thresholdLuminance);
      const pinned = report.h2.counterweight.oldH106[eye]!;
      expect(hot.length, `${eye} old-env 230+ px`).toBe(pinned.hot230);
      expect(largestCluster(hot), `${eye} old env has no crisp dot`).toBeLessThan(20);
      expect(largestCluster(hot), `${eye} old-env cluster`).toBe(pinned.hotCluster);
    }
    expect(report.h2.counterweight.note, "counterweight documented").toMatch(/fails on the old env/);
  });

  it(h2Exists ? "h2 store shas verify" : "h2 store absent — sha verification skipped", () => {
    if (!h2Exists) return;
    for (const [key, want] of Object.entries(report.h2.storeShas)) {
      const p = join(H2STORE, report.h2.renders[key]!.png);
      expect(existsSync(p), `h2 store file present`).toBe(true);
      expect(sha256File(p), `sha of ${key}`).toBe(want);
    }
  });
});

const qsReportPath = join(here, "catchlight-pos-report.json");
const qsReport = JSON.parse(readFileSync(qsReportPath, "utf8")) as {
  module: string;
  moduleSha256: string;
  landed: { shape: string; size: number; intensity: number; pos: [number, number, number]; tag: string };
  store: string;
  renders: Record<string, { png: string; sha256: string }>;
  crops: { Leye: [number, number, number, number]; Reye: [number, number, number, number]; cheek: [number, number, number, number]; forehead: [number, number, number, number] };
  seeds: { L: [number, number]; R: [number, number] };
  thresholds: { hot: number; smearLift: number; irisCore: number };
  rows: Record<string, {
    shape: string; size: number; intensity: number; pos: [number, number, number];
    L: { hot230: number; hotCluster: number; coreBbox: [number, number]; roundRatio: number; distFromCentre: number; smearSub230: number; meansat: number; hueDeg: number; spotMaxLum: number; ringMeanL: number; ringLiftOverOff: number };
    R: { hot230: number; hotCluster: number; coreBbox: [number, number]; roundRatio: number; distFromCentre: number; smearSub230: number; meansat: number; hueDeg: number; spotMaxLum: number; ringMeanL: number; ringLiftOverOff: number };
    skin: { cheek: number; forehead: number };
  }>;
  gates: { coreMinCluster: number; roundRatioMax: number; smearCeiling: number; meansatBand: [number, number]; hueBand: [number, number]; ringLiftLe: number; skinZero: boolean };
};
const QSSTORE = qsReport.store;
const qsExists = existsSync(QSSTORE);
const qsPng = (key: string): string => join(QSSTORE, qsReport.renders[key]!.png);

/** Quad-attributable wash: in-disc px lifted >=25 L by the env but still sub-230 (the blob/wash, not the dot). */
function qsSmear(on: DecodedPng, off: DecodedPng, circle: { cx: number; cy: number; r: number }): number {
  let n = 0;
  for (let y = 0; y < on.h; y += 1) {
    for (let x = 0; x < on.w; x += 1) {
      if (Math.hypot(x - circle.cx, y - circle.cy) > circle.r) continue;
      const lo = luminance(on, x, y);
      if (lo < qsReport.thresholds.hot && lo - luminance(off, x, y) >= qsReport.thresholds.smearLift) n += 1;
    }
  }
  return n;
}

/** Render-space hue (deg) of the mean in-disc RGB — same formula as the iris-upgrade render gate. */
function qsHueDeg(on: DecodedPng, circle: { cx: number; cy: number; r: number }): number {
  let rs = 0, gs = 0, bs = 0, n = 0;
  for (let y = 0; y < on.h; y += 1) {
    for (let x = 0; x < on.w; x += 1) {
      if (Math.hypot(x - circle.cx, y - circle.cy) > circle.r) continue;
      const i = (y * on.w + x) * on.chans;
      rs += on.data[i]!; gs += on.data[i + 1]!; bs += on.data[i + 2]!;
      n += 1;
    }
  }
  const r = rs / n, g = gs / n, b = bs / n;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

describe("catchlight shape+position: a raised quad compacts the dot", () => {
  it("report module sha matches the landed source", () => {
    expect(qsReport.module).toBe("packages/openclinxr/xr-scene/src/isolated-subject-rig-variants.ts");
    expect(sha256File(modulePath)).toBe(qsReport.moduleSha256);
  });

  it("landed source: quad 2.0 @500 at (1,8,6) with a shape switch", () => {
    const src = readFileSync(modulePath, "utf8");
    const shapeM = src.match(/const CATCHLIGHT_SHAPE[^=]*=\s*"(quad|disc)"/);
    expect(shapeM?.[1], "shape landed").toBe(qsReport.landed.shape);
    const sizeM = src.match(/const CATCHLIGHT_QUAD_SIZE = ([0-9.]+);/);
    expect(Number(sizeM?.[1]), "size landed").toBe(qsReport.landed.size);
    const intM = src.match(/const CATCHLIGHT_QUAD_INTENSITY = ([0-9.]+);/);
    expect(Number(intM?.[1]), "intensity landed").toBe(qsReport.landed.intensity);
    const posM = src.match(/const CATCHLIGHT_QUAD_POS[^=]*=\s*\[([^\]]+)\]/);
    expect(posM?.[1]?.split(",").map(Number), "position landed").toEqual(qsReport.landed.pos);
    expect(src, "disc branch present (shape lever kept)").toMatch(/CATCHLIGHT_SHAPE === "disc"/);
    expect(src, "equal-area disc radius").toMatch(/CATCHLIGHT_QUAD_SIZE \/ Math\.sqrt\(Math\.PI\)/);
    expect(src, "source still pins the pos identifier").toMatch(/CATCHLIGHT_QUAD_POS/);
  });

  it(qsExists ? "G2: a round 230+ core sits in each iris disc at the landed position" : "pos store absent — G2 skipped", () => {
    if (!qsExists) return;
    expect(sha256File(qsPng(qsReport.landed.tag))).toBe(qsReport.renders[qsReport.landed.tag]!.sha256);
    const on = decodePngFile(qsPng(qsReport.landed.tag));
    const off = decodePngFile(qsPng("off"));
    expect(on.w).toBe(1280);
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = qsReport.rows[qsReport.landed.tag]![eye]!;
      const rect = rectFromArray(qsReport.crops[key as "Leye" | "Reye"]);
      const circle = darkCoreCircle(off, rect, qsReport.seeds[eye]![0], qsReport.seeds[eye]![1], qsReport.thresholds.irisCore);
      const hot = h2Hot(on, circle, rect, qsReport.thresholds.hot);
      expect(hot.length, `${eye} 230+ px in disc`).toBe(g.hot230);
      const members = largestClusterMembers(hot);
      expect(members.length, `${eye} dot cluster px`).toBe(g.hotCluster);
      expect(members.length, `${eye} crisp bar (>= ${qsReport.gates.coreMinCluster} px contiguous)`).toBeGreaterThanOrEqual(qsReport.gates.coreMinCluster);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of members) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const ratio = Math.max(x1 - x0 + 1, y1 - y0 + 1) / Math.max(Math.min(x1 - x0 + 1, y1 - y0 + 1), 1);
      expect([x1 - x0 + 1, y1 - y0 + 1].sort((a, b) => a - b), `${eye} core bbox`).toEqual([...g.coreBbox].sort((a, b) => a - b));
      expect(Math.round(ratio * 100) / 100, `${eye} core round (extent ratio <= ${qsReport.gates.roundRatioMax})`).toBeLessThanOrEqual(qsReport.gates.roundRatioMax);
      expect(Math.round(ratio * 100) / 100).toBeCloseTo(g.roundRatio, 1);
      const c = centroid(members);
      expect(Math.hypot(c.x - circle.cx, c.y - circle.cy), `${eye} dot centroid inside disc`).toBeLessThan(circle.r);
      expect(Math.round(Math.hypot(c.x - circle.cx, c.y - circle.cy) * 10) / 10, `${eye} centroid offset`).toBe(g.distFromCentre);
      let mx = -Infinity, satSum = 0, n = 0;
      for (let y = 0; y < on.h; y += 1) {
        for (let x = 0; x < on.w; x += 1) {
          if (Math.hypot(x - circle.cx, y - circle.cy) > circle.r) continue;
          mx = Math.max(mx, luminance(on, x, y));
          satSum += saturation(on, x, y);
          n += 1;
        }
      }
      expect(mx, `${eye} core reaches 230+`).toBeGreaterThanOrEqual(qsReport.thresholds.hot);
      expect(Math.round((satSum / Math.max(n, 1)) * 10000) / 10000, `${eye} iris meansat`).toBe(g.meansat);
      expect(g.meansat, `${eye} meansat in band`).toBeGreaterThanOrEqual(qsReport.gates.meansatBand[0]);
      expect(g.meansat, `${eye} meansat below neon`).toBeLessThan(qsReport.gates.meansatBand[1]);
      expect(Math.round(qsHueDeg(on, circle) * 10) / 10, `${eye} render hue`).toBe(g.hueDeg);
      expect(g.hueDeg, `${eye} hue in the brown band`).toBeGreaterThanOrEqual(qsReport.gates.hueBand[0]);
      expect(g.hueDeg, `${eye} hue out of the red`).toBeLessThanOrEqual(qsReport.gates.hueBand[1]);
    }
  });

  it(qsExists ? "smear: quad-attributable wash under the ceiling at the landed position" : "pos store absent — smear skipped", () => {
    if (!qsExists) return;
    const on = decodePngFile(qsPng(qsReport.landed.tag));
    const off = decodePngFile(qsPng("off"));
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = qsReport.rows[qsReport.landed.tag]![eye]!;
      const rect = rectFromArray(qsReport.crops[key as "Leye" | "Reye"]);
      const circle = darkCoreCircle(off, rect, qsReport.seeds[eye]![0], qsReport.seeds[eye]![1], qsReport.thresholds.irisCore);
      expect(qsSmear(on, off, circle), `${eye} wash px`).toBe(g.smearSub230);
      expect(g.smearSub230, `${eye} wash <= ceiling ${qsReport.gates.smearCeiling}`).toBeLessThanOrEqual(qsReport.gates.smearCeiling);
    }
  });

  it(qsExists ? "counterweight: the old square position fails the new gate" : "pos store absent — counterweight skipped", () => {
    if (!qsExists) return;
    // A gate that also passes on the old (1,5,8.5) quad is a fail: the old
    // render must breach the smear ceiling AND the R roundness floor.
    const oldOn = decodePngFile(qsPng("quad-old-pos"));
    const off = decodePngFile(qsPng("off"));
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = qsReport.rows["quad-old-pos"]![eye]!;
      const rect = rectFromArray(qsReport.crops[key as "Leye" | "Reye"]);
      const circle = darkCoreCircle(off, rect, qsReport.seeds[eye]![0], qsReport.seeds[eye]![1], qsReport.thresholds.irisCore);
      expect(qsSmear(oldOn, off, circle), `${eye} old-pos wash px`).toBe(g.smearSub230);
      expect(g.smearSub230, `${eye} old quad fails the smear ceiling`).toBeGreaterThan(qsReport.gates.smearCeiling);
    }
    expect(qsReport.rows["quad-old-pos"]!.R.roundRatio, "old R core is a streak").toBeGreaterThan(qsReport.gates.roundRatioMax);
    const discOld = qsReport.rows["disc-2-i500-1_5_8p5"]!;
    expect(discOld.L.hotCluster, "disc at old pos also drops the L core").toBeLessThan(qsReport.gates.coreMinCluster);
  });

  it(qsExists ? "CW1: cheek and forehead still pixel-identical (scoped env)" : "pos store absent — CW1 skipped", () => {
    if (!qsExists) return;
    const on = decodePngFile(qsPng(qsReport.landed.tag));
    const off = decodePngFile(qsPng("off"));
    for (const key of ["cheek", "forehead"] as const) {
      const rect = rectFromArray(qsReport.crops[key]);
      const g = qsReport.rows[qsReport.landed.tag]!.skin[key]!;
      expect(countChangedPx(off, on, rect), `${key} changed px`).toBe(g);
      expect(g, `${key} skin must be pixel-identical`).toBe(0);
    }
  });

  it(qsExists ? "limbus: annulus lift over OFF is bounded at the landed position" : "pos store absent — limbus skipped", () => {
    if (!qsExists) return;
    const on = decodePngFile(qsPng(qsReport.landed.tag));
    const off = decodePngFile(qsPng("off"));
    for (const [eye, key] of [["L", "Leye"], ["R", "Reye"]] as const) {
      const g = qsReport.rows[qsReport.landed.tag]![eye]!;
      const rect = rectFromArray(qsReport.crops[key as "Leye" | "Reye"]);
      const circle = darkCoreCircle(off, rect, qsReport.seeds[eye]![0], qsReport.seeds[eye]![1], qsReport.thresholds.irisCore);
      const ring = h2RingMean(on, circle, rect);
      expect(Math.round(ring * 10) / 10, `${eye} annulus mean L*`).toBe(g.ringMeanL);
      const ringOff = h2RingMean(off, circle, rect);
      expect(Math.round((ring - ringOff) * 10) / 10, `${eye} annulus lift over OFF`).toBe(g.ringLiftOverOff);
      expect(g.ringLiftOverOff, `${eye} limbus lift <= ${qsReport.gates.ringLiftLe} L*`).toBeLessThanOrEqual(qsReport.gates.ringLiftLe);
    }
  });

  it(qsExists ? "pos store shas verify" : "pos store absent — sha verification skipped", () => {
    if (!qsExists) return;
    for (const [key, want] of Object.entries(qsReport.renders)) {
      const p = join(QSSTORE, want.png);
      expect(existsSync(p), `pos store file present: ${want.png}`).toBe(true);
      expect(sha256File(p), `sha of ${key}`).toBe(want.sha256);
    }
  });
});
