/**
 * Skin-realism runtime portrait (realism-95) + variant evaluator.
 *
 * Baseline (no args): renders the SHIPPED Aisha GLB through the product
 * three.js path (apps/ui-xr isolated-subject lab) as front + 40° portraits
 * under .openclinxr/realism-spike/runtime/.
 *
 * Variant (evaluator a future factory station calls — deterministic,
 * data-driven, never writes a GLB):
 *   pnpm tsx tools/openclinxr/evidence/skin-realism/runtime-portrait-capture.ts \
 *     --variant .openclinxr/realism-spike/variants/v1-rig.variant.json \
 *     --out .openclinxr/realism-spike/variants [--glb <repo path>]
 * Sheet:  ... --sheet --out .openclinxr/realism-spike/variants
 * Checks: ... --check --out .openclinxr/realism-spike/variants
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "../lib/slotted-playwright.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";

const GLB_REPO_PATH = "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb";
const OUT_DIR = ".openclinxr/realism-spike/runtime";
const RENDER_SIZE = 1280;
const FRONT_PNG = "aisha-runtime-front.png";
const THREE_QUARTER_PNG = "aisha-runtime-three-quarter.png";

export type LabEvidence = {
  meshCount?: number;
  frameSpanFraction?: number | null;
  focusRegion?: unknown;
};

export function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function subjectUrl(baseUrl: string, spec: Record<string, unknown>): string {
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(spec));
  return `${baseUrl.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
}

async function waitForEvidence(page: Page): Promise<LabEvidence> {
  const handle = await page.waitForFunction(
    () => {
      // globalThis IS the window inside the page; bare window/document do not
      // typecheck under the tools tsconfig (node types, no DOM lib).
      const g = globalThis as unknown as {
        __openClinXrIsolatedSubjectEvidence?: LabEvidence;
        document: { querySelector(sel: string): { textContent: string | null } | null };
      };
      const evidence = g.__openClinXrIsolatedSubjectEvidence;
      if (evidence && typeof evidence.meshCount === "number" && evidence.meshCount > 0) {
        return evidence as LabEvidence;
      }
      const app = g.document.querySelector("#app");
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
export function decodePng(file: string): { w: number; h: number; chans: number; data: Uint8Array } {
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
export function measureImage(pngPath: string): { headWidthPx: number; litHeightFraction: number; luminanceStd: number; w: number; h: number } {
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

export async function captureOne(input: {
  page: Page;
  baseUrl: string;
  spec: Record<string, unknown>;
  imagePath: string;
  size?: number;
}): Promise<LabEvidence> {
  const size = input.size ?? RENDER_SIZE;
  await input.page.setViewportSize({ width: size, height: size });
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
      () => (globalThis as unknown as { __openClinXrIsolatedRuntimeDebug?: unknown }).__openClinXrIsolatedRuntimeDebug ?? null,
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

// ---------------------------------------------------------------------------
// Variant evaluator: deterministic skin/rig overrides, no GLB writes
// ---------------------------------------------------------------------------

export type VariantDef = {
  id: string;
  skinOverride?: Record<string, unknown>;
  materialOverrides?: Array<Record<string, unknown>>;
  rigOverride?: Record<string, unknown>;
  productEnvironmentId?: string;
  portrait?: boolean;
  renderSize?: number;
  views?: number[];
};

const TEXTURE_URL_KEYS = ["baseColorUrl", "normalUrl", "roughnessMapUrl"] as const;

const RIG_TONE_NUMBERS: Record<string, number> = {
  None: 0,
  ACESFilmic: 4,
  AgX: 6,
  Neutral: 7,
};

function parseCliArgs(argv: string[]): { variant?: string; out?: string; glb?: string; sheet?: boolean; check?: boolean; productSheet?: boolean; productCheck?: boolean; studioSheet?: boolean } {
  const parsed: { variant?: string; out?: string; glb?: string; sheet?: boolean; check?: boolean; productSheet?: boolean; productCheck?: boolean; studioSheet?: boolean } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "--variant") parsed.variant = argv[++i];
    else if (a === "--out") parsed.out = argv[++i];
    else if (a === "--glb") parsed.glb = argv[++i];
    else if (a === "--sheet") parsed.sheet = true;
    else if (a === "--check") parsed.check = true;
    else if (a === "--product-sheet") parsed.productSheet = true;
    else if (a === "--product-check") parsed.productCheck = true;
    else if (a === "--studio-sheet") parsed.studioSheet = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  return parsed;
}

/** PNG IHDR only: dimensions without decoding pixels. */
export function pngDims(file: string): [number, number] {
  const b = readFileSync(file);
  if (b.length < 24) throw new Error(`unreadable PNG ${file}`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** Mean absolute per-channel pixel difference (0-255 scale). Same dims required. */
export function meanAbsDiff(aPath: string, bPath: string): number {
  const a = decodePng(aPath), b = decodePng(bPath);
  if (a.w !== b.w || a.h !== b.h) {
    throw new Error(`meanAbsDiff dimension mismatch: ${aPath} ${a.w}x${a.h} vs ${bPath} ${b.w}x${b.h}`);
  }
  const c = Math.min(a.chans, b.chans, 3);
  const n = a.w * a.h;
  let sum = 0;
  for (let k = 0; k < n; k += 1) {
    for (let ch = 0; ch < c; ch += 1) {
      sum += Math.abs(a.data[k * a.chans + ch]! - b.data[k * b.chans + ch]!);
    }
  }
  return sum / (n * c);
}

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  throw new Error(`unsupported texture extension for /__spike/ serving: ${file}`);
}

/**
 * Re-assert from a recorded readout that the variant's overrides actually
 * landed. Returns human-readable check lines. THROWS on any mismatch: a
 * variant whose readout does not show the override is a failure, not a pass.
 */
export function assertVariantLanded(variant: VariantDef, record: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const fail = (msg: string): never => {
    throw new Error(`variant ${variant.id}: override did not land: ${msg}`);
  };
  const skin = record.skinMaterial as Record<string, unknown> | null;
  if (!skin) throw new Error(`variant ${variant.id}: override did not land: no skinMaterial in live readout`);
  const skinOv = (variant.skinOverride ?? {}) as Record<string, unknown>;
  if (skinOv.roughness != null) {
    const want = skinOv.roughness as number;
    const got = skin.roughness as number;
    lines.push(`roughness readback=${got} want=${want}`);
    if (Math.abs(got - want) > 1e-6) fail(`roughness readback ${got} != ${want}`);
  }
  if (skinOv.normalUrl) {
    lines.push(`hasNormalMap=${String(skin.hasNormalMap)}`);
    if (skin.hasNormalMap !== true) fail("hasNormalMap is not true");
    const applied = (record.runtimeDebug as Record<string, { normal?: { scale?: number } }>)?.skinOverrideApplied;
    if (skinOv.normalScale != null && applied?.normal?.scale !== skinOv.normalScale) {
      fail(`normalScale applied ${String(applied?.normal?.scale)} != ${String(skinOv.normalScale)}`);
    }
    lines.push(`normalScale applied=${String(applied?.normal?.scale)}`);
  } else {
    lines.push(`hasNormalMap=${String(skin.hasNormalMap)}`);
  }
  const requestedMatOvs = (variant.materialOverrides ?? []) as Array<Record<string, unknown>>;
  const appliedMatOvs = (record.materialOverridesApplied ?? []) as Array<{
    match: unknown;
    matched: unknown;
    readback: Array<Record<string, unknown>>;
  }>;
  if (requestedMatOvs.length) {
    if (!Array.isArray(appliedMatOvs) || appliedMatOvs.length !== requestedMatOvs.length) {
      fail(`materialOverridesApplied length ${String((appliedMatOvs as unknown[])?.length)} != requested ${requestedMatOvs.length}`);
    }
    requestedMatOvs.forEach((ov, i) => {
      const got = appliedMatOvs[i]!;
      if (got.match !== ov.match) fail(`material override ${i} match readback ${String(got.match)} != ${String(ov.match)}`);
      if (!Array.isArray(got.matched) || got.matched.length === 0) fail(`material override /${String(ov.match)}/i matched nothing`);
      lines.push(`matOverride[${String(ov.match)}] matched=${(got.matched as string[]).join(",")}`);
      for (const rb of got.readback) {
        const eq = (field: string, want: unknown): void => {
          const v = rb[field];
          if (typeof want === "number") {
            if (typeof v !== "number" || Math.abs(v - want) > 1e-6) fail(`${String(ov.match)} ${field} readback ${String(v)} != ${String(want)}`);
          } else if (typeof want === "string" && /^#[0-9a-fA-F]{6}$/.test(want)) {
            if (typeof v !== "string" || v.toLowerCase() !== want.toLowerCase()) {
              fail(`${String(ov.match)} ${field} readback ${String(v)} != ${want}`);
            }
          } else if (typeof want === "boolean") {
            if (v !== want) fail(`${String(ov.match)} ${field} readback ${String(v)} != ${String(want)}`);
          }
        };
        if (ov.color !== undefined) eq("color", ov.color);
        if (ov.roughness !== undefined) eq("roughness", ov.roughness);
        if (ov.metalness !== undefined) eq("metalness", ov.metalness);
        if (ov.envMapIntensity !== undefined) eq("envMapIntensity", ov.envMapIntensity);
        if (ov.emissive !== undefined) eq("emissive", ov.emissive);
        if (ov.emissiveIntensity !== undefined) eq("emissiveIntensity", ov.emissiveIntensity);
        if (ov.hide === true) eq("hidden", true);
        const phys = ov.physical as Record<string, unknown> | undefined;
        if (phys) {
          if (rb.type !== "MeshPhysicalMaterial") fail(`${String(ov.match)} type ${String(rb.type)} is not MeshPhysicalMaterial`);
          if (phys.clearcoat !== undefined) eq("clearcoat", phys.clearcoat);
          if (phys.clearcoatRoughness !== undefined) eq("clearcoatRoughness", phys.clearcoatRoughness);
          if (phys.ior !== undefined) eq("ior", phys.ior);
        }
      }
      lines.push(`matOverride[${String(ov.match)}] readback ok x${got.readback.length}`);
    });
  }
  const rigOv = (variant.rigOverride ?? {}) as Record<string, unknown>;
  const renderer = record.renderer as Record<string, unknown>;
  if (rigOv.toneMapping) {
    const want = RIG_TONE_NUMBERS[rigOv.toneMapping as string];
    lines.push(`toneMapping=${String(renderer.toneMapping)} want=${String(want)}`);
    if (renderer.toneMapping !== want) fail(`toneMapping ${String(renderer.toneMapping)} != ${String(want)}`);
  }
  if (rigOv.exposure != null) {
    lines.push(`exposure=${String(renderer.toneMappingExposure)} want=${String(rigOv.exposure)}`);
    if (renderer.toneMappingExposure !== rigOv.exposure) fail("exposure mismatch");
  }
  if (rigOv.environment === "room") {
    lines.push(`environmentMap=${String(record.environmentMap)}`);
    if (record.environmentMap !== true) fail("environmentMap is not true");
    if (rigOv.environmentIntensity != null) {
      lines.push(`environmentIntensity=${String(record.environmentIntensity)}`);
      if (record.environmentIntensity !== rigOv.environmentIntensity) fail("environmentIntensity mismatch");
    }
  }
  if (variant.productEnvironmentId) {
    // Product rig: ACES + rig exposure + applied rig, all read back live.
    lines.push(`toneMapping=${String(renderer.toneMapping)} want=4 (ACESFilmic)`);
    if (renderer.toneMapping !== 4) fail("product toneMapping is not ACESFilmic");
    const rig = record.rig as { exposure?: unknown; sha256?: unknown } | null;
    if (!rig || typeof rig.exposure !== "number") {
      throw new Error(`variant ${variant.id}: override did not land: no rig exposure in record`);
    }
    lines.push(`exposure=${String(renderer.toneMappingExposure)} want=${String(rig.exposure)}`);
    if (renderer.toneMappingExposure !== rig.exposure) fail("rig exposure did not land");
    const productRig = record.productRig as { rigApplied?: unknown } | null;
    lines.push(`rigApplied=${String(productRig?.rigApplied)}`);
    if (productRig?.rigApplied !== true) fail("product rig not applied");
    const lights = record.lights as Array<{ role?: unknown }>;
    const rigRoles = lights.filter((l) => typeof l.role === "string").map((l) => l.role as string);
    lines.push(`rigRoles=${rigRoles.slice(0, 12).join(",")}${rigRoles.length > 12 ? `+${rigRoles.length - 12}` : ""}`);
    if (!rigRoles.length) fail("no rig-role lights in live light list");
  }
  const studio = (variant.rigOverride as { studio?: Record<string, unknown> } | undefined)?.studio;
  if (studio) {
    // Studio rig: exactly hemisphere + key + fill + rim, ACES, fitted exposure.
    const lights = record.lights as Array<{ type?: unknown; color?: unknown }>;
    const types = lights.map((l) => String(l.type)).sort().join(",");
    lines.push(`studioLights=${types}`);
    if (lights.length !== 4) fail(`studio light count ${lights.length} != 4`);
    if (types !== "DirectionalLight,DirectionalLight,DirectionalLight,HemisphereLight") {
      fail(`studio light types ${types} != hemisphere + 3 directionals`);
    }
    if (lights.some((l) => l.color === "#dceee6")) fail("lab default ambient still present");
    lines.push(`toneMapping=${String(renderer.toneMapping)} want=4 (ACESFilmic)`);
    if (renderer.toneMapping !== 4) fail("studio toneMapping is not ACESFilmic");
    lines.push(`exposure=${String(renderer.toneMappingExposure)} want=${String(studio.exposure)}`);
    if (renderer.toneMappingExposure !== studio.exposure) fail("studio exposure did not land");
    lines.push(`environmentMap=${String(record.environmentMap)}`);
    if (record.environmentMap !== true) fail("studio environmentMap is not true");
  }
  if (rigOv.removeDefaultLights === true && !(rigOv as { studio?: unknown }).studio) {
    const lights = record.lights as Array<{ color?: string; type?: string }>;
    const expected = (rigOv.ambient ? 1 : 0) + ((rigOv.directionals as unknown[] | undefined)?.length ?? 0);
    lines.push(`lightCount=${lights.length} want=${expected}`);
    if (lights.length !== expected) fail(`light count ${lights.length} != ${expected}`);
    if (lights.some((l) => l.color === "#dceee6")) fail("default ambient still present");
  } else if (!variant.productEnvironmentId && !(rigOv as { studio?: unknown }).studio && !rigOv.ambient && !(rigOv.directionals as unknown[] | undefined)?.length) {
    const lights = record.lights as Array<unknown>;
    lines.push(`defaultLightCount=${lights.length}`);
    if (lights.length !== 3) fail(`default light count ${lights.length} != 3`);
  }
  return lines;
}

async function runVariantMode(input: { cwd: string; variantPath: string; outDir: string; glbRepoPath: string }): Promise<void> {
  const { cwd, variantPath, outDir, glbRepoPath } = input;
  const variant = JSON.parse(readFileSync(variantPath, "utf8")) as VariantDef;
  if (!variant.id || !/^[a-z0-9_-]+$/.test(variant.id)) throw new Error(`variant needs an id ([a-z0-9_-]): ${variantPath}`);
  const views = variant.views?.length ? variant.views : [0, 40];
  const size = variant.renderSize ?? RENDER_SIZE;
  if (!Number.isInteger(size) || size < 512 || size > 4096) {
    throw new Error(`variant ${variant.id}: renderSize must be an integer in 512..4096`);
  }
  await mkdir(outDir, { recursive: true });

  const glbAbs = path.join(cwd, glbRepoPath);
  const glbSha256 = sha256File(glbAbs);
  // The lab resolves bodyGlb against the ui-xr public dir: strip that prefix.
  const publicPrefix = "apps/ui-xr/public/";
  const bodyGlb = glbRepoPath.startsWith(publicPrefix) ? glbRepoPath.slice(publicPrefix.length) : glbRepoPath;

  // Product rig file bytes (sha recorded; the page loads the same file via the product path).
  let rigFile: { environmentId: string; path: string; sha256: string; exposure: number } | null = null;
  if (variant.productEnvironmentId) {
    const rigRel = `apps/ui-xr/public/xr-assets/lighting/${variant.productEnvironmentId}.rig.json`;
    const rigBytes = readFileSync(path.join(cwd, rigRel));
    const rigJson = JSON.parse(rigBytes.toString("utf8")) as { exposure?: unknown };
    if (typeof rigJson.exposure !== "number") throw new Error(`rig ${rigRel} has no numeric exposure`);
    rigFile = {
      environmentId: variant.productEnvironmentId,
      path: rigRel,
      sha256: createHash("sha256").update(rigBytes).digest("hex"),
      exposure: rigJson.exposure,
    };
  }

  // Local texture files -> /__spike/ URLs (never copied into apps/ui-xr/public).
  const skinOv = { ...((variant.skinOverride ?? {}) as Record<string, unknown>) };
  const spikeFiles = new Map<string, { bytes: Buffer; contentType: string }>();
  const inputShas: Record<string, { sha256: string; servedUrl: string }> = {};
  let texIndex = 0;
  for (const key of TEXTURE_URL_KEYS) {
    const rel = skinOv[key];
    if (rel == null) continue;
    if (typeof rel !== "string") throw new Error(`variant ${variant.id}: skinOverride.${key} must be a path string`);
    const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    const bytes = readFileSync(abs);
    const ext = path.extname(abs).toLowerCase() || ".png";
    const servedPath = `/__spike/tex${texIndex}${ext}`;
    texIndex += 1;
    spikeFiles.set(servedPath, { bytes, contentType: contentTypeFor(abs) });
    inputShas[rel] = { sha256: createHash("sha256").update(bytes).digest("hex"), servedUrl: servedPath };
    skinOv[key] = servedPath;
  }

  // Generic material-override textures follow the same local-route rules as skinOverride.
  const rawMatOvs = (variant.materialOverrides ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(rawMatOvs)) throw new Error(`variant ${variant.id}: materialOverrides must be a list`);
  const matOvs = rawMatOvs.map((o) => ({ ...(o as Record<string, unknown>) }));
  for (const ov of matOvs) {
    const rel = ov.baseColorUrl;
    if (rel == null) continue;
    if (typeof rel !== "string") throw new Error(`variant ${variant.id}: materialOverrides[].baseColorUrl must be a path string`);
    const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    const bytes = readFileSync(abs);
    const ext = path.extname(abs).toLowerCase() || ".png";
    const servedPath = `/__spike/tex${texIndex}${ext}`;
    texIndex += 1;
    spikeFiles.set(servedPath, { bytes, contentType: contentTypeFor(abs) });
    inputShas[`${String(ov.match)}:${rel}`] = { sha256: createHash("sha256").update(bytes).digest("hex"), servedUrl: servedPath };
    ov.baseColorUrl = servedPath;
  }

  let server = null as Awaited<ReturnType<typeof spawnPortlessDevServer>> | null;
  let browser = null as Awaited<ReturnType<typeof import("../lib/slotted-playwright.js").chromium.launch>> | null;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd, readyTimeoutMs: 180_000 });
    browser = await chromium.launch({
      headless: true,
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.route("**/__spike/*", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const file = spikeFiles.get(pathname);
      if (!file) return route.abort();
      return route.fulfill({ body: file.bytes, contentType: file.contentType });
    });
    // Absolute URLs keep TextureLoader same-origin without depending on page URL shape.
    for (const key of TEXTURE_URL_KEYS) {
      if (typeof skinOv[key] === "string" && (skinOv[key] as string).startsWith("/__spike/")) {
        skinOv[key] = `${server.url.replace(/\/$/, "")}${skinOv[key] as string}`;
      }
    }
    for (const ov of matOvs) {
      if (typeof ov.baseColorUrl === "string" && (ov.baseColorUrl as string).startsWith("/__spike/")) {
        ov.baseColorUrl = `${server.url.replace(/\/$/, "")}${ov.baseColorUrl as string}`;
      }
    }
    for (const rel of Object.keys(inputShas)) {
      const served = inputShas[rel]!;
      served.servedUrl = `${server.url.replace(/\/$/, "")}${served.servedUrl}`;
    }

    const baseSpec: Record<string, unknown> = {
      subjectKind: "glb",
      bodyGlb,
      view: "front",
      focus: "head",
      hideHair: true,
      subjectOnly: true,
      renderSize: size,
      ...(Object.keys(skinOv).length ? { skinOverride: skinOv } : {}),
      ...(matOvs.length ? { materialOverrides: matOvs } : {}),
      ...(variant.rigOverride ? { rigOverride: variant.rigOverride } : {}),
      ...(variant.productEnvironmentId ? { productEnvironmentId: variant.productEnvironmentId } : {}),
      ...(variant.portrait === true ? { portrait: true } : {}),
    };

    const viewResults: Array<{ yaw: number; png: string; sha256: string; headWidthPx: number; headHeightPx: number | null; headBoxPx: { x0: number; y0: number; x1: number; y1: number } | null; frameSpanFraction: number | null }> = [];
    let debug: unknown = null;
    for (const yaw of views) {
      const fileName = yaw === 0 ? `${variant.id}-front.png` : `${variant.id}-yaw${yaw}.png`;
      const abs = path.join(outDir, fileName);
      const evidence = await captureOne({
        page, baseUrl: server.url,
        spec: { ...baseSpec, subjectId: `${variant.id}_${yaw}`, yawDegrees: yaw, label: `${variant.id} yaw ${yaw}` },
        imagePath: abs,
        size,
      });
      const m = measureImage(abs);
      if (m.w !== size || m.h !== size || m.w !== m.h) {
        throw new Error(`variant ${variant.id} yaw ${yaw}: PNG is ${m.w}x${m.h}, expected square ${size}`);
      }
      if (m.luminanceStd <= 10) throw new Error(`variant ${variant.id} yaw ${yaw}: blank render`);
      const viewDebug = await page.evaluate(
        () => (globalThis as unknown as { __openClinXrIsolatedRuntimeDebug?: unknown }).__openClinXrIsolatedRuntimeDebug ?? null,
      );
      if (!viewDebug) throw new Error(`variant ${variant.id} yaw ${yaw}: no live runtime debug readout`);
      const portraitDbg = (viewDebug as { portrait?: { headHeightPx?: unknown; headBoxPx?: { x0: number; y0: number; x1: number; y1: number } } | null }).portrait;
      const headHeightPx = typeof portraitDbg?.headHeightPx === "number" ? portraitDbg.headHeightPx : null;
      const headBoxPx = portraitDbg?.headBoxPx ?? null;
      if (variant.portrait === true) {
        // Tight-portrait gate: chin-to-crown within 5% of 0.78 * frame.
        if (headHeightPx == null) throw new Error(`variant ${variant.id} yaw ${yaw}: no portrait headHeightPx readout`);
        const want = 0.78 * size;
        if (Math.abs(headHeightPx - want) > 0.05 * want) {
          throw new Error(`variant ${variant.id} yaw ${yaw}: headHeightPx ${headHeightPx.toFixed(1)} not within 5% of ${want.toFixed(1)}`);
        }
      } else if (m.headWidthPx < 500) {
        throw new Error(`variant ${variant.id} yaw ${yaw}: headWidthPx ${m.headWidthPx} < 500`);
      }
      viewResults.push({
        yaw,
        png: path.relative(cwd, abs).replaceAll("\\", "/"),
        sha256: sha256File(abs),
        headWidthPx: m.headWidthPx,
        headHeightPx,
        headBoxPx,
        frameSpanFraction: evidence.frameSpanFraction ?? null,
      });
      if (yaw === views[0]) debug = viewDebug;
    }
    if (!debug) throw new Error(`variant ${variant.id}: no live runtime debug readout`);

    const dbg = debug as Record<string, unknown>;
    const record: Record<string, unknown> = {
      id: variant.id,
      variant: {
        id: variant.id,
        views,
        renderSize: size,
        skinOverride: variant.skinOverride ?? null,
        materialOverrides: variant.materialOverrides ?? null,
        rigOverride: variant.rigOverride ?? null,
        productEnvironmentId: variant.productEnvironmentId ?? null,
        portrait: variant.portrait ?? false,
      },
      glb: { path: glbRepoPath, sha256: glbSha256 },
      rig: rigFile,
      inputs: inputShas,
      viewport: { width: size, height: size },
      headWidthMethod: "image: widest lit row span within the top 35% of lit rows (background #18211d threshold; shoulders excluded)",
      views: viewResults,
      hairHidden: true,
      renderer: {
        threeRevision: dbg.threeRevision,
        toneMapping: dbg.toneMapping,
        toneMappingExposure: dbg.toneMappingExposure,
        outputColorSpace: dbg.outputColorSpace,
      },
      lights: (dbg as { lights?: unknown }).lights ?? null,
      environmentMap: (dbg as { environmentMap?: unknown }).environmentMap ?? null,
      environmentIntensity: (dbg as { environmentIntensity?: unknown }).environmentIntensity ?? null,
      skinMaterial: (dbg as { skinMaterial?: unknown }).skinMaterial ?? null,
      skinOverrideApplied: (dbg as { skinOverrideApplied?: unknown }).skinOverrideApplied ?? null,
      materialInventory: (dbg as { materialInventory?: unknown }).materialInventory ?? null,
      materialOverridesApplied: (dbg as { materialOverridesApplied?: unknown }).materialOverridesApplied ?? null,
      productRig: (dbg as { productRig?: unknown }).productRig ?? null,
      portrait: (dbg as { portrait?: unknown }).portrait ?? null,
      runtimeDebug: debug,
      command: `MISE_TRUSTED_CONFIG_PATHS=$HOME/.grok/worktrees pnpm tsx tools/openclinxr/evidence/skin-realism/runtime-portrait-capture.ts --variant ${path.relative(cwd, variantPath).replaceAll("\\", "/")} --out ${path.relative(cwd, outDir).replaceAll("\\", "/")}`,
    };
    const landed = assertVariantLanded(variant, record);
    (record as { landedChecks?: string[] }).landedChecks = landed;
    await writeFile(path.join(outDir, `${variant.id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    console.log(`variant ${variant.id} ok: ${landed.join(" | ")}`);
  } finally {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
  }
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Minimal PNG encoder (8-bit RGB, filter 0) for sheet crops. */
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePngRgb(w: number, h: number, rgb: Uint8Array): Buffer {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.subarray(y * w * 3, (y + 1) * w * 3)).copy(raw, y * (w * 3 + 1) + 1);
  }
  const idat = deflateSync(raw);
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", new Uint8Array(idat)), pngChunk("IEND", new Uint8Array(0))]);
}

/** Square head crop (+margin of box size, clamped) bilinear-resized to `dst` px. */
export function cropHeadSquare(
  pngPath: string,
  box: { x0: number; y0: number; x1: number; y1: number },
  margin: number,
  dst: number,
): Buffer {
  const png = decodePng(pngPath);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const side = Math.max(bw, bh) * (1 + 2 * margin);
  let cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  cx = Math.min(Math.max(cx, side / 2), png.w - side / 2);
  cy = Math.min(Math.max(cy, side / 2), png.h - side / 2);
  const x0 = cx - side / 2, y0 = cy - side / 2;
  const out = new Uint8Array(dst * dst * 3);
  const sample = (x: number, y: number, ch: number): number => {
    const xi = Math.min(png.w - 1, Math.max(0, Math.floor(x)));
    const yi = Math.min(png.h - 1, Math.max(0, Math.floor(y)));
    const i = (yi * png.w + xi) * png.chans + Math.min(ch, png.chans - 1);
    return png.data[i]!;
  };
  for (let y = 0; y < dst; y += 1) {
    for (let x = 0; x < dst; x += 1) {
      const sx = x0 + ((x + 0.5) / dst) * side;
      const sy = y0 + ((y + 0.5) / dst) * side;
      for (let ch = 0; ch < 3; ch += 1) out[(y * dst + x) * 3 + ch] = Math.round(sample(sx, sy, ch));
    }
  }
  return encodePngRgb(dst, dst, out);
}
export function centralFaceLuma(pngPath: string): number {
  const png = decodePng(pngPath);
  const { w, h, chans, data } = png;
  const x0 = Math.floor(w * 0.35), x1 = Math.ceil(w * 0.65);
  const y0 = Math.floor(h * 0.35), y1 = Math.ceil(h * 0.65);
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * w + x) * chans;
      const r = data[i]!, g = data[i + 1] ?? r, b = data[i + 2] ?? r;
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      n += 1;
    }
  }
  return sum / Math.max(n, 1);
}

export async function compositeSheet(input: {
  cells: Array<{ abs: string | null; label: string }>;
  columns: number;
  cellW: number;
  cellH: number;
  outPng: string;
}): Promise<void> {
  const { cells, columns, cellW, cellH, outPng } = input;
  let browser = null as Awaited<ReturnType<typeof import("../lib/slotted-playwright.js").chromium.launch>> | null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const labelH = 40;
    const rows = Math.ceil(cells.length / columns);
    const width = columns * cellW, height = rows * (cellH + labelH);
    const htmlCells = cells.map((c) => {
      const img = c.abs
        ? `<img src="data:image/png;base64,${readFileSync(c.abs).toString("base64")}" width="${cellW}" height="${cellH}" style="display:block;object-fit:contain;background:#18211d"/>`
        : `<div style="width:${cellW}px;height:${cellH}px;background:#0f1613"></div>`;
      return `<div style="width:${cellW}px;height:${cellH + labelH}px;background:#0f1613;box-sizing:border-box">`
        + `<div style="height:${labelH}px;line-height:${labelH}px;padding:0 12px;color:#e8f5ef;font:16px/40px Menlo,Consolas,monospace;white-space:nowrap;overflow:hidden">${escapeHtml(c.label)}</div>`
        + img + `</div>`;
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"/><style>html,body{margin:0;background:#0f1613}`
      + `.grid{display:grid;grid-template-columns:repeat(${columns},${cellW}px);width:${width}px;height:${height}px}`
      + `</style></head><body><div class="grid">${htmlCells.join("")}</div></body></html>`;
    await page.setViewportSize({ width, height });
    await page.setContent(html, { waitUntil: "load" });
    await page.locator(".grid").screenshot({ path: outPng });
    const [w, h] = pngDims(outPng);
    console.log(`sheet ok: ${cells.length} cells ${w}x${h} -> ${outPng}`);
  } finally {
    if (browser) await browser.close();
  }
}

async function runSheetMode(input: { cwd: string; outDir: string }): Promise<void> {
  const { cwd, outDir } = input;
  const entries = (await readdir(outDir)).filter((f) => /^v[0-9][a-z0-9-]*-front\.png$/.test(f)).sort();
  if (!entries.length) throw new Error(`no v*-front.png cells in ${outDir}`);
  const fineBRel = ".openclinxr/realism-spike/realism-95/shader/aisha-fine-b-s2.00-v0.92-l1.png";
  const targetRel = ".openclinxr/realism-spike/realism-targets/aisha-target.png";
  for (const rel of [fineBRel, targetRel]) readFileSync(path.join(cwd, rel));
  const cells: Array<{ abs: string | null; label: string }> = [
    ...entries.map((f) => ({ abs: path.join(outDir, f) as string | null, label: f.replace(/-front\.png$/, "") })),
    { abs: path.join(cwd, fineBRel), label: "fine-b (EEVEE)" },
    { abs: path.join(cwd, targetRel), label: "target" },
  ];
  await compositeSheet({ cells, columns: cells.length, cellW: 640, cellH: 640, outPng: path.join(outDir, "sheet.png") });
}

async function runCheckMode(input: { cwd: string; outDir: string }): Promise<void> {
  const { cwd, outDir } = input;
  const base = path.join(cwd, ".openclinxr/realism-spike/runtime/aisha-runtime-front.png");
  const v0 = path.join(outDir, "v0-baseline-front.png");
  const v1 = path.join(outDir, "v1-rig-front.png");
  const d0 = meanAbsDiff(v0, base);
  console.log(`v0 vs runtime baseline meanAbsDiff=${d0.toFixed(3)} (must be < 1.0)`);
  if (!(d0 < 1.0)) throw new Error(`v0 does not reproduce the baseline: ${d0}`);
  const d1 = meanAbsDiff(v1, v0);
  console.log(`v1 vs v0 meanAbsDiff=${d1.toFixed(3)} (must be > 5.0)`);
  if (!(d1 > 5.0)) throw new Error(`v1 rig change is not visible: ${d1}`);
  const defs = (await readdir(outDir)).filter((f) => f.endsWith(".variant.json")).sort();
  if (!defs.length) throw new Error(`no .variant.json defs in ${outDir}`);
  for (const def of defs) {
    const variant = JSON.parse(readFileSync(path.join(outDir, def), "utf8")) as VariantDef;
    const record = JSON.parse(readFileSync(path.join(outDir, `${variant.id}.json`), "utf8")) as Record<string, unknown>;
    const landed = assertVariantLanded(variant, record);
    console.log(`${variant.id}: ${landed.join(" | ")}`);
  }
  console.log("checks ok");
}

/** Two-row product sheet: row 1 fronts, row 2 yaw40s; references close both rows. */
async function runProductSheetMode(input: { cwd: string; outDir: string }): Promise<void> {
  const { cwd, outDir } = input;
  const ids = (await readdir(outDir))
    .filter((f) => f.endsWith(".variant.json"))
    .map((f) => (JSON.parse(readFileSync(path.join(outDir, f), "utf8")) as VariantDef).id)
    .sort();
  if (!ids.length) throw new Error(`no .variant.json defs in ${outDir}`);
  const fineBRel = ".openclinxr/realism-spike/realism-95/shader/aisha-fine-b-s2.00-v0.92-l1.png";
  const targetFrontRel = ".openclinxr/realism-spike/target-views/target-front.png";
  const target3qRel = ".openclinxr/realism-spike/target-views/target-3q-left.png";
  for (const rel of [fineBRel, targetFrontRel, target3qRel]) readFileSync(path.join(cwd, rel));
  for (const id of ids) {
    for (const suffix of ["-front.png", "-yaw40.png"]) readFileSync(path.join(outDir, `${id}${suffix}`));
  }
  const row1: Array<{ abs: string | null; label: string }> = [
    ...ids.map((id) => ({ abs: path.join(outDir, `${id}-front.png`) as string | null, label: id })),
    { abs: path.join(cwd, fineBRel), label: "fine-b EEVEE" },
    { abs: path.join(cwd, targetFrontRel), label: "target" },
  ];
  const row2: Array<{ abs: string | null; label: string }> = [
    ...ids.map((id) => ({ abs: path.join(outDir, `${id}-yaw40.png`) as string | null, label: `${id} yaw40` })),
    { abs: null, label: "—" },
    { abs: path.join(cwd, target3qRel), label: "target 3q" },
  ];
  await compositeSheet({
    cells: [...row1, ...row2],
    columns: row1.length,
    cellW: 512,
    cellH: 512,
    outPng: path.join(outDir, "sheet.png"),
  });
}

/** Product gates: ACES + rig sha on p0, headHeight within 5% everywhere, 2048 albedo on candidates, face luma band on p0. */
async function runProductCheckMode(input: { cwd: string; outDir: string }): Promise<void> {
  const { cwd, outDir } = input;
  const defs = (await readdir(outDir)).filter((f) => f.endsWith(".variant.json")).sort();
  if (!defs.length) throw new Error(`no .variant.json defs in ${outDir}`);
  const rigRel = "apps/ui-xr/public/xr-assets/lighting/ob_triage_room_v1.rig.json";
  const rigSha = createHash("sha256").update(readFileSync(path.join(cwd, rigRel))).digest("hex");
  for (const def of defs) {
    const variant = JSON.parse(readFileSync(path.join(outDir, def), "utf8")) as VariantDef;
    const record = JSON.parse(readFileSync(path.join(outDir, `${variant.id}.json`), "utf8")) as Record<string, unknown>;
    const landed = assertVariantLanded(variant, record);
    console.log(`${variant.id}: ${landed.join(" | ")}`);
    const size = ((record.viewport as { width?: unknown }).width as number) ?? 1024;
    const want = 0.78 * size;
    for (const v of record.views as Array<{ yaw?: unknown; headHeightPx?: unknown }>) {
      const hh = v.headHeightPx;
      console.log(`${variant.id} yaw ${String(v.yaw)} headHeightPx=${typeof hh === "number" ? hh.toFixed(1) : String(hh)} want=${want.toFixed(1)}`);
      if (typeof hh !== "number" || Math.abs(hh - want) > 0.05 * want) {
        throw new Error(`${variant.id} yaw ${String(v.yaw)}: headHeightPx outside 5% of ${want.toFixed(1)}`);
      }
    }
    if (variant.id !== "p0-shipped" && variant.id !== "p1-graded") {
      const skin = record.skinMaterial as { baseColorTextureSize?: unknown };
      const texSize = JSON.stringify(skin.baseColorTextureSize);
      console.log(`${variant.id} baseColorTextureSize=${texSize} want=[2048,2048]`);
      if (texSize !== "[2048,2048]") throw new Error(`${variant.id}: candidate albedo is not 2048`);
    }
  }
  const p0 = JSON.parse(readFileSync(path.join(outDir, "p0-shipped.json"), "utf8")) as Record<string, unknown>;
  const rig = p0.rig as { sha256?: unknown; exposure?: unknown };
  console.log(`p0 rigSha=${String(rig.sha256)} want=${rigSha}`);
  if (rig.sha256 !== rigSha) throw new Error("p0 rig sha mismatch");
  const renderer = p0.renderer as { toneMapping?: unknown };
  console.log(`p0 toneMapping=${String(renderer.toneMapping)} want=4 (ACESFilmic)`);
  if (renderer.toneMapping !== 4) throw new Error("p0 toneMapping is not ACESFilmic");
  const luma = centralFaceLuma(path.join(outDir, "p0-shipped-front.png"));
  console.log(`p0 central-face luma=${luma.toFixed(1)} (band 90..200)`);
  const lights = p0.lights as unknown;
  if (luma < 90 || luma > 200) {
    console.log(`p0 luma outside band — NOT tuning lights; live light list: ${JSON.stringify(lights)}`);
    throw new Error(`p0 face luma ${luma.toFixed(1)} outside 90..200`);
  }
  console.log("product checks ok");
}

/** Studio sheet: s0 | s1 | s2 | fine-b | target, render cells cropped to the recorded head box (+8% margin) at 640 px. */
async function runStudioSheetMode(input: { cwd: string; outDir: string }): Promise<void> {
  const { cwd, outDir } = input;
  const ids = ["s0-shipped", "s1-toigo-natural"];
  if (readFileSync(path.join(outDir, "s2-composite-front.png")) && readFileSync(path.join(outDir, "s2-composite.json"))) {
    ids.push("s2-composite");
  }
  const cells: Array<{ abs: string | null; label: string }> = [];
  for (const id of ids) {
    const record = JSON.parse(readFileSync(path.join(outDir, `${id}.json`), "utf8")) as {
      views: Array<{ png?: unknown; headBoxPx?: { x0: number; y0: number; x1: number; y1: number } | null }>;
    };
    const front = record.views[0];
    if (!front || typeof front.png !== "string" || !front.headBoxPx) {
      throw new Error(`${id}: no recorded front headBoxPx for the crop`);
    }
    const cropPath = path.join(outDir, `crop-${id}.png`);
    await writeFile(cropPath, cropHeadSquare(path.join(cwd, front.png as string), front.headBoxPx, 0.08, 640));
    cells.push({ abs: cropPath, label: id });
  }
  const fineBRel = ".openclinxr/realism-spike/realism-95/shader/aisha-fine-b-s2.00-v0.92-l1.png";
  cells.push({ abs: path.join(cwd, fineBRel), label: "fine-b EEVEE" });
  cells.push({ abs: path.join(cwd, ".openclinxr/realism-spike/studio-rig/target-front.png"), label: "target" });
  await compositeSheet({ cells, columns: cells.length, cellW: 640, cellH: 640, outPng: path.join(outDir, "sheet.png") });
}

if (invokedDirectly) {
  const args = parseCliArgs(process.argv.slice(2));
  const cwd = process.cwd();
  (async () => {
    if (args.variant) {
      if (!args.out) throw new Error("--variant requires --out <dir>");
      await runVariantMode({
        cwd,
        variantPath: path.resolve(args.variant),
        outDir: path.resolve(args.out),
        glbRepoPath: args.glb ?? GLB_REPO_PATH,
      });
    } else if (args.sheet) {
      if (!args.out) throw new Error("--sheet requires --out <variants dir>");
      await runSheetMode({ cwd, outDir: path.resolve(args.out) });
    } else if (args.productSheet) {
      if (!args.out) throw new Error("--product-sheet requires --out <variants dir>");
      await runProductSheetMode({ cwd, outDir: path.resolve(args.out) });
    } else if (args.productCheck) {
      if (!args.out) throw new Error("--product-check requires --out <variants dir>");
      await runProductCheckMode({ cwd, outDir: path.resolve(args.out) });
    } else if (args.studioSheet) {
      if (!args.out) throw new Error("--studio-sheet requires --out <studio dir>");
      await runStudioSheetMode({ cwd, outDir: path.resolve(args.out) });
    } else if (args.check) {
      if (!args.out) throw new Error("--check requires --out <variants dir>");
      await runCheckMode({ cwd, outDir: path.resolve(args.out) });
    } else {
      await runRuntimePortraitCapture();
    }
  })().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
