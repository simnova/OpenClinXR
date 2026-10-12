/**
 * Studio-rig grid fit (realism-95): find the studio key/fill/hemisphere that
 * reproduces the TARGET photograph's shading pattern under the product
 * renderer, so later skin grades compare skin, not lighting.
 *
 * Albedo is fixed (toigo natural 2048, roughness 0.55, portrait 1024-wide
 * framing rendered at 512 for the search). Per cell, exposure is bisected in
 * [0.4, 1.6] so the central-30% face-box luma matches the target within 3
 * levels; the score is the mean-normalised, sigma-2-blurred RMS luminance
 * difference over the central 60% square at 64x64 (crude alignment).
 *
 * Run:
 *   MISE_TRUSTED_CONFIG_PATHS=$HOME/.grok/worktrees pnpm tsx tools/openclinxr/evidence/skin-realism/fit-studio-rig.ts
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "../lib/slotted-playwright.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import {
  captureOne,
  centralFaceLuma,
  compositeSheet,
  decodePng,
} from "./runtime-portrait-capture.js";

const GLB_PUBLIC = "generated-humanoids/mpfb-ob-patient-aisha.glb";
const ALBEDO_REL = ".openclinxr/realism-spike/candidates/albedo/toigo_light_skin_with_natural_makeup-2048.png";
// NOTE: target-views/*.png are JPEG bytes under a .png name; the pinned
// PIL conversion below is the byte-identical decode, re-encoded lossless.
// The fit measures the conversion so every reader sees the same pixels.
const TARGET_SRC_REL = ".openclinxr/realism-spike/target-views/target-front.png";
const TARGET_REL = ".openclinxr/realism-spike/studio-rig/target-front.png";
const OUT_DIR = ".openclinxr/realism-spike/studio-rig";
const SEARCH_SIZE = 512;

type CellParams = { az: number; el: number; key: number; hemi: number };

type CellResult = {
  id: string;
  params: CellParams & { fill: number; rim: number; env: number };
  exposure: number;
  luma: number;
  renders: number;
  score: number;
  png: string;
};

function lumaOf(data: Uint8Array, chans: number, k: number): number {
  const r = data[k * chans]!, g = data[k * chans + 1] ?? r, b = data[k * chans + 2] ?? r;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Central 60% square -> 64x64 average-pooled luminance field. */
function field64(pngPath: string): Float64Array {
  const png = decodePng(pngPath);
  const side = Math.min(png.w, png.h);
  const crop = Math.floor(side * 0.6);
  const x0 = Math.floor((png.w - crop) / 2), y0 = Math.floor((png.h - crop) / 2);
  const out = new Float64Array(64 * 64);
  const counts = new Float64Array(64 * 64);
  for (let y = 0; y < crop; y += 1) {
    for (let x = 0; x < crop; x += 1) {
      const l = lumaOf(png.data, png.chans, (y0 + y) * png.w + (x0 + x));
      const cx = Math.min(63, Math.floor((x / crop) * 64));
      const cy = Math.min(63, Math.floor((y / crop) * 64));
      out[cy * 64 + cx]! += l;
      counts[cy * 64 + cx]! += 1;
    }
  }
  for (let i = 0; i < 4096; i += 1) out[i]! /= Math.max(counts[i]!, 1);
  return out;
}

function gaussBlur(field: Float64Array, n: number, sigma: number): Float64Array {
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i]! /= sum;
  const tmp = new Float64Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = Math.min(n - 1, Math.max(0, x + k));
        acc += field[y * n + xx]! * kernel[k + radius]!;
      }
      tmp[y * n + x] = acc;
    }
  }
  const blurred = new Float64Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = Math.min(n - 1, Math.max(0, y + k));
        acc += tmp[yy * n + x]! * kernel[k + radius]!;
      }
      blurred[y * n + x] = acc;
    }
  }
  return blurred;
}

/** Crude shading-pattern error: mean-normalised, sigma-2-blurred RMS at 64x64. */
export function shadingScore(renderPng: string, targetField: Float64Array): number {
  const mine = gaussBlur(normalise(field64(renderPng)), 64, 2);
  let sum = 0;
  for (let i = 0; i < 4096; i += 1) {
    const d = mine[i]! - targetField[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum / 4096);
}

function normalise(field: Float64Array): Float64Array {
  let sum = 0;
  for (let i = 0; i < field.length; i += 1) sum += field[i]!;
  const mean = sum / Math.max(field.length, 1);
  const out = new Float64Array(field.length);
  for (let i = 0; i < field.length; i += 1) out[i] = field[i]! / Math.max(mean, 1e-6);
  return out;
}

const invokedDirectly = process.argv[1]?.endsWith("fit-studio-rig.ts") ?? false;

/**
 * Offline reconstruction of a finished cell: replay the bisection from the
 * measured lumas of the on-disk e-files (bit-identical mids — same ops).
 * Returns null when the cell is incomplete or inconsistent (re-render it).
 */
function reconstructCell(searchDir: string, cwd: string, id: string, targetLuma: number): { exposure: number; luma: number; renders: number } | null {
  const finalPng = path.join(searchDir, `${id}.png`);
  if (!existsSync(finalPng)) return null;
  let lo = 0.4, hi = 1.6, exposure = 1.0, renders = 0;
  let lastFile = "";
  for (let iter = 0; iter < 6; iter += 1) {
    exposure = (lo + hi) / 2;
    lastFile = path.join(searchDir, `${id}-e${iter}.png`);
    if (!existsSync(lastFile)) return null;
    renders += 1;
    const luma = centralFaceLuma(lastFile);
    if (Math.abs(luma - targetLuma) <= 3) break;
    if (luma < targetLuma) lo = exposure;
    else hi = exposure;
  }
  if (readFileSync(finalPng).compare(readFileSync(lastFile)) !== 0) return null;
  return { exposure: Math.round(exposure * 1000) / 1000, luma: Math.round(centralFaceLuma(finalPng) * 10) / 10, renders };
}

function cellId(g: CellParams): string {
  return `fit-az${g.az}el${g.el}k${String(g.key).replace(".", "p")}h${String(g.hemi).replace(".", "p")}`;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const outDir = path.join(cwd, OUT_DIR);
  const searchDir = path.join(outDir, "search");
  await mkdir(searchDir, { recursive: true });
  const albedoAbs = path.join(cwd, ALBEDO_REL);
  const albedoBytes = readFileSync(albedoAbs);
  const albedoSha = createHash("sha256").update(albedoBytes).digest("hex");
  try {
    readFileSync(path.join(cwd, TARGET_REL));
  } catch {
    throw new Error(
      `missing ${TARGET_REL}: the target-views files are JPEG bytes under .png names; create the pinned PNG conversion with: python3 -c "from PIL import Image; Image.open('${TARGET_SRC_REL}').convert('RGB').save('${TARGET_REL}')"`,
    );
  }
  const targetAbs = path.join(cwd, TARGET_REL);
  const targetLuma = centralFaceLuma(targetAbs);
  const targetField = gaussBlur(normalise(field64(targetAbs)), 64, 2);
  console.log(`target central-30% luma=${targetLuma.toFixed(1)} albedo=${ALBEDO_REL} sha=${albedoSha.slice(0, 16)}`);

  const grid: CellParams[] = [];
  for (const az of [-50, -35, -20]) {
    for (const el of [20, 35]) {
      for (const key of [1.5, 2.5, 3.5]) {
        for (const hemi of [0.3, 0.7]) grid.push({ az, el, key, hemi });
      }
    }
  }

  let server = null as Awaited<ReturnType<typeof spawnPortlessDevServer>> | null;
  let browser = null as Awaited<ReturnType<typeof import("../lib/slotted-playwright.js").chromium.launch>> | null;
  const cells: CellResult[] = [];
  const missing: CellParams[] = [];
  // Resume: reconstruct finished cells offline (no browser); render only gaps.
  for (const g of grid) {
    const id = cellId(g);
    const rec = reconstructCell(searchDir, cwd, id, targetLuma);
    const finalPng = path.join(searchDir, `${id}.png`);
    if (rec) {
      const score = shadingScore(finalPng, targetField);
      cells.push({
        id,
        params: { ...g, fill: 0.25 * g.key, rim: 0.5, env: 0.3 },
        exposure: rec.exposure,
        luma: rec.luma,
        renders: rec.renders,
        score: Math.round(score * 10000) / 10000,
        png: path.relative(cwd, finalPng).replaceAll("\\", "/"),
      });
      console.log(`${id} resumed exposure=${rec.exposure.toFixed(3)} luma=${rec.luma.toFixed(1)} score=${score.toFixed(4)}`);
    } else {
      missing.push(g);
    }
  }
  console.log(`resume: ${cells.length} cells reconstructed, ${missing.length} to render`);
  if (missing.length) {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd, readyTimeoutMs: 180_000 });
    browser = await chromium.launch({
      headless: true,
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    });
    const page = await browser.newPage({
      viewport: { width: SEARCH_SIZE, height: SEARCH_SIZE },
      deviceScaleFactor: 1,
    });
    const albedoUrl = `${server.url.replace(/\/$/, "")}/__spike/albedo.png`;
    await page.route("**/__spike/*", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname !== "/__spike/albedo.png") return route.abort();
      return route.fulfill({ body: albedoBytes, contentType: "image/png" });
    });
    try {
      for (const g of missing) {
        const id = cellId(g);
        const studioBase = {
          keyAzimuthDeg: g.az,
          keyElevationDeg: g.el,
          keyIntensity: g.key,
          fillIntensity: 0.25 * g.key,
          hemisphereIntensity: g.hemi,
          rimIntensity: 0.5,
          environmentIntensity: 0.3,
        };
        const specBase: Record<string, unknown> = {
          subjectKind: "glb",
          bodyGlb: GLB_PUBLIC,
          view: "front",
          focus: "head",
          hideHair: true,
          subjectOnly: true,
          renderSize: SEARCH_SIZE,
          portrait: true,
          yawDegrees: 0,
          skinOverride: { baseColorUrl: albedoUrl, roughness: 0.55 },
        };
        // Exposure bisection in [0.4, 1.6] against the target face-box luma.
        let lo = 0.4, hi = 1.6, exposure = 1.0, luma = 0, renders = 0;
        let pngPath = "";
        for (let iter = 0; iter < 6; iter += 1) {
          exposure = (lo + hi) / 2;
          pngPath = path.join(searchDir, `${id}-e${iter}.png`);
          await captureOne({
            page,
            baseUrl: server.url,
            spec: {
              ...specBase,
              subjectId: `${id}_e${iter}`,
              rigOverride: { studio: { ...studioBase, exposure }, removeDefaultLights: true },
              label: id,
            },
            imagePath: pngPath,
            size: SEARCH_SIZE,
          });
          renders += 1;
          luma = centralFaceLuma(pngPath);
          if (Math.abs(luma - targetLuma) <= 3) break;
          if (luma < targetLuma) lo = exposure;
          else hi = exposure;
        }
        const finalPng = path.join(searchDir, `${id}.png`);
        await writeFile(finalPng, readFileSync(pngPath));
        const score = shadingScore(finalPng, targetField);
        cells.push({
          id,
          params: { ...g, fill: 0.25 * g.key, rim: 0.5, env: 0.3 },
          exposure: Math.round(exposure * 1000) / 1000,
          luma: Math.round(luma * 10) / 10,
          renders,
          score: Math.round(score * 10000) / 10000,
          png: path.relative(cwd, finalPng).replaceAll("\\", "/"),
        });
        console.log(`${id} exposure=${exposure.toFixed(3)} luma=${luma.toFixed(1)} score=${score.toFixed(4)} (${renders} renders)`);
        await writeFitJson();
      }
    } finally {
      if (browser) await browser.close();
      if (server) await stopPortlessDevServer(server.proc);
    }
  }

  async function writeFitJson(): Promise<void> {
    const ranked = [...cells].sort((a, b) => a.score - b.score);
    await writeFile(
      path.join(outDir, "fit.json"),
      `${JSON.stringify({ target: TARGET_REL, targetSrc: TARGET_SRC_REL, targetLuma: Math.round(targetLuma * 10) / 10, albedo: ALBEDO_REL, albedoSha256: albedoSha, cells, best: ranked[0]?.id ?? null }, null, 2)}\n`,
      "utf8",
    );
  }

  const ranked = [...cells].sort((a, b) => a.score - b.score);
  const best = ranked[0]!;
  const median = ranked[Math.floor(ranked.length / 2)]!;
  const worst = ranked[ranked.length - 1]!;
  await writeFile(
    path.join(outDir, "fit.json"),
    `${JSON.stringify({ target: TARGET_REL, targetSrc: TARGET_SRC_REL, targetLuma: Math.round(targetLuma * 10) / 10, albedo: ALBEDO_REL, albedoSha256: albedoSha, cells, best: best.id, median: median.id, worst: worst.id }, null, 2)}\n`,
    "utf8",
  );
  const bestParams = {
    keyAzimuthDeg: best.params.az,
    keyElevationDeg: best.params.el,
    keyIntensity: best.params.key,
    fillIntensity: best.params.fill,
    hemisphereIntensity: best.params.hemi,
    rimIntensity: best.params.rim,
    exposure: best.exposure,
    environmentIntensity: best.params.env,
  };
  await writeFile(
    path.join(outDir, "best.rig.json"),
    `${JSON.stringify({ studio: bestParams, fitScore: best.score, fromCell: best.id, targetLuma: Math.round(targetLuma * 10) / 10 }, null, 2)}\n`,
    "utf8",
  );
  console.log(`best=${best.id} score=${best.score} median=${median.score} worst=${worst.score} bestLuma=${best.luma} target=${targetLuma.toFixed(1)}`);
  if (best.score >= 0.9 * median.score) {
    console.log("fit is NOT discriminating: best within 10% of median");
  }
  const contactCells = [
    ...ranked.slice(0, 6).map((c) => ({
      abs: path.join(cwd, c.png) as string | null,
      label: `${c.id} ${c.score.toFixed(4)}`,
    })),
    ...ranked.slice(-3).map((c) => ({
      abs: path.join(cwd, c.png) as string | null,
      label: `${c.id} ${c.score.toFixed(4)}`,
    })),
    { abs: targetAbs as string | null, label: "target" },
  ];
  await compositeSheet({
    cells: contactCells,
    columns: contactCells.length,
    cellW: 256,
    cellH: 256,
    outPng: path.join(outDir, "contact.png"),
  });
}

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
