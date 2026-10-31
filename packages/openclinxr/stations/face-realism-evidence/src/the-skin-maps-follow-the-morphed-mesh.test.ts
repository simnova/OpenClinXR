/**
 * The skin maps follow the morphed mesh.
 *
 * Manifest contract (tools/openclinxr/asset-pipeline/skin/maps/maps-manifest.json):
 * the wrinkle normal, curvature, cavity and pore tile cite the MORPHED Aisha
 * body (58775 verts merged on import -- never the 13380-vert hm08 base), each
 * with size, store path and sha256 plus the bake command and input mesh sha.
 * G1 consistency: a numeric on-vs-off gap below the stock-vs-Aisha threshold
 * must carry a DROP verdict; null-gap maps (no variant field) must name the
 * exact file:line that would need the change.
 *
 * Store checks run only when /Volumes/files/openclinxr-assets/store/skin-maps
 * exists; otherwise a single 'store absent' test records the skip.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "@openclinxr/factory-station-core/runner";
/** Relocated evidence: skin sources stay under tools/ (S4); anchor via the repo-root helper (S5). */
const DIR = path.join(repoRoot(), "tools/openclinxr/asset-pipeline/skin/maps");
const MANIFEST_PATH = path.join(DIR, "maps-manifest.json");
const STORE = "/Volumes/files/openclinxr-assets/store/skin-maps";
const HM08_BASE_VERTS = 13380;

type SkinMap = {
  kind?: unknown;
  file?: unknown;
  size?: unknown;
  store?: unknown;
  sha256?: unknown;
  g1OnVsOff1280?: unknown;
  g1Note?: unknown;
  questVerdict?: unknown;
};
type Manifest = {
  inputGlbSha256?: unknown;
  inputMesh?: { verts?: unknown; faces?: unknown; meshSha256RoundedPositions?: unknown };
  threshold?: { valueMeanAbsDiff255?: unknown };
  bakeCommand?: unknown;
  maps?: unknown;
};

function readManifest(): Manifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" }).split(" ")[0]!;
}

/** Minimal PNG decoder: 8-bit non-interlaced RGB/RGBA (Blender output). */
function decodePngSimple(file: string): { w: number; h: number; rgb: Uint8Array } {
  const bytes = fs.readFileSync(file);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint32(16), h = dv.getUint32(20);
  const depth = bytes[24]!, colour = bytes[25]!;
  if (depth !== 8 || (colour !== 2 && colour !== 6)) {
    throw new Error(`unsupported PNG (need 8-bit RGB/RGBA): ${file}`);
  }
  const chans = colour === 2 ? 3 : 4;
  const idat: Buffer[] = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    if (type === "IDAT") idat.push(Buffer.from(bytes.subarray(off + 8, off + 8 + len)));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * chans;
  const px = new Uint8Array(w * h * 3);
  const cur = new Uint8Array(stride);
  let prev = new Uint8Array(stride), p = 0;
  for (let y = 0; y < h; y += 1) {
    const f = raw[p++]!;
    for (let x = 0; x < stride; x += 1) {
      const rb = raw[p + x]!;
      const a = x >= chans ? cur[x - chans]! : 0;
      const b = prev[x]!;
      const c = x >= chans ? prev[x - chans]! : 0;
      let v: number;
      if (f === 0) v = rb;
      else if (f === 1) v = rb + a;
      else if (f === 2) v = rb + b;
      else if (f === 3) v = rb + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    p += stride;
    for (let x = 0; x < w; x += 1) {
      px[(y * w + x) * 3] = cur[x * chans]!;
      px[(y * w + x) * 3 + 1] = cur[x * chans + 1]!;
      px[(y * w + x) * 3 + 2] = cur[x * chans + 2]!;
    }
    prev = Uint8Array.from(cur);
  }
  return { w, h, rgb: px };
}

const STATUSES = ["baked_unwired", "shipped", "dropped", "blocked"] as const;

/** Per-map manifest rules: status closed set; shipped needs a crop sheet;
 *  anything but blocked needs store bytes. Returns error lines (empty = ok). */
function validateMap(e: SkinMap): string[] {
  const errs: string[] = [];
  const kind = String((e as { kind?: unknown }).kind ?? "?");
  const status = (e as { status?: unknown }).status;
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    errs.push(`${kind}: status ${String(status)} not in ${STATUSES.join(",")}`);
  }
  if (status === "shipped" && !(e as { gradeSheet?: unknown }).gradeSheet) {
    errs.push(`${kind}: status shipped with no crop sheet path`);
  }
  if (status !== "blocked") {
    if (!/^assets:skin-maps\//.test(String((e as { store?: unknown }).store ?? ""))) {
      errs.push(`${kind}: store path missing`);
    }
    if (!/^[0-9a-f]{64}$/.test(String((e as { sha256?: unknown }).sha256 ?? ""))) {
      errs.push(`${kind}: sha256 missing`);
    }
    const size = (e as { size?: unknown }).size as number[] | null;
    if (!Array.isArray(size) || size.length !== 2) errs.push(`${kind}: size missing`);
  }
  return errs;
}

describe("maps-manifest contract", () => {
  it("names the morphed mesh, the bake command and four maps", () => {
    const m = readManifest();
    expect(typeof m.bakeCommand).toBe("string");
    expect((m.bakeCommand as string)).toContain("bake_skin_maps.py");
    expect(m.inputMesh?.verts).toBe(58775);
    expect(m.inputMesh?.verts).not.toBe(HM08_BASE_VERTS);
    expect(m.inputMesh?.meshSha256RoundedPositions).toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(m.maps)).toBe(true);
    expect((m.maps as SkinMap[]).map((e) => e.kind)).toEqual(
      ["curvature", "cavity", "pore-normal-tile", "wrinkle-normal"]);
    for (const e of m.maps as SkinMap[]) {
      expect(validateMap(e)).toEqual([]);
    }
  });

  it("known-bad: shipped with no crop sheet is rejected", () => {
    const errs = validateMap({ kind: "knows-bad", status: "shipped" } as SkinMap);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(" ")).toContain("no crop sheet path");
  });

  it("withheld wrinkle map is recorded with evidence, not shipped silently", () => {
    const m = readManifest();
    const blocked = (m as { blocked?: { kind?: unknown; status?: unknown; evidence?: unknown } }).blocked;
    expect(blocked?.kind).toBe("wrinkle-normal");
    expect(blocked?.status).toContain("NOT SHIPPED");
    expect(blocked?.evidence).toContain("UV layout diverges");
  });

  it("gate verdicts follow the measured gaps", () => {
    const m = readManifest();
    const threshold = m.threshold?.valueMeanAbsDiff255 as number;
    expect(threshold).toBe(12.679);
    for (const e of m.maps as SkinMap[]) {
      const status = (e as { status?: unknown }).status;
      if (status === "blocked") {
        expect(e.questVerdict).toMatch(/WITHDRAWN/);
      } else if (typeof e.g1OnVsOff1280 === "number") {
        expect(e.questVerdict).toEqual(
          (e.g1OnVsOff1280 as number) >= threshold
            ? expect.stringContaining("KEEP")
            : expect.stringContaining("DROP"));
      } else {
        expect(e.questVerdict).toMatch(/UNWIRED/);
        expect(e.g1Note).toContain("isolated-subject-material-variants.ts:26-35");
      }
    }
  });
});

if (fs.existsSync(STORE)) {
  describe("store/skin-maps bytes", () => {
    const m = readManifest();
    for (const e of m.maps as SkinMap[]) {
      if (!e.file) continue; // blocked maps ship no bytes
      const file = e.file as string;
      it(`${file}: sha matches manifest`, () => {
        expect(shaOf(path.join(STORE, file))).toBe(e.sha256);
      });
      it(`${file}: PNG dims match manifest`, () => {
        const d = decodePngSimple(path.join(STORE, file));
        expect([d.w, d.h]).toEqual(e.size);
      });
    }
    it("normals read tangent-space (blue dominant), curvature/cavity grayscale with signal", () => {
      const mean = (px: Uint8Array, ch: number): number => {
        let s = 0;
        const n = px.length / 3;
        for (let i = ch; i < px.length; i += 3) s += px[i]!;
        return s / n;
      };
      const std = (px: Uint8Array, ch: number, mu: number): number => {
        let s = 0;
        const n = px.length / 3;
        for (let i = ch; i < px.length; i += 3) s += (px[i]! - mu) ** 2;
        return Math.sqrt(s / n);
      };
      const po = decodePngSimple(path.join(STORE, "pore-tile-normal-512.png"));
      expect(mean(po.rgb, 2)).toBeGreaterThan(200);
      for (const f of ["aisha-curvature-1024.png", "aisha-cavity-1024.png"]) {
        const d = decodePngSimple(path.join(STORE, f));
        let gray = true;
        for (let i = 0; i < d.rgb.length; i += 3) {
          if (d.rgb[i] !== d.rgb[i + 1] || d.rgb[i] !== d.rgb[i + 2]) { gray = false; break; }
        }
        expect(gray).toBe(true);
        expect(std(d.rgb, 0, mean(d.rgb, 0))).toBeGreaterThan(10);
      }
    });
    it("pore tile seam step matches interior step (tileable)", () => {
      const d = decodePngSimple(path.join(STORE, "pore-tile-normal-512.png"));
      const { w, h, rgb } = d;
      let inter = 0, ni = 0;
      for (let y = 0; y < h - 1; y += 2048) {
        for (let x = 0; x < w; x += 4) {
          for (let c = 0; c < 3; c += 1) {
            inter += Math.abs(rgb[(y * w + x) * 3 + c]! - rgb[((y + 1) * w + x) * 3 + c]!);
            ni += 1;
          }
        }
      }
      inter /= ni;
      let seam = 0, ns = 0;
      for (let x = 0; x < w; x += 4) {
        for (let c = 0; c < 3; c += 1) {
          seam += Math.abs(rgb[((h - 1) * w + x) * 3 + c]! - rgb[x * 3 + c]!);
          ns += 1;
        }
      }
      seam /= ns;
      expect(seam / inter).toBeLessThan(1.5);
    });
  });
} else {
  describe("store absent", () => {
    it("store absent: sha checks skipped", () => {
      expect(fs.existsSync(STORE)).toBe(false);
    });
  });
}
