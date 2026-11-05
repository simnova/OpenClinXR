import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO, type Primitive } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { decodePng } from "../../../../../tools/openclinxr/evidence/decode-png.js";

const ROOT = repoRoot();
const CURRENT_GLB = process.env["OPENCLINXR_PARTNER_GLB"]
  ?? join(ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb");
// r3 = the landed st-vitdark r5 slice commit (r3 remap bytes, sha 85d98d37). The pre-rebase
// local sha 859944f4c never reached origin, so a clone cannot `git show` it.
const R3_REVISION = "97d331a4d";
// The rejected r8 shape was an atlas-wide luminance gain. It is rebuilt in-test from r3 so no
// gitignored evidence file is read (the r8 GLB lived only in the st-vitdark E dir).
const GLOBAL_GAIN = 0.97;
const R3_PATH = "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb";
const DARK_TEXEL_FRACTION = 0.35;
const KNEE_START = 0.5949254260464409;
const MAX_CHANGED_FRACTION = 0.001;
const MEDIAN_RATIO_TOLERANCE = 0.001;
const MIN_SKIN_TEXELS = 100_000;

function pointInTri(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Rasterize the shipped skin primitive so black/near-black texels cannot escape coverage. */
function coverageMask(prim: Primitive, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  const uv = prim.getAttribute("TEXCOORD_0")?.getArray();
  if (!uv) return mask;
  const idx = prim.getIndices()?.getArray();
  const triCount = idx ? idx.length / 3 : uv.length / 6;
  for (let t = 0; t < triCount; t += 1) {
    const a = idx ? idx[t * 3]! : t * 3;
    const b = idx ? idx[t * 3 + 1]! : t * 3 + 1;
    const c = idx ? idx[t * 3 + 2]! : t * 3 + 2;
    const ax = uv[a * 2]!;
    const ay = uv[a * 2 + 1]!;
    const bx = uv[b * 2]!;
    const by = uv[b * 2 + 1]!;
    const cx = uv[c * 2]!;
    const cy = uv[c * 2 + 1]!;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx) * w));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx) * w));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy) * h));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy) * h));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (pointInTri(
          (x + 0.5) / w, (y + 0.5) / h,
          ax, ay, bx, by, cx, cy,
        )) mask[y * w + x] = 1;
      }
    }
  }
  return mask;
}

type Atlas = {
  width: number;
  height: number;
  mask: Uint8Array;
  red: Uint8Array;
  green: Uint8Array;
  blue: Uint8Array;
  luminance: Float32Array;
  median: number;
  ratios: Float64Array;
  covered: number;
  dark: number;
};

async function measure(raw: Uint8Array): Promise<Atlas> {
  const doc = await new NodeIO().readBinary(raw);
  let image: Uint8Array | null = null;
  let prim: Primitive | null = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const candidate of mesh.listPrimitives()) {
      const material = candidate.getMaterial();
      const name = material?.getName() ?? "";
      if (!/skin|body|human/i.test(name) || /iris|eye|cornea|sclera|scalp|hair/i.test(name)) continue;
      const candidateImage = material?.getBaseColorTexture()?.getImage();
      if (candidateImage && (!image || candidateImage.byteLength > image.byteLength)) {
        image = candidateImage;
        prim = candidate;
      }
    }
  }
  if (!image || !prim) throw new Error("partner skin atlas/primitive missing");
  const decoded = decodePng(image);
  if (!decoded) throw new Error("partner skin atlas is not a decodable PNG");
  const mask = coverageMask(prim, decoded.w, decoded.h);
  const values: number[] = [];
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) values.push(decoded.lum[i]!);
  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)]!;
  const ratios = new Float64Array(mask.length);
  let dark = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    ratios[i] = decoded.lum[i]! / median;
    if (ratios[i]! < DARK_TEXEL_FRACTION) dark += 1;
  }
  return {
    width: decoded.w,
    height: decoded.h,
    mask,
    red: decoded.r,
    green: decoded.g,
    blue: decoded.b,
    luminance: decoded.lum,
    median,
    ratios,
    covered: values.length,
    dark,
  };
}

type Clauses = {
  floor: { pass: boolean; dark: number };
  identity: {
    pass: boolean;
    changed: number;
    changedFraction: number;
    identityChanged: number;
  };
  counterweight: { pass: boolean; darker: number; medianRatio: number };
};

function clauses(atlas: Atlas, r3: Atlas): Clauses {
  expect(atlas.width).toBe(r3.width);
  expect(atlas.height).toBe(r3.height);
  let changed = 0;
  let identityChanged = 0;
  let darker = 0;
  for (let i = 0; i < r3.mask.length; i += 1) {
    if (!r3.mask[i]) continue;
    if (atlas.luminance[i]! < r3.luminance[i]!) darker += 1;
    const differs = (
      atlas.red[i] !== r3.red[i]
      || atlas.green[i] !== r3.green[i]
      || atlas.blue[i] !== r3.blue[i]
    );
    if (differs) changed += 1;
    if (r3.ratios[i]! >= KNEE_START && differs) identityChanged += 1;
  }
  const changedFraction = changed / r3.covered;
  const medianRatio = atlas.median / r3.median;
  return {
    floor: { pass: atlas.dark === 0, dark: atlas.dark },
    identity: {
      pass: identityChanged === 0 && changedFraction <= MAX_CHANGED_FRACTION,
      changed,
      changedFraction,
      identityChanged,
    },
    counterweight: {
      pass: darker === 0 && Math.abs(medianRatio - 1) <= MEDIAN_RATIO_TOLERANCE,
      darker,
      medianRatio,
    },
  };
}

/** Every covered texel scaled by one gain: the atlas-wide shape the r8 round shipped. */
function globalGain(atlas: Atlas, gain: number): Atlas {
  const scale = (v: Uint8Array) => v.map((c) => Math.min(255, Math.round(c * gain)));
  const luminance = atlas.luminance.map((l) => l * gain);
  return { ...atlas, red: scale(atlas.red), green: scale(atlas.green), blue: scale(atlas.blue), luminance, median: atlas.median * gain };
}

const fixtures = await (async () => {
  const raw = {
    current: readFileSync(CURRENT_GLB),
    r3: execFileSync("git", ["show", `${R3_REVISION}:${R3_PATH}`], {
      cwd: ROOT,
      maxBuffer: 20 * 1024 * 1024,
    }),
  };
  const measured = {
    current: await measure(raw.current),
    r3: await measure(raw.r3),
  };
  const r8 = globalGain(measured.r3, GLOBAL_GAIN);
  const results = {
    current: clauses(measured.current, measured.r3),
    r3: clauses(measured.r3, measured.r3),
    r8: clauses(r8, measured.r3),
  };
  for (const name of ["current", "r3", "r8"] as const) {
    process.stdout.write(`st-vitdark r9 clauses ${name}: ${JSON.stringify(results[name])}\n`);
  }
  return { measured, results };
})();

describe("the deep partner atlas changes only below the light-bake soft-knee start", () => {
  it("(a) clears TEST_A's 0.35x floor while the known-good r3 atlas retains 88 defects", () => {
    expect(fixtures.measured.current.covered).toBeGreaterThanOrEqual(MIN_SKIN_TEXELS);
    expect(fixtures.results.r3.floor.dark).toBe(88);
    expect(fixtures.results.r3.floor.pass).toBe(false);
    expect(fixtures.results.current.floor.pass).toBe(true);
  });

  it("(b) is byte-identical to r3 at and above k_start while an atlas-wide gain is not", () => {
    expect(fixtures.results.r8.identity.pass).toBe(false);
    expect(fixtures.results.current.identity.identityChanged).toBe(0);
    expect(fixtures.results.current.identity.changedFraction).toBeLessThanOrEqual(
      MAX_CHANGED_FRACTION,
    );
    expect(fixtures.results.current.identity.pass).toBe(true);
  });

  it("(c) never darkens r3 and keeps the atlas median within 0.1%", () => {
    expect(fixtures.results.current.counterweight.darker).toBe(0);
    expect(fixtures.results.current.counterweight.medianRatio).toBeGreaterThanOrEqual(
      1 - MEDIAN_RATIO_TOLERANCE,
    );
    expect(fixtures.results.current.counterweight.medianRatio).toBeLessThanOrEqual(
      1 + MEDIAN_RATIO_TOLERANCE,
    );
    expect(fixtures.results.current.counterweight.pass).toBe(true);
  });
});
