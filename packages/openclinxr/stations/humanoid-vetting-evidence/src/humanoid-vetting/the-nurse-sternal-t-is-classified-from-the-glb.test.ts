import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glbGeometryDigest, repoRoot } from "@openclinxr/factory-station-core/runner";
import { decodePng } from "@openclinxr/png-measure/evidence-png";
import { describe, expect, it } from "vitest";
import {
  classifyGarmentMeshName,
  isUpperMeshName,
} from "../../../../../../tools/openclinxr/evidence/lib/garment-mesh-class.js";

/**
 * Nurse sternal T classify probe (diagnose only, no fix): the grey T at the
 * nurse sternal notch / collar (parent pixel-graded present in
 * docs/assets/speech-emotion-blink-closed-2026-09-18.png and
 * docs/assets/mpfb-nurse-rebake-hair-scrub-textures-2026-09-17.png) is
 * classified A (hide-mask hole) / B (real grey material) / C (shaded-skin
 * collar seam) from the live GLB bytes + the tracked PNG, the same instrument
 * as the child file (mpfb-peds-patient-child-defect-sites.json): stride-52
 * interleaved accessor reads, embedded-PNG decode, front-to-back raycast.
 *
 * Verdict: C. Machine-readable record:
 * tools/openclinxr/evidence/humanoid-vetting/mpfb-nurse-sternal-t-classify.json
 * (the record, not the proof: every clause below recomputes from the bytes).
 *
 * Out of scope: any fix (materializer held for the eyebrow worker); Blender;
 * eyebrows; teeth; website; promoting GLBs.
 */

const REPO_ROOT = repoRoot();
const PEDS_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb");
const ADULT_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const REPORT = join(REPO_ROOT, "tools/openclinxr/evidence/humanoid-vetting/mpfb-nurse-sternal-t-classify.json");
const CLOSEUP = join(REPO_ROOT, "docs/assets/speech-emotion-blink-closed-2026-09-18.png");

type GlbJson = {
  materials?: { name?: string; alphaMode?: string; alphaCutoff?: number; doubleSided?: boolean; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index?: number; texCoord?: number } } }[];
  meshes?: { name?: string; primitives?: { indices?: number; material?: number; attributes?: Record<string, number> }[] }[];
  accessors?: { count?: number; componentType?: number; bufferView?: number; byteOffset?: number; type?: string }[];
  bufferViews?: { byteOffset?: number; byteLength?: number; byteStride?: number }[];
  textures?: { source?: number }[];
  images?: { bufferView?: number; mimeType?: string }[];
};

function readGlb(path: string): { bytes: Buffer; json: GlbJson; bin: Buffer } {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  return { bytes, json: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson, bin: bytes.subarray(20 + jsonLength + 8) };
}

function floats(glb: { json: GlbJson; bin: Buffer }, accessor: number, size: number): number[][] {
  const a = glb.json.accessors?.[accessor];
  const bv = glb.json.bufferViews?.[a?.bufferView ?? -1];
  if (!a || !bv || a.count === undefined) throw new Error(`bad accessor ${accessor}`);
  const base = (a.byteOffset ?? 0) + (bv.byteOffset ?? 0);
  const stride = bv.byteStride ?? size * 4;
  const out: number[][] = new Array(a.count);
  for (let k = 0; k < a.count; k++) {
    const row: number[] = new Array(size);
    for (let d = 0; d < size; d++) row[d] = glb.bin.readFloatLE(base + k * stride + d * 4);
    out[k] = row;
  }
  return out;
}

function indices(glb: { json: GlbJson; bin: Buffer }, accessor: number): number[] {
  const a = glb.json.accessors?.[accessor];
  const bv = glb.json.bufferViews?.[a?.bufferView ?? -1];
  if (!a || !bv || a.count === undefined) throw new Error(`bad index accessor ${accessor}`);
  const base = (a.byteOffset ?? 0) + (bv.byteOffset ?? 0);
  const out: number[] = new Array(a.count);
  for (let k = 0; k < a.count; k++) out[k] = a.componentType === 5125 ? glb.bin.readUInt32LE(base + k * 4) : glb.bin.readUInt16LE(base + k * 2);
  return out;
}

/** Child-method neck band: centroid y > 0.95 and |x| < 0.12. */
function neckCount(glb: { json: GlbJson; bin: Buffer }, posAcc: number, idxAcc: number): number {
  const pos = floats(glb, posAcc, 3);
  const idx = indices(glb, idxAcc);
  let n = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t];
    const i1 = idx[t + 1];
    const i2 = idx[t + 2];
    if (i0 === undefined || i1 === undefined || i2 === undefined) {
      throw new Error("index buffer length is not a multiple of 3");
    }
    const cy = (pos[i0]![1]! + pos[i1]![1]! + pos[i2]![1]!) / 3;
    const cx = (Math.abs(pos[i0]![0]!) + Math.abs(pos[i1]![0]!) + Math.abs(pos[i2]![0]!)) / 3;
    if (cy > 0.95 && cx < 0.12) n++;
  }
  return n;
}

/** Shirt alpha coverage (glTF 2.0): OPAQUE covers; BLEND never; MASK covers where
 * factor x texture x vertex alpha >= cutoff (default 0.5). Texture alpha is
 * nearest-sampled at the hit UV (TEXCOORD of the texture texCoord; clamped).
 * Unreadable MASK texture or missing UVs refuses; COLOR_0 multiplies when present
 * (dormant: neither shipped GLB has it). */
type ShirtCover = {
  alphaMode: string;
  cutoff: number;
  factorAlpha: number;
  tex: DecodedPng | null;
  texOwed: boolean;
  refuse: string | null;
};
type Tri = {
  a: number[];
  b: number[];
  c: number[];
  kind: string;
  uv: [number[], number[], number[]] | null;
  vertAlpha: [number, number, number] | null;
  cover: ShirtCover | null;
};
type DecodedPng = NonNullable<ReturnType<typeof decodePng>>;

function coverTexture(glb: { json: GlbJson; bin: Buffer }, cache: Map<number, DecodedPng | null>, texIndex: number): DecodedPng | null {
  const hit = cache.get(texIndex);
  if (hit !== undefined) return hit;
  let decoded: DecodedPng | null = null;
  const image = glb.json.images?.[glb.json.textures?.[texIndex]?.source ?? -1];
  const bv = glb.json.bufferViews?.[image?.bufferView ?? -1];
  if (image?.mimeType === "image/png" && bv?.byteLength !== undefined) {
    decoded = decodePng(new Uint8Array(glb.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)));
  }
  cache.set(texIndex, decoded);
  return decoded;
}

function loadTris(glb: { json: GlbJson; bin: Buffer }, bodyName: string): Tri[] {
  const out: Tri[] = [];
  const texCache = new Map<number, DecodedPng | null>();
  for (const mesh of glb.json.meshes ?? []) {
    // Body by resolved identity, with the shared body class as the rename-proof
    // fallback; shirt via the shared upper class, not /scrub_shirt/.
    const isBody = mesh.name === bodyName || classifyGarmentMeshName(mesh.name ?? "") === "body";
    // The nurse upper, via the shared classifier — not a /scrub_shirt/ match
    // that misses the next wardrobe retarget.
    const isShirt = isUpperMeshName(mesh.name ?? "");
    if (!isBody && !isShirt) continue;
    for (const p of mesh.primitives ?? []) {
      const mat = glb.json.materials?.[p.material ?? -1];
      const kind = isShirt ? "shirt" : mat?.alphaMode === "MASK" ? "mask" : "skin";
      // Shirt cover is opacity at the hit, not mesh name: factor alpha alone
      // blinds a fully transparent textured MASK (h11 F3), so MASK multiplies
      // the texture alpha sampled at the hit UV (and COLOR_0 alpha when present).
      let cover: ShirtCover | null = null;
      let uv: number[][] | null = null;
      let vert: number[] | null = null;
      if (isShirt) {
        const alphaMode = mat?.alphaMode ?? "OPAQUE";
        const texRef = mat?.pbrMetallicRoughness?.baseColorTexture;
        const texIndex = alphaMode === "MASK" ? (texRef?.index ?? -1) : -1;
        const jx = glb.json as GlbJson & { textures?: { source?: number; sampler?: number }[]; samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[] };
        const samp = jx.samplers?.[jx.textures?.[texIndex]?.sampler ?? -1];
        const img = glb.json.images?.[jx.textures?.[texIndex]?.source ?? -1];
        const iBv = glb.json.bufferViews?.[img?.bufferView ?? -1];
        const iBy = img?.mimeType === "image/png" && iBv?.byteLength !== undefined ? glb.bin.subarray(iBv.byteOffset ?? 0, (iBv.byteOffset ?? 0) + iBv.byteLength) : null;
        const tD = iBy !== null && iBy.length >= 33 && iBy[0] === 137 && iBy[12] === 73 && iBy[13] === 72 && iBy[14] === 68 && iBy[15] === 82 ? [iBy[24]!, iBy[25]!] : null;
        let trns = false;
        if (iBy !== null && iBy.length >= 33 && iBy[0] === 137) { const dv = new DataView(iBy.buffer, iBy.byteOffset, iBy.byteLength); let o = 8; while (o + 8 <= iBy.length) { const ty = String.fromCharCode(iBy[o + 4]!, iBy[o + 5]!, iBy[o + 6]!, iBy[o + 7]!); if (ty === "tRNS") { trns = true; break; } if (ty === "IEND") break; o += 12 + dv.getUint32(o); } }
        const xX = [...Object.keys((texRef as { extensions?: Record<string, unknown> } | undefined)?.extensions ?? {}), ...Object.keys((mat as { extensions?: Record<string, unknown> } | undefined)?.extensions ?? {})];
        let refuse: string | null = null;
        if (xX.length > 0) refuse = `unsupported MASK coverage input: texture extension ${xX[0]}`;
        else if ((samp?.wrapS ?? 10497) === 33648 || (samp?.wrapT ?? 10497) === 33648) refuse = `unsupported MASK coverage input: sampler wrap ${(samp?.wrapS ?? 10497) === 33648 ? samp?.wrapS : samp?.wrapT}`;
        else if (samp?.magFilter !== undefined && samp.magFilter !== 9728) refuse = `unsupported MASK coverage input: sampler filter ${samp.magFilter}`;
        else if (samp?.minFilter !== undefined && samp.minFilter !== 9728 && samp.minFilter !== 9984) refuse = `unsupported MASK coverage input: sampler filter ${samp.minFilter}`;
        else if (tD !== null && tD[1] !== 6) refuse = `unsupported MASK coverage input: PNG color type ${tD[1]}`;
        else if (tD !== null && tD[0] !== 8) refuse = `unsupported MASK coverage input: PNG bit depth ${tD[0]}`;
        else if (trns) refuse = `unsupported MASK coverage input: PNG tRNS`;
        cover = {
          alphaMode,
          cutoff: mat?.alphaCutoff ?? 0.5,
          factorAlpha: mat?.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1,
          tex: texIndex >= 0 ? coverTexture(glb, texCache, texIndex) : null,
          texOwed: texIndex >= 0 && coverTexture(glb, texCache, texIndex) === null,
          refuse,
        };
        const uvAcc = p.attributes?.[`TEXCOORD_${texRef?.texCoord ?? 0}`];
        uv = uvAcc === undefined ? null : floats(glb, uvAcc, 2);
        const colorAcc = p.attributes?.["COLOR_0"];
        if (colorAcc !== undefined) {
          const rows = floats(glb, colorAcc, glb.json.accessors?.[colorAcc]?.type === "VEC3" ? 3 : 4);
          vert = rows.map((row) => (row.length === 3 ? 1 : (row[3] ?? 1)));
        }
        if (cover.refuse === null && alphaMode === "MASK" && uv?.some((q) => q[0]! < 0 || q[0]! > 1 || q[1]! < 0 || q[1]! > 1)) cover.refuse = `unsupported MASK coverage input: sampler wrap ${uv.some((q) => q[0]! < 0 || q[0]! > 1) ? (samp?.wrapS ?? 10497) : (samp?.wrapT ?? 10497)}`;
      }
      const pos = floats(glb, p.attributes?.["POSITION"] ?? -1, 3);
      const idx = indices(glb, p.indices ?? -1);
      for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t];
      const i1 = idx[t + 1];
      const i2 = idx[t + 2];
      if (i0 === undefined || i1 === undefined || i2 === undefined) {
        throw new Error("index buffer length is not a multiple of 3");
      }
      out.push({
        a: pos[i0]!,
        b: pos[i1]!,
        c: pos[i2]!,
        kind,
        uv: uv === null ? null : [uv[i0]!, uv[i1]!, uv[i2]!],
        vertAlpha: vert === null ? null : [vert[i0]!, vert[i1]!, vert[i2]!],
        cover,
      });
    }
    }
  }
  return out;
}

/** Shirt opacity at the hit (barycentric u, v; w = 1-u-v). */
function shirtCovers(tri: Tri, u: number, v: number): boolean {
  const cover = tri.cover!;
  if (cover.alphaMode === "BLEND") return false;
  if (cover.alphaMode !== "MASK") return true;
  if (cover.refuse !== null) throw new Error(cover.refuse);
  if (cover.texOwed || (cover.tex !== null && tri.uv === null)) return false;
  let alpha = cover.factorAlpha;
  if (cover.tex !== null) {
    const w = 1 - u - v;
    const uu = w * tri.uv![0]![0]! + u * tri.uv![1]![0]! + v * tri.uv![2]![0]!;
    const vv = w * tri.uv![0]![1]! + u * tri.uv![1]![1]! + v * tri.uv![2]![1]!;
    const x = Math.min(cover.tex.w - 1, Math.max(0, Math.floor(uu * cover.tex.w)));
    const y = Math.min(cover.tex.h - 1, Math.max(0, Math.floor(vv * cover.tex.h)));
    alpha *= cover.tex.a[y * cover.tex.w + x]! / 255;
  }
  if (tri.vertAlpha !== null) {
    alpha *= (1 - u - v) * tri.vertAlpha[0]! + u * tri.vertAlpha[1]! + v * tri.vertAlpha[2]!;
  }
  return alpha >= cover.cutoff;
}

/** Front (+z) to back ray; returns front-to-back hits. Double-sided: no cull. */
function raycast(tris: Tri[], px: number, py: number): { kind: string; opaque: boolean }[] {
  const hits: { z: number; kind: string; opaque: boolean }[] = [];
  for (const tr of tris) {
    const { a: A, b: B, c: C } = tr;
    const e1x = B[0]! - A[0]!, e1y = B[1]! - A[1]!, e1z = B[2]! - A[2]!;
    const e2x = C[0]! - A[0]!, e2y = C[1]! - A[1]!, e2z = C[2]! - A[2]!;
    const q0 = e2y, q1 = -e2x;
    const det = e1x * q0 + e1y * q1;
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det;
    const sx = px - A[0]!, sy = py - A[1]!, sz = 10 - A[2]!;
    const u = (sx * q0 + sy * q1) * inv;
    if (u < 0 || u > 1) continue;
    const r2 = sx * e1y - sy * e1x;
    const v = -r2 * inv;
    if (v < 0 || u + v > 1) continue;
    const r0 = sy * e1z - sz * e1y, r1 = sz * e1x - sx * e1z;
    const tt = (e2x * r0 + e2y * r1 + e2z * r2) * inv;
    if (tt < 0) continue;
    hits.push({ z: 10 - tt, kind: tr.kind, opaque: tr.cover === null ? false : shirtCovers(tr, u, v) });
  }
  hits.sort((x, y) => y.z - x.z);
  return hits.map((h) => ({ kind: h.kind, opaque: h.opaque }));
}

/** Sternal-T identity gate (C3a): digest of the live GLB bytes against the
 * writer pin. The classify body and the A2 P2 counterweight share it, so a
 * loosened gate breaks P2 instead of passing silently. */
function assertSternalPinOrThrow(glbBytes: Uint8Array, key: string, pin: string | undefined): void {
  if (glbGeometryDigest(glbBytes) !== pin) {
    throw new Error(`${key}: geometry digest pinned (stale pin refuses)`);
  }
}

describe("the nurse sternal T is classified from the GLB", () => {
  it("nurse-sternal-t-classify", () => {
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      subjects?: { pedsKevin?: { geometrySha256?: string }; adult?: { geometrySha256?: string } };
      attribution?: { class?: string };
    };

    // Identity is geometry (C3a): glbGeometryDigest of the live GLB against the
    // writer-pinned subjects.<key>.geometrySha256. A material-only post-export
    // stage keeps the digest; a rebake that moves a vertex refuses.

    for (const [path, key] of [
      // RE-PINNED history (whole-file pins, superseded by the C3a geometry digest):
      // deliberate churn 32e58c3ff + 91aa4b5d3 (walk bind) + 9f2934536 (teeth retreat);
      // ci-w11b, st-redgarm D1, st-weld2, st-palette C5, st-viteye r2, st-vitfacet r6/r7,
      // st-vitbody3 r2b, teeth swap + F3 2026-11-10, kevin-colour 2026-11-18, kevin-collar S3.
      [PEDS_GLB, "pedsKevin"],
      // RE-PINNED history (whole-file pins, superseded by the C3a geometry digest):
      // deliberate churn 8e7a1d0c2 (CC-BY scrub extras) + 91aa4b5d3 + 9f2934536;
      // ci-w11b, st-weld, st-vitfacet r6/r7, st-vitbody3 r2b, teeth swap + F3 2026-11-10.
      [ADULT_GLB, "adult"],
    ] as const) {
      const glb = readGlb(path);
      assertSternalPinOrThrow(
        new Uint8Array(glb.bytes.buffer, glb.bytes.byteOffset, glb.bytes.byteLength),
        key,
        (report.subjects as Record<string, { geometrySha256?: string }>)?.[key]?.geometrySha256,
      );


      // Mask machinery present with the child signature (MASK, cutoff 0.5, alpha-0, no texture).
      const masks = (glb.json.materials ?? []).filter((m) => /openclinxr_hidden/.test(m.name ?? ""));
      expect(masks.length, `${key}: hide-mask materials present`).toBeGreaterThan(0);
      for (const m of masks) {
        expect(m.alphaMode, `${key} ${m.name}: MASK discard`).toBe("MASK");
        expect(m.alphaCutoff, `${key} ${m.name}: cutoff`).toBe(0.5);
        expect(m.pbrMetallicRoughness?.baseColorFactor?.slice(0, 3), `${key} ${m.name}: alpha-0 base`).toEqual([0, 0, 0]);
        expect(m.pbrMetallicRoughness?.baseColorFactor?.[3], `${key} ${m.name}: hide-mask alpha must stay 0 or the discard hole closes`).toBe(0);
        expect(m.pbrMetallicRoughness?.baseColorTexture, `${key} ${m.name}: no texture`).toBeUndefined();
      }

      // No OPAQUE material carries a grey base factor (rules out B at the material level).
      for (const m of glb.json.materials ?? []) {
        const f = m.pbrMetallicRoughness?.baseColorFactor;
        if ((m.alphaMode ?? "OPAQUE") === "OPAQUE" && f && !m.pbrMetallicRoughness?.baseColorTexture) {
          const [r, g, b] = f;
          const grey = Math.max(r!, g!, b!) - Math.min(r!, g!, b!) < 0.12 && r! > 0.25 && r! < 0.8;
          expect(grey, `${key} ${m.name}: no flat-grey OPAQUE base factor`).toBe(false);
        }
      }

      // Mask tris overlap the throat band (child method) AND an OPAQUE shirt
      // covers every notch ray, so no discard hole reaches the viewer (rules out A).
      // Body mesh via the shared classifier (the next rename must not empty this).
      const bodyName = glb.json.meshes?.find((m) => classifyGarmentMeshName(m.name ?? "") === "body")?.name ?? "";
      expect(bodyName, `${key}: body mesh present`).not.toBe("");
      const body = glb.json.meshes?.find((m) => m.name === bodyName);
      let maskNeck = 0;
      for (const p of body?.primitives ?? []) {
        const m = glb.json.materials?.[p.material ?? -1];
        if (m?.alphaMode === "MASK") maskNeck += neckCount(glb, p.attributes?.["POSITION"] ?? -1, p.indices ?? -1);
      }
      expect(maskNeck, `${key}: mask tris overlap the throat band (the A candidate)`).toBeGreaterThan(0);
      const tris = loadTris(glb, bodyName);
      expect(tris.length, `${key}: body+shirt tris loaded`).toBeGreaterThan(8000);
      for (const py of [1.0, 1.02, 1.04, 1.06, 1.08]) {
        const hits = raycast(tris, 0, py);
        expect(hits.length, `${key} ray y=${py}: hits geometry`).toBeGreaterThan(0);
        expect(hits[0]?.kind, `${key} ray y=${py}: front-most hit is OPAQUE shirt, not a mask hole`).toBe("shirt");
        expect(hits[0]?.opaque, `${key} ray y=${py}: front-most shirt is opaque material, not BLEND/transparent`).toBe(true);
      }
    }

    // Capture: chest window holds zero exact-background pixels (a hide-mask
    // hole would read the 24,33,29 clear color); the T pixels are skin-family.
    const png = decodePng(new Uint8Array(readFileSync(CLOSEUP)))!;
    expect(png, "closeup decodes").not.toBeNull();
    expect([png.w, png.h], "closeup size").toEqual([1280, 720]);
    const at = (x: number, y: number): [number, number, number] => {
      const i = y * png.w + x;
      return [png.r[i]!, png.g[i]!, png.b[i]!];
    };
    expect(at(5, 5), "clear color pinned at corner").toEqual([24, 33, 29]);
    let bg = 0;
    for (let y = 460; y < 600; y++) {
      for (let x = 560; x < 710; x++) {
        const [r, g, b] = at(x, y);
        if (r === 24 && g === 33 && b === 29) bg++;
      }
    }
    expect(bg, "chest window exact-background pixels (A would be nonzero)").toBe(0);
    const [tr, tg, tb] = at(592, 499);
    expect(Math.max(tr, tg, tb) - Math.min(tr, tg, tb) < 30, "T median is low-chroma (skin-family, not teal shirt)").toBe(true);
    expect(tr > 120 && tr < 220, "T median red in skin range").toBe(true);

    expect(report.attribution?.class, "report verdict").toBe("C");
  }, 300_000);
});

describe("A2 sternal-T geometry pin (C3a: a material-only stage re-pins no geometry file)", () => {
  function committedAdultPin(): string {
    const doc = JSON.parse(readFileSync(REPORT, "utf8")) as {
      subjects?: { adult?: { geometrySha256?: string } };
    };
    const pin = doc.subjects?.adult?.geometrySha256;
    expect(pin, "classify record has no adult geometrySha256 (run pin-sternal-t-geometry.ts)").toMatch(/^[0-9a-f]{64}$/);
    return pin!;
  }

  /** Material-only variant: one parsed baseColorFactor component +0.05; JSON chunk lengths repaired. */
  function withMaterialOnlyTweak(shipped: Uint8Array): { bytes: Uint8Array; before: number; after: number } {
    const buf = Buffer.from(shipped);
    const jsonLen = buf.readUInt32LE(12);
    const text = buf.subarray(20, 20 + jsonLen).toString("utf8");
    const arrM = /"baseColorFactor":\[([^\]]*)\]/.exec(text);
    if (!arrM) throw new Error("A2 P1 setup: baseColorFactor array missing from JSON text");
    const tok = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(arrM[1]!)!;
    const before = Number(tok[0]);
    const after = Math.min(1, before + 0.05);
    const absIdx = arrM.index + arrM[0].indexOf(arrM[1]!) + tok.index;
    let next = text.slice(0, absIdx) + String(after) + text.slice(absIdx + tok[0].length);
    next += " ".repeat((4 - (Buffer.byteLength(next, "utf8") % 4)) % 4);
    const nextBytes = Buffer.from(next, "utf8");
    const binStart = 20 + jsonLen;
    const out = Buffer.alloc(20 + nextBytes.length + (buf.length - binStart));
    buf.subarray(0, 8).copy(out, 0);
    out.writeUInt32LE(nextBytes.length, 12);
    buf.subarray(16, 20).copy(out, 16);
    nextBytes.copy(out, 20);
    buf.subarray(binStart).copy(out, 20 + nextBytes.length);
    out.writeUInt32LE(out.length, 8);
    return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), before, after };
  }

  /** 1-ULP edit of the first float of the first float-POSITION accessor (in-memory copy). */
  function withOneUlpPositionEdit(shipped: Uint8Array): { bytes: Uint8Array; beforeHex: string; afterHex: string } {
    const buf = Buffer.from(shipped);
    const jsonLen = buf.readUInt32LE(12);
    const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
      meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
      accessors?: { bufferView?: number; byteOffset?: number; componentType?: number }[];
      bufferViews?: { byteOffset?: number }[];
    };
    let at = -1;
    for (const mesh of doc.meshes ?? []) {
      for (const prim of mesh.primitives ?? []) {
        const ai = prim.attributes?.["POSITION"];
        const acc = ai === undefined ? undefined : doc.accessors?.[ai];
        const bv = acc?.bufferView === undefined ? undefined : doc.bufferViews?.[acc.bufferView];
        if (acc !== undefined && bv !== undefined && acc.componentType === 5126) {
          at = 20 + jsonLen + 8 + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
          break;
        }
      }
      if (at >= 0) break;
    }
    if (at < 0) throw new Error("A2 P2 setup: no float POSITION accessor");
    const beforeHex = buf.subarray(at, at + 4).toString("hex");
    buf.writeUInt32LE(buf.readUInt32LE(at) + 1, at);
    const afterHex = buf.subarray(at, at + 4).toString("hex");
    if (afterHex === beforeHex) throw new Error("A2 P2 setup: ULP edit did not change bytes");
    return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), beforeHex, afterHex };
  }

  it("A2 P1 material-blind: a material-only copy keeps the adult sternal-T pin", () => {
    const shipped = new Uint8Array(readFileSync(ADULT_GLB));
    const liveSha = createHash("sha256").update(shipped).digest("hex");
    const tweak = withMaterialOnlyTweak(shipped);
    const copySha = createHash("sha256").update(tweak.bytes).digest("hex");
    console.log("A2 P1", { before: tweak.before, after: tweak.after, liveSha, copySha });
    expect(tweak.after, "material tweak must change the parsed component").not.toBe(tweak.before);
    expect(copySha, "material-only copy must differ in whole bytes from the live GLB").not.toBe(liveSha);
    // The parsed material JSON of the mutant carries the new component value (not just the regex token).
    const mutantBuf = Buffer.from(tweak.bytes);
    const mutatedDoc = JSON.parse(mutantBuf.subarray(20, 20 + mutantBuf.readUInt32LE(12)).toString("utf8")) as {
      materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
    };
    const parsedFactors = (mutatedDoc.materials ?? []).flatMap((m) => m.pbrMetallicRoughness?.baseColorFactor ?? []);
    expect(parsedFactors, "mutated GLB parses a material factor carrying the tweak").toContain(tweak.after);
    expect(glbGeometryDigest(tweak.bytes), "material-only copy must keep the live geometry digest").toBe(
      glbGeometryDigest(shipped),
    );
    expect(glbGeometryDigest(tweak.bytes), "tweaked copy must match the committed pin").toBe(committedAdultPin());
  }, 30_000);

  it("A2 P2 counterweight: a 1-ULP POSITION edit refuses as stale", () => {
    const shipped = new Uint8Array(readFileSync(ADULT_GLB));
    const edit = withOneUlpPositionEdit(shipped);
    console.log("A2 P2", { beforeHex: edit.beforeHex, afterHex: edit.afterHex });
    expect(edit.afterHex, "ULP edit must change accessor bytes").not.toBe(edit.beforeHex);
    // The sternal-T identity gate on a disk round-trip: a loosened gate breaks this refusal.
    const dir = mkdtempSync(join(tmpdir(), "h10-a2-p2-"));
    try {
      const mutant = join(dir, "mpfb-clinical-nurse-adult.glb");
      writeFileSync(mutant, edit.bytes);
      expect(() => assertSternalPinOrThrow(new Uint8Array(readFileSync(mutant)), "adult", committedAdultPin())).toThrow(
        /stale pin refuses/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("A2 P3 known-good: the shipped adult passes the new pin", () => {
    const shipped = new Uint8Array(readFileSync(ADULT_GLB));
    expect(glbGeometryDigest(shipped)).toBe(committedAdultPin());
  }, 30_000);
});
