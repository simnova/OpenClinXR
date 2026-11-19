import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { glbGeometryDigest } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";

/**
 * A material-only post-export stage (hair maps: new images + material fields, 0 vertex bytes
 * changed) must not move a geometry pin, while a 1-ULP vertex edit must.
 *
 * (a) PARITY: the digest of `git show 30083bee8:<path>` (pre-maps) equals the digest of the
 * shipped file (post-maps) for the three toigo GLBs; the whole-file sha256 pairs must DIFFER.
 * (b) COUNTERWEIGHT 1-ULP: flipping the first X float of accessor 1178 in the shipped
 * family-partner GLB (0xbde76584 -> 0xbde76583) changes the digest.
 * (c) COUNTERWEIGHT material-only: changing only a material roughnessFactor in the JSON chunk
 * (re-padded, BIN bytes identical) leaves the digest unchanged while the whole-file sha moves.
 * (cw1) Prepending a copy of a named mesh (node mesh indices adjusted) changes the digest.
 * (cw2) A 6xuint16 index accessor changed to 3xuint32 over the same 12 payload bytes changes
 * the digest (small synthetic GLB: the shipped GLB has no 6-count uint16 index accessor).
 * (cw3) A sparse override on a dense POSITION accessor changes the digest.
 * (cw4) version 999 throws; (cw5) a truncated tail throws.
 * (cw6) rv6 F1: a forged attribute name replaying deleted roles yields a DIFFERENT digest.
 * (cw7) rv6 F7: a bufferView selecting buffer 1 or any buffer with a uri throws.
 */

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const PRE_MAPS_REF = "30083bee8";
const GLBS = [
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-gown-ed-robert-hayes.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
] as const;
const FAMILY_PARTNER = "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb";

type TestAccessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  count?: number;
  sparse?: unknown;
  type?: string;
};

type TestMesh = {
  name?: string;
  primitives?: Array<{ attributes?: Record<string, number>; indices?: number }>;
};

type TestDoc = {
  accessors?: TestAccessor[];
  asset?: unknown;
  bufferViews?: Array<{ byteOffset?: number; byteLength?: number; buffer?: number }>;
  buffers?: Array<{ byteLength?: number; uri?: string }>;
  images?: unknown[];
  materials?: Array<{ pbrMetallicRoughness?: { roughnessFactor?: number } }>;
  meshes?: TestMesh[];
  nodes?: Array<{ mesh?: number }>;
};

function toU8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function parseGlb(raw: Uint8Array): { jsonLen: number; binLen: number; binStart: number; doc: TestDoc } {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const jsonLen = view.getUint32(12, true);
  const binLen = view.getUint32(20 + jsonLen, true);
  const binStart = 20 + jsonLen + 8;
  const doc = JSON.parse(Buffer.from(raw.subarray(20, 20 + jsonLen)).toString("utf8")) as TestDoc;
  return { jsonLen, binLen, binStart, doc };
}

/** Rebuilds a GLB with a mutated JSON doc; optionally appends bytes to the BIN chunk. */
function rebuildGlb(raw: Uint8Array, doc: TestDoc, extraBin?: Buffer): Uint8Array {
  const { binLen, binStart } = parseGlb(raw);
  let json = Buffer.from(JSON.stringify(doc));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = extraBin
    ? Buffer.concat([Buffer.from(raw.subarray(binStart, binStart + binLen)), extraBin])
    : Buffer.from(raw.subarray(binStart, binStart + binLen));
  const out = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
  Buffer.from(raw.subarray(0, 12)).copy(out, 0);
  out.writeUInt32LE(json.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  json.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + json.length);
  out.writeUInt32LE(0x004e4942, 20 + json.length + 4);
  bin.copy(out, 20 + json.length + 8);
  out.writeUInt32LE(out.length, 8);
  return toU8(out);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireGit(): void {
  try {
    execFileSync("git", ["--version"], { cwd: REPO, stdio: "ignore" });
  } catch (error) {
    throw new Error(`parity requires git: ${(error as Error).message}`);
  }
}

function gitShow(rel: string): Uint8Array {
  try {
    return toU8(
      execFileSync("git", ["show", `${PRE_MAPS_REF}:${rel}`], {
        cwd: REPO,
        maxBuffer: 256 * 1024 * 1024,
      }),
    );
  } catch (error) {
    throw new Error(`parity requires git blob ${PRE_MAPS_REF}:${rel}: ${(error as Error).message}`);
  }
}

describe("a material-only stage repins no geometry file", () => {
  it("(a) PARITY: pre-maps and post-maps digests agree for the three toigo GLBs", () => {
    requireGit();
    for (const rel of GLBS) {
      const pre = gitShow(rel);
      const post = toU8(readFileSync(join(REPO, rel)));
      expect(
        sha256Hex(pre),
        `${rel}: the parity pair must differ in whole-file sha or equality proves nothing`,
      ).not.toBe(sha256Hex(post));
      expect(
        glbGeometryDigest(post),
        `${rel}: post-maps digest must equal the pre-maps digest`,
      ).toBe(glbGeometryDigest(pre));
    }
  });

  it("(b) COUNTERWEIGHT: a 1-ULP vertex edit moves the digest", () => {
    const orig = toU8(readFileSync(join(REPO, FAMILY_PARTNER)));
    const { jsonLen, doc } = parseGlb(orig);
    const acc = doc.accessors?.[1178];
    if (acc === undefined) throw new Error("accessor 1178 missing");
    const bv = doc.bufferViews?.[acc.bufferView ?? -1];
    if (bv === undefined) throw new Error("bufferView for accessor 1178 missing");
    const off = 20 + jsonLen + 8 + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const view = new DataView(orig.buffer, orig.byteOffset, orig.byteLength);
    expect(
      view.getUint32(off, true),
      "accessor 1178 must still open with 0xbde76584 or the substitution is not proven",
    ).toBe(0xbde76584);
    const edited = new Uint8Array(orig);
    new DataView(edited.buffer, edited.byteOffset, edited.byteLength).setUint32(off, 0xbde76583, true);
    process.stdout.write(`1-ULP before=${glbGeometryDigest(orig)} after=${glbGeometryDigest(edited)}
`);
    expect(glbGeometryDigest(edited)).not.toBe(glbGeometryDigest(orig));
  });

  it("(c) COUNTERWEIGHT: a material-only roughnessFactor edit keeps the digest, moves the file sha", () => {
    const orig = toU8(readFileSync(join(REPO, FAMILY_PARTNER)));
    const { doc } = parseGlb(orig);
    const editedDoc = JSON.parse(JSON.stringify(doc)) as TestDoc;
    const target = editedDoc.materials?.find(
      (m) => typeof m.pbrMetallicRoughness?.roughnessFactor === "number",
    );
    if (!target?.pbrMetallicRoughness) throw new Error("no material with roughnessFactor found");
    const before = target.pbrMetallicRoughness.roughnessFactor;
    target.pbrMetallicRoughness.roughnessFactor = before === 0.5 ? 0.6 : 0.5;
    const edited = rebuildGlb(orig, editedDoc);
    process.stdout.write(`material-only before=${glbGeometryDigest(orig)} after=${glbGeometryDigest(edited)}
`);
    expect(glbGeometryDigest(edited)).toBe(glbGeometryDigest(orig));
    expect(sha256Hex(edited)).not.toBe(sha256Hex(orig));
  });

  it("(cw1) COUNTERWEIGHT: prepending a mesh copy moves the digest", () => {
    const orig = toU8(readFileSync(join(REPO, FAMILY_PARTNER)));
    const { doc } = parseGlb(orig);
    const named = doc.meshes?.findIndex((m) => typeof m.name === "string") ?? -1;
    if (named < 0 || doc.meshes === undefined) throw new Error("no named mesh found");
    const namedMesh = doc.meshes[named];
    if (namedMesh === undefined) throw new Error("no named mesh found");
    const editedDoc = JSON.parse(JSON.stringify(doc)) as TestDoc;
    if (editedDoc.meshes === undefined) throw new Error("meshes missing after clone");
    editedDoc.meshes.unshift(JSON.parse(JSON.stringify(namedMesh)) as TestMesh);
    for (const node of editedDoc.nodes ?? []) {
      if (node.mesh !== undefined) node.mesh += 1;
    }
    const edited = rebuildGlb(orig, editedDoc);
    process.stdout.write(`prepend-mesh before=${glbGeometryDigest(orig)} after=${glbGeometryDigest(edited)}
`);
    expect(glbGeometryDigest(edited)).not.toBe(glbGeometryDigest(orig));
  });

  it("(cw2) COUNTERWEIGHT: 6xuint16 indices read as 3xuint32 move the digest", () => {
    // Synthetic: the shipped family-partner GLB has no 6-count uint16 index accessor.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 1]);
    const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
    const base: TestDoc = {
      asset: { version: "2.0" },
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5123, count: 6, type: "SCALAR" },
      ],
      bufferViews: [
        { byteOffset: 0, byteLength: 36 },
        { byteOffset: 36, byteLength: 12 },
      ],
      buffers: [{ byteLength: 48 }],
      meshes: [{ name: "tri", primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    };
    const build = (doc: TestDoc): Uint8Array => {
      let json = Buffer.from(JSON.stringify(doc));
      json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
      const out = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
      out.write("glTF", 0);
      out.writeUInt32LE(2, 4);
      out.writeUInt32LE(json.length, 12);
      out.writeUInt32LE(0x4e4f534a, 16);
      json.copy(out, 20);
      out.writeUInt32LE(bin.length, 20 + json.length);
      out.writeUInt32LE(0x004e4942, 20 + json.length + 4);
      bin.copy(out, 20 + json.length + 8);
      out.writeUInt32LE(out.length, 8);
      return toU8(out);
    };
    const before = build(base);
    const editedDoc = JSON.parse(JSON.stringify(base)) as TestDoc;
    const idxAcc = editedDoc.accessors?.[1];
    if (idxAcc === undefined) throw new Error("synthetic indices accessor missing");
    idxAcc.componentType = 5125;
    idxAcc.count = 3;
    const after = build(editedDoc);
    process.stdout.write(`index-retype before=${glbGeometryDigest(before)} after=${glbGeometryDigest(after)}
`);
    expect(glbGeometryDigest(after)).not.toBe(glbGeometryDigest(before));
  });

  it("(cw3) COUNTERWEIGHT: a sparse override on a dense POSITION moves the digest", () => {
    const orig = toU8(readFileSync(join(REPO, FAMILY_PARTNER)));
    const { binLen, doc } = parseGlb(orig);
    const editedDoc = JSON.parse(JSON.stringify(doc)) as TestDoc;
    const acc = editedDoc.accessors?.[1178];
    if (acc === undefined) throw new Error("accessor 1178 missing");
    if (acc.sparse !== undefined) throw new Error("accessor 1178 must start dense");
    const idxBytes = Buffer.alloc(2);
    idxBytes.writeUInt16LE(5, 0);
    const valBytes = Buffer.from(new Float32Array([9.5, 8.5, 7.5]).buffer);
    if (editedDoc.bufferViews === undefined) throw new Error("bufferViews missing");
    editedDoc.bufferViews.push({ byteOffset: binLen, byteLength: 2 }, { byteOffset: binLen + 2, byteLength: 12 });
    acc.sparse = {
      count: 1,
      indices: { bufferView: editedDoc.bufferViews.length - 2, byteOffset: 0, componentType: 5123 },
      values: { bufferView: editedDoc.bufferViews.length - 1, byteOffset: 0 },
    };
    const edited = rebuildGlb(orig, editedDoc, Buffer.concat([idxBytes, valBytes]));
    process.stdout.write(`sparse-override before=${glbGeometryDigest(orig)} after=${glbGeometryDigest(edited)}
`);
    expect(glbGeometryDigest(edited)).not.toBe(glbGeometryDigest(orig));
  });

  it("(cw4) malformed version throws; (cw5) a truncated tail throws", () => {
    const orig = toU8(readFileSync(join(REPO, FAMILY_PARTNER)));
    const badVersion = new Uint8Array(orig);
    new DataView(badVersion.buffer, badVersion.byteOffset, badVersion.byteLength).setUint32(4, 999, true);
    expect(() => glbGeometryDigest(badVersion)).toThrow();
    expect(() => glbGeometryDigest(orig.subarray(0, orig.length - 4))).toThrow();
  });

  it("(cw6) COUNTERWEIGHT (rv6 F1): a forged attribute name cannot replay deleted roles", () => {
    // rv6 collision: base roles `mesh0:X#prim0/_a=H_attr` + `mesh0:X#prim0/indices=H_idx`
    // concatenate under the old `role=hex` encoding to exactly the forged single-attribute
    // line `mesh0:X#prim0/_a=H_attr\nmesh0:X#prim0/indices=H_idx`. The forged primitive drops
    // `indices`, so its second triangle renders verts 3,4,5 instead of 0,2,1 — same digest,
    // different geometry. Escaped role boundaries must separate them.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 9, 9, 8, 8, 8, 7, 7, 7]);
    const attrVals = new Float32Array([0, 1, 2, 3, 4, 5]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 1]);
    const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(attrVals.buffer), Buffer.from(indices.buffer)]);
    const base: TestDoc = {
      asset: { version: "2.0" },
      accessors: [
        { bufferView: 0, componentType: 5126, count: 6, type: "VEC3" },
        { bufferView: 1, componentType: 5126, count: 6, type: "SCALAR" },
        { bufferView: 2, componentType: 5123, count: 6, type: "SCALAR" },
      ],
      bufferViews: [
        { byteOffset: 0, byteLength: 72 },
        { byteOffset: 72, byteLength: 24 },
        { byteOffset: 96, byteLength: 12 },
      ],
      buffers: [{ byteLength: 108 }],
      meshes: [{ name: "X", primitives: [{ attributes: { POSITION: 0, _a: 1 }, indices: 2 }] }],
    };
    const build = (doc: TestDoc): Uint8Array => {
      let json = Buffer.from(JSON.stringify(doc));
      json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
      const out = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
      out.write("glTF", 0);
      out.writeUInt32LE(2, 4);
      out.writeUInt32LE(json.length, 12);
      out.writeUInt32LE(0x4e4f534a, 16);
      json.copy(out, 20);
      out.writeUInt32LE(bin.length, 20 + json.length);
      out.writeUInt32LE(0x004e4942, 20 + json.length + 4);
      bin.copy(out, 20 + json.length + 8);
      out.writeUInt32LE(out.length, 8);
      return toU8(out);
    };
    // Dense-reader hash of accessor 1 (mirrors shaAccessor: header line + raw payload).
    const attrHash = createHash("sha256")
      .update("6,SCALAR,5126,false\n", "utf8")
      .update(Buffer.from(attrVals.buffer))
      .digest("hex");
    const before = build(base);
    const forgedDoc = JSON.parse(JSON.stringify(base)) as TestDoc;
    const prim = forgedDoc.meshes?.[0]?.primitives?.[0];
    if (prim?.attributes === undefined) throw new Error("synthetic primitive missing");
    prim.attributes = { POSITION: 0, [`_a=${attrHash}\nmesh0:X#prim0/indices`]: 2 };
    delete prim.indices;
    const after = build(forgedDoc);
    process.stdout.write(`forged-role before=${glbGeometryDigest(before)} after=${glbGeometryDigest(after)}\n`);
    expect(glbGeometryDigest(after)).not.toBe(glbGeometryDigest(before));
  });

  it("(cw7) COUNTERWEIGHT (rv6 F7): a second buffer / data-URI bufferView selection throws", () => {
    // rv6 gap: redirecting a POSITION bufferView to a data-URI-backed second buffer kept the
    // pin because decoding ignored bufferView.buffer. GLB BIN chunk only — both must throw.
    const positions = new Float32Array([123, 0, 0, 1, 0, 0, 0, 1, 0]);
    const bin = Buffer.from(positions.buffer);
    const build = (doc: TestDoc): Uint8Array => {
      let json = Buffer.from(JSON.stringify(doc));
      json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
      const out = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
      out.write("glTF", 0);
      out.writeUInt32LE(2, 4);
      out.writeUInt32LE(json.length, 12);
      out.writeUInt32LE(0x4e4f534a, 16);
      json.copy(out, 20);
      out.writeUInt32LE(bin.length, 20 + json.length);
      out.writeUInt32LE(0x004e4942, 20 + json.length + 4);
      bin.copy(out, 20 + json.length + 8);
      out.writeUInt32LE(out.length, 8);
      return toU8(out);
    };
    const dataUri =
      `data:application/octet-stream;base64,${Buffer.from(new Float32Array([9, 9, 9]).buffer).toString("base64")}`;
    const redirected: TestDoc = {
      asset: { version: "2.0" },
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
      bufferViews: [{ byteOffset: 0, byteLength: 36, buffer: 1 }],
      buffers: [{ byteLength: 36 }, { byteLength: 12, uri: dataUri }],
      meshes: [{ name: "tri", primitives: [{ attributes: { POSITION: 0 } }] }],
    };
    expect(() => glbGeometryDigest(build(redirected))).toThrow(/buffer/i);
    const otherBuffer: TestDoc = {
      asset: { version: "2.0" },
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
      bufferViews: [{ byteOffset: 0, byteLength: 36, buffer: 1 }],
      buffers: [{ byteLength: 36 }, { byteLength: 36 }],
      meshes: [{ name: "tri", primitives: [{ attributes: { POSITION: 0 } }] }],
    };
    expect(() => glbGeometryDigest(build(otherBuffer))).toThrow(/buffer/i);
  });
});
