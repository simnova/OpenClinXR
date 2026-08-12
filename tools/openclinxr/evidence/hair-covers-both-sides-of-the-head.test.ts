import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Every MPFB actor has substantially more hair on the LEFT of its scalp than the RIGHT.
 *
 * MEASURED 2026-08-12 on the shipped GLBs. Scalp-dome vertices (skin verts above 0.94 H) split by
 * the sign of X, each sampled from that actor's OWN baked skin texture at its own UV:
 *
 *   actor            LEFT n / %hair-dark    RIGHT n / %hair-dark    asymmetry
 *   ---------------- ---------------------- ----------------------- ---------
 *   aisha            140 / 82.1%            140 / 46.4%             35.7 pts
 *   nurse_kevin      300 / 87.0%            300 / 57.3%             29.7 pts
 *   patient_child    122 / 82.8%            122 / 49.2%             33.6 pts
 *
 * Same direction on all three, 30-36 points, on a region that should be near-symmetric. This is a
 * pipeline fault, not one actor's problem.
 *
 * HOW THIS WAS FOUND, because the route matters more than the number:
 *
 * I graded the child "bald" from a front-lit capture and filed three explanations. All three died:
 *
 *   hypothesis                                  | measurement                              | verdict
 *   --------------------------------------------|------------------------------------------|--------
 *   round 13 removed the child's hair            | it removed 440 texels, all in the eye band; aisha lost 3,013 in the same band | dead
 *   the child has less hair paint                | child 100,201 vs aisha 105,139 texels    | dead
 *   the paint misses the child's crown in UV     | child crown samples 69.1% hair-dark, aisha 66.2% | dead
 *   the fault is child-specific                  | all three actors show it, 29.7-35.7 pts  | dead
 *
 * The fourth死 came from looking at the THREE-QUARTER view: the child has dense hair on one side and
 * bare skin on the other, with a hard front-to-back boundary over the skull. The front view showed
 * the bare side, so "bald" was a one-angle verdict. §11l warns a thumbnail cannot support a negative
 * verdict; this is the same failure at full resolution — one angle is not the object.
 *
 * It also corrects a grade I published: I called aisha's face "good". She carries the same 35.7-point
 * deficit; her front view hides it. 0 of 3 was always the honest count.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                | (1) symmetric | (2) hair remains | (3) hairline survives | result
 *   -----------------------------------------|---------------|------------------|-----------------------|--------
 *   a) today                                 |   **FAIL**    |      pass        |        pass           | REFUSED
 *   b) drop the hair region entirely         |     pass      |    **FAIL**      |      **FAIL**         | REFUSED
 *   c) paint the whole dome                  |     pass      |      pass        |      **FAIL**         | REFUSED
 *   d) fix the directional bias in the region|     pass      |      pass        |        pass           | ALL PASS
 *
 * (b) and (c) are the two ways to make a ratio symmetric without fixing anything: remove the numerator
 * or saturate it. Clause (2) bounds coverage below and clause (3) bounds it above by requiring the
 * hairline band to still separate hair from face — a fully-painted dome has no hairline.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails on all three. (2) and (3) PASS
 * today and are regression nets — round 11 retired the per-polygon scalp (`scalpPrims=0`) and round 13
 * recovered the eye sockets; neither may be spent to buy symmetry.
 *
 * NOT TESTED: this asserts LEFT/RIGHT BALANCE of the baked hair region only. It says nothing about
 * whether the hairline is at the right height, whether the hair looks like hair, or about the nurse's
 * mottled mouth region. It samples one texel per vertex, so it measures coverage, not appearance. And
 * it does not diagnose the cause — a directional bias could come from the region classifier, the UV
 * splat, or the bake, and nothing here distinguishes them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** Measured ambient is 29.7–35.7 points. A near-symmetric scalp should sit in single digits. */
const MAX_ASYMMETRY_POINTS = 12;

/** Below this the "fix" is hair removal, not balance. Measured today: 46.4–87.0% per side. */
const MIN_SIDE_COVERAGE_PCT = 25;

/** Above this on BOTH sides there is no hairline left — the dome is uniformly painted. */
const MAX_SIDE_COVERAGE_PCT = 97;

type Row = { file: string; leftPct: number; rightPct: number; asym: number; n: number };

const io = new NodeIO();

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const body = doc.getRoot().listMeshes().find((m) => /_body$/.test(m.getName()));
  if (!body) return null;
  const skin = body.listPrimitives().find((p) => /skin/i.test(p.getMaterial()?.getName() ?? ""));
  const pos = skin?.getAttribute("POSITION");
  const uv = skin?.getAttribute("TEXCOORD_0");
  const img = skin?.getMaterial()?.getBaseColorTexture()?.getImage();
  if (!pos || !uv || !img || img.byteLength === 0) return null;

  let lo = Infinity;
  let hi = -Infinity;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (mat?.getAlphaMode() === "MASK" && (mat?.getBaseColorFactor()?.[3] ?? 1) === 0) continue;
      const q = prim.getAttribute("POSITION");
      if (!q) continue;
      for (let i = 0; i < q.getCount(); i++) {
        const y = (q.getElement(i, [0, 0, 0]) as number[])[1]!;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
  }
  const H = hi - lo;

  // Decoding the PNG needs a decoder this package does not carry, so the texture is sampled
  // through the same path the orchestrator used: nearest texel via raw byte offset is NOT valid on
  // a compressed PNG, so instead the per-side comparison uses the DECODED sample the pipeline
  // already writes beside the GLB. Absent that sidecar the row is skipped rather than guessed.
  const sidecar = rel.replace(/\.glb$/, ".skin-baked.png");
  if (!readdirSync(join(REPO_ROOT, GENERATED)).includes(sidecar.split("/").pop()!)) return null;

  const { readFileSync } = await import("node:fs");
  const png = readFileSync(join(REPO_ROOT, sidecar));
  const decoded = await decodePng(png);
  if (!decoded) return null;

  let leftHair = 0;
  let leftN = 0;
  let rightHair = 0;
  let rightN = 0;
  for (let i = 0; i < pos.getCount(); i++) {
    const p = pos.getElement(i, [0, 0, 0]) as number[];
    if ((p[1]! - lo) / H < 0.94) continue;
    const side = p[0]!;
    if (Math.abs(side) <= 0.005) continue;
    const t = uv.getElement(i, [0, 0]) as number[];
    const x = Math.min(decoded.width - 1, Math.max(0, Math.floor(t[0]! * decoded.width)));
    const y = Math.min(decoded.height - 1, Math.max(0, Math.floor((1 - t[1]!) * decoded.height)));
    const o = (y * decoded.width + x) * 4;
    const lum = (decoded.data[o]! + decoded.data[o + 1]! + decoded.data[o + 2]!) / 3;
    const dark = lum < 70;
    if (side < 0) { leftN++; if (dark) leftHair++; } else { rightN++; if (dark) rightHair++; }
  }
  if (leftN < 20 || rightN < 20) return null;

  const leftPct = (leftHair / leftN) * 100;
  const rightPct = (rightHair / rightN) * 100;
  return {
    file: rel.split("/").pop()!,
    leftPct,
    rightPct,
    asym: Math.abs(leftPct - rightPct),
    n: leftN + rightN,
  };
}

/** Minimal PNG reader for the baked sidecar: 8-bit RGB/RGBA, non-interlaced (what the bake emits). */
async function decodePng(
  buf: Buffer,
): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  const zlib = await import("node:zlib");
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) return null; // 8-bit, non-interlaced only
      channels = body[9] === 2 ? 3 : body[9] === 6 ? 4 : 0;
      if (channels === 0) return null;
    } else if (type === "IDAT") idat.push(Buffer.from(body));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  const stride = width * channels;
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]!;
    for (let i = 0; i < stride; i++) {
      const rawByte = raw[p + i]!;
      const a = i >= channels ? line[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
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
      line[i] = v & 0xff;
    }
    p += stride;
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s]!;
      out[d + 1] = line[s + 1]!;
      out[d + 2] = line[s + 2]!;
      out[d + 3] = channels === 4 ? line[s + 3]! : 255;
    }
    prev.set(line);
  }
  return { width, height, data: out };
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `MPFB bodies with a measurable baked scalp (scanned ${files.length})`)
    .toBeGreaterThanOrEqual(3);
}

const show = (r: Row): string =>
  `${r.file}: left=${r.leftPct.toFixed(1)}% right=${r.rightPct.toFixed(1)}% asym=${r.asym.toFixed(1)}pts n=${r.n}`;

describe("baked hair covers both sides of the head", () => {
  it.fails("(1) RED: left/right scalp hair coverage is balanced", () => {
    requireRows();
    expect(
      rows.filter((r) => r.asym > MAX_ASYMMETRY_POINTS).map(show),
      `scalps whose sides differ by more than ${MAX_ASYMMETRY_POINTS} points`,
    ).toEqual([]);
  });

  it("(2) NET known-good: hair is not REMOVED to make the ratio symmetric", () => {
    requireRows();
    const stripped = rows
      .filter((r) => r.leftPct < MIN_SIDE_COVERAGE_PCT || r.rightPct < MIN_SIDE_COVERAGE_PCT)
      .map(show);
    expect(stripped, `sides below ${MIN_SIDE_COVERAGE_PCT}% coverage`).toEqual([]);
  });

  it("(3) NET known-good: the dome is not SATURATED to make the ratio symmetric", () => {
    // A fully painted dome is symmetric and has no hairline. Round 11 and 13 bought that boundary.
    requireRows();
    const saturated = rows
      .filter((r) => r.leftPct > MAX_SIDE_COVERAGE_PCT && r.rightPct > MAX_SIDE_COVERAGE_PCT)
      .map(show);
    expect(saturated, `scalps painted above ${MAX_SIDE_COVERAGE_PCT}% on both sides`).toEqual([]);
  });
});
