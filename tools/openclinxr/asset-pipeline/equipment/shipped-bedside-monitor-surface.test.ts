import { execFileSync } from "node:child_process";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { type Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { describe, expect, it } from "vitest";

/**
 * bx_audit trial 2026-10-30 rendered bedside-monitor-generated.glb (sha 8ce34907, issue #253
 * TRELLIS bake) with a baked ground quad welded to its base and a screen made of dark and pale
 * texture shards. Both live in the old bake's texture atlas, so the producer fix routes the
 * monitor through the escape-hatch TRELLIS station (black-void reference) instead.
 *
 * (1) ground sheet: near-horizontal area within the bottom 2 % of height, over the XZ footprint of
 *     everything above that band. A base under a box is <= 1; a ground quad that runs past the
 *     body is > 1. Old bytes measure 1.25, new 0.83.
 * (2) screen shards: base-colour texels at the centroids of front-facing (+Z) faces in x 30-70 %,
 *     y 45-75 % of the bbox (the screen on both bakes; y 30-45 % reaches the new bake's bezel).
 *     Area fraction more than 0.2 luminance from the area-weighted median. Old 0.371, new 0.000.
 * Both clauses run on the old bytes too (git show), so each one is proven able to fail.
 */

const REPO = path.resolve(import.meta.dirname, "../../../..");
const SHIPPED = "apps/ui-xr/public/xr-assets/medical-equipment/bedside-monitor-generated.glb";
const OLD_SHA_COMMIT = "0cbf775dd";

function decodePng(buf: Uint8Array): { w: number; h: number; ch: number; px: Uint8Array } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8; let w = 0; let h = 0; let ch = 0; const idat: Uint8Array[] = [];
  while (off < buf.length) {
    const len = dv.getUint32(off); const type = String.fromCharCode(...buf.subarray(off + 4, off + 8));
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8); h = dv.getUint32(off + 12);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced PNG");
      ch = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[data[9]!]!;
    } else if (type === "IDAT") idat.push(data);
    off += 12 + len;
    if (type === "IEND") break;
  }
  const raw = inflateSync(Buffer.concat(idat)); const stride = w * ch; const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!; const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch]! : 0; const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch]! : 0;
      const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[y * stride + x] = (src[x]! + pred) & 255;
    }
  }
  return { w, h, ch, px };
}

type Tri = { p: number[][]; uv: number[][]; n: number[]; area: number };

function triangles(doc: Document): Tri[] {
  const out: Tri[] = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION")!; const uv = prim.getAttribute("TEXCOORD_0"); const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    for (let i = 0; i < n; i += 3) {
      const ids = [0, 1, 2].map((k) => (idx ? idx.getScalar(i + k) : i + k));
      const p = ids.map((j) => pos.getElement(j, [0, 0, 0]));
      const t = ids.map((j) => (uv ? uv.getElement(j, [0, 0]) : [0, 0]));
      const e1 = [0, 1, 2].map((k) => p[1]![k]! - p[0]![k]!); const e2 = [0, 1, 2].map((k) => p[2]![k]! - p[0]![k]!);
      const c = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const len = Math.hypot(...c); if (len === 0) continue;
      out.push({ p, uv: t, n: c.map((v) => v / len), area: len / 2 });
    }
  }
  return out;
}

async function measure(bytes: Uint8Array) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
  // Node transforms are identity on this asset (single root mesh); asserted so a future rig fails loudly.
  for (const node of doc.getRoot().listNodes()) {
    expect(node.getWorldMatrix().every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6)).toBe(true);
  }
  const tris = triangles(doc);
  const range = (ts: Tri[], k: number) => {
    let mn = Infinity; let mx = -Infinity;
    for (const t of ts) for (const q of t.p) { mn = Math.min(mn, q[k]!); mx = Math.max(mx, q[k]!); }
    return [mn, mx] as const;
  };
  const lo = [0, 1, 2].map((k) => range(tris, k)[0]);
  const hi = [0, 1, 2].map((k) => range(tris, k)[1]);
  const band = lo[1]! + 0.02 * (hi[1]! - lo[1]!);
  const sheet = tris.filter((t) => Math.abs(t.n[1]!) > 0.95 && t.p.every((q) => q[1]! <= band)).reduce((s, t) => s + t.area, 0);
  const above = tris.filter((t) => t.p.some((q) => q[1]! > band));
  const [x0, x1] = range(above, 0); const [z0, z1] = range(above, 2);
  const footprint = (x1 - x0) * (z1 - z0);

  const tex = doc.getRoot().listMaterials()[0]!.getBaseColorTexture()!;
  const img = decodePng(tex.getImage()!);
  const cx = (k: number, f: number) => lo[k]! + f * (hi[k]! - lo[k]!);
  const samples: { lum: number; area: number }[] = [];
  for (const t of tris) {
    const c = [0, 1, 2].map((k) => (t.p[0]![k]! + t.p[1]![k]! + t.p[2]![k]!) / 3);
    if (t.n[2]! < 0.8 || c[2]! < cx(2, 0.5) || c[0]! < cx(0, 0.3) || c[0]! > cx(0, 0.7) || c[1]! < cx(1, 0.45) || c[1]! > cx(1, 0.75)) continue;
    const u = (t.uv[0]![0]! + t.uv[1]![0]! + t.uv[2]![0]!) / 3; const v = (t.uv[0]![1]! + t.uv[1]![1]! + t.uv[2]![1]!) / 3;
    const x = Math.min(img.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.w)));
    const y = Math.min(img.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.h)));
    const o = (y * img.w + x) * img.ch;
    const lum = img.ch >= 3 ? (0.2126 * img.px[o]! + 0.7152 * img.px[o + 1]! + 0.0722 * img.px[o + 2]!) / 255 : img.px[o]! / 255;
    samples.push({ lum, area: t.area });
  }
  // Area-weighted median, then the area fraction of texels more than 0.2 luminance away from it:
  // a uniform screen of any brightness is ~0, dark glass broken by pale shards is not.
  samples.sort((a, b) => a.lum - b.lum);
  const screenArea = samples.reduce((s, x) => s + x.area, 0);
  let acc = 0; let median = 0;
  for (const x of samples) { acc += x.area; if (acc >= screenArea / 2) { median = x.lum; break; } }
  const offArea = samples.filter((x) => Math.abs(x.lum - median) > 0.2).reduce((s, x) => s + x.area, 0);
  return { groundSheetRatio: sheet / footprint, screenArea, screenMedianLum: median, screenShardFraction: offArea / screenArea };
}

const MAX_GROUND_SHEET_RATIO = 1.0;
const MAX_SCREEN_SHARD_FRACTION = 0.05;

describe("shipped bedside monitor has no ground quad and no screen shards (bx_audit 2026-10-30)", () => {
  it("the shipped GLB passes both clauses", async () => {
    const { readFileSync } = await import("node:fs");
    const m = await measure(readFileSync(path.join(REPO, SHIPPED)));
    expect(m.screenArea, "no front-facing screen faces found").toBeGreaterThan(0);
    expect(m.groundSheetRatio, `ground sheet ${m.groundSheetRatio.toFixed(2)} x footprint`).toBeLessThanOrEqual(MAX_GROUND_SHEET_RATIO);
    expect(m.screenShardFraction, `screen shard fraction ${m.screenShardFraction.toFixed(3)}`).toBeLessThanOrEqual(MAX_SCREEN_SHARD_FRACTION);
  }, 120_000);

  it("both clauses fail on the pre-fix bytes (counterweight: the measure can see the defect)", async () => {
    // CI checks out with fetch-depth 0, so the pre-fix commit is reachable.
    const old = execFileSync("git", ["show", `${OLD_SHA_COMMIT}:${SHIPPED}`], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
    const m = await measure(old);
    expect(m.groundSheetRatio).toBeGreaterThan(MAX_GROUND_SHEET_RATIO);
    expect(m.screenShardFraction).toBeGreaterThan(MAX_SCREEN_SHARD_FRACTION);
  }, 120_000);
});
