import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * hair-groom-2: shipped actor GLBs carry an untextured flat hair material from a bake older than
 * hair texture wiring, under dozens of graded post-export stages a re-bake would drop. The
 * transplant takes only the hair (geometry, material, images) from a fresh bake of the same actor.
 *
 * Clauses: (1) the hair primitive, material and image come from the bake; (2) counterweight:
 * every other shipped bufferView, mesh, node and skin is unchanged; (3) joints are remapped by
 * name; (4) a hair material shared with another mesh is refused; (5) two runs are byte-identical;
 * (6) --alpha-mode MASK --alpha-cutoff 0.2 sets the hair material to MASK at 0.2 (peds-parent-aisha's
 * shipped value); a cutoff without MASK is refused, and without the flag the bake's BLEND stays (1);
 * (7) cards-r4: a bake material with extensions is refused without --carry-extensions; with it the
 * extensions, their texture and extensionsUsed are carried; (8) --fringe-blend adds a BLEND copy of the
 * MASK hair primitive on the same accessors and is refused without MASK; (9) --fringe-triangles gives
 * the fringe primitive its own index accessor holding only the listed triangles, refuses an index past
 * the triangle count and refuses use without --fringe-blend.
 *
 * Fixture values are illustrative. The fixture PNG is 2x2, under --max-texture, so it passes
 * through without Pillow. NOT TESTED here: the Pillow downscale branch (runs on real GLBs only).
 */

const ROOT = resolve(import.meta.dirname, "../../../../..");
const TOOL = join(ROOT, "tools/openclinxr/asset-pipeline/makeclothes/transplant_library_hair.py");
const HAIR = "makeclothes_library_hair_fixture_style_mesh";

type Doc = {
  accessors: Array<Record<string, unknown> & { bufferView: number }>;
  bufferViews: Array<{ byteLength: number; byteOffset: number }>;
  meshes: Array<{ name: string; primitives: Array<{ material: number; attributes: Record<string, number> }> }>;
  materials: Array<Record<string, unknown> & { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }>;
  textures?: Array<{ source: number; sampler?: number }>;
  images?: Array<{ bufferView: number; mimeType: string }>;
  nodes: unknown[];
  skins: unknown[];
};

function defined<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`${what} missing`);
  return v;
}

function at<T>(xs: readonly T[] | undefined, i: number): T {
  return defined(xs?.[i], `index ${i}`);
}

function encodeGlb(document: object, binary: Buffer): Buffer {
  const source = Buffer.from(JSON.stringify(document));
  const json = Buffer.concat([source, Buffer.alloc((4 - (source.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
  const out = Buffer.alloc(28 + json.length + bin.length);
  out.write("glTF", 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  json.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + json.length);
  out.writeUInt32LE(0x004e4942, 24 + json.length);
  bin.copy(out, 28 + json.length);
  return out;
}

function parseGlb(path: string): { doc: Doc; bin: Buffer } {
  const raw = readFileSync(path);
  const jsonLength = raw.readUInt32LE(12);
  const doc = JSON.parse(raw.subarray(20, 20 + jsonLength).toString("utf8")) as Doc;
  const binLength = raw.readUInt32LE(20 + jsonLength);
  return { doc, bin: raw.subarray(28 + jsonLength, 28 + jsonLength + binLength) };
}

function view(glb: { doc: Doc; bin: Buffer }, index: number): Buffer {
  const v = at(glb.doc.bufferViews, index);
  return glb.bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
}

function png(rgba: number[]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
  const rows = Buffer.from([0, ...rgba.slice(0, 8), 0, ...rgba.slice(8, 16)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const DONOR_PNG = png([200, 120, 60, 255, 10, 20, 30, 0, 90, 80, 70, 128, 1, 2, 3, 4]);

function fixture(opts: { bake: boolean; jointOrder: number[]; sharedMaterial?: boolean; ext?: boolean }): Buffer {
  const chunks: Buffer[] = [];
  const bufferViews: Array<Record<string, number>> = [];
  const add = (payload: Buffer) => {
    const used = chunks.reduce((sum, c) => sum + c.length, 0);
    if (used % 4) chunks.push(Buffer.alloc(4 - (used % 4)));
    const byteOffset = chunks.reduce((sum, c) => sum + c.length, 0);
    chunks.push(payload);
    bufferViews.push({ buffer: 0, byteOffset, byteLength: payload.length });
    return bufferViews.length - 1;
  };
  const floats = (values: number[]) => Buffer.from(new Float32Array(values).buffer);
  const z = opts.bake ? 2 : 1; // bake hair sits at a distinguishable depth
  const body = add(floats([7, 8, 9, 7, 8, 10, 7, 9, 9]));
  const indices = add(Buffer.from(new Uint16Array([0, 1, 2]).buffer));
  const position = add(floats([0, 0, z, 1, 0, z, 0, 1, z]));
  const normal = add(floats([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  const uv = add(floats([0, 0, 1, 0, 0, 1]));
  const joints = add(Buffer.from([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));
  const weights = add(floats([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));
  const accessors = [
    { bufferView: body, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: indices, componentType: 5123, count: 3, type: "SCALAR" },
    { bufferView: position, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: normal, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: uv, componentType: 5126, count: 3, type: "VEC2" },
    { bufferView: joints, componentType: 5121, count: 3, type: "VEC4" },
    { bufferView: weights, componentType: 5126, count: 3, type: "VEC4" },
  ];
  const hairMaterial = opts.bake
    ? { name: "openclinxr_fitted_hair_fixture_mat", alphaMode: "BLEND", doubleSided: true,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, roughnessFactor: 0.9 },
        ...(opts.ext ? { extensions: { KHR_materials_specular: { specularFactor: 0.25 },
          KHR_materials_anisotropy: { anisotropyStrength: 0.5, anisotropyRotation: 1.5708, anisotropyTexture: { index: 0 } } } } : {}) }
    : { name: "openclinxr_fitted_hair_fixture_mat", doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [0.13, 0.09, 0.07, 1], roughnessFactor: 0.9 } };
  const extra = opts.bake
    ? { images: [{ name: "fixture_hair", mimeType: "image/png", bufferView: add(DONOR_PNG) }],
        textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987 }] }
    : {};
  const binary = Buffer.concat(chunks);
  return encodeGlb(
    {
      asset: { version: "2.0" },
      buffers: [{ byteLength: binary.length }],
      bufferViews,
      accessors,
      materials: [{ name: "fixture_body_mat" }, hairMaterial],
      meshes: [
        { name: "fixture_body", extras: { targetNames: ["fixture-target"] }, primitives: [{ material: opts.sharedMaterial ? 1 : 0, attributes: { POSITION: 0 } }] },
        { name: HAIR, primitives: [{ material: 1, indices: 1,
          attributes: { POSITION: 2, NORMAL: 3, TEXCOORD_0: 4, JOINTS_0: 5, WEIGHTS_0: 6 } }] },
      ],
      nodes: [{ name: "Hip" }, { name: "Head" }, { name: "body", mesh: 0 }, { name: "hair", mesh: 1, skin: 0 }],
      skins: [{ joints: opts.jointOrder }],
      scenes: [{ nodes: [0, 1, 2, 3] }],
      scene: 0,
      ...(opts.ext ? { extensionsUsed: ["KHR_materials_specular", "KHR_materials_anisotropy"] } : {}),
      ...extra,
    },
    binary,
  );
}

function run(dir: string, input: string, bake: string, output: string, extra: string[] = []) {
  return spawnSync("mise", ["exec", "--", "python3", TOOL, "--input", input, "--bake", bake,
    "--output", output, "--no-provenance", ...extra], { cwd: ROOT, encoding: "utf8" });
}

describe("library hair transplant", () => {
  const dir = mkdtempSync(join(tmpdir(), "hair-transplant-contract-"));
  const shippedPath = join(dir, "shipped.glb");
  const bakePath = join(dir, "bake.glb");
  writeFileSync(shippedPath, fixture({ bake: false, jointOrder: [0, 1] }));
  // Bake skin lists Head first: a by-index copy would bind hair to Hip.
  writeFileSync(bakePath, fixture({ bake: true, jointOrder: [1, 0] }));

  it("(1)-(3) replaces only the hair primitive, material and image; joints remapped by name", () => {
    const outPath = join(dir, "out.glb");
    const result = run(dir, shippedPath, bakePath, outPath);
    expect(result.status, result.stderr).toBe(0);
    const shipped = parseGlb(shippedPath);
    const out = parseGlb(outPath);

    const hairMesh = out.doc.meshes.find((m) => m.name === HAIR);
    expect(hairMesh, "hair mesh kept its name").toBeDefined();
    const prim = at(hairMesh!.primitives, 0);
    const position = view(out, at(out.doc.accessors, defined(prim.attributes["POSITION"], "POSITION")).bufferView);
    expect([...new Float32Array(position.buffer, position.byteOffset, 9)].filter((_, i) => i % 3 === 2))
      .toEqual([2, 2, 2]); // bake depth, shipped was 1
    const joints = view(out, at(out.doc.accessors, defined(prim.attributes["JOINTS_0"], "JOINTS_0")).bufferView);
    // bake index 0 = Head, which is index 1 in the shipped skin
    expect(joints[0], "bake joint 0 (Head) maps to shipped joint 1").toBe(1);
    expect(joints[4], "bake joint 1 (Hip) maps to shipped joint 0").toBe(0);

    const material = at(out.doc.materials, prim.material);
    expect(prim.material, "hair keeps the shipped material slot").toBe(1);
    expect(material["alphaMode"]).toBe("BLEND");
    const textureIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
    expect(textureIndex, "hair material carries a base colour texture").toBeTypeOf("number");
    const image = at(out.doc.images, at(out.doc.textures, defined(textureIndex, "textureIndex")).source);
    expect(image.mimeType).toBe("image/png");
    expect(view(out, image.bufferView).equals(DONOR_PNG), "under-limit image passes through byte-identical")
      .toBe(true);

    // (2) counterweight
    expect(out.doc.meshes[0]).toEqual(shipped.doc.meshes[0]);
    expect(out.doc.materials[0]).toEqual(shipped.doc.materials[0]);
    expect(out.doc.nodes).toEqual(shipped.doc.nodes);
    expect(out.doc.skins).toEqual(shipped.doc.skins);
    const bodyAccessor = at(out.doc.accessors, defined(at(at(out.doc.meshes, 0).primitives, 0).attributes["POSITION"], "POSITION"));
    expect(view(out, bodyAccessor.bufferView).equals(view(shipped, at(shipped.doc.accessors, 0).bufferView)),
      "body bytes unchanged").toBe(true);
  });

  it("(4) refuses a hair material shared with another mesh", () => {
    const sharedPath = join(dir, "shared.glb");
    writeFileSync(sharedPath, fixture({ bake: false, jointOrder: [0, 1], sharedMaterial: true }));
    const result = run(dir, sharedPath, bakePath, join(dir, "shared-out.glb"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("is shared by");
  });

  it("(5) is deterministic", () => {
    const a = join(dir, "a.glb");
    const b = join(dir, "b.glb");
    for (const target of [a, b]) {
      execFileSync("mise", ["exec", "--", "python3", TOOL, "--input", shippedPath, "--bake", bakePath,
        "--output", target, "--no-provenance"], { cwd: ROOT });
    }
    expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
  });

  it("(6) --alpha-mode MASK --alpha-cutoff 0.2 sets the hair material only; a lone cutoff is refused", () => {
    const outPath = join(dir, "mask.glb");
    const result = run(dir, shippedPath, bakePath, outPath, ["--alpha-mode", "MASK", "--alpha-cutoff", "0.2"]);
    expect(result.status, result.stderr).toBe(0);
    const shipped = parseGlb(shippedPath);
    const out = parseGlb(outPath);
    const hair = at(out.doc.materials, at(out.doc.meshes.find((m) => m.name === HAIR)!.primitives, 0).material);
    expect(hair["alphaMode"]).toBe("MASK");
    expect(hair["alphaCutoff"]).toBe(0.2);
    expect(out.doc.materials[0], "body material untouched").toEqual(shipped.doc.materials[0]);
    const lone = run(dir, shippedPath, bakePath, join(dir, "lone.glb"), ["--alpha-cutoff", "0.2"]);
    expect(lone.status).not.toBe(0);
    expect(lone.stderr).toContain("--alpha-cutoff is required with --alpha-mode MASK");
  });

  const extPath = join(dir, "bake-ext.glb");
  writeFileSync(extPath, fixture({ bake: true, jointOrder: [1, 0], ext: true }));

  it("(7) material extensions are refused unless --carry-extensions; then carried with their texture", () => {
    const refused = run(dir, shippedPath, extPath, join(dir, "ext-refused.glb"));
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("bake hair material has extensions");
    const outPath = join(dir, "ext.glb");
    const result = run(dir, shippedPath, extPath, outPath, ["--carry-extensions"]);
    expect(result.status, result.stderr).toBe(0);
    const out = parseGlb(outPath);
    const doc = out.doc as Doc & { extensionsUsed?: string[] };
    const hair = at(doc.materials, at(doc.meshes.find((m) => m.name === HAIR)!.primitives, 0).material) as {
      extensions?: { KHR_materials_specular?: { specularFactor: number };
        KHR_materials_anisotropy?: { anisotropyStrength: number; anisotropyTexture: { index: number } } };
      pbrMetallicRoughness?: { baseColorTexture?: { index: number } };
    };
    expect(hair.extensions?.KHR_materials_specular?.specularFactor).toBe(0.25);
    expect(hair.extensions?.KHR_materials_anisotropy?.anisotropyStrength).toBe(0.5);
    const texIndex = defined(hair.extensions?.KHR_materials_anisotropy, "anisotropy").anisotropyTexture.index;
    expect(texIndex, "extension texture is a new output texture, not the bake index")
      .not.toBe(hair.pbrMetallicRoughness?.baseColorTexture?.index);
    expect(view(out, at(doc.images, at(doc.textures, texIndex).source).bufferView).equals(DONOR_PNG)).toBe(true);
    expect(doc.extensionsUsed).toEqual(["KHR_materials_anisotropy", "KHR_materials_specular"]);
  });

  it("(8) --fringe-blend adds a BLEND primitive on the same accessors; refused without MASK", () => {
    const outPath = join(dir, "fringe.glb");
    const result = run(dir, shippedPath, bakePath, outPath,
      ["--alpha-mode", "MASK", "--alpha-cutoff", "0.5", "--fringe-blend"]);
    expect(result.status, result.stderr).toBe(0);
    const out = parseGlb(outPath);
    const prims = out.doc.meshes.find((m) => m.name === HAIR)!.primitives as Array<{
      material: number; attributes: Record<string, number>; indices?: number }>;
    expect(prims).toHaveLength(2);
    const p0 = at(prims, 0);
    const p1 = at(prims, 1);
    expect(p1.attributes).toEqual(p0.attributes);
    expect(p1.indices).toBe(p0.indices);
    const core = at(out.doc.materials, p0.material);
    const fringe = at(out.doc.materials, p1.material);
    expect(core["alphaMode"]).toBe("MASK");
    expect(core["alphaCutoff"]).toBe(0.5);
    expect(fringe["alphaMode"]).toBe("BLEND");
    expect(fringe["alphaCutoff"]).toBeUndefined();
    expect(fringe.pbrMetallicRoughness).toEqual(core.pbrMetallicRoughness);
    const refused = run(dir, shippedPath, bakePath, join(dir, "fringe-refused.glb"), ["--fringe-blend"]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("--fringe-blend needs --alpha-mode MASK");
  });

  it("(9) --fringe-triangles draws the fringe on the listed triangles only", () => {
    const keep = join(dir, "keep.json");
    writeFileSync(keep, JSON.stringify({ triangles: [0] }));
    const outPath = join(dir, "fringe-subset.glb");
    const mask = ["--alpha-mode", "MASK", "--alpha-cutoff", "0.5", "--fringe-blend"];
    const result = run(dir, shippedPath, bakePath, outPath, [...mask, "--fringe-triangles", keep]);
    expect(result.status, result.stderr).toBe(0);
    const out = parseGlb(outPath);
    const prims = out.doc.meshes.find((m) => m.name === HAIR)!.primitives as Array<{
      material: number; attributes: Record<string, number>; indices: number }>;
    expect(prims).toHaveLength(2);
    const p0 = at(prims, 0);
    const p1 = at(prims, 1);
    expect(p1.attributes).toEqual(p0.attributes);
    expect(p1.indices).not.toBe(p0.indices);
    const own = at(out.doc.accessors, p1.indices);
    expect(own["count"]).toBe(3);
    const core = at(out.doc.accessors, p0.indices);
    const read = (acc: typeof own) => [...view(out, acc.bufferView)
      .subarray((acc["byteOffset"] as number | undefined) ?? 0)].slice(0, 6);
    expect(read(own)).toEqual(read(core));
    writeFileSync(keep, JSON.stringify({ triangles: [1] }));
    const past = run(dir, shippedPath, bakePath, join(dir, "fringe-past.glb"), [...mask, "--fringe-triangles", keep]);
    expect(past.status).not.toBe(0);
    expect(past.stderr).toContain("--fringe-triangles: indices must be in [0, 1)");
    const alone = run(dir, shippedPath, bakePath, join(dir, "fringe-alone.glb"),
      ["--alpha-mode", "MASK", "--alpha-cutoff", "0.5", "--fringe-triangles", keep]);
    expect(alone.status).not.toBe(0);
    expect(alone.stderr).toContain("--fringe-triangles needs --fringe-blend");
  });
});
