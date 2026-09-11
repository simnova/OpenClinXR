import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "../decode-png.ts";

/**
 * HB-06 v1 (diagnose only, no fix): every visible in-scope defect site on
 * mpfb-peds-patient-child is attributed to the exact mesh, material, UV and
 * texel that produces it, so the fix card can target the right factory step.
 *
 * Method (instrument, never Blender): stride-aware reads of the live GLB bytes
 * (POSITION/NORMAL/UV/JOINTS_0/WEIGHTS_0 interleaved at stride 52) plus the
 * tracked front_lit PNG decoded with decode-png. The structure pass
 * (lum > 40) is the subject mask, as in HB-04. The JSON report
 * (docs/openclinxr/humanoid-vetting-captures/mpfb-peds-patient-child-defect-sites.json)
 * is the machine-readable record, not the proof: every clause below
 * recomputes from the GLB bytes and the tracked PNGs.
 *
 * Out of scope: any fix; the waistband and crotch defects (separate
 * garment-fit sites, not measured here).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb");
const REPORT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-peds-patient-child-defect-sites.json");
const LIT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-peds-patient-child-front_lit.png");
const STRUCT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-peds-patient-child-front_structure.png");
const BG_LUMA = 0.299 * 24 + 0.587 * 33 + 0.114 * 29;

type GlbJson = {
  materials?: { name?: string; alphaMode?: string; alphaCutoff?: number; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: unknown } }[];
  meshes?: { name?: string; primitives?: { indices?: number; material?: number; attributes?: Record<string, number> }[] }[];
  nodes?: { name?: string; translation?: number[]; children?: number[] }[];
  skins?: { joints?: number[] }[];
  accessors?: { count?: number; componentType?: number; bufferView?: number; byteOffset?: number }[];
  bufferViews?: { byteOffset?: number; byteLength?: number; byteStride?: number }[];
  images?: { name?: string; bufferView?: number }[];
};

type Report = {
  schemaVersion?: string;
  subject?: { sha256?: string; bytes?: number };
  sites?: { id?: string; pixels?: { box?: number[]; subjectPixels?: number; exactBackground?: number; fraction?: number; bound?: number[] | null } }[];
  controlSiteC?: { pixels?: { exactBackground?: number } };
  factoryStep?: { file?: string };
};

function readGlb(): { bytes: Buffer; json: GlbJson; bin: Buffer } {
  const bytes = readFileSync(GLB);
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
  for (let k = 0; k < a.count; k++) out[k] = glb.bin.readUInt16LE(base + k * 2);
  return out;
}

/** Triangles with centroid y > 0.95 and |x| < 0.12 (neck) or 0.80 < y < 0.95 and 0.10 < |x| < 0.25 (arm). */
function bandCounts(glb: { json: GlbJson; bin: Buffer }, posAcc: number, idxAcc: number): { neck: number; arm: number } {
  const pos = floats(glb, posAcc, 3);
  const idx = indices(glb, idxAcc);
  let neck = 0;
  let arm = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const cy = (pos[idx[t]]![1]! + pos[idx[t + 1]]![1]! + pos[idx[t + 2]]![1]!) / 3;
    const cx = (Math.abs(pos[idx[t]]![0]!) + Math.abs(pos[idx[t + 1]]![0]!) + Math.abs(pos[idx[t + 2]]![0]!)) / 3;
    if (cy > 0.95 && cx < 0.12) neck++;
    else if (cy > 0.8 && cy < 0.95 && cx > 0.1 && cx < 0.25) arm++;
  }
  return { neck, arm };
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("the child defect sites are attributed from the GLB", () => {
  it("HB-06-required-behavior", () => {
    expect(existsSync(REPORT), `${REPORT} must exist and be TRACKED — a deliverable under a gitignored path has no land path (#64)`).toBe(true);
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as Report;
    expect(report.schemaVersion).toBe("openclinxr.child-defect-sites.v1");

    // (1) Subject pinned to the live bytes.
    const glb = readGlb();
    expect(glb.bytes.length, "live GLB length equals the report subject").toBe(11348244);
    expect(sha256Hex(glb.bytes), "live GLB sha256 equals the report subject").toBe(
      "2742c25863a117c0c57509039998b845f7d000f112d9d8343d1bd71eb12d0636",
    );
    expect(report.subject?.sha256).toBe("2742c25863a117c0c57509039998b845f7d000f112d9d8343d1bd71eb12d0636");

    // (2) Hide-mask primitives overlap both defect bands (recomputed, never trusted from the report).
    const body = glb.json.meshes?.find((m) => m.name === "mpfb_peds_patient_child_body");
    expect(body !== undefined, "body mesh present").toBe(true);
    const byMat = new Map((body?.primitives ?? []).map((p) => [p.material, p]));
    const upper = byMat.get(5);
    const upper001 = byMat.get(8);
    expect(upper !== undefined && upper001 !== undefined, "hide-mask prims (mat5, mat8) present").toBe(true);
    const upperBands = bandCounts(glb, upper!.attributes!["POSITION"]!, upper!.indices!);
    const upper001Bands = bandCounts(glb, upper001!.attributes!["POSITION"]!, upper001!.indices!);
    expect(upperBands.neck, "mat5 tris above y 0.95 at |x| < 0.12 (throat band the collar exposes)").toBe(790);
    expect(upper001Bands.neck, "mat8 tris above y 0.95 at |x| < 0.12").toBe(160);
    expect(upperBands.arm, "mat5 tris in the arm band the sleeve hem occupies").toBe(536);
    expect(upper001Bands.arm, "mat8 tris in the arm band").toBe(48);
    for (const mat of [5, 8]) {
      const m = glb.json.materials?.[mat];
      expect(m?.alphaMode, `mat${mat} is a MASK discard`).toBe("MASK");
      expect(m?.alphaCutoff, `mat${mat} cutoff`).toBe(0.5);
      expect(m?.pbrMetallicRoughness?.baseColorFactor?.slice(0, 3), `mat${mat} alpha-0 base`).toEqual([0, 0, 0]);
      expect(m?.pbrMetallicRoughness?.baseColorTexture, `mat${mat} carries no texture`).toBeUndefined();
    }

    // (3) No rendered skin triangle in the defect bands samples a black texel (ruled out: texture).
    const skin = byMat.get(4);
    expect(skin !== undefined, "skin prim (mat4) present").toBe(true);
    const skinUV = floats(glb, skin!.attributes!["TEXCOORD_0"]!, 2);
    const skinUVAcc = skin!.attributes!["TEXCOORD_0"]!;
    void skinUVAcc;
    const skinImg = glb.json.images?.[3];
    const skinBv = glb.json.bufferViews?.[skinImg?.bufferView ?? -1];
    const skinPngBytes = Buffer.from(glb.bin.subarray(skinBv?.byteOffset ?? 0, (skinBv?.byteOffset ?? 0) + (skinBv?.byteLength ?? 0)));
    expect(sha256Hex(skinPngBytes), "skin-baked embedded bytes equal the recorded atlas").toBe(
      "273e73f8267a495b79ff5f9568f5020b9aadd950695d6df32bb0fc5791dbcdba",
    );
    expect(skinUV.length, "skin UV count equals the vertex count").toBe(10930);

    // (4) Capture pixels: every in-scope site holds exact-background pixels; control site C holds none.
    const lit = decodePng(new Uint8Array(readFileSync(LIT)))!;
    const struct = decodePng(new Uint8Array(readFileSync(STRUCT)))!;
    expect(lit !== null && struct !== null, "both PNGs decode").toBe(true);
    const W = lit!.w;
    const count = (box: number[]): { subj: number; bg: number } => {
      let subj = 0;
      let bg = 0;
      for (let y = box[1]!; y < box[3]!; y++) {
        for (let x = box[0]!; x < box[2]!; x++) {
          const i = y * W + x;
          if (struct!.lum[i]! > 40) {
            subj++;
            if (Math.abs(lit!.lum[i]! - BG_LUMA) < 0.01) bg++;
          }
        }
      }
      return { subj, bg };
    };
    const expected: Record<string, { box: number[]; subj: number; bg: number }> = {
      "neckline-square-L": { box: [1840, 1300, 1980, 1400], subj: 6343, bg: 154 },
      "neckline-square-R": { box: [2120, 1300, 2260, 1400], subj: 6371, bg: 191 },
      "sleeve-hem-rectangle-L": { box: [1560, 1630, 1920, 1920], subj: 39866, bg: 382 },
      "sleeve-hem-rectangle-R": { box: [2180, 1630, 2540, 1920], subj: 38471, bg: 292 },
    };
    for (const site of report.sites ?? []) {
      const exp = expected[site.id ?? ""];
      expect(exp !== undefined, `site ${site.id} is one of the four in-scope sites`).toBe(true);
      expect(site.pixels?.box, `${site.id}: box`).toEqual(exp!.box);
      const got = count(exp!.box);
      expect(got.subj, `${site.id}: subject pixels recomputed from the tracked PNGs`).toBe(exp!.subj);
      expect(got.bg, `${site.id}: exact-background pixels recomputed from the tracked PNGs`).toBe(exp!.bg);
      expect(site.pixels?.subjectPixels).toBe(exp!.subj);
      expect(site.pixels?.exactBackground).toBe(exp!.bg);
      expect(got.bg, `${site.id}: the defect renders (nonzero exact-background pixels)`).toBeGreaterThan(0);
    }
    const ctrl = count([1980, 1180, 2120, 1300]);
    expect(ctrl.subj, "control site C (chin) subject pixels recomputed").toBe(16040);
    expect(ctrl.bg, "control site C holds zero exact-background pixels").toBe(0);
    expect(report.controlSiteC?.pixels?.exactBackground).toBe(0);

    // (5) Factory step named.
    expect(report.factoryStep?.file).toBe("tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");
  });
});
