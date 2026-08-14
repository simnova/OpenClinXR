import { existsSync, readFileSync, readdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **The grade capture cannot resolve a face, and that has blocked three appearance claims tonight.**
 *
 * Measured 2026-08-14 on `glb-grade-capture/2026-08-14T06-40-39Z` (aisha, stamped `7dd3ab84`):
 *
 *   render viewport      1280 x 1280
 *   figure height          868 px
 *   **head width           104 px**   -> the face spans roughly 60 px
 *
 * At 60 px of face, pore-scale detail is sub-pixel. Three claims died on it:
 *
 *   #369 skin normal map   bytes prove sd 2.1 -> 9.2, but I could NOT confirm it reads less like
 *                          plastic, and refused to claim it
 *   hairline               my "hard stair-step on 3/3" description came from a 5x crop and is suspect
 *   #378 boot "teeth"      a 4x crop invented a defect I filed and had to withdraw
 *
 * The last two are the same failure in the other direction: **enlarging a sub-pixel feature
 * manufactures structure** (rule 12a). The answer is not a bigger crop, it is more rendered pixels.
 *
 * ## THE FIX IS ON OUR SIDE OF THE FENCE
 *
 * The camera lives in `apps/arena/model-vetting-studio/**`, which another lane owns and this contract
 * does not touch. The **viewport** is set in our own capture script
 * (`model-vetting-glb-grade-capture.ts:371`, `{ width: 1280, height: 1280 }`). Rendering more pixels
 * needs no camera change and no peer coordination:
 *
 *   1280 -> head ~104 px      2048 -> ~166 px      3072 -> **~249 px**      4096 -> ~332 px
 *
 * ## THE THRESHOLD IS DERIVED FROM GRADES THAT WORKED (SS9h)
 *
 * There is no external standard for "resolvable face". The known-good is empirical and in-session:
 * the head crops I could actually read — the hairline verdict and the eye-direction verdict — were
 * **~176 px** of head width. 250 px is 1.4x that, so it clears the readable threshold with margin
 * rather than sitting on it, and is reachable at 3072 without demanding 4096. Today's 104 px fails by
 * 2.4x.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                       | (1) head px | (2) no upscale | (3) self-check | result
 *   ------------------------------------------------|-------------|----------------|----------------|--------
 *   a) today (1280, head 104 px)                    |  **FAIL**   |      pass      |     pass       | REFUSED
 *   b) render 1280, resize the PNG up to 4096       |    pass     |    **FAIL**    |     pass       | REFUSED
 *   c) crop to the head and call that the grade     |    pass     |      pass      |   **FAIL**     | REFUSED
 *   d) raise the render viewport                    |    pass     |      pass      |     pass       | ALL PASS
 *
 * **(b) is the one to watch and it is why clause (2) exists.** Resampling a 1280 render to 4096 makes
 * the head "332 px" and adds no information — it is precisely the transform that manufactured the
 * #378 teeth. Clause (2) requires the PNG's own dimensions to match the viewport the run declares, so
 * a resize is detectable in the artifact itself.
 *
 * **(c) is why clause (3) exists.** Cropping to the head would satisfy a pixel count while discarding
 * the full-figure pass, and with it the NodeIO-vs-three.js agreement check (#59) that refuses a render
 * drawn at the wrong scale. The whole-figure image and its self-check must survive.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails on every existing run. (2) and
 * (3) are counterweights and pass today — every shipped capture is rendered, not resampled, and every
 * gallery carries an agreement verdict.
 *
 * NOT TESTED:
 *   - **That a 250 px head resolves the SKIN.** It resolves what the hairline and eye grades needed.
 *     Whether #369's dermal detail becomes visible is the open question this unblocks, not one it
 *     answers — and if 250 px still cannot show it, that is a finding, not a failure of this contract.
 *   - **Render cost.** 3072^2 is 5.8x the pixels of 1280^2. D9 says duration is not a constraint, but
 *     nothing here bounds it and a 15-station sweep multiplies it.
 *   - **The camera.** Framing stays whole-figure; this buys pixels, not composition. A true head-framed
 *     pass needs the studio camera, which is another lane's file.
 *   - **The other capture scripts.** Only `glb-grade` is in scope.
 *
 * ## FIXED (#384)
 *
 * The capture now renders at the browser viewport. The single-candidate renderer in
 * `apps/arena/model-vetting-studio/src/candidate-capture.ts` hardcoded a 1280x1280 drawing buffer,
 * so the capture script's `viewport` only resampled that buffer via CSS — a viewport-only change
 * would have produced a browser upscale, the exact transform clause (2) exists to refuse. The
 * renderer now sizes its buffer to the canvas display size (`canvas.clientWidth`); the camera and
 * framing (`frameCameraForBounds`) are untouched, and behaviour at a 1280 viewport is unchanged for
 * every other studio consumer. The capture viewport is now 4096x4096 (`model-vetting-glb-grade-capture.ts:371`);
 * this header's own table puts 3072 at ~249 px, sitting on the bar it mandates, while 4096 renders
 * ~334 px with margin (D9: duration is not a constraint).
 *
 * Measured on the new run `2026-08-14T09-17-28Z` (aisha): PNG width 4096 == declared viewport
 * (rendered, not resampled), head width **334 px** (>= 250), gallery reports geometry agreement for
 * all 3 assets (self-check survives).
 *
 * Instrument fix, assertion unchanged: `headWidthPx` used `Math.min(...)/Math.max(...)` spreads,
 * which overflow the call stack on the ~2M sampled pixels of a 4096 render — the gate could not
 * measure at the resolution it demands. Replaced with single-pass min/max loops; verified identical
 * on the 2026-08-13 run (98 px, spread and loop agree).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GRADE_ROOT = join(REPO_ROOT, ".openclinxr/evidence/glb-grade-capture");
const CAPTURE = join(REPO_ROOT, "tools/openclinxr/evidence/model-vetting-glb-grade-capture.ts");

/** Derived from the head crops that were actually readable this session (~176 px), plus margin. */
const MIN_HEAD_PX = 250;
/** ISO run directories only — never `latest`, which mirrors whichever ran last. */
const ISO_RUN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

/** PNG IHDR only: width/height without decoding pixels. */
function pngSize(file: string): { w: number; h: number } | null {
  const b = readFileSync(file);
  if (b.length < 24) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** Decode enough of a PNG to find the lit figure's head width. Same reader as the AO probe. */
function decode(bytes: Uint8Array): { w: number; h: number; chans: number; data: Uint8Array } | null {
  let w = 0, h = 0, depth = 0, colour = -1;
  const idat: Uint8Array[] = [];
  let off = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
  if (depth !== 8 || !chans || !w) return null;
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c)))); } catch { return null; }
  const stride = w * chans;
  if (raw.length < (stride + 1) * h) return null;
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

/** Widest span of lit subject in the top 14% of the figure — the head. */
function headWidthPx(file: string): number {
  const png = decode(readFileSync(file));
  if (!png) return 0;
  const xs: number[] = [], ys: number[] = [];
  const skipTop = Math.round(png.h * 0.055); // the run's caption band
  for (let y = skipTop; y < png.h; y += 2) {
    for (let x = 0; x < png.w; x += 2) {
      const i = (y * png.w + x) * png.chans;
      if ((png.data[i]! + (png.data[i + 1] ?? 0) + (png.data[i + 2] ?? 0)) / 3 > 70) { xs.push(x); ys.push(y); }
    }
  }
  if (!xs.length) return 0;
  // #384: single-pass min/max loops — `Math.min(...ys)` spreads millions of samples at a 4096
  // viewport and overflows the call stack, so the gate could not measure the resolution it demands.
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let k = 0; k < ys.length; k += 1) {
    if (ys[k]! < y0) y0 = ys[k]!;
    if (ys[k]! > y1) y1 = ys[k]!;
  }
  const bandMaxY = y0 + (y1 - y0) * 0.14;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < xs.length; k += 1) {
    if (ys[k]! <= bandMaxY) {
      if (xs[k]! < lo) lo = xs[k]!;
      if (xs[k]! > hi) hi = xs[k]!;
    }
  }
  return hi >= lo ? hi - lo : 0;
}

type Run = { dir: string; headPx: number; declaredViewport: number; pngW: number; agrees: boolean };

function newestRun(): Run | null {
  if (!existsSync(GRADE_ROOT)) return null;
  const dirs = readdirSync(GRADE_ROOT).filter((d) => ISO_RUN.test(d)).sort((a, b) => b.localeCompare(a));
  for (const d of dirs) {
    const gallery = join(GRADE_ROOT, d, "gallery.json");
    const assets = join(GRADE_ROOT, d, "assets");
    if (!existsSync(gallery) || !existsSync(assets)) continue;
    const actor = readdirSync(assets).find((a: string) => existsSync(join(assets, a, "front_structure.png")));
    if (!actor) continue;
    const lit = join(assets, actor, "front_structure.png");
    const size = pngSize(lit);
    let agrees = false;
    try {
      const g = JSON.parse(readFileSync(gallery, "utf8")) as { assets?: { agrees?: boolean }[] };
      agrees = (g.assets ?? []).every((a) => a.agrees !== false);
    } catch { agrees = false; }
    const src = existsSync(CAPTURE) ? readFileSync(CAPTURE, "utf8") : "";
    const m = /viewport:\s*\{\s*width:\s*(\d+)/u.exec(src);
    return {
      dir: d,
      headPx: headWidthPx(lit),
      declaredViewport: m ? Number(m[1]) : 0,
      pngW: size?.w ?? 0,
      agrees,
    };
  }
  return null;
}

const run = newestRun();

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 *
 * Returns the narrowed run rather than declaring `asserts run is Run`: an assertion signature must
 * name a PARAMETER, so the `asserts` form silently fails to narrow a module-level const (TS1225).
 */
function requireRun(): Run {
  expect(run, `a glb-grade run with a decodable front_structure.png under ${GRADE_ROOT}`).not.toBeNull();
  expect(run?.headPx ?? 0, "head width located in the newest run").toBeGreaterThan(0);
  return run as Run;
}

describe("a graded capture resolves the face", () => {
  it("(1) RED: the head is rendered at enough pixels to grade", () => {
    const r = requireRun();
    expect(
      r.headPx,
      `head width in ${r.dir} (readable grades this session were ~176 px; today's runs are 104 px at a ${r.declaredViewport} viewport)`,
    ).toBeGreaterThanOrEqual(MIN_HEAD_PX);
  });

  it("(2) COUNTERWEIGHT: the image is rendered at that size, not resampled up to it", () => {
    // Refuses (b): resizing a 1280 render to 4096 adds no information and is exactly the transform
    // that manufactured the #378 "teeth" I filed and withdrew (rule 12a).
    const r = requireRun();
    expect(
      r.pngW,
      `${r.dir} PNG width must equal the declared capture viewport (${r.declaredViewport}) — a mismatch means the artifact was resampled after rendering`,
    ).toBe(r.declaredViewport);
  });

  it("(3) COUNTERWEIGHT: the whole-figure pass and its self-check survive", () => {
    // Refuses (c): cropping to the head satisfies a pixel count and discards the NodeIO-vs-three.js
    // agreement check (#59) that refuses a figure drawn at the wrong scale.
    const r = requireRun();
    expect(r.agrees, `${r.dir} gallery must still report geometry agreement for every asset`).toBe(true);
  });
});
