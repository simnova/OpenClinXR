/**
 * Skin-realism runtime portrait (realism-95).
 *
 * Renders the SHIPPED Aisha GLB through the product three.js path
 * (apps/ui-xr isolated-subject lab: WebGLRenderer + lab lights) as two
 * square head-and-shoulders portraits: straight-on front and +40° yaw.
 *
 * Additive user of the isolated-subject lab options hideHair / yawDegrees /
 * renderSize (no forked renderer, no Blender).
 *
 * Run:
 *   MISE_TRUSTED_CONFIG_PATHS=$HOME/.grok/worktrees pnpm tsx tools/openclinxr/evidence/skin-realism/runtime-portrait-capture.ts
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "../lib/slotted-playwright.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";

const GLB_REPO_PATH = "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb";
const OUT_DIR = ".openclinxr/realism-spike/runtime";
const RENDER_SIZE = 1280;
const FRONT_PNG = "aisha-runtime-front.png";
const THREE_QUARTER_PNG = "aisha-runtime-three-quarter.png";

type LabEvidence = {
  meshCount?: number;
  frameSpanFraction?: number | null;
  focusRegion?: unknown;
};

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function subjectUrl(baseUrl: string, spec: Record<string, unknown>): string {
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(spec));
  return `${baseUrl.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
}

async function waitForEvidence(page: Page): Promise<LabEvidence> {
  const handle = await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __openClinXrIsolatedSubjectEvidence?: LabEvidence;
      };
      const evidence = w.__openClinXrIsolatedSubjectEvidence;
      if (evidence && typeof evidence.meshCount === "number" && evidence.meshCount > 0) {
        return evidence as LabEvidence;
      }
      const app = document.querySelector("#app");
      const text = app?.textContent ?? "";
      if (text.includes("Isolated subject lab error")) {
        return { kind: "error", text: text.slice(0, 2000) } as unknown as LabEvidence;
      }
      return null;
    },
    null,
    { timeout: 120_000 },
  );
  const value = (await handle.jsonValue()) as LabEvidence & { kind?: string; text?: string };
  if (value && (value as { kind?: string }).kind === "error") {
    throw new Error(`isolated subject lab refused the subject: ${(value as { text?: string }).text ?? ""}`);
  }
  return value;
}

/** Minimal PNG decoder (8-bit RGB/RGBA) for lit-span measurement. */
function decodePng(file: string): { w: number; h: number; chans: number; data: Uint8Array } {
  const bytes = readFileSync(file);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0, h = 0, depth = 0, colour = -1;
  const idat: Uint8Array[] = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8); h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!; colour = bytes[off + 17]!;
    } else if (type === "IDAT") idat.push(bytes.subarray(off + 8, off + 8 + len));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (depth !== 8 || !chans || !w) throw new Error(`undecodable PNG ${file}`);
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  const stride = w * chans;
  const out = new Uint8Array(stride * h);
  let prev = new Uint8Array(stride), p = 0;
  for (let y = 0; y < h; y += 1) {
    const f = raw[p++]!;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const rb = raw[p + x]!;
      const a = x >= chans ? cur[x - chans]! : 0, b = prev[x]!, c = x >= chans ? prev[x - chans]! : 0;
      let v: number;
      if (f === 0) v = rb; else if (f === 1) v = rb + a; else if (f === 2) v = rb + b;
      else if (f === 3) v = rb + ((a + b) >> 1);
      else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
             v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[x] = v & 0xff;
    }
    p += stride; prev = cur;
  }
  return { w, h, chans, data: out };
}

function isLit(r: number, g: number, b: number): boolean {
  return Math.abs(r - 0x18) + Math.abs(g - 0x21) + Math.abs(b - 0x1d) > 36;
}

/** Widest lit row span within the TOP 35% of lit rows (the head, not the shoulders) + lit fractions + luminance std. */
function measureImage(pngPath: string): { headWidthPx: number; litHeightFraction: number; luminanceStd: number; w: number; h: number } {
  const png = decodePng(pngPath);
  const { w, h, chans, data } = png;
  const spans: number[] = new Array<number>(h).fill(-1);
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 0; y < h; y += 1) {
    let lo = -1, hi = -1;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * chans;
      const r = data[i]!, g = data[i + 1] ?? r, b = data[i + 2] ?? r;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum; sum2 += lum * lum; n += 1;
      if (isLit(r, g, b)) { if (lo < 0) lo = x; hi = x; }
    }
    if (hi >= 0) spans[y] = hi - lo;
  }
  let y0 = -1, y1 = -1;
  for (let y = 0; y < h; y += 1) if (spans[y]! >= 0) { if (y0 < 0) y0 = y; y1 = y; }
  let headWidthPx = 0, litRows = 0;
  if (y0 >= 0) {
    const bandMaxY = y0 + (y1 - y0) * 0.35;
    for (let y = 0; y < h; y += 1) {
      if (spans[y]! < 0) continue;
      litRows += 1;
      if (y <= bandMaxY && spans[y]! > headWidthPx) headWidthPx = spans[y]!;
    }
  }
  const mean = sum / Math.max(n, 1);
  const std = Math.sqrt(Math.max(sum2 / Math.max(n, 1) - mean * mean, 0));
  return { headWidthPx, litHeightFraction: (y0 >= 0 ? (y1 - y0 + 1) : 0) / h, luminanceStd: std, w, h };
}

async function captureOne(input: {
  page: Page;
  baseUrl: string;
  spec: Record<string, unknown>;
  imagePath: string;
}): Promise<LabEvidence> {
  await input.page.setViewportSize({ width: RENDER_SIZE, height: RENDER_SIZE });
  await input.page.goto(subjectUrl(input.baseUrl, input.spec), { waitUntil: "domcontentloaded", timeout: 120_000 });
  const evidence = await waitForEvidence(input.page);
  await mkdir(path.dirname(input.imagePath), { recursive: true });
  const canvas = input.page.locator("#isolated-subject-capture-canvas");
  if (await canvas.count()) {
    await canvas.screenshot({ path: input.imagePath });
  } else {
    await input.page.screenshot({ path: input.imagePath });
  }
  return evidence;
}

export async function runRuntimePortraitCapture(options?: { cwd?: string }): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const outDir = path.join(cwd, OUT_DIR);
  await mkdir(outDir, { recursive: true });
  const glbAbs = path.join(cwd, GLB_REPO_PATH);
  const glbSha256 = sha256File(glbAbs);
  const jsonPath = path.join(outDir, "runtime-capture.json");

  const baseSpec = {
    subjectKind: "glb",
    bodyGlb: "generated-humanoids/mpfb-ob-patient-aisha.glb",
    view: "front",
    focus: "head",
    hideHair: true,
    subjectOnly: true,
    renderSize: RENDER_SIZE,
  };

  let server = null as Awaited<ReturnType<typeof spawnPortlessDevServer>> | null;
  let browser = null as Awaited<ReturnType<typeof import("../lib/slotted-playwright.js").chromium.launch>> | null;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd, readyTimeoutMs: 180_000 });
    browser = await chromium.launch({
      headless: true,
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: RENDER_SIZE, height: RENDER_SIZE }, deviceScaleFactor: 1 });

    const frontAbs = path.join(outDir, FRONT_PNG);
    const frontEvidence = await captureOne({
      page, baseUrl: server.url,
      spec: { ...baseSpec, subjectId: "aisha_runtime_front", yawDegrees: 0, label: "Aisha runtime front" },
      imagePath: frontAbs,
    });

    const debug = await page.evaluate(
      () => (window as unknown as { __openClinXrIsolatedRuntimeDebug?: unknown }).__openClinXrIsolatedRuntimeDebug ?? null,
    );

    const tqAbs = path.join(outDir, THREE_QUARTER_PNG);
    const tqEvidence = await captureOne({
      page, baseUrl: server.url,
      spec: { ...baseSpec, subjectId: "aisha_runtime_three_quarter", yawDegrees: 40, label: "Aisha runtime three-quarter 40deg" },
      imagePath: tqAbs,
    });

    const frontMeasure = measureImage(frontAbs);
    const tqMeasure = measureImage(tqAbs);

    const record = {
      glbSha256,
      glbPath: GLB_REPO_PATH,
      pngPaths: [path.join(OUT_DIR, FRONT_PNG), path.join(OUT_DIR, THREE_QUARTER_PNG)],
      pngSha256s: [sha256File(frontAbs), sha256File(tqAbs)],
      viewport: { width: RENDER_SIZE, height: RENDER_SIZE },
      headWidthPx: frontMeasure.headWidthPx,
      headWidthMethod: "image: widest lit row span within the top 35% of lit rows of aisha-runtime-front.png (background #18211d threshold; shoulders excluded)",
      headWidthPxThreeQuarter: tqMeasure.headWidthPx,
      litHeightFractionFront: Math.round(frontMeasure.litHeightFraction * 1000) / 1000,
      litHeightFractionThreeQuarter: Math.round(tqMeasure.litHeightFraction * 1000) / 1000,
      frameSpanFractionFront: frontEvidence.frameSpanFraction ?? null,
      frameSpanFractionThreeQuarter: tqEvidence.frameSpanFraction ?? null,
      hairHidden: true,
      renderer: (debug as Record<string, unknown> | null)?.hasOwnProperty?.("threeRevision")
        ? {
            threeRevision: (debug as Record<string, unknown>).threeRevision,
            toneMapping: (debug as Record<string, unknown>).toneMapping,
            toneMappingExposure: (debug as Record<string, unknown>).toneMappingExposure,
            outputColorSpace: (debug as Record<string, unknown>).outputColorSpace,
          }
        : debug,
      lights: (debug as { lights?: unknown } | null)?.lights ?? null,
      environmentMap: (debug as { environmentMap?: unknown } | null)?.environmentMap ?? null,
      skinMaterial: (debug as { skinMaterial?: unknown } | null)?.skinMaterial ?? null,
      runtimeDebug: debug,
      command: "MISE_TRUSTED_CONFIG_PATHS=$HOME/.grok/worktrees pnpm tsx tools/openclinxr/evidence/skin-realism/runtime-portrait-capture.ts",
    };
    await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

    // Fail-closed self checks.
    const failures: string[] = [];
    for (const [label, m] of [["front", frontMeasure], ["three-quarter", tqMeasure]] as const) {
      if (m.w !== RENDER_SIZE || m.h !== RENDER_SIZE) failures.push(`${label}: PNG is ${m.w}x${m.h}, expected ${RENDER_SIZE}x${RENDER_SIZE}`);
      if (m.w !== m.h) failures.push(`${label}: PNG is not square`);
      if (m.luminanceStd <= 10) failures.push(`${label}: image looks blank (luminance std ${m.luminanceStd.toFixed(2)})`);
    }
    if (frontMeasure.headWidthPx < 500) failures.push(`front headWidthPx ${frontMeasure.headWidthPx} < 500`);
    if (failures.length) throw new Error(`runtime portrait self-check failed: ${failures.join("; ")}`);
    console.log(`runtime portraits ok: front headWidthPx=${frontMeasure.headWidthPx} tq=${tqMeasure.headWidthPx}`);
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    await writeFile(jsonPath, `${JSON.stringify({ glbSha256: (() => { try { return sha256File(path.join(cwd, GLB_REPO_PATH)); } catch { return null; } })(), error: message }, null, 2)}\n`, "utf8");
    throw err;
  } finally {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
  }
}

const invokedDirectly = process.argv[1]?.endsWith("runtime-portrait-capture.ts") ?? false;
if (invokedDirectly) {
  runRuntimePortraitCapture().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
