import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Arch: this gate test imports exactly zero entrypoint-reachable modules —
// only ./png-crop.js (unreachable from the entrypoint) plus node builtins —
// so testInternalImports holds at 10 with no new public exports. The hook
// is exercised through source-text pins (same-file strings the compiler
// consumes) and through the committed LUT bytes the hook uploads.
import { countChangedPx, decodePngFile, type CropRect } from "./png-crop.js";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, "lut-report.json");
const shadeReportPath = join(here, "shader-report.json");
const modulePath = join(here, "skin-shade.ts");
const lutPngPath = join(here, "skin-lut.png");
const lutDataPath = join(here, "skin-lut-data.ts");
const moduleSource = readFileSync(modulePath, "utf8");
const lutModulePath = join(here, "skin-lut.ts");
const lutModuleSource = readFileSync(lutModulePath, "utf8");
const allSources = `${moduleSource}\n${lutModuleSource}`;
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  lut: { width: number; height: number; sha256: string };
  g1: { epsilon: number; flatRowMaxAbs255: number };
  g2: {
    threshold: number;
    thresholdSource: string;
    regions: Record<string, { lutVsWrap: number; lutVsOff: number; wrapVsOff: number }>;
    gap: number;
    verdict: string;
  };
  cw1: { originMainSha256: string };
  cw2: { wrapMatchesH1OnFaceCrops: boolean };
  renders: Record<string, { png: string; sha256: string }>;
  crops: Record<string, CropRect>;
  cropView: Record<string, string>;
  sheet: { dir: string; cells: string[] };
};
const shadeReport = JSON.parse(readFileSync(shadeReportPath, "utf8")) as {
  renders: Record<string, { png: string; sha256: string }>;
  crops: Record<string, CropRect>;
  cw1: { originMainSha256: string };
};
const sha256File = (p: string): string =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const STORE = "/Volumes/files/openclinxr-assets/store/skin-lut";
const SHADE_STORE = "/Volumes/files/openclinxr-assets/store/skin-shade/h1";
const storeExists = existsSync(STORE);

/** Mean absolute channel difference (0-255) over a native crop rect. */
function meanAbsDiff255(
  a: { w: number; data: Uint8Array },
  b: { w: number; data: Uint8Array },
  rect: CropRect,
): number {
  let sum = 0;
  let n = 0;
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        sum += Math.abs(a.data[(y * a.w + x) * 3 + c]! - b.data[(y * b.w + x) * 3 + c]!);
        n += 1;
      }
    }
  }
  return sum / n;
}

describe("the skin LUT is identity on flat skin", () => {
  it("G1: the flat row of the committed LUT is the unhooked physical diffuse within 1/255", () => {
    expect(report.lut.width).toBe(128);
    expect(report.lut.height).toBe(16);
    expect(sha256File(lutPngPath)).toBe(report.lut.sha256);
    const lut = decodePngFile(lutPngPath);
    expect(lut.w).toBe(128);
    expect(lut.h).toBe(16);
    // CW1 flat-surface case, planted: flat skin bakes to curvature 0.5
    // (SKIN_CURVATURE_FLAT), deviation |0.5-0.5|*2 = 0 -> v row 0.
    // Row 0 must equal saturate(NdotL) at every texel centre: epsilon is
    // 8-bit LUT quantisation, 1/255.
    let maxAbs = 0;
    for (let x = 0; x < 128; x += 1) {
      const ndl = -1 + (2 * x) / 127;
      const expected = Math.round(Math.max(0, ndl) * 255);
      const got = lut.data[(0 * 128 + x) * 3]!;
      maxAbs = Math.max(maxAbs, Math.abs(got - expected));
      // The row is grayscale (R=G=B), like the curvature bake.
      expect(lut.data[(0 * 128 + x) * 3 + 1]).toBe(got);
      expect(lut.data[(0 * 128 + x) * 3 + 2]).toBe(got);
    }
    expect(maxAbs).toBeLessThanOrEqual(1);
    expect(report.g1.epsilon, "report states the 8-bit epsilon").toBeCloseTo(1 / 255, 6);
    expect(report.g1.flatRowMaxAbs255).toBeLessThanOrEqual(1);
    expect(maxAbs).toBe(report.g1.flatRowMaxAbs255);
  });

  it("G1: the embedded upload bytes are the same bake (sha-pinned)", () => {
    const dataSource = readFileSync(lutDataPath, "utf8");
    const sha = /SKIN_LUT_PNG_SHA256 = "([0-9a-f]{64})"/.exec(dataSource)?.[1];
    expect(sha, "embedded sha cites the PNG").toBe(sha256File(lutPngPath));
    const b64 = /SKIN_LUT_BYTES_BASE64 = "([A-Za-z0-9+/=]+)"/.exec(dataSource)?.[1];
    const raw = Buffer.from(b64!, "base64");
    expect(raw.length).toBe(128 * 16);
    // Data row 0 (v 0, flipY=false) is the identity row, same as PNG row 0.
    const lut = decodePngFile(lutPngPath);
    for (let x = 0; x < 128; x += 1) {
      expect(raw[x]).toBe(lut.data[x * 3]);
    }
  });

  it("G1/CW1: the hook samples curvature deviation and lifts (LUT - Lambert), so flat is a no-op", () => {
    // Flat (curv SKIN_CURVATURE_FLAT = 0.5) -> deviation 0 -> v row 0 ->
    // identity (proved above), and the added term subtracts Lambert back
    // out: lift is exactly zero. (Source text carries the ${CONST} form;
    // the hook interpolates 0.5 at install.)
    expect(allSources).toMatch(/SKIN_CURVATURE_FLAT = 0\.5/);
    expect(allSources).toMatch(/abs\(skinCurv - \$\{SKIN_CURVATURE_FLAT\}\) \* 2\.0/);
    expect(allSources).toMatch(/skinLutF - clamp\(skinKeyNdl, 0\.0, 1\.0\)/);
    expect(allSources).toMatch(/texture2D\(uSkinLutMap, skinLutUv\)\.r/);
    // The wrap path (lut off) keeps the old convex/cavity term verbatim.
    expect(allSources).toMatch(
      /skinConvex \* uSkinScatterCvx \+ skinCav \* uSkinScatterCav/,
    );
    // No screen derivative in the LUT GLSL bodies (the fwidth mention in
    // the module header is the documented rejection of the h0 approach).
    const lutBodies = [
      /skinShadeLutParsGlsl\(\): string \{([\s\S]*?)\n\}/.exec(allSources)?.[1] ?? "",
      /skinShadeLutScatterGlsl\(\): string \{([\s\S]*?)\n\}/.exec(allSources)?.[1] ?? "",
    ].join("\n");
    expect(lutBodies).toMatch(/uSkinLutMap/);
    expect(lutBodies).not.toMatch(/fwidth|dFdx|dFdy/);
    // Sub-flag defaults off; fail-closed strengths.
    expect(allSources).toMatch(/lut: false/);
    expect(allSources).toMatch(/lutStrength/);
  });

  it("plumbing: the LUT rides the existing flag object, no new capture/variant key", () => {
    // isolated-subject-material-variants.ts spreads the skinShade object
    // into applySkinShade untouched, so {lut:true} flows with zero edits
    // there (other workers' file) and no capture-tool extension.
    const variants = readFileSync(
      join(here, "..", "isolated-subject-material-variants.ts"),
      "utf8",
    );
    expect(variants).toMatch(/\.\.\.flagOpts, curvatureMap/);
    expect(variants).not.toMatch(/lutMap|skinShadeLut/);
    expect(allSources).toMatch(/resolved\.lut \? skinShadeLutScatterGlsl/);
  });

  it(storeExists ? "G2: ear and nose regional moves match the report, verdict follows the gap rule" : "store absent — G2 skipped", () => {
    if (!storeExists) return;
    // Threshold = the stock-vs-Aisha gap: maps-manifest.json
    // threshold.valueMeanAbsDiff255, asserted 12.679 at
    // the-skin-maps-follow-the-morphed-mesh.test.ts:165; the rule itself is
    // consult47/r4.answer.md card 10 (S/consult47, line 48).
    expect(report.g2.threshold).toBe(12.679);
    expect(report.g2.thresholdSource).toMatch(/maps-manifest\.json/);
    const renders: Record<string, { w: number; data: Uint8Array }> = {};
    for (const [name, rec] of Object.entries(report.renders)) {
      const p = join(STORE, rec.png);
      expect(existsSync(p), `render present: ${rec.png}`).toBe(true);
      expect(sha256File(p), `sha of ${rec.png}`).toBe(rec.sha256);
      renders[name] = decodePngFile(p);
    }
    for (const region of ["ear", "nose"] as const) {
      const rect = report.crops[region]!;
      const view = report.cropView[region]!;
      const lutVsWrap = meanAbsDiff255(renders[`on-${view}`]!, renders[`wrap-${view}`]!, rect);
      const lutVsOff = meanAbsDiff255(renders[`on-${view}`]!, renders[`off-${view}`]!, rect);
      const wrapVsOff = meanAbsDiff255(renders[`wrap-${view}`]!, renders[`off-${view}`]!, rect);
      expect(lutVsWrap, `${region} lutVsWrap matches report`).toBeCloseTo(
        report.g2.regions[region]!.lutVsWrap,
        2,
      );
      expect(lutVsOff, `${region} lutVsOff matches report`).toBeCloseTo(
        report.g2.regions[region]!.lutVsOff,
        2,
      );
      expect(wrapVsOff, `${region} wrapVsOff matches report`).toBeCloseTo(
        report.g2.regions[region]!.wrapVsOff,
        2,
      );
    }
    const gap = Math.max(
      ...Object.values(report.g2.regions).map((r) => r.lutVsWrap),
    );
    expect(gap).toBeCloseTo(report.g2.gap, 2);
    // Falsifier: below threshold -> not_shipped_quest, LUT stays behind
    // the default-off sub-flag; at/above -> ships_quest.
    expect(report.g2.verdict).toBe(gap >= report.g2.threshold ? "ships_quest" : "not_shipped_quest");
  });

  it(storeExists ? "CW1: skinShade-off render matches origin/main (face crops clean, only silhouette noise)" : "store absent — CW1 skipped", () => {
    if (!storeExists) return;
    // Same witness as skin-shade CW1: h1 off2, byte-identical to the
    // origin/main-tree render. Same-tree SwiftShader re-renders differ by
    // ~19 silhouette px (h1 off vs off2), so the gate is: 0 changed px in
    // every face crop, full-frame residue confined to the known noise
    // signature (<= 64 px, max abs <= 32, none inside the face box).
    expect(report.cw1.originMainSha256).toBe(shadeReport.cw1.originMainSha256);
    const witness = decodePngFile(join(SHADE_STORE, "skinshade-off2-front.png"));
    expect(sha256File(join(SHADE_STORE, "skinshade-off2-front.png"))).toBe(
      report.cw1.originMainSha256,
    );
    const off = decodePngFile(join(STORE, report.renders["off-front"]!.png));
    expect(off.w).toBe(witness.w);
    for (const crop of ["cheek", "lip", "nostril"] as const) {
      expect(countChangedPx(witness, off, shadeReport.crops[crop]!), `${crop}: off == origin/main`).toBe(0);
    }
    let changed = 0;
    let maxAbs = 0;
    let faceChanged = 0;
    const face = { x0: 500, y0: 500, x1: 900, y1: 1000 };
    for (let i = 0; i < witness.data.length; i += 1) {
      const d = Math.abs(witness.data[i]! - off.data[i]!);
      if (d > 0) {
        changed += 1;
        maxAbs = Math.max(maxAbs, d);
        const px = (i / 3) | 0;
        const x = px % witness.w;
        const y = (px / witness.w) | 0;
        if (x >= face.x0 && x < face.x1 && y >= face.y0 && y < face.y1) faceChanged += 1;
      }
    }
    expect(faceChanged, "no residue inside the face box").toBe(0);
    expect(changed, "full-frame residue within silhouette-noise budget").toBeLessThanOrEqual(64);
    expect(maxAbs, "residue amplitude within noise").toBeLessThanOrEqual(32);
  });

  it(storeExists ? "CW2: wrap path (lut off) unchanged vs the origin/main-tree render" : "store absent — CW2 skipped", () => {
    if (!storeExists) return;
    // Baseline is lut-wrap-base (origin/main tree: skin-shade.ts stashed,
    // xr-scene dist rebuilt, same spec) — NOT the h1 on-render, which
    // predates the specular card (see lut-report.json cw2.h1OnContext).
    // Hook-level proof is pinned in the report (identical shader shas).
    const base = decodePngFile(join(STORE, report.renders["wrap-base-front"]!.png));
    const wrap = decodePngFile(join(STORE, report.renders["wrap-front"]!.png));
    expect(wrap.w).toBe(base.w);
    expect(sha256File(join(STORE, report.renders["wrap-base-front"]!.png))).toBe(
      report.renders["wrap-base-front"]!.sha256,
    );
    for (const crop of ["cheek", "lip", "nostril"] as const) {
      const rect = shadeReport.crops[crop]!;
      expect(countChangedPx(base, wrap, rect), `${crop}: wrap == origin/main`).toBe(0);
    }
    expect(report.cw2.wrapMatchesH1OnFaceCrops).toBe(true);
  });

  it(storeExists ? "sheet cells exist in store/skin-lut" : "store absent — sheet check skipped", () => {
    if (!storeExists) return;
    expect(report.sheet.dir).toBe("/Volumes/files/openclinxr-assets/store/skin-lut");
    expect(report.sheet.cells.length).toBeGreaterThanOrEqual(6);
    for (const cell of report.sheet.cells) {
      expect(existsSync(join(STORE, cell)), `sheet cell present: ${cell}`).toBe(true);
    }
  });
});
