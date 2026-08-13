/**
 * MPFB eye-colour inspection (#356) — the first-measurement instrument for "every actor has the
 * same eyes".
 *
 * factory_step: instrument. Measures, per shipped MPFB cast actor, the iris texture identity
 * (sha256 / bytes / pixel dims), the baseColorFactor, and the PIXEL CHARACTER of the embedded
 * iris map — the column that decides the approach:
 *
 *   - if the iris is effectively GREYSCALE (R≈G≈B everywhere), a derived per-actor tint is honest
 *     and needs no second asset;
 *   - if it is BAKED brown, tinting produces a muddy brown-green and a second licence-clear asset
 *     (or a derived recolor of a greyscale channel) is required.
 *
 * It also censuses the provider cache directory the materializer reads
 * (`.openclinxr-local/provider-cache/eyes/makehuman-default/`): which files exist, and the licence
 * header each carries. The upstream `makehumancommunity/makehuman2` `data/eyes/hm08` layout is
 * recorded as measured (gh API) so "no second asset exists" is an observed fact, not an absence
 * someone re-litigates.
 *
 * claimScope: deterministic file-side iris identity + pixel-character properties of the SHIPPED
 * bytes, and the provider-cache census. notEvidenceFor: how eyes render (pixel grade), clinical
 * eye realism, which eye colour "belongs" to a case.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { NodeIO } from "@gltf-transform/core";

export const MPFB_EYE_COLOUR_EVIDENCE_ROOT = ".openclinxr/evidence/mpfb-eye-colour";

export const MPFB_EYE_COLOUR_ACTORS = [
  {
    id: "child",
    role: "child",
    actorRole: "patient",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb",
  },
  {
    id: "aisha",
    role: "adult_female",
    actorRole: "parent",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
  },
  {
    id: "kevin",
    role: "adult_male",
    actorRole: "nurse",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb",
  },
] as const;

/** The provider cache directory the materializer's `_eyes_dir` resolves. */
export const EYES_CACHE_DIR = ".openclinxr-local/provider-cache/eyes/makehuman-default";

export type IrisPixelStats = {
  /** IHDR colour type: 0 grey, 2 RGB, 4 grey+alpha, 6 RGBA. */
  pngColourType: number;
  samples: number;
  /** Per-pixel max(|R-G|,|G-B|,|R-B|) — ~0 everywhere means greyscale. */
  channelSpread: { mean: number; max: number; p95: number };
  /** Pixels whose channel spread exceeds the chromatic threshold (baked colour). */
  chromatic: { count: number; fraction: number };
  /** Dominant hue (degrees 0-360) over chromatic pixels, when any exist. */
  hue: { meanDeg: number | null; sdDeg: number | null };
  classification: "greyscale" | "baked_colour" | "mixed";
};

export type IrisTextureReport = {
  materialName: string;
  textureName: string;
  sha256: string;
  sha256Short: string;
  bytes: number;
  pngWidth: number | null;
  pngHeight: number | null;
  baseColorFactor: [number, number, number];
  pixels: IrisPixelStats | null;
};

export type CacheFileReport = {
  name: string;
  bytes: number;
  /** First licence-signalling lines of the file ('license', 'cc0', 'copyright'). */
  licenceHeader: string[];
};

export type MpfbEyeColourPreFix = {
  schemaVersion: "openclinxr.mpfb-eye-colour.pre-fix.v1";
  issue: "356";
  factoryStep: "instrument";
  measuredAt: string;
  generator: {
    tool: "inspectMpfbEyeColour";
    file: "tools/openclinxr/evidence/mpfb-eye-colour-inspection.ts";
    deterministic: true;
    llmInvolved: false;
  };
  actors: Array<{
    actorId: string;
    role: string;
    actorRole: string;
    glb: string;
    irisTexture: IrisTextureReport;
  }>;
  providerCache: {
    dir: string;
    files: CacheFileReport[];
    /** Measured upstream layout (gh API) — does a second licence-clear iris asset exist? */
    upstream: {
      repo: string;
      path: string;
      entries: string[];
      materials: string[];
      secondIrisAssetAvailable: boolean;
      note: string;
    };
    /** The official CC0 MakeHuman community pack the fix stages from. */
    systemAssetsPack: {
      name: string;
      url: string;
      licence: string;
      eyeColours: string[];
      note: string;
    };
  };
  /** The decision column: does a derived per-actor tint of the shared map read honestly? */
  approach: {
    irisIsGreyscale: boolean;
    recommendation: string;
  };
  claimScope: string[];
  notEvidenceFor: string[];
};

function resolveRepoPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

/**
 * Minimal PNG reader: IHDR colour type + per-pixel channel spread / hue over a subsample.
 * Same decoder family as `pngLuminanceSd` in mpfb-eyes-inspection.ts (no pngjs dependency).
 * Returns null when the bytes are not a decodable 8-bit PNG.
 */
export function pngPixelStats(bytes: Uint8Array): IrisPixelStats | null {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = -1;
  const idat: Uint8Array[] = [];
  let off = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    const body = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!;
      colour = bytes[off + 17]!;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || w === 0 || h === 0) return null;
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (chans === 0) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  } catch {
    return null;
  }
  const stride = w * chans;
  if (raw.length < (stride + 1) * h) return null;

  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const spreads: number[] = [];
  const hues: number[] = [];
  let n = 0;
  let p = 0;
  const CHROMATIC_THRESHOLD = 12; // /255 — a baked brown iris sits far above this
  for (let y = 0; y < h; y += 1) {
    const filter = raw[p++]!;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[p + x]!;
      const a = x >= chans ? cur[x - chans]! : 0;
      const b = prev[x]!;
      const c = x >= chans ? prev[x - chans]! : 0;
      let v: number;
      if (filter === 0) v = rawByte;
      else if (filter === 1) v = rawByte + a;
      else if (filter === 2) v = rawByte + b;
      else if (filter === 3) v = rawByte + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    p += stride;
    // Sample every 2nd pixel (rows already step by 1; cols step by 2) — plenty for a histogram.
    for (let x = 0; x + chans <= stride; x += chans * 2) {
      const r = chans >= 3 ? cur[x]! : cur[x]!;
      const g = chans >= 3 ? cur[x + 1]! : cur[x]!;
      const b2 = chans >= 3 ? cur[x + 2]! : cur[x]!;
      const spread = Math.max(Math.abs(r - g), Math.abs(g - b2), Math.abs(r - b2));
      spreads.push(spread);
      if (spread >= CHROMATIC_THRESHOLD) {
        const mx = Math.max(r, g, b2);
        const mn = Math.min(r, g, b2);
        let hue = 0;
        if (mx !== mn) {
          const d = mx - mn;
          if (mx === r) hue = ((g - b2) / d) % 6;
          else if (mx === g) hue = (b2 - r) / d + 2;
          else hue = (r - g) / d + 4;
          hue *= 60;
          if (hue < 0) hue += 360;
        }
        hues.push(hue);
      }
      n += 1;
    }
    prev.set(cur);
  }
  if (n === 0) return null;

  const meanSpread = spreads.reduce((s, v) => s + v, 0) / spreads.length;
  const sorted = [...spreads].sort((x, y) => x - y);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  const maxSpread = sorted[sorted.length - 1]!;

  let hueMean: number | null = null;
  let hueSd: number | null = null;
  if (hues.length > 0) {
    hueMean = hues.reduce((s, v) => s + v, 0) / hues.length;
    // Circular sd via mean resultant length — hue is a circle, a plain sd wraps at 0/360.
    const rad = hues.map((v) => (v * Math.PI) / 180);
    const R = Math.hypot(
      rad.reduce((s, v) => s + Math.cos(v), 0) / rad.length,
      rad.reduce((s, v) => s + Math.sin(v), 0) / rad.length,
    );
    hueSd = (Math.sqrt(-2 * Math.log(Math.max(R, 1e-9))) * 180) / Math.PI;
  }

  const chromaticFraction = hues.length / n;
  const classification: IrisPixelStats["classification"] =
    meanSpread < 4 && chromaticFraction < 0.005
      ? "greyscale"
      : chromaticFraction > 0.5 && hueMean !== null && hueSd !== null && hueSd < 60
        ? "baked_colour"
        : "mixed";

  return {
    pngColourType: colour,
    samples: n,
    channelSpread: { mean: Math.round(meanSpread * 100) / 100, max: maxSpread, p95 },
    chromatic: { count: hues.length, fraction: Math.round(chromaticFraction * 10000) / 10000 },
    hue: { meanDeg: hueMean === null ? null : Math.round(hueMean * 10) / 10, sdDeg: hueSd === null ? null : Math.round(hueSd * 10) / 10 },
    classification,
  };
}

/** Licence-signalling first lines of a cache file (header comment scan). */
export function licenceHeaderOf(filePath: string, maxLines = 12): string[] {
  const raw = readFileSync(filePath, "utf8").slice(0, 4096);
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/license|licence|cc0|copyright|released as/i.test(t)) out.push(t.slice(0, 140));
    if (out.length >= maxLines) break;
  }
  return out;
}

export async function inspectMpfbEyeColour(glb: string): Promise<IrisTextureReport> {
  const io = new NodeIO();
  const doc = await io.read(resolveRepoPath(glb));

  for (const mesh of doc.getRoot().listMeshes()) {
    if (!/eye/i.test(mesh.getName() ?? "")) continue;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const tex = mat?.getBaseColorTexture();
      const img = tex?.getImage();
      if (!mat || !tex || !img) continue;
      const hash = createHash("sha256").update(img).digest("hex");
      const factor = mat.getBaseColorFactor() ?? [1, 1, 1, 1];
      const pixels = pngPixelStats(img);
      const dims = readIhdr(img);
      return {
        materialName: mat.getName() ?? "",
        textureName: tex.getName() ?? "",
        sha256: hash,
        sha256Short: hash.slice(0, 16),
        bytes: img.byteLength,
        pngWidth: dims?.width ?? null,
        pngHeight: dims?.height ?? null,
        baseColorFactor: [factor[0]!, factor[1]!, factor[2]!],
        pixels,
      };
    }
  }
  throw new Error(`${glb}: no eye material with a base-color texture found`);
}

function readIhdr(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

export async function writeMpfbEyeColourPreFix(options?: { cwd?: string; outputRoot?: string }): Promise<MpfbEyeColourPreFix> {
  const cwd = options?.cwd ?? process.cwd();
  const outputRoot = options?.outputRoot ?? MPFB_EYE_COLOUR_EVIDENCE_ROOT;

  const actors: MpfbEyeColourPreFix["actors"] = [];
  for (const actor of MPFB_EYE_COLOUR_ACTORS) {
    const irisTexture = await inspectMpfbEyeColour(actor.glb);
    actors.push({
      actorId: actor.id,
      role: actor.role,
      actorRole: actor.actorRole,
      glb: actor.glb,
      irisTexture,
    });
  }

  const cacheDir = path.join(cwd, EYES_CACHE_DIR);
  let files: CacheFileReport[] = [];
  try {
    files = readdirSync(cacheDir)
      .filter((n) => !n.startsWith("."))
      .sort()
      .map((name) => {
        const p = path.join(cacheDir, name);
        const stat = readFileSync(p);
        return { name, bytes: stat.byteLength, licenceHeader: licenceHeaderOf(p) };
      });
  } catch {
    files = [];
  }

  const shas = actors.map((a) => a.irisTexture.sha256);
  const distinctShas = new Set(shas).size;
  const allGrey = actors.every((a) => a.irisTexture.pixels?.classification === "greyscale");

  const preFix: MpfbEyeColourPreFix = {
    schemaVersion: "openclinxr.mpfb-eye-colour.pre-fix.v1",
    issue: "356",
    factoryStep: "instrument",
    measuredAt: new Date().toISOString(),
    generator: {
      tool: "inspectMpfbEyeColour",
      file: "tools/openclinxr/evidence/mpfb-eye-colour-inspection.ts",
      deterministic: true,
      llmInvolved: false,
    },
    actors,
    providerCache: {
      dir: EYES_CACHE_DIR,
      files,
      upstream: {
        repo: "makehumancommunity/makehuman2",
        path: "data/eyes/hm08",
        entries: ["high-poly", "low-poly", "materials", "selection_filter.json"],
        materials: ["brown.mhmat", "brown_eye.png"],
        secondIrisAssetAvailable: false,
        note: "Measured via gh API 2026-08-13: data/eyes contains only hm08, and its materials dir "
          + "contains only brown.mhmat + brown_eye.png. No second iris variant exists in the "
          + "makehuman2 repo itself; the high-poly eye shares the same brown material.",
      },
      systemAssetsPack: {
        name: "makehuman_system_assets",
        url: "https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html",
        licence: "CC0 1.0 — every staged <colour>.mhmat carries the same in-file header as hm08 "
          + "('This asset was explicitly released as CC0 in september 2020', Data Collection AB / "
          + "Joel Palmius / Jonas Hauquier); pack page licence column also CC0",
        eyeColours: ["blue", "bluegreen", "brown", "brownlight", "deepblue", "green", "grey", "ice", "lightblue"],
        note: "Measured 2026-08-13: downloaded makehuman_system_assets_cc0.zip (files2 mirror, "
          + "280,737,770 bytes) and extracted eyes/materials/. Each colour is <colour>.mhmat + "
          + "<colour>_eye.png (610,817-701,486 bytes, 1024x1024 RGBA, luminance sd 33.71-39.96). "
          + "pack brown_eye.png sha256 == shipped iris sha256 (4659691c7295ad62) — the SAME asset "
          + "already on the rail. A second licence-clear iris asset therefore EXISTS.",
      },
    },
    approach: {
      irisIsGreyscale: allGrey,
      recommendation: allGrey
        ? "Greyscale iris: a derived per-actor recolor of the shared map is honest and needs no "
          + "second asset — tint the TEXTURE (not the factor) per actor."
        : "Baked-colour iris (not greyscale — naive tinting would be muddy), but a licence-clear "
          + "second asset EXISTS: makehuman_system_assets_cc0.zip (CC0 in-file headers), 9 iris "
          + "colours. Fix = per-actor iris textures from the pack's declared <colour>.mhmat "
          + "materials, role-driven (treatment d).",
    },
    claimScope: [
      "deterministic_file_side_iris_identity_properties",
      "iris_pixel_character_greyscale_vs_baked_colour",
      "provider_cache_census_and_upstream_second_asset_availability",
    ],
    notEvidenceFor: [
      "how_eyes_render_in_a_crop_pixel_grade_required",
      "clinical_eye_realism",
      "which_eye_colour_belongs_to_which_case",
    ],
  };

  const outDir = path.join(cwd, outputRoot);
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "pre-fix.json");
  writeFileSync(outPath, `${JSON.stringify(preFix, null, 2)}\n`, "utf8");
  return preFix;
}

const isMain = Boolean(
  process.argv[1]
  && (import.meta.url === `file://${path.resolve(process.argv[1])}`
    || import.meta.url.endsWith(process.argv[1]!.replaceAll("\\", "/"))),
);

if (isMain) {
  writeMpfbEyeColourPreFix()
    .then((preFix) => {
      const summary = {
        path: path.join(MPFB_EYE_COLOUR_EVIDENCE_ROOT, "pre-fix.json"),
        actors: preFix.actors.map((a) => ({
          actorId: a.actorId,
          irisSha: a.irisTexture.sha256Short,
          irisBytes: a.irisTexture.bytes,
          png: `${a.irisTexture.pngWidth}x${a.irisTexture.pngHeight ?? "?"}`,
          baseColorFactor: a.irisTexture.baseColorFactor,
          classification: a.irisTexture.pixels?.classification,
          channelSpreadMean: a.irisTexture.pixels?.channelSpread.mean,
          chromaticFraction: a.irisTexture.pixels?.chromatic.fraction,
          hueMeanDeg: a.irisTexture.pixels?.hue.meanDeg,
        })),
        cache: preFix.providerCache.files.map((f) => ({ name: f.name, bytes: f.bytes, licence: f.licenceHeader[0] ?? "" })),
        upstream: preFix.providerCache.upstream,
        recommendation: preFix.approach.recommendation,
      };
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
