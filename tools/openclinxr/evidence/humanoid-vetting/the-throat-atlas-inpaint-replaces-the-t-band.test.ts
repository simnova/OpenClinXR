import { execFileSync } from "node:child_process";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Throat-atlas inpaint (class-C collar T fix, no Blender, no materializer edit).
 *
 * Record: tools/openclinxr/evidence/humanoid-vetting/mpfb-nurse-sternal-t-classify.json
 * (class C: throat skin tris render atlas texels a half-step off neighboring
 * skin; T median ~[174,160,145] vs adjacent ~[165,152,137]; straight T edges
 * follow the throat UV-island boundary u=[0.157,0.604] v=[0.412,0.468]).
 *
 * The helper (tools/openclinxr/evidence/blender/inpaint_skin_atlas_throat.py)
 * replaces island texels with the outside-ring skin median. This contract builds
 * a tiny PNG fixture with a T-shaped band in the measured UV bbox, runs the
 * helper, and asserts the band moved to the neighbor median while the
 * right-side face island stayed byte-stable.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const HELPER = join(REPO_ROOT, "tools/openclinxr/evidence/blender/inpaint_skin_atlas_throat.py");

const W = 64;
const H = 64;
const NEIGHBOR: [number, number, number] = [165, 152, 137];
const T_BAND: [number, number, number] = [174, 160, 145];
const FACE: [number, number, number] = [200, 100, 50];

/** Pixel rect for a UV bbox under the helper's OpenGL convention (row 0 = top). */
function uvRect(u0: number, v0: number, u1: number, v1: number): [number, number, number, number] {
  const c0 = Math.max(0, Math.min(W - 1, Math.floor(u0 * W)));
  const c1 = Math.max(0, Math.min(W - 1, Math.ceil(u1 * W) - 1));
  const rTop = Math.max(0, Math.min(H - 1, Math.floor((1 - v1) * H)));
  const rBot = Math.max(0, Math.min(H - 1, Math.ceil((1 - v0) * H) - 1));
  return [c0, rTop, c1, rBot];
}

function pngChunk(type: string, body: Uint8Array): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(body)])) >>> 0, 0);
  return Buffer.concat([header, Buffer.from(body), crc]);
}

function encodeRgb(px: Uint8Array): Buffer {
  const stride = W * 3;
  const scan = Buffer.alloc((stride + 1) * H);
  for (let y = 0; y < H; y += 1) {
    scan[y * (stride + 1)] = 0;
    Buffer.from(px.subarray(y * stride, (y + 1) * stride)).copy(scan, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(scan)), pngChunk("IEND", new Uint8Array(0))]);
}

function decodeRgb(bytes: Uint8Array): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0;
  let h = 0;
  const idat: Uint8Array[] = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
    } else if (type === "IDAT") idat.push(bytes.subarray(off + 8, off + 8 + len));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (w !== W || h !== H) throw new Error(`fixture size ${w}x${h}, want ${W}x${H}`);
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  const stride = W * 3;
  const px = new Uint8Array(W * H * 3);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < H; y += 1) {
    const filter = raw[p++]!;
    for (let x = 0; x < stride; x += 1) {
      const rb = raw[p + x]!;
      const a = x >= 3 ? cur[x - 3]! : 0;
      const b = prev[x]!;
      const c = x >= 3 ? prev[x - 3]! : 0;
      let v: number;
      if (filter === 0) v = rb;
      else if (filter === 1) v = rb + a;
      else if (filter === 2) v = rb + b;
      else if (filter === 3) v = rb + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    p += stride;
    px.set(cur, y * stride);
    prev.set(cur);
  }
  return px;
}

function medianOf(px: Uint8Array, rect: [number, number, number, number]): [number, number, number] {
  const [c0, rTop, c1, rBot] = rect;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = rTop; y <= rBot; y += 1) {
    for (let x = c0; x <= c1; x += 1) {
      const i = (y * W + x) * 3;
      rs.push(px[i]!);
      gs.push(px[i + 1]!);
      bs.push(px[i + 2]!);
    }
  }
  const med = (a: number[]): number => a.sort((p, q) => p - q)[Math.floor(a.length / 2)]!;
  return [med(rs), med(gs), med(bs)];
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** First candidate that can `import PIL, numpy` wins. */
function pickPython(): string {
  const cands = [process.env["OPENCLINXR_PYTHON"], "/usr/local/bin/python3", "python3"].filter(Boolean) as string[];
  for (const c of cands) {
    try {
      execFileSync(c, ["-c", "import PIL, numpy"], { stdio: "ignore" });
      return c;
    } catch {
      /* try next */
    }
  }
  throw new Error("no python with PIL+numpy (tried OPENCLINXR_PYTHON, /usr/local/bin/python3, python3)");
}

describe("the throat-atlas inpaint replaces the T band", () => {
  it("throat-island-inpaint", () => {
    const island = uvRect(0.157, 0.412, 0.604, 0.468);
    const face = uvRect(0.65, 0.0, 1.0, 1.0);
    const [c0, rTop, c1, rBot] = island;
    expect(c1, "island has width").toBeGreaterThan(c0 + 4);
    expect(rBot, "island has height").toBeGreaterThan(rTop + 1);

    // Fixture: neighbor skin everywhere; T band (top bar + center stem) in the
    // measured UV bbox; distinct face block on the right.
    const px = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i += 1) {
      px[i * 3] = NEIGHBOR[0];
      px[i * 3 + 1] = NEIGHBOR[1];
      px[i * 3 + 2] = NEIGHBOR[2];
    }
    const paint = (x: number, y: number, c: [number, number, number]): void => {
      const i = (y * W + x) * 3;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    };
    for (let x = c0; x <= c1; x += 1) {
      paint(x, rTop, T_BAND);
      paint(x, rTop + 1, T_BAND);
    }
    const stem = Math.floor((c0 + c1) / 2);
    for (let y = rTop; y <= rBot; y += 1) {
      paint(stem, y, T_BAND);
      paint(stem + 1, y, T_BAND);
    }
    const [fc0, frTop, fc1, frBot] = face;
    for (let y = frTop; y <= frBot; y += 1) {
      for (let x = fc0; x <= fc1; x += 1) paint(x, y, FACE);
    }

    const dir = mkdtempSync(join(tmpdir(), "throat-inpaint-"));
    const input = join(dir, "atlas.png");
    const output = join(dir, "atlas-inpainted.png");
    writeFileSync(input, encodeRgb(px));

    const before = medianOf(px, island);
    expect(dist(before, T_BAND) < dist(before, NEIGHBOR), "fixture band reads as T, not neighbor").toBe(true);

    const python = pickPython();
    const out = execFileSync(
      python,
      [HELPER, input, "--out", output, "--uv-bbox", "0.157,0.412,0.604,0.468"],
      { encoding: "utf8" },
    );
    const census = JSON.parse(out) as {
      texelsChanged: number;
      medianBefore: [number, number, number];
      medianAfter: [number, number, number];
      neighborMedian: [number, number, number];
    };
    expect(census.texelsChanged, "census changed texels").toBeGreaterThan(0);
    expect(census.neighborMedian, "census neighbor median is skin").toEqual([165, 152, 137]);

    const afterPx = decodeRgb(new Uint8Array(readFileSync(output)));
    const after = medianOf(afterPx, island);
    expect(dist(after, NEIGHBOR), "T band moved to the neighbor median").toBeLessThan(dist(before, NEIGHBOR));
    expect(dist(after, NEIGHBOR), "island median equals neighbor skin").toBeLessThanOrEqual(2);

    const faceBefore = medianOf(px, face);
    const faceAfter = medianOf(afterPx, face);
    expect(faceAfter, "face island rectangle unchanged").toEqual(faceBefore);
    expect(faceAfter, "face island keeps its own color").toEqual([200, 100, 50]);

    // Byte-stability: every texel of the face rectangle is untouched.
    const [bx0, byTop, bx1, byBot] = face;
    let faceBytesChanged = 0;
    for (let y = byTop; y <= byBot; y += 1) {
      for (let x = bx0; x <= bx1; x += 1) {
        const i = (y * W + x) * 3;
        if (afterPx[i] !== px[i] || afterPx[i + 1] !== px[i + 1] || afterPx[i + 2] !== px[i + 2]) {
          faceBytesChanged += 1;
        }
      }
    }
    expect(faceBytesChanged, "face island texels changed (must be byte-stable)").toBe(0);
  }, 120_000);

  /**
   * FOLLOW-ON (subdiv2 atlas, 2026-09-18): the UV numbers in the header above
   * document the classify record of the OLD shipped GLB (a 459x59 px black
   * strip on the new atlas -- the wrong target). The real collar T sits at
   * u=[0.3428,0.4385] v=[0.8027,0.8672]; the helper default is now
   * (0.33,0.79,0.46,0.88).
   *
   * FOLLOW-ON 2: the real T is an INTERIOR BLACK HOLE (unbaked void) inside
   * the torso skin island, not a darker-skin rectangle. This case models that
   * polarity: a black T void fully surrounded by skin inside the default
   * bbox, with black atlas gutter around the island. Runs the helper with NO
   * --uv-bbox and asserts the hole fills to neighbor skin while the gutter
   * and the face block stay byte-stable.
   */
  it("throat-inpaint-default-bbox-hole-fill", () => {
    const island = uvRect(0.33, 0.79, 0.46, 0.88);
    const face = uvRect(0.65, 0.0, 1.0, 1.0);
    const [c0, rTop, c1, rBot] = island;
    expect(c1, "default island has width").toBeGreaterThan(c0 + 2);
    expect(rBot, "default island has height").toBeGreaterThan(rTop + 2);
    const SKIN: [number, number, number] = [188, 142, 121];
    const HOLE: [number, number, number] = [0, 0, 0];

    // Fixture: black background; skin island = bbox + 8px margin; BLACK T
    // hole (top bar + center stem, fully surrounded by skin) inside the
    // default bbox; face block on right.
    const px = new Uint8Array(W * H * 3); // all black
    const paint = (x: number, y: number, c: [number, number, number]): void => {
      const i = (y * W + x) * 3;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    };
    const m = 8;
    const ic0 = Math.max(0, c0 - m);
    const ic1 = Math.min(W - 1, c1 + m);
    const irTop = Math.max(0, rTop - m);
    const irBot = Math.min(H - 1, rBot + m);
    for (let y = irTop; y <= irBot; y += 1) {
      for (let x = ic0; x <= ic1; x += 1) paint(x, y, SKIN);
    }
    for (let x = c0; x <= c1; x += 1) {
      paint(x, rTop, HOLE);
      paint(x, rTop + 1, HOLE);
    }
    const stem = Math.floor((c0 + c1) / 2);
    for (let y = rTop; y <= rBot; y += 1) {
      paint(stem, y, HOLE);
      paint(stem + 1, y, HOLE);
    }
    const [fc0, frTop, fc1, frBot] = face;
    for (let y = frTop; y <= frBot; y += 1) {
      for (let x = fc0; x <= fc1; x += 1) paint(x, y, FACE);
    }

    const dir = mkdtempSync(join(tmpdir(), "throat-inpaint-v2-"));
    const input = join(dir, "atlas.png");
    const output = join(dir, "atlas-inpainted.png");
    writeFileSync(input, encodeRgb(px));

    const python = pickPython();
    const out = execFileSync(python, [HELPER, input, "--out", output], { encoding: "utf8" });
    const census = JSON.parse(out) as {
      texelsChanged: number;
      medianBefore: [number, number, number];
      medianAfter: [number, number, number];
      neighborMedian: [number, number, number];
      bboxHoleTexels: number;
      bboxBlackKept: number;
    };
    expect(census.texelsChanged, "census changed texels").toBeGreaterThan(0);
    expect(census.bboxHoleTexels, "census filled hole texels").toBeGreaterThan(0);
    expect(census.neighborMedian, "census neighbor median is skin, not black").toEqual([188, 142, 121]);

    const afterPx = decodeRgb(new Uint8Array(readFileSync(output)));
    const after = medianOf(afterPx, island);
    expect(dist(after, SKIN), "hole T filled to neighbor skin").toBeLessThanOrEqual(2);

    // No black texels remain inside the bbox rect (hole filled, skin kept).
    let blackLeft = 0;
    for (let y = rTop; y <= rBot; y += 1) {
      for (let x = c0; x <= c1; x += 1) {
        const i = (y * W + x) * 3;
        if (Math.max(afterPx[i]!, afterPx[i + 1]!, afterPx[i + 2]!) < 16) blackLeft += 1;
      }
    }
    expect(blackLeft, "black texels left inside bbox (hole must be filled)").toBe(0);

    // Black background byte-stable: every texel outside the island rect and
    // the face rect is unchanged.
    const inFace = (x: number, y: number): boolean => x >= fc0 && x <= fc1 && y >= frTop && y <= frBot;
    let bgChanged = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const inIsland = x >= c0 && x <= c1 && y >= rTop && y <= rBot;
        if (inIsland || inFace(x, y)) continue;
        const i = (y * W + x) * 3;
        if (afterPx[i] !== px[i] || afterPx[i + 1] !== px[i + 1] || afterPx[i + 2] !== px[i + 2]) {
          bgChanged += 1;
        }
      }
    }
    expect(bgChanged, "black background texels changed (must stay black)").toBe(0);

    const faceBefore = medianOf(px, face);
    const faceAfter = medianOf(afterPx, face);
    expect(faceAfter, "face island rectangle unchanged").toEqual(faceBefore);
  }, 120_000);

  it("throat-inpaint-skips-uniform-skin-bbox", () => {
    const island = uvRect(0.33, 0.79, 0.46, 0.88);
    const face = uvRect(0.65, 0.0, 1.0, 1.0);
    const [c0, rTop, c1, rBot] = island;
    const SKIN: [number, number, number] = [188, 144, 123];

    // Fixture: black gutter; skin island (bbox + 8px margin) uniform at the
    // ring color; face block on the right. No holes, no T band.
    const px = new Uint8Array(W * H * 3); // all black
    const paint = (x: number, y: number, c: [number, number, number]): void => {
      const i = (y * W + x) * 3;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    };
    const m = 8;
    for (let y = Math.max(0, rTop - m); y <= Math.min(H - 1, rBot + m); y += 1) {
      for (let x = Math.max(0, c0 - m); x <= Math.min(W - 1, c1 + m); x += 1) paint(x, y, SKIN);
    }
    const [fc0, frTop, fc1, frBot] = face;
    for (let y = frTop; y <= frBot; y += 1) {
      for (let x = fc0; x <= fc1; x += 1) paint(x, y, FACE);
    }

    const dir = mkdtempSync(join(tmpdir(), "throat-inpaint-skip-"));
    const input = join(dir, "atlas.png");
    const output = join(dir, "atlas-inpainted.png");
    const inputBytes = encodeRgb(px);
    writeFileSync(input, inputBytes);

    const python = pickPython();
    const out = execFileSync(python, [HELPER, input, "--out", output], { encoding: "utf8" });
    const census = JSON.parse(out) as { texelsChanged: number; bboxHoleTexels: number };
    expect(census.bboxHoleTexels, "no holes in uniform skin").toBe(0);
    expect(census.texelsChanged, "uniform chest not flattened").toBe(0);
    expect(Buffer.from(readFileSync(output)).equals(Buffer.from(inputBytes)), "PNG byte-identical").toBe(true);
  }, 120_000);
});
