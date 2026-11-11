#!/usr/bin/env tsx
/**
 * decimate_teeth.mts — ratio-locked decimation of fitted CC0 teeth (station/teeth).
 *
 * IN-PLACE INDICES method (handback h1, supersedes the NodeIO draft): edits raw
 * GLB bytes only. No NodeIO, no @gltf-transform/core Document — a NodeIO
 * round-trip on a shipped GLB strips OPENCLINXR_skin_shade and renumbers
 * accessors (lane memory nodeio-round-trip-drops-openclinxr-extensions), so it
 * is forbidden here. Pattern copied from
 * tools/openclinxr/asset-pipeline/makeclothes/glb-in-place-translate.ts
 * (GLB parse/write + self-diff after write).
 *
 * Per primitive of the single mesh whose name starts `openclinxr_fitted_teeth`:
 * reads the indices accessor + POSITION, calls `MeshoptSimplifier.simplify`
 * from meshoptimizer directly (`await MeshoptSimplifier.ready` first, per
 * tools/openclinxr/asset-pipeline/trellis/vr-postopt-ladder.ts:111), writes the
 * new indices into the SAME bufferView from its start in the original component
 * type, zero-fills the rest of the old range, sets accessors[i].count.
 * Vertices, UVs, skin attributes and morph targets are never touched.
 * (`simplifyPrimitive` from @gltf-transform/functions is intentionally NOT used:
 * it requires a gltf-transform Document, i.e. the forbidden round-trip.)
 *
 * Error search (B3): ascending ladder capped by --error; smallest error whose
 * total teeth tris land at `ratio` of before within 2%. Borders NOT locked
 * (flags []); see borderNote in the sidecar.
 *
 * Refuses (exit 2): 0 or >1 fitted-teeth meshes; input carries hm08 teeth;
 * sparse / bufferView-less indices or POSITION; shared indices bufferView or
 * accessor; teethTrisAfter > 4,871; no ladder error reaches the target.
 *
 * Usage:
 *   pnpm exec tsx <file>.mts <in.glb> <out.glb> --ratio 0.65 --error 0.05
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { basename } from "node:path";
import { MeshoptSimplifier } from "meshoptimizer";

const TEETH_PREFIX = "openclinxr_fitted_teeth";
const HM08_RE = /openclinxr_hm08_teeth/i;
const TEETH_TRIS_CAP = 4871;
const ERROR_LADDER = [0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05];

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const USHORT = 5123;
const UINT = 5125;
const FLOAT = 5126;

function fail(message: string): never {
  console.error(`decimate_teeth: refusing: ${message}`);
  process.exit(2);
}

function sha256Bytes(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

type Accessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  sparse?: unknown;
  min?: number[];
  max?: number[];
};
type Gltf = {
  accessors: Accessor[];
  bufferViews: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
  meshes: Array<{
    name?: string;
    primitives: Array<{
      indices?: number;
      attributes: Record<string, number>;
      targets?: Array<Record<string, number>>;
    }>;
  }>;
  materials?: unknown;
  extensionsUsed?: unknown;
  extensions?: unknown;
  images?: unknown;
  textures?: unknown;
  samplers?: unknown;
};

function parseGlb(raw: Buffer, label: string): { gltf: Gltf; bin: Buffer; tail: Buffer } {
  if (raw.toString("ascii", 0, 4) !== "glTF" || raw.readUInt32LE(4) !== 2) {
    throw new Error(`${label}: expected GLB v2`);
  }
  const jsonLength = raw.readUInt32LE(12);
  if (raw.readUInt32LE(16) !== JSON_CHUNK) throw new Error(`${label}: JSON chunk missing`);
  const gltf = JSON.parse(raw.subarray(20, 20 + jsonLength).toString("utf8")) as Gltf;
  const binHeader = 20 + jsonLength;
  const binLength = raw.readUInt32LE(binHeader);
  if (raw.readUInt32LE(binHeader + 4) !== BIN_CHUNK) throw new Error(`${label}: BIN chunk missing`);
  const bin = Buffer.from(raw.subarray(binHeader + 8, binHeader + 8 + binLength));
  const tail = raw.subarray(binHeader + 8 + binLength);
  return { gltf, bin, tail };
}

function readIndices(bin: Buffer, gltf: Gltf, accIndex: number): Uint32Array {
  const acc = gltf.accessors[accIndex]!;
  if (acc.sparse || acc.bufferView === undefined) fail(`indices accessor ${accIndex} is sparse or has no bufferView`);
  if (acc.type !== "SCALAR") fail(`indices accessor ${accIndex} is not SCALAR (got ${acc.type})`);
  if (acc.componentType !== USHORT && acc.componentType !== UINT) {
    fail(`indices accessor ${accIndex} componentType ${acc.componentType} (need 5123/5125)`);
  }
  const view = gltf.bufferViews[acc.bufferView]!;
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Uint32Array(acc.count);
  if (acc.componentType === USHORT) {
    for (let i = 0; i < acc.count; i++) out[i] = bin.readUInt16LE(start + i * 2);
  } else {
    for (let i = 0; i < acc.count; i++) out[i] = bin.readUInt32LE(start + i * 4);
  }
  return out;
}

function readPositions(bin: Buffer, gltf: Gltf, accIndex: number): Float32Array {
  const acc = gltf.accessors[accIndex]!;
  if (acc.sparse || acc.bufferView === undefined) fail(`POSITION accessor ${accIndex} is sparse or has no bufferView`);
  if (acc.componentType !== FLOAT || acc.type !== "VEC3") {
    fail(`POSITION accessor ${accIndex} is not float32 VEC3`);
  }
  const view = gltf.bufferViews[acc.bufferView]!;
  const stride = view.byteStride ?? 12;
  if (stride < 12) fail(`POSITION accessor ${accIndex} stride ${stride} < 12`);
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Float32Array(acc.count * 3);
  for (let v = 0; v < acc.count; v++) {
    const o = base + v * stride;
    out[v * 3] = bin.readFloatLE(o);
    out[v * 3 + 1] = bin.readFloatLE(o + 4);
    out[v * 3 + 2] = bin.readFloatLE(o + 8);
  }
  return out;
}

function parseArgs(argv: string[]): { inGlb: string; outGlb: string; ratio: number; maxError: number } {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const flagValues = new Set(["--ratio", "--error"].map((f) => argv[argv.indexOf(f) + 1]).filter((v) => argv.includes(v as string)));
  const paths = positional.filter((p) => !flagValues.has(p));
  const inGlb = paths[0];
  // --in-place: one path, rewritten in place (the derive_sidecar post-step form).
  const outGlb = argv.includes("--in-place") ? paths[0] : paths[1];
  const ratioRaw = val("--ratio") ?? "0.65";
  const errorRaw = val("--error");
  if (!inGlb || !outGlb) fail("usage: decimate_teeth.mts <in.glb> (<out.glb> | --in-place) --ratio 0.65 --error <e>");
  if (errorRaw === undefined) fail("usage: decimate_teeth.mts <in.glb> (<out.glb> | --in-place) --ratio 0.65 --error <e>");
  const ratio = Number(ratioRaw);
  const maxError = Number(errorRaw);
  if (!(ratio > 0 && ratio < 1)) fail(`--ratio must be in (0,1), got ${ratioRaw}`);
  if (!(maxError > 0)) fail(`--error must be > 0, got ${errorRaw}`);
  return { inGlb: inGlb as string, outGlb: outGlb as string, ratio, maxError };
}

async function main(): Promise<void> {
  const { inGlb, outGlb, ratio, maxError } = parseArgs(process.argv.slice(2));

  // Import/ready pattern per vr-postopt-ladder.ts:111.
  await MeshoptSimplifier.ready;

  const rawIn = readFileSync(inGlb);
  const inputSha256 = sha256Bytes(rawIn);
  const { gltf, bin } = parseGlb(rawIn, inGlb);

  const teethMeshes = gltf.meshes.filter((m) => (m.name ?? "").startsWith(TEETH_PREFIX));
  if (teethMeshes.length === 0) fail(`0 meshes start with ${TEETH_PREFIX} in ${inGlb}`);
  if (teethMeshes.length > 1) {
    fail(`>1 fitted-teeth meshes in ${inGlb}: ${teethMeshes.map((m) => m.name).join(", ")}`);
  }
  const hm08 = gltf.meshes.filter((m) => HM08_RE.test(m.name ?? ""));
  if (hm08.length > 0) fail(`input already carries hm08 teeth: ${hm08.map((m) => m.name).join(", ")}`);
  const teethMesh = teethMeshes[0]!;
  if (teethMesh.primitives.length === 0) fail(`fitted-teeth mesh ${teethMesh.name} has no primitives`);

  // Reference counts: every accessor use across all meshes (indices + attributes + targets).
  const refCount = new Map<number, number>();
  const use = (a: number): void => refCount.set(a, (refCount.get(a) ?? 0) + 1);
  for (const m of gltf.meshes) {
    for (const pr of m.primitives) {
      if (pr.indices !== undefined) use(pr.indices);
      for (const a of Object.values(pr.attributes)) use(a);
      for (const t of pr.targets ?? []) for (const a of Object.values(t)) use(a);
    }
  }
  const viewUsers = new Map<number, number>();
  for (const acc of gltf.accessors) {
    if (acc.bufferView !== undefined) viewUsers.set(acc.bufferView, (viewUsers.get(acc.bufferView) ?? 0) + 1);
  }

  type PrimWork = {
    primIndex: number;
    indicesAcc: number;
    positions: Float32Array;
    indices: Uint32Array;
    targetCount: number;
    verts: number;
  };
  const work: PrimWork[] = [];
  teethMesh.primitives.forEach((prim, primIndex) => {
    if (prim.indices === undefined) fail(`teeth prim ${primIndex} is non-indexed (unsupported)`);
    const ia = prim.indices;
    if (refCount.get(ia) !== 1) fail(`teeth indices accessor ${ia} referenced ${refCount.get(ia)}x (shared)`);
    const iacc = gltf.accessors[ia]!;
    if (iacc.bufferView === undefined || iacc.sparse) fail(`teeth indices ${ia} sparse or bufferView-less`);
    if (viewUsers.get(iacc.bufferView) !== 1) {
      fail(`teeth indices ${ia} shares bufferView ${iacc.bufferView}`);
    }
    const posAcc = prim.attributes["POSITION"];
    if (posAcc === undefined) fail(`teeth prim ${primIndex} has no POSITION`);
    const positions = readPositions(bin, gltf, posAcc);
    const indices = readIndices(bin, gltf, ia);
    const targetCount = Math.floor(ratio * (indices.length / 3)) * 3;
    if (targetCount < 3) fail(`teeth prim ${primIndex}: target ${targetCount} < 1 tri`);
    work.push({ primIndex, indicesAcc: ia, positions, indices, targetCount, verts: positions.length / 3 });
  });

  const teethTrisBefore = work.reduce((s, w) => s + w.indices.length / 3, 0);
  const vertsKept = work.reduce((s, w) => s + w.verts, 0);
  const targetTris = teethTrisBefore * ratio;
  const floorTris = targetTris * 0.98;
  const acceptTris = targetTris * 1.02;

  const ladder = [...new Set([...ERROR_LADDER.filter((e) => e <= maxError), maxError])].sort((a, b) => a - b);
  type Attempt = { error: number; simplifierError: number; results: Uint32Array[]; after: number };
  let chosen: Attempt | null = null;
  let best: Attempt | null = null;
  for (const error of ladder) {
    let worstErr = 0;
    const results: Uint32Array[] = [];
    let after = 0;
    for (const w of work) {
      const [out, err] = MeshoptSimplifier.simplify(w.indices, w.positions, 3, w.targetCount, error, []);
      worstErr = Math.max(worstErr, err);
      results.push(out);
      after += out.length / 3;
    }
    const attempt: Attempt = { error, simplifierError: worstErr, results, after };
    if (!best || after < best.after) best = attempt;
    if (after >= floorTris && after <= acceptTris && after <= TEETH_TRIS_CAP) {
      chosen = attempt;
      break;
    }
  }
  if (!chosen) {
    fail(
      `no error <= ${maxError} lands ratio ${ratio} within 2% ` +
        `(band ${floorTris.toFixed(1)}..${acceptTris.toFixed(1)} tris): ` +
        `best error=${best?.error} after=${best?.after} tris simplifierError=${best?.simplifierError}`,
    );
  }
  const teethTrisAfter = Math.round(chosen.after);
  if (teethTrisAfter > TEETH_TRIS_CAP) fail(`teethTrisAfter ${teethTrisAfter} > ${TEETH_TRIS_CAP}`);

  // Write: new indices into the SAME bufferView from its start, original component
  // type; zero-fill the rest of the old range; set count (+ min/max if present).
  const outBin = Buffer.from(bin);
  const touchedAccessors = work.map((w) => w.indicesAcc);
  const binDiffRanges: Array<[number, number]> = [];
  const jsonDiffKeys: string[] = [];
  work.forEach((w, i) => {
    const acc = gltf.accessors[w.indicesAcc]!;
    const view = gltf.bufferViews[acc.bufferView!]!;
    const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const itemSize = acc.componentType === USHORT ? 2 : 4;
    const oldBytes = acc.count * itemSize;
    const simplified = chosen.results[i]!;
    if (acc.componentType === USHORT) {
      for (const v of simplified) {
        if (v > 0xffff) fail(`simplified index ${v} overflows UNSIGNED_SHORT (prim ${w.primIndex})`);
      }
      for (let k = 0; k < simplified.length; k++) outBin.writeUInt16LE(simplified[k]!, start + k * 2);
    } else {
      for (let k = 0; k < simplified.length; k++) outBin.writeUInt32LE(simplified[k]!, start + k * 4);
    }
    outBin.fill(0, start + simplified.length * itemSize, start + oldBytes);
    binDiffRanges.push([start, start + oldBytes]);
    acc.count = simplified.length;
    jsonDiffKeys.push(`accessors[${w.indicesAcc}].count`);
    if (acc.min !== undefined || acc.max !== undefined) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of simplified) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      acc.min = [lo];
      acc.max = [hi];
      jsonDiffKeys.push(`accessors[${w.indicesAcc}].min`, `accessors[${w.indicesAcc}].max`);
    }
  });

  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(JSON_CHUNK, 4);
  const binHeaderOut = Buffer.alloc(8);
  binHeaderOut.writeUInt32LE(outBin.length, 0);
  binHeaderOut.writeUInt32LE(BIN_CHUNK, 4);
  const { tail } = parseGlb(rawIn, inGlb);
  const out = Buffer.concat([header, jsonHeader, json, binHeaderOut, outBin, tail]);
  out.writeUInt32LE(out.length, 8);
  writeFileSync(outGlb, out);
  const outputSha256 = sha256Bytes(out);

  // Self-assert (B1'e): re-read; JSON deep-equals input except touched
  // counts/min-max; BIN differs only inside touched ranges; protected keys equal.
  const inParsed = parseGlb(rawIn, inGlb).gltf;
  const reParsed = parseGlb(out, outGlb);
  const strip = (doc: Gltf): Gltf => {
    const copy = structuredClone(doc);
    for (const a of touchedAccessors) {
      copy.accessors[a]!.count = -1;
      delete copy.accessors[a]!.min;
      delete copy.accessors[a]!.max;
    }
    return copy;
  };
  if (!isDeepStrictEqual(strip(reParsed.gltf), strip(inParsed))) {
    fail("self-assert: JSON differs outside touched accessors' count/min/max");
  }
  if (reParsed.bin.length !== bin.length) fail("self-assert: BIN length changed");
  const inside = (o: number): boolean => binDiffRanges.some(([lo, hi]) => o >= lo && o < hi);
  for (let o = 0; o < reParsed.bin.length; o++) {
    if (reParsed.bin[o] !== bin[o] && !inside(o)) fail(`self-assert: BIN byte ${o} changed outside touched indices ranges`);
  }
  for (const k of ["materials", "extensionsUsed", "extensions", "images", "textures", "samplers"] as const) {
    if (!isDeepStrictEqual((reParsed.gltf as Gltf)[k], (inParsed as Gltf)[k])) {
      fail(`self-assert: ${k} changed (g4_materials.py KEYS must deep-equal)`);
    }
  }
  // g4_materials.py CLI note: it takes <candidate dir> <swap dir> (dir-pair
  // comparison), not single in/out files, so its CLI does not fit here; the
  // loop above replicates its KEYS deep-equal inline per file instead.

  const primAttrs = teethMesh.primitives.map((p) => ({
    uv: "TEXCOORD_0" in p.attributes,
    joints: "JOINTS_0" in p.attributes,
    weights: "WEIGHTS_0" in p.attributes,
    targets: (p.targets ?? []).length,
  }));
  const sidecar = {
    method: "in-place-indices",
    ratio,
    error: chosen.error,
    simplifierErrorReturned: chosen.simplifierError,
    teethTrisBefore: Math.round(teethTrisBefore),
    teethTrisAfter,
    inputSha256,
    outputSha256,
    lockBorder: false,
    borderNote:
      "borders not locked (flags []); gum/crown seam-closure check not run headlessly — deferred to orchestrator render/sidecar",
    touchedAccessors,
    jsonDiffKeys,
    binDiffRanges,
    vertexCountBefore: vertsKept,
    vertexCountAfter: vertsKept,
    uvPresent: primAttrs.every((s) => s.uv),
    jointsPresent: primAttrs.every((s) => s.joints),
    weightsPresent: primAttrs.every((s) => s.weights),
    morphTargetsBefore: primAttrs.map((s) => s.targets),
    morphTargetsAfter: primAttrs.map((s) => s.targets),
    targetTris: Math.round(targetTris * 100) / 100,
    floorTrisWithin2Pct: Math.round(floorTris * 100) / 100,
    acceptTrisWithin2Pct: Math.round(acceptTris * 100) / 100,
    teethTrisCap: TEETH_TRIS_CAP,
    ratioAchieved: Math.round((teethTrisAfter / teethTrisBefore) * 10000) / 10000,
  };
  writeFileSync(`${outGlb}.decimate.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
  process.stdout.write(
    `${basename(inGlb)}: teeth ${Math.round(teethTrisBefore)} -> ${teethTrisAfter} tris ` +
      `(ratio ${(teethTrisAfter / teethTrisBefore).toFixed(4)}, error ${chosen.error}, ` +
      `simplifierError ${chosen.simplifierError.toFixed(5)}, in-place)\n`,
  );
}

main().catch((e) => {
  console.error(`decimate_teeth: failed: ${(e as Error)?.message ?? e}`);
  process.exit(1);
});
