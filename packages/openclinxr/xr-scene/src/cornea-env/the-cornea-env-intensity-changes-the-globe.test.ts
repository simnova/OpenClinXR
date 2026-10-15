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
  luminanceLStar,
  luminanceQuantile,
  meanAbsLumaDiff,
  meanLStarOf,
  medianLStarOf,
  rectFromArray,
  type CropRect,
  type DecodedPng,
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
      expect(eyeSrc, `eye-parallax cites ${lit}`).toContain(lit);
      expect(rigSrc, `rig module cites ${lit}`).toContain(lit);
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
