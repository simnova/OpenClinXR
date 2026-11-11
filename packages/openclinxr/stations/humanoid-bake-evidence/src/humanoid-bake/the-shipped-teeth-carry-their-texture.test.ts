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
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";

process.chdir(repoRoot());

const DIR = "apps/ui-xr/public/generated-humanoids";
const EXPECTED_IMAGE_SHA = {
  teeth: "d0afb57869c6fbb56b98f5efc4aec629ee7593e70d8dd2bfb9de923acfb65f43",
  tongue: "3150be398e48e8ba1feac164c3143c16c0b2e959d9ffb6155f0171f59cfb4ea9",
} as const;
const FEATURES = ["teeth", "tongue"] as const;
const SCRATCH = process.env["OPENCLINXR_TEETH_SCRATCH_DIR"];
const BAKE_NATIVE_KNOWN_GOOD = "mpfb-peds-parent-aisha.glb";
/**
 * Excluded from this swap (super-ceo-cap8 ruling, 2026-11-10): its scratch bake missed the body
 * gate on the mouth row only (compare_body_v2 mouth p99 5.304 mm > 5.13 mm, whole 3.837 mm;
 * chin verts). The swap moves to tsk_2a74bbdb3f03cb3e, which gates on a seat measure instead.
 */
const PENDING_SWAP = "mpfb-clinical-physician-adult.glb";
const PENDING_SWAP_CARD = "tsk_2a74bbdb3f03cb3e";

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
  const raw = readFileSync(path);
  if (raw.toString("ascii", 0, 4) !== "glTF" || raw.readUInt32LE(4) !== 2) {
    throw new Error(`${path}: expected GLB v2`);
  }
  const jsonLength = raw.readUInt32LE(12);
  if (raw.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${path}: JSON chunk missing`);
  const document = JSON.parse(raw.subarray(20, 20 + jsonLength).toString("utf8")) as Document;
  const binHeader = 20 + jsonLength;
  const binLength = raw.readUInt32LE(binHeader);
  if (raw.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error(`${path}: BIN chunk missing`);
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

type TeethSwapBlock = {
  output?: { sha256?: string };
  protectedAccessorHashes?: Array<{ meshIndex: number; slot: string; accessorIndex: number; sha256: string }>;
};

function sidecarFor(actor: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(DIR, actor.replace(/\.glb$/, ".provenance.json")), "utf8")) as Record<
    string,
    unknown
  >;
}

function validateT3(actor: string, glb: Glb, sidecar: Record<string, unknown>): void {
  const block = sidecar["teethSwapB1"] as TeethSwapBlock | undefined;
  if (!block) {
    if (actor !== BAKE_NATIVE_KNOWN_GOOD) {
      throw new Error("T3 neither teethSwapB1 lineage nor the bake-native fitted pair is present");
    }
    return;
  }
  if (block.output?.sha256 !== sha256(glb.raw)) {
    throw new Error("T3 teethSwapB1 output sha does not pin this GLB");
  }
  for (const row of block.protectedAccessorHashes ?? []) {
    const actual = accessorHash(glb, row.accessorIndex);
    if (actual !== row.sha256) {
      throw new Error(`T3 protected ${row.meshIndex}:${row.slot} ${actual} != ${row.sha256}`);
    }
  }
  if ((block.protectedAccessorHashes?.length ?? 0) === 0) {
    throw new Error("T3 protected accessor list is empty");
  }
}

describe("the shipped teeth carry their own CC0 texture", () => {
  it("T1-T3: 11 of the 12 actors (physician pending, see the guard below) carry a fitted textured pair, valid weights, and swap or bake-native lineage", () => {
    const problems: string[] = [];
    let knownGood = "KNOWN_GOOD not measured";
    const actors = actorFiles();
    expect(actors, "K3: this contract is pinned to the 12 shipped MPFB actors").toHaveLength(12);
    for (const actor of actors.filter((name) => name !== PENDING_SWAP)) {
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
      `${knownGood}\nteeth/tongue swap failures (${problems.length}/11):\n${problems.join("\n")}`,
    ).toEqual([]);
  }, 1_800_000);

  it(`inverted guard: ${PENDING_SWAP} still carries the hm08 teeth/tongue until ${PENDING_SWAP_CARD} lands`, () => {
    const names = parseGlb(join(DIR, PENDING_SWAP)).document.meshes.map((mesh) => mesh.name ?? "");
    const count = (token: string) => names.filter((name) => name.includes(token)).length;
    expect(
      {
        hm08Teeth: count("openclinxr_hm08_teeth"),
        hm08Tongue: count("openclinxr_hm08_tongue"),
        fittedTeeth: count("openclinxr_fitted_teeth"),
        fittedTongue: count("openclinxr_fitted_tongue"),
      },
      `physician teeth swap pending ${PENDING_SWAP_CARD}: when that card lands, replace this guard with ` +
        "the swapped-teeth assertion used for the other 10 (drop PENDING_SWAP from the T1-T3 and T5 " +
        "filters); do not delete or widen it",
    ).toEqual({ hm08Teeth: 1, hm08Tongue: 1, fittedTeeth: 0, fittedTongue: 0 });
  });

  it("known-good: the current peds-parent bake passes T1/T2 without teethSwapB1", () => {
    const glb = parseGlb(join(DIR, BAKE_NATIVE_KNOWN_GOOD));
    const sidecar = sidecarFor(BAKE_NATIVE_KNOWN_GOOD);
    const splits = validateT1T2(glb);
    expect(sidecar["teethSwapB1"]).toBeUndefined();
    console.info(`KNOWN_GOOD ${BAKE_NATIVE_KNOWN_GOOD} split=${JSON.stringify(splits)}`);
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
    ? "T5': the 10 transplanted mouth accessors equal each actor's scratch bake plus its recorded post-steps"
    : "T5': the 10 transplanted mouth accessors equal each actor's scratch bake plus its recorded post-steps [SKIP: OPENCLINXR_TEETH_SCRATCH_DIR is unset]";
  // NOT TESTED: T5' skips without OPENCLINXR_TEETH_SCRATCH_DIR (the scratch bakes are machine-local),
  // so it runs locally only, never in CI.
  (SCRATCH ? it : it.skip)(t5Title, () => {
    const problems: string[] = [];
    // T5' covers the swapped actors only. NOT TESTED: the bake-native known-good (peds-parent) does
    // not equal a fresh bake of the current producer: its fitted teeth carry 7 viseme POSITION morphs
    // and its tongue 1 (couple-fitted-teeth-to-lip-viseme.ts, after the bake; fresh scratch: 0), and
    // 2180 of 4494 teeth verts are skinned head/jaw/oris blends where the fresh bake skins jaw 1.0
    // (measured 2026-11-10). That is producer-vs-shipped drift outside this swap; T1/T2 still pass on it.
    const swapped = actorFiles().filter((name) => name !== PENDING_SWAP && name !== BAKE_NATIVE_KNOWN_GOOD);
    expect(swapped, "T5' covers the 10 swapped actors").toHaveLength(10);
    expect(Object.keys(POST_STEPS).sort(), "T5' post-step table names the 10 swapped actors").toEqual([...swapped].sort());
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
