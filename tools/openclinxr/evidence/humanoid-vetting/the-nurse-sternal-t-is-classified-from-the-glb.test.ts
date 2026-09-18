import { readFileSync } from "node:fs";
import { join, dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodePng } from "../decode-png.ts";

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

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const PEDS_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb");
const ADULT_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const REPORT = join(REPO_ROOT, "tools/openclinxr/evidence/humanoid-vetting/mpfb-nurse-sternal-t-classify.json");
const CLOSEUP = join(REPO_ROOT, "docs/assets/speech-emotion-blink-closed-2026-09-18.png");

type GlbJson = {
  materials?: { name?: string; alphaMode?: string; alphaCutoff?: number; doubleSided?: boolean; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: unknown } }[];
  meshes?: { name?: string; primitives?: { indices?: number; material?: number; attributes?: Record<string, number> }[] }[];
  accessors?: { count?: number; componentType?: number; bufferView?: number; byteOffset?: number }[];
  bufferViews?: { byteOffset?: number; byteLength?: number; byteStride?: number }[];
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
    const cy = (pos[idx[t]]![1]! + pos[idx[t + 1]]![1]! + pos[idx[t + 2]]![1]!) / 3;
    const cx = (Math.abs(pos[idx[t]]![0]!) + Math.abs(pos[idx[t + 1]]![0]!) + Math.abs(pos[idx[t + 2]]![0]!)) / 3;
    if (cy > 0.95 && cx < 0.12) n++;
  }
  return n;
}

type Tri = { a: number[]; b: number[]; c: number[]; kind: string };

function loadTris(glb: { json: GlbJson; bin: Buffer }, bodyName: string): Tri[] {
  const out: Tri[] = [];
  for (const mesh of glb.json.meshes ?? []) {
    const isBody = mesh.name === bodyName;
    const isShirt = /scrub_shirt/.test(mesh.name ?? "");
    if (!isBody && !isShirt) continue;
    for (const p of mesh.primitives ?? []) {
      const mat = glb.json.materials?.[p.material ?? -1];
      const kind = isShirt ? "shirt" : mat?.alphaMode === "MASK" ? "mask" : "skin";
      const pos = floats(glb, p.attributes?.["POSITION"] ?? -1, 3);
      const idx = indices(glb, p.indices ?? -1);
      for (let t = 0; t < idx.length; t += 3) out.push({ a: pos[idx[t]]!, b: pos[idx[t + 1]]!, c: pos[idx[t + 2]]!, kind });
    }
  }
  return out;
}

/** Front (+z) to back ray; returns kinds front-to-back. Double-sided: no cull. */
function raycast(tris: Tri[], px: number, py: number): string[] {
  const hits: { z: number; kind: string }[] = [];
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
    hits.push({ z: 10 - tt, kind: tr.kind });
  }
  hits.sort((x, y) => y.z - x.z);
  return hits.map((h) => h.kind);
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("the nurse sternal T is classified from the GLB", () => {
  it("nurse-sternal-t-classify", () => {
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      subjects?: { pedsKevin?: { sha256?: string; bytes?: number }; adult?: { sha256?: string; bytes?: number } };
      attribution?: { class?: string };
    };

    for (const [path, key, bytes, sha] of [
      [PEDS_GLB, "pedsKevin", 7513812, "fc5f285c79a13459de3bb9de5fbe3409d9725d2834e43a1e4f977b08f19765d5"],
      [ADULT_GLB, "adult", 8396376, "8409334c30861e07d7bb180b2b8f7e5d48c277bc91c4a5df8f0cb0475869c541"],
    ] as const) {
      const glb = readGlb(path);
      expect(glb.bytes.length, `${key}: GLB length pinned`).toBe(bytes);
      expect(sha256Hex(glb.bytes), `${key}: GLB sha256 pinned`).toBe(sha);
      expect((report.subjects as Record<string, { sha256?: string }>)?.[key]?.sha256, `${key}: report subject matches`).toBe(sha);

      // Mask machinery present with the child signature (MASK, cutoff 0.5, alpha-0, no texture).
      const masks = (glb.json.materials ?? []).filter((m) => /openclinxr_hidden/.test(m.name ?? ""));
      expect(masks.length, `${key}: hide-mask materials present`).toBeGreaterThan(0);
      for (const m of masks) {
        expect(m.alphaMode, `${key} ${m.name}: MASK discard`).toBe("MASK");
        expect(m.alphaCutoff, `${key} ${m.name}: cutoff`).toBe(0.5);
        expect(m.pbrMetallicRoughness?.baseColorFactor?.slice(0, 3), `${key} ${m.name}: alpha-0 base`).toEqual([0, 0, 0]);
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
      const bodyName = glb.json.meshes?.find((m) => /_body$/.test(m.name ?? ""))?.name ?? "";
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
        const kinds = raycast(tris, 0, py);
        expect(kinds.length, `${key} ray y=${py}: hits geometry`).toBeGreaterThan(0);
        expect(kinds[0], `${key} ray y=${py}: front-most hit is OPAQUE shirt, not a mask hole`).toBe("shirt");
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
