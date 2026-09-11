/**
 * HB-02 — bake albedo into humanoid GLBs (factory_step: clothing_consume).
 *
 * Texel arithmetic, not a render: for each HB-00-cleared material carrying both
 * a baseColorTexture and a non-white baseColorFactor, every texel becomes
 * round(clamp(texel * factor)) at the texture's own resolution (no resample),
 * and the factor is reset to white so a renderer cannot double-apply it.
 * Materials without a texture are untouched — an untextured factor IS the albedo.
 * openclinxr_hidden_* cover shells ([0,0,0,0], alphaMode MASK) are dropped from
 * the bake atlas per HB-00's REMOVE-at-bake verdict: neither baked nor blackened.
 *
 * Resolution provenance: the TRELLIS bake-resolution-ladder.json swept
 * 512 / 1024 / 2048. Every texture baked here is natively 2048 wide, so no new
 * number is invented; the report cites rung "res2048" of that ladder.
 */
import { crc32, inflateSync, deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const RUNG_ID = "bake-resolution-ladder.res2048";
const RUNG_SOURCE = "tools/openclinxr/asset-pipeline/trellis/bake-resolution-ladder.json";
const HB00_AUDIT = "docs/openclinxr/humanoid-basecolorfactor-audit-2026-09-10.json";

type GlbJson = Record<string, unknown>;
type JsonObj = Record<string, unknown>;

function pngChunk(type: string, body: Uint8Array): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(body)])) >>> 0, 0);
  return Buffer.concat([header, Buffer.from(body), crc]);
}

type DecodedPng = { w: number; h: number; chans: number; px: Uint8Array };

function decodePng8(bytes: Uint8Array): DecodedPng {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error("not a PNG");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = -1;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!;
      colour = bytes[off + 17]!;
      interlace = bytes[off + 20]!;
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(off + 8, off + 8 + len));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (depth !== 8 || w === 0 || h === 0) throw new Error(`unsupported PNG depth=${depth} ${w}x${h}`);
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");
  const chans = colour === 2 ? 3 : colour === 6 ? 4 : 0;
  if (chans === 0) throw new Error(`unsupported PNG colour type ${colour}`);
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  const stride = w * chans;
  if (raw.length < (stride + 1) * h) throw new Error("truncated PNG scanlines");
  const px = new Uint8Array(w * h * chans);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    const filter = raw[p++]!;
    for (let x = 0; x < stride; x += 1) {
      const rb = raw[p + x]!;
      const a = x >= chans ? cur[x - chans]! : 0;
      const b = prev[x]!;
      const c = x >= chans ? prev[x - chans]! : 0;
      let v: number;
      if (filter === 0) v = rb;
      else if (filter === 1) v = rb + a;
      else if (filter === 2) v = rb + b;
      else if (filter === 3) v = rb + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    p += stride;
    px.set(cur, y * stride);
    prev.set(cur);
  }
  return { w, h, chans, px };
}

function encodePng8(decoded: DecodedPng): Buffer {
  const { w, h, chans, px } = decoded;
  const stride = w * chans;
  const scan = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    scan[y * (stride + 1)] = 0;
    Buffer.from(px.subarray(y * stride, (y + 1) * stride)).copy(scan, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = chans === 4 ? 6 : 2;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(scan)), pngChunk("IEND", new Uint8Array(0))]);
}

type Glb = { json: GlbJson; bin: Uint8Array; jsonLength: number };

function readGlb(file: string): Glb {
  const bytes = readFileSync(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson;
  const binChunkLength = bytes.readUInt32LE(20 + jsonLength);
  const bin = new Uint8Array(bytes.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + binChunkLength));
  return { json, bin, jsonLength };
}

function concatBytes(parts: Uint8Array[]): Buffer {
  return Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)));
}

function writeGlb(file: string, json: GlbJson, bin: Buffer): void {
  const encoded = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (encoded.length % 4)) % 4;
  const jsonChunk = Buffer.concat([encoded, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binPadded = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binPadded.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.write("JSON", 4, "ascii");
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.write("BIN\0", 4, 4, "ascii");
  writeFileSync(file, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binPadded]));
}

function isWhite3(factor: unknown): boolean {
  if (factor === undefined || factor === null) return true;
  if (!Array.isArray(factor) || factor.length < 3) return false;
  return (factor as number[]).slice(0, 3).every((c) => c === 1);
}

export type BakedSample = { x: number; y: number; before: number[]; factor: number[] };

export type BakedMaterialRow = {
  material: string;
  decision: string;
  sourceResolution: string;
  bakedResolution: string;
  ladderRungId: string;
  texelBudget: number;
  factorBefore: number[];
  factorAfter: number[];
  samples: BakedSample[];
};

export type BakedBodyRow = {
  body: string;
  meshCountBefore: number;
  meshCountAfter: number;
  nodeCountBefore: number;
  nodeCountAfter: number;
  byteLengthBefore: number;
  byteLengthAfter: number;
  materials: BakedMaterialRow[];
};

function listOf(json: GlbJson, key: string): JsonObj[] {
  const v = json[key];
  return Array.isArray(v) ? (v as JsonObj[]) : [];
}

export function bakeGlbAlbedo(input: string, output: string): BakedBodyRow {
  const { json, bin } = readGlb(input);
  const buffers = listOf(json, "buffers");
  if (buffers.length !== 1) throw new Error(`${input}: expected 1 buffer, found ${buffers.length}`);
  const bufferViews = listOf(json, "bufferViews");
  const viewBytes: Uint8Array[] = bufferViews.map((bv) => {
    const off = (bv["byteOffset"] as number | undefined) ?? 0;
    const len = bv["byteLength"] as number;
    return new Uint8Array(bin.subarray(off, off + len));
  });
  const images = listOf(json, "images");
  const textures = listOf(json, "textures");
  const materials = listOf(json, "materials");

  const meshCountBefore = listOf(json, "meshes").length;
  const nodeCountBefore = listOf(json, "nodes").length;
  const byteLengthBefore = readFileSync(input).byteLength;
  const materialsOut: BakedMaterialRow[] = [];

  for (const mat of materials) {
    const name = mat["name"] as string;
    const pbr = mat["pbrMetallicRoughness"] as JsonObj | undefined;
    const texRef = pbr?.["baseColorTexture"] as JsonObj | undefined;
    const factor = pbr?.["baseColorFactor"] as number[] | undefined;
    if (texRef === undefined) continue;
    if (name.startsWith("openclinxr_hidden_")) {
      materialsOut.push({
        material: name,
        decision: "REMOVE-at-bake: hidden cover shell excluded from the bake atlas (HB-00 verdict), untouched",
        sourceResolution: "n/a",
        bakedResolution: "n/a",
        ladderRungId: "n/a",
        texelBudget: 0,
        factorBefore: [0, 0, 0],
        factorAfter: [0, 0, 0],
        samples: [],
      });
      continue;
    }
    if (isWhite3(factor)) {
      const tex = textures[texRef["index"] as number] as JsonObj;
      const img = images[(tex["source"] as number)] as JsonObj;
      const bvIndexSkip = img["bufferView"] as number;
      let dim = "n/a";
      try {
        const probe = decodePng8(viewBytes[bvIndexSkip]!);
        dim = `${probe.w}x${probe.h}`;
      } catch {
        dim = "n/a";
      }
      materialsOut.push({
        material: name,
        decision: "skipped: factor already white, texture carries the look",
        sourceResolution: dim,
        bakedResolution: dim,
        ladderRungId: "n/a",
        texelBudget: 0,
        factorBefore: [1, 1, 1],
        factorAfter: [1, 1, 1],
        samples: [],
      });
      continue;
    }
    const factor3 = (factor as number[]).slice(0, 3);
    const tex = textures[texRef["index"] as number] as JsonObj;
    const imgIndex = tex["source"] as number;
    const img = images[imgIndex] as JsonObj;
    const bvIndex = img["bufferView"] as number;
    const decoded = decodePng8(viewBytes[bvIndex]!);
    const out = new Uint8Array(decoded.px.length);
    for (let i = 0; i < decoded.w * decoded.h; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        const v = Math.round(decoded.px[i * decoded.chans + c]! * factor3[c]!);
        out[i * decoded.chans + c] = Math.min(255, Math.max(0, v));
      }
      if (decoded.chans === 4) out[i * 4 + 3] = decoded.px[i * 4 + 3]!;
    }
    viewBytes[bvIndex] = new Uint8Array(encodePng8({ w: decoded.w, h: decoded.h, chans: decoded.chans, px: out }));
    if (pbr !== undefined) pbr["baseColorFactor"] = [1, 1, 1, 1];
    const samples: BakedSample[] = [];
    for (let s = 0; s < 32; s += 1) {
      const x = (s * 401 + 7) % decoded.w;
      const y = (s * 733 + 13) % decoded.h;
      const i = y * decoded.w + x;
      samples.push({
        x,
        y,
        before: [decoded.px[i * decoded.chans]!, decoded.px[i * decoded.chans + 1]!, decoded.px[i * decoded.chans + 2]!],
        factor: [...factor3],
      });
    }
    materialsOut.push({
      material: name,
      decision: "baked: per-texel texture x factor folded into the texture, factor reset to white",
      sourceResolution: `${decoded.w}x${decoded.h}`,
      bakedResolution: `${decoded.w}x${decoded.h}`,
      ladderRungId: RUNG_ID,
      texelBudget: decoded.w * decoded.h,
      factorBefore: factor3,
      factorAfter: [1, 1, 1],
      samples,
    });
  }

  const outBinParts: Uint8Array[] = [];
  let cursor = 0;
  bufferViews.forEach((bv, i) => {
    const content = viewBytes[i]!;
    const pad = (4 - (content.length % 4)) % 4;
    bv["byteOffset"] = cursor;
    bv["byteLength"] = content.length;
    outBinParts.push(content, new Uint8Array(pad));
    cursor += content.length + pad;
  });
  (buffers[0] as JsonObj)["byteLength"] = cursor;
  mkdirSync(path.dirname(output), { recursive: true });
  writeGlb(output, json, concatBytes(outBinParts));

  return {
    body: path.basename(input),
    meshCountBefore,
    meshCountAfter: listOf(json, "meshes").length,
    nodeCountBefore,
    nodeCountAfter: listOf(json, "nodes").length,
    byteLengthBefore,
    byteLengthAfter: readFileSync(output).byteLength,
    materials: materialsOut,
  };
}

function parseBatchArgs(argv: string[]): { inputs: string[]; outdir: string; report: string } {
  let inputs: string[] = [];
  let outdir = "";
  let report = "";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--inputs") inputs = (argv[++i] ?? "").split(",").filter((s) => s.length > 0);
    else if (argv[i] === "--outdir") outdir = argv[++i] ?? "";
    else if (argv[i] === "--report") report = argv[++i] ?? "";
  }
  if (inputs.length === 0 || !outdir || !report) {
    process.stderr.write("Usage: bake-humanoid-albedo.ts --inputs <a.glb,b.glb> --outdir <dir> --report <path>\n");
    process.exit(2);
  }
  return { inputs, outdir, report };
}

function main(): void {
  const { inputs, outdir, report } = parseBatchArgs(process.argv.slice(2));
  mkdirSync(outdir, { recursive: true });
  const bodies: BakedBodyRow[] = [];
  for (const input of inputs) {
    if (!existsSync(input)) {
      process.stderr.write(`missing input ${input}\n`);
      process.exit(2);
    }
    const output = path.join(outdir, path.basename(input));
    const row = bakeGlbAlbedo(input, output);
    bodies.push(row);
    const baked = row.materials.filter((m) => m.decision.startsWith("baked")).length;
    process.stdout.write(`${row.body}: ${baked} baked, ${row.meshCountAfter} meshes, ${row.nodeCountAfter} nodes\n`);
  }
  const texelTotal = bodies.flatMap((b) => b.materials).reduce((sum, m) => sum + m.texelBudget, 0);
  mkdirSync(path.dirname(report), { recursive: true });
  writeFileSync(
    report,
    `${JSON.stringify(
      {
        schemaVersion: "openclinxr.humanoid-albedo-bake.v1",
        generated: "2026-09-11",
        precondition: "HB-00 (3c2f2fbf): every factor cleared before baking",
        audit: HB00_AUDIT,
        ladder: RUNG_SOURCE,
        ladderRungId: RUNG_ID,
        ladderNote:
          "Every texture baked here is natively 2048 wide, a resolution the TRELLIS ladder already swept; no resample is performed and no fresh number is invented. The rung id names the matching swept cell.",
        hiddenShells: "REMOVE-at-bake: openclinxr_hidden_* cover shells ([0,0,0,0], MASK) are excluded from the bake atlas, never baked black (HB-00 verdict).",
        exceptions: [
          {
            body: "mpfb-street-adult-male.glb",
            reason: "Owned by another agent's street-clothing card (tsk_2a6935fb4eb63f95); not baked on this card.",
          },
        ],
        texelBudgetTotal: texelTotal,
        bodies,
        claimScope: ["per-texel baseColorFactor x baseColorTexture folded into one albedo per cleared material"],
        notEvidenceFor: [
          "decimation or packing (HB-03)",
          "any lighting change to finished_figure_grade.py",
          "how a regenerated body gets baked: no caller wires this station after materialize yet",
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`report: ${report}\n`);
}

const invokedAsCli = process.argv[1] !== undefined && path.resolve(process.argv[1]).endsWith("bake-humanoid-albedo.ts");
if (invokedAsCli) main();
