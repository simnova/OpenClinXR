/**
 * RED contract for tsk_27e0cec12cab410d (option B teeth/tongue swap).
 *
 * K2 pins are the staged CC0 bytes declared at
 * tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py:317-337:
 * teeth_base/teeth.png (1,799,930 B) and tongue01/tongue01_diffuse.png (625,419 B).
 * T5 is deliberately skipped with a named reason until OPENCLINXR_TEETH_SCRATCH_DIR points at
 * the owner-run scratch bakes. It is never inferred from a stale directory.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isNurseChestStageSplit,
  NURSE_CHEST_STAGE_INDICES_SHA256,
  NURSE_CHEST_STAGE_KEPT_INDICES_SHA256,
} from "@openclinxr/asset-registry/nurse-chest-stage";
import type {
  ByteLineageLevel,
  NeckChainSidecar,
  TeethSwapBlock,
} from "@openclinxr/factory-station-core/runner";
import {
  lineageLevels,
  P2E_CHAIN_SCRIPT,
  repoRoot,
  validateT3LineageChain,
} from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";

process.chdir(repoRoot());

const DIR = "apps/ui-xr/public/generated-humanoids";
/**
 * kevin-colour pre-probe parent (2026-11-18): HEAD is the kevin-colour probe
 * commit (depth-3 colour sidecar + GLB), so the previous depth-2 blobs beside
 * their matching GLB live at this pinned parent, never at HEAD. A named
 * constant (not HEAD or HEAD^) so the next card that moves the pin cannot
 * silently re-point this regression.
 */
const KEVIN_PRE_COLOUR_PARENT = "5259f80f3";
const EXPECTED_IMAGE_SHA = {
  teeth: "d0afb57869c6fbb56b98f5efc4aec629ee7593e70d8dd2bfb9de923acfb65f43",
  tongue: "3150be398e48e8ba1feac164c3143c16c0b2e959d9ffb6155f0171f59cfb4ea9",
} as const;
const FEATURES = ["teeth", "tongue"] as const;
const SCRATCH = process.env["OPENCLINXR_TEETH_SCRATCH_DIR"];
const BAKE_NATIVE_KNOWN_GOOD = "mpfb-peds-parent-aisha.glb";
/**
 * Swapped later than the other 10 (super-ceo-cap8 ruling, 2026-11-10): its scratch bake missed the
 * body gate on the mouth row only (compare_body_v2 mouth p99 5.304 mm > 5.13 mm, whole 3.837 mm;
 * chin verts). tsk_2a74bbdb3f03cb3e swapped it, gated on the seat measure in
 * the-physician-teeth-seat-in-its-mouth.test.ts instead of body similarity.
 */
const LATE_SWAP = "mpfb-clinical-physician-adult.glb";
const LATE_SWAP_CARD = "tsk_2a74bbdb3f03cb3e";

type Accessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  sparse?: SparseAccessor;
};
type SparseRef = { bufferView: number; byteOffset?: number; componentType?: number };
type SparseAccessor = { count: number; indices: SparseRef & { componentType: number }; values: SparseRef };
type Primitive = {
  indices?: number;
  attributes?: Record<string, number>;
  targets?: Array<Record<string, number>>;
  material?: number;
};
type Mesh = { name?: string; primitives?: Primitive[] };
type Document = {
  accessors: Accessor[];
  bufferViews: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
  meshes: Mesh[];
  nodes: Array<{ name?: string; mesh?: number; skin?: number }>;
  skins: Array<{ joints: number[] }>;
  materials?: Array<Record<string, unknown>>;
  textures?: Array<{ source?: number; extensions?: { KHR_texture_basisu?: { source?: number } } }>;
  images?: Array<{ bufferView?: number; uri?: string }>;
};
type Glb = { document: Document; binary: Buffer; raw: Buffer };

const component = {
  5120: { bytes: 1, read: (b: Buffer, o: number) => b.readInt8(o) },
  5121: { bytes: 1, read: (b: Buffer, o: number) => b.readUInt8(o) },
  5122: { bytes: 2, read: (b: Buffer, o: number) => b.readInt16LE(o) },
  5123: { bytes: 2, read: (b: Buffer, o: number) => b.readUInt16LE(o) },
  5125: { bytes: 4, read: (b: Buffer, o: number) => b.readUInt32LE(o) },
  5126: { bytes: 4, read: (b: Buffer, o: number) => b.readFloatLE(o) },
} as const;
const widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseGlb(path: string): Glb {
  return parseGlbBytes(readFileSync(path), path);
}

function parseGlbBytes(raw: Buffer, label = "<bytes>"): Glb {
  if (raw.toString("ascii", 0, 4) !== "glTF" || raw.readUInt32LE(4) !== 2) {
    throw new Error(`expected GLB v2`);
  }
  const jsonLength = raw.readUInt32LE(12);
  if (raw.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${label}: JSON chunk missing`);
  const document = JSON.parse(raw.subarray(20, 20 + jsonLength).toString("utf8")) as Document;
  const binHeader = 20 + jsonLength;
  const binLength = raw.readUInt32LE(binHeader);
  if (raw.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error(`${label}: BIN chunk missing`);
  return { document, binary: raw.subarray(binHeader + 8, binHeader + 8 + binLength), raw };
}

function accessorBytes(glb: Glb, index: number): Buffer {
  const accessor = glb.document.accessors[index];
  if (!accessor || accessor.bufferView === undefined || accessor.sparse) {
    throw new Error(`accessor ${index}: dense bufferView required`);
  }
  return denseBytes(glb, index);
}

/** Dense base bytes of a bufferView-backed accessor (also the base of a sparse one). */
function denseBytes(glb: Glb, index: number): Buffer {
  const accessor = glb.document.accessors[index]!;
  if (accessor.bufferView === undefined) throw new Error(`accessor ${index}: no bufferView`);
  const layout = component[accessor.componentType as keyof typeof component];
  const width = widths[accessor.type];
  if (!layout || !width) throw new Error(`accessor ${index}: unsupported layout`);
  const view = glb.document.bufferViews[accessor.bufferView];
  if (!view) throw new Error(`accessor ${index}: missing bufferView`);
  const itemBytes = layout.bytes * width;
  const stride = view.byteStride ?? itemBytes;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const rows: Buffer[] = [];
  for (let row = 0; row < accessor.count; row += 1) {
    rows.push(glb.binary.subarray(start + row * stride, start + row * stride + itemBytes));
  }
  return Buffer.concat(rows);
}

function accessorValues(glb: Glb, index: number): number[][] {
  const accessor = glb.document.accessors[index]!;
  const layout = component[accessor.componentType as keyof typeof component]!;
  const width = widths[accessor.type]!;
  const bytes = accessorBytes(glb, index);
  const maximum = accessor.normalized ? ({ 5121: 255, 5123: 65_535 } as Record<number, number>)[accessor.componentType] : undefined;
  return Array.from({ length: accessor.count }, (_unusedRow, row) =>
    Array.from({ length: width }, (_unusedColumn, column) => {
      const value = layout.read(bytes, (row * width + column) * layout.bytes);
      return maximum ? value / maximum : value;
    }),
  );
}

function sliceRef(glb: Glb, ref: SparseRef, length: number): Buffer {
  const view = glb.document.bufferViews[ref.bufferView]!;
  const start = (view.byteOffset ?? 0) + (ref.byteOffset ?? 0);
  if (start + length > (view.byteOffset ?? 0) + view.byteLength) throw new Error("sparse range exceeds bufferView");
  return glb.binary.subarray(start, start + length);
}

/** Same payload swap_teeth.py `_accessor_payload` hashes: dense, sparse, or all-zero (glTF 2.0 3.6.2.3). */
function accessorPayload(glb: Glb, index: number): Buffer {
  const accessor = glb.document.accessors[index]!;
  const sparse = accessor.sparse;
  if (sparse) {
    const indexBytes = component[sparse.indices.componentType as keyof typeof component]!.bytes;
    const elementBytes = component[accessor.componentType as keyof typeof component]!.bytes * widths[accessor.type]!;
    const base = accessor.bufferView === undefined ? Buffer.alloc(0) : denseBytes(glb, index);
    return Buffer.concat([
      Buffer.from("SPARSE\0", "latin1"),
      base,
      Buffer.from([0]),
      sliceRef(glb, sparse.indices, sparse.count * indexBytes),
      Buffer.from([0]),
      sliceRef(glb, sparse.values, sparse.count * elementBytes),
    ]);
  }
  if (accessor.bufferView === undefined) return Buffer.from("ZERO\0", "latin1");
  return accessorBytes(glb, index);
}

function accessorHash(glb: Glb, index: number): string {
  const { bufferView: _view, byteOffset: _offset, sparse: _sparse, ...descriptor } = glb.document.accessors[index]!;
  delete (descriptor as Record<string, unknown>)["min"];
  delete (descriptor as Record<string, unknown>)["max"];
  const ordered = Object.fromEntries(Object.entries(descriptor).sort(([a], [b]) => a.localeCompare(b)));
  const payload = accessorPayload(glb, index);
  return sha256(Buffer.concat([Buffer.from(JSON.stringify(ordered)), Buffer.from([0]), payload]));
}

function feature(glb: Glb, name: string, fitted: boolean): { meshIndex: number; mesh: Mesh; skin: number } {
  const token = fitted ? `openclinxr_fitted_${name}` : `openclinxr_hm08_${name}`;
  const matches = glb.document.meshes.flatMap((mesh, meshIndex) =>
    String(mesh.name ?? "").toLowerCase().includes(token) ? [{ meshIndex, mesh }] : [],
  );
  if (matches.length !== 1) throw new Error(`expected exactly one ${token} mesh, found ${matches.length}`);
  const nodes = glb.document.nodes.filter((node) => node.mesh === matches[0]!.meshIndex);
  if (nodes.length !== 1 || nodes[0]!.skin === undefined) throw new Error(`${token}: exactly one skinned node required`);
  return { ...matches[0]!, skin: nodes[0]!.skin! };
}

function primitiveAccessorRows(mesh: Mesh): Array<{ slot: string; accessorIndex: number }> {
  const rows: Array<{ slot: string; accessorIndex: number }> = [];
  for (const [primitiveIndex, primitive] of (mesh.primitives ?? []).entries()) {
    if (primitive.indices !== undefined) rows.push({ slot: `primitive[${primitiveIndex}].indices`, accessorIndex: primitive.indices });
    for (const [semantic, accessorIndex] of Object.entries(primitive.attributes ?? {}).sort()) {
      rows.push({ slot: `primitive[${primitiveIndex}].attributes.${semantic}`, accessorIndex });
    }
    for (const [targetIndex, target] of (primitive.targets ?? []).entries()) {
      for (const [semantic, accessorIndex] of Object.entries(target).sort()) {
        rows.push({ slot: `primitive[${primitiveIndex}].targets[${targetIndex}].${semantic}`, accessorIndex });
      }
    }
  }
  return rows;
}

function imageSha(glb: Glb, mesh: Mesh): string[] {
  const result: string[] = [];
  for (const primitive of mesh.primitives ?? []) {
    const material = primitive.material === undefined ? undefined : glb.document.materials?.[primitive.material];
    const pbr = material?.["pbrMetallicRoughness"] as { baseColorTexture?: { index?: number } } | undefined;
    const textureIndex = pbr?.baseColorTexture?.index;
    if (textureIndex === undefined) continue;
    const texture = glb.document.textures?.[textureIndex];
    const imageIndex = texture?.extensions?.KHR_texture_basisu?.source ?? texture?.source;
    const image = imageIndex === undefined ? undefined : glb.document.images?.[imageIndex];
    if (!image || image.bufferView === undefined || image.uri) throw new Error(`${mesh.name}: embedded baseColorTexture required`);
    const view = glb.document.bufferViews[image.bufferView]!;
    const start = view.byteOffset ?? 0;
    result.push(sha256(glb.binary.subarray(start, start + view.byteLength)));
  }
  return [...new Set(result)];
}

function weightSplit(glb: Glb, item: ReturnType<typeof feature>): { jawLower: number; head: number; tongue: number; jaw: number } {
  const names = glb.document.skins[item.skin]!.joints.map((node) => glb.document.nodes[node]?.name ?? "");
  const all = { jaw: 0, head: 0, tongue: 0, total: 0 };
  let jawLower = 0;
  let lowerTotal = 0;
  for (const primitive of item.mesh.primitives ?? []) {
    const attributes = primitive.attributes ?? {};
    const positions = accessorValues(glb, attributes["POSITION"]!);
    const joints = accessorValues(glb, attributes["JOINTS_0"]!);
    const weights = accessorValues(glb, attributes["WEIGHTS_0"]!);
    // glTF is Y-up. This is the same split used by rebind-head-locked-teeth.ts.
    const ys = positions.map((row) => row[1]!).sort((a, b) => a - b);
    const median = ys[Math.floor(ys.length / 2)]!;
    for (let row = 0; row < positions.length; row += 1) {
      for (let column = 0; column < joints[row]!.length; column += 1) {
        const weight = weights[row]![column]!;
        const name = names[joints[row]![column]!]!.toLowerCase();
        all.total += weight;
        if (name.includes("jaw")) all.jaw += weight;
        if (name.includes("head")) all.head += weight;
        if (name.includes("tongue")) all.tongue += weight;
        if (positions[row]![1]! <= median) {
          lowerTotal += weight;
          if (name.includes("jaw")) jawLower += weight;
        }
      }
    }
  }
  return {
    jawLower: jawLower / (lowerTotal || 1),
    jaw: all.jaw / (all.total || 1),
    head: all.head / (all.total || 1),
    tongue: all.tongue / (all.total || 1),
  };
}

function actorFiles(): string[] {
  return readdirSync(DIR).filter((name) => /^mpfb-.*\.glb$/.test(name)).sort();
}

function validateT1T2(glb: Glb): Record<(typeof FEATURES)[number], ReturnType<typeof weightSplit>> {
  const splits = {} as Record<(typeof FEATURES)[number], ReturnType<typeof weightSplit>>;
  const t1Problems: string[] = [];
  const t2Problems: string[] = [];
  for (const name of FEATURES) {
    const hm08 = glb.document.meshes.filter((mesh) =>
      String(mesh.name ?? "").includes(`openclinxr_hm08_${name}`),
    );
    if (hm08.length !== 0) t1Problems.push(`T1 ${name}: ${hm08.length} hm08 mesh remains`);
    const mouth = feature(glb, name, hm08.length === 0);
    if (hm08.length === 0) {
      const shas = imageSha(glb, mouth.mesh);
      if (shas.length !== 1 || shas[0] !== EXPECTED_IMAGE_SHA[name]) {
        t1Problems.push(`T1 ${name}: baseColorTexture sha ${shas.join(",") || "missing"}`);
      }
    }
    // T2 is measured for every actor, including legacy actors whose T1 failure remains the
    // reported primary reason. Their sole hm08 mesh supplies the measurable pre-swap weights.
    const split = weightSplit(glb, mouth);
    splits[name] = split;
    if (name === "teeth" && split.jawLower <= 0.3) {
      t2Problems.push(`T2 teeth: lower-half jaw fraction ${split.jawLower.toFixed(6)} <= 0.3`);
    }
    if (name === "tongue" && split.head >= 0.999999) {
      t2Problems.push(`T2 tongue: 100% head (${split.head.toFixed(6)})`);
    }
    if (name === "tongue" && split.jaw + split.tongue <= 0) {
      t2Problems.push("T2 tongue: no tongue/jaw weight");
    }
  }
  const firstProblem = [...t1Problems, ...t2Problems][0];
  if (firstProblem) throw new Error(firstProblem);
  return splits;
}

/** Teeth-swap lineage types + walk live in @openclinxr/factory-station-core/runner
 * (teeth-swap-lineage.ts, kevin-collar s10h4 B2) so trellis-evidence shares the
 * SAME continuity rule without importing from this .test.ts file. */

const NURSE_ACTOR = "mpfb-clinical-nurse-adult.glb";
const NURSE_BODY_MESH = 4;
const NURSE_BODY_PRIM0_SLOT = "primitive[0].indices";

/** The F1 chain pre-image pins live in teeth-swap-lineage.ts (imported above). */

/** Pre-E9 nurse bytes (recorded pre-image descriptor): the rehide split's union baseline.
 * P2e-C (cap31, 2026-11-16) added newer levels on top (r2 F1: the single-run
 * inpaint+un-hide chain with a c1da76fb4 revision pre-image), so the baseline
 * comes from the E9 rehide level by content (rehide-poking-skin.py in argv),
 * never from the top level. */
const nurseBaselineCache = new Map<string, Glb>();
function e9Level(sidecar: Record<string, unknown>): ByteLineageLevel {
  const found = lineageLevels(sidecar).find((level) =>
    (level.derivationArgv ?? []).join(" ").includes("rehide-poking-skin.py"),
  );
  if (!found) throw new Error("T3 E9 chest: sidecar byteLineage carries no E9 rehide level");
  return found;
}
function nurseBaselineGlb(sidecar: Record<string, unknown>): Glb {
  const rev = e9Level(sidecar).preImageRevision;
  if (typeof rev !== "string" || rev.length === 0) {
    throw new Error("T3 E9 chest: sidecar byteLineage carries no preImageRevision descriptor");
  }
  if (!/^[0-9a-f]{40}:/.test(rev)) {
    throw new Error(
      `T3 E9 chest: baseline locator must be a pinned commit descriptor, got ${rev}`,
    );
  }
  const cached = nurseBaselineCache.get(rev);
  if (cached) return cached;
  const raw = execFileSync("git", ["show", rev], {
    cwd: repoRoot(),
    maxBuffer: 64 * 1024 * 1024,
  });
  const baseline = parseGlbBytes(raw, rev);
  nurseBaselineCache.set(rev, baseline);
  return baseline;
}

/**
 * E9 chest-stage row exception (e9-r2b T2; coordinator precedent R3 accepted). The nurse
 * body prim0.indices row passes iff the live prim0 indices bytes sha is the exact-sha
 * E9 kept-skin-prim pin AND the one shared predicate (isNurseChestStageSplit, imported
 * from the E9 pin file, never hand-typed) accepts the kept/hidden pair: both indices
 * shas in the pin, sorted index union equals the pre-E9 prim, both prims share the
 * baseline prim's attribute/morph accessors with the kept prim keeping the baseline
 * material and the hidden prim carrying the hide material, and the sidecar
 * byteLineage chain carries an E9 rehide level newer than the teeth-swap level.
 * Every other protected row is strict.
 */
function rawPrimAttrSig(owner: Glb, prim: Primitive): string {
  const entries = Object.entries(prim.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return sha256(
    JSON.stringify(entries.map(([semantic, accessorIndex]) => [semantic, accessorHash(owner, accessorIndex)])),
  );
}
function rawPrimTargetHash(owner: Glb, prim: Primitive): string {
  const targets = prim.targets ?? [];
  return sha256(
    JSON.stringify(
      targets.map((target) =>
        Object.entries(target)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([semantic, accessorIndex]) => [semantic, accessorHash(owner, accessorIndex)]),
      ),
    ),
  );
}
function rawPrimMaterial(owner: Glb, prim: Primitive): string {
  if (prim.material === undefined) return "";
  const material = owner.document.materials?.[prim.material] as { name?: string } | undefined;
  return material?.name ?? `mat:${prim.material}`;
}
function nurseChestWitness(
  glb: Glb,
  baseline: Glb,
  sidecar: Record<string, unknown>,
  rowAccessorIndex: number,
): {
  keptIndicesSha256: string;
  hiddenIndicesSha256: string;
  keptSortedIndices: number[];
  hiddenSortedIndices: number[];
  baselineSortedIndices: number[];
  keptAttrAccessors: Record<string, number>;
  hiddenAttrAccessors: Record<string, number>;
  baselineAttrAccessors: Record<string, number>;
  keptTargetAccessors: Array<Record<string, number>>;
  hiddenTargetAccessors: Array<Record<string, number>>;
  baselineTargetAccessors: Array<Record<string, number>>;
  keptMaterialIndex: number;
  hiddenMaterialIndex: number;
  baselineMaterialIndex: number;
  keptMaterial: string;
  hiddenMaterial: string;
  baselineMaterial: string;
  derivationArgvs: (string[] | undefined)[];
} {
  const mesh = glb.document.meshes[NURSE_BODY_MESH];
  const prims = mesh?.primitives ?? [];
  const basePrims = baseline.document.meshes[NURSE_BODY_MESH]?.primitives ?? [];
  // E9 adds one hidden prim (baseline +1). P2e-C appends one more skin prim
  // (the 6-tri un-hide; F1 single-run chain: newest level runs
  // nurse-vneck-chain.py, which stages the same un-hide from its temp
  // inpaint output), so live is baseline +2 with the E9 hidden prim
  // second-to-last. A +2 live body without the un-hide record on top refuses
  // (not an E9-shaped live).
  const extra = prims.length - basePrims.length;
  const newestArgv = (lineageLevels(sidecar)[0]?.derivationArgv ?? []).join(" ");
  const p2eAppend =
    extra === 2 &&
    (newestArgv.includes("nurse-vneck-6tri-unhide.py") || newestArgv.includes(P2E_CHAIN_SCRIPT));
  if (extra !== 1 && !p2eAppend) {
    throw new Error(
      `T3 E9 chest: live body prims ${prims.length} != baseline ${basePrims.length} + 1` +
        (extra === 2 ? " (and the newest level is not the 6-tri un-hide)" : ""),
    );
  }
  const kept = prims[0]!;
  const hidden = p2eAppend ? prims[prims.length - 2]! : prims[prims.length - 1]!;
  if (kept.indices !== rowAccessorIndex || hidden.indices === undefined || kept.indices === undefined) {
    throw new Error(
      `T3 E9 chest: live prim0 indices accessor ${kept.indices} != row accessor ${rowAccessorIndex}`,
    );
  }
  const sortedOf = (owner: Glb, index: number): number[] =>
    accessorValues(owner, index)
      .map((values) => values[0]!)
      .sort((a, b) => a - b);
  const basePrim = basePrims[0]!;
  if (basePrim.indices === undefined) throw new Error("T3 E9 chest: baseline prim0 has no indices");
  const matName = (owner: Glb, index: number | undefined): string => {
    if (index === undefined) return "";
    const material = owner.document.materials?.[index] as Record<string, unknown> | undefined;
    return typeof material?.["name"] === "string" ? (material["name"] as string) : `mat:${index}`;
  };
  return {
    keptIndicesSha256: sha256(accessorBytes(glb, kept.indices)),
    hiddenIndicesSha256: sha256(accessorBytes(glb, hidden.indices)),
    keptSortedIndices: sortedOf(glb, kept.indices),
    hiddenSortedIndices: sortedOf(glb, hidden.indices),
    baselineSortedIndices: sortedOf(baseline, basePrim.indices),
    keptAttrAccessors: { ...(kept.attributes ?? {}) },
    hiddenAttrAccessors: { ...(hidden.attributes ?? {}) },
    baselineAttrAccessors: { ...(basePrim.attributes ?? {}) },
    keptTargetAccessors: (kept.targets ?? []).map((target) => ({ ...target })),
    hiddenTargetAccessors: (hidden.targets ?? []).map((target) => ({ ...target })),
    baselineTargetAccessors: (basePrim.targets ?? []).map((target) => ({ ...target })),
    keptMaterialIndex: kept.material ?? -1,
    hiddenMaterialIndex: hidden.material ?? -1,
    baselineMaterialIndex: basePrim.material ?? -1,
    keptMaterial: matName(glb, kept.material),
    hiddenMaterial: matName(glb, hidden.material),
    baselineMaterial: matName(baseline, basePrim.material),
    derivationArgvs: lineageLevels(sidecar).map((level) => level.derivationArgv),
  };
}

function nurseChestRowOrThrow(
  actor: string,
  glb: Glb,
  baseline: Glb,
  sidecar: Record<string, unknown>,
  rowAccessorIndex: number,
): void {
  // M1: the ONE shared predicate owns the kept-role pin — no caller-local copy.
  const witness = nurseChestWitness(glb, baseline, sidecar, rowAccessorIndex);
  if (!isNurseChestStageSplit(witness)) {
    const chain = lineageLevels(sidecar)
      .map((level) => (level.derivationArgv ?? []).join(" "))
      .join(" <- ");
    throw new Error(
      `T3 E9 chest ${actor}: shared E9 split rejected ` +
        `(kept ${witness.keptIndicesSha256.slice(0, 12)} ` +
        `hidden ${witness.hiddenIndicesSha256.slice(0, 12)} chain ${chain.slice(0, 160)})`,
    );
  }
}

/**
 * Combined swap+post level (kevin-colour h2 F3, hardened h3): the swap level
 * carries the ordering ONLY when derivationArgv names the EXACT swap tool
 * invocation AND the EXACT tongue-forward tool invocation. Live token shape
 * (read from the shipped sidecar): the combined level's derivationArgv is
 * ["sh", "-c", "<one shell script>", "x", ...] — both tool paths sit
 * singly-quoted INSIDE that single sh -c token, not as separate argv
 * tokens, so bare `some(a => a === TOOL)` would RED the live shape.
 * Exactness is therefore word-token equality: each argv token is split on
 * whitespace/quotes and the full tool path must appear as a whole word.
 * A forged token that prefixes/suffixes the path (FORGED-<path>-FORGED)
 * stays one word and never equals the tool, so basename/substring markers
 * and free-form why text never suffice.
 *
 * These helpers stay in this test (FU8 owns this surface): the shared
 * validateT3LineageChain takes isCombinedSwapPostLevel as a parameter.
 */
const SWAP_TOOL_INVOCATION = "tools/openclinxr/asset-pipeline/makeclothes/teeth-swap/swap_teeth.py";
const TONGUE_TOOL_INVOCATION = "tools/openclinxr/asset-pipeline/makeclothes/tongue-forward-place.ts";
const argvWords = (level: ByteLineageLevel): string[] =>
  (level.derivationArgv ?? []).flatMap((a) => a.split(/[\s'"]+/).filter((w) => w.length > 0));
const argvHasExactTool = (level: ByteLineageLevel, tool: string): boolean =>
  argvWords(level).some((w) => w === tool);
const isCombinedSwapPostLevel = (level: ByteLineageLevel): boolean =>
  argvHasExactTool(level, SWAP_TOOL_INVOCATION) && argvHasExactTool(level, TONGUE_TOOL_INVOCATION);

function sidecarFor(actor: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(DIR, actor.replace(/\.glb$/, ".provenance.json")), "utf8")) as Record<
    string,
    unknown
  >;
}

function validateT3(actor: string, glb: Glb, sidecar: Record<string, unknown>, liveOverride?: string): void {
  const block = (sidecar as NeckChainSidecar)["teethSwapB1"];
  if (!block) {
    if (actor !== BAKE_NATIVE_KNOWN_GOOD) {
      throw new Error("T3 neither teethSwapB1 lineage nor the bake-native fitted pair is present");
    }
    return;
  }
  const live = liveOverride ?? sha256(glb.raw);
  // FU8 MAPS-TOIGO peel (actor-free, single): a top post-export maps level is
  // peeled when it names the exact stage tool, the sidecar top pin matches the
  // live GLB, and its pre-image matches the recorded pin it supersedes. The
  // existing branches below then run unchanged on recordedBefore as the
  // sidecar with live' = preImageSha256. A top maps level that fails (ii) or
  // (iii) throws here and never falls through to the old branches. At most one
  // peel: a stacked (nested) maps level throws instead of peeling again.
  const MAPS_TOOL_INVOCATION =
    "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py";
  const chainLevels = lineageLevels(sidecar);
  const topLevel = chainLevels[0];
  if (topLevel !== undefined && argvHasExactTool(topLevel, MAPS_TOOL_INVOCATION)) {
    const recorded = topLevel.recordedBefore;
    if ((sidecar as NeckChainSidecar).outputSha256 !== live) {
      throw new Error(
        `T3 maps peel ${actor}: top level names the maps stage but sidecar top ${(sidecar as NeckChainSidecar).outputSha256} != live ${live}`,
      );
    }
    const livePrime = topLevel.preImageSha256;
    if (
      recorded === undefined ||
      typeof recorded.outputSha256 !== "string" ||
      typeof livePrime !== "string" ||
      livePrime !== recorded.outputSha256
    ) {
      throw new Error(
        `T3 maps peel ${actor}: top level preImageSha256 ${topLevel.preImageSha256} != recordedBefore.outputSha256 ${recorded?.outputSha256}`,
      );
    }
    if (chainLevels.length > 1 && argvHasExactTool(chainLevels[1]!, MAPS_TOOL_INVOCATION)) {
      throw new Error(`T3 maps peel ${actor}: stacked maps levels — peel at most once`);
    }
    const inner = lineageLevels(recorded as unknown as Record<string, unknown>);
    if (inner.length === 0) {
      throw new Error(
        `T3 maps peel ${actor}: recordedBefore carries no nested byteLineage to peel onto`,
      );
    }
    const peeled = {
      ...(sidecar as Record<string, unknown>),
      outputSha256: recorded.outputSha256,
      outputBytes: recorded.outputBytes,
      byteLineage: recorded.byteLineage,
    };
    validateT3(actor, glb, peeled, livePrime);
    return;
  }
  if (block.output?.sha256 !== live) {
    // R2 neck-stage chain (physician only; owning gate: the collar test): the swap
    // output pins the pre-neck bytes in byteLineage.recordedBefore, and the sidecar
    // top level pins the live GLB. teethSwapB1.output itself is never rewritten.
    const chain = sidecar as NeckChainSidecar;
    const legacyNeck =
      actor === LATE_SWAP &&
      block.output?.sha256 === chain.byteLineage?.recordedBefore?.outputSha256 &&
      chain.outputSha256 === live;
    // R2 lineage chain (nurse e9-r1 rehide): the swap output pins the junction in the
    // walked byteLineage chain (teeth-swap record, nested #741 record, per-level continuity).
    if (!legacyNeck) {
      validateT3LineageChain(actor, live, sidecar, block, isCombinedSwapPostLevel);
    }
  } else if (lineageLevels(sidecar).length > 0) {
    // M3: no skip when the swap output is rewritten to live — any sidecar
    // carrying a chain still validates (top pin, junction, continuity). The
    // only bypass is the one proven legacy shape below (robert-hayes
    // blender-bake genesis); the kevin combined single-level derivation now
    // validates directly through the combined rule above, so its former
    // depth-pinned bypass retired with the depth-3 sidecar. The neck-stage
    // allowance above already covers the physician non-live path. The bypass
    // is actor- plus shape-pinned and self-retires if its sidecar ever gains
    // a validatable chain shape.
    const levels = lineageLevels(sidecar);
    const oldest = levels[levels.length - 1]!;
    const isRobertHayesGenesis =
      actor === "mpfb-gown-ed-robert-hayes.glb" &&
      levels.length === 2 &&
      (oldest.derivationArgv ?? []).join(" ").includes("bake_mpfb_gown_inspect.py") &&
      oldest.recordedBefore === undefined &&
      // sidecar apps/ui-xr/public/generated-humanoids/mpfb-gown-ed-robert-hayes.provenance.json
      // JSON path byteLineage.recordedBefore.byteLineage.inputSha256 (genesis level has no recordedBefore)
      oldest.inputSha256 ===
        "27cbf4e5ed5a007ad497a3bafe2763ac72746583374ad1718d51573ba649aa66";
    if (!isRobertHayesGenesis) validateT3LineageChain(actor, live, sidecar, block, isCombinedSwapPostLevel);
  }
  for (const row of block.protectedAccessorHashes ?? []) {
    const actual = accessorHash(glb, row.accessorIndex);
    if (actual === row.sha256) continue;
    if (
      actor === NURSE_ACTOR &&
      row.meshIndex === NURSE_BODY_MESH &&
      row.slot === NURSE_BODY_PRIM0_SLOT
    ) {
      nurseChestRowOrThrow(actor, glb, nurseBaselineGlb(sidecar), sidecar, row.accessorIndex);
      continue;
    }
    throw new Error(`T3 protected ${row.meshIndex}:${row.slot} ${actual} != ${row.sha256}`);
  }
  if ((block.protectedAccessorHashes?.length ?? 0) === 0) {
    throw new Error("T3 protected accessor list is empty");
  }
}

describe("the shipped teeth carry their own CC0 texture", () => {
  it("T1-T3: all 12 actors carry a fitted textured pair, valid weights, and swap or bake-native lineage", () => {
    const problems: string[] = [];
    let knownGood = "KNOWN_GOOD not measured";
    const actors = actorFiles();
    expect(actors, "K3: this contract is pinned to the 12 shipped MPFB actors").toHaveLength(12);
    for (const actor of actors) {
      try {
        const glb = parseGlb(join(DIR, actor));
        const splits = validateT1T2(glb);
        if (actor === BAKE_NATIVE_KNOWN_GOOD) {
          knownGood = `KNOWN_GOOD ${actor} T1/T2 PASS split=${JSON.stringify(splits)}`;
        }
        validateT3(actor, glb, sidecarFor(actor));
      } catch (error) {
        problems.push(`${actor}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(
      problems,
      `${knownGood}\nteeth/tongue swap failures (${problems.length}/12):\n${problems.join("\n")}`,
    ).toEqual([]);
  }, 1_800_000);

  it(`former inverted guard: ${LATE_SWAP} carries the fitted teeth/tongue and no hm08 pair since ${LATE_SWAP_CARD}`, () => {
    const names = parseGlb(join(DIR, LATE_SWAP)).document.meshes.map((mesh) => mesh.name ?? "");
    const count = (token: string) => names.filter((name) => name.includes(token)).length;
    expect(
      {
        hm08Teeth: count("openclinxr_hm08_teeth"),
        hm08Tongue: count("openclinxr_hm08_tongue"),
        fittedTeeth: count("openclinxr_fitted_teeth"),
        fittedTongue: count("openclinxr_fitted_tongue"),
      },
      `${LATE_SWAP} lost its fitted pair or regained the hm08 slab: restore it from ${LATE_SWAP_CARD}'s ` +
        "swap chain (sidecar teethSwapB1.postSteps); do not delete or widen this check",
    ).toEqual({ hm08Teeth: 0, hm08Tongue: 0, fittedTeeth: 1, fittedTongue: 1 });
  });

  it("known-good: the current peds-parent bake passes T1/T2 without teethSwapB1", () => {
    const glb = parseGlb(join(DIR, BAKE_NATIVE_KNOWN_GOOD));
    const sidecar = sidecarFor(BAKE_NATIVE_KNOWN_GOOD);
    const splits = validateT1T2(glb);
    expect(sidecar["teethSwapB1"]).toBeUndefined();
    console.info(`KNOWN_GOOD ${BAKE_NATIVE_KNOWN_GOOD} split=${JSON.stringify(splits)}`);
  });

  /**
   * T3 chain-walk (e9-r2lineage). The nurse sidecar top pin moved past teethSwapB1.output via
   * the e9 rehide, a byte-identical chained correction: the chain must nest the teeth-swap
   * record with the #741 record older still, every level continuous
   * (preImageSha256 === recordedBefore.outputSha256), and the post-swap level's pre-image
   * must equal teethSwapB1.output at the junction. RED shapes are built in memory
   * from the tracked nurse sidecar (no gitignored fixture read): a collapsed chain
   * without the nested byteLineage, a broken preImageSha256 continuity, a wrong swap
   * junction, and #741 moved newer than the swap.
   */
  it("T3 chain-walk: the nurse byteLineage nests the teeth-swap record and #741 with junction continuity", () => {
    const actor = "mpfb-clinical-nurse-adult.glb";
    const live = sha256(parseGlb(join(DIR, actor)).raw);
    const nurse = sidecarFor(actor);
    const block = (nurse as NeckChainSidecar)["teethSwapB1"]!;
    expect(block?.output?.sha256).toBeDefined();
    validateT3LineageChain(actor, live, nurse, block, isCombinedSwapPostLevel);
    const levels = lineageLevels(nurse);
    const swapAt = levels.findIndex((level) =>
      (level.derivationArgv ?? []).join(" ").includes("swap_teeth.py"),
    );
    const fixAt = levels.findIndex(
      (level) =>
        (level.why ?? "").includes("fix(#741)") ||
        (level.derivationArgv ?? []).join(" ").includes("tongue-forward-place.ts"),
    );
    console.info(`T3 chain-walk ${actor}: depth=${levels.length} swap=${swapAt} fix741=${fixAt} live=${live.slice(0, 12)}`);
    // Collapsed shape: the e9-install top level without its nested byteLineage
    // (recordedBefore kept, byteLineage dropped) — built in memory so a clean
    // checkout exercises the negative without a gitignored fixture.
    const collapsed = JSON.parse(JSON.stringify(nurse)) as Record<string, unknown>;
    const collapsedTop = (collapsed as NeckChainSidecar).byteLineage!;
    expect(collapsedTop, "setup: tracked sidecar carries a chained byteLineage").toBeDefined();
    if (collapsedTop.recordedBefore !== undefined) {
      delete (collapsedTop.recordedBefore as Record<string, unknown>)["byteLineage"];
    }
    expect(collapsed["outputSha256"]).toBe(live);
    const collapsedBlock = (collapsed as NeckChainSidecar)["teethSwapB1"]!;
    expect(() => validateT3LineageChain(actor, live, collapsed, collapsedBlock, isCombinedSwapPostLevel)).toThrow(
      /no teeth-swap derivation record/,
    );
    // Plant 1: broken preImageSha256 continuity at the newest level. The
    // newest level is the F1 chain level, so the chain branch refuses first
    // with the tracked-pre-image message (not the generic junction text).
    const brokenContinuity = JSON.parse(JSON.stringify(nurse)) as Record<string, unknown>;
    (brokenContinuity as NeckChainSidecar).byteLineage!.preImageSha256 = "0".repeat(64);
    expect(() =>
      validateT3LineageChain(
        actor,
        live,
        brokenContinuity,
        (brokenContinuity as NeckChainSidecar)["teethSwapB1"]!,
        isCombinedSwapPostLevel,
      ),
    ).toThrow(/chain level must name the tracked pre-image/);
    // Plant 2: wrong swap junction — the swap output no longer pins the junction.
    const wrongJunction = JSON.parse(JSON.stringify(nurse)) as Record<string, unknown>;
    (wrongJunction as NeckChainSidecar)["teethSwapB1"] = {
      ...(((wrongJunction as NeckChainSidecar)["teethSwapB1"] ?? {}) as object),
      output: { sha256: "f".repeat(64) },
    };
    expect(() =>
      validateT3LineageChain(
        actor,
        live,
        wrongJunction,
        (wrongJunction as NeckChainSidecar)["teethSwapB1"]!,
        isCombinedSwapPostLevel,
      ),
    ).toThrow(/pins neither the top pin nor the swap junction/);
    // Plant 3: #741 moved newer than the swap — swap the CONTENT (argv+why)
    // of the swap level with the #741 level, wherever the chain nests them
    // (P2e-C added two newer levels on top, so no fixed depth is assumed).
    const reordered = JSON.parse(JSON.stringify(nurse)) as Record<string, unknown>;
    const reorderedLevels = lineageLevels(reordered);
    const reorderedSwap = reorderedLevels.findIndex((level) =>
      (level.derivationArgv ?? []).join(" ").includes("swap_teeth.py"),
    );
    const reorderedFix = reorderedLevels.findIndex(
      (level) =>
        (level.why ?? "").includes("fix(#741)") ||
        (level.derivationArgv ?? []).join(" ").includes("tongue-forward-place.ts"),
    );
    if (reorderedSwap < 0 || reorderedFix < 0)
      throw new Error("setup: swap and #741 levels present for reorder plant");
    const swapLevel = reorderedLevels[reorderedSwap]!;
    const fixLevel = reorderedLevels[reorderedFix]!;
    const swapArgv = swapLevel.derivationArgv;
    if (swapArgv === undefined || fixLevel.derivationArgv === undefined) {
      throw new Error("setup: swap and #741 levels carry argv for the reorder plant");
    }
    swapLevel.derivationArgv = fixLevel.derivationArgv;
    fixLevel.derivationArgv = swapArgv;
    const swapWhy = (swapLevel as Record<string, unknown>)["why"];
    (swapLevel as Record<string, unknown>)["why"] = (fixLevel as Record<string, unknown>)["why"];
    (fixLevel as Record<string, unknown>)["why"] = swapWhy;
    expect(() =>
      validateT3LineageChain(
        actor,
        live,
        reordered,
        (reordered as NeckChainSidecar)["teethSwapB1"]!,
        isCombinedSwapPostLevel,
      ),
    ).toThrow(/must nest older than the teeth-swap record/);
  });

  /**
   * B1 post-commit baseline: the T3 baseline comes from the recorded
   * descriptor, never symbolic HEAD. The descriptor is a pinned 40-hex
   * commit, it stays distinct from live after landing (live is baseline+1),
   * and a HEAD-shaped descriptor is refused.
   */
  it("B1: T3 loads the union baseline from the recorded commit descriptor, not HEAD", () => {
    const actor = "mpfb-clinical-nurse-adult.glb";
    const glb = parseGlb(join(DIR, actor));
    const sidecar = sidecarFor(actor);
    const live = sha256(glb.raw);
    const rev = e9Level(sidecar).preImageRevision;
    expect(typeof rev, "setup: E9 level carries a preImageRevision descriptor").toBe("string");
    expect(rev as string, "baseline descriptor is a pinned commit, not symbolic HEAD").toMatch(
      /^[0-9a-f]{40}:/,
    );
    expect(rev as string, "no symbolic HEAD in the E9 baseline descriptor").not.toContain("HEAD");
    expect((sidecar as NeckChainSidecar).outputSha256, "top pins live").toBe(live);
    const baseline = nurseBaselineGlb(sidecar);
    const baselineSha = sha256(baseline.raw);
    expect(baselineSha, "baseline (recorded pre-image) differs from live after landing").not.toBe(live);
    expect(baselineSha, "recorded pre-image bytes hash to the pinned f6573124 pre-E9 blob").toBe(
      "f6573124437c4f170643ad33d2f922bb66a069fcc58bcf3bbeef8b9a8da2833c",
    );
    const row = ((sidecar as NeckChainSidecar)["teethSwapB1"] as TeethSwapBlock).protectedAccessorHashes!.find(
      (candidate) =>
        candidate.meshIndex === NURSE_BODY_MESH && candidate.slot === NURSE_BODY_PRIM0_SLOT,
    )!;
    const witness = nurseChestWitness(glb, baseline, sidecar, row.accessorIndex);
    expect(
      baseline.document.meshes[NURSE_BODY_MESH]?.primitives?.length,
      "recorded pre-image body is the 8-prim pre-split mesh",
    ).toBe(8);
    expect(
      glb.document.meshes[NURSE_BODY_MESH]?.primitives?.length,
      "live body is the pre-image +2 split prims (E9 hidden prim8 + P2e-C skin prim9)",
    ).toBe(10);
    expect(isNurseChestStageSplit(witness), "recorded-descriptor baseline witnesses the live split").toBe(
      true,
    );
    // A HEAD-shaped descriptor is refused instead of read: post-commit,
    // HEAD:<nurse.glb> would be the 10-prim shipped GLB, not the pre-image.
    // The plant targets the E9 level (the top levels carry no revision).
    const headShaped = JSON.parse(JSON.stringify(sidecar)) as Record<string, unknown>;
    const headE9 = lineageLevels(headShaped).find((level) =>
      (level.derivationArgv ?? []).join(" ").includes("rehide-poking-skin.py"),
    )!;
    headE9.preImageRevision =
      `HEAD:apps/ui-xr/public/generated-humanoids/${actor}`;
    expect(() => nurseBaselineGlb(headShaped)).toThrow(/pinned commit descriptor/);
  });

  /**
   * M3 validateT3 integration: the chain plants run through validateT3 (not
   * the helper), and rewriting the swap output to live no longer skips the
   * chain — validateT3 throws on every plant.
   */
  it("M3: chain plants and a live-rewritten swap output throw through validateT3", () => {
    const actor = "mpfb-clinical-nurse-adult.glb";
    const glb = parseGlb(join(DIR, actor));
    const sidecar = sidecarFor(actor);
    const live = sha256(glb.raw);
    validateT3(actor, glb, sidecar);
    const plant = (mutate: (copy: Record<string, unknown>) => void): Record<string, unknown> => {
      const copy = JSON.parse(JSON.stringify(sidecar)) as Record<string, unknown>;
      mutate(copy);
      return copy;
    };
    const blockOf = (copy: Record<string, unknown>): string =>
      `swap=${JSON.stringify(((copy as NeckChainSidecar)["teethSwapB1"] as TeethSwapBlock)?.output?.sha256)}`;
    // Broken continuity through the real path (top level is the F1 chain
    // level: refusal carries the tracked-pre-image message).
    expect(
      () =>
        validateT3(
          actor,
          glb,
          plant((copy) => {
            ((copy as NeckChainSidecar).byteLineage as ByteLineageLevel).preImageSha256 = "0".repeat(64);
          }),
        ),
      `broken continuity plant ${blockOf(sidecar)}`,
    ).toThrow(/chain level must name the tracked pre-image/);
    // Wrong junction through the real path.
    expect(
      () =>
        validateT3(
          actor,
          glb,
          plant((copy) => {
            ((copy as NeckChainSidecar)["teethSwapB1"] as TeethSwapBlock).output = {
              sha256: "f".repeat(64),
            };
          }),
        ),
      "wrong junction plant",
    ).toThrow(/pins neither the top pin nor the swap junction/);
    // Block output rewritten to live through the real path (the old skip).
    expect(
      () =>
        validateT3(
          actor,
          glb,
          plant((copy) => {
            ((copy as NeckChainSidecar)["teethSwapB1"] as TeethSwapBlock).output = { sha256: live };
          }),
        ),
      "block-output-equals-live plant",
    ).toThrow(/pins neither the top pin nor the swap junction/);
    // Reordered #741 (newer than the swap) through the real path: swap the
    // CONTENT of the swap and #741 levels wherever the chain nests them.
    expect(
      () =>
        validateT3(
          actor,
          glb,
          plant((copy) => {
            const planted = lineageLevels(copy);
            const swapIdx = planted.findIndex((level) =>
              (level.derivationArgv ?? []).join(" ").includes("swap_teeth.py"),
            );
            const fixIdx = planted.findIndex(
              (level) =>
                (level.why ?? "").includes("fix(#741)") ||
                (level.derivationArgv ?? []).join(" ").includes("tongue-forward-place.ts"),
            );
            if (swapIdx < 0 || fixIdx < 0)
              throw new Error("setup: swap and #741 levels present for reorder plant");
            const swapLevel = planted[swapIdx]!;
            const fixLevel = planted[fixIdx]!;
            const swapArgv = swapLevel.derivationArgv;
            if (swapArgv === undefined || fixLevel.derivationArgv === undefined) {
              throw new Error("setup: expected derivationArgv on both levels for reorder plant");
            }
            swapLevel.derivationArgv = fixLevel.derivationArgv;
            fixLevel.derivationArgv = swapArgv;
            const swapWhy = (swapLevel as Record<string, unknown>)["why"];
            (swapLevel as Record<string, unknown>)["why"] = (fixLevel as Record<string, unknown>)["why"];
            (fixLevel as Record<string, unknown>)["why"] = swapWhy;
          }),
        ),
      "reordered #741 plant",
    ).toThrow(/must nest older than the teeth-swap record/);
  });

  it("M3 non-nurse equal-live malformed chain throws through validateT3", () => {
    const actor = "mpfb-family-partner-adult.glb";
    const glb = parseGlb(join(DIR, actor));
    const sidecar = sidecarFor(actor);
    const live = sha256(glb.raw);
    expect(lineageLevels(sidecar).length, "setup: non-nurse sidecar carries a chain").toBeGreaterThan(0);
    validateT3(actor, glb, sidecar);
    const broken = JSON.parse(JSON.stringify(sidecar)) as Record<string, unknown>;
    ((broken as NeckChainSidecar)["teethSwapB1"] as TeethSwapBlock).output = { sha256: live };
    ((broken as NeckChainSidecar).byteLineage as ByteLineageLevel).preImageSha256 = "0".repeat(64);
    expect(() => validateT3(actor, glb, broken)).toThrow(
      /preImageSha256 .* != recordedBefore\.outputSha256/,
    );
  });

  /**
   * e9-r2f G2: the legacy bypass is pinned to actor + depth 2 + the bypassed
   * level's genesis input sha, and the kevin combined-shape chain is pinned to
   * its combined level's recorded output sha. In-memory plants (never a sidecar
   * file write): flipping the pinned sha by one hex digit, or changing the
   * depth by +1/-1, must fail closed through validateT3.
   */
  it("M3 legacy bypass and combined-shape pins fail closed on sha or depth change", () => {
    const flipLastHex = (sha: string): string =>
      sha.slice(0, -1) + (sha.endsWith("0") ? "1" : "0");
    // Robert-hayes blender-bake genesis bypass (depth 3 with the maps top level;
    // the bypass itself runs on the peeled chain, where the depth is still 2).
    const rhActor = "mpfb-gown-ed-robert-hayes.glb";
    const rhGlb = parseGlb(join(DIR, rhActor));
    const rhSidecar = sidecarFor(rhActor);
    expect(lineageLevels(rhSidecar).length, "setup: robert-hayes chain depth").toBe(3);
    validateT3(rhActor, rhGlb, rhSidecar);
    const rhShaPlant = JSON.parse(JSON.stringify(rhSidecar)) as Record<string, unknown>;
    const rhOldest = lineageLevels(rhShaPlant)[2]!;
    expect(rhOldest.inputSha256, "setup: genesis input sha pinned").toBe(
      "27cbf4e5ed5a007ad497a3bafe2763ac72746583374ad1718d51573ba649aa66",
    );
    rhOldest.inputSha256 = flipLastHex(rhOldest.inputSha256!);
    expect(() => validateT3(rhActor, rhGlb, rhShaPlant)).toThrow(
      /preImageSha256 .* != recordedBefore\.outputSha256/,
    );
    const rhPlus = JSON.parse(JSON.stringify(rhSidecar)) as Record<string, unknown>;
    // +1 at the oldest level (genesis [2] under the maps top [0], was [1] at depth 2).
    lineageLevels(rhPlus)[2]!.recordedBefore = {
      outputSha256: "a".repeat(64),
      outputBytes: 1,
      byteLineage: { derivationArgv: ["extra"], preImageSha256: "b".repeat(64) },
    };
    expect(lineageLevels(rhPlus).length, "setup: robert-hayes depth +1").toBe(4);
    expect(() => validateT3(rhActor, rhGlb, rhPlus)).toThrow(
      /preImageSha256 .* != recordedBefore\.outputSha256/,
    );
    const rhMinus = JSON.parse(JSON.stringify(rhSidecar)) as Record<string, unknown>;
    delete (lineageLevels(rhMinus)[1]!.recordedBefore as Record<string, unknown>)["byteLineage"];
    expect(lineageLevels(rhMinus).length, "setup: robert-hayes depth -1").toBe(2);
    expect(() => validateT3(rhActor, rhGlb, rhMinus)).toThrow(/no nested #741 record/);
    // FU8 peel refusal (separate assertion): a copy with the maps level's own
    // nested chain deleted refuses at the peel, since there is nothing to peel onto.
    const rhMinusPeel = JSON.parse(JSON.stringify(rhSidecar)) as Record<string, unknown>;
    delete (((rhMinusPeel as NeckChainSidecar).byteLineage as ByteLineageLevel).recordedBefore as Record<
      string,
      unknown
    >)["byteLineage"];
    expect(lineageLevels(rhMinusPeel).length, "setup: robert-hayes maps-peel depth -1").toBe(1);
    expect(() => validateT3(rhActor, rhGlb, rhMinusPeel)).toThrow(/carries no nested byteLineage/);
    // Peds-nurse-kevin combined shape (live depth 4: stage-22 L0, colour L1,
    // combined swap L2, #741 L3). The combined L2 carries the newest recorded
    // output pin; the +1 plant breaks continuity at the new oldest level, and
    // the -1 plant drops the swap level itself so the chain refuses at the
    // swap search.
    const keActor = "mpfb-peds-nurse-kevin.glb";
    const keGlb = parseGlb(join(DIR, keActor));
    const keSidecar = sidecarFor(keActor);
    expect(lineageLevels(keSidecar).length, "setup: kevin chain depth").toBe(4);
    validateT3(keActor, keGlb, keSidecar);
    const keShaPlant = JSON.parse(JSON.stringify(keSidecar)) as Record<string, unknown>;
    const keCombined = lineageLevels(keShaPlant)[2]!;
    expect(keCombined.recordedBefore?.outputSha256?.slice(0, 12), "setup: combined level output pin").toBe(
      "a872dbd0f469",
    );
    keCombined.recordedBefore!.outputSha256 = flipLastHex(keCombined.recordedBefore!.outputSha256!);
    expect(() => validateT3(keActor, keGlb, keShaPlant)).toThrow(
      /preImageSha256 .* != recordedBefore\.outputSha256/,
    );
    const kePlus = JSON.parse(JSON.stringify(keSidecar)) as Record<string, unknown>;
    lineageLevels(kePlus)[3]!.recordedBefore = {
      outputSha256: "a".repeat(64),
      outputBytes: 1,
      byteLineage: { derivationArgv: ["extra"], preImageSha256: "b".repeat(64) },
    };
    expect(lineageLevels(kePlus).length, "setup: kevin depth +1").toBe(5);
    expect(() => validateT3(keActor, keGlb, kePlus)).toThrow(
      /preImageSha256 .* != recordedBefore\.outputSha256/,
    );
    const keMinus = JSON.parse(JSON.stringify(keSidecar)) as Record<string, unknown>;
    delete (((keMinus as NeckChainSidecar).byteLineage as ByteLineageLevel).recordedBefore as Record<
      string,
      unknown
    >)["byteLineage"];
    expect(lineageLevels(keMinus).length, "setup: kevin depth -1").toBe(1);
    expect(() => validateT3(keActor, keGlb, keMinus)).toThrow(/no teeth-swap derivation record/);
  });

  /**
   * FU8 MAPS-TOIGO peel plants (cap42 RULING-cap42-maps-toigo-fu8.txt): a top
   * post-export maps level peels exactly once, only on the exact tool path,
   * and only when its pins match the live GLB. In-memory copies of live maps
   * sidecars (never a sidecar file write); each plant prints the forged
   * field before/after and must throw.
   */
  it("T3 MAPS-TOIGO P1: tool path forged as a prefix word REDs", () => {
    // P1 runs on robert, where the peel is load-bearing: the forged word does
    // not equal the tool, so no peel happens and the old-branch walk reaches
    // the genesis level, which has no recordedBefore.
    const actor = "mpfb-gown-ed-robert-hayes.glb";
    const glb = parseGlb(join(DIR, actor));
    const planted = JSON.parse(JSON.stringify(sidecarFor(actor))) as Record<string, unknown>;
    const top = lineageLevels(planted)[0]!;
    const before = (top.derivationArgv ?? []).join(" ");
    expect(before, "setup: robert top level names the maps stage").toContain(
      "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py",
    );
    top.derivationArgv = top.derivationArgv!.map((a) =>
      a.includes("apply_hair_material_maps.py") ? `FORGED-${a}` : a,
    );
    const after = (top.derivationArgv ?? []).join(" ");
    console.info(`PLANT P1 prefix-forged tool word on ${actor}: before=[${before.slice(0, 80)}...] after=[${after.slice(0, 100)}...]`);
    expect(before).not.toContain("FORGED-");
    expect(after).toContain("FORGED-");
    expect(() => validateT3(actor, glb, planted)).toThrow(
      /preImageSha256 undefined != recordedBefore\.outputSha256 undefined/,
    );
  });

  it("T3 MAPS-TOIGO P2: tool path forged as a suffix word REDs", () => {
    const actor = "mpfb-gown-ed-robert-hayes.glb";
    const glb = parseGlb(join(DIR, actor));
    const live = sha256(glb.raw);
    expect(live, "setup: robert live pins the sidecar top").toBe(
      (sidecarFor(actor) as NeckChainSidecar).outputSha256,
    );
    const planted = JSON.parse(JSON.stringify(sidecarFor(actor))) as Record<string, unknown>;
    const top = lineageLevels(planted)[0]!;
    const before = (top.derivationArgv ?? []).join(" ");
    top.derivationArgv = top.derivationArgv!.map((a) =>
      a.includes("apply_hair_material_maps.py") ? `${a}-FORGED` : a,
    );
    const after = (top.derivationArgv ?? []).join(" ");
    console.info(`PLANT P2 suffix-forged tool word on ${actor}: before=[${before.slice(0, 80)}...] after=[${after.slice(-100)}...]`);
    expect(before).not.toMatch(/-FORGED/);
    expect(after).toMatch(/-FORGED/);
    expect(() => validateT3(actor, glb, planted)).toThrow(
      /preImageSha256 undefined != recordedBefore\.outputSha256 undefined/,
    );
  });

  it("T3 MAPS-TOIGO P3: pre-image off by one hex REDs", () => {
    const actor = "mpfb-family-partner-adult.glb";
    const glb = parseGlb(join(DIR, actor));
    const planted = JSON.parse(JSON.stringify(sidecarFor(actor))) as Record<string, unknown>;
    const top = lineageLevels(planted)[0]!;
    const before = top.preImageSha256!;
    expect(before, "setup: planted pre-image starts pinned").toBe(
      top.recordedBefore!.outputSha256,
    );
    top.preImageSha256 = before.slice(0, -1) + (before.endsWith("0") ? "1" : "0");
    console.info(`PLANT P3 pre-image 1-hex off on ${actor}: before=${before.slice(0, 12)}... after=${top.preImageSha256!.slice(0, 12)}...`);
    expect(() => validateT3(actor, glb, planted)).toThrow(
      /preImageSha256 .* != recordedBefore\.outputSha256/,
    );
  });

  it("T3 MAPS-TOIGO P4: stacked maps levels RED (peel at most once)", () => {
    const actor = "mpfb-family-partner-adult.glb";
    const glb = parseGlb(join(DIR, actor));
    const planted = JSON.parse(JSON.stringify(sidecarFor(actor))) as Record<string, unknown>;
    const inner = (planted as NeckChainSidecar).byteLineage!;
    const stacked = JSON.parse(JSON.stringify(inner)) as ByteLineageLevel;
    (planted as NeckChainSidecar).byteLineage = stacked;
    const innerPre = inner.preImageSha256;
    if (innerPre === undefined) throw new Error(`setup P4 ${actor}: inner maps level has no preImageSha256`);
    stacked.recordedBefore = {
      outputSha256: innerPre,
      outputBytes: 0,
      byteLineage: inner,
    };
    const depth = lineageLevels(planted).length;
    console.info(`PLANT P4 stacked maps levels on ${actor}: depth ${depth - 1} -> ${depth}, nested top names maps tool`);
    expect(depth, "setup: stacked plant adds exactly one level").toBeGreaterThan(1);
    expect(() => validateT3(actor, glb, planted)).toThrow(/peel at most once/);
  });

  it("T3 MAPS-TOIGO P5: maps level whose output != live REDs", () => {
    const actor = "mpfb-family-partner-adult.glb";
    const glb = parseGlb(join(DIR, actor));
    const live = sha256(glb.raw);
    const planted = JSON.parse(JSON.stringify(sidecarFor(actor))) as Record<string, unknown>;
    const before = (planted as NeckChainSidecar).outputSha256;
    expect(before, "setup: sidecar top pins live").toBe(live);
    (planted as NeckChainSidecar).outputSha256 = "f".repeat(64);
    console.info(`PLANT P5 output mismatch on ${actor}: before=${String(before).slice(0, 12)}... after=ffffffffffff (live=${live.slice(0, 12)}...)`);
    expect(() => validateT3(actor, glb, planted)).toThrow(/!= live/);
  });

  /**
   * T3 combined ordering (kevin-colour h1). One byteLineage level that ran both
   * the teeth swap and the #741 post-step satisfies the ordering by its contents
   * at any depth: the live depth-4 shape (R4b) and the previous depth-2 shape
   * (R4a, pinned-parent blobs beside their matching GLB) both validate.
   * Counterweights, built in memory from the live sidecar: a SEPARATE #741 level
   * newer than a pure-swap level (R2) still refuses with the ordering message,
   * and a chain with no #741 level at all (R3) refuses as missing #741.
   */
  it("T3 combined swap level satisfies the ordering at any depth; newer-only or absent #741 still refuse", () => {
    const actor = "mpfb-peds-nurse-kevin.glb";
    const glb = parseGlb(join(DIR, actor));
    const live = sha256(glb.raw);
    const kevin = sidecarFor(actor);
    const block = (kevin as NeckChainSidecar)["teethSwapB1"]!;
    // R4b: the live depth-4 shape (stage-22 on top of the combined swap level) validates.
    expect(lineageLevels(kevin).length, "setup: live kevin chain depth").toBe(4);
    validateT3LineageChain(actor, live, kevin, block, isCombinedSwapPostLevel);
    validateT3(actor, glb, kevin);
    const swapAt = lineageLevels(kevin).findIndex((level) =>
      (level.derivationArgv ?? []).join(" ").includes("swap_teeth.py"),
    );
    console.info(`T3 combined ${actor}: depth=4 swap=${swapAt} live=${live.slice(0, 12)}`);
    // R4a: the depth-2 shape from before this card (combined newest, #741 older),
    // read from the pinned-parent blobs beside their matching GLB, still validates.
    const prevSidecar = JSON.parse(
      execFileSync("git", ["show", `${KEVIN_PRE_COLOUR_PARENT}:${DIR}/${actor.replace(/\.glb$/, ".provenance.json")}`], {
        maxBuffer: 64 * 1024 * 1024,
      }).toString("utf8"),
    ) as Record<string, unknown>;
    const prevGlb = parseGlbBytes(
      execFileSync("git", ["show", `${KEVIN_PRE_COLOUR_PARENT}:${DIR}/${actor}`], { maxBuffer: 128 * 1024 * 1024 }),
    );
    const prevLive = sha256(prevGlb.raw);
    expect(lineageLevels(prevSidecar).length, "setup: previous kevin chain depth").toBe(2);
    validateT3LineageChain(
      actor,
      prevLive,
      prevSidecar,
      (prevSidecar as NeckChainSidecar)["teethSwapB1"]!,
      isCombinedSwapPostLevel,
    );
    validateT3(actor, prevGlb, prevSidecar);
    console.info(`T3 combined previous ${actor}: depth=2 live=${prevLive.slice(0, 12)}`);
    // R2 counterweight: the #741 markers live on a SEPARATE level NEWER than a
    // pure-swap level (combined split apart) -> the ordering still refuses.
    const newer741 = JSON.parse(JSON.stringify(kevin)) as Record<string, unknown>;
    const newerLevels = lineageLevels(newer741);
    newerLevels[0]!.why = `${newerLevels[0]!.why ?? ""} fix(#741) plant: separate newer #741`;
    newerLevels[2]!.derivationArgv = (newerLevels[2]!.derivationArgv ?? []).map((arg) =>
      arg.replaceAll("tongue-forward-place.ts", "tongue-forward-place-removed-for-plant.ts"),
    );
    newerLevels[3]!.why = "plant: oldest-level #741 markers stripped";
    newerLevels[3]!.derivationArgv = ["plant: oldest-level argv stripped"];
    expect(
      () =>
        validateT3LineageChain(
          actor,
          live,
          newer741,
          (newer741 as NeckChainSidecar)["teethSwapB1"]!,
          isCombinedSwapPostLevel,
        ),
      "R2: separate newer #741 plant",
    ).toThrow(/must nest older than the teeth-swap record/);
    // R3 counterweight: no #741 level at all (combined split apart AND the older
    // record stripped) -> the chain refuses as missing #741, never as optional.
    const no741 = JSON.parse(JSON.stringify(kevin)) as Record<string, unknown>;
    const no741Levels = lineageLevels(no741);
    no741Levels[2]!.derivationArgv = (no741Levels[2]!.derivationArgv ?? []).map((arg) =>
      arg.replaceAll("tongue-forward-place.ts", "tongue-forward-place-removed-for-plant.ts"),
    );
    no741Levels[3]!.why = "plant: oldest-level #741 markers stripped";
    no741Levels[3]!.derivationArgv = ["plant: oldest-level argv stripped"];
    expect(
      () =>
        validateT3LineageChain(actor, live, no741, (no741 as NeckChainSidecar)["teethSwapB1"]!, isCombinedSwapPostLevel),
      "R3: absent #741 plant",
    ).toThrow(/missing #741/);
  });

  /**
   * T3 forged-why counterweight (kevin-colour h2 F3). Strip every real #741
   * command (the tongue-forward invocation from the combined level's argv, all
   * markers from the older level) and plant fix(#741) in the swap level's why:
   * the combined case needs the EXACT swap + tongue-forward invocations in
   * derivationArgv, so why text never suffices and the chain still refuses
   * with the ordering message. h1 R2/R3/R4 plants stay GREEN (asserted in the
   * test above; this test re-runs the live shape GREEN as its setup).
   */
  it("T3 forged fix(#741) why on a tongue-stripped swap level still refuses", () => {
    const actor = "mpfb-peds-nurse-kevin.glb";
    const glb = parseGlb(join(DIR, actor));
    const live = sha256(glb.raw);
    const kevin = sidecarFor(actor);
    expect(lineageLevels(kevin).length, "setup: live kevin chain depth").toBe(4);
    validateT3(actor, glb, kevin);
    const forged = JSON.parse(JSON.stringify(kevin)) as Record<string, unknown>;
    const forgedLevels = lineageLevels(forged);
    forgedLevels[2]!.derivationArgv = (forgedLevels[2]!.derivationArgv ?? []).map((arg) =>
      arg.replaceAll("tongue-forward-place.ts", "tongue-forward-place-removed-for-plant.ts"),
    );
    forgedLevels[2]!.why = `${forgedLevels[2]!.why ?? ""} fix(#741) forged why plant`;
    forgedLevels[3]!.why = "plant: oldest-level #741 markers stripped";
    forgedLevels[3]!.derivationArgv = ["plant: oldest-level argv stripped"];
    expect(
      () =>
        validateT3LineageChain(actor, live, forged, (forged as NeckChainSidecar)["teethSwapB1"]!, isCombinedSwapPostLevel),
      "F3: forged why on tongue-stripped swap level",
    ).toThrow(/must nest older than the teeth-swap record/);
  });

  /**
   * T3 forged-path counterweight (kevin-colour h3 F3). A single forged token
   * that prefixes/suffixes BOTH full tool paths (FORGED-<path>-FORGED) still
   * contains both paths as substrings, so joined-string includes would pass —
   * but word-token equality refuses because neither exact invocation is
   * present. The older #741 markers are stripped as in the h2 plant, so the
   * chain refuses with the ordering message.
   */
  it("T3 forged single token wrapping both tool paths still refuses", () => {
    const actor = "mpfb-peds-nurse-kevin.glb";
    const glb = parseGlb(join(DIR, actor));
    const live = sha256(glb.raw);
    const kevin = sidecarFor(actor);
    expect(lineageLevels(kevin).length, "setup: live kevin chain depth").toBe(4);
    validateT3(actor, glb, kevin);
    const forged = JSON.parse(JSON.stringify(kevin)) as Record<string, unknown>;
    const forgedLevels = lineageLevels(forged);
    forgedLevels[2]!.derivationArgv = (forgedLevels[2]!.derivationArgv ?? []).map((arg) =>
      arg
        .replaceAll(
          "tools/openclinxr/asset-pipeline/makeclothes/teeth-swap/swap_teeth.py",
          "FORGED-tools/openclinxr/asset-pipeline/makeclothes/teeth-swap/swap_teeth.py-FORGED",
        )
        .replaceAll(
          "tools/openclinxr/asset-pipeline/makeclothes/tongue-forward-place.ts",
          "FORGED-tools/openclinxr/asset-pipeline/makeclothes/tongue-forward-place.ts-FORGED",
        ),
    );
    forgedLevels[3]!.why = "plant: oldest-level #741 markers stripped";
    forgedLevels[3]!.derivationArgv = ["plant: oldest-level argv stripped"];
    expect(
      () =>
        validateT3LineageChain(
          actor,
          live,
          forged,
          (forged as NeckChainSidecar)["teethSwapB1"]!,
          isCombinedSwapPostLevel,
        ),
      "F3: forged prefix/suffix token around both tool paths",
    ).toThrow(/must nest older than the teeth-swap record/);
  });

  it("M1: swapped kept/hidden roles refuse even though both shas are in the pin set", () => {
    const actor = NURSE_ACTOR;
    const glb = parseGlb(join(DIR, actor));
    const sidecar = sidecarFor(actor);
    const baseline = nurseBaselineGlb(sidecar);
    const block = (sidecar as NeckChainSidecar)["teethSwapB1"]!;
    const row = block.protectedAccessorHashes!.find(
      (candidate) =>
        candidate.meshIndex === NURSE_BODY_MESH && candidate.slot === NURSE_BODY_PRIM0_SLOT,
    )!;
    expect(row, "nurse body prim0.indices row recorded").toBeDefined();
    const witness = nurseChestWitness(glb, baseline, sidecar, row.accessorIndex);
    expect(isNurseChestStageSplit(witness), "live nurse split passes the shared predicate").toBe(true);
    // Swap every role-bound field: shas, sorted index arrays, accessor maps,
    // and material index+name pairs. Both shas stay inside the pin set, but
    // the kept slot no longer carries the KEPT pin, so the predicate refuses.
    const swapped = {
      ...witness,
      keptIndicesSha256: witness.hiddenIndicesSha256,
      hiddenIndicesSha256: witness.keptIndicesSha256,
      keptSortedIndices: witness.hiddenSortedIndices,
      hiddenSortedIndices: witness.keptSortedIndices,
      keptAttrAccessors: witness.hiddenAttrAccessors,
      hiddenAttrAccessors: witness.keptAttrAccessors,
      keptTargetAccessors: witness.hiddenTargetAccessors,
      hiddenTargetAccessors: witness.keptTargetAccessors,
      keptMaterialIndex: witness.hiddenMaterialIndex,
      hiddenMaterialIndex: witness.keptMaterialIndex,
      keptMaterial: witness.hiddenMaterial,
      hiddenMaterial: witness.keptMaterial,
    };
    expect(
      isNurseChestStageSplit(swapped),
      "swapped kept/hidden roles must refuse the split",
    ).toBe(false);
    // Sha-only swap: every binding field stays live, only the two shas trade
    // slots. Both shas stay inside the pin set, but the kept slot no longer
    // carries the KEPT pin — the role-bound predicate refuses. (D5 probe:
    // relaxing the predicate to set membership admits this plant.)
    const shaOnlySwapped = {
      ...witness,
      keptIndicesSha256: witness.hiddenIndicesSha256,
      hiddenIndicesSha256: witness.keptIndicesSha256,
    };
    expect(
      isNurseChestStageSplit(shaOnlySwapped),
      "sha-only swapped roles must refuse the split",
    ).toBe(false);
  });

  it("M1 hidden-only triangle-rotated buffer refuses through the direct predicate", () => {
    const actor = NURSE_ACTOR;
    const glb = parseGlb(join(DIR, actor));
    const sidecar = sidecarFor(actor);
    const baseline = nurseBaselineGlb(sidecar);
    const block = (sidecar as NeckChainSidecar)["teethSwapB1"]!;
    const row = block.protectedAccessorHashes!.find(
      (candidate) =>
        candidate.meshIndex === NURSE_BODY_MESH && candidate.slot === NURSE_BODY_PRIM0_SLOT,
    )!;
    const witness = nurseChestWitness(glb, baseline, sidecar, row.accessorIndex);
    expect(isNurseChestStageSplit(witness), "live nurse split passes the shared predicate").toBe(true);
    const prims = glb.document.meshes[NURSE_BODY_MESH]?.primitives ?? [];
    // P2e-C appended the skin prim9 last: the E9 hidden prim is second-to-last.
    const hidden = prims[prims.length - 2]!;
    expect(
      sha256(accessorBytes(glb, hidden.indices!)),
      "setup: second-to-last prim is the E9 hidden prim",
    ).toBe(witness.hiddenIndicesSha256);
    const hiddenIdx = hidden.indices!;
    const acc = glb.document.accessors[hiddenIdx]!;
    const view = glb.document.bufferViews[acc.bufferView!]!;
    const itemBytes = acc.componentType === 5125 || acc.componentType === 5126 ? 4 : 2;
    expect(view.byteStride ?? itemBytes, "setup: hidden indices are densely packed").toBe(itemBytes);
    const flat = accessorValues(glb, hiddenIdx).map((r) => r[0]!);
    expect(flat.length % 3, "setup: hidden indices form whole triangles").toBe(0);
    const rotated = [...flat];
    for (let i = 0; i < rotated.length; i += 3) {
      const a = rotated[i]!;
      rotated[i] = rotated[i + 1]!;
      rotated[i + 1] = rotated[i + 2]!;
      rotated[i + 2] = a;
    }
    expect([...rotated].sort((a, b) => a - b)).toEqual(witness.hiddenSortedIndices);
    const buf = Buffer.alloc(rotated.length * itemBytes);
    rotated.forEach((v, k) => {
      if (acc.componentType === 5125) buf.writeUInt32LE(v, k * 4);
      else if (acc.componentType === 5123) buf.writeUInt16LE(v, k * 2);
      else if (acc.componentType === 5122) buf.writeInt16LE(v, k * 2);
      else throw new Error(`setup: unexpected hidden indices component ${acc.componentType}`);
    });
    const rotatedSha = sha256(buf);
    expect(rotatedSha, "setup: triangle rotation changes the hidden raw sha").not.toBe(
      witness.hiddenIndicesSha256,
    );
    const planted = { ...witness, hiddenIndicesSha256: rotatedSha };
    expect(
      isNurseChestStageSplit(planted),
      "triangle-rotated hidden buffer must refuse (hidden pin)",
    ).toBe(false);
  });

  it("M1 hidden-only triangle-rotated buffer refuses through the T3 chest row caller", () => {
    const actor = NURSE_ACTOR;
    const glb = parseGlb(join(DIR, actor));
    const sidecar = sidecarFor(actor);
    const baseline = nurseBaselineGlb(sidecar);
    const block = (sidecar as NeckChainSidecar)["teethSwapB1"]!;
    const row = block.protectedAccessorHashes!.find(
      (candidate) =>
        candidate.meshIndex === NURSE_BODY_MESH && candidate.slot === NURSE_BODY_PRIM0_SLOT,
    )!;
    const prims = glb.document.meshes[NURSE_BODY_MESH]?.primitives ?? [];
    // P2e-C appended the skin prim9 last: the E9 hidden prim is second-to-last.
    const hidden = prims[prims.length - 2]!;
    const hiddenSha = sha256(accessorBytes(glb, hidden.indices!));
    expect(
      NURSE_CHEST_STAGE_INDICES_SHA256,
      "setup: second-to-last prim carries a pinned split sha",
    ).toContain(hiddenSha);
    expect(hiddenSha, "setup: second-to-last prim is the hidden half, not the kept half").not.toBe(
      NURSE_CHEST_STAGE_KEPT_INDICES_SHA256,
    );
    const hiddenIdx = hidden.indices!;
    const acc = glb.document.accessors[hiddenIdx]!;
    const view = glb.document.bufferViews[acc.bufferView!]!;
    const itemBytes = acc.componentType === 5125 || acc.componentType === 5126 ? 4 : 2;
    expect(view.byteStride ?? itemBytes, "setup: hidden indices are densely packed").toBe(itemBytes);
    const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const count = acc.count;
    expect(count % 3, "setup: hidden indices form whole triangles").toBe(0);
    const readEl = (k: number): number =>
      acc.componentType === 5125
        ? glb.binary.readUInt32LE(start + k * 4)
        : glb.binary.readUInt16LE(start + k * 2);
    const writeEl = (k: number, v: number): void => {
      if (acc.componentType === 5125) glb.binary.writeUInt32LE(v, start + k * 4);
      else glb.binary.writeUInt16LE(v, start + k * 2);
    };
    for (let i = 0; i < count; i += 3) {
      const a = readEl(i);
      const b = readEl(i + 1);
      const c = readEl(i + 2);
      writeEl(i, b);
      writeEl(i + 1, c);
      writeEl(i + 2, a);
    }
    const witness = nurseChestWitness(glb, baseline, sidecar, row.accessorIndex);
    expect(
      isNurseChestStageSplit(witness),
      "triangle-rotated hidden GLB must refuse through the caller-built witness",
    ).toBe(false);
    expect(() =>
      nurseChestRowOrThrow(actor, glb, baseline, sidecar, row.accessorIndex),
    ).toThrow(/shared E9 split rejected/);
  });

  it("M2: prim8 repointed at a byte-identical duplicate accessor refuses (index identity, not bytes)", () => {
    const actor = NURSE_ACTOR;
    const glb = parseGlb(join(DIR, actor));
    const sidecar = sidecarFor(actor);
    const baseline = nurseBaselineGlb(sidecar);
    const block = (sidecar as NeckChainSidecar)["teethSwapB1"]!;
    const row = block.protectedAccessorHashes!.find(
      (candidate) =>
        candidate.meshIndex === NURSE_BODY_MESH && candidate.slot === NURSE_BODY_PRIM0_SLOT,
    )!;
    expect(row, "nurse body prim0.indices row recorded").toBeDefined();
    const witness = nurseChestWitness(glb, baseline, sidecar, row.accessorIndex);
    expect(isNurseChestStageSplit(witness), "live nurse split passes the shared predicate").toBe(true);
    // Body prim0 morph targets 16/17 share byte-identical payloads: t16
    // POSITION 2055 == t17 POSITION 2057 (and NORMAL 2056 == 2058). A
    // byte-signature check cannot tell them apart; accessor-index identity can.
    expect(
      sha256(accessorPayload(glb, 2055)),
      "setup: twin POSITION accessors share bytes",
    ).toBe(sha256(accessorPayload(glb, 2057)));
    const repointed = witness.hiddenTargetAccessors.map((target) => ({ ...target }));
    expect(repointed[17]?.["POSITION"], "setup: hidden t17 POSITION is 2057").toBe(2057);
    repointed[17]!["POSITION"] = 2055;
    expect(
      isNurseChestStageSplit({ ...witness, hiddenTargetAccessors: repointed }),
      "prim8 morph target repointed to a byte-identical duplicate accessor must refuse",
    ).toBe(false);
    // Attribute repoint to any other index refuses as well (2018 is unique,
    // so this one differs in bytes too — the twin-target plant above is the
    // byte-identical case).
    expect(
      isNurseChestStageSplit({
        ...witness,
        hiddenAttrAccessors: { ...witness.hiddenAttrAccessors, ["POSITION"]: 2775 },
      }),
      "prim8 POSITION repointed away from the baseline accessor index must refuse",
    ).toBe(false);
  });

  it("M2: prim8 material swapped to another openclinxr_hidden_* refuses (exact hide material)", () => {
    const actor = NURSE_ACTOR;
    const glb = parseGlb(join(DIR, actor));
    const sidecar = sidecarFor(actor);
    const baseline = nurseBaselineGlb(sidecar);
    const block = (sidecar as NeckChainSidecar)["teethSwapB1"]!;
    const row = block.protectedAccessorHashes!.find(
      (candidate) =>
        candidate.meshIndex === NURSE_BODY_MESH && candidate.slot === NURSE_BODY_PRIM0_SLOT,
    )!;
    expect(row, "nurse body prim0.indices row recorded").toBeDefined();
    const witness = nurseChestWitness(glb, baseline, sidecar, row.accessorIndex);
    expect(isNurseChestStageSplit(witness), "live nurse split passes the shared predicate").toBe(true);
    // Live body prim2 carries the lower hide material (index 6,
    // openclinxr_hidden_lower_...): still an openclinxr_hidden_* material,
    // but not the exact E9 hide material (index 5, ..._upper_...).
    expect(witness.hiddenMaterialIndex, "setup: E9 hide material index is 5").toBe(5);
    expect(
      isNurseChestStageSplit({
        ...witness,
        hiddenMaterialIndex: 6,
        hiddenMaterial: "openclinxr_hidden_lower_mpfb_ed_chest_pain_nurse_adult_body_mesh",
      }),
      "prim8 material swapped to another openclinxr_hidden_* must refuse",
    ).toBe(false);
    // Donor: a non-hidden prim GLB-wide with a different attribute set (body
    // prims 1-7 are all hidden, so a body-local donor cannot supply one).
    const basePrim0 = baseline.document.meshes[NURSE_BODY_MESH]?.primitives?.[0];
    if (basePrim0 === undefined) throw new Error("setup: baseline body prim0 missing");
    const baseAttr = rawPrimAttrSig(baseline, basePrim0);
    let donor: { material: string; materialIndex: number } | undefined;
    for (const mesh of glb.document.meshes) {
      for (const prim of mesh?.primitives ?? []) {
        const material = rawPrimMaterial(glb, prim);
        if (material.startsWith("openclinxr_hidden_")) continue;
        if (prim.material === undefined) continue;
        const attr = rawPrimAttrSig(glb, prim);
        if (attr === baseAttr) {
          continue;
        }
        donor = { material, materialIndex: prim.material };
        break;
      }
      if (donor) break;
    }
    expect(donor, "setup: GLB carries a non-hidden prim with a different attribute set").toBeDefined();
    expect(
      isNurseChestStageSplit({
        ...witness,
        hiddenMaterialIndex: donor!.materialIndex,
        hiddenMaterial: donor!.material,
      }),
      "prim8 material swapped to a non-hidden material must refuse",
    ).toBe(false);
    expect(
      isNurseChestStageSplit({ ...witness, keptMaterial: donor!.material }),
      "kept prim material swapped away from the baseline must refuse",
    ).toBe(false);
  });

  /**
   * T3 E9 row guard (b): a temp sidecar copy with the E9 rehide level removed refuses
   * the row. Never edits the real sidecar: deep copy, drop the newest level, round-trip
   * through a temp file, then the row path must throw.
   */
  it("T3 E9 row guard: temp sidecar copy without the E9 rehide level refuses the row", () => {
    const actor = NURSE_ACTOR;
    const glb = parseGlb(join(DIR, actor));
    const sidecar = sidecarFor(actor);
    const baseline = nurseBaselineGlb(sidecar);
    const block = (sidecar as NeckChainSidecar)["teethSwapB1"]!;
    const row = block.protectedAccessorHashes!.find(
      (candidate) =>
        candidate.meshIndex === NURSE_BODY_MESH && candidate.slot === NURSE_BODY_PRIM0_SLOT,
    )!;
    expect(row, "nurse body prim0.indices row recorded").toBeDefined();
    // Sanity: the live nurse passes through the row path (guard (a) direction).
    nurseChestRowOrThrow(actor, glb, baseline, sidecar, row.accessorIndex);
    // P2e-C: the E9 rehide level is no longer the top (the chain sits
    // above it), so the guard splices the E9 level out wherever it nests.
    const copy = JSON.parse(JSON.stringify(sidecar)) as Record<string, unknown>;
    const copyLevels = lineageLevels(copy);
    const e9Idx = copyLevels.findIndex((level) =>
      (level.derivationArgv ?? []).join(" ").includes("rehide-poking-skin.py"),
    );
    expect(e9Idx, "setup: E9 rehide level present to remove").toBeGreaterThanOrEqual(0);
    const e9Recorded = copyLevels[e9Idx]!.recordedBefore;
    if (e9Idx === 0) {
      const e9Inner = e9Recorded?.byteLineage;
      if (e9Inner === undefined) throw new Error("setup: E9 level carries a nested chain to keep");
      (copy as NeckChainSidecar).byteLineage = e9Inner;
    } else if (e9Recorded === undefined) {
      delete (copyLevels[e9Idx - 1]! as unknown as Record<string, unknown>)["recordedBefore"];
    } else {
      copyLevels[e9Idx - 1]!.recordedBefore = e9Recorded;
    }
    const dir = mkdtempSync(join(tmpdir(), "e9r2b-guard-b-"));
    try {
      const file = join(dir, "sidecar.json");
      writeFileSync(file, JSON.stringify(copy));
      const stripped = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const witness = nurseChestWitness(glb, baseline, stripped, row.accessorIndex);
      expect(witness.keptIndicesSha256, "bytes untouched: kept sha still pinned").toBe(
        NURSE_CHEST_STAGE_KEPT_INDICES_SHA256,
      );
      expect(isNurseChestStageSplit(witness), "E9 level removed must refuse the split").toBe(false);
      expect(() => nurseChestRowOrThrow(actor, glb, baseline, stripped, row.accessorIndex)).toThrow(
        /T3 E9 chest .* shared E9 split rejected/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * T3 E9 row guard (c): a temp GLB copy whose prim0 indices bytes leave the E9 pin
   * refuses the row. The plant rotates the kept index buffer by one triangle: the index
   * multiset (and therefore the sorted union) is unchanged, but the raw bytes sha is no
   * longer in the pin. Both the row path and the shared predicate must refuse.
   */
  it("T3 E9 row guard: temp GLB copy with a non-pin body indices sha refuses the row", () => {
    const actor = NURSE_ACTOR;
    const glb = parseGlb(join(DIR, actor));
    const sidecar = sidecarFor(actor);
    const baseline = nurseBaselineGlb(sidecar);
    const keptAccessor = 1985;
    const accessor = glb.document.accessors[keptAccessor]!;
    if (accessor.bufferView === undefined || accessor.sparse) {
      throw new Error("guard setup: kept indices accessor must be dense");
    }
    const view = glb.document.bufferViews[accessor.bufferView]!;
    const itemBytes = 2;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const jsonLength = glb.raw.readUInt32LE(12);
    const binStart = 20 + jsonLength + 8;
    const planted = Buffer.from(glb.raw);
    const region = planted.subarray(binStart + start, binStart + start + accessor.count * itemBytes);
    const rotated = Buffer.concat([region.subarray(3 * itemBytes), region.subarray(0, 3 * itemBytes)]);
    rotated.copy(region);
    const dir = mkdtempSync(join(tmpdir(), "e9r2b-guard-c-"));
    try {
      const file = join(dir, "planted.glb");
      writeFileSync(file, planted);
      const plantedGlb = parseGlb(file);
      const plantedSha = sha256(accessorBytes(plantedGlb, keptAccessor));
      expect(plantedSha, "plant changed the kept bytes").not.toBe(
        NURSE_CHEST_STAGE_KEPT_INDICES_SHA256,
      );
      expect(NURSE_CHEST_STAGE_INDICES_SHA256, "planted sha is in no pin").not.toContain(plantedSha);
      const witness = nurseChestWitness(plantedGlb, baseline, sidecar, keptAccessor);
      expect(
        [...witness.keptSortedIndices, ...witness.hiddenSortedIndices].sort((a, b) => a - b),
        "rotation keeps the sorted union intact",
      ).toEqual(witness.baselineSortedIndices);
      expect(isNurseChestStageSplit(witness), "non-pin sha must refuse the split").toBe(false);
      expect(() =>
      nurseChestRowOrThrow(actor, plantedGlb, baseline, sidecar, keptAccessor),
      ).toThrow(/T3 E9 chest .* shared E9 split rejected/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * A1 shared-fn guard: a union-off-by-one plant straight through the shared
   * predicate is refused. Pinned kept/hidden shas and the intact sidecar chain,
   * but the baseline union is off by exactly one index: isNurseChestStageSplit
   * must be false. Mutation-sensitive by construction: deleting the index-union
   * check (M1) turns this RED (pins + chain still pass); deleting the pinned-sha
   * check (M2) leaves it green (guard (c) covers M2).
   */
  it("shared predicate refuses a union off by one with pinned shas and intact chain", () => {
    const actor = NURSE_ACTOR;
    const glb = parseGlb(join(DIR, actor));
    const sidecar = sidecarFor(actor);
    const baseline = nurseBaselineGlb(sidecar);
    const block = (sidecar as NeckChainSidecar)["teethSwapB1"]!;
    const row = block.protectedAccessorHashes!.find(
      (candidate) =>
        candidate.meshIndex === NURSE_BODY_MESH && candidate.slot === NURSE_BODY_PRIM0_SLOT,
    )!;
    expect(row, "nurse body prim0.indices row recorded").toBeDefined();
    const witness = nurseChestWitness(glb, baseline, sidecar, row.accessorIndex);
    expect(isNurseChestStageSplit(witness), "live nurse split passes the shared predicate").toBe(
      true,
    );
    const offByOne = [...witness.baselineSortedIndices];
    offByOne[0]! += 1;
    expect(offByOne[0], "plant moved the smallest baseline index").not.toBe(
      witness.baselineSortedIndices[0],
    );
    expect(
      isNurseChestStageSplit({ ...witness, baselineSortedIndices: offByOne }),
      "union off by one must refuse the split",
    ).toBe(false);
  });

  /**
   * T5' post-step table (cap8 ruling, 2026-11-10). Values were recorded in
   * st-teeth/post/deltas.txt BEFORE teeth-rest-clearance.ts ran; they are never read from the
   * shipped bytes. Retreat rule: dz = -(|marginAtCap| + 0.5 mm) per actor (deltas.txt line N).
   * Kevin tongue -0.004 m = the #741 tongue-back value in mpfb-peds-parent-aisha.provenance.json
   * byteLineage.derivationArgv. coupled = couple-fitted-teeth-to-lip-viseme.ts ran (ob trio:
   * refused, lower front shell not jaw-weighted, ships retreated uncoupled).
   */
  const POST_STEPS: Record<string, { teethDz: number; tongueDz: number; coupled: boolean }> = {
    "mpfb-clinical-nurse-adult.glb": { teethDz: -0.0057, tongueDz: 0, coupled: true }, // deltas.txt line 1
    "mpfb-family-partner-adult.glb": { teethDz: -0.0061, tongueDz: 0, coupled: true }, // line 2
    "mpfb-gown-adult-patient.glb": { teethDz: -0.0023, tongueDz: 0, coupled: true }, // line 3
    "mpfb-gown-ed-robert-hayes.glb": { teethDz: -0.0023, tongueDz: 0, coupled: true }, // line 4
    "mpfb-gown-inspect.glb": { teethDz: -0.0031, tongueDz: 0, coupled: false }, // line 5
    "mpfb-ob-patient-aisha.glb": { teethDz: -0.0031, tongueDz: 0, coupled: false }, // line 6
    "mpfb-peds-nurse-kevin.glb": { teethDz: -0.0102, tongueDz: -0.004, coupled: true }, // line 7; tongue #741
    "mpfb-peds-patient-child.glb": { teethDz: 0, tongueDz: 0, coupled: true }, // not in deltas.txt: rest cleared
    "mpfb-street-adult-male.glb": { teethDz: 0, tongueDz: 0, coupled: true }, // not in deltas.txt: rest cleared
    "mpfb-viseme-inspect.glb": { teethDz: -0.0031, tongueDz: 0, coupled: false }, // line 8
    // tsk_2a74bbdb3f03cb3e: same rule (|marginAtCap| + 0.5 mm), physician marginAtCap -5.5596 mm
    // (phys-seat/swap/retreat-delta.record.json, recorded before the seat measure).
    "mpfb-clinical-physician-adult.glb": { teethDz: -0.0061, tongueDz: 0, coupled: true },
  };
  /**
   * T5' decimation post-step (super-ceo-cap13 ruling 2026-11-10: ONE ratio 0.65, error 0.005 for
   * all 10 swapped actors; budget 180,000 at asset-generation-pipeline.md:87). The shipped teeth
   * indices are not compared to scratch by hash: they are re-produced by running the decimation tool
   * the sidecar's postSteps names (path + toolSha256 read from the sidecar; the file on disk must hash
   * to the recorded sha, so a tool edit reds here) on the shipped GLB with the scratch teeth indices
   * restored. The replay runs twice; both runs and the shipped indices must be byte-equal
   * (determinism of meshopt simplify on this lockfile). Vertices, skin and targets stay checked
   * against scratch above and below.
   */
  const DECIMATE_ARGS = ["--in-place", "--ratio", "0.65", "--error", "0.005"];
  const decimateStep = (actor: string): { tool: string; args: string[] } => {
    const provenance = JSON.parse(readFileSync(join(DIR, actor.replace(/\.glb$/, ".provenance.json")), "utf8")) as {
      teethSwapB1?: { postSteps?: Array<{ tool: string; toolSha256: string; args: string[] }> };
    };
    const steps = (provenance.teethSwapB1?.postSteps ?? []).filter((candidate) => /\/decimate_[^/]*$/.test(candidate.tool));
    if (steps.length !== 1) throw new Error(`T5' expected 1 recorded decimation post-step, found ${steps.length}`);
    const step = steps[0]!;
    if (step.toolSha256 !== sha256(readFileSync(step.tool))) throw new Error(`T5' ${step.tool} moved since the sidecar recorded it`);
    if (JSON.stringify(step.args) !== JSON.stringify(DECIMATE_ARGS)) throw new Error(`T5' decimate args ${JSON.stringify(step.args)} != ${JSON.stringify(DECIMATE_ARGS)}`);
    return step;
  };
  const replayDecimatedIndices = (shipped: Glb, outputIndices: number, scratch: Glb, scratchIndices: number, tool: string, args: string[]): Buffer => {
    const document = structuredClone(shipped.document);
    const accessor = document.accessors[outputIndices]! as Accessor & { min?: number[]; max?: number[] };
    const scratchAccessor = scratch.document.accessors[scratchIndices]!;
    if (accessor.componentType !== scratchAccessor.componentType) throw new Error("T5' teeth indices component type differs from scratch");
    const view = document.bufferViews[accessor.bufferView!]!;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const preImage = accessorBytes(scratch, scratchIndices);
    if (preImage.length > view.byteLength - (accessor.byteOffset ?? 0)) throw new Error("T5' scratch teeth indices exceed the shipped bufferView");
    const binary = Buffer.from(shipped.binary);
    preImage.copy(binary, start);
    accessor.count = scratchAccessor.count;
    delete accessor.min;
    delete accessor.max;
    let json = Buffer.from(JSON.stringify(document), "utf8");
    json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
    const tail = shipped.raw.subarray(20 + shipped.raw.readUInt32LE(12) + 8 + shipped.binary.length);
    const header = Buffer.alloc(12);
    header.write("glTF", 0, "ascii");
    header.writeUInt32LE(2, 4);
    const chunk = (length: number, type: number) => {
      const out = Buffer.alloc(8);
      out.writeUInt32LE(length, 0);
      out.writeUInt32LE(type, 4);
      return out;
    };
    const glb = Buffer.concat([header, chunk(json.length, 0x4e4f534a), json, chunk(binary.length, 0x004e4942), binary, tail]);
    glb.writeUInt32LE(glb.length, 8);
    const dir = mkdtempSync(join(tmpdir(), "t5-decimate-"));
    try {
      const file = join(dir, "pre-image.glb");
      writeFileSync(file, glb);
      execFileSync(join(repoRoot(), "node_modules/.bin/tsx"), [tool, file, ...args], { stdio: "pipe" });
      return accessorBytes(parseGlb(file), outputIndices);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  /** float32 ulp at 0.2 m is 1.5e-8 m; one add of dz rounds once. */
  const POSITION_TOLERANCE_M = 1e-6;
  const t5Title = SCRATCH
    ? "T5': the 11 transplanted mouth accessors equal each actor's scratch bake plus its recorded post-steps"
    : "T5': the 11 transplanted mouth accessors equal each actor's scratch bake plus its recorded post-steps [SKIP: OPENCLINXR_TEETH_SCRATCH_DIR is unset]";
  // NOT TESTED: T5' skips without OPENCLINXR_TEETH_SCRATCH_DIR (the scratch bakes are machine-local),
  // so it runs locally only, never in CI.
  (SCRATCH ? it : it.skip)(t5Title, () => {
    const problems: string[] = [];
    // T5' covers the swapped actors only. NOT TESTED: the bake-native known-good (peds-parent) does
    // not equal a fresh bake of the current producer: its fitted teeth carry 7 viseme POSITION morphs
    // and its tongue 1 (couple-fitted-teeth-to-lip-viseme.ts, after the bake; fresh scratch: 0), and
    // 2180 of 4494 teeth verts are skinned head/jaw/oris blends where the fresh bake skins jaw 1.0
    // (measured 2026-11-10). That is producer-vs-shipped drift outside this swap; T1/T2 still pass on it.
    const swapped = actorFiles().filter((name) => name !== BAKE_NATIVE_KNOWN_GOOD);
    expect(swapped, "T5' covers the 11 swapped actors").toHaveLength(11);
    expect(Object.keys(POST_STEPS).sort(), "T5' post-step table names the 11 swapped actors").toEqual([...swapped].sort());
    const knownGood = parseGlb(join(DIR, BAKE_NATIVE_KNOWN_GOOD));
    const knownGoodNames = (feature(knownGood, "teeth", true).mesh as Mesh & { extras?: { targetNames?: string[] } })
      .extras?.targetNames ?? [];
    expect(knownGoodNames, "peds-parent teeth carry the 7 coupled viseme targets").toHaveLength(7);
    const isTarget = (slot: string): boolean => slot.includes(".targets[");
    for (const actor of swapped) {
      try {
        const steps = POST_STEPS[actor]!;
        const shipped = parseGlb(join(DIR, actor));
        const scratch = parseGlb(join(SCRATCH!, actor));
        const decimate = decimateStep(actor);
        for (const name of FEATURES) {
          const outputFeature = feature(shipped, name, true);
          const scratchFeature = feature(scratch, name, true);
          const allOutputRows = primitiveAccessorRows(outputFeature.mesh);
          const outputRows = allOutputRows.filter((row) => !isTarget(row.slot));
          const targetRows = allOutputRows.filter((row) => isTarget(row.slot));
          const scratchRows = primitiveAccessorRows(scratchFeature.mesh);
          if (scratchRows.some((row) => isTarget(row.slot))) throw new Error(`T5' ${name}: scratch carries morph targets`);
          expect(outputRows.map((row) => row.slot)).toEqual(scratchRows.map((row) => row.slot));
          // (c) coupled teeth carry exactly the 7 known-good targets, each moving; tongue and uncoupled carry none.
          const coupledHere = name === "teeth" && steps.coupled;
          const names = (outputFeature.mesh as Mesh & { extras?: { targetNames?: string[] } }).extras?.targetNames ?? [];
          if (coupledHere) {
            if (JSON.stringify(names) !== JSON.stringify(knownGoodNames)) {
              throw new Error(`T5' teeth target names ${JSON.stringify(names)} != peds-parent ${JSON.stringify(knownGoodNames)}`);
            }
            if (targetRows.length !== 7 || targetRows.some((row) => !row.slot.endsWith(".POSITION"))) {
              throw new Error(`T5' teeth: expected 7 POSITION targets, found ${targetRows.map((row) => row.slot).join(",")}`);
            }
            // (c+') opening visemes move; FF and PP are exactly 0 by design
            // (couple-fitted-teeth-to-lip-viseme.ts:1670-1680, "a closed bite does not carry the open
            // protrusion"). A zero opening target and a non-zero closed target both fail.
            // NOT TESTED: target magnitudes. peds-parent was coupled by an older coupler (peak mm: aa 8.55,
            // E 1.64, I 3.44, O 2.59, U 1.75, FF 1.93, PP 0.36); the current coupler writes nurse = street
            // aa 17.00, E 9.98, I 9.99, O 10.40, U 9.73, FF 0, PP 0 (measured 2026-11-10).
            const CLOSED = new Set(["viseme_FF", "viseme_PP"]);
            for (const [targetIndex, row] of targetRows.entries()) {
              const target = names[targetIndex]!;
              const peak = Math.max(...accessorValues(shipped, row.accessorIndex).flat().map(Math.abs));
              if (CLOSED.has(target) && peak !== 0) throw new Error(`T5' teeth ${target}: closed viseme moves ${peak} m`);
              if (!CLOSED.has(target) && !(peak > 0)) throw new Error(`T5' teeth ${target}: zero opening target couples nothing`);
            }
          } else if (targetRows.length !== 0) {
            throw new Error(`T5' ${name}: ${targetRows.length} unexpected morph-target accessors`);
          }
          const dz = name === "teeth" ? steps.teethDz : steps.tongueDz;
          for (let index = 0; index < outputRows.length; index += 1) {
            const outputRow = outputRows[index]!;
            const scratchRow = scratchRows[index]!;
            if (outputRow.slot.endsWith("JOINTS_0")) {
              const outputNames = shipped.document.skins[outputFeature.skin]!.joints.map((node) => shipped.document.nodes[node]?.name ?? "");
              const scratchNames = scratch.document.skins[scratchFeature.skin]!.joints.map((node) => scratch.document.nodes[node]?.name ?? "");
              const canonical = (glb: Glb, accessor: number, jointNames: string[]) => sha256(JSON.stringify(accessorValues(glb, accessor).map((row) => row.map((joint) => jointNames[joint]))));
              if (canonical(shipped, outputRow.accessorIndex, outputNames) !== canonical(scratch, scratchRow.accessorIndex, scratchNames)) {
                throw new Error(`T5' ${name} ${outputRow.slot}: joint-name accessor differs`);
              }
            } else if (outputRow.slot.endsWith(".POSITION")) {
              // (b) POSITION == scratch + (0, 0, dz) per vertex.
              const out = accessorValues(shipped, outputRow.accessorIndex);
              const ref = accessorValues(scratch, scratchRow.accessorIndex);
              if (out.length !== ref.length) throw new Error(`T5' ${name} POSITION: vertex count differs`);
              let worst = 0;
              for (let v = 0; v < out.length; v += 1) {
                const expected = [ref[v]![0]!, ref[v]![1]!, ref[v]![2]! + dz];
                for (let c = 0; c < 3; c += 1) worst = Math.max(worst, Math.abs(out[v]![c]! - expected[c]!));
              }
              if (worst > POSITION_TOLERANCE_M) {
                throw new Error(`T5' ${name} POSITION: max |shipped - (scratch + dz ${dz})| ${worst} m > ${POSITION_TOLERANCE_M}`);
              }
            } else if (name === "teeth" && outputRow.slot.endsWith(".indices")) {
              // (d) decimated teeth indices == production decimate_teeth.mts replayed on the scratch indices.
              const replay = () => replayDecimatedIndices(shipped, outputRow.accessorIndex, scratch, scratchRow.accessorIndex, decimate.tool, decimate.args);
              const first = replay();
              if (!first.equals(replay())) throw new Error(`T5' teeth ${outputRow.slot}: ${decimate.tool} replay is not deterministic`);
              if (!first.equals(accessorBytes(shipped, outputRow.accessorIndex))) {
                throw new Error(`T5' teeth ${outputRow.slot}: shipped indices != ${decimate.tool} ${decimate.args.join(" ")} replayed on scratch`);
              }
            } else if (accessorHash(shipped, outputRow.accessorIndex) !== accessorHash(scratch, scratchRow.accessorIndex)) {
              // (a) every other base accessor is the scratch accessor.
              throw new Error(`T5' ${name} ${outputRow.slot}: accessor differs from scratch bake`);
            }
          }
        }
      } catch (error) {
        problems.push(`${actor}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  }, 1_800_000);
});
