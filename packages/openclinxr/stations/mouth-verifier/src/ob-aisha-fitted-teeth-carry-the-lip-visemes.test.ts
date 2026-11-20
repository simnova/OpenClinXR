/**
 * RED for AISHA-FITTED-TEETH-VISEMES: the shipped Aisha GLB carries no
 * fitted-teeth lip-viseme targets, so its teeth cannot follow the lips.
 *
 * - G0 the fitted-teeth target names deep-equal the coupler ORDER constant
 *   (module-private ORDER in couple-fitted-teeth-to-lip-viseme.ts, cited by
 *   name: it is not exported). This also pins exactly one viseme_aa
 *   (coordinator carry-over: with duplicate names the helper zeroes the
 *   first slot while the runtime drives the last).
 * - G1 the teeth viseme_aa morph contribution is below -0.05 mm.
 * - CW1 rest sil tongue-tip-minus-crown stays within 0.05 mm of the pre-fix
 *   pin (the shipped GLB is the town square: rest geometry must not move).
 * - CW3 every accessor outside the fitted-teeth morph-target set is
 *   byte-identical to the pre-image, so the fix cannot smuggle other bytes.
 *   Dense payloads are stride-walked (Aisha's body interleaves attributes at
 *   stride 52); the S1 probe plants one byte in a strided non-teeth accessor
 *   on an in-memory copy and shows the comparator flags exactly that index
 *   (and passes the unmodified bytes).
 *
 * Only two numeric thresholds exist: TOL_MM 0.05 below, sourced from the
 * landed R1 TOL of the-tongue-channel-reads test ("R1 fresh-read"). G0 is an
 * exact deep-equal; CW3 is exact byte identity.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { applyNamedSpeechVisemes } from "@openclinxr/xr-dialogue/package-viseme";
import { describe, expect, it } from "vitest";
import {
  loadHeadlessScene,
  lowerArchIndices,
  measureTeethAaContribution,
} from "./index.js";
import { tongueTipMinusIncisor } from "./tongue-channel.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const AISHA_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb");
// Pre-image ref for CW3: read via git in the test, so the clause runs on any
// checkout with history (no committed per-accessor table to drift).
const PRE_IMAGE_REV = "4a8428b8b";
const PRE_IMAGE_PATH = "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb";
// Coupler ORDER constant (couple-fitted-teeth-to-lip-viseme.ts, module-private:
// cited by name because it is not exported).
const COUPLER_ORDER = [
  "viseme_aa",
  "viseme_E",
  "viseme_I",
  "viseme_O",
  "viseme_U",
  "viseme_FF",
  "viseme_PP",
];
// Pre-fix rest sil tip-minus-crown, mm, unrounded. Source: S0 prefix.json
// (S0c landed-channel probe on the shipped Aisha GLB); the store is
// machine-local so the value is a literal here, never read at test time.
// TOL below is the landed R1 TOL (the-tongue-channel-reads test, "R1 fresh-read").
const PREFIX_REST_SIL_DIFF_MM = 2.743145412381722;
const TOL_MM = 0.05;
// S0-measured contributions beside the Aisha value (not gated): Kevin
// -5.048165122516963, physician -5.073511817019721, via the same
// measureTeethAaContribution helper the clause-(3) test asserts the split with
// ("clause (3): teeth viseme_aa presence matches the contribution split on
// every actor").
const KEVIN_CONTRIBUTION_MM = -5.048165122516963;
const PHYSICIAN_CONTRIBUTION_MM = -5.073511817019721;

type Accessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  sparse?: unknown;
};
type Primitive = {
  indices?: number;
  attributes?: Record<string, number>;
  targets?: Array<Record<string, number>>;
};
type Mesh = { name?: string; primitives?: Primitive[]; extras?: { targetNames?: string[] } };
type Document = {
  accessors: Accessor[];
  bufferViews: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
  meshes: Mesh[];
};
type ParsedGlb = { document: Document; binary: Buffer };

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

function parseGlbBytes(raw: Buffer, label: string): ParsedGlb {
  if (raw.readUInt32LE(0) !== 0x46546c67 || raw.readUInt32LE(4) !== 2) {
    throw new Error(`${label}: expected GLB v2`);
  }
  const jsonLength = raw.readUInt32LE(12);
  if (raw.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${label}: missing JSON chunk`);
  const document = JSON.parse(raw.subarray(20, 20 + jsonLength).toString("utf8")) as Document;
  const binHeader = 20 + jsonLength;
  if (raw.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error(`${label}: missing BIN chunk`);
  const binLength = raw.readUInt32LE(binHeader);
  return { document, binary: raw.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

/** BIN bytes of a dense accessor payload, element by element at the view's
 * byteStride (default = element size). Aisha's body interleaves attributes
 * (POSITION stride 52), so a contiguous count*elemSize slice would compare
 * the wrong bytes; stride-walking reads each element where it lives and
 * skips inter-element padding deterministically on both sides. */
function densePayload(glb: ParsedGlb, index: number, label: string): Buffer | null {
  const accessor = glb.document.accessors[index];
  if (!accessor || accessor.bufferView === undefined || accessor.sparse) return null;
  const size = COMPONENT_SIZE[accessor.componentType];
  const count = TYPE_COUNT[accessor.type];
  if (size === undefined || count === undefined) throw new Error(`${label}: accessor ${index} unknown layout`);
  const view = glb.document.bufferViews[accessor.bufferView];
  if (!view) throw new Error(`${label}: accessor ${index} has no bufferView entry`);
  const elem = count * size;
  const stride = view.byteStride ?? elem;
  if (stride < elem) throw new Error(`${label}: accessor ${index} stride ${stride} < element ${elem}`);
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = Buffer.alloc(accessor.count * elem);
  for (let i = 0; i < accessor.count; i += 1) {
    glb.binary.copy(out, i * elem, base + i * stride, base + i * stride + elem);
  }
  return out;
}

/** BIN slice of a sparse indices/values block. */
function sparseBlockBytes(glb: ParsedGlb, block: { bufferView: number; byteOffset?: number; componentType: number }, elements: number): Buffer {
  const view = glb.document.bufferViews[block.bufferView];
  if (!view) throw new Error(`sparse block has no bufferView entry`);
  const size = COMPONENT_SIZE[block.componentType];
  if (size === undefined) throw new Error(`sparse block unknown componentType`);
  const start = (view.byteOffset ?? 0) + (block.byteOffset ?? 0);
  return glb.binary.subarray(start, start + elements * size);
}

/** Indices of non-fitted-teeth-target accessors whose bytes differ between
 * two GLBs (teeth-target set read off each document by mesh name, never by
 * index). Appended (a-only) and removed (b-only) non-teeth indices count as
 * differing. Pure over the two parsed GLBs; the caller asserts emptiness. */
function nonTeethDiffs(a: ParsedGlb, b: ParsedGlb, aLabel: string, bLabel: string): number[] {
  const skip = fittedTeethTargetAccessors(a.document);
  const bSkip = fittedTeethTargetAccessors(b.document);
  const differing: number[] = [];
  for (let index = b.document.accessors.length; index < a.document.accessors.length; index += 1) {
    if (!skip.has(index)) differing.push(index);
  }
  const shared = Math.min(a.document.accessors.length, b.document.accessors.length);
  for (let index = 0; index < shared; index += 1) {
    if (skip.has(index) || bSkip.has(index)) continue;
    const aDense = densePayload(a, index, aLabel);
    const bDense = densePayload(b, index, bLabel);
    if (aDense && bDense) {
      if (aDense.length !== bDense.length || !aDense.equals(bDense)) differing.push(index);
      continue;
    }
    // Sparse or byte-less accessors (morph deltas ride sparse on this
    // asset): parsed-JSON identity plus the sparse index/value BIN bytes.
    const aAcc = a.document.accessors[index];
    const bAcc = b.document.accessors[index];
    if (!isDeepStrictEqual(aAcc, bAcc)) {
      differing.push(index);
      continue;
    }
    const aSparse = (aAcc as Accessor & { sparse?: { count: number; indices: { bufferView: number; byteOffset?: number; componentType: number }; values: { bufferView: number; byteOffset?: number } } }).sparse;
    const bSparse = (bAcc as Accessor & { sparse?: { count: number; indices: { bufferView: number; byteOffset?: number; componentType: number }; values: { bufferView: number; byteOffset?: number } } }).sparse;
    if (aSparse || bSparse) {
      if (!aSparse || !bSparse) {
        differing.push(index);
        continue;
      }
      const comps = TYPE_COUNT[(aAcc as Accessor).type] ?? 3;
      const aI = sparseBlockBytes(a, aSparse.indices, aSparse.count);
      const bI = sparseBlockBytes(b, bSparse.indices, bSparse.count);
      const aV = sparseBlockBytes(
        a,
        { ...aSparse.values, componentType: (aAcc as Accessor).componentType },
        aSparse.count * comps,
      );
      const bV = sparseBlockBytes(
        b,
        { ...bSparse.values, componentType: (bAcc as Accessor).componentType },
        bSparse.count * comps,
      );
      if (aI.length !== bI.length || !aI.equals(bI) || aV.length !== bV.length || !aV.equals(bV)) {
        differing.push(index);
      }
    }
  }
  for (let index = shared; index < b.document.accessors.length; index += 1) {
    if (!bSkip.has(index)) differing.push(index);
  }
  return differing;
}
/** Fitted-teeth morph-target accessor indices, by mesh name (never by index). */
function fittedTeethTargetAccessors(document: Document): Set<number> {
  const out = new Set<number>();
  for (const mesh of document.meshes) {
    if (!/fitted_teeth/i.test(mesh.name ?? "")) continue;
    for (const prim of mesh.primitives ?? []) {
      for (const target of prim.targets ?? []) {
        for (const accessor of Object.values(target)) out.add(accessor);
      }
    }
  }
  return out;
}

function fittedTeethTargetNames(document: Document): string[] {
  const mesh = document.meshes.find((item) => /fitted_teeth/i.test(item.name ?? ""));
  if (!mesh) throw new Error("no fitted-teeth mesh (/fitted_teeth/i) in Aisha GLB");
  return [...((mesh.extras?.targetNames ?? []) as string[])];
}

describe("ob aisha fitted teeth carry the lip visemes", () => {
  it("G0 fitted-teeth target names deep-equal the coupler ORDER", () => {
    const { document } = parseGlbBytes(readFileSync(AISHA_GLB), "shipped Aisha GLB");
    expect(fittedTeethTargetNames(document)).toEqual(COUPLER_ORDER);
  });

  it("G1 teeth viseme_aa contribution is below -0.05 mm", async () => {
    const contrib = await measureTeethAaContribution(AISHA_GLB);
    // eslint-disable-next-line no-console
    console.log(
      `G1 aisha contribution=${contrib.contribution} ` +
        `(kevin ${KEVIN_CONTRIBUTION_MM}, physician ${PHYSICIAN_CONTRIBUTION_MM}, not gated) ` +
        `present=${contrib.present} shipped=${contrib.shippedDispDiffZ} zeroed=${contrib.zeroedDispDiffZ}`,
    );
    expect(contrib.contribution).toBeLessThan(-TOL_MM);
  }, 180_000);

  it("CW1 rest sil tip-minus-crown stays within 0.05 mm of the pre-fix pin", async () => {
    const scene = await loadHeadlessScene(AISHA_GLB);
    const drive = applyNamedSpeechVisemes({ root: scene.root }, 0);
    expect(drive.activeTargetName, "sil drive active target").toBe("viseme_sil");
    const arch = lowerArchIndices(scene.teeth, scene.jawBone);
    const { diffMm } = tongueTipMinusIncisor(scene, arch);
    // eslint-disable-next-line no-console
    console.log(`CW1 rest sil tip-minus-crown=${diffMm} prefix=${PREFIX_REST_SIL_DIFF_MM}`);
    expect(Math.abs(diffMm - PREFIX_REST_SIL_DIFF_MM)).toBeLessThanOrEqual(TOL_MM);
  }, 180_000);

  it("CW3 every non-teeth-target accessor is byte-identical to the pre-image", () => {
    const shippedRaw = readFileSync(AISHA_GLB);
    const preRaw = execFileSync("git", ["show", `${PRE_IMAGE_REV}:${PRE_IMAGE_PATH}`], {
      cwd: REPO_ROOT,
      maxBuffer: 1024 * 1024 * 128,
    }) as Buffer;
    const shipped = parseGlbBytes(shippedRaw, "shipped Aisha GLB");
    const pre = parseGlbBytes(preRaw, `pre-image ${PRE_IMAGE_REV}`);
    const differing = nonTeethDiffs(shipped, pre, "shipped", "pre-image");
    expect(differing, `non-teeth-target accessors differing from pre-image: ${differing}`).toEqual([]);
  }, 180_000);

  it("S1 probe: the strided comparator flags a one-byte plant and passes clean bytes", () => {
    const preRaw = execFileSync("git", ["show", `${PRE_IMAGE_REV}:${PRE_IMAGE_PATH}`], {
      cwd: REPO_ROOT,
      maxBuffer: 1024 * 1024 * 128,
    }) as Buffer;
    const pre = parseGlbBytes(preRaw, `pre-image ${PRE_IMAGE_REV}`);
    const preSkip = fittedTeethTargetAccessors(pre.document);
    const planted = pre.document.accessors.findIndex((cand, index) => {
      if (preSkip.has(index) || cand.bufferView === undefined || cand.sparse) return false;
      const size = COMPONENT_SIZE[cand.componentType];
      const comps = TYPE_COUNT[cand.type];
      if (size === undefined || comps === undefined) return false;
      return (pre.document.bufferViews[cand.bufferView]?.byteStride ?? 0) > comps * size;
    });
    expect(planted, "a strided non-teeth dense accessor exists in the pre-image").toBeGreaterThanOrEqual(0);
    const acc = pre.document.accessors[planted]!;
    const view = pre.document.bufferViews[acc.bufferView!]!;
    const stride = view.byteStride!;
    const elemOff = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    // eslint-disable-next-line no-console
    console.log(`S1 probe: planting one byte in strided accessor ${planted} (stride ${stride})`);
    const mutatedBin = Buffer.from(pre.binary);
    mutatedBin[elemOff] = (mutatedBin[elemOff]! + 1) % 256;
    const mutated: ParsedGlb = { document: pre.document, binary: mutatedBin };
    expect(nonTeethDiffs(pre, mutated, "pre-image", "mutated")).toEqual([planted]);
    expect(nonTeethDiffs(pre, pre, "pre-image", "pre-image")).toEqual([]);
  }, 180_000);
});
